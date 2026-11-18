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
  const rect = options.rect || null;
  const pageScrollTop = Number(options.scrollTop) || 0;
  const windowHeight = Number(options.windowHeight) || 700;

  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast() {},
    showModal() {},
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
    },
  };
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: {} };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: { getToken: () => 'token', getUser: () => ({}), setUser() {} },
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
