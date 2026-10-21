import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {parseCalibration,opticalUniforms,viewOffset,profiles} from '../src/calibration.ts';
import {FrameScheduler} from '../src/scheduler.ts';

// Synthetic optical fixture. This is NEVER used as hardware calibration.
const fixture={serial:'SYNTHETIC-TEST',pitch:50,slope:-7,center:0.2,DPI:324,screenW:1536,screenH:2048,viewCone:40,invView:1};
test('raw and nested Visual.json formats produce the same validated optics',()=>{
  const nested=Object.fromEntries(Object.entries(fixture).map(([k,v])=>[k,typeof v==='number'?{value:v}:v]));
  assert.deepEqual(parseCalibration(nested),parseCalibration({calibration:fixture}));
  const u=opticalUniforms(parseCalibration(nested));
  assert.ok(Math.abs(u.pitch-50*1536/324*Math.cos(Math.atan(-1/7)))<1e-10);
  assert.equal(u.tilt,2048/(1536*-7));
  assert.equal(u.subp,1/(1536*3));
});
test('invalid or wrong-device calibration never silently falls back to demo values',()=>{
  for(const patch of [{pitch:NaN},{pitch:Infinity},{slope:0},{DPI:0},{screenW:3840},{screenH:1536},{viewCone:90},{invView:2},{flipImageX:3},{serial:''},{subpixelCells:[{}]}])
    assert.throws(()=>parseCalibration({...fixture,...patch}));
  assert.throws(()=>parseCalibration({}));
  assert.throws(()=>parseCalibration({calibration:null}));
  assert.throws(()=>parseCalibration({...fixture,center:'0.2'}));
});
test('all view frusta converge on the screen plane, with parallel camera axes',()=>{
  for(const p of Object.values(profiles)) {
    const n=p.rows*p.columns,distance=6,near=0.1,far=100,halfY=near*Math.tan(18*Math.PI/360);
    for(let i=0;i<n;i++) {
      const offset=viewOffset(i,n,distance,40), midpoint=-near*offset/distance;
      const proj=new THREE.Matrix4().makePerspective(midpoint-halfY*.75,midpoint+halfY*.75,halfY,-halfY,near,far);
      const screenCenter=new THREE.Vector3(-offset,0,-distance).applyMatrix4(proj);
      assert.ok(Math.abs(screenCenter.x)<1e-12);
    }
    assert.ok(Math.abs(viewOffset(0,n,distance,40)+viewOffset(n-1,n,distance,40))<1e-12);
    assert.equal(p.tileW/p.tileH,0.75);
  }
});
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test('static content renders once, sleeps, coalesces invalidations and disposes cleanly',async()=>{
  let renders=0;
  const scheduler=new FrameScheduler(()=>renders++,cb=>Number(setTimeout(()=>cb(performance.now()),0)),id=>clearTimeout(id));
  scheduler.invalidate();scheduler.invalidate();scheduler.invalidate();
  await wait(60);assert.equal(renders,1);
  await wait(70);assert.equal(renders,1);
  scheduler.setActive(false);scheduler.invalidate();await wait(45);assert.equal(renders,1);
  scheduler.setActive(true);await wait(45);assert.equal(renders,2);
  scheduler.dispose();scheduler.invalidate();await wait(45);assert.equal(renders,2);
});
test('animated frames respect the configured cap, and pausing stops future work',async()=>{
  const times:number[]=[];
  const scheduler=new FrameScheduler(now=>times.push(now),cb=>Number(setTimeout(()=>cb(performance.now()),0)),id=>clearTimeout(id));
  scheduler.fps=20;scheduler.setAnimated(true);await wait(230);scheduler.setAnimated(false);
  const stopped=times.length;await wait(90);assert.equal(times.length,stopped);
  assert.ok(times.length>=3&&times.length<=5);
  for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=48);
  scheduler.dispose();
});
