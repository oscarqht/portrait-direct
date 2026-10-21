import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildThreeMF,fitImportedModel,modelFormat} from '../src/model';
import {disposeObject} from '../src/scene';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';

const asciiSTL=`solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 2 0 0
vertex 0 2 0
endloop
endfacet
endsolid triangle`;

test('model formats accept uppercase extensions and reject unsupported files',()=>{
  for(const extension of ['glb','stl','3mf'] as const) assert.equal(modelFormat(`part.${extension.toUpperCase()}`),extension);
  assert.throws(()=>modelFormat('part.obj'),/Choose a/);
});

test('ASCII and binary STL geometries produce centered, fitted meshes',()=>{
  const binary=new ArrayBuffer(134),view=new DataView(binary);
  view.setUint32(80,1,true);
  [0,0,1,0,0,0,2,0,0,0,2,0].forEach((value,index)=>view.setFloat32(84+index*4,value,true));
  for(const data of [asciiSTL,binary]) {
    const geometry=new STLLoader().parse(typeof data==='string'?new TextEncoder().encode(data).buffer:data);
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());mesh.rotation.x=-Math.PI/2;
    try {
      fitImportedModel(mesh);
      assert.equal(mesh.geometry.getAttribute('position').count,3);
      const bounds=new THREE.Box3().setFromObject(mesh),size=bounds.getSize(new THREE.Vector3());
      assert.ok(bounds.getCenter(new THREE.Vector3()).length()<1e-6);
      assert.ok(Math.abs(Math.max(size.x/.75,size.y,size.z)-1.65)<1e-6);
    } finally {disposeObject(mesh);}

  }
});

test('fitting preserves source scale and rejects empty geometry',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,1,3));mesh.scale.set(2,3,4);mesh.position.set(8,9,10);
  try {
    fitImportedModel(mesh);
    const bounds=new THREE.Box3().setFromObject(mesh),size=bounds.getSize(new THREE.Vector3());
    assert.ok(bounds.getCenter(new THREE.Vector3()).length()<1e-6);
    assert.ok(Math.abs(size.z/size.x-3)<1e-6);
    assert.throws(()=>fitImportedModel(new THREE.Group()),/no renderable bounds/);
  } finally {disposeObject(mesh);}
});

test('3MF instances apply their own transform once and share geometry',()=>{
  const part={unitScale:1,objects:{'1':{components:[],mesh:{positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])}}},build:[
    {objectId:'1',transform:[1,0,0,0,1,0,0,0,1,10,0,0]},
    {objectId:'1',transform:[1,0,0,0,1,0,0,0,1,20,0,0]},
  ]};
  const group=buildThreeMF({root:'3D/model.model',parts:{'3D/model.model':part},unsupported:[]});
  try {
    assert.equal(group.children[0].position.x,10);
    assert.equal(group.children[1].position.x,20);
    const first=group.children[0].children[0] as THREE.Mesh,second=group.children[1].children[0] as THREE.Mesh;
    assert.equal(first.geometry,second.geometry);
    const bounds=new THREE.Box3().setFromObject(group);
    assert.equal(bounds.min.x,10);assert.equal(bounds.max.x,21);
  } finally {disposeObject(group);}
});
