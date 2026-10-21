import { unzipSync } from 'three/addons/libs/fflate.module.js';

/** Plain data, transferable from a worker without constructing a DOM or Three objects. */
export interface ThreeMFMaterial { color:[number,number,number]; opacity:number }
export interface ThreeMFMesh {
  positions:Float32Array;
  indices:Uint32Array;
  colors?:Float32Array;
  groups?:{start:number;count:number;materialIndex:number}[];
  materials?:ThreeMFMaterial[];
}
export interface ThreeMFReference { objectId:string; path?:string; transform?:number[] }
export interface ThreeMFObject { name?:string; mesh?:ThreeMFMesh; components:ThreeMFReference[] }
export interface ThreeMFPart { objects:Record<string,ThreeMFObject>; build:ThreeMFReference[]; unitScale:number }
export interface ParsedThreeMF { root:string; parts:Record<string,ThreeMFPart>; unsupported:string[] }

type Attributes=Record<string,string>;
type Tag={name:string;attributes:string;start:number;end:number;closing:boolean};
type Properties={kind:'base'|'color'; materials:ThreeMFMaterial[]};
const attributePattern=/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function unescapeXML(value:string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_all,key:string)=>{
    if(key[0]==='#') return String.fromCodePoint(key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1)));
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[key]??_all;
  });
}
function attributes(source:string):Attributes {
  const result:Attributes=Object.create(null);
  attributePattern.lastIndex=0;
  let match:RegExpExecArray|null;
  while((match=attributePattern.exec(source))) result[match[1]]=unescapeXML(match[2]??match[3]);
  return result;
}
/** Scans one bounded tag at a time; comments and CDATA never become geometry. */
function walkTags(xml:string,visit:(tag:Tag)=>void,start=0,end=xml.length) {
  let cursor=start;
  while((cursor=xml.indexOf('<',cursor))>=0&&cursor<end) {
    if(xml.startsWith('<!--',cursor)) { const close=xml.indexOf('-->',cursor+4); if(close<0) throw new Error('Unclosed 3MF XML comment.'); cursor=close+3; continue; }
    if(xml.startsWith('<![CDATA[',cursor)) { const close=xml.indexOf(']]>',cursor+9); if(close<0) throw new Error('Unclosed 3MF XML CDATA.'); cursor=close+3; continue; }
    if(xml.startsWith('<!DOCTYPE',cursor)) throw new Error('3MF XML document types are not supported.');
    let stop=cursor+1,quote='';
    for(;stop<end;stop++) {
      const ch=xml[stop];
      if(quote) { if(ch===quote) quote=''; }
      else if(ch==='"'||ch==="'") quote=ch;
      else if(ch==='>') break;
    }
    if(stop>=end) throw new Error('Unclosed 3MF XML tag.');
    const closing=xml[cursor+1]==='/';
    const nameStart=cursor+(closing?2:1);
    let nameEnd=nameStart;
    while(nameEnd<stop&&!/[\s/]/.test(xml[nameEnd])) nameEnd++;
    const qualified=xml.slice(nameStart,nameEnd);
    if(qualified[0]!=='?'&&qualified[0]!=='!') visit({name:qualified.slice(qualified.lastIndexOf(':')+1),attributes:xml.slice(nameEnd,stop),start:cursor,end:stop+1,closing});
    cursor=stop+1;
  }
}
function pathName(path:string,relativeTo='') {
  const parts=(path.startsWith('/')?path:relativeTo.slice(0,relativeTo.lastIndexOf('/')+1)+path).replace(/\\/g,'/').split('/');
  const normalized:string[]=[];
  for(const part of parts) { if(part==='..') normalized.pop(); else if(part&&part!=='.') normalized.push(part); }
  return normalized.join('/');
}
function reference(a:Attributes,path:string):ThreeMFReference {
  if(!a.objectid) throw new Error('A 3MF component is missing its object ID.');
  const ref:ThreeMFReference={objectId:a.objectid};
  const external=Object.keys(a).find(key=>key==='path'||key.endsWith(':path'));
  if(external) ref.path=pathName(a[external],path);
  if(a.transform) {
    ref.transform=a.transform.trim().split(/\s+/).map(Number);
    if(ref.transform.length!==12||ref.transform.some(n=>!Number.isFinite(n))) throw new Error('Invalid 3MF component transform.');
  }
  return ref;
}
function material(value:string):ThreeMFMaterial {
  if(!/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) throw new Error(`Invalid 3MF display color: ${value}`);
  return {color:[parseInt(value.slice(1,3),16)/255,parseInt(value.slice(3,5),16)/255,parseInt(value.slice(5,7),16)/255],opacity:value.length===9?parseInt(value.slice(7,9),16)/255:1};
}
const defaultMaterial:ThreeMFMaterial={color:[0.635,0.780,1],opacity:1};
const vertexFast=/^\s*x\s*=\s*"([^"]+)"\s+y\s*=\s*"([^"]+)"\s+z\s*=\s*"([^"]+)"/;
const triangleFast=/^\s*v1\s*=\s*"(\d+)"\s+v2\s*=\s*"(\d+)"\s+v3\s*=\s*"(\d+)"/;
function parseMesh(xml:string,start:number,end:number,objectAttributes:Attributes,properties:Map<string,Properties>,unsupported:Set<string>):ThreeMFMesh {
  let vertices=0,triangles=0;
  walkTags(xml,tag=>{ if(!tag.closing) { if(tag.name==='vertex') vertices++; else if(tag.name==='triangle') triangles++; } },start,end);
  if(!vertices||!triangles) throw new Error('The 3MF mesh has no renderable triangles.');
  const positions=new Float32Array(vertices*3),indices=new Uint32Array(triangles*3);
  let vertex=0,triangle=0;
  // Property storage is allocated only if standard material properties are actually used.
  let propertyIds:Uint32Array|undefined,cornerProperties:Uint32Array|undefined;
  const propertyNumbers=new Map<string,number>(),propertyValues:string[]=[];
  const defaultPid=objectAttributes.pid;
  const defaultIndex=Number(objectAttributes.pindex??0);
  function propertyNumber(pid:string) { let number=propertyNumbers.get(pid); if(number===undefined) { number=propertyValues.length; propertyNumbers.set(pid,number); propertyValues.push(pid); } return number; }
  walkTags(xml,tag=>{
    if(tag.closing) return;
    if(tag.name==='vertex') {
      const fast=vertexFast.exec(tag.attributes),a=fast?null:attributes(tag.attributes);
      const x=Number(fast?fast[1]:a!.x),y=Number(fast?fast[2]:a!.y),z=Number(fast?fast[3]:a!.z);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)) throw new Error('The 3MF contains a non-finite vertex.');
      positions[vertex++]=x; positions[vertex++]=y; positions[vertex++]=z;
    } else if(tag.name==='triangle') {
      const fast=triangleFast.exec(tag.attributes);
      const hasProperties=defaultPid!==undefined||/\b(?:pid|p1|p2|p3)\s*=/.test(tag.attributes);
      const a=(!fast||hasProperties)?attributes(tag.attributes):null;
      for(let corner=0;corner<3;corner++) {
        const index=Number(fast?fast[corner+1]:a![`v${corner+1}`]);
        if(!Number.isInteger(index)||index<0||index>=vertices) throw new Error('The 3MF contains an invalid triangle vertex index.');
        indices[triangle*3+corner]=index;
      }
      if(hasProperties) {
        const pid=a!.pid??defaultPid;
        if(pid!==undefined) {
          if(!propertyIds) { propertyIds=new Uint32Array(triangles); propertyIds.fill(0xffffffff); cornerProperties=new Uint32Array(triangles*3); }
          propertyIds[triangle]=propertyNumber(pid);
          const p1=Number(a!.p1??defaultIndex),p2=Number(a!.p2??p1),p3=Number(a!.p3??p1);
          if([p1,p2,p3].some(n=>!Number.isInteger(n)||n<0)) throw new Error('Invalid 3MF material index.');
          cornerProperties![triangle*3]=p1; cornerProperties![triangle*3+1]=p2; cornerProperties![triangle*3+2]=p3;
        }
      }
      triangle++;
    }
  },start,end);
  if(!propertyIds) return {positions,indices};
  const resources=propertyValues.map(pid=>{ const value=properties.get(pid); if(!value) unsupported.add(`property resource ${pid}`); return value; });
  function triangleMaterial(t:number,corner=0):ThreeMFMaterial {
    const resource=resources[propertyIds![t]];
    if(!resource) return defaultMaterial;
    const result=resource.materials[cornerProperties![t*3+(resource.kind==='base'?0:corner)]];
    if(!result) throw new Error('The 3MF references a missing material color.');
    return result;
  }
  if(resources.some(resource=>resource?.kind==='color')) {
    const expanded=new Float32Array(triangles*9),colors=new Float32Array(triangles*9),expandedIndices=new Uint32Array(triangles*3);
    for(let t=0;t<triangles;t++) for(let corner=0;corner<3;corner++) {
      const offset=t*9+corner*3,index=indices[t*3+corner]*3,c=triangleMaterial(t,corner);
      expanded[offset]=positions[index]; expanded[offset+1]=positions[index+1]; expanded[offset+2]=positions[index+2];
      colors.set(c.color,offset); expandedIndices[t*3+corner]=t*3+corner;
      if(c.opacity!==1) unsupported.add('vertex color opacity');
    }
    return {positions:expanded,indices:expandedIndices,colors};
  }
  // Bucket triangles by material; a heavily painted model still needs one draw call per material.
  const materials:ThreeMFMaterial[]=[],materialIds=new Map<ThreeMFMaterial,number>(),triangleMaterials=new Uint32Array(triangles),counts:number[]=[];
  for(let t=0;t<triangles;t++) {
    const value=triangleMaterial(t); let id=materialIds.get(value);
    if(id===undefined) { id=materials.length; materialIds.set(value,id); materials.push(value); counts.push(0); }
    triangleMaterials[t]=id; counts[id]+=3;
  }
  let offset=0;
  const groups=counts.map((count,materialIndex)=>{ const group={start:offset,count,materialIndex}; offset+=count; return group; });
  const cursors=groups.map(group=>group.start),groupedIndices=new Uint32Array(indices.length);
  for(let t=0;t<triangles;t++) { const id=triangleMaterials[t],at=cursors[id]; groupedIndices[at]=indices[t*3]; groupedIndices[at+1]=indices[t*3+1]; groupedIndices[at+2]=indices[t*3+2]; cursors[id]+=3; }
  return {positions,indices:groupedIndices,materials,groups};
}

