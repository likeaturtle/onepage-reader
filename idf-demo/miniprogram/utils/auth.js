'use strict';

const KEY = 'onepage.session.v1';

function get() {
  try {
    const session = wx.getStorageSync(KEY);
    return session && session.token ? session : null;
  } catch (_) {
    return null;
  }
}

function save(session) {
  const value = {
    token: session.token,
    user: session.user || null,
    savedAt: Date.now(),
  };
  wx.setStorageSync(KEY, value);
  return value;
}

function setUser(user) {
  const session = get();
  if (!session) return null;
  session.user = user;
  wx.setStorageSync(KEY, session);
  return session;
}

function getToken() {
  const session = get();
  return session ? session.token : '';
}

function getUser() {
  const session = get();
  return session ? session.user : null;
}

function clear() {
  try {
    wx.removeStorageSync(KEY);
  } catch (_) {
    // ignore
  }
}

module.exports = { get, save, setUser, getToken, getUser, clear };
