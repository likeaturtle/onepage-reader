/*
 * PDM microphone level detector.
 *
 * The C61 I2S RX path only supports raw PDM (no PDM-to-PCM filter), so this
 * file does the conversion in software:
 *
 *   16-bit word -> popcount (16 PDM bits) -> sum 8 words -> 128-bit density
 *   -> subtract the 50% DC -> one-pole high-pass -> 16 kHz PCM
 *
 * The PCM stream is not saved; it only feeds the RMS / peak meters. The capture
 * task runs above the UI task so the I2S DMA keeps draining while the panel is
 * refreshing (the panel blocks the caller for hundreds of milliseconds).
 */

#include "onepage_mic.h"

#include "onepage_pins.h"

#include "driver/i2s_pdm.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <math.h>
#include <string.h>

static const char *TAG = "mic";

#define MIC_EVT_START (1U << 0)
#define MIC_EVT_IDLE (1U << 1)

/* 1024 words = 8 ms at 128 kwords/s: enough to keep the task cheap while the
 * DMA ring (8 x 1024 frames) covers ~64 ms of stalls. */
#define MIC_READ_WORDS 1024
#define MIC_DECIM_WORDS 8
#define MIC_PCM_CENTER (MIC_DECIM_WORDS * 16 / 2)
#define MIC_FRAME_US (100 * 1000)
#define MIC_HISTORY_US (200 * 1000)
#define MIC_HP_HZ 50.0f
/* PCM rate after 8-word decimation, assuming the measured 2x clock relation.
 * The meter only needs a representative subset of the stream, so the capture
 * task deliberately drops part of it to stay friendly to the idle task. */
#define MIC_PCM_HZ 16000
#define MIC_WORD_HZ 128000
/* PCM RMS of a full-scale sine after the 128-bit box filter: amplitudes span
 * -64..+64, so a sine of amplitude 64 has an RMS of 64/sqrt(2). */
#define MIC_FULL_SCALE 45.25f
#define MIC_TASK_PRIORITY 6
#define MIC_TASK_STACK 4096

static i2s_chan_handle_t s_rx;
static TaskHandle_t s_task;
static EventGroupHandle_t s_events;
static SemaphoreHandle_t s_lock;
static bool s_initialized;
static volatile bool s_capture;
static volatile bool s_running;
static onepage_mic_status_t s_status;

/* DMA target for the capture task. One task only, so a static buffer keeps the
 * 4 KB task stack free. */
static int16_t s_read_buf[MIC_READ_WORDS];

/* Decimation / meter state, touched only by the capture task (reset at start
 * while the task is idle). */
static uint32_t s_bit_acc;
static uint32_t s_decim_count;
static float s_dc;
static float s_hp_alpha;
static float s_frame_energy;
static float s_frame_peak;
static uint32_t s_frame_samples;
static uint8_t s_warmup_frames;
static float s_level_f;
static double s_total_energy;
static uint32_t s_total_samples;
static float s_peak_abs;
static float s_meter_floor_db = ONEPAGE_MIC_METER_FLOOR_DB;
static float s_meter_top_db = ONEPAGE_MIC_METER_TOP_DB;
static uint8_t s_calib_frames;
static float s_calib_max_db;
static int64_t s_frame_start_us;
static int64_t s_history_last_us;
static int64_t s_start_us;

static int16_t clamp_db(float db) {
  if (db < (float)ONEPAGE_MIC_METER_FLOOR_DB) {
    db = (float)ONEPAGE_MIC_METER_FLOOR_DB;
  }
  if (db > 0.0f) {
    db = 0.0f;
  }
  return (int16_t)lroundf(db);
}

static uint8_t db_to_pct(float db) {
  const float span = s_meter_top_db - s_meter_floor_db;
  if (span <= 0.0f) {
    return 0;
  }
  float pct = (db - s_meter_floor_db) * 100.0f / span;
  if (pct <= 0.0f) {
    return 0;
  }
  if (pct >= 100.0f) {
    return 100;
  }
  return (uint8_t)lroundf(pct);
}

