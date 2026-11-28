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
const deviceSyncPath = require.resolve('../utils/device-sync');
const fmt = require('../utils/format');

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makePage(options = {}) {
  let definition = null;
  const calls = {
    events: [],
    updated: [],
    deleted: [],
    purged: [],
    mapped: [],
    deviceDeleted: [],
    deviceUpdated: [],
    deviceAdded: [],
  };
  const toasts = [];
  const events = options.events || [];
  const scrollCalls = [];
  const queries = [];
  const rects = options.rects || {};

  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast(opts) { toasts.push(opts.title); },
    showModal(opts) {
      if (opts.success) opts.success({ confirm: true, cancel: false });
    },
    reLaunch() {},
    getWindowInfo: () => ({ windowHeight: Number(options.windowHeight) || 700 }),
    pageScrollTo: (opts) => scrollCalls.push(opts),
    createSelectorQuery() {
      let found = null;
      let view = null;
      return {
        select(selector) {
          return {
            boundingClientRect() {
              found = rects[selector] || null;
              queries.push(selector);
              return this;
            },
          };
        },
        selectViewport() {
          return {
            scrollOffset() {
              view = { scrollTop: Number(options.scrollTop) || 0 };
              return this;
            },
          };
        },
        exec(callback) { callback([found, view]); },
      };
    },
  };

  require.cache[blePath] = {
    id: blePath,
    filename: blePath,
    loaded: true,
    exports: {
      isConnected: () => Boolean(options.connected),
      update: (id, event) => {
        calls.deviceUpdated.push({ id, event });
        return Promise.resolve({ ok: true, cmd: 'update', id });
      },
      del: (id) => {
        calls.deviceDeleted.push(id);
        return Promise.resolve({ ok: true });
      },
      add: (event) => {
        calls.deviceAdded.push(event);
        return Promise.resolve({ ok: true, cmd: 'add', id: 99 });
      },
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
      updateEvent: (id, data) => {
        calls.updated.push({ id, data });
        const target = events.find((event) => event.id === id);
        if (target) Object.assign(target, data);
        return Promise.resolve(Object.assign({}, target, { id, deviceId: target ? target.deviceId : null }));
      },
      deleteEvent: (id) => { calls.deleted.push(id); return Promise.resolve({ ok: true }); },
      purgeEvent: (id) => { calls.purged.push(id); return Promise.resolve({ ok: true }); },
      mapDevice: (id, deviceId) => {
        calls.mapped.push({ id, deviceId });
        return Promise.resolve({ id, deviceId });
      },
    },
  };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      get: () => ({ token: 'token', user: {} }),
      getToken: () => 'token',
      isLoggedIn: () => true,
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
  page.calls = calls;
  page.toasts = toasts;
  page.scrollCalls = scrollCalls;
  page.queries = queries;
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

test('editing an event updates the cloud and the same device id', async () => {
  const todayText = today();
  const page = makePage({
    connected: true,
    events: [{ id: 'e1', date: todayText, start: '09:00', end: '09:30', title: 'A', note: '', deviceId: 7 }],
  });
  page.onLoad();
  await page.onShow();

  page.edit({ currentTarget: { dataset: { id: 'e1' } } });
  assert.equal(page.data.editorOpen, true);
  assert.equal(page.data.editor.title, 'A');
  assert.equal(page.data.editorTitleBytes, 1);

  page.onEditorTitle({ detail: { value: '改后的标题' } });
  page.onEditorNote({ detail: { value: '新备注' } });
  page.onEditorStart({ detail: { value: '10:00' } });
  assert.equal(page.data.editor.end, '10:30');

  await page.saveEditor();

  assert.deepEqual(page.calls.updated, [{
    id: 'e1',
    data: { date: todayText, start: '10:00', end: '10:30', title: '改后的标题', note: '新备注' },
  }]);
  assert.equal(page.calls.deviceUpdated.length, 1);
  assert.equal(page.calls.deviceUpdated[0].id, 7);
  assert.equal(page.calls.deviceUpdated[0].event.title, '改后的标题');
  assert.equal(page.calls.deviceDeleted.length, 0);
  assert.equal(page.data.editorOpen, false);
  assert.equal(page.calls.events.length, 2); // first load plus the reload
  assert.equal(page.data.groups[0].items[0].title, '改后的标题');
  assert.ok(page.toasts.includes('已保存并同步到设备'));
});

