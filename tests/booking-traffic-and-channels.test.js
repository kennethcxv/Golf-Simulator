// C1 and C4 (Goal 20) — how much booking traffic arrives, and from where.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  golfOperationsTick, CONTACTS_PER_DAY, CONTACT_HOURS,
} from '../src/sim/reservations.js';

// Tick a whole day a minute at a time, the way the sim does, and report every
// booking contact that arrived. Counting ids rather than array length matters:
// the request ledger prunes itself, so length under-reports.
function runDays(state, days) {
  const seen = new Set();
  const arrivals = [];
  const start = Math.floor(state.clock.minutes);
  for (let day = 0; day < days; day += 1) {
    let count = 0;
    for (let m = 0; m < 1440; m += 1) {
      const minute = start + day * 1440 + m;
      state.clock.minutes = minute;
      golfOperationsTick(state, minute);
      for (const r of state.reservations?.requests || []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        count += 1;
        arrivals.push(r);
      }
    }
    arrivals.push(null); // day marker
    void count;
  }
  return arrivals.filter(Boolean);
}

function openGame(seed) {
  const state = newGame('relaxed', seed);
  if (state.campaign) state.campaign.businessOpen = true;
  return state;
}

test('C1: the phone and the inbox carry real traffic, on both channels', () => {
  const DAYS = 4;
  const arrivals = runDays(openGame(4242), DAYS);
  const perDay = arrivals.length / DAYS;
  const phone = arrivals.filter((r) => r.channel === 'phone').length / DAYS;
  const email = arrivals.filter((r) => r.channel === 'email').length / DAYS;

  // Measured before the change: 4.27 a day, 1.87 of them by phone. The floor
  // here is deliberately far above that and far below the configured rate, so
  // it fails loudly on a revert without being brittle about the draw.
  assert.ok(perDay >= 12, `only ${perDay.toFixed(2)} contacts a day (was 4.27 before C1)`);
  assert.ok(phone >= 4, `only ${phone.toFixed(2)} calls a day`);
  assert.ok(email >= 4, `only ${email.toFixed(2)} emails a day`);
  // and not so many that the sheet is being spammed
  assert.ok(perDay <= CONTACTS_PER_DAY * 1.3, `${perDay.toFixed(2)} a day exceeds the configured rate`);
});

test('C1: the rate survives a coarse tick, which is what sim speed produces', () => {
  // At 2x and 4x the clock advances several minutes per tick. The old form
  // could create at most ONE request per roll however much time had passed, so
  // traffic thinned out exactly when the player sped through the quiet hours.
  const fine = openGame(777);
  const coarse = openGame(777);
  const start = Math.floor(fine.clock.minutes);
  const seenFine = new Set();
  const seenCoarse = new Set();
  for (let m = 0; m < 1440; m += 1) {
    fine.clock.minutes = start + m;
    golfOperationsTick(fine, start + m);
    for (const r of fine.reservations?.requests || []) seenFine.add(r.id);
  }
  for (let m = 0; m < 1440; m += 10) {
    coarse.clock.minutes = start + m;
    golfOperationsTick(coarse, start + m);
    for (const r of coarse.reservations?.requests || []) seenCoarse.add(r.id);
  }
  const ratio = seenCoarse.size / Math.max(1, seenFine.size);
  assert.ok(ratio > 0.6,
    `a 10-minute tick produced ${seenCoarse.size} contacts against ${seenFine.size} at one minute`);
});

test('C1: contacts only arrive inside the club\'s calling hours', () => {
  const arrivals = runDays(openGame(31337), 3);
  assert.ok(arrivals.length > 0, 'precondition: some contacts arrived');
  for (const r of arrivals) {
    const hour = Math.floor((r.createdAtAbs % 1440) / 60);
    assert.ok(hour >= CONTACT_HOURS.from && hour < CONTACT_HOURS.to,
      `${r.channel} contact at ${hour}:00, outside ${CONTACT_HOURS.from}-${CONTACT_HOURS.to}`);
  }
});

test('C4: nothing but the phone and the inbox invents a booking after opening', () => {
  const state = openGame(9090);
  const book = state.reservations;
  const start = Math.floor(state.clock.minutes);

  // day one: the generator seeds the diary the club already had
  for (let m = 0; m < 1440; m += 1) {
    state.clock.minutes = start + m;
    golfOperationsTick(state, start + m);
  }
  // COUNT THE DAYS EVER GENERATED, not the live array. generatedDays is pruned
  // to a sliding window on every call, so its LENGTH is flat whether or not the
  // generator is running — the second written version of this test passed on
  // the un-guarded code for exactly that reason, twice, once even after being
  // extended past the horizon. A union across the run is the honest measure.
  const everGenerated = new Set(book.generator.generatedDays);
  const seededDays = everGenerated.size;
  assert.ok(seededDays > 0, 'the club must open with a diary, not an empty sheet');
  assert.ok(book.generator.seededAtDayAbs != null, 'the seed must be recorded so it cannot repeat');

  // ...and never again, however many days pass.
  //
  // This must outrun the HORIZON to mean anything. The first written version
  // ran six days and passed even with the guard removed, because the horizon is
  // seven days deep: day one's seed had already covered every day the test
  // looked at, so "no new day was generated" was true for the wrong reason. Run
  // past the horizon and the un-guarded generator has to reach for a new day.
  const horizon = book.config.horizonDays;
  assert.ok(horizon >= 1 && horizon < 30, `unexpected horizon ${horizon}`);
  for (let day = 1; day < horizon + 3; day += 1) {
    for (let m = 0; m < 1440; m += 1) {
      const minute = start + day * 1440 + m;
      state.clock.minutes = minute;
      golfOperationsTick(state, minute);
      for (const d of book.generator.generatedDays) everGenerated.add(d);
    }
  }
  assert.equal(everGenerated.size, seededDays,
    `${everGenerated.size - seededDays} day(s) of reservations appeared out of nowhere after opening`);
});
