#include "calendar_ui.h"

#include <stdio.h>
#include <string.h>
#include <time.h>

#include "gfx.h"
#include "brand.h"
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
 * of it: the brand logo/name and a 32 px clock.
 *
 * Vertical rhythm: body line 24 px, gaps of 8 / 12 / 16 px, a taller 64 px
 * top bar and a shorter footer with its baseline 12 px above the bottom edge.
 * The scrollable content band keeps the same height as before. */
#define MARGIN 30
#define CONTENT_W (UI_W - 2 * MARGIN)
#define BODY_H 24
#define GAP_S 8
#define GAP_M 12
#define GAP_L 16

#define HEADER_RULE_Y 64
/* Ink baseline shared by the header logo, wordmark and status text. */
#define HEADER_BASELINE_Y 48
#define HEADER_STATUS_SCALE 3
#define HEADER_STATUS_Y (HEADER_BASELINE_Y - 8 * HEADER_STATUS_SCALE) /* 18 */
#define HEADER_STATUS_INK_H (7 * HEADER_STATUS_SCALE)                /* 21 */
#define HEADER_BLE_Y (HEADER_BASELINE_Y - HEADER_STATUS_INK_H)       /* 27 */
#define HEADER_WORD_GAP 8
/* Right cluster: battery, clock, BLE icon, separated by this gap. */
#define HEADER_RIGHT_GAP 14
#define HEADER_BLE_SLOT_W 18
#define TITLE_Y 80
/* The day agenda gives its date row more air above and below than the month
 * title: 24 px from the header rule and 24 px to the event list. */
#define DAY_TITLE_Y (TITLE_Y + 8) /* 88 */
#define DAY_BODY_GAP 24

#define FOOTER_TEXT_Y (UI_H - 12 - BODY_H)      /* 764 */
#define FOOTER_RULE_Y (FOOTER_TEXT_Y - GAP_L)   /* 748 */
#define CONTENT_BOTTOM (FOOTER_RULE_Y - GAP_L)  /* 732 */

/* "09:00" in the 5x7 font at scale 3 is 5 * 18 px wide. Every event row
 * (month card, day agenda, lock screen) puts its title 12 px after it. */
#define LIST_TIME_W (5 * 18)

#define MONTH_GRID_Y 152
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
 * "gray" a 1-bit panel can show) when the radio failed to start. The whole
 * icon occupies HEADER_STATUS_INK_H (21 px) rows, exactly the battery/clock
 * digit ink height, and shares their bottom edge. */
static void draw_ble_icon(uint8_t *fb, int x, int y, bool available, bool connected) {
  const bool inverted = available && connected;
  if (inverted) {
    fill_round_rect(fb, x - 2, y, 18, HEADER_STATUS_INK_H, true);
  }
  const bool ink = !inverted;
  const int cx = x + 7;
  const int right = x + 13;
  /* 2 px brush: line centers at y+1..y+20 cover exactly y..y+20 (21 rows). */
  const int top = y + (inverted ? 2 : 1);
  const int bottom = y + (inverted ? 18 : 20);
  const int q1 = y + (inverted ? 6 : 5);
  const int mid = y + 10;
  const int q3 = y + (inverted ? 14 : 15);

  gfx_line(fb, cx, top, cx, bottom, 2, ink);
  gfx_line(fb, cx, top, right, q1, 2, ink);
  gfx_line(fb, right, q1, cx, mid, 2, ink);
  gfx_line(fb, cx, mid, right, q3, 2, ink);
  gfx_line(fb, right, q3, cx, bottom, 2, ink);
  /* Left half of the bind-rune cross. */
  gfx_line(fb, cx, mid, x + 1, q1 - 1, 2, ink);
  gfx_line(fb, cx, mid, x + 1, q3 + 1, 2, ink);

  if (!available) {
    for (int j = 0; j < HEADER_STATUS_INK_H; j++) {
      for (int i = 0; i < 16; i++) {
        if (((i + j) & 1) == 0) {
          gfx_pixel(fb, x - 1 + i, y + j, false);
        }
      }
    }
  }
}

/* Top bar: logo + compact wordmark on the left; battery, clock and the BLE
 * icon form a right-aligned cluster with the radio state at the far right.
 * The wordmark bitmap replaces a second 24 px CJK lockup so the bar can be
 * taller while the type stays small; the bitmap and the status text are
 * positioned from one ink baseline. */
static void draw_brand_header(uint8_t *fb) {
  int x = MARGIN;
  gfx_bitmap(fb, x, HEADER_BASELINE_Y - brand_logo_header.height, brand_logo_header.width,
             brand_logo_header.height, brand_logo_header.bits, true);
  x += brand_logo_header.width + HEADER_WORD_GAP;
  gfx_bitmap(fb, x, HEADER_BASELINE_Y - brand_wordmark.height, brand_wordmark.width,
             brand_wordmark.height, brand_wordmark.bits, true);
}

