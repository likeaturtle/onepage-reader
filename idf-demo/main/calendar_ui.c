#include "calendar_ui.h"

#include <stdio.h>
#include <string.h>
#include <time.h>

#include "gfx.h"
#include "onepage_pins.h"

#define UI_W ONEPAGE_UI_WIDTH
#define UI_H ONEPAGE_UI_HEIGHT
#define MARGIN 12
#define HEADER_LINE_Y 40
#define MONTH_GRID_X 30
#define MONTH_GRID_Y 116
#define MONTH_CELL_W 60
/* Bayer level (0..16) for the Saturday/Sunday cell shading. */
#define WEEKEND_SHADE 1
#define FOOTER_LINE_Y 744
#define FOOTER_TEXT_Y 750

static const char *const kWeekdayShort[7] = {"日", "一", "二", "三", "四", "五", "六"};
static const char *const kWeekdayFull[7] = {"星期日", "星期一", "星期二", "星期三",
                                            "星期四", "星期五", "星期六"};

/* --- formatting helpers ------------------------------------------------- */

static void format_clock(const ui_status_t *status, char *out, size_t len) {
  if (!status->time_valid || status->local_epoch == 0) {
    snprintf(out, len, "--:--");
    return;
  }
  const time_t t = (time_t)status->local_epoch;
  struct tm tm = {0};
  if (!gmtime_r(&t, &tm)) {
    snprintf(out, len, "--:--");
    return;
  }
  snprintf(out, len, "%02d:%02d", tm.tm_hour, tm.tm_min);
}

static void format_day_label(uint16_t day, bool with_year, char *out, size_t len) {
  if (day == 0) {
    snprintf(out, len, "--月--日");
    return;
  }
  int y = 1970, m = 1, d = 1;
  calendar_civil_from_days(day, &y, &m, &d);
  if (with_year) {
    snprintf(out, len, "%d年%d月%d日", y, m, d);
  } else {
    snprintf(out, len, "%d月%d日", m, d);
  }
}

static void format_day_ascii(uint16_t day, char *out, size_t len) {
  if (day == 0) {
    snprintf(out, len, "--/--");
    return;
  }
  int y = 1970, m = 1, d = 1;
  calendar_civil_from_days(day, &y, &m, &d);
  snprintf(out, len, "%02d/%02d", m, d);
}

static void format_hhmm(uint16_t minutes, char *out, size_t len) {
  snprintf(out, len, "%02u:%02u", (unsigned)(minutes / 60), (unsigned)(minutes % 60));
}

static void draw_centered(uint8_t *fb, int y, const char *text, bool black) {
  const int width = gfx_text_utf8_width(text);
  gfx_text_utf8(fb, (UI_W - width) / 2, y, text, black);
}

/* --- shared chrome ------------------------------------------------------ */

/* Rounded-corner fill; the badge behind the connected BLE glyph uses a small
 * radius so it reads as a soft chip instead of a hard rectangle. */
static void fill_round_rect(uint8_t *fb, int x, int y, int w, int h, bool black) {
  const int r = 3;
  gfx_fill_rect(fb, x, y, w, h, black);
  for (int i = 0; i < r; i++) {
    const int cut = r - i - 1;
    gfx_hline(fb, x, y + i, cut, !black);
    gfx_hline(fb, x + w - cut, y + i, cut, !black);
    gfx_hline(fb, x, y + h - 1 - i, cut, !black);
    gfx_hline(fb, x + w - cut, y + h - 1 - i, cut, !black);
  }
}

/* Bluetooth glyph for the header: plain outline while advertising, white on a
 * black rounded badge while a phone is connected, and a 50% dither (the only
 * "gray" a 1-bit panel can show) when the radio failed to start. It replaces
 * the old text label so the top bar carries no status text. */
static void draw_ble_icon(uint8_t *fb, int x, int y, bool available, bool connected) {
  const bool inverted = available && connected;
  if (inverted) {
    fill_round_rect(fb, x - 2, y - 3, 18, 28, true);
  }
  const bool ink = !inverted;
  const int cx = x + 7;
  const int right = x + 13;
  const int top = y;
  const int bottom = y + 21;
  const int q1 = y + 5;
  const int mid = y + 11;
  const int q3 = y + 16;

  gfx_line(fb, cx, top, cx, bottom, 2, ink);
  gfx_line(fb, cx, top, right, q1, 2, ink);
  gfx_line(fb, right, q1, cx, mid, 2, ink);
  gfx_line(fb, cx, mid, right, q3, 2, ink);
  gfx_line(fb, right, q3, cx, bottom, 2, ink);
  /* Left half of the bind-rune cross. */
  gfx_line(fb, cx, mid, x + 1, q1 - 1, 2, ink);
  gfx_line(fb, cx, mid, x + 1, q3 + 1, 2, ink);

  if (!available) {
    for (int j = 0; j < 24; j++) {
      for (int i = 0; i < 16; i++) {
        if (((i + j) & 1) == 0) {
          gfx_pixel(fb, x - 1 + i, y - 1 + j, false);
        }
      }
    }
  }
}

