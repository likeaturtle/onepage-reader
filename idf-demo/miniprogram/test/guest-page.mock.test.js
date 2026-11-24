'use strict';

/**
 * Page-level guest mode. auth is a local guest session and the real
 * utils/api.js is used, so these tests also prove no page reaches wx.request
 * while the sample data flows through the normal code paths.
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

const tick = () => new Promise((resolve) => setImmediate(resolve));

function moduleCache(target, exports) {
  require.cache[target] = { id: target, filename: target, loaded: true, exports };
}

function freshCaches() {
  for (const target of [
    indexPath, calendarPath, loginPath, profilePath,
    blePath, apiPath, authPath, voicePath, deviceSyncPath,
  ]) {
    delete require.cache[target];
  }
}

function guestAuth() {
  const calls = { cleared: 0 };
  const session = { guest: true, user: { id: 'guest', nickname: '游客' } };
  moduleCache(authPath, {
    get: () => session,
    getUser: () => session.user,
    getToken: () => '',
    isGuest: () => true,
    setUser() {},
    clear() { calls.cleared += 1; },
  });
  return calls;
}

function fakeCalls() {
  return {
    toasts: [],
    modals: [],
    relaunches: [],
    switches: [],
    scans: 0,
    disconnects: 0,
    requests: 0,
  };
}

function fakeWx(calls) {
  return {
    showToast: (opts) => calls.toasts.push(opts.title || ''),
    showModal: (opts) => calls.modals.push(opts),
    reLaunch: (opts) => calls.relaunches.push(opts.url),
    switchTab: (opts) => calls.switches.push(opts.url),
    getWindowInfo: () => ({ windowHeight: 700 }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop', version: '' } }),
    pageScrollTo() {},
    request() {
      calls.requests += 1;
      throw new Error('guest mode must not reach wx.request');
    },
  };
}

function fakeBle(calls) {
  return {
    onState: () => () => {},
    onMessage: () => () => {},
    isConnected: () => false,
    startScan() { calls.scans += 1; return Promise.resolve(); },
    stopScan: () => Promise.resolve(),
    canOpenBluetoothSettings: () => false,
    disconnect() { calls.disconnects += 1; return Promise.resolve(); },
    sleep: () => Promise.resolve(),
    hello: () => Promise.resolve(null),
  };
}

function instantiate(definition) {
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
  return page;
}

function loadPage(target) {
  let definition = null;
  global.Page = (value) => { definition = value; };
  require(target);
  return instantiate(definition);
}

test('the login page starts a guest session from the entry under WeChat login', () => {
  freshCaches();
  const calls = fakeCalls();
  const authCalls = { started: 0 };
  global.wx = fakeWx(calls);
  global.getApp = () => ({ globalData: {} });
  moduleCache(authPath, {
    startGuest() {
      authCalls.started += 1;
      return { user: { id: 'guest', nickname: '游客' } };
    },
    getToken: () => '',
  });
  moduleCache(apiPath, {});

  const page = loadPage(loginPath);
  page.onLoad();

  // The printed month has 4-6 weeks, only current-month numbers, and one
  // today mark.
  const weeks = page.data.monthWeeks;
  assert.ok(weeks.length >= 4 && weeks.length <= 6);
  assert.equal(page.data.weekdays.length, 7);
  const days = weeks.reduce((all, week) => all.concat(week.cells), []);
  assert.ok(days.every((cell) => cell.day === '' || (cell.day >= 1 && cell.day <= 31)));
  const todayCells = days.filter((cell) => cell.today);
  assert.equal(todayCells.length, 1);
  assert.equal(todayCells[0].day, Number(page.data.today.day));

  page.guestMode();

  assert.equal(authCalls.started, 1);
  assert.deepEqual(calls.switches, ['/pages/calendar/calendar']);
});

test('the index page reads samples, blocks device/save, and fakes the voice text', async () => {
  freshCaches();
  const calls = fakeCalls();
  guestAuth();
  global.wx = fakeWx(calls);
  moduleCache(blePath, fakeBle(calls));
  const recorder = { start: () => Promise.resolve(), stop() {}, cancel() {}, dispose() {} };
  moduleCache(voicePath, {
    createRecorder: () => recorder,
    ensurePermission: () => Promise.resolve(),
  });

  const page = loadPage(indexPath);
  page.onLoad();
  assert.equal(page.data.guest, true);

  page.onShow();
  assert.deepEqual(calls.relaunches, []);
  assert.equal(page.data.guest, true);

  const saved = await page.saveForm({
    date: '2026-11-19', start: '09:00', end: '10:00', title: '手动标题', note: '',
  });
  assert.equal(saved, false);
  assert.equal(await page.submit(), false);
  assert.deepEqual(calls.toasts, [
    '游客模式仅可查看样例数据',
    '游客模式仅可查看样例数据',
  ]);

  page.startScan();
  assert.equal(calls.scans, 0);
  assert.match(calls.toasts[2], /游客模式/);

  // Holding/releasing never opens the microphone; it fills the sample text.
  page.startVoice();
  assert.equal(page.data.voiceRecording, true);
  assert.match(page.data.voiceStatus, /样例/);
  page.stopVoice();
  assert.equal(page.data.voiceRecording, false);
  assert.ok(page.data.voiceText.length > 0);

  const parsed = await page.confirmVoice();
  assert.equal(parsed, true);
  assert.equal(page.data.form.title, '项目评审');
  assert.match(page.data.voiceStatus, /样例/);
  assert.equal(calls.requests, 0);
});

test('the calendar page lists samples but refuses edit and delete', async () => {
  freshCaches();
  const calls = fakeCalls();
  guestAuth();
  global.wx = fakeWx(calls);
  moduleCache(blePath, fakeBle(calls));

  const page = loadPage(calendarPath);
  page.onLoad();
  assert.equal(page.data.guest, true);

  await page.onShow();
  assert.ok(page.data.groups.length >= 1);
  assert.equal(page.data.eventCount, page.data.groups.reduce(
    (total, group) => total + group.items.length, 0));
  assert.equal(calls.requests, 0);

  const id = page.data.groups[0].items[0].id;
  page.edit({ currentTarget: { dataset: { id } } });
  page.remove({ currentTarget: { dataset: { id } } });
  await page.saveEditor();

  assert.equal(page.data.editorOpen, false);
  assert.equal(calls.modals.length, 0); // no delete confirmation
  assert.equal(calls.toasts.length, 3);
  for (const toast of calls.toasts) assert.match(toast, /游客模式/);
});

test('the profile page exits guest mode without touching the server', async () => {
  freshCaches();
  const calls = fakeCalls();
  const authCalls = guestAuth();
  global.wx = fakeWx(calls);
  moduleCache(blePath, fakeBle(calls));

  const page = loadPage(profilePath);
  page.onShow();

  assert.equal(page.data.guest, true);
  assert.equal(page.data.devicesLoading, false);
  assert.equal(calls.requests, 0);

  page.logout();
  assert.equal(calls.modals.length, 1);
  assert.equal(calls.modals[0].title, '退出游客模式');

  calls.modals[0].success({ confirm: true });
  await tick();
  await tick();

  assert.equal(authCalls.cleared, 1);
  assert.equal(calls.disconnects, 1);
  assert.deepEqual(calls.relaunches, ['/pages/login/login']);
});
