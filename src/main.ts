import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseCalibration, profiles, type Calibration, type Profile } from './calibration';
import { PortraitRenderer, type OutputMode } from './renderer';
import { FrameScheduler } from './scheduler';
import { createScene, disposeObject, type SceneKind } from './scene';

interface Settings { profile:Profile; animate:boolean; mode:OutputMode; scene:SceneKind; zoom:number; yaw:number; calibration:Calibration|null; modelUrl?:string; modelName?:string }
interface Display { id:number; name:string; width:number; height:number; builtIn:boolean; mirrored:boolean; valid:boolean; reason:string }
interface Host { displays:Display[]; presenting:boolean; lowPower:boolean; suspended:boolean; events:string[]; settings?:Settings; message?:string }
declare global { interface Window { webkit?:{messageHandlers:{portrait:{postMessage:(data:unknown)=>void}}}; portraitReceive?:(event:any)=>void; portraitDebug?:()=>unknown } }
const native=!!window.webkit?.messageHandlers.portrait;
const output=new URLSearchParams(location.search).has('output');
const app=document.querySelector<HTMLDivElement>('#app')!;
let settings:Settings={profile:'balanced',animate:false,mode:'hologram',scene:'triangle',zoom:1,yaw:0,calibration:null};
try { const saved=JSON.parse(localStorage.getItem('portrait-settings')??'null'); if(saved) settings=sanitize(saved); } catch { /* Optional cache; native host also persists settings. */ }
let host:Host={displays:[],presenting:false,lowPower:false,suspended:false,events:[]};
let selectedDisplay:number|undefined;
let render:PortraitRenderer|undefined;
let scheduler:FrameScheduler|undefined;
let sceneState:ReturnType<typeof createScene>|undefined;
let modelToken=0, loadedModel:string|undefined, loadedScene:SceneKind='triangle', frameTotal=0, previousTime:number|undefined;
let animationTime=0, fatal=false;
const loader=new GLTFLoader();
const channel=!native && 'BroadcastChannel' in window?new BroadcastChannel('portrait-direct'):null;

