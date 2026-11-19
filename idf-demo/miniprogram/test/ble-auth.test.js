'use strict';

/**
 * Protocol v3 auth primitives and frame encryption. These are the reference
 * vectors for the firmware implementation (see docs/ble-protocol.md).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../utils/ble-auth');

const DID = 'A1B2C3D4E5F6';
const CODE = 'K7Q4M2X9B3TF';
const NONCE_D = '000102030405060708090a0b0c0d0e0f';
const NONCE_A = 'f0e0d0c0b0a090807060504030201000';

function hkdf(ikm, salt, info, length = 32) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function deterministicRandom() {
  let counter = 0;
  return (length) => {
    const out = Buffer.alloc(length);
    for (let i = 0; i < length; i++) out[i] = (counter * 31 + i * 7 + 11) & 0xff;
    counter++;
    return out;
  };
}

test('pairing codes normalize Crockford look-alikes and group by four', () => {
  assert.equal(auth.normalizeCode('k7q4-m2x9 b3tf'), CODE);
  assert.equal(auth.normalizeCode('K7Q4-M2X9-B3TF'), CODE);
  assert.equal(auth.normalizeCode('OILU'), '011V');
  assert.equal(auth.formatCode(CODE), 'K7Q4-M2X9-B3TF');
  assert.equal(auth.isValidCode('K7Q4-M2X9-B3TF'), true);
  assert.equal(auth.isValidCode('K7Q4-M2X9-B3T'), false);
  assert.equal(auth.isValidCode('K7Q4-M2X9-B3T!'), false);
});

test('HKDF-SHA256 matches Node for all protocol derivations', () => {
  const code = Buffer.from(auth.normalizeCode(CODE), 'utf8');
  const did = Buffer.from(DID, 'utf8');
  assert.deepEqual(
    Buffer.from(auth.derivePairKey(CODE, DID)),
    hkdf(code, did, 'mochen-calcal-pair-v1')
  );
  assert.deepEqual(
    Buffer.from(auth.deriveLongKey(CODE, DID)),
    hkdf(code, did, 'mochen-calcal-key-v1')
  );

  const salt = Buffer.concat([Buffer.from(NONCE_D, 'hex'), Buffer.from(NONCE_A, 'hex')]);
  const longKey = Buffer.from(auth.deriveLongKey(CODE, DID));
  const keys = auth.deriveSessionKeys(longKey, NONCE_D, NONCE_A);
  for (const [name, value] of Object.entries({
    encC2D: 'enc-c2d',
    macC2D: 'mac-c2d',
    encD2C: 'enc-d2c',
    macD2C: 'mac-d2c',
  })) {
    assert.deepEqual(
      Buffer.from(keys[name]),
      hkdf(longKey, salt, `mochen-calcal-${value}-v1`),
      name
    );
  }
});

test('client and device proofs match the documented HMAC inputs', () => {
  const pairKey = Buffer.from(auth.derivePairKey(CODE, DID));
  const expectedClient = hmac(
    pairKey,
    `mochen-calcal-client-v1|${DID}|${NONCE_D}|${NONCE_A}|pair`
  ).toString('hex');
  assert.equal(auth.clientProof(pairKey, DID, NONCE_D, NONCE_A, 'pair'), expectedClient);

  const longKey = Buffer.from(auth.deriveLongKey(CODE, DID));
  const expectedDevice = hmac(
    longKey,
    `mochen-calcal-device-v1|${DID}|${NONCE_A}|${NONCE_D}|auth`
  ).toString('hex');
  assert.equal(auth.deviceProof(longKey, DID, NONCE_A, NONCE_D, 'auth'), expectedDevice);

  // Reflection must not verify: the device binds the nonces in the other order.
  assert.notEqual(expectedDevice, expectedClient);
});

test('encrypted frames round-trip between app and device, and reject tampering/replay', async (t) => {
  t.after(() => auth.setRandomSource(null));
  auth.setRandomSource(deterministicRandom());

  const longKey = auth.deriveLongKey(CODE, DID);
  const app = auth.createSession(longKey, NONCE_D, NONCE_A, 'app');
  const device = auth.createSession(longKey, NONCE_D, NONCE_A, 'device');

  const line = await app.encrypt({ cmd: 'ping' });
  const frame = JSON.parse(line);
  assert.equal(frame.s, 1);
  assert.equal(frame.iv.length, 32);
  assert.equal(frame.m.length, 64);
  assert.deepEqual(device.decrypt(frame), { cmd: 'ping' });

  // Replaying the same seq is rejected even though the MAC is valid.
  assert.equal(device.decrypt(frame), null);

  const ack = await device.encrypt({ ok: true, cmd: 'ping' });
  assert.deepEqual(app.decrypt(JSON.parse(ack)), { ok: true, cmd: 'ping' });

  // A modified ciphertext or MAC must not decrypt.
  const tampered = JSON.parse(await app.encrypt({ cmd: 'del', id: 7 }));
  tampered.m = tampered.m.replace(/^./, tampered.m[0] === '0' ? '1' : '0');
  assert.equal(device.decrypt(tampered), null);

  const badPayload = JSON.parse(await app.encrypt({ cmd: 'del', id: 9 }));
  const raw = Buffer.from(badPayload.d, 'base64');
  raw[0] ^= 1;
  badPayload.d = raw.toString('base64');
  assert.equal(device.decrypt(badPayload), null);
});

test('the paired handshake establishes a session both ways', async (t) => {
  t.after(() => auth.setRandomSource(null));
  auth.setRandomSource(deterministicRandom());

  const longKey = auth.deriveLongKey(CODE, DID);
  const clientProof = auth.clientProof(longKey, DID, NONCE_D, NONCE_A, 'auth');
  // Device-side verification, as the firmware does it.
  assert.equal(
    clientProof,
    auth.clientProof(Buffer.from(longKey), DID, NONCE_D, NONCE_A, 'auth')
  );

  const proof = auth.deviceProof(longKey, DID, NONCE_A, NONCE_D, 'auth');
  assert.equal(auth.secureEqualHex(proof, auth.deviceProof(longKey, DID, NONCE_A, NONCE_D, 'auth')), true);
  assert.equal(auth.secureEqualHex(proof, clientProof), false);

  const app = auth.createSession(longKey, NONCE_D, NONCE_A, 'app');
  const device = auth.createSession(longKey, NONCE_D, NONCE_A, 'device');
  const frame = JSON.parse(await app.encrypt({ cmd: 'hello' }));
  assert.deepEqual(device.decrypt(frame), { cmd: 'hello' });
});

test('pairing derives K_long and the same session on both sides', async (t) => {
  t.after(() => auth.setRandomSource(null));
  auth.setRandomSource(deterministicRandom());

  const pairKey = auth.derivePairKey(CODE, DID);
  const longKey = auth.deriveLongKey(CODE, DID);
  const proof = auth.clientProof(pairKey, DID, NONCE_D, NONCE_A, 'pair');
  assert.equal(
    proof,
    Buffer.from(
      hmac(
        Buffer.from(pairKey),
        `mochen-calcal-client-v1|${DID}|${NONCE_D}|${NONCE_A}|pair`
      )
    ).toString('hex')
  );

  const deviceProof = auth.deviceProof(longKey, DID, NONCE_A, NONCE_D, 'pair');
  assert.equal(
    deviceProof,
    Buffer.from(
      hmac(
        Buffer.from(longKey),
        `mochen-calcal-device-v1|${DID}|${NONCE_A}|${NONCE_D}|pair`
      )
    ).toString('hex')
  );

  const app = auth.createSession(longKey, NONCE_D, NONCE_A, 'app');
  const device = auth.createSession(longKey, NONCE_D, NONCE_A, 'device');
  const frame = JSON.parse(await app.encrypt({ cmd: 'hello' }));
  assert.deepEqual(device.decrypt(frame), { cmd: 'hello' });
});

test('web and mini program copies of the shared module stay identical', () => {
  const mini = path.join(__dirname, '..', 'utils', 'ble-auth.js');
  const web = path.join(__dirname, '..', '..', 'web', 'ble-auth.js');
  assert.equal(fs.readFileSync(mini, 'utf8'), fs.readFileSync(web, 'utf8'));
});
