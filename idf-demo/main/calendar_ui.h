#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "calendar.h"

/* Pure drawing helpers for the single-calendar, portrait calendar UI. main.c
 * owns the state machine; these functions only render a snapshot into the
 * 480x800 logical framebuffer (gfx.c rotates it onto the 800x480 panel). */

typedef struct {
  bool time_valid;
  bool time_synced;
  uint32_t local_epoch; /* epoch shifted by the phone timezone */
  uint8_t battery_pct;
  /* False until the first plausible pack voltage arrives; the header then
   * shows "--%" instead of pretending the battery is empty. */
  bool battery_valid;
  bool usb;
  bool ble_available;
  bool ble_connected;
  bool ble_subscribed;
} ui_status_t;

typedef struct {
  ui_status_t status;
  uint16_t selected_day;
  uint16_t today;
  int year;
  int month;
  uint16_t first_day;
  int grid_rows;
  uint8_t counts[42];
  int month_event_count;
  /* Events on the selected day, drawn as a floating card at the bottom of the
   * month grid. peek_total is the real day count; only the first two events
   * are copied into peek_events. */
  int peek_total;
  int peek_shown;
  const cal_event_t *peek_events;
} ui_month_t;

typedef struct {
  ui_status_t status;
  uint16_t day;
  uint16_t today;
  int count;
  const cal_event_t *events;
  int selected;
} ui_day_t;

typedef struct {
  ui_status_t status;
  const cal_event_t *event;
  bool confirm_delete;
} ui_detail_t;

typedef struct {
  ui_status_t status;
  int count;
  const cal_event_t *events;
} ui_sleep_t;

void ui_draw_month(uint8_t *fb, const ui_month_t *view);
void ui_draw_day(uint8_t *fb, const ui_day_t *view);
void ui_draw_detail(uint8_t *fb, const ui_detail_t *view);
void ui_draw_sleep(uint8_t *fb, const ui_sleep_t *view);

void ui_draw_toast(uint8_t *fb, const char *text);
