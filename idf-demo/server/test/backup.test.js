'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createBackup, restoreBackup } = require('../src/backup');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'onepage-backup-'));
}

test('encrypted backup round trip, wrong key and non-empty target', (t) => {
  const source = tmpDir();
  const outputRoot = tmpDir();
  const restoredRoot = tmpDir();
  t.after(() => {
    for (const dir of [source, outputRoot, restoredRoot]) fs.rmSync(dir, { recursive: true, force: true });
  });
  const output = path.join(outputRoot, 'backup.json');
  const key = crypto.randomBytes(32).toString('base64');

  fs.mkdirSync(path.join(source, 'avatars'));
  fs.writeFileSync(path.join(source, 'users.json'), '{"v":2,"users":{}}');
  fs.writeFileSync(path.join(source, 'avatars', 'a.jpg'), Buffer.from([1, 2, 3, 4]));

  const result = createBackup({ dataDir: source, outFile: output, key });
  assert.equal(result.files, 2);
  assert.ok(result.backupBytes > 0);

  const envelope = fs.readFileSync(output, 'utf8');
  assert.ok(!envelope.includes('"users"'));

  const restored = path.join(restoredRoot, 'restored');
  const summary = restoreBackup({ file: output, dataDir: restored, key });
  assert.equal(summary.files, 2);
  assert.equal(fs.readFileSync(path.join(restored, 'users.json'), 'utf8'), '{"v":2,"users":{}}');
  assert.deepEqual(fs.readFileSync(path.join(restored, 'avatars', 'a.jpg')), Buffer.from([1, 2, 3, 4]));

  assert.throws(() => createBackup({ dataDir: source, outFile: output, key: 'short' }), /32 bytes/);

  const wrongKey = crypto.randomBytes(32).toString('base64');
  assert.throws(
    () => restoreBackup({ file: output, dataDir: path.join(outputRoot, 'wrong'), key: wrongKey }),
    /authentication/,
  );

  assert.throws(
    () => restoreBackup({ file: output, dataDir: restored, key }),
    /not empty/,
  );
  restoreBackup({ file: output, dataDir: restored, key, force: true });
});
