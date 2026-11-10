#include "calendar_ui.h"

#include <stdio.h>
#include <string.h>
#include <time.h>

#include "gfx.h"
#include "onepage_pins.h"

#define UI_W ONEPAGE_UI_WIDTH
#define UI_H ONEPAGE_UI_HEIGHT

/* --- layout system ------------------------------------------------------
 * One content column: 30 px side margins on the 480 px canvas, so every
 * screen shares the same left/right edges and the seven 60 px month columns
 * fill the width exactly (7 * 60 = 480 - 2 * 30).
 *
 * Type: one body size of 24 px (ASCII 5x7 at scale 3, CJK 24 px bitmap) for
 * every label, title, number and footer hint. Only the lock screen steps out
 * of it: 48 px headline and 32 px clock.
 *
 * Vertical rhythm: body line 24 px, gaps of 8 / 12 / 16 px, and a shared
 * footer baseline 24 px above the bottom edge. Content never enters the
 * band between CONTENT_BOTTOM and the footer rule. */
#define MARGIN 30
#define CONTENT_W (UI_W - 2 * MARGIN)
#define BODY_H 24
#define GAP_S 8
#define GAP_M 12
#define GAP_L 16

#define HEADER_TEXT_Y 14
#define HEADER_RULE_Y 52
#define TITLE_Y 68

#define FOOTER_TEXT_Y (UI_H - 24 - BODY_H)      /* 752 */
#define FOOTER_RULE_Y (FOOTER_TEXT_Y - GAP_L)   /* 736 */
#define CONTENT_BOTTOM (FOOTER_RULE_Y - GAP_L)  /* 720 */

/* "09:00" in the 5x7 font at scale 3 is 5 * 18 px wide. Every event row
 * (month card, day agenda, lock screen) puts its title 12 px after it. */
#define LIST_TIME_W (5 * 18)

#define MONTH_GRID_Y 140
#define MONTH_GRID_H 420 /* five 84 px rows or six 70 px rows, never both */
#define MONTH_CELL_W 60
/* The peek card is docked below the grid with the same 30 px edges, so the
 * whole month stays readable instead of being covered by a floating popup. */
#define PEEK_CARD_Y (MONTH_GRID_Y + MONTH_GRID_H + GAP_M)
#define PEEK_CARD_ROWS 3
/* Bayer level (0..16) for the Saturday/Sunday cell shading. */
#define WEEKEND_SHADE 1

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

static int month_cell_h(int rows) {
  /* The grid block keeps a constant height so the peek card below never
   * moves: 5 * 84 = 6 * 70 = MONTH_GRID_H. */
  return rows == 5 ? 84 : 70;
}

static void draw_centered(uint8_t *fb, int y, const char *text, bool black) {
  const int width = gfx_text_utf8_width(text);
  gfx_text_utf8(fb, (UI_W - width) / 2, y, text, black);
}

static void draw_right(uint8_t *fb, int y, const char *text, bool black) {
  gfx_text_utf8(fb, UI_W - MARGIN - gfx_text_utf8_width(text), y, text, black);
}

/* --- shared chrome ------------------------------------------------------ */

/* Rounded-corner fill shared by the BLE badge and the footer action chip;
 * radius 3 keeps the corner soft without eating the 1-bit edge. */
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

/* Top bar: BLE state and battery on the left, clock on the right. All three
 * share one 24 px cap height; only the icon is shorter. */
static void draw_header(uint8_t *fb, const ui_status_t *status) {
  int icon_x = MARGIN;
  if (!status->ble_available) {
    draw_ble_warning(fb, MARGIN, HEADER_TEXT_Y + 1);
    icon_x = MARGIN + GAP_S;
  }
  draw_ble_icon(fb, icon_x, HEADER_TEXT_Y, status->ble_available, status->ble_connected);

  char battery[8];
  if (status->battery_valid) {
    snprintf(battery, sizeof(battery), "%u%%", (unsigned)status->battery_pct);
  } else {
    snprintf(battery, sizeof(battery), "--%%");
  }
  gfx_text(fb, icon_x + 26, HEADER_TEXT_Y, battery, 3, true);

  /* Right: clock. */
  char clock[8];
  format_clock(status, clock, sizeof(clock));
  gfx_text(fb, UI_W - MARGIN - gfx_text_width(clock, 3), HEADER_TEXT_Y, clock, 3, true);

  gfx_hline(fb, MARGIN, HEADER_RULE_Y, CONTENT_W, true);
}

