#!/usr/bin/env bash
# PeerSwitch 一键打 Windows EXE（安装包 + 便携版）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export https_proxy="${https_proxy:-http://127.0.0.1:51894}"
export http_proxy="${http_proxy:-http://127.0.0.1:51894}"
unset all_proxy ALL_PROXY || true

echo "==> PeerSwitch 正在打包 EXE"
echo "    目录: $ROOT"
echo "    主机: $(uname -s)/$(uname -m)"

if ! command -v node >/dev/null; then
  echo "需要安装 Node.js" >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "==> 安装依赖"
  npm install
fi

echo "==> 生成图标"
bash "$ROOT/scripts/make-icons.sh"

mkdir -p "$ROOT/native/bin"

echo "==> 编译"
npm run build

echo "==> electron-builder win（NSIS + 便携版）"
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
npx electron-builder --win nsis portable --x64 --publish never

echo ""
echo "✅ Windows 安装包："
ls -lh "$ROOT"/release/*.exe 2>/dev/null || ls -lh "$ROOT"/release/
echo ""
echo "安装版：PeerSwitch Setup *.exe  |  便携版：PeerSwitch *.exe"
