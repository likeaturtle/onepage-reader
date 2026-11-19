#include "ble_calendar.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "ble_auth.h"
#include "brand.h"
#include "calendar.h"
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/ble_hs.h"
#include "host/ble_store.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "store/config/ble_store_config.h"

void ble_store_config_init(void);

static const char *TAG = "ble_cal";

#define PROTO_VERSION 3
#define RX_BUF_SIZE 2048
#define LINE_BUF_SIZE 1024
#define NOTIFY_BUF_SIZE 1536
#define INNER_BUF_SIZE 1024
#define MAX_NOTIFY_CHUNK 180

/* The firmware version has exactly one source: version.txt at the project root.
 * ESP-IDF bakes it into the image as PROJECT_VER and exposes it through the app
 * description, so the `fw` field below and the image metadata cannot drift. */
static const char *fw_version(void) {
  const esp_app_desc_t *desc = esp_app_get_description();
  return (desc && desc->version[0]) ? desc->version : "unknown";
}

/* Little-endian byte order, as required by BLE_UUID128_INIT. The canonical
 * strings are in ble_calendar.h:
 *   6f6e6570-6167-6531-6361-6c656e646172  service
 *   6f6e6570-6167-6531-6361-000000000001  RX
 *   6f6e6570-6167-6531-6361-000000000002  TX
 *   6f6e6570-6167-6531-6361-000000000003  INFO */
static const ble_uuid128_t s_svc_uuid = BLE_UUID128_INIT(
    0x72, 0x61, 0x64, 0x6e, 0x65, 0x6c, 0x61, 0x63, 0x31, 0x65, 0x67, 0x61, 0x70, 0x65, 0x6e,
    0x6f);
static const ble_uuid128_t s_rx_uuid = BLE_UUID128_INIT(
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x63, 0x31, 0x65, 0x67, 0x61, 0x70, 0x65, 0x6e,
    0x6f);
static const ble_uuid128_t s_tx_uuid = BLE_UUID128_INIT(
    0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x63, 0x31, 0x65, 0x67, 0x61, 0x70, 0x65, 0x6e,
    0x6f);
static const ble_uuid128_t s_info_uuid = BLE_UUID128_INIT(
    0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x63, 0x31, 0x65, 0x67, 0x61, 0x70, 0x65, 0x6e,
    0x6f);

static uint16_t s_rx_handle;
static uint16_t s_tx_handle;
static uint16_t s_info_handle;

static uint8_t s_own_addr_type;
static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static volatile bool s_connected;
static volatile bool s_subscribed;
static volatile uint16_t s_mtu = BLE_ATT_MTU_DFLT;

static SemaphoreHandle_t s_lock;
static SemaphoreHandle_t s_wake;
static SemaphoreHandle_t s_stopped;
static uint8_t s_rx_buf[RX_BUF_SIZE];
static size_t s_rx_len;
static bool s_rx_overflow;
static char s_notify_line[NOTIFY_BUF_SIZE];
static char s_encrypted_line[NOTIFY_BUF_SIZE];
static char s_inner_line[INNER_BUF_SIZE];
static volatile bool s_hello_pending;
static volatile bool s_shutting_down;
static volatile bool s_stop_requested;
static bool s_inited;
static TaskHandle_t s_task;

static ble_calendar_callbacks_t s_callbacks;

/* --- access callback ---------------------------------------------------- */

