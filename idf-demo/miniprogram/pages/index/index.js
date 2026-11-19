'use strict';

const config = require('../../config');
const ble = require('../../utils/ble');
const auth = require('../../utils/auth');
const api = require('../../utils/api');
const avatar = require('../../utils/avatar');
const deviceSync = require('../../utils/device-sync');
const cal = require('../../utils/calendar');
const eventRules = require('../../utils/event');
const fmt = require('../../utils/format');
const utf8 = require('../../utils/utf8');
const voice = require('../../utils/voice');

const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 120;
const BULK_DELETE_THRESHOLD = 3;
const SCAN_DURATION_MS = 5000;
// The wheel picker this replaced was capped at 2021..2100; keep the calendar
// arrows inside the same practical range instead of allowing any year.
const CAL_YEAR_MIN = 2020;
const CAL_YEAR_MAX = 2099;
// Confirming a start time moves the end time this far ahead; the end picker
// stays editable so the user can override it afterwards.
const AUTO_END_MINUTES = 30;
// The device stores titles/notes in 96/192-byte fields (95/191 usable). The
// inputs are clamped by UTF-8 bytes here, because a character limit would stop
// Chinese text at roughly a third of the budget.
const TITLE_BYTES = eventRules.TITLE_BYTES;
const NOTE_BYTES = eventRules.NOTE_BYTES;
// The spoken sentence is free text for the AI parser, not a device field, so
// cap it by characters and let the server condense it into 95/191 bytes.
const VOICE_TEXT_MAX = 500;

function defaultForm() {
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const hhmm = (date) => `${fmt.pad(date.getHours())}:${fmt.pad(date.getMinutes())}`;
  return {
    date: fmt.ymd(start),
    start: hhmm(start),
    end: fmt.shiftClock(hhmm(start), AUTO_END_MINUTES),
    title: '',
    note: '',
  };
}


