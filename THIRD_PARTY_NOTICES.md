# Third-party notices

Three.js (https://github.com/mrdoob/three.js), copyright 2010-2026 Three.js Authors, MIT. License in `licenses/Three-MIT.txt`.

The optical pitch, tilt and subpixel parameter conversions, and off-axis camera approach, are based on Looking Glass WebXR's `LookingGlassConfig.ts` and `LookingGlassXRDevice.ts` (https://github.com/Looking-Glass/looking-glass-webxr), Apache-2.0. Source notices credit Copyright 2021 Google LLC. The parser, renderer, shader, scheduler and native host here are new implementations; they do not bundle HoloPlay Core or the WebXR polyfill. Apache license in `licenses/LookingGlass-WebXR-Apache-2.0.txt`.

Vite, TypeScript, tsx and their dependencies are build/test tools; their licenses remain in `node_modules` and are not required at app runtime.

The purple triangle character is adapted from the user's local Alpha Bro Pets project: `src/utils/projectAvatarShapes.ts` (rounded triangle, original avatar geometry credited to dots-lab), `src/utils/projectIcons.ts` (initial purple palette and face), `src/pet/spec.ts` (Working poses and cyclic interpolation), `src/pet/3d/petGlassGeometry.ts` (inflated outline construction), and `src/pet/3d/pet3dBuilder.ts` / `PetKeyboard3D.tsx` (body, eyes, typing hands and keyboard). The Portrait adaptation uses articulated shared meshes and instanced keys, with lavender studio styling based on the user's image reference; it does not bundle the React app, fur or glass renderer.
