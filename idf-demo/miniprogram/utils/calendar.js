'use strict';

/**
 * Month grid for the add-event calendar picker.
 *
 * The device month view starts its weeks on Sunday, so the picker does too.
 * Every grid is six weeks (42 cells) tall: switching months never changes the
 * panel height, and a date from a neighbouring month is always reachable in
 * the same tap.
 */

const fmt = require('./format');

const CELLS = 42;
const WEEKDAY_INITIALS = fmt.WEEKDAYS.map((name) => name.slice(-1));
// Breathing room (px) around the panel when it is scrolled into view.
const REVEAL_MARGIN = 12;

function monthLabel(year, month) {
  return `${year} 年 ${month + 1} 月`;
}

/** `{ year, month }` (month is 0-based) for the month containing `ymd`. */
function cursorFrom(ymd) {
  const date = fmt.parseYmd(ymd);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/**
 * 42 cells for the month of `year`/`month` (0-based).
 * Each cell: `{ key, date, day, inMonth, today, selected }`, where `date` is
 * the same `YYYY-MM-DD` string the form and the API use.
 */
function monthGrid(year, month, selectedYmd, todayYmd) {
  const first = new Date(year, month, 1);
  // Day 1 - first.getDay() walks back to the Sunday that opens the week.
  const start = new Date(year, month, 1 - first.getDay());
  const cells = [];
  for (let index = 0; index < CELLS; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const ymd = fmt.ymd(date);
    cells.push({
      key: ymd,
      date: ymd,
      day: date.getDate(),
      inMonth: date.getFullYear() === year && date.getMonth() === month,
      today: ymd === todayYmd,
      selected: ymd === selectedYmd,
    });
  }
  return cells;
}

/**
 * Absolute scrollTop that makes a panel fully visible, or `null` when the
 * panel already fits. `top`/`height` are viewport pixels from a selector
 * query, `scrollTop` is the current page offset.
 *
 * A panel taller than the viewport cannot fully fit; the top of the panel wins
 * so the month header and the first weeks stay readable.
 */
function revealScrollTop(options) {
  const top = Number(options && options.top);
  const height = Number(options && options.height);
  const scrollTop = Number(options && options.scrollTop) || 0;
  const viewport = Number(options && options.viewport);
  const margin = Number.isFinite(Number(options && options.margin))
    ? Number(options.margin)
    : REVEAL_MARGIN;
  if (!Number.isFinite(top) || !Number.isFinite(height) || !Number.isFinite(viewport)) {
    return null;
  }
  // A negative `top` means the panel already starts above the viewport; the
  // bottom check below still decides whether scrolling is needed.
  const bottom = top + height;
  if (bottom + margin <= viewport) return null;
  const fits = height + margin * 2 <= viewport;
  const delta = fits ? bottom + margin - viewport : top - margin;
  return Math.max(0, Math.round(scrollTop + delta));
}

module.exports = {
  CELLS,
  WEEKDAY_INITIALS,
  REVEAL_MARGIN,
  monthLabel,
  cursorFrom,
  monthGrid,
  revealScrollTop,
};
