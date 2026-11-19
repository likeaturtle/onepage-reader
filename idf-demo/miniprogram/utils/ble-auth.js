'use strict';

/**
 * Application-layer authentication for the CalCal BLE protocol (proto 3).
 *
 * The BLE link itself is not paired, so the phone and the device prove
 * knowledge of a per-device key and encrypt every application frame:
 *
 *   pairing  code shown on the device -> K_pair / K_long (HKDF-SHA256)
 *   handshake  nonce challenge -> HMAC-SHA256 proofs (mutual)
 *   frames   AES-256-CBC + HMAC-SHA256, one JSON line per frame
 *
 * Keep this file byte-for-byte identical to web/ble-auth.js. The web page
 * loads it with <script> and uses window.CalCalAuth; the mini program uses
 * require(). test/auth-copy.test.js enforces the copy is in sync.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/crypto-js'));
  } else {
    root.CalCalAuth = factory(root.CryptoJS);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CryptoJS) {
  'use strict';

  const VERSION = 3;
  // Crockford base32 alphabet: 0/1 are in, I/L/O/U are not, so the printed
  // code cannot contain the usual look-alikes.
  const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const CODE_LENGTH = 12;

  let randomSource = null;

  function setRandomSource(fn) {
    randomSource = typeof fn === 'function' ? fn : null;
  }

  function normalizeBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return Uint8Array.from(value);
    throw new Error('random source returned unsupported bytes');
  }

  function randomBytes(length) {
    if (randomSource) {
      try {
        return Promise.resolve(normalizeBytes(randomSource(length)));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    // Node tests and browsers. The mini program has no WebCrypto, so the
    // wx.getRandomValues branch below is the one that runs on phones.
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      const out = new Uint8Array(length);
      crypto.getRandomValues(out);
      return Promise.resolve(out);
    }
    if (typeof wx !== 'undefined' && wx && typeof wx.getRandomValues === 'function') {
      return new Promise((resolve, reject) => {
        wx.getRandomValues({
          length,
          success(res) {
            resolve(new Uint8Array(res.randomValues));
          },
          fail(err) {
            reject(new Error((err && err.errMsg) || '获取安全随机数失败'));
          },
        });
      });
    }
    return Promise.reject(new Error('当前环境没有安全随机数'));
  }

  function bytesToWordArray(bytes) {
    const words = [];
    for (let i = 0; i < bytes.length; i += 4) {
      words.push(
        ((bytes[i] << 24) |
          ((bytes[i + 1] || 0) << 16) |
          ((bytes[i + 2] || 0) << 8) |
          (bytes[i + 3] || 0)) >>> 0
      );
    }
    return CryptoJS.lib.WordArray.create(words, bytes.length);
  }

  function wordArrayToBytes(wordArray) {
    const out = new Uint8Array(wordArray.sigBytes);
    for (let i = 0; i < wordArray.sigBytes; i++) {
      out[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return out;
  }

  function utf8Bytes(text) {
    return wordArrayToBytes(CryptoJS.enc.Utf8.parse(String(text)));
  }

  function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return out;
  }

  function hexToBytes(hex) {
    const text = String(hex || '');
    if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) {
      throw new Error('bad hex');
    }
    const out = new Uint8Array(text.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(text.substr(i * 2, 2), 16);
    }
    return out;
  }

  function bytesToBase64(bytes) {
    return CryptoJS.enc.Base64.stringify(bytesToWordArray(bytes));
  }

  function base64ToBytes(text) {
    const value = String(text || '');
    if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
      throw new Error('bad base64');
    }
    return wordArrayToBytes(CryptoJS.enc.Base64.parse(value));
  }

  function hmacSha256(keyBytes, dataBytes) {
    const digest = CryptoJS.HmacSHA256(bytesToWordArray(dataBytes), bytesToWordArray(keyBytes));
    return wordArrayToBytes(digest);
  }

  function hmacHex(keyBytes, text) {
    return bytesToHex(hmacSha256(keyBytes, utf8Bytes(text)));
  }

  // HKDF-SHA256 (RFC 5869), single 32-byte output block.
  function hkdfSha256(ikm, salt, info, length) {
    const size = length || 32;
    if (size > 32) throw new Error('hkdf length unsupported');
    const saltBytes = salt && salt.length ? salt : new Uint8Array(32);
    const prk = hmacSha256(saltBytes, ikm);
    const infoBytes = utf8Bytes(info);
    const input = new Uint8Array(infoBytes.length + 1);
    input.set(infoBytes, 0);
    input[infoBytes.length] = 1;
    return hmacSha256(prk, input).slice(0, size);
  }

  function normalizeCode(value) {
    // Crockford's ambiguity rules: O -> 0, I/L -> 1, U -> V.
    return String(value || '')
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1')
      .replace(/U/g, 'V');
  }

  function isValidCode(value) {
    const code = normalizeCode(value);
    if (code.length !== CODE_LENGTH) return false;
    for (let i = 0; i < code.length; i++) {
      if (CODE_ALPHABET.indexOf(code[i]) < 0) return false;
    }
    return true;
  }

  function formatCode(value) {
    const code = normalizeCode(value);
    return code.length === CODE_LENGTH
      ? `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`
      : code;
  }

  function derivePairKey(code, did) {
    return hkdfSha256(utf8Bytes(normalizeCode(code)), utf8Bytes(did), 'mochen-calcal-pair-v1', 32);
  }

  function deriveLongKey(code, did) {
    return hkdfSha256(utf8Bytes(normalizeCode(code)), utf8Bytes(did), 'mochen-calcal-key-v1', 32);
  }

  function clientProof(key, did, nonceD, nonceA, mode) {
    return hmacHex(key, `mochen-calcal-client-v1|${did}|${nonceD}|${nonceA}|${mode}`);
  }

  function deviceProof(key, did, nonceA, nonceD, mode) {
    return hmacHex(key, `mochen-calcal-device-v1|${did}|${nonceA}|${nonceD}|${mode}`);
  }

  function deriveSessionKeys(longKey, nonceD, nonceA) {
    const salt = new Uint8Array(32);
    salt.set(hexToBytes(nonceD), 0);
    salt.set(hexToBytes(nonceA), 16);
    const derive = (name) => hkdfSha256(longKey, salt, `mochen-calcal-${name}-v1`, 32);
    return {
      encC2D: derive('enc-c2d'),
      macC2D: derive('mac-c2d'),
      encD2C: derive('enc-d2c'),
      macD2C: derive('mac-d2c'),
    };
  }

  function secureEqualHex(left, right) {
    try {
      const a = hexToBytes(left);
      const b = hexToBytes(right);
      if (a.length !== b.length) return false;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
      return diff === 0;
    } catch (_) {
      return false;
    }
  }

  function frameMac(key, direction, seq, iv, ciphertext) {
    return hmacHex(
      key,
      `mochen-calcal-frame-v1|${direction}|${seq}|${bytesToHex(iv)}|${bytesToHex(ciphertext)}`
    );
  }

  /**
   * Session used after the handshake. `role` is "app" (default) or "device";
   * the direction of the keys and MACs follows from it. Encryption is async
   * only because the IV comes from the platform RNG.
   */
  function createSession(longKey, nonceD, nonceA, role) {
    const isApp = role !== 'device';
    const keys = deriveSessionKeys(longKey, nonceD, nonceA);
    const encTx = isApp ? keys.encC2D : keys.encD2C;
    const macTx = isApp ? keys.macC2D : keys.macD2C;
    const encRx = isApp ? keys.encD2C : keys.encC2D;
    const macRx = isApp ? keys.macD2C : keys.macC2D;
    const txDirection = isApp ? 'c2d' : 'd2c';
    const rxDirection = isApp ? 'd2c' : 'c2d';
    let txSeq = 0;
    let rxSeq = 0;

    async function encrypt(payload) {
      const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const iv = await randomBytes(16);
      const ciphertext = wordArrayToBytes(
        CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(json), bytesToWordArray(encTx), {
          iv: bytesToWordArray(iv),
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        }).ciphertext
      );
      const seq = txSeq + 1;
      const mac = frameMac(macTx, txDirection, seq, iv, ciphertext);
      txSeq = seq;
      return JSON.stringify({
        s: seq,
        iv: bytesToHex(iv),
        d: bytesToBase64(ciphertext),
        m: mac,
      });
    }

    function decrypt(frame) {
      if (!frame || typeof frame !== 'object') return null;
      const seq = Number(frame.s);
      if (!Number.isInteger(seq) || seq <= rxSeq || seq > 0xffffffff) return null;
      let iv;
      let ciphertext;
      try {
        if (String(frame.iv).length !== 32 || !/^[0-9a-f]{32}$/i.test(String(frame.iv))) return null;
        if (String(frame.m).length !== 64 || !/^[0-9a-f]{64}$/i.test(String(frame.m))) return null;
        iv = hexToBytes(frame.iv);
        ciphertext = base64ToBytes(frame.d);
      } catch (_) {
        return null;
      }
      if (!ciphertext.length || ciphertext.length % 16 !== 0) return null;
      const expected = frameMac(macRx, rxDirection, seq, iv, ciphertext);
      if (!secureEqualHex(expected, frame.m)) return null;
      try {
        const plaintext = CryptoJS.AES.decrypt(
          { ciphertext: bytesToWordArray(ciphertext) },
          bytesToWordArray(encRx),
          {
            iv: bytesToWordArray(iv),
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7,
          }
        ).toString(CryptoJS.enc.Utf8);
        if (!plaintext) return null;
        const message = JSON.parse(plaintext);
        rxSeq = seq;
        return message;
      } catch (_) {
        return null;
      }
    }

    return {
      keys,
      encrypt,
      decrypt,
      direction: isApp ? 'app' : 'device',
      get txSeq() { return txSeq; },
      get rxSeq() { return rxSeq; },
    };
  }

  return {
    VERSION,
    CODE_ALPHABET,
    CODE_LENGTH,
    setRandomSource,
    randomBytes,
    normalizeCode,
    isValidCode,
    formatCode,
    derivePairKey,
    deriveLongKey,
    clientProof,
    deviceProof,
    deriveSessionKeys,
    createSession,
    // Exposed for tests and for the device-side Node mock.
    hkdfSha256,
    hmacHex,
    bytesToHex,
    hexToBytes,
    bytesToBase64,
    base64ToBytes,
    utf8Bytes,
    secureEqualHex,
  };
});