test('an offline edit only writes the cloud and syncs on the next connect', async () => {
  const todayText = today();
  const page = makePage({
    connected: false,
    events: [{ id: 'e2', date: todayText, start: '09:00', end: '09:30', title: 'A', note: '', deviceId: 7 }],
  });
  page.onLoad();
  await page.onShow();

  page.edit({ currentTarget: { dataset: { id: 'e2' } } });
  page.onEditorTitle({ detail: { value: '离线改' } });
  await page.saveEditor();

  assert.deepEqual(page.calls.updated.map((item) => item.id), ['e2']);
  assert.equal(page.calls.deviceUpdated.length, 0);
  assert.equal(page.calls.deviceDeleted.length, 0);
  assert.ok(page.toasts.includes('已保存，连接设备后同步'));
});

test('editing a cloud-only event while connected adds it to the device', async () => {
  const todayText = today();
  const page = makePage({
    connected: true,
    events: [{ id: 'e3', date: todayText, start: '09:00', end: '09:30', title: 'A', note: '', deviceId: null }],
  });
  page.onLoad();
  await page.onShow();

  page.edit({ currentTarget: { dataset: { id: 'e3' } } });
  page.onEditorTitle({ detail: { value: '只存过云端' } });
  await page.saveEditor();

  assert.equal(page.calls.deviceUpdated.length, 0);
  assert.equal(page.calls.deviceAdded.length, 1);
  assert.deepEqual(page.calls.mapped, [{ id: 'e3', deviceId: 99 }]);
  assert.ok(page.toasts.includes('已保存并同步到设备'));
});

test('saving an edit validates the title and the time range', async () => {
  const todayText = today();
  const page = makePage({
    events: [{ id: 'e4', date: todayText, start: '09:00', end: '09:30', title: 'A', note: '', deviceId: null }],
  });
  page.onLoad();
  await page.onShow();

  page.edit({ currentTarget: { dataset: { id: 'e4' } } });
  page.onEditorTitle({ detail: { value: '   ' } });
  await page.saveEditor();
  assert.equal(page.data.editorError, '请填写标题');
  assert.equal(page.calls.updated.length, 0);

  page.onEditorTitle({ detail: { value: 'B' } });
  page.onEditorStart({ detail: { value: '12:00' } });
  page.onEditorEnd({ detail: { value: '11:00' } });
  await page.saveEditor();
  assert.equal(page.data.editorError, '结束时间要晚于开始时间');
  assert.equal(page.calls.updated.length, 0);
});

test('a 24:00 end from the server opens as 23:59 in the native time picker', async () => {
  const todayText = today();
  const page = makePage({
    events: [{ id: 'e5', date: todayText, start: '23:30', end: '24:00', title: '晚场', note: '', deviceId: null }],
  });
  page.onLoad();
  await page.onShow();

  page.edit({ currentTarget: { dataset: { id: 'e5' } } });
  assert.equal(page.data.editor.end, '23:59');
});

test('opening the tab lands on today, not on the first event of the month', async () => {
  const todayText = today();
  const page = makePage({
    events: [
      { id: 'e0', date: '2026-01-01', start: '09:00', end: '09:30', title: '月初', note: '', deviceId: null },
      { id: 'e1', date: todayText, start: '13:00', end: '14:00', title: '今天', note: '', deviceId: null },
    ],
    rects: { [`#day-${todayText}`]: { top: 800, height: 160 } },
    windowHeight: 700,
  });
  page.onLoad();
  await page.onShow();

  assert.deepEqual(page.queries, [`#day-${todayText}`]);
  // 800 px down, anchored 12 px below the top of the page.
  assert.deepEqual(page.scrollCalls, [{ scrollTop: 788, duration: 200 }]);
});