static int gatt_access(uint16_t conn_handle, uint16_t attr_handle,
                       struct ble_gatt_access_ctxt *ctxt, void *arg) {
  (void)conn_handle;
  (void)arg;

  if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR && attr_handle == s_rx_handle) {
    const uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
    if (len == 0) {
      return 0;
    }
    if (len > 512) {
      return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    uint8_t tmp[512];
    uint16_t copied = 0;
    if (ble_hs_mbuf_to_flat(ctxt->om, tmp, sizeof(tmp), &copied) != 0) {
      return BLE_ATT_ERR_UNLIKELY;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_rx_len + copied > sizeof(s_rx_buf)) {
      s_rx_len = 0;
      s_rx_overflow = true;
    } else {
      memcpy(s_rx_buf + s_rx_len, tmp, copied);
      s_rx_len += copied;
    }
    xSemaphoreGive(s_lock);
    xSemaphoreGive(s_wake);
    return 0;
  }

  if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR && attr_handle == s_info_handle) {
    char json[256];
    const int n = snprintf(json, sizeof(json),
                           "{\"name\":\"%s\",\"fw\":\"%s\",\"proto\":%d,"
                           "\"events\":%d,\"calendars\":%d,\"time_valid\":%s}",
                           BRAND_NAME, fw_version(), PROTO_VERSION, calendar_event_count(),
                           calendar_count(),
                           calendar_time_valid() ? "true" : "false");
    if (n <= 0 || n >= (int)sizeof(json)) {
      return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (os_mbuf_append(ctxt->om, json, (uint16_t)n) != 0) {
      return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return 0;
  }

  return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def s_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &s_svc_uuid.u,
        .characteristics =
            (struct ble_gatt_chr_def[]){
                {
                    .uuid = &s_rx_uuid.u,
                    .access_cb = gatt_access,
                    .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
                    .val_handle = &s_rx_handle,
                },
                {
                    .uuid = &s_tx_uuid.u,
                    .access_cb = gatt_access,
                    .flags = BLE_GATT_CHR_F_NOTIFY,
                    .val_handle = &s_tx_handle,
                },
                {
                    .uuid = &s_info_uuid.u,
                    .access_cb = gatt_access,
                    .flags = BLE_GATT_CHR_F_READ,
                    .val_handle = &s_info_handle,
                },
                {0},
            },
    },
    {0},
};

/* --- JSON helpers ------------------------------------------------------- */

static void json_escape(char *dst, size_t cap, const char *src) {
  if (!dst || cap == 0) {
    return;
  }
  size_t out = 0;
  if (src) {
    for (const unsigned char *p = (const unsigned char *)src; *p && out + 7 < cap; p++) {
      switch (*p) {
        case '"':
          dst[out++] = '\\';
          dst[out++] = '"';
          break;
        case '\\':
          dst[out++] = '\\';
          dst[out++] = '\\';
          break;
        case '\n':
          dst[out++] = '\\';
          dst[out++] = 'n';
          break;
        case '\r':
          dst[out++] = '\\';
          dst[out++] = 'r';
          break;
        case '\t':
          dst[out++] = '\\';
          dst[out++] = 't';
          break;
        default:
          if (*p < 0x20) {
            const int n = snprintf(dst + out, cap - out, "\\u%04x", *p);
            if (n < 0) {
              dst[out] = '\0';
              return;
            }
            out += (size_t)n;
          } else {
            dst[out++] = (char)*p;
          }
          break;
      }
    }
  }
  dst[out] = '\0';
}

static bool notify_bytes(const char *data, size_t len) {
  if (s_shutting_down || !s_connected || !s_subscribed || s_tx_handle == 0 || len == 0) {
    return false;
  }
  const uint16_t mtu = s_mtu >= BLE_ATT_MTU_DFLT ? s_mtu : BLE_ATT_MTU_DFLT;
  size_t chunk = mtu > 3 ? (size_t)(mtu - 3) : (size_t)(BLE_ATT_MTU_DFLT - 3);
  if (chunk > MAX_NOTIFY_CHUNK) {
    chunk = MAX_NOTIFY_CHUNK;
  }

  for (size_t off = 0; off < len; off += chunk) {
    const size_t n = (len - off) < chunk ? (len - off) : chunk;
    int rc = BLE_HS_ENOMEM;
    for (int attempt = 0; attempt < 4 && rc != 0; attempt++) {
      struct os_mbuf *om = ble_hs_mbuf_from_flat(data + off, (uint16_t)n);
      if (!om) {
        rc = BLE_HS_ENOMEM;
      } else {
        rc = ble_gatts_notify_custom(s_conn_handle, s_tx_handle, om);
      }
      if (rc != 0) {
        vTaskDelay(pdMS_TO_TICKS(8));
      }
    }
    if (rc != 0) {
      ESP_LOGW(TAG, "notify failed: %d", rc);
      return false;
    }
    /* Give the host task room to drain the mbuf pool before the next chunk. */
    vTaskDelay(pdMS_TO_TICKS(3));
  }
  return true;
}

static void notify_json_plain(const char *json) {
  const int n = snprintf(s_notify_line, sizeof(s_notify_line), "%s\n", json);
  if (n <= 0) {
    return;
  }
  notify_bytes(s_notify_line, (size_t)n < sizeof(s_notify_line) ? (size_t)n
                                                               : sizeof(s_notify_line) - 1);
}

/* Every command response and event goes through here: after auth the JSON is
 * wrapped in an encrypted frame, before auth (hello/auth) it is plaintext. */
