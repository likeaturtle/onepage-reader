'use strict';

/**
 * BLE client for the 墨程CalCal calendar (NimBLE GATT peripheral).
 *
 * Reference protocol: ../docs/ble-protocol.md
 *   service 6f6e6570-6167-6531-6361-6c656e646172
 *   RX      ...0001  write / write without response
 *   TX      ...0002  notify
 *
 * Notes that matter on phones:
 * - writes are chunked to 20 bytes, which works at the default ATT MTU 23;
 * - notifications are reassembled by newline, not by packet boundary;
 * - only one command is allowed in flight, so commands are queued.
 */

const config = require('../config');
const utf8 = require('./utf8');
const auth = require('./ble-auth');
const { LineDecoder } = require('./frame');

const SERVICE = '6f6e6570-6167-6531-6361-6c656e646172';
const RX_UUID = '6f6e6570-6167-6531-6361-000000000001';
const TX_UUID = '6f6e6570-6167-6531-6361-000000000002';
const CHUNK = 20;
const AUTH_STORAGE = 'calcal.bleAuthKeys';

const state = {
  adapterOpen: false,
  adapterAvailable: true,
  connected: false,
  connecting: false,
  scanning: false,
  deviceId: '',
  deviceName: '',
  serviceId: '',
  rxId: '',
  txId: '',
  lastError: '',
  expectedDisconnect: false,
  decoder: new LineDecoder(),
  writeQueue: Promise.resolve(),
  commandQueue: Promise.resolve(),
  authed: false,
  session: null,
  waiters: [],
  stateListeners: new Set(),
  messageListeners: new Set(),
  scanHandler: null,
  scanAll: false,
};

let handlersBound = false;

function call(api, options) {
  return new Promise((resolve, reject) => {
    wx[api](Object.assign({}, options, {
      success: resolve,
      fail(err) {
        const raw = (err && (err.errMsg || err.message)) || `${api} 失败`;
        const message = String(raw)
          .replace(/^[a-zA-Z0-9_]+:fail\s*/, '')
          .replace(/^fail\s*/, '');
        const error = new Error(message || `${api} 失败`);
        error.code = err && err.errCode;
        error.api = api;
        reject(error);
      },
    }));
  });
}

function snapshot() {
  return {
    adapterOpen: state.adapterOpen,
    adapterAvailable: state.adapterAvailable,
    connected: state.connected && state.authed,
    connecting: state.connecting,
    authed: state.authed,
    scanning: state.scanning,
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    error: state.lastError,
  };
}

/* Long-term keys are stored per device MAC. They are sandbox-local; a new
 * phone (or a cleared mini program) has to re-pair with the code on screen. */
function readKeys() {
  try {
    const value = wx.getStorageSync(AUTH_STORAGE);
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
}

function writeKeys(keys) {
  try {
    wx.setStorageSync(AUTH_STORAGE, keys);
  } catch (_) {
    // A full or unavailable storage only means the user re-pairs next time.
  }
}

function storedKey(did) {
  const encoded = readKeys()[did];
  if (!encoded) return null;
  try {
    const bytes = auth.base64ToBytes(encoded);
    return bytes.length === 32 ? bytes : null;
  } catch (_) {
    return null;
  }
}

function forgetDevice(pid) {
  const keys = readKeys();
  if (!keys[pid]) return;
  delete keys[pid];
  writeKeys(keys);
}

function rememberKey(did, keyBytes) {
  const keys = readKeys();
  keys[did] = auth.bytesToBase64(keyBytes);
  writeKeys(keys);
}

function emitState() {
  const value = snapshot();
  state.stateListeners.forEach((listener) => {
    try {
      listener(value);
    } catch (_) {
      // A broken page must not break the BLE state machine.
    }
  });
}

function onState(listener) {
  state.stateListeners.add(listener);
  try {
    listener(snapshot());
  } catch (_) {
    // ignore
  }
  return () => state.stateListeners.delete(listener);
}

function onMessage(listener) {
  state.messageListeners.add(listener);
  return () => state.messageListeners.delete(listener);
}

function rejectWaiters(error) {
  const waiters = state.waiters;
  state.waiters = [];
  waiters.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  });
}

