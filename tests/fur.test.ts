import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createScene,disposeObject} from '../src/scene.ts';
import {furCounts} from '../src/fur.ts';
import {FurMotion} from '../src/fur-motion.ts';

test('fur follicles cover the body deterministically, with finite unit normals and eye taper',()=>{
  const first=createScene('furry'),second=createScene('furry');
  const coat=first.content.getObjectByName('furry-coat') as THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  const other=second.content.getObjectByName('furry-coat') as typeof coat;
  const roots=coat.geometry.getAttribute('aRootPos'),normals=coat.geometry.getAttribute('aRootNormal'),masks=coat.geometry.getAttribute('aMaskValue');
  assert.deepEqual(roots.array,other.geometry.getAttribute('aRootPos').array);
  let front=0,back=0,shortFace=0;
  for(let i=0;i<roots.count;i++) {
    assert.ok(Number.isFinite(roots.getX(i)+roots.getY(i)+roots.getZ(i)));
    assert.ok(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)<1e-5);
    assert.ok(masks.getX(i)>=.09&&masks.getX(i)<=1);
    if(roots.getZ(i)>.3)front++;if(roots.getZ(i)<-.3)back++;
    if(roots.getZ(i)>.35&&masks.getX(i)<.3)shortFace++;
  }
  assert.ok(front>2000&&back>2000&&shortFace>100);
  const attributes=Object.values(coat.geometry.attributes).map(a=>a.array);
  const geometry=coat.geometry,material=coat.material;
  for(const profile of ['eco','balanced','detail'] as const) {
    first.setProfile(profile);assert.equal(geometry.instanceCount,furCounts[profile]);
    first.update(.5);assert.equal(material.uniforms.uTime.value,.5);
    first.update(.5);assert.equal(material.uniforms.uTime.value,.5);
    assert.equal(coat.geometry,geometry);assert.equal(coat.material,material);
    Object.values(geometry.attributes).forEach((a,i)=>assert.equal(a.array,attributes[i]));
  }
  let geometryDisposed=0,materialDisposed=0;
  geometry.addEventListener('dispose',()=>geometryDisposed++); material.addEventListener('dispose',()=>materialDisposed++);
  disposeObject(first.content);disposeObject(second.content);
  assert.equal(geometryDisposed,1);assert.equal(materialDisposed,1);
  const smooth=createScene('triangle');assert.equal(smooth.content.getObjectByName('furry-coat'),undefined);disposeObject(smooth.content);
});

test('fur spring trails rotation and squash, settles, and freezes at a paused clock',()=>{
  const motion=new FurMotion(),matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1);
  motion.update(0,matrix);
  for(let i=1;i<=15;i++) {
    rotation.setFromAxisAngle(new THREE.Vector3(0,0,1),i/15*.3);
    scale.set(1+i*.002,1-i*.002,1);
    matrix.compose(position,rotation,scale);motion.update(i/30,matrix);
  }
  assert.ok(motion.angular.z<-.05,'fur trails the positive body rotation');
  assert.ok(motion.stretch.x<0&&motion.stretch.y>0,'coat lags the body squash');
  const frozen=[...motion.linear.toArray(),...motion.angular.toArray(),...motion.stretch.toArray()];
  for(let i=0;i<20;i++)motion.update(.5,matrix);
  assert.deepEqual([...motion.linear.toArray(),...motion.angular.toArray(),...motion.stretch.toArray()],frozen);
  const initial=motion.angular.length();
  for(let i=16;i<=105;i++)motion.update(i/30,matrix);
  assert.ok(motion.angular.length()<initial*.001&&motion.stretch.length()<.001,'spring settles on a still body');
  motion.update(0,matrix);assert.equal(motion.angular.length(),0);
});

test('working pose drives fur inertia without reallocating attributes',()=>{
  const state=createScene('furry');
  const coat=state.content.getObjectByName('furry-coat') as THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  const uniforms=coat.material.uniforms;
  const angular=uniforms.uAngularLag.value as THREE.Vector3,stretch=uniforms.uStretchLag.value as THREE.Vector3;
  let peak=0;
  for(let frame=1;frame<60;frame++) {state.update(frame/30);peak=Math.max(peak,angular.length()+stretch.length());}
  assert.ok(peak>.05,'typing tilt and squash cause measurable coat lag');
  const before=angular.clone();state.update(59/30);assert.deepEqual(angular,before);
  disposeObject(state.content);
});
