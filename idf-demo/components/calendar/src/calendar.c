#include "calendar.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "calendar";

#define NVS_NAMESPACE "calstore"
#define NVS_KEY_DB "db"
#define NVS_KEY_EPOCH "epoch"
#define NVS_KEY_TZ "tz"

#define DB_MAGIC 0x4C41434Fu /* "OCAL" */
#define DB_VERSION 2
#define DB_HEADER_BYTES 16
#define DB_MAX_BYTES 16384

/* A calendar without a synced clock still needs a sane cursor. */
#define EPOCH_2021 1609459200u

/* This build intentionally exposes a single calendar. The storage schema
 * still carries a calendar index (0) so old databases migrate cleanly. */
#define DEFAULT_CALENDAR_NAME "日历"
static const char *const kDefaultCalendars[] = {DEFAULT_CALENDAR_NAME};

static cal_event_t *s_events;
static int s_event_count;
static char s_cal_names[CAL_MAX_CALENDARS][CAL_NAME_BYTES];
static int s_cal_count;
static uint16_t s_next_id = 1;
static int s_tz_minutes;
static bool s_time_synced;
static uint32_t s_generation;
static SemaphoreHandle_t s_lock;
static nvs_handle_t s_nvs;
static bool s_nvs_open;
static uint8_t *s_blob;

/* --- small helpers ------------------------------------------------------ */

static uint32_t db_crc32(const uint8_t *data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc >> 1) ^ (0xEDB88320u & (uint32_t)(-(int32_t)(crc & 1u)));
    }
  }
  return ~crc;
}

static uint16_t get_u16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

static uint32_t get_u32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void put_u16(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)(v >> 8);
}

static void put_u32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)((v >> 8) & 0xFF);
  p[2] = (uint8_t)((v >> 16) & 0xFF);
  p[3] = (uint8_t)((v >> 24) & 0xFF);
}

/* Copies at most cap-1 bytes and never leaves half of a UTF-8 sequence at the
 * end. The source is assumed to be valid UTF-8 (the web page produces it). */
static void copy_utf8(char *dst, size_t cap, const char *src) {
  if (cap == 0) {
    return;
  }
  size_t n = 0;
  if (src) {
    n = strlen(src);
    if (n > cap - 1) {
      n = cap - 1;
    }
    /* Do not leave a partial multi-byte sequence at the end: the display
     * decoder would turn it into a replacement glyph. */
    size_t i = 0;
    while (i < n) {
      const unsigned char c = (unsigned char)src[i];
      size_t need = 1;
      if ((c & 0xE0) == 0xC0) {
        need = 2;
      } else if ((c & 0xF0) == 0xE0) {
        need = 3;
      } else if ((c & 0xF8) == 0xF0) {
        need = 4;
      }
      if (i + need > n) {
        break;
      }
      i += need;
    }
    n = i;
    if (n) {
      memcpy(dst, src, n);
    }
  }
  dst[n] = '\0';
}

static int compare_events(const void *a, const void *b) {
  const cal_event_t *ea = (const cal_event_t *)a;
  const cal_event_t *eb = (const cal_event_t *)b;
  if (ea->day != eb->day) {
    return ea->day < eb->day ? -1 : 1;
  }
  if (ea->start_min != eb->start_min) {
    return ea->start_min < eb->start_min ? -1 : 1;
  }
  if (ea->end_min != eb->end_min) {
    return ea->end_min < eb->end_min ? -1 : 1;
  }
  if (ea->id != eb->id) {
    return ea->id < eb->id ? -1 : 1;
  }
  return 0;
}

static int find_index_by_id(uint16_t id) {
  for (int i = 0; i < s_event_count; i++) {
    if (s_events[i].id == id) {
      return i;
    }
  }
  return -1;
}

static void remove_at(int index) {
  if (index < 0 || index >= s_event_count) {
    return;
  }
  if (index + 1 < s_event_count) {
    memmove(&s_events[index], &s_events[index + 1],
            (size_t)(s_event_count - index - 1) * sizeof(cal_event_t));
  }
  s_event_count--;
}

static void insert_sorted(const cal_event_t *event) {
  int at = s_event_count;
  for (int i = 0; i < s_event_count; i++) {
    if (compare_events(event, &s_events[i]) < 0) {
      at = i;
      break;
    }
  }
  if (at < s_event_count) {
    memmove(&s_events[at + 1], &s_events[at],
            (size_t)(s_event_count - at) * sizeof(cal_event_t));
  }
  s_events[at] = *event;
  s_event_count++;
}

