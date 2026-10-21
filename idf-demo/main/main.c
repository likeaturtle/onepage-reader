/*
 * OnePage C61 bring-up demo (ESP-IDF).
 *
 * Exercises, in order, everything that is easy to get wrong on this board:
 *   1. shared EPD/SD power rail + panel hardware reset
 *   2. SSD1677 panel: three refresh modes, full-screen patterns
 *   3. microSD on the bus shared with the panel, including a write/read test
 *   4. front ADC key ladder + the three side keys
 *   5. battery divider reading and USB detection
 *   6. deep sleep with wake on the POWER key
 *
 * Everything is also mirrored on the panel so the device is usable without a
 * serial console, and on the console for detail.
 */

#include "board_buttons.h"
#include "board_power.h"
#include "epd_ssd1677.h"
#include "font_cjk.h"
#include "gfx.h"
#include "onepage_mic.h"
#include "onepage_pins.h"
#include "sd_card.h"

#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_idf_version.h"
#include "esp_log.h"
#include "esp_psram.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

static const char *TAG = "demo";

#define STATUS_X 16
#define STATUS_Y 244
#define STATUS_PITCH 19
#define BTN_BOX_Y 396
#define BTN_BOX_H 40
#define BTN_BOX_W 100
#define BTN_BOX_GAP 8

/* A single ADC reading of the battery divider jitters by more than 1 mV, so
 * redrawing whenever the value changes means a panel flash every poll. Only
 * react once the cell has moved by this much (~1% of charge), and rate-limit
 * how often slow values may repaint the panel at all -- they are informational,
 * while the panel pays for every refresh in ghosting and current. */
#define BAT_REDRAW_MV 25
#define SLOW_REDRAW_US (30LL * 1000 * 1000)
#define ENV_POLL_US (2000LL * 1000)
#define POWER_HOLD_US (2LL * 1000 * 1000)
/* A press shorter than this is a glitch on the key line, not a click: with a
 * 20 ms poll period an ignored contact bounce shows up as a single sample. */
#define POWER_CLICK_MIN_US (30LL * 1000)

/* The live meter can only change as fast as the panel: a differential refresh
 * takes a few hundred milliseconds even in FAST mode, so asking for more than
 * this just queues panel work and delays the CONFIRM release. */
#define MIC_REDRAW_US (250LL * 1000)
#define MIC_LOG_US (1000LL * 1000)
/* CONFIRM is a click toggle now: press+release starts, the next click stops.
 * Anything shorter than this is contact bounce, not a click. */
#define MIC_CLICK_MIN_US (20LL * 1000)
/* A differential refresh is cheap but accumulates ghosting, so give the meter a
 * stronger clean-up pass every this many updates (roughly every few seconds). */
#define MIC_CLEAN_EVERY 8

typedef struct {
  bool sd_mounted;
  int sd_entries;
  char sd_rw[24];
  uint16_t bat_mv;
  uint8_t bat_pct;
  bool usb;
  uint32_t buttons;
  char last_event[24];
  const char *reset_reason;
} app_state_t;

static app_state_t s_state;

typedef enum {
  UI_MAIN = 0,
  UI_RECORDING,
  UI_RESULT,
} ui_mode_t;

static ui_mode_t s_ui = UI_MAIN;
static bool s_mic_ready;
static bool s_mic_failed;
static onepage_mic_status_t s_rec;
static onepage_mic_status_t s_last_rec;
static bool s_have_rec;
static int64_t s_last_mic_draw_us;
static int64_t s_last_mic_log_us;
static uint32_t s_mic_refresh_count;
static SemaphoreHandle_t s_confirm_click;

/* --- small helpers ------------------------------------------------------ */

static const char *reset_reason_str(void) {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:
      return "POWER ON";
    case ESP_RST_EXT:
      return "EXT PIN";
    case ESP_RST_SW:
      return "SOFTWARE";
    case ESP_RST_PANIC:
      return "PANIC";
    case ESP_RST_INT_WDT:
      return "INT WATCHDOG";
    case ESP_RST_TASK_WDT:
      return "TASK WATCHDOG";
    case ESP_RST_WDT:
      return "WATCHDOG";
    case ESP_RST_DEEPSLEEP:
      return "WAKE FROM SLEEP";
    case ESP_RST_BROWNOUT:
      return "BROWNOUT";
    default:
      return "UNKNOWN";
  }
}

