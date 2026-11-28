'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cal = require('../utils/calendar');
const fmt = require('../utils/format');

test('month grid is six Sunday-first weeks of unique days', () => {
  const cells = cal.monthGrid(2026, 10, '2026-11-16', '2026-11-16'); // November 2026
  assert.equal(cells.length, cal.CELLS);
  assert.equal(cells[0].date, '2026-11-01'); // 2026-11-01 is a Sunday
  assert.equal(new Date(2026, 10, 1).getDay(), 0);
  assert.equal(cells[cells.length - 1].date, '2026-12-12');
  assert.equal(cells.filter((cell) => cell.inMonth).length, 30);

  const keys = new Set();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    assert.equal(cell.day, fmt.parseYmd(cell.date).getDate());
    assert.equal(cell.date, fmt.ymd(fmt.parseYmd(cell.date)));
    assert.equal(keys.has(cell.key), false, `duplicate ${cell.key}`);
    keys.add(cell.key);
    if (index > 0) {
      const previous = cells[index - 1];
      const gap = (fmt.parseYmd(cell.date) - fmt.parseYmd(previous.date)) / 86400000;
      assert.equal(gap, 1, `${previous.date} -> ${cell.date}`);
    }
  }
});

test('a month starting on a Friday still opens on the previous Sunday', () => {
  const cells = cal.monthGrid(2026, 4, '2026-05-01', '2026-11-16'); // May 2026
  assert.equal(cells[0].date, '2026-04-26');
  assert.equal(cells[cells.length - 1].date, '2026-06-06');
  assert.equal(cells.filter((cell) => cell.inMonth).length, 31);
  assert.equal(cells.filter((cell) => cell.inMonth)[0].date, '2026-05-01');
});

test('leap February exposes the 29th and the flags follow the form date', () => {
  const leap = cal.monthGrid(2024, 1, '2024-02-29', '2024-02-29');
  assert.equal(leap.filter((cell) => cell.inMonth).length, 29);
  assert.deepEqual(
    leap.filter((cell) => cell.selected).map((cell) => cell.date),
    ['2024-02-29']
  );
  assert.deepEqual(
    leap.filter((cell) => cell.today).map((cell) => cell.date),
    ['2024-02-29']
  );

  const plain = cal.monthGrid(2023, 1, '2023-02-28', '2023-02-28');
  assert.equal(plain.filter((cell) => cell.inMonth).length, 28);
  assert.equal(plain.filter((cell) => cell.inMonth && cell.day === 29).length, 0);
});

test('a selected date from a neighbouring month is still marked in the grid', () => {
  const cells = cal.monthGrid(2026, 10, '2026-12-01', '2026-11-16');
  const marked = cells.filter((cell) => cell.selected);
  assert.deepEqual(marked.map((cell) => cell.date), ['2026-12-01']);
  assert.equal(marked[0].inMonth, false);
  assert.equal(cells.filter((cell) => cell.today).length, 1);
});

test('label and cursor helpers describe the same month', () => {
  assert.equal(cal.monthLabel(2026, 10), '2026 年 11 月');
  assert.deepEqual(cal.cursorFrom('2026-11-16'), { year: 2026, month: 10 });
  assert.deepEqual(cal.cursorFrom('2027-01-02'), { year: 2027, month: 0 });
  assert.deepEqual(cal.WEEKDAY_INITIALS, ['日', '一', '二', '三', '四', '五', '六']);
});

test('revealScrollTop only scrolls when the panel hangs below the fold', () => {
  // Already fully visible, including the margin.
  assert.equal(cal.revealScrollTop({ top: 100, height: 300, scrollTop: 0, viewport: 600 }), null);
  assert.equal(cal.revealScrollTop({ top: 288, height: 300, scrollTop: 0, viewport: 600 }), null);

  // Bottom 112 px below the fold, added to the current 50 px scroll.
  assert.equal(cal.revealScrollTop({ top: 400, height: 300, scrollTop: 50, viewport: 600 }), 162);

  // A panel taller than the viewport aligns its top instead of its bottom.
  assert.equal(cal.revealScrollTop({ top: 300, height: 700, scrollTop: 100, viewport: 600 }), 388);
  assert.equal(cal.revealScrollTop({ top: 5, height: 700, scrollTop: 0, viewport: 600 }), 0);
});

test('revealScrollTop ignores incomplete measurements', () => {
  assert.equal(cal.revealScrollTop({}), null);
  assert.equal(cal.revealScrollTop({ top: 10, height: 10 }), null);
  assert.equal(cal.revealScrollTop({ top: 'x', height: 10, scrollTop: 0, viewport: 600 }), null);
});

test('revealAnchorScrollTop aligns an off-screen top and leaves a visible one alone', () => {
  // Below the fold: 800 - 12 px above, added to the current scroll.
  assert.equal(
    cal.revealAnchorScrollTop({ top: 800, scrollTop: 40, viewport: 700 }),
    828
  );
  // Partially above the fold: scroll back up.
  assert.equal(cal.revealAnchorScrollTop({ top: -30, scrollTop: 120, viewport: 700 }), 78);
  // Already on screen, even at the very bottom edge.
  assert.equal(cal.revealAnchorScrollTop({ top: 0, scrollTop: 120, viewport: 700 }), null);
  assert.equal(cal.revealAnchorScrollTop({ top: 699, scrollTop: 0, viewport: 700 }), null);
  // Just above the page top: clamp to zero instead of a negative scroll.
  assert.equal(cal.revealAnchorScrollTop({ top: -3, scrollTop: 0, viewport: 700 }), 0);
});

test('revealAnchorScrollTop ignores incomplete measurements', () => {
  assert.equal(cal.revealAnchorScrollTop({}), null);
  assert.equal(cal.revealAnchorScrollTop({ top: 10, scrollTop: 0 }), null);
  assert.equal(cal.revealAnchorScrollTop({ top: 'x', scrollTop: 0, viewport: 700 }), null);
});
