import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js';
import { parseThreeMF, threeMFTransferables } from '../src/three-mf';

function archive(parts:Record<string,string>) {
  const bytes=zipSync(Object.fromEntries(Object.entries(parts).map(([name,xml])=>[name,strToU8(xml)])));
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
}
const vertices='<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>';
function model(resources:string,build='<item objectid="1"/>',unit='millimeter') {
  return `<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resources}</resources><build>${build}</build></model>`;
}
const mesh=(triangles='<triangle v1="0" v2="1" v3="2"/>')=>`<mesh>${vertices}<triangles>${triangles}</triangles></mesh>`;

test('3MF parser retains indexed geometry and transfers buffers without a DOM',()=>{
  const phases:string[]=[];
  const parsed=parseThreeMF(archive({'3D/3dmodel.model':model(`<object id="1" name="A &amp; B">${mesh()}</object>`)}),phase=>phases.push(phase));
  const object=parsed.parts[parsed.root].objects['1'];
  assert.equal(object.name,'A & B');
  assert.deepEqual([...object.mesh!.indices],[0,1,2]);
  assert.deepEqual([...object.mesh!.positions],[0,0,0,1,0,0,0,1,0]);
  assert.equal(threeMFTransferables(parsed).length,2);
  assert.deepEqual(parsed.unsupported,[]);
  assert.ok(phases.length>=3);
});

test('3MF production components resolve external parts and retain both transforms',()=>{
  const transform='1 0 0 0 1 0 0 0 1 10 20 30';
  const parsed=parseThreeMF(archive({
    '_rels/.rels':'<Relationships><Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/root.model"/></Relationships>',
    '3D/root.model':model(`<object id="2"><components><component p:path="/3D/Objects/piece.model" objectid="1" transform="${transform}"/></components></object>`,'<item objectid="2" transform="1 0 0 0 1 0 0 0 1 5 6 7"/>'),
    '3D/Objects/piece.model':model(`<object id="1">${mesh()}</object>`,'','inch'),
    '3D/unreferenced.model':model('<object id="1"/>'),
  }));
  assert.equal(parsed.root,'3D/root.model');
  const root=parsed.parts[parsed.root];
  assert.deepEqual(root.build[0].transform?.slice(9),[5,6,7]);
  const component=root.objects['2'].components[0];
  assert.equal(component.path,'3D/Objects/piece.model');
  assert.deepEqual(component.transform?.slice(9),[10,20,30]);
  assert.equal(parsed.parts[component.path!].unitScale,25.4);
  assert.equal(parsed.parts[component.path!].objects['1'].mesh!.positions.length,9);
});

test('3MF base material defaults and overrides become grouped indexed draws',()=>{
  const resources='<basematerials id="5"><base name="Red" displaycolor="#FF0000"/><base name="Blue" displaycolor="#0000FF80"/></basematerials>'+
    `<object id="1" pid="5" pindex="1">${mesh('<triangle v1="0" v2="1" v3="2"/><triangle v1="2" v2="1" v3="0" p1="0"/><triangle v1="0" v2="2" v3="1"/>')}</object>`;
  const result=parseThreeMF(archive({'3D/root.model':model(resources)})).parts['3D/root.model'].objects['1'].mesh!;
  assert.equal(result.positions.length,9);
  assert.deepEqual([...result.indices],[0,1,2,0,2,1,2,1,0]);
  assert.deepEqual(result.groups,[{start:0,count:6,materialIndex:0},{start:6,count:3,materialIndex:1}]);
  assert.deepEqual(result.materials![0].color,[0,0,1]);
  assert.equal(result.materials![0].opacity,128/255);
  assert.deepEqual(result.materials![1].color,[1,0,0]);
});

test('3MF color groups preserve per-corner colors and object property defaults',()=>{
  const resources='<m:colorgroup id="5"><m:color color="#FF0000"/><m:color color="#00FF00"/><m:color color="#0000FF"/></m:colorgroup>'+
    `<object id="1" pid="5" pindex="0">${mesh('<triangle v1="0" v2="1" v3="2" p2="1" p3="2"/>')}</object>`;
  const result=parseThreeMF(archive({'3D/root.model':model(resources)})).parts['3D/root.model'].objects['1'].mesh!;
  assert.deepEqual([...result.colors!],[1,0,0,0,1,0,0,0,1]);
  assert.deepEqual([...result.positions],[0,0,0,1,0,0,0,1,0]);
});

test('3MF handles attribute order, XML prefixes, quotes, and ignores fake comment geometry',()=>{
  const xml=model(`<object id='1'><mesh><vertices><!-- <vertex x="5" y="5" z="5"/> --><c:vertex z='0' x='0' y='0'/><c:vertex y='0' z='0' x='1'/><c:vertex x='0' z='0' y='1'/></vertices><triangles><c:triangle v3='2' v1='0' v2='1' paint_color='unsupported-slicer-data'/></triangles></mesh></object>`);
  const parsed=parseThreeMF(archive({'3D/root.model':xml}));
  assert.deepEqual([...parsed.parts[parsed.root].objects['1'].mesh!.indices],[0,1,2]);
  assert.deepEqual(parsed.unsupported,[]);
});

test('3MF reports standard features requiring the full loader',()=>{
  const xml=model(`<texture2d id="3" path="/3D/Textures/color.png"/><object id="1">${mesh()}</object>`);
  const result=parseThreeMF(archive({'3D/root.model':xml,'3D/Textures/color.png':'not decoded'}));
  assert.deepEqual(result.unsupported,['texture2d']);
});

test('3MF rejects invalid indices, missing references, cycles, and empty builds',()=>{
  assert.throws(()=>parseThreeMF(archive({'3D/root.model':model(`<object id="1">${mesh('<triangle v1="0" v2="1" v3="99"/>')}</object>`)})),/invalid triangle vertex/);
  assert.throws(()=>parseThreeMF(archive({'3D/root.model':model('<object id="1"><components><component objectid="2"/></components></object>')})),/missing object/);
  assert.throws(()=>parseThreeMF(archive({'3D/root.model':model('<object id="1"><components><component objectid="1"/></components></object>')})),/cyclic/);
  assert.throws(()=>parseThreeMF(archive({'3D/root.model':model(`<object id="1">${mesh()}</object>`,'')})),/no build items/);
});
