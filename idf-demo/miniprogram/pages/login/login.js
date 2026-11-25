'use strict';

const config = require('../../config');
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const cal = require('../../utils/calendar');
const fmt = require('../../utils/format');

/**
 * Five or six Sunday-first weeks for the month containing `now`, with the
 * neighbouring-month cells blanked out. The login page prints this month as
 * context under the big date; it is not a date picker, so there is no
 * selected cell and out-of-month numbers are omitted.
 */
function monthWeeks(now) {
  const cells = cal.monthGrid(now.getFullYear(), now.getMonth(), '', fmt.ymd(now));
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    const week = cells.slice(index, index + 7);
    if (!week.some((cell) => cell.inMonth)) continue;
    weeks.push({
      key: week[0].key,
      cells: week.map((cell) => ({
        key: cell.key,
        day: cell.inMonth ? cell.day : '',
        today: cell.today,
      })),
    });
  }
  return weeks;
}

function dateView(now) {
  const date = now || new Date();
  return {
    today: fmt.todayMeta(date),
    monthWeeks: monthWeeks(date),
  };
}

const initialView = dateView();

Page({
  data: {
    appName: config.appName,
    tagline: config.tagline,
    devLogin: Boolean(config.devLogin),
    today: initialView.today,
    monthWeeks: initialView.monthWeeks,
    weekdays: cal.WEEKDAY_INITIALS,
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

  // The masthead date and the printed month belong to the day the page is on
  // screen, not the day the process started.
  onShow() {
    this.setData(dateView());
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

  // A local-only session is gone by design: login is now opt-in from 我的.
  // This page is only reached from that entry, so it needs a way back to the
  // tab pages without logging in.
  goBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  },

  finish(session) {
    auth.save(session);
    const app = getApp();
    if (app) app.globalData.user = session.user;
    this.setData({ busy: false, error: '' });
    wx.switchTab({ url: '/pages/index/index' });
  },
});
