import Cocoa
import WebKit
import UniformTypeIdentifiers
import CoreGraphics

// A small Cocoa/WebKit host: no bundled Chromium, daemon, display-mode writes,
// USB resets, firmware changes or screen-capture permission.
final class Resources: NSObject, WKURLSchemeHandler {
    let root: URL
    var model: URL?
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app" else { task.didFailWithError(URLError(.badURL)); return }
        let path = url.path == "/" ? "/index.html" : url.path
        let file = path == "/model.glb" ? model : root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard let file = file, (path == "/model.glb" || file.path.hasPrefix(root.path + "/")),
              let data = try? Data(contentsOf: file) else { task.didFailWithError(URLError(.fileDoesNotExist)); return }
        let mime: String
        switch file.pathExtension {
        case "html": mime = "text/html"
        case "js": mime = "application/javascript"
        case "css": mime = "text/css"
        case "glb": mime = "model/gltf-binary"
        case "json": mime = "application/json"
        default: mime = "application/octet-stream"
        }
        task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil))
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var control: NSWindow!
    var controlView: WKWebView!
    var output: NSWindow?
    var outputView: WKWebView?
    var outputDisplay: CGDirectDisplayID?
    var settings: [String: Any] = ["profile": "balanced", "animate": false, "mode": "hologram", "zoom": 1, "yaw": 0]
    var events: [String] = []
    var observers: [NSObjectProtocol] = []
    var message = ""
    var suspended = false
    var lastMetrics: [String: Any] = [:]
    var readyViews = Set<ObjectIdentifier>()
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Portrait Direct", isDirectory: true)
    lazy var resources = Resources(root: Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true))
    var testPath: String? {
        guard let index = CommandLine.arguments.firstIndex(of: "--smoke-test"), CommandLine.arguments.count > index+1 else { return nil }
        return CommandLine.arguments[index+1]
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: support.appendingPathComponent("settings.json")),
           let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { settings = saved }
        let model = support.appendingPathComponent("model.glb")
        if FileManager.default.fileExists(atPath: model.path) { resources.model = model }
        else { settings.removeValue(forKey: "modelUrl"); settings.removeValue(forKey: "modelName") }
        if testPath != nil, let index = CommandLine.arguments.firstIndex(of: "--model-check"), CommandLine.arguments.count > index+1 {
            resources.model = URL(fileURLWithPath: CommandLine.arguments[index+1])
            settings["modelUrl"] = "portrait://app/model.glb"; settings["modelName"] = "Synthetic GLB test"; settings["animate"] = false
        }
        control = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 940), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        control.title = "Portrait Direct"; control.minSize = NSSize(width: 820, height: 720)
        control.isReleasedWhenClosed = false; control.delegate = self
        controlView = makeView(); control.contentView = controlView
        control.center(); control.makeKeyAndOrderFront(nil)
        controlView.load(URLRequest(url: URL(string: "portrait://app/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
        let menu = NSMenu(); let appMenu = NSMenu(); let item = NSMenuItem(); item.submenu = appMenu; menu.addItem(item)
        appMenu.addItem(withTitle: "About Portrait Direct", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Portrait Direct", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editMenu = NSMenu(title: "Edit"); let editItem = NSMenuItem(); editItem.submenu = editMenu; menu.addItem(editItem)
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = menu
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.screensChanged() })
        observers.append(NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in self?.log("Power mode changed"); self?.broadcast() })
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification] {
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.suspended = true; self?.log("Display/system sleep: rendering paused"); self?.broadcast() })
        }
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification] {
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.suspended = false; self?.screensChanged() })
        }
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53, self?.output != nil { self?.stop(); return nil }; return event
        }
        log("App started. Optical output and blinking have not been hardware-validated.")
        log("Displays: \(displayList().map { "\($0["name"] ?? "?") \($0["width"] ?? 0)×\($0["height"] ?? 0)" }.joined(separator: ", "))")
    }
    func makeView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(resources, forURLScheme: "portrait")
        config.userContentController.add(self, name: "portrait")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        if #available(macOS 13.3, *) { view.isInspectable = true }
        return view
    }
    func displayList() -> [[String: Any]] {
        NSScreen.screens.map { screen in
            let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! NSNumber).uint32Value
            let size = screen.convertRectToBacking(NSRect(origin: .zero, size: screen.frame.size)).size
            let width = Int(size.width.rounded()), height = Int(size.height.rounded())
            let builtIn = CGDisplayIsBuiltin(id) != 0
            let mirrored = CGDisplayIsInMirrorSet(id) != 0
            let rotation = Int(CGDisplayRotation(id)) % 180
            let mode = CGDisplayCopyDisplayMode(id)
            let physicalW = rotation == 90 ? mode?.pixelHeight : mode?.pixelWidth
            let physicalH = rotation == 90 ? mode?.pixelWidth : mode?.pixelHeight
            let reason = builtIn ? "Built-in display" : mirrored ? "Turn off mirroring" : (width != 1536 || height != 2048 || physicalW != 1536 || physicalH != 2048) ? "Set unscaled 1536 × 2048" : ""
            return ["id": id, "name": screen.localizedName, "width": width, "height": height, "builtIn": builtIn, "mirrored": mirrored, "valid": reason.isEmpty, "reason": reason, "scale": screen.backingScaleFactor, "refreshHz": mode?.refreshRate ?? 0, "physicalWidth": physicalW ?? 0, "physicalHeight": physicalH ?? 0]
        }
    }
    func state() -> [String: Any] {
        ["displays": displayList(), "presenting": output != nil, "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled,
         "suspended": suspended, "events": events, "settings": settings, "message": message]
    }
    func emit(_ object: [String: Any], to view: WKWebView?) {
        guard let view = view, readyViews.contains(ObjectIdentifier(view)),
              let data = try? JSONSerialization.data(withJSONObject: object), let json = String(data: data, encoding: .utf8) else { return }
        view.evaluateJavaScript("window.portraitReceive(\(json))", completionHandler: nil)
    }
    func broadcast() { let event: [String: Any] = ["type": "host", "host": state()]; emit(event, to: controlView); emit(event, to: outputView) }
    func log(_ text: String) {
        events.append("\(ISO8601DateFormatter().string(from: Date()))  \(text)")
        if events.count > 100 { events.removeFirst(events.count - 100) }
    }
    func saveSettings() {
        guard testPath == nil else { return }
        if let data = try? JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: support.appendingPathComponent("settings.json"), options: .atomic) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive scriptMessage: WKScriptMessage) {
        guard let body = scriptMessage.body as? [String: Any], let type = body["type"] as? String,
              let source = scriptMessage.webView, scriptMessage.frameInfo.isMainFrame,
              source === controlView || source === outputView else { return }
        switch type {
        case "ready":
            readyViews.insert(ObjectIdentifier(source)); emit(["type": "host", "host": state()], to: source)
        case "settings" where source === controlView:
            if let next = body["settings"] as? [String: Any] { settings = next; saveSettings(); broadcast() }
        case "present" where source === controlView:
            present((body["displayId"] as? NSNumber)?.uint32Value)
        case "stop" where source === controlView: stop()
        case "importCalibration" where source === controlView: importCalibration()
        case "importModel" where source === controlView: importModel()
        case "export" where source === controlView: exportReport()
        case "metrics": lastMetrics = body; emit(body, to: controlView)
        case "rendererError": message = body["message"] as? String ?? "Renderer error"; log(message); stop()
        case "log": log(body["message"] as? String ?? "Renderer event"); broadcast()
        default: break
        }
    }
    func present(_ id: CGDirectDisplayID?) {
        guard output == nil else { return }
        guard let id = id,
              displayList().contains(where: { ($0["id"] as? UInt32) == id && ($0["valid"] as? Bool) == true }),
              let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id }) else {
            message = "Choose an external, unmirrored Portrait running at native 1536 × 2048. No output was opened."; broadcast(); return
        }
        guard settings["mode"] as? String != "hologram" || settings["calibration"] is [String: Any] else { message = "Import this Portrait’s Visual.json before starting holographic output."; broadcast(); return }
        message = ""; outputDisplay = id
        let window = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
        window.isReleasedWhenClosed = false; window.delegate = self
        window.backgroundColor = .black; window.isOpaque = true; window.hasShadow = false
        window.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.setFrame(screen.frame, display: true)
        let view = makeView(); window.contentView = view; output = window; outputView = view
        view.load(URLRequest(url: URL(string: "portrait://app/index.html?output=1")!))
        window.orderFrontRegardless()
        log("Output started on display \(id), native 1536×2048, mode \(settings["mode"] ?? "?"). Laptop preview paused.")
        broadcast()
    }
    func stop() {
        if let view = outputView {
            view.evaluateJavaScript("window.dispatchEvent(new Event('pagehide'))", completionHandler: nil)
            readyViews.remove(ObjectIdentifier(view)); view.stopLoading()
            view.configuration.userContentController.removeScriptMessageHandler(forName: "portrait")
        }
        if output != nil { log("Output stopped") }
        output?.orderOut(nil); output?.close(); output = nil; outputView = nil; outputDisplay = nil
        broadcast()
    }
    func screensChanged() {
        log("Display configuration changed: \(displayList().map { "\($0["id"] ?? 0):\($0["width"] ?? 0)×\($0["height"] ?? 0)" }.joined(separator: ", "))")
        if let id = outputDisplay {
            if !displayList().contains(where: { ($0["id"] as? UInt32) == id && ($0["valid"] as? Bool) == true }) {
                message = "Portrait disconnected or changed resolution. Output stopped; reconnect and start it explicitly."; stop()
            } else if let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id }) { output?.setFrame(screen.frame, display: true) }
        }
        broadcast()
    }
    func importCalibration() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.canChooseDirectories = false
        panel.message = "Choose your Portrait’s Visual.json from LKG_Calibration on its mounted drive, or a saved copy."
        if let volumes = try? FileManager.default.contentsOfDirectory(at: URL(fileURLWithPath: "/Volumes"), includingPropertiesForKeys: nil) {
            for volume in volumes {
                let folder = volume.appendingPathComponent("LKG_Calibration", isDirectory: true)
                if FileManager.default.fileExists(atPath: folder.path) { panel.directoryURL = folder; break }
            }
        }
        panel.beginSheetModal(for: control) { [weak self] response in
            guard let self = self, response == .OK, let url = panel.url else { return }
            do {
                let data = try Data(contentsOf: url)
                guard data.count < 1_048_576 else { throw NSError(domain: "Portrait", code: 1, userInfo: [NSLocalizedDescriptionKey: "Calibration file exceeds 1 MB."]) }
                let json = try JSONSerialization.jsonObject(with: data)
                self.emit(["type": "calibration", "value": json], to: self.controlView)
                self.log("Calibration file read: \(url.lastPathComponent). Optical validation is performed by the renderer.")
            } catch { self.message = error.localizedDescription; self.broadcast() }
        }
    }
    func importModel() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [UTType(filenameExtension: "glb") ?? .data]
        panel.message = "Choose an uncompressed, self-contained GLB under 64 MB. It will be copied into this app’s local data folder."
        panel.beginSheetModal(for: control) { [weak self] response in
            guard let self = self, response == .OK, let url = panel.url else { return }
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 64*1024*1024 else { throw NSError(domain: "Portrait", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose a GLB under 64 MB."]) }
                let data = try Data(contentsOf: url); let target = self.support.appendingPathComponent("model.glb")
                try data.write(to: target, options: .atomic); self.resources.model = target
                // A stable local URL; reset the loader even when replacing an existing file.
                self.settings.removeValue(forKey: "modelUrl"); self.settings.removeValue(forKey: "modelName"); self.broadcast()
                self.emit(["type": "model", "url": "portrait://app/model.glb", "name": url.lastPathComponent], to: self.controlView)
                self.log("Model imported: \(url.lastPathComponent)")
            } catch { self.message = error.localizedDescription; self.broadcast() }
        }
    }
    func exportReport() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "portrait-diagnostics.json"; panel.allowedContentTypes = [.json]
        panel.beginSheetModal(for: control) { [weak self] response in
            guard let self = self, response == .OK, let url = panel.url else { return }
            var report = self.state(); report["metrics"] = self.lastMetrics
            report["os"] = ProcessInfo.processInfo.operatingSystemVersionString
            report["hardwareValidated"] = false
            report["notes"] = "Display events do not detect every panel blackout or USB brownout. CPU submission time is not GPU frame time. Record visible symptom and LED colour separately."
            report.removeValue(forKey: "settings") // Calibration and local model details are unnecessary for connection diagnosis.
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: url, options: .atomic) }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.scheme == "portrait" && navigationAction.request.url?.host == "app" ? .allow : .cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        message = "Web content process exited. Stop and reopen the app to recover."; log(message); stop()
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === controlView, let path = testPath else { return }
        DispatchQueue.main.asyncAfter(deadline: .now()+3) {
            if let index = CommandLine.arguments.firstIndex(of: "--gpu-check"), CommandLine.arguments.count > index+1,
               let source = try? String(contentsOfFile: CommandLine.arguments[index+1], encoding: .utf8) {
                webView.evaluateJavaScript(source + "; JSON.stringify(PortraitGPUCheck.checkGPU())") { value, error in
                    let gpu = (value as? String) ?? "{\"error\":\"\(error?.localizedDescription ?? "No result")\"}"
                    try? gpu.write(toFile: path + "-gpu.json", atomically: true, encoding: .utf8)
                }
            }
            webView.evaluateJavaScript("window.__idleFrames=window.portraitDebug?.().frames")
            DispatchQueue.main.asyncAfter(deadline: .now()+1) {
            webView.evaluateJavaScript("JSON.stringify({renderer:window.portraitDebug?.(),idleFramesBefore:window.__idleFrames,title:document.title,body:document.body.innerText,canvas:!!document.querySelector('canvas')})") { value, error in
                let result = (value as? String) ?? "{\"error\":\"\(error?.localizedDescription ?? "No result")\"}"
                try? result.write(toFile: path + ".json", atomically: true, encoding: .utf8)
                webView.takeSnapshot(with: nil) { image, _ in
                    if let image = image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: path + ".png")) }
                    print(result); NSApp.terminate(nil)
                }
            }
            }
        }
    }
    func windowWillClose(_ notification: Notification) { if notification.object as? NSWindow === control { NSApp.terminate(nil) } }
    func applicationWillTerminate(_ notification: Notification) { saveSettings() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular); app.delegate = delegate
app.run()
