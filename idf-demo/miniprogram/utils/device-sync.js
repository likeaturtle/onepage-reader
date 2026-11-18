'use strict';

/**
 * Pushes an edited cloud event to the device.
 *
 * Firmware before proto 2 has no `update` command and answers `unknown cmd`;
 * those boards get the old copy deleted and the edited one added, then the
 * cloud record is remapped to the new numeric id. A `not found` reply means the
 * board was reset (or the event was deleted on the device), so the edited event
 * is added back under a fresh id in the same way.
 *
 * On a failed re-add the mapping is cleared, so the next sync re-adds the
 * cloud event instead of mistaking the missing device id for a deletion.
 */

const ble = require('./ble');
const api = require('./api');

async function addAndMap(event) {
  const ack = await ble.add(event);
  await api.mapDevice(event.id, ack.id);
  event.deviceId = ack.id;
  return ack;
}

async function reAdd(event) {
  try {
    return await addAndMap(event);
  } catch (err) {
    await api.mapDevice(event.id, null).catch(() => {});
    throw err;
  }
}

async function pushUpdate(event) {
  if (!event || event.deviceId == null) return null;

  try {
    return await ble.update(event.deviceId, event);
  } catch (err) {
    if (/not found/i.test(err.message)) {
      return reAdd(event);
    }
    if (!/unknown cmd/i.test(err.message)) throw err;
  }

  // Legacy firmware: delete first so the 96-event cap cannot reject the new
  // copy. Both requests go through the queued BLE client, so they stay ordered.
  let deleted = false;
  try {
    await ble.del(event.deviceId);
    deleted = true;
  } catch (err) {
    if (!/not found/i.test(err.message)) throw err;
  }
  try {
    return await addAndMap(event);
  } catch (err) {
    if (deleted) await api.mapDevice(event.id, null).catch(() => {});
    throw err;
  }
}

module.exports = { pushUpdate };
