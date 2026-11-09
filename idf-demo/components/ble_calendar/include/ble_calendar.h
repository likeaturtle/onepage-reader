#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

/*
 * BLE peripheral that exposes the calendar over a small JSON protocol.
 *
 * Service 6f6e6570-6167-6531-6361-6c656e646172
 *   RX   6f6e6570-6167-6531-6361-000000000001  write / write-without-response
 *   TX   6f6e6570-6167-6531-6361-000000000002  notify
 *   INFO 6f6e6570-6167-6531-6361-000000000003  read
 *
 * Messages are one JSON object per line. The device chunks notifications to
 * the negotiated MTU and reassembles writes until a newline arrives; the phone
 * web page does the same in the other direction. See docs/ble-protocol.md.
 */

typedef struct {
  /* The database changed because of a phone command. Runs in the BLE task;
   * set a flag and let the UI task redraw. */
  void (*on_change)(void);
  /* Connection / notification-subscription state changed. */
  void (*on_conn)(bool connected, bool subscribed);
  /* The phone asked the device to lock/sleep. Runs in the BLE task. */
  void (*on_sleep_request)(void);
} ble_calendar_callbacks_t;

/* Initialises the NimBLE host and controller, registers the GATT service and
 * starts advertising. nvs_flash_init() must already have succeeded. */
esp_err_t ble_calendar_init(void);

void ble_calendar_set_callbacks(const ble_calendar_callbacks_t *callbacks);

bool ble_calendar_connected(void);
bool ble_calendar_subscribed(void);
uint16_t ble_calendar_mtu(void);

/* Stops the host and controller. Call before deep sleep so the radio is not
 * left in an undefined state and the current draw drops immediately. */
void ble_calendar_shutdown(void);
