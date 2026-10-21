// Run through browser-harness with fixtures from scripts/make-test-{glb,models}.py.
import * as THREE from 'three';
import {loadImportedModel} from '../src/model';
import {disposeObject} from '../src/scene';
export async function checkImportedModels() {
  const results=[];
  for(const name of ['triangle.glb','tetrahedron.stl','tetrahedron-binary.stl','tetrahedron.3mf']) {
    const model=await loadImportedModel(`/artifacts/${name}`,name);
    try {
      const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
      if(bounds.getCenter(new THREE.Vector3()).length()>1e-5) throw new Error(`${name}: model is not centered`);
      if(Math.abs(Math.max(size.x/.75,size.y,size.z)-1.65)>1e-5) throw new Error(`${name}: model is not fitted`);
      let meshes=0;
      model.traverse(child=>{if(child instanceof THREE.Mesh) {
        meshes++;
        if(!child.geometry.getAttribute('position')?.count) throw new Error(`${name}: missing geometry`);
        if(name.endsWith('.3mf')&&!(child.material as THREE.MeshStandardMaterial).color.equals(new THREE.Color('#40c090'))) throw new Error('3MF base material was lost');
      }});
      if(!meshes) throw new Error(`${name}: no meshes`);
      results.push({name,meshes,centered:true,fitted:true});
    } finally {disposeObject(model);}
  }
  return results;
}

/** Large-file regression: parsing stays off the UI thread and can be cancelled. */
export async function checkModelWorker(url:string,name:string) {
  const controller=new AbortController();
  let processing=false;
  try {
    await loadImportedModel(url,name,{signal:controller.signal,onProgress:phase=>{
      if(phase.startsWith('Reading 3D/')) {processing=true;controller.abort();}
    }});
    throw new Error('Cancelled model unexpectedly loaded.');
  } catch(error) {
    if(!(error instanceof DOMException)||error.name!=='AbortError'||!processing) throw error;
  }
  let ticks=0,maxGap=0,last=performance.now();
  const heartbeat=setInterval(()=>{const now=performance.now();ticks++;maxGap=Math.max(maxGap,now-last);last=now;},25);
  const start=performance.now();
  try {
    const model=await loadImportedModel(url,name);
    const elapsedMs=performance.now()-start;
    try {
      let triangles=0;
      model.traverse(child=>{if(child instanceof THREE.Mesh)triangles+=(child.geometry.index?.count??child.geometry.getAttribute('position').count)/3;});
      if(!ticks||maxGap>500) throw new Error(`Model import blocked the UI: ${maxGap}ms.`);
      return {elapsedMs,ticks,maxGap,triangles,cancelled:true};
    } finally {disposeObject(model);}
  } finally {clearInterval(heartbeat);}
}
