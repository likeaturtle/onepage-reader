#include "ble_auth.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "psa/crypto.h"

static const char *TAG = "ble-auth";

#define AUTH_NAMESPACE "calauth"
#define AUTH_KEY_NAME "key"
#define AUTH_ID_NAME "id"
#define ID_BYTES 16
#define KEY_BYTES 32
#define NONCE_BYTES 16
#define CODE_LEN 12
#define CODE_BUF (CODE_LEN + 1)
#define PAIR_WINDOW_MS (3 * 60 * 1000)
#define AUTH_BLOCK_MS (60 * 1000)
#define MAX_FAILURES 5
#define FRAME_BUF 1040
#define B64_BUF 1400
#define LINE_BUF 1536

static const char kCodeAlphabet[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

typedef struct {
  bool inited;
  bool nvs_open;
  bool has_key;
  bool authed;
  bool pairing;
  bool pairing_ok;
  uint8_t key[KEY_BYTES];
  uint8_t nonce[NONCE_BYTES];
  char nonce_hex[NONCE_BYTES * 2 + 1];
  char pid[13];
  char did[33];
  char code[CODE_BUF];
  int64_t pairing_deadline_ms;
  int64_t blocked_until_ms;
  uint32_t failures;
  uint32_t tx_seq;
  uint32_t rx_seq;
  uint8_t k_enc_c2d[32];
  uint8_t k_mac_c2d[32];
  uint8_t k_enc_d2c[32];
  uint8_t k_mac_d2c[32];
  nvs_handle_t nvs;
  SemaphoreHandle_t lock;
  /* Scratch space for the BLE task only; both helpers run sequentially. */
  uint8_t plain[FRAME_BUF];
  uint8_t cipher[FRAME_BUF];
  char b64[B64_BUF];
} auth_state_t;

static auth_state_t s_auth;

static int64_t now_ms(void) {
  return (int64_t)(esp_timer_get_time() / 1000);
}

static void bytes_to_hex(const uint8_t *in, size_t len, char *out) {
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = hex[in[i] >> 4];
    out[i * 2 + 1] = hex[in[i] & 0x0f];
  }
  out[len * 2] = '\0';
}

static bool hex_to_bytes(const char *text, uint8_t *out, size_t len) {
  if (!text || strlen(text) != len * 2) {
    return false;
  }
  for (size_t i = 0; i < len; i++) {
    int hi = isdigit((unsigned char)text[i * 2]) ? text[i * 2] - '0'
             : isxdigit((unsigned char)text[i * 2]) ? tolower((unsigned char)text[i * 2]) - 'a' + 10
                                                   : -1;
    int lo = isdigit((unsigned char)text[i * 2 + 1]) ? text[i * 2 + 1] - '0'
             : isxdigit((unsigned char)text[i * 2 + 1]) ? tolower((unsigned char)text[i * 2 + 1]) - 'a' + 10
                                                       : -1;
    if (hi < 0 || lo < 0) {
      return false;
    }
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return true;
}

static bool constant_time_equal(const uint8_t *a, const uint8_t *b, size_t len) {
  volatile uint8_t diff = 0;
  for (size_t i = 0; i < len; i++) {
    diff |= (uint8_t)(a[i] ^ b[i]);
  }
  return diff == 0;
}

static bool hmac_sha256(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len,
                        uint8_t out[32]) {
  psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_type(&attr, PSA_KEY_TYPE_HMAC);
  psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_SIGN_MESSAGE);
  psa_set_key_algorithm(&attr, PSA_ALG_HMAC(PSA_ALG_SHA_256));
  psa_key_id_t key_id = 0;
  psa_status_t status = psa_import_key(&attr, key, key_len, &key_id);
  psa_reset_key_attributes(&attr);
  if (status != PSA_SUCCESS) {
    return false;
  }
  uint8_t mac[32];
  size_t mac_len = 0;
  status = psa_mac_compute(key_id, PSA_ALG_HMAC(PSA_ALG_SHA_256), data, data_len, mac,
                           sizeof(mac), &mac_len);
  psa_destroy_key(key_id);
  if (status != PSA_SUCCESS || mac_len != sizeof(mac)) {
    return false;
  }
  memcpy(out, mac, sizeof(mac));
  return true;
}