/* One line of key hints laid out like the front panel: BACK on the left, the
 * LEFT/RIGHT pair in the middle, CONFIRM on the right. Every view uses the
 * same rule position and baseline. */
static void draw_footer(uint8_t *fb, const char *back, const char *left_right,
                        const char *confirm) {
  gfx_hline(fb, MARGIN, FOOTER_RULE_Y, CONTENT_W, true);
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

/* Selected-day summary docked below the grid. It uses the content column, a
 * 3 px double border and the same 12 px header rule as the other panels, so
 * it reads as part of the page instead of covering two weeks of dates. Up to
 * three events are listed; CONFIRM opens the full day agenda. */
static void draw_peek_card(uint8_t *fb, const ui_month_t *view) {
  const int x = MARGIN;
  const int w = CONTENT_W;
  const int shown = view->peek_shown > PEEK_CARD_ROWS ? PEEK_CARD_ROWS : view->peek_shown;
  /* 12 px top pad + title + 44 px rule + 30 px per row + 12 px bottom pad.
   * An empty day still gets one body line ("这天没有日程") so the card keeps
   * its place and the page does not reflow when the selection moves. */
  const int h = 58 + (shown > 0 ? shown : 1) * 30;
  const int y = PEEK_CARD_Y;

  gfx_fill_rect(fb, x, y, w, h, false);
  gfx_rect(fb, x, y, w, h, true);
  gfx_rect(fb, x + 3, y + 3, w - 6, h - 6, true);

  int cy = 1970, cm = 1, cd = 1;
  calendar_civil_from_days(view->selected_day, &cy, &cm, &cd);
  char title[48];
  snprintf(title, sizeof(title), "%d月%d日 %s", cm, cd,
           kWeekdayFull[calendar_weekday(view->selected_day)]);
  gfx_text_utf8(fb, x + GAP_L, y + GAP_M, title, true);

  if (shown > 0) {
    char total[16];
    snprintf(total, sizeof(total), "%d 条", view->peek_total);
    draw_right(fb, y + GAP_M, total, true);
  }

  gfx_hline(fb, x + GAP_L, y + 44, w - 2 * GAP_L, true);

  if (shown == 0) {
    gfx_text_utf8(fb, x + GAP_L, y + 52, "这天没有日程", true);
    return;
  }
  for (int i = 0; i < shown; i++) {
    const cal_event_t *event = &view->peek_events[i];
    const int ey = y + 52 + i * 30;
    char start[6];
    format_hhmm(event->start_min, start, sizeof(start));
    gfx_text(fb, x + GAP_L, ey, start, 3, true);
    gfx_text_utf8_clipped(fb, x + GAP_L + LIST_TIME_W + GAP_M, ey,
                          event->title[0] ? event->title : "(无标题)",
                          w - (GAP_L + LIST_TIME_W + GAP_M) - GAP_L, true);
  }
}

void ui_draw_month(uint8_t *fb, const ui_month_t *view) {
  gfx_clear(fb, true);
  draw_header(fb, &view->status);

  const int grid_x = MARGIN;
  const int cell_w = MONTH_CELL_W;
  int rows = view->grid_rows;
  if (rows < 5 || rows > 6) {
    rows = 6;
  }
  const int cell_h = month_cell_h(rows);

  char title[32];
  snprintf(title, sizeof(title), "%d年%d月", view->year, view->month);
  gfx_text_utf8(fb, MARGIN, TITLE_Y, title, true);

  char count[48];
  snprintf(count, sizeof(count), "%d 条", view->month_event_count);
  draw_right(fb, TITLE_Y, count, true);

  const int weekday_y = TITLE_Y + BODY_H + GAP_L;
  for (int i = 0; i < 7; i++) {
    const int w = gfx_text_utf8_width(kWeekdayShort[i]);
    gfx_text_utf8(fb, grid_x + i * cell_w + (cell_w - w) / 2, weekday_y, kWeekdayShort[i],
                  true);
  }

  /* Weekend columns get a light dither so they read apart from weekdays. It is
   * painted before the grid lines, the selected-cell fill, the date numbers and
   * the event dots, so none of those lose contrast. */
  for (int row = 0; row < rows; row++) {
    gfx_dither_rect(fb, grid_x, MONTH_GRID_Y + row * cell_h, cell_w - 1, cell_h - 1,
                    WEEKEND_SHADE);
    gfx_dither_rect(fb, grid_x + 6 * cell_w, MONTH_GRID_Y + row * cell_h, cell_w - 1,
                    cell_h - 1, WEEKEND_SHADE);
  }

  for (int row = 1; row < rows; row++) {
    gfx_hline(fb, grid_x, MONTH_GRID_Y + row * cell_h, CONTENT_W, true);
  }
  for (int col = 1; col < 7; col++) {
    gfx_vline(fb, grid_x + col * cell_w, MONTH_GRID_Y, rows * cell_h, true);
  }

  for (int row = 0; row < rows; row++) {
    for (int col = 0; col < 7; col++) {
      const int idx = row * 7 + col;
      const int x = grid_x + col * cell_w;
      const int y = MONTH_GRID_Y + row * cell_h;
      const uint16_t day = (uint16_t)(view->first_day + idx);
      int cy = 1970, cm = 1, cd = 1;
      calendar_civil_from_days(day, &cy, &cm, &cd);
      const bool in_month = cy == view->year && cm == view->month;
      const bool selected = day == view->selected_day;
      const bool today = view->today != 0 && day == view->today;

      if (selected) {
        gfx_fill_rect(fb, x, y, cell_w - 1, cell_h - 1, true);
      } else if (today) {
        gfx_rect(fb, x + 2, y + 2, cell_w - 4, cell_h - 4, true);
        gfx_rect(fb, x + 4, y + 4, cell_w - 8, cell_h - 8, true);
      }

      if (!in_month) {
        continue;
      }

      char number[4];
      snprintf(number, sizeof(number), "%d", cd);
      gfx_text(fb, x + GAP_S, y + GAP_S, number, 3, !selected);

      if (selected && today) {
        gfx_rect(fb, x + 6, y + 6, cell_w - 12, cell_h - 12, false);
      }

      int dots = view->counts[idx];
      if (dots > 4) {
        dots = 4;
      }
      for (int d = 0; d < dots; d++) {
        gfx_fill_rect(fb, x + GAP_S + d * 8, y + cell_h - 16, 4, 4, !selected);
      }
    }
  }

  draw_peek_card(fb, view);

  draw_footer(fb, "返回:今天", "左右:换天", "确认:查看");
}

/* --- day view ----------------------------------------------------------- */

void ui_draw_day(uint8_t *fb, const ui_day_t *view) {
  gfx_clear(fb, true);
  draw_header(fb, &view->status);

  char date[24];
  format_day_label(view->day, false, date, sizeof(date));
  gfx_text_utf8(fb, MARGIN, TITLE_Y, date, true);
  const int weekday = calendar_weekday(view->day);
  const int date_w = gfx_text_utf8_width(date);
  gfx_text_utf8(fb, MARGIN + date_w + GAP_M, TITLE_Y, kWeekdayFull[weekday], true);

  int first = 0;
  if (view->selected >= 8) {
    first = view->selected - 7;
  }
  int rows = view->count - first;
  if (rows > 8) {
    rows = 8;
  }
  if (rows < 0) {
    rows = 0;
  }

  if (view->count > 0) {
    char count[48];
    if (view->count > 8) {
      snprintf(count, sizeof(count), "%d-%d/%d", first + 1, first + rows, view->count);
    } else {
      snprintf(count, sizeof(count), "%d 条", view->count);
    }
    draw_right(fb, TITLE_Y, count, true);
  }

  gfx_hline(fb, MARGIN, TITLE_Y + BODY_H + GAP_M, CONTENT_W, true);

  if (view->count == 0) {
    draw_centered(fb, 390, "这天没有日程", true);
    draw_centered(fb, 426, "打开手机网页，通过蓝牙添加", true);
    draw_footer(fb, "返回:月历", "左右:换天", "确认:详情");
    return;
  }

  const int list_y = TITLE_Y + BODY_H + GAP_M + GAP_L;
  const int row_h = 72;
  const int time_x = MARGIN;
  const int text_x = MARGIN + LIST_TIME_W + GAP_M;

  for (int i = 0; i < rows; i++) {
    const int index = first + i;
    const cal_event_t *event = &view->events[index];
    const int y = list_y + i * row_h;
    const bool selected = index == view->selected;

    if (selected) {
      gfx_fill_rect(fb, MARGIN, y, CONTENT_W, row_h, true);
    }

    char start[6];
    char end[6];
    format_hhmm(event->start_min, start, sizeof(start));
    format_hhmm(event->end_min, end, sizeof(end));
    gfx_text(fb, time_x, y + GAP_S, start, 3, !selected);
    gfx_text(fb, time_x, y + GAP_S + 32, end, 3, !selected);

    gfx_text_utf8_clipped(fb, text_x, y + GAP_S, event->title[0] ? event->title : "(空)",
                          UI_W - text_x - MARGIN, !selected);
    if (event->note[0]) {
      gfx_text_utf8_clipped(fb, text_x, y + GAP_S + 32, event->note, UI_W - text_x - MARGIN,
                            !selected);
    }

    if (!selected && i < rows - 1) {
      gfx_hline(fb, MARGIN, y + row_h - 1, CONTENT_W, true);
    }
  }

  draw_footer(fb, "返回:月历", "左右:换天", "确认:详情");
}

/* --- detail view -------------------------------------------------------- */

void ui_draw_detail(uint8_t *fb, const ui_detail_t *view) {
  gfx_clear(fb, true);
  draw_header(fb, &view->status);

  const cal_event_t *event = view->event;
  const int title_lines =
      gfx_text_utf8_wrap(fb, MARGIN, TITLE_Y, event->title[0] ? event->title : "(无标题)",
                         CONTENT_W, 32, 2, true);
  const int meta_y = TITLE_Y + title_lines * 32 + GAP_S;

  char date[24];
  char start[6];
  char end[6];
  char span[16];
  format_day_label(event->day, true, date, sizeof(date));
  format_hhmm(event->start_min, start, sizeof(start));
  format_hhmm(event->end_min, end, sizeof(end));
  snprintf(span, sizeof(span), "%s-%s", start, end);

  /* Date + weekday on one line, time on the next: the full date and the
   * range do not fit on one 420 px line at 24 px. */
  gfx_text_utf8(fb, MARGIN, meta_y, date, true);
  const int date_w = gfx_text_utf8_width(date);
  gfx_text_utf8(fb, MARGIN + date_w + GAP_M, meta_y,
                kWeekdayFull[calendar_weekday(event->day)], true);
  gfx_text_utf8(fb, MARGIN, meta_y + 32, span, true);

  const int line_y = meta_y + 32 + BODY_H + GAP_M;
  gfx_hline(fb, MARGIN, line_y, CONTENT_W, true);
  gfx_text_utf8(fb, MARGIN, line_y + GAP_L, "备注", true);
  if (event->note[0]) {
    gfx_text_utf8_wrap(fb, MARGIN, line_y + GAP_L + BODY_H + GAP_M, event->note, CONTENT_W,
                       32, 8, true);
  } else {
    gfx_text_utf8(fb, MARGIN, line_y + GAP_L + BODY_H + GAP_M, "无备注", true);
  }

  gfx_hline(fb, MARGIN, FOOTER_RULE_Y, CONTENT_W, true);
  gfx_text_utf8(fb, MARGIN, FOOTER_TEXT_Y, "返回:列表", true);

  const int delete_w = gfx_text_utf8_width("确认:删除") + 2 * GAP_L;
  const int chip_x = UI_W - MARGIN - delete_w;
  fill_round_rect(fb, chip_x, FOOTER_TEXT_Y - 6, delete_w, 30, true);
  gfx_text_utf8(fb, chip_x + GAP_L, FOOTER_TEXT_Y, "确认:删除", false);

  if (!view->confirm_delete) {
    return;
  }

  const int box_w = CONTENT_W;
  const int box_h = 196;
  const int box_x = MARGIN;
  const int box_y = (HEADER_RULE_Y + CONTENT_BOTTOM - box_h) / 2;
  gfx_fill_rect(fb, box_x, box_y, box_w, box_h, false);
  gfx_rect(fb, box_x, box_y, box_w, box_h, true);
  gfx_rect(fb, box_x + 3, box_y + 3, box_w - 6, box_h - 6, true);
  gfx_fill_rect(fb, box_x + 3, box_y + 3, box_w - 6, 44, true);
  gfx_text_utf8(fb, box_x + GAP_L, box_y + 12, "删除日程", false);

  gfx_text_utf8_clipped(fb, box_x + GAP_L, box_y + 64, event->title, box_w - 2 * GAP_L, true);
  gfx_text_utf8(fb, box_x + GAP_L, box_y + 104, "确定要删除这个日程吗?", true);
  gfx_text_utf8(fb, box_x + GAP_L, box_y + 148, "再次按确认删除  返回取消", true);
}

/* --- sleep screen ------------------------------------------------------- */

void ui_draw_sleep(uint8_t *fb, const ui_sleep_t *view) {
  gfx_clear(fb, true);

  const int top_y = 30;
  gfx_text_cjk_large(fb, MARGIN, top_y, "休眠中", 2, true);

  char clock[8];
  format_clock(&view->status, clock, sizeof(clock));
  const int clock_w = gfx_text_width(clock, 4);
  gfx_text(fb, UI_W - MARGIN - clock_w, top_y, clock, 4, true);

  char date[8];
  format_day_ascii(calendar_today(), date, sizeof(date));
  const int date_w = gfx_text_width(date, 3);
  gfx_text(fb, UI_W - MARGIN - date_w, top_y + 40, date, 3, true);

  gfx_hline(fb, MARGIN, 114, CONTENT_W, true);
  gfx_text_utf8(fb, MARGIN, 128, "接下来的日程", true);

  if (view->count == 0) {
    draw_centered(fb, 414, "近期没有日程", true);
    draw_centered(fb, 450, "手机网页可通过蓝牙添加", true);
  } else {
    const int max_rows = view->count > 5 ? 5 : view->count;
    for (int i = 0; i < max_rows; i++) {
      const cal_event_t *event = &view->events[i];
      const int y = 168 + i * 104;

      char day_text[8];
      char time_text[6];
      format_day_ascii(event->day, day_text, sizeof(day_text));
      format_hhmm(event->start_min, time_text, sizeof(time_text));
      gfx_text(fb, MARGIN, y + GAP_L, day_text, 3, true);
      gfx_text(fb, MARGIN, y + 48, time_text, 3, true);

      gfx_text_utf8_clipped(fb, MARGIN + LIST_TIME_W + GAP_M, y + GAP_L, event->title,
                            UI_W - MARGIN - LIST_TIME_W - GAP_M - MARGIN, true);
      if (event->note[0]) {
        gfx_text_utf8_clipped(fb, MARGIN + LIST_TIME_W + GAP_M, y + 48, event->note,
                              UI_W - MARGIN - LIST_TIME_W - GAP_M - MARGIN, true);
      }
      if (i < max_rows - 1) {
        gfx_hline(fb, MARGIN, y + 103, CONTENT_W, true);
      }
    }
  }

  gfx_hline(fb, MARGIN, FOOTER_RULE_Y, CONTENT_W, true);
  draw_centered(fb, FOOTER_TEXT_Y, "按 POWER 唤醒  蓝牙日历", true);
}

void ui_draw_toast(uint8_t *fb, const char *text) {
  if (!text || !text[0]) {
    return;
  }
  int width = gfx_text_utf8_width(text) + 2 * GAP_L;
  if (width > CONTENT_W) {
    width = CONTENT_W;
  }
  const int x = (UI_W - width) / 2;
  const int y = FOOTER_RULE_Y - GAP_L - 48;
  fill_round_rect(fb, x, y, width, 48, true);
  gfx_text_utf8_clipped(fb, x + GAP_L, y + 12, text, width - 2 * GAP_L, false);
}
