#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

/* PDM microphone on the shared SD/EPD rail: CLK = GPIO7, DIN = GPIO3.
 *
 * The C61 I2S block has no PDM-to-PCM converter, so the driver hands over raw
 * PDM words (16 one-bit samples per word). This module box-filters 8 words
 * (128 PDM bits) into one 16 kHz PCM sample, removes the DC component and
 * publishes RMS/peak levels plus a scrolling level history. */

/* Requested PDM oversampling clock. Measured on this board: the I2S CLK pin
 * runs at 2x the configured value (2.048 MHz requested produced a 256 kHz
 * word rate), so 1.024 MHz here gives the intended ~2.048 MHz PDM clock,
 * ~128 kwords/s and ~16 kHz PCM after the 8-word decimation. */
#define ONEPAGE_MIC_PDM_CLK_HZ 1024000

/* Fallback meter window, used until the per-take noise floor is measured. The
 * bar is auto-ranged after about 500 ms: 0% sits just above the ambient level,
 * so a silent room reads ~0 instead of 70%. */
#define ONEPAGE_MIC_METER_FLOOR_DB (-70)
#define ONEPAGE_MIC_METER_TOP_DB (-20)

/* Auto-range: the bar floor is placed this many dB above the measured noise,
 * and the top is this many dB above the floor (clamped at 0 dBFS). */
#define ONEPAGE_MIC_NOISE_MARGIN_DB 3
#define ONEPAGE_MIC_METER_RANGE_DB 30

/* Quiet lead-in frames used to estimate the ambient level before the meter
 * starts moving (100 ms per frame). */
#define ONEPAGE_MIC_CALIB_FRAMES 4

/* One history entry per 200 ms; 64 entries cover the last ~13 seconds. */
#define ONEPAGE_MIC_HISTORY_LEN 64

typedef struct {
  bool recording;
  bool calibrating;
  uint32_t elapsed_ms;
  uint16_t frames;
  uint8_t level_pct;
  uint8_t peak_pct;
  int16_t level_db;
  int16_t peak_db;
  int16_t avg_db;
  uint16_t pcm_rate_hz;
  uint8_t history_count;
  uint8_t history[ONEPAGE_MIC_HISTORY_LEN];
} onepage_mic_status_t;

/* Allocate the I2S PDM RX channel and start the capture task. The task idles
 * (channel disabled, no PDM clock) until onepage_mic_start(). */
esp_err_t onepage_mic_init(void);

/* Start a capture. Returns ESP_ERR_INVALID_STATE before init. */
esp_err_t onepage_mic_start(void);

/* Stop the capture and leave the final numbers in the status snapshot. Safe to
 * call when not recording. */
void onepage_mic_stop(void);

/* Copy the latest metrics. Safe to call from another task while capturing. */
void onepage_mic_get_status(onepage_mic_status_t *out);
