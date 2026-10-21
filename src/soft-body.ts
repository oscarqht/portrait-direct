import * as THREE from 'three';
import {triangleOutline} from './triangle-shape';

/** Closed inflated triangle, with a continuous curved front instead of a flat cap.
 * Adapted from Alpha Bro Pets' inflated outline construction at a lower mesh cost. */
export function createSoftBody() {
  const segments=128, rings=40, depth=.48;
  const radii=new Float64Array(segments);
  for(let i=0;i<segments;i++) {
    const angle=i/segments*Math.PI*2, dx=Math.cos(angle),dy=Math.sin(angle);
    let radius=Infinity;
    for(let j=0;j<triangleOutline.length;j++) {
      const a=triangleOutline[j],b=triangleOutline[(j+1)%triangleOutline.length];
      const ex=b[0]-a[0],ey=b[1]-a[1],cross=dx*ey-dy*ex;
      if(Math.abs(cross)<1e-10)continue;
      const t=(a[0]*ey-a[1]*ex)/cross, u=(a[0]*dy-a[1]*dx)/cross;
      if(t>0&&u>=-1e-8&&u<=1+1e-8)radius=Math.min(radius,t);
    }
    radii[i]=radius;
  }
  const core=Math.min(...radii);
  const positions:number[]=[0,0,-depth],indices:number[]=[];
  for(let ring=1;ring<rings;ring++) {
    const latitude=-Math.PI/2+ring/rings*Math.PI, s=Math.cos(latitude);
    for(let i=0;i<segments;i++) {
      const angle=i/segments*Math.PI*2, radius=s*(core+(radii[i]-core)*s*s);
      positions.push(radius*Math.cos(angle),radius*Math.sin(angle),depth*Math.sin(latitude));
    }
  }
  const pole=positions.length/3; positions.push(0,0,depth);
  for(let i=0;i<segments;i++) {
    const next=(i+1)%segments;
    indices.push(0,1+next,1+i);
    for(let ring=0;ring<rings-2;ring++) {
      const a=1+ring*segments+i,b=1+ring*segments+next;
      indices.push(a,b,a+segments,b,b+segments,a+segments);
    }
    const last=1+(rings-2)*segments; indices.push(last+i,last+next,pole);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  function frontZ(x:number,y:number) {
    const angle=((Math.atan2(y,x)/(Math.PI*2))%1+1)%1*segments, i=Math.floor(angle);
    const radius=THREE.MathUtils.lerp(radii[i],radii[(i+1)%segments],angle-i),distance=Math.hypot(x,y);
    let low=0,high=1;
    for(let step=0;step<16;step++) {
      const s=(low+high)/2;
      if(s*(core+(radius-core)*s*s)<distance)low=s;else high=s;
    }
    const s=(low+high)/2;
    return distance>=radius?0:depth*Math.sqrt(Math.max(0,1-s*s));
  }
  return {geometry,frontZ};
}

/** A soft analytical contact shadow on the white floor. One shared pass per view,
 * with no shadow-map rendering, blur buffers or frame-dependent texture work. */
export function createGroundShadow() {
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.9,2.5),new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec2 vUv;
      void main(){
        vec2 p=(vUv-.5)*2.; float d=dot(p,p);
        float alpha=(.24*exp(-3.5*d)+.12*exp(-14.*d))*(1.-smoothstep(.5,1.,d));
        gl_FragColor=vec4(vec3(.32,.27,.40),alpha);
        #include <colorspace_fragment>
      }`,
  }));
  shadow.name='soft-ground-shadow'; shadow.rotation.x=-Math.PI/2;
  shadow.position.set(0,-1.12,.04); return shadow;
}
