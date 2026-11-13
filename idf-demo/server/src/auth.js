'use strict';

const crypto = require('node:crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Compact HMAC-signed token: base64url(payload) + "." + base64url(HMAC).
 * The payload only carries the user id and expiry; openid stays server-side.
 */
function signToken(userId, secret, ttlSeconds) {
  const payload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const data = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const data = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  let given;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch (_) {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string' || !Number.isFinite(payload.exp)) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { signToken, verifyToken };
