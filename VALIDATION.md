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
