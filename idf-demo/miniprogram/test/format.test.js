'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fmt = require('../utils/format');

test('shiftClock moves a time forward and rolls over the hour', () => {
  assert.equal(fmt.shiftClock('09:00', 30), '09:30');
  assert.equal(fmt.shiftClock('09:45', 30), '10:15');
  assert.equal(fmt.shiftClock('23:00', 30), '23:30');
  assert.equal(fmt.shiftClock('08:30', 0), '08:30');
  assert.equal(fmt.shiftClock('08:30', undefined), '08:30');
});

test('shiftClock clamps inside the same day instead of wrapping', () => {
  assert.equal(fmt.shiftClock('23:40', 30), '23:59');
  assert.equal(fmt.shiftClock('00:10', -30), '00:00');
});

test('shiftClock leaves invalid input untouched', () => {
  assert.equal(fmt.shiftClock('', 30), '');
  assert.equal(fmt.shiftClock(null, 30), null);
  assert.equal(fmt.shiftClock('9:00', 30), '9:00');
  assert.equal(fmt.shiftClock('24:00', 30), '24:00');
  assert.equal(fmt.shiftClock('09:75', 30), '09:75');
});

test('localDateTime renders a server timestamp in local time', () => {
  const bound = new Date(2026, 10, 19, 21, 32, 45);
  assert.equal(fmt.localDateTime(bound.toISOString()), '2026-11-19 21:32');
  assert.equal(fmt.localDateTime(''), '');
  assert.equal(fmt.localDateTime(null), '');
  assert.equal(fmt.localDateTime('not a date'), '');
});

test('groupEvents sorts events by date and start and groups them by day', () => {
  const groups = fmt.groupEvents([
    { id: 'b', date: '2026-11-10', start: '13:00', end: '14:00', title: 'B' },
    { id: 'a', date: '2026-11-10', start: '09:00', end: '10:00', title: 'A' },
    { id: 'c', date: '2026-11-09', start: '09:00', end: '10:00', title: 'C' },
  ]);
  assert.deepEqual(groups.map((group) => group.date), ['2026-11-09', '2026-11-10']);
  assert.deepEqual(groups[1].items.map((item) => item.title), ['A', 'B']);
  assert.equal(groups[0].weekday, '周一'); // 2026-11-09 is a Monday
});

test('groupEvents inserts an empty section for today when it has no events', () => {
  const todayText = fmt.ymd(new Date());
  const groups = fmt.groupEvents([
    { id: 'a', date: '2000-01-01', start: '09:00', end: '10:00', title: 'A' },
    { id: 'b', date: '2999-12-31', start: '09:00', end: '10:00', title: 'B' },
  ], { today: todayText });

  assert.deepEqual(groups.map((group) => group.date),
    ['2000-01-01', todayText, '2999-12-31']);
  const todayGroup = groups[1];
  assert.equal(todayGroup.today, true);
  assert.equal(todayGroup.day, new Date().getDate());
  assert.deepEqual(todayGroup.items, []);
});

test('groupEvents does not duplicate today and still lists a blank current month', () => {
  const todayText = fmt.ymd(new Date());
  const groups = fmt.groupEvents([
    { id: 'a', date: todayText, start: '09:00', end: '10:00', title: 'A' },
  ], { today: todayText });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);

  // An empty current month still gets today's section; the month-level hint
  // is driven by the event count instead of the group count.
  const emptyMonth = fmt.groupEvents([], { today: todayText });
  assert.equal(emptyMonth.length, 1);
  assert.equal(emptyMonth[0].date, todayText);
  assert.deepEqual(emptyMonth[0].items, []);

  // Other months pass no `today` option, so they stay group-less when empty.
  assert.deepEqual(fmt.groupEvents([]), []);
});