static void update_status(const onepage_mic_status_t *next) {
  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_status = *next;
  xSemaphoreGive(s_lock);
}

static void reset_dsp(void) {
  s_bit_acc = 0;
  s_decim_count = 0;
  s_dc = 0.0f;
  s_hp_alpha = 1.0f - expf(-6.2831853f * MIC_HP_HZ / (float)MIC_PCM_HZ);
  s_frame_energy = 0.0f;
  s_frame_peak = 0.0f;
  s_frame_samples = 0;
  s_warmup_frames = 1;
  s_level_f = (float)ONEPAGE_MIC_METER_FLOOR_DB;
  s_total_energy = 0.0;
  s_total_samples = 0;
  s_peak_abs = 0.0f;
  s_meter_floor_db = ONEPAGE_MIC_METER_FLOOR_DB;
  s_meter_top_db = ONEPAGE_MIC_METER_TOP_DB;
  s_calib_frames = ONEPAGE_MIC_CALIB_FRAMES;
  s_calib_max_db = (float)ONEPAGE_MIC_METER_FLOOR_DB;
  s_start_us = esp_timer_get_time();
  s_frame_start_us = s_start_us;
  s_history_last_us = s_start_us;
}

static void finish_frame(int64_t now) {
  if (s_frame_samples < 64) {
    return;
  }

  const float rms = sqrtf(s_frame_energy / (float)s_frame_samples);
  float level_db = 20.0f * log10f(rms / MIC_FULL_SCALE);
  if (level_db < (float)ONEPAGE_MIC_METER_FLOOR_DB) {
    level_db = (float)ONEPAGE_MIC_METER_FLOOR_DB;
  }

  if (s_warmup_frames > 0) {
    /* The first block contains the high-pass settling transient. Discard it
     * instead of showing a phantom peak on every recording. */
    s_warmup_frames--;
  } else if (s_calib_frames > 0) {
    /* Auto-range: the first few frames are assumed to be room noise. Use the
     * loudest of them as a conservative floor (a dropped DMA buffer must not
     * drag the estimate down, or silence would still show up as a high bar).
     * The bar floor is then placed just above that level, so a quiet room
     * reads ~0% instead of showing its absolute -33 dBFS as 74%. */
    if (s_calib_frames == ONEPAGE_MIC_CALIB_FRAMES || level_db > s_calib_max_db) {
      s_calib_max_db = level_db;
    }
    s_calib_frames--;

    onepage_mic_status_t next;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    next = s_status;
    xSemaphoreGive(s_lock);
    next.recording = true;
    next.calibrating = true;
    next.elapsed_ms = (uint32_t)((now - s_start_us) / 1000);
    next.frames++;
    next.level_db = clamp_db(level_db);
    next.peak_db = clamp_db(level_db);
    next.avg_db = clamp_db(level_db);
    next.level_pct = 0;
    next.peak_pct = 0;

    if (s_calib_frames == 0) {
      float floor_db = s_calib_max_db + (float)ONEPAGE_MIC_NOISE_MARGIN_DB;
      if (floor_db < (float)ONEPAGE_MIC_METER_FLOOR_DB + 5.0f) {
        floor_db = (float)ONEPAGE_MIC_METER_FLOOR_DB + 5.0f;
      }
      if (floor_db > -20.0f) {
        floor_db = -20.0f;
      }
      s_meter_floor_db = floor_db;
      s_meter_top_db = floor_db + (float)ONEPAGE_MIC_METER_RANGE_DB;
      /* Keep at least the fallback top: in a very quiet room a 30 dB window
       * would otherwise put normal speech at 100% immediately. */
      if (s_meter_top_db < (float)ONEPAGE_MIC_METER_TOP_DB) {
        s_meter_top_db = (float)ONEPAGE_MIC_METER_TOP_DB;
      }
      if (s_meter_top_db > 0.0f) {
        s_meter_top_db = 0.0f;
      }
      s_level_f = s_meter_floor_db;
      next.calibrating = false;
      ESP_LOGI(TAG, "noise floor %d dBFS -> meter %d..%d dBFS",
               (int)lroundf(s_calib_max_db), (int)lroundf(s_meter_floor_db),
               (int)lroundf(s_meter_top_db));
    }
    update_status(&next);
  } else {
    /* Instant attack, ~300 ms release: the meter follows speech onsets but does
     * not flicker between syllables. The e-ink refresh is much slower anyway. */
    if (level_db > s_level_f) {
      s_level_f = level_db;
    } else {
      s_level_f += (level_db - s_level_f) * 0.45f;
    }
    s_total_energy += (double)s_frame_energy;
    s_total_samples += s_frame_samples;
    if (s_frame_peak > s_peak_abs) {
      s_peak_abs = s_frame_peak;
    }

    onepage_mic_status_t next;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    next = s_status;
    xSemaphoreGive(s_lock);

    const double avg_ms = s_total_samples > 0
                              ? s_total_energy / (double)s_total_samples
                              : 0.0;
    const float avg_rms = (float)sqrt(avg_ms);
    const float peak_abs_db =
        s_peak_abs > 0.0f ? 20.0f * log10f(s_peak_abs / MIC_FULL_SCALE)
                          : (float)ONEPAGE_MIC_METER_FLOOR_DB;
    next.recording = true;
    next.calibrating = false;
    next.elapsed_ms = (uint32_t)((now - s_start_us) / 1000);
    next.frames++;
    next.level_db = clamp_db(s_level_f);
    next.peak_db = clamp_db(peak_abs_db);
    next.avg_db = clamp_db(20.0f * log10f(avg_rms / MIC_FULL_SCALE));
    const uint8_t level_pct = db_to_pct(s_level_f);
    next.level_pct = level_pct;
    next.peak_pct = db_to_pct(peak_abs_db);

    if (now - s_history_last_us >= MIC_HISTORY_US) {
      if (next.history_count < ONEPAGE_MIC_HISTORY_LEN) {
        next.history[next.history_count++] = level_pct;
      } else {
        memmove(next.history, next.history + 1, ONEPAGE_MIC_HISTORY_LEN - 1);
        next.history[ONEPAGE_MIC_HISTORY_LEN - 1] = level_pct;
      }
      s_history_last_us = now;
    }
    update_status(&next);
  }

  s_frame_energy = 0.0f;
  s_frame_peak = 0.0f;
  s_frame_samples = 0;
  s_frame_start_us = now;
}

