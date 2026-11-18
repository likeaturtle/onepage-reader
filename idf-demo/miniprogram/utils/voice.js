'use strict';

/**
 * RecorderManager wrapper for the voice schedule card.
 *
 * WeChat records 16-bit mono PCM at 16 kHz and leaves the file headerless; the
 * server adds a WAV header before calling DeepSeek ASR. The recorder API is
 * event based, so the page receives callbacks instead of awaiting a promise:
 *
 *   createRecorder({ onStart, onStop, onCancel, onError })
 *   start()   -> Promise (resolves once recording actually starts)
 *   stop()    -> ask the recorder to stop; onStop delivers the audio
 *   cancel()  -> discard the current recording; onCancel fires instead
 *
 * `onStop` receives { base64, durationMs, sampleRate, channels, bitsPerSample }.
 */

const MAX_DURATION_MS = 60 * 1000;
const MIN_DURATION_MS = 800;
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function permissionError() {
  const err = new Error('需要麦克风权限才能录制语音');
  err.code = 'permission';
  return err;
}

function ensurePermission() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getSetting !== 'function') {
      reject(new Error('当前环境不支持麦克风权限检查'));
      return;
    }
    wx.getSetting({
      success(res) {
        const setting = res && res.authSetting ? res.authSetting['scope.record'] : undefined;
        if (setting === true) {
          resolve();
          return;
        }
        if (setting === false) {
          reject(permissionError());
          return;
        }
        if (typeof wx.authorize !== 'function') {
          resolve(); // let the recorder surface its own permission error
          return;
        }
        wx.authorize({
          scope: 'scope.record',
          success: () => resolve(),
          fail: () => reject(permissionError()),
        });
      },
      fail: () => reject(new Error('无法读取麦克风权限，请重试')),
    });
  });
}

function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function') {
      reject(new Error('无法读取录音文件，请重试'));
      return;
    }
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success(res) {
        const data = res && res.data;
        if (typeof data !== 'string' || !data) {
          reject(new Error('录音文件为空，请重试'));
          return;
        }
        resolve(data);
      },
      fail: () => reject(new Error('读取录音失败，请重试')),
    });
  });
}