static void log_chip_info(void) {
  esp_chip_info_t chip;
  esp_chip_info(&chip);

  uint32_t flash_size = 0;
  esp_flash_get_size(NULL, &flash_size);
  const size_t psram = esp_psram_get_size();

  ESP_LOGI(TAG, "chip: ESP32-C61 rev v%d.%d, %d core(s)", chip.revision / 100, chip.revision % 100,
           chip.cores);
  ESP_LOGI(TAG, "flash: %" PRIu32 " MB, PSRAM: %u KB, IDF: %s", flash_size / (1024 * 1024),
           (unsigned)(psram / 1024), esp_get_idf_version());
  ESP_LOGI(TAG, "reset reason: %s", s_state.reset_reason);
  ESP_LOGI(TAG, "heap after boot: internal %u KB free, PSRAM %u KB free",
           (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024),
           (unsigned)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
}

/* --- panel rendering ---------------------------------------------------- */

static void draw_patterns(uint8_t *fb) {
  const int top = 72;
  const int height = 60;

  /* 10 px checkerboard: checks the X/Y mapping and the byte packing. */
  gfx_checker(fb, 16, top, 180, height, 10, false);

  /* Five dither densities: a coarse gray ramp. */
  static const int levels[5] = {16, 12, 8, 4, 1};
  for (int i = 0; i < 5; i++) {
    gfx_dither_rect(fb, 206 + i * 36, top, 36, height, levels[i]);
  }

  /* 12 px grid with a border: single-pixel line purity. */
  gfx_grid(fb, 396, top, 180, height, 12, true);

  /* 16-step tone ramp. */
  for (int i = 0; i < 16; i++) {
    gfx_dither_rect(fb, 586 + i * 12, top, 12, height, i + 1);
  }

  const int lower = top + height + 8;

  /* Outlined box with a cross and diagonals. */
  gfx_rect(fb, 16, lower, 180, 60, true);
  gfx_hline(fb, 16, lower + 30, 180, true);
  gfx_vline(fb, 106, lower, 60, true);
  for (int i = 0; i < 30; i++) {
    gfx_pixel(fb, 26 + i, lower + 8 + i, true);
    gfx_pixel(fb, 26 + i, lower + 51 - i, true);
  }

  /* Text at three sizes, including glyphs that are easy to confuse. */
  gfx_text(fb, 206, lower, "SCALE 1 0123456789", 1, true);
  gfx_text(fb, 206, lower + 12, "SCALE 2 O0I1 8B", 2, true);
  gfx_text(fb, 206, lower + 32, "SCALE 3", 3, true);

  /* Solid / hollow halves plus 1 px lines on an 8 px pitch. */
  gfx_fill_rect(fb, 396, lower, 180, 30, true);
  for (int i = 0; i < 23; i++) {
    gfx_vline(fb, 396 + i * 8, lower + 34, 26, true);
  }

  /* Every other pixel column: the panel's worst-case uniform tone. */
  for (int i = 0; i < 99; i++) {
    gfx_vline(fb, 586 + i * 2, lower, 60, true);
  }
}

static void draw_status(uint8_t *fb) {
  char line[64];
  int y = STATUS_Y;

  esp_chip_info_t chip;
  esp_chip_info(&chip);
  uint32_t flash_size = 0;
  esp_flash_get_size(NULL, &flash_size);

  snprintf(line, sizeof(line), "CHIP  ESP32-C61 V%d.%d  %d CORE", chip.revision / 100,
           chip.revision % 100, chip.cores);
  gfx_text(fb, STATUS_X, y, line, 2, true);
  y += STATUS_PITCH;

  snprintf(line, sizeof(line), "FLASH %" PRIu32 "MB   PSRAM %uKB", flash_size / (1024 * 1024),
           (unsigned)(esp_psram_get_size() / 1024));
  gfx_text(fb, STATUS_X, y, line, 2, true);
  y += STATUS_PITCH;

  snprintf(line, sizeof(line), "HEAP  INT %uK  PSRAM %uK",
           (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024),
           (unsigned)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
  gfx_text(fb, STATUS_X, y, line, 2, true);
  y += STATUS_PITCH;

  if (s_state.sd_mounted) {
    snprintf(line, sizeof(line), "SD    %d FILES  %s", s_state.sd_entries, s_state.sd_rw);
  } else {
    snprintf(line, sizeof(line), "SD    NOT MOUNTED");
  }
  gfx_text(fb, STATUS_X, y, line, 2, true);
  y += STATUS_PITCH;

  snprintf(line, sizeof(line), "BAT   %uMV %u%%   USB %d", (unsigned)s_state.bat_mv,
           (unsigned)s_state.bat_pct, s_state.usb ? 1 : 0);
  gfx_text(fb, STATUS_X, y, line, 2, true);
  y += STATUS_PITCH;

  snprintf(line, sizeof(line), "KEYS  %d RAW %dMV  %s", board_buttons_last_adc_raw(),
           board_buttons_last_adc_mv(), s_state.last_event);
  gfx_text(fb, STATUS_X, y, line, 2, true);
}

static void draw_buttons(uint8_t *fb) {
  for (int i = 0; i < BOARD_BTN_COUNT; i++) {
    const int x = 16 + i * (BTN_BOX_W + BTN_BOX_GAP);
    const bool pressed = (s_state.buttons & (1u << i)) != 0;
    if (pressed) {
      gfx_fill_rect(fb, x, BTN_BOX_Y, BTN_BOX_W, BTN_BOX_H, true);
    } else {
      gfx_rect(fb, x, BTN_BOX_Y, BTN_BOX_W, BTN_BOX_H, true);
    }
    const char *name = board_button_name(i);
    const int text_x = x + (BTN_BOX_W - gfx_text_width(name, 2)) / 2;
    /* A held key is drawn as a filled box with the label knocked out. */
    gfx_text(fb, text_x, BTN_BOX_Y + 13, name, 2, !pressed);
  }
}

/* --- microphone meter --------------------------------------------------- */

static void format_elapsed(char *out, size_t len, uint32_t ms) {
  const uint32_t total_s = ms / 1000;
  snprintf(out, len, "%02u:%02u", (unsigned)(total_s / 60), (unsigned)(total_s % 60));
}

/* Live recording / result screen. Kept in one function so both views share the
 * meter geometry; only the title, badge and footer differ. */
static void draw_mic_screen(uint8_t *fb, const onepage_mic_status_t *st, bool finished) {
  char text[64];
  gfx_clear(fb, true);

  const char *title = finished ? "RECORDING FINISHED" : "MIC LEVEL";
  const char *badge = finished ? "DONE" : "REC";
  gfx_text(fb, 16, 14, title, 3, true);

  const int badge_x = 16 + gfx_text_width(title, 3) + 16;
  const int badge_w = gfx_text_width(badge, 2) + 16;
  if (finished) {
    gfx_rect(fb, badge_x, 10, badge_w, 30, true);
    gfx_text(fb, badge_x + 8, 17, badge, 2, true);
  } else {
    gfx_fill_rect(fb, badge_x, 10, badge_w, 30, true);
    gfx_text(fb, badge_x + 8, 17, badge, 2, false);
  }

  format_elapsed(text, sizeof(text), st->elapsed_ms);
  gfx_text(fb, ONEPAGE_EPD_WIDTH - 16 - gfx_text_width(text, 3), 14, text, 3, true);
  gfx_hline(fb, 16, 50, ONEPAGE_EPD_WIDTH - 32, true);

  /* Big percentage plus a segmented bar. The peak-hold marker sits just above
   * the bar so it stays visible even when the bar is full. */
  gfx_text(fb, 16, 64, "LEVEL", 2, true);
  snprintf(text, sizeof(text), "%3u%%", (unsigned)st->level_pct);
  gfx_text(fb, 16, 84, text, 6, true);

  const int segs = 27;
  const int seg_w = 19;
  const int seg_gap = 2;
  const int seg_pitch = seg_w + seg_gap;
  const int bar_x = 210;
  const int bar_y = 86;
  const int bar_h = 40;
  const int lit = (int)st->level_pct * segs / 100;
  for (int i = 0; i < segs; i++) {
    const int x = bar_x + i * seg_pitch;
    if (i < lit) {
      gfx_fill_rect(fb, x, bar_y, seg_w, bar_h, true);
    } else {
      gfx_rect(fb, x, bar_y, seg_w, bar_h, true);
    }
  }
  const int bar_span = segs * seg_pitch - seg_gap;
  int peak_x = bar_x + (int)st->peak_pct * (bar_span - 1) / 100;
  if (peak_x < bar_x) {
    peak_x = bar_x;
  }
  if (peak_x > bar_x + bar_span - 1) {
    peak_x = bar_x + bar_span - 1;
  }
  gfx_fill_rect(fb, peak_x - 1, 74, 3, 8, true);

  gfx_text(fb, bar_x, 130, "0", 1, true);
  gfx_text(fb, bar_x + bar_span - gfx_text_width("100", 1), 130, "100", 1, true);

  snprintf(text, sizeof(text), "LEVEL %d DBFS", st->level_db);
  gfx_text(fb, 16, 146, text, 2, true);
  snprintf(text, sizeof(text), "PEAK %d DBFS", st->peak_db);
  gfx_text(fb, 300, 146, text, 2, true);
  snprintf(text, sizeof(text), "AVG %d DBFS", st->avg_db);
  gfx_text(fb, 590, 146, text, 2, true);

  snprintf(text, sizeof(text), "PDM RX  %u HZ PCM", (unsigned)st->pcm_rate_hz);
  gfx_text(fb, 16, 166, text, 1, true);
  const char *meter_hint = "LIVE LEVEL - AUDIO NOT SAVED";
  if (!finished && st->calibrating) {
    meter_hint = "CALIBRATING NOISE FLOOR - STAY QUIET";
  }
  gfx_text(fb, ONEPAGE_EPD_WIDTH - 16 - gfx_text_width(meter_hint, 1), 166, meter_hint, 1, true);

  gfx_hline(fb, 16, 190, ONEPAGE_EPD_WIDTH - 32, true);
  gfx_text(fb, 16, 198, "LEVEL HISTORY - LAST 13 S", 2, true);

  const int gx = 16;
  const int gy = 222;
  const int gw = ONEPAGE_EPD_WIDTH - 32;
  const int gh = 152;
  gfx_rect(fb, gx, gy, gw, gh, true);
  for (int level = 1; level < 4; level++) {
    for (int x = gx + 4; x < gx + gw - 4; x += 4) {
      gfx_pixel(fb, x, gy + gh * level / 4, true);
    }
  }
  const int slot_w = gw / ONEPAGE_MIC_HISTORY_LEN;
  const int bar_w = slot_w - 2;
  const int base_y = gy + gh - 2;
  for (int i = 0; i < st->history_count && i < ONEPAGE_MIC_HISTORY_LEN; i++) {
    int h = (int)st->history[i] * (gh - 4) / 100;
    if (st->history[i] > 0 && h < 1) {
      h = 1;
    }
    if (h > 0) {
      gfx_fill_rect(fb, gx + 1 + i * slot_w, base_y - h, bar_w, h, true);
    }
  }

  gfx_hline(fb, 16, 390, ONEPAGE_EPD_WIDTH - 32, true);
  if (finished) {
    gfx_text(fb, 16, 400, "BACK = MAIN SCREEN   CLICK CONFIRM = RECORD AGAIN", 2, true);
    gfx_text(fb, 16, 424, "AUDIO WAS ANALYSED LIVE - NOT SAVED TO SD", 1, true);
  } else {
    gfx_text(fb, 16, 400, "CLICK CONFIRM AGAIN TO STOP RECORDING", 2, true);
    gfx_text(fb, 16, 424, "E-INK IS SLOW - THE METER UPDATES WHEN IT CAN", 1, true);
  }
}

static void render_mic_screen(epd_refresh_mode_t mode, bool finished) {
  uint8_t *fb = epd_framebuffer();
  if (!fb) {
    return;
  }
  draw_mic_screen(fb, finished ? &s_last_rec : &s_rec, finished);
  epd_refresh(mode);
}

static void render_screen(epd_refresh_mode_t mode) {
  uint8_t *fb = epd_framebuffer();
  if (!fb) {
    return;
  }
  gfx_clear(fb, true);

  gfx_text(fb, 16, 14, "ONEPAGE C61  IDF DEMO", 3, true);
  gfx_hline(fb, 16, 46, ONEPAGE_EPD_WIDTH - 32, true);

  char reset_line[32];
  snprintf(reset_line, sizeof(reset_line), "RESET %s", s_state.reset_reason);
  gfx_text(fb, ONEPAGE_EPD_WIDTH - 16 - gfx_text_width(reset_line, 2), 24, reset_line, 2, true);

  gfx_text(fb, 16, 54, "PANEL SELF TEST", 2, true);
  draw_patterns(fb);

  gfx_hline(fb, 16, 216, ONEPAGE_EPD_WIDTH - 32, true);
  gfx_text(fb, 16, 226, "STATUS", 2, true);
  draw_status(fb);

  gfx_hline(fb, 16, 366, ONEPAGE_EPD_WIDTH - 32, true);
  gfx_text(fb, 16, 376, "BUTTONS - CLICK OR HOLD POWER TO SLEEP", 2, true);
  draw_buttons(fb);

  char footer[48];
  if (s_have_rec) {
    snprintf(footer, sizeof(footer), "LAST REC %u.%uS  PEAK %d DB",
             (unsigned)(s_last_rec.elapsed_ms / 1000),
             (unsigned)((s_last_rec.elapsed_ms % 1000) / 100), s_last_rec.peak_db);
  } else if (s_mic_failed) {
    snprintf(footer, sizeof(footer), "MIC UNAVAILABLE - SEE CONSOLE");
  } else {
    snprintf(footer, sizeof(footer), "CLICK CONFIRM = MIC RECORD");
  }
  gfx_text(fb, 16, 446, footer, 2, true);
  gfx_text(fb, 16, 464, "ESP-IDF BRING-UP BUILD - NOT THE STOCK FIRMWARE", 1, true);

  epd_refresh(mode);
}

/* --- tests -------------------------------------------------------------- */

static void refresh_environment(void) {
  s_state.usb = board_usb_connected();
  s_state.bat_mv = board_battery_read_mv();
  s_state.bat_pct = board_battery_percent(s_state.bat_mv);
}

static void run_sd_test(void) {
  if (!sd_card_mounted() && sd_card_mount() != ESP_OK) {
    s_state.sd_mounted = false;
    snprintf(s_state.sd_rw, sizeof(s_state.sd_rw), "NO CARD");
    ESP_LOGW(TAG, "SD: no card detected (inserted and FAT formatted?)");
    return;
  }
  s_state.sd_mounted = true;
  s_state.sd_entries = sd_card_count_entries("/", 200);
  if (sd_card_rw_test(s_state.sd_rw, sizeof(s_state.sd_rw)) != ESP_OK) {
    ESP_LOGE(TAG, "SD: write/read test failed (%s)", s_state.sd_rw);
  }

  char names[4][64];
  const int n = sd_card_list("/", names, 4);
  ESP_LOGI(TAG, "SD: %d entries, write/read test: %s", s_state.sd_entries, s_state.sd_rw);
  for (int i = 0; i < n; i++) {
    ESP_LOGI(TAG, "SD:   %s", names[i]);
  }
}

/* Poll the keys from a separate task while the UI task is blocked in an e-ink
 * refresh. CONFIRM is on the ADC ladder, so a click that starts and ends
 * entirely inside a panel refresh would otherwise be missed. Only the click is
 * posted here; the UI task performs the start/stop so drawing stays
 * single-threaded. */
static void key_scan_task(void *arg) {
  (void)arg;
  uint32_t previous = board_buttons_poll();
  int64_t pressed_us = 0;
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(20));
    const uint32_t mask = board_buttons_poll();
    const bool was = (previous & (1u << BOARD_BTN_CONFIRM)) != 0;
    const bool is = (mask & (1u << BOARD_BTN_CONFIRM)) != 0;
    if (is && !was) {
      pressed_us = esp_timer_get_time();
    } else if (!is && was && pressed_us) {
      const int64_t held_us = esp_timer_get_time() - pressed_us;
      pressed_us = 0;
      if (held_us >= MIC_CLICK_MIN_US) {
        xSemaphoreGive(s_confirm_click);
      }
    }
    previous = mask;
  }
}