/* Dithered "!" shown to the left of the BLE glyph when the radio failed. The
 * 50% checkerboard makes it gray like the icon, so it reads as a warning
 * rather than a second status symbol. */
static void draw_ble_warning(uint8_t *fb, int x, int y) {
  gfx_fill_rect(fb, x, y, 4, 12, true);
  gfx_fill_rect(fb, x, y + 16, 4, 4, true);
  for (int j = 0; j < 22; j++) {
    for (int i = 0; i < 6; i++) {
      if (((i + j) & 1) == 0) {
        gfx_pixel(fb, x - 1 + i, y - 1 + j, false);
      }
    }
  }
}

static void draw_header(uint8_t *fb, const ui_status_t *status) {
  /* Left: radio state icon + battery percentage. A failed radio gets a gray
   * "!" in front of the icon, which shifts the rest of the group right a bit. */
  int icon_x = MARGIN;
  if (!status->ble_available) {
    draw_ble_warning(fb, MARGIN, 11);
    icon_x = MARGIN + 8;
  }
  draw_ble_icon(fb, icon_x, 10, status->ble_available, status->ble_connected);

  char battery[8];
  if (status->battery_valid) {
    snprintf(battery, sizeof(battery), "%u%%", (unsigned)status->battery_pct);
  } else {
    snprintf(battery, sizeof(battery), "--%%");
  }
  gfx_text(fb, icon_x + 22, 14, battery, 2, true);

  /* Right: clock. */
  char clock[8];
  format_clock(status, clock, sizeof(clock));
  const int clock_w = gfx_text_width(clock, 3);
  gfx_text(fb, UI_W - MARGIN - clock_w, 10, clock, 3, true);

  gfx_hline(fb, MARGIN, HEADER_LINE_Y, UI_W - 2 * MARGIN, true);
}

/* One line of key hints laid out like the front panel: BACK on the left, the
 * LEFT/RIGHT pair in the middle, CONFIRM on the right. */
static void draw_footer(uint8_t *fb, const char *back, const char *left_right,
                        const char *confirm) {
  gfx_hline(fb, MARGIN, FOOTER_LINE_Y, UI_W - 2 * MARGIN, true);
  if (back && back[0]) {
    gfx_text_utf8(fb, MARGIN, FOOTER_TEXT_Y, back, true);
  }
  if (left_right && left_right[0]) {
    const int w = gfx_text_utf8_width(left_right);
    gfx_text_utf8(fb, (UI_W - w) / 2, FOOTER_TEXT_Y, left_right, true);
  }
  if (confirm && confirm[0]) {
    const int w = gfx_text_utf8_width(confirm);
    gfx_text_utf8(fb, UI_W - MARGIN - w, FOOTER_TEXT_Y, confirm, true);
  }
}

/* --- month view --------------------------------------------------------- */

/* Floating preview of the selected day, shown next to its cell: below it when
 * the lower half of the grid has room, otherwise above it. The opaque white
 * body hides whatever grid lines sit underneath. */
