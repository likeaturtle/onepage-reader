/*
 * OnePage C61 calendar.
 *
 * The panel is an e-ink display, so the UI is a small state machine that only
 * repaints when something actually changed. BLE runs in its own NimBLE task;
 * keys are sampled by a dedicated task so a click is not lost while a panel
 * refresh blocks the UI task.
 */

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "ble_calendar.h"
#include "board_buttons.h"
#include "board_power.h"
#include "calendar.h"
#include "calendar_ui.h"
#include "epd_ssd1677.h"
#include "onepage_pins.h"
#include "sdkconfig.h"

#include "esp_log.h"
#include "esp_pm.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"

static const char *TAG = "calendar-app";

#define KEY_SCAN_MS 15
#define CLICK_MIN_US (25LL * 1000)
#define POWER_CLICK_MIN_US (30LL * 1000)
#define POWER_HOLD_US (2LL * 1000 * 1000)
#define ARROW_REPEAT_DELAY_US (500LL * 1000)
#define ARROW_REPEAT_PERIOD_US (180LL * 1000)
#define UI_MIN_REDRAW_US (120LL * 1000)
#define BATTERY_POLL_US (60LL * 1000 * 1000)
#define BATTERY_REDRAW_PCT 5
#define AUTO_SLEEP_US (180LL * 1000 * 1000)
#define AUTO_SLEEP_CONNECTED_US (600LL * 1000 * 1000)
#define CLEAN_REFRESH_EVERY 12
#define TOAST_MS 1600

typedef enum {
  VIEW_MONTH = 0,
  VIEW_DAY,
  VIEW_DETAIL,
  VIEW_DELETE,
} app_view_t;

typedef enum {
  KEY_CLICK = 0,
  KEY_REPEAT,
  KEY_POWER_HOLD,
} key_type_t;

typedef struct {
  uint8_t button;
  uint8_t type;
} key_event_t;

static struct {
  app_view_t view;
  uint16_t day;
  int selected;
  uint16_t detail_id;
  bool follow_today;
  volatile bool dirty;
  volatile bool sleep_requested;
  volatile bool ble_connected;
  volatile bool ble_subscribed;
  bool ble_started;
  uint8_t battery_pct;
  bool battery_valid;
  uint16_t battery_mv;
  bool usb;
  int64_t last_input_us;
  int64_t last_render_us;
  int64_t last_battery_us;
  int64_t battery_retry_us;
  uint8_t battery_retry_count;
  uint32_t refresh_count;
  char toast[48];
  int64_t toast_until_us;
} s_app;

static cal_event_t s_day_events[CAL_MAX_DAY_EVENTS];
static int s_day_count;
static uint8_t s_month_counts[42];
static volatile bool s_calendar_dirty;
static volatile bool s_ble_activity;
static uint32_t s_last_generation;
static QueueHandle_t s_key_queue;
static int64_t s_last_alive_us;

/* --- helpers ------------------------------------------------------------ */

static int64_t now_us(void) { return esp_timer_get_time(); }

static bool is_arrow(uint8_t button) {
  return button == BOARD_BTN_LEFT || button == BOARD_BTN_RIGHT ||
         button == BOARD_BTN_UP || button == BOARD_BTN_DOWN;
}

static void set_toast(const char *text) {
  snprintf(s_app.toast, sizeof(s_app.toast), "%s", text ? text : "");
  s_app.toast_until_us = now_us() + (int64_t)TOAST_MS * 1000;
}

static void mark_dirty(void) {
  s_app.dirty = true;
  s_app.last_input_us = now_us();
}

static void fill_status(ui_status_t *status) {
  status->time_valid = calendar_time_valid();
  status->time_synced = calendar_time_synced();
  status->local_epoch = calendar_local_epoch();
  status->battery_pct = s_app.battery_pct;
  status->battery_valid = s_app.battery_valid;
  status->usb = s_app.usb;
  status->ble_available = s_app.ble_started;
  status->ble_connected = s_app.ble_connected;
  status->ble_subscribed = s_app.ble_subscribed;
}

