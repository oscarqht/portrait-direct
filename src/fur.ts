import * as THREE from 'three';
import type {Profile} from './calibration';
import {evaluateGroomFlow} from './fur-groom';
import {STRAND_VERTEX_SHADER,STRAND_FRAGMENT_SHADER} from './fur-shaders';
import {FurMotion} from './fur-motion';

export const furCounts:Record<Profile,number>={eco:8000,balanced:16000,detail:24000};
/** Uniform area sampling, rather than vertex sampling, avoids bald caps and
 * silhouette bands. All seeded follicles and attributes are built once. */
export function createFur(body:THREE.BufferGeometry) {
  const max=furCounts.detail, segments=8;
  const positions:number[]=[],indices:number[]=[];
  for(let s=0;s<=segments;s++)positions.push(-1,s/segments,0,1,s/segments,0);
  for(let s=0;s<segments;s++) {const a=s*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geometry.setIndex(indices);
  const p=body.getAttribute('position'),n=body.getAttribute('normal'),idx=body.index!;
  const triangles=idx.count/3,cdf=new Float64Array(triangles);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),edge=new THREE.Vector3(),normal=new THREE.Vector3();
  let area=0;
  for(let i=0;i<triangles;i++) {
    a.fromBufferAttribute(p,idx.getX(i*3)); b.fromBufferAttribute(p,idx.getX(i*3+1)); c.fromBufferAttribute(p,idx.getX(i*3+2));
    area+=edge.subVectors(b,a).cross(normal.subVectors(c,a)).length()*.5; cdf[i]=area;
  }
  let seed=133742;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  function sample(target:THREE.Vector3, outNormal:THREE.Vector3) {
    const targetArea=random()*area;let low=0,high=triangles-1;
    while(low<high) {const middle=(low+high)>>>1;if(cdf[middle]<targetArea)low=middle+1;else high=middle;}
    const i0=idx.getX(low*3),i1=idx.getX(low*3+1),i2=idx.getX(low*3+2);
    const r=Math.sqrt(random()),r2=random(),w0=1-r,w1=r*(1-r2),w2=r*r2;
    target.set(p.getX(i0)*w0+p.getX(i1)*w1+p.getX(i2)*w2,p.getY(i0)*w0+p.getY(i1)*w1+p.getY(i2)*w2,p.getZ(i0)*w0+p.getZ(i1)*w1+p.getZ(i2)*w2);
    outNormal.set(n.getX(i0)*w0+n.getX(i1)*w1+n.getX(i2)*w2,n.getY(i0)*w0+n.getY(i1)*w1+n.getY(i2)*w2,n.getZ(i0)*w0+n.getZ(i1)*w1+n.getZ(i2)*w2).normalize();
  }
  const clumps=Array.from({length:128},()=>{const center=new THREE.Vector3();sample(center,normal);return center;});
  const roots=new Float32Array(max*3),normals=new Float32Array(max*3),groom=new Float32Array(max*3),offsets=new Float32Array(max*3),seeds=new Float32Array(max),masks=new Float32Array(max);
  for(let i=0;i<max;i++) {
    sample(a,normal); roots.set(a.toArray(),i*3); normals.set(normal.toArray(),i*3);
    groom.set(evaluateGroomFlow(a.x,a.y+.23,a.z,normal.x,normal.y,normal.z),i*3);
    let nearest=clumps[0],distance=Infinity;
    for(const center of clumps) {const d=a.distanceToSquared(center);if(d<distance){nearest=center;distance=d;}}
    edge.subVectors(nearest,a).addScaledVector(normal,-edge.dot(normal)); offsets.set(edge.toArray(),i*3);
    // Trim the upstream roots too, so long downward-combed hairs clear the eyes.
    const faceDistance=Math.hypot((Math.abs(a.x)-.29)/.21,(a.y+.12)/.30);
    const faceTaper=THREE.MathUtils.lerp(.10,1,THREE.MathUtils.smoothstep(faceDistance,.55,1.4));
    const faceMask=THREE.MathUtils.lerp(1,faceTaper,THREE.MathUtils.smoothstep(a.z,.15,.35));
    // A shorter underside leaves room for the keyboard under the long fleece.
    const hem=THREE.MathUtils.lerp(.35,1,THREE.MathUtils.smoothstep(a.y,-.92,-.58));
    masks[i]=faceMask*hem; seeds[i]=random();
  }
  for(const [name,array,size] of [
    ['aRootPos',roots,3],['aRootNormal',normals,3],['aGroomDir',groom,3],['aClumpOffset',offsets,3],['aStrandSeed',seeds,1],['aMaskValue',masks,1],
  ] as const)geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,size));
  const motion=new FurMotion();
  const uniforms={
    uFurLength:{value:.32},uFurDensity:{value:.92},uStrandWidthBoost:{value:1.7},uClumping:{value:.40},uCurliness:{value:.50},
    uTime:{value:0},uWindStrength:{value:.06},
    uWebGLInertia:{value:motion.linear},uAngularLag:{value:motion.angular},uStretchLag:{value:motion.stretch},
    uBaseColor:{value:new THREE.Color('#ac7bfa')},uTipColor:{value:new THREE.Color('#c6a0f8')},uRoughness:{value:1},uSpecular:{value:.06},
    uKeyLightDir:{value:new THREE.Vector3(-3,4,5).normalize()},uKeyLightColor:{value:new THREE.Color('#fff7ed')},uKeyLightIntensity:{value:1.25},
    uRimLightDir:{value:new THREE.Vector3(4,1,2).normalize()},uRimLightColor:{value:new THREE.Color('#e8d9ff')},uRimIntensity:{value:.32},
    uAmbientIntensity:{value:.85},uEnvSkyColor:{value:new THREE.Color('#ffffff')},uEnvGroundColor:{value:new THREE.Color('#d5c9e5')},uEnvTintStrength:{value:.5},
  };
  const material=new THREE.ShaderMaterial({vertexShader:STRAND_VERTEX_SHADER,fragmentShader:STRAND_FRAGMENT_SHADER,uniforms,side:THREE.DoubleSide,depthWrite:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='furry-coat';mesh.frustumCulled=false;
  // Explicit bounds include the shader-displaced coat, not its tiny template ribbon.
  body.computeBoundingBox();geometry.boundingBox=body.boundingBox!.clone().expandByScalar(1.5);
  geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  function setProfile(profile:Profile) {
    geometry.instanceCount=furCounts[profile];
    uniforms.uStrandWidthBoost.value=profile==='eco'?2.4:profile==='detail'?1.45:1.7;
  }
  setProfile('balanced');
  return {mesh,setProfile,update:(seconds:number,matrix:THREE.Matrix4)=>{uniforms.uTime.value=seconds;motion.update(seconds,matrix);}};
}