static void notify_json(const char *json) {
  if (!ble_auth_is_authed()) {
    notify_json_plain(json);
    return;
  }
  if (!ble_auth_encrypt_line(json, s_encrypted_line, sizeof(s_encrypted_line))) {
    ESP_LOGE(TAG, "frame encryption failed");
    return;
  }
  notify_json_plain(s_encrypted_line);
}

static void send_error(const char *message) {
  char json[128];
  snprintf(json, sizeof(json), "{\"ok\":false,\"error\":\"%s\"}", message);
  notify_json(json);
}

static void send_ack(const char *cmd) {
  char json[96];
  snprintf(json, sizeof(json), "{\"ok\":true,\"cmd\":\"%s\"}", cmd);
  notify_json(json);
}

static const char *get_string(cJSON *root, const char *key) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
  return cJSON_IsString(item) ? item->valuestring : NULL;
}

static bool get_number(cJSON *root, const char *key, double *out) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
  if (!cJSON_IsNumber(item) || !isfinite(item->valuedouble)) {
    return false;
  }
  *out = item->valuedouble;
  return true;
}

/* Resolves "cal" as an index or a calendar name. Missing => -1 (all). */
static void send_event(const cal_event_t *event) {
  char date[12];
  char start[6];
  char end[6];
  /* Sized for the full 95/191-byte fields even when every byte has to be
   * escaped (\" or \\ doubles it). */
  char title[200];
  char note[400];
  calendar_format_date(event->day, date, sizeof(date));
  calendar_format_time(event->start_min, start, sizeof(start));
  calendar_format_time(event->end_min, end, sizeof(end));
  json_escape(title, sizeof(title), event->title);
  json_escape(note, sizeof(note), event->note);

  char json[768];
  snprintf(json, sizeof(json),
           "{\"ev\":\"ev\",\"id\":%u,\"cal\":%u,\"date\":\"%s\",\"start\":\"%s\","
           "\"end\":\"%s\",\"title\":\"%s\",\"note\":\"%s\"}",
           (unsigned)event->id, (unsigned)event->cal, date, start, end, title, note);
  notify_json(json);
}

static void send_hello(void) {
  if (!ble_auth_is_authed()) {
    char hello[360];
    const int n = snprintf(
        hello, sizeof(hello),
        "{\"ev\":\"hello\",\"proto\":%d,\"fw\":\"%s\",\"name\":\"%s\",\"did\":\"%s\","
        "\"auth\":true,\"paired\":%s,\"pairing\":%s,\"nonce\":\"%s\"}",
        PROTO_VERSION, fw_version(), BRAND_NAME, ble_auth_did(),
        ble_auth_has_key() ? "true" : "false",
        ble_auth_pairing_active() ? "true" : "false", ble_auth_nonce_hex());
    if (n > 0 && n < (int)sizeof(hello)) {
      notify_json_plain(hello);
    }
    return;
  }

  char cals[420];
  size_t off = 0;
  cals[0] = '\0';
  for (int i = 0; i < calendar_count() && off + 32 < sizeof(cals); i++) {
    char name[64];
    json_escape(name, sizeof(name), calendar_name(i));
    const int n = snprintf(cals + off, sizeof(cals) - off, "%s\"%s\"", i ? "," : "", name);
    if (n < 0 || (size_t)n >= sizeof(cals) - off) {
      break;
    }
    off += (size_t)n;
  }

  char json[800];
  const int n = snprintf(
      json, sizeof(json),
      "{\"ev\":\"hello\",\"proto\":%d,\"fw\":\"%s\",\"name\":\"%s\",\"did\":\"%s\","
      "\"auth\":true,\"authed\":true,"
      "\"now\":%u,\"tz\":%d,\"time_valid\":%s,\"time_synced\":%s,\"events\":%d,"
      "\"calendars\":%d,\"cals\":[%s]}",
      PROTO_VERSION, fw_version(), BRAND_NAME, ble_auth_did(),
      (unsigned)calendar_now_epoch(), calendar_tz_minutes(),
      calendar_time_valid() ? "true" : "false",
      calendar_time_synced() ? "true" : "false", calendar_event_count(), calendar_count(),
      cals);
  if (n > 0 && n < (int)sizeof(json)) {
    notify_json(json);
  }
}

/* --- command handlers --------------------------------------------------- */

static void handle_hello(cJSON *root) {
  (void)root;
  send_hello();
}

