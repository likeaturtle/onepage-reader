#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_err.h"

/* Protocol v3 application-layer authentication.
 *
 * The BLE link has no SMP pairing. The phone proves knowledge of a per-device
 * key with an HMAC-SHA256 challenge and then encrypts every JSON frame with
 * AES-256-CBC + HMAC-SHA256. Pairing uses a one-time 12-character code printed
 * on the e-ink screen; the code is never sent over the air. All functions are
 * called from the BLE task except the pairing helpers, which the UI task uses
 * while no phone is connected. */

esp_err_t ble_auth_init(void);

/* New connection/subscription: clear the session, issue a fresh nonce. */
void ble_auth_reset_session(void);
bool ble_auth_is_authed(void);
bool ble_auth_has_key(void);
const char *ble_auth_pid(void);
const char *ble_auth_did(void);
const char *ble_auth_nonce_hex(void);

/* Pairing mode. `clear_key` also erases the stored key (re-pair from scratch).
 * Only call while no phone is connected. */
esp_err_t ble_auth_start_pairing(bool clear_key);
void ble_auth_cancel_pairing(void);
bool ble_auth_pairing_active(void);
bool ble_auth_pairing_code(char *out, size_t out_len);
/* Latches a successful pairing for the UI; reading clears the flag. */
bool ble_auth_take_pairing_succeeded(void);

/* Handle a plaintext auth request. Builds the plaintext response JSON and, on
 * success, installs the session keys. Returns false only on an internal error
 * (the response is still valid). `paired_now` is true when this request
 * created/replaced the device key. */
bool ble_auth_handle_auth(cJSON *root, char *response, size_t response_len, bool *paired_now);

/* Encrypt an outbound JSON line, or decrypt an inbound wrapper object. Both
 * use static buffers and must only run from the BLE task. */
bool ble_auth_encrypt_line(const char *json, char *out, size_t out_len);
bool ble_auth_decrypt_frame(cJSON *root, char *out, size_t out_len);

/* Erase the stored key (used by start_pairing(true) and factory reset). */
esp_err_t ble_auth_clear_key(void);