static void draw_peek_card(uint8_t *fb, const ui_month_t *view) {
  const int x = 16;
  const int w = UI_W - 2 * x;
  const int rows = (view->grid_rows < 5 || view->grid_rows > 6) ? 6 : view->grid_rows;
  const int cell_h = rows == 5 ? 110 : 96;
  const int shown = view->peek_shown > 5 ? 5 : view->peek_shown;
  const int h = 54 + shown * 30;

  int row = ((int)view->selected_day - (int)view->first_day) / 7;
  if (row < 0) {
    row = 0;
  }
  if (row >= rows) {
    row = rows - 1;
  }
  const int cell_top = MONTH_GRID_Y + row * cell_h;

  int y = cell_top + cell_h + 6;
  if (y + h > 738) {
    /* Not enough room below: float above the selected cell instead. */
    y = cell_top - h - 6;
    if (y < MONTH_GRID_Y) {
      y = MONTH_GRID_Y;
    }
  }

  gfx_fill_rect(fb, x, y, w, h, false);
  gfx_rect(fb, x, y, w, h, true);
  gfx_rect(fb, x + 3, y + 3, w - 6, h - 6, true);

  int cy = 1970, cm = 1, cd = 1;
  calendar_civil_from_days(view->selected_day, &cy, &cm, &cd);
  char title[48];
  snprintf(title, sizeof(title), "%d月%d日 %s", cm, cd,
           kWeekdayFull[calendar_weekday(view->selected_day)]);
  gfx_text_utf8(fb, x + 12, y + 8, title, true);

  char total[16];
  snprintf(total, sizeof(total), "%d 条", view->peek_total);
  gfx_text_utf8(fb, x + w - 12 - gfx_text_utf8_width(total), y + 8, total, true);

  gfx_hline(fb, x + 12, y + 38, w - 24, true);

  for (int i = 0; i < shown; i++) {
    const cal_event_t *event = &view->peek_events[i];
    const int ey = y + 44 + i * 30;
    char start[6];
    format_hhmm(event->start_min, start, sizeof(start));
    gfx_text(fb, x + 12, ey, start, 3, true);
    gfx_text_utf8_clipped(fb, x + 112, ey, event->title[0] ? event->title : "(无标题)",
                          w - 112 - 12, true);
  }
}

void ui_draw_month(uint8_t *fb, const ui_month_t *view) {
  gfx_clear(fb, true);
  draw_header(fb, &view->status);

  const int title_y = 52;
  const int weekday_y = 86;
  const int grid_y = MONTH_GRID_Y;
  const int grid_x = MONTH_GRID_X;
  const int cell_w = MONTH_CELL_W;
  int rows = view->grid_rows;
  if (rows < 5 || rows > 6) {
    rows = 6;
  }
  const int cell_h = rows == 5 ? 110 : 96;

  char title[32];
  snprintf(title, sizeof(title), "%d年%d月", view->year, view->month);
  gfx_text_utf8(fb, grid_x, title_y, title, true);

  char count[48];
  snprintf(count, sizeof(count), "%d 条日程", view->month_event_count);
  const int count_w = gfx_text_utf8_width(count);
  gfx_text_utf8(fb, UI_W - grid_x - count_w, title_y, count, true);

  for (int i = 0; i < 7; i++) {
    const int w = gfx_text_utf8_width(kWeekdayShort[i]);
    gfx_text_utf8(fb, grid_x + i * cell_w + (cell_w - w) / 2, weekday_y, kWeekdayShort[i],
                  true);
  }

  /* Weekend columns get a light dither so they read apart from weekdays. It is
   * painted before the grid lines, the selected-cell fill, the date numbers and
   * the event dots, so none of those lose contrast. */
  for (int row = 0; row < rows; row++) {
    gfx_dither_rect(fb, grid_x, grid_y + row * cell_h, cell_w - 1, cell_h - 1,
                    WEEKEND_SHADE);
    gfx_dither_rect(fb, grid_x + 6 * cell_w, grid_y + row * cell_h, cell_w - 1,
                    cell_h - 1, WEEKEND_SHADE);
  }

  for (int row = 1; row < rows; row++) {
    gfx_hline(fb, grid_x, grid_y + row * cell_h, cell_w * 7, true);
  }
  for (int col = 1; col < 7; col++) {
    gfx_vline(fb, grid_x + col * cell_w, grid_y, rows * cell_h, true);
  }

  for (int row = 0; row < rows; row++) {
    for (int col = 0; col < 7; col++) {
      const int idx = row * 7 + col;
      const int x = grid_x + col * cell_w;
      const int y = grid_y + row * cell_h;
      const uint16_t day = (uint16_t)(view->first_day + idx);
      int cy = 1970, cm = 1, cd = 1;
      calendar_civil_from_days(day, &cy, &cm, &cd);
      const bool in_month = cy == view->year && cm == view->month;
      const bool selected = day == view->selected_day;
      const bool today = view->today != 0 && day == view->today;

      if (selected) {
        gfx_fill_rect(fb, x, y, cell_w - 1, cell_h - 1, true);
      } else if (today) {
        gfx_rect(fb, x + 1, y + 1, cell_w - 3, cell_h - 3, true);
        gfx_rect(fb, x + 2, y + 2, cell_w - 5, cell_h - 5, true);
      }

      if (!in_month) {
        continue;
      }

      char number[4];
      snprintf(number, sizeof(number), "%d", cd);
      gfx_text(fb, x + 6, y + 8, number, 3, !selected);

      if (selected && today) {
        gfx_rect(fb, x + 3, y + 3, cell_w - 7, cell_h - 7, false);
      }

      int dots = view->counts[idx];
      if (dots > 4) {
        dots = 4;
      }
      for (int d = 0; d < dots; d++) {
        gfx_fill_rect(fb, x + 6 + d * 7, y + cell_h - 15, 4, 4, !selected);
      }
    }
  }

  if (view->peek_total > 0 && view->peek_shown > 0 && view->peek_events) {
    draw_peek_card(fb, view);
  }

  draw_footer(fb, "返回:今天", "左右:换天", "确认:查看");
}

