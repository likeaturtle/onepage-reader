'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createKeyrings, isBox } = require('../src/crypto');

function makeConfig(overrides = {}) {
  return {
    sessionSecret: 'test-secret',
    dataKey: '',
    dataKeyId: 'k1',
    dataOldKeys: '',
    indexKey: '',
    indexKeyId: 'k1',
    indexOldKeys: '',
    ...overrides,
  };
}

test('seal / unseal round trip and AAD binding', () => {
  const data = createKeyrings(makeConfig()).data;
  const box = data.seal('小页', 'user:u1:nickname');

  assert.ok(isBox(box));
  assert.equal(box.kid, 'dev');
  assert.equal(data.unseal(box, 'user:u1:nickname'), '小页');

  assert.throws(() => data.unseal(box, 'user:u2:nickname'), /authentication/);
  assert.throws(() => data.unseal({ ...box, ct: Buffer.from('tampered').toString('base64') }, 'user:u1:nickname'), /authentication/);
  assert.throws(() => data.unseal({ ...box, kid: 'missing' }, 'user:u1:nickname'), /unknown data key/);
  assert.throws(() => data.unseal('plaintext', 'user:u1:nickname'), /not an encrypted record/);
});

test('explicit data keys and decrypt-only old keys support rotation', () => {
  const k1 = crypto.randomBytes(32).toString('base64');
  const k2 = crypto.randomBytes(32).toString('base64');

  const before = createKeyrings(makeConfig({ dataKey: k1, dataKeyId: 'k1' })).data;
  const box = before.seal('rotate me', 'event:u:e:title');

  const after = createKeyrings(makeConfig({
    dataKey: k2,
    dataKeyId: 'k2',
    dataOldKeys: `k1:${k1}`,
  })).data;

  assert.equal(after.unseal(box, 'event:u:e:title'), 'rotate me');
  assert.equal(after.seal('new', 'event:u:e:title').kid, 'k2');
});

test('openid index is HMAC only and survives index key rotation', () => {
  const k1 = crypto.randomBytes(32).toString('base64');
  const k2 = crypto.randomBytes(32).toString('base64');

  const first = createKeyrings(makeConfig({ indexKey: k1, indexKeyId: 'k1' })).index;
  const hash = first.hash('openid-alice');
  assert.match(hash, /^k1:[A-Za-z0-9_-]+$/);
  assert.ok(!hash.includes('openid-alice'));

  const byHash = { [hash]: 'user-1' };
  assert.deepEqual(first.lookup('openid-alice', byHash), { id: 'user-1', hash, kid: 'k1' });
  assert.equal(first.lookup('openid-bob', byHash), null);

  const rotated = createKeyrings(makeConfig({
    indexKey: k2,
    indexKeyId: 'k2',
    indexOldKeys: `k1:${k1}`,
  })).index;

  const found = rotated.lookup('openid-alice', byHash);
  assert.equal(found.id, 'user-1');
  assert.equal(found.kid, 'k1');
  assert.equal(rotated.isCurrent(found.hash), false);
  assert.equal(rotated.isCurrent(rotated.hash('openid-alice')), true);
});

test('invalid key material fails at startup instead of silently changing keys', () => {
  assert.throws(() => createKeyrings(makeConfig({ dataKey: 'too-short' })), /32 bytes/);
  assert.throws(() => createKeyrings(makeConfig({ indexKey: 'not base64 !!!' })), /32 bytes|base64/);
  assert.throws(
    () => createKeyrings(makeConfig({
      dataKey: crypto.randomBytes(32).toString('base64'),
      dataKeyId: 'k1',
      dataOldKeys: `k1:${crypto.randomBytes(32).toString('base64')}`,
    })),
    /duplicate/,
  );
});