static void note_event(const char *name, bool pressed) {
  snprintf(s_state.last_event, sizeof(s_state.last_event), "%s %s", name, pressed ? "DOWN" : "UP");
}

/* --- recording flow ----------------------------------------------------- */

static void start_recording(void) {
  /* Initialise lazily: the boot path stays exactly as it was before the
   * microphone existed, and an I2S problem can only affect the first take
   * instead of the whole demo. */
  if (!s_mic_ready && !s_mic_failed) {
    const esp_err_t err = onepage_mic_init();
    if (err != ESP_OK) {
      s_mic_failed = true;
      snprintf(s_state.last_event, sizeof(s_state.last_event), "MIC INIT ERR");
      ESP_LOGE(TAG, "mic: init failed (%s)", esp_err_to_name(err));
      return;
    }
    s_mic_ready = true;
    ESP_LOGI(TAG, "mic: initialised on first use");
  }
  if (s_mic_failed) {
    snprintf(s_state.last_event, sizeof(s_state.last_event), "MIC UNAVAILABLE");
    ESP_LOGW(TAG, "mic: CONFIRM ignored, microphone not initialised");
    return;
  }

  const esp_err_t err = onepage_mic_start();
  if (err != ESP_OK) {
    snprintf(s_state.last_event, sizeof(s_state.last_event), "MIC START ERR");
    ESP_LOGE(TAG, "mic: start failed (%s)", esp_err_to_name(err));
    return;
  }

  onepage_mic_get_status(&s_rec);
  s_ui = UI_RECORDING;
  /* The start screen is already a HALF refresh, so the next periodic update can
   * go straight to differential. */
  s_mic_refresh_count = 1;
  render_mic_screen(EPD_REFRESH_HALF, false);
  s_last_mic_draw_us = esp_timer_get_time();
  s_last_mic_log_us = s_last_mic_draw_us;
  ESP_LOGI(TAG, "mic: recording (click CONFIRM again to stop)");
}

