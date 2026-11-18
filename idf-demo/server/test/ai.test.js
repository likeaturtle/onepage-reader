'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { buildWav, prepareAudio, transcribe, parseSchedule, localNow } = require('../src/ai');

const NOW = new Date('2026-11-18T13:55:00Z'); // 21:55 in Asia/Shanghai

function makeConfig(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mocheng-calcal-ai-'));
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    wxAppId: '',
    wxSecret: '',
    allowDevLogin: true,
    sessionSecret: 'test-secret',
    tokenTtlDays: 1,
    maxAvatarBytes: 512 * 1024,
    corsOrigin: '*',
    isProd: false,
    defaultSecret: 'dev-only-secret-change-me',
    deepseekApiKey: 'test-key',
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-flash',
    deepseekTimeoutMs: 5000,
    scheduleTimeZone: 'Asia/Shanghai',
    ...overrides,
  };
}

async function withServer(config, fn) {
  const server = createApp(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, config);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  }
}

async function json(base, method, url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function chatReply(content) {
  return { choices: [{ message: { content } }] };
}

function draft(overrides = {}) {
  return {
    date: '2026-11-19',
    start: '15:00',
    end: '15:30',
    title: '项目评审',
    note: '会议室 A',
    ...overrides,
  };
}

test('buildWav writes a valid 16-bit PCM header', () => {
  const pcm = Buffer.alloc(3200); // 100 ms of 16 kHz mono
  const wav = buildWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });

  assert.equal(wav.length, pcm.length + 44);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ');
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(28), 32000);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});

test('buildWav rejects audio longer than the 120 s ASR limit', () => {
  const pcm = Buffer.alloc(8000 * 2 * 121); // 121 s, 8 kHz mono 16-bit
  assert.throws(
    () => buildWav(pcm, { sampleRate: 8000, channels: 1, bitsPerSample: 16 }),
    (err) => err.status === 413 && /120/.test(err.message)
  );
});

test('prepareAudio wraps PCM, passes WAV/Ogg through and rejects bad input', () => {
  const pcm = Buffer.alloc(640);
  const wrapped = prepareAudio({
    data: pcm.toString('base64'),
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
  });
  assert.equal(wrapped.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wrapped.length, pcm.length + 44);

  const wav = buildWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });
  assert.deepEqual(prepareAudio({ data: wav.toString('base64') }), wav);

  const ogg = Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(64)]);
  assert.deepEqual(prepareAudio({ data: ogg.toString('base64') }), ogg);

  assert.throws(() => prepareAudio({ data: 'not base64!' }), { status: 400 });
  assert.throws(() => prepareAudio({ data: Buffer.alloc(640).toString('base64'), sampleRate: 12345 }), {
    status: 400,
  });
  assert.throws(() => prepareAudio({ data: 'AAAA', sampleRate: 16000, channels: 1, bitsPerSample: 16 }), {
    status: 400,
  });
});

test('localNow resolves the configured time zone', () => {
  const current = localNow(NOW, 'Asia/Shanghai');
  assert.deepEqual(current, { date: '2026-11-18', time: '21:55', weekday: '星期三' });
  const utc = localNow(NOW, 'UTC');
  assert.equal(utc.date, '2026-11-18');
  assert.equal(utc.time, '13:55');
});

test('transcribe uploads a WAV file and trims the recognized text', async () => {
  const pcm = Buffer.alloc(16000);
  let captured = null;
  const config = makeConfig({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ text: ' 明天下午三点项目评审 ', duration_ms: 3200, request_id: 'req-1' });
    },
  });

  const result = await transcribe(config, {
    data: pcm.toString('base64'),
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
  });

  assert.deepEqual(result, {
    text: '明天下午三点项目评审',
    durationMs: 3200,
    requestId: 'req-1',
  });
  assert.equal(captured.url, 'https://api.deepseek.com/v1/tools/asr');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.authorization, 'Bearer test-key');
  assert.ok(captured.options.body instanceof FormData);
  // The ASR contract: one multipart `file` field, no language parameter, and a
  // 16-bit PCM WAV at a supported sample rate / channel count.
  assert.deepEqual([...captured.options.body.keys()], ['file']);
  const file = captured.options.body.get('file');
  assert.equal(file.name, 'speech.wav');
  assert.equal(file.type, 'audio/wav');
  assert.equal(file.size, pcm.length + 44);
  assert.ok(file.size <= 8 * 1024 * 1024);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(20), 1); // PCM
  assert.equal(bytes.readUInt16LE(22), 1); // mono
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.readUInt32LE(40), pcm.length);
});

test('transcribe maps DeepSeek errors to friendly HTTP errors', async () => {
  const audio = { data: Buffer.alloc(320).toString('base64'), sampleRate: 16000, channels: 1, bitsPerSample: 16 };

  await assert.rejects(
    transcribe(makeConfig({ fetchImpl: async () => response({}, 429) }), audio),
    (err) => err.status === 429 && /频繁/.test(err.message)
  );
  await assert.rejects(
    transcribe(makeConfig({ fetchImpl: async () => response({}, 401) }), audio),
    (err) => err.status === 500 && /API Key/.test(err.message)
  );
  await assert.rejects(
    transcribe(makeConfig({ fetchImpl: async () => response({ text: '' }) }), audio),
    (err) => err.status === 422 && /没有识别到/.test(err.message)
  );
  await assert.rejects(
    transcribe(makeConfig({ fetchImpl: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); } }), audio),
    (err) => err.status === 504
  );
  await assert.rejects(
    transcribe(makeConfig({ deepseekApiKey: '' }), audio),
    (err) => err.status === 503 && /DEEPSEEK_API_KEY/.test(err.message)
  );
});

