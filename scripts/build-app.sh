#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="$PWD/build/Portrait Direct.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp dist/app.js dist/style.css "$APP/Contents/Resources/web/"
cat > "$APP/Contents/Resources/web/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self' portrait: blob: data:; script-src 'self' portrait:; style-src 'self' portrait: 'unsafe-inline'; connect-src 'self' portrait: blob: data:; img-src 'self' portrait: blob: data:;"><title>Portrait Direct</title><link rel="stylesheet" href="style.css"></head><body><div id="app"></div><script src="app.js"></script></body></html>
HTML
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Portrait Direct</string>
<key>CFBundleDisplayName</key><string>Portrait Direct</string>
<key>CFBundleIdentifier</key><string>local.portrait.direct</string>
<key>CFBundleExecutable</key><string>PortraitDirect</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict></plist>
PLIST
xcrun swiftc -swift-version 5 -O -target arm64-apple-macosx14.0 native/main.swift -o "$APP/Contents/MacOS/PortraitDirect" -framework Cocoa -framework WebKit -framework CoreGraphics -framework UniformTypeIdentifiers
cp THIRD_PARTY_NOTICES.md "$APP/Contents/Resources/"
cp -R licenses "$APP/Contents/Resources/"
codesign --force --deep --sign - "$APP"
printf 'Built %s\n' "$APP"