static bool event_matches_cal(const cal_event_t *event, int cal) {
  return cal < 0 || event->cal == (uint8_t)cal;
}

/* --- persistence -------------------------------------------------------- */

static size_t pack_db(uint8_t *buf, size_t cap) {
  if (DB_HEADER_BYTES + (size_t)s_cal_count * (1 + CAL_NAME_BYTES) > cap) {
    return 0;
  }
  put_u32(buf, DB_MAGIC);
  buf[4] = DB_VERSION;
  buf[5] = (uint8_t)s_cal_count;
  put_u16(buf + 6, (uint16_t)s_event_count);
  put_u16(buf + 8, s_next_id);
  put_u16(buf + 10, 0);
  put_u32(buf + 12, 0);
  size_t off = DB_HEADER_BYTES;

  for (int i = 0; i < s_cal_count; i++) {
    const size_t len = strnlen(s_cal_names[i], CAL_NAME_BYTES - 1);
    buf[off++] = (uint8_t)len;
    memcpy(buf + off, s_cal_names[i], len);
    off += len;
  }

  for (int i = 0; i < s_event_count; i++) {
    const cal_event_t *e = &s_events[i];
    const size_t title_len = strnlen(e->title, CAL_TITLE_BYTES - 1);
    const size_t note_len = strnlen(e->note, CAL_NOTE_BYTES - 1);
    const size_t need = 12 + title_len + note_len;
    if (off + need > cap) {
      return 0;
    }
    put_u16(buf + off, e->id);
    buf[off + 2] = e->cal;
    buf[off + 3] = e->flags;
    put_u16(buf + off + 4, e->day);
    put_u16(buf + off + 6, e->start_min);
    put_u16(buf + off + 8, e->end_min);
    buf[off + 10] = (uint8_t)title_len;
    buf[off + 11] = (uint8_t)note_len;
    off += 12;
    memcpy(buf + off, e->title, title_len);
    off += title_len;
    memcpy(buf + off, e->note, note_len);
    off += note_len;
  }
  put_u32(buf + 12, db_crc32(buf + DB_HEADER_BYTES, off - DB_HEADER_BYTES));
  return off;
}

static bool unpack_db(const uint8_t *buf, size_t len) {
  if (len < DB_HEADER_BYTES || get_u32(buf) != DB_MAGIC || buf[4] != DB_VERSION) {
    return false;
  }
  if (get_u32(buf + 12) != db_crc32(buf + DB_HEADER_BYTES, len - DB_HEADER_BYTES)) {
    ESP_LOGW(TAG, "stored calendar CRC mismatch");
    return false;
  }
  const int cal_count = buf[5];
  const int event_count = get_u16(buf + 6);
  if (cal_count < 1 || cal_count > CAL_MAX_CALENDARS || event_count > CAL_MAX_EVENTS) {
    return false;
  }

  char names[CAL_MAX_CALENDARS][CAL_NAME_BYTES] = {0};
  size_t off = DB_HEADER_BYTES;
  for (int i = 0; i < cal_count; i++) {
    if (off >= len) {
      return false;
    }
    const size_t n = buf[off++];
    if (n == 0 || n >= CAL_NAME_BYTES || off + n > len) {
      return false;
    }
    memcpy(names[i], buf + off, n);
    names[i][n] = '\0';
    off += n;
  }

  cal_event_t *events = calloc((size_t)event_count ? (size_t)event_count : 1, sizeof(cal_event_t));
  if (!events) {
    return false;
  }
  for (int i = 0; i < event_count; i++) {
    if (off + 12 > len) {
      free(events);
      return false;
    }
    cal_event_t *e = &events[i];
    e->id = get_u16(buf + off);
    e->cal = buf[off + 2];
    e->flags = buf[off + 3];
    e->day = get_u16(buf + off + 4);
    e->start_min = get_u16(buf + off + 6);
    e->end_min = get_u16(buf + off + 8);
    const size_t title_len = buf[off + 10];
    const size_t note_len = buf[off + 11];
    if (title_len >= CAL_TITLE_BYTES || note_len >= CAL_NOTE_BYTES ||
        e->cal >= (uint8_t)cal_count || e->start_min > 1439 || e->end_min > 1440) {
      free(events);
      return false;
    }
    off += 12;
    if (off + title_len + note_len > len) {
      free(events);
      return false;
    }
    memcpy(e->title, buf + off, title_len);
    e->title[title_len] = '\0';
    off += title_len;
    memcpy(e->note, buf + off, note_len);
    e->note[note_len] = '\0';
    off += note_len;
  }

  memcpy(s_cal_names, names, sizeof(s_cal_names));
  s_cal_count = cal_count;
  memcpy(s_events, events, (size_t)event_count * sizeof(cal_event_t));
  s_event_count = event_count;
  free(events);

  uint16_t max_id = 0;
  for (int i = 0; i < s_event_count; i++) {
    if (s_events[i].id > max_id) {
      max_id = s_events[i].id;
    }
  }
  s_next_id = get_u16(buf + 8);
  if (s_next_id <= max_id) {
    s_next_id = max_id == 0xFFFF ? 1 : (uint16_t)(max_id + 1);
  }
  qsort(s_events, (size_t)s_event_count, sizeof(cal_event_t), compare_events);
  return true;
}