static void handle_time(cJSON *root) {
  double epoch = 0;
  double tz = 0;
  if (!get_number(root, "epoch", &epoch) || epoch < 1609459200.0 ||
      epoch > 4294967295.0) {
    send_error("bad epoch");
    return;
  }
  if (!get_number(root, "tz", &tz)) {
    tz = calendar_tz_minutes();
  }
  /* settimeofday() happens even if the NVS write fails; the clock is still
   * correct for this session, so report success with a persistence flag. */
  const esp_err_t err = calendar_set_time((uint32_t)epoch, (int)tz);
  char local[64];
  const time_t local_epoch = (time_t)calendar_local_epoch();
  struct tm tm = {0};
  if (gmtime_r(&local_epoch, &tm)) {
    snprintf(local, sizeof(local), "%04d-%02d-%02d %02d:%02d", tm.tm_year + 1900,
             tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min);
  } else {
    snprintf(local, sizeof(local), "?");
  }
  char json[128];
  snprintf(json, sizeof(json),
           "{\"ok\":true,\"cmd\":\"time\",\"local\":\"%s\",\"persist\":%s}", local,
           err == ESP_OK ? "true" : "false");
  notify_json(json);
  if (s_callbacks.on_change) {
    s_callbacks.on_change();
  }
}

static void handle_list(cJSON *root) {
  /* Single-calendar build: any cal field is ignored. */
  const int cal = 0;
  uint16_t from_day = 0;
  uint16_t to_day = 0xFFFF;
  const char *from = get_string(root, "from");
  const char *to = get_string(root, "to");
  if (from && !calendar_parse_date(from, &from_day)) {
    send_error("bad from date");
    return;
  }
  if (to && !calendar_parse_date(to, &to_day)) {
    send_error("bad to date");
    return;
  }
  if (from_day > to_day) {
    send_error("empty range");
    return;
  }

  cal_event_t *events =
      heap_caps_malloc((size_t)CAL_MAX_EVENTS * sizeof(cal_event_t),
                       MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!events) {
    events = malloc((size_t)CAL_MAX_EVENTS * sizeof(cal_event_t));
  }
  if (!events) {
    send_error("out of memory");
    return;
  }
  const int count = calendar_events_range(cal, from_day, to_day, events, CAL_MAX_EVENTS);
  ESP_LOGD(TAG, "list cal=%d %u..%u -> %d", cal, (unsigned)from_day, (unsigned)to_day, count);
  for (int i = 0; i < count; i++) {
    send_event(&events[i]);
  }
  free(events);

  char json[64];
  snprintf(json, sizeof(json), "{\"ev\":\"done\",\"n\":%d}", count);
  notify_json(json);
}

/* Parses the fields shared by add and update. `title_out`/`note_out` point into
 * the cJSON tree, so callers can report truncation without copying them again. */
static bool parse_event(cJSON *root, cal_event_t *event, const char **title_out,
                        const char **note_out) {
  /* Single-calendar build: everything is filed into calendar 0. */
  const char *date = get_string(root, "date");
  const char *start = get_string(root, "start");
  const char *title = get_string(root, "title");
  const char *end = get_string(root, "end");
  const char *note = get_string(root, "note");

  uint16_t day = 0;
  uint16_t start_min = 0;
  uint16_t end_min = 0;
  if (!date || !calendar_parse_date(date, &day)) {
    send_error("bad date");
    return false;
  }
  if (!start || !calendar_parse_time(start, &start_min)) {
    send_error("bad start");
    return false;
  }
  if (end && end[0] && !calendar_parse_time(end, &end_min)) {
    send_error("bad end");
    return false;
  }
  if (!title || !title[0]) {
    send_error("empty title");
    return false;
  }

  memset(event, 0, sizeof(*event));
  event->cal = 0;
  event->day = day;
  event->start_min = start_min;
  event->end_min = end_min;
  snprintf(event->title, sizeof(event->title), "%s", title);
  snprintf(event->note, sizeof(event->note), "%s", note ? note : "");
  if (title_out) {
    *title_out = title;
  }
  if (note_out) {
    *note_out = note;
  }
  return true;
}

static bool event_truncated(const char *title, const char *note) {
  return strlen(title) >= CAL_TITLE_BYTES || (note && strlen(note) >= CAL_NOTE_BYTES);
}

