'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isBox } = require('./crypto');

const SCHEMA_VERSION = 3;
const DEVICES_SCHEMA_VERSION = 1;
const DEVICE_DID_RE = /^[0-9A-F]{12,32}$/;
const DEVICE_PID_RE = /^[0-9A-F]{12}$/;
const DEVICE_NAME_MAX = 64;
const AVATAR_RE = /^[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp)$/i;

function userAad(userId, field) {
  return `user:${userId}:${field}`;
}

function eventAad(userId, eventId, field) {
  return `event:${userId}:${eventId}:${field}`;
}

function cleanProfile(value) {
  const profile = value && typeof value === 'object' ? value : {};
  return {
    nickname: String(profile.nickname || ''),
    avatarId: String(profile.avatarId || ''),
  };
}

function normalizeDid(value) {
  const did = String(value || '').trim().toUpperCase();
  return DEVICE_DID_RE.test(did) ? did : '';
}

function normalizePid(value) {
  const pid = String(value || '').trim().toUpperCase();
  return DEVICE_PID_RE.test(pid) ? pid : '';
}

function cleanDeviceName(value) {
  return String(value || '').trim().slice(0, DEVICE_NAME_MAX);
}

function publicDevice(device) {
  return {
    did: device.did,
    pid: device.pid,
    name: device.name,
    boundAt: device.boundAt,
    lastSeenAt: device.lastSeenAt,
  };
}

function deviceError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/**
 * Tiny JSON-file store. This pre-release build only reads/writes schema v3:
 *
 *   users:  { id, openidHash, openidEnc, profile, createdAt, lastLoginAt }
 *   events: { id, seq, payload }
 *
 * There is deliberately no v1/v2 migration path. If an older file is found the
 * process refuses to start instead of silently rewriting data; the project has
 * not shipped yet, so the right move is to delete the old data directory.
 */
class Store {
  constructor(dataDir, keyrings) {
    if (!keyrings || !keyrings.data || !keyrings.index) {
      throw new Error('Store requires data and index keyrings');
    }

    this.dataDir = dataDir;
    this.keys = keyrings;
    this.file = path.join(dataDir, 'users.json');
    this.eventsFile = path.join(dataDir, 'events.json');
    this.devicesFile = path.join(dataDir, 'devices.json');
    this.avatarDir = path.join(dataDir, 'avatars');

    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.avatarDir, { recursive: true, mode: 0o700 });
    this.tightenPermissions();

