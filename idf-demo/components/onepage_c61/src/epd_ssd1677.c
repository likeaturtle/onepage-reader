/*
 * SSD1677 e-paper driver for the OnePage C61 panel (800x480).
 *
 * The command sequences, waveform handling and RAM windowing are ported from
 * the vendor board-support package (open-onepage-sdk, MIT, itself derived from
 * the OpenX4 community SDK) because they encode panel-specific values that are
 * not in the public SSD1677 datasheet. Keep them in sync with
 * firmware/open-onepage-sdk/libs/display/EInkDisplay if the panel changes.
 */

#include "epd_ssd1677.h"

#include "onepage_pins.h"

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_attr.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include <string.h>

static const char *TAG = "epd";

/* SSD1677 command set (only what this driver needs). */
#define CMD_DRIVER_OUTPUT_CONTROL 0x01
#define CMD_BOOSTER_SOFT_START 0x0C
#define CMD_DEEP_SLEEP 0x10
#define CMD_DATA_ENTRY_MODE 0x11
#define CMD_SOFT_RESET 0x12
#define CMD_TEMP_SENSOR_CONTROL 0x18
#define CMD_WRITE_TEMP 0x1A
#define CMD_MASTER_ACTIVATION 0x20
#define CMD_DISPLAY_UPDATE_CTRL1 0x21
#define CMD_DISPLAY_UPDATE_CTRL2 0x22
#define CMD_WRITE_RAM_BW 0x24
#define CMD_WRITE_RAM_RED 0x26
#define CMD_BORDER_WAVEFORM 0x3C
#define CMD_SET_RAM_X_RANGE 0x44
#define CMD_SET_RAM_Y_RANGE 0x45
#define CMD_AUTO_WRITE_BW_RAM 0x46
#define CMD_AUTO_WRITE_RED_RAM 0x47
#define CMD_SET_RAM_X_COUNTER 0x4E
#define CMD_SET_RAM_Y_COUNTER 0x4F

/* Display Update Control 1: compare both RAM planes (differential) ... */
#define CTRL1_DIFFERENTIAL 0x00
/* ... or ignore the RED plane entirely (clean full refresh). */
#define CTRL1_BYPASS_RED 0x40

/* Display Update Control 2 bits. */
#define CTRL2_CLOCK_ON 0x80
#define CTRL2_ANALOG_ON 0x40
#define CTRL2_TEMP_LOAD 0x20
#define CTRL2_LUT_LOAD 0x10
#define CTRL2_MODE_SELECT 0x08
#define CTRL2_DISPLAY_START 0x04
#define CTRL2_ANALOG_OFF 0x02
#define CTRL2_CLOCK_OFF 0x01

/* Panel transfer chunk; DMA-capable internal RAM, so the framebuffer itself is
 * free to live in PSRAM. */
#define EPD_CHUNK 4096

static spi_device_handle_t s_spi;
static uint8_t *s_fb;
static DMA_ATTR uint8_t s_chunk[EPD_CHUNK];
static bool s_screen_on;

/* --- low level ---------------------------------------------------------- */

static void epd_cmd(uint8_t cmd) {
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_DC, 0);
  spi_transaction_t t = {
      .flags = SPI_TRANS_USE_TXDATA,
      .length = 8,
      .tx_data = {cmd, 0, 0, 0},
  };
  ESP_ERROR_CHECK(spi_device_polling_transmit(s_spi, &t));
}

static void epd_data(const uint8_t *data, size_t len) {
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_DC, 1);
  while (len > 0) {
    const size_t n = (len > EPD_CHUNK) ? EPD_CHUNK : len;
    memcpy(s_chunk, data, n);
    spi_transaction_t t = {
        .length = n * 8,
        .tx_buffer = s_chunk,
    };
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_spi, &t));
    data += n;
    len -= n;
  }
}

static void epd_data8(uint8_t value) { epd_data(&value, 1); }

/* BUSY is active high on this controller: high while the internal sequence is
 * running, low when it is done. */
static void epd_wait_busy(const char *what) {
  const int64_t start = esp_timer_get_time();
  while (gpio_get_level((gpio_num_t)ONEPAGE_PIN_EPD_BUSY) != 0) {
    vTaskDelay(pdMS_TO_TICKS(1));
    if (esp_timer_get_time() - start > 30LL * 1000 * 1000) {
      ESP_LOGW(TAG, "%s: busy timeout, continuing", what);
      break;
    }
  }
}

/* Full-screen RAM window. Note the panel's gate scan is reversed, hence the
 * Y flip, and X addresses are in pixels, not bytes. */
