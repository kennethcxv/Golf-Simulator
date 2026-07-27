import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEASONS, DAYS_PER_SEASON, MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newClock, advanceClock, calendarOf, formatClock, formatDate } from '../src/sim/time.js';

test('calendar constants are sane', () => {
  assert.equal(SEASONS.length, 4);
  assert.equal(MINUTES_PER_DAY, 1440);
  assert.ok(DAYS_PER_SEASON >= 20 && DAYS_PER_SEASON <= 30);
});

test('new clock starts year 1, spring, day 1, 6:00 AM', () => {
  const clock = newClock();
  const cal = calendarOf(clock.minutes);
  assert.equal(cal.year, 1);
  assert.equal(cal.seasonIndex, 0);
  assert.equal(cal.seasonName, 'Spring');
  assert.equal(cal.dayOfSeason, 1);
  assert.equal(cal.minuteOfDay, 360);
});

test('advancing a full day lands on day 2 at the same time', () => {
  const clock = newClock();
  const res = advanceClock(clock, MINUTES_PER_DAY);
  const cal = calendarOf(clock.minutes);
  assert.equal(res.daysPassed, 1);
  assert.equal(cal.dayOfSeason, 2);
  assert.equal(cal.minuteOfDay, 360);
});

test('advancing partial time crosses midnight exactly once', () => {
  const clock = newClock();
  // from 6:00 AM, +20h crosses midnight once, lands 2:00 AM day 2
  const res = advanceClock(clock, 20 * 60);
  const cal = calendarOf(clock.minutes);
  assert.equal(res.daysPassed, 1);
  assert.equal(cal.dayOfSeason, 2);
  assert.equal(cal.minuteOfDay, 120);
});

test('season rolls over after DAYS_PER_SEASON days', () => {
  const clock = newClock();
  advanceClock(clock, DAYS_PER_SEASON * MINUTES_PER_DAY);
  const cal = calendarOf(clock.minutes);
  assert.equal(cal.seasonIndex, 1);
  assert.equal(cal.seasonName, 'Summer');
  assert.equal(cal.dayOfSeason, 1);
});

test('year rolls over after 4 seasons', () => {
  const clock = newClock();
  advanceClock(clock, 4 * DAYS_PER_SEASON * MINUTES_PER_DAY);
  const cal = calendarOf(clock.minutes);
  assert.equal(cal.year, 2);
  assert.equal(cal.seasonIndex, 0);
  assert.equal(cal.dayOfSeason, 1);
});

test('dayOfYear counts continuously across seasons', () => {
  const clock = newClock();
  advanceClock(clock, (DAYS_PER_SEASON + 4) * MINUTES_PER_DAY);
  const cal = calendarOf(clock.minutes);
  assert.equal(cal.dayOfYear, DAYS_PER_SEASON + 5);
});

test('formatClock renders 12-hour time', () => {
  assert.equal(formatClock(360), '6:00 AM');
  assert.equal(formatClock(0), '12:00 AM');
  assert.equal(formatClock(725), '12:05 PM');
  assert.equal(formatClock(13 * 60 + 30), '1:30 PM');
});

test('formatDate renders a readable calendar date', () => {
  const clock = newClock();
  assert.equal(formatDate(calendarOf(clock.minutes)), 'Y1 · Spring · Day 1');
});
