'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const voicePath = require.resolve('../utils/voice');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function makeRuntime(options = {}) {
  const handlers = {};
  const calls = { start: [], stop: 0, authorize: 0, read: [] };
  const manager = {
    onStart(cb) { handlers.start = cb; },
    onStop(cb) { handlers.stop = cb; },
    onError(cb) { handlers.error = cb; },
    onInterruptionBegin(cb) { handlers.interruption = cb; },
    offStart(cb) { if (handlers.start === cb) delete handlers.start; },
    offStop(cb) { if (handlers.stop === cb) delete handlers.stop; },
    offError(cb) { if (handlers.error === cb) delete handlers.error; },
    offInterruptionBegin(cb) { if (handlers.interruption === cb) delete handlers.interruption; },
    start(opts) { calls.start.push(opts); },
    stop() { calls.stop += 1; },
  };

  global.wx = {
    getSetting({ success }) {
      const setting = options.setting;
      success({ authSetting: setting === undefined ? {} : { 'scope.record': setting } });
    },
    authorize({ success, fail }) {
      calls.authorize += 1;
      if (options.authorize === false) fail({ errMsg: 'authorize:fail auth deny' });
      else success();
    },
    getRecorderManager() { return manager; },
    getFileSystemManager() {
      return {
        readFile(opts) {
          calls.read.push(opts.filePath);
          if (options.readFails) opts.fail({ errMsg: 'readFile:fail' });
          else opts.success({ data: options.base64 || 'UklGRg==' });
        },
      };
    },
  };

  delete require.cache[voicePath];
  const mod = require(voicePath);
  return { mod, handlers, calls, manager };
}

test('starting records 16 kHz mono PCM and stopping returns base64 audio', async () => {
  const rt = makeRuntime();
  const events = [];
  const recorder = rt.mod.createRecorder({
    onStart: () => events.push('start'),
    onStop: (audio) => events.push(audio),
    onError: (err) => events.push(err),
  });

  const started = recorder.start();
  await tick();
  assert.equal(rt.calls.start.length, 1);
  assert.equal(rt.calls.start[0].format, 'PCM');
  assert.equal(rt.calls.start[0].sampleRate, 16000);
  assert.equal(rt.calls.start[0].numberOfChannels, 1);
  assert.equal(rt.calls.start[0].duration, 60000);

  rt.handlers.start();
  await started;
  assert.deepEqual(events, ['start']);

  recorder.stop();
  assert.equal(rt.calls.stop, 1);
  rt.handlers.stop({ tempFilePath: 'voice.pcm', duration: 2500 });
  await tick();

  assert.equal(events.length, 2);
  assert.deepEqual(events[1], {
    base64: 'UklGRg==',
    durationMs: 2500,
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
  });
  assert.deepEqual(rt.calls.read, ['voice.pcm']);
});

test('a release before onStart still stops the recorder once it starts', async () => {
  const rt = makeRuntime();
  const events = [];
  const recorder = rt.mod.createRecorder({
    onStart: () => events.push('start'),
    onStop: (audio) => events.push(audio),
  });

  const started = recorder.start();
  recorder.stop(); // user already lifted the finger
  await tick();
  assert.equal(rt.calls.stop, 0);

  rt.handlers.start();
  await started;
  assert.equal(rt.calls.stop, 1);

  rt.handlers.stop({ tempFilePath: 'voice.pcm', duration: 1200 });
  await tick();
  assert.equal(events.length, 2);
  assert.equal(events[1].durationMs, 1200);
});

test('denied permission rejects start without touching the recorder', async () => {
  const rt = makeRuntime({ setting: false });
  const errors = [];
  const recorder = rt.mod.createRecorder({ onError: (err) => errors.push(err) });

  await assert.rejects(recorder.start(), (err) => err.code === 'permission');
  assert.equal(rt.calls.start.length, 0);
  assert.equal(errors.length, 0); // the caller shows the permission dialog
});

test('an unknown permission asks wx.authorize first', async () => {
  const rt = makeRuntime({ setting: undefined });
  const recorder = rt.mod.createRecorder({});
  const started = recorder.start();
  await tick();
  assert.equal(rt.calls.authorize, 1);
  assert.equal(rt.calls.start.length, 1);
  rt.handlers.start();
  await started;
});

test('short recordings report tooShort instead of uploading', async () => {
  const rt = makeRuntime();
  const errors = [];
  const recorder = rt.mod.createRecorder({ onError: (err) => errors.push(err) });

  const started = recorder.start();
  await tick();
  rt.handlers.start();
  await started;
  rt.handlers.stop({ tempFilePath: 'voice.pcm', duration: 100 });
  await tick();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'tooShort');
  assert.match(errors[0].message, /太短/);
  assert.equal(rt.calls.read.length, 0);
});

test('cancel discards the recording and only fires onCancel', async () => {
  const rt = makeRuntime();
  const events = [];
  const recorder = rt.mod.createRecorder({
    onStop: () => events.push('stop'),
    onCancel: () => events.push('cancel'),
  });

  const started = recorder.start();
  await tick();
  rt.handlers.start();
  await started;

  recorder.cancel();
  assert.equal(rt.calls.stop, 1);
  rt.handlers.stop({ tempFilePath: 'voice.pcm', duration: 2000 });
  await tick();

  assert.deepEqual(events, ['cancel']);
  assert.equal(rt.calls.read.length, 0);
});

test('a phone-call interruption cancels the recording', async () => {
  const rt = makeRuntime();
  const events = [];
  const recorder = rt.mod.createRecorder({
    onStop: () => events.push('stop'),
    onCancel: () => events.push('cancel'),
  });

  const started = recorder.start();
  await tick();
  rt.handlers.start();
  await started;

  rt.handlers.interruption();
  assert.equal(rt.calls.stop, 1);
  rt.handlers.stop({ tempFilePath: 'voice.pcm', duration: 2000 });
  await tick();
  assert.deepEqual(events, ['cancel']);
});

test('recorder and file errors reach onError with friendly messages', async () => {
  const rt = makeRuntime({ readFails: true });
  const errors = [];
  const recorder = rt.mod.createRecorder({ onError: (err) => errors.push(err) });

  const started = recorder.start();
  await tick();
  rt.handlers.start();
  await started;

  rt.handlers.stop({ tempFilePath: 'voice.pcm', duration: 2000 });
  await tick();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /读取录音失败/);

  const second = recorder.start();
  await tick();
  rt.handlers.start();
  await second;
  rt.handlers.error({ errMsg: 'operateRecorder:fail auth deny' });
  assert.equal(errors.length, 2);
  assert.equal(errors[1].code, 'permission');
});

test('dispose removes the recorder handlers and rejects a pending start', async () => {
  const rt = makeRuntime();
  const recorder = rt.mod.createRecorder({});
  const started = recorder.start();
  await tick();

  recorder.dispose();
  await assert.rejects(started, /录音已关闭/);
  assert.equal(rt.handlers.start, undefined);
  assert.equal(rt.handlers.stop, undefined);
});