function settleWaiters(message) {
  const matched = [];
  state.waiters = state.waiters.filter((waiter) => {
    let matchedNow = false;
    try {
      matchedNow = waiter.predicate(message);
    } catch (_) {
      matchedNow = false;
    }
    if (matchedNow) matched.push(waiter);
    return !matchedNow;
  });
  matched.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  });
}

function handleLine(bytes) {
  const text = utf8.decode(bytes).replace(/\r$/, '').trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch (_) {
    return;
  }
  if (state.authed && state.session) {
    // After the handshake the device only sends encrypted wrapper frames.
    if (!(message && message.s !== undefined && message.iv && message.d && message.m)) {
      return;
    }
    const plain = state.session.decrypt(message);
    if (!plain) return;
    message = plain;
  }
  state.messageListeners.forEach((listener) => {
    try {
      listener(message);
    } catch (_) {
      // ignore
    }
  });
  settleWaiters(message);
}

function bindHandlers() {
  if (handlersBound) return;
  handlersBound = true;

  wx.onBLEConnectionStateChange((res) => {
    if (!state.deviceId || res.deviceId !== state.deviceId) return;
    if (res.connected) return;

    const expected = state.expectedDisconnect;
    state.connected = false;
    state.connecting = false;
    state.authed = false;
    state.session = null;
    state.serviceId = '';
    state.rxId = '';
    state.txId = '';
    state.decoder.reset();
    state.expectedDisconnect = false;
    if (!expected) state.lastError = '设备连接已断开';
    rejectWaiters(new Error(expected ? '设备已休眠' : '设备连接已断开'));
    emitState();
  });

  wx.onBLECharacteristicValueChange((res) => {
    if (!state.connected || res.deviceId !== state.deviceId) return;
    if (String(res.characteristicId).toLowerCase() !== String(state.txId).toLowerCase()) return;
    const lines = state.decoder.push(res.value);
    lines.forEach(handleLine);
  });

  wx.onBluetoothAdapterStateChange((res) => {
    state.adapterAvailable = Boolean(res.available);
    if (!res.available) {
      state.adapterOpen = false;
      state.lastError = '系统蓝牙已关闭';
      if (state.connected) {
        rejectWaiters(new Error('系统蓝牙已关闭'));
      }
    }
    emitState();
  });
}

async function openAdapter() {
  bindHandlers();
  if (state.adapterOpen) return;
  try {
    await call('openBluetoothAdapter', { mode: 'central' });
    state.adapterOpen = true;
    state.adapterAvailable = true;
    state.lastError = '';
  } catch (err) {
    if (/already/i.test(err.message)) {
      state.adapterOpen = true;
      state.adapterAvailable = true;
      return;
    }
    state.adapterAvailable = false;
    state.lastError = err.code === 10001
      ? '蓝牙未开启或未授权，请打开系统蓝牙并允许微信使用蓝牙'
      : err.message;
    throw new Error(state.lastError);
  } finally {
    emitState();
  }
}

function matchesDevice(device, all) {
  if (all) return true;
  const name = String(device.name || device.localName || '');
  const prefix = String(config.deviceNamePrefix || 'Mochen').toLowerCase();
  if (name && name.toLowerCase().indexOf(prefix) >= 0) return true;
  const services = device.advertisServiceUUIDs || [];
  return services.some((uuid) => String(uuid).toLowerCase() === SERVICE);
}


