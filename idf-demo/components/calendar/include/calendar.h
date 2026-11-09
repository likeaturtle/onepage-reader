#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

/*
 * Calendar data model and persistence.
 *
 * This application exposes exactly one calendar. The schema still carries a
 * calendar index (always 0), and calendar_init() collapses an older
 * multi-calendar database into index 0 on first boot. Dates are stored as a
 * civil day number (days since 1970-01-01) and minutes of the local day, so no
 * POSIX timezone handling is involved: the phone sends local wall-clock values
 * and the panel shows the same values. The timezone offset is only used to
 * decide what "today" is and to order the upcoming list.
 *
 * The whole database is a single NVS blob in namespace "calstore". A calendar
 * of this size (96 events with short titles/notes) fits the 20 KB nvs
 * partition; when it does not, the oldest past events are pruned and the
 * caller is told how many were dropped.
 */

#define CAL_MAX_CALENDARS 8
#define CAL_MAX_EVENTS 96
#define CAL_MAX_DAY_EVENTS 24
#define CAL_NAME_BYTES 20
#define CAL_TITLE_BYTES 48
#define CAL_NOTE_BYTES 96

typedef struct {
  uint16_t id;
  uint8_t cal;   /* index into the calendar list */
  uint8_t flags; /* reserved, 0 */
  uint16_t day;  /* days since 1970-01-01, local civil date */
  uint16_t start_min;
  uint16_t end_min;
  char title[CAL_TITLE_BYTES];
  char note[CAL_NOTE_BYTES];
} cal_event_t;

/* Idempotent. Loads the database, restores the clock/tz and creates the
 * default calendars on first boot. Call nvs_flash_init() first (or let this
 * function do it). */
esp_err_t calendar_init(void);

/* --- calendars ---------------------------------------------------------- */

int calendar_count(void);
int calendar_event_count(void);
const char *calendar_name(int index);
int calendar_find_by_name(const char *name);

/* Legacy calendar-management helpers. The single-calendar application does not
 * call them; they remain for schema migration and future experiments. */
esp_err_t calendar_add_calendar(const char *name, int *index);
/* Only empty calendars can be removed; at least one must remain. */
esp_err_t calendar_delete_calendar(int index);
esp_err_t calendar_rename_calendar(int index, const char *name);

/* --- events ------------------------------------------------------------- */

/* Events are kept sorted by (day, start, id). All returned arrays are copies;
 * callers never hold a pointer into the database. */
bool calendar_get_event(uint16_t id, cal_event_t *out);
int calendar_count_on_day(int cal, uint16_t day);
void calendar_day_counts(int cal, uint16_t first_day, uint8_t *counts, int days);
int calendar_events_on_day(int cal, uint16_t day, cal_event_t *out, int max);
int calendar_events_range(int cal, uint16_t from_day, uint16_t to_day, cal_event_t *out,
                          int max);
/* Events that are ongoing at, or start after, (from_day, from_min). Pass
 * cal < 0 for all calendars. */
int calendar_upcoming(uint16_t from_day, uint16_t from_min, int cal, cal_event_t *out,
                      int max);

esp_err_t calendar_add_event(const cal_event_t *event, uint16_t *id_out, int *pruned_out);
esp_err_t calendar_delete_event(uint16_t id);

/* Increments on every mutation (including a phone time sync), so the UI can
 * notice a change made by the BLE task without sharing its data. */
uint32_t calendar_generation(void);

/* --- time --------------------------------------------------------------- */

/* Store a phone-supplied epoch/tz, update the system clock and persist both.
 * tz is minutes east of UTC (Asia/Shanghai = 480). */
esp_err_t calendar_set_time(uint32_t epoch, int tz_minutes);
int calendar_tz_minutes(void);
uint32_t calendar_now_epoch(void);
/* Epoch shifted into local civil time; pass to gmtime_r, not localtime_r. */
uint32_t calendar_local_epoch(void);
bool calendar_time_valid(void);
/* True when the clock was already valid at boot (RTC or phone sync) rather
 * than restored from the last stored value. */
bool calendar_time_synced(void);
uint16_t calendar_today(void);
/* Best-effort persistence of the current clock; call before deep sleep. */
void calendar_save_clock(void);

/* --- civil date helpers (no ESP-IDF dependencies) ----------------------- */

int calendar_days_from_civil(int year, int month, int day);
void calendar_civil_from_days(int days, int *year, int *month, int *day);
int calendar_weekday(uint16_t day); /* 0 = Sunday */

bool calendar_parse_date(const char *text, uint16_t *day);
bool calendar_parse_time(const char *text, uint16_t *minutes);
void calendar_format_date(uint16_t day, char *out, size_t len);
void calendar_format_time(uint16_t minutes, char *out, size_t len);
