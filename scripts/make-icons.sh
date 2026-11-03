#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/resources"
mkdir -p "$RES"
cd "$ROOT"

python3 - <<'PY'
from pathlib import Path
import struct
import subprocess
import sys
import zlib

try:
    from PIL import Image, ImageDraw
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pillow', '-q'])
    from PIL import Image, ImageDraw

out = Path('resources')
out.mkdir(exist_ok=True)

size = 1024
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
margin = 80
radius = 220
d.rounded_rectangle(
    [margin, margin, size - margin, size - margin],
    radius=radius,
    fill=(0, 113, 227, 255),
)
cx = cy = size // 2
d.ellipse([cx - 260, cy - 160, cx + 260, cy + 160], outline=(255, 255, 255, 230), width=36)
d.ellipse([cx + 140, cy - 40, cx + 220, cy + 40], fill=(255, 255, 255, 255))
img.save(out / 'icon.png')


def png_bytes(im: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    im.save(buf, format='PNG')
    return buf.getvalue()


def write_ico(path: Path, master: Image.Image, sizes: list[int]) -> None:
    """Write a real multi-size ICO with PNG-compressed 256 entry (Vista+)."""
    images = []
    for s in sizes:
        im = master.resize((s, s), Image.Resampling.LANCZOS)
        data = png_bytes(im)
        images.append((s, data))

    # ICONDIR
    count = len(images)
    header = struct.pack('<HHH', 0, 1, count)
    offset = 6 + 16 * count
    entries = b''
    blobs = b''
    for s, data in images:
        # width/height: 0 means 256
        w = 0 if s >= 256 else s
        h = 0 if s >= 256 else s
        entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)

    path.write_bytes(header + entries + blobs)


sizes = [16, 24, 32, 48, 64, 128, 256]
write_ico(out / 'icon.ico', img.convert('RGBA'), sizes)

# Verify
raw = (out / 'icon.ico').read_bytes()
_, _, n = struct.unpack_from('<HHH', raw, 0)
found = []
for i in range(n):
    w, h = raw[6 + i * 16], raw[7 + i * 16]
    found.append((256 if w == 0 else w, 256 if h == 0 else h))
print('wrote resources/icon.png')
print('wrote resources/icon.ico sizes:', found)
if (256, 256) not in found:
    raise SystemExit('icon.ico missing 256x256')
PY

rm -rf "$RES/icon.iconset"
mkdir -p "$RES/icon.iconset"
sips -z 16 16 "$RES/icon.png" --out "$RES/icon.iconset/icon_16x16.png" >/dev/null
sips -z 32 32 "$RES/icon.png" --out "$RES/icon.iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$RES/icon.png" --out "$RES/icon.iconset/icon_32x32.png" >/dev/null
sips -z 64 64 "$RES/icon.png" --out "$RES/icon.iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$RES/icon.png" --out "$RES/icon.iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$RES/icon.png" --out "$RES/icon.iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$RES/icon.png" --out "$RES/icon.iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$RES/icon.png" --out "$RES/icon.iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$RES/icon.png" --out "$RES/icon.iconset/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$RES/icon.png" --out "$RES/icon.iconset/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$RES/icon.iconset" -o "$RES/icon.icns"
rm -rf "$RES/icon.iconset"
echo "图标已就绪：$RES"
