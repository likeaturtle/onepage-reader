'use strict';

/**
 * Read-only demo content for the guest mode.
 *
 * Nothing here touches wx.request or the BLE adapter. Sample events are built
 * relative to "today" so the month list is never empty, and the voice samples
 * cycle so a guest can try the flow more than once. utils/api.js is the only
 * caller; pages keep using the normal api surface.
 */

const fmt = require('./format');

const USER = { id: 'guest', nickname: '游客', guest: true };

const TRANSCRIPTS = [
  '明天下午三点项目评审，会议室 A',
  '周五晚上七点和朋友吃饭',
  '下周一上午十点做月度复盘',
];

// Day offsets relative to today. Spreading them over roughly two months
// before and after today keeps the neighbouring months of the 日程 tab
// populated no matter which day the guest opens the app.
const PLAN = [
  { offset: -40, start: '10:00', end: '11:00', title: '项目复盘', note: '样例日程 · 会议室 B' },
  { offset: -33, start: '19:30', end: '21:00', title: '读书会', note: '样例日程 · 线上' },
  { offset: -25, start: '09:00', end: '09:30', title: '周报提交', note: '样例日程' },
  { offset: -18, start: '14:00', end: '15:00', title: '设计走查', note: '样例日程 · 会议室 A' },
  { offset: -12, start: '08:00', end: '08:40', title: '晨跑', note: '样例日程' },
  { offset: -6, start: '15:00', end: '16:00', title: '客户沟通', note: '样例日程' },
  { offset: -2, start: '10:30', end: '11:30', title: '牙医复诊', note: '样例日程' },
  { offset: 0, start: '09:30', end: '10:30', title: '项目评审', note: '样例日程 · 会议室 A' },
  { offset: 0, start: '18:00', end: '19:00', title: '健身', note: '样例日程' },
  { offset: 1, start: '15:00', end: '15:30', title: '周会', note: '样例日程 · 线上' },
  { offset: 3, start: '19:00', end: '20:30', title: '家庭聚餐', note: '样例日程' },
  { offset: 6, start: '14:00', end: '15:00', title: '招聘面试', note: '样例日程' },
  { offset: 10, start: '10:00', end: '12:00', title: '季度规划', note: '样例日程' },
  { offset: 15, start: '20:00', end: '20:30', title: '交房租', note: '样例日程' },
  { offset: 21, start: '09:30', end: '10:30', title: '体检预约', note: '样例日程' },
  { offset: 29, start: '18:30', end: '20:00', title: '读书会', note: '样例日程 · 线上' },
  { offset: 38, start: '10:00', end: '11:00', title: '月度复盘', note: '样例日程' },
  { offset: 52, start: '15:00', end: '16:30', title: '客户拜访', note: '样例日程' },
  { offset: 70, start: '09:00', end: '10:00', title: '年度计划', note: '样例日程' },
];

let transcriptIndex = 0;

function dateFromToday(days) {
  const date = new Date();
  // Noon avoids the daylight-saving edge where subtracting a day lands on the
  // same calendar date at some offsets.
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return fmt.ymd(date);
}

function user() {
  return Object.assign({}, USER);
}

function events() {
  return PLAN.map((item, index) => ({
    id: `sample-${index + 1}`,
    date: dateFromToday(item.offset),
    start: item.start,
    end: item.end,
    title: item.title,
    note: item.note,
    deviceId: null,
    seq: index + 1,
    sample: true,
  }));
}

function eventsBetween(from, to) {
  return events().filter((event) =>
    (!from || event.date >= from) && (!to || event.date <= to));
}

function transcribe() {
  const text = TRANSCRIPTS[transcriptIndex % TRANSCRIPTS.length];
  transcriptIndex += 1;
  return text;
}

function scheduleDraft() {
  return {
    date: dateFromToday(1),
    start: '15:00',
    end: '15:30',
    title: '项目评审',
    note: '会议室 A',
  };
}

module.exports = {
  USER,
  user,
  events,
  eventsBetween,
  transcribe,
  scheduleDraft,
};
