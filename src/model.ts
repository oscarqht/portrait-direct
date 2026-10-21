import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ParsedThreeMF, ThreeMFReference } from './three-mf';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { disposeObject } from './scene';

export type ModelFormat='glb'|'stl'|'3mf';
export function modelFormat(name:string):ModelFormat {
  const extension=name.split('.').pop()?.toLowerCase();
  if(extension==='glb'||extension==='stl'||extension==='3mf') return extension;
  throw new Error('Choose a .glb, .stl or .3mf model.');
}

export interface ModelLoadOptions { signal?:AbortSignal; onProgress?:(message:string)=>void }

async function parseInWorker(url:string,format:'stl'|'3mf',options:ModelLoadOptions):Promise<any> {
  options.onProgress?.('Reading model…');
  const response=await fetch(url,{signal:options.signal});
  // WKURLSchemeHandler returns a local URLResponse with status 0.
  if(!response.ok&&!(response.status===0&&url.startsWith('portrait://app/'))) throw new Error(`Could not read model (${response.status}).`);
  const buffer=await response.arrayBuffer();
  options.signal?.throwIfAborted();
  const {default:ModelWorker}=await import('./model-worker?worker&inline');
  options.signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new ModelWorker();
    const finish=(error?:unknown,result?:unknown)=>{
      worker.terminate();options.signal?.removeEventListener('abort',abort);
      if(error) reject(error);else resolve(result);
    };
    const abort=()=>finish(new DOMException('Model loading cancelled.','AbortError'));
    options.signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=event=>finish(new Error(event.message||'Model processing failed.'));
    worker.onmessage=({data})=>{
      if(data.phase) options.onProgress?.(data.phase);
      else if(data.error) finish(new Error(data.error));
      else finish(undefined,data.result);
    };
    worker.postMessage({format,buffer},[buffer]);
  });
}

export function buildThreeMF(parsed:ParsedThreeMF):THREE.Group {
  const cache=new Map<string,THREE.Group>();
  const building=new Set<string>();
  const make=(path:string,id:string):THREE.Group=>{
    const key=`${path}#${id}`;
    if(building.has(key)) throw new Error('Cyclic 3MF component reference.');
    if(cache.has(key)) return cache.get(key)!.clone(true);
    const part=parsed.parts[path],object=part?.objects[id];
    if(!object) throw new Error(`Missing 3MF object ${key}.`);
    building.add(key);
    const group=new THREE.Group();group.name=object.name??'';
    if(object.mesh) {
      const mesh=object.mesh,geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices,1));
      if(mesh.colors) {
        const colors=new THREE.BufferAttribute(mesh.colors,3),color=new THREE.Color();
        for(let i=0;i<colors.count;i++) {
          color.fromBufferAttribute(colors,i).convertSRGBToLinear();colors.setXYZ(i,color.r,color.g,color.b);
        }
        geometry.setAttribute('color',colors);
      }
      const materials=(mesh.materials??[{color:[1,1,1] as [number,number,number],opacity:1}]).map(material=>new THREE.MeshStandardMaterial({
        color:new THREE.Color().setRGB(...material.color,THREE.SRGBColorSpace),
        opacity:material.opacity,transparent:material.opacity<1,roughness:.65,flatShading:true,vertexColors:!!mesh.colors,
      }));
      for(const entry of mesh.groups??[]) geometry.addGroup(entry.start,entry.count,entry.materialIndex);
      group.add(new THREE.Mesh(geometry,materials.length===1?materials[0]:materials));
    }
    for(const ref of object.components) group.add(reference(path,ref));
    building.delete(key);cache.set(key,group);return group.clone(true);
  };
  const reference=(parentPath:string,ref:ThreeMFReference)=>{
    const path=ref.path??parentPath,child=make(path,ref.objectId);
    child.scale.multiplyScalar(parsed.parts[path].unitScale/parsed.parts[parentPath].unitScale);
    if(ref.transform) {
      const v=ref.transform;
      child.applyMatrix4(new THREE.Matrix4().set(v[0],v[3],v[6],v[9],v[1],v[4],v[7],v[10],v[2],v[5],v[8],v[11],0,0,0,1));
    }
    return child;
  };
  const root=new THREE.Group();
  for(const ref of parsed.parts[parsed.root].build) root.add(reference(parsed.root,ref));
  root.scale.setScalar(parsed.parts[parsed.root].unitScale);
  return root;
}

export async function loadImportedModel(url:string,name?:string,options:ModelLoadOptions={}):Promise<THREE.Object3D> {
  const format=modelFormat(name??url);
  let model:THREE.Object3D;
  if(format==='glb') model=(await new GLTFLoader().loadAsync(url)).scene;
  else if(format==='3mf') {
    const parsed=await parseInWorker(url,'3mf',options) as ParsedThreeMF;
    model=parsed.unsupported.length?await new ThreeMFLoader().loadAsync(url):buildThreeMF(parsed);
    model.rotation.x=-Math.PI/2;
  } else {
    const data=await parseInWorker(url,'stl',options);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
    if(data.normals) geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
    if(data.colors) geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,3));
    model=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
      color:data.colors?0xffffff:0xa2c7ff,roughness:0.55,vertexColors:!!data.colors,
      opacity:data.opacity,transparent:data.opacity<1,
    }));
    model.rotation.x=-Math.PI/2;
  }
  try {
    options.signal?.throwIfAborted();
    options.onProgress?.('Preparing model for display…');
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