static void handle_add(cJSON *root) {
  cal_event_t event;
  const char *title = NULL;
  const char *note = NULL;
  if (!parse_event(root, &event, &title, &note)) {
    return;
  }

  uint16_t id = 0;
  int pruned = 0;
  const esp_err_t err = calendar_add_event(&event, &id, &pruned);
  if (err == ESP_ERR_NO_MEM) {
    send_error("calendar full");
    return;
  }
  if (err != ESP_OK) {
    send_error("save failed");
    return;
  }

  ESP_LOGD(TAG, "add id=%u day=%u start=%u end=%u", (unsigned)id, (unsigned)event.day,
           (unsigned)event.start_min, (unsigned)event.end_min);
  char json[160];
  snprintf(json, sizeof(json),
           "{\"ok\":true,\"cmd\":\"add\",\"id\":%u,\"pruned\":%d,\"trunc\":%s}",
           (unsigned)id, pruned, event_truncated(title, note) ? "true" : "false");
  notify_json(json);
  if (s_callbacks.on_change) {
    s_callbacks.on_change();
  }
}

static void handle_update(cJSON *root) {
  double id = 0;
  if (!get_number(root, "id", &id) || id < 1 || id > 65535) {
    send_error("bad id");
    return;
  }
  cal_event_t event;
  const char *title = NULL;
  const char *note = NULL;
  if (!parse_event(root, &event, &title, &note)) {
    return;
  }

  const esp_err_t err = calendar_update_event((uint16_t)id, &event);
  if (err == ESP_ERR_NOT_FOUND) {
    send_error("not found");
    return;
  }
  if (err != ESP_OK) {
    send_error("save failed");
    return;
  }

  ESP_LOGD(TAG, "update id=%u day=%u start=%u end=%u", (unsigned)id, (unsigned)event.day,
           (unsigned)event.start_min, (unsigned)event.end_min);
  char json[160];
  snprintf(json, sizeof(json),
           "{\"ok\":true,\"cmd\":\"update\",\"id\":%u,\"trunc\":%s}", (unsigned)id,
           event_truncated(title, note) ? "true" : "false");
  notify_json(json);
  if (s_callbacks.on_change) {
    s_callbacks.on_change();
  }
}

static void handle_delete(cJSON *root) {
  double id = 0;
  if (!get_number(root, "id", &id) || id < 1 || id > 65535) {
    send_error("bad id");
    return;
  }
  const esp_err_t err = calendar_delete_event((uint16_t)id);
  if (err == ESP_ERR_NOT_FOUND) {
    send_error("not found");
    return;
  }
  if (err != ESP_OK) {
    send_error("save failed");
    return;
  }
  char json[96];
  snprintf(json, sizeof(json), "{\"ok\":true,\"cmd\":\"del\",\"id\":%u}", (unsigned)id);
  notify_json(json);
  if (s_callbacks.on_change) {
    s_callbacks.on_change();
  }
}

