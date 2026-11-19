'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { Store } = require('./store');
const { createKeyrings } = require('./crypto');
const { signToken, verifyToken } = require('./auth');
const { exchangeCode } = require('./wechat');
const { httpError } = require('./http-error');
const { isValidDate, normalizeEvent } = require('./event-rules');
const { transcribe, parseSchedule } = require('./ai');

const JSON_LIMIT = 64 * 1024;
const AVATAR_LIMIT = 3 * 1024 * 1024;
const AI_AUDIO_LIMIT = 6 * 1024 * 1024;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 30;
const AI_WINDOW_MS = 60 * 1000;
const AI_MAX_REQUESTS = 20;
const AI_MAX_TEXT_CHARS = 500;

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

function clientIp(req, trustProxy) {
  if (trustProxy) {
    // nginx runs on loopback and overwrites X-Real-IP with $remote_addr.
    // Read the length-capped value so a client cannot grow the limiter map
    // with an arbitrarily long header.
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim().slice(0, 64);
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim().slice(0, 64);
    }
  }
  return req.socket.remoteAddress || 'unknown';
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


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Voice recognition and parsing cost money, so each logged-in user gets a small
// sliding-window budget in addition to the login limiter.
function createAiLimiter() {
  const attempts = new Map();
  return function allow(userId) {
    const now = Date.now();
    const recent = (attempts.get(userId) || []).filter((t) => now - t < AI_WINDOW_MS);
    if (recent.length >= AI_MAX_REQUESTS) {
      attempts.set(userId, recent);
      return false;
    }
    recent.push(now);
    attempts.set(userId, recent);
    return true;
  };
}

function createApp(config, store) {
  if (!store) store = new Store(config.dataDir, createKeyrings(config));
  const allowLogin = createLoginLimiter();
  const allowAi = createAiLimiter();

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

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        wechat: Boolean(config.wxAppId && config.wxSecret),
        devLogin: config.allowDevLogin,
        ai: Boolean(config.deepseekApiKey),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      const ip = clientIp(req, config.trustProxy);
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

    if (req.method === 'GET' && pathname === '/api/me/avatar') {
      const user = requireUser(req);
      const file = store.avatarFile(user);
      if (!file) {
        sendJson(res, 404, { error: '头像不存在' });
        return;
      }
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const stat = fs.statSync(file);
      res.writeHead(200, {
        'content-type': mime,
        'content-length': stat.size,
        // Private content: never let a shared cache keep one user's avatar.
        'cache-control': 'private, max-age=300',
        vary: 'Authorization',
      });
      fs.createReadStream(file).pipe(res);
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


    if (req.method === 'POST' && pathname === '/api/ai/transcribe') {
      const user = requireUser(req);
      if (!allowAi(user.id)) throw httpError(429, '语音识别太频繁，请稍后再试');
      const body = await readJson(req, AI_AUDIO_LIMIT);
      const audio = {
        data: String((body && body.audio) || ''),
        sampleRate: Number(body && body.sampleRate) || 16000,
        channels: Number(body && body.channels) || 1,
        bitsPerSample: Number(body && body.bitsPerSample) || 16,
      };
      if (!audio.data) throw httpError(400, '缺少录音数据');
      const result = await transcribe(config, audio);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/ai/schedule') {
      const user = requireUser(req);
      if (!allowAi(user.id)) throw httpError(429, 'AI 解析太频繁，请稍后再试');
      const body = await readJson(req);
      const text = String((body && body.text) || '').trim();
      if (!text) throw httpError(400, '日程内容不能为空');
      if (text.length > AI_MAX_TEXT_CHARS) {
        throw httpError(400, `日程内容最多 ${AI_MAX_TEXT_CHARS} 字`);
      }
      const event = await parseSchedule(config, text);
      sendJson(res, 200, { event });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/devices') {
      const user = requireUser(req);
      sendJson(res, 200, { devices: store.listDevices(user.id) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/devices/claim') {
      const user = requireUser(req);
      const body = await readJson(req);
      const did = String((body && body.did) || '');
      const name = body && body.name !== undefined ? String(body.name || '') : undefined;
      const pid = body && body.pid !== undefined ? String(body.pid || '') : undefined;
      const device = store.claimDevice(user.id, did, name, pid);
      sendJson(res, 200, { device });
      return;
    }

    if (pathname.startsWith('/api/devices/')) {
      const user = requireUser(req);
      const segments = pathname.split('/').filter(Boolean);
      let did;
      try {
        did = decodeURIComponent(segments[2] || '');
      } catch (_) {
        throw httpError(400, '设备 ID 不合法');
      }
      if (req.method === 'POST' && segments[3] === 'unbind') {
        store.unbindDevice(user.id, did);
        sendJson(res, 200, { ok: true });
        return;
      }
      throw httpError(404, '接口不存在');
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

      if ((req.method === 'PATCH' || req.method === 'POST') && !action) {
        // wx.request does not document PATCH, so the mini program posts here;
        // PATCH stays available for other clients.
        if (event.deletedAt) throw httpError(409, '日程已删除');
        const body = await readJson(req);
        // PATCH is a content edit: merge with the stored event so a partial
        // body keeps the other fields, then validate the result as a whole.
        const input = normalizeEvent({ ...event, ...body });
        // The cloud <-> device mapping belongs to /device; an edit must not
        // clear it (the device update keeps the same numeric id).
        delete input.deviceId;
        const updated = store.updateEvent(user.id, id, input);
        sendJson(res, 200, { event: updated });
        return;
      }

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