static void process_words(const int16_t *words, size_t count, int64_t now) {
  for (size_t i = 0; i < count; i++) {
    s_bit_acc += (uint32_t)__builtin_popcount((unsigned)(uint16_t)words[i]);
    if (++s_decim_count < MIC_DECIM_WORDS) {
      continue;
    }
    s_decim_count = 0;

    const int pcm = (int)s_bit_acc - MIC_PCM_CENTER;
    s_bit_acc = 0;

    /* DC tracking + high-pass in one pole; PDM "silence" is a 50% duty cycle,
     * which the subtraction removes exactly. */
    s_dc += ((float)pcm - s_dc) * s_hp_alpha;
    const float hp = (float)pcm - s_dc;
    s_frame_energy += hp * hp;
    s_frame_samples++;
    const float magnitude = fabsf(hp);
    if (magnitude > s_frame_peak) {
      s_frame_peak = magnitude;
    }
  }

  if (now - s_frame_start_us >= MIC_FRAME_US) {
    finish_frame(now);
  }
}

static void mic_task(void *arg) {
  (void)arg;
  for (;;) {
    xEventGroupWaitBits(s_events, MIC_EVT_START, pdTRUE, pdFALSE, portMAX_DELAY);
    while (s_capture) {
      size_t bytes_read = 0;
      esp_err_t err = i2s_channel_read(s_rx, s_read_buf, sizeof(s_read_buf), &bytes_read,
                                       pdMS_TO_TICKS(20));
      if (err != ESP_OK || bytes_read == 0) {
        if (s_capture) {
          /* One tick, not pdMS_TO_TICKS(1): at 100 Hz the latter is zero and
           * would turn an error path into a busy loop. */
          vTaskDelay(1);
        }
        continue;
      }
      process_words(s_read_buf, bytes_read / sizeof(int16_t), esp_timer_get_time());

      /* Drain everything already queued without blocking. Otherwise the DMA
       * ring stays full and a 10 ms sleep hands the next read a stale buffer
       * (the meter then shows a frozen value). */
      while (s_capture) {
        bytes_read = 0;
        err = i2s_channel_read(s_rx, s_read_buf, sizeof(s_read_buf), &bytes_read, 0);
        if (err != ESP_OK || bytes_read == 0) {
          break;
        }
        process_words(s_read_buf, bytes_read / sizeof(int16_t), esp_timer_get_time());
      }

      /* The PDM stream can deliver data faster than this loop consumes it, in
       * which case i2s_channel_read() returns immediately forever and this
       * high-priority task would starve IDLE, tripping the task watchdog.
       * Always yield one tick; the meter only needs a representative subset
       * of the stream and the e-ink screen is far slower than this anyway. */
      vTaskDelay(1);
    }
    xEventGroupSetBits(s_events, MIC_EVT_IDLE);
  }
}

