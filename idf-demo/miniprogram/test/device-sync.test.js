'use strict';

/**
 * Unit tests for utils/device-sync.js: pushing a cloud edit to the board with
 * the proto 2 `update` command, and the legacy delete + add fallback.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const blePath = require.resolve('../utils/ble');
const apiPath = require.resolve('../utils/api');
const syncPath = require.resolve('../utils/device-sync');

function load(ble, api) {
  require.cache[blePath] = { id: blePath, filename: blePath, loaded: true, exports: ble };
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: api };
  delete require.cache[syncPath];
  return require(syncPath);
}

function event() {
  return { id: 'c1', date: '2026-11-20', start: '09:00', end: '10:00', title: 'A', note: '', deviceId: 7 };
}

test('a proto 2 board gets one update command and keeps its id', async () => {
  const calls = [];
  const ack = await load({
    update: async (id, payload) => {
      calls.push({ update: id, title: payload.title });
      return { ok: true, cmd: 'update', id };
    },
    del: async () => { throw new Error('del must not run'); },
    add: async () => { throw new Error('add must not run'); },
  }, {
    mapDevice: async () => { throw new Error('map must not run'); },
  }).pushUpdate(event());

  assert.deepEqual(calls, [{ update: 7, title: 'A' }]);
  assert.equal(ack.id, 7);
});

test('unknown cmd (legacy firmware) replaces the copy and remaps the id', async () => {
  const calls = [];
  const mapped = [];
  const target = event();
  const ack = await load({
    update: async () => { throw new Error('unknown cmd'); },
    del: async (id) => { calls.push(['del', id]); return { ok: true }; },
    add: async () => { calls.push(['add', target.title]); return { ok: true, cmd: 'add', id: 200 }; },
  }, {
    mapDevice: async (id, deviceId) => {
      mapped.push({ id, deviceId });
      return { id, deviceId };
    },
  }).pushUpdate(target);

  assert.deepEqual(calls, [['del', 7], ['add', 'A']]);
  assert.deepEqual(mapped, [{ id: 'c1', deviceId: 200 }]);
  assert.equal(target.deviceId, 200);
  assert.equal(ack.id, 200);
});

test('not found re-adds the event and remaps it', async () => {
  const mapped = [];
  const target = event();
  const ack = await load({
    update: async () => { throw new Error('not found'); },
    del: async () => { throw new Error('del must not run'); },
    add: async () => ({ ok: true, cmd: 'add', id: 201 }),
  }, {
    mapDevice: async (id, deviceId) => {
      mapped.push({ id, deviceId });
      return { id, deviceId };
    },
  }).pushUpdate(target);

  assert.equal(ack.id, 201);
  assert.deepEqual(mapped, [{ id: 'c1', deviceId: 201 }]);
  assert.equal(target.deviceId, 201);
});

test('other device errors are surfaced without touching the device copy', async () => {
  const calls = [];
  await assert.rejects(
    load({
      update: async () => { throw new Error('save failed'); },
      del: async () => { calls.push('del'); },
      add: async () => { calls.push('add'); },
    }, {
      mapDevice: async () => {},
    }).pushUpdate(event()),
    /save failed/
  );
  assert.deepEqual(calls, []);
});

test('a failed legacy re-add clears the stale mapping', async () => {
  const mapped = [];
  const target = event();
  await assert.rejects(
    load({
      update: async () => { throw new Error('unknown cmd'); },
      del: async () => ({ ok: true }),
      add: async () => { throw new Error('calendar full'); },
    }, {
      mapDevice: async (id, deviceId) => { mapped.push({ id, deviceId }); },
    }).pushUpdate(target),
    /calendar full/
  );
  assert.deepEqual(mapped, [{ id: 'c1', deviceId: null }]);
});

test('an event that never reached the device is left to the next sync', async () => {
  const ack = await load({
    update: async () => { throw new Error('must not run'); },
  }, {}).pushUpdate({ id: 'c1', deviceId: null });
  assert.equal(ack, null);
});
