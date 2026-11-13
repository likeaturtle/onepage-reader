'use strict';

const auth = require('../../utils/auth');
const api = require('../../utils/api');
const ble = require('../../utils/ble');
const fmt = require('../../utils/format');
const config = require('../../config');

const MAX_AVATAR_BYTES = 512 * 1024;

Page({
  data: {
    user: {},
    initial: '页',
    avatarUrl: '',
    nickname: '',
    saving: false,
    uploading: false,
    error: '',
    appName: config.appName,
    apiBase: config.apiBase,
    version: '1.0.0',
  },

  onShow() {
    if (!auth.getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.sync();
    api.me()
      .then((res) => {
        auth.setUser(res.user);
        this.sync();
      })
      .catch(() => {});
  },

  sync() {
    const user = auth.getUser() || {};
    this.setData({
      user,
      initial: fmt.initial(user.nickname || '微信用户'),
      avatarUrl: fmt.avatarUrl(user.avatar),
      nickname: user.nickname || '',
    });
  },

  onNickname(event) {
    this.setData({ nickname: event.detail.value });
  },

  save() {
    const nickname = String(this.data.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true, error: '' });
    api.updateMe(nickname)
      .then((res) => {
        auth.setUser(res.user);
        this.sync();
        wx.showToast({ title: '已保存', icon: 'success' });
      })
      .catch((err) => this.setData({ error: err.message }))
      .then(() => this.setData({ saving: false }));
  },

  chooseAvatar(event) {
    const filePath = event.detail.avatarUrl;
    if (!filePath || this.data.uploading) return;
    this.setData({ uploading: true, error: '' });

    const lower = filePath.toLowerCase();
    const mime = lower.endsWith('.png') ? 'png' : lower.endsWith('.webp') ? 'webp' : 'jpeg';

    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => {
        const base64 = res.data || '';
        const bytes = Math.floor((base64.length * 3) / 4);
        if (bytes > MAX_AVATAR_BYTES) {
          this.setData({ uploading: false, error: '头像不能超过 512 KB，请换一张小图' });
          return;
        }
        api.uploadAvatar(`data:image/${mime};base64,${base64}`)
          .then((uploaded) => {
            auth.setUser(uploaded.user);
            this.sync();
            wx.showToast({ title: '头像已更新', icon: 'success' });
          })
          .catch((err) => this.setData({ error: err.message }))
          .then(() => this.setData({ uploading: false }));
      },
      fail: () => this.setData({ uploading: false, error: '读取头像文件失败' }),
    });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能继续使用小程序，设备上的日程不会删除。',
      confirmText: '退出',
      confirmColor: '#9c3427',
      success: (res) => {
        if (!res.confirm) return;
        api.logout()
          .then(() => ble.disconnect().catch(() => null))
          .then(() => {
            auth.clear();
            wx.reLaunch({ url: '/pages/login/login' });
          });
      },
    });
  },
});
