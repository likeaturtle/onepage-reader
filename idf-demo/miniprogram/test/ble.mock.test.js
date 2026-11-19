'use strict';

/**
 * End-to-end test of utils/ble.js against a fake WeChat BLE stack.
 * Run with: node --test test/ble.mock.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const auth = require('../utils/ble-auth');

const SERVICE = '6f6e6570-6167-6531-6361-6c656e646172';
const RX = '6f6e6570-6167-6531-6361-000000000001';
const TX = '6f6e6570-6167-6531-6361-000000000002';

class FakeWx {
  constructor(options = {}) {
    this.connectionHandler = null;
    this.valueHandler = null;
    this.adapterHandler = null;
    this.connected = false;
    this.deviceId = '';
    this.rxBuffer = Buffer.alloc(0);
    this.writeSizes = [];
    this.commands = [];
    this.notifyQueue = [];
    this.txChain = Promise.resolve();
    this.notifyBusy = false;
    this.events = [
      { ev: 'ev', id: 7, cal: 0, date: '2026-11-10', start: '09:00', end: '10:00', title: '项目评审', note: '会议室 A' },
    ];
    this.storage = new Map();
    this.pid = 'A1B2C3D4E5F6';
    this.did = '0123456789abcdef0123456789abcdef';
    this.pairing = Boolean(options.pairing);
    this.pairingCode = options.code || 'K7Q4M2X9B3TF';
    this.key = this.pairing ? null : Buffer.alloc(32, 0x42);
    this.nonceD = '';
    this.authed = false;
    this.deviceSession = null;
  }

  getStorageSync(key) { return this.storage.get(key); }
  setStorageSync(key, value) { this.storage.set(key, value); }
  removeStorageSync(key) { this.storage.delete(key); }
  clearStorageSync() { this.storage.clear(); }

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
      // The firmware issues a nonce and pushes a minimal hello as soon as TX
      // notifications are enabled.
      this.nonceD = crypto.randomBytes(16).toString('hex');
      this.authed = false;
      this.deviceSession = null;
      this.sendHello();
    }, 0);
  }

  sendHello() {
    this.notifyPlain({
      ev: 'hello',
      proto: 3,
      fw: '1.2.0',
      name: '墨程CalCal',
      pid: this.pid,
      auth: true,
      paired: Boolean(this.key),
      pairing: this.pairing,
      nonce: this.nonceD,
    });
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
    if (this.authed) {
      if (!command.s || !command.iv || !command.d || !command.m) {
        this.notify({ ok: false, error: 'encrypted frame required' });
        return;
      }
      const plain = this.deviceSession.decrypt(command);
      if (!plain) {
        this.notify({ ok: false, error: 'bad frame' });
        return;
      }
      this.dispatchCommand(plain);
      return;
    }
    this.commands.push(command);
    if (command.cmd === 'hello') {
      this.sendHello();
    } else if (command.cmd === 'auth') {
      this.handleAuth(command);
    } else {
      this.notify({ ok: false, error: 'auth required' });
    }
  }

  dispatchCommand(command) {
    this.commands.push(command);
    if (command.cmd === 'hello') {
      this.notify({
        ev: 'hello', proto: 3, fw: '1.2.0', name: '墨程CalCal',
        pid: this.pid, did: this.did,
        auth: true, authed: true, now: 1762703820, tz: 480, time_valid: true,
        time_synced: true, events: this.events.length, calendars: 1, cals: ['日历'],
      });
    } else if (command.cmd === 'time') {
      this.notify({ ok: true, cmd: 'time', local: '2026-11-10 10:00', persist: true });
    } else if (command.cmd === 'add') {
      this.events.push({ ev: 'ev', id: 8, cal: 0, date: command.date, start: command.start, end: command.end, title: command.title, note: command.note || '' });
      this.notify({ ok: true, cmd: 'add', id: 8, pruned: 0, trunc: false });
    } else if (command.cmd === 'list') {
      this.events.forEach((event) => this.notify(event));
      this.notify({ ev: 'done', n: this.events.length });
    } else if (command.cmd === 'update') {
      const target = this.events.find((event) => event.id === command.id);
      if (!target) {
        this.notify({ ok: false, error: 'not found' });
      } else {
        Object.assign(target, {
          date: command.date,
          start: command.start,
          end: command.end,
          title: command.title,
          note: command.note || '',
        });
        this.notify({ ok: true, cmd: 'update', id: command.id, trunc: false });
      }
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

  handleAuth(command) {
    const pair = Boolean(command.pair);
    const nonceA = String(command.nonce || '');
    const pid = String(command.pid || '');
    const fail = (error) => this.notifyPlain({
      ev: 'auth', ok: false, proto: 3, error,
      paired: Boolean(this.key), pairing: this.pairing,
    });
    if (pid !== this.pid || !/^[0-9a-f]{32}$/i.test(nonceA)) {
      fail('bad auth request');
      return;
    }
    let keyAuth;
    if (pair) {
      if (!this.pairing) {
        fail('pairing not active');
        return;
      }
      keyAuth = auth.derivePairKey(this.pairingCode, this.pid);
    } else {
      if (!this.key) {
        fail('not paired');
        return;
      }
      keyAuth = this.key;
    }
    const expected = auth.clientProof(keyAuth, this.pid, this.nonceD, nonceA,
      pair ? 'pair' : 'auth');
    if (!auth.secureEqualHex(expected, command.proof)) {
      fail('bad proof');
      return;
    }
    let longKey = this.key;
    if (pair) {
      longKey = auth.deriveLongKey(this.pairingCode, this.pid);
      this.key = longKey;
      this.pairing = false;
    }
    this.deviceSession = auth.createSession(longKey, this.nonceD, nonceA, 'device');
    this.authed = true;
    const proof = auth.deviceProof(longKey, this.pid, nonceA, this.nonceD,
      pair ? 'pair' : 'auth');
    this.notifyPlain({ ev: 'auth', ok: true, proto: 3, paired: true, pairing: false, proof });
  }

  notifyPlain(message) {
    this.notifyLine(JSON.stringify(message));
  }

  notify(message) {
    if (this.authed && this.deviceSession) {
      this.txChain = this.txChain
        .then(() => this.deviceSession.encrypt(message))
        .then((line) => this.notifyLine(line), () => {});
      return;
    }
    this.notifyLine(JSON.stringify(message));
  }

  notifyLine(line) {
    const bytes = Buffer.from(`${line}\n`, 'utf8');
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
  fake.setStorageSync('calcal.bleAuthKeys', {
    [fake.pid]: auth.bytesToBase64(fake.key),
  });

  delete require.cache[require.resolve('../utils/ble')];
  const ble = require('../utils/ble');

  const hello = await ble.connect('device-1');
  assert.equal(hello.name, '墨程CalCal');
  assert.equal(ble.isConnected(), true);

  const events = await ble.list('2026-11-01', '2026-11-30');
  assert.equal(events.length, 1);
  assert.equal(events[0].title, '项目评审');

  const ack = await ble.add({ date: '2026-11-11', start: '14:00', end: '15:00', title: '新的日程', note: '备注' });
  assert.equal(ack.id, 8);

  const edited = await ble.update(ack.id, {
    date: '2026-11-11', start: '14:30', end: '15:30', title: '改期的日程', note: '',
  });
  assert.equal(edited.id, 8);
  assert.equal(fake.events.find((event) => event.id === 8).title, '改期的日程');
  assert.equal(fake.events.find((event) => event.id === 8).start, '14:30');

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


test('a new phone pairs with the one-time code shown on the device', async () => {
  const fake = new FakeWx({ pairing: true, code: 'K7Q4M2X9B3TF' });
  global.wx = fake;

  delete require.cache[require.resolve('../utils/ble')];
  const ble = require('../utils/ble');

  let asked = 0;
  const hello = await ble.connect('device-1', {
    requestPairingCode: async (info) => {
      asked += 1;
      assert.equal(info.pid, fake.pid);
      return asked === 1 ? 'K7Q4-M2X9-B3TF' : '';
    },
  });

  assert.equal(hello.name, '墨程CalCal');
  assert.equal(asked, 1);
  assert.equal(fake.authed, true);
  assert.equal(fake.pairing, false);
  const stored = fake.getStorageSync('calcal.bleAuthKeys');
  assert.ok(stored[fake.pid]);
  assert.deepEqual(Buffer.from(auth.base64ToBytes(stored[fake.pid])), Buffer.from(fake.key));

  const events = await ble.list('2026-11-01', '2026-11-30');
  assert.equal(events.length, 1);
  await ble.disconnect();
});

test('a failed authentication keeps the stored key for a later real device', async () => {
  const fake = new FakeWx();
  global.wx = fake;
  const previous = Buffer.alloc(32, 0x11);
  fake.setStorageSync('calcal.bleAuthKeys', {
    [fake.pid]: auth.bytesToBase64(previous),
  });

  delete require.cache[require.resolve('../utils/ble')];
  const ble = require('../utils/ble');

  await assert.rejects(() => ble.connect('device-1'), /认证失败|重置/);
  const stored = fake.getStorageSync('calcal.bleAuthKeys');
  assert.deepEqual(Buffer.from(auth.base64ToBytes(stored[fake.pid])), previous);
});
