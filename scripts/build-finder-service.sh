#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/PeerSwitchService/main.swift"
PLIST="$ROOT/native/PeerSwitchService/Info.plist"
APP="$ROOT/native/bin/PeerSwitchService.app"
MACOS="$APP/Contents/MacOS"
mkdir -p "$MACOS"
cp "$PLIST" "$APP/Contents/Info.plist"
swiftc -O -o "$MACOS/PeerSwitchService" "$SRC"
codesign --force --sign - --identifier app.peerswitch.service "$APP" >/dev/null 2>&1 || true
echo "✅ Finder 服务助手：$APP"