/* --- day view ----------------------------------------------------------- */

void ui_draw_day(uint8_t *fb, const ui_day_t *view) {
  gfx_clear(fb, true);
  draw_header(fb, &view->status);

  char date[24];
  format_day_label(view->day, false, date, sizeof(date));
  gfx_text_utf8(fb, MARGIN, 52, date, true);
  const int weekday = calendar_weekday(view->day);
  const int date_w = gfx_text_utf8_width(date);
  gfx_text_utf8(fb, MARGIN + date_w + 12, 52, kWeekdayFull[weekday], true);

  gfx_hline(fb, MARGIN, 88, UI_W - 2 * MARGIN, true);

  char count[48];
  if (view->count == 0) {
    snprintf(count, sizeof(count), "今天没有日程");
  } else {
    snprintf(count, sizeof(count), "%d 条日程", view->count);
  }
  gfx_text_utf8(fb, MARGIN, 96, count, true);

  if (view->count == 0) {
    draw_centered(fb, 260, "今天没有日程", true);
    draw_centered(fb, 300, "打开手机网页，通过蓝牙添加", true);
    draw_footer(fb, "返回:月历", "左右:换天", "确认:详情");
    return;
  }

  int first = 0;
  if (view->selected >= 8) {
    first = view->selected - 7;
  }
  int rows = view->count - first;
  if (rows > 8) {
    rows = 8;
  }

  for (int i = 0; i < rows; i++) {
    const int index = first + i;
    const cal_event_t *event = &view->events[index];
    const int y = 128 + i * 64;
    const bool selected = index == view->selected;

    if (selected) {
      gfx_fill_rect(fb, MARGIN, y, UI_W - 2 * MARGIN, 60, true);
    }

    char start[6];
    char end[6];
    format_hhmm(event->start_min, start, sizeof(start));
    format_hhmm(event->end_min, end, sizeof(end));
    gfx_text(fb, MARGIN + 8, y + 4, start, 3, !selected);
    gfx_text(fb, MARGIN + 8, y + 33, end, 2, !selected);

    gfx_text_utf8_clipped(fb, 120, y + 4, event->title[0] ? event->title : "(空)",
                          UI_W - 120 - MARGIN, !selected);
    if (event->note[0]) {
      gfx_text_utf8_clipped(fb, 120, y + 33, event->note, UI_W - 120 - MARGIN, !selected);
    }

    if (!selected) {
      gfx_hline(fb, MARGIN, y + 63, UI_W - 2 * MARGIN, true);
    }
  }

  if (view->count > 8) {
    char position[32];
    snprintf(position, sizeof(position), "%d-%d/%d", first + 1,
             first + rows < view->count ? first + rows : view->count, view->count);
    const int pw = gfx_text_width(position, 2);
    gfx_text(fb, UI_W - MARGIN - pw, 98, position, 2, true);
  }

  draw_footer(fb, "返回:月历", "左右:换天", "确认:详情");
}

/* --- detail view -------------------------------------------------------- */

