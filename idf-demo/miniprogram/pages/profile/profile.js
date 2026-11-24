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
    guest: false,
    user: {},
    initial: '页',
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
    const session = auth.get();
    if (!session) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    const guest = Boolean(session.guest);
    this.setData({ guest });
    this.sync();
    if (guest) return;
    this.loadDevices();
    api.me()
      .then((res) => {
        auth.setUser(res.user);
        this.sync();
      })
      .catch(() => {});
  },

  guestHint() {
    wx.showToast({ title: '游客模式仅可查看样例数据', icon: 'none' });
  },

  loadDevices() {
    if (this.data.guest) return;
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
    if (this.data.guest) {
      this.guestHint();
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

  sync() {
    const user = auth.getUser() || {};
    const path = user.avatar || '';
    this.setData({
      user,
      initial: fmt.initial(user.nickname || '微信用户'),
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
    if (this.data.guest) {
      this.guestHint();
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
    if (this.data.guest) {
      this.guestHint();
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
    const guest = this.data.guest;
    wx.showModal({
      title: guest ? '退出游客模式' : '退出登录',
      content: guest
        ? '退出后回到登录页。游客模式没有保存任何数据，样例内容会消失。'
        : '退出后需要重新登录才能继续使用小程序，设备上的日程不会删除。',
      confirmText: '退出',
      confirmColor: '#9c3427',
      success: (res) => {
        if (!res.confirm) return;
        const finish = () => {
          avatar.clear();
          auth.clear();
          wx.reLaunch({ url: '/pages/login/login' });
        };
        if (guest) {
          ble.disconnect().catch(() => null).then(finish);
          return;
        }
        api.logout()
          .then(() => ble.disconnect().catch(() => null))
          .then(finish);
      },
    });
  },
});