static void refresh_battery(bool force) {
  const int64_t now = now_us();
  if (!force && now - s_app.last_battery_us < BATTERY_POLL_US) {
    return;
  }
  s_app.last_battery_us = now;
  const uint16_t mv = board_battery_read_mv();
  /* Sample the key node only after the battery burst, so switching the ADC
   * mux to channel 2 cannot contaminate the battery's first conversion. */
  (void)board_buttons_poll();
  const uint8_t pct = board_battery_percent(mv);
  const bool usb = board_usb_connected();
  const bool battery_ok = mv >= 3000 && mv <= 4400;

  /* The first sample after power-up can still be charging from the charger's
   * start-up transient (the 60 s poll is normal). Re-read with backoff and
   * repaint as soon as the pack voltage is in the 1S range. */
  s_app.battery_mv = mv;
  if (battery_ok) {
    s_app.battery_valid = true;
    s_app.battery_retry_us = 0;
    s_app.battery_retry_count = 0;
  } else if (s_app.battery_retry_count < 5 && s_app.battery_retry_us == 0) {
    s_app.battery_retry_us =
        now + ((int64_t)2 << s_app.battery_retry_count) * 1000 * 1000;
    s_app.battery_retry_count++;
  }

  const int delta = (int)pct - (int)s_app.battery_pct;
  if (force || usb != s_app.usb || delta >= BATTERY_REDRAW_PCT || delta <= -BATTERY_REDRAW_PCT) {
    /* One line per real change makes a 0% report diagnosable: 3200 mV is a cell
     * at the bottom of the curve, while ~6200 mV means the ADC is seeing the
     * front-key ladder (3.1 V pin) instead of the battery divider. */
    if (battery_ok) {
      ESP_LOGI(TAG, "battery: %u mV -> %u%% (usb=%d)", (unsigned)mv, (unsigned)pct,
               usb ? 1 : 0);
    } else {
      ESP_LOGI(TAG, "battery: %u mV -> --%% (usb=%d, waiting for a valid sample)",
               (unsigned)mv, usb ? 1 : 0);
    }
    if (force) {
      /* The front-key node is a convenient second voltage on the same ADC1
       * unit. If both nodes read ~3.0 V, the battery channel is looking at the
       * key ladder (swapped/miswired divider) rather than the 1:1 divider. */
      ESP_LOGI(TAG, "ADC probe: front-key node %d mV, battery node %u mV",
               board_buttons_last_adc_mv(), (unsigned)(mv / 2));
    }
    if (mv < 2500 || mv > 4400) {
      ESP_LOGW(TAG, "battery voltage %u mV is outside a 1S LiPo range; check the ADC wiring",
               (unsigned)mv);
    }
    if (battery_ok) {
      s_app.battery_pct = pct;
    }
    s_app.usb = usb;
    if (!force) {
      s_app.dirty = true;
    }
  }
}

static bool update_follow_today(void) {
  if (!s_app.follow_today) {
    return false;
  }
  const uint16_t today = calendar_today();
  if (today != 0 && today != s_app.day) {
    s_app.day = today;
    s_app.selected = 0;
    return true;
  }
  return false;
}

static void load_day_events(void) {
  s_day_count =
      calendar_events_on_day(0, s_app.day, s_day_events, CAL_MAX_DAY_EVENTS);
  if (s_app.selected >= s_day_count) {
    s_app.selected = s_day_count > 0 ? s_day_count - 1 : 0;
  }
  if (s_app.selected < 0) {
    s_app.selected = 0;
  }
}

/* --- callbacks from the BLE task --------------------------------------- */

static void on_ble_change(void) {
  ESP_LOGD(TAG, "BLE data changed");
  s_calendar_dirty = true;
  s_ble_activity = true;
}