static bool hkdf_sha256(const uint8_t *salt, size_t salt_len, const uint8_t *ikm, size_t ikm_len,
                        const char *info, uint8_t out[32]) {
  psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_type(&attr, PSA_KEY_TYPE_DERIVE);
  psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_DERIVE);
  psa_set_key_algorithm(&attr, PSA_ALG_HKDF(PSA_ALG_SHA_256));
  psa_key_id_t key_id = 0;
  psa_status_t status = psa_import_key(&attr, ikm, ikm_len, &key_id);
  psa_reset_key_attributes(&attr);
  if (status != PSA_SUCCESS) {
    return false;
  }

  psa_key_derivation_operation_t op = PSA_KEY_DERIVATION_OPERATION_INIT;
  bool ok = psa_key_derivation_setup(&op, PSA_ALG_HKDF(PSA_ALG_SHA_256)) == PSA_SUCCESS;
  if (ok) {
    ok = psa_key_derivation_input_bytes(&op, PSA_KEY_DERIVATION_INPUT_SALT, salt, salt_len) ==
         PSA_SUCCESS;
  }
  if (ok) {
    ok = psa_key_derivation_input_key(&op, PSA_KEY_DERIVATION_INPUT_SECRET, key_id) ==
         PSA_SUCCESS;
  }
  if (ok) {
    ok = psa_key_derivation_input_bytes(&op, PSA_KEY_DERIVATION_INPUT_INFO,
                                        (const uint8_t *)info, strlen(info)) == PSA_SUCCESS;
  }
  if (ok) {
    ok = psa_key_derivation_output_bytes(&op, out, 32) == PSA_SUCCESS;
  }
  psa_key_derivation_abort(&op);
  psa_destroy_key(key_id);
  return ok;
}

static bool derive_pair_key(const char *code, const char *pid, uint8_t out[32]) {
  return hkdf_sha256((const uint8_t *)pid, strlen(pid), (const uint8_t *)code, strlen(code),
                     "mochen-calcal-pair-v1", out);
}

static bool derive_long_key(const char *code, const char *pid, uint8_t out[32]) {
  return hkdf_sha256((const uint8_t *)pid, strlen(pid), (const uint8_t *)code, strlen(code),
                     "mochen-calcal-key-v1", out);
}

static bool derive_session(const uint8_t long_key[32], const char *nonce_d, const char *nonce_a) {
  uint8_t salt[32];
  uint8_t nonce_a_bytes[16];
  if (!hex_to_bytes(nonce_d, salt, 16) || !hex_to_bytes(nonce_a, nonce_a_bytes, 16)) {
    return false;
  }
  memcpy(salt + 16, nonce_a_bytes, 16);
  return hkdf_sha256(salt, sizeof(salt), long_key, 32, "mochen-calcal-enc-c2d-v1",
                     s_auth.k_enc_c2d) &&
         hkdf_sha256(salt, sizeof(salt), long_key, 32, "mochen-calcal-mac-c2d-v1",
                     s_auth.k_mac_c2d) &&
         hkdf_sha256(salt, sizeof(salt), long_key, 32, "mochen-calcal-enc-d2c-v1",
                     s_auth.k_enc_d2c) &&
         hkdf_sha256(salt, sizeof(salt), long_key, 32, "mochen-calcal-mac-d2c-v1",
                     s_auth.k_mac_d2c);
}

static bool auth_proof(bool client, const uint8_t key[32], const char *pid, const char *nonce_d,
                       const char *nonce_a, const char *mode, char out_hex[65]) {
  char input[256];
  uint8_t digest[32];
  const int n = snprintf(input, sizeof(input), "mochen-calcal-%s-v1|%s|%s|%s|%s",
                         client ? "client" : "device", pid,
                         client ? nonce_d : nonce_a, client ? nonce_a : nonce_d, mode);
  if (n <= 0 || (size_t)n >= sizeof(input) ||
      !hmac_sha256(key, 32, (const uint8_t *)input, (size_t)n, digest)) {
    return false;
  }
  bytes_to_hex(digest, sizeof(digest), out_hex);
  return true;
}

