'use strict';

const crypto = require('node:crypto');

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALG = 'aes-256-gcm';
const SCHEME_VERSION = 1;
// Legacy data-domain separators. Keep the literal bytes even though the
// product is now 墨程CalCal: changing them would make existing encrypted
// data unreadable. New user-facing filenames use the product name instead.
const HKDF_SALT = Buffer.from('onepage-server-v2', 'utf8');

function decodeKey(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is empty`);

  const key = Buffer.from(text, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${label} must be ${KEY_BYTES} bytes encoded as base64 (got ${key.length})`);
  }
  // Buffer.from is forgiving: reject anything that is not canonical base64 so a
  // truncated or padded key fails at startup instead of silently becoming a
  // different key.
  const canonical = key.toString('base64').replace(/=+$/, '');
  if (canonical !== text.replace(/=+$/, '')) {
    throw new Error(`${label} is not valid base64`);
  }
  return key;
}

function deriveKey(secret, info) {
  const ikm = Buffer.from(String(secret || ''), 'utf8');
  const out = crypto.hkdfSync('sha256', ikm, HKDF_SALT, Buffer.from(info, 'utf8'), KEY_BYTES);
  return Buffer.from(out);
}

function parseOldKeys(spec, label) {
  const text = String(spec || '').trim();
  if (!text) return [];

  return text.split(',').map((part) => {
    const index = part.indexOf(':');
    if (index <= 0) throw new Error(`${label} entries must look like kid:base64`);
    const kid = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new Error(`${label} contains an invalid key id: ${kid}`);
    return [kid, value];
  });
}

function isBox(value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.v === SCHEME_VERSION &&
    value.alg === 'A256GCM' &&
    typeof value.kid === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.ct === 'string' &&
    typeof value.tag === 'string';
}

class Keyring {
  constructor(entries, currentId) {
    this.keys = new Map(entries);
    this.currentId = currentId;
    if (!this.keys.has(currentId)) throw new Error(`missing current data key: ${currentId}`);
  }

  get ids() {
    return [...this.keys.keys()];
  }

  seal(value, aad) {
    const key = this.keys.get(this.currentId);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(String(aad), 'utf8'));
    const ct = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return {
      v: SCHEME_VERSION,
      alg: 'A256GCM',
      kid: this.currentId,
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  unseal(box, aad) {
    if (!isBox(box)) throw new Error('value is not an encrypted record');
    const key = this.keys.get(box.kid);
    if (!key) throw new Error(`unknown data key id: ${box.kid}`);

    const iv = Buffer.from(box.iv, 'base64');
    const tag = Buffer.from(box.tag, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('encrypted record has an invalid IV or tag');
    }

    const decipher = crypto.createDecipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(box.ct, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (_) {
      // Never echo the underlying OpenSSL message: it is noise for callers and
      // the only actionable fact is that the ciphertext or AAD was changed.
      throw new Error('encrypted record failed authentication');
    }
  }
}

/**
 * HMAC index for openid. The plaintext identifier is never written to disk;
 * login recomputes the digest and looks it up. Key ids are stored as a prefix
 * so rotating INDEX_KEY keeps existing accounts reachable.
 */
class IndexHasher {
  constructor(entries, currentId) {
    this.keys = new Map(entries);
    this.currentId = currentId;
    if (!this.keys.has(currentId)) throw new Error(`missing current index key: ${currentId}`);
  }

  digest(openid, kid) {
    const key = this.keys.get(kid);
    return crypto.createHmac('sha256', key).update(String(openid), 'utf8').digest('base64url');
  }

  hash(openid, kid = this.currentId) {
    return `${kid}:${this.digest(openid, kid)}`;
  }

  lookup(openid, byHash) {
    const ids = [this.currentId, ...this.keys.keys()].filter((id, index, list) => list.indexOf(id) === index);
    for (const kid of ids) {
      const hash = this.hash(openid, kid);
      if (Object.prototype.hasOwnProperty.call(byHash, hash)) return { id: byHash[hash], hash, kid };
    }
    return null;
  }

  isCurrent(hash) {
    return typeof hash === 'string' && hash.startsWith(`${this.currentId}:`);
  }
}

function entriesFrom(current, currentId, oldSpec, label) {
  const entries = [[currentId, decodeKey(current, label)]];
  for (const [kid, value] of parseOldKeys(oldSpec, label)) {
    if (entries.some(([id]) => id === kid)) throw new Error(`${label} contains a duplicate key id: ${kid}`);
    entries.push([kid, decodeKey(value, label)]);
  }
  return entries;
}

/**
 * Build the two independent keyrings the store needs.
 *
 * Explicit DATA_KEY / INDEX_KEY always win. In development we derive stable
 * keys from SESSION_SECRET so `npm start` works without extra setup; the
 * server refuses to boot in production without explicit keys.
 */
function createKeyrings(config) {
  const sessionSecret = config.sessionSecret || 'onepage-dev';
  const dataExplicit = Boolean(config.dataKey);
  const indexExplicit = Boolean(config.indexKey);

  const dataId = dataExplicit ? (config.dataKeyId || 'k1') : 'dev';
  const indexId = indexExplicit ? (config.indexKeyId || 'k1') : 'dev';

  const dataEntries = dataExplicit
    ? entriesFrom(config.dataKey, dataId, config.dataOldKeys, 'DATA_KEY')
    : [['dev', deriveKey(sessionSecret, 'onepage/data')]];

  const indexEntries = indexExplicit
    ? entriesFrom(config.indexKey, indexId, config.indexOldKeys, 'INDEX_KEY')
    : [['dev', deriveKey(sessionSecret, 'onepage/index')]];

  return {
    data: new Keyring(dataEntries, dataId),
    index: new IndexHasher(new Map(indexEntries), indexId),
    source: {
      data: dataExplicit ? 'env' : 'derived',
      index: indexExplicit ? 'env' : 'derived',
    },
  };
}

module.exports = {
  KEY_BYTES,
  isBox,
  decodeKey,
  deriveKey,
  createKeyrings,
  Keyring,
  IndexHasher,
};