static void on_ble_conn(bool connected, bool subscribed) {
  ESP_LOGD(TAG, "BLE conn=%d sub=%d", connected, subscribed);
  s_app.ble_connected = connected;
  s_app.ble_subscribed = subscribed;
  s_ble_activity = true;
  s_app.dirty = true;
}

static void on_ble_sleep_request(void) { s_app.sleep_requested = true; }

/* --- key scanner -------------------------------------------------------- */

static void post_key(uint8_t button, key_type_t type) {
  const key_event_t event = {.button = button, .type = (uint8_t)type};
  if (s_key_queue) {
    xQueueSend(s_key_queue, &event, 0);
  }
}

static void key_task(void *arg) {
  (void)arg;
  uint32_t previous = board_buttons_poll();
  int64_t pressed_us[BOARD_BTN_COUNT] = {0};
  int64_t last_repeat_us[BOARD_BTN_COUNT] = {0};
  bool power_hold_sent = false;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(KEY_SCAN_MS));
    const int64_t now = now_us();
    const uint32_t mask = board_buttons_poll();

    for (int i = 0; i < BOARD_BTN_COUNT; i++) {
      const bool was = (previous & (1u << i)) != 0;
      const bool is = (mask & (1u << i)) != 0;
      if (is && !was) {
        ESP_LOGD(TAG, "key %s down", board_button_name(i));
        pressed_us[i] = now;
        last_repeat_us[i] = now;
        if (is_arrow((uint8_t)i)) {
          post_key((uint8_t)i, KEY_CLICK);
        }
      } else if (is && was && pressed_us[i] != 0) {
        if (i == BOARD_BTN_POWER && !power_hold_sent &&
            now - pressed_us[i] >= POWER_HOLD_US) {
          power_hold_sent = true;
          post_key((uint8_t)i, KEY_POWER_HOLD);
        } else if (is_arrow((uint8_t)i) && now - pressed_us[i] >= ARROW_REPEAT_DELAY_US &&
                   now - last_repeat_us[i] >= ARROW_REPEAT_PERIOD_US) {
          last_repeat_us[i] = now;
          post_key((uint8_t)i, KEY_REPEAT);
        }
      } else if (!is && was) {
        const int64_t held = pressed_us[i] ? now - pressed_us[i] : 0;
        ESP_LOGD(TAG, "key %s up (%lld ms)", board_button_name(i), held / 1000);
        pressed_us[i] = 0;
        if (i == BOARD_BTN_POWER) {
          if (!power_hold_sent && held >= POWER_CLICK_MIN_US) {
            post_key((uint8_t)i, KEY_CLICK);
          }
          power_hold_sent = false;
        } else if (!is_arrow((uint8_t)i) && held >= CLICK_MIN_US) {
          post_key((uint8_t)i, KEY_CLICK);
        }
      }
    }
    previous = mask;
  }
}

/* --- rendering ---------------------------------------------------------- */

static void build_month_view(ui_month_t *view) {
  int year = 1970, month = 1, day = 1;
  calendar_civil_from_days(s_app.day, &year, &month, &day);
  const uint16_t first = (uint16_t)calendar_days_from_civil(year, month, 1);
  const int weekday = calendar_weekday(first);
  const uint16_t grid_start = (uint16_t)((int)first - weekday);
  const int next_month = month == 12 ? 1 : month + 1;
  const int next_year = month == 12 ? year + 1 : year;
  const int days_in_month =
      calendar_days_from_civil(next_year, next_month, 1) - (int)first;
  int grid_rows = (weekday + days_in_month + 6) / 7;
  if (grid_rows < 5) {
    grid_rows = 5;
  }
  if (grid_rows > 6) {
    grid_rows = 6;
  }

  calendar_day_counts(0, grid_start, s_month_counts, 42);

  int month_events = 0;
  for (int i = 0; i < 42; i++) {
    int cy = 1970, cm = 1, cd = 1;
    calendar_civil_from_days((int)grid_start + i, &cy, &cm, &cd);
    if (cy == year && cm == month) {
      month_events += s_month_counts[i];
    }
  }

  memset(view, 0, sizeof(*view));
  fill_status(&view->status);
  view->selected_day = s_app.day;
  view->today = calendar_today();
  view->year = year;
  view->month = month;
  view->first_day = grid_start;
  view->grid_rows = grid_rows;
  memcpy(view->counts, s_month_counts, sizeof(view->counts));
  view->month_event_count = month_events;
}

