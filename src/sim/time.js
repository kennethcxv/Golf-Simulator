// FAIRWAY STATE — game clock and calendar.
// The clock is a single absolute minute counter from Y1 Spring Day 1, 00:00.
// Everything else (year/season/day/time-of-day) is derived, so save files stay tiny
// and time math can't drift.

import { SEASONS, DAYS_PER_SEASON, DAYS_PER_YEAR, MINUTES_PER_DAY, DAY_START_MIN } from './constants.js';

export { SEASONS, DAYS_PER_SEASON, MINUTES_PER_DAY };

export function newClock() {
  return { minutes: DAY_START_MIN }; // day 1, 6:00 AM
}

// Advances the clock, returning how many midnights were crossed so daily systems
// can tick once per calendar day regardless of sim step size.
export function advanceClock(clock, gameMinutes) {
  const before = Math.floor(clock.minutes / MINUTES_PER_DAY);
  clock.minutes += gameMinutes;
  const after = Math.floor(clock.minutes / MINUTES_PER_DAY);
  return { daysPassed: after - before };
}

export function calendarOf(minutes) {
  const dayAbs = Math.floor(minutes / MINUTES_PER_DAY); // 0-based absolute day
  const minuteOfDay = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const year = Math.floor(dayAbs / DAYS_PER_YEAR) + 1;
  const dayOfYear = (dayAbs % DAYS_PER_YEAR) + 1; // 1-based
  const seasonIndex = Math.floor((dayOfYear - 1) / DAYS_PER_SEASON);
  const dayOfSeason = ((dayOfYear - 1) % DAYS_PER_SEASON) + 1;
  return {
    year,
    seasonIndex,
    seasonName: SEASONS[seasonIndex],
    dayOfYear,
    dayOfSeason,
    minuteOfDay,
    dayAbs,
  };
}

export function formatClock(minuteOfDay) {
  const whole = Math.floor(minuteOfDay);
  const h24 = Math.floor(whole / 60) % 24;
  const m = whole % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatDate(cal) {
  return `Y${cal.year} · ${cal.seasonName} · Day ${cal.dayOfSeason}`;
}
