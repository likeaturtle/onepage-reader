#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

/*
 * Power rail, battery gauge and deep-sleep handling for the OnePage C61 board.
 */

/* Bring up the shared EPD/SD/mic power rail and hardware-reset the panel.
 *
 * MUST be called before the panel driver or the SD card is initialised, and
 * exactly once per boot: the low pulse on GPIO27 also browns out an already
 * mounted SD card (the still-driven SPI lines back-power it through its ESD
 * diodes, which latches the card). Sequencing it first is what makes the later
 * single SD mount reliable.
 */
esp_err_t board_power_init(void);

/* USB presence, from the open-drain USB_DET line (LM66200). */
bool board_usb_connected(void);

/* Battery pack voltage in millivolts (divider already compensated). */
uint16_t board_battery_read_mv(void);

/* LiPo state of charge in percent from a pack voltage. */
uint8_t board_battery_percent(uint16_t millivolts);

/* Park the peripherals and enter deep sleep; returns on wake via the POWER key.
 * Never returns normally. */
void board_power_enter_deep_sleep(void);