static bool frame_mac(const uint8_t key[32], const char *direction, uint32_t seq,
                      const uint8_t iv[16], const uint8_t *cipher, size_t cipher_len,
                      uint8_t out[32]) {
  psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_type(&attr, PSA_KEY_TYPE_HMAC);
  psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_SIGN_MESSAGE);
  psa_set_key_algorithm(&attr, PSA_ALG_HMAC(PSA_ALG_SHA_256));
  psa_key_id_t key_id = 0;
  psa_status_t status = psa_import_key(&attr, key, 32, &key_id);
  psa_reset_key_attributes(&attr);
  if (status != PSA_SUCCESS) {
    return false;
  }

  psa_mac_operation_t op = PSA_MAC_OPERATION_INIT;
  bool ok = psa_mac_sign_setup(&op, key_id, PSA_ALG_HMAC(PSA_ALG_SHA_256)) == PSA_SUCCESS;
  char head[64];
  const int head_len = snprintf(head, sizeof(head), "mochen-calcal-frame-v1|%s|%lu|", direction,
                                (unsigned long)seq);
  char iv_hex[33];
  bytes_to_hex(iv, 16, iv_hex);
  if (ok) {
    ok = head_len > 0 && (size_t)head_len < sizeof(head) &&
         psa_mac_update(&op, (const uint8_t *)head, (size_t)head_len) == PSA_SUCCESS &&
         psa_mac_update(&op, (const uint8_t *)iv_hex, sizeof(iv_hex) - 1) == PSA_SUCCESS &&
         psa_mac_update(&op, (const uint8_t *)"|", 1) == PSA_SUCCESS;
  }
  char chunk[65];
  for (size_t off = 0; ok && off < cipher_len; off += 32) {
    const size_t take = cipher_len - off < 32 ? cipher_len - off : 32;
    bytes_to_hex(cipher + off, take, chunk);
    ok = psa_mac_update(&op, (const uint8_t *)chunk, take * 2) == PSA_SUCCESS;
  }
  size_t mac_len = 0;
  if (ok) {
    ok = psa_mac_sign_finish(&op, out, 32, &mac_len) == PSA_SUCCESS && mac_len == 32;
  }
  psa_mac_abort(&op);
  psa_destroy_key(key_id);
  return ok;
}

/* AES-256-CBC with PKCS#7 padding, through PSA Crypto (mbedTLS 4 removed the
 * legacy mbedtls_aes_* API). The output can be up to in_len + 16 bytes. */
static bool aes_cipher(bool encrypt, const uint8_t key[32], const uint8_t iv[16],
                       const uint8_t *in, size_t len, uint8_t *out, size_t out_size,
                       size_t *out_len) {
  psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
  psa_set_key_type(&attr, PSA_KEY_TYPE_AES);
  psa_set_key_bits(&attr, 256);
  psa_set_key_usage_flags(&attr, encrypt ? PSA_KEY_USAGE_ENCRYPT : PSA_KEY_USAGE_DECRYPT);
  psa_set_key_algorithm(&attr, PSA_ALG_CBC_PKCS7);
  psa_key_id_t key_id = 0;
  psa_status_t status = psa_import_key(&attr, key, 32, &key_id);
  psa_reset_key_attributes(&attr);
  if (status != PSA_SUCCESS) {
    return false;
  }

  psa_cipher_operation_t op = PSA_CIPHER_OPERATION_INIT;
  status = encrypt ? psa_cipher_encrypt_setup(&op, key_id, PSA_ALG_CBC_PKCS7)
                   : psa_cipher_decrypt_setup(&op, key_id, PSA_ALG_CBC_PKCS7);
  size_t used = 0;
  size_t finish = 0;
  bool ok = status == PSA_SUCCESS &&
            psa_cipher_set_iv(&op, iv, 16) == PSA_SUCCESS &&
            psa_cipher_update(&op, in, len, out, out_size, &used) == PSA_SUCCESS &&
            psa_cipher_finish(&op, out + used, out_size - used, &finish) == PSA_SUCCESS;
  psa_cipher_abort(&op);
  psa_destroy_key(key_id);
  if (ok) {
    *out_len = used + finish;
  }
  return ok;
}

