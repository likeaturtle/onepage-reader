'use strict';

const config = require('../../config');
const ble = require('../../utils/ble');
const auth = require('../../utils/auth');
const api = require('../../utils/api');
const fmt = require('../../utils/format');

const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 120;
const BULK_DELETE_THRESHOLD = 3;

function defaultForm() {
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const hhmm = (date) => `${fmt.pad(date.getHours())}:${fmt.pad(date.getMinutes())}`;
  return {
    date: fmt.ymd(start),
    start: hhmm(start),
    end: hhmm(end),
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
    deviceTime: '',
    monthCursor: '',
    monthLabel: '',
    groups: [],
    eventCount: 0,
    loading: false,
    form: { date: '', start: '', end: '', title: '', note: '' },
    titleBytes: 0,
    noteBytes: 0,
    busy: false,
    error: '',
    syncError: '',
    logOpen: false,
    logs: [],
  },

  onLoad() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    this.events = [];
    this.syncedThisSession = false;
    this.setData({
      monthCursor: fmt.ymd(first),
      monthLabel: fmt.monthLabel(first),
      form: defaultForm(),
    });
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
        this.syncedThisSession = false;
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

    // The cloud list is the primary view: it must load even without a device.
    this.loadMonth();
    if (ble.isConnected() && !this.syncedThisSession && !this.syncing) {
      this.syncDevice().then(() => this.loadMonth());
    }
  },

  onHide() {
    if (this.data.scanning) this.stopScan();
  },

  onUnload() {
    if (this.offState) this.offState();
    if (this.offMessage) this.offMessage();
  },

  syncUser() {
    const user = auth.getUser() || {};
    this.setData({
      user,
      userInitial: fmt.initial(user.nickname || '微信用户'),
      userAvatar: fmt.avatarUrl(user.avatar),
    });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  // --- device -----------------------------------------------------------
  startScan() {
    if (this.data.scanning || this.data.connecting) return;
    this.setData({ devices: [], error: '', hasScanned: true });
    ble.startScan({
      all: this.data.showAllDevices,
      onDevices: (devices) => this.setData({ devices }),
    }).catch((err) => {
      this.setData({ error: err.message, scanning: false });
    });
  },

  stopScan() {
    ble.stopScan().catch(() => {});
  },

  toggleAllDevices(event) {
    const value = Boolean(event.detail.value);
    this.setData({ showAllDevices: value, devices: [] });
    if (this.data.scanning) {
      ble.stopScan()
        .then(() => this.startScan())
        .catch(() => {});
    }
  },

  connect(event) {
    const deviceId = event.currentTarget.dataset.id;
    if (!deviceId || this.data.connecting) return;
    this.setData({ connecting: true, error: '' });
    ble.connect(deviceId)
      .then((hello) => {
        this.setData({ hello, deviceTime: fmt.deviceTime(hello) });
        wx.showToast({ title: '已连接，正在同步', icon: 'none' });
        return this.syncDevice();
      })
      .then(() => this.loadMonth())
      .catch((err) => this.setData({ error: err.message }))
      .then(() => this.setData({ connecting: false }));
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
    if (!ble.isConnected()) {
      this.loadMonth().then(() => wx.showToast({ title: '已刷新云端', icon: 'none' }));
      return;
    }
    this.syncDevice()
      .then(() => this.loadMonth())
      .then(() => wx.showToast({ title: '已同步', icon: 'none' }));
  },

  // --- cloud <-> device sync -------------------------------------------
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

        // 3. Import events that only exist on the device (web page, keys, etc.).
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

        // 4. Push cloud events that have never reached the device.
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

        // 5. Deletions on the device also delete the cloud copy. A device reset
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
      // The message is already on screen; callers still refresh the cloud list.
    }).then(() => {
      this.syncing = false;
      this.setData({ syncing: false });
    });
  },

  // --- month ------------------------------------------------------------
  loadMonth() {
    this.setData({ loading: true, error: '' });
    const cursor = this.data.monthCursor;
    const bounds = fmt.monthBounds(cursor);
    return api.events({ from: bounds.from, to: bounds.to })
      .then((events) => {
        if (cursor !== this.data.monthCursor) return; // a newer month won
        this.events = events;
        this.setData({
          groups: fmt.groupEvents(events),
          eventCount: events.length,
        });
      })
      .catch((err) => {
        if (cursor === this.data.monthCursor) this.setData({ error: err.message });
      })
      .then(() => {
        if (cursor === this.data.monthCursor) this.setData({ loading: false });
      });
  },

  shiftMonth(delta) {
    const cursor = fmt.parseYmd(this.data.monthCursor);
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    this.setData({
      monthCursor: fmt.ymd(next),
      monthLabel: fmt.monthLabel(next),
      groups: [],
    });
    this.loadMonth();
  },

  prevMonth() {
    this.shiftMonth(-1);
  },

  nextMonth() {
    this.shiftMonth(1);
  },

  // --- add / delete -----------------------------------------------------
  onDate(event) {
    this.setData({ 'form.date': event.detail.value });
  },

  onStart(event) {
    this.setData({ 'form.start': event.detail.value });
  },

  onEnd(event) {
    this.setData({ 'form.end': event.detail.value });
  },

  onTitle(event) {
    const value = event.detail.value;
    this.setData({ 'form.title': value, titleBytes: fmt.utf8Len(value) });
  },

  onNote(event) {
    const value = event.detail.value;
    this.setData({ 'form.note': value, noteBytes: fmt.utf8Len(value) });
  },

  submit() {
    if (this.data.busy) return;
    const form = this.data.form;
    const title = String(form.title || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (form.end && form.end <= form.start) {
      wx.showToast({ title: '结束时间要晚于开始时间', icon: 'none' });
      return;
    }

    this.setData({ busy: true, error: '' });
    let deviceError = '';
    api.createEvent({
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
          titleBytes: 0,
          noteBytes: 0,
        });
        const day = fmt.parseYmd(form.date);
        this.setData({
          monthCursor: fmt.ymd(new Date(day.getFullYear(), day.getMonth(), 1)),
          monthLabel: fmt.monthLabel(day),
        });
        return this.loadMonth();
      })
      .then(() => (ble.isConnected() ? ble.hello().catch(() => null) : null))
      .then((hello) => {
        if (hello) this.setData({ hello, deviceTime: fmt.deviceTime(hello) });
      })
      .catch((err) => this.setData({ error: err.message }))
      .then(() => this.setData({ busy: false }));
  },

  remove(event) {
    const id = event.currentTarget.dataset.id;
    const target = (this.events || []).find((item) => item.id === id);
    if (!target) return;
    wx.showModal({
      title: '删除日程',
      content: ble.isConnected()
        ? '删除后无法恢复，确定删除这条日程吗？'
        : '删除后无法恢复。当前未连接蓝牙设备，删除会先改云端，连接设备后再同步。',
      confirmText: '删除',
      confirmColor: '#9c3427',
      success: (res) => {
        if (res.confirm) this.doRemove(target);
      },
    });
  },

  doRemove(target) {
    this.setData({ busy: true, error: '' });
    const wasConnected = ble.isConnected();
    let deviceError = '';
    api.deleteEvent(target.id)
      .then(() => {
        if (target.deviceId == null) return api.purgeEvent(target.id);
        if (!ble.isConnected()) return null; // tombstone waits for the next sync
        return ble.del(target.deviceId)
          .then(() => api.purgeEvent(target.id))
          .catch((err) => {
            if (/not found/i.test(err.message)) return api.purgeEvent(target.id);
            deviceError = err.message; // keep the tombstone
            return null;
          });
      })
      .then(() => {
        wx.showToast({
          title: deviceError
            ? '云端已删，设备同步失败'
            : (!wasConnected ? '未连蓝牙，已删云端' : '已删除'),
          icon: 'none',
          duration: 2200,
        });
        return this.loadMonth();
      })
      .catch((err) => this.setData({ error: err.message }))
      .then(() => this.setData({ busy: false }));
  },

  // --- misc -------------------------------------------------------------
  toggleLog() {
    this.setData({ logOpen: !this.data.logOpen });
  },
});