static void draw_header(uint8_t *fb, const ui_status_t *status) {
  draw_brand_header(fb);

  char clock[8];
  format_clock(status, clock, sizeof(clock));
  char battery[8];
  if (status->battery_valid) {
    snprintf(battery, sizeof(battery), "%u%%", (unsigned)status->battery_pct);
  } else {
    snprintf(battery, sizeof(battery), "--%%");
  }

  /* The connected badge is 18 px wide and starts at icon_x - 2, so this pins
   * the visual right edge to the content margin. */
  const int icon_x = UI_W - MARGIN - HEADER_BLE_SLOT_W + 2;
  const int clock_x =
      icon_x - HEADER_RIGHT_GAP - gfx_text_width(clock, HEADER_STATUS_SCALE);
  const int battery_x =
      clock_x - HEADER_RIGHT_GAP - gfx_text_width(battery, HEADER_STATUS_SCALE);

  draw_ble_icon(fb, icon_x, HEADER_BLE_Y, status->ble_available, status->ble_connected);
  gfx_text(fb, battery_x, HEADER_STATUS_Y, battery, HEADER_STATUS_SCALE, true);
  gfx_text(fb, clock_x, HEADER_STATUS_Y, clock, HEADER_STATUS_SCALE, true);

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
    /* Keep the count inside the card's inner border: draw_right() aligns to
     * the screen margin (x=450), which is outside the inner frame at x=446.
     * Right-align to the same 16 px padding as the title instead. */
    const int total_w = gfx_text_utf8_width(total);
    gfx_text_utf8(fb, x + w - GAP_L - total_w, y + GAP_M, total, true);
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
  gfx_text_utf8(fb, MARGIN, DAY_TITLE_Y, date, true);
  const int weekday = calendar_weekday(view->day);
  const int date_w = gfx_text_utf8_width(date);
  gfx_text_utf8(fb, MARGIN + date_w + GAP_M, DAY_TITLE_Y, kWeekdayFull[weekday], true);

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
    draw_right(fb, DAY_TITLE_Y, count, true);
  }

  /* No rule under the date: the 64 px header rule already separates the
   * status bar, and a second line 52 px below it reads as a duplicate. */
  if (view->count == 0) {
    draw_centered(fb, 390, "这天没有日程", true);
    draw_centered(fb, 426, "打开手机网页，通过蓝牙添加", true);
    draw_footer(fb, "返回:月历", "左右:换天", "确认:详情");
    return;
  }

  const int list_y = DAY_TITLE_Y + BODY_H + DAY_BODY_GAP;
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
  /* The device stores 95-byte titles and 191-byte notes; at 24 px a 420 px line
   * holds 23 ASCII or 16 CJK characters, so the worst case is 5 title lines
   * plus 9 note lines. Title and note share the space above the footer:
   * note_start = 208 + 32 * title_lines, so title_lines + note_lines <= 16. */
  const int title_lines =
      gfx_text_utf8_wrap(fb, MARGIN, TITLE_Y, event->title[0] ? event->title : "(无标题)",
                         CONTENT_W, 32, 5, true);
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
    const int note_lines = 16 - title_lines;
    gfx_text_utf8_wrap(fb, MARGIN, line_y + GAP_L + BODY_H + GAP_M, event->note, CONTENT_W,
                       32, note_lines, true);
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

/* Lock-screen footer. The key name is Chinese now, so the hint is one
 * centered UTF-8 run; the old 5x7 "POWER" optical spacing is unnecessary. */
static void draw_power_hint(uint8_t *fb, int y) {
  const char *hint = "按电源键唤醒";
  const int width = gfx_text_utf8_width(hint);
  gfx_text_utf8(fb, (UI_W - width) / 2, y, hint, true);
}

/* Section title and the top of the list band on the lock screen; the empty
 * state centers its block between this and CONTENT_BOTTOM. */
#define LOCK_TITLE_Y 148
#define LOCK_LIST_TOP (LOCK_TITLE_Y + BODY_H) /* 172 */
/* Empty state: 32 px between the mini program code and the first hint, 36 px
 * between the hints (the same line step as the event rows). */
#define LOCK_EMPTY_QR_GAP 32
#define LOCK_EMPTY_LINE_GAP 36

/* Nothing upcoming: the phone can add events by scanning the mini program
 * code, so the code sits above the two hints and the whole block is centered
 * in the list band instead of sitting at the top of a page with no rows. */
