'use strict';

const config = require('../config');
const auth = require('./auth');

let redirecting = false;

function base() {
  return String(config.apiBase || '').replace(/\/+$/, '');
}

function loginRequired() {
  const error = new Error('请先登录后再使用云端功能');
  error.status = 401;
  error.loginRequired = true;
  return error;
}

/* A 401 means the cached token is stale. Login is optional now, so instead of
 * trapping the user on the login page we drop the session and reload the
 * local-only 添加 tab (a no-session reload leaves the pages in local mode). */
function handleUnauthorized() {
  auth.clear();
  if (redirecting) return;
  redirecting = true;
  if (typeof wx.showToast === 'function') {
    wx.showToast({ title: '登录已失效，已切换为本机模式', icon: 'none' });
  }
  wx.reLaunch({
    url: '/pages/index/index',
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

  // Never send an unauthenticated cloud call: without a token the pages read
  // and write utils/local-events.js instead.
  if (needAuth && !auth.getToken()) return Promise.reject(loginRequired());

  return new Promise((resolve, reject) => {
    const header = { 'content-type': 'application/json' };
    if (needAuth) {
      header.Authorization = `Bearer ${auth.getToken()}`;
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

function transcribe(audio, meta) {
  const opts = meta || {};
  return request('/api/ai/transcribe', {
    method: 'POST',
    timeout: 45000,
    data: {
      audio,
      format: opts.format || 'pcm',
      sampleRate: opts.sampleRate || 16000,
      channels: opts.channels || 1,
      bitsPerSample: opts.bitsPerSample || 16,
    },
  });
}

function parseSchedule(text) {
  return request('/api/ai/schedule', {
    method: 'POST',
    data: { text },
    timeout: 30000,
  }).then((res) => res.event);
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

function updateEvent(id, event) {
  return request(`/api/events/${encodeURIComponent(id)}`, {
    // wx.request does not document PATCH; the server accepts POST here too.
    method: 'POST',
    data: event,
  }).then((res) => res.event);
}

function deleteEvent(id) {
  return request(`/api/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then((res) => res.event);
}

function claimDevice(did, name, pid) {
  return request('/api/devices/claim', {
    method: 'POST',
    data: { did, name, pid },
  });
}

function devices() {
  return request('/api/devices');
}

function unbindDevice(did) {
  return request(`/api/devices/${encodeURIComponent(did)}/unbind`, {
    method: 'POST',
    data: {},
  });
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
  transcribe,
  parseSchedule,
  events,
  createEvent,
  updateEvent,
  deleteEvent,
  claimDevice,
  devices,
  unbindDevice,
  mapDevice,
  purgeEvent,
  logout,
  handleUnauthorized,
};