/* Minimal standard base64 (the mbedTLS 4 base64 helper is gone). */
static int base64_index(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

static bool base64_encode(const uint8_t *in, size_t len, char *out, size_t out_len) {
  static const char table[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const size_t need = 4 * ((len + 2) / 3) + 1;
  if (need > out_len) {
    return false;
  }
  size_t o = 0;
  for (size_t i = 0; i < len; i += 3) {
    const uint32_t v = ((uint32_t)in[i] << 16) |
                       ((i + 1 < len ? in[i + 1] : 0) << 8) |
                       (i + 2 < len ? in[i + 2] : 0);
    out[o++] = table[(v >> 18) & 0x3f];
    out[o++] = table[(v >> 12) & 0x3f];
    out[o++] = i + 1 < len ? table[(v >> 6) & 0x3f] : '=';
    out[o++] = i + 2 < len ? table[v & 0x3f] : '=';
  }
  out[o] = '\0';
  return true;
}

static bool base64_decode(const char *in, uint8_t *out, size_t out_len, size_t *decoded_len) {
  const size_t len = strlen(in);
  if (len == 0 || len % 4 != 0) {
    return false;
  }
  size_t o = 0;
  for (size_t i = 0; i < len; i += 4) {
    int v[4];
    int pad = 0;
    for (int j = 0; j < 4; j++) {
      const char c = in[i + j];
      if (c == '=') {
        if (j < 2 || i + 4 != len) {
          return false;
        }
        pad++;
        v[j] = 0;
      } else {
        if (pad) {
          return false;
        }
        v[j] = base64_index(c);
        if (v[j] < 0) {
          return false;
        }
      }
    }
    const uint32_t word = ((uint32_t)v[0] << 18) | ((uint32_t)v[1] << 12) |
                          ((uint32_t)v[2] << 6) | (uint32_t)v[3];
    if (o >= out_len) return false;
    out[o++] = (uint8_t)((word >> 16) & 0xff);
    if (pad < 2) {
      if (o >= out_len) return false;
      out[o++] = (uint8_t)((word >> 8) & 0xff);
    }
    if (pad < 1) {
      if (o >= out_len) return false;
      out[o++] = (uint8_t)(word & 0xff);
    }
  }
  *decoded_len = o;
  return true;
}

static void load_device_id(void) {
  uint8_t id[ID_BYTES];
  size_t len = sizeof(id);
  bool loaded = s_auth.nvs_open &&
                nvs_get_blob(s_auth.nvs, AUTH_ID_NAME, id, &len) == ESP_OK &&
                len == sizeof(id);
  if (!loaded) {
    esp_fill_random(id, sizeof(id));
    if (s_auth.nvs_open) {
      esp_err_t err = nvs_set_blob(s_auth.nvs, AUTH_ID_NAME, id, sizeof(id));
      if (err == ESP_OK) {
        err = nvs_commit(s_auth.nvs);
      }
      if (err != ESP_OK) {
        ESP_LOGW(TAG, "store device id: %s", esp_err_to_name(err));
      }
    }
  }
  bytes_to_hex(id, sizeof(id), s_auth.did);
}

static void load_key(void) {
  if (!s_auth.nvs_open) {
    return;
  }
  uint8_t key[KEY_BYTES];
  size_t len = sizeof(key);
  if (nvs_get_blob(s_auth.nvs, AUTH_KEY_NAME, key, &len) == ESP_OK && len == sizeof(key)) {
    memcpy(s_auth.key, key, sizeof(key));
    s_auth.has_key = true;
  } else {
    s_auth.has_key = false;
  }
}

static esp_err_t store_key(const uint8_t key[KEY_BYTES]) {
  if (!s_auth.nvs_open) {
    return ESP_ERR_INVALID_STATE;
  }
  esp_err_t err = nvs_set_blob(s_auth.nvs, AUTH_KEY_NAME, key, KEY_BYTES);
  if (err == ESP_OK) {
    err = nvs_commit(s_auth.nvs);
  }
  if (err == ESP_OK) {
    memcpy(s_auth.key, key, KEY_BYTES);
    s_auth.has_key = true;
  }
  return err;
}

esp_err_t ble_auth_clear_key(void) {
  if (!s_auth.nvs_open) {
    memset(s_auth.key, 0, sizeof(s_auth.key));
    s_auth.has_key = false;
    return ESP_ERR_INVALID_STATE;
  }
  esp_err_t err = nvs_erase_key(s_auth.nvs, AUTH_KEY_NAME);
  if (err == ESP_ERR_NVS_NOT_FOUND) {
    err = ESP_OK;
  }
  if (err == ESP_OK) {
    err = nvs_commit(s_auth.nvs);
  }
  if (err == ESP_OK) {
    memset(s_auth.key, 0, sizeof(s_auth.key));
    s_auth.has_key = false;
  }
  return err;
}

esp_err_t ble_auth_init(void) {
  if (s_auth.inited) {
    return ESP_OK;
  }
  s_auth.lock = xSemaphoreCreateMutex();
  if (!s_auth.lock) {
    ESP_LOGE(TAG, "pairing mutex allocation failed");
    return ESP_ERR_NO_MEM;
  }

  const psa_status_t psa_status = psa_crypto_init();
  if (psa_status != PSA_SUCCESS) {
    ESP_LOGE(TAG, "psa_crypto_init: %d", (int)psa_status);
    return ESP_FAIL;
  }

  uint8_t mac[6] = {0};
  if (esp_read_mac(mac, ESP_MAC_BT) == ESP_OK) {
    snprintf(s_auth.pid, sizeof(s_auth.pid), "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2],
             mac[3], mac[4], mac[5]);
  } else {
    snprintf(s_auth.pid, sizeof(s_auth.pid), "000000000000");
  }

  const esp_err_t err = nvs_open(AUTH_NAMESPACE, NVS_READWRITE, &s_auth.nvs);
  if (err == ESP_OK) {
    s_auth.nvs_open = true;
    load_key();
  } else {
    ESP_LOGE(TAG, "nvs_open: %s", esp_err_to_name(err));
  }
  load_device_id();
  s_auth.inited = true;
  ESP_LOGI(TAG, "auth ready, pid %s, %s", s_auth.pid, s_auth.has_key ? "paired" : "unpaired");
  ESP_LOGD(TAG, "device id %s", s_auth.did);
  return err;
}

void ble_auth_reset_session(void) {
  s_auth.authed = false;
  s_auth.tx_seq = 0;
  s_auth.rx_seq = 0;
  memset(s_auth.k_enc_c2d, 0, sizeof(s_auth.k_enc_c2d));
  memset(s_auth.k_mac_c2d, 0, sizeof(s_auth.k_mac_c2d));
  memset(s_auth.k_enc_d2c, 0, sizeof(s_auth.k_enc_d2c));
  memset(s_auth.k_mac_d2c, 0, sizeof(s_auth.k_mac_d2c));
  esp_fill_random(s_auth.nonce, sizeof(s_auth.nonce));
  bytes_to_hex(s_auth.nonce, sizeof(s_auth.nonce), s_auth.nonce_hex);
}

bool ble_auth_is_authed(void) {
  return s_auth.authed;
}

bool ble_auth_has_key(void) {
  return s_auth.has_key;
}

const char *ble_auth_pid(void) {
  return s_auth.pid;
}

const char *ble_auth_did(void) {
  return s_auth.did;
}

const char *ble_auth_nonce_hex(void) {
  return s_auth.nonce_hex;
}

esp_err_t ble_auth_start_pairing(bool clear_key) {
  if (!s_auth.inited || !s_auth.lock) {
    return ESP_ERR_INVALID_STATE;
  }
  if (clear_key) {
    const esp_err_t err = ble_auth_clear_key();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
      return err;
    }
  }

  char code[CODE_BUF];
  for (int i = 0; i < CODE_LEN; i++) {
    code[i] = kCodeAlphabet[esp_random() % (sizeof(kCodeAlphabet) - 1)];
  }
  code[CODE_LEN] = '\0';

  xSemaphoreTake(s_auth.lock, portMAX_DELAY);
  memcpy(s_auth.code, code, sizeof(code));
  s_auth.pairing = true;
  s_auth.pairing_ok = false;
  s_auth.pairing_deadline_ms = now_ms() + PAIR_WINDOW_MS;
  s_auth.failures = 0;
  s_auth.blocked_until_ms = 0;
  xSemaphoreGive(s_auth.lock);
  ESP_LOGI(TAG, "pairing window open%s", clear_key ? ", old key erased" : "");
  return ESP_OK;
}

void ble_auth_cancel_pairing(void) {
  if (!s_auth.lock) {
    return;
  }
  xSemaphoreTake(s_auth.lock, portMAX_DELAY);
  s_auth.pairing = false;
  memset(s_auth.code, 0, sizeof(s_auth.code));
  xSemaphoreGive(s_auth.lock);
}

bool ble_auth_pairing_active(void) {
  if (!s_auth.lock) {
    return false;
  }
  bool active;
  const int64_t now = now_ms();
  xSemaphoreTake(s_auth.lock, portMAX_DELAY);
  if (s_auth.pairing && now >= s_auth.pairing_deadline_ms) {
    s_auth.pairing = false;
    memset(s_auth.code, 0, sizeof(s_auth.code));
  }
  active = s_auth.pairing;
  xSemaphoreGive(s_auth.lock);
  return active;
}

bool ble_auth_pairing_code(char *out, size_t out_len) {
  if (!s_auth.lock || !out || out_len < CODE_BUF) {
    return false;
  }
  bool ok = false;
  xSemaphoreTake(s_auth.lock, portMAX_DELAY);
  if (s_auth.pairing && s_auth.code[0]) {
    memcpy(out, s_auth.code, CODE_BUF);
    ok = true;
  }
  xSemaphoreGive(s_auth.lock);
  return ok;
}

bool ble_auth_take_pairing_succeeded(void) {
  if (!s_auth.lock) {
    return false;
  }
  xSemaphoreTake(s_auth.lock, portMAX_DELAY);
  const bool ok = s_auth.pairing_ok;
  s_auth.pairing_ok = false;
  xSemaphoreGive(s_auth.lock);
  return ok;
}

static const char *get_string(cJSON *root, const char *key) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
  return cJSON_IsString(item) ? item->valuestring : NULL;
}

