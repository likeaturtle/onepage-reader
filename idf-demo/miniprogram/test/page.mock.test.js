'use strict';

/**
 * Unit tests for the interactions in pages/index/index.js: the add-event form
 * (calendar date picker, start-time/end-time link) and the collapsible device
 * card. The page is loaded with fake api/ble/auth modules, so this runs without
 * a WeChat runtime.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'pages', 'index', 'index.js');
const blePath = require.resolve('../utils/ble');
const apiPath = require.resolve('../utils/api');
const authPath = require.resolve('../utils/auth');
const deviceSyncPath = require.resolve('../utils/device-sync');
const fmt = require('../utils/format');

function makePage(formDate, options = {}) {
  let definition = null;
  const scrollCalls = [];
  const calls = { bluetoothSettings: 0, wechatSettings: 0, retries: 0, disconnects: 0, toasts: [], modals: [] };
  const rect = options.rect || null;
  const pageScrollTop = Number(options.scrollTop) || 0;
  const windowHeight = Number(options.windowHeight) || 700;

  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast: (opts) => calls.toasts.push(opts),
    showModal: (opts) => calls.modals.push(opts),
    reLaunch() {},
    switchTab() {},
    getWindowInfo: () => ({ windowHeight }),
    pageScrollTo: (opts) => scrollCalls.push(opts),
    createSelectorQuery() {
      let found = null;
      let view = null;
      return {
        select() {
          return { boundingClientRect() { found = rect; return this; } };
        },
        selectViewport() {
          return { scrollOffset() { view = { scrollTop: pageScrollTop }; return this; } };
        },
        exec(callback) { callback([found, view]); },
      };
    },
  };

  let stateCallback = null;
  require.cache[blePath] = {
    id: blePath,
    filename: blePath,
    loaded: true,
    exports: {
      onState(callback) {
        stateCallback = callback;
        return () => { stateCallback = null; };
      },
      onMessage() { return () => {}; },
      canOpenBluetoothSettings: () => options.android !== false,
      openBluetoothSettings() {
        calls.bluetoothSettings += 1;
        return Promise.resolve({});
      },
      openWechatSettings() {
        calls.wechatSettings += 1;
        return Promise.resolve({});
      },
      retryAdapter() {
        calls.retries += 1;
        return Promise.resolve(options.retryReady !== false);
      },
      disconnect() {
        calls.disconnects += 1;
        return Promise.resolve();
      },
      isConnected: () => options.connected === true,
    },
  };
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {} };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      get: () => ({ token: 'token', user: {} }),
      getToken: () => 'token',
      getUser: () => ({}),
      isGuest: () => false,
      setUser() {},
    },
  };
  delete require.cache[deviceSyncPath];
  delete require.cache[pagePath];
  require(pagePath);

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      for (const key of Object.keys(patch)) {
        if (key.indexOf('.') < 0) {
          this.data[key] = patch[key];
          continue;
        }
        const [head, tail] = key.split('.');
        this.data[head] = Object.assign({}, this.data[head], { [tail]: patch[key] });
      }
      if (typeof callback === 'function') callback();
    },
  });
  page.data.form = Object.assign({}, page.data.form, { date: formDate });
  page.scrollCalls = scrollCalls;
  page.calls = calls;
  page.emitState = (state) => { if (stateCallback) stateCallback(state); };
  return page;
}

function tap(date) {
  return { currentTarget: { dataset: { date } } };
}

function arrow(delta) {
  return { currentTarget: { dataset: { delta: String(delta) } } };
}

function selectedDates(page) {
  return page.data.calendarCells.filter((cell) => cell.selected).map((cell) => cell.date);
}

test('the date field opens a six-week grid for the form month', () => {
  const page = makePage('2026-11-16');
  assert.equal(page.data.calendarOpen, false);

  page.toggleCalendar();

  assert.equal(page.data.calendarOpen, true);
  assert.equal(page.data.calendarLabel, '2026 年 11 月');
  assert.equal(page.data.calendarCells.length, 42);
  assert.deepEqual(selectedDates(page), ['2026-11-16']);
  // The 今天 marker can only point at the real current day.
  for (const cell of page.data.calendarCells.filter((item) => item.today)) {
    assert.equal(cell.date, fmt.ymd(new Date()));
  }
});

test('tapping the field again closes the grid', () => {
  const page = makePage('2026-11-16');
  page.toggleCalendar();
  page.toggleCalendar();
  assert.equal(page.data.calendarOpen, false);
});

test('the month arrows move the grid without touching the form date', () => {
  const page = makePage('2026-11-16');
  page.toggleCalendar();

  page.shiftCalendarMonth(arrow(1));
  assert.equal(page.data.calendarLabel, '2026 年 12 月');
  assert.equal(page.data.form.date, '2026-11-16');
  assert.equal(page.data.calendarCells.length, 42);

  page.shiftCalendarMonth(arrow(-1));
  assert.equal(page.data.calendarLabel, '2026 年 11 月');
  assert.deepEqual(selectedDates(page), ['2026-11-16']);

  page.shiftCalendarMonth(arrow(2)); // November -> January, across the year
  assert.equal(page.data.calendarLabel, '2027 年 1 月');
});

test('picking a day writes the form date and closes the grid', () => {
  const page = makePage('2026-11-16');
  page.toggleCalendar();

  page.pickDay(tap('2026-11-03'));

  assert.equal(page.data.form.date, '2026-11-03');
  assert.equal(page.data.calendarOpen, false);
  assert.equal(page.calMonth, 10);
  assert.equal(page.data.form.start, page.data.form.start); // time fields untouched
});

test('picking a neighbouring-month day reopens the grid on that month', () => {
  const page = makePage('2026-11-16');
  page.toggleCalendar();

  page.pickDay(tap('2026-12-01')); // trailing row of the November grid
  page.toggleCalendar();

  assert.equal(page.data.calendarLabel, '2026 年 12 月');
  assert.deepEqual(selectedDates(page), ['2026-12-01']);
});

test('the month arrows stop at the 2020..2099 range', () => {
  const last = makePage('2099-12-05');
  last.toggleCalendar();
  last.shiftCalendarMonth(arrow(1));
  assert.equal(last.data.calendarLabel, '2099 年 12 月');

  const first = makePage('2020-01-05');
  first.toggleCalendar();
  first.shiftCalendarMonth(arrow(-1));
  assert.equal(first.data.calendarLabel, '2020 年 1 月');
});

test('the 今天 shortcut selects the current day and closes the grid', () => {
  const page = makePage('2026-11-16');
  page.toggleCalendar();

  page.pickToday();

  assert.equal(page.data.form.date, fmt.ymd(new Date()));
  assert.equal(page.data.calendarOpen, false);
});

test('confirming a start time moves the end 30 minutes ahead', () => {
  const page = makePage('2026-11-16');

  page.onStart({ detail: { value: '09:00' } });
  assert.equal(page.data.form.start, '09:00');
  assert.equal(page.data.form.end, '09:30');

  page.onStart({ detail: { value: '14:45' } }); // crosses the hour
  assert.equal(page.data.form.end, '15:15');
});

test('a picked end time is kept, and only a new start re-derives it', () => {
  const page = makePage('2026-11-16');
  page.onStart({ detail: { value: '09:00' } });

  page.onEnd({ detail: { value: '11:00' } });
  assert.equal(page.data.form.end, '11:00');

  page.onStart({ detail: { value: '10:00' } });
  assert.equal(page.data.form.end, '10:30');
});

test('the auto end stays on the same day', () => {
  const page = makePage('2026-11-16');

  page.onStart({ detail: { value: '23:40' } });

  assert.equal(page.data.form.start, '23:40');
  assert.equal(page.data.form.end, '23:59');
});

test('opening the calendar scrolls the panel fully into view', () => {
  const page = makePage('2026-11-16', {
    rect: { top: 400, height: 300 },
    scrollTop: 50,
    windowHeight: 600,
  });

  page.toggleCalendar();

  // 400 + 300 + 12 - 600 = 112 px below the fold, on top of the current 50 px.
  assert.deepEqual(page.scrollCalls, [{ scrollTop: 162, duration: 200 }]);
});

test('a calendar that already fits does not scroll the page', () => {
  const page = makePage('2026-11-16', {
    rect: { top: 100, height: 300 },
    scrollTop: 0,
    windowHeight: 600,
  });

  page.toggleCalendar();

  assert.deepEqual(page.scrollCalls, []);
});

test('a calendar taller than the screen aligns its top edge', () => {
  const page = makePage('2026-11-16', {
    rect: { top: 300, height: 700 },
    scrollTop: 100,
    windowHeight: 600,
  });

  page.toggleCalendar();

  assert.deepEqual(page.scrollCalls, [{ scrollTop: 388, duration: 200 }]);
});

test('closing the calendar never scrolls the page', () => {
  const page = makePage('2026-11-16', {
    rect: { top: 400, height: 300 },
    scrollTop: 50,
    windowHeight: 600,
  });
  page.toggleCalendar();
  page.scrollCalls.length = 0;

  page.toggleCalendar();

  assert.deepEqual(page.scrollCalls, []);
});

test('connecting folds the device card, disconnecting opens it again', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  assert.equal(page.data.deviceOpen, true);

  page.emitState({ connected: true, connecting: false, scanning: false, adapterAvailable: true });
  assert.equal(page.data.deviceOpen, false);
  assert.equal(page.data.connected, true);

  page.emitState({ connected: false, connecting: false, scanning: false, adapterAvailable: true });
  assert.equal(page.data.deviceOpen, true);
});

test('expanding the folded device card survives repeated connected states', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.emitState({ connected: true, connecting: false, scanning: false, adapterAvailable: true });
  assert.equal(page.data.deviceOpen, false);

  page.toggleDeviceCard();
  assert.equal(page.data.deviceOpen, true);

  page.emitState({ connected: true, connecting: false, scanning: false, adapterAvailable: true });
  assert.equal(page.data.deviceOpen, true);
});

test('the device header does nothing while disconnected', () => {
  const page = makePage('2026-11-16');
  page.toggleDeviceCard();
  assert.equal(page.data.deviceOpen, true);
});

test('a finished connection (lock/sleep, disconnect, drop) clears the scan list', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.setData({
    devices: [{ deviceId: 'AA-BB', name: 'Mochen CalCal', RSSI: -60 }],
    hasScanned: true,
  });

  page.emitState({ connected: true, connecting: false, scanning: false, adapterAvailable: true });
  page.emitState({ connected: false, connecting: false, scanning: false, adapterAvailable: true });

  assert.deepEqual(page.data.devices, []);
  assert.equal(page.data.hasScanned, false);
  assert.equal(page.data.deviceOpen, true);
});

test('a failed connect keeps the devices found by the scan', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.setData({
    devices: [{ deviceId: 'AA-BB', name: 'Mochen CalCal', RSSI: -60 }],
    hasScanned: true,
  });

  // Never connected: a connect error must not wipe the list the user is
  // looking at.
  page.emitState({
    connected: false,
    connecting: false,
    scanning: false,
    adapterAvailable: true,
    error: '连接失败',
  });

  assert.equal(page.data.devices.length, 1);
  assert.equal(page.data.hasScanned, true);
  assert.equal(page.data.error, '连接失败');
});

test('the title input stops at 95 bytes instead of 30 characters', () => {
  const page = makePage('2026-11-16');

  page.onTitle({ detail: { value: '长'.repeat(40) } });

  assert.equal(page.data.form.title, '长'.repeat(31));
  assert.equal(page.data.titleBytes, 93);
  assert.equal(page.data.titleLimit, 95);

  page.onTitle({ detail: { value: 'a'.repeat(200) } });
  assert.equal(page.data.form.title.length, 95);
  assert.equal(page.data.titleBytes, 95);
});

test('the note input stops at 191 bytes', () => {
  const page = makePage('2026-11-16');

  page.onNote({ detail: { value: '记'.repeat(80) } });

  assert.equal(page.data.form.note, '记'.repeat(63));
  assert.equal(page.data.noteBytes, 189);
  assert.equal(page.data.noteLimit, 191);
});

test('the pairing dialog starts with an empty field and a placeholder hint', async () => {
  const page = makePage('2026-11-16');

  const pending = page.requestPairingCode({ error: '' });

  assert.equal(page.data.pairingVisible, true);
  assert.equal(page.data.pairingValue, '');
  assert.equal(page.data.pairingError, '');

  page.onPairingInput({ detail: { value: ' k7q4-m2x9-b3tf ' } });
  page.confirmPairing();

  assert.equal(await pending, 'k7q4-m2x9-b3tf');
  assert.equal(page.data.pairingVisible, false);
  assert.equal(page.data.pairingValue, '');
});

test('a failed pairing attempt shows its error outside the input', async () => {
  const page = makePage('2026-11-16');

  page.requestPairingCode({ error: '配对码错误' });

  assert.equal(page.data.pairingError, '配对码错误');
  assert.equal(page.data.pairingValue, '');
  // Typing clears the old error instead of leaving it in the field.
  page.onPairingInput({ detail: { value: 'K7Q4' } });
  assert.equal(page.data.pairingError, '');
});

test('confirming an empty code keeps the dialog open', async () => {
  const page = makePage('2026-11-16');

  page.requestPairingCode({ error: '' });
  page.confirmPairing();

  assert.equal(page.data.pairingVisible, true);
  assert.match(page.data.pairingError, /配对码/);

  page.cancelPairing();
  assert.equal(page.data.pairingVisible, false);
});

test('the Bluetooth banner names the reason and offers the system page', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: false, adapterReason: 'off',
  });

  assert.equal(page.data.adapterHint, '手机蓝牙已关闭，开启后可搜索设备');
  assert.equal(page.data.adapterActionLabel, '去开启');
  // The banner is the only place the adapter failure is explained.
  assert.equal(page.data.error, '');

  page.enableBluetooth();
  assert.equal(page.calls.bluetoothSettings, 1);
  assert.equal(page.calls.wechatSettings, 0);
});

test('a blocked permission on Android points at the app permission page', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: false, adapterReason: 'permission',
  });

  assert.match(page.data.adapterHint, /权限/);
  assert.equal(page.data.adapterActionLabel, '去设置');

  // Android's permission belongs to the WeChat app, so no mini-program page
  // can grant it; the modal has to name the system screen.
  page.enableBluetooth();
  assert.equal(page.calls.modals.length, 1);
  assert.match(page.calls.modals[0].content, /附近的设备/);
  assert.equal(page.calls.wechatSettings, 0);
});

test('a blocked permission on iOS reopens WeChat authorization', () => {
  const page = makePage('2026-11-16', { android: false });
  page.onLoad();
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: false, adapterReason: 'permission',
  });

  page.enableBluetooth();
  assert.equal(page.calls.wechatSettings, 1);
  assert.equal(page.calls.modals.length, 0);
});

test('a privacy or unsupported failure has no button to press', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: false, adapterReason: 'privacy',
  });

  assert.match(page.data.adapterHint, /隐私保护指引/);
  assert.equal(page.data.adapterActionLabel, '');
});

test('an iOS phone without a deep link shows the Control Center steps', () => {
  const page = makePage('2026-11-16', { android: false });
  page.onLoad();
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: false, adapterReason: 'off',
  });

  assert.equal(page.data.adapterActionLabel, '如何开启');

  page.enableBluetooth();
  assert.equal(page.calls.modals.length, 1);
  assert.match(page.calls.modals[0].content, /控制中心/);
});

test('the iOS help dialog can retry once Bluetooth is back on', async () => {
  const page = makePage('2026-11-16', { android: false, retryReady: false });
  page.onLoad();
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: false, adapterReason: 'off',
  });

  page.enableBluetooth();
  const modal = page.calls.modals[0];
  assert.equal(modal.confirmText, '已开启，重试');

  modal.success({ confirm: true });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(page.calls.retries, 1);
  assert.match(page.calls.toasts[0].title, /还没有检测到蓝牙/);
});

test('flipping the switch while in settings confirms the recovery', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: false, adapterReason: 'off',
  });

  // The app-show probe in utils/ble.js reports the adapter as usable again.
  page.emitState({
    connected: false, connecting: false, scanning: false,
    adapterAvailable: true, adapterReason: '',
  });

  assert.equal(page.calls.toasts.length, 1);
  assert.equal(page.calls.toasts[0].title, '蓝牙已开启');
  assert.equal(page.data.adapterAvailable, true);
});

test('sync asks for confirmation before it starts', () => {
  const page = makePage('2026-11-16');
  page.onLoad();

  page.refresh();

  assert.equal(page.calls.modals.length, 1);
  assert.equal(page.calls.modals[0].title, '同步日程');
  assert.equal(page.calls.modals[0].confirmText, '同步');
  assert.equal(page.calls.toasts.length, 0);
});

test('disconnect asks for confirmation and only drops the link on confirm', () => {
  const page = makePage('2026-11-16');
  page.onLoad();
  page.emitState({ connected: true, connecting: false, scanning: false, adapterAvailable: true });

  page.disconnect();
  assert.equal(page.calls.modals.length, 1);
  assert.equal(page.calls.modals[0].title, '断开设备');
  assert.equal(page.calls.disconnects, 0);

  page.calls.modals[0].success({ confirm: false });
  assert.equal(page.calls.disconnects, 0);

  page.calls.modals[0].success({ confirm: true });
  assert.equal(page.calls.disconnects, 1);
});
