import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { disposeObject } from './scene';

export type ModelFormat='glb'|'stl'|'3mf';
export function modelFormat(name:string):ModelFormat {
  const extension=name.split('.').pop()?.toLowerCase();
  if(extension==='glb'||extension==='stl'||extension==='3mf') return extension;
  throw new Error('Choose a .glb, .stl or .3mf model.');
}

export async function loadImportedModel(url:string,name?:string):Promise<THREE.Object3D> {
  const format=modelFormat(name??url);
  let model:THREE.Object3D;
  if(format==='glb') model=(await new GLTFLoader().loadAsync(url)).scene;
  else if(format==='3mf') {
    model=await new ThreeMFLoader().loadAsync(url);
    model.rotation.x=-Math.PI/2; // 3MF uses Z up; the preview uses Y up.
  } else {
    const geometry=await new STLLoader().loadAsync(url);
    const hasColors=!!geometry.getAttribute('color');
    const opacity='alpha' in geometry&&typeof geometry.alpha==='number'?geometry.alpha:1;
    model=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
      color:hasColors?0xffffff:0xa2c7ff,roughness:0.55,
      vertexColors:hasColors,opacity,transparent:opacity<1,
    }));
    model.rotation.x=-Math.PI/2; // Conventional printing/CAD orientation.
  }
  try {
    fitImportedModel(model);
    return model;
  } catch(error) {
    disposeObject(model);
    throw error;
  }
}

export function fitImportedModel(model:THREE.Object3D) {
  const box=new THREE.Box3().setFromObject(model);
  const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  if(!Number.isFinite(size.length())||size.length()===0) throw new Error('The model has no renderable bounds.');
  const fit=1.65/Math.max(size.x/0.75,size.y,size.z);
  model.position.sub(center).multiplyScalar(fit);
  model.scale.multiplyScalar(fit);
}
