#!/usr/bin/env python3
"""Offline previews of the portrait single-calendar UI.

The layout mirrors main/calendar_ui.c (480x800 logical canvas, rotated by gfx.c
onto the 800x480 panel). It reads the real font5x7 table and embedded GB2312
font blob, so missing glyphs and overflow show up here. The C file and this
script share the same spacing constants: 30 px margins, 24 px body text, and a
footer baseline at y=752.

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

# Layout system, kept in sync with main/calendar_ui.c.
MARGIN = 30
CONTENT_W = W - 2 * MARGIN
BODY_H = 24
GAP_S = 8
GAP_M = 12
GAP_L = 16
HEADER_TEXT_Y = 14
HEADER_RULE_Y = 52
TITLE_Y = 68
FOOTER_TEXT_Y = H - 24 - BODY_H
FOOTER_RULE_Y = FOOTER_TEXT_Y - GAP_L
CONTENT_BOTTOM = FOOTER_RULE_Y - GAP_L
LIST_TIME_W = 5 * 18
MONTH_GRID_Y = 140
MONTH_GRID_H = 420
MONTH_CELL_W = 60
PEEK_CARD_Y = MONTH_GRID_Y + MONTH_GRID_H + GAP_M
PEEK_CARD_ROWS = 3


def month_cell_h(rows):
    return 84 if rows == 5 else 70


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

    def dither_rect(self, x, y, w, h, level):
        bayer = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))
        for row in range(h):
            for col in range(w):
                self.pixel(x + col, y + row, bayer[(y + row) & 3][(x + col) & 3] < level)

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

    def text_right(self, y, s, black=True):
        self.text_utf8(W - MARGIN - self.text_width(s), y, s, black)

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


def fill_round_rect(s, x, y, w, h, r=3):
    s.fill_rect(x, y, w, h)
    for i in range(r):
        cut = r - i - 1
        s.hline(x, y + i, cut, False)
        s.hline(x + w - cut, y + i, cut, False)
        s.hline(x, y + h - 1 - i, cut, False)
        s.hline(x + w - cut, y + h - 1 - i, cut, False)


def ble_icon(s, x, y, available=True, connected=True):
    inverted = available and connected
    if inverted:
        fill_round_rect(s, x - 2, y - 3, 18, 28)
    ink = not inverted
    cx, right = x + 7, x + 13
    top, bottom = y, y + 21
    q1, mid, q3 = y + 5, y + 11, y + 16
    for x0, y0, x1, y1 in ((cx, top, cx, bottom), (cx, top, right, q1),
                           (right, q1, cx, mid), (cx, mid, right, q3),
                           (right, q3, cx, bottom),
                           (cx, mid, x + 1, q1 - 1), (cx, mid, x + 1, q3 + 1)):
        s.line(x0, y0, x1, y1, 2, ink)
    if not available:
        for j in range(24):
            for i in range(16):
                if (i + j) % 2 == 0:
                    s.pixel(x - 1 + i, y - 1 + j, False)


def ble_warning(s, x, y):
    s.fill_rect(x, y, 4, 12)
    s.fill_rect(x, y + 16, 4, 4)
    for j in range(22):
        for i in range(6):
            if (i + j) % 2 == 0:
                s.pixel(x - 1 + i, y - 1 + j, False)


def header(s, clock="15:57", battery="78%", connected=True, available=True):
    icon_x = MARGIN
    if not available:
        ble_warning(s, MARGIN, HEADER_TEXT_Y + 1)
        icon_x = MARGIN + GAP_S
    ble_icon(s, icon_x, HEADER_TEXT_Y, available, connected)
    s.text5x7(icon_x + 26, HEADER_TEXT_Y, battery, 3)
    s.text5x7(W - MARGIN - s.text5x7_width(clock, 3), HEADER_TEXT_Y, clock, 3)
    s.hline(MARGIN, HEADER_RULE_Y, CONTENT_W)


def footer(s, back, left_right, confirm):
    s.hline(MARGIN, FOOTER_RULE_Y, CONTENT_W)
    s.text_utf8(MARGIN, FOOTER_TEXT_Y, back)
    lw = s.text_width(left_right)
    s.text_utf8((W - lw) // 2, FOOTER_TEXT_Y, left_right)
    cw = s.text_width(confirm)
    s.text_utf8(W - MARGIN - cw, FOOTER_TEXT_Y, confirm)


def peek_card(s, day, events):
    x, w = MARGIN, CONTENT_W
    shown = min(len(events), PEEK_CARD_ROWS)
    h = 58 + max(shown, 1) * 30
    y = PEEK_CARD_Y
    s.fill_rect(x, y, w, h, False)
    s.rect(x, y, w, h)
    s.rect(x + 3, y + 3, w - 6, h - 6)
    weekday = WEEK_FULL[(day.weekday() + 1) % 7]
    s.text_utf8(x + GAP_L, y + GAP_M, f"{day.month}月{day.day}日 {weekday}")
    if events:
        total = f"{len(events)} 条"
        s.text_utf8(x + w - GAP_L - s.text_width(total), y + GAP_M, total)
    s.hline(x + GAP_L, y + 44, w - 2 * GAP_L)
    if not shown:
        s.text_utf8(x + GAP_L, y + 52, "这天没有日程")
        return
    for i, (_when, start, _end, title, _note) in enumerate(events[:shown]):
        ey = y + 52 + i * 30
        s.text5x7(x + GAP_L, ey, start, 3)
        s.text_clipped(x + GAP_L + LIST_TIME_W + GAP_M, ey, title or "(无标题)",
                       w - (GAP_L + LIST_TIME_W + GAP_M) - GAP_L)


def month_preview():
    s = Screen()
    header(s)
    grid_x, cell_w, rows = MARGIN, MONTH_CELL_W, 5
    cell_h = month_cell_h(rows)
    s.text_utf8(MARGIN, TITLE_Y, "2026年11月")
    count = f"{len(EVENTS)} 条"
    s.text_right(TITLE_Y, count)
    weekday_y = TITLE_Y + BODY_H + GAP_L
    for i, ch in enumerate(WEEK_SHORT):
        s.text_utf8(grid_x + i * cell_w + (cell_w - 25) // 2, weekday_y, ch)

    first = dt.date(2026, 11, 1)
    grid_start = first - dt.timedelta(days=(first.weekday() + 1) % 7)
    counts = {}
    for when, *_rest in EVENTS:
        counts[when] = counts.get(when, 0) + 1

    for row in range(rows):
        s.dither_rect(grid_x, MONTH_GRID_Y + row * cell_h, cell_w - 1, cell_h - 1, 1)
        s.dither_rect(grid_x + 6 * cell_w, MONTH_GRID_Y + row * cell_h, cell_w - 1,
                      cell_h - 1, 1)

    for row in range(1, rows):
        s.hline(grid_x, MONTH_GRID_Y + row * cell_h, CONTENT_W)
    for col in range(1, 7):
        s.vline(grid_x + col * cell_w, MONTH_GRID_Y, rows * cell_h)

    for row in range(rows):
        for col in range(7):
            day = grid_start + dt.timedelta(days=row * 7 + col)
            x = grid_x + col * cell_w
            y = MONTH_GRID_Y + row * cell_h
            selected = day == dt.date(2026, 11, 9)
            today = day == dt.date(2026, 11, 9)
            if selected:
                s.fill_rect(x, y, cell_w - 1, cell_h - 1)
            elif today:
                s.rect(x + 2, y + 2, cell_w - 4, cell_h - 4)
                s.rect(x + 4, y + 4, cell_w - 8, cell_h - 8)
            if day.month != 11:
                continue
            s.text5x7(x + GAP_S, y + GAP_S, str(day.day), 3, not selected)
            if selected and today:
                s.rect(x + 6, y + 6, cell_w - 12, cell_h - 12, False)
            for d in range(min(counts.get(day, 0), 4)):
                s.fill_rect(x + GAP_S + d * 8, y + cell_h - 16, 4, 4, not selected)
    selected_day = dt.date(2026, 11, 9)
    day_events = [ev for ev in EVENTS if ev[0] == selected_day]
    peek_card(s, selected_day, day_events)
    footer(s, "返回:今天", "左右:换天", "确认:查看")
    s.save("preview_month.png")


def day_preview():
    s = Screen()
    header(s)
    s.text_utf8(MARGIN, TITLE_Y, "11月9日")
    s.text_utf8(MARGIN + s.text_width("11月9日") + GAP_M, TITLE_Y, "星期一")
    events = [e for e in EVENTS if e[0] == dt.date(2026, 11, 9)]
    s.text_right(TITLE_Y, f"{len(events)} 条")
    s.hline(MARGIN, TITLE_Y + BODY_H + GAP_M, CONTENT_W)

    list_y = TITLE_Y + BODY_H + GAP_M + GAP_L
    row_h = 72
    text_x = MARGIN + LIST_TIME_W + GAP_M
    for i, (_, start, end, title, note) in enumerate(events):
        y = list_y + i * row_h
        selected = i == 1
        if selected:
            s.fill_rect(MARGIN, y, CONTENT_W, row_h)
        s.text5x7(MARGIN, y + GAP_S, start, 3, not selected)
        s.text5x7(MARGIN, y + GAP_S + 32, end, 3, not selected)
        s.text_clipped(text_x, y + GAP_S, title, W - text_x - MARGIN, not selected)
        if note:
            s.text_clipped(text_x, y + GAP_S + 32, note, W - text_x - MARGIN, not selected)
        if not selected and i < len(events) - 1:
            s.hline(MARGIN, y + row_h - 1, CONTENT_W)
    footer(s, "返回:月历", "左右:换天", "确认:详情")
    s.save("preview_day.png")


def detail_preview(confirm=False):
    s = Screen()
    header(s)
    s.text_utf8(MARGIN, TITLE_Y, "项目评审")
    meta_y = TITLE_Y + 32 + GAP_S
    s.text_utf8(MARGIN, meta_y, "2026年11月9日")
    s.text_utf8(MARGIN + s.text_width("2026年11月9日") + GAP_M, meta_y, "星期一")
    s.text_utf8(MARGIN, meta_y + 32, "09:00-10:30")
    line_y = meta_y + 32 + BODY_H + GAP_M
    s.hline(MARGIN, line_y, CONTENT_W)
    s.text_utf8(MARGIN, line_y + GAP_L, "备注")
    s.text_utf8(MARGIN, line_y + GAP_L + BODY_H + GAP_M, "会议室 A，带上上周的测试报告。")
    s.hline(MARGIN, FOOTER_RULE_Y, CONTENT_W)
    s.text_utf8(MARGIN, FOOTER_TEXT_Y, "返回:列表")
    delete = "确认:删除"
    dw = s.text_width(delete) + 2 * GAP_L
    chip_x = W - MARGIN - dw
    fill_round_rect(s, chip_x, FOOTER_TEXT_Y - 6, dw, 30)
    s.text_utf8(chip_x + GAP_L, FOOTER_TEXT_Y, delete, False)
    if confirm:
        box_w, box_h = CONTENT_W, 196
        box_x = MARGIN
        box_y = (HEADER_RULE_Y + CONTENT_BOTTOM - box_h) // 2
        s.fill_rect(box_x, box_y, box_w, box_h, False)
        s.rect(box_x, box_y, box_w, box_h)
        s.rect(box_x + 3, box_y + 3, box_w - 6, box_h - 6)
        s.fill_rect(box_x + 3, box_y + 3, box_w - 6, 44)
        s.text_utf8(box_x + GAP_L, box_y + 12, "删除日程", False)
        s.text_clipped(box_x + GAP_L, box_y + 64, "项目评审", box_w - 2 * GAP_L)
        s.text_utf8(box_x + GAP_L, box_y + 104, "确定要删除这个日程吗?")
        s.text_utf8(box_x + GAP_L, box_y + 148, "再次按确认删除  返回取消")
    s.save("preview_delete.png" if confirm else "preview_detail.png")


def sleep_preview():
    s = Screen()
    for i, ch in enumerate("休眠中"):
        s.large(MARGIN + i * 50, 30, ch)
    s.text5x7(W - MARGIN - s.text5x7_width("15:57", 4), 30, "15:57", 4)
    s.text5x7(W - MARGIN - s.text5x7_width("11/09", 3), 70, "11/09", 3)
    s.hline(MARGIN, 114, CONTENT_W)
    s.text_utf8(MARGIN, 128, "接下来的日程")
    upcoming = EVENTS[:5]
    for i, (when, start, _end, title, note) in enumerate(upcoming):
        y = 168 + i * 104
        s.text5x7(MARGIN, y + GAP_L, f"{when.month:02d}/{when.day:02d}", 3)
        s.text5x7(MARGIN, y + 48, start, 3)
        s.text_clipped(MARGIN + LIST_TIME_W + GAP_M, y + GAP_L, title,
                       W - MARGIN - LIST_TIME_W - GAP_M - MARGIN)
        if note:
            s.text_clipped(MARGIN + LIST_TIME_W + GAP_M, y + 48, note,
                           W - MARGIN - LIST_TIME_W - GAP_M - MARGIN)
        if i < len(upcoming) - 1:
            s.hline(MARGIN, y + 103, CONTENT_W)
    s.hline(MARGIN, FOOTER_RULE_Y, CONTENT_W)
    s.centered(FOOTER_TEXT_Y, "按 POWER 唤醒  蓝牙日历")
    s.save("preview_sleep.png")


def main():
    month_preview()
    day_preview()
    detail_preview(False)
    detail_preview(True)
    sleep_preview()


if __name__ == "__main__":
    main()