function send(data:unknown) { window.webkit?.messageHandlers.portrait.postMessage(data); }
function sanitize(raw:Partial<Settings>):Settings {
  return {
    profile: raw.profile && profiles[raw.profile]?raw.profile:'balanced', animate:raw.animate===true,
    mode: raw.mode && ['hologram','quilt','test'].includes(raw.mode)?raw.mode:'hologram',
    scene:raw.scene==='orbital'||raw.scene==='furry'?raw.scene:'triangle',
    zoom:typeof raw.zoom==='number'?Math.min(1.5,Math.max(0.65,raw.zoom)):1,
    yaw:typeof raw.yaw==='number'&&Number.isFinite(raw.yaw)?raw.yaw:0,
    calibration:raw.calibration?parseCalibration(raw.calibration):null,
    modelUrl:typeof raw.modelUrl==='string'&&(raw.modelUrl.startsWith('blob:')||raw.modelUrl==='portrait://app/model.glb')?raw.modelUrl:undefined,
    modelName:typeof raw.modelName==='string'?raw.modelName:undefined,
  };
}
function effectiveProfile() { return host.lowPower?'eco':settings.profile; }
function update(patch:Partial<Settings>,broadcast=true) {
  settings=sanitize({...settings,...patch});
  if (!output) {
    try { localStorage.setItem('portrait-settings',JSON.stringify({...settings,modelUrl:undefined,modelName:undefined})); } catch { /* private storage unavailable */ }
    if(broadcast) { send({type:'settings',settings}); channel?.postMessage({type:'settings',settings}); }
    refresh();
  }
  if(render) render.configure(effectiveProfile(),settings.calibration);
  sceneState?.setProfile(effectiveProfile());
  syncActivity();
  if(settings.modelUrl!==loadedModel || (!settings.modelUrl&&settings.scene!==loadedScene)) void loadModel(settings.modelUrl);
  scheduler?.invalidate();
}
function syncActivity() {
  const active=!fatal&&!host.suspended&&(output||(!host.presenting&&!document.hidden));
  if(scheduler) {
    scheduler.fps=profiles[effectiveProfile()].fps;
    scheduler.setActive(active);
    scheduler.setAnimated(settings.animate&&settings.mode!=='test');
  }
  if(!active||!settings.animate||settings.mode==='test') previousTime=undefined;
}
function report(message:string) {
  if(output) send({type:'rendererError',message});
  else { const el=document.querySelector('#notice'); if(el) { el.textContent=message; el.classList.add('visible'); } }
}
function setupRenderer(canvas:HTMLCanvasElement) {
  try {
    render=new PortraitRenderer(canvas); loadedScene=settings.scene; sceneState=createScene(loadedScene,effectiveProfile());
    render.configure(effectiveProfile(),settings.calibration);
    canvas.addEventListener('webglcontextlost',e=>{ e.preventDefault(); fatal=true; syncActivity(); report('The GPU context was lost. Stop and reopen the output to recover.'); send({type:'log',message:'WebGL context lost'}); });
    canvas.addEventListener('webglcontextrestored',()=>{ fatal=false; render?.configure(effectiveProfile(),settings.calibration); syncActivity(); scheduler?.invalidate(); });
    scheduler=new FrameScheduler(now=>{
      if(!render||!sceneState) return;
      try {
        const moving=settings.animate&&settings.mode!=='test';
        if(moving&&previousTime!==undefined) animationTime+=Math.min((now-previousTime)/1000,0.1);
        previousTime=moving?now:undefined;
        sceneState.content.rotation.y=settings.yaw+(settings.modelUrl||settings.scene==='orbital'?animationTime*0.25:0);
        sceneState.content.rotation.x=0.12;
        sceneState.update(animationTime);
        const box=canvas.getBoundingClientRect();
        render.render(sceneState.scene,output?settings.mode:'preview',output?1536:Math.max(1,Math.round(box.width)),output?2048:Math.max(1,Math.round(box.height)),settings.zoom);
        frameTotal=render.frames;
        const ms=document.querySelector('#submit'); if(ms) ms.textContent=`${render.lastSubmitMs.toFixed(1)} ms`;
        const frames=document.querySelector('#frames'); if(frames) frames.textContent=String(frameTotal);
        // Native telemetry is bounded to one update per second of actual rendering.
        if(output && now-lastTelemetry>1000) { lastTelemetry=now; send({type:'metrics',frames:frameTotal,submitMs:render.lastSubmitMs,profile:effectiveProfile()}); }
      } catch(e) { fatal=true; syncActivity(); report(String(e)); }
    });
    new ResizeObserver(()=>scheduler?.invalidate()).observe(canvas);
    syncActivity(); scheduler.invalidate();
  } catch(e) { report(`WebGL2 could not start: ${String(e)}`); }
}
let lastTelemetry=0;
async function loadModel(url?:string) {
  loadedModel=url;
  const token=++modelToken;
  if(!sceneState) return;
  if(!url) {
    disposeObject(sceneState.content);
    loadedScene=settings.scene; sceneState=createScene(loadedScene,effectiveProfile()); animationTime=0; previousTime=undefined;
    scheduler?.invalidate();
    return;
  }
  try {
    const result=await loader.loadAsync(url);
    if(token!==modelToken) { disposeObject(result.scene); return; }
    const box=new THREE.Box3().setFromObject(result.scene), size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    if(!Number.isFinite(size.length())||size.length()===0) throw new Error('The model has no renderable bounds.');
    result.scene.position.sub(center); const fit=1.65/Math.max(size.x/0.75,size.y,size.z); result.scene.scale.setScalar(fit); result.scene.position.multiplyScalar(fit);
    const group=new THREE.Group(); group.add(result.scene);
    disposeObject(sceneState.content); sceneState.scene.remove(sceneState.content);
    sceneState.content=group; sceneState.update=()=>{}; sceneState.setProfile=()=>{}; sceneState.scene.add(group); animationTime=0; previousTime=undefined; scheduler?.invalidate();
  } catch(e) { report(`Could not load GLB: ${String(e)}. Use an uncompressed, self-contained .glb.`); }
}

