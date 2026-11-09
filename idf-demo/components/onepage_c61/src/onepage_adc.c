#include "onepage_adc.h"

#include "driver/rtc_io.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include <string.h>

static const char *TAG = "adc1";

/* The C61 exposes four ADC1 channels. Keep a little headroom so the array
 * index is safe even if this component is ever reused on a wider part. */
#define ONEPAGE_ADC_CALI_SLOTS 8

static adc_oneshot_unit_handle_t s_unit;
static adc_cali_handle_t s_cali[ONEPAGE_ADC_CALI_SLOTS];
static SemaphoreHandle_t s_lock;
static bool s_ready;
static bool s_calibrated_all = true;

/* The C61 eFuse stores a per-channel offset that adc_cali_raw_to_voltage()
 * subtracts from the raw count. The old code created one scheme for channel 0
 * and reused it for channel 3, which applied the wrong offset (a few counts,
 * so small, but still the wrong number). Create one scheme per claimed channel
 * so the calibration context matches the conversion. */
static void create_calibration(adc_channel_t channel) {
  if ((int)channel >= ONEPAGE_ADC_CALI_SLOTS || s_cali[channel]) {
    return;
  }

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
  adc_cali_curve_fitting_config_t curve_cfg = {
      .unit_id = ADC_UNIT_1,
      .chan = channel,
      .atten = ADC_ATTEN_DB_12,
      .bitwidth = ADC_BITWIDTH_DEFAULT,
  };
  if (adc_cali_create_scheme_curve_fitting(&curve_cfg, &s_cali[channel]) == ESP_OK) {
    return;
  }
#endif
#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
  adc_cali_line_fitting_config_t line_cfg = {
      .unit_id = ADC_UNIT_1,
      .atten = ADC_ATTEN_DB_12,
      .bitwidth = ADC_BITWIDTH_DEFAULT,
  };
  if (adc_cali_create_scheme_line_fitting(&line_cfg, &s_cali[channel]) == ESP_OK) {
    return;
  }
#endif
  s_calibrated_all = false;
}

esp_err_t onepage_adc_init(void) {
  if (s_ready) {
    return ESP_OK;
  }

  adc_oneshot_unit_init_cfg_t unit_cfg = {.unit_id = ADC_UNIT_1};
  esp_err_t err = adc_oneshot_new_unit(&unit_cfg, &s_unit);
  if (err != ESP_OK) {
    return err;
  }

  /* The UI task and the key-scan task both sample the front key ladder. The
   * oneshot driver only try-locks the unit (contention returns a timeout), so
   * serialise callers here instead of letting samples vanish. */
  s_lock = xSemaphoreCreateMutex();
  if (!s_lock) {
    ESP_LOGE(TAG, "ADC mutex allocation failed");
    return ESP_ERR_NO_MEM;
  }

  s_ready = true;
  ESP_LOGI(TAG, "ADC1 ready; calibration is created per claimed channel");
  return ESP_OK;
}

