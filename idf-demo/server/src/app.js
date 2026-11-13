'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { Store } = require('./store');
const { signToken, verifyToken } = require('./auth');
const { exchangeCode, httpError } = require('./wechat');

const JSON_LIMIT = 64 * 1024;
const AVATAR_LIMIT = 3 * 1024 * 1024;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 30;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(httpError(413, '请求体过大'));
        req.resume(); // drain without buffering, keep the socket usable for the 413
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function readJson(req, limit = JSON_LIMIT) {
  const buffer = await readBody(req, limit);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (_) {
    throw httpError(400, '请求体不是合法的 JSON');
  }
}

function createLoginLimiter() {
  const attempts = new Map();
  return function allow(ip) {
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_MAX_ATTEMPTS) {
      attempts.set(ip, recent);
      return false;
    }
    recent.push(now);
    attempts.set(ip, recent);
    return true;
  };
}

function detectImage(buffer) {
  if (buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}


const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_BYTES = 47;
const NOTE_BYTES = 95;

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2021 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function minutesOf(value) {
  if (value === '24:00') return 1440;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(value) {
  const clamped = Math.max(0, Math.min(1440, value));
  if (clamped === 1440) return '24:00';
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function truncateUtf8(text, maxBytes) {
  let out = '';
  let used = 0;
  for (const char of String(text)) {
    const size = Buffer.byteLength(char);
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

function normalizeEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, '请求体必须是 JSON 对象');
  }
  const date = String(body.date || '').trim();
  if (!isValidDate(date)) throw httpError(400, '日期不合法，应为 YYYY-MM-DD');
  const start = String(body.start || '').trim();
  if (!TIME_RE.test(start)) throw httpError(400, '开始时间不合法，应为 HH:MM');
  let end = String(body.end || '').trim();
  if (end !== '24:00' && !TIME_RE.test(end)) end = '';
  if (!end || minutesOf(end) <= minutesOf(start)) {
    end = timeFromMinutes(minutesOf(start) + 60);
  }
  const title = truncateUtf8(String(body.title || '').trim(), TITLE_BYTES);
  if (!title) throw httpError(400, '标题不能为空');
  const note = truncateUtf8(String(body.note || '').trim(), NOTE_BYTES);
  let deviceId = null;
  if (body.deviceId !== undefined && body.deviceId !== null) {
    const value = Number(body.deviceId);
    if (!Number.isInteger(value) || value <= 0) throw httpError(400, 'deviceId 不合法');
    deviceId = value;
  }
  return { date, start, end, title, note, deviceId };
}

function createApp(config, store = new Store(config.dataDir)) {
  const allowLogin = createLoginLimiter();

  function authenticate(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = verifyToken(token, config.sessionSecret);
    if (!payload) return null;
    return store.get(payload.sub);
  }

  function requireUser(req) {
    const user = authenticate(req);
    if (!user) throw httpError(401, '登录已过期，请重新登录');
    return user;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        wechat: Boolean(config.wxAppId && config.wxSecret),
        devLogin: config.allowDevLogin,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      if (!allowLogin(ip)) throw httpError(429, '登录太频繁，请一分钟后再试');

      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw httpError(400, '请求体必须是 JSON 对象');
      }
      let openid;

      if (body.dev === true) {
        if (!config.allowDevLogin) throw httpError(403, '开发登录未开启');
        openid = 'dev-local';
      } else {
        if (!config.wxAppId || !config.wxSecret) {
          throw httpError(503, '服务端未配置微信登录，请先填写 WX_APPID / WX_SECRET');
        }
        const code = String(body.code || '').trim();
        if (!code) throw httpError(400, '缺少登录 code');
        if (code.length > 128) throw httpError(400, '登录 code 不合法');
        const session = await exchangeCode(config, code);
        openid = session.openid;
      }

      let user = store.findByOpenid(openid);
      if (!user) {
        user = store.createUser(openid, openid === 'dev-local' ? { nickname: '开发测试' } : {});
      } else {
        store.touch(user);
      }

      const token = signToken(user.id, config.sessionSecret, config.tokenTtlDays * 86400);
      sendJson(res, 200, {
        token,
        user: store.publicUser(user),
        expiresIn: config.tokenTtlDays * 86400,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/me') {
      const user = requireUser(req);
      sendJson(res, 200, { user: store.publicUser(user) });
      return;
    }

    // POST is used by the mini program because wx.request does not document
    // PATCH; keep PATCH for generic HTTP clients.
    if ((req.method === 'POST' || req.method === 'PATCH') && pathname === '/api/me') {
      const user = requireUser(req);
      const body = await readJson(req);
      const nickname = String((body && body.nickname) || '').trim();
      if (!nickname) throw httpError(400, '昵称不能为空');
      if (nickname.length > 20) throw httpError(400, '昵称最多 20 个字符');
      const updated = store.update(user.id, { nickname });
      sendJson(res, 200, { user: store.publicUser(updated) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/me/avatar') {
      const user = requireUser(req);
      const body = await readJson(req, AVATAR_LIMIT);
      const raw = String((body && body.data) || '');
      const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
      if (!match) throw httpError(400, '头像格式不支持，请使用 PNG / JPEG / WebP');
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length < 100) throw httpError(400, '头像文件太小或已损坏');
      if (buffer.length > config.maxAvatarBytes) throw httpError(413, '头像不能超过 512 KB');
      const kind = detectImage(buffer);
      if (!kind) throw httpError(400, '头像内容不是有效的 PNG / JPEG / WebP');
      store.saveAvatar(user, buffer, kind.ext);
      sendJson(res, 200, { user: store.publicUser(user) });
      return;
    }


    if (req.method === 'GET' && pathname === '/api/events') {
      const user = requireUser(req);
      const from = (url.searchParams.get('from') || '').trim();
      const to = (url.searchParams.get('to') || '').trim();
      if (from && !isValidDate(from)) throw httpError(400, 'from 不合法');
      if (to && !isValidDate(to)) throw httpError(400, 'to 不合法');
      const includeDeleted = url.searchParams.get('includeDeleted') === '1';
      sendJson(res, 200, {
        events: store.listEvents(user.id, { from, to, includeDeleted }),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/events') {
      const user = requireUser(req);
      const body = await readJson(req);
      const input = normalizeEvent(body);
      const event = store.createEvent(user.id, input);
      sendJson(res, 201, { event });
      return;
    }

    if (pathname.startsWith('/api/events/')) {
      const user = requireUser(req);
      const segments = pathname.split('/').filter(Boolean);
      let id;
      try {
        id = decodeURIComponent(segments[2] || '');
      } catch (_) {
        throw httpError(400, '事件 id 不合法');
      }
      if (!UUID_RE.test(id)) throw httpError(400, '事件 id 不合法');
      const event = store.getEvent(user.id, id);
      if (!event) throw httpError(404, '日程不存在');
      const action = segments[3] || '';

      if (req.method === 'DELETE' && !action) {
        const deleted = store.softDeleteEvent(user.id, id);
        sendJson(res, 200, { ok: true, event: deleted });
        return;
      }

      if (req.method === 'POST' && action === 'device') {
        const body = await readJson(req);
        let deviceId = null;
        if (body && body.deviceId !== undefined && body.deviceId !== null) {
          const value = Number(body.deviceId);
          if (!Number.isInteger(value) || value <= 0) throw httpError(400, 'deviceId 不合法');
          deviceId = value;
        }
        const updated = store.updateEvent(user.id, id, { deviceId });
        sendJson(res, 200, { event: updated });
        return;
      }

      if (req.method === 'POST' && action === 'purge') {
        store.purgeEvent(user.id, id);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      // Tokens are stateless; the client drops its copy. Kept as an explicit
      // endpoint so a future revocation list can be added without a client change.
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/avatars/')) {
      const name = path.basename(decodeURIComponent(pathname.slice('/avatars/'.length)));
      const file = store.avatarPath(name);
      if (!file) {
        sendJson(res, 404, { error: '头像不存在' });
        return;
      }
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, {
        'content-type': mime,
        'cache-control': 'public, max-age=31536000, immutable',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    sendJson(res, 404, { error: '接口不存在' });
  }

  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    handle(req, res).catch((err) => {
      const status = err.status || 500;
      if (status >= 500 && !err.expose) console.error('[api]', err);
      const message = err.expose ? err.message : '服务器内部错误';
      if (!res.headersSent) {
        sendJson(res, status, { error: message });
      } else {
        res.end();
      }
    });
  });
}

module.exports = { createApp };
