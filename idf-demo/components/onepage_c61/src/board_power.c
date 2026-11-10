#include "board_power.h"

#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_idf_version.h"
#include "onepage_adc.h"
#include "onepage_pins.h"

#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "board";

static int s_bat_channel = -1;

esp_err_t board_power_init(void) {
  /* GPIO27 is the shared EPD / microSD / microphone power enable. The low
   * pulse both power-cycles that rail (which hardware-resets the panel) and
   * guarantees a known state after a wake from deep sleep, where the pin was
   * latched low with gpio_hold_en(). A hold survives the wake reset, so it has
   * to be released first or the rail would stay off forever. */
  gpio_hold_dis((gpio_num_t)ONEPAGE_PIN_EPD_RST);
  gpio_set_direction((gpio_num_t)ONEPAGE_PIN_EPD_RST, GPIO_MODE_OUTPUT);
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_RST, 1);
  vTaskDelay(pdMS_TO_TICKS(20));
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_RST, 0);
  vTaskDelay(pdMS_TO_TICKS(120));
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_RST, 1);
  vTaskDelay(pdMS_TO_TICKS(120)); /* let the rail settle before the SD mounts */

  /* The SD card shares the SPI bus with the panel. This application never
   * mounts a card, but its CS line must still be parked high: a floating CS
   * can let the card drive MISO while the panel is being addressed. */
  gpio_config_t sd_cs_cfg = {
      .pin_bit_mask = 1ULL << ONEPAGE_PIN_SD_CS,
      .mode = GPIO_MODE_OUTPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  gpio_config(&sd_cs_cfg);
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_SD_CS, 1);

  /* USB_DET is an open-drain output of the LM66200 power mux: it pulls low
   * when USB power is present and floats otherwise, so it needs a pull-up. */
  gpio_config_t usb_cfg = {
      .pin_bit_mask = 1ULL << ONEPAGE_PIN_USB_DET,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  esp_err_t err = gpio_config(&usb_cfg);
  if (err != ESP_OK) {
    return err;
  }

  /* Charging stays enabled until a sample is taken; then it is paused so the
   * charger's terminal voltage does not inflate the reading. */
  gpio_set_direction((gpio_num_t)ONEPAGE_PIN_BAT_CHG_EN, GPIO_MODE_OUTPUT);
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_BAT_CHG_EN, 1);

  s_bat_channel = onepage_adc_claim_gpio(ONEPAGE_PIN_BAT_ADC);
  if (s_bat_channel < 0) {
    ESP_LOGW(TAG, "battery ADC channel unavailable");
  }

  ESP_LOGI(TAG, "power rail up (GPIO%d high), USB %s", ONEPAGE_PIN_EPD_RST,
           board_usb_connected() ? "present" : "absent");
  return ESP_OK;
}

bool board_usb_connected(void) {
  return gpio_get_level((gpio_num_t)ONEPAGE_PIN_USB_DET) == 0;
}

uint16_t board_battery_read_mv(void) {
  if (s_bat_channel < 0) {
    ESP_LOGW(TAG, "battery ADC channel unavailable");
    return 0;
  }
  /* Diagnostic: sample once with charging still enabled. If the node is fine
   * here but collapses to ~3 V after the pause, BAT_CHG_EN is gating the sense
   * path rather than just the charge current. */
  int pre_raw = 0;
  int pre_mv = 0;
  const esp_err_t pre_err = onepage_adc_read(s_bat_channel, &pre_raw, &pre_mv);

  gpio_set_level((gpio_num_t)ONEPAGE_PIN_BAT_CHG_EN, 0);
  /* The vendor BSP samples 5 ms after pausing the charger. Do not stretch this:
   * the BAT_CHG_EN net also gates the battery-sense path on this board, and a
   * longer pause lets the high-impedance divider node drift up to ~3 V (which
   * the x2 conversion reports as a phantom ~6 V pack). */
  vTaskDelay(pdMS_TO_TICKS(5));

  /* The vendor BatteryMonitor takes a single analogReadMilliVolts() sample.
   * Log that first sample separately: if the following burst drifts upward,
   * averaging it is what turns a good first reading into a phantom 5-6 V. */
  int first_raw = 0;
  int first_mv = 0;
  const esp_err_t first_err = onepage_adc_read(s_bat_channel, &first_raw, &first_mv);

  /* Average a burst while holding the ADC unit; see onepage_adc_read_burst().
   * A single reading jitters by several millivolts, which used to make the
   * caller think the charge level was changing. */
  int raw = 0;
  int pin_mv = 0;
  const esp_err_t err =
      onepage_adc_read_burst(s_bat_channel, ONEPAGE_BATTERY_SAMPLES, &raw, &pin_mv);
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_BAT_CHG_EN, 1);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "battery ADC read failed: %s", esp_err_to_name(err));
    return 0;
  }

  const int paused_raw = raw;
  const int paused_pin_mv = pin_mv;
  const uint16_t paused_pack_mv = (uint16_t)(pin_mv * ONEPAGE_BATTERY_DIVIDER);
  const uint16_t first_pack_mv =
      first_err == ESP_OK ? (uint16_t)(first_mv * ONEPAGE_BATTERY_DIVIDER) : 0;
  uint16_t pack_mv = paused_pack_mv;

  /* A burst can drift upward when a high-impedance node is sampled; the vendor
   * firmware reads one sample only. Prefer a plausible first sample over an
   * implausible average. */
  if (first_pack_mv >= 2500 && first_pack_mv <= 4400 &&
      (paused_pack_mv < 2500 || paused_pack_mv > 4400)) {
    pack_mv = first_pack_mv;
  }

  /* If pausing the charger leaves the sense node floating, both readings are
   * unusable. Fall back to a sample with charging enabled; it is at worst the
   * charger's CV voltage, still far better than a phantom 6 V pack. */
  if (pack_mv < 2500 || pack_mv > 4400) {
    int retry_raw = 0;
    int retry_pin_mv = 0;
    if (onepage_adc_read_burst(s_bat_channel, ONEPAGE_BATTERY_SAMPLES, &retry_raw,
                               &retry_pin_mv) == ESP_OK) {
      const uint16_t retry_pack_mv = (uint16_t)(retry_pin_mv * ONEPAGE_BATTERY_DIVIDER);
      ESP_LOGW(TAG,
               "battery: paused reading %u mV is implausible; charging reading %u mV",
               (unsigned)pack_mv, (unsigned)retry_pack_mv);
      if (retry_pack_mv >= 2500 && retry_pack_mv <= 4400) {
        pack_mv = retry_pack_mv;
      }
    }
  }

  /* DEBUG: the raw count separates a wrong calibration from an input that is
   * genuinely at ~3 V. The user-visible summary is logged by refresh_battery. */
  if (pre_err == ESP_OK) {
    ESP_LOGD(TAG,
             "battery: charging raw=%d pin=%d; paused first raw=%d pin=%d; burst raw=%d "
             "pin=%d; using %u mV",
             pre_raw, pre_mv, first_raw, first_mv, paused_raw, paused_pin_mv,
             (unsigned)pack_mv);
  } else {
    ESP_LOGD(TAG,
             "battery: paused first raw=%d pin=%d; burst raw=%d pin=%d; using %u mV",
             first_raw, first_mv, paused_raw, paused_pin_mv, (unsigned)pack_mv);
  }
  return pack_mv;
}

