#include "board_buttons.h"

#include "esp_log.h"
#include "onepage_adc.h"
#include "onepage_pins.h"

#include "driver/gpio.h"

static const char *TAG = "buttons";

/*
 * Front four keys are a resistor ladder on one ADC pin. Windows below are the
 * ones the vendor BSP uses on this hardware (millivolt values measured on real
 * boards; ENTER is a 0-ohm short to ground, hence "<= 250 mV"):
 *   BACK ~2592 mV, LEFT ~1956 mV, RIGHT ~1316 mV, CONFIRM ~0 mV, idle ~3100 mV
 * The idle value must fall outside every window, otherwise the ladder is not
 * powered and all keys read as released.
 */
#define KEY_BACK_MV_MIN 2400
#define KEY_BACK_MV_MAX 2800
#define KEY_LEFT_MV_MIN 1780
#define KEY_LEFT_MV_MAX 2140
#define KEY_RIGHT_MV_MIN 1140
#define KEY_RIGHT_MV_MAX 1500
#define KEY_CONFIRM_MV_MAX 250

static int s_btn_channel = -1;
static int s_last_raw;
static int s_last_mv = -1;

static const char *const kNames[BOARD_BTN_COUNT] = {"BACK", "CONFIRM", "LEFT", "RIGHT", "UP", "DOWN", "POWER"};

static void configure_side_key(int pin) {
  gpio_config_t cfg = {
      .pin_bit_mask = 1ULL << pin,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  gpio_config(&cfg);
}

esp_err_t board_buttons_init(void) {
  configure_side_key(ONEPAGE_PIN_BTN_UP);
  configure_side_key(ONEPAGE_PIN_BTN_DOWN);
  configure_side_key(ONEPAGE_PIN_BTN_POWER);

  s_btn_channel = onepage_adc_claim_gpio(ONEPAGE_PIN_BTN_ADC);
  if (s_btn_channel < 0) {
    ESP_LOGE(TAG, "front-key ADC channel unavailable on GPIO%d", ONEPAGE_PIN_BTN_ADC);
    return ESP_ERR_NOT_FOUND;
  }
  if (!onepage_adc_calibrated()) {
    ESP_LOGW(TAG, "no ADC calibration; the key windows below are approximate");
  }
  return ESP_OK;
}

uint32_t board_buttons_poll(void) {
  uint32_t mask = 0;
  if (s_btn_channel >= 0) {
    int raw = 0, mv = 0;
    if (onepage_adc_read(s_btn_channel, &raw, &mv) == ESP_OK) {
      s_last_raw = raw;
      s_last_mv = mv;
      if (mv >= KEY_BACK_MV_MIN && mv <= KEY_BACK_MV_MAX) {
        mask |= 1u << BOARD_BTN_BACK;
      } else if (mv >= KEY_LEFT_MV_MIN && mv <= KEY_LEFT_MV_MAX) {
        mask |= 1u << BOARD_BTN_LEFT;
      } else if (mv >= KEY_RIGHT_MV_MIN && mv <= KEY_RIGHT_MV_MAX) {
        mask |= 1u << BOARD_BTN_RIGHT;
      } else if (mv <= KEY_CONFIRM_MV_MAX) {
        mask |= 1u << BOARD_BTN_CONFIRM;
      }
    }
  }
  if (gpio_get_level((gpio_num_t)ONEPAGE_PIN_BTN_UP) == 0) {
    mask |= 1u << BOARD_BTN_UP;
  }
  if (gpio_get_level((gpio_num_t)ONEPAGE_PIN_BTN_DOWN) == 0) {
    mask |= 1u << BOARD_BTN_DOWN;
  }
  if (gpio_get_level((gpio_num_t)ONEPAGE_PIN_BTN_POWER) == 0) {
    mask |= 1u << BOARD_BTN_POWER;
  }
  return mask;
}

int board_buttons_last_adc_raw(void) { return s_last_raw; }
int board_buttons_last_adc_mv(void) { return s_last_mv; }
bool board_buttons_adc_calibrated(void) { return onepage_adc_calibrated(); }

const char *board_button_name(int index) {
  if (index >= 0 && index < BOARD_BTN_COUNT) {
    return kNames[index];
  }
  return "?";
}
