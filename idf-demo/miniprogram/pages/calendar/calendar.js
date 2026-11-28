'use strict';

const ble = require('../../utils/ble');
const auth = require('../../utils/auth');
const api = require('../../utils/api');
const deviceSync = require('../../utils/device-sync');
const eventRules = require('../../utils/event');
const fmt = require('../../utils/format');
const cal = require('../../utils/calendar');
const utf8 = require('../../utils/utf8');
const localEvents = require('../../utils/local-events');

/**
 * Month list tab. The 添加 tab keeps the device card and the create form;
 * reading, editing and deleting events lives here so the form page stays short.
 */
Page({
  data: {
    loggedIn: false,
    monthCursor: '',
    monthLabel: '',
    monthTitle: '',
    monthYear: '',
    groups: [],
    eventCount: 0,
    localCount: 0,
    loading: false,
    busy: false,
    error: '',
    editorOpen: false,
    saving: false,
    editor: { id: '', date: '', start: '', end: '', title: '', note: '', deviceId: null, local: false },
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
    // The month that is "current" for this visit; compared on the next show
    // so a month boundary crossed in the background moves the cursor along.
    this.todayMonth = fmt.ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    this.setData({
      loggedIn: auth.isLoggedIn(),
      monthCursor: this.todayMonth,
      monthLabel: fmt.monthLabel(now),
      monthTitle: meta.title,
      monthYear: meta.year,
    });
  },

  onShow() {
    this.setData({ loggedIn: auth.isLoggedIn() });
    this.followTodayMonth();
    // The 添加 tab can change the store (local or cloud), so every visit
    // reloads instead of trusting an old list.
    // A tab visit also lands on today instead of the month's first event;
    // the reloads caused by edits and month arrows must not move the page.
    this.revealPending = true;
    return this.loadMonth();
  },

  /* A month boundary crossed while the mini program was in the background
   * must not leave the tab on last month (where today has no section at all).
   * Only follow it when the page was still showing the month that was current
   * at the previous visit; a month the user navigated to is left alone. */
  followTodayMonth() {
    const now = new Date();
    const currentMonth = fmt.ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    if (!this.todayMonth || this.todayMonth === currentMonth) return;
    if (this.data.monthCursor === this.todayMonth) {
      const meta = fmt.monthMeta(now);
      this.setData({
        monthCursor: currentMonth,
        monthLabel: fmt.monthLabel(now),
        monthTitle: meta.title,
        monthYear: meta.year,
        groups: [],
      });
    }
    this.todayMonth = currentMonth;
  },

  loadMonth() {
    const reveal = this.revealPending === true;
    this.revealPending = false;
    this.setData({ loading: true, error: '' });
    const cursor = this.data.monthCursor;
    const bounds = fmt.monthBounds(cursor);
    const local = Promise.resolve(localEvents.list(bounds));
    const source = this.data.loggedIn
      ? Promise.all([api.events({ from: bounds.from, to: bounds.to }), local])
        .then(([cloud, offline]) => cloud.concat(offline))
      : local;
    return source
      .then((events) => {
        if (cursor !== this.data.monthCursor) return; // a newer month won
        this.events = events;
        const now = new Date();
        const currentMonth = fmt.ymd(new Date(now.getFullYear(), now.getMonth(), 1));
        this.setData({
          // Today gets a section even without events, so a tap on the tab
          // still lands on today with a "暂无日程" placeholder.
          groups: fmt.groupEvents(events,
            cursor === currentMonth ? { today: fmt.ymd(now) } : undefined),
          eventCount: events.length,
          localCount: events.filter((event) => event.local).length,
        });
      })
      .catch((err) => {
        if (cursor === this.data.monthCursor) this.setData({ error: err.message });
      })
      .then(() => {
        if (cursor !== this.data.monthCursor) return;
        // The loading placeholder sits above the list; wait until it is gone
        // so the measured position of today's row matches the final layout.
        this.setData({ loading: false }, () => {
          if (reveal) this.revealToday();
        });
      });
  },

  /* Jump to today's day section after the tab's first load. The current month
   * always carries a section for today: groupEvents inserts an empty one when
   * the day has no events. Only the current month is anchored, so browsing
   * another month (or an open editor) leaves the page where it is. */
  revealToday() {
    if (this.data.editorOpen) return;
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
    const groups = this.data.groups || [];
    if (!groups.length) return;
    const now = new Date();
    if (this.data.monthCursor !== fmt.ymd(new Date(now.getFullYear(), now.getMonth(), 1))) return;
    const todayText = fmt.ymd(now);
    const anchor = groups.find((group) => group.date === todayText);
    if (!anchor) return; // no sections yet (failed load)

    const query = wx.createSelectorQuery();
    query.select(`#day-${anchor.date}`).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const rect = res && res[0];
      const view = res && res[1];
      if (!rect || !view) return;
      const info = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const target = cal.revealAnchorScrollTop({
        top: rect.top,
        scrollTop: view.scrollTop,
        viewport: Number(info && info.windowHeight),
      });
      if (target == null) return;
      wx.pageScrollTo({ scrollTop: target, duration: 200 });
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
        local: target.local === true,
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

    if (editor.local || !this.data.loggedIn) {
      const updated = localEvents.update(editor.id, payload);
      if (!updated) {
        this.setData({ saving: false, editorError: '这条日程已不存在' });
        return Promise.resolve();
      }
      this.setData({ editorOpen: false, editorError: '', saving: false });
      wx.showToast({ title: '已保存到本机', icon: 'none', duration: 2200 });
      return this.loadMonth();
    }

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
    const isLocal = target.local === true || !this.data.loggedIn;
    const content = isLocal
      ? '删除后无法恢复。这条日程只保存在本机，不会影响云端。'
      : (ble.isConnected()
        ? '删除后无法恢复，确定删除这条日程吗？'
        : '删除后无法恢复。当前未连接蓝牙设备，删除会先改云端，连接设备后再同步。');
    wx.showModal({
      title: '删除日程',
      content,
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

    if (target.local || !this.data.loggedIn) {
      try {
        localEvents.remove(target.id);
        wx.showToast({ title: '已从本机删除', icon: 'none', duration: 2200 });
      } catch (err) {
        this.setData({ error: err.message });
      }
      return this.loadMonth().then(() => this.setData({ busy: false }));
    }

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