async function startScan(options) {
  const opts = options || {};
  const all = Boolean(opts.all);
  if (typeof opts.onDevices !== 'function') throw new Error('startScan 缺少 onDevices 回调');

  await openAdapter();
  await stopScan();

  state.scanAll = all;
  const found = new Map();

  state.scanHandler = (res) => {
    let changed = false;
    (res.devices || []).forEach((device) => {
      if (!matchesDevice(device, all)) return;
      const name = String(device.name || device.localName || '').trim();
      const previous = found.get(device.deviceId);
      if (!previous || previous.name !== name) changed = true;
      found.set(device.deviceId, {
        deviceId: device.deviceId,
        name: name || '未命名设备',
        RSSI: Number(device.RSSI) || -100,
      });
    });
    // Keep discovery order stable while scanning; the page sorts once after
    // the scan window closes. Re-sorting on every RSSI update makes the whole
    // list jump under the user's finger.
    if (changed) opts.onDevices(Array.from(found.values()));
  };

  wx.onBluetoothDeviceFound(state.scanHandler);
  try {
    await call('startBluetoothDevicesDiscovery', {
      allowDuplicatesKey: true,
      interval: 800,
      powerLevel: 'high',
    });
    state.scanning = true;
    state.lastError = '';
  } catch (err) {
    if (wx.offBluetoothDeviceFound) wx.offBluetoothDeviceFound(state.scanHandler);
    state.scanHandler = null;
    state.lastError = /auth|permission|denied/i.test(err.message)
      ? '没有蓝牙扫描权限，请检查微信的系统权限'
      : err.message;
    throw new Error(state.lastError);
  } finally {
    emitState();
  }
}

async function stopScan() {
  if (!state.scanning && !state.scanHandler) return;
  try {
    await call('stopBluetoothDevicesDiscovery');
  } catch (_) {
    // already stopped
  }
  if (state.scanHandler && wx.offBluetoothDeviceFound) {
    wx.offBluetoothDeviceFound(state.scanHandler);
  }
  state.scanHandler = null;
  state.scanning = false;
  emitState();
}

function enqueueWrite(bytes) {
  const run = () => writeChunks(bytes);
  const promise = state.writeQueue.then(run, run);
  state.writeQueue = promise.catch(() => {});
  return promise;
}

async function writeChunks(bytes) {
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const part = bytes.slice(offset, offset + CHUNK);
    await call('writeBLECharacteristicValue', {
      deviceId: state.deviceId,
      serviceId: state.serviceId,
      characteristicId: state.rxId,
      value: part.buffer,
    });
  }
}

async function send(payload) {
  if (!state.connected) throw new Error('设备未连接');
  if (!state.authed || !state.session) throw new Error('设备未认证');
  const line = await state.session.encrypt(payload);
  return enqueueWrite(utf8.encode(`${line}\n`));
}

function sendPlain(payload) {
  if (!state.connected) return Promise.reject(new Error('设备未连接'));
  const line = `${JSON.stringify(payload)}\n`;
  return enqueueWrite(utf8.encode(line));
}

function enqueueCommand(payload, predicate, timeout, plain) {
  const run = () => new Promise((resolve, reject) => {
    if (!state.connected) {
      reject(new Error('设备未连接'));
      return;
    }
    const waiter = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        state.waiters = state.waiters.filter((item) => item !== waiter);
        reject(new Error('设备响应超时'));
      }, timeout || 7000),
    };
    state.waiters.push(waiter);

    const promise = plain ? sendPlain(payload) : send(payload);
    promise.catch((err) => {
      clearTimeout(waiter.timer);
      state.waiters = state.waiters.filter((item) => item !== waiter);
      reject(err);
    });
  });

  const promise = state.commandQueue.then(run, run);
  state.commandQueue = promise.catch(() => {});
  return promise;
}

function command(payload, predicate, timeout) {
  return enqueueCommand(payload, predicate, timeout, false);
}

/* Like command(), but only waits: used for the hello that the firmware pushes
 * when notifications are enabled. */
function waitFor(predicate, timeout) {
  return new Promise((resolve, reject) => {
    if (!state.connected) {
      reject(new Error('设备未连接'));
      return;
    }
    const waiter = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        state.waiters = state.waiters.filter((item) => item !== waiter);
        reject(new Error('设备响应超时'));
      }, timeout || 7000),
    };
    state.waiters.push(waiter);
  });
}

