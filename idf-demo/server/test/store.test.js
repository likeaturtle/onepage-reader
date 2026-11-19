'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { Store } = require('../src/store');
const { createKeyrings } = require('../src/crypto');

function makeKeys(overrides = {}) {
  return createKeyrings({
    sessionSecret: 'test-secret',
    dataKey: '',
    dataKeyId: 'k1',
    dataOldKeys: '',
    indexKey: '',
    indexKeyId: 'k1',
    indexOldKeys: '',
    ...overrides,
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mocheng-calcal-store-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('users, profiles, events and avatars are encrypted at rest', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.chmodSync(dir, 0o755);

  const store = new Store(dir, makeKeys());
  const user = store.createUser('openid-alice', { nickname: '小页' });
  const event = store.createEvent(user.id, {
    date: '2026-11-20',
    start: '09:00',
    end: '10:00',
    title: '项目评审',
    note: '会议室 A',
    deviceId: 7,
  });

  assert.equal(store.publicUser(user).nickname, '小页');
  assert.equal(store.findByOpenid('openid-alice').id, user.id);
  assert.equal(store.listEvents(user.id)[0].title, '项目评审');
  assert.equal(store.listEvents(user.id)[0].note, '会议室 A');
  assert.equal(store.listEvents(user.id)[0].deviceId, 7);
  assert.equal(store.getEvent(user.id, event.id).title, '项目评审');
  assert.equal(event.seq, 1);

  const usersFile = path.join(dir, 'users.json');
  const eventsFile = path.join(dir, 'events.json');
  const usersRaw = fs.readFileSync(usersFile, 'utf8');
  const eventsRaw = fs.readFileSync(eventsFile, 'utf8');
  const usersJson = readJson(usersFile);
  const eventsJson = readJson(eventsFile);

  assert.ok(!usersRaw.includes('openid-alice'));
  assert.ok(!usersRaw.includes('小页'));
  assert.ok(!eventsRaw.includes('项目评审'));
  assert.ok(!eventsRaw.includes('会议室 A'));
  assert.ok(!eventsRaw.includes('2026-11-20'));
  assert.ok(!eventsRaw.includes('09:00'));
  assert.equal(usersJson.v, 3);
  assert.equal(eventsJson.v, 3);
  assert.ok(usersJson.users[user.id].profile);
  assert.ok(usersJson.users[user.id].openidEnc);
  assert.equal(usersJson.users[user.id].nickname, undefined);
  assert.equal(usersJson.users[user.id].avatar, undefined);
  assert.ok(eventsJson.byUser[user.id][0].payload);
  assert.equal(eventsJson.byUser[user.id][0].date, undefined);
  assert.equal(eventsJson.byUser[user.id][0].title, undefined);
  assert.equal(eventsJson.byUser[user.id][0].deviceId, undefined);

  const png = Buffer.alloc(256);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  store.saveAvatar(user, png, 'png');
  const avatarUrl = store.publicUser(user).avatar;
  assert.match(avatarUrl, /^\/api\/me\/avatar\?v=[a-f0-9]{32}\.png$/);
  const avatarId = avatarUrl.split('v=')[1];
  assert.ok(!fs.readFileSync(usersFile, 'utf8').includes(avatarId));
  const avatarFile = store.avatarFile(user);
  assert.ok(avatarFile);
  assert.equal(fs.statSync(avatarFile).mode & 0o777, 0o600);

  const mode = (target) => fs.statSync(target).mode & 0o777;
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(path.join(dir, 'avatars')), 0o700);
  assert.equal(mode(usersFile), 0o600);
  assert.equal(mode(eventsFile), 0o600);
});

test('reopening the store preserves data without rewriting it', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keys = makeKeys();

  const first = new Store(dir, keys);
  const user = first.createUser('openid-reopen', { nickname: '重开' });
  first.createEvent(user.id, {
    date: '2026-11-21',
    start: '11:00',
    end: '12:00',
    title: '保持不变',
    note: '',
  });

  const usersBefore = fs.readFileSync(path.join(dir, 'users.json'), 'utf8');
  const eventsBefore = fs.readFileSync(path.join(dir, 'events.json'), 'utf8');
  const again = new Store(dir, keys);
  assert.equal(again.publicUser(again.get(user.id)).nickname, '重开');
  assert.equal(again.listEvents(user.id)[0].title, '保持不变');
  assert.equal(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'), usersBefore);
  assert.equal(fs.readFileSync(path.join(dir, 'events.json'), 'utf8'), eventsBefore);
});

test('key rotation decrypts old records and re-encrypts them with the new key', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k1 = crypto.randomBytes(32).toString('base64');
  const k2 = crypto.randomBytes(32).toString('base64');

  const base = {
    dataKey: k1,
    dataKeyId: 'k1',
    indexKey: k1,
    indexKeyId: 'k1',
  };
  const first = new Store(dir, createKeyrings(base));
  const user = first.createUser('openid-rotate', { nickname: '旋转前' });
  const event = first.createEvent(user.id, {
    date: '2026-11-20',
    start: '09:00',
    end: '10:00',
    title: '旧密钥',
    note: '旧备注',
  });

  const rotated = new Store(dir, createKeyrings({
    ...base,
    dataKey: k2,
    dataKeyId: 'k2',
    dataOldKeys: `k1:${k1}`,
    indexKey: k2,
    indexKeyId: 'k2',
    indexOldKeys: `k1:${k1}`,
  }));

  const found = rotated.findByOpenid('openid-rotate');
  assert.equal(rotated.publicUser(found).nickname, '旋转前');
  assert.equal(rotated.listEvents(user.id)[0].title, '旧密钥');
  assert.ok(found.openidHash.startsWith('k2:'));

  rotated.updateEvent(user.id, event.id, { title: '新密钥' });
  const rawEvents = readJson(path.join(dir, 'events.json')).byUser[user.id];
  const stored = rawEvents.find((item) => item.id === event.id);
  assert.equal(stored.payload.kid, 'k2');

  const rawUsers = readJson(path.join(dir, 'users.json'));
  assert.ok(!Object.keys(rawUsers.byOpenidHash).some((hash) => hash.startsWith('k1:')));
  assert.equal(rawUsers.users[user.id].profile.kid, 'k2');
  assert.equal(rawUsers.users[user.id].openidEnc.kid, 'k2');
});

