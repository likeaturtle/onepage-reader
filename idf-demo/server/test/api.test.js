'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

function makeConfig(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onepage-server-'));
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    wxAppId: '',
    wxSecret: '',
    allowDevLogin: true,
    sessionSecret: 'test-secret',
    tokenTtlDays: 1,
    maxAvatarBytes: 512 * 1024,
    corsOrigin: '*',
    isProd: false,
    defaultSecret: 'dev-only-secret-change-me',
    ...overrides,
  };
}

async function withServer(config, fn) {
  const server = createApp(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, config);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  }
}

async function json(base, method, url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('health, dev login, profile update and avatar upload', async () => {
  await withServer(makeConfig(), async (base) => {
    const health = await json(base, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.devLogin, true);

    const login = await json(base, 'POST', '/api/login', { dev: true });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
    assert.equal(login.body.user.nickname, '开发测试');
    assert.equal(login.body.user.openid, undefined);

    const me = await json(base, 'GET', '/api/me', undefined, login.body.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, login.body.user.id);

    const patched = await json(base, 'PATCH', '/api/me', { nickname: '小页' }, login.body.token);
    assert.equal(patched.status, 200);
    assert.equal(patched.body.user.nickname, '小页');

    const png = Buffer.alloc(256);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    const uploaded = await json(base, 'POST', '/api/me/avatar', {
      data: `data:image/png;base64,${png.toString('base64')}`,
    }, login.body.token);
    assert.equal(uploaded.status, 200);
    assert.match(uploaded.body.user.avatar, /^\/avatars\/.+\.png$/);

    const image = await fetch(base + uploaded.body.user.avatar);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.ok((await image.arrayBuffer()).byteLength >= 256);
  });
});

test('rejects missing and invalid tokens', async () => {
  await withServer(makeConfig(), async (base) => {
    const missing = await json(base, 'GET', '/api/me');
    assert.equal(missing.status, 401);

    const invalid = await json(base, 'GET', '/api/me', undefined, 'not.a.token');
    assert.equal(invalid.status, 401);

    const forged = await json(base, 'GET', '/api/me', undefined, 'eyJzdWIiOiJ4In0.deadbeef');
    assert.equal(forged.status, 401);
  });
});

test('dev login can be disabled and WeChat login reports missing config', async () => {
  await withServer(makeConfig({ allowDevLogin: false }), async (base) => {
    const dev = await json(base, 'POST', '/api/login', { dev: true });
    assert.equal(dev.status, 403);

    const wx = await json(base, 'POST', '/api/login', { code: 'abc' });
    assert.equal(wx.status, 503);
    assert.match(wx.body.error, /WX_APPID/);
  });
});

test('events are per user, map to a device id, soft delete and purge', async () => {
  await withServer(makeConfig(), async (base) => {
    const login = await json(base, 'POST', '/api/login', { dev: true });
    const token = login.body.token;

    const created = await json(base, 'POST', '/api/events', {
      date: '2026-11-20',
      start: '09:00',
      end: '10:00',
      title: '项目评审',
      note: '会议室 A',
    }, token);
    assert.equal(created.status, 201);
    assert.equal(created.body.event.deviceId, null);
    assert.equal(created.body.event.title, '项目评审');
    const id = created.body.event.id;

    const mapped = await json(base, 'POST', `/api/events/${id}/device`, { deviceId: 7 }, token);
    assert.equal(mapped.status, 200);
    assert.equal(mapped.body.event.deviceId, 7);

    const list = await json(base, 'GET', '/api/events?from=2026-11-01&to=2026-11-30', undefined, token);
    assert.equal(list.status, 200);
    assert.equal(list.body.events.length, 1);

    const removed = await json(base, 'DELETE', `/api/events/${id}`, undefined, token);
    assert.equal(removed.status, 200);
    assert.ok(removed.body.event.deletedAt);

    const active = await json(base, 'GET', '/api/events', undefined, token);
    assert.equal(active.body.events.length, 0);

    const all = await json(base, 'GET', '/api/events?includeDeleted=1', undefined, token);
    assert.equal(all.body.events.length, 1);
    assert.equal(all.body.events[0].deviceId, 7);

    const purged = await json(base, 'POST', `/api/events/${id}/purge`, {}, token);
    assert.equal(purged.status, 200);
    const after = await json(base, 'GET', '/api/events?includeDeleted=1', undefined, token);
    assert.equal(after.body.events.length, 0);
  });
});

test('event validation rejects bad dates and clamps a missing end time', async () => {
  await withServer(makeConfig(), async (base) => {
    const login = await json(base, 'POST', '/api/login', { dev: true });
    const token = login.body.token;

    const bad = await json(base, 'POST', '/api/events', {
      date: '2026-02-31', start: '09:00', title: 'x',
    }, token);
    assert.equal(bad.status, 400);

    const late = await json(base, 'POST', '/api/events', {
      date: '2026-11-20', start: '23:30', title: '晚场',
    }, token);
    assert.equal(late.status, 201);
    assert.equal(late.body.event.end, '24:00');

    const unauth = await json(base, 'GET', '/api/events');
    assert.equal(unauth.status, 401);
  });
});
