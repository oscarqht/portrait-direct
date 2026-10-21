import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createScene,disposeObject} from '../src/scene.ts';

test('liquid glass uses physical transmission, a fixed gray grid and a single uncaptured face',()=>{
  const state=createScene('glass');
  const body=state.content.getObjectByName('triangle-body') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshPhysicalMaterial>;
  assert.ok(body.material.transmission>.9&&body.material.dispersion>0&&body.material.thickness>.9);
  const face=state.content.getObjectByName('pet-face')!;
  face.traverse(o=>{if(o instanceof THREE.Mesh)assert.equal(o.material.transparent,true,'eyes stay out of opaque transmission capture');});
  const grid=state.content.getObjectByName('glass-gray-grid') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  assert.equal(grid.material.transparent,false);
  const gray=grid.material.uniforms.ink.value as THREE.Color;
  assert.ok(Math.max(gray.r,gray.g,gray.b)-Math.min(gray.r,gray.g,gray.b)<.1);
  state.content.rotation.set(.12,.7,0);state.update(.37);state.scene.updateMatrixWorld(true);
  const position=grid.getWorldPosition(new THREE.Vector3()),rotation=grid.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(position.distanceTo(new THREE.Vector3(0,0,-1.1))<1e-12);
  assert.ok(rotation.angleTo(new THREE.Quaternion())<1e-7);
  const left=state.content.getObjectByName('left-paw')!,before=left.position.clone();state.update(.5);assert.notDeepEqual(left.position,before);
  const resources=new Set<THREE.BufferGeometry|THREE.Material>();
  const environment=new THREE.Texture();environment.userData.portraitRendererOwned=true;body.material.envMap=environment;
  let environmentDisposed=false;environment.addEventListener('dispose',()=>environmentDisposed=true);
  state.content.traverse(o=>{if(o instanceof THREE.Mesh){resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])resources.add(m);}});
  let disposals=0;resources.forEach(r=>r.addEventListener('dispose',()=>disposals++));
  disposeObject(state.content);assert.equal(disposals,resources.size);
  assert.equal(environmentDisposed,false,'scene replacement preserves the renderer-owned studio map');environment.dispose();
});
