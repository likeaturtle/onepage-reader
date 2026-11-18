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
  const deepseekApiKey = (env.DEEPSEEK_API_KEY || '').trim();
  const deepseekTimeout = Number(env.DEEPSEEK_TIMEOUT_MS);
  const scheduleTimeZone = (env.SCHEDULE_TIMEZONE || 'Asia/Shanghai').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: scheduleTimeZone });
  } catch (_) {
    throw new Error(`SCHEDULE_TIMEZONE 不是有效时区：${scheduleTimeZone}`);
  }

  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    dataDir,
    wxAppId,
    wxSecret,
    // DeepSeek voice schedule. The key must stay on the server; the mini
    // program only talks to /api/ai/*.
    deepseekApiKey,
    deepseekBaseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim().replace(/\/+$/, ''),
    deepseekModel: (env.DEEPSEEK_MODEL || 'deepseek-flash').trim(),
    deepseekTimeoutMs: Number.isFinite(deepseekTimeout) && deepseekTimeout > 0 ? deepseekTimeout : 30000,
    scheduleTimeZone,
    // Only enabled explicitly. Never infer this from an empty AppID: a
    // production deploy with a missing .env must fail closed, not open a
    // password-less login.
    allowDevLogin: env.ALLOW_DEV_LOGIN === '1',
    sessionSecret: (env.SESSION_SECRET || DEFAULT_SECRET).trim(),
    tokenTtlDays: Math.max(1, Number(env.TOKEN_TTL_DAYS || 7)),
    maxAvatarBytes: Math.max(1024, Number(env.MAX_AVATAR_BYTES || 512 * 1024)),
    corsOrigin: env.CORS_ORIGIN || '*',
    // Only enable behind a local reverse proxy that overwrites X-Real-IP.
    trustProxy: env.TRUST_PROXY === '1',
    isProd: env.NODE_ENV === 'production',
    defaultSecret: DEFAULT_SECRET,

    // At-rest encryption. Explicit keys are required in production; in
    // development crypto.js derives stable fallbacks from SESSION_SECRET.
    // Old keys are decrypt-only; Store re-encrypts records with the current
    // key at startup, so rotation does not require downtime or user action.
    dataKey: (env.DATA_KEY || '').trim(),
    dataKeyId: (env.DATA_KEY_ID || 'k1').trim(),
    dataOldKeys: (env.DATA_OLD_KEYS || '').trim(),
    indexKey: (env.INDEX_KEY || '').trim(),
    indexKeyId: (env.INDEX_KEY_ID || 'k1').trim(),
    indexOldKeys: (env.INDEX_OLD_KEYS || '').trim(),

    // Used by scripts/backup.js, never by the request path.
    backupKey: (env.BACKUP_KEY || '').trim(),
  };
}

module.exports = { loadConfig, DEFAULT_SECRET };
