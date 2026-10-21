# Portrait Direct

A small native macOS app and Three.js light-field renderer for the **original Looking Glass Portrait (1536 × 2048)**. Uses Cocoa + the system WebKit GPU process; no Electron, Bridge service, Studio, cloud, video encoding, or framebuffer readbacks in the rendering path.

This is an experimental user-space renderer, not a kernel driver or device firmware. macOS still handles HDMI. **A Portrait has not been connected or tested yet.** Correct optical alignment, refresh stability, comparative speed and battery savings remain unverified on hardware. A faulty power source, HDMI adapter, connector or cable cannot be repaired by this app.

## Run

Open [`build/Portrait Direct.app`](build/Portrait%20Direct.app) in Finder. The app is built for this Apple Silicon Mac, ad-hoc signed, and uses macOS 14+. It runs offline without Node installed.

To rebuild (Node 22.12+ and Xcode command line tools):

```sh
npm ci --include=dev
npm test
npm run build:app
open "build/Portrait Direct.app"
```

For browser preview, use `npm run dev`, then open the printed localhost URL. Browsers preview scenes and import models/calibration; exact display selection is provided by the native app.

## Connect the device

1. Connect HDMI and USB power. Start with the Mac's built-in HDMI port to remove a hub/adapter as a variable. The vendor requires adapters capable of at least 4K at 30 Hz for Portrait.
2. In macOS Displays, set the Portrait to **extended, unmirrored 1536 × 2048** with native pixel mapping. The app checks backing dimensions and active display-mode pixel dimensions. It never changes resolution or refresh rate automatically.
3. Choose **Import calibration**. Select `Visual.json` (sometimes `visual.json`) from `LKG_Calibration` on the Portrait's mounted drive, or your saved copy. If the drive/file is unavailable, the vendor documents exporting it using Bridge once. This app does not implement a USB calibration protocol or use invented default calibration. Check that the serial shown matches your device; matching the calibration to an HDMI display is manual.
4. Select the display. Try **Static connection test** first; it needs no calibration. If stable, choose **Calibrated hologram**, then **Start output**. Press Escape or Stop output to close it.

The app deliberately does not start output automatically after a disconnect. A change to display geometry or mirroring stops output. The native output window covers the panel without borders. Native-pixel mapping still needs physical confirmation with the test pattern. macOS colour transforms, Night Shift or third-party display tools can affect optical output; disable those on the Portrait during alignment checks.

## Web 3D content

The default scene is **Purple triangle · Working**, based on `~/Downloads/projects/alpha-bro-pets`: its rounded triangle outline and smooth 820 ms typing cycle. The character has an inflated lavender body, small glossy eyes and rounded hands and keyboard, lit against a white studio background with a soft floor shadow. Choose **Play working** to animate the hands, body, eyes and keyboard. Motion stays facing you; drag to turn it. Pause freezes the pose and lets the renderer sleep. The character is bundled offline and appears in both preview and calibrated Portrait output without importing a model.

The body is a closed curved mesh, and the eyes follow its surface as it moves. The floor shadow uses one analytical transparent mesh, keeping the softness in every light-field view without shadow maps or per-frame blur work.

To project it, select **Purple triangle · Working**, choose **Calibrated hologram**, then **Start output** after connecting the display and importing its calibration. The same live Three.js character is rendered from every light-field camera; this is not a flat sprite or a video. The scene selection and motion preference are saved by the native app.

The **Scene** menu also offers the original Orbital study. You can load a **self-contained, uncompressed `.glb` under 64 MB**. Draco, KTX2 and Meshopt decoders are not bundled; external model resources are not supported. Imported model animation clips are not played; Play motion turns the model. Selecting a built-in scene leaves the imported model; Reset scene restores the paused purple triangle.

For a custom web scene, replace `createScene()` in `src/scene.ts`, keeping its `{ scene, content, update(seconds) }` return contract, and rebuild. Put dynamic updates in `update`; the scheduler calls it once before all views, using a clock that stops when paused, hidden or suspended. Set animation only when needed, or call `scheduler.invalidate()` after a scene change. Your Three.js geometry, materials and shaders run directly in WebKit. DOM/CSS overlays do not become holograms.

For integration into another Three.js application, `src/renderer.ts` exposes the renderer independently:

```ts
import { PortraitRenderer } from './src/renderer';
import { parseCalibration } from './src/calibration';
const display = new PortraitRenderer(canvas);
display.configure('balanced', parseCalibration(myVisualJson));
display.render(myThreeScene, 'hologram', 1536, 2048);
// Re-render when the scene changes; dispose() when closing.
```

The scene's screen/convergence plane is z=0, camera axis is +z looking toward -z. The vertical field at default framing is about 3.17 scene units, with 0.75 aspect on the Portrait. Cameras use parallel, off-axis frusta. Existing arbitrary websites/iframes cannot be converted to light fields from their 2D pixels: their scene/render loop needs integration. This is not a WebXR drop-in polyfill.

