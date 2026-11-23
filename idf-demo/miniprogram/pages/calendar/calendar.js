'use strict';

const ble = require('../../utils/ble');
const auth = require('../../utils/auth');
const api = require('../../utils/api');
const deviceSync = require('../../utils/device-sync');
const eventRules = require('../../utils/event');
const fmt = require('../../utils/format');
const utf8 = require('../../utils/utf8');

/**
 * Month list tab. The 添加 tab keeps the device card and the create form;
 * reading, editing and deleting events lives here so the form page stays short.
 */
Page({
  data: {
    monthCursor: '',
    monthLabel: '',
    monthTitle: '',
    monthYear: '',
    groups: [],
    eventCount: 0,
    loading: false,
    busy: false,
    error: '',
    editorOpen: false,
    saving: false,
    editor: { id: '', date: '', start: '', end: '', title: '', note: '', deviceId: null },
    editorTitleBytes: 0,
    editorNoteBytes: 0,
    editorError: '',
    titleLimit: eventRules.TITLE_BYTES,
    noteLimit: eventRules.NOTE_BYTES,
  },

  onLoad() {
    const now = new Date();
    const meta = fmt.monthMeta(now);
    this.events = [];
    this.setData({
      monthCursor: fmt.ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      monthLabel: fmt.monthLabel(now),
      monthTitle: meta.title,
      monthYear: meta.year,
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
    const meta = fmt.monthMeta(next);
    this.setData({
      monthCursor: fmt.ymd(next),
      monthLabel: fmt.monthLabel(next),
      monthTitle: meta.title,
      monthYear: meta.year,
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

  // --- edit -------------------------------------------------------------
  edit(event) {
    if (this.data.busy || this.data.saving) return null;
    const id = event.currentTarget.dataset.id;
    const target = (this.events || []).find((item) => item.id === id);
    if (!target) return null;
    // The native time picker only goes up to 23:59; the server/device encode
    // a late end as 24:00, so show it as the last selectable minute.
    const end = target.end === '24:00' ? '23:59' : target.end;
    this.setData({
      editorOpen: true,
      editorError: '',
      editor: {
        id: target.id,
        date: target.date,
        start: target.start,
        end,
        title: target.title || '',
        note: target.note || '',
        deviceId: target.deviceId == null ? null : target.deviceId,
      },
      editorTitleBytes: utf8.byteLength(target.title || ''),
      editorNoteBytes: utf8.byteLength(target.note || ''),
    });
    if (typeof wx.pageScrollTo === 'function') {
      wx.pageScrollTo({ scrollTop: 0, duration: 150 });
    }
    return null;
  },

  closeEditor() {
    if (this.data.saving) return;
    this.setData({ editorOpen: false, editorError: '' });
  },

  onEditorDate(event) {
    this.setData({ 'editor.date': event.detail.value });
  },

  onEditorStart(event) {
    const start = event.detail.value;
    this.setData({
      'editor.start': start,
      'editor.end': fmt.shiftClock(start, 30),
    });
  },

  onEditorEnd(event) {
    this.setData({ 'editor.end': event.detail.value });
  },

  onEditorTitle(event) {
    const value = utf8.clamp(event.detail.value, eventRules.TITLE_BYTES);
    this.setData({ 'editor.title': value, editorTitleBytes: utf8.byteLength(value) });
  },

  onEditorNote(event) {
    const value = utf8.clamp(event.detail.value, eventRules.NOTE_BYTES);
    this.setData({ 'editor.note': value, editorNoteBytes: utf8.byteLength(value) });
  },

  saveEditor() {
    if (this.data.saving) return Promise.resolve();
    const editor = this.data.editor;
    if (!editor || !editor.id) return Promise.resolve();
    const title = String(editor.title || '').trim();
    if (!title) {
      this.setData({ editorError: '请填写标题' });
      return Promise.resolve();
    }
    if (editor.end && editor.end <= editor.start) {
      this.setData({ editorError: '结束时间要晚于开始时间' });
      return Promise.resolve();
    }

    this.setData({ saving: true, editorError: '' });
    const payload = {
      date: editor.date,
      start: editor.start,
      end: editor.end,
      title,
      note: String(editor.note || '').trim(),
    };

    return api.updateEvent(editor.id, payload)
      .then(async (saved) => {
        let deviceError = '';
        if (ble.isConnected()) {
          try {
            if (saved.deviceId == null) {
              // A cloud-only event has no device id yet; add it now instead of
              // waiting for the next full sync.
              const ack = await ble.add(saved);
              await api.mapDevice(saved.id, ack.id);
            } else {
              await deviceSync.pushUpdate(saved);
            }
          } catch (err) {
            deviceError = err.message;
          }
        }
        this.setData({ editorOpen: false, editorError: '' });
        wx.showToast({
          title: deviceError
            ? '已存云端，设备同步失败'
            : (!ble.isConnected() ? '已保存，连接设备后同步' : '已保存并同步到设备'),
          icon: 'none',
          duration: 2200,
        });
        return this.loadMonth();
      })
      .catch((err) => this.setData({ editorError: err.message }))
      .then(() => this.setData({ saving: false }));
  },

  // --- delete -----------------------------------------------------------
  remove(event) {
    if (this.data.saving) return;
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
