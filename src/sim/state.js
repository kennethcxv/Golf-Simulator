// FAIRWAY STATE — the single serializable GameState and its master tick.
// Everything the game *is* lives in this object; rendering and UI only read it
// and call command functions. All randomness flows through state.rngState so a
// loaded save resumes the exact same stream.

import { makeRng } from '../core/utils.js';
import { labelSections } from './course.js';
import { buildStartingCourse } from './startingCourse.js';
import { newClock, advanceClock } from './time.js';
import { tickRenovationsDaily } from './terrainEdit.js';
import { BALANCE } from './balance.js';

export const SAVE_VERSION = 1;

export function newGame(mode = 'relaxed', seed = Date.now() % 2147483647) {
  const rng = makeRng(seed);
  const course = buildStartingCourse(rng);
  const state = {
    version: SAVE_VERSION,
    mode, // 'relaxed' | 'realistic'
    seed,
    rngState: rng.getState(),
    clock: newClock(),
    cash: BALANCE.startingCash[mode],
    clubName: 'Willow Creek Golf Club',
    course,
    sections: labelSections(course), // derived cache, rebuilt on load/edit
  };
  return state;
}

// A tiny facade so callers can draw seeded randomness without touching rng plumbing.
export function rngOf(state) {
  const rng = makeRng(0);
  rng.setState(state.rngState);
  const wrap = (fn) => (...args) => {
    const v = fn(...args);
    state.rngState = rng.getState();
    return v;
  };
  return {
    next: wrap(rng.next),
    int: wrap(rng.int),
    range: wrap(rng.range),
    pick: wrap(rng.pick),
    chance: wrap(rng.chance),
  };
}

// --- master tick --------------------------------------------------------------

export function dailyTick(state) {
  tickRenovationsDaily(state);
  // Phase 2+: turf daily pass, weather roll, economy close-of-books, golfer churn…
}

export function update(state, gameMinutes) {
  const { daysPassed } = advanceClock(state.clock, gameMinutes);
  for (let i = 0; i < daysPassed; i++) dailyTick(state);
  return { daysPassed };
}

// --- persistence ----------------------------------------------------------------

export function snapshot(state) {
  const { course } = state;
  return ({
    version: state.version,
    mode: state.mode,
    seed: state.seed,
    rngState: state.rngState,
    clock: { minutes: state.clock.minutes },
    cash: state.cash,
    clubName: state.clubName,
    course: {
      w: course.w,
      h: course.h,
      zones: Array.from(course.zones),
      elevation: Array.from(course.elevation, (v) => Math.round(v * 100) / 100),
      holes: course.holes,
      nextHoleId: course.nextHoleId,
      structures: course.structures,
    },
  });
}

export function serialize(state) {
  return JSON.stringify(snapshot(state));
}

export function deserialize(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  const course = {
    w: raw.course.w,
    h: raw.course.h,
    zones: Uint8Array.from(raw.course.zones),
    elevation: Float32Array.from(raw.course.elevation),
    holes: raw.course.holes,
    nextHoleId: raw.course.nextHoleId,
    structures: raw.course.structures || [],
  };
  const state = {
    version: raw.version,
    mode: raw.mode,
    seed: raw.seed,
    rngState: raw.rngState,
    clock: { minutes: raw.clock.minutes },
    cash: raw.cash,
    clubName: raw.clubName || 'Willow Creek Golf Club',
    course,
    sections: labelSections(course),
  };
  return state;
}