static void draw_lock_empty(uint8_t *fb) {
  const int qr_w = (int)brand_qrcode.width;
  const int qr_h = (int)brand_qrcode.height;
  const int block_h = qr_h + LOCK_EMPTY_QR_GAP + LOCK_EMPTY_LINE_GAP + BODY_H;
  const int top = (LOCK_LIST_TOP + CONTENT_BOTTOM - block_h) / 2;

  gfx_bitmap(fb, (UI_W - qr_w) / 2, top, qr_w, qr_h, brand_qrcode.bits, true);
  draw_centered(fb, top + qr_h + LOCK_EMPTY_QR_GAP, "近期没有日程", true);
  draw_centered(fb, top + qr_h + LOCK_EMPTY_QR_GAP + LOCK_EMPTY_LINE_GAP,
                "手机网页可通过蓝牙添加", true);
}

/* The lock screen is the brand's hero surface: the mark and the product name
 * stay on the glass while the device is parked, followed by the next events.
 * The line next to the name is the short lock-screen subtitle, not the
 * tagline, so it still fits beside it at 24 px. */
void ui_draw_sleep(uint8_t *fb, const ui_sleep_t *view) {
  gfx_clear(fb, true);

  gfx_bitmap(fb, MARGIN, 24, brand_logo_lock.width, brand_logo_lock.height,
             brand_logo_lock.bits, true);

  char clock[8];
  format_clock(&view->status, clock, sizeof(clock));
  const int clock_w = gfx_text_width(clock, 4);
  gfx_text(fb, UI_W - MARGIN - clock_w, 26, clock, 4, true);

  char date[8];
  format_day_ascii(calendar_today(), date, sizeof(date));
  const int date_w = gfx_text_width(date, 3);
  gfx_text(fb, UI_W - MARGIN - date_w, 68, date, 3, true);

  gfx_text_utf8(fb, MARGIN, 100, BRAND_NAME, true);
  draw_right(fb, 100, BRAND_LOCK_SUBTITLE, true);
  gfx_hline(fb, MARGIN, 136, CONTENT_W, true);
  gfx_text_utf8(fb, MARGIN, LOCK_TITLE_Y, "接下来的日程", true);

  if (view->count == 0) {
    draw_lock_empty(fb);
  } else {
    const int max_rows = view->count > 5 ? 5 : view->count;
    for (int i = 0; i < max_rows; i++) {
      const cal_event_t *event = &view->events[i];
      const int y = 184 + i * 104;

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
  draw_power_hint(fb, FOOTER_TEXT_Y);
}

/* --- boot splash -------------------------------------------------------- */

/* Painted once on a cold boot before the first calendar frame; the e-ink
 * keeps it for the short hold in main.c, then swaps to the month view. */
void ui_draw_boot(uint8_t *fb) {
  gfx_clear(fb, true);

  const int logo_y = 230;
  gfx_bitmap(fb, (UI_W - (int)brand_logo_boot.width) / 2, logo_y, brand_logo_boot.width,
             brand_logo_boot.height, brand_logo_boot.bits, true);

  const int name_y = logo_y + (int)brand_logo_boot.height + 32;
  draw_centered(fb, name_y, BRAND_NAME, true);
  draw_centered(fb, name_y + 36, BRAND_TAGLINE, true);
  gfx_hline(fb, (UI_W - 120) / 2, name_y + 92, 120, true);
  draw_centered(fb, name_y + 108, "ESP32-C61 / BLE", true);
}

/* Pairing screen: the 12-character one-time code is the only secret, so it is
 * drawn as three large 4-character lines instead of body text. */
void ui_draw_pairing(uint8_t *fb, const ui_pairing_t *view) {
  gfx_clear(fb, true);

  gfx_text_utf8(fb, MARGIN, 28, BRAND_NAME, true);
  draw_right(fb, 28, "BLE 配对", true);
  gfx_hline(fb, MARGIN, 64, CONTENT_W, true);

  gfx_text_utf8(fb, MARGIN, 100, "设备配对", true);
  gfx_text_utf8(fb, MARGIN, 140, "在小程序中输入以下配对码", true);

  const char *code = view->code && view->code[0] ? view->code : "------------";
  char line[5] = {0};
  for (int row = 0; row < 3; row++) {
    for (int col = 0; col < 4; col++) {
      line[col] = code[row * 4 + col];
    }
    const int width = gfx_text_width(line, 6);
    gfx_text(fb, (UI_W - width) / 2, 200 + row * 80, line, 6, true);
  }

  draw_centered(fb, 500, "配对码 3 分钟内有效", true);
  draw_centered(fb, 540, "配对后所有日程指令都会加密", true);
  if (view->has_key) {
    draw_centered(fb, 580, "重新配对会替换当前手机", true);
  }
  draw_centered(fb, 620, "长按确认键 8 秒可清除绑定", true);

  gfx_hline(fb, MARGIN, FOOTER_RULE_Y, CONTENT_W, true);
  gfx_text_utf8(fb, MARGIN, FOOTER_TEXT_Y, "返回取消", true);
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
