import * as THREE from 'three';
import {createTrianglePet} from './triangle-pet';
import type {Profile} from './calibration';
export type SceneKind='triangle'|'furry'|'orbital';
export function createScene(kind:SceneKind='triangle',profile:Profile='balanced') {
  const triangle=kind!=='orbital';
  const scene=new THREE.Scene(); scene.background=new THREE.Color(triangle?'#ffffff':'#080d15');
  scene.add(new THREE.HemisphereLight(triangle?0xffffff:0xb9e2ff,triangle?0xd5c9e5:0x191d37,triangle?1.65:2.8));
  const light=new THREE.DirectionalLight(0xffffff,triangle?2.6:3); light.position.set(triangle?-3:3,4,5); scene.add(light);
  const rim=new THREE.DirectionalLight(triangle?0xfff5ed:0x62a5ff,triangle?.85:3); rim.position.set(triangle?4:-3,1,triangle?2:-2); scene.add(rim);
  const content=new THREE.Group(); content.scale.setScalar(kind==='furry'?.68:.75); scene.add(content);
  if(triangle) {
    const pet=createTrianglePet(kind==='furry'); content.add(pet.content);pet.setProfile(profile);
    return {scene,content,update:pet.update,setProfile:pet.setProfile};
  }
  const body=new THREE.Mesh(new THREE.TorusKnotGeometry(0.63,0.19,128,16),new THREE.MeshStandardMaterial({color:0xa2c7ff,metalness:0.65,roughness:0.25}));
  content.add(body);
  for(let i=0;i<3;i++) {
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.02+i*0.13,0.008,6,96),new THREE.MeshBasicMaterial({color:i===1?0x9be8d2:0x5478a0}));
    ring.rotation.set(Math.PI/2+i*0.4,0.4*i,0.25); content.add(ring);
  }
  return {scene,content,update:(_seconds:number)=>{},setProfile:(_profile:Profile)=>{}};
}
export function disposeObject(object: THREE.Object3D) {
  const textures=new Set<THREE.Texture>(),geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  object.traverse(child=>{
    if(child instanceof THREE.Mesh) {
      geometries.add(child.geometry);
      for(const mat of Array.isArray(child.material)?child.material:[child.material]) {
        for(const value of Object.values(mat)) if(value instanceof THREE.Texture) textures.add(value);
        materials.add(mat);
      }
      if(child instanceof THREE.InstancedMesh) child.dispose();
    }
  });
  geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
  textures.forEach(t=>t.dispose());
}