if(output) {
  document.body.className='output'; app.innerHTML='<canvas id="output" aria-label="Portrait output"></canvas>';
  // Wait for the host state before rendering; no uncalibrated first frame.
  if(!native) {
    report('Holographic output requires the native macOS app.');
    app.insertAdjacentHTML('beforeend','<p class="output-warning">Open Portrait Direct.app to use exact-pixel output.</p>');
  }
} else {
  app.innerHTML=`
    <header><div class="brand"><span class="mark">▱</span><div>Portrait <b>Direct</b><small>LIGHT FIELD · LOCAL FIRST</small></div></div><span class="pill" id="connection">Preview mode</span></header>
    <main><section class="stage"><div class="stage-top"><span class="eyebrow">YOUR SPACE, IN THREE DIMENSIONS</span><span class="live-dot"></span></div>
      <div class="canvas-wrap"><canvas id="preview" aria-label="Interactive 3D preview"></canvas><div class="preview-badge">2D PREVIEW</div><div id="presenting-cover" hidden>Rendering on your Portrait<span>Laptop preview is sleeping to save energy.</span></div></div>
      <div class="stage-bottom"><div><span class="eyebrow">NOW SHOWING</span><h1 id="scene-name">Purple triangle</h1><p id="scene-description">A little focus, a lot of typing. Drag to turn.</p></div><button id="animate" class="secondary">Play working</button></div>
      <div class="metrics"><div><small>RENDER POLICY</small><strong id="policy">On demand</strong></div><div><small>VIEWS / FRAME</small><strong id="view-count">48</strong></div><div><small>CPU SUBMISSION</small><strong id="submit">—</strong></div><div><small>PREVIEW FRAMES</small><strong id="frames">0</strong></div></div>
      <p id="notice" role="alert"></p>
    </section><aside>
      <section class="panel"><div class="section-label"><span>01</span><h2>Connect your Portrait</h2></div><p id="device-help">Connect HDMI and USB power. Use the native app for exact-pixel output.</p>
        <label for="display">Output display</label><select id="display"><option>No Portrait connected</option></select>
        <button id="calibration" class="secondary full">Import calibration <span>↗</span></button><input id="calibration-file" type="file" accept=".json,application/json" hidden>
        <div class="cal-status" id="cal-status">Calibration needed for 3D output</div>
      </section>
      <section class="panel"><div class="section-label"><span>02</span><h2>Make it yours</h2></div>
        <label for="scene">Scene</label><select id="scene"><option value="triangle">Purple triangle · Working</option><option value="furry">Furry triangle · Working</option><option value="orbital">Orbital study</option><option value="model" disabled>Imported GLB model</option></select>
        <div class="quality" role="group" aria-label="Rendering quality"><button data-profile="eco">Eco</button><button data-profile="balanced">Balanced</button><button data-profile="detail">Detail</button></div><p class="hint" id="quality-hint"></p>
        <label for="zoom">Framing <output id="zoom-value">100%</output></label><input id="zoom" type="range" min="0.65" max="1.5" step="0.01" value="1">
        <div class="button-row"><button id="model" class="secondary">Open GLB model</button><button id="reset" class="text-button">Reset scene</button></div><input id="model-file" type="file" accept=".glb" hidden>
      </section>
      <section class="panel"><div class="section-label"><span>03</span><h2>Send to the glass</h2></div><label for="mode">Output</label><select id="mode"><option value="hologram">Calibrated hologram</option><option value="quilt">Quilt inspection</option><option value="test">Static connection test</option></select>
        <button id="present" class="primary full" disabled>Start output <span>↗</span></button><p class="hint" id="output-hint">A connected Portrait and its calibration unlock output.</p>
      </section>
    </aside></main>
    <details class="diagnostics"><summary>Connection diagnostics <span>Power, signal & rendering</span></summary><div class="diagnostic-grid"><div><h3>If the screen blinks</h3><p>Start the static connection test. If it still blacks out, record the side LED colour and check power, HDMI and adapters one at a time. A still pattern removes continuous scene rendering from the test.</p><p>Use an extended 1536 × 2048 display. Try the Mac’s HDMI port directly. For a separate power test, use the supplied USB-C wall adapter with HDMI connected.</p><p>Red flashing can indicate insufficient power. Yellow blinking can indicate a mode-switch attempt. The exact LED behaviour matters.</p></div><div><h3>Connection log</h3><pre id="events">No hardware connected. No hardware fix has been verified.</pre><button id="export" class="secondary">Save diagnostic report</button></div></div></details>
    <footer><span>Native host · GPU quilt rendering · No Bridge service</span><span>Portrait Direct / 0.1 · hardware validation pending</span></footer>`;
  setupRenderer(document.querySelector('#preview')!);
  document.querySelector('#calibration')!.addEventListener('click',()=> native?send({type:'importCalibration'}):(document.querySelector('#calibration-file') as HTMLInputElement).click());
  document.querySelector('#calibration-file')!.addEventListener('change',async e=>{
    const file=(e.target as HTMLInputElement).files?.[0]; if(!file)return;
    try { update({calibration:parseCalibration(JSON.parse(await file.text()))}); } catch(e) {report(String(e));}
  });
  document.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach(b=>b.onclick=()=>update({profile:b.dataset.profile as Profile}));
  document.querySelector('#animate')!.addEventListener('click',()=>update({animate:!settings.animate}));
  document.querySelector('#scene')!.addEventListener('change',e=>{
    if(settings.modelUrl?.startsWith('blob:')) URL.revokeObjectURL(settings.modelUrl);
    update({scene:(e.target as HTMLSelectElement).value as SceneKind,modelUrl:undefined,modelName:undefined,yaw:0});
  });
  document.querySelector('#zoom')!.addEventListener('input',e=>update({zoom:Number((e.target as HTMLInputElement).value)}));
  document.querySelector('#mode')!.addEventListener('change',e=>update({mode:(e.target as HTMLSelectElement).value as OutputMode}));
  document.querySelector('#model')!.addEventListener('click',()=>native?send({type:'importModel'}):(document.querySelector('#model-file') as HTMLInputElement).click());
  document.querySelector('#model-file')!.addEventListener('change',e=>{
    const file=(e.target as HTMLInputElement).files?.[0]; if(!file)return;
    if(file.size>64*1024*1024){report('Choose a self-contained GLB under 64 MB.');return;}
    if(settings.modelUrl?.startsWith('blob:')) URL.revokeObjectURL(settings.modelUrl);
    update({modelUrl:URL.createObjectURL(file),modelName:file.name});
  });
  document.querySelector('#reset')!.addEventListener('click',()=>{
    if(settings.modelUrl?.startsWith('blob:')) URL.revokeObjectURL(settings.modelUrl);
    animationTime=0; previousTime=undefined;
    update({scene:'triangle',modelUrl:undefined,modelName:undefined,yaw:0,zoom:1,animate:false});
  });
  document.querySelector('#display')!.addEventListener('change',e=>{selectedDisplay=Number((e.target as HTMLSelectElement).value);refresh();});
  document.querySelector('#present')!.addEventListener('click',()=>send(host.presenting?{type:'stop'}:{type:'present',displayId:selectedDisplay}));
  document.querySelector('#export')!.addEventListener('click',()=>{
    if(native) send({type:'export'});
    else {const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify({host,settings:{...settings,modelUrl:undefined},renderer:window.portraitDebug?.()},null,2)],{type:'application/json'}));link.download='portrait-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
  });
  const canvas=document.querySelector<HTMLCanvasElement>('#preview')!;
  let dragging=false, x=0;
  canvas.onpointerdown=e=>{dragging=true;x=e.clientX;canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(dragging){const dx=e.clientX-x;x=e.clientX;update({yaw:settings.yaw+dx*0.008});}};
  canvas.onpointerup=canvas.onpointercancel=()=>{dragging=false;};
  refresh();
}