function createRecorder(options) {
  const opts = options || {};
  let manager = null;
  let active = false;
  let started = false;
  let stopRequested = false;
  let cancelled = false;
  let startedAt = 0;
  let pendingStart = null;
  let disposed = false;

  function emit(name, value) {
    if (typeof opts[name] === 'function') opts[name](value);
  }

  function reset() {
    active = false;
    started = false;
    stopRequested = false;
    cancelled = false;
    startedAt = 0;
  }

  function settleStart(err) {
    if (!pendingStart) return;
    const pending = pendingStart;
    pendingStart = null;
    clearTimeout(pending.timer);
    if (err) pending.reject(err);
    else pending.resolve();
  }

  function fail(err) {
    const wasStarting = Boolean(pendingStart);
    reset();
    settleStart(err);
    // Errors during start() reject that promise and are shown by the caller;
    // only failures while recording need the onError channel.
    if (!wasStarting) emit('onError', err);
  }

  function getManager() {
    if (!manager) {
      manager = wx.getRecorderManager();
      if (typeof manager.onStart === 'function') manager.onStart(handleStart);
      if (typeof manager.onStop === 'function') manager.onStop(handleStop);
      if (typeof manager.onError === 'function') manager.onError(handleError);
      if (typeof manager.onInterruptionBegin === 'function') {
        manager.onInterruptionBegin(handleInterruption);
      }
    }
    return manager;
  }

  function handleStart() {
    if (disposed || !active) return;
    started = true;
    startedAt = Date.now();
    settleStart(null);
    emit('onStart');
    // The user may have released before the recorder actually started.
    if (stopRequested) stopRecording();
  }

  function handleStop(result) {
    if (disposed || !active) return;
    const duration = Math.max(
      Number(result && result.duration) || 0,
      startedAt ? Date.now() - startedAt : 0
    );
    const filePath = result && result.tempFilePath;
    const wasCancelled = cancelled;
    reset();

    if (wasCancelled) {
      emit('onCancel');
      return;
    }
    if (!filePath) {
      emit('onError', new Error('录音文件不存在，请重试'));
      return;
    }
    if (duration && duration < MIN_DURATION_MS) {
      const err = new Error('录音太短，请按住多说几句');
      err.code = 'tooShort';
      emit('onError', err);
      return;
    }
    readBase64(filePath)
      .then((base64) => {
        if (disposed) return;
        emit('onStop', {
          base64,
          durationMs: duration,
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
          bitsPerSample: BITS_PER_SAMPLE,
        });
      })
      .catch((err) => {
        if (!disposed) emit('onError', err);
      });
  }

  function handleError(raw) {
    if (disposed || !active) return;
    const message = String((raw && (raw.errMsg || raw.message)) || '');
    const err = new Error('录音失败，请重试');
    if (/auth|permission|deny|denied|scope/i.test(message)) {
      err.message = '麦克风权限未开启，请在设置中允许';
      err.code = 'permission';
    } else if (/busy|占用/i.test(message)) {
      err.message = '麦克风正忙，请稍后再试';
    } else if (/interrupt/i.test(message)) {
      err.message = '录音被中断，请重试';
    }
    fail(err);
  }

  function handleInterruption() {
    if (disposed || !active) return;
    cancelled = true;
    if (!started) {
      stopRequested = true;
      return;
    }
    try {
      getManager().stop();
    } catch (_) {
      reset();
      emit('onCancel');
    }
  }

  function stopRecording() {
    if (!active) return;
    if (!started) {
      stopRequested = true;
      return;
    }
    try {
      getManager().stop();
    } catch (_) {
      fail(new Error('停止录音失败，请重试'));
    }
  }

  function start() {
    if (disposed) return Promise.reject(new Error('录音已关闭'));
    if (active) return Promise.resolve();
    if (typeof wx === 'undefined' || typeof wx.getRecorderManager !== 'function') {
      return Promise.reject(new Error('当前环境不支持录音，请在微信中打开'));
    }

    active = true;
    started = false;
    stopRequested = false;
    cancelled = false;
    startedAt = 0;

    return ensurePermission()
      .then(() => new Promise((resolve, reject) => {
        if (disposed) {
          active = false;
          reject(new Error('录音已关闭'));
          return;
        }
        pendingStart = {
          resolve,
          reject,
          timer: setTimeout(() => {
            const err = new Error('录音启动超时，请重试');
            fail(err);
            try {
              getManager().stop();
            } catch (_) {
              // the timeout already rejected start()
            }
          }, 5000),
        };
        try {
          getManager().start({
            duration: MAX_DURATION_MS,
            sampleRate: SAMPLE_RATE,
            numberOfChannels: CHANNELS,
            encodeBitRate: 48000,
            format: 'PCM',
          });
        } catch (_) {
          fail(new Error('录音启动失败，请重试'));
        }
      }))
      .catch((err) => {
        if (active && !started) reset();
        throw err;
      });
  }

  function cancel() {
    if (!active) return;
    cancelled = true;
    if (!started) {
      stopRequested = true;
      return;
    }
    try {
      getManager().stop();
    } catch (_) {
      reset();
      emit('onCancel');
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const wasActive = active;
    if (wasActive) {
      cancelled = true;
      if (started) {
        try {
          getManager().stop();
        } catch (_) {
          // the page is going away; no callback is needed
        }
      }
    }
    reset();
    settleStart(new Error('录音已关闭'));

    const current = manager;
    manager = null;
    if (!current) return;
    if (typeof current.offStart === 'function') current.offStart(handleStart);
    if (typeof current.offStop === 'function') current.offStop(handleStop);
    if (typeof current.offError === 'function') current.offError(handleError);
    if (typeof current.offInterruptionBegin === 'function') {
      current.offInterruptionBegin(handleInterruption);
    }
  }

  return {
    start,
    stop: stopRecording,
    cancel,
    dispose,
    isActive: () => active,
  };
}

module.exports = {
  createRecorder,
  ensurePermission,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  SAMPLE_RATE,
  CHANNELS,
  BITS_PER_SAMPLE,
};