function commandPlain(payload, predicate, timeout) {
  return enqueueCommand(payload, predicate, timeout, true);
}

function isOk(message) {
  return Boolean(message) && message.ok === true;
}

function throwIfError(message, fallback) {
  if (!isOk(message)) {
    throw new Error((message && message.error) || fallback);
  }
  return message;
}

/* --- protocol v3 authentication --------------------------------------- */

async function runAuth(pid, nonceD, key, mode) {
  const nonceA = auth.bytesToHex(await auth.randomBytes(16));
  const proof = auth.clientProof(key, pid, nonceD, nonceA, mode);
  const response = await commandPlain(
    { cmd: 'auth', pid, nonce: nonceA, proof, pair: mode === 'pair' },
    (message) => Boolean(message) && message.ev === 'auth',
    7000
  );
  if (!response.ok) {
    const error = new Error(response.error || '设备认证失败');
    error.code = response.error;
    throw error;
  }
  return { nonceA, response };
}

async function authenticateWithKey(longKey, pid, nonceD) {
  const { nonceA, response } = await runAuth(pid, nonceD, longKey, 'auth');
  const expected = auth.deviceProof(longKey, pid, nonceA, nonceD, 'auth');
  if (!auth.secureEqualHex(expected, response.proof)) {
    throw new Error('设备身份校验失败');
  }
  state.session = auth.createSession(longKey, nonceD, nonceA, 'app');
  state.authed = true;
}

async function pairWithCode(code, pid, nonceD) {
  const pairKey = auth.derivePairKey(code, pid);
  const longKey = auth.deriveLongKey(code, pid);
  const { nonceA, response } = await runAuth(pid, nonceD, pairKey, 'pair');
  const expected = auth.deviceProof(longKey, pid, nonceA, nonceD, 'pair');
  if (!auth.secureEqualHex(expected, response.proof)) {
    throw new Error('设备身份校验失败');
  }
  state.session = auth.createSession(longKey, nonceD, nonceA, 'app');
  state.authed = true;
  rememberKey(pid, longKey);
}

function pairingError(err) {
  switch (err && err.code) {
    case 'bad proof':
      return new Error('配对码错误');
    case 'pairing not active':
      return new Error('配对已过期，请在设备上重新长按确认键 3 秒');
    case 'too many attempts':
      return new Error('尝试次数过多，请稍后重试');
    default:
      return err;
  }
}

async function authenticate(hello, options) {
  const pid = String(hello.pid || '');
  const nonceD = String(hello.nonce || '');
  if (!pid || !/^[0-9a-f]{12}$/i.test(pid) || !/^[0-9a-f]{32}$/i.test(nonceD)) {
    throw new Error('设备认证信息不完整，请升级固件后重试');
  }

  const stored = storedKey(pid);
  if (stored) {
    try {
      await authenticateWithKey(stored, pid, nonceD);
      return;
    } catch (err) {
      if (err.code !== 'bad proof' && err.code !== 'not paired') throw err;
      // Keep the old key: a fake device or a device re-paired by someone else
      // must not be able to erase it. A successful re-pair below overwrites it.
      if (!hello.pairing) {
        throw new Error(hello.paired
          ? '设备认证失败（可能已被其他手机重新配对），请在设备上长按确认键 3 秒重新配对'
          : '设备已重置，请在设备上长按确认键 3 秒重新配对');
      }
    }
  }

  if (!hello.pairing) {
    throw new Error(hello.paired
      ? '此手机尚未绑定该设备，请在设备上长按确认键 3 秒后重试'
      : '设备未绑定，请在设备上长按确认键 3 秒后重试');
  }
  if (!options || typeof options.requestPairingCode !== 'function') {
    throw new Error('需要设备屏幕上显示的配对码');
  }

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const entered = await options.requestPairingCode({
      pid,
      error: lastError ? lastError.message : '',
    });
    if (!entered) throw new Error('已取消配对');
    if (!auth.isValidCode(entered)) {
      lastError = new Error('配对码格式不正确');
      continue;
    }
    try {
      await pairWithCode(entered, pid, nonceD);
      return;
    } catch (err) {
      lastError = pairingError(err);
      if (/too many|尝试次数/.test(lastError.message)) break;
    }
  }
  throw lastError || new Error('配对失败');
}

