'use strict';

/**
 * Page-level local mode. No session is present, utils/local-events.js is the
 * real store, and the fake api counts calls: every cloud path must stay closed
 * while local create/edit/delete keeps working.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'pages', 'index', 'index.js');
const calendarPath = path.join(__dirname, '..', 'pages', 'calendar', 'calendar.js');
const loginPath = path.join(__dirname, '..', 'pages', 'login', 'login.js');
const profilePath = path.join(__dirname, '..', 'pages', 'profile', 'profile.js');
const blePath = require.resolve('../utils/ble');
const apiPath = require.resolve('../utils/api');
const authPath = require.resolve('../utils/auth');
const voicePath = require.resolve('../utils/voice');
const deviceSyncPath = require.resolve('../utils/device-sync');
const localPath = require.resolve('../utils/local-events');

const storage = new Map();
const tick = () => new Promise((resolve) => setImmediate(resolve));

function moduleCache(target, exports) {
  require.cache[target] = { id: target, filename: target, loaded: true, exports };
}

function freshCaches() {
  for (const target of [
    indexPath, calendarPath, loginPath, profilePath,
    blePath, apiPath, authPath, voicePath, deviceSyncPath, localPath,
  ]) {
    delete require.cache[target];
  }
}

function localAuth() {
  return {
    get: () => null,
    getToken: () => '',
    getUser: () => null,
    isLoggedIn: () => false,
    setUser() {},
    clear() {},
    save() {},
  };
}

function fakeCalls() {
  return {
    toasts: [],
    modals: [],
    relaunches: [],
    switches: [],
    navigates: [],
    backs: 0,
    requests: 0,
    me: 0,
    parse: 0,
    transcribe: 0,
    create: 0,
    claim: 0,
    sync: 0,
    connect: 0,
    deviceAdd: 0,
    voiceStart: 0,
  };
}

function fakeWx(calls) {
  return {
    showToast: (opts) => calls.toasts.push(opts.title || ''),
    showModal: (opts) => {
      calls.modals.push(opts);
      if (opts.success) opts.success({ confirm: true, cancel: false });
    },
    reLaunch: (opts) => calls.relaunches.push(opts.url),
    switchTab: (opts) => calls.switches.push(opts.url),
    navigateTo: (opts) => calls.navigates.push(opts.url),
    navigateBack: () => { calls.backs += 1; },
    getWindowInfo: () => ({ windowHeight: 700 }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop', version: '' } }),
    pageScrollTo() {},
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: (key) => storage.delete(key),
    request() {
      calls.requests += 1;
      throw new Error('local mode must not reach wx.request');
    },
  };
}

function fakeApi(calls, options = {}) {
  return {
    me() { calls.me += 1; return Promise.resolve({ user: {} }); },
    devices() { calls.me += 1; return Promise.resolve({ devices: [] }); },
    events() { calls.me += 1; return Promise.resolve(options.events || []); },
    parseSchedule() { calls.parse += 1; return Promise.resolve({}); },
    transcribe() { calls.transcribe += 1; return Promise.resolve({ text: '' }); },
    createEvent() { calls.create += 1; return Promise.resolve({ id: 'cloud-1' }); },
    updateEvent() { calls.create += 1; return Promise.resolve({ id: 'cloud-1' }); },
    deleteEvent() { calls.create += 1; return Promise.resolve({}); },
    claimDevice() { calls.claim += 1; return Promise.resolve({ device: {} }); },
  };
}

function fakeBle(calls) {
  return {
    onState: () => () => {},
    onMessage: () => () => {},
    isConnected: () => false,
    startScan: () => { calls.sync += 1; return Promise.resolve(); },
    stopScan: () => Promise.resolve(),
    canOpenBluetoothSettings: () => false,
    connect: () => {
      calls.connect += 1;
      return Promise.resolve({
        ev: 'hello',
        proto: 3,
        fw: '1.2.0',
        name: '墨程CalCal',
        pid: 'A1B2C3D4E5F6',
        did: '0123456789abcdef0123456789abcdef',
      });
    },
    disconnect: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    add: () => { calls.deviceAdd += 1; return Promise.resolve({ id: 1 }); },
    hello: () => Promise.resolve(null),
    sleep: () => Promise.resolve(),
  };
}

function instantiate(definition) {
  return Object.assign({}, definition, {
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
}

function loadPage(target) {
  let definition = null;
  global.Page = (value) => { definition = value; };
  require(target);
  return instantiate(definition);
}

test.beforeEach(() => {
  freshCaches();
  storage.clear();
});

test('the 添加 page works locally: no redirect, voice locked, save stays on the phone', async () => {
  const calls = fakeCalls();
  global.wx = fakeWx(calls);
  moduleCache(authPath, localAuth());
  moduleCache(apiPath, fakeApi(calls));
  moduleCache(blePath, fakeBle(calls));
  moduleCache(voicePath, {
    createRecorder: () => ({
      start() { calls.voiceStart += 1; return Promise.resolve(); },
      stop() {},
      cancel() {},
      dispose() {},
    }),
    ensurePermission: () => Promise.resolve(),
  });

  const page = loadPage(indexPath);
  page.onLoad();
  assert.equal(page.data.loggedIn, false);
  assert.match(page.data.voiceStatus, /登录后/);

  page.onShow();
  assert.deepEqual(calls.relaunches, []);
  assert.equal(calls.me, 0);

  page.startVoice();
  assert.equal(calls.voiceStart, 0);
  assert.equal(page.data.voiceRecording, false);
  assert.match(calls.toasts[calls.toasts.length - 1], /登录后/);

  const parsed = await page.confirmVoice();
  assert.equal(parsed, false);
  assert.equal(calls.parse, 0);

  const saved = await page.saveForm({
    date: '2026-11-19', start: '09:00', end: '10:00', title: '本机标题', note: '备注',
  });
  assert.equal(saved, true);
  assert.equal(calls.create, 0);
  assert.equal(page.data.busy, false);
  assert.ok(calls.toasts.includes('已保存到本机'));

  const local = require('../utils/local-events');
  const events = local.list();
  assert.equal(events.length, 1);
  assert.equal(events[0].title, '本机标题');
  assert.match(events[0].id, /^local-/);
  assert.equal(calls.requests, 0);
});

test('connecting a board in local mode keeps BLE but skips claim and sync', async () => {
  const calls = fakeCalls();
  global.wx = fakeWx(calls);
  moduleCache(authPath, localAuth());
  moduleCache(apiPath, fakeApi(calls));
  moduleCache(blePath, fakeBle(calls));
  moduleCache(voicePath, {
    createRecorder: () => ({ start: () => Promise.resolve(), stop() {}, cancel() {}, dispose() {} }),
    ensurePermission: () => Promise.resolve(),
  });

  const page = loadPage(indexPath);
  page.onLoad();
  await page.connect({ currentTarget: { dataset: { id: 'device-1' } } });
  await tick();

  assert.equal(calls.connect, 1);
  assert.equal(calls.claim, 0);
  assert.equal(calls.create, 0);
  assert.equal(calls.deviceAdd, 0);
  assert.equal(page.data.hello.name, '墨程CalCal');
  assert.ok(calls.toasts.includes('已连接（未登录，不同步日程）'));
  assert.equal(calls.requests, 0);
});

test('the 日程 page lists, edits and deletes local events without touching the cloud', async () => {
  const calls = fakeCalls();
  global.wx = fakeWx(calls);
  moduleCache(authPath, localAuth());
  moduleCache(apiPath, fakeApi(calls));
  moduleCache(blePath, fakeBle(calls));

  const local = require('../utils/local-events');
  const event = local.create({
    date: '2026-11-19', start: '09:00', end: '10:00', title: '旧标题', note: '',
  });

  const page = loadPage(calendarPath);
  page.onLoad();
  await page.onShow();

  assert.equal(page.data.loggedIn, false);
  assert.equal(page.data.eventCount, 1);
  assert.equal(page.data.groups.length, 1);
  assert.equal(calls.me + calls.create, 0);

  page.edit({ currentTarget: { dataset: { id: event.id } } });
  assert.equal(page.data.editorOpen, true);
  page.onEditorTitle({ detail: { value: '改后的本机标题' } });
  await page.saveEditor();

  assert.equal(page.data.editorOpen, false);
  assert.ok(calls.toasts.includes('已保存到本机'));
  assert.equal(local.list()[0].title, '改后的本机标题');
  assert.equal(calls.create, 0);

  page.remove({ currentTarget: { dataset: { id: event.id } } });
  await tick();

  assert.match(calls.modals[0].content, /只保存在本机/);
  assert.ok(calls.toasts.includes('已从本机删除'));
  assert.equal(local.list().length, 0);
  assert.equal(calls.create, 0);
  assert.equal(calls.requests, 0);
});

test('a logged-in 日程 page keeps local events visible and edits them locally', async () => {
  const calls = fakeCalls();
  global.wx = fakeWx(calls);
  moduleCache(authPath, Object.assign(localAuth(), {
    get: () => ({ token: 'token', user: { id: 'u1' } }),
    getToken: () => 'token',
    getUser: () => ({ id: 'u1' }),
    isLoggedIn: () => true,
  }));
  moduleCache(apiPath, fakeApi(calls, {
    events: [{
      id: 'cloud-1', date: '2026-11-19', start: '08:00', end: '08:30',
      title: '云端日程', note: '', deviceId: null,
    }],
  }));
  moduleCache(blePath, fakeBle(calls));

  const local = require('../utils/local-events');
  const event = local.create({
    date: '2026-11-19', start: '09:00', end: '10:00', title: '本机标题', note: '',
  });

  const page = loadPage(calendarPath);
  page.onLoad();
  await page.onShow();

  assert.equal(page.data.loggedIn, true);
  assert.equal(page.data.eventCount, 2);
  assert.equal(page.data.localCount, 1);
  assert.ok(page.data.groups[0].items.some((item) => item.local === true));

  page.edit({ currentTarget: { dataset: { id: event.id } } });
  page.onEditorTitle({ detail: { value: '本机改后' } });
  await page.saveEditor();

  assert.equal(calls.create, 0); // no cloud update
  assert.equal(calls.me, 2); // the month read, then the reload after the local edit
  assert.equal(local.list()[0].title, '本机改后');
  assert.ok(calls.toasts.includes('已保存到本机'));
});

test('the 我的 page offers login and never calls the server while logged out', () => {
  const calls = fakeCalls();
  global.wx = fakeWx(calls);
  moduleCache(authPath, localAuth());
  moduleCache(apiPath, fakeApi(calls));
  moduleCache(blePath, fakeBle(calls));

  const page = loadPage(profilePath);
  page.onShow();

  assert.equal(page.data.loggedIn, false);
  assert.equal(page.data.devicesLoading, false);
  assert.equal(calls.me, 0);
  assert.equal(calls.requests, 0);

  page.logout(); // the bottom action is the login entry while logged out
  assert.deepEqual(calls.navigates, ['/pages/login/login']);
});

test('the login page has no guest entry and can go back without logging in', () => {
  const calls = fakeCalls();
  global.wx = fakeWx(calls);
  global.getCurrentPages = () => [];
  moduleCache(authPath, Object.assign(localAuth(), { getToken: () => '' }));
  moduleCache(apiPath, fakeApi(calls));

  const page = loadPage(loginPath);
  assert.equal(page.guestMode, undefined);

  page.onLoad();
  assert.deepEqual(calls.switches, []);
  assert.ok(page.data.monthWeeks.length >= 4);

  page.goBack();
  assert.deepEqual(calls.switches, ['/pages/index/index']);
  assert.equal(calls.requests, 0);
});
