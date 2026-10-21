# Validation — 21 October 2026

Tested on this Apple M1 Pro Mac, macOS 26.6. The Portrait was **not connected**. These are software results, not hardware acceptance or comparative performance benchmarks.

- TypeScript check and optimized native arm64 build passed. App is about 880 KB; Cocoa/WebKit are supplied by macOS. `codesign --verify --deep --strict` passed.
- Five automated tests passed: calibration format conversion, invalid/wrong-device rejection, parallel off-axis camera convergence, static/suspend/dispose scheduling, and capped animation.
- Real WebGL2 GPU interlacing tests passed in Chrome and native WKWebView for Eco (24 views), Balanced (48) and Detail (48). Four pixel locations with all three colour channels matched the independent CPU optical calculation with zero 8-bit error for the synthetic fixture. Static pattern border also passed. This does not validate the optical fixture against a real Portrait.
- Browser and native preview rendered real geometry. Native GLB loading through the app resource scheme passed using a generated self-contained triangle fixture; its rendered screenshot was visually inspected. No GL error was reported.
- Browser static frame count remained unchanged between checks. Native smoke-test frame counts were identical before and after a one-second idle interval. Animation start/stop was exercised in the browser.
- No-device Start output is disabled; invalid calibration produced an explicit error. Native display discovery found only the built-in display, matching `system_profiler`.
- Native preview, model and GPU evidence lives in ignored `artifacts/`; disconnected display/USB/power baseline is `artifacts/disconnected-baseline.json`.

Pending with hardware: correct device calibration, native pixel registration, RGB/left-right/depth alignment, all quality modes, visible static stability, motion cadence, reconnect/sleep/wake, the reported blinking, and controlled power/performance comparisons with the vendor software. OS display logs cannot detect all power brownouts or visible blackouts.

## Purple triangle Working scene — 21 October 2026

- Added the rounded purple triangle and the original six-pose, 820 ms Working cycle from Alpha Bro Pets. Seven automated tests pass, including continuous cyclic interpolation, alternating paw/key motion, framing, stable geometry/material identity and shared-resource disposal.
- TypeScript, production build, Apple Silicon native packaging and strict code-signature verification pass. Chrome and native WebKit GPU optical checks pass for Eco, Balanced and Detail (zero 8-bit error at the sampled interlaced pixels). The built-in character occupies roughly 74% of output width and 53% of height at default framing in the synthetic GPU fixture.
- Browser preview was visually inspected. Scene switching, pause/frozen frame counts and resume were exercised. The triangle retains a fixed viewing angle while its hands, face, body and keys animate.
- A Portrait **was connected during this follow-up**, identified as LKG-P20078 at unmirrored 1536 × 2048 / 60 Hz. The rebuilt native app used its existing device calibration and started calibrated hologram output with Purple triangle selected and motion enabled. The saved native report records output active, 2,722 rendered frames, Balanced quality, 4 ms CPU submission for the sampled frame, no suspension and no renderer error. This is software/OS evidence of active rendering, not a GPU timing benchmark or proof of the physical image's optical quality.
- Evidence: ignored `artifacts/triangle-preview.png`, `triangle-paused.png`, `triangle-native.json`, `triangle-native-gpu.json`, `triangle-hardware.json` and `triangle-live-output.json`. The app was left projecting the animated character. Visual depth/RGB alignment, perceived smoothness, blinking and long-term stability still require observation of the panel.

## Soft lavender styling — 21 October 2026

- Replaced the flat beveled body with a closed inflated triangle and surface-following glossy dot eyes to match the supplied reference. Added brighter lavender, soft white studio lighting, rounded pastel keyboard and hands, a white background and an analytical soft floor shadow. The shadow is real scene geometry shared by all views, with no shadow maps, blur buffers or new animation loop.
- All seven tests, TypeScript/production build, native app build and strict code-signature verification pass. Browser motion/pause verification confirms typing advances and then freezes both frame count and pose time when paused.
- Chrome and native WebKit GPU checks pass for all three profiles, including the white studio background and character framing. Synthetic interlaced pixel checks still have zero sampled 8-bit error. Browser and native preview images were visually inspected; evidence is in ignored `artifacts/soft-triangle-*.png`, `soft-triangle-native.json` and `soft-triangle-native-gpu.json`.
- Reopened the rebuilt native app and restarted calibrated hologram output on the connected Portrait with motion enabled. Physical appearance, optical alignment and long-term panel stability still require visual observation.
