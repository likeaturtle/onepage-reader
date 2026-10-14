#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

typedef enum {
  BOARD_BTN_BACK = 0,
  BOARD_BTN_CONFIRM,
  BOARD_BTN_LEFT,
  BOARD_BTN_RIGHT,
  BOARD_BTN_UP,
  BOARD_BTN_DOWN,
  BOARD_BTN_POWER,
  BOARD_BTN_COUNT
} board_btn_t;

esp_err_t board_buttons_init(void);

/* Bit (1 << board_btn_t) for every key currently held. */
uint32_t board_buttons_poll(void);

/* Last raw ADC sample of the front-key ladder (diagnostics). */
int board_buttons_last_adc_raw(void);
/* Same sample converted to millivolts, or -1 when no calibration is available
 * and the raw-to-mV fallback was used (then the value is approximate). */
int board_buttons_last_adc_mv(void);
/* True when the ADC unit was calibrated (curve/line fitting available). */
bool board_buttons_adc_calibrated(void);

const char *board_button_name(int index);
