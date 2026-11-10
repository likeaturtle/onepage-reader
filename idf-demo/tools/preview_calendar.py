#!/usr/bin/env python3
"""Offline previews of the portrait single-calendar UI.

The layout mirrors main/calendar_ui.c (480x800 logical canvas, rotated by gfx.c
onto the 800x480 panel). It reads the real font5x7 table and embedded GB2312
font blob, so missing glyphs and overflow show up here.

    /Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/preview_calendar.py

Outputs tools/preview_month.png, preview_day.png, preview_detail.png,
preview_delete.png and preview_sleep.png.
"""

import datetime as dt
import re
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
COMPONENT = ROOT / "components" / "onepage_c61"
W, H = 480, 800
CJK_PX = 24
LARGE_PX = 48


def load_font5x7():
    src = (COMPONENT / "src" / "font5x7.c").read_text()
    body = src.split("= {", 1)[1]
    rows = re.findall(r"\{\s*((?:0x[0-9A-Fa-f]{2}\s*,?\s*){5})\}", body)
    glyphs = [[int(b, 16) for b in re.findall(r"0x[0-9A-Fa-f]{2}", row)] for row in rows]
    return {chr(0x20 + i): g for i, g in enumerate(glyphs)}


def load_gb2312():
    data = (COMPONENT / "font_gb2312_24.bin").read_bytes()
    magic, version, px, row_bytes, count, _ = struct.unpack("<4sHBBII", data[:16])
    assert magic == b"OPF1" and version == 1 and px == CJK_PX, "bad font blob"
    stride = 4 + row_bytes * px
    glyphs = {}
    for i in range(count):
        off = 16 + i * stride
        cp = struct.unpack("<I", data[off : off + 4])[0]
        glyphs[cp] = data[off + 4 : off + 4 + row_bytes * px]
    return glyphs, row_bytes


def load_large():
    src = (COMPONENT / "src" / "font_cjk_large.c").read_text()
    entries = re.findall(r"\{0x([0-9A-Fa-f]{4}), \{(.*?)\}\},", src, re.S)
    return {
        int(cp, 16): bytes(int(b, 16) for b in re.findall(r"0x([0-9A-Fa-f]{2})", body))
        for cp, body in entries
    }


FONT = load_font5x7()
GB, GB_ROW_BYTES = load_gb2312()
LARGE = load_large()