## Energy and performance design

| Mode | Views | Quilt | Motion cap |
|---|---:|---:|---:|
| Eco | 24 | 1440 × 1280 | 24 fps |
| Balanced | 48 | 2520 × 2520 | 30 fps |
| Detail | 48 | 3360 × 3360 | 30 fps |

Motion is off by default. Static content sleeps after its dirty frame. A timer plus vsync caps animation without a continuously polling 60/120 Hz loop. Low Power Mode selects Eco. The laptop's preview pauses during output; sleep pauses rendering. The app does not keep the display/system awake. One render target, one direct GPU interlacing pass, no MSAA, no per-frame texture readbacks, canvas-to-canvas copies or video transport. Eco trades angular resolution for lower cost; test its quality on the device.

The shown timing is **CPU submission**, not GPU execution or end-to-end latency. Initial shader compilation can produce a slow first frame. No claim of outperforming Bridge/Studio or measured battery savings is made. The panel continues consuming power and receiving HDMI scanout even when scene rendering sleeps. For comparisons, use the same scene and panel mode, then measure sustained GPU time, frame cadence, total process memory and battery/energy use after warm-up.

## Blinking investigation

First distinguish the **side status LED** blinking from the **picture going black**. Record the LED colour and whether the device reboots, macOS loses the external display, or the picture alone cuts out.

1. Run the static pattern for several minutes. It renders once, removing continuous 3D rendering as a variable. If it still blinks, investigate below; this does not alone prove a cable fault.
2. Test the supplied USB-C wall adapter with HDMI still connected, as described in the vendor's desktop-mode instructions. This powers the panel separately from the laptop and can help distinguish laptop USB power delivery from other causes. Do not add an unverified splitter or simultaneously connect competing power sources.
3. Compare direct HDMI with your adapter path. Try one known-good HDMI cable, then one USB-C cable, changing one variable at a time. Keep the same resolution/refresh rate throughout each comparison.
4. Watch the native connection log. Disconnect/mode events suggest signal or topology changes; a panel can blink without sending an OS event, so an empty log does not prove stability.
5. Save a diagnostic report. For USB/display/battery snapshots before and during reproduction:

```sh
python3 scripts/capture-hardware.py artifacts/connected.json
```

The hardware snapshot is local and includes device serials. It cannot measure USB voltage, cable integrity or visible blackouts. A red status flash is documented as insufficient power; yellow can indicate a mode-switch attempt. Confirm the exact state against the vendor guide rather than diagnosing from "blinking" alone.

No USB resets, power cycling, firmware writes, mode/refresh-rate flapping or automatic restart loops are used. Persistent faults with the static pattern and stable power require hardware-side investigation.

## Validation

`npm test` checks calibration parsing/rejection, the optical parameter conversion, every off-axis camera's convergence, frame coalescing, idle/suspend/dispose and animation caps. Character tests check the original typing poses, continuous looping, key and paw motion, fixed geometry allocations, framing bounds and disposal of shared resources.

`tests/browser-check.ts` renders synthetic view-coded quilts and compares real GPU output pixels with an independent CPU optical calculation for every quality profile. Readbacks exist only in this test. Run with browser-harness while the dev server is open:

```python
print(js('(async()=>JSON.stringify((await import("/tests/browser-check.ts")).checkGPU()))()'))
```

Native WebKit preview, idle and GPU checks (no device needed):

```sh
node scripts/build-gpu-check.mjs
"build/Portrait Direct.app/Contents/MacOS/PortraitDirect" \
  --smoke-test "$PWD/artifacts/native-preview" \
  --gpu-check "$PWD/artifacts/gpu-test/gpu-check.js"
```

Reports and a native WebKit snapshot are saved beside the chosen prefix. These verify software only. The pending physical acceptance test is: device-specific calibration; pixel registration; correct left-to-right depth and RGB alignment; start/stop; unplug/replug; sleep/wake; several minutes of static and animated output; the reported blinking; and measured energy/performance against the same reference scene.

Local settings and the imported model are stored in `~/Library/Application Support/Portrait Direct/`. Nothing is sent over the network by the bundled app. See `THIRD_PARTY_NOTICES.md` for licenses.

## Primary references

- [Portrait setup](https://lfdocs.lookingglassfactory.com/getting-started/portrait/get-started-with-looking-glass-portrait)
- [Portrait power, LEDs and calibration troubleshooting](https://lfdocs.lookingglassfactory.com/getting-started/portrait/troubleshooting)
- [macOS display settings and pixel resolution](https://lfdocs.lookingglassfactory.com/software/looking-glass-bridge/display-settings-on-macos)
- [Looking Glass WebXR source](https://github.com/Looking-Glass/looking-glass-webxr)
