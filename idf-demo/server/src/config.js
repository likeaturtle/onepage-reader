'use strict';

const path = require('node:path');

const DEFAULT_SECRET = 'dev-only-secret-change-me';

function loadConfig(env = process.env) {
  const serverRoot = path.join(__dirname, '..');
  const dataDir = env.DATA_DIR
    ? path.resolve(serverRoot, env.DATA_DIR)
    : path.join(serverRoot, 'data');
  const wxAppId = (env.WX_APPID || '').trim();
  const wxSecret = (env.WX_SECRET || '').trim();

  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    dataDir,
    wxAppId,
    wxSecret,
    // Only enabled explicitly. Never infer this from an empty AppID: a
    // production deploy with a missing .env must fail closed, not open a
    // password-less login.
    allowDevLogin: env.ALLOW_DEV_LOGIN === '1',
    sessionSecret: (env.SESSION_SECRET || DEFAULT_SECRET).trim(),
    tokenTtlDays: Math.max(1, Number(env.TOKEN_TTL_DAYS || 7)),
    maxAvatarBytes: Math.max(1024, Number(env.MAX_AVATAR_BYTES || 512 * 1024)),
    corsOrigin: env.CORS_ORIGIN || '*',
    isProd: env.NODE_ENV === 'production',
    defaultSecret: DEFAULT_SECRET,
  };
}

module.exports = { loadConfig, DEFAULT_SECRET };