static void handle_ping(cJSON *root) {
  (void)root;
  char json[128];
  snprintf(json, sizeof(json),
           "{\"ok\":true,\"cmd\":\"ping\",\"uptime_ms\":%u,\"heap\":%u}",
           (unsigned)(esp_timer_get_time() / 1000),
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
  notify_json(json);
}

static void handle_sleep(cJSON *root) {
  (void)root;
  send_ack("sleep");
  vTaskDelay(pdMS_TO_TICKS(80));
  if (s_callbacks.on_sleep_request) {
    s_callbacks.on_sleep_request();
  }
}

static void dispatch_command(cJSON *root, const char *cmd) {
  if (strcmp(cmd, "hello") == 0) {
    handle_hello(root);
  } else if (strcmp(cmd, "time") == 0) {
    handle_time(root);
  } else if (strcmp(cmd, "list") == 0) {
    handle_list(root);
  } else if (strcmp(cmd, "add") == 0) {
    handle_add(root);
  } else if (strcmp(cmd, "update") == 0) {
    handle_update(root);
  } else if (strcmp(cmd, "del") == 0) {
    handle_delete(root);
  } else if (strcmp(cmd, "ping") == 0) {
    handle_ping(root);
  } else if (strcmp(cmd, "sleep") == 0) {
    handle_sleep(root);
  } else {
    send_error("unknown cmd");
  }
}

static void process_line(const char *line) {
  cJSON *root = cJSON_Parse(line);
  if (!root) {
    send_error("bad json");
    return;
  }
  const char *cmd = get_string(root, "cmd");

  if (!ble_auth_is_authed()) {
    if (cmd && strcmp(cmd, "auth") == 0) {
      char response[320];
      bool paired_now = false;
      ble_auth_handle_auth(root, response, sizeof(response), &paired_now);
      (void)paired_now;
      notify_json_plain(response);
    } else if (cmd && strcmp(cmd, "hello") == 0) {
      handle_hello(root);
    } else {
      send_error("auth required");
    }
    cJSON_Delete(root);
    return;
  }

  /* Once authenticated every command is an encrypted wrapper object. */
  if (cmd || !cJSON_GetObjectItemCaseSensitive(root, "s")) {
    send_error("encrypted frame required");
    cJSON_Delete(root);
    return;
  }
  if (!ble_auth_decrypt_frame(root, s_inner_line, sizeof(s_inner_line))) {
    send_error("bad frame");
    cJSON_Delete(root);
    return;
  }
  cJSON_Delete(root);

  root = cJSON_Parse(s_inner_line);
  if (!root) {
    send_error("bad json");
    return;
  }
  cmd = get_string(root, "cmd");
  if (!cmd) {
    send_error("missing cmd");
    cJSON_Delete(root);
    return;
  }
  dispatch_command(root, cmd);
  cJSON_Delete(root);
}

/* --- RX task ------------------------------------------------------------ */

static void rx_task(void *arg) {
  (void)arg;
  for (;;) {
    xSemaphoreTake(s_wake, portMAX_DELAY);

    if (s_stop_requested) {
      /* The host is being torn down. Leave the NVS/flash work to finish
       * before acknowledging, so a deep sleep cannot cut a write in half. */
      xSemaphoreGive(s_stopped);
      vTaskDelete(NULL);
    }

    if (s_hello_pending && s_connected && s_subscribed) {
      s_hello_pending = false;
      send_hello();
    }

    for (;;) {
      if (s_stop_requested) {
        break;
      }
      char line[LINE_BUF_SIZE];
      size_t len = 0;
      bool overflow = false;
      xSemaphoreTake(s_lock, portMAX_DELAY);
      if (s_rx_overflow) {
        s_rx_overflow = false;
        s_rx_len = 0;
        overflow = true;
      }
      const uint8_t *newline = memchr(s_rx_buf, '\n', s_rx_len);
      if (newline) {
        len = (size_t)(newline - s_rx_buf);
        const size_t consumed = len + 1;
        if (len >= sizeof(line)) {
          len = sizeof(line) - 1;
          overflow = true;
        }
        memcpy(line, s_rx_buf, len);
        memmove(s_rx_buf, s_rx_buf + consumed, s_rx_len - consumed);
        s_rx_len -= consumed;
      }
      xSemaphoreGive(s_lock);

      if (overflow) {
        send_error("line too long");
      }
      if (!newline) {
        break;
      }
      line[len] = '\0';
      /* Tolerate CRLF from a desktop test client. */
      if (len > 0 && line[len - 1] == '\r') {
        line[len - 1] = '\0';
      }
      if (line[0]) {
        process_line(line);
      }
    }

    if (s_stop_requested) {
      xSemaphoreGive(s_stopped);
      vTaskDelete(NULL);
    }
  }
}

/* --- GAP ---------------------------------------------------------------- */

static int gap_event(struct ble_gap_event *event, void *arg);

static void fire_conn(void) {
  if (s_callbacks.on_conn) {
    s_callbacks.on_conn(s_connected, s_subscribed);
  }
}

static void start_advertising(void) {
  if (s_shutting_down) {
    return;
  }

  struct ble_hs_adv_fields fields = {0};
  fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
  fields.uuids128 = &s_svc_uuid;
  fields.num_uuids128 = 1;
  fields.uuids128_is_complete = 1;
  int rc = ble_gap_adv_set_fields(&fields);
  if (rc != 0) {
    ESP_LOGW(TAG, "adv fields: %d", rc);
  }

  static const char *name = BRAND_DEVICE_NAME;
  struct ble_hs_adv_fields rsp = {0};
  rsp.name = (const uint8_t *)name;
  rsp.name_len = (uint8_t)strlen(name);
  rsp.name_is_complete = 1;
  rc = ble_gap_adv_rsp_set_fields(&rsp);
  if (rc != 0) {
    ESP_LOGW(TAG, "scan response: %d", rc);
  }

  struct ble_gap_adv_params params = {0};
  params.conn_mode = BLE_GAP_CONN_MODE_UND;
  params.disc_mode = BLE_GAP_DISC_MODE_GEN;
  /* Slow advertising: a phone needs seconds, not milliseconds, to find the
   * device, and every advertising event costs radio current. */
  params.itvl_min = BLE_GAP_ADV_ITVL_MS(300);
  params.itvl_max = BLE_GAP_ADV_ITVL_MS(350);
  rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
  if (rc != 0 && rc != BLE_HS_EALREADY) {
    ESP_LOGW(TAG, "adv start: %d", rc);
  } else {
    ESP_LOGI(TAG, "advertising as \"%s\"", name);
  }
}

static void request_connection_params(void) {
  struct ble_gap_upd_params params = {
      .itvl_min = 24,             /* 30 ms */
      .itvl_max = 40,             /* 50 ms */
      .latency = 0,
      .supervision_timeout = 400, /* 4 s */
      .min_ce_len = 0,
      .max_ce_len = 0,
  };
  const int rc = ble_gap_update_params(s_conn_handle, &params);
  if (rc != 0 && rc != BLE_HS_EALREADY) {
    ESP_LOGD(TAG, "conn params: %d", rc);
  }
}

static int gap_event(struct ble_gap_event *event, void *arg) {
  (void)arg;
  switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
      if (event->connect.status != 0) {
        ESP_LOGW(TAG, "connection failed: %d", event->connect.status);
        start_advertising();
        return 0;
      }
      s_conn_handle = event->connect.conn_handle;
      s_connected = true;
      s_subscribed = false;
      s_mtu = ble_att_mtu(s_conn_handle);
      ble_auth_reset_session();
      xSemaphoreTake(s_lock, portMAX_DELAY);
      s_rx_len = 0;
      s_rx_overflow = false;
      xSemaphoreGive(s_lock);
      ESP_LOGI(TAG, "connected, MTU %u", (unsigned)s_mtu);
      request_connection_params();
      fire_conn();
      return 0;

    case BLE_GAP_EVENT_DISCONNECT:
      ESP_LOGI(TAG, "disconnected (reason %d)", event->disconnect.reason);
      s_connected = false;
      s_subscribed = false;
      s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
      s_hello_pending = false;
      ble_auth_reset_session();
      xSemaphoreTake(s_lock, portMAX_DELAY);
      s_rx_len = 0;
      s_rx_overflow = false;
      xSemaphoreGive(s_lock);
      fire_conn();
      if (!s_shutting_down) {
        start_advertising();
      }
      return 0;

    case BLE_GAP_EVENT_ADV_COMPLETE:
      if (!s_connected && !s_shutting_down) {
        start_advertising();
      }
      return 0;

    case BLE_GAP_EVENT_SUBSCRIBE:
      if (event->subscribe.attr_handle == s_tx_handle) {
        s_subscribed = event->subscribe.cur_notify;
        ESP_LOGI(TAG, "notifications %s", s_subscribed ? "on" : "off");
        if (s_subscribed) {
          /* Keep the nonce issued on connect: resetting it here could race
           * with an early hello write and invalidate the client's proof. */
          s_hello_pending = true;
          xSemaphoreGive(s_wake);
        }
        fire_conn();
      }
      return 0;

    case BLE_GAP_EVENT_MTU:
      s_mtu = event->mtu.value;
      ESP_LOGI(TAG, "MTU updated to %u", (unsigned)s_mtu);
      return 0;

    case BLE_GAP_EVENT_CONN_UPDATE:
      if (event->conn_update.status == 0) {
        ESP_LOGI(TAG, "connection parameters updated");
      }
      return 0;

    default:
      return 0;
  }
}

