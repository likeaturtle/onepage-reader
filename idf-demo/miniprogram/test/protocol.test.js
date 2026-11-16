'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const utf8 = require('../utils/utf8');
const { LineDecoder } = require('../utils/frame');

test('UTF-8 encode/decode round-trips ASCII, Chinese and emoji', () => {
  const samples = [
    '',
    'hello',
    '项目评审',
    '会议室 A · 09:00',
    'emoji 😀 and 汉字',
    'éàü',
  ];
  for (const sample of samples) {
    const bytes = utf8.encode(sample);
    assert.deepEqual(Array.from(bytes), Array.from(Buffer.from(sample, 'utf8')));
    assert.equal(utf8.decode(bytes), sample);
    assert.equal(utf8.byteLength(sample), Buffer.byteLength(sample, 'utf8'));
  }
});

test('line decoder reassembles fragments split inside a multi-byte character', () => {
  const payload = '{"ev":"ev","id":7,"title":"项目评审"}\n{"ev":"done","n":1}\n';
  const bytes = utf8.encode(payload);

  for (const split of [1, 2, 3, 5, 7, 11, 19, 20, 23]) {
    const decoder = new LineDecoder();
    const lines = [];
    for (let offset = 0; offset < bytes.length; offset += split) {
      lines.push(...decoder.push(bytes.slice(offset, offset + split).buffer));
    }
    const decoded = lines.map((line) => utf8.decode(line));
    assert.deepEqual(decoded, [
      '{"ev":"ev","id":7,"title":"项目评审"}',
      '{"ev":"done","n":1}',
    ], `split=${split}`);
  }
});

test('line decoder keeps CRLF-compatible lines clean', () => {
  const decoder = new LineDecoder();
  const lines = decoder.push(utf8.encode('{"cmd":"ping"}\r\n').buffer);
  assert.equal(lines.length, 1);
  assert.equal(utf8.decode(lines[0]).replace(/\r$/, ''), '{"cmd":"ping"}');
});

test('20-byte chunks never break JSON parsing after reassembly', () => {
  const commands = [
    { cmd: 'hello' },
    { cmd: 'time', epoch: 1762703820, tz: 480 },
    { cmd: 'list', from: '2026-11-01', to: '2026-11-30' },
    { cmd: 'add', date: '2026-11-10', start: '09:00', end: '10:00', title: '项目评审', note: '会议室 A' },
  ];
  for (const command of commands) {
    const bytes = utf8.encode(`${JSON.stringify(command)}\n`);
    const decoder = new LineDecoder();
    let lines = [];
    for (let offset = 0; offset < bytes.length; offset += 20) {
      lines = lines.concat(decoder.push(bytes.slice(offset, offset + 20).buffer));
    }
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(utf8.decode(lines[0])), command);
  }
});

test('clamp truncates by UTF-8 bytes without splitting characters', () => {
  assert.equal(utf8.clamp('a'.repeat(200), 95).length, 95);
  const cjk = utf8.clamp('长'.repeat(40), 95);
  assert.equal(cjk, '长'.repeat(31)); // 93 bytes, the 32nd character would be 96
  assert.equal(utf8.byteLength(cjk), 93);
  const note = utf8.clamp('记'.repeat(80), 191);
  assert.equal(note, '记'.repeat(63)); // 189 bytes, the 64th would be 192
  assert.equal(utf8.byteLength(note), 189);
  assert.equal(utf8.clamp('😀'.repeat(30), 95), '😀'.repeat(23)); // 4 bytes each
  assert.equal(utf8.clamp('', 95), '');
  assert.equal(utf8.clamp('abc', 0), '');
  assert.equal(utf8.clamp('abc', -1), '');
  assert.equal(utf8.clamp(null, 95), '');
});
