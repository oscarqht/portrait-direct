import { parseThreeMF, threeMFTransferables } from './three-mf';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

self.onmessage=({data}:{data:{format:'3mf'|'stl';buffer:ArrayBuffer}})=>{
  try {
    self.postMessage({phase:'Processing model…'});
    if(data.format==='3mf') {
      const parsed=parseThreeMF(data.buffer,phase=>self.postMessage({phase}));
      self.postMessage({result:parsed}, {transfer:threeMFTransferables(parsed)});
    } else {
      const geometry=new STLLoader().parse(data.buffer);
      const positions=geometry.getAttribute('position').array as Float32Array;
      const normals=geometry.getAttribute('normal')?.array as Float32Array|undefined;
      const colors=geometry.getAttribute('color')?.array as Float32Array|undefined;
      const opacity='alpha' in geometry&&typeof geometry.alpha==='number'?geometry.alpha:1;
      const transfer=[positions,normals,colors].filter(Boolean).map(a=>a!.buffer as ArrayBuffer);
      self.postMessage({result:{positions,normals,colors,opacity}}, {transfer});
    }
  } catch(error) { self.postMessage({error:String(error)}); }
};