static bool get_bool(cJSON *root, const char *key, bool fallback) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
  if (cJSON_IsBool(item)) {
    return cJSON_IsTrue(item);
  }
  return fallback;
}

static bool get_u32(cJSON *root, const char *key, uint32_t *out) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
  if (!cJSON_IsNumber(item) || item->valuedouble < 0 || item->valuedouble > 4294967295.0) {
    return false;
  }
  const double rounded = (double)(uint32_t)item->valuedouble;
  if (rounded != item->valuedouble) {
    return false;
  }
  *out = (uint32_t)item->valuedouble;
  return true;
}

static void auth_error(char *response, size_t response_len, const char *error) {
  snprintf(response, response_len,
           "{\"ev\":\"auth\",\"ok\":false,\"proto\":3,\"error\":\"%s\",\"paired\":%s,"
           "\"pairing\":%s}",
           error, s_auth.has_key ? "true" : "false",
           ble_auth_pairing_active() ? "true" : "false");
}

bool ble_auth_handle_auth(cJSON *root, char *response, size_t response_len, bool *paired_now) {
  if (paired_now) {
    *paired_now = false;
  }
  if (!s_auth.inited) {
    auth_error(response, response_len, "auth unavailable");
    return true;
  }
  if (!s_auth.nonce_hex[0]) {
    auth_error(response, response_len, "auth unavailable");
    return true;
  }
  if (s_auth.blocked_until_ms && now_ms() < s_auth.blocked_until_ms) {
    auth_error(response, response_len, "too many attempts");
    return true;
  }

  const char *pid = get_string(root, "pid");
  const char *nonce_text = get_string(root, "nonce");
  const char *proof_text = get_string(root, "proof");
  const bool pairing_request = get_bool(root, "pair", false);
  uint8_t nonce_a[NONCE_BYTES];
  uint8_t proof[32];
  char nonce_a_hex[NONCE_BYTES * 2 + 1];
  if (!pid || !nonce_text || !proof_text || strlen(pid) != strlen(s_auth.pid) ||
      strcasecmp(pid, s_auth.pid) != 0 ||
      !hex_to_bytes(nonce_text, nonce_a, sizeof(nonce_a)) ||
      !hex_to_bytes(proof_text, proof, sizeof(proof))) {
    auth_error(response, response_len, "bad auth request");
    return true;
  }
  bytes_to_hex(nonce_a, sizeof(nonce_a), nonce_a_hex);

  uint8_t key[32];
  const char *mode = pairing_request ? "pair" : "auth";
  bool pairing_active = false;
  char pairing_code[CODE_BUF] = {0};
  if (pairing_request) {
    xSemaphoreTake(s_auth.lock, portMAX_DELAY);
    if (s_auth.pairing && now_ms() < s_auth.pairing_deadline_ms) {
      pairing_active = true;
      memcpy(pairing_code, s_auth.code, sizeof(pairing_code));
    } else {
      s_auth.pairing = false;
      memset(s_auth.code, 0, sizeof(s_auth.code));
    }
    xSemaphoreGive(s_auth.lock);
    if (!pairing_active) {
      auth_error(response, response_len, "pairing not active");
      return true;
    }
    if (!derive_pair_key(pairing_code, s_auth.pid, key)) {
      auth_error(response, response_len, "auth unavailable");
      return true;
    }
  } else {
    if (!s_auth.has_key) {
      auth_error(response, response_len, "not paired");
      return true;
    }
    memcpy(key, s_auth.key, sizeof(key));
  }

  char expected_hex[65];
  if (!auth_proof(true, key, s_auth.pid, s_auth.nonce_hex, nonce_a_hex, mode, expected_hex)) {
    auth_error(response, response_len, "auth unavailable");
    return true;
  }
  uint8_t expected[32];
  hex_to_bytes(expected_hex, expected, sizeof(expected));
  if (!constant_time_equal(expected, proof, sizeof(expected))) {
    s_auth.failures++;
    if (s_auth.failures >= MAX_FAILURES) {
      s_auth.blocked_until_ms = now_ms() + AUTH_BLOCK_MS;
      s_auth.failures = 0;
      ESP_LOGW(TAG, "too many auth failures, pausing attempts");
    }
    memset(key, 0, sizeof(key));
    auth_error(response, response_len, "bad proof");
    return true;
  }

  uint8_t long_key[32];
  if (pairing_request) {
    if (!derive_long_key(pairing_code, s_auth.pid, long_key)) {
      memset(key, 0, sizeof(key));
      auth_error(response, response_len, "auth unavailable");
      return true;
    }
    const esp_err_t err = store_key(long_key);
    if (err != ESP_OK) {
      memset(key, 0, sizeof(key));
      memset(long_key, 0, sizeof(long_key));
      ESP_LOGE(TAG, "store key: %s", esp_err_to_name(err));
      auth_error(response, response_len, "auth unavailable");
      return true;
    }
    if (paired_now) {
      *paired_now = true;
    }
    xSemaphoreTake(s_auth.lock, portMAX_DELAY);
    s_auth.pairing = false;
    s_auth.pairing_ok = true;
    memset(s_auth.code, 0, sizeof(s_auth.code));
    xSemaphoreGive(s_auth.lock);
  } else {
    memcpy(long_key, s_auth.key, sizeof(long_key));
  }

  if (!derive_session(long_key, s_auth.nonce_hex, nonce_a_hex)) {
    memset(key, 0, sizeof(key));
    memset(long_key, 0, sizeof(long_key));
    auth_error(response, response_len, "auth unavailable");
    return true;
  }

  char device_proof_hex[65];
  if (!auth_proof(false, long_key, s_auth.pid, s_auth.nonce_hex, nonce_a_hex, mode,
                  device_proof_hex)) {
    memset(key, 0, sizeof(key));
    memset(long_key, 0, sizeof(long_key));
    auth_error(response, response_len, "auth unavailable");
    return true;
  }

  s_auth.authed = true;
  s_auth.tx_seq = 0;
  s_auth.rx_seq = 0;
  s_auth.failures = 0;
  s_auth.blocked_until_ms = 0;
  memset(key, 0, sizeof(key));
  memset(long_key, 0, sizeof(long_key));

  snprintf(response, response_len,
           "{\"ev\":\"auth\",\"ok\":true,\"proto\":3,\"paired\":true,\"pairing\":%s,"
           "\"proof\":\"%s\"}",
           ble_auth_pairing_active() ? "true" : "false", device_proof_hex);
  return true;
}

