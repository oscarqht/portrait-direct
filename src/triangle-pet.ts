import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createSoftBody,createGroundShadow} from './soft-body';
import {createWorkingPose, sampleWorkingPose} from './working-pose';

/** Alpha Bro's purple triangle / Working, adapted to the direct light-field renderer.
 * Shared geometry and instanced keys keep the cost bounded across 24–48 views.
 * No transmission, shadow maps, textures, React, or extra animation loop is needed. */
export function createTrianglePet() {
  const root=new THREE.Group(); root.name='purple-triangle-working';
  const pet=new THREE.Group(); pet.name='pet-body-rig'; root.add(pet);
  const purple=new THREE.MeshPhysicalMaterial({color:'#ac7bfa',roughness:.53,metalness:0,clearcoat:.2,clearcoatRoughness:.48});
  const white=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.3});
  const ink=new THREE.MeshStandardMaterial({color:'#30203f',roughness:.3});
  const chassis=new THREE.MeshStandardMaterial({color:'#e3d8f3',roughness:.65});
  const plate=new THREE.MeshStandardMaterial({color:'#bcaed4',roughness:.65});
  const keyMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.35,metalness:.08});
  const cyan=new THREE.MeshBasicMaterial({color:'#38bdf8'});
  const sphere=new THREE.SphereGeometry(1,28,20), box=new RoundedBoxGeometry(1,1,1,3,.12);
  function mesh(parent:THREE.Object3D, geometry:THREE.BufferGeometry, material:THREE.Material,
    x:number,y:number,z:number,sx=1,sy=sx,sz=sx) {
    const item=new THREE.Mesh(geometry,material); item.position.set(x,y,z); item.scale.set(sx,sy,sz); parent.add(item); return item;
  }
  const body=createSoftBody();
  mesh(pet,body.geometry,purple,0,0,0).name='triangle-body';
  root.add(createGroundShadow());
  const face=new THREE.Group(); face.name='pet-face'; pet.add(face);
  const eyes:THREE.Group[]=[];
  for(const side of [-1,1]) {
    const eye=new THREE.Group(); eye.position.x=side*.29; face.add(eye); eyes.push(eye);
    mesh(eye,sphere,ink,0,0,0,.082,.086,.033);
    mesh(eye,sphere,white,-.024,.028,.029,.016,.016,.009);
  }

  // The reference keyboard sits below and in front of the face (positive Z).
  const keyboard=new THREE.Group(); keyboard.name='keyboard'; keyboard.position.set(0,-.92,.58);
  // The Portrait cameras sit at eye level; tilt the key tops toward that axis.
  keyboard.rotation.x=.45; pet.add(keyboard);
  mesh(keyboard,box,chassis,0,0,0,1.25,.065,.44);
  mesh(keyboard,box,plate,0,.025,0,1.18,.03,.38);
  mesh(keyboard,box,cyan,0,-.015,.222,1.2,.012,.005);
  const layout:{x:number;z:number;width:number;accent:boolean}[]=[];
  [-.44,-.31,-.19,-.06,.06,.19,.31,.44].forEach((x,i)=>layout.push({x,z:-.1,width:.1,accent:i===0}));
  [-.42,-.29,-.16,-.03,.09,.22,.35,.45].forEach((x,i)=>layout.push({x,z:.01,width:i===7?.12:.1,accent:i===7}));
  [-.41,0,.41].forEach(x=>layout.push({x,z:.12,width:x===0?.54:.16,accent:false}));
  const keycaps=new THREE.InstancedMesh(box,keyMaterial,layout.length); keycaps.name='typing-keys';
  keycaps.instanceMatrix.setUsage(THREE.DynamicDrawUsage); keyboard.add(keycaps);
  // A separate instanced cyan surface marks keys under each paw.
  const activeKeys=new THREE.InstancedMesh(box,cyan,layout.length); activeKeys.name='key-lights'; keyboard.add(activeKeys);
  activeKeys.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const normalColor=new THREE.Color('#f5efff'), accentColor=new THREE.Color('#c09afa');
  layout.forEach((key,i)=>keycaps.setColorAt(i,key.accent?accentColor:normalColor));

  // Capsules articulate instead of rebuilding/discarding tube geometry per frame.
  const limbGeometry=new THREE.CapsuleGeometry(.062,1,6,16);
  const arms=[-1,1].map(side=>{
    const upper=mesh(pet,limbGeometry,purple,0,0,0), lower=mesh(pet,limbGeometry,purple,0,0,0);
    const elbow=mesh(pet,sphere,purple,0,0,0,.065);
    const paw=mesh(pet,sphere,purple,0,0,0,.09,.075,.08); paw.name=side<0?'left-paw':'right-paw';
    return {side,upper,lower,elbow,paw};
  });
  const pose=createWorkingPose(), matrix=new THREE.Object3D();
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(), direction=new THREE.Vector3(), up=new THREE.Vector3(0,1,0),forward=new THREE.Vector3(0,0,1);
  function segment(item:THREE.Mesh,start:THREE.Vector3,end:THREE.Vector3) {
    direction.subVectors(end,start); const length=direction.length();
    item.position.copy(start).add(end).multiplyScalar(.5);
    item.quaternion.setFromUnitVectors(up,direction.normalize()); item.scale.set(1,length/1.124,1);
  }
  function update(seconds:number) {
    sampleWorkingPose(seconds*1000,pose);
    pet.rotation.z=-pose.tilt; pet.scale.set(pose.sx,pose.sy,1/Math.sqrt(pose.sx*pose.sy));
    face.position.set(pose.faceX*.008,-.18-pose.faceY*.008,0); face.scale.set(1,pose.eyeScale,1);
    for(const eye of eyes) {
      const x=face.position.x+eye.position.x,y=face.position.y;
      eye.position.z=body.frontZ(x,y)+.018;
      const epsilon=.005;
      direction.set((body.frontZ(x-epsilon,y)-body.frontZ(x+epsilon,y))/(2*epsilon),
        (body.frontZ(x,y-epsilon)-body.frontZ(x,y+epsilon))/(2*epsilon)*pose.eyeScale,1).normalize();
      eye.quaternion.setFromUnitVectors(forward,direction);
    }
    for(const arm of arms) {
      const x=(arm.side<0?pose.leftX:pose.rightX)*.024;
      const y=-.8+Math.max(0,-(arm.side<0?pose.leftY:pose.rightY)-9)*.015;
      a.set(arm.side*.66,-.3,body.frontZ(arm.side*.66,-.3)); b.set(arm.side*.72,(-.3+y)*.55,.49); c.set(x,y,.6);
      segment(arm.upper,a,b); segment(arm.lower,b,c); arm.elbow.position.copy(b); arm.paw.position.copy(c);
    }
    layout.forEach((key,i)=>{
      const hit=(pose.leftY>=-11 && Math.abs(pose.leftX*.024-key.x)<key.width/2+.04)
        || (pose.rightY>=-11 && Math.abs(pose.rightX*.024-key.x)<key.width/2+.04);
      matrix.position.set(key.x,hit?.032:.055,key.z); matrix.scale.set(key.width,.04,.09); matrix.updateMatrix();
      keycaps.setMatrixAt(i,matrix.matrix);
      matrix.position.y+=.021; matrix.scale.set(hit?key.width*.85:0,.002,hit?.075:0); matrix.updateMatrix(); activeKeys.setMatrixAt(i,matrix.matrix);
    });
    keycaps.instanceMatrix.needsUpdate=true; activeKeys.instanceMatrix.needsUpdate=true;
  }
  update(0);
  // Enclose all key travel even if the initial pose has a depressed key.
  keycaps.computeBoundingSphere(); activeKeys.frustumCulled=false;
  return {content:root,update};
}
