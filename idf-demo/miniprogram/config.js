'use strict';

/**
 * Runtime configuration for the mini program.
 *
 * Development: keep apiBase on your computer's LAN address if you test on a
 * phone. WeChat DevTools can reach 127.0.0.1, a phone cannot.
 *
 * Production: apiBase must be an HTTPS host that is registered under
 * 小程序后台 -> 开发 -> 开发设置 -> 服务器域名 -> request 合法域名.
 * `devLogin` must be false in production.
 */
module.exports = {
  apiBase: 'http://192.168.66.39:8787',
  devLogin: true,
  appName: '墨程CalCal',
  tagline: '把日程写进墨水屏',
  deviceNamePrefix: 'Mochen',
  protocol: 1,
};