async function connect(deviceId, options) {
  await openAdapter();
  await stopScan();

  if (state.connected) {
    await disconnect();
    // Let the close event land before a new connection starts, otherwise it
    // looks like the new link dropped immediately.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  state.deviceId = deviceId;
  state.connecting = true;
  state.lastError = '';
  state.expectedDisconnect = false;
  state.decoder.reset();
  emitState();

  try {
    await call('createBLEConnection', { deviceId, timeout: 12000 });

    const services = await call('getBLEDeviceServices', { deviceId });
    const service = (services.services || []).find(
      (item) => String(item.uuid).toLowerCase() === SERVICE
    );
    if (!service) throw new Error('设备上没有找到日历服务');

    const characteristics = await call('getBLEDeviceCharacteristics', {
      deviceId,
      serviceId: service.uuid,
    });
    const list = characteristics.characteristics || [];
    const rx = list.find((item) => String(item.uuid).toLowerCase() === RX_UUID);
    const tx = list.find((item) => String(item.uuid).toLowerCase() === TX_UUID);
    if (!rx || !tx) throw new Error('设备特征不完整，可能不是墨程CalCal');

    state.serviceId = service.uuid;
    state.rxId = rx.uuid;
    state.txId = tx.uuid;

    // Set connected before enabling notifications so the automatic hello is
    // not dropped by the notification handler. The waiter is registered first
    // too; the explicit hello below is only a fallback for a lost event.
    state.connected = true;
    state.connecting = true;
    state.authed = false;
    state.session = null;
    const helloPromise = waitFor((m) => m && m.ev === 'hello', 2000);
    helloPromise.catch(() => {});
    await call('notifyBLECharacteristicValueChange', {
      state: true,
      deviceId,
      serviceId: service.uuid,
      characteristicId: tx.uuid,
    });

    let pre;
    try {
      pre = await helloPromise;
    } catch (_) {
      pre = await commandPlain({ cmd: 'hello' }, (m) => m && m.ev === 'hello', 7000);
    }
    if (!pre || Number(pre.proto) < 3) {
      throw new Error('设备固件过旧，请先升级固件');
    }
    await authenticate(pre, options || {});
    state.connecting = false;
    emitState();

    const hello = await command({ cmd: 'hello' }, (m) => m && m.ev === 'hello', 7000);
    state.deviceName = hello.name || '墨程CalCal';
    emitState();

    const tz = -new Date().getTimezoneOffset();
    try {
      await time(Math.floor(Date.now() / 1000), tz);
      // Reflect the successful sync so the page does not show "未同步".
      hello.now = Math.floor(Date.now() / 1000);
      hello.tz = tz;
      hello.time_valid = true;
    } catch (_) {
      // The device keeps its previous clock; the user can refresh later.
    }

    return hello;
  } catch (err) {
    state.connected = false;
    state.connecting = false;
    state.authed = false;
    state.session = null;
    state.serviceId = '';
    state.rxId = '';
    state.txId = '';
    rejectWaiters(err);
    try {
      await call('closeBLEConnection', { deviceId });
    } catch (_) {
      // ignore
    }
    state.deviceId = '';
    state.lastError = err.message;
    emitState();
    throw err;
  }
}

async function disconnect() {
  state.expectedDisconnect = true;
  await stopScan();
  const deviceId = state.deviceId;
  if (state.connected && deviceId) {
    try {
      await call('closeBLEConnection', { deviceId });
    } catch (_) {
      // ignore
    }
  }
  state.connected = false;
  state.connecting = false;
  state.authed = false;
  state.session = null;
  state.deviceId = '';
  state.deviceName = '';
  state.serviceId = '';
  state.rxId = '';
  state.txId = '';
  state.lastError = '';
  state.decoder.reset();
  rejectWaiters(new Error('已断开连接'));
  emitState();
}

async function hello() {
  return command({ cmd: 'hello' }, (m) => m.ev === 'hello', 7000);
}

async function time(epoch, tz) {
  const ack = await command(
    { cmd: 'time', epoch, tz },
    (m) => (isOk(m) && m.cmd === 'time') || m.ok === false,
    7000
  );
  return throwIfError(ack, '时间同步失败');
}

async function list(from, to) {
  const events = [];
  const off = onMessage((message) => {
    if (message.ev === 'ev') events.push(message);
  });
  try {
    const done = await command(
      { cmd: 'list', from, to },
      (m) => m.ev === 'done' || m.ok === false,
      12000
    );
    // The terminator is {"ev":"done","n":N}; only an explicit ok:false is an error.
    if (done.ok === false) throw new Error(done.error || '读取日程失败');
    if (Number.isFinite(done.n) && done.n !== events.length) {
      // A dropped notification must not be mistaken for deleted events during
      // the cloud sync, so fail the whole listing instead.
      throw new Error(`设备列表不完整（${events.length}/${done.n}）`);
    }
    return events;
  } finally {
    off();
  }
}

async function add(event) {
  const payload = {
    cmd: 'add',
    date: event.date,
    start: event.start,
    end: event.end,
    title: event.title,
    note: event.note || '',
  };
  const ack = await command(
    payload,
    (m) => (isOk(m) && m.cmd === 'add') || m.ok === false,
    9000
  );
  return throwIfError(ack, '添加日程失败');
}

async function update(id, event) {
  const payload = {
    cmd: 'update',
    id,
    date: event.date,
    start: event.start,
    end: event.end,
    title: event.title,
    note: event.note || '',
  };
  const ack = await command(
    payload,
    (m) => (isOk(m) && m.cmd === 'update') || m.ok === false,
    9000
  );
  return throwIfError(ack, '修改日程失败');
}

async function del(id) {
  const ack = await command(
    { cmd: 'del', id },
    (m) => (isOk(m) && m.cmd === 'del') || m.ok === false,
    7000
  );
  return throwIfError(ack, '删除日程失败');
}

async function sleepDevice() {
  state.expectedDisconnect = true;
  try {
    const ack = await command(
      { cmd: 'sleep' },
      (m) => (isOk(m) && m.cmd === 'sleep') || m.ok === false,
      7000
    );
    return throwIfError(ack, '锁屏失败');
  } catch (err) {
    // The device acknowledges and then cuts the radio. If it drops before the
    // ack reaches us, that is still the expected outcome, not a failure.
    if (!state.connected) return { ok: true, disconnected: true };
    state.expectedDisconnect = false;
    throw err;
  }
}

async function ping() {
  const ack = await command(
    { cmd: 'ping' },
    (m) => (isOk(m) && m.cmd === 'ping') || m.ok === false,
    5000
  );
  return throwIfError(ack, '设备无响应');
}

function isConnected() {
  // The page treats "connected" as "ready for commands"; before the auth
  // handshake is done the link exists but commands would be rejected.
  return state.connected && state.authed;
}

function getState() {
  return snapshot();
}

module.exports = {
  SERVICE,
  RX_UUID,
  TX_UUID,
  openAdapter,
  startScan,
  stopScan,
  connect,
  disconnect,
  hello,
  time,
  list,
  add,
  update,
  del,
  sleep: sleepDevice,
  ping,
  command,
  send,
  isConnected,
  forgetDevice,
  getState,
  onState,
  onMessage,
  scanRunning: () => state.scanning,
  scanAll: () => state.scanAll,
};
