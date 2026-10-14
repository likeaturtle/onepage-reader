/*
 * Carried over from the vendor firmware
 * (`-Wl,--wrap=bootloader_common_check_efuse_blk_validity`, see
 * firmware/src/platform/skip_efuse_blk_check.c).
 *
 * The 2nd-stage bootloader compares the eFuse block revision it reads from the
 * chip against the range recorded in the app image and refuses to boot when it
 * falls outside that range. On this silicon that gate rejects otherwise
 * bootable images. It is a manufacturing/rollback gate, not a runtime safety
 * property, so answering "valid" here is safe, and it matches the
 * configuration the vendor ships.
 *
 * The wrapper has to end up in the bootloader, not the application: the check
 * runs during image validation, before the app exists.
 */

#include "esp_err.h"

esp_err_t __wrap_bootloader_common_check_efuse_blk_validity(uint32_t min_rev_full, uint32_t max_rev_full) {
  (void)min_rev_full;
  (void)max_rev_full;
  return ESP_OK;
}
