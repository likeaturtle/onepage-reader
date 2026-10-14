#include "sd_card.h"

#include "onepage_pins.h"

#include <dirent.h>
#include <stdio.h>
#include <string.h>

#include "driver/sdmmc_host.h"
#include "driver/sdspi_host.h"
#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdmmc_cmd.h"

static const char *TAG = "sd";
#define MOUNT_POINT "/sdcard"
#define RW_TEST_FILE MOUNT_POINT "/IDFTEST.TXT"

static sdmmc_card_t *s_card;
static bool s_mounted;

esp_err_t sd_card_mount(void) {
  if (s_mounted) {
    return ESP_OK;
  }

  /* The bus itself is brought up by epd_init(); the SPI SD driver attaches to
   * the same host and only adds its own chip select, which is exactly how the
   * board is wired (panel and card share SCLK/MOSI/MISO). */
  sdmmc_host_t host = SDSPI_HOST_DEFAULT();
  host.slot = ONEPAGE_SPI_HOST;
  host.max_freq_khz = ONEPAGE_SD_SPI_HZ_KHZ;

  sdspi_device_config_t slot = SDSPI_DEVICE_CONFIG_DEFAULT();
  slot.host_id = ONEPAGE_SPI_HOST;
  slot.gpio_cs = ONEPAGE_PIN_SD_CS;

  esp_vfs_fat_sdmmc_mount_config_t mount_cfg = {
      .format_if_mount_failed = false,
      .max_files = 5,
      .allocation_unit_size = 16 * 1024,
  };

  esp_err_t err = ESP_FAIL;
  for (int attempt = 0; attempt < 5; attempt++) {
    err = esp_vfs_fat_sdspi_mount(MOUNT_POINT, &host, &slot, &mount_cfg, &s_card);
    if (err == ESP_OK) {
      break;
    }
    /* The card shares the GPIO27 rail with the panel, and right after the rail
     * comes up it is not always ready on the first attempt (the vendor BSP
     * retries for the same reason). */
    ESP_LOGW(TAG, "mount attempt %d: %s", attempt + 1, esp_err_to_name(err));
    vTaskDelay(pdMS_TO_TICKS(100));
  }
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "no card mounted at %s", MOUNT_POINT);
    return err;
  }

  s_mounted = true;
  ESP_LOGI(TAG, "mounted at %s", MOUNT_POINT);
  sdmmc_card_print_info(stdout, s_card);
  return ESP_OK;
}

bool sd_card_mounted(void) { return s_mounted; }

void sd_card_unmount(void) {
  if (!s_mounted) {
    return;
  }
  esp_vfs_fat_sdcard_unmount(MOUNT_POINT, s_card);
  s_card = NULL;
  s_mounted = false;
}

static const char *resolve_dir(const char *dir) { return (dir && dir[0]) ? dir : MOUNT_POINT; }

int sd_card_count_entries(const char *dir, int max) {
  if (!s_mounted) {
    return -1;
  }
  DIR *d = opendir(resolve_dir(dir));
  if (!d) {
    return -1;
  }
  int count = 0;
  struct dirent *entry;
  while ((entry = readdir(d)) != NULL && count < max) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    count++;
  }
  closedir(d);
  return count;
}

int sd_card_list(const char *dir, char names[][64], int max_files) {
  if (!s_mounted || !names) {
    return 0;
  }
  DIR *d = opendir(resolve_dir(dir));
  if (!d) {
    return 0;
  }
  int count = 0;
  struct dirent *entry;
  while ((entry = readdir(d)) != NULL && count < max_files) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    /* Explicit precision: entry->d_name is NAME_MAX long, which does not fit
     * next to the "/" suffix in a 64-byte row. */
    snprintf(names[count], 64, "%.62s%s", entry->d_name, entry->d_type == DT_DIR ? "/" : "");
    count++;
  }
  closedir(d);
  return count;
}

esp_err_t sd_card_rw_test(char *msg, size_t msg_len) {
  if (!s_mounted) {
    snprintf(msg, msg_len, "NO CARD");
    return ESP_ERR_INVALID_STATE;
  }

  const char *payload = "onepage-c61 idf demo write test\n";
  FILE *f = fopen(RW_TEST_FILE, "w");
  if (!f) {
    snprintf(msg, msg_len, "WRITE FAILED");
    return ESP_FAIL;
  }
  size_t written = fwrite(payload, 1, strlen(payload), f);
  fclose(f);
  if (written != strlen(payload)) {
    snprintf(msg, msg_len, "SHORT WRITE");
    return ESP_FAIL;
  }

  char readback[128] = {0};
  f = fopen(RW_TEST_FILE, "r");
  if (!f) {
    snprintf(msg, msg_len, "READ FAILED");
    return ESP_FAIL;
  }
  size_t got = fread(readback, 1, sizeof(readback) - 1, f);
  fclose(f);
  if (got != strlen(payload) || strcmp(readback, payload) != 0) {
    snprintf(msg, msg_len, "VERIFY FAILED");
    return ESP_FAIL;
  }

  snprintf(msg, msg_len, "RW OK");
  ESP_LOGI(TAG, "write/read/verify of %s succeeded", RW_TEST_FILE);
  return ESP_OK;
}
