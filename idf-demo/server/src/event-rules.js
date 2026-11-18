'use strict';

const { httpError } = require('./http-error');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TITLE_BYTES = 95;
const NOTE_BYTES = 191;

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

/**
 * Validate a create/update payload. AI drafts use the same rules as API
 * clients; only the implicit duration differs (voice defaults to 30 minutes,
 * which matches the add form, while a plain API create falls back to 60).
 */
function normalizeEvent(body, options = {}) {
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
    const fallback = Number(options.defaultEndMinutes);
    end = timeFromMinutes(minutesOf(start) + (Number.isFinite(fallback) && fallback > 0 ? fallback : 60));
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

module.exports = {
  DATE_RE,
  TIME_RE,
  TITLE_BYTES,
  NOTE_BYTES,
  isValidDate,
  minutesOf,
  timeFromMinutes,
  truncateUtf8,
  normalizeEvent,
};
