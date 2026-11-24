'use strict';

/**
 * Voice card interactions in pages/index/index.js. api / ble / auth / voice are
 * replaced with small fakes so the page runs without the WeChat runtime.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'pages', 'index', 'index.js');
const blePath = require.resolve('../utils/ble');
const apiPath = require.resolve('../utils/api');
const authPath = require.resolve('../utils/auth');
const voicePath = require.resolve('../utils/voice');
const deviceSyncPath = require.resolve('../utils/device-sync');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function makePage(options = {}) {
  let definition = null;
  let recorderCallbacks = null;
  const calls = {
    start: 0,
    stop: 0,
    cancel: 0,
    dispose: 0,
    transcribe: [],
    parseSchedule: [],
    createEvent: [],
    toasts: [],
    modals: [],
    scroll: [],
    openSetting: 0,
  };

  const addCardRect = options.addCardRect || { top: 500, height: 600 };
  const pageScrollTop = Number(options.scrollTop) || 0;
  const windowHeight = Number(options.windowHeight) || 700;

  global.Page = (value) => { definition = value; };
  global.wx = {
    showToast(opts) { calls.toasts.push(opts.title); },
    showModal(opts) { calls.modals.push(opts); },
    openSetting() { calls.openSetting += 1; },
    reLaunch() {},
    switchTab() {},
    getWindowInfo: () => ({ windowHeight }),
    pageScrollTo(opts) { calls.scroll.push(opts); },
    createSelectorQuery() {
      let found = null;
      let view = null;
      return {
        select(selector) {
          return {
            boundingClientRect() {
              found = selector === '#add-card' ? addCardRect : null;
              return this;
            },
          };
        },
        selectViewport() {
          return { scrollOffset() { view = { scrollTop: pageScrollTop }; return this; } };
        },
        exec(callback) { callback([found, view]); },
      };
    },
  };

  require.cache[blePath] = {
    id: blePath,
    filename: blePath,
    loaded: true,
    exports: {
      onState() { return () => {}; },
      onMessage() { return () => {}; },
      isConnected: () => false,
      stopScan: () => Promise.resolve(),
      hello: () => Promise.resolve(null),
    },
  };
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: {
      me: () => Promise.resolve({ user: {} }),
      transcribe(audio, meta) {
        calls.transcribe.push({ audio, meta });
        if (options.transcribeError) return Promise.reject(options.transcribeError);
        return options.transcribe
          ? Promise.resolve(options.transcribe)
          : Promise.resolve({ text: '明天下午三点项目评审' });
      },
      parseSchedule(text) {
        calls.parseSchedule.push(text);
        if (options.parseError) return Promise.reject(options.parseError);
        if (options.parseSchedule) return options.parseSchedule;
        return Promise.resolve({
          date: '2026-11-19',
          start: '15:00',
          end: '15:30',
          title: '项目评审',
          note: '会议室 A',
        });
      },
      createEvent(event) {
        calls.createEvent.push(event);
        if (options.createError) return Promise.reject(options.createError);
        return Promise.resolve(Object.assign({ id: 'event-1' }, event));
      },
      mapDevice: () => Promise.resolve({}),
    },
  };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      get: () => ({ token: 'token', user: {} }),
      getToken: () => 'token',
      getUser: () => ({}),
      isGuest: () => false,
      setUser() {},
    },
  };
  require.cache[voicePath] = {
    id: voicePath,
    filename: voicePath,
    loaded: true,
    exports: {
      ensurePermission() {
        if (options.ensurePermission) return options.ensurePermission();
        return Promise.resolve();
      },
      createRecorder(callbacks) {
        recorderCallbacks = callbacks;
        return {
          start() {
            calls.start += 1;
            if (options.startError) return Promise.reject(options.startError);
            return Promise.resolve();
          },
          stop() { calls.stop += 1; },
          cancel() { calls.cancel += 1; },
          dispose() { calls.dispose += 1; },
        };
      },
    },
  };
  delete require.cache[deviceSyncPath];
  delete require.cache[pagePath];
  require(pagePath);

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      for (const key of Object.keys(patch)) {
        if (key.indexOf('.') < 0) {
          this.data[key] = patch[key];
          continue;
        }
        const [head, tail] = key.split('.');
        this.data[head] = Object.assign({}, this.data[head], { [tail]: patch[key] });
      }
      if (typeof callback === 'function') callback();
    },
  });
  page.calls = calls;
  page.emit = (name, value) => {
    if (recorderCallbacks && typeof recorderCallbacks[name] === 'function') {
      recorderCallbacks[name](value);
    }
  };
  return page;
}

test('recording fills the text box with the recognized sentence', async () => {
  const page = makePage();
  page.onLoad();

  page.startVoice();
  await tick();
  assert.equal(page.calls.start, 1);
  assert.equal(page.data.voiceStatus, '正在准备麦克风…');

  page.emit('onStart');
  page.stopVoiceTimer();
  assert.equal(page.data.voiceRecording, true);
  assert.equal(page.data.voiceButtonLabel, '松开 发送');

  page.emit('onStop', {
    base64: 'AAAA',
    durationMs: 2000,
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
  });
  assert.equal(page.data.voiceRecording, false);
  await tick();

  assert.deepEqual(page.calls.transcribe, [{
    audio: 'AAAA',
    meta: { format: 'pcm', sampleRate: 16000, channels: 1, bitsPerSample: 16 },
  }]);
  assert.equal(page.data.voiceText, '明天下午三点项目评审');
  assert.equal(page.data.voicePhase, '');
  assert.equal(page.data.voiceStatus, '识别完成，可以修改后解析');
});

test('the hold button doubles as the recording progress bar', () => {
  const page = makePage();
  page.onLoad();

  page.emit('onStart');
  // Pin the clock instead of waiting, so the fill percentage is exact.
  page.voiceStartedAt = Date.now() - 12300;
  page.updateVoiceTimer();
  assert.equal(page.data.voiceRecording, true);
  assert.equal(page.data.voiceSeconds, 12);
  assert.equal(page.data.voiceElapsed, '0:12');
  // 12.3 s of the 60 s limit.
  assert.ok(page.data.voiceProgress >= 20.4 && page.data.voiceProgress <= 20.6);

  page.voiceStartedAt = Date.now() - 65000;
  page.updateVoiceTimer();
  assert.equal(page.data.voiceSeconds, 60);
  assert.equal(page.data.voiceElapsed, '1:00');
  assert.equal(page.data.voiceProgress, 100);
  // Built in JS: the style attribute binds one string, because an expression
  // inside inset() trips the WXML/CSS checker.
  assert.equal(
    page.data.voiceClipStyle,
    'clip-path: inset(0 0% 0 0); -webkit-clip-path: inset(0 0% 0 0)'
  );

  page.stopVoiceTimer();
  assert.equal(page.data.voiceProgress, 0);
  assert.equal(page.data.voiceElapsed, '0:00');
  assert.equal(
    page.data.voiceClipStyle,
    'clip-path: inset(0 100% 0 0); -webkit-clip-path: inset(0 100% 0 0)'
  );
});

test('a failed transcription keeps the phase idle and shows the message', async () => {
  const page = makePage({ transcribeError: new Error('语音识别太频繁，请稍后再试') });
  page.onLoad();

  page.startVoice();
  await tick();
  page.emit('onStart');
  page.stopVoiceTimer();
  page.emit('onStop', {
    base64: 'AAAA',
    durationMs: 2000,
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
  });
  await tick();

  assert.equal(page.data.voiceError, '语音识别太频繁，请稍后再试');
  assert.equal(page.data.voicePhase, '');
  assert.equal(page.data.voiceRecording, false);
});

test('confirming fills the add form but does not save it', async () => {
  const page = makePage();
  page.onLoad();
  page.setData({ voiceText: '明天下午三点项目评审，会议室 A' });

  const result = await page.confirmVoice();

  assert.equal(result, true);
  assert.deepEqual(page.calls.parseSchedule, ['明天下午三点项目评审，会议室 A']);
  // The AI only fills the form; 保存日程 is the commit step.
  assert.equal(page.calls.createEvent.length, 0);
  assert.deepEqual(page.data.form, {
    date: '2026-11-19',
    start: '15:00',
    end: '15:30',
    title: '项目评审',
    note: '会议室 A',
  });
  assert.equal(page.data.titleBytes, Buffer.byteLength('项目评审'));
  assert.equal(page.data.noteBytes, Buffer.byteLength('会议室 A'));
  assert.equal(page.data.voiceText, '明天下午三点项目评审，会议室 A');
  assert.equal(page.data.voiceFilled, true);
  assert.equal(page.data.voicePhase, '');
  assert.equal(page.data.voiceStatus, '已填入下方表单，确认后保存');
  // The card (600 px) fits the 700 px viewport, so the page scrolls just
  // enough to show its bottom edge: 500 + 600 + 12 - 700 = 412.
  assert.deepEqual(page.calls.scroll, [{ scrollTop: 412, duration: 200 }]);
});

test('saving the filled form creates the event and clears the voice state', async () => {
  const page = makePage();
  page.onLoad();
  page.setData({ voiceText: '明天下午三点项目评审，会议室 A' });

  await page.confirmVoice();
  assert.equal(page.calls.createEvent.length, 0);

  const saved = await page.submit();

  assert.equal(saved, true);
  assert.deepEqual(page.calls.createEvent, [{
    date: '2026-11-19',
    start: '15:00',
    end: '15:30',
    title: '项目评审',
    note: '会议室 A',
  }]);
  assert.equal(page.data.voiceText, '');
  assert.equal(page.data.voiceFilled, false);
  assert.equal(page.data.voiceStatus, '已保存，可以继续说下一条');
  assert.match(page.calls.toasts.join('|'), /未连蓝牙/);
});

test('the user can edit the AI-filled form before saving', async () => {
  const page = makePage();
  page.onLoad();
  page.setData({ voiceText: '明天下午三点项目评审' });

  await page.confirmVoice();
  page.onTitle({ detail: { value: '项目评审（改）' } });
  page.onStart({ detail: { value: '16:00' } }); // end follows to 16:30

  await page.submit();

  assert.deepEqual(page.calls.createEvent[0], {
    date: '2026-11-19',
    start: '16:00',
    end: '16:30',
    title: '项目评审（改）',
    note: '会议室 A',
  });
});

test('confirming without text neither calls the AI nor saves', async () => {
  const page = makePage();
  page.onLoad();

  const result = await page.confirmVoice();

  assert.equal(result, false);
  assert.equal(page.calls.parseSchedule.length, 0);
  assert.equal(page.calls.createEvent.length, 0);
  assert.equal(page.data.voiceError, '请先输入或说出日程内容');
});

test('a parse failure keeps the text for editing', async () => {
  const page = makePage({ parseError: new Error('AI 没能理解这条日程') });
  page.onLoad();
  page.setData({ voiceText: '随便说点什么' });

  await page.confirmVoice();

  assert.equal(page.calls.createEvent.length, 0);
  assert.equal(page.data.voiceText, '随便说点什么');
  assert.equal(page.data.voiceError, 'AI 没能理解这条日程');
  assert.equal(page.data.voicePhase, '');
});

test('a save failure keeps the filled form and voice text for retry', async () => {
  const page = makePage({ createError: new Error('网络断开') });
  page.onLoad();
  page.setData({ voiceText: '明天下午三点项目评审' });

  await page.confirmVoice();
  assert.equal(page.calls.createEvent.length, 0);
  assert.equal(page.data.voiceFilled, true);

  const saved = await page.submit();

  assert.equal(saved, false);
  assert.equal(page.calls.createEvent.length, 1);
  assert.equal(page.data.voiceText, '明天下午三点项目评审');
  assert.equal(page.data.voiceFilled, true);
  assert.equal(page.data.voiceStatus, '保存失败，请检查后重试');
  assert.equal(page.data.voicePhase, '');
  assert.equal(page.data.error, '网络断开');
});

test('a permission error opens the microphone help dialog', async () => {
  const err = new Error('需要麦克风权限才能录制语音');
  err.code = 'permission';
  const page = makePage({ startError: err });
  page.onLoad();

  page.startVoice();
  await tick();

  assert.equal(page.calls.modals.length, 1);
  assert.match(page.calls.modals[0].title, /麦克风/);
  assert.equal(page.data.voiceRecording, false);
  assert.equal(page.data.voiceStatus, '说一句，AI 帮你填好');

  page.calls.modals[0].success({ confirm: true });
  assert.equal(page.calls.openSetting, 1);
});

test('the voice text is clamped to 500 characters', () => {
  const page = makePage();
  page.setData({ voiceError: '旧错误' });

  page.onVoiceText({ detail: { value: '长'.repeat(600) } });

  assert.equal(page.data.voiceText.length, 500);
  assert.equal(page.data.voiceError, '');
});

test('cancelling the hold gesture stops the recorder without transcribing', async () => {
  const page = makePage();
  page.onLoad();
  page.startVoice();
  await tick();
  page.emit('onStart');
  page.stopVoiceTimer();

  page.onVoiceTouchCancel();

  assert.equal(page.calls.cancel, 1);
  assert.equal(page.data.voicePhase, '');
  assert.equal(page.data.voiceStatus, '已取消录音');
});

test('leaving the page cancels an in-flight recording', async () => {
  const page = makePage();
  page.onLoad();
  page.startVoice();
  await tick();
  page.emit('onStart');
  page.stopVoiceTimer();

  page.onHide();

  assert.equal(page.calls.cancel, 1);
});

test('releasing while the permission prompt is open does not start a recording', async () => {
  let grant = null;
  const page = makePage({
    ensurePermission: () => new Promise((resolve) => { grant = resolve; }),
  });
  page.onLoad();

  page.startVoice();
  page.stopVoice(); // release while the system prompt is still open
  grant();
  await tick();

  assert.equal(page.calls.start, 0);
  assert.equal(page.data.voiceStatus, '麦克风已授权，请按住说话');
  assert.equal(page.data.voiceRecording, false);
});

test('the manual save is blocked while the voice card owns the form', async () => {
  const page = makePage();
  page.onLoad();
  page.setData({
    voicePhase: 'parsing',
    form: { date: '2026-11-19', start: '09:00', end: '10:00', title: '手动标题', note: '' },
  });

  const result = await page.submit();

  assert.equal(result, false);
  assert.equal(page.calls.createEvent.length, 0);
});

test('an add form that is already fully visible does not scroll', async () => {
  const page = makePage({
    addCardRect: { top: 100, height: 300 },
    scrollTop: 50,
  });
  page.onLoad();
  page.setData({ voiceText: '明天下午三点项目评审' });

  await page.confirmVoice();

  assert.deepEqual(page.calls.scroll, []);
});

test('an add form taller than the screen aligns its top edge', async () => {
  const page = makePage({
    addCardRect: { top: 400, height: 900 },
    scrollTop: 50,
  });
  page.onLoad();
  page.setData({ voiceText: '明天下午三点项目评审' });

  await page.confirmVoice();

  assert.deepEqual(page.calls.scroll, [{ scrollTop: 438, duration: 200 }]);
});