static void draw_current(epd_refresh_mode_t mode) {
  const int64_t draw_start = now_us();
  ESP_LOGD(TAG, "draw view=%d mode=%d", (int)s_app.view, (int)mode);
  uint8_t *fb = epd_framebuffer();
  if (!fb) {
    return;
  }

  if (s_app.view == VIEW_MONTH) {
    ui_month_t view;
    build_month_view(&view);
    ui_draw_month(fb, &view);
  } else if (s_app.view == VIEW_DAY) {
    load_day_events();
    ui_day_t view = {
        .day = s_app.day,
        .today = calendar_today(),
        .count = s_day_count,
        .events = s_day_events,
        .selected = s_app.selected,
    };
    fill_status(&view.status);
    ui_draw_day(fb, &view);
  } else {
    cal_event_t event;
    if (!calendar_get_event(s_app.detail_id, &event)) {
      /* The phone may have deleted this event while it was on screen. */
      s_app.view = VIEW_DAY;
      s_app.dirty = true;
      load_day_events();
      ui_day_t view = {
          .day = s_app.day,
          .today = calendar_today(),
          .count = s_day_count,
          .events = s_day_events,
          .selected = s_app.selected,
      };
      fill_status(&view.status);
      ui_draw_day(fb, &view);
    } else {
      ui_detail_t view = {
          .event = &event,
          .confirm_delete = s_app.view == VIEW_DELETE,
      };
      fill_status(&view.status);
      ui_draw_detail(fb, &view);
    }
  }

  if (s_app.toast[0] && now_us() < s_app.toast_until_us) {
    ui_draw_toast(fb, s_app.toast);
  }

  epd_refresh(mode);
  s_app.last_render_us = now_us();
  s_app.refresh_count++;
  ESP_LOGD(TAG, "draw done in %lld ms", (now_us() - draw_start) / 1000);
}

static epd_refresh_mode_t next_refresh_mode(void) {
  /* Differential refreshes are fast but accumulate ghosting; insert a stronger
   * HALF pass every few updates. Cold boot, the wake frame and the lock screen
   * pick their mode explicitly instead. */
  if (s_app.refresh_count != 0 && (s_app.refresh_count % CLEAN_REFRESH_EVERY) == 0) {
    return EPD_REFRESH_HALF;
  }
  return EPD_REFRESH_FAST;
}

/* --- actions ------------------------------------------------------------ */

static void enter_sleep(void) {
  ESP_LOGI(TAG, "locking: screen shows the upcoming schedule, then deep sleep");
  s_app.sleep_requested = false;

  if (s_app.ble_started) {
    ble_calendar_shutdown();
    s_app.ble_started = false;
    s_app.ble_connected = false;
    s_app.ble_subscribed = false;
  }

  refresh_battery(true);

  const uint16_t today = calendar_today();
  uint16_t now_min = 0;
  if (calendar_time_valid()) {
    const time_t local = (time_t)calendar_local_epoch();
    struct tm tm = {0};
    if (gmtime_r(&local, &tm)) {
      now_min = (uint16_t)(tm.tm_hour * 60 + tm.tm_min);
    }
  }

  cal_event_t upcoming[5];
  int count = 0;
  if (today != 0) {
    count = calendar_upcoming(today, now_min, -1, upcoming, 5);
  } else {
    count = calendar_upcoming(0, 0, -1, upcoming, 5);
  }

  ui_sleep_t view = {
      .count = count,
      .events = upcoming,
  };
  fill_status(&view.status);

  uint8_t *fb = epd_framebuffer();
  if (fb) {
    ui_draw_sleep(fb, &view);
    /* HALF still writes both RAM planes and drives every pixel, so the parked
     * image is clean; the high-temperature waveform just finishes before the
     * panel has cycled black/white as many times as FULL does. The vendor's
     * sleep screen uses the same mode. */
    epd_refresh(EPD_REFRESH_HALF);
  }

  calendar_save_clock();
  epd_sleep();
  board_power_enter_deep_sleep();
  /* Not reached. */
  for (;;) {
    vTaskDelay(portMAX_DELAY);
  }
}