function confirmDeviceDeletion(count, looksReset) {
  return new Promise((resolve) => {
    wx.showModal({
      title: looksReset ? '设备日程为空' : '设备上的日程被删除',
      content: looksReset
        ? `设备上没有任何日程，可能是设备重置。检测到云端有 ${count} 条日程，要同时从云端删除吗？取消会把它们重新推回设备。`
        : `检测到设备上有 ${count} 条日程已不存在。要从云端也删除吗？取消会把它们重新推回设备。`,
      confirmText: '删除云端',
      cancelText: '恢复设备',
      confirmColor: '#9c3427',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

function syncBounds() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - SYNC_PAST_DAYS);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + SYNC_FUTURE_DAYS);
  return { from: fmt.ymd(from), to: fmt.ymd(to) };
}

function inWindow(date, bounds) {
  return Boolean(date) && date >= bounds.from && date <= bounds.to;
}

function norm(value) {
  return String(value == null ? '' : value).trim();
}

function sameEvent(deviceEvent, cloudEvent) {
  return norm(deviceEvent.date) === norm(cloudEvent.date) &&
    norm(deviceEvent.start) === norm(cloudEvent.start) &&
    norm(deviceEvent.end) === norm(cloudEvent.end) &&
    norm(deviceEvent.title) === norm(cloudEvent.title) &&
    norm(deviceEvent.note) === norm(cloudEvent.note);
}

Page({
  data: {
    appName: config.appName,
    tagline: config.tagline,
    user: {},
    userInitial: '页',
    userAvatar: '',
    connected: false,
    connecting: false,
    syncing: false,
    scanning: false,
    adapterAvailable: true,
    devices: [],
    showAllDevices: false,
    hasScanned: false,
    hello: null,
    deviceOpen: true,
    deviceTime: '',
    form: { date: '', start: '', end: '', title: '', note: '' },
    weekdays: cal.WEEKDAY_INITIALS,
    calendarOpen: false,
    calendarLabel: '',
    calendarCells: [],
    titleBytes: 0,
    noteBytes: 0,
    titleLimit: TITLE_BYTES,
    noteLimit: NOTE_BYTES,
    voiceText: '',
    voiceRecording: false,
    voiceSeconds: 0,
    // The 70%-wide hold button is also the recording progress bar, so the
    // duration stays visible under the finger that covers the row below.
    voiceProgress: 0,
    voiceElapsed: '0:00',
    voicePhase: '',
    voiceButtonLabel: '按住 说话',
    voiceStatus: '说一句，AI 帮你填好',
    voiceFilled: false,
    voiceError: '',
    busy: false,
    error: '',
    syncError: '',
    logOpen: false,
    logs: [],
    // The pairing code dialog is page-level rather than wx.showModal: a modal
    // shows its `content` inside the input on some WeChat versions, so the
    // hint had to be deleted by hand before typing.
    pairingVisible: false,
    pairingValue: '',
    pairingError: '',
    pairingFocus: false,
  },

  onLoad() {
    this.syncedThisSession = false;
    this.setData({ form: defaultForm() });
    this.syncUser();

    this.offState = ble.onState((state) => {
      const patch = {
        connected: state.connected,
        connecting: state.connecting,
        scanning: state.scanning,
        adapterAvailable: state.adapterAvailable,
      };
      if (state.connected) {
        patch.error = '';
      } else if (state.error) {
        patch.error = state.error;
      }
      if (!state.connected) {
        patch.hello = null;
        patch.deviceTime = '';
        patch.deviceOpen = true; // the scan UI has to be visible again
        if (this.data.connected) {
          // The link just ended (lock/sleep, manual disconnect or a drop).
          // The devices from the old scan are almost certainly asleep or out
          // of range by now, so leave an empty scan list instead of a row that
          // cannot be reconnected.
          patch.devices = [];
          patch.hasScanned = false;
          patch.scanning = false;
        }
        this.syncedThisSession = false;
      } else if (!this.data.connected) {
        // Freshly connected: roll the device card up to its header so the
        // calendar and the add-event form stay in reach. The header tap opens
        // it again, and repeated state events leave that choice alone.
        patch.deviceOpen = false;
      }
      this.setData(patch);
    });

    this.offMessage = ble.onMessage((message) => {
      if (message.ev === 'hello') {
        this.setData({
          hello: message,
          deviceTime: fmt.deviceTime(message),
        });
      }
      // Streamed `ev` lines are already in the cloud list; logging each one
      // would mean 90+ setData calls for a full month.
      if (message.ev !== 'ev') {
        this.logSeq = (this.logSeq || 0) + 1;
        const entry = { id: this.logSeq, line: JSON.stringify(message) };
        this.setData({ logs: this.data.logs.concat([entry]).slice(-40) });
      }
    });

    this.voiceRecorder = voice.createRecorder({
      onStart: () => {
        this.voiceStartedAt = Date.now();
        this.startVoiceTimer();
        this.setData({
          voiceRecording: true,
          voiceSeconds: 0,
          voiceProgress: 0,
          voiceElapsed: '0:00',
          voiceError: '',
          voiceButtonLabel: '松开 发送',
          voiceStatus: '正在录音',
        });
      },
      onStop: (audio) => {
        this.stopVoiceTimer();
        this.setData({ voiceRecording: false, voiceButtonLabel: '按住 说话' });
        this.transcribeVoice(audio);
      },
      onCancel: () => {
        this.stopVoiceTimer();
        this.setData({
          voiceRecording: false,
          voiceButtonLabel: '按住 说话',
          voicePhase: '',
          voiceStatus: '已取消录音',
        });
      },
      onError: (err) => {
        this.stopVoiceTimer();
        this.setData({
          voiceRecording: false,
          voiceButtonLabel: '按住 说话',
          voicePhase: '',
          voiceStatus: '说一句，AI 帮你填好',
          voiceError: (err && err.message) || '录音失败，请重试',
        });
        if (err && err.code === 'permission') this.showRecordPermissionHelp();
      },
    });
  },

  onShow() {
    if (!auth.getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.syncUser();
    api.me()
      .then((res) => {
        auth.setUser(res.user);
        this.syncUser();
      })
      .catch(() => {
        // 401 already redirects from utils/api; network errors keep the cache.
      });

    // The month list lives on the 日程 tab; this page only syncs when a board
    // is connected, so switching there always reads a fresh list.
    if (ble.isConnected() && !this.syncedThisSession && !this.syncing) {
      this.syncDevice();
    }
  },

  onHide() {
    this.scanSession = (this.scanSession || 0) + 1;
    this.clearScanTimer();
    if (this.data.scanning) this.stopScan();
    this.cancelVoiceRecording();
  },

  onUnload() {
    this.scanSession = (this.scanSession || 0) + 1;
    this.clearScanTimer();
    ble.stopScan().catch(() => {});
    if (this.offState) this.offState();
    if (this.offMessage) this.offMessage();
    this.cancelVoiceRecording();
    if (this.voiceRecorder) {
      this.voiceRecorder.dispose();
      this.voiceRecorder = null;
    }
  },

  syncUser() {
    const user = auth.getUser() || {};
    const path = user.avatar || '';
    this.setData({
      user,
      userInitial: fmt.initial(user.nickname || '微信用户'),
      userAvatar: '',
    });
    avatar.resolve(path).then((url) => {
      const current = auth.getUser() || {};
      if ((current.avatar || '') === path) this.setData({ userAvatar: url });
    });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  // --- device -----------------------------------------------------------
  toggleDeviceCard() {
    if (!this.data.connected) return; // the scan UI must stay on screen
    this.setData({ deviceOpen: !this.data.deviceOpen });
  },

  clearScanTimer() {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  },

  sortScannedDevices() {
    const devices = this.data.devices.slice().sort(
      (a, b) => (b.RSSI || -100) - (a.RSSI || -100)
    );
    this.setData({ devices });
  },

  startScan() {
    if (this.data.scanning || this.data.connecting) return;
    this.clearScanTimer();
    const session = (this.scanSession || 0) + 1;
    this.scanSession = session;
    this.setData({ devices: [], error: '', hasScanned: true });

    ble.startScan({
      all: this.data.showAllDevices,
      onDevices: (devices) => {
        if (session !== this.scanSession) return;
        this.setData({ devices });
      },
    }).then(() => {
      // A filter toggle or page hide can invalidate this scan while the
      // native discovery call is still in flight.
      if (session !== this.scanSession) {
        ble.stopScan().catch(() => {});
        return;
      }
      this.scanTimer = setTimeout(() => this.stopScan(), SCAN_DURATION_MS);
    }).catch((err) => {
      if (session !== this.scanSession) return;
      this.setData({ error: err.message, scanning: false });
    });
  },

  stopScan() {
    this.scanSession = (this.scanSession || 0) + 1;
    this.clearScanTimer();
    return ble.stopScan()
      .then(() => this.sortScannedDevices())
      .catch(() => this.sortScannedDevices());
  },

  toggleAllDevices(event) {
    const value = Boolean(event.detail.value);
    this.setData({ showAllDevices: value, devices: [] });
    if (this.data.scanning) {
      this.stopScan()
        .then(() => this.startScan())
        .catch(() => {});
    }
  },

  connect(event) {
    const deviceId = event.currentTarget.dataset.id;
    if (!deviceId || this.data.connecting) return;
    this.scanSession = (this.scanSession || 0) + 1;
    this.clearScanTimer();
    this.setData({ connecting: true, error: '' });
    ble.connect(deviceId, {
      requestPairingCode: (info) => this.requestPairingCode(info),
    })
      .then((hello) => {
        this.setData({ hello, deviceTime: fmt.deviceTime(hello) });
        return this.claimDevice(hello).then((device) => {
          if (!device) return null;
          wx.showToast({ title: '已连接，正在同步', icon: 'none' });
          return this.syncDevice();
        });
      })
      .catch((err) => this.setData({ error: err.message }))
      .then(() => this.setData({ connecting: false }));
  },

  // BLE auth proves this phone has the device key; the claim records which
  // WeChat account owns the physical device. The random `did` is only revealed
  // inside the authenticated hello, so it cannot be claimed from a distance.
  claimDevice(hello) {
    const did = String(hello.did || '');
    if (!did) {
      this.setData({ error: '设备身份缺失，请升级固件后重试' });
      ble.disconnect().catch(() => {});
      return Promise.resolve(null);
    }
    return api.claimDevice(did, hello.name || this.data.appName || '墨程CalCal', hello.pid)
      .then((res) => res.device)
      .catch((err) => {
        if (err.status === 409) {
          this.setData({ error: '该设备已绑定其他微信账号' });
          wx.showModal({
            title: '设备已绑定其他账号',
            content: '这台设备已归属另一个微信账号。请原账号在「我的」页解绑，或在设备上恢复出厂设置后用当前账号重新配对。',
            showCancel: false,
            confirmText: '知道了',
          });
        } else {
          this.setData({ error: `设备归属校验失败：${err.message}` });
        }
        ble.disconnect().catch(() => {});
        return null;
      });
  },

  // Called by utils/ble.js when the device is in pairing mode and this phone
  // has no key for it. The code is shown on the e-ink screen; the hint lives in
  // the input's placeholder and the retry error on its own line, so the field
  // always starts empty.
  requestPairingCode(info) {
    const error = info && info.error ? info.error : '';
    // A new attempt supersedes a pending one instead of leaving it unresolved.
    if (this._pairingResolve) {
      this._pairingResolve('');
    }
    return new Promise((resolve) => {
      this._pairingResolve = resolve;
      this.setData({
        pairingVisible: true,
        pairingValue: '',
        pairingError: error,
        pairingFocus: true,
      });
    });
  },

  onPairingInput(event) {
    this.setData({ pairingValue: event.detail.value, pairingError: '' });
  },

  confirmPairing() {
    const value = String(this.data.pairingValue || '').trim();
    if (!value) {
      this.setData({ pairingError: '先输入设备屏幕上的配对码' });
      return;
    }
    this.closePairing(value);
  },

  cancelPairing() {
    this.closePairing('');
  },

  closePairing(value) {
    const resolve = this._pairingResolve;
    this._pairingResolve = null;
    this.setData({
      pairingVisible: false,
      pairingValue: '',
      pairingError: '',
      pairingFocus: false,
    });
    if (resolve) resolve(value);
  },

  disconnect() {
    this.syncedThisSession = false;
    ble.disconnect().catch(() => {});
  },

  sleepDevice() {
    wx.showModal({
      title: '锁屏并休眠',
      content: '设备会显示接下来的日程并进入深睡，之后按 POWER 键唤醒。',
      confirmText: '锁屏',
      success: (res) => {
        if (!res.confirm) return;
        ble.sleep()
          .then(() => wx.showToast({ title: '设备正在锁屏', icon: 'none' }))
          .catch((err) => this.setData({ error: err.message }));
      },
    });
  },

  refresh() {
    if (this.data.syncing) return;
    this.syncDevice().then(() => wx.showToast({ title: '已同步', icon: 'none' }));
  },

  // --- cloud <-> device sync -------------------------------------------
  // Single-device assumption: the cloud stores one `deviceId` per event, and
  // that id is the device-local number (both devices count from 1). Alternating
  // between two devices under one account mis-deletes events; see DEVNOTES
  // section 24 before changing this function.
  syncDevice() {
    if (!ble.isConnected() || this.syncing) return Promise.resolve();
    this.syncing = true;
    this.setData({ syncing: true, error: '', syncError: '' });

    return (async () => {
      const errors = [];
      try {
        const cloud = await api.events({ includeDeleted: true });
        const deviceEvents = await ble.list();
        const deviceIds = new Set(deviceEvents.map((event) => event.id));
        const removed = new Set();
        const claimed = new Set();

        // 1. Apply tombstones: delete from the device, then purge the record.
        for (const event of cloud) {
          if (!event.deletedAt) continue;
          if (event.deviceId != null && deviceIds.has(event.deviceId)) {
            // Never import the device copy back as a new event, even if the
            // delete fails; the tombstone will be retried next sync.
            claimed.add(event.deviceId);
            try {
              await ble.del(event.deviceId);
              deviceIds.delete(event.deviceId);
              removed.add(event.deviceId);
            } catch (err) {
              if (!/not found/i.test(err.message)) {
                errors.push(`删除设备日程失败：${err.message}`);
                continue; // keep the tombstone for the next sync
              }
              // The device already forgot it (pruned or deleted twice); drop
              // the tombstone below.
              removed.add(event.deviceId);
            }
          }
          try {
            await api.purgeEvent(event.id);
          } catch (err) {
            errors.push(`清理云端删除记录失败：${err.message}`);
          }
        }

        const active = cloud.filter((event) => !event.deletedAt);

        // 2. Recover mappings: either the cloud event was never mapped, or the
        // device was reset/reindexed and its old numeric id no longer exists.
        for (const event of active) {
          if (event.deviceId != null && deviceIds.has(event.deviceId)) {
            claimed.add(event.deviceId);
            continue;
          }
          const match = deviceEvents.find((candidate) =>
            !claimed.has(candidate.id) &&
            !removed.has(candidate.id) &&
            sameEvent(candidate, event));
          if (match) {
            const previousId = event.deviceId;
            event.deviceId = match.id;
            claimed.add(match.id);
            try {
              if (previousId !== match.id) await api.mapDevice(event.id, match.id);
            } catch (err) {
              errors.push(`关联设备日程失败：${err.message}`);
            }
          }
        }

        // 3. Push content edits to events the device already has. The device id
        // stays the same (proto 2 `update`); older firmware is replaced by
        // delete + add and the cloud record is remapped.
        for (const event of active) {
          if (event.deviceId == null || !deviceIds.has(event.deviceId)) continue;
          const deviceEvent = deviceEvents.find((candidate) => candidate.id === event.deviceId);
          if (!deviceEvent || sameEvent(deviceEvent, event)) continue;
          const previousId = event.deviceId;
          try {
            const ack = await deviceSync.pushUpdate(event);
            if (ack && ack.id !== previousId) {
              claimed.add(ack.id);
              deviceIds.delete(previousId);
              deviceIds.add(ack.id);
              removed.add(previousId);
            }
          } catch (err) {
            errors.push(`修改设备日程失败：${err.message}`);
          }
        }

        // 4. Import events that only exist on the device (web page, keys, etc.).
        for (const deviceEvent of deviceEvents) {
          if (claimed.has(deviceEvent.id) || removed.has(deviceEvent.id)) continue;
          try {
            await api.createEvent({
              date: deviceEvent.date,
              start: deviceEvent.start,
              end: deviceEvent.end,
              title: deviceEvent.title,
              note: deviceEvent.note || '',
              deviceId: deviceEvent.id,
            });
            claimed.add(deviceEvent.id);
          } catch (err) {
            errors.push(`上传设备日程失败：${err.message}`);
          }
        }

        const bounds = syncBounds();

        // 5. Push cloud events that have never reached the device.
        for (const event of active) {
          if (event.deviceId != null || !inWindow(event.date, bounds)) continue;
          try {
            const ack = await ble.add(event);
            deviceIds.add(ack.id);
            claimed.add(ack.id);
            event.deviceId = ack.id;
            await api.mapDevice(event.id, ack.id);
          } catch (err) {
            errors.push(`同步到设备失败：${err.message}`);
          }
        }

        // 6. Deletions on the device also delete the cloud copy. A device reset
        // or a bulk deletion is confirmed first so a wiped NVS cannot silently
        // erase the user's cloud calendar.
        const missing = active.filter((event) =>
          event.deviceId != null &&
          !deviceIds.has(event.deviceId) &&
          inWindow(event.date, bounds));

        if (missing.length) {
          const looksReset = deviceEvents.length === 0;
          const needConfirm = looksReset || missing.length >= BULK_DELETE_THRESHOLD;
          const deleteCloud = needConfirm
            ? await confirmDeviceDeletion(missing.length, looksReset)
            : true;

          for (const event of missing) {
            if (deleteCloud) {
              try {
                await api.deleteEvent(event.id);
                await api.purgeEvent(event.id);
              } catch (err) {
                errors.push(`删除云端日程失败：${err.message}`);
              }
            } else {
              try {
                const ack = await ble.add(event);
                deviceIds.add(ack.id);
                event.deviceId = ack.id;
                await api.mapDevice(event.id, ack.id);
              } catch (err) {
                errors.push(`恢复设备日程失败：${err.message}`);
              }
            }
          }
        }

        this.syncedThisSession = true;
        const hello = await ble.hello().catch(() => null);
        if (hello) this.setData({ hello, deviceTime: fmt.deviceTime(hello) });
        if (errors.length) {
          this.setData({ syncError: `同步完成，但有 ${errors.length} 条失败：${errors[0]}` });
        } else {
          this.setData({ syncError: '' });
        }
      } catch (err) {
        this.setData({ syncError: err.message });
        throw err;
      }
    })().catch(() => {
      // The message is already on screen; the caller only clears its flags.
    }).then(() => {
      this.syncing = false;
      this.setData({ syncing: false });
    });
  },

  // --- date picker ------------------------------------------------------
  toggleCalendar() {
    if (this.data.calendarOpen) {
      this.setData({ calendarOpen: false });
      return;
    }
    const cursor = cal.cursorFrom(this.data.form.date);
    this.calYear = cursor.year;
    this.calMonth = cursor.month;
    this.renderCalendar();
    this.setData({ calendarOpen: true }, () => this.revealCalendar());
  },

  /* The panel opens below the date row, which can leave its last weeks below
   * the fold on a short screen. Measure it after the view has updated and
   * scroll just enough to show all of it. */
  revealCalendar() {
    if (typeof wx === 'undefined' || !wx.createSelectorQuery) return;
    const query = wx.createSelectorQuery();
    query.select('.cal').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      if (!this.data.calendarOpen) return; // closed while measuring
      const rect = res && res[0];
      const view = res && res[1];
      if (!rect || !view) return;
      const info = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const target = cal.revealScrollTop({
        top: rect.top,
        height: rect.height,
        scrollTop: view.scrollTop,
        viewport: info.windowHeight,
      });
      if (target == null) return;
      wx.pageScrollTo({ scrollTop: target, duration: 200 });
    });
  },

  shiftCalendarMonth(event) {
    const delta = Number(event.currentTarget.dataset.delta) || 0;
    if (!delta) return;
    const next = new Date(this.calYear, this.calMonth + delta, 1);
    if (next.getFullYear() < CAL_YEAR_MIN || next.getFullYear() > CAL_YEAR_MAX) return;
    this.calYear = next.getFullYear();
    this.calMonth = next.getMonth();
    this.renderCalendar();
  },

  renderCalendar() {
    this.setData({
      calendarLabel: cal.monthLabel(this.calYear, this.calMonth),
      calendarCells: cal.monthGrid(this.calYear, this.calMonth, this.data.form.date,
        fmt.ymd(new Date())),
    });
  },

  pickDay(event) {
    this.chooseDate(event.currentTarget.dataset.date);
  },

  pickToday() {
    this.chooseDate(fmt.ymd(new Date()));
  },

  chooseDate(date) {
    if (!date) return;
    const cursor = cal.cursorFrom(date);
    this.calYear = cursor.year;
    this.calMonth = cursor.month;
    this.setData({
      form: Object.assign({}, this.data.form, { date }),
      calendarOpen: false,
    });
  },

  // --- voice schedule ---------------------------------------------------
  startVoice() {
    if (!this.voiceRecorder) return;
    if (this.data.voicePhase || this.data.busy || this.data.voiceRecording) return;
    this.voicePressed = true;
    this.setData({ voiceError: '', voiceStatus: '正在准备麦克风…' });
    // Check permission before starting so a release while the system prompt is
    // open does not produce a 0-second recording.
    voice.ensurePermission()
      .then(() => {
        if (!this.voicePressed) {
          this.setData({
            voiceRecording: false,
            voiceButtonLabel: '按住 说话',
            voiceStatus: '麦克风已授权，请按住说话',
          });
          return null;
        }
        return this.voiceRecorder.start().catch((err) => {
          this.setData({
            voiceRecording: false,
            voiceButtonLabel: '按住 说话',
            voiceStatus: '说一句，AI 帮你填好',
          });
          if (err && err.code === 'permission') this.showRecordPermissionHelp();
          else this.setData({ voiceError: (err && err.message) || '录音启动失败，请重试' });
        });
      })
      .catch((err) => {
        this.setData({
          voiceRecording: false,
          voiceButtonLabel: '按住 说话',
          voiceStatus: '说一句，AI 帮你填好',
        });
        if (err && err.code === 'permission') this.showRecordPermissionHelp();
        else this.setData({ voiceError: (err && err.message) || '录音启动失败，请重试' });
      });
  },

  stopVoice() {
    this.voicePressed = false;
    if (this.voiceRecorder) this.voiceRecorder.stop();
  },

  onVoiceTouchCancel() {
    this.voicePressed = false;
    this.cancelVoiceRecording();
    this.setData({ voicePhase: '', voiceStatus: '已取消录音' });
  },

  cancelVoiceRecording() {
    this.voicePressed = false;
    this.stopVoiceTimer();
    if (this.voiceRecorder) this.voiceRecorder.cancel();
  },

  // The recorder keeps the touch area from scrolling while the user holds it.
  noop() {},

  startVoiceTimer() {
    this.stopVoiceTimer();
    this.voiceStartedAt = Date.now();
    this.updateVoiceTimer();
    this.voiceTimer = setInterval(() => this.updateVoiceTimer(), 500);
  },

  // Keeps both the elapsed seconds and the fill percentage of the hold
  // button in sync with the recorder's 60 s limit.
  updateVoiceTimer() {
    const elapsed = Date.now() - (this.voiceStartedAt || Date.now());
    const seconds = Math.min(60, Math.floor(elapsed / 1000));
    const progress = Math.min(100, Math.round(elapsed / 60) / 10);
    const label = `${Math.floor(seconds / 60)}:${fmt.pad(seconds % 60)}`;
    if (seconds === this.data.voiceSeconds &&
        progress === this.data.voiceProgress &&
        label === this.data.voiceElapsed) {
      return;
    }
    this.setData({ voiceSeconds: seconds, voiceProgress: progress, voiceElapsed: label });
  },

  stopVoiceTimer() {
    if (this.voiceTimer) {
      clearInterval(this.voiceTimer);
      this.voiceTimer = null;
    }
    if (this.data.voiceProgress || this.data.voiceSeconds || this.data.voiceElapsed !== '0:00') {
      this.setData({ voiceProgress: 0, voiceSeconds: 0, voiceElapsed: '0:00' });
    }
  },

  onVoiceText(event) {
    const value = String(event.detail.value || '').slice(0, VOICE_TEXT_MAX);
    this.setData({ voiceText: value, voiceError: '' });
  },

  transcribeVoice(audio) {
    if (!audio || !audio.base64) return;
    this.setData({ voicePhase: 'transcribing', voiceStatus: '正在识别…', voiceError: '' });
    api.transcribe(audio.base64, {
      format: 'pcm',
      sampleRate: audio.sampleRate,
      channels: audio.channels,
      bitsPerSample: audio.bitsPerSample,
    })
      .then((res) => {
        const text = String((res && res.text) || '').trim();
        if (!text) throw new Error('没有识别到内容，请再说一次');
        this.setData({
          voiceText: text.slice(0, VOICE_TEXT_MAX),
          voicePhase: '',
          voiceButtonLabel: '按住 说话',
          voiceStatus: '识别完成，可以修改后解析',
          voiceError: '',
        });
      })
      .catch((err) => {
        this.setData({
          voicePhase: '',
          voiceButtonLabel: '按住 说话',
          voiceStatus: '说一句，AI 帮你填好',
          voiceError: (err && err.message) || '语音识别失败，请重试',
        });
      });
  },

  showRecordPermissionHelp() {
    wx.showModal({
      title: '需要麦克风权限',
      content: '语音日程需要麦克风。请在设置里允许微信使用麦克风，然后重新按住按钮说话。',
      confirmText: '去设置',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm && typeof wx.openSetting === 'function') wx.openSetting({});
      },
    });
  },

  confirmVoice() {
    if (!this.voiceRecorder) return Promise.resolve(false);
    if (this.data.voicePhase || this.data.busy || this.data.voiceRecording) {
      return Promise.resolve(false);
    }
    const text = String(this.data.voiceText || '').trim();
    if (!text) {
      this.setData({ voiceError: '请先输入或说出日程内容' });
      return Promise.resolve(false);
    }

    this.setData({ voicePhase: 'parsing', voiceStatus: 'AI 正在解析…', voiceError: '' });
    return api.parseSchedule(text)
      .then((event) => {
        const draft = {
          date: event.date,
          start: event.start,
          end: event.end,
          title: event.title,
          note: event.note || '',
        };
        const cursor = cal.cursorFrom(draft.date);
        this.calYear = cursor.year;
        this.calMonth = cursor.month;
        this.setData({
          form: draft,
          calendarOpen: false,
          titleBytes: utf8.byteLength(draft.title),
          noteBytes: utf8.byteLength(draft.note),
          voiceFilled: true,
          voicePhase: '',
          voiceButtonLabel: '按住 说话',
          voiceStatus: '已填入下方表单，确认后保存',
          voiceError: '',
        }, () => this.revealAddForm());
        return true;
      })
      .catch((err) => {
        this.setData({
          voicePhase: '',
          voiceButtonLabel: '按住 说话',
          voiceStatus: '说一句，AI 帮你填好',
          voiceError: (err && err.message) || 'AI 解析失败，请重试',
        });
        return false;
      });
  },

  // The AI draft lands in the add-event card below. Measure the whole card and
  // scroll so its bottom is visible too, not just its top; when it already fits
  // on screen no scrolling happens.
  revealAddForm() {
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
    const query = wx.createSelectorQuery();
    query.select('#add-card').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const rect = res && res[0];
      const view = res && res[1];
      if (!rect || !view) return;
      const info = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const target = cal.revealScrollTop({
        top: rect.top,
        height: rect.height,
        scrollTop: view.scrollTop,
        viewport: info.windowHeight,
      });
      if (target == null) return;
      wx.pageScrollTo({ scrollTop: target, duration: 200 });
    });
  },

  // --- add / delete -----------------------------------------------------
  onStart(event) {
    const start = event.detail.value;
    // The end follows the start by 30 minutes; picking an end afterwards still
    // wins until the start is confirmed again.
    this.setData({
      'form.start': start,
      'form.end': fmt.shiftClock(start, AUTO_END_MINUTES),
    });
  },

  onEnd(event) {
    this.setData({ 'form.end': event.detail.value });
  },

  onTitle(event) {
    const value = utf8.clamp(event.detail.value, TITLE_BYTES);
    this.setData({ 'form.title': value, titleBytes: utf8.byteLength(value) });
  },

  onNote(event) {
    const value = utf8.clamp(event.detail.value, NOTE_BYTES);
    this.setData({ 'form.note': value, noteBytes: utf8.byteLength(value) });
  },

  submit() {
    if (this.data.voicePhase) return Promise.resolve(false);
    return this.saveForm(this.data.form).then((saved) => {
      if (saved && this.data.voiceFilled) {
        this.setData({
          voiceFilled: false,
          voiceText: '',
          voiceButtonLabel: '按住 说话',
          voiceStatus: '已保存，可以继续说下一条',
          voiceError: '',
        });
      } else if (!saved && this.data.voiceFilled) {
        this.setData({ voiceStatus: '保存失败，请检查后重试' });
      }
      return saved;
    });
  },

  // Shared by the manual form and the AI-filled draft. Resolves to true only
  // after the cloud write succeeds, so submit() knows whether to clear the
  // voice text/flag.
  saveForm(form) {
    if (this.data.busy) return Promise.resolve(false);
    const title = String(form.title || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return Promise.resolve(false);
    }
    if (form.end && form.end <= form.start) {
      wx.showToast({ title: '结束时间要晚于开始时间', icon: 'none' });
      return Promise.resolve(false);
    }

    this.setData({ busy: true, error: '' });
    let deviceError = '';
    let saved = false;
    return api.createEvent({
      date: form.date,
      start: form.start,
      end: form.end,
      title,
      note: String(form.note || '').trim(),
    })
      .then((event) => {
        if (!ble.isConnected()) return event;
        return ble.add(event)
          .then((ack) => api.mapDevice(event.id, ack.id))
          .catch((err) => {
            deviceError = err.message;
            return event;
          });
      })
      .then(() => {
        const online = ble.isConnected();
        wx.showToast({
          title: !online
            ? '未连蓝牙，已存云端'
            : (deviceError ? '已存云端，设备同步失败' : '已添加并同步到设备'),
          icon: 'none',
          duration: 2200,
        });
        const fresh = defaultForm();
        this.setData({
          form: Object.assign({}, fresh, { date: form.date }),
          calendarOpen: false,
          titleBytes: 0,
          noteBytes: 0,
        });
        saved = true;
      })
      .then(() => (ble.isConnected() ? ble.hello().catch(() => null) : null))
      .then((hello) => {
        if (hello) this.setData({ hello, deviceTime: fmt.deviceTime(hello) });
      })
      .catch((err) => this.setData({ error: err.message }))
      .then(() => {
        this.setData({ busy: false });
        return saved;
      });
  },

  // --- misc -------------------------------------------------------------
  toggleLog() {
    this.setData({ logOpen: !this.data.logOpen });
  },
});
