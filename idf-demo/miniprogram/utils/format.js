'use strict';

const config = require('../config');
const utf8 = require('./utf8');

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseYmd(text) {
  const parts = String(text || '').split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function monthBounds(cursor) {
  const date = typeof cursor === 'string' ? parseYmd(cursor) : cursor;
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: ymd(first), to: ymd(last) };
}

function monthLabel(date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function groupEvents(events) {
  const sorted = (events || []).slice().sort((a, b) => {
    const left = `${a.date} ${a.start || ''}`;
    const right = `${b.date} ${b.start || ''}`;
    if (left !== right) return left < right ? -1 : 1;
    const leftId = String(a.id);
    const rightId = String(b.id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });

  const groups = [];
  let current = null;
  for (const event of sorted) {
    if (!current || current.date !== event.date) {
      const day = parseYmd(event.date);
      current = {
        date: event.date,
        label: `${day.getMonth() + 1} 月 ${day.getDate()} 日 ${WEEKDAYS[day.getDay()]}`,
        items: [],
      };
      groups.push(current);
    }
    current.items.push({
      id: event.id,
      start: event.start || '--:--',
      end: event.end || '',
      title: event.title || '(无标题)',
      note: event.note || '',
    });
  }
  return groups;
}

function deviceTime(hello) {
  if (!hello || !hello.time_valid || !Number.isFinite(hello.now) || !Number.isFinite(hello.tz)) {
    return '';
  }
  const shifted = new Date((hello.now + hello.tz * 60) * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function initial(name) {
  const chars = Array.from(String(name || '').trim());
  return chars.length ? chars[0] : '页';
}

function avatarUrl(avatar) {
  if (!avatar) return '';
  if (/^https?:\/\//.test(avatar)) return avatar;
  return config.apiBase.replace(/\/+$/, '') + (avatar.charAt(0) === '/' ? '' : '/') + avatar;
}

function utf8Len(text) {
  return utf8.byteLength(text || '');
}

module.exports = {
  WEEKDAYS,
  pad,
  ymd,
  parseYmd,
  monthBounds,
  monthLabel,
  groupEvents,
  deviceTime,
  initial,
  avatarUrl,
  utf8Len,
};
