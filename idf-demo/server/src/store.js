'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Tiny JSON-file store. The demo only needs a handful of users, so a database
 * would add operational weight without buying anything. Writes are atomic
 * (tmp + rename) and synchronous, which is fine at this scale and keeps the
 * request handlers simple.
 */
class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'users.json');
    this.eventsFile = path.join(dataDir, 'events.json');
    this.avatarDir = path.join(dataDir, 'avatars');
    fs.mkdirSync(this.avatarDir, { recursive: true });
    this.data = this.load();
    this.events = this.loadEvents();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        users: raw.users || {},
        byOpenid: raw.byOpenid || {},
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[store] cannot read users.json:', err.message);
      }
      return { users: {}, byOpenid: {} };
    }
  }

  save() {
    this.writeAtomic(this.file, this.data);
  }

  writeAtomic(file, value) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  }

  loadEvents() {
    try {
      return JSON.parse(fs.readFileSync(this.eventsFile, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[store] cannot read events.json:', err.message);
      }
      return {};
    }
  }

  saveEvents() {
    this.writeAtomic(this.eventsFile, this.events);
  }

  findByOpenid(openid) {
    const id = this.data.byOpenid[openid];
    return id ? this.data.users[id] || null : null;
  }

  createUser(openid, extra = {}) {
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      openid,
      nickname: '',
      avatar: '',
      createdAt: now,
      lastLoginAt: now,
      ...extra,
    };
    this.data.users[user.id] = user;
    this.data.byOpenid[openid] = user.id;
    this.save();
    return user;
  }

  touch(user) {
    user.lastLoginAt = new Date().toISOString();
    this.save();
    return user;
  }

  get(id) {
    return this.data.users[id] || null;
  }

  update(id, patch) {
    const user = this.data.users[id];
    if (!user) return null;
    Object.assign(user, patch);
    this.save();
    return user;
  }

  saveAvatar(user, buffer, ext) {
    const name = `${user.id}-${Date.now()}.${ext}`;
    const previous = user.avatar;
    fs.writeFileSync(path.join(this.avatarDir, name), buffer);
    user.avatar = `/avatars/${name}`;
    this.save();
    if (previous && previous.startsWith('/avatars/')) {
      try {
        fs.unlinkSync(path.join(this.avatarDir, path.basename(previous)));
      } catch (_) {
        // Best effort: a stale file is harmless.
      }
    }
    return user;
  }

  avatarPath(name) {
    if (!/^[a-f0-9-]+-\d+\.(png|jpg|jpeg|webp)$/.test(name)) return null;
    const file = path.join(this.avatarDir, name);
    return fs.existsSync(file) ? file : null;
  }

  // --- events -----------------------------------------------------------

  userEvents(userId) {
    if (!this.events[userId]) this.events[userId] = [];
    return this.events[userId];
  }

  listEvents(userId, options = {}) {
    const from = options.from || '';
    const to = options.to || '';
    const includeDeleted = Boolean(options.includeDeleted);
    return this.userEvents(userId)
      .filter((event) => includeDeleted || !event.deletedAt)
      .filter((event) => !from || event.date >= from)
      .filter((event) => !to || event.date <= to)
      .slice()
      .sort((a, b) => {
        const left = `${a.date} ${a.start} ${a.createdAt}`;
        const right = `${b.date} ${b.start} ${b.createdAt}`;
        return left < right ? -1 : left > right ? 1 : 0;
      })
      .map((event) => ({ ...event }));
  }

  getEvent(userId, id) {
    const event = this.userEvents(userId).find((item) => item.id === id);
    return event ? { ...event } : null;
  }

  createEvent(userId, data) {
    const now = new Date().toISOString();
    const event = {
      id: crypto.randomUUID(),
      date: data.date,
      start: data.start,
      end: data.end,
      title: data.title,
      note: data.note || '',
      deviceId: Number.isFinite(data.deviceId) ? data.deviceId : null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.userEvents(userId).push(event);
    this.saveEvents();
    return { ...event };
  }

  updateEvent(userId, id, patch) {
    const event = this.userEvents(userId).find((item) => item.id === id);
    if (!event) return null;
    Object.assign(event, patch, { updatedAt: new Date().toISOString() });
    this.saveEvents();
    return { ...event };
  }

  softDeleteEvent(userId, id) {
    return this.updateEvent(userId, id, { deletedAt: new Date().toISOString() });
  }

  purgeEvent(userId, id) {
    const list = this.userEvents(userId);
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) return false;
    list.splice(index, 1);
    this.saveEvents();
    return true;
  }

  /** Never let openid or internal timestamps leak to the client. */
  publicUser(user) {
    return {
      id: user.id,
      nickname: user.nickname || '',
      avatar: user.avatar || '',
      createdAt: user.createdAt,
    };
  }
}

module.exports = { Store };