static void epd_set_ram_window(void) {
  const uint16_t x = 0;
  const uint16_t y = 0;
  const uint16_t w = ONEPAGE_EPD_WIDTH;
  const uint16_t h = ONEPAGE_EPD_HEIGHT;
  const uint16_t y_start = h - 1; /* reversed: counter walks downwards from here */

  epd_cmd(CMD_DATA_ENTRY_MODE);
  epd_data8(0x01); /* X increment, Y decrement */

  epd_cmd(CMD_SET_RAM_X_RANGE);
  epd_data8(x % 256);
  epd_data8(x / 256);
  epd_data8((x + w - 1) % 256);
  epd_data8((x + w - 1) / 256);

  epd_cmd(CMD_SET_RAM_Y_RANGE);
  epd_data8(y_start % 256);
  epd_data8(y_start / 256);
  epd_data8((y + 0) % 256);
  epd_data8((y + 0) / 256);

  epd_cmd(CMD_SET_RAM_X_COUNTER);
  epd_data8(x % 256);
  epd_data8(x / 256);

  epd_cmd(CMD_SET_RAM_Y_COUNTER);
  epd_data8(y_start % 256);
  epd_data8(y_start / 256);
}

static void epd_write_ram(uint8_t ram_cmd, const uint8_t *buffer) {
  epd_cmd(ram_cmd);
  epd_data(buffer, ONEPAGE_EPD_BUFFER_SIZE);
}

static void epd_init_controller(void) {
  epd_cmd(CMD_SOFT_RESET);
  epd_wait_busy("soft reset");

  epd_cmd(CMD_TEMP_SENSOR_CONTROL);
  epd_data8(0x80); /* use the internal temperature sensor */

  /* Booster soft-start, panel-specific values. */
  epd_cmd(CMD_BOOSTER_SOFT_START);
  epd_data8(0xAE);
  epd_data8(0xC7);
  epd_data8(0xC3);
  epd_data8(0xC0);
  epd_data8(0x40);

  epd_cmd(CMD_DRIVER_OUTPUT_CONTROL);
  epd_data8((ONEPAGE_EPD_HEIGHT - 1) % 256);
  epd_data8((ONEPAGE_EPD_HEIGHT - 1) / 256);
  epd_data8(0x02); /* SM=1 interlaced, TB=0 */

  epd_cmd(CMD_BORDER_WAVEFORM);
  epd_data8(0x01);

  epd_set_ram_window();

  /* Fill both RAM planes with white so the first differential update has a
   * defined "previous frame". */
  epd_cmd(CMD_AUTO_WRITE_BW_RAM);
  epd_data8(0xF7);
  epd_wait_busy("clear BW RAM");
  epd_cmd(CMD_AUTO_WRITE_RED_RAM);
  epd_data8(0xF7);
  epd_wait_busy("clear RED RAM");
}

/* --- public API --------------------------------------------------------- */

esp_err_t epd_init(void) {
  gpio_config_t dc_cfg = {
      .pin_bit_mask = (1ULL << ONEPAGE_PIN_EPD_DC) | (1ULL << ONEPAGE_PIN_EPD_RST),
      .mode = GPIO_MODE_OUTPUT,
  };
  ESP_RETURN_ON_ERROR(gpio_config(&dc_cfg), TAG, "control pin config failed");

  gpio_config_t busy_cfg = {
      .pin_bit_mask = 1ULL << ONEPAGE_PIN_EPD_BUSY,
      .mode = GPIO_MODE_INPUT,
  };
  ESP_RETURN_ON_ERROR(gpio_config(&busy_cfg), TAG, "busy pin config failed");

  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_DC, 1);
  /* No reset pulse here: board_power_init() already power-cycled the shared
   * rail, which resets the panel. Pulsing GPIO27 again would brown out the
   * microSD card mounted on the same rail. */
  gpio_set_level((gpio_num_t)ONEPAGE_PIN_EPD_RST, 1);

  spi_bus_config_t bus = {
      .mosi_io_num = ONEPAGE_PIN_EPD_MOSI,
      .miso_io_num = ONEPAGE_PIN_SPI_MISO,
      .sclk_io_num = ONEPAGE_PIN_EPD_SCLK,
      .quadwp_io_num = -1,
      .quadhd_io_num = -1,
      .max_transfer_sz = EPD_CHUNK,
  };
  esp_err_t err = spi_bus_initialize(ONEPAGE_SPI_HOST, &bus, SPI_DMA_CH_AUTO);
  if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
    return err;
  }

  spi_device_interface_config_t dev = {
      .clock_speed_hz = ONEPAGE_EPD_SPI_HZ,
      .mode = 0,
      .spics_io_num = ONEPAGE_PIN_EPD_CS,
      .queue_size = 1,
  };
  err = spi_bus_add_device(ONEPAGE_SPI_HOST, &dev, &s_spi);
  if (err != ESP_OK) {
    return err;
  }

  /* Soften the edges of the shared panel/SD bus: the vendor BSP lowers the
   * drive strength one level (about 20 mA -> 10 mA) to cut ringing, which is
   * what made 20 MHz SD transfers marginal. */
  gpio_set_drive_capability((gpio_num_t)ONEPAGE_PIN_EPD_SCLK, GPIO_DRIVE_CAP_1);
  gpio_set_drive_capability((gpio_num_t)ONEPAGE_PIN_EPD_MOSI, GPIO_DRIVE_CAP_1);

  s_fb = heap_caps_malloc(ONEPAGE_EPD_BUFFER_SIZE, MALLOC_CAP_SPIRAM);
  if (!s_fb) {
    ESP_LOGW(TAG, "no PSRAM framebuffer, falling back to internal RAM");
    s_fb = heap_caps_malloc(ONEPAGE_EPD_BUFFER_SIZE, MALLOC_CAP_DEFAULT);
  }
  if (!s_fb) {
    ESP_LOGE(TAG, "framebuffer allocation failed (%d bytes)", ONEPAGE_EPD_BUFFER_SIZE);
    return ESP_ERR_NO_MEM;
  }
  memset(s_fb, 0xFF, ONEPAGE_EPD_BUFFER_SIZE);

  epd_init_controller();
  s_screen_on = false;
  ESP_LOGI(TAG, "SSD1677 ready at %dx%d", ONEPAGE_EPD_WIDTH, ONEPAGE_EPD_HEIGHT);
  return ESP_OK;
}

