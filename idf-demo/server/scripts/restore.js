'use strict';

const path = require('node:path');
const { loadConfig } = require('../src/config');
const { restoreBackup } = require('../src/backup');

const config = loadConfig();

if (!config.backupKey) {
  console.error('[restore] BACKUP_KEY is not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((arg) => arg !== '--force');
const file = positional[0];
const target = positional[1] ? path.resolve(positional[1]) : config.dataDir;

if (!file) {
  console.error('usage: node scripts/restore.js <backup.json> [dataDir] [--force]');
  process.exit(1);
}

try {
  const result = restoreBackup({
    file: path.resolve(file),
    dataDir: target,
    key: config.backupKey,
    force,
  });
  console.log(`[restore] ${result.files} files restored to ${target} (backup from ${result.created})`);
  console.log('[restore] stop the server before restoring, then start it again');
} catch (err) {
  console.error('[restore] failed:', err.message);
  process.exit(1);
}
