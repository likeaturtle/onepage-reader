'use strict';

const ble = require('../../utils/ble');
const auth = require('../../utils/auth');
const api = require('../../utils/api');
const fmt = require('../../utils/format');

/**
 * Month list tab. The 添加 tab keeps the device card and the form; reading and
 * deleting events lives here so the form page stays short.
 */
Page({
  data: {
    monthCursor: '',
    monthLabel: '',
    groups: [],
    eventCount: 0,
    loading: false,
    busy: false,
    error: '',
  },

  onLoad() {
    const now = new Date();
    this.events = [];
    this.setData({
      monthCursor: fmt.ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      monthLabel: fmt.monthLabel(now),
    });
  },

  onShow() {
    if (!auth.getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    // The 添加 tab can change the cloud (create/delete/sync), so every visit
    // reloads instead of trusting an old list.
    return this.loadMonth();
  },

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
    return this.loadMonth();
  },

  prevMonth() {
    return this.shiftMonth(-1);
  },

  nextMonth() {
    return this.shiftMonth(1);
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
    if (this.data.busy) return Promise.resolve();
    this.setData({ busy: true, error: '' });
    const wasConnected = ble.isConnected();
    let deviceError = '';
    return api.deleteEvent(target.id)
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
});