static void stop_recording(void) {
  onepage_mic_stop();
  onepage_mic_get_status(&s_last_rec);
  s_have_rec = true;
  s_ui = UI_RESULT;
  render_mic_screen(EPD_REFRESH_HALF, true);
  ESP_LOGI(TAG, "mic: result %u ms, level %d dBFS, peak %d dBFS, avg %d dBFS, PCM %u Hz",
           (unsigned)s_last_rec.elapsed_ms, s_last_rec.level_db, s_last_rec.peak_db,
           s_last_rec.avg_db, (unsigned)s_last_rec.pcm_rate_hz);
}

static void return_to_main(uint32_t buttons) {
  s_state.buttons = buttons;
  s_ui = UI_MAIN;
  refresh_environment();
  render_screen(EPD_REFRESH_HALF);
}

/* Draw the "asleep" screen: a centred box with the label and a wake hint. The
 * panel keeps this image while the chip is in deep sleep, so it is refreshed
 * with the full waveform -- it has to survive for hours without ghosting. */
static void draw_sleep_screen(void) {
  uint8_t *fb = epd_framebuffer();
  if (!fb) {
    return;
  }
  const char *label = "休眠中";
  const char *hint = "PRESS POWER TO WAKE";
  const int gap = 12;
  const int pad = 32;
  const int box_w = gfx_text_cjk_width(label, gap) + pad * 2;
  const int box_h = FONT_CJK_PX + pad * 2;
  const int box_x = (ONEPAGE_EPD_WIDTH - box_w) / 2;
  const int box_y = (ONEPAGE_EPD_HEIGHT - box_h) / 2 - 20;

  gfx_clear(fb, true);
  gfx_rect(fb, box_x, box_y, box_w, box_h, true);
  gfx_text_cjk(fb, box_x + pad, box_y + pad, label, gap, true);
  gfx_text(fb, (ONEPAGE_EPD_WIDTH - gfx_text_width(hint, 2)) / 2, box_y + box_h + 40, hint, 2,
           true);
}