static void delete_selected_event(void) {
  const esp_err_t err = calendar_delete_event(s_app.detail_id);
  if (err == ESP_OK) {
    set_toast("已删除");
    s_app.view = VIEW_DAY;
    s_app.selected = 0;
    load_day_events();
  } else {
    set_toast("删除失败");
    s_app.view = VIEW_DETAIL;
  }
  mark_dirty();
}

static void handle_arrow(uint8_t button) {
  if (s_app.view == VIEW_MONTH) {
    if (button == BOARD_BTN_LEFT) {
      if (s_app.day > 0) {
        s_app.day--;
      }
      s_app.follow_today = false;
      mark_dirty();
    } else if (button == BOARD_BTN_RIGHT) {
      if (s_app.day < 0xFFFE) {
        s_app.day++;
      }
      s_app.follow_today = false;
      mark_dirty();
    } else if (button == BOARD_BTN_UP || button == BOARD_BTN_DOWN) {
      const int delta = (button == BOARD_BTN_UP) ? -7 : 7;
      const int next = (int)s_app.day + delta;
      if (next >= 0 && next <= 0xFFFE) {
        s_app.day = (uint16_t)next;
        s_app.selected = 0;
        s_app.follow_today = false;
        mark_dirty();
      }
    }
  } else if (s_app.view == VIEW_DAY) {
    if (button == BOARD_BTN_LEFT || button == BOARD_BTN_RIGHT) {
      if (button == BOARD_BTN_LEFT && s_app.day > 0) {
        s_app.day--;
      } else if (button == BOARD_BTN_RIGHT && s_app.day < 0xFFFE) {
        s_app.day++;
      }
      s_app.selected = 0;
      s_app.follow_today = false;
      load_day_events();
      mark_dirty();
    } else if (button == BOARD_BTN_UP || button == BOARD_BTN_DOWN) {
      load_day_events();
      if (s_day_count > 0) {
        s_app.selected += (button == BOARD_BTN_UP) ? -1 : 1;
        if (s_app.selected < 0) {
          s_app.selected = 0;
        }
        if (s_app.selected >= s_day_count) {
          s_app.selected = s_day_count - 1;
        }
        mark_dirty();
      }
    }
  }
}

static void handle_key(const key_event_t *event) {
  ESP_LOGD(TAG, "handle %s type=%d view=%d", board_button_name(event->button), event->type,
           (int)s_app.view);
  s_app.last_input_us = now_us();

  if (event->button == BOARD_BTN_POWER) {
    /* A click or a 2 s hold both lock the device; the hold fires while the
     * finger is still down, so it also works if the UI task is busy. */
    enter_sleep();
    return;
  }

  if (is_arrow(event->button)) {
    handle_arrow(event->button);
    return;
  }

  if (event->button == BOARD_BTN_BACK) {
    if (s_app.view == VIEW_MONTH) {
      s_app.follow_today = true;
      const uint16_t today = calendar_today();
      if (today != 0) {
        s_app.day = today;
        s_app.selected = 0;
      }
      mark_dirty();
    } else if (s_app.view == VIEW_DAY) {
      s_app.view = VIEW_MONTH;
      mark_dirty();
    } else if (s_app.view == VIEW_DETAIL) {
      s_app.view = VIEW_DAY;
      mark_dirty();
    } else if (s_app.view == VIEW_DELETE) {
      s_app.view = VIEW_DETAIL;
      mark_dirty();
    }
    return;
  }

  if (event->button == BOARD_BTN_CONFIRM) {
    if (s_app.view == VIEW_MONTH) {
      s_app.view = VIEW_DAY;
      s_app.selected = 0;
      load_day_events();
      mark_dirty();
    } else if (s_app.view == VIEW_DAY) {
      load_day_events();
      if (s_day_count > 0) {
        s_app.detail_id = s_day_events[s_app.selected].id;
        s_app.view = VIEW_DETAIL;
        mark_dirty();
      } else {
        set_toast("当天没有日程");
        mark_dirty();
      }
    } else if (s_app.view == VIEW_DETAIL) {
      s_app.view = VIEW_DELETE;
      mark_dirty();
    } else if (s_app.view == VIEW_DELETE) {
      delete_selected_event();
    }
  }
}

