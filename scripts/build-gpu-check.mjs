import {build} from 'vite';
await build({configFile:false,build:{target:'safari17',outDir:'artifacts/gpu-test',emptyOutDir:true,lib:{entry:'tests/browser-check.ts',name:'PortraitGPUCheck',formats:['iife'],fileName:()=> 'gpu-check.js'}}});