static void on_reset(int reason) {
  ESP_LOGW(TAG, "host reset, reason %d", reason);
  s_connected = false;
  s_subscribed = false;
  s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
  ble_auth_reset_session();
  fire_conn();
}

static void on_sync(void) {
  int rc = ble_hs_util_ensure_addr(0);
  if (rc != 0) {
    ESP_LOGE(TAG, "no usable BLE address: %d", rc);
    return;
  }
  rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
  if (rc != 0) {
    ESP_LOGE(TAG, "address type: %d", rc);
    return;
  }
  start_advertising();
}

static void host_task(void *param) {
  (void)param;
  ESP_LOGI(TAG, "NimBLE host task started");
  nimble_port_run();
  nimble_port_freertos_deinit();
}

/* --- public API --------------------------------------------------------- */

esp_err_t ble_calendar_init(void) {
  if (s_inited) {
    return ESP_OK;
  }
  s_lock = xSemaphoreCreateMutex();
  s_wake = xSemaphoreCreateBinary();
  s_stopped = xSemaphoreCreateBinary();
  if (!s_lock || !s_wake || !s_stopped) {
    return ESP_ERR_NO_MEM;
  }

  const esp_err_t auth_err = ble_auth_init();
  if (auth_err != ESP_OK) {
    ESP_LOGW(TAG, "auth init: %s", esp_err_to_name(auth_err));
  }

  esp_err_t err = nimble_port_init();
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "nimble_port_init: %s", esp_err_to_name(err));
    return err;
  }

  ble_hs_cfg.reset_cb = on_reset;
  ble_hs_cfg.sync_cb = on_sync;
  ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
  ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_NO_IO;
  ble_hs_cfg.sm_bonding = 0;
  ble_hs_cfg.sm_mitm = 0;
  ble_hs_cfg.sm_sc = 0;

  ble_svc_gap_init();
  ble_svc_gatt_init();

  int rc = ble_gatts_count_cfg(s_svcs);
  if (rc != 0) {
    ESP_LOGE(TAG, "ble_gatts_count_cfg: %d", rc);
    return ESP_FAIL;
  }
  rc = ble_gatts_add_svcs(s_svcs);
  if (rc != 0) {
    ESP_LOGE(TAG, "ble_gatts_add_svcs: %d", rc);
    return ESP_FAIL;
  }
  rc = ble_svc_gap_device_name_set(BRAND_DEVICE_NAME);
  if (rc != 0) {
    ESP_LOGW(TAG, "device name set: %d", rc);
  }
  ble_att_set_preferred_mtu(247);
  ble_store_config_init();

  if (xTaskCreate(rx_task, "ble_cal", 6144, NULL, 5, &s_task) != pdPASS) {
    ESP_LOGE(TAG, "cannot create BLE task");
    return ESP_ERR_NO_MEM;
  }
  nimble_port_freertos_init(host_task);
  s_inited = true;
  ESP_LOGI(TAG, "BLE calendar service ready");
  return ESP_OK;
}