void ui_draw_detail(uint8_t *fb, const ui_detail_t *view) {
  gfx_clear(fb, true);
  draw_header(fb, &view->status);

  const cal_event_t *event = view->event;
  const int title_lines =
      gfx_text_utf8_wrap(fb, MARGIN, 52, event->title[0] ? event->title : "(无标题)",
                         UI_W - 2 * MARGIN, 30, 3, true);
  const int meta_y = 52 + title_lines * 30 + 8;

  char meta[96];
  char date[24];
  char start[6];
  char end[6];
  format_day_label(event->day, true, date, sizeof(date));
  format_hhmm(event->start_min, start, sizeof(start));
  format_hhmm(event->end_min, end, sizeof(end));
  snprintf(meta, sizeof(meta), "%s  %s-%s", date, start, end);
  gfx_text_utf8_clipped(fb, MARGIN, meta_y, meta, UI_W - 2 * MARGIN, true);

  const int line_y = meta_y + 34;
  gfx_hline(fb, MARGIN, line_y, UI_W - 2 * MARGIN, true);
  gfx_text_utf8(fb, MARGIN, line_y + 8, "备注", true);
  if (event->note[0]) {
    gfx_text_utf8_wrap(fb, MARGIN, line_y + 40, event->note, UI_W - 2 * MARGIN, 28, 8,
                       true);
  } else {
    gfx_text_utf8(fb, MARGIN, line_y + 40, "无备注", true);
  }

  gfx_hline(fb, MARGIN, 720, UI_W - 2 * MARGIN, true);
  gfx_text_utf8(fb, MARGIN, 738, "返回:列表", true);
  const int delete_w = gfx_text_utf8_width("确认:删除") + 24;
  gfx_fill_rect(fb, UI_W - MARGIN - delete_w, 730, delete_w, 40, true);
  gfx_text_utf8(fb, UI_W - MARGIN - delete_w + 12, 738, "确认:删除", false);

  if (!view->confirm_delete) {
    return;
  }

  const int box_x = 50;
  const int box_y = 250;
  const int box_w = 380;
  const int box_h = 300;
  gfx_fill_rect(fb, box_x, box_y, box_w, box_h, false);
  gfx_rect(fb, box_x, box_y, box_w, box_h, true);
  gfx_rect(fb, box_x + 3, box_y + 3, box_w - 6, box_h - 6, true);
  gfx_fill_rect(fb, box_x + 6, box_y + 6, box_w - 12, 44, true);
  gfx_text_utf8(fb, box_x + 20, box_y + 16, "删除日程", false);

  gfx_text_utf8_clipped(fb, box_x + 20, box_y + 68, event->title, box_w - 40, true);
  gfx_text_utf8(fb, box_x + 20, box_y + 120, "确定要删除这个日程吗?", true);
  gfx_text_utf8(fb, box_x + 20, box_y + 184, "再次按确认删除", true);
  gfx_text_utf8(fb, box_x + 20, box_y + 224, "按返回取消", true);
}

/* --- sleep screen ------------------------------------------------------- */

void ui_draw_sleep(uint8_t *fb, const ui_sleep_t *view) {
  gfx_clear(fb, true);

  gfx_text_cjk_large(fb, 30, 30, "休眠中", 2, true);

  char clock[8];
  format_clock(&view->status, clock, sizeof(clock));
  const int clock_w = gfx_text_width(clock, 4);
  const int right = UI_W - 30;
  gfx_text(fb, right - clock_w, 30, clock, 4, true);

  char date[8];
  format_day_ascii(calendar_today(), date, sizeof(date));
  const int date_w = gfx_text_width(date, 3);
  gfx_text(fb, right - date_w, 72, date, 3, true);

  gfx_hline(fb, 30, 118, UI_W - 60, true);
  gfx_text_utf8(fb, 30, 132, "接下来的日程", true);

  if (view->count == 0) {
    draw_centered(fb, 300, "近期没有日程", true);
    draw_centered(fb, 340, "手机网页可通过蓝牙添加", true);
  } else {
    int max_rows = view->count > 5 ? 5 : view->count;
    for (int i = 0; i < max_rows; i++) {
      const cal_event_t *event = &view->events[i];
      const int y = 172 + i * 96;

      char day_text[8];
      char time_text[6];
      format_day_ascii(event->day, day_text, sizeof(day_text));
      format_hhmm(event->start_min, time_text, sizeof(time_text));
      gfx_text(fb, 30, y + 12, day_text, 2, true);
      gfx_text(fb, 30, y + 34, time_text, 3, true);

      gfx_text_utf8_clipped(fb, 130, y + 10, event->title, UI_W - 130 - 24, true);
      if (event->note[0]) {
        gfx_text_utf8_clipped(fb, 130, y + 42, event->note, UI_W - 130 - 24, true);
      }
      gfx_hline(fb, 30, y + 84, UI_W - 60, true);
    }
  }

  gfx_hline(fb, 30, FOOTER_LINE_Y, UI_W - 60, true);
  draw_centered(fb, FOOTER_TEXT_Y, "按 POWER 唤醒  蓝牙日历", true);
}

void ui_draw_toast(uint8_t *fb, const char *text) {
  if (!text || !text[0]) {
    return;
  }
  int width = gfx_text_utf8_width(text) + 32;
  if (width > 400) {
    width = 400;
  }
  const int x = (UI_W - width) / 2;
  const int y = 560;
  gfx_fill_rect(fb, x, y, width, 44, true);
  gfx_text_utf8_clipped(fb, x + 16, y + 10, text, width - 32, false);
}
