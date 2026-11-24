'use strict';

const KEY = 'onepage.session.v1';

/**
 * A guest session is a local-only stand-in for a login: it carries no token,
 * so nothing can be sent to the server, and the flag lets api.js answer from
 * utils/sample.js instead. It is stored like a real session so the tab pages
 * keep working after a restart.
 */
function get() {
  try {
    const session = wx.getStorageSync(KEY);
    return session && (session.token || session.guest) ? session : null;
  } catch (_) {
    return null;
  }
}

function startGuest() {
  const value = {
    guest: true,
    token: '',
    user: { id: 'guest', nickname: '游客', guest: true },
    savedAt: Date.now(),
  };
  wx.setStorageSync(KEY, value);
  return value;
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
  return session ? session.token || '' : '';
}

function isGuest() {
  const session = get();
  return Boolean(session && session.guest);
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

module.exports = { get, startGuest, save, setUser, getToken, isGuest, getUser, clear };
