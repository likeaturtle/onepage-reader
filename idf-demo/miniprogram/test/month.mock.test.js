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
      isGuest: () => false,
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
