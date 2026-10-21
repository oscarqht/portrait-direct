import * as THREE from 'three';
export function createScene() {
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#080d15');
  scene.add(new THREE.HemisphereLight(0xb9e2ff,0x191d37,2.8));
  const light=new THREE.DirectionalLight(0xffffff,3); light.position.set(3,4,5); scene.add(light);
  const rim=new THREE.DirectionalLight(0x62a5ff,3); rim.position.set(-3,1,-2); scene.add(rim);
  const content=new THREE.Group(); content.scale.setScalar(0.75); scene.add(content);
  const body=new THREE.Mesh(new THREE.TorusKnotGeometry(0.63,0.19,128,16),new THREE.MeshStandardMaterial({color:0xa2c7ff,metalness:0.65,roughness:0.25}));
  content.add(body);
  for(let i=0;i<3;i++) {
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.02+i*0.13,0.008,6,96),new THREE.MeshBasicMaterial({color:i===1?0x9be8d2:0x5478a0}));
    ring.rotation.set(Math.PI/2+i*0.4,0.4*i,0.25); content.add(ring);
  }
  return {scene,content};
}
export function disposeObject(object: THREE.Object3D) {
  const textures=new Set<THREE.Texture>();
  object.traverse(child=>{
    if(child instanceof THREE.Mesh) {
      child.geometry.dispose();
      for(const mat of Array.isArray(child.material)?child.material:[child.material]) {
        for(const value of Object.values(mat)) if(value instanceof THREE.Texture) textures.add(value);
        mat.dispose();
      }
    }
  });
  textures.forEach(t=>t.dispose());
}
