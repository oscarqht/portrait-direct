import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cameraDistance,focalDistance,setViewCamera,worldFocus,type FocusPoint} from '../src/focus.ts';
import {profiles,viewOffset} from '../src/calibration.ts';

test('a picked model point has zero disparity across every view after rotation and framing changes',()=>{
  const content=new THREE.Group(),camera=new THREE.PerspectiveCamera(18,.75,.1,100);
  const selected:FocusPoint=[.4,.2,.7];
  content.scale.setScalar(.75);
  content.position.set(.1,-.1,0);
  for(const yaw of [0,.7,Math.PI/2,Math.PI,5])for(const zoom of [.5,1,3]) {
    content.rotation.set(.12,yaw,0);
    const point=worldFocus(content,selected),distance=cameraDistance(zoom),focus=focalDistance(zoom,point.z);
    setViewCamera(camera,distance,0,.75,focus);
    const expected=point.clone().project(camera);
    for(const p of Object.values(profiles)) {
      const n=p.rows*p.columns;
      for(let i=0;i<n;i++) {
        const offset=viewOffset(i,n,focus,40);
        setViewCamera(camera,distance,offset,.75,focus);
        const actual=point.clone().project(camera);
        assert.ok(Math.abs(actual.x-expected.x)<1e-12);
        assert.ok(Math.abs(actual.y-expected.y)<1e-12);
        assert.equal(camera.quaternion.angleTo(new THREE.Quaternion()),0);
      }
    }
  }
});

test('manual focal depth changes disparity without moving or resizing the central preview',()=>{
  const camera=new THREE.PerspectiveCamera(18,.75,.1,100),point=new THREE.Vector3(.3,.1,.6);
  let central:THREE.Vector3|undefined;
  for(const depth of [-2,0,.6,2]) {
    const distance=cameraDistance(3),focus=focalDistance(3,depth);
    setViewCamera(camera,distance,0,.75,focus);
    const center=point.clone().project(camera);
    if(central)assert.ok(center.distanceTo(central)<1e-12);
    central=center;
    setViewCamera(camera,distance,viewOffset(0,48,focus,40),.75,focus);
    const left=point.clone().project(camera);
    setViewCamera(camera,distance,viewOffset(47,48,focus,40),.75,focus);
    const right=point.clone().project(camera);
    if(depth===point.z)assert.ok(Math.abs(left.x-right.x)<1e-12);
    else assert.ok(Math.abs(left.x-right.x)>.01);
    assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
  }
  assert.equal(focalDistance(3,100),.2);
});