int onepage_adc_claim_gpio(int gpio) {
  if (onepage_adc_init() != ESP_OK) {
    return -1;
  }
  adc_unit_t unit = ADC_UNIT_1;
  adc_channel_t channel = ADC_CHANNEL_0;
  if (adc_oneshot_io_to_channel(gpio, &unit, &channel) != ESP_OK || unit != ADC_UNIT_1) {
    ESP_LOGW(TAG, "GPIO%d is not an ADC1 pin", gpio);
    return -1;
  }

  adc_oneshot_chan_cfg_t chan_cfg = {
      .atten = ADC_ATTEN_DB_12,
      .bitwidth = ADC_BITWIDTH_DEFAULT,
  };
  esp_err_t err = adc_oneshot_config_channel(s_unit, channel, &chan_cfg);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "channel config failed: %s", esp_err_to_name(err));
    return -1;
  }

  /* GPIO4/5 are LP (RTC-domain) pins on the C61. gpio_config_as_analog() only
   * clears the RTC pulls when it believes the LP IO mux is in use; on the ADC
   * path that can be false and an RTC pull-up stays enabled. The battery
   * divider is 5.1 M + 5.1 M, so even a weak pull-up lifts the node by hundreds
   * of millivolts (a ~3.0 V reading instead of battery/2) and the gauge shows a
   * phantom 6 V pack. Clear both RTC pulls explicitly. */
  if (rtc_gpio_is_valid_gpio((gpio_num_t)gpio)) {
    /* Match what IDF 5.5's gpio_config_as_analog() did unconditionally; 6.1
     * moved these behind an "LP IO in use" check. */
    rtc_gpio_set_direction((gpio_num_t)gpio, RTC_GPIO_MODE_DISABLED);
    rtc_gpio_pullup_dis((gpio_num_t)gpio);
    rtc_gpio_pulldown_dis((gpio_num_t)gpio);
    ESP_LOGI(TAG, "cleared RTC direction/pulls on GPIO%d", gpio);
  }

  create_calibration(channel);
  ESP_LOGI(TAG, "GPIO%d -> ADC1 channel %d, calibration: %s", gpio, (int)channel,
           s_cali[channel] ? "hardware" : "approximate (linear fallback)");
  return (int)channel;
}

static esp_err_t read_one(int channel, int *raw, int *mv) {
  int sample = 0;
  esp_err_t err = adc_oneshot_read(s_unit, (adc_channel_t)channel, &sample);
  if (err != ESP_OK) {
    return err;
  }
  if (raw) {
    *raw = sample;
  }
  if (mv) {
    int millivolts = 0;
    if (s_cali[channel] &&
        adc_cali_raw_to_voltage(s_cali[channel], sample, &millivolts) == ESP_OK) {
      *mv = millivolts;
    } else {
      /* 12 dB attenuation gives roughly a 3.1 V full scale; good enough to tell
       * the key windows apart, printed as a warning by the caller. */
      *mv = sample * 3100 / 4095;
    }
  }
  return ESP_OK;
}

esp_err_t onepage_adc_read(int channel, int *raw, int *mv) {
  if (!s_ready || channel < 0 || channel >= ONEPAGE_ADC_CALI_SLOTS) {
    return ESP_ERR_INVALID_STATE;
  }
  if (s_lock) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
  }
  const esp_err_t err = read_one(channel, raw, mv);
  if (s_lock) {
    xSemaphoreGive(s_lock);
  }
  return err;
}

esp_err_t onepage_adc_read_burst(int channel, int samples, int *avg_raw, int *avg_mv) {
  if (!s_ready || channel < 0 || channel >= ONEPAGE_ADC_CALI_SLOTS || samples <= 0) {
    return ESP_ERR_INVALID_STATE;
  }
  /* Hold the unit for the whole burst: the key task must not slip a channel-2
   * conversion between two channel-3 samples. The first conversion after a
   * channel switch is the least accurate one, and interleaving would put one
   * of those into the average every time the key task preempts us. */
  if (s_lock) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
  }
  int64_t sum_raw = 0;
  int64_t sum_mv = 0;
  int valid = 0;
  for (int i = 0; i < samples; i++) {
    int raw = 0;
    int mv = 0;
    if (read_one(channel, &raw, &mv) != ESP_OK) {
      continue;
    }
    sum_raw += raw;
    sum_mv += mv;
    valid++;
  }
  if (s_lock) {
    xSemaphoreGive(s_lock);
  }
  if (valid == 0) {
    return ESP_FAIL;
  }
  if (avg_raw) {
    *avg_raw = (int)(sum_raw / valid);
  }
  if (avg_mv) {
    *avg_mv = (int)(sum_mv / valid);
  }
  return ESP_OK;
}

bool onepage_adc_calibrated(void) { return s_calibrated_all; }
