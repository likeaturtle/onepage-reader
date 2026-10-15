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
    return 0;
  }
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_BAT_CHG_EN, 0);
  vTaskDelay(pdMS_TO_TICKS(20)); /* let the cell terminal voltage settle */

  /* The vendor BSP takes a single reading, which jitters by several millivolts
   * and makes the caller think the charge level is changing. Average instead. */
  uint32_t sum_mv = 0;
  int samples = 0;
  for (int i = 0; i < ONEPAGE_BATTERY_SAMPLES; i++) {
    int raw = 0, mv = 0;
    if (onepage_adc_read(s_bat_channel, &raw, &mv) != ESP_OK) {
      break;
    }
    sum_mv += (uint32_t)mv;
    samples++;
  }
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_BAT_CHG_EN, 1);
  if (samples == 0) {
    return 0;
  }
  return (uint16_t)((sum_mv / (uint32_t)samples) * ONEPAGE_BATTERY_DIVIDER);
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
