#pragma once

/*
 * Shared ADC1 access for the board component (internal helper).
 *
 * Both the front-key ladder (GPIO4) and the battery divider (GPIO5) sit on
 * ADC1, and only one unit handle can own the unit, so every reader goes
 * through here.
 */

#include <stdbool.h>
#include "esp_adc/adc_oneshot.h"

/* Idempotent: the first call initialises ADC1 and the calibration scheme. */
esp_err_t onepage_adc_init(void);

/* Map a GPIO to its ADC1 channel and configure it. Returns the channel, or -1
 * (cast-safe) when the pin is not an ADC1 pin. */
int onepage_adc_claim_gpio(int gpio);

/* Read a claimed channel. `mv` may be NULL. Returns ESP_ERR_INVALID_STATE when
 * the channel was never claimed. */
esp_err_t onepage_adc_read(int channel, int *raw, int *mv);

/* False when no hardware calibration scheme is available; millivolt values are
 * then a linear approximation and the key windows should be re-checked. */
bool onepage_adc_calibrated(void);