esp_err_t onepage_mic_init(void) {
  if (s_initialized) {
    return ESP_OK;
  }

  i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
  /* 8 x 1024 frames = 16 KB, about 64 ms of PDM data: the capture task can be
   * delayed by an e-ink refresh without overflowing the DMA ring. */
  chan_cfg.dma_desc_num = 8;
  chan_cfg.dma_frame_num = 1024;

  esp_err_t err = i2s_new_channel(&chan_cfg, NULL, &s_rx);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "i2s_new_channel failed: %s", esp_err_to_name(err));
    return err;
  }

  const i2s_pdm_rx_config_t pdm_cfg = {
      .clk_cfg = I2S_PDM_RX_CLK_DEFAULT_CONFIG(ONEPAGE_MIC_PDM_CLK_HZ),
      .slot_cfg =
          I2S_PDM_RX_SLOT_RAW_FMT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
      .gpio_cfg =
          {
              .clk = (gpio_num_t)ONEPAGE_PIN_PDM_CLK,
              .din = (gpio_num_t)ONEPAGE_PIN_PDM_DIN,
              .invert_flags = {.clk_inv = false},
          },
  };
  err = i2s_channel_init_pdm_rx_mode(s_rx, &pdm_cfg);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "PDM RX init failed: %s", esp_err_to_name(err));
    i2s_del_channel(s_rx);
    s_rx = NULL;
    return err;
  }

  s_events = xEventGroupCreate();
  s_lock = xSemaphoreCreateMutex();
  if (!s_events || !s_lock) {
    ESP_LOGE(TAG, "mic synchronisation allocation failed");
    if (s_events) {
      vEventGroupDelete(s_events);
      s_events = NULL;
    }
    if (s_lock) {
      vSemaphoreDelete(s_lock);
      s_lock = NULL;
    }
    i2s_del_channel(s_rx);
    s_rx = NULL;
    return ESP_ERR_NO_MEM;
  }

  memset(&s_status, 0, sizeof(s_status));
  s_status.level_db = ONEPAGE_MIC_METER_FLOOR_DB;
  s_status.peak_db = ONEPAGE_MIC_METER_FLOOR_DB;
  s_status.avg_db = ONEPAGE_MIC_METER_FLOOR_DB;
  s_status.pcm_rate_hz = MIC_PCM_HZ;
  s_status.calibrating = false;

  if (xTaskCreate(mic_task, "onepage_mic", MIC_TASK_STACK, NULL, MIC_TASK_PRIORITY, &s_task) !=
      pdPASS) {
    ESP_LOGE(TAG, "mic task creation failed");
    vSemaphoreDelete(s_lock);
    vEventGroupDelete(s_events);
    s_lock = NULL;
    s_events = NULL;
    i2s_del_channel(s_rx);
    s_rx = NULL;
    return ESP_ERR_NO_MEM;
  }

  s_initialized = true;
  ESP_LOGI(TAG, "PDM mic ready: CLK GPIO%d, DIN GPIO%d, %d kHz requested (~%d kword/s, %d Hz PCM)",
           ONEPAGE_PIN_PDM_CLK, ONEPAGE_PIN_PDM_DIN, ONEPAGE_MIC_PDM_CLK_HZ / 1000,
           MIC_WORD_HZ / 1000, MIC_PCM_HZ);
  return ESP_OK;
}