test('a today row already on screen keeps the current scroll position', async () => {
  const todayText = today();
  const page = makePage({
    events: [{ id: 'e1', date: todayText, start: '13:00', end: '14:00', title: '今天', note: '', deviceId: null }],
    rects: { [`#day-${todayText}`]: { top: 120, height: 160 } },
    scrollTop: 400,
    windowHeight: 700,
  });
  page.onLoad();
  await page.onShow();

  assert.deepEqual(page.scrollCalls, []);
});

test('a blank today still gets a section with no items and is revealed', async () => {
  const now = new Date();
  const todayText = fmt.ymd(now);
  const later = fmt.ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  const page = makePage({
    events: [{ id: 'e1', date: later, start: '09:00', end: '09:30', title: '后天', note: '', deviceId: null }],
    rects: { [`#day-${todayText}`]: { top: 800, height: 120 } },
    windowHeight: 700,
  });
  page.onLoad();
  await page.onShow();

  assert.deepEqual(page.data.groups.map((group) => group.date), [todayText, later]);
  const todayGroup = page.data.groups[0];
  assert.equal(todayGroup.today, true);
  assert.deepEqual(todayGroup.items, []);
  assert.equal(page.data.eventCount, 1);
  assert.deepEqual(page.queries, [`#day-${todayText}`]);
  assert.deepEqual(page.scrollCalls, [{ scrollTop: 788, duration: 200 }]);
});

test('an empty current month still lists today with no items', async () => {
  const todayText = today();
  const page = makePage({ events: [] });
  page.onLoad();
  await page.onShow();

  assert.equal(page.data.eventCount, 0);
  assert.deepEqual(page.data.groups.map((group) => group.date), [todayText]);
  assert.equal(page.data.groups[0].today, true);
  assert.deepEqual(page.data.groups[0].items, []);
});

test('reloads after an edit or a month arrow do not move the page', async () => {
  const todayText = today();
  const page = makePage({
    events: [{ id: 'e1', date: todayText, start: '09:00', end: '09:30', title: 'A', note: '', deviceId: null }],
    rects: { [`#day-${todayText}`]: { top: 800, height: 160 } },
    windowHeight: 700,
  });
  page.onLoad();
  await page.onShow();
  page.scrollCalls.length = 0;
  page.queries.length = 0;

  await page.loadMonth();
  assert.deepEqual(page.scrollCalls, []);

  await page.nextMonth();
  assert.deepEqual(page.scrollCalls, []);
  assert.deepEqual(page.queries, []);
});

test('a month boundary crossed in the background moves the tab to the new month', async () => {
  const page = makePage({ events: [] });
  page.onLoad();
  await page.onShow();

  // Pretend the last visit happened in the previous month and the app stayed
  // in the background until today, which is now in another month.
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  page.todayMonth = fmt.ymd(previous);
  page.data.monthCursor = fmt.ymd(previous);
  page.calls.events.length = 0;

  await page.onShow();

  const currentMonth = fmt.ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  assert.equal(page.data.monthCursor, currentMonth);
  assert.deepEqual(page.calls.events[0], fmt.monthBounds(currentMonth));
  assert.deepEqual(page.data.groups.map((group) => group.date), [today()]);
});

test('a month the user browsed to is not pulled back to the current month', async () => {
  const page = makePage({ events: [] });
  page.onLoad();
  await page.onShow();

  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const browsed = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  page.todayMonth = fmt.ymd(previous); // stale current month
  page.data.monthCursor = fmt.ymd(browsed); // the user had navigated here
  page.calls.events.length = 0;

  await page.onShow();

  assert.equal(page.data.monthCursor, fmt.ymd(browsed));
  assert.deepEqual(page.calls.events[0], fmt.monthBounds(fmt.ymd(browsed)));
});
