'use strict';

const config = require('../../config');
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    appName: config.appName,
    tagline: config.tagline,
    devLogin: Boolean(config.devLogin),
    apiBase: config.apiBase,
    busy: false,
    error: '',
  },

  onLoad() {
    // Never expose the password-less dev login in a released build, even if
    // config.js was copied unchanged from a development checkout.
    let envVersion = 'develop';
    try {
      const account = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
      if (account && account.miniProgram && account.miniProgram.envVersion) {
        envVersion = account.miniProgram.envVersion;
      }
    } catch (_) {
      // older base library
    }
    this.setData({ devLogin: Boolean(config.devLogin) && envVersion !== 'release' });

    if (auth.getToken()) {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  wechatLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });

    wx.login({
      success: (res) => {
        if (!res.code) {
          this.setData({ busy: false, error: '微信未返回登录 code，请确认小程序已绑定 AppID' });
          return;
        }
        api.login(res.code)
          .then((session) => this.finish(session))
          .catch((err) => this.setData({ busy: false, error: err.message || '登录失败' }));
      },
      fail: (err) => {
        this.setData({
          busy: false,
          error: (err && err.errMsg) || '微信登录失败，请重试',
        });
      },
    });
  },

  devLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    api.devLogin()
      .then((session) => this.finish(session))
      .catch((err) => this.setData({ busy: false, error: err.message || '开发登录失败' }));
  },

  finish(session) {
    auth.save(session);
    const app = getApp();
    if (app) app.globalData.user = session.user;
    this.setData({ busy: false, error: '' });
    wx.switchTab({ url: '/pages/index/index' });
  },
});
