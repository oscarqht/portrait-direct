// Run through browser-harness against the local dev server. Readbacks are TEST
// ONLY; the production rendering path never reads pixels back to the CPU.
import * as THREE from 'three';
import {PortraitRenderer} from '../src/renderer';
import {parseCalibration,opticalUniforms,profiles,viewOffset} from '../src/calibration';
import {createScene,disposeObject} from '../src/scene';
import {furCounts} from '../src/fur';
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
        if(Math.max(255-pixels[i],255-pixels[i+1],255-pixels[i+2])>25) {
          minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        }
      }
      const centerX=(minX+maxX)/2/1536,centerY=(minY+maxY)/2/2048;
      const width=(maxX-minX)/1536,height=(maxY-minY)/2048;
      defaultModelBounds={centerX,centerY,width,height};
      if(Math.abs(centerX-.5)>.1||Math.abs(centerY-.5)>.1||width<.5||height<.4)
        throw new Error(`Default hologram is off-center or too small: ${JSON.stringify(defaultModelBounds)}`);
      if(pixels[0]!==255||pixels[1]!==255||pixels[2]!==255)throw new Error('White studio background failed');
    } finally {disposeObject(orbital.content);}
    renderer.render(scene,'test',1536,2048);
    const gl=renderer.renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    if(pixel[0]!==255||pixel[1]!==255||pixel[2]!==255)throw new Error('Static pattern border failed');
    const fur=checkFurGPU(renderer,calibration);
    const glass=checkGlassGPU(renderer,calibration);
    return {passed:true,profiles:results,defaultModelBounds,staticPattern:true,fur,glass};
  } finally {renderer.dispose();geometry.dispose();material.dispose();}
}

function checkGlassGPU(renderer:PortraitRenderer,calibration:ReturnType<typeof parseCalibration>) {
  const glass=createScene('glass'),r=renderer.renderer,gl=r.getContext();
  const body=glass.content.getObjectByName('triangle-body') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshPhysicalMaterial>;
  const previousError=r.debug.onShaderError;
  r.debug.onShaderError=(context,_program,vertex,fragment)=>{throw new Error(`Glass shader failed: ${context.getShaderInfoLog(vertex)} ${context.getShaderInfoLog(fragment)}`);};
  const read=(x:number,y:number,w:number,h:number)=>{
    const pixels=new Uint8Array(w*h*4);gl.readPixels(x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
  };
  try {
    glass.content.rotation.set(.12,.2,0);glass.update(.37);
    renderer.configure('balanced',calibration);
    const beforeColor=body.material.color.clone(),beforeAttenuation=body.material.attenuationColor.clone();
    body.material.color.set('white');body.material.attenuationColor.set('white');
    renderer.render(glass.scene,'preview',256,320);const refracted=read(0,0,256,320);
    const thickness=body.material.thickness;body.material.thickness=0;
    renderer.render(glass.scene,'preview',256,320);const flat=read(0,0,256,320);
    body.material.thickness=thickness;body.material.color.copy(beforeColor);body.material.attenuationColor.copy(beforeAttenuation);
    let refractionPixels=0;
    for(let i=0;i<flat.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(flat[i+c]-refracted[i+c])))>8)refractionPixels++;
    if(refractionPixels<300)throw new Error('Glass thickness did not visibly refract the gray grid.');
    const results=[];
    // Compare quilt tiles to independent full-frame camera renders. Transmission
    // switches render targets inside Three; restoring a full-quilt viewport or
    // reusing another view's refraction image corrupts these comparisons.
    const camera=new THREE.PerspectiveCamera(18,.75,.1,100);
    for(const profile of ['eco','balanced','detail'] as const) {
      renderer.configure(profile,calibration);
      const p=profiles[profile],count=p.columns*p.rows;
      renderer.render(glass.scene,'quilt',p.columns*p.tileW,p.rows*p.tileH);
      const views=[0,Math.floor(count/2),count-1];
      const tiles=views.map(i=>read(i%p.columns*p.tileW,Math.floor(i/p.columns)*p.tileH,p.tileW,p.tileH));
      let maxPixelError=0,totalError=0,channels=0,differentPixels=0,sampledPixels=0;
      views.forEach((view,index)=>{
        const offset=viewOffset(view,count,10,calibration.viewCone),halfY=.1*Math.tan(Math.PI/20),midpoint=-.1*offset/10;
        camera.position.set(offset,0,10);
        camera.projectionMatrix.makePerspective(midpoint-halfY*.75,midpoint+halfY*.75,halfY,-halfY,.1,100);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.updateMatrixWorld(true);
        r.setRenderTarget(null);r.setSize(p.tileW,p.tileH,false);r.setViewport(0,0,p.tileW,p.tileH);r.setScissorTest(false);r.clear();r.render(glass.scene,camera);
        const independent=read(0,0,p.tileW,p.tileH),tile=tiles[index];
        for(let i=0;i<tile.length;i+=32){
          let error=0;
          for(let c=0;c<3;c++){
            const channelError=Math.abs(tile[i+c]-independent[i+c]);
            error=Math.max(error,channelError);totalError+=channelError;channels++;
          }
          if(error>3)differentPixels++;sampledPixels++;maxPixelError=Math.max(maxPixelError,error);
        }
      });
      // Rasterization at different framebuffer offsets can move high-contrast
      // edges by a subpixel. Bound both mean error and the affected pixel share.
      const meanPixelError=totalError/channels,differentFraction=differentPixels/sampledPixels;
      if(meanPixelError>.4||differentFraction>.015)throw new Error(`${profile}: glass quilt differs from independent camera renders: mean ${meanPixelError}, fraction ${differentFraction}`);
      if(gl.getError()!==gl.NO_ERROR)throw new Error(`${profile}: glass GL error`);
      results.push({profile,views:count,independentViewsChecked:views,maxPixelError,meanPixelError,differentFraction});
    }
    return {passed:true,refractionPixels,profiles:results};
  } finally {r.debug.onShaderError=previousError;disposeObject(glass.content);}
}