test('parseSchedule sends local time context and normalizes the draft', async () => {
  let captured = null;
  const config = makeConfig({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response(chatReply(JSON.stringify(draft())));
    },
  });

  const event = await parseSchedule(config, '明天下午三点项目评审，会议室 A', NOW);

  assert.deepEqual(event, {
    date: '2026-11-19',
    start: '15:00',
    end: '15:30',
    title: '项目评审',
    note: '会议室 A',
  });
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.options.headers.authorization, 'Bearer test-key');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[1].content, '明天下午三点项目评审，会议室 A');
  assert.match(body.messages[0].content, /2026-11-18 21:55/);
  assert.match(body.messages[0].content, /星期三/);
  assert.match(body.messages[0].content, /ASR 会按停顿自动加句号/);
  assert.match(body.messages[0].content, /只取第一件/);
  assert.match(body.messages[0].content, /明天 2026-11-19/);
  assert.match(body.messages[0].content, /后天 2026-11-20/);
  assert.match(body.messages[0].content, /大后天 2026-11-21/);
  assert.match(body.messages[0].content, /没有提日期时默认今天/);
});

test('parseSchedule strips trailing sentence punctuation from the title', async () => {
  const config = makeConfig({
    fetchImpl: async () => response(chatReply(JSON.stringify(draft({ title: '项目评审。' })))),
  });

  const event = await parseSchedule(config, '明天下午三点项目评审。', NOW);

  assert.equal(event.title, '项目评审');
});

test('parseSchedule defaults to deepseek-flash and disables thinking', async () => {
  let captured = null;
  const config = makeConfig({
    deepseekModel: '',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response(chatReply(JSON.stringify(draft())));
    },
  });

  await parseSchedule(config, '明天下午三点项目评审', NOW);

  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('parseSchedule accepts fenced JSON, fixes the end time and falls back to the text title', async () => {
  const config = makeConfig({
    fetchImpl: async () => response(chatReply(
      '```json\n' + JSON.stringify({ date: '2026-11-19', start: '23:40', end: '23:00', title: '', note: '' }) + '\n```'
    )),
  });

  const event = await parseSchedule(config, '今晚十一点四十收尾', NOW);
  assert.equal(event.date, '2026-11-19');
  assert.equal(event.start, '23:40');
  assert.equal(event.end, '24:00');
  assert.equal(event.title, '今晚十一点四十收尾');

  // A short prefix around an object is recovered instead of failing the request.
  const prefixed = makeConfig({
    fetchImpl: async () => response(chatReply('结果如下：' + JSON.stringify(draft()))),
  });
  const recovered = await parseSchedule(prefixed, '明天下午三点项目评审', NOW);
  assert.equal(recovered.title, '项目评审');
});

test('parseSchedule rejects malformed JSON and unusable dates', async () => {
  await assert.rejects(
    parseSchedule(makeConfig({ fetchImpl: async () => response(chatReply('不是 JSON')) }), '明天开会', NOW),
    (err) => err.status === 502 && /格式不正确/.test(err.message)
  );
  await assert.rejects(
    parseSchedule(makeConfig({
      fetchImpl: async () => response(chatReply(JSON.stringify(draft({ date: '2026-02-31' })))),
    }), '2 月 31 日开会', NOW),
    (err) => err.status === 422 && /没能理解/.test(err.message)
  );
  await assert.rejects(
    parseSchedule(makeConfig({ deepseekApiKey: '' }), '明天开会', NOW),
    (err) => err.status === 503
  );
});

test('voice endpoints require login and proxy DeepSeek', async () => {
  const config = makeConfig({
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/tools/asr')) {
        return response({ text: '明天下午三点项目评审', duration_ms: 1200, request_id: 'req-1' });
      }
      return response(chatReply(JSON.stringify(draft())));
    },
  });

  await withServer(config, async (base) => {
    const unauth = await json(base, 'POST', '/api/ai/transcribe', { audio: 'AAAA' });
    assert.equal(unauth.status, 401);

    const health = await json(base, 'GET', '/api/health');
    assert.equal(health.body.ai, true);

    const login = await json(base, 'POST', '/api/login', { dev: true });
    const token = login.body.token;

    const asr = await json(base, 'POST', '/api/ai/transcribe', {
      audio: Buffer.alloc(320).toString('base64'),
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
    }, token);
    assert.equal(asr.status, 200);
    assert.equal(asr.body.text, '明天下午三点项目评审');

    const parsed = await json(base, 'POST', '/api/ai/schedule', {
      text: '明天下午三点项目评审，会议室 A',
    }, token);
    assert.equal(parsed.status, 200);
    assert.deepEqual(parsed.body.event, {
      date: '2026-11-19',
      start: '15:00',
      end: '15:30',
      title: '项目评审',
      note: '会议室 A',
    });

    const empty = await json(base, 'POST', '/api/ai/schedule', { text: '   ' }, token);
    assert.equal(empty.status, 400);
  });
});

test('voice endpoints report a missing DeepSeek key instead of calling out', async () => {
  const config = makeConfig({ deepseekApiKey: '' });
  await withServer(config, async (base) => {
    const health = await json(base, 'GET', '/api/health');
    assert.equal(health.body.ai, false);

    const login = await json(base, 'POST', '/api/login', { dev: true });
    const res = await json(base, 'POST', '/api/ai/schedule', { text: '明天开会' }, login.body.token);
    assert.equal(res.status, 503);
    assert.match(res.body.error, /DEEPSEEK_API_KEY/);
  });
});
