'use strict';

const config = require('../config');
const auth = require('./auth');

let redirecting = false;

function base() {
  return String(config.apiBase || '').replace(/\/+$/, '');
}

function currentRoute() {
  const pages = getCurrentPages ? getCurrentPages() : [];
  const page = pages.length ? pages[pages.length - 1] : null;
  return page && page.route ? page.route : '';
}

function handleUnauthorized() {
  auth.clear();
  if (redirecting) return;
  if (currentRoute() === 'pages/login/login') return;
  redirecting = true;
  wx.reLaunch({
    url: '/pages/login/login',
    complete() {
      setTimeout(() => { redirecting = false; }, 1200);
    },
  });
}

function request(path, options) {
  const opts = options || {};
  const method = opts.method || 'GET';
  const needAuth = opts.auth !== false;
  const timeout = opts.timeout || 15000;

  return new Promise((resolve, reject) => {
    const header = { 'content-type': 'application/json' };
    if (needAuth) {
      const token = auth.getToken();
      if (token) header.Authorization = `Bearer ${token}`;
    }

    wx.request({
      url: base() + path,
      method,
      data: opts.data,
      header,
      timeout,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        if (res.statusCode === 401 && needAuth) handleUnauthorized();
        const message = (res.data && res.data.error) || `请求失败（${res.statusCode}）`;
        const error = new Error(message);
        error.status = res.statusCode;
        reject(error);
      },
      fail(err) {
        const error = new Error('无法连接服务器，请检查网络与 apiBase；真机请使用电脑局域网地址');
        error.cause = err;
        reject(error);
      },
    });
  });
}

function login(code) {
  return request('/api/login', {
    method: 'POST',
    auth: false,
    data: { code },
  });
}

function devLogin() {
  return request('/api/login', {
    method: 'POST',
    auth: false,
    data: { dev: true },
  });
}

function me() {
  return request('/api/me');
}

function updateMe(nickname) {
  return request('/api/me', {
    method: 'POST',
    data: { nickname },
  });
}

function uploadAvatar(dataUri) {
  return request('/api/me/avatar', {
    method: 'POST',
    data: { data: dataUri },
    timeout: 30000,
  });
}

function events(params) {
  const opts = params || {};
  const query = [];
  if (opts.from) query.push(`from=${encodeURIComponent(opts.from)}`);
  if (opts.to) query.push(`to=${encodeURIComponent(opts.to)}`);
  if (opts.includeDeleted) query.push('includeDeleted=1');
  const suffix = query.length ? `?${query.join('&')}` : '';
  return request(`/api/events${suffix}`).then((res) => res.events || []);
}

function createEvent(event) {
  return request('/api/events', {
    method: 'POST',
    data: event,
  }).then((res) => res.event);
}

function deleteEvent(id) {
  return request(`/api/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then((res) => res.event);
}

function mapDevice(id, deviceId) {
  return request(`/api/events/${encodeURIComponent(id)}/device`, {
    method: 'POST',
    data: { deviceId },
  }).then((res) => res.event);
}

function purgeEvent(id) {
  return request(`/api/events/${encodeURIComponent(id)}/purge`, {
    method: 'POST',
    data: {},
  });
}

function logout() {
  return request('/api/logout', { method: 'POST', auth: false }).catch(() => null);
}

module.exports = {
  base,
  request,
  login,
  devLogin,
  me,
  updateMe,
  uploadAvatar,
  events,
  createEvent,
  deleteEvent,
  mapDevice,
  purgeEvent,
  logout,
  handleUnauthorized,
};
