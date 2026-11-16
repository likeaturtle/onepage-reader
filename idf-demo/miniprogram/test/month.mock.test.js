'use strict';

/**
 * Unit tests for the 日程 tab (pages/calendar/calendar.js): the month list that
 * moved out of the 添加 page, its month navigation and its delete action.
 * Loaded with fake api/ble/auth modules, so this runs without a WeChat runtime.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'pages', 'calendar', 'calendar.js');
const blePath = require.resolve('../utils/ble');
const apiPath = require.resolve('../utils/api');
const authPath = require.resolve('../utils/auth');
const fmt = require('../utils/format');

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makePage(options = {}) {
  let definition = null;
  const calls = { events: [], deleted: [], purged: [], deviceDeleted: [] };
  const toasts = [];
  const events = options.events || [];

  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast(opts) { toasts.push(opts.title); },
    showModal(opts) {
      if (opts.success) opts.success({ confirm: true, cancel: false });
    },
    reLaunch() {},
  };

  require.cache[blePath] = {
    id: blePath,
    filename: blePath,
    loaded: true,
    exports: {
      isConnected: () => Boolean(options.connected),
      del: (id) => {
        calls.deviceDeleted.push(id);
        return Promise.resolve({ ok: true });
      },
      add: () => Promise.reject(new Error('not used')),
    },
  };
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      events: (query) => {
        calls.events.push(query);
        return Promise.resolve(events);
      },
      deleteEvent: (id) => { calls.deleted.push(id); return Promise.resolve({ ok: true }); },
      purgeEvent: (id) => { calls.purged.push(id); return Promise.resolve({ ok: true }); },
    },
  };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: { getToken: () => 'token' },
  };

  delete require.cache[pagePath];
  require(pagePath);

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === 'function') callback();
    },
  });
  page.calls = calls;
  page.toasts = toasts;
  return page;
}

function today() {
  return fmt.ymd(new Date());
}

test('the month page loads the current month when shown', async () => {
  const todayText = today();
  const page = makePage({
    events: [
      { id: 'e1', date: todayText, start: '09:00', end: '09:30', title: '项目评审', note: '', deviceId: null },
      { id: 'e2', date: todayText, start: '13:00', end: '14:00', title: '牙医复诊', note: '带病历', deviceId: null },
    ],
  });
  page.onLoad();
  const now = new Date();
  assert.equal(page.data.monthLabel, `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`);

  await page.onShow();

  const bounds = fmt.monthBounds(todayText);
  assert.deepEqual(page.calls.events, [bounds]);
  assert.equal(page.data.eventCount, 2);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.groups.length, 1);
  assert.equal(page.data.groups[0].items.length, 2);
});

test('the month arrows load the neighbouring month', async () => {
  const page = makePage({ events: [] });
  page.onLoad();
  await page.onShow();
  const startLabel = page.data.monthLabel;

  await page.prevMonth();
  assert.notEqual(page.data.monthLabel, startLabel);
  assert.equal(page.calls.events.length, 2);
  const previous = fmt.parseYmd(page.data.monthCursor);
  assert.deepEqual(page.calls.events[1], fmt.monthBounds(page.data.monthCursor));
  assert.equal(previous.getDate(), 1);

  await page.nextMonth();
  assert.equal(page.data.monthLabel, startLabel);
});

test('deleting an event changes the cloud and reloads the month', async () => {
  const todayText = today();
  const page = makePage({
    events: [{ id: 'e1', date: todayText, start: '09:00', end: '09:30', title: 'A', note: '', deviceId: null }],
  });
  page.onLoad();
  await page.onShow();

  page.remove({ currentTarget: { dataset: { id: 'e1' } } });
  await tick();

  assert.deepEqual(page.calls.deleted, ['e1']);
  assert.deepEqual(page.calls.purged, ['e1']);
  assert.equal(page.calls.events.length, 2); // the first load plus the reload
  assert.equal(page.data.busy, false);
  assert.ok(page.toasts.includes('未连蓝牙，已删云端'));
});

test('a connected board also removes the device copy', async () => {
  const todayText = today();
  const page = makePage({
    connected: true,
    events: [{ id: 'e9', date: todayText, start: '09:00', end: '09:30', title: 'A', note: '', deviceId: 7 }],
  });
  page.onLoad();
  await page.onShow();

  page.remove({ currentTarget: { dataset: { id: 'e9' } } });
  await tick();

  assert.deepEqual(page.calls.deviceDeleted, [7]);
  assert.deepEqual(page.calls.purged, ['e9']);
  assert.ok(page.toasts.includes('已删除'));
});