bool ble_auth_encrypt_line(const char *json, char *out, size_t out_len) {
  if (!s_auth.authed || !json || !out) {
    return false;
  }
  const size_t json_len = strlen(json);
  if (json_len == 0 || json_len + 16 > sizeof(s_auth.cipher)) {
    return false;
  }

  uint8_t iv[16];
  esp_fill_random(iv, sizeof(iv));
  size_t cipher_len = 0;
  if (!aes_cipher(true, s_auth.k_enc_d2c, iv, (const uint8_t *)json, json_len, s_auth.cipher,
                  sizeof(s_auth.cipher), &cipher_len)) {
    return false;
  }
  if (!base64_encode(s_auth.cipher, cipher_len, s_auth.b64, sizeof(s_auth.b64))) {
    return false;
  }

  const uint32_t seq = s_auth.tx_seq + 1;
  uint8_t mac[32];
  if (!frame_mac(s_auth.k_mac_d2c, "d2c", seq, iv, s_auth.cipher, cipher_len, mac)) {
    return false;
  }
  char iv_hex[33];
  char mac_hex[65];
  bytes_to_hex(iv, sizeof(iv), iv_hex);
  bytes_to_hex(mac, sizeof(mac), mac_hex);
  const int n = snprintf(out, out_len, "{\"s\":%lu,\"iv\":\"%s\",\"d\":\"%s\",\"m\":\"%s\"}",
                         (unsigned long)seq, iv_hex, s_auth.b64, mac_hex);
  if (n <= 0 || (size_t)n >= out_len) {
    return false;
  }
  s_auth.tx_seq = seq;
  return true;
}

