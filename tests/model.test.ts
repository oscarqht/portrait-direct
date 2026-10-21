import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {fitImportedModel,loadImportedModel,modelFormat} from '../src/model';
import {disposeObject} from '../src/scene';

// Three.js FileLoader emits browser progress events during streaming fetches.
if(!globalThis.ProgressEvent) Object.defineProperty(globalThis,'ProgressEvent',{value:class ProgressEvent extends Event {
  constructor(type:string,readonly init:ProgressEventInit={}) {super(type);}
}});

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

test('ASCII and binary STL imports produce centered, fitted meshes',async()=>{
  const binary=new ArrayBuffer(134),view=new DataView(binary);
  view.setUint32(80,1,true);
  [0,0,1,0,0,0,2,0,0,0,2,0].forEach((value,index)=>view.setFloat32(84+index*4,value,true));
  for(const data of [asciiSTL,binary]) {
    const url=URL.createObjectURL(new Blob([data]));
    try {
      const mesh=await loadImportedModel(url,'triangle.STL') as THREE.Mesh;
      try {
        assert.equal(mesh.geometry.getAttribute('position').count,3);
        const bounds=new THREE.Box3().setFromObject(mesh),size=bounds.getSize(new THREE.Vector3());
        assert.ok(bounds.getCenter(new THREE.Vector3()).length()<1e-6);
        assert.ok(Math.abs(Math.max(size.x/.75,size.y,size.z)-1.65)<1e-6);
        assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
      } finally {disposeObject(mesh);}
    } finally {URL.revokeObjectURL(url);}
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
