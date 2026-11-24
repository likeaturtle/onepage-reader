'use strict';

/**
 * Guest mode at the module boundary: the local session must be enough to make
 * every page work, while utils/api.js answers from utils/sample.js and never
 * lets a request reach wx.request.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
let requests = 0;

global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  request() {
    requests += 1;
    throw new Error('guest mode must not call wx.request');
  },
};

const auth = require('../utils/auth');
const api = require('../utils/api');
const sample = require('../utils/sample');
const fmt = require('../utils/format');

test.beforeEach(() => {
  auth.clear();
  requests = 0;
});

test('a guest session is accepted without a token', () => {
  const session = auth.startGuest();

  assert.equal(session.guest, true);
  assert.equal(session.token, '');
  assert.equal(session.user.nickname, '游客');
  assert.equal(auth.isGuest(), true);
  assert.equal(auth.getToken(), '');
  assert.ok(auth.get());
});

test('a real login replaces the guest session', () => {
  auth.startGuest();
  auth.save({ token: 'token-1', user: { id: 'user-1' } });

  assert.equal(auth.isGuest(), false);
  assert.equal(auth.getToken(), 'token-1');
  assert.equal(auth.getUser().id, 'user-1');
});

test('guest events are the in-window samples and never hit the network', async () => {
  auth.startGuest();
  const today = fmt.ymd(new Date());

  const events = await api.events({ from: today, to: today });

  assert.ok(events.length >= 1);
  for (const event of events) {
    assert.equal(event.date, today);
    assert.match(event.id, /^sample-/);
    assert.equal(event.deviceId, null);
    assert.equal(event.sample, true);
  }
  assert.equal(requests, 0);
});

test('guest recognition and parsing return canned content only', async () => {
  auth.startGuest();

  const recognized = await api.transcribe('base64-audio', {
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
  });
  assert.equal(typeof recognized.text, 'string');
  assert.ok(recognized.text.length > 0);
  assert.equal(recognized.sample, true);

  const draft = await api.parseSchedule('随便说点什么');
  assert.equal(draft.title, '项目评审');
  assert.equal(draft.start, '15:00');
  assert.equal(draft.end, '15:30');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(draft.date, fmt.ymd(tomorrow));
  assert.equal(requests, 0);
});

test('guest profile and devices describe a local-only user', async () => {
  auth.startGuest();

  assert.deepEqual(await api.me(), {
    user: { id: 'guest', nickname: '游客', guest: true },
  });
  assert.deepEqual(await api.devices(), { devices: [] });
  assert.equal(await api.logout(), null);
  assert.equal(requests, 0);
});

test('every write path is refused in guest mode', async () => {
  auth.startGuest();

  const writes = [
    () => api.updateMe('昵称'),
    () => api.uploadAvatar('data:image/png;base64,AAAA'),
    () => api.createEvent({ date: '2026-11-19', title: 'x' }),
    () => api.updateEvent('sample-1', { title: 'x' }),
    () => api.deleteEvent('sample-1'),
    () => api.claimDevice('did', 'name', 'pid'),
    () => api.unbindDevice('did'),
    () => api.mapDevice('sample-1', 1),
    () => api.purgeEvent('sample-1'),
  ];

  for (const write of writes) {
    await assert.rejects(write, /游客模式仅可查看样例数据/);
  }
  assert.equal(requests, 0);
});

test('the sample month is populated around today', () => {
  const today = new Date();
  const events = sample.events();
  const month = fmt.ymd(today).slice(0, 7);
  const currentMonth = events.filter((event) => event.date.slice(0, 7) === month);

  assert.ok(currentMonth.length >= 2);
  assert.ok(events.some((event) => event.date < fmt.ymd(today)));
  assert.ok(events.some((event) => event.date > fmt.ymd(today)));
});
