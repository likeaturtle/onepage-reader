'use strict';

/**
 * Unit tests for the cloud <-> device reconciliation in pages/index/index.js.
 * The page is loaded with fake api/ble/auth modules, so this runs without a
 * WeChat runtime.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'pages', 'index', 'index.js');
const blePath = require.resolve('../utils/ble');
const apiPath = require.resolve('../utils/api');
const authPath = require.resolve('../utils/auth');
const fmt = require('../utils/format');

function today() {
  return fmt.ymd(new Date());
}

function makePage(ble, api, options = {}) {
  let definition = null;
  const modalCalls = [];
  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast() {},
    showModal(opts) {
      modalCalls.push(opts);
      const confirm = options.modalConfirm !== false;
      setTimeout(() => opts.success({ confirm, cancel: !confirm }), 0);
    },
    reLaunch() {},
    switchTab() {},
  };

  require.cache[blePath] = { id: blePath, filename: blePath, loaded: true, exports: ble };
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: api };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      getToken: () => 'token',
      getUser: () => ({ id: 'u1', nickname: '测试' }),
      setUser() {},
    },
  };
  delete require.cache[pagePath];
  require(pagePath);

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  });
  page.modalCalls = modalCalls;
  return page;
}

function fakeBle(deviceEvents) {
  const calls = { add: [], del: [] };
  let nextId = 100;
  return {
    calls,
    isConnected: () => true,
    list: async () => deviceEvents,
    hello: async () => ({ ev: 'hello', name: 'Mochen CalCal' }),
    add: async (event) => {
      calls.add.push(event);
      nextId += 1;
      return { ok: true, id: nextId };
    },
    del: async (id) => {
      calls.del.push(id);
      return { ok: true, id };
    },
  };
}

function fakeApi(cloudEvents) {
  const calls = { create: [], map: [], delete: [], purge: [] };
  return {
    calls,
    events: async () => cloudEvents.map((event) => ({ ...event })),
    createEvent: async (data) => {
      calls.create.push(data);
      return { id: `new-${calls.create.length}`, ...data };
    },
    deleteEvent: async (id) => {
      calls.delete.push(id);
      return { id, deletedAt: new Date().toISOString() };
    },
    mapDevice: async (id, deviceId) => {
      calls.map.push({ id, deviceId });
      return { id, deviceId };
    },
    purgeEvent: async (id) => {
      calls.purge.push(id);
      return { ok: true };
    },
  };
}

test('sync imports device-only events, pushes cloud-only events and applies tombstones', async () => {
  const date = today();
  const cloudEvents = [
    { id: 'c1', date, start: '09:00', end: '10:00', title: 'A', note: '', deviceId: 1, deletedAt: null },
    { id: 'c2', date, start: '11:00', end: '12:00', title: 'B', note: '', deviceId: null, deletedAt: null },
    { id: 'c3', date, start: '13:00', end: '14:00', title: 'C', note: '', deviceId: 2, deletedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const deviceEvents = [
    { id: 1, date, start: '09:00', end: '10:00', title: 'A', note: '' },
    { id: 2, date, start: '13:00', end: '14:00', title: 'C', note: '' },
    { id: 3, date, start: '15:00', end: '16:00', title: 'D', note: 'device only' },
  ];
  const ble = fakeBle(deviceEvents);
  const api = fakeApi(cloudEvents);
  const page = makePage(ble, api);

  await page.syncDevice();

  assert.deepEqual(ble.calls.del, [2]);
  assert.deepEqual(api.calls.purge, ['c3']);
  assert.equal(api.calls.create.length, 1);
  assert.equal(api.calls.create[0].title, 'D');
  assert.equal(api.calls.create[0].deviceId, 3);
  assert.equal(ble.calls.add.length, 1);
  assert.equal(ble.calls.add[0].title, 'B');
  assert.deepEqual(api.calls.map, [{ id: 'c2', deviceId: 101 }]);
  assert.equal(page.data.error, '');
});

test('a device deletion removes the cloud copy when the device still has other events', async () => {
  const date = today();
  const cloudEvents = [
    { id: 'c1', date, start: '09:00', end: '10:00', title: 'A', note: '', deviceId: 1, deletedAt: null },
    { id: 'c2', date, start: '11:00', end: '12:00', title: 'B', note: '', deviceId: 2, deletedAt: null },
  ];
  const deviceEvents = [
    { id: 2, date, start: '11:00', end: '12:00', title: 'B', note: '' },
  ];
  const ble = fakeBle(deviceEvents);
  const api = fakeApi(cloudEvents);
  const page = makePage(ble, api);

  await page.syncDevice();

  assert.equal(page.modalCalls.length, 0);
  assert.deepEqual(api.calls.delete, ['c1']);
  assert.deepEqual(api.calls.purge, ['c1']);
  assert.equal(ble.calls.add.length, 0);
});

test('an empty device is treated as a reset and asks before deleting the cloud', async () => {
  const date = today();
  const cloudEvents = [
    { id: 'c1', date, start: '09:00', end: '10:00', title: 'A', note: '', deviceId: 1, deletedAt: null },
  ];
  const ble = fakeBle([]);
  const api = fakeApi(cloudEvents);
  const page = makePage(ble, api, { modalConfirm: false });

  await page.syncDevice();

  assert.equal(page.modalCalls.length, 1);
  assert.equal(ble.calls.add.length, 1);
  assert.equal(ble.calls.add[0].id, 'c1');
  assert.deepEqual(api.calls.map, [{ id: 'c1', deviceId: 101 }]);
  assert.equal(api.calls.delete.length, 0);
});

test('a bulk deletion with confirmation deletes every missing cloud event', async () => {
  const date = today();
  const cloudEvents = [1, 2, 3, 4].map((n) => ({
    id: `c${n}`, date, start: `0${n}:00`, end: `0${n}:30`, title: `T${n}`, note: '', deviceId: n, deletedAt: null,
  }));
  const deviceEvents = [
    { id: 4, date, start: '04:00', end: '04:30', title: 'T4', note: '' },
  ];
  const ble = fakeBle(deviceEvents);
  const api = fakeApi(cloudEvents);
  const page = makePage(ble, api, { modalConfirm: true });

  await page.syncDevice();

  assert.equal(page.modalCalls.length, 1);
  assert.deepEqual(api.calls.delete.sort(), ['c1', 'c2', 'c3']);
  assert.deepEqual(api.calls.purge.sort(), ['c1', 'c2', 'c3']);
  assert.equal(ble.calls.add.length, 0);
});

test('sync maps a cloud event back to an identical device event instead of duplicating it', async () => {
  const date = today();
  const cloudEvents = [
    { id: 'c1', date, start: '09:00', end: '10:00', title: 'A', note: 'same', deviceId: null, deletedAt: null },
  ];
  const deviceEvents = [
    { id: 7, date, start: '09:00', end: '10:00', title: 'A', note: 'same' },
  ];
  const ble = fakeBle(deviceEvents);
  const api = fakeApi(cloudEvents);
  const page = makePage(ble, api);

  await page.syncDevice();

  assert.deepEqual(api.calls.map, [{ id: 'c1', deviceId: 7 }]);
  assert.equal(api.calls.create.length, 0);
  assert.equal(ble.calls.add.length, 0);
});
