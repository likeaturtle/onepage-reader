'use strict';

const { loadConfig, DEFAULT_SECRET } = require('./config');
const { createKeyrings } = require('./crypto');
const { createApp } = require('./app');

const config = loadConfig();

if (config.isProd && config.sessionSecret === DEFAULT_SECRET) {
  console.error('[server] refusing to start: set SESSION_SECRET for production');
  process.exit(1);
}
if (config.isProd && config.allowDevLogin) {
  console.error('[server] refusing to start: ALLOW_DEV_LOGIN=1 in production exposes a password-less login');
  process.exit(1);
}
if (config.isProd && !config.dataKey) {
  console.error('[server] refusing to start: set DATA_KEY for production (openssl rand -base64 32)');
  process.exit(1);
}
if (config.isProd && !config.indexKey) {
  console.error('[server] refusing to start: set INDEX_KEY for production (openssl rand -base64 32)');
  process.exit(1);
}
if (!config.isProd && (!config.dataKey || !config.indexKey)) {
  console.warn('[server] DATA_KEY / INDEX_KEY not set; using keys derived from SESSION_SECRET (development only)');
}

let keyrings;
let server;
try {
  keyrings = createKeyrings(config);
  server = createApp(config);
} catch (err) {
  console.error('[server] refusing to start:', err.message);
  process.exit(1);
}

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`[server] listening on http://${config.host}:${port}`);
  console.log(`[server] wechat login: ${config.wxAppId && config.wxSecret ? 'configured' : 'NOT configured'}`);
  console.log(`[server] dev login: ${config.allowDevLogin ? 'enabled' : 'disabled'}`);
  console.log(`[server] data encryption: ${keyrings.source.data === 'env' ? config.dataKeyId : 'dev-derived'} / index: ${keyrings.source.index === 'env' ? config.indexKeyId : 'dev-derived'}`);
});

function shutdown(signal) {
  console.log(`[server] ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
