import * as THREE from 'three';
import { type Calibration, type Profile, profiles, opticalUniforms, viewOffset } from './calibration';
export type OutputMode = 'hologram' | 'quilt' | 'test' | 'preview';
// Original, single-pass lenticular interlacer. RGB channels sample their own view.
// Tile coordinates are clamped by half a texel to avoid bleeding adjacent views.
const fragmentShader = `
uniform sampler2D quilt;
uniform vec2 grid;
uniform vec2 quiltSize;
uniform float pitch, tilt, center, subp, invView, flipX, flipY, flipSubp;
uniform int mode;
varying vec2 uvScreen;
vec2 tileUV(vec2 p, float index) {
  vec2 tile = vec2(mod(index, grid.x), floor(index / grid.x));
  vec2 halfTexel = grid / (quiltSize * 2.0);
  return (tile + clamp(p, halfTexel, vec2(1.0) - halfTexel)) / grid;
}
void main() {
  if (mode == 1) {
    gl_FragColor = texture2D(quilt, uvScreen);
    #include <colorspace_fragment>
    return;
  }
  if (mode == 2) {
    vec2 cell = floor(uvScreen * vec2(12.0,16.0));
    float v = mix(0.22, 0.65, mod(cell.x+cell.y,2.0));
    vec3 color = vec3(v);
    if (uvScreen.x < 0.025 || uvScreen.x > 0.975 || uvScreen.y < 0.02 || uvScreen.y > 0.98) color=vec3(1.0);
    if (abs(uvScreen.x-0.5)<0.002 || abs(uvScreen.y-0.5)<0.002) color=vec3(0.25,0.8,1.0);
    gl_FragColor=vec4(color,1.0);
    #include <colorspace_fragment>
    return;
  }
  vec2 p = mix(uvScreen, vec2(1.0)-uvScreen, vec2(flipX,flipY));
  vec3 color;
  for (int channel = 0; channel < 3; channel++) {
    float subpixel = mix(float(channel), 2.0-float(channel), flipSubp);
    float phase = fract((uvScreen.x + subpixel*subp + uvScreen.y*tilt)*pitch - center);
    phase = mix(phase, 1.0-phase, invView);
    float view = min(floor(phase * grid.x * grid.y), grid.x * grid.y - 1.0);
    vec4 sampleColor = texture2D(quilt, tileUV(p, view));
    if (channel == 0) color.r = sampleColor.r;
    else if (channel == 1) color.g = sampleColor.g;
    else color.b = sampleColor.b;
  }
  gl_FragColor=vec4(color,1.0);
  #include <colorspace_fragment>
}`;

/** Public SDK: supply your own Three.js scene. No Bridge, pixel readback, video
 * encode, 2D canvas copy, remote server, or WebXR session is involved. */
export class PortraitRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private camera = new THREE.PerspectiveCamera(18, 0.75, 0.1, 100);
  private blit = new THREE.Scene();
  private blitCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  private material: THREE.ShaderMaterial;
  private plane = new THREE.PlaneGeometry(2,2);
  private profile: Profile = 'balanced';
  private calibration: Calibration | null = null;
  frames = 0;
  lastSubmitMs = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.target = new THREE.WebGLRenderTarget(1,1, { depthBuffer: true, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    // Store display-encoded quilt samples: the interlacer must not tone-map or
    // interpolate channels after selecting the optical views.
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      uniforms: { quilt:{value:this.target.texture}, grid:{value:new THREE.Vector2(8,6)}, quiltSize:{value:new THREE.Vector2()}, pitch:{value:0}, tilt:{value:0}, center:{value:0}, subp:{value:0}, invView:{value:0}, flipX:{value:0}, flipY:{value:0}, flipSubp:{value:0}, mode:{value:0} },
      vertexShader:'varying vec2 uvScreen; void main(){uvScreen=uv;gl_Position=vec4(position.xy,0.0,1.0);}', fragmentShader,
      depthTest:false, depthWrite:false, toneMapped:false,
    });
    this.blit.add(new THREE.Mesh(this.plane, this.material));
    this.configure('balanced', null);
  }
  configure(profile: Profile, calibration: Calibration | null) {
    if (!profiles[profile]) throw new Error('Unsupported quality profile.');
    this.profile = profile; this.calibration = calibration;
    const p = profiles[profile];
    this.target.setSize(p.columns*p.tileW,p.rows*p.tileH);
    this.material.uniforms.grid.value.set(p.columns,p.rows);
    this.material.uniforms.quiltSize.value.set(this.target.width,this.target.height);
    if (calibration) {
      const c = opticalUniforms(calibration);
      for (const [key, value] of Object.entries(c)) this.material.uniforms[key].value = value;
      for (const [key, value] of Object.entries({center:calibration.center,invView:calibration.invView,flipX:calibration.flipImageX,flipY:calibration.flipImageY,flipSubp:calibration.flipSubp})) this.material.uniforms[key].value=value;
    }
  }
  render(scene: THREE.Scene, mode: OutputMode, width: number, height: number, zoom = 1) {
    if (mode === 'hologram' && !this.calibration) throw new Error('Import your Portrait calibration before holographic output.');
    const begin = performance.now();
    if (this.canvas.width !== width || this.canvas.height !== height) this.renderer.setSize(width,height,false);
    const r=this.renderer, p=profiles[this.profile], count=p.rows*p.columns;
    const camera=this.camera, distance=10/zoom;
    scene.updateMatrixWorld(true);
    const oldAuto=scene.matrixWorldAutoUpdate; scene.matrixWorldAutoUpdate=false;
    try {
      if (mode !== 'test') {
        const preview=mode==='preview';
        r.setRenderTarget(preview ? null : this.target);
        r.setScissorTest(false); r.setViewport(0,0,preview?width:this.target.width,preview?height:this.target.height); r.clear();
        const n=preview?1:count;
        for(let i=0;i<n;i++) {
          const offset=preview?0:viewOffset(i,count,distance,this.calibration?.viewCone ?? 40);
          camera.position.set(offset,0,distance);
          // Parallel off-axis frusta converge at z=0; toe-in cameras distort depth.
          const near=camera.near, halfY=near*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
          const aspect=preview?width/height:0.75;
          const midpoint=-near*offset/distance;
          camera.projectionMatrix.makePerspective(midpoint-halfY*aspect,midpoint+halfY*aspect,halfY,-halfY,near,camera.far);
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
          camera.updateMatrixWorld(true);
          const x=preview?0:(i%p.columns)*p.tileW, y=preview?0:Math.floor(i/p.columns)*p.tileH;
          const w=preview?width:p.tileW, h=preview?height:p.tileH;
          r.setViewport(x,y,w,h);
          // A scene background can force a clear despite autoClear=false.
          // Viewports don't constrain gl.clear; scissor each camera's tile
          // so later views cannot erase the quilt rendered before them.
          r.setScissor(x,y,w,h); r.setScissorTest(!preview);
          r.render(scene,camera);
        }
      }
    } finally { scene.matrixWorldAutoUpdate=oldAuto; r.setScissorTest(false); }
    if(mode!=='preview') {
      r.setRenderTarget(null); r.setViewport(0,0,width,height); r.clear();
      this.material.uniforms.mode.value=mode==='quilt'?1:mode==='test'?2:0;
      r.render(this.blit,this.blitCamera);
    }
    this.frames++; this.lastSubmitMs=performance.now()-begin;
  }
  dispose() { this.target.dispose(); this.plane.dispose(); this.material.dispose(); this.renderer.dispose(); }
}