static int find_oldest_past(uint16_t keep_id) {
  const uint16_t today = calendar_today();
  int best = -1;
  for (int i = 0; i < s_event_count; i++) {
    if (s_events[i].id == keep_id) {
      continue;
    }
    if (today != 0 && s_events[i].day < today) {
      if (best < 0 || s_events[i].day < s_events[best].day) {
        best = i;
      }
    }
  }
  return best;
}

/* Packs and stores the database. When NVS is full, the oldest events that are
 * already in the past are dropped first; a calendar keeps its upcoming ones. */
static esp_err_t save_db_locked(uint16_t keep_id, int *pruned) {
  int dropped = 0;
  esp_err_t err = ESP_FAIL;
  for (int attempt = 0; attempt < CAL_MAX_EVENTS; attempt++) {
    const size_t len = pack_db(s_blob, DB_MAX_BYTES);
    if (len == 0) {
      err = ESP_ERR_INVALID_SIZE;
      break;
    }
    if (!s_nvs_open) {
      err = ESP_ERR_INVALID_STATE;
      break;
    }
    err = nvs_set_blob(s_nvs, NVS_KEY_DB, s_blob, len);
    if (err != ESP_ERR_NVS_NOT_ENOUGH_SPACE) {
      break;
    }
    const int victim = find_oldest_past(keep_id);
    if (victim < 0) {
      break;
    }
    ESP_LOGW(TAG, "NVS full, pruning past event %u", (unsigned)s_events[victim].id);
    remove_at(victim);
    dropped++;
  }
  if (err == ESP_OK) {
    err = nvs_commit(s_nvs);
  }
  if (pruned) {
    *pruned = dropped;
  }
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "save failed: %s", esp_err_to_name(err));
  }
  return err;
}

static void load_defaults(void) {
  s_cal_count = (int)(sizeof(kDefaultCalendars) / sizeof(kDefaultCalendars[0]));
  memset(s_cal_names, 0, sizeof(s_cal_names));
  for (int i = 0; i < s_cal_count; i++) {
    copy_utf8(s_cal_names[i], CAL_NAME_BYTES, kDefaultCalendars[i]);
  }
  s_event_count = 0;
  s_next_id = 1;
}

static void ensure_storage(void) {
  if (s_events) {
    return;
  }
  s_events = heap_caps_malloc((size_t)CAL_MAX_EVENTS * sizeof(cal_event_t),
                              MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_events) {
    s_events = malloc((size_t)CAL_MAX_EVENTS * sizeof(cal_event_t));
  }
  s_blob = heap_caps_malloc(DB_MAX_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_blob) {
    s_blob = malloc(DB_MAX_BYTES);
  }
}

/* Old firmware stored up to five calendars. Collapse every event into the
 * single visible calendar once, then persist the migrated database. */
static void normalize_single_calendar(void) {
  bool changed = s_cal_count != 1 || strcmp(s_cal_names[0], DEFAULT_CALENDAR_NAME) != 0;
  for (int i = 0; i < s_event_count; i++) {
    if (s_events[i].cal != 0) {
      s_events[i].cal = 0;
      changed = true;
    }
  }
  if (!changed) {
    return;
  }

  s_cal_count = 1;
  memset(s_cal_names, 0, sizeof(s_cal_names));
  copy_utf8(s_cal_names[0], CAL_NAME_BYTES, DEFAULT_CALENDAR_NAME);
  int pruned = 0;
  const esp_err_t err = save_db_locked(0, &pruned);
  ESP_LOGI(TAG, "collapsed calendars to one (%d events kept, save %s)", s_event_count,
           esp_err_to_name(err));
}

