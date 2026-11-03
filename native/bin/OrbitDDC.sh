#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "set" || -z "${2:-}" ]]; then
  echo "用法: PeerSwitchDDC set <输入源代码>" >&2
  exit 2
fi
CODE="$2"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -x /opt/homebrew/bin/m1ddc ]]; then
  exec /opt/homebrew/bin/m1ddc display 1 set input "$CODE"
fi
if [[ -x /usr/local/bin/m1ddc ]]; then
  exec /usr/local/bin/m1ddc display 1 set input "$CODE"
fi
if command -v m1ddc >/dev/null 2>&1; then
  exec m1ddc display 1 set input "$CODE"
fi
if command -v ddcctl >/dev/null 2>&1; then
  exec ddcctl -d 1 -i "$CODE"
fi
echo "未找到 m1ddc，请执行: brew install m1ddc" >&2
exit 1
