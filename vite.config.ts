import { defineConfig } from 'vite';
// A classic bundle also runs under WKWebView's local resource scheme, offline.
export default defineConfig({
  base: './',
  build: { target: 'safari17', lib: { entry: 'src/main.ts', name: 'PortraitDirect', formats: ['iife'], fileName: () => 'app.js', cssFileName: 'style' }, cssCodeSplit: false },
});