static void note_generation_change(void) {
  const uint32_t generation = calendar_generation();
  if (generation == s_last_generation) {
    return;
  }
  s_last_generation = generation;
  s_app.dirty = true;
  /* If the phone changed data, the detail screen may no longer be valid;
   * draw_current() falls back to the day list when the id is gone. */
  if (s_app.view == VIEW_DAY) {
    load_day_events();
  }
}

/* --- setup -------------------------------------------------------------- */

static void init_power_management(void) {
  esp_pm_config_t config = {
      .max_freq_mhz = CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ,
      .min_freq_mhz = 40,
      /* Automatic light sleep is disabled on this board: the C61 SAR ADC
       * (front keys / battery) and the USB-Serial/JTAG console do not survive
       * it reliably, which made keys and screen updates appear dead. Deep
       * sleep remains the primary low-power state; DFS stays enabled. */
      .light_sleep_enable = false,
  };
  const esp_err_t err = esp_pm_configure(&config);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "power management unavailable: %s", esp_err_to_name(err));
  } else {
    ESP_LOGI(TAG, "PM: %d..%d MHz, light sleep %s", config.min_freq_mhz,
             config.max_freq_mhz, config.light_sleep_enable ? "enabled" : "disabled");
  }
}

static esp_err_t init_nvs(void) {
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_LOGW(TAG, "NVS needs a rebuild (old/incompatible layout); calendar data will be lost");
    ESP_ERROR_CHECK(nvs_flash_erase());
    err = nvs_flash_init();
  }
  return err;
}