    this.data = this.load();
    this.events = this.loadEvents();
    this.devices = this.loadDevices();
    this.verifyKeyMaterial();
  }

  // --- files ------------------------------------------------------------

  readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      console.warn(`[store] cannot read ${path.basename(file)}:`, err.message);
      this.quarantine(file);
      return null;
    }
  }

  load() {
    const raw = this.readJson(this.file);
    if (!raw) return { users: {}, byOpenidHash: {} };
    if (raw.v !== SCHEMA_VERSION) {
      throw new Error(
        `[store] users.json schema v${raw.v} is unsupported; this build only reads v${SCHEMA_VERSION}. ` +
        'Delete the old data directory instead of migrating pre-release data.',
      );
    }

    const normalized = this.normalizeUsers(raw);
    if (normalized.changed) {
      this.writeAtomic(this.file, {
        v: SCHEMA_VERSION,
        users: normalized.users,
        byOpenidHash: normalized.byOpenidHash,
      });
    }
    return { users: normalized.users, byOpenidHash: normalized.byOpenidHash };
  }

  loadEvents() {
    const raw = this.readJson(this.eventsFile);
    if (!raw) return { byUser: {} };
    if (raw.v !== SCHEMA_VERSION) {
      throw new Error(
        `[store] events.json schema v${raw.v} is unsupported; this build only reads v${SCHEMA_VERSION}. ` +
        'Delete the old data directory instead of migrating pre-release data.',
      );
    }

    const normalized = this.normalizeEvents(raw);
    if (normalized.changed) {
      this.writeAtomic(this.eventsFile, { v: SCHEMA_VERSION, byUser: normalized.byUser });
    }
    return { byUser: normalized.byUser };
  }

  save() {
    this.writeAtomic(this.file, {
      v: SCHEMA_VERSION,
      users: this.data.users,
      byOpenidHash: this.data.byOpenidHash,
    });
  }

  saveEvents() {
    this.writeAtomic(this.eventsFile, { v: SCHEMA_VERSION, byUser: this.events.byUser });
  }

  loadDevices() {
    const raw = this.readJson(this.devicesFile);
    if (!raw) return { byDid: {} };
    if (raw.v !== DEVICES_SCHEMA_VERSION) {
      throw new Error(
        `[store] devices.json schema v${raw.v} is unsupported; this build only reads v${DEVICES_SCHEMA_VERSION}. ` +
        'Delete the old data directory instead of migrating pre-release data.',
      );
    }
    const byDid = {};
    const source = raw.byDid && typeof raw.byDid === 'object' ? raw.byDid : {};
    for (const [key, value] of Object.entries(source)) {
      const did = normalizeDid(key);
      if (!did || !value || typeof value.userId !== 'string' || !value.userId) continue;
      byDid[did] = {
        did,
        pid: normalizePid(value.pid),
        userId: value.userId,
        name: cleanDeviceName(value.name),
        boundAt: typeof value.boundAt === 'string' ? value.boundAt : new Date().toISOString(),
        lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : new Date().toISOString(),
      };
    }
    return { byDid };
  }

  saveDevices() {
    this.writeAtomic(this.devicesFile, {
      v: DEVICES_SCHEMA_VERSION,
      byDid: this.devices.byDid,
    });
  }

  writeAtomic(file, value) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch (_) {
      // Platforms without POSIX modes (e.g. Windows) are not supported for a
      // production deploy; do not fail the write.
    }
  }

  /** Keep an unreadable file instead of letting the next save overwrite it. */
  quarantine(file) {
    const target = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, target);
      console.warn(`[store] moved unreadable ${path.basename(file)} to ${target}`);
    } catch (err) {
      console.warn(`[store] cannot quarantine ${file}:`, err.message);
    }
  }

  tightenPermissions() {
    const chmod = (target, mode) => {
      try {
        fs.chmodSync(target, mode);
      } catch (_) {
        // Best effort; the process may not own the file.
      }
    };

    chmod(this.dataDir, 0o700);
    chmod(this.avatarDir, 0o700);
    for (const file of [this.file, this.eventsFile, this.devicesFile]) {
      if (fs.existsSync(file)) chmod(file, 0o600);
    }

    try {
      for (const name of fs.readdirSync(this.avatarDir)) {
        const full = path.join(this.avatarDir, name);
        try {
          if (fs.statSync(full).isFile()) chmod(full, 0o600);
        } catch (_) {
          // Ignore a file that disappeared between readdir and stat.
        }
      }
    } catch (_) {
      // Avatar directory is created above; ignore a transient read error.
    }
  }

  // --- users ------------------------------------------------------------

  normalizeUsers(raw) {
    const users = { ...(raw.users || {}) };
    const byOpenidHash = { ...(raw.byOpenidHash || {}) };
    let changed = false;

    for (const [id, user] of Object.entries(users)) {
      if (!user || typeof user !== 'object' || Array.isArray(user)) {
        delete users[id];
        changed = true;
        continue;
      }

      if (!user.id) {
        user.id = id;
        changed = true;
      }

      // The encrypted copy lets a later INDEX_KEY rotation rehash every
      // account at startup without asking users to log in again.
      if (isBox(user.openidEnc)) {
        try {
          const openid = this.keys.data.unseal(user.openidEnc, userAad(user.id, 'openid'));
          if (user.openidEnc.kid !== this.keys.data.currentId) {
            user.openidEnc = this.keys.data.seal(openid, userAad(user.id, 'openid'));
            changed = true;
          }
          const hash = this.keys.index.hash(openid);
          if (user.openidHash !== hash) {
            if (user.openidHash && byOpenidHash[user.openidHash] === user.id) {
              delete byOpenidHash[user.openidHash];
            }
            user.openidHash = hash;
            changed = true;
          }
        } catch (err) {
          console.warn(`[store] cannot refresh openid index for user ${id}: ${err.message}`);
        }
      }

      if (!user.openidHash) {
        console.warn(`[store] user ${id} has no openid hash and cannot be looked up by login`);
      } else if (byOpenidHash[user.openidHash] !== user.id) {
        byOpenidHash[user.openidHash] = user.id;
        changed = true;
      }

      if (!isBox(user.profile)) {
        throw new Error(`[store] user ${id} has no profile payload; data is not schema v${SCHEMA_VERSION}`);
      }
      if (user.profile.kid !== this.keys.data.currentId) {
        try {
          const profile = this.openProfileBox(user, user.profile);
          this.sealProfile(user, profile);
          changed = true;
        } catch (err) {
          throw new Error(`DATA_KEY cannot decrypt users.json: ${err.message}`);
        }
      }
    }

    return { users, byOpenidHash, changed };
  }

  // --- profile ----------------------------------------------------------

  openProfileBox(user, box) {
    const parsed = JSON.parse(this.keys.data.unseal(box, userAad(user.id, 'profile')));
    return cleanProfile(parsed);
  }

  openProfile(user) {
    return this.openProfileBox(user, user.profile);
  }

  sealProfile(user, profile) {
    user.profile = this.keys.data.seal(
      JSON.stringify(cleanProfile(profile)),
      userAad(user.id, 'profile'),
    );
  }

  findByOpenid(openid) {
    const found = this.keys.index.lookup(openid, this.data.byOpenidHash);
    if (!found) return null;

    const user = this.data.users[found.id] || null;
    if (!user) {
      delete this.data.byOpenidHash[found.hash];
      this.save();
      return null;
    }

    if (!this.keys.index.isCurrent(found.hash)) {
      const hash = this.keys.index.hash(openid);
      delete this.data.byOpenidHash[found.hash];
      this.data.byOpenidHash[hash] = user.id;
      user.openidHash = hash;
      this.save();
    }

    return user;
  }

  createUser(openid, extra = {}) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const user = {
      id,
      openidHash: this.keys.index.hash(openid),
      openidEnc: this.keys.data.seal(String(openid), userAad(id, 'openid')),
      profile: this.keys.data.seal(
        JSON.stringify({ nickname: String(extra.nickname || ''), avatarId: '' }),
        userAad(id, 'profile'),
      ),
      createdAt: now,
      lastLoginAt: now,
    };
    this.data.users[user.id] = user;
    this.data.byOpenidHash[user.openidHash] = user.id;
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

    const profile = this.openProfile(user);
    if (Object.prototype.hasOwnProperty.call(patch, 'nickname')) {
      profile.nickname = String(patch.nickname || '');
    }
    this.sealProfile(user, profile);
    this.save();
    return user;
  }

  // --- avatar -----------------------------------------------------------

  avatarPath(name) {
    const base = path.basename(String(name || ''));
    if (!AVATAR_RE.test(base)) return null;
    const file = path.join(this.avatarDir, base);
    return fs.existsSync(file) ? file : null;
  }

  avatarFile(user) {
    const profile = this.openProfile(user);
    return this.avatarPath(profile.avatarId);
  }

  saveAvatar(user, buffer, ext) {
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const file = path.join(this.avatarDir, name);
    fs.writeFileSync(file, buffer, { mode: 0o600 });

    const profile = this.openProfile(user);
    const previous = profile.avatarId;
    profile.avatarId = name;
    this.sealProfile(user, profile);
    this.save();

    if (previous) {
      try {
        fs.unlinkSync(path.join(this.avatarDir, path.basename(previous)));
      } catch (_) {
        // Best effort: a stale file is harmless.
      }
    }
    return user;
  }

  // --- events -----------------------------------------------------------

  normalizeEvents(raw) {
    const byUser = { ...(raw.byUser || {}) };
    let changed = false;

    for (const [userId, list] of Object.entries(byUser)) {
      if (!Array.isArray(list)) {
        byUser[userId] = [];
        changed = true;
        continue;
      }

      const events = [];
      for (const event of list) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          changed = true;
          continue;
        }
        if (!event.id) {
          event.id = crypto.randomUUID();
          changed = true;
        }
        if (!isBox(event.payload)) {
          throw new Error(`[store] event ${event.id} has no payload; data is not schema v${SCHEMA_VERSION}`);
        }
        if (event.payload.kid !== this.keys.data.currentId) {
          try {
            const plain = this.keys.data.unseal(event.payload, eventAad(userId, event.id, 'payload'));
            event.payload = this.keys.data.seal(plain, eventAad(userId, event.id, 'payload'));
            changed = true;
          } catch (err) {
            throw new Error(`DATA_KEY cannot decrypt events.json: ${err.message}`);
          }
        }
        events.push(event);
      }

      let maxSeq = 0;
      for (const event of events) {
        if (Number.isInteger(event.seq) && event.seq > maxSeq) maxSeq = event.seq;
      }
      for (const event of events) {
        if (!Number.isInteger(event.seq) || event.seq <= 0) {
          event.seq = ++maxSeq;
          changed = true;
        }
      }

      byUser[userId] = events;
    }

    return { byUser, changed };
  }

  userEvents(userId) {
    if (!this.events.byUser[userId]) this.events.byUser[userId] = [];
    return this.events.byUser[userId];
  }

  nextSeq(userId) {
    let max = 0;
    for (const event of this.userEvents(userId)) {
      if (Number.isInteger(event.seq) && event.seq > max) max = event.seq;
    }
    return max + 1;
  }

  openEventPayload(userId, event) {
    const parsed = JSON.parse(
      this.keys.data.unseal(event.payload, eventAad(userId, event.id, 'payload')),
    );
    return {
      date: String(parsed.date || ''),
      start: String(parsed.start || ''),
      end: String(parsed.end || ''),
      title: String(parsed.title || ''),
      note: String(parsed.note || ''),
      deviceId: Number.isFinite(parsed.deviceId) ? parsed.deviceId : null,
      createdAt: parsed.createdAt || '',
      updatedAt: parsed.updatedAt || '',
      deletedAt: parsed.deletedAt || null,
    };
  }

  decryptEvent(userId, event) {
    const data = this.openEventPayload(userId, event);
    return { id: event.id, seq: event.seq, ...data };
  }

  listEvents(userId, options = {}) {
    const from = options.from || '';
    const to = options.to || '';
    const includeDeleted = Boolean(options.includeDeleted);
    return this.userEvents(userId)
      .map((event) => this.decryptEvent(userId, event))
      .filter((event) => includeDeleted || !event.deletedAt)
      .filter((event) => !from || event.date >= from)
      .filter((event) => !to || event.date <= to)
      .sort((a, b) => {
        const left = `${a.date} ${a.start} ${a.createdAt}`;
        const right = `${b.date} ${b.start} ${b.createdAt}`;
        return left < right ? -1 : left > right ? 1 : 0;
      });
  }

  getEvent(userId, id) {
    const event = this.userEvents(userId).find((item) => item.id === id);
    return event ? this.decryptEvent(userId, event) : null;
  }

  createEvent(userId, data) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const payload = {
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
    const event = {
      id,
      seq: this.nextSeq(userId),
      payload: this.keys.data.seal(
        JSON.stringify(payload),
        eventAad(userId, id, 'payload'),
      ),
    };
    this.userEvents(userId).push(event);
    this.saveEvents();
    return this.decryptEvent(userId, event);
  }

  updateEvent(userId, id, patch) {
    const event = this.userEvents(userId).find((item) => item.id === id);
    if (!event) return null;

    const next = { ...this.openEventPayload(userId, event), ...patch };
    next.updatedAt = new Date().toISOString();
    event.payload = this.keys.data.seal(
      JSON.stringify(next),
      eventAad(userId, id, 'payload'),
    );
    event.seq = this.nextSeq(userId);
    this.saveEvents();
    return this.decryptEvent(userId, event);
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

  // --- output -----------------------------------------------------------

  verifyKeyMaterial() {
    const user = Object.values(this.data.users)[0];
    if (user) {
      try {
        this.openProfile(user);
      } catch (err) {
        throw new Error(`DATA_KEY cannot decrypt users.json: ${err.message}`);
      }
    }

    for (const [userId, list] of Object.entries(this.events.byUser)) {
      const event = list[0];
      if (!event) continue;
      try {
        this.openEventPayload(userId, event);
      } catch (err) {
        throw new Error(`DATA_KEY cannot decrypt events.json: ${err.message}`);
      }
      break;
    }
  }

  // --- devices ----------------------------------------------------------

  listDevices(userId) {
    return Object.values(this.devices.byDid)
      .filter((device) => device.userId === userId)
      .sort((a, b) => String(a.boundAt).localeCompare(String(b.boundAt)))
      .map(publicDevice);
  }

  getDevice(did) {
    const key = normalizeDid(did);
    return key ? this.devices.byDid[key] || null : null;
  }

  claimDevice(userId, did, name, pid) {
    const key = normalizeDid(did);
    if (!key) throw deviceError(400, '设备 ID 不合法');
    const linkId = normalizePid(pid);
    if (pid !== undefined && pid !== null && String(pid) && !linkId) {
      throw deviceError(400, '设备广播 ID 不合法');
    }
    const existing = this.devices.byDid[key];
    if (existing && existing.userId !== userId) {
      throw deviceError(409, '设备已绑定其他账号');
    }
    const now = new Date().toISOString();
    const device = existing || {
      did: key,
      pid: linkId,
      userId,
      name: cleanDeviceName(name),
      boundAt: now,
      lastSeenAt: now,
    };
    device.userId = userId;
    if (linkId) device.pid = linkId;
    if (name !== undefined && name !== null) device.name = cleanDeviceName(name);
    device.lastSeenAt = now;
    this.devices.byDid[key] = device;
    this.saveDevices();
    return publicDevice(device);
  }

  unbindDevice(userId, did) {
    const key = normalizeDid(did);
    if (!key) throw deviceError(400, '设备 ID 不合法');
    const existing = this.devices.byDid[key];
    if (!existing) throw deviceError(404, '设备未绑定');
    if (existing.userId !== userId) throw deviceError(403, '无权解绑该设备');
    delete this.devices.byDid[key];
    this.saveDevices();
    return publicDevice(existing);
  }

  /** Never let openid or internal timestamps leak to the client. */
  publicUser(user) {
    const profile = this.openProfile(user);
    return {
      id: user.id,
      nickname: profile.nickname,
      avatar: profile.avatarId
        ? `/api/me/avatar?v=${encodeURIComponent(profile.avatarId)}`
        : '',
      createdAt: user.createdAt,
    };
  }
}

module.exports = { Store, SCHEMA_VERSION, normalizeDid };
