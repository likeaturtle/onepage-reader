#include "onepage_adc.h"

#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include <string.h>

static const char *TAG = "adc1";

static adc_oneshot_unit_handle_t s_unit;
static adc_cali_handle_t s_cali;
static SemaphoreHandle_t s_lock;
static bool s_ready;
static bool s_calibrated;

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

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
  adc_cali_curve_fitting_config_t curve_cfg = {
      .unit_id = ADC_UNIT_1,
      .atten = ADC_ATTEN_DB_12,
      .bitwidth = ADC_BITWIDTH_DEFAULT,
  };
  if (adc_cali_create_scheme_curve_fitting(&curve_cfg, &s_cali) == ESP_OK) {
    s_calibrated = true;
  }
#endif
#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
  if (!s_calibrated) {
    adc_cali_line_fitting_config_t line_cfg = {
        .unit_id = ADC_UNIT_1,
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    if (adc_cali_create_scheme_line_fitting(&line_cfg, &s_cali) == ESP_OK) {
      s_calibrated = true;
    }
  }
#endif

  s_ready = true;
  ESP_LOGI(TAG, "ADC1 ready, calibration: %s", s_calibrated ? "hardware" : "approximate (linear fallback)");
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
  return (int)channel;
}

esp_err_t onepage_adc_read(int channel, int *raw, int *mv) {
  if (!s_ready || channel < 0) {
    return ESP_ERR_INVALID_STATE;
  }
  if (s_lock) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
  }
  int sample = 0;
  esp_err_t err = adc_oneshot_read(s_unit, (adc_channel_t)channel, &sample);
  if (err != ESP_OK) {
    if (s_lock) {
      xSemaphoreGive(s_lock);
    }
    return err;
  }
  if (raw) {
    *raw = sample;
  }
  if (mv) {
    int millivolts = 0;
    if (s_calibrated && adc_cali_raw_to_voltage(s_cali, sample, &millivolts) == ESP_OK) {
      *mv = millivolts;
    } else {
      /* 12 dB attenuation gives roughly a 3.1 V full scale; good enough to tell
       * the key windows apart, printed as a warning by the caller. */
      *mv = sample * 3100 / 4095;
    }
  }
  if (s_lock) {
    xSemaphoreGive(s_lock);
  }
  return ESP_OK;
}

bool onepage_adc_calibrated(void) { return s_calibrated; }
