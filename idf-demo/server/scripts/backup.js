'use strict';

const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createBackup } = require('../src/backup');

const config = loadConfig();

if (!config.backupKey) {
  console.error('[backup] BACKUP_KEY is not set; generate one with: openssl rand -base64 32');
  process.exit(1);
}

const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(outputDir, `mocheng-calcal-${stamp}.backup.json`);

try {
  const result = createBackup({ dataDir: config.dataDir, outFile: output, key: config.backupKey });
  console.log(`[backup] ${result.files} files, ${result.plainBytes} bytes plaintext`);
  console.log(`[backup] wrote ${result.file} (${result.backupBytes} bytes)`);
  console.log('[backup] store the key separately from the backup; without it the file is unrecoverable');
} catch (err) {
  console.error('[backup] failed:', err.message);
  process.exit(1);
}
