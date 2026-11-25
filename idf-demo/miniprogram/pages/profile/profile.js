'use strict';

const auth = require('../../utils/auth');
const api = require('../../utils/api');
const ble = require('../../utils/ble');
const fmt = require('../../utils/format');
const avatar = require('../../utils/avatar');
const config = require('../../config');

const MAX_AVATAR_BYTES = 512 * 1024;

/* The client version is not stored in this repository: WeChat only exposes the
 * online version number inside a release build, and develop/trial return an
 * empty `version`. Reading it at runtime keeps this row honest instead of
 * showing a hardcoded string that drifts from what was uploaded. */
function clientVersion() {
  try {
    const mp = wx.getAccountInfoSync().miniProgram || {};
    if (mp.version) {
      return mp.version;
    }
    if (mp.envVersion === 'trial') {
      return '体验版';
    }
    if (mp.envVersion === 'release') {
      return '正式版';
    }
  } catch (err) {
    /* getAccountInfoSync needs base library 2.2.2+; fall through to the label. */
  }
  return '开发版';
}

Page({
  data: {
    loggedIn: false,
    user: {},
    initial: '未',
    avatarUrl: '',
    nickname: '',
    saving: false,
    uploading: false,
    error: '',
    appName: config.appName,
    tagline: config.tagline,
    apiBase: config.apiBase,
    version: clientVersion(),
    protocol: config.protocol,
    devices: [],
    devicesLoading: false,
    deviceError: '',
    unbinding: false,
  },

  onShow() {
    const loggedIn = auth.isLoggedIn();
    this.setData({ loggedIn });
    this.sync(loggedIn);
    if (!loggedIn) {
      this.setData({ devices: [], devicesLoading: false, deviceError: '' });
      return;
    }
    this.loadDevices();
    api.me()
      .then((res) => {
        auth.setUser(res.user);
        this.sync(true);
      })
      .catch(() => {});
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  loginHint() {
    wx.showToast({ title: '登录后可同步云端与设备', icon: 'none' });
  },

  loadDevices() {
    if (!this.data.loggedIn) return;
    if (this.data.devicesLoading) return;
    this.setData({ devicesLoading: true, deviceError: '' });
    api.devices()
      .then((res) => {
        const devices = (res.devices || []).map((device) => ({
          ...device,
          boundLabel: fmt.localDateTime(device.boundAt),
        }));
        this.setData({ devices });
      })
      .catch((err) => this.setData({ deviceError: err.message }))
      .then(() => this.setData({ devicesLoading: false }));
  },

  unbindDevice(event) {
    if (!this.data.loggedIn) {
      this.loginHint();
      return;
    }
    const did = event.currentTarget.dataset.did;
    const pid = event.currentTarget.dataset.pid;
    if (!did || this.data.unbinding) return;
    wx.showModal({
      title: '解绑设备',
      content: '解绑后该设备不再归属当前账号。要阻止本机继续连接，请再到设备上长按确认键 8 秒清除密钥。',
      confirmText: '解绑',
      confirmColor: '#9c3427',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ unbinding: true, deviceError: '' });
        api.unbindDevice(did)
          .then(() => {
            if (pid) ble.forgetDevice(pid);
            ble.disconnect().catch(() => null);
            this.setData({
              devices: this.data.devices.filter((device) => device.did !== did),
            });
            wx.showToast({ title: '已解绑', icon: 'success' });
          })
          .catch((err) => this.setData({ deviceError: err.message }))
          .then(() => this.setData({ unbinding: false }));
      },
    });
  },

  sync(loggedIn) {
    const signedIn = loggedIn === undefined ? auth.isLoggedIn() : loggedIn;
    const user = auth.getUser() || {};
    const path = user.avatar || '';
    this.setData({
      user,
      initial: fmt.initial(user.nickname || (signedIn ? '微信用户' : '未登录')),
      avatarUrl: '',
      nickname: user.nickname || '',
    });
    avatar.resolve(path).then((url) => {
      const current = auth.getUser() || {};
      if ((current.avatar || '') === path) this.setData({ avatarUrl: url });
    });
  },

  onNickname(event) {
    this.setData({ nickname: event.detail.value });
  },

  save() {
    if (!this.data.loggedIn) {
      this.loginHint();
      return;
    }
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
    if (!this.data.loggedIn) {
      this.loginHint();
      return;
    }
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
    if (!this.data.loggedIn) {
      this.goLogin();
      return;
    }
    wx.showModal({
      title: '退出登录',
      content: '退出后回到本机模式：新日程只保存在这台手机上，云端和设备同步暂停。设备上的日程不会删除。',
      confirmText: '退出',
      confirmColor: '#9c3427',
      success: (res) => {
        if (!res.confirm) return;
        api.logout()
          .then(() => ble.disconnect().catch(() => null))
          .then(() => {
            avatar.clear();
            auth.clear();
            wx.reLaunch({ url: '/pages/index/index' });
          });
      },
    });
  },
});
