#pragma once

#include <stdint.h>
#include "esp_err.h"

typedef enum {
  /* Differential update against the previously displayed frame: cheapest,
   * used for most redraws. */
  EPD_REFRESH_FAST = 0,
  /* Differential with a state-collapsed waveform plus a high-temperature
   * register write, i.e. a stronger, slightly slower clean-up pass. */
  EPD_REFRESH_HALF,
  /* Full waveform with the RED plane bypassed: strongest drive, clears
   * accumulated ghosting. Used at boot and after grayscale. */
  EPD_REFRESH_FULL
} epd_refresh_mode_t;

/* Bring up the bus, the control pins and the panel controller.
 * board_power_init() must already have powered the rail. */
esp_err_t epd_init(void);

/* 48000-byte framebuffer: 100 bytes per row, MSB = leftmost pixel,
 * bit set = white, bit clear = black. */
uint8_t *epd_framebuffer(void);
void epd_fill(uint8_t pattern);

/* Push the framebuffer to the panel and wait for the refresh to finish. */
void epd_refresh(epd_refresh_mode_t mode);

/* Park the panel (analog rails down, controller into deep sleep). The image
 * stays on screen. */
void epd_sleep(void);
