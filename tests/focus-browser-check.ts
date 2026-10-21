import * as THREE from 'three';
import {PortraitRenderer} from '../src/renderer';
import {worldFocus,type FocusPoint} from '../src/focus';
import {profiles} from '../src/calibration';

/** Browser GPU integration: inspect the cameras actually submitted for each tile. */
export function checkFocusGPU() {
  const canvas=document.createElement('canvas'),renderer=new PortraitRenderer(canvas);
  const scene=new THREE.Scene(),content=new THREE.Group();scene.add(content);
  const geometry=new THREE.SphereGeometry(.1,12,8),material=new THREE.MeshBasicMaterial({color:'red'});
  const mesh=new THREE.Mesh(geometry,material);content.add(mesh);mesh.frustumCulled=false;mesh.position.set(.4,.2,.7);
  const selected:FocusPoint=[.4,.2,.7],results=[];
  try {
    for(const profile of ['eco','balanced','detail'] as const) {
      renderer.configure(profile,null);
      for(const yaw of [0,1.6,3.2])for(const zoom of [.5,3]) {
        content.rotation.set(.12,yaw,0);
        const point=worldFocus(content,selected),samples:THREE.Vector3[]=[];
        mesh.onBeforeRender=(_r,_s,camera)=>{samples.push(point.clone().project(camera));};
        renderer.render(scene,'quilt',300,400,zoom,point.z);
        const expected=profiles[profile].columns*profiles[profile].rows;
        if(samples.length!==expected)throw new Error('Wrong number of rendered views');
        const error=Math.max(...samples.map(p=>Math.hypot(p.x-samples[0].x,p.y-samples[0].y)));
        if(error>1e-10)throw new Error(`Focus drifted across quilt: ${error}`);
        if(renderer.renderer.getContext().getError()!==0)throw new Error('GPU error');
        results.push({profile,yaw,zoom,views:samples.length,maxDisparity:error});
      }
    }
    return {passed:true,cases:results.length,maxDisparity:Math.max(...results.map(r=>r.maxDisparity))};
  } finally {geometry.dispose();material.dispose();renderer.dispose();}
}
