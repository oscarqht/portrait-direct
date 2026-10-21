// Run through browser-harness against the local dev server. Readbacks are TEST
// ONLY; the production rendering path never reads pixels back to the CPU.
import * as THREE from 'three';
import {PortraitRenderer} from '../src/renderer';
import {parseCalibration,opticalUniforms,profiles} from '../src/calibration';
import {createScene,disposeObject} from '../src/scene';
export function checkGPU() {
  const canvas=document.createElement('canvas');
  const renderer=new PortraitRenderer(canvas);
  const calibration=parseCalibration({serial:'SYNTHETIC-TEST-NOT-FOR-DEVICE',pitch:50,slope:-7,center:.2,DPI:324,screenW:1536,screenH:2048,viewCone:40,invView:1});
  const scene=new THREE.Scene();
  // A colour background makes Three.js clear before every camera render,
  // even with autoClear=false. Earlier tiles must survive those clears.
  scene.background=new THREE.Color('#080d15');
  const geometry=new THREE.PlaneGeometry(100,100);
  const material=new THREE.MeshBasicMaterial({color:0xffffff});
  const mesh=new THREE.Mesh(geometry,material); scene.add(mesh);
  const results:unknown[]=[];
  const srgb=(x:number)=>x<=.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-.055;
  try {
    for(const profile of ['eco','balanced','detail'] as const) {
      renderer.configure(profile,calibration);
      const p=profiles[profile],n=p.columns*p.rows;
      let view=0;
      mesh.onBeforeRender=()=>{const value=view++/(n-1);material.color.setRGB(value,1-value,.25);};
      renderer.render(scene,'quilt',1536,2048);
      const gl=renderer.renderer.getContext();
      for(let i=0;i<n;i++) {
        const x=Math.floor((i%p.columns+.5)/p.columns*1536);
        const y=Math.floor((Math.floor(i/p.columns)+.5)/p.rows*2048);
        const pixel=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        const expected=[i/(n-1),1-i/(n-1),.25].map(v=>Math.round(srgb(v)*255));
        const errors=expected.map((v,ch)=>Math.abs(v-pixel[ch]));
        if(Math.max(...errors)>3)throw new Error(`${profile}: quilt tile ${i} was erased or misplaced: ${errors}`);
      }
      view=0;
      renderer.render(scene,'hologram',1536,2048);
      const u=opticalUniforms(calibration),errors:number[]=[];
      for(const [x,y] of [[0,0],[100,500],[768,1024],[1500,2000]]) {
        const pixel=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        const expected=[0,1,2].map(ch=>{
          const phase=((x+.5)/1536+ch*u.subp+(y+.5)/2048*u.tilt)*u.pitch-calibration.center;
          const index=Math.min(n-1,Math.floor((1-(phase-Math.floor(phase)))*n));
          return Math.round(srgb(ch===0?index/(n-1):ch===1?1-index/(n-1):.25)*255);
        });
        errors.push(...expected.map((v,ch)=>Math.abs(v-pixel[ch])));
      }
      if(Math.max(...errors)>3)throw new Error(`${profile}: interlaced GPU pixels do not match calibrated CPU reference: ${errors}`);
      if(gl.getError()!==gl.NO_ERROR)throw new Error(`${profile}: GL error`);
      if(view!==n)throw new Error(`${profile}: expected ${n} view renders, got ${view}`);
      results.push({profile,views:view,quiltTilesChecked:n,maxPixelError:Math.max(...errors)});
    }
    const orbital=createScene();
    let defaultModelBounds:unknown;
    try {
      orbital.content.rotation.x=.12;
      renderer.configure('balanced',calibration);
      renderer.render(orbital.scene,'hologram',1536,2048);
      const gl=renderer.renderer.getContext(),pixels=new Uint8Array(1536*2048*4);
      gl.readPixels(0,0,1536,2048,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let minX=1536,minY=2048,maxX=-1,maxY=-1;
      for(let y=0;y<2048;y+=8)for(let x=0;x<1536;x+=8) {
        const i=(y*1536+x)*4;
        if(Math.max(Math.abs(pixels[i]-8),Math.abs(pixels[i+1]-13),Math.abs(pixels[i+2]-21))>20) {
          minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        }
      }
      const centerX=(minX+maxX)/2/1536,centerY=(minY+maxY)/2/2048;
      const width=(maxX-minX)/1536,height=(maxY-minY)/2048;
      defaultModelBounds={centerX,centerY,width,height};
      if(Math.abs(centerX-.5)>.1||Math.abs(centerY-.5)>.1||width<.5||height<.4)
        throw new Error(`Default hologram is off-center or too small: ${JSON.stringify(defaultModelBounds)}`);
    } finally {disposeObject(orbital.content);}
    renderer.render(scene,'test',1536,2048);
    const gl=renderer.renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    if(pixel[0]!==255||pixel[1]!==255||pixel[2]!==255)throw new Error('Static pattern border failed');
    return {passed:true,profiles:results,defaultModelBounds,staticPattern:true};
  } finally {renderer.dispose();geometry.dispose();material.dispose();}
}