uint8_t board_battery_percent(uint16_t millivolts) {
  /* Cubic fit of the discharge curve, same coefficients as the vendor BSP. */
  const double volts = millivolts / 1000.0;
  double percent = -144.9390 * volts * volts * volts + 1655.8629 * volts * volts - 6158.8520 * volts + 7501.3202;
  if (percent < 0.0) {
    percent = 0.0;
  }
  if (percent > 100.0) {
    percent = 100.0;
  }
  return (uint8_t)(percent + 0.5);
}

void board_power_enter_deep_sleep(void) {
  /* POWER is a level-triggered deep-sleep wake source. The 2 s hold fires the
   * sleep request while the finger is still down, and arming the wake with the
   * key already low makes the chip wake up again immediately (the lock screen
   * flashes, then the calendar flashes back). Wait for the release first; the
   * timeout only stops a stuck key from keeping us awake forever. */
  const gpio_config_t power_cfg = {
      .pin_bit_mask = 1ULL << ONEPAGE_PIN_BTN_POWER,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  gpio_config(&power_cfg);
  for (int waited_ms = 0; waited_ms < 3000; waited_ms += 20) {
    if (gpio_get_level((gpio_num_t)ONEPAGE_PIN_BTN_POWER) != 0) {
      break;
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }

  /* Cutting the rail while the shared bus and the microphone lines are still
   * driven would back-power the card through its ESD diodes (and can latch it),
   * so every line that reaches a peripheral on that rail is parked first. The
   * panel is expected to be in its own deep sleep by now (epd_sleep()). */
  /* BUSY belongs to the panel and MISO to the card, so both stay inputs: only
   * the lines the MCU drives are parked. */
  const gpio_num_t shared[] = {
      (gpio_num_t)ONEPAGE_PIN_EPD_SCLK, (gpio_num_t)ONEPAGE_PIN_EPD_MOSI,
      (gpio_num_t)ONEPAGE_PIN_EPD_CS,   (gpio_num_t)ONEPAGE_PIN_SD_CS,
      (gpio_num_t)ONEPAGE_PIN_EPD_DC,
  };
  for (size_t i = 0; i < sizeof(shared) / sizeof(shared[0]); i++) {
    gpio_set_direction(shared[i], GPIO_MODE_OUTPUT);
    gpio_set_level(shared[i], 0);
  }

  gpio_set_direction((gpio_num_t)ONEPAGE_PIN_PDM_CLK, GPIO_MODE_OUTPUT);
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_PDM_CLK, 0);
  gpio_set_direction((gpio_num_t)ONEPAGE_PIN_PDM_DIN, GPIO_MODE_INPUT);

  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_RST, 0);
  gpio_hold_en((gpio_num_t)ONEPAGE_PIN_EPD_RST);
  /* No gpio_deep_sleep_hold_en() here: the C61 holds individual pads in deep
   * sleep on its own (SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP), so the global
   * call does not even exist on this target. The vendor firmware guards it the
   * same way. gpio_hold_dis() in board_power_init() releases it on wake. */

  /* Wake on the POWER key (GPIO2), which is an LP GPIO on the C61. */
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(6, 0, 0)
  /* IDF 6.0 folded the deep-sleep GPIO wakeup source into this single API. */
  esp_sleep_enable_gpio_wakeup_on_hp_periph_powerdown(1ULL << ONEPAGE_PIN_BTN_POWER,
                                                      ESP_GPIO_WAKEUP_GPIO_LOW);
#else
  esp_deep_sleep_enable_gpio_wakeup(1ULL << ONEPAGE_PIN_BTN_POWER, ESP_GPIO_WAKEUP_GPIO_LOW);
#endif

  ESP_LOGI(TAG, "entering deep sleep; press POWER to wake");
  esp_deep_sleep_start();
}
