#!/usr/bin/env bash
# 编译并替换本机 Mac 上的 PeerSwitch
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export https_proxy="${https_proxy:-http://127.0.0.1:51894}"
export http_proxy="${http_proxy:-http://127.0.0.1:51894}"
unset all_proxy ALL_PROXY || true
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"

echo "==> 编译访达右键服务"
bash scripts/build-finder-service.sh

echo "==> 编译 PeerSwitch"
npm run build

ARCH="$(uname -m)"
EB_ARCH="arm64"
[[ "$ARCH" != "arm64" ]] && EB_ARCH="x64"

echo "==> 打包 macOS dir ($EB_ARCH)"
npx electron-builder --mac dir --"$EB_ARCH" --publish never

APP_SRC="$ROOT/release/mac-$EB_ARCH/PeerSwitch.app"
if [[ ! -d "$APP_SRC" ]]; then
  # electron-builder 有时输出到 release/mac/
  if [[ -d "$ROOT/release/mac/PeerSwitch.app" ]]; then
    APP_SRC="$ROOT/release/mac/PeerSwitch.app"
  else
    echo "未找到打包产物 PeerSwitch.app" >&2
    exit 1
  fi
fi

echo "==> 结束正在运行的 PeerSwitch"
osascript -e 'tell application "PeerSwitch" to quit' >/dev/null 2>&1 || true
pkill -x PeerSwitch >/dev/null 2>&1 || true
sleep 1

APP_DST="/Applications/PeerSwitch.app"
echo "==> 安装到 $APP_DST"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"

echo "==> 启动 PeerSwitch"
open "$APP_DST"

echo "✅ 本机已更换为最新包：$APP_DST"
