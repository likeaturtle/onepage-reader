'use strict';

/**
 * Local mode at the module boundary: no login is required, events live in wx
 * storage, and nothing in this path may reach wx.request.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
let requests = 0;

global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
  removeStorageSync: (key) => storage.delete(key),
  request() {
    requests += 1;
    throw new Error('local mode must not call wx.request');
  },
};

const auth = require('../utils/auth');
const local = require('../utils/local-events');

test.beforeEach(() => {
  storage.clear();
  requests = 0;
});

test('no session means local mode, and a login is only valid with a token', () => {
  assert.equal(auth.get(), null);
  assert.equal(auth.isLoggedIn(), false);
  assert.equal(auth.getToken(), '');
  assert.equal(auth.getUser(), null);

  auth.save({ token: 'token-1', user: { id: 'user-1' } });
  assert.equal(auth.isLoggedIn(), true);
  assert.equal(auth.getToken(), 'token-1');
  assert.equal(auth.getUser().id, 'user-1');
  assert.equal(requests, 0);

  auth.clear();
  assert.equal(auth.isLoggedIn(), false);
});

test('an old guest record without a token is ignored', () => {
  storage.set('onepage.session.v1', {
    guest: true,
    token: '',
    user: { id: 'guest', nickname: '游客', guest: true },
  });

  assert.equal(auth.get(), null);
  assert.equal(auth.isLoggedIn(), false);
  assert.equal(auth.getUser(), null);
});

test('created events are stored locally and can be listed by date', () => {
  const first = local.create({
    date: '2026-11-19',
    start: '09:00',
    end: '10:00',
    title: '项目评审',
    note: '会议室 A',
  });
  const second = local.create({
    date: '2026-11-21',
    start: '14:00',
    end: '15:00',
    title: '设计走查',
    note: '',
  });

  assert.match(first.id, /^local-/);
  assert.equal(first.title, '项目评审');
  assert.equal(first.deviceId, null);
  assert.equal(requests, 0);

  const all = local.all();
  assert.deepEqual(all.map((event) => event.id), [first.id, second.id]);
  assert.deepEqual(
    local.list({ from: '2026-11-20', to: '2026-11-30' }).map((event) => event.id),
    [second.id]
  );
});

test('updating keeps the id and deleting removes only that event', () => {
  const event = local.create({
    date: '2026-11-19',
    start: '09:00',
    end: '10:00',
    title: '旧标题',
    note: '',
  });

  const updated = local.update(event.id, { title: '新标题', start: '11:00', end: '12:00' });
  assert.equal(updated.id, event.id);
  assert.equal(updated.title, '新标题');
  assert.equal(updated.start, '11:00');
  assert.equal(local.list().length, 1);

  assert.equal(local.remove(event.id), true);
  assert.equal(local.list().length, 0);
  assert.equal(local.remove(event.id), false);
  assert.equal(requests, 0);
});

test('events survive a fresh module load after an app restart', () => {
  local.create({
    date: '2026-11-19',
    start: '09:00',
    end: '10:00',
    title: '项目评审',
    note: '',
  });

  const modulePath = require.resolve('../utils/local-events');
  delete require.cache[modulePath];
  const reloaded = require('../utils/local-events');

  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].title, '项目评审');
  assert.equal(requests, 0);
});

test('a failed storage write surfaces a readable error', () => {
  const original = global.wx.setStorageSync;
  global.wx.setStorageSync = () => { throw new Error('quota exceeded'); };

  assert.throws(
    () => local.create({ date: '2026-11-19', start: '09:00', end: '10:00', title: 'A' }),
    /本机存储空间不足/
  );

  global.wx.setStorageSync = original;
});
