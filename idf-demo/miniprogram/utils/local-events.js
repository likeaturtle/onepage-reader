'use strict';

/**
 * Events created while the user is not logged in.
 *
 * They live in wx storage on this phone only: no wx.request and no BLE write.
 * Logged-in users keep using the cloud store, so this module is only called
 * from the local-mode branches in the 添加 and 日程 pages.
 */

const KEY = 'onepage.local.events.v1';
const FIELDS = ['date', 'start', 'end', 'title', 'note'];

function text(value) {
  return String(value == null ? '' : value).trim();
}

function read() {
  try {
    const stored = wx.getStorageSync(KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter((event) => event && typeof event.id === 'string');
  } catch (_) {
    return [];
  }
}

function write(events) {
  try {
    wx.setStorageSync(KEY, events);
  } catch (err) {
    const error = new Error('本机存储空间不足，无法保存日程');
    error.cause = err;
    throw error;
  }
}

function copy(event) {
  // `local: true` lets the 日程 page distinguish these from cloud records even
  // while the user is logged in; it is not persisted.
  return Object.assign({ local: true }, event);
}

function sortKey(event) {
  return `${event.date || ''} ${event.start || ''} ${event.id}`;
}

function normalize(input, base) {
  const source = input || {};
  const event = Object.assign({}, base || {});
  for (const field of FIELDS) {
    if (source[field] !== undefined) event[field] = text(source[field]);
  }
  return event;
}

function newId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function list(params) {
  const opts = params || {};
  return read()
    .filter((event) =>
      (!opts.from || event.date >= opts.from) &&
      (!opts.to || event.date <= opts.to))
    .sort((left, right) => {
      const a = sortKey(left);
      const b = sortKey(right);
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map(copy);
}

function all() {
  return read().sort((left, right) => {
    const a = sortKey(left);
    const b = sortKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }).map(copy);
}

function create(input) {
  const now = Date.now();
  const event = normalize(input);
  event.id = newId();
  event.createdAt = now;
  event.updatedAt = now;
  event.deviceId = null;

  const events = read();
  events.push(event);
  write(events);
  return copy(event);
}

function update(id, input) {
  const events = read();
  const index = events.findIndex((event) => event.id === id);
  if (index < 0) return null;
  events[index] = normalize(input, events[index]);
  events[index].updatedAt = Date.now();
  write(events);
  return copy(events[index]);
}

function remove(id) {
  const events = read();
  const next = events.filter((event) => event.id !== id);
  if (next.length === events.length) return false;
  write(next);
  return true;
}

function clear() {
  try {
    wx.removeStorageSync(KEY);
  } catch (_) {
    // ignore
  }
}

module.exports = { list, all, create, update, remove, clear };
