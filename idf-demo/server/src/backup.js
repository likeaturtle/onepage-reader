'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { decodeKey } = require('./crypto');

const MAGIC = 'ONEPAGE-BACKUP';
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function listFiles(root) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.endsWith('.tmp')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }

  walk(root);
  return files;
}

/**
 * Encrypt a snapshot of DATA_DIR into one self-contained JSON envelope.
 *
 * The backup key is deliberately separate from DATA_KEY: a leaked backup key
 * must not decrypt the live store, and losing the live key must not make
 * yesterday's backup useless.
 */
function createBackup({ dataDir, outFile, key, now = new Date() }) {
  const backupKey = decodeKey(key, 'BACKUP_KEY');
  const root = path.resolve(dataDir);
  const output = path.resolve(outFile);

  const files = listFiles(root)
    .filter((file) => path.resolve(file) !== output)
    .map((file) => {
      const bytes = fs.readFileSync(file);
      const relative = path.relative(root, file).split(path.sep).join('/');
      return {
        path: relative,
        mode: fs.statSync(file).mode & 0o777,
        sha256: sha256(bytes),
        data: bytes.toString('base64'),
      };
    });

  const payload = Buffer.from(JSON.stringify({
    v: VERSION,
    created: now.toISOString(),
    files,
  }), 'utf8');
  const compressed = zlib.gzipSync(payload, { level: 9 });

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', backupKey, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);

  const envelope = {
    magic: MAGIC,
    v: VERSION,
    created: now.toISOString(),
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  };

  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const tmp = `${output}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
  fs.renameSync(tmp, output);

  return {
    file: output,
    files: files.length,
    plainBytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.data, 'base64'), 0),
    backupBytes: fs.statSync(output).size,
  };
}

function restoreBackup({ file, dataDir, key, force = false }) {
  const backupKey = decodeKey(key, 'BACKUP_KEY');
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!envelope || envelope.magic !== MAGIC || envelope.v !== VERSION) {
    throw new Error('not a OnePage backup file');
  }

  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('backup has an invalid IV or tag');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', backupKey, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);

  let payload;
  try {
    const compressed = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  } catch (_) {
    throw new Error('backup failed authentication or is corrupted');
  }

  if (!payload || payload.v !== VERSION || !Array.isArray(payload.files)) {
    throw new Error('backup payload is malformed');
  }

  const root = path.resolve(dataDir);
  if (!force && fs.existsSync(root) && fs.readdirSync(root).length) {
    throw new Error(`target directory is not empty: ${root} (pass --force to overwrite)`);
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  for (const entry of payload.files) {
    const relative = String(entry.path || '');
    if (!relative || relative.includes('\0') || path.isAbsolute(relative)) {
      throw new Error(`backup contains an invalid path: ${relative}`);
    }
    const normalized = path.posix.normalize(relative);
    if (normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`backup contains a path outside the data directory: ${relative}`);
    }

    const bytes = Buffer.from(String(entry.data || ''), 'base64');
    if (entry.sha256 && sha256(bytes) !== entry.sha256) {
      throw new Error(`checksum mismatch for ${relative}`);
    }

    const destination = path.resolve(root, normalized);
    if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
      throw new Error(`backup contains a path outside the data directory: ${relative}`);
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const mode = Number.isInteger(entry.mode) ? entry.mode : 0o600;
    fs.writeFileSync(destination, bytes, { mode });
    try {
      fs.chmodSync(destination, mode);
    } catch (_) {
      // Same portability caveat as the store: POSIX modes are best effort.
    }
  }

  return { files: payload.files.length, created: payload.created };
}

module.exports = { createBackup, restoreBackup };