/* Park the panel on the sleep screen and put the chip into deep sleep. The
 * image stays visible and POWER wakes the board again. */
static void enter_sleep(void) {
  ESP_LOGI(TAG, "sleep: click or 2 s hold on POWER");
  /* Never cut the rail while the PDM clock is still running. */
  onepage_mic_stop();
  draw_sleep_screen();
  epd_refresh(EPD_REFRESH_FULL);
  epd_sleep();
  sd_card_unmount();
  board_power_enter_deep_sleep();
}

/* --- main --------------------------------------------------------------- */

void app_main(void) {
  s_state.reset_reason = reset_reason_str();
  ESP_LOGI(TAG, "OnePage C61 ESP-IDF bring-up demo");
  log_chip_info();

  /* Rail first: it resets the panel and powers the SD card, and doing it before
   * either peripheral is touched is what keeps the single SD mount reliable. */
  ESP_ERROR_CHECK(board_power_init());
  ESP_ERROR_CHECK(epd_init());
  ESP_ERROR_CHECK(board_buttons_init());

  /* CONFIRM is a click toggle. Scan it from its own task so the click is not
   * lost while this task is blocked for hundreds of milliseconds in a panel
   * refresh; the action itself is still executed here. */
  s_confirm_click = xSemaphoreCreateBinary();
  if (!s_confirm_click ||
      xTaskCreate(key_scan_task, "key_scan", 3072, NULL, 2, NULL) != pdPASS) {
    ESP_LOGE(TAG, "key scan task creation failed; CONFIRM toggle disabled");
    if (s_confirm_click) {
      vSemaphoreDelete(s_confirm_click);
      s_confirm_click = NULL;
    }
  }

  /* The microphone shares the SD/panel rail, so it is safe to bring up here.
   * Initialisation is deliberately deferred to the first CONFIRM click: a
   * failure then leaves the self test and SD path untouched, and the boot path
   * stays identical to the version that was verified on hardware. */
  ESP_LOGI(TAG, "mic: PDM capture will be initialized on first CONFIRM");

  s_state.buttons = board_buttons_poll();
  render_screen(EPD_REFRESH_FULL);

  refresh_environment();
  run_sd_test();
  refresh_environment();
  render_screen(EPD_REFRESH_HALF);

  int64_t power_press_started_us = 0;
  bool power_handled = false;
  int64_t last_redraw_us = 0;
  int64_t last_slow_redraw_us = esp_timer_get_time();
  int64_t last_poll_us = esp_timer_get_time();
  bool slow_dirty = false;

  while (true) {
    const uint32_t mask = board_buttons_poll();
    const int64_t now = esp_timer_get_time();

    /* A CONFIRM click may have arrived while this task was refreshing the
     * panel; key_scan_task latched it. Toggle the take here, on the UI task. */
    if (s_confirm_click && xSemaphoreTake(s_confirm_click, 0) == pdTRUE) {
      if (s_ui == UI_RECORDING) {
        stop_recording();
      } else if (s_ui == UI_MAIN || s_ui == UI_RESULT) {
        start_recording();
      }
    }

    bool dirty = false;

    for (int i = 0; i < BOARD_BTN_COUNT; i++) {
      const bool was = (s_state.buttons & (1u << i)) != 0;
      const bool is = (mask & (1u << i)) != 0;
      if (was == is) {
        continue;
      }
      note_event(board_button_name(i), is);
      ESP_LOGI(TAG, "key %s %s", board_button_name(i), is ? "pressed" : "released");
      dirty = true;

      if (i == BOARD_BTN_POWER && is) {
        power_press_started_us = now;
        power_handled = false;
      }
      /* POWER released before the hold threshold: a click sleeps too. Deep
       * sleep never returns, so there is nothing to unwind here. */
      if (i == BOARD_BTN_POWER && !is && power_press_started_us && !power_handled) {
        const int64_t held_us = now - power_press_started_us;
        power_press_started_us = 0;
        if (held_us >= POWER_CLICK_MIN_US) {
          ESP_LOGI(TAG, "POWER click (%lld ms)", held_us / 1000);
          enter_sleep();
        } else {
          ESP_LOGD(TAG, "ignoring %lld us glitch on POWER", held_us);
        }
      }
      /* CONFIRM clicks are handled by key_scan_task above; this loop only
       * tracks the press state for the on-screen key boxes. */
      /* BACK leaves the result screen; a CONFIRM click starts another take. */
      if (i == BOARD_BTN_BACK && is && s_ui == UI_RESULT) {
        return_to_main(mask);
        dirty = false;
        last_redraw_us = now;
        last_poll_us = now;
        last_slow_redraw_us = now;
      }
    }
    s_state.buttons = mask;

    /* Long press on POWER parks the panel and sleeps. The image stays on the
     * display, and a second press of POWER wakes the board. */
    if (!power_handled && power_press_started_us && (mask & (1u << BOARD_BTN_POWER)) &&
        (now - power_press_started_us) > POWER_HOLD_US) {
      power_handled = true;
      snprintf(s_state.last_event, sizeof(s_state.last_event), "POWER SLEEP");
      enter_sleep();
    }

    if (s_ui == UI_MAIN) {
      /* Keep the slow-moving values (battery, USB) live, but leave the panel
       * alone unless the cell actually moved: a 1 mV jitter used to repaint the
       * screen every two seconds. */
      if (now - last_poll_us > ENV_POLL_US) {
        last_poll_us = now;
        const uint16_t previous_mv = s_state.bat_mv;
        const bool previous_usb = s_state.usb;
        refresh_environment();
        const int delta_mv = (int)s_state.bat_mv - (int)previous_mv;
        if (previous_usb != s_state.usb || delta_mv >= BAT_REDRAW_MV ||
            delta_mv <= -BAT_REDRAW_MV) {
          slow_dirty = true;
        }
      }

      /* Key-driven updates are throttled to 120 ms; the informational values get
       * a much slower budget so charging (which walks the voltage up steadily)
       * cannot turn the panel into a metronome. */
      const bool slow_due = slow_dirty && (now - last_slow_redraw_us) > SLOW_REDRAW_US;
      if ((dirty || slow_due) && (now - last_redraw_us) > 120LL * 1000) {
        last_redraw_us = now;
        if (slow_due) {
          last_slow_redraw_us = now;
          slow_dirty = false;
        }
        render_screen(EPD_REFRESH_FAST);
      }
    } else if (s_ui == UI_RECORDING) {
      /* Refresh the meter at a cadence the panel can actually keep up with.
       * The capture task keeps filling the history regardless of this branch. */
      if (now - s_last_mic_draw_us >= MIC_REDRAW_US) {
        onepage_mic_get_status(&s_rec);
        const epd_refresh_mode_t mode =
            (s_mic_refresh_count++ % MIC_CLEAN_EVERY) == 0 ? EPD_REFRESH_HALF : EPD_REFRESH_FAST;
        render_mic_screen(mode, false);
        s_last_mic_draw_us = esp_timer_get_time();
        if (s_last_mic_draw_us - s_last_mic_log_us >= MIC_LOG_US) {
          s_last_mic_log_us = s_last_mic_draw_us;
          ESP_LOGI(TAG, "mic: %u ms, level %d dBFS (%u%%), peak %d dBFS",
                   (unsigned)s_rec.elapsed_ms, s_rec.level_db, (unsigned)s_rec.level_pct,
                   s_rec.peak_db);
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}
