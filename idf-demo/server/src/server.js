'use strict';

const { loadConfig, DEFAULT_SECRET } = require('./config');
const { createApp } = require('./app');

const config = loadConfig();

if (config.isProd && config.sessionSecret === DEFAULT_SECRET) {
  console.error('[server] refusing to start: set SESSION_SECRET for production');
  process.exit(1);
}
if (config.isProd && config.allowDevLogin) {
  console.warn('[server] WARNING: ALLOW_DEV_LOGIN=1 in production exposes a password-less login');
}

const server = createApp(config);

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`[server] listening on http://${config.host}:${port}`);
  console.log(`[server] wechat login: ${config.wxAppId && config.wxSecret ? 'configured' : 'NOT configured'}`);
  console.log(`[server] dev login: ${config.allowDevLogin ? 'enabled' : 'disabled'}`);
});

function shutdown(signal) {
  console.log(`[server] ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
