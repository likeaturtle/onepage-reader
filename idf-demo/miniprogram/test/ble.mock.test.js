'use strict';

/**
 * End-to-end test of utils/ble.js against a fake WeChat BLE stack.
 * Run with: node --test test/ble.mock.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const SERVICE = '6f6e6570-6167-6531-6361-6c656e646172';
const RX = '6f6e6570-6167-6531-6361-000000000001';
const TX = '6f6e6570-6167-6531-6361-000000000002';

class FakeWx {
  constructor() {
    this.connectionHandler = null;
    this.valueHandler = null;
    this.adapterHandler = null;
    this.connected = false;
    this.deviceId = '';
    this.rxBuffer = Buffer.alloc(0);
    this.writeSizes = [];
    this.commands = [];
    this.notifyQueue = [];
    this.notifyBusy = false;
    this.events = [
      { ev: 'ev', id: 7, cal: 0, date: '2026-11-10', start: '09:00', end: '10:00', title: '项目评审', note: '会议室 A' },
    ];
  }

  onBLEConnectionStateChange(handler) { this.connectionHandler = handler; }
  onBLECharacteristicValueChange(handler) { this.valueHandler = handler; }
  onBluetoothAdapterStateChange(handler) { this.adapterHandler = handler; }
  onBluetoothDeviceFound() {}
  offBluetoothDeviceFound() {}

  openBluetoothAdapter(options) {
    setTimeout(() => options.success({}), 0);
  }

  startBluetoothDevicesDiscovery(options) {
    setTimeout(() => options.success({}), 0);
  }

  stopBluetoothDevicesDiscovery(options) {
    setTimeout(() => options.success({}), 0);
  }

  createBLEConnection(options) {
    this.deviceId = options.deviceId;
    this.connected = true;
    setTimeout(() => {
      options.success({});
      if (this.connectionHandler) this.connectionHandler({ deviceId: this.deviceId, connected: true });
    }, 0);
  }

  closeBLEConnection(options) {
    this.connected = false;
    setTimeout(() => {
      options.success({});
      if (this.connectionHandler) this.connectionHandler({ deviceId: options.deviceId, connected: false });
    }, 0);
  }

  getBLEDeviceServices(options) {
    setTimeout(() => options.success({ services: [{ uuid: SERVICE, isPrimary: true }] }), 0);
  }

  getBLEDeviceCharacteristics(options) {
    setTimeout(() => options.success({
      characteristics: [
        { uuid: RX, properties: { write: true, writeNoResponse: true } },
        { uuid: TX, properties: { notify: true } },
      ],
    }), 0);
  }

  notifyBLECharacteristicValueChange(options) {
    setTimeout(() => {
      options.success({});
      // The firmware sends hello as soon as TX notifications are enabled.
      this.notify({ ev: 'hello', proto: 1, fw: '1.0.0', name: 'Mochen CalCal', now: 1762703820, tz: 480, time_valid: true, events: 1, calendars: 1 });
    }, 0);
  }

  writeBLECharacteristicValue(options) {
    const bytes = Buffer.from(options.value);
    assert.ok(bytes.length <= 20, `write chunk is ${bytes.length} bytes`);
    this.writeSizes.push(bytes.length);
    this.rxBuffer = Buffer.concat([this.rxBuffer, bytes]);

    let index;
    while ((index = this.rxBuffer.indexOf(0x0a)) >= 0) {
      const line = this.rxBuffer.subarray(0, index).toString('utf8');
      this.rxBuffer = this.rxBuffer.subarray(index + 1);
      this.handleCommand(JSON.parse(line));
    }
    setTimeout(() => options.success({}), 0);
  }

  handleCommand(command) {
    this.commands.push(command);
    if (command.cmd === 'hello') {
      this.notify({ ev: 'hello', proto: 1, fw: '1.0.0', name: 'Mochen CalCal', now: 1762703820, tz: 480, time_valid: true, events: 1, calendars: 1 });
    } else if (command.cmd === 'time') {
      this.notify({ ok: true, cmd: 'time', local: '2026-11-10 10:00', persist: true });
    } else if (command.cmd === 'add') {
      this.events.push({ ev: 'ev', id: 8, cal: 0, date: command.date, start: command.start, end: command.end, title: command.title, note: command.note || '' });
      this.notify({ ok: true, cmd: 'add', id: 8, pruned: 0, trunc: false });
    } else if (command.cmd === 'list') {
      this.events.forEach((event) => this.notify(event));
      this.notify({ ev: 'done', n: this.events.length });
    } else if (command.cmd === 'del') {
      this.events = this.events.filter((event) => event.ev !== 'ev' || event.id !== command.id);
      this.notify({ ok: true, cmd: 'del', id: command.id });
    } else if (command.cmd === 'sleep') {
      this.notify({ ok: true, cmd: 'sleep' });
      this.closeBLEConnection({ deviceId: this.deviceId, success() {}, fail() {} });
    } else {
      this.notify({ ok: false, error: 'unknown cmd' });
    }
  }

  notify(message) {
    const bytes = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
    // Deliberately split inside multi-byte characters.
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 5) {
      chunks.push(Uint8Array.from(bytes.subarray(offset, offset + 5)).buffer);
    }
    this.notifyQueue.push(chunks);
    this.pumpNotifications();
  }

  // A real GATT server sends the chunks of one line in order, one line at a
  // time. Interleaving two lines would corrupt the byte stream, so the fake
  // must serialize them too.
  pumpNotifications() {
    if (this.notifyBusy) return;
    const chunks = this.notifyQueue.shift();
    if (!chunks) return;
    this.notifyBusy = true;
    const send = (index) => {
      if (index >= chunks.length) {
        this.notifyBusy = false;
        this.pumpNotifications();
        return;
      }
      setImmediate(() => {
        if (this.valueHandler) {
          this.valueHandler({ deviceId: this.deviceId, serviceId: SERVICE, characteristicId: TX, value: chunks[index] });
        }
        send(index + 1);
      });
    };
    send(0);
  }
}

test('BLE client connects, parses streamed events and chunks writes at 20 bytes', async () => {
  const fake = new FakeWx();
  global.wx = fake;

  delete require.cache[require.resolve('../utils/ble')];
  const ble = require('../utils/ble');

  const hello = await ble.connect('device-1');
  assert.equal(hello.name, 'Mochen CalCal');
  assert.equal(ble.isConnected(), true);

  const events = await ble.list('2026-11-01', '2026-11-30');
  assert.equal(events.length, 1);
  assert.equal(events[0].title, '项目评审');

  const ack = await ble.add({ date: '2026-11-11', start: '14:00', end: '15:00', title: '新的日程', note: '备注' });
  assert.equal(ack.id, 8);

  await ble.del(7);
  assert.equal(fake.events.length, 1);

  assert.ok(fake.writeSizes.length > 0);
  assert.ok(fake.writeSizes.every((size) => size <= 20));
  assert.ok(fake.commands.some((command) => command.cmd === 'time'));

  const states = [];
  ble.onState((state) => states.push(state.connected));
  await ble.sleep();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(ble.isConnected(), false);
  assert.equal(states[states.length - 1], false);
});