esp_err_t calendar_init(void) {
  if (s_lock) {
    return ESP_OK;
  }
  ensure_storage();
  if (!s_events || !s_blob) {
    return ESP_ERR_NO_MEM;
  }
  s_lock = xSemaphoreCreateMutex();
  if (!s_lock) {
    return ESP_ERR_NO_MEM;
  }

  esp_err_t err = nvs_flash_init();
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "nvs_flash_init: %s", esp_err_to_name(err));
    return err;
  }
  err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &s_nvs);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "nvs_open: %s", esp_err_to_name(err));
    return err;
  }
  s_nvs_open = true;

  load_defaults();

  int32_t tz = 0;
  if (nvs_get_i32(s_nvs, NVS_KEY_TZ, &tz) == ESP_OK) {
    if (tz >= -720 && tz <= 840) {
      s_tz_minutes = (int)tz;
    }
  }

  const time_t now = time(NULL);
  if (now >= (time_t)EPOCH_2021) {
    s_time_synced = true;
  } else {
    int64_t stored_epoch = 0;
    if (nvs_get_i64(s_nvs, NVS_KEY_EPOCH, &stored_epoch) == ESP_OK &&
        stored_epoch >= (int64_t)EPOCH_2021) {
      struct timeval tv = {.tv_sec = (time_t)stored_epoch, .tv_usec = 0};
      settimeofday(&tv, NULL);
      ESP_LOGW(TAG, "clock restored from NVS (phone sync still recommended)");
    }
    s_time_synced = false;
  }

  size_t blob_len = 0;
  if (nvs_get_blob(s_nvs, NVS_KEY_DB, NULL, &blob_len) == ESP_OK && blob_len > 0 &&
      blob_len <= DB_MAX_BYTES) {
    uint8_t *blob = heap_caps_malloc(blob_len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!blob) {
      blob = malloc(blob_len);
    }
    if (blob) {
      if (nvs_get_blob(s_nvs, NVS_KEY_DB, blob, &blob_len) == ESP_OK &&
          unpack_db(blob, blob_len)) {
        ESP_LOGI(TAG, "loaded %d events, %d calendars", s_event_count, s_cal_count);
      } else {
        ESP_LOGW(TAG, "stored calendar is invalid; starting with defaults");
        load_defaults();
      }
      free(blob);
    } else {
      load_defaults();
    }
  } else {
    ESP_LOGI(TAG, "no stored calendar; creating defaults");
    int pruned = 0;
    (void)save_db_locked(0, &pruned);
  }

  normalize_single_calendar();

  ESP_LOGI(TAG, "ready: %d events in %d calendar(s), tz %+d min, clock %s",
           s_event_count, s_cal_count, s_tz_minutes,
           calendar_time_synced() ? "synced" : "unsynced");
  return ESP_OK;
}

/* --- calendars ---------------------------------------------------------- */

int calendar_count(void) { return s_cal_count; }

int calendar_event_count(void) { return s_event_count; }

const char *calendar_name(int index) {
  if (index < 0 || index >= s_cal_count) {
    return "";
  }
  return s_cal_names[index];
}

int calendar_find_by_name(const char *name) {
  if (!name) {
    return -1;
  }
  for (int i = 0; i < s_cal_count; i++) {
    if (strcmp(s_cal_names[i], name) == 0) {
      return i;
    }
  }
  return -1;
}