void ble_calendar_set_callbacks(const ble_calendar_callbacks_t *callbacks) {
  if (callbacks) {
    s_callbacks = *callbacks;
  } else {
    memset(&s_callbacks, 0, sizeof(s_callbacks));
  }
}

bool ble_calendar_connected(void) { return s_connected; }

bool ble_calendar_subscribed(void) { return s_subscribed; }

uint16_t ble_calendar_mtu(void) { return s_mtu; }

bool ble_calendar_start_pairing(bool clear_key) {
  /* The pairing code is verified by the BLE task; keep the key/NVS writes out
   * of a live authenticated session. */
  if (s_connected) {
    return false;
  }
  return ble_auth_start_pairing(clear_key) == ESP_OK;
}

void ble_calendar_cancel_pairing(void) {
  ble_auth_cancel_pairing();
}

bool ble_calendar_pairing_active(void) {
  return ble_auth_pairing_active();
}

bool ble_calendar_pairing_code(char *out, size_t out_len) {
  return ble_auth_pairing_code(out, out_len);
}

bool ble_calendar_take_pairing_succeeded(void) {
  return ble_auth_take_pairing_succeeded();
}

bool ble_calendar_has_key(void) {
  return ble_auth_has_key();
}

void ble_calendar_shutdown(void) {
  if (!s_inited) {
    return;
  }
  s_shutting_down = true;
  s_hello_pending = false;
  s_stop_requested = true;
  ble_auth_reset_session();
  xSemaphoreGive(s_wake);
  if (xSemaphoreTake(s_stopped, pdMS_TO_TICKS(1500)) != pdTRUE) {
    ESP_LOGW(TAG, "RX task did not stop in time");
  }
  /* Stop the TX task from queueing notifications while the host is going
   * away, but keep the connection handle for the terminate call below. */
  const uint16_t conn = s_conn_handle;
  s_connected = false;
  s_subscribed = false;
  if (conn != BLE_HS_CONN_HANDLE_NONE) {
    ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
    vTaskDelay(pdMS_TO_TICKS(120));
  }
  ble_gap_adv_stop();
  const esp_err_t stop_err = nimble_port_stop();
  if (stop_err != ESP_OK) {
    ESP_LOGW(TAG, "nimble_port_stop: %s", esp_err_to_name(stop_err));
  }
  vTaskDelay(pdMS_TO_TICKS(50));
  const esp_err_t deinit_err = nimble_port_deinit();
  if (deinit_err != ESP_OK) {
    ESP_LOGW(TAG, "nimble_port_deinit: %s", esp_err_to_name(deinit_err));
  }
  s_connected = false;
  s_subscribed = false;
  s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
  s_inited = false;
  ESP_LOGI(TAG, "BLE shut down");
}
