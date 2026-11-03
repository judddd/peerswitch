#!/usr/bin/env bash
# PeerSwitch 一键打 macOS DMG
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export https_proxy="${https_proxy:-http://127.0.0.1:51894}"
export http_proxy="${http_proxy:-http://127.0.0.1:51894}"
unset all_proxy ALL_PROXY || true

echo "==> PeerSwitch 正在打包 DMG"
echo "    目录: $ROOT"

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

echo "==> 可选：捆绑 m1ddc"
mkdir -p "$ROOT/native/bin"
if command -v m1ddc >/dev/null 2>&1; then
  cp "$(command -v m1ddc)" "$ROOT/native/bin/m1ddc"
  chmod +x "$ROOT/native/bin/m1ddc"
  echo "    已捆绑 m1ddc"
elif [[ -x /opt/homebrew/bin/m1ddc ]]; then
  cp /opt/homebrew/bin/m1ddc "$ROOT/native/bin/m1ddc"
  chmod +x "$ROOT/native/bin/m1ddc"
  echo "    已捆绑 /opt/homebrew/bin/m1ddc"
else
  echo "    未找到 m1ddc，运行时可使用 brew 安装的版本"
fi
if [[ -f "$ROOT/native/bin/OrbitDDC.sh" ]]; then
  cp "$ROOT/native/bin/OrbitDDC.sh" "$ROOT/native/bin/PeerSwitchDDC"
  chmod +x "$ROOT/native/bin/PeerSwitchDDC"
fi

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  EB_ARCH="arm64"
else
  EB_ARCH="x64"
fi

echo "==> 编译"
npm run build

echo "==> electron-builder dmg ($EB_ARCH)"
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
npx electron-builder --mac dmg --"$EB_ARCH" --publish never

echo ""
echo "✅ DMG 已生成："
ls -lh "$ROOT"/release/*.dmg 2>/dev/null || ls -lh "$ROOT"/release/
echo ""
echo "打开目录：open \"$ROOT/release\""
