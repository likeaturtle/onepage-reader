#pragma once

#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

/* Mount the microSD card (SPI, shared with the panel) at /sdcard.
 * board_power_init() must have powered the rail and epd_init() must have set
 * up the SPI bus: this driver attaches to that bus instead of creating one. */
esp_err_t sd_card_mount(void);
bool sd_card_mounted(void);
void sd_card_unmount(void);

/* Number of entries in `dir` (NULL = root), capped at `max`. */
int sd_card_count_entries(const char *dir, int max);

/* Read up to `max_files` entry names from `dir` (NULL = root).
 * Returns the number of names written into `names`. */
int sd_card_list(const char *dir, char names[][64], int max_files);

/* Write, read back and verify a small file. On success `msg` receives a short
 * human-readable result. */
esp_err_t sd_card_rw_test(char *msg, size_t msg_len);
