import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirA } from './dir-a.mjs';
import { dirB } from './dir-b.mjs';
import { dirC } from './dir-c.mjs';
import { dirD } from './dir-d.mjs';
import { dirE } from './dir-e.mjs';
import { dirF } from './dir-f.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const logoPath = path.resolve(root, '../miniprogram/CalCal_logo.png');
const logo = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');

const only = process.argv[2] || 'all';
const jobs = [
  { name: 'dir-1.html', fn: dirA, build: only === 'all' || only === 'a' },
  { name: 'dir-2.html', fn: dirB, build: only === 'all' || only === 'b' },
  { name: 'dir-3.html', fn: dirC, build: only === 'all' || only === 'c' },
  { name: 'dir-4.html', fn: dirD, build: only === 'all' || only === 'a2' },
  { name: 'dir-5.html', fn: dirE, build: only === 'all' || only === 'b2' },
  { name: 'dir-6.html', fn: dirF, build: only === 'all' || only === 'c1' },
];

for (const job of jobs) {
  if (!job.build) continue;
  const html = job.fn(logo);
  fs.writeFileSync(path.resolve(root, job.name), html);
  console.log(`wrote ${job.name} (${(html.length / 1024).toFixed(1)} KB)`);
}
