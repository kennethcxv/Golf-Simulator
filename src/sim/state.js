// FAIRWAY STATE — the single serializable GameState and its master tick.
// Everything the game *is* lives in this object; rendering and UI only read it
// and call command functions. All randomness flows through state.rngState so a
// loaded save resumes the exact same stream.

import { makeRng, rngOf } from '../core/utils.js';
import { labelSections } from './course.js';
import { buildStartingCourse } from './startingCourse.js';
import { newClock, advanceClock, calendarOf } from './time.js';
import { tickRenovationsDaily } from './terrainEdit.js';
import { newWeather, rollDailyWeather } from './weather.js';
import { initTurf, turfHourlyTick, turfDailyTick, runMorningMaintenance, defaultPolicies } from './turf.js';
import { BALANCE } from './balance.js';

export { rngOf }; // re-export: rngOf lives in core/utils to avoid import cycles

export const SAVE_VERSION = 2;

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
    weather: newWeather(),
    pendingMorning: true, // maintenance pass runs at the first 5 AM
  };
  // day-1 weather + turf initial condition draw from the same seeded stream
  rollDailyWeather(state.weather, rngOf(state), calendarOf(state.clock.minutes).dayOfYear);
  initTurf(state);
  return state;
}

// --- master tick --------------------------------------------------------------

export function dailyTick(state) {
  if (!state.weather.locked) {
    rollDailyWeather(state.weather, rngOf(state), calendarOf(state.clock.minutes).dayOfYear);
  } else {
    // locked weather still tracks drought for tests/scenarios
    state.weather.droughtDays = state.weather.today.rainIn > 0 ? 0 : state.weather.droughtDays + 1;
  }
  tickRenovationsDaily(state);
  turfDailyTick(state);
  state.pendingMorning = true;
  // Phase 3+: economy close-of-books, golfer churn…
}

export function hourlyTick(state, hourOfDay) {
  if (hourOfDay === 5 && state.pendingMorning) {
    state.pendingMorning = false;
    const report = runMorningMaintenance(state, calendarOf(state.clock.minutes).dayAbs);
    if (report) {
      const total = report.costs.wages + report.costs.water + report.costs.fertilizer;
      state.cash -= Math.round(total);
    }
  }
  turfHourlyTick(state, hourOfDay);
}

export function update(state, gameMinutes) {
  const beforeHour = Math.floor(state.clock.minutes / 60);
  advanceClock(state.clock, gameMinutes);
  const afterHour = Math.floor(state.clock.minutes / 60);
  let daysPassed = 0;
  for (let h = beforeHour + 1; h <= afterHour; h++) {
    const hourOfDay = ((h % 24) + 24) % 24;
    if (hourOfDay === 0) {
      dailyTick(state);
      daysPassed++;
    }
    hourlyTick(state, hourOfDay);
  }
  return { daysPassed };
}

// --- persistence ----------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;

export function snapshot(state) {
  const { course, turf } = state;
  return ({
    version: state.version,
    mode: state.mode,
    seed: state.seed,
    rngState: state.rngState,
    clock: { minutes: state.clock.minutes },
    cash: Math.round(state.cash * 100) / 100,
    clubName: state.clubName,
    pendingMorning: state.pendingMorning,
    course: {
      w: course.w,
      h: course.h,
      zones: Array.from(course.zones),
      elevation: Array.from(course.elevation, (v) => Math.round(v * 100) / 100),
      holes: course.holes,
      nextHoleId: course.nextHoleId,
      structures: course.structures,
    },
    weather: {
      today: state.weather.today,
      droughtDays: state.weather.droughtDays,
      bias: state.weather.bias,
    },
    maintenance: state.maintenance,
    turf: turf
      ? {
          health: Array.from(turf.health, round1),
          moisture: Array.from(turf.moisture, round1),
          nutrients: Array.from(turf.nutrients, round1),
          heightMm: Array.from(turf.heightMm, round1),
          wear: Array.from(turf.wear, round1),
          disType: Array.from(turf.disType),
          disSev: Array.from(turf.disSev, round1),
          treated: Array.from(turf.treated),
        }
      : null,
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
    pendingMorning: raw.pendingMorning ?? true,
    course,
    sections: labelSections(course),
    weather: raw.weather
      ? { today: raw.weather.today, droughtDays: raw.weather.droughtDays, bias: raw.weather.bias || { temp: 0, dry: 0 } }
      : newWeather(),
    maintenance: raw.maintenance || null,
  };
  if (raw.turf) {
    state.turf = {
      health: Float32Array.from(raw.turf.health),
      moisture: Float32Array.from(raw.turf.moisture),
      nutrients: Float32Array.from(raw.turf.nutrients),
      heightMm: Float32Array.from(raw.turf.heightMm),
      wear: Float32Array.from(raw.turf.wear),
      disType: Uint8Array.from(raw.turf.disType),
      disSev: Float32Array.from(raw.turf.disSev),
      treated: Uint8Array.from(raw.turf.treated),
    };
  } else {
    // pre-turf (version 1) saves: initialize fresh turf so old saves stay loadable
    initTurf(state);
  }
  if (!state.maintenance) {
    state.maintenance = {
      policies: defaultPolicies(),
      lastMowDay: { green: -10, tee: -10, fairway: -10, rough: -10 },
      lastFertDay: { green: -10, tee: -10, fairway: -10, rough: -10 },
      crewUnits: 1,
      lastReport: null,
    };
  }
  return state;
}
