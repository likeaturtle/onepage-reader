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