bool ble_auth_decrypt_frame(cJSON *root, char *out, size_t out_len) {
  if (!s_auth.authed || !root || !out) {
    return false;
  }
  uint32_t seq;
  const char *iv_text = get_string(root, "iv");
  const char *data_text = get_string(root, "d");
  const char *mac_text = get_string(root, "m");
  uint8_t iv[16];
  uint8_t mac[32];
  if (!get_u32(root, "s", &seq) || seq <= s_auth.rx_seq || !iv_text || !data_text || !mac_text ||
      !hex_to_bytes(iv_text, iv, sizeof(iv)) || !hex_to_bytes(mac_text, mac, sizeof(mac))) {
    return false;
  }

  size_t cipher_len = 0;
  if (!base64_decode(data_text, s_auth.cipher, sizeof(s_auth.cipher), &cipher_len) ||
      cipher_len == 0 || cipher_len % 16 != 0) {
    return false;
  }

  uint8_t expected[32];
  if (!frame_mac(s_auth.k_mac_c2d, "c2d", seq, iv, s_auth.cipher, cipher_len, expected) ||
      !constant_time_equal(expected, mac, sizeof(expected))) {
    return false;
  }
  size_t plain_len = 0;
  if (!aes_cipher(false, s_auth.k_enc_c2d, iv, s_auth.cipher, cipher_len, s_auth.plain,
                  sizeof(s_auth.plain), &plain_len)) {
    return false;
  }
  if (plain_len == 0 || plain_len >= out_len) {
    return false;
  }
  memcpy(out, s_auth.plain, plain_len);
  out[plain_len] = '\0';
  s_auth.rx_seq = seq;
  return true;
}