class Screen:
    def __init__(self):
        self.p = [[False] * W for _ in range(H)]

    def pixel(self, x, y, black=True):
        if 0 <= x < W and 0 <= y < H:
            self.p[y][x] = black

    def hline(self, x, y, w, black=True):
        for i in range(w):
            self.pixel(x + i, y, black)

    def vline(self, x, y, h, black=True):
        for i in range(h):
            self.pixel(x, y + i, black)

    def rect(self, x, y, w, h, black=True):
        self.hline(x, y, w, black)
        self.hline(x, y + h - 1, w, black)
        self.vline(x, y, h, black)
        self.vline(x + w - 1, y, h, black)

    def fill_rect(self, x, y, w, h, black=True):
        for row in range(h):
            self.hline(x, y + row, w, black)

    def line(self, x0, y0, x1, y1, thickness=1, black=True):
        dx, sx = abs(x1 - x0), (1 if x0 < x1 else -1)
        dy, sy = -abs(y1 - y0), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            if thickness <= 1:
                self.pixel(x0, y0, black)
            else:
                self.fill_rect(x0 - thickness // 2, y0 - thickness // 2,
                               thickness, thickness, black)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def text5x7(self, x, y, s, scale=1, black=True):
        cur = x
        for ch in s:
            c = ch.upper() if "a" <= ch <= "z" else ch
            glyph = FONT.get(c)
            if glyph is None:
                glyph = [0x7F, 0x41, 0x41, 0x41, 0x7F]
            for col, bits in enumerate(glyph):
                for row in range(7):
                    if bits & (1 << row):
                        if scale == 1:
                            self.pixel(cur + col, y + row, black)
                        else:
                            self.fill_rect(cur + col * scale, y + row * scale, scale, scale, black)
            cur += 6 * scale
        return cur

    def text5x7_width(self, s, scale=1):
        return len(s) * 6 * scale

    def cjk(self, x, y, ch, black=True):
        glyph = GB.get(ord(ch))
        if glyph is None:
            self.rect(x + 2, y + 2, CJK_PX - 4, CJK_PX - 4, black)
            return
        for row in range(CJK_PX):
            for col in range(CJK_PX):
                ink = glyph[row * GB_ROW_BYTES + col // 8] & (0x80 >> (col % 8))
                self.pixel(x + col, y + row, black if ink else not black)

    def large(self, x, y, ch, black=True):
        glyph = LARGE.get(ord(ch))
        if glyph is None:
            return
        for row in range(LARGE_PX):
            for col in range(LARGE_PX):
                ink = glyph[row * 6 + col // 8] & (0x80 >> (col % 8))
                self.pixel(x + col, y + row, black if ink else not black)

    def text_utf8(self, x, y, s, black=True):
        cur = x
        for ch in s:
            if ch == "\n":
                continue
            if ord(ch) < 0x80:
                self.text5x7(cur, y, ch, 3, black)
                cur += 18
            else:
                self.cjk(cur, y, ch, black)
                cur += 25
        return cur

    def text_width(self, s):
        return sum(18 if ord(ch) < 0x80 else 25 for ch in s if ch != "\n")

    def text_clipped(self, x, y, s, max_w, black=True):
        cur = x
        for ch in s:
            w = 18 if ord(ch) < 0x80 else 25
            if cur + w > x + max_w:
                break
            if ord(ch) < 0x80:
                self.text5x7(cur, y, ch, 3, black)
            else:
                self.cjk(cur, y, ch, black)
            cur += w
        return cur

    def centered(self, y, s, black=True):
        self.text_utf8((W - self.text_width(s)) // 2, y, s, black)

    def save(self, name):
        img = Image.new("L", (W, H), 255)
        px = img.load()
        for y in range(H):
            for x in range(W):
                if self.p[y][x]:
                    px[x, y] = 0
        img.save(ROOT / "tools" / name)
        print(f"tools/{name}")


WEEK_SHORT = "日一二三四五六"
WEEK_FULL = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
EVENTS = [
    (dt.date(2026, 11, 9), "09:00", "10:30", "项目评审", "会议室 A"),
    (dt.date(2026, 11, 9), "13:00", "14:00", "牙医复诊", ""),
    (dt.date(2026, 11, 9), "19:30", "20:30", "英语听力", "第 4 单元"),
    (dt.date(2026, 11, 10), "10:00", "11:00", "家长会", "学校礼堂"),
    (dt.date(2026, 11, 11), "15:00", "16:00", "周会", ""),
    (dt.date(2026, 11, 12), "08:30", "09:00", "吃药", ""),
]


def ble_icon(s, x, y, available=True, connected=True):
    cx, right = x + 7, x + 13
    top, bottom = y, y + 21
    q1, mid, q3 = y + 5, y + 11, y + 16
    t = 3 if (available and connected) else 2
    for x0, y0, x1, y1 in ((cx, top, cx, bottom), (cx, top, right, q1),
                           (right, q1, cx, mid), (cx, mid, right, q3),
                           (right, q3, cx, bottom),
                           (cx, mid, x + 1, q1 - 1), (cx, mid, x + 1, q3 + 1)):
        s.line(x0, y0, x1, y1, t)
    if not available:
        s.line(x, y + 2, x + 13, y + 19, 2)


def header(s, clock="15:57", battery="78%", connected=True, available=True):
    ble_icon(s, 12, 10, available, connected)
    s.text5x7(34, 14, battery, 2)
    s.text5x7(W - 12 - s.text5x7_width(clock, 3), 10, clock, 3)
    s.hline(12, 40, W - 24)


def footer(s, back, left_right, confirm):
    s.hline(12, 744, W - 24)
    s.text_utf8(12, 750, back)
    lw = s.text_width(left_right)
    s.text_utf8((W - lw) // 2, 750, left_right)
    cw = s.text_width(confirm)
    s.text_utf8(W - 12 - cw, 750, confirm)


def peek_card(s, day, events, first_day, rows):
    x, w = 16, W - 32
    cell_h = 110 if rows == 5 else 96
    shown = min(len(events), 5)
    h = 54 + shown * 30
    row = max(0, min((day - first_day).days // 7, rows - 1))
    cell_top = 116 + row * cell_h
    y = cell_top + cell_h + 6
    if y + h > 738:
        y = max(116, cell_top - h - 6)
    s.fill_rect(x, y, w, h, False)
    s.rect(x, y, w, h)
    s.rect(x + 3, y + 3, w - 6, h - 6)
    weekday = WEEK_FULL[(day.weekday() + 1) % 7]
    s.text_utf8(x + 12, y + 8, f"{day.month}月{day.day}日 {weekday}")
    total = f"{len(events)} 条"
    s.text_utf8(x + w - 12 - s.text_width(total), y + 8, total)
    s.hline(x + 12, y + 38, w - 24)
    for i, (_when, start, _end, title, _note) in enumerate(events[:shown]):
        ey = y + 44 + i * 30
        s.text5x7(x + 12, ey, start, 3)
        s.text_clipped(x + 112, ey, title or "(无标题)", w - 112 - 12)


def month_preview():
    s = Screen()
    header(s)
    title_y, weekday_y, grid_y = 52, 86, 116
    grid_x, cell_w, cell_h = 30, 60, 110
    s.text_utf8(grid_x, title_y, "2026年11月")
    count = "12 条日程"
    s.text_utf8(W - grid_x - s.text_width(count), title_y, count)
    for i, ch in enumerate(WEEK_SHORT):
        s.text_utf8(grid_x + i * cell_w + (cell_w - 25) // 2, weekday_y, ch)

    first = dt.date(2026, 11, 1)
    grid_start = first - dt.timedelta(days=(first.weekday() + 1) % 7)
    counts = {}
    for when, *_rest in EVENTS:
        counts[when] = counts.get(when, 0) + 1

    for row in range(1, 5):
        s.hline(grid_x, grid_y + row * cell_h, cell_w * 7)
    for col in range(1, 7):
        s.vline(grid_x + col * cell_w, grid_y, 5 * cell_h)

    for row in range(5):
        for col in range(7):
            day = grid_start + dt.timedelta(days=row * 7 + col)
            x = grid_x + col * cell_w
            y = grid_y + row * cell_h
            selected = day == dt.date(2026, 11, 9)
            today = day == dt.date(2026, 11, 9)
            if selected:
                s.fill_rect(x, y, cell_w - 1, cell_h - 1)
            elif today:
                s.rect(x + 1, y + 1, cell_w - 3, cell_h - 3)
                s.rect(x + 2, y + 2, cell_w - 5, cell_h - 5)
            if day.month != 11:
                continue
            s.text5x7(x + 6, y + 8, str(day.day), 3, not selected)
            if selected and today:
                s.rect(x + 3, y + 3, cell_w - 7, cell_h - 7, False)
            for d in range(min(counts.get(day, 0), 4)):
                s.fill_rect(x + 6 + d * 7, y + cell_h - 15, 4, 4, not selected)
    selected_day = dt.date(2026, 11, 9)
    day_events = [ev for ev in EVENTS if ev[0] == selected_day]
    if day_events:
        peek_card(s, selected_day, day_events, grid_start, 5)
    footer(s, "返回:今天", "左右:换天", "确认:查看")
    s.save("preview_month.png")


def day_preview():
    s = Screen()
    header(s)
    s.text_utf8(12, 52, "11月9日")
    s.text_utf8(12 + s.text_width("11月9日") + 12, 52, "星期一")
    s.hline(12, 88, W - 24)
    s.text_utf8(12, 96, "3 条日程")
    events = [e for e in EVENTS if e[0] == dt.date(2026, 11, 9)]
    for i, (_, start, end, title, note) in enumerate(events):
        y = 128 + i * 64
        selected = i == 1
        if selected:
            s.fill_rect(12, y, W - 24, 60)
        s.text5x7(20, y + 4, start, 3, not selected)
        s.text5x7(20, y + 33, end, 2, not selected)
        s.text_clipped(120, y + 4, title, W - 120 - 12, not selected)
        if note:
            s.text_clipped(120, y + 33, note, W - 120 - 12, not selected)
        if not selected:
            s.hline(12, y + 63, W - 24)
    footer(s, "返回:月历", "左右:换天", "确认:详情")
    s.save("preview_day.png")


def detail_preview(confirm=False):
    s = Screen()
    header(s)
    s.text_utf8(12, 52, "项目评审")
    meta_y = 52 + 32 + 8
    s.text_utf8(12, meta_y, "2026年11月9日  09:00-10:30")
    line_y = meta_y + 34
    s.hline(12, line_y, W - 24)
    s.text_utf8(12, line_y + 8, "备注")
    s.text_utf8(12, line_y + 40, "会议室 A，带上上周的测试报告。")
    s.hline(12, 720, W - 24)
    s.text_utf8(12, 738, "返回:列表")
    delete = "确认:删除"
    dw = s.text_width(delete) + 24
    s.fill_rect(W - 12 - dw, 730, dw, 40)
    s.text_utf8(W - 12 - dw + 12, 738, delete, False)
    if confirm:
        x, y, w, h = 50, 250, 380, 300
        s.fill_rect(x, y, w, h, False)
        s.rect(x, y, w, h)
        s.rect(x + 3, y + 3, w - 6, h - 6)
        s.fill_rect(x + 6, y + 6, w - 12, 44)
        s.text_utf8(x + 20, y + 16, "删除日程", False)
        s.text_clipped(x + 20, y + 68, "项目评审", w - 40)
        s.text_utf8(x + 20, y + 120, "确定要删除这个日程吗?")
        s.text_utf8(x + 20, y + 184, "再次按确认删除")
        s.text_utf8(x + 20, y + 224, "按返回取消")
    s.save("preview_delete.png" if confirm else "preview_detail.png")


def sleep_preview():
    s = Screen()
    for i, ch in enumerate("休眠中"):
        s.large(30 + i * 50, 30, ch)
    s.text5x7(W - 30 - s.text5x7_width("15:57", 4), 30, "15:57", 4)
    s.text5x7(W - 30 - s.text5x7_width("11/09", 3), 72, "11/09", 3)
    s.hline(30, 118, W - 60)
    s.text_utf8(30, 132, "接下来的日程")
    upcoming = EVENTS[:5]
    for i, (when, start, _end, title, note) in enumerate(upcoming):
        y = 172 + i * 96
        s.text5x7(30, y + 12, f"{when.month:02d}/{when.day:02d}", 2)
        s.text5x7(30, y + 34, start, 3)
        s.text_clipped(130, y + 10, title, W - 130 - 24)
        if note:
            s.text_clipped(130, y + 42, note, W - 130 - 24)
        s.hline(30, y + 84, W - 60)
    s.hline(30, 744, W - 60)
    s.centered(750, "按 POWER 唤醒  蓝牙日历")
    s.save("preview_sleep.png")


def main():
    month_preview()
    day_preview()
    detail_preview(False)
    detail_preview(True)
    sleep_preview()


if __name__ == "__main__":
    main()
