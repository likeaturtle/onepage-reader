#!/usr/bin/env python3
"""Generate the 1-bit brand assets embedded in the firmware.

The product mark is maintained as a transparent PNG at
``miniprogram/CalCal_logo.png``. The e-ink panel only has two tones, so the
script composites the mark on white, crops the empty transparent border,
renders it at the sizes the UI needs and thresholds it to 1-bit.

It also renders the compact header wordmark (``墨程CalCal``) with the same
Noto Sans CJK SC font used for the 24 px CJK table, so the top bar does not
need a second full CJK font.

Outputs ``components/brand/src/brand_logo.c``. The generated file is
committed; rerun this script whenever the logo or the product name changes:

    /Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/gen_brand_assets.py

Requires Pillow (available in the ESP-IDF virtualenv) and Noto Sans CJK SC for
the wordmark (same OFL font as tools/gen_cjk_bitmaps.py; pass --font if needed).
"""

import argparse
import pathlib
import re
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - host dependency
    sys.exit("needs Pillow: use the ESP-IDF virtualenv python")

REPO = pathlib.Path(__file__).resolve().parent.parent
SOURCE = REPO / "miniprogram" / "CalCal_logo.png"
BRAND_HEADER = REPO / "components" / "brand" / "include" / "brand.h"
OUTPUT = REPO / "components" / "brand" / "src" / "brand_logo.c"

# Name -> rendered width in pixels. Heights follow the logo aspect ratio.
SIZES = (
    ("boot", 200),
    ("lock", 96),
    ("header", 30),
)
# 22 px Noto Sans CJK SC renders a 21 px ink box, matching 5x7 scale 3 digits.
WORDMARK_PX = 22
# The mark is a dark navy on white after compositing (30,48,80), far below the
# threshold. 160 keeps the thin strokes at 30 px without filling the counters.
INK_THRESHOLD = 160
BYTES_PER_LINE = 16

FONT_CANDIDATES = [
    "/tmp/NotoSansCJKsc-Regular.otf",
    "/Library/Fonts/NotoSansCJKsc-Regular.otf",
    str(pathlib.Path.home() / "Downloads/NotoSansCJKsc-Regular.otf"),
]


def find_font(explicit: str | None) -> str:
    if explicit:
        return explicit
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return path
    sys.exit(
        "Noto Sans CJK SC not found for the wordmark. Download it (OFL) and pass --font:\n"
        "  curl -L -o /tmp/NotoSansCJKsc-Regular.otf \\\n"
        "    https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"
    )


def brand_name() -> str:
    """Read the canonical name from brand.h so the wordmark cannot drift."""
    text = BRAND_HEADER.read_text()
    zh = re.search(r'#define BRAND_NAME_ZH "([^"]+)"', text)
    en = re.search(r'#define BRAND_NAME_EN "([^"]+)"', text)
    if not zh or not en:
        sys.exit(f"{BRAND_HEADER}: BRAND_NAME_ZH / BRAND_NAME_EN not found")
    return zh.group(1) + en.group(1)


def load_mark() -> Image.Image:
    if not SOURCE.exists():
        sys.exit(f"logo not found: {SOURCE}")
    image = Image.open(SOURCE).convert("RGBA")
    white = Image.new("RGBA", image.size, (255, 255, 255, 255))
    flat = Image.alpha_composite(white, image).convert("L")
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        sys.exit(f"{SOURCE}: logo is fully transparent")
    return flat.crop(bbox)


def pack_pixels(image: Image.Image) -> tuple[int, int, bytes]:
    """Pack an L-mode image (0 = ink, 255 = paper) into 1-bit rows."""
    width, height = image.size
    stride = (width + 7) // 8
    data = bytearray()
    for y in range(height):
        row = bytearray(stride)
        for x in range(width):
            if image.getpixel((x, y)) == 0:
                row[x // 8] |= 0x80 >> (x % 8)
        data.extend(row)
    return width, height, bytes(data)


def pack_logo(mark: Image.Image, width: int) -> tuple[int, int, bytes]:
    height = max(1, round(mark.height * width / mark.width))
    scaled = mark.resize((width, height), Image.LANCZOS)
    bw = scaled.point(lambda value: 0 if value < INK_THRESHOLD else 255)
    return pack_pixels(bw)


def render_wordmark(font_path: str, text: str, px: int,
                    font_index: int = 0) -> tuple[int, int, bytes]:
    font = ImageFont.truetype(font_path, px, index=font_index)
    # Draw black ink on a white canvas and crop to the actual ink box. The
    # baseline anchor keeps the CJK and Latin parts on one line.
    canvas = Image.new("L", (px * len(text) * 2, px * 4), 255)
    ImageDraw.Draw(canvas).text((px, px * 3), text, font=font, fill=0, anchor="ls")
    ink = canvas.point(lambda value: 255 if value < INK_THRESHOLD else 0)
    bbox = ink.getbbox()
    if not bbox:
        sys.exit(f"wordmark {text!r} rendered empty")
    crop = canvas.crop(bbox)
    bw = crop.point(lambda value: 0 if value < INK_THRESHOLD else 255)
    return pack_pixels(bw)


def emit_array(name: str, bits: bytes) -> str:
    lines = [f"static const uint8_t k_{name}_bits[] = {{"]
    for offset in range(0, len(bits), BYTES_PER_LINE):
        chunk = bits[offset : offset + BYTES_PER_LINE]
        lines.append("    " + ", ".join(f"0x{byte:02X}" for byte in chunk) + ",")
    lines.append("};")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", default=None, help="Noto Sans CJK SC OTF/TTC for the wordmark")
    parser.add_argument("--font-index", type=int, default=0,
                        help="face index when --font is a .ttc (Noto Sans CJK SC is 2)")
    args = parser.parse_args()

    mark = load_mark()
    rendered = []
    for name, width in SIZES:
        out_w, out_h, bits = pack_logo(mark, width)
        rendered.append((f"logo_{name}", out_w, out_h, bits))
    word_text = brand_name()
    word_w, word_h, word_bits = render_wordmark(find_font(args.font), word_text, WORDMARK_PX,
                                               args.font_index)
    rendered.append(("wordmark", word_w, word_h, word_bits))

    parts = [
        "/* Generated by tools/gen_brand_assets.py from",
        " * miniprogram/CalCal_logo.png and",
        f" * the canonical brand name {word_text!r}; do not edit by hand.",
        " *",
        " * 1-bit row-major bitmaps, MSB first, 1 = ink. */",
        '#include "brand.h"',
        "",
    ]
    for name, _width, _height, bits in rendered:
        parts.append(emit_array(name, bits))
        parts.append("")
    for name, width, height, _bits in rendered:
        parts.append(f"const brand_bitmap_t brand_{name} = {{{width}, {height}, k_{name}_bits}};")
    parts.append("")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(parts))
    print(f"wrote {OUTPUT.relative_to(REPO)}")
    for name, width, height, bits in rendered:
        print(f"  {name}: {width}x{height}, {len(bits)} bytes")


if __name__ == "__main__":
    main()