void app_main(void) {
  const esp_reset_reason_t reset_reason = esp_reset_reason();
  ESP_LOGI(TAG, "OnePage C61 calendar starting (reset reason %d%s)", (int)reset_reason,
           reset_reason == ESP_RST_DEEPSLEEP ? ", wake from deep sleep" : "");
  /* Waking from deep sleep is the vendor's "panel was off" case: the frame on
   * the glass is our own lock screen, so HALF (both RAM planes, sped-up
   * waveform) repaints it cleanly without the long black/white cycling of
   * FULL. A cold boot starts from an unknown panel state and keeps FULL. */
  const bool panel_was_parked = reset_reason == ESP_RST_DEEPSLEEP;

  ESP_ERROR_CHECK(init_nvs());
  ESP_ERROR_CHECK(board_power_init());
  ESP_ERROR_CHECK(epd_init());
  ESP_ERROR_CHECK(board_buttons_init());

  ESP_ERROR_CHECK(calendar_init());
  s_last_generation = calendar_generation();

  refresh_battery(true);

  s_app.view = VIEW_MONTH;
  s_app.follow_today = true;
  s_app.last_input_us = now_us();
  s_app.toast_until_us = 0;
  const uint16_t today = calendar_today();
  if (today != 0) {
    s_app.day = today;
  } else {
    cal_event_t first[1];
    const int n = calendar_upcoming(0, 0, -1, first, 1);
    s_app.day = n > 0 ? first[0].day : (uint16_t)calendar_days_from_civil(2026, 1, 1);
  }

  init_power_management();

  static const ble_calendar_callbacks_t callbacks = {
      .on_change = on_ble_change,
      .on_conn = on_ble_conn,
      .on_sleep_request = on_ble_sleep_request,
  };
  ble_calendar_set_callbacks(&callbacks);
  const esp_err_t ble_err = ble_calendar_init();
  s_app.ble_started = ble_err == ESP_OK;
  if (!s_app.ble_started) {
    ESP_LOGE(TAG, "BLE unavailable; the calendar still works offline");
  }

  s_key_queue = xQueueCreate(32, sizeof(key_event_t));
  if (!s_key_queue || xTaskCreate(key_task, "keys", 3072, NULL, 2, NULL) != pdPASS) {
    ESP_LOGE(TAG, "key scanner failed to start");
  }

  ESP_LOGI(TAG, "ready: %d events, %d calendars, clock %s", calendar_event_count(),
           calendar_count(), calendar_time_valid() ? "valid" : "not synced");

  draw_current(panel_was_parked ? EPD_REFRESH_HALF : EPD_REFRESH_FULL);

  for (;;) {
    key_event_t event;
    if (s_key_queue && xQueueReceive(s_key_queue, &event, pdMS_TO_TICKS(500)) == pdTRUE) {
      do {
        handle_key(&event);
      } while (xQueueReceive(s_key_queue, &event, 0) == pdTRUE);
    } else if (!s_key_queue) {
      vTaskDelay(pdMS_TO_TICKS(500));
    }

    if (s_ble_activity) {
      s_ble_activity = false;
      s_app.last_input_us = now_us();
    }
    if (s_calendar_dirty) {
      s_calendar_dirty = false;
      s_app.dirty = true;
    }
    note_generation_change();
    if (update_follow_today()) {
      s_app.dirty = true;
    }
    refresh_battery(false);
    if (s_app.battery_retry_us && now_us() >= s_app.battery_retry_us) {
      s_app.battery_retry_us = 0;
      /* A retry must not postpone the regular 60 s poll. */
      const int64_t last_poll_us = s_app.last_battery_us;
      refresh_battery(true);
      s_app.last_battery_us = last_poll_us;
      /* Only repaint once there is a real percentage to show; an invalid retry
       * keeps the existing "--%" without an extra e-ink flash. */
      if (s_app.battery_valid) {
        s_app.dirty = true;
      }
    }

    if (s_app.toast[0] && now_us() >= s_app.toast_until_us) {
      s_app.toast[0] = '\0';
      s_app.dirty = true;
    }

    if (s_app.sleep_requested) {
      enter_sleep();
    }

    const int64_t now = now_us();
    if (now - s_last_alive_us >= 30LL * 1000 * 1000) {
      s_last_alive_us = now;
      ESP_LOGD(TAG, "alive view=%d dirty=%d ble=%d sub=%d", (int)s_app.view,
               (int)s_app.dirty, (int)s_app.ble_connected, (int)s_app.ble_subscribed);
    }
    if (s_app.dirty && now - s_app.last_render_us >= UI_MIN_REDRAW_US) {
      s_app.dirty = false;
      draw_current(next_refresh_mode());
    }

    /* On USB power the battery is not at risk; staying awake also keeps the
     * serial monitor and the desk-calendar use case alive. POWER and the web
     * page can still lock it explicitly. */
    const int64_t idle = now - s_app.last_input_us;
    if (!s_app.usb) {
      if (s_app.ble_connected) {
        if (idle > AUTO_SLEEP_CONNECTED_US) {
          ESP_LOGI(TAG, "auto-lock after %lld s connected", idle / 1000000);
          enter_sleep();
        }
      } else if (idle > AUTO_SLEEP_US) {
        ESP_LOGI(TAG, "auto-lock after %lld s idle", idle / 1000000);
        enter_sleep();
      }
    }
  }
}