function checkFurGPU(renderer:PortraitRenderer,calibration:ReturnType<typeof parseCalibration>) {
  const furry=createScene('furry');
  const coat=furry.content.getObjectByName('furry-coat') as THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
  const previousError=renderer.renderer.debug.onShaderError;
  renderer.renderer.debug.onShaderError=(gl,_program,vertex,fragment)=>{throw new Error(`Fur shader failed: ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`);};
  try {
    furry.content.rotation.set(.12,.2,0);
    for(let frame=1;frame<=11;frame++)furry.update(frame/30);
    furry.update(.37);
    const gl=renderer.renderer.getContext(),before=new Uint8Array(256*320*4),after=new Uint8Array(before.length);
    coat.visible=false;renderer.render(furry.scene,'preview',256,320);gl.readPixels(0,0,256,320,gl.RGBA,gl.UNSIGNED_BYTE,before);
    coat.visible=true;renderer.render(furry.scene,'preview',256,320);gl.readPixels(0,0,256,320,gl.RGBA,gl.UNSIGNED_BYTE,after);
    let changedPixels=0;
    for(let i=0;i<before.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(before[i+c]-after[i+c])))>8)changedPixels++;
    if(changedPixels<300)throw new Error('Fur pass did not change the rendered character.');
    const lagNames=['uWebGLInertia','uAngularLag','uStretchLag'] as const;
    const savedLag=lagNames.map(name=>(coat.material.uniforms[name].value as THREE.Vector3).clone());
    lagNames.forEach(name=>(coat.material.uniforms[name].value as THREE.Vector3).set(0,0,0));
    renderer.render(furry.scene,'preview',256,320);gl.readPixels(0,0,256,320,gl.RGBA,gl.UNSIGNED_BYTE,before);
    lagNames.forEach((name,i)=>(coat.material.uniforms[name].value as THREE.Vector3).copy(savedLag[i]));
    let motionPixels=0;
    for(let i=0;i<before.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(before[i+c]-after[i+c])))>8)motionPixels++;
    if(motionPixels<20)throw new Error('Body-driven fur inertia did not change the rendered coat.');
    const results=[];
    for(const profile of ['eco','balanced','detail'] as const) {
      furry.setProfile(profile);renderer.configure(profile,calibration);
      const times:number[]=[];coat.onBeforeRender=()=>{
        times.push(coat.material.uniforms.uTime.value);
        lagNames.forEach((name,i)=>{if(!(coat.material.uniforms[name].value as THREE.Vector3).equals(savedLag[i]))throw new Error('Fur inertia changed between views');});
      };
      renderer.render(furry.scene,'hologram',1536,2048);
      const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      const views=profiles[profile].columns*profiles[profile].rows;
      if(times.length!==views||times.some(time=>time!==.37))throw new Error(`${profile}: fur pose changed between views`);
      if(gl.getError()!==gl.NO_ERROR||pixel[0]!==255||pixel[1]!==255||pixel[2]!==255)throw new Error(`${profile}: fur output failed`);
      if(coat.geometry.instanceCount!==furCounts[profile])throw new Error(`${profile}: wrong fur density`);
      results.push({profile,views,strands:coat.geometry.instanceCount,poseFrozenAcrossViews:true});
    }
    return {passed:true,changedPixels,motionPixels,profiles:results};
  } finally {renderer.renderer.debug.onShaderError=previousError;disposeObject(furry.content);}
}