esp_err_t calendar_add_calendar(const char *name, int *index) {
  if (!name || !name[0]) {
    return ESP_ERR_INVALID_ARG;
  }
  if (s_cal_count >= CAL_MAX_CALENDARS) {
    return ESP_ERR_NO_MEM;
  }
  char clean[CAL_NAME_BYTES];
  copy_utf8(clean, sizeof(clean), name);
  if (!clean[0]) {
    return ESP_ERR_INVALID_ARG;
  }
  if (calendar_find_by_name(clean) >= 0) {
    return ESP_ERR_INVALID_STATE;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  copy_utf8(s_cal_names[s_cal_count], CAL_NAME_BYTES, clean);
  const int idx = s_cal_count++;
  const esp_err_t err = save_db_locked(0, NULL);
  s_generation++;
  xSemaphoreGive(s_lock);
  if (index) {
    *index = idx;
  }
  return err;
}

esp_err_t calendar_delete_calendar(int index) {
  if (index < 0 || index >= s_cal_count || s_cal_count <= 1) {
    return ESP_ERR_INVALID_ARG;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  for (int i = 0; i < s_event_count; i++) {
    if (s_events[i].cal == (uint8_t)index) {
      xSemaphoreGive(s_lock);
      return ESP_ERR_INVALID_STATE;
    }
  }
  for (int i = index; i + 1 < s_cal_count; i++) {
    memcpy(s_cal_names[i], s_cal_names[i + 1], CAL_NAME_BYTES);
  }
  s_cal_count--;
  memset(s_cal_names[s_cal_count], 0, CAL_NAME_BYTES);
  for (int i = 0; i < s_event_count; i++) {
    if (s_events[i].cal > (uint8_t)index) {
      s_events[i].cal--;
    }
  }
  const esp_err_t err = save_db_locked(0, NULL);
  s_generation++;
  xSemaphoreGive(s_lock);
  return err;
}

esp_err_t calendar_rename_calendar(int index, const char *name) {
  if (index < 0 || index >= s_cal_count || !name || !name[0]) {
    return ESP_ERR_INVALID_ARG;
  }
  char clean[CAL_NAME_BYTES];
  copy_utf8(clean, sizeof(clean), name);
  if (!clean[0]) {
    return ESP_ERR_INVALID_ARG;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  for (int i = 0; i < s_cal_count; i++) {
    if (i != index && strcmp(s_cal_names[i], clean) == 0) {
      xSemaphoreGive(s_lock);
      return ESP_ERR_INVALID_STATE;
    }
  }
  copy_utf8(s_cal_names[index], CAL_NAME_BYTES, clean);
  const esp_err_t err = save_db_locked(0, NULL);
  s_generation++;
  xSemaphoreGive(s_lock);
  return err;
}

/* --- events ------------------------------------------------------------- */

bool calendar_get_event(uint16_t id, cal_event_t *out) {
  if (!out) {
    return false;
  }
  bool found = false;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  const int idx = find_index_by_id(id);
  if (idx >= 0) {
    *out = s_events[idx];
    found = true;
  }
  xSemaphoreGive(s_lock);
  return found;
}

int calendar_count_on_day(int cal, uint16_t day) {
  int count = 0;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  for (int i = 0; i < s_event_count; i++) {
    if (s_events[i].day == day && event_matches_cal(&s_events[i], cal)) {
      count++;
    }
  }
  xSemaphoreGive(s_lock);
  return count;
}

void calendar_day_counts(int cal, uint16_t first_day, uint8_t *counts, int days) {
  if (!counts || days <= 0) {
    return;
  }
  memset(counts, 0, (size_t)days);
  xSemaphoreTake(s_lock, portMAX_DELAY);
  for (int i = 0; i < s_event_count; i++) {
    if (!event_matches_cal(&s_events[i], cal)) {
      continue;
    }
    const int offset = (int)s_events[i].day - (int)first_day;
    if (offset >= 0 && offset < days && counts[offset] < 255) {
      counts[offset]++;
    }
  }
  xSemaphoreGive(s_lock);
}

int calendar_events_on_day(int cal, uint16_t day, cal_event_t *out, int max) {
  return calendar_events_range(cal, day, day, out, max);
}

int calendar_events_range(int cal, uint16_t from_day, uint16_t to_day, cal_event_t *out,
                          int max) {
  if (!out || max <= 0) {
    return 0;
  }
  int count = 0;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  for (int i = 0; i < s_event_count && count < max; i++) {
    if (s_events[i].day < from_day || s_events[i].day > to_day) {
      continue;
    }
    if (!event_matches_cal(&s_events[i], cal)) {
      continue;
    }
    out[count++] = s_events[i];
  }
  xSemaphoreGive(s_lock);
  return count;
}

int calendar_upcoming(uint16_t from_day, uint16_t from_min, int cal, cal_event_t *out,
                      int max) {
  if (!out || max <= 0) {
    return 0;
  }
  int count = 0;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  for (int i = 0; i < s_event_count && count < max; i++) {
    const cal_event_t *e = &s_events[i];
    if (!event_matches_cal(e, cal)) {
      continue;
    }
    const bool future = e->day > from_day || (e->day == from_day && e->end_min >= from_min);
    if (!future) {
      continue;
    }
    out[count++] = *e;
  }
  xSemaphoreGive(s_lock);
  return count;
}

esp_err_t calendar_add_event(const cal_event_t *event, uint16_t *id_out, int *pruned_out) {
  if (!event || !event->title[0]) {
    return ESP_ERR_INVALID_ARG;
  }
  if (event->cal >= (uint8_t)s_cal_count) {
    return ESP_ERR_INVALID_ARG;
  }
  if (event->start_min > 1439) {
    return ESP_ERR_INVALID_ARG;
  }

  cal_event_t clean = *event;
  if (clean.end_min == 0 && clean.start_min > 0) {
    clean.end_min = 1440;
  } else if (clean.end_min <= clean.start_min) {
    clean.end_min = clean.start_min + 60;
    if (clean.end_min > 1440) {
      clean.end_min = 1440;
    }
  }
  if (clean.end_min > 1440) {
    clean.end_min = 1440;
  }
  copy_utf8(clean.title, CAL_TITLE_BYTES, event->title);
  copy_utf8(clean.note, CAL_NOTE_BYTES, event->note);
  clean.flags = 0;

  xSemaphoreTake(s_lock, portMAX_DELAY);
  if (s_event_count >= CAL_MAX_EVENTS) {
    const int victim = find_oldest_past(0);
    if (victim >= 0) {
      remove_at(victim);
    }
  }
  if (s_event_count >= CAL_MAX_EVENTS) {
    xSemaphoreGive(s_lock);
    return ESP_ERR_NO_MEM;
  }

  /* Pick an id that is not currently in use. */
  uint16_t id = s_next_id;
  for (int guard = 0; guard < CAL_MAX_EVENTS + 1; guard++) {
    if (id == 0) {
      id = 1;
    }
    if (find_index_by_id(id) < 0) {
      break;
    }
    id++;
  }
  clean.id = id;
  s_next_id = id == 0xFFFF ? 1 : (uint16_t)(id + 1);

  insert_sorted(&clean);
  int pruned = 0;
  esp_err_t err = save_db_locked(id, &pruned);
  if (err != ESP_OK) {
    remove_at(find_index_by_id(id));
    xSemaphoreGive(s_lock);
    return err;
  }
  s_generation++;
  xSemaphoreGive(s_lock);

  if (id_out) {
    *id_out = id;
  }
  if (pruned_out) {
    *pruned_out = pruned;
  }
  return ESP_OK;
}

esp_err_t calendar_delete_event(uint16_t id) {
  xSemaphoreTake(s_lock, portMAX_DELAY);
  const int idx = find_index_by_id(id);
  if (idx < 0) {
    xSemaphoreGive(s_lock);
    return ESP_ERR_NOT_FOUND;
  }
  const cal_event_t removed = s_events[idx];
  remove_at(idx);
  const esp_err_t err = save_db_locked(0, NULL);
  if (err != ESP_OK) {
    insert_sorted(&removed);
  } else {
    s_generation++;
  }
  xSemaphoreGive(s_lock);
  return err;
}

uint32_t calendar_generation(void) { return s_generation; }

/* --- time --------------------------------------------------------------- */

int calendar_tz_minutes(void) { return s_tz_minutes; }

uint32_t calendar_now_epoch(void) {
  const time_t now = time(NULL);
  return now > 0 ? (uint32_t)now : 0;
}

uint32_t calendar_local_epoch(void) {
  const time_t now = time(NULL);
  if (now <= 0) {
    return 0;
  }
  return (uint32_t)((int64_t)now + (int64_t)s_tz_minutes * 60);
}

bool calendar_time_valid(void) {
  const time_t now = time(NULL);
  return now >= (time_t)EPOCH_2021;
}

bool calendar_time_synced(void) { return s_time_synced; }

uint16_t calendar_today(void) {
  if (!calendar_time_valid()) {
    return 0;
  }
  const time_t local = (time_t)((int64_t)time(NULL) + (int64_t)s_tz_minutes * 60);
  struct tm tm;
  if (!gmtime_r(&local, &tm)) {
    return 0;
  }
  const int days = calendar_days_from_civil(tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday);
  return days > 0 && days <= 0xFFFF ? (uint16_t)days : 0;
}

esp_err_t calendar_set_time(uint32_t epoch, int tz_minutes) {
  if (epoch < EPOCH_2021) {
    return ESP_ERR_INVALID_ARG;
  }
  if (tz_minutes < -720) {
    tz_minutes = -720;
  }
  if (tz_minutes > 840) {
    tz_minutes = 840;
  }
  struct timeval tv = {.tv_sec = (time_t)epoch, .tv_usec = 0};
  settimeofday(&tv, NULL);
  s_tz_minutes = tz_minutes;
  s_time_synced = true;
  s_generation++;

  esp_err_t err = ESP_OK;
  if (s_nvs_open) {
    esp_err_t e = nvs_set_i64(s_nvs, NVS_KEY_EPOCH, (int64_t)epoch);
    if (e == ESP_OK) {
      e = nvs_set_i32(s_nvs, NVS_KEY_TZ, tz_minutes);
    }
    if (e == ESP_OK) {
      e = nvs_commit(s_nvs);
    }
    err = e;
  }
  ESP_LOGI(TAG, "clock set to %u (tz %+d), persist: %s", (unsigned)epoch, tz_minutes,
           esp_err_to_name(err));
  return err;
}

void calendar_save_clock(void) {
  if (!s_nvs_open || !calendar_time_valid()) {
    return;
  }
  esp_err_t err = nvs_set_i64(s_nvs, NVS_KEY_EPOCH, (int64_t)time(NULL));
  if (err == ESP_OK) {
    err = nvs_set_i32(s_nvs, NVS_KEY_TZ, s_tz_minutes);
  }
  if (err == ESP_OK) {
    err = nvs_commit(s_nvs);
  }
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "clock persist failed: %s", esp_err_to_name(err));
  }
}

/* --- civil date helpers ------------------------------------------------- */

int calendar_days_from_civil(int year, int month, int day) {
  const int y = year - (month <= 2);
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (unsigned)((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1);
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int)doe - 719468;
}

void calendar_civil_from_days(int days, int *year, int *month, int *day) {
  const int z = days + 719468;
  const int era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int y = (int)yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  const unsigned d = doy - (153 * mp + 2) / 5 + 1;
  const unsigned m = mp + (mp < 10 ? 3 : -9);
  if (year) {
    *year = y + (m <= 2 ? 1 : 0);
  }
  if (month) {
    *month = (int)m;
  }
  if (day) {
    *day = (int)d;
  }
}

int calendar_weekday(uint16_t day) { return (int)(((uint32_t)day + 4u) % 7u); }

bool calendar_parse_date(const char *text, uint16_t *day) {
  if (!text || !day) {
    return false;
  }
  int y = 0, m = 0, d = 0;
  char trailing = 0;
  if (sscanf(text, "%d-%d-%d%c", &y, &m, &d, &trailing) != 3) {
    return false;
  }
  if (y < 1970 || y > 2149 || m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  int cy = 0, cm = 0, cd = 0;
  const int days = calendar_days_from_civil(y, m, d);
  calendar_civil_from_days(days, &cy, &cm, &cd);
  if (cy != y || cm != m || cd != d || days < 0 || days > 0xFFFF) {
    return false;
  }
  *day = (uint16_t)days;
  return true;
}

bool calendar_parse_time(const char *text, uint16_t *minutes) {
  if (!text || !minutes) {
    return false;
  }
  int h = 0, m = 0;
  char trailing = 0;
  if (sscanf(text, "%d:%d%c", &h, &m, &trailing) != 2) {
    return false;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return false;
  }
  *minutes = (uint16_t)(h * 60 + m);
  return true;
}

void calendar_format_date(uint16_t day, char *out, size_t len) {
  if (!out || len == 0) {
    return;
  }
  int y = 1970, m = 1, d = 1;
  calendar_civil_from_days(day, &y, &m, &d);
  snprintf(out, len, "%04d-%02d-%02d", y, m, d);
}

void calendar_format_time(uint16_t minutes, char *out, size_t len) {
  if (!out || len == 0) {
    return;
  }
  snprintf(out, len, "%02u:%02u", (unsigned)(minutes / 60), (unsigned)(minutes % 60));
}
