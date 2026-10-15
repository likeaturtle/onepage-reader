#pragma once

/*
 * OnePage (ESP32-C61) board pin map.
 *
 * Facts taken from the vendor board-support package that drives this hardware
 * today (open-onepage-sdk, MIT) so the demo talks to the same nets:
 *   firmware/open-onepage-sdk (libs/display/EInkDisplay, libs/hardware/...)
 *   firmware/lib/hal/HalGPIO.h
 *
 * Silicon: ESP32-C61HR2, 16 MB SPI flash (PY25Q128HA), 2 MB PSRAM, 40 MHz XTAL
 * plus a 32.768 kHz XTAL on the dedicated XTAL_32K pins.
 */

#include "driver/spi_master.h"

/* --- E-ink panel (SSD1677, 800x480, 4.26") ------------------------------- */
#define ONEPAGE_PIN_EPD_SCLK 22
#define ONEPAGE_PIN_EPD_MOSI 23
#define ONEPAGE_PIN_EPD_CS 25
#define ONEPAGE_PIN_EPD_DC 8
/* GPIO27 is BOTH the panel reset line and the enable of a shared
 * SD-card / microphone / panel power rail (high = powered). A low pulse here
 * therefore power-cycles the rail *and* hardware-resets the panel, which is
 * why the rail is cycled exactly once, early, before the SD card is mounted. */
#define ONEPAGE_PIN_EPD_RST 27
#define ONEPAGE_PIN_EPD_BUSY 29

/* --- Shared SPI bus ----------------------------------------------------- */
/* The panel and the microSD card share one bus; only the chip selects differ.
 * MISO must stay attached even when only the panel is being driven. */
#define ONEPAGE_PIN_SPI_MISO 24
#define ONEPAGE_PIN_SD_CS 26
#define ONEPAGE_SPI_HOST SPI2_HOST
#define ONEPAGE_EPD_SPI_HZ (40 * 1000 * 1000) /* vendor: 40 MHz, mode 0 */
#define ONEPAGE_SD_SPI_HZ_KHZ 20000           /* vendor: 20 MHz */

/* --- Panel geometry ----------------------------------------------------- */
#define ONEPAGE_EPD_WIDTH 800
#define ONEPAGE_EPD_HEIGHT 480
#define ONEPAGE_EPD_ROW_BYTES (ONEPAGE_EPD_WIDTH / 8)
#define ONEPAGE_EPD_BUFFER_SIZE (ONEPAGE_EPD_ROW_BYTES * ONEPAGE_EPD_HEIGHT)

/* --- Buttons ------------------------------------------------------------ */
/* Front 4-key ADC ladder (BACK / CONFIRM / LEFT / RIGHT on one pin) plus
 * three active-low side keys. */
#define ONEPAGE_PIN_BTN_ADC 4   /* ADC1 channel, see board_buttons.c */
#define ONEPAGE_PIN_BTN_UP 6    /* PREV */
#define ONEPAGE_PIN_BTN_DOWN 9  /* NEXT */
#define ONEPAGE_PIN_BTN_POWER 2 /* WAKE, also the deep-sleep wake source */

/* --- Power / misc ------------------------------------------------------- */
#define ONEPAGE_PIN_BAT_ADC 5    /* battery divider, ADC1 */
#define ONEPAGE_PIN_BAT_CHG_EN 10 /* low = pause charging while sampling */
#define ONEPAGE_PIN_USB_DET 11    /* LM66200 open-drain: low = USB present */
#define ONEPAGE_PIN_PDM_CLK 7     /* microphone PDM clock */
#define ONEPAGE_PIN_PDM_DIN 3     /* microphone PDM data */

/* Battery divider on the board is 1:1, so the measured cell voltage is 2x. */
#define ONEPAGE_BATTERY_DIVIDER 2.0f
/* Readings averaged per sample: the ADC noise is far larger than the 1 mV
 * resolution, and callers compare readings to decide on a redraw. */
#define ONEPAGE_BATTERY_SAMPLES 8