esp_err_t onepage_mic_start(void) {
  if (!s_initialized) {
    return ESP_ERR_INVALID_STATE;
  }
  if (s_running) {
    return ESP_OK;
  }

  reset_dsp();

  onepage_mic_status_t fresh;
  memset(&fresh, 0, sizeof(fresh));
  fresh.recording = true;
  fresh.calibrating = true;
  fresh.level_db = ONEPAGE_MIC_METER_FLOOR_DB;
  fresh.peak_db = ONEPAGE_MIC_METER_FLOOR_DB;
  fresh.avg_db = ONEPAGE_MIC_METER_FLOOR_DB;
  fresh.pcm_rate_hz = MIC_PCM_HZ;
  update_status(&fresh);

  const esp_err_t err = i2s_channel_enable(s_rx);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "i2s_channel_enable failed: %s", esp_err_to_name(err));
    fresh.recording = false;
    update_status(&fresh);
    return err;
  }

  s_capture = true;
  s_running = true;
  xEventGroupClearBits(s_events, MIC_EVT_IDLE);
  xEventGroupSetBits(s_events, MIC_EVT_START);
  return ESP_OK;
}

void onepage_mic_stop(void) {
  if (!s_running) {
    return;
  }

  s_capture = false;
  const EventBits_t bits =
      xEventGroupWaitBits(s_events, MIC_EVT_IDLE, pdFALSE, pdTRUE, pdMS_TO_TICKS(400));
  if ((bits & MIC_EVT_IDLE) == 0) {
    ESP_LOGW(TAG, "capture task did not idle before stop");
  }
  const esp_err_t err = i2s_channel_disable(s_rx);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "i2s_channel_disable failed: %s", esp_err_to_name(err));
  }
  s_running = false;

  onepage_mic_status_t next;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  next = s_status;
  xSemaphoreGive(s_lock);
  next.recording = false;
  next.calibrating = false;
  next.elapsed_ms = (uint32_t)((esp_timer_get_time() - s_start_us) / 1000);
  update_status(&next);
  ESP_LOGI(TAG, "capture stopped after %u ms", (unsigned)next.elapsed_ms);
}

void onepage_mic_get_status(onepage_mic_status_t *out) {
  if (!out) {
    return;
  }
  if (!s_lock) {
    memset(out, 0, sizeof(*out));
    out->level_db = ONEPAGE_MIC_METER_FLOOR_DB;
    out->peak_db = ONEPAGE_MIC_METER_FLOOR_DB;
    out->avg_db = ONEPAGE_MIC_METER_FLOOR_DB;
    out->pcm_rate_hz = MIC_PCM_HZ;
    out->calibrating = false;
    return;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  *out = s_status;
  xSemaphoreGive(s_lock);
}