function refresh() {
  if(output)return;
  const p=profiles[effectiveProfile()];
  const connection=document.querySelector('#connection')!;connection.textContent=host.presenting?'Output active':host.displays.some(d=>d.valid)?'Portrait connected':native?'Waiting for Portrait':'Browser preview';
  connection.classList.toggle('connected',host.presenting||host.displays.some(d=>d.valid));
  const triangle=!settings.modelUrl&&settings.scene!=='orbital';
  document.querySelector('#animate')!.textContent=settings.animate?'Pause motion':triangle?'Play working':'Play motion';
  document.querySelector('#policy')!.textContent=settings.animate?`${p.fps} fps cap`:'On demand';
  document.querySelector('#view-count')!.textContent=String(p.columns*p.rows);
  document.querySelector('#scene-name')!.textContent=settings.modelName??(settings.scene==='furry'?'Furry triangle':triangle?'Purple triangle':'Orbital study');
  document.querySelector('#scene-description')!.textContent=triangle?`${settings.scene==='furry'?'Fluffy lavender · ':''}Working · Alpha Bro Pets. Drag to turn.`:'Drag to turn. A little depth goes a long way.';
  (document.querySelector('#scene') as HTMLSelectElement).value=settings.modelUrl?'model':settings.scene;
  document.querySelector('#cal-status')!.textContent=settings.calibration?`Calibrated · ${settings.calibration.serial}`:'Calibration needed for 3D output';
  document.querySelector('#cal-status')!.classList.toggle('ready',!!settings.calibration);
  document.querySelector('#quality-hint')!.textContent=`${host.lowPower?'Low Power Mode → Eco. ':''}${p.columns*p.rows} views · ${p.columns*p.tileW} × ${p.rows*p.tileH} quilt · ${p.fps} fps maximum`;
  document.querySelectorAll<HTMLElement>('[data-profile]').forEach(b=>b.classList.toggle('selected',b.dataset.profile===settings.profile));
  (document.querySelector('#zoom') as HTMLInputElement).value=String(settings.zoom);
  document.querySelector('#zoom-value')!.textContent=`${Math.round(settings.zoom*100)}%`;
  (document.querySelector('#mode') as HTMLSelectElement).value=settings.mode;
  const select=document.querySelector<HTMLSelectElement>('#display')!;
  const eligible=host.displays.filter(d=>!d.builtIn);
  if(!eligible.some(d=>d.id===selectedDisplay))selectedDisplay=eligible.find(d=>d.valid)?.id;
  select.replaceChildren();
  if(!eligible.length)select.add(new Option('No external display detected',''));
  eligible.forEach(d=>{const option=new Option(`${d.name} · ${d.width} × ${d.height}${d.valid?'':` · ${d.reason}`}`,String(d.id));option.disabled=!d.valid;option.selected=d.id===selectedDisplay;select.add(option);});
  const target=eligible.find(d=>d.id===selectedDisplay&&d.valid);
  const present=document.querySelector<HTMLButtonElement>('#present')!;
  present.textContent=host.presenting?'Stop output':'Start output ↗';
  present.disabled=!host.presenting&&(!native||!target||(settings.mode==='hologram'&&!settings.calibration));
  document.querySelector('#output-hint')!.textContent=host.presenting?'Output stays on the selected display. Escape stops it.':settings.mode==='test'?'Static test needs no calibration and renders once.':'Exact-pixel output requires a connected Portrait; holograms also need its calibration.';
  document.querySelector<HTMLElement>('#presenting-cover')!.hidden=!host.presenting;
  document.querySelector('#device-help')!.textContent=native?'Use HDMI + USB power. Set the Portrait as an extended 1536 × 2048 display.':'Explore the scene here. Open Portrait Direct.app to discover displays and project to the device.';
  document.querySelector('#events')!.textContent=host.events.length?host.events.join('\n'):'No hardware connected. No hardware fix has been verified.';
}
window.portraitReceive=(event)=>{
  try {
    if(event.type==='host') {
      host=event.host;
      if(event.host.settings)settings=sanitize(event.host.settings);
      if(output&&!render)setupRenderer(document.querySelector('#output')!);
      update({},false);
      if(event.host.message)report(event.host.message);
    } else if(event.type==='calibration') update({calibration:parseCalibration(event.value)});
    else if(event.type==='model')update({modelUrl:event.url,modelName:event.name});
    else if(event.type==='error')report(event.message);
    else if(event.type==='metrics'&&!output) {
      document.querySelector('#submit')!.textContent=`${Number(event.submitMs).toFixed(1)} ms (output)`;
    }
  } catch(e) {report(String(e));}
};
channel?.addEventListener('message',e=>{if(e.data.type==='settings'&&output)update(e.data.settings,false);});
document.addEventListener('visibilitychange',syncActivity);
window.addEventListener('pagehide',()=>{scheduler?.dispose();render?.dispose();if(sceneState)disposeObject(sceneState.content);channel?.close();});
window.portraitDebug=()=>({frames:frameTotal,submitMs:render?.lastSubmitMs,profile:effectiveProfile(),scene:settings.modelUrl?'model':settings.scene,animationTime,animate:settings.animate,output,native,hidden:document.hidden,calibrated:!!settings.calibration,glError:render?.renderer.getContext().getError()});
if(native)send({type:'ready',output});

