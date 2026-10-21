import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createScene,disposeObject} from '../src/scene.ts';
import {createWorkingPose,sampleWorkingPose,workingDuration} from '../src/working-pose.ts';

test('Working preserves the reference typing poses and loops continuously',()=>{
  const pose=createWorkingPose();
  sampleWorkingPose(0,pose); assert.equal(pose.leftY,-9); assert.equal(pose.rightY,-24);
  sampleWorkingPose(120,pose); assert.equal(pose.leftY,-22); assert.equal(pose.rightY,-9);
  const start=sampleWorkingPose(0,createWorkingPose());
  assert.deepEqual(sampleWorkingPose(workingDuration,pose),start);
  for(const t of [0,120,240,360,480,600,820]) {
    const before=sampleWorkingPose(t-.001,createWorkingPose()),after=sampleWorkingPose(t+.001,createWorkingPose());
    for(const key of Object.keys(pose) as (keyof typeof pose)[]) assert.ok(Math.abs(before[key]-after[key])<.001,`${key} jumps at ${t}`);
  }
  // Shape-preserving interpolation must never send a paw outside its reference range.
  for(let t=0;t<workingDuration;t+=2) {
    sampleWorkingPose(t,pose);
    assert.ok(pose.leftY>=-24&&pose.leftY<=-9);
    assert.ok(pose.rightY>=-26&&pose.rightY<=-9);
  }
});

test('3D typing changes paws and keys while reusing geometry and staying inside Portrait framing',()=>{
  const {content,update}=createScene();
  const get=(name:string)=>content.getObjectByName(name)!;
  const left=get('left-paw'),right=get('right-paw'),body=get('triangle-body') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  assert.equal(body.material.color.getHexString(),'ac7bfa');
  const leftY=left.position.y,rightY=right.position.y;
  const keys=get('typing-keys') as THREE.InstancedMesh;
  const initialKeys=keys.instanceMatrix.array.slice();
  const resources:unknown[]=[];
  content.traverse(o=>{if(o instanceof THREE.Mesh) resources.push(o.geometry,o.geometry.attributes.position.array,o.material);});
  update(.12);
  assert.ok(left.position.y>leftY); assert.ok(right.position.y<rightY);
  assert.notDeepEqual(keys.instanceMatrix.array,initialKeys);
  for(let t=0;t<2;t+=1/30) {
    update(t);
    content.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(get('pet-body-rig'));
    assert.ok(bounds.min.x>-.9&&bounds.max.x<.9);
    assert.ok(bounds.min.y>-.9&&bounds.max.y<.9);
  }
  const after:unknown[]=[];
  content.traverse(o=>{if(o instanceof THREE.Mesh) after.push(o.geometry,o.geometry.attributes.position.array,o.material);});
  assert.equal(after.length,resources.length);
  after.forEach((resource,i)=>assert.equal(resource,resources[i]));
  const paused=left.position.clone(); update(2); const atTwo=left.position.clone(); update(2);
  assert.deepEqual(left.position,atTwo); assert.notDeepEqual(paused,atTwo);
  const disposed=new Map<THREE.BufferGeometry|THREE.Material,number>();
  for(const resource of resources) if(resource instanceof THREE.BufferGeometry||resource instanceof THREE.Material) {
    if(!disposed.has(resource)) {disposed.set(resource,0);resource.addEventListener('dispose',()=>disposed.set(resource,disposed.get(resource)!+1));}
  }
  disposeObject(content);
  for(const count of disposed.values()) assert.equal(count,1,'shared resources dispose exactly once');
});