test('a tampered ciphertext fails at startup', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keys = makeKeys();
  const store = new Store(dir, keys);
  const user = store.createUser('openid-tamper', { nickname: '原昵称' });

  const usersFile = path.join(dir, 'users.json');
  const raw = readJson(usersFile);
  raw.users[user.id].profile.ct = Buffer.from('tampered').toString('base64');
  fs.writeFileSync(usersFile, JSON.stringify(raw));

  assert.throws(() => new Store(dir, keys), /DATA_KEY cannot decrypt users\.json/);
});

test('index rotation rehashes accounts from the encrypted openid copy', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k1 = crypto.randomBytes(32).toString('base64');
  const k2 = crypto.randomBytes(32).toString('base64');

  const first = new Store(dir, createKeyrings({
    dataKey: k1,
    dataKeyId: 'k1',
    indexKey: k1,
    indexKeyId: 'k1',
  }));
  const user = first.createUser('openid-index-rotate', { nickname: '索引轮换' });

  // No INDEX_OLD_KEYS: the account must still be found because openidEnc lets
  // the store recompute the new hash at startup.
  const rotated = new Store(dir, createKeyrings({
    dataKey: k1,
    dataKeyId: 'k1',
    indexKey: k2,
    indexKeyId: 'k2',
  }));
  const found = rotated.findByOpenid('openid-index-rotate');
  assert.equal(found.id, user.id);
  assert.ok(found.openidHash.startsWith('k2:'));

  const raw = readJson(path.join(dir, 'users.json'));
  assert.ok(!Object.keys(raw.byOpenidHash).some((hash) => hash.startsWith('k1:')));
});

test('a wrong data key fails at startup instead of serving 500s', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const first = new Store(dir, makeKeys());
  first.createUser('openid-wrong-key', { nickname: '不能读' });

  const wrong = createKeyrings({
    sessionSecret: 'test-secret',
    dataKey: crypto.randomBytes(32).toString('base64'),
    dataKeyId: 'dev',
  });

  assert.throws(() => new Store(dir, wrong), /DATA_KEY cannot decrypt users\.json/);
});

test('older schema files are rejected instead of migrated', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({
    v: 2,
    users: {},
    byOpenidHash: {},
  }));
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify({
    v: 2,
    byUser: {},
  }));

  assert.throws(() => new Store(dir, makeKeys()), /users\.json schema v2 is unsupported/);
});

test('devices bind to one account, list, persist and unbind', (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = new Store(dir, makeKeys());
  const alice = store.createUser('openid-alice');
  const bob = store.createUser('openid-bob');
  const did = '0123456789ABCDEF0123456789ABCDEF';

  const claimed = store.claimDevice(alice.id, did, '书桌', 'A1B2C3D4E5F6');
  assert.equal(claimed.did, did);
  assert.equal(claimed.name, '书桌');
  assert.equal(claimed.pid, 'A1B2C3D4E5F6');
  assert.equal(claimed.userId, undefined);

  // Reloading must keep the binding.
  const reopened = new Store(dir, makeKeys());
  assert.equal(reopened.getDevice(did).userId, alice.id);
  assert.equal(reopened.listDevices(alice.id).length, 1);

  // Idempotent for the owner; the name can change.
  const again = reopened.claimDevice(alice.id, did.toLowerCase(), '书房');
  assert.equal(again.name, '书房');
  assert.equal(reopened.listDevices(alice.id).length, 1);

  // Another account cannot claim or unbind it.
  assert.throws(() => reopened.claimDevice(bob.id, did, '抢占'), (err) => err.status === 409);
  assert.throws(() => reopened.unbindDevice(bob.id, did), (err) => err.status === 403);
  assert.equal(reopened.listDevices(bob.id).length, 0);

  // The owner can unbind; after that another account can claim.
  reopened.unbindDevice(alice.id, did);
  assert.equal(reopened.getDevice(did), null);
  const bobClaim = reopened.claimDevice(bob.id, did, '新主人');
  assert.equal(bobClaim.did, did);
  assert.equal(reopened.listDevices(bob.id).length, 1);
});
