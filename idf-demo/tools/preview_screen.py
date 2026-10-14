#!/usr/bin/env python3
"""Offline preview of the demo screen.

Mirrors the drawing code in main/main.c and components/onepage_c61/src/gfx.c so
the layout can be iterated on without flashing the board. The glyphs are parsed
straight out of src/font5x7.c, so the font cannot drift from the firmware, but
the layout itself is a hand-kept copy: if the demo changes, change this too.

    python3 tools/preview_screen.py [out.png]
"""

import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 800, 480
ROW_BYTES = WIDTH // 8

# --- font -------------------------------------------------------------------


def load_font() -> dict[str, list[int]]:
    src = (ROOT / "components/onepage_c61/src/font5x7.c").read_text()
    body = src.split("= {", 1)[1]
    rows = re.findall(r"\{\s*((?:0x[0-9A-Fa-f]{2}\s*,?\s*){5})\}", body)
    glyphs = [[int(b, 16) for b in re.findall(r"0x[0-9A-Fa-f]{2}", row)] for row in rows]
    return {chr(0x20 + i): g for i, g in enumerate(glyphs)}


FONT = load_font()


class Screen:
    def __init__(self) -> None:
        self.pixels = [[False] * WIDTH for _ in range(HEIGHT)]

    def pixel(self, x: int, y: int, black: bool = True) -> None:
        if 0 <= x < WIDTH and 0 <= y < HEIGHT:
            self.pixels[y][x] = black

    def hline(self, x: int, y: int, w: int, black: bool = True) -> None:
        for i in range(w):
            self.pixel(x + i, y, black)

    def vline(self, x: int, y: int, h: int, black: bool = True) -> None:
        for i in range(h):
            self.pixel(x, y + i, black)

    def rect(self, x: int, y: int, w: int, h: int, black: bool = True) -> None:
        self.hline(x, y, w, black)
        self.hline(x, y + h - 1, w, black)
        self.vline(x, y, h, black)
        self.vline(x + w - 1, y, h, black)

    def fill_rect(self, x: int, y: int, w: int, h: int, black: bool = True) -> None:
        for row in range(h):
            self.hline(x, y + row, w, black)

    def checker(self, x: int, y: int, w: int, h: int, cell: int) -> None:
        for row in range(h):
            for col in range(w):
                odd = (((x + col) // cell) + ((y + row) // cell)) & 1
                self.pixel(x + col, y + row, bool(odd))

    def grid(self, x: int, y: int, w: int, h: int, cell: int) -> None:
        self.rect(x, y, w, h)
        for col in range(cell, w, cell):
            self.vline(x + col, y, h)
        for row in range(cell, h, cell):
            self.hline(x, y + row, w)

    def dither(self, x: int, y: int, w: int, h: int, level: int) -> None:
        bayer = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))
        for row in range(h):
            for col in range(w):
                self.pixel(x + col, y + row, bayer[(y + row) & 3][(x + col) & 3] < level)

    def text_width(self, s: str, scale: int) -> int:
        return 6 * scale * len(s)

    def text(self, x: int, y: int, s: str, scale: int = 1, black: bool = True) -> None:
        cursor = x
        for ch in s.upper():
            glyph = FONT.get(ch)
            if glyph:
                for col in range(5):
                    for row in range(7):
                        if glyph[col] & (1 << row):
                            if scale == 1:
                                self.pixel(cursor + col, y + row, black)
                            else:
                                self.fill_rect(cursor + col * scale, y + row * scale, scale, scale, black)
            cursor += 6 * scale


# --- layout (mirrors main/main.c) -------------------------------------------

STATE = {
    "chip": "CHIP  ESP32-C61 V1.0  1 CORE",
    "flash": "FLASH 16MB   PSRAM 2048KB",
    "heap": "HEAP  INT 208K  PSRAM 2008K",
    "sd": "SD    12 FILES  RW OK",
    "bat": "BAT   4012MV 78%   USB 1",
    "keys": "KEYS  2592 RAW 2592MV  BACK DOWN",
    "reset": "RESET POWER ON",
    "buttons": 1 << 0,  # BACK held, to show the filled state
}
BUTTONS = ("BACK", "CONFIRM", "LEFT", "RIGHT", "UP", "DOWN", "POWER")


def draw_patterns(s: Screen) -> None:
    top, height = 72, 60

    s.checker(16, top, 180, height, 10)
    for i, level in enumerate((16, 12, 8, 4, 1)):
        s.dither(206 + i * 36, top, 36, height, level)
    s.grid(396, top, 180, height, 12)
    for i in range(16):
        s.dither(586 + i * 12, top, 12, height, i + 1)

    lower = top + height + 8
    s.rect(16, lower, 180, 60)
    s.hline(16, lower + 30, 180)
    s.vline(106, lower, 60)
    for i in range(30):
        s.pixel(26 + i, lower + 8 + i)
        s.pixel(26 + i, lower + 51 - i)

    s.text(206, lower, "SCALE 1 0123456789", 1)
    s.text(206, lower + 12, "SCALE 2 O0I1 8B", 2)
    s.text(206, lower + 32, "SCALE 3", 3)

    s.fill_rect(396, lower, 180, 30)
    for i in range(23):
        s.vline(396 + i * 8, lower + 34, 26)
    for i in range(99):
        s.vline(586 + i * 2, lower, 60)


def render() -> Screen:
    s = Screen()
    s.text(16, 14, "ONEPAGE C61  IDF DEMO", 3)
    s.hline(16, 46, WIDTH - 32)
    s.text(WIDTH - 16 - s.text_width(STATE["reset"], 2), 24, STATE["reset"], 2)

    s.text(16, 54, "PANEL SELF TEST", 2)
    draw_patterns(s)

    s.hline(16, 216, WIDTH - 32)
    s.text(16, 226, "STATUS", 2)
    y = 244
    for key in ("chip", "flash", "heap", "sd", "bat", "keys"):
        s.text(16, y, STATE[key], 2)
        y += 19

    s.hline(16, 366, WIDTH - 32)
    s.text(16, 376, "BUTTONS - HOLD POWER 2S TO SLEEP", 2)
    for i, name in enumerate(BUTTONS):
        x = 16 + i * (100 + 8)
        pressed = bool(STATE["buttons"] & (1 << i))
        if pressed:
            s.fill_rect(x, 396, 100, 40)
        else:
            s.rect(x, 396, 100, 40)
        text_x = x + (100 - s.text_width(name, 2)) // 2
        s.text(text_x, 396 + 13, name, 2, black=not pressed)

    s.text(16, 446, "CONFIRM = RERUN SD TEST", 2)
    s.text(16, 464, "ESP-IDF BRING-UP BUILD - NOT THE STOCK FIRMWARE", 1)
    return s


def to_image(s: Screen) -> Image.Image:
    img = Image.new("L", (WIDTH, HEIGHT), 255)
    px = img.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if s.pixels[y][x]:
                px[x, y] = 0
    return img


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tools/preview_screen.png"
    screen = render()
    to_image(screen).save(out)
    print(f"wrote {out} ({WIDTH}x{HEIGHT})")

    # Coarse terminal preview: 4x8 pixel blocks.
    for y in range(0, HEIGHT, 8):
        line = []
        for x in range(0, WIDTH, 4):
            dark = sum(screen.pixels[y + dy][x + dx] for dy in range(8) for dx in range(4))
            line.append(" .:-=+*#@"[min(8, dark // 4)])
        print("".join(line))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
