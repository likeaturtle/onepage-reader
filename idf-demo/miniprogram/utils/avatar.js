'use strict';

const config = require('../config');
const auth = require('./auth');

/**
 * Avatars are no longer public URLs. Download them with the login token into a
 * local temp file, then let <image> render that path. The URL carries a version
 * query (?v=<avatarId>), so replacing an avatar naturally misses this cache.
 */
const cache = Object.create(null);

function resolve(pathname) {
  const value = String(pathname || '');
  if (!value) return Promise.resolve('');
  if (/^https?:\/\//.test(value)) return Promise.resolve(value);

  const base = String(config.apiBase || '').replace(/\/+$/, '');
  const url = base + (value.charAt(0) === '/' ? value : `/${value}`);
  if (cache[url]) return Promise.resolve(cache[url]);

  return new Promise((resolve) => {
    wx.downloadFile({
      url,
      header: auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {},
      success(res) {
        if (res.statusCode === 200 && res.tempFilePath) {
          cache[url] = res.tempFilePath;
          resolve(res.tempFilePath);
          return;
        }
        resolve('');
      },
      fail() {
        resolve('');
      },
    });
  });
}

function clear() {
  for (const key of Object.keys(cache)) delete cache[key];
}

module.exports = { resolve, clear };