uint8_t *epd_framebuffer(void) { return s_fb; }

void epd_fill(uint8_t pattern) {
  if (s_fb) {
    memset(s_fb, pattern, ONEPAGE_EPD_BUFFER_SIZE);
  }
}

void epd_refresh(epd_refresh_mode_t mode) {
  if (!s_fb || !s_spi) {
    return;
  }

  epd_set_ram_window();
  if (mode == EPD_REFRESH_FAST) {
    /* Differential: only the new frame is written. The RED plane still holds
     * the frame that is currently on screen, which is what the controller
     * compares against. */
    epd_write_ram(CMD_WRITE_RAM_BW, s_fb);
  } else {
    epd_write_ram(CMD_WRITE_RAM_BW, s_fb);
    epd_write_ram(CMD_WRITE_RAM_RED, s_fb);
  }

  uint8_t ctrl2 = 0;
  if (!s_screen_on) {
    ctrl2 |= CTRL2_CLOCK_ON | CTRL2_ANALOG_ON; /* power the rails up */
  }

  epd_cmd(CMD_DISPLAY_UPDATE_CTRL1);
  epd_data8((mode == EPD_REFRESH_FAST) ? CTRL1_DIFFERENTIAL : CTRL1_BYPASS_RED);

  if (mode == EPD_REFRESH_FULL) {
    ctrl2 |= CTRL2_TEMP_LOAD | CTRL2_LUT_LOAD | CTRL2_DISPLAY_START;
    ESP_LOGD(TAG, "full refresh");
  } else if (mode == EPD_REFRESH_HALF) {
    /* A high temperature reading selects the faster waveform. */
    epd_cmd(CMD_WRITE_TEMP);
    epd_data8(0x5A);
    ctrl2 |= CTRL2_CLOCK_ON | CTRL2_ANALOG_ON | CTRL2_LUT_LOAD | CTRL2_DISPLAY_START;
    ESP_LOGD(TAG, "half refresh");
  } else {
    ctrl2 |= CTRL2_LUT_LOAD | CTRL2_MODE_SELECT | CTRL2_DISPLAY_START;
    ESP_LOGD(TAG, "fast refresh");
  }

  epd_cmd(CMD_DISPLAY_UPDATE_CTRL2);
  epd_data8(ctrl2);
  epd_cmd(CMD_MASTER_ACTIVATION);
  epd_wait_busy("refresh");
  s_screen_on = true;

  if (mode == EPD_REFRESH_FAST) {
    /* Re-sync the RED plane with what is now displayed so the next differential
     * update has a valid reference frame. */
    epd_set_ram_window();
    epd_write_ram(CMD_WRITE_RAM_RED, s_fb);
  }
}

void epd_sleep(void) {
  if (!s_spi) {
    return;
  }
  if (s_screen_on) {
    epd_cmd(CMD_DISPLAY_UPDATE_CTRL1);
    epd_data8(CTRL1_BYPASS_RED);
    epd_cmd(CMD_DISPLAY_UPDATE_CTRL2);
    epd_data8(CTRL2_ANALOG_OFF | CTRL2_CLOCK_OFF);
    epd_cmd(CMD_MASTER_ACTIVATION);
    epd_wait_busy("power down");
    s_screen_on = false;
  }
  epd_cmd(CMD_DEEP_SLEEP);
  epd_data8(0x01);
  ESP_LOGI(TAG, "panel parked (image stays on screen)");
}