export function parseThreeMF(data:ArrayBuffer,onProgress?:(phase:string)=>void):ParsedThreeMF {
  onProgress?.('Decompressing 3MF model…');
  const zip=unzipSync(new Uint8Array(data),{filter:entry=>/\.(model|rels)$/i.test(entry.name)});
  const decoder=new TextDecoder(),parts:Record<string,ThreeMFPart>=Object.create(null),unsupported=new Set<string>();
  let root='';
  const rootRelations=zip['_rels/.rels'];
  if(rootRelations) walkTags(decoder.decode(rootRelations),tag=>{
    if(tag.name==='Relationship'&&!tag.closing) { const a=attributes(tag.attributes); if(a.Type?.endsWith('/3dmodel')&&a.TargetMode!=='External') root=pathName(a.Target); }
  });
  for(const zipPath of Object.keys(zip)) {
    if(!/\.model$/i.test(zipPath)) continue;
    onProgress?.(`Reading ${zipPath}…`);
    const path=pathName(zipPath),xml=decoder.decode(zip[zipPath]);
    delete zip[zipPath];
    const part:ThreeMFPart={objects:Object.create(null),build:[],unitScale:1};
    const properties=new Map<string,Properties>();
    const meshRanges:{object:ThreeMFObject;a:Attributes;start:number;end:number}[]=[];
    let object:ThreeMFObject|undefined,objectAttrs:Attributes={},meshStart=-1,currentProperties:Properties|undefined;
    let inBuild=false,hasModel=false;
    walkTags(xml,tag=>{
      if(tag.closing) {
        if(tag.name==='object') object=undefined;
        else if(tag.name==='mesh'&&object&&meshStart>=0) { meshRanges.push({object,a:objectAttrs,start:meshStart,end:tag.start}); meshStart=-1; }
        else if(tag.name==='basematerials'||tag.name==='colorgroup') currentProperties=undefined;
        else if(tag.name==='build') inBuild=false;
        return;
      }
      if(tag.name==='vertex'||tag.name==='triangle') return;
      const a=attributes(tag.attributes);
      switch(tag.name) {
        case 'model': {
          hasModel=true;
          part.unitScale=({micron:0.001,millimeter:1,centimeter:10,meter:1000,inch:25.4,foot:304.8} as Record<string,number>)[a.unit??'millimeter']??1;
          if(a.requiredextensions) for(const prefix of a.requiredextensions.split(/\s+/)) {
            const namespace=a[`xmlns:${prefix}`]??'';
            if(!namespace.includes('/production/')&&!namespace.includes('/material/')) unsupported.add(`required extension ${prefix}`);
          }
          break;
        }
        case 'object': object={name:a.name,components:[]}; objectAttrs=a; part.objects[a.id]=object; break;
        case 'mesh': meshStart=tag.end; break;
        case 'component': if(object) object.components.push(reference(a,path)); break;
        case 'build': inBuild=true; break;
        case 'item': if(inBuild) part.build.push(reference(a,path)); break;
        case 'basematerials': case 'colorgroup': currentProperties={kind:tag.name==='basematerials'?'base':'color',materials:[]}; properties.set(a.id,currentProperties); break;
        case 'base': if(currentProperties) currentProperties.materials.push(material(a.displaycolor??'#ffffff')); break;
        case 'color': if(currentProperties) currentProperties.materials.push(material(a.color??'#ffffff')); break;
        case 'texture2d': case 'texture2dgroup': case 'multiproperties': case 'compositematerials': case 'displayproperties': case 'beamlattice': unsupported.add(tag.name); break;
      }
    });
    if(!hasModel) throw new Error(`No 3MF model element in ${path}.`);
    for(const range of meshRanges) range.object.mesh=parseMesh(xml,range.start,range.end,range.a,properties,unsupported);
    parts[path]=part;
  }
  if(!root) root=Object.keys(parts).find(path=>/^3D\/[^/]+\.model$/i.test(path))??Object.keys(parts)[0];
  if(!root||!parts[root]) throw new Error('The 3MF archive has no root model.');
  if(!parts[root].build.length) throw new Error('The 3MF root model has no build items.');
  // Reject missing references and cycles before a renderer attempts to instantiate them.
  const visiting=new Set<string>(),visited=new Set<string>();
  function validate(ref:ThreeMFReference,partPath:string) {
    const target=ref.path??partPath,key=`${target}#${ref.objectId}`;
    if(visiting.has(key)) throw new Error('The 3MF contains cyclic object components.');
    if(visited.has(key)) return;
    const targetObject=parts[target]?.objects[ref.objectId];
    if(!targetObject) throw new Error(`The 3MF references a missing object: ${key}`);
    visiting.add(key);
    for(const child of targetObject.components) validate(child,target);
    visiting.delete(key); visited.add(key);
  }
  for(const ref of parts[root].build) validate(ref,root);
  onProgress?.('3MF geometry ready.');
  return {root,parts,unsupported:[...unsupported]};
}

export function threeMFTransferables(parsed:ParsedThreeMF):ArrayBuffer[] {
  const buffers=new Set<ArrayBuffer>();
  for(const part of Object.values(parsed.parts)) for(const object of Object.values(part.objects)) if(object.mesh) {
    buffers.add(object.mesh.positions.buffer as ArrayBuffer); buffers.add(object.mesh.indices.buffer as ArrayBuffer);
    if(object.mesh.colors) buffers.add(object.mesh.colors.buffer as ArrayBuffer);
  }
  return [...buffers];
}
