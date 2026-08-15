// D1 (Goal 18) — the reservation generator must actually RUN in production.
//
// generateReservations and ensureReservationHorizon existed with tests of
// their own and NO production call site: a live probe read
// generator.generatedDays = [] on a running save, zero booked, 20 open slots,
// and 6/6 observed golfers were walk-ins. This test pins the WIRING, not the
// generator: advancing an ordinary sim hour must leave the horizon generated
// and (at sane occupancy inputs) some parties booked.
//
// Watched fail 2026-08-10: with the ensureReservationHorizon call removed
// from golfOperationsTick, generatedDays stays [] and this test fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, update } from '../src/sim/state.js';

test('an ordinary sim hour fills the reservation horizon', () => {
  const state = newGame('relaxed', 4242);
  // healthy-enough inputs that occupancy cannot round to nothing
  state.club.reputation = 60;
  state.clock.minutes = 6 * 60; // 06:00, before opening
  update(state, 60); // one game hour -> at least one hourly tick
  const gen = state.reservations?.generator;
  assert.ok(gen, 'the reservations book carries its generator record');
  assert.ok(gen.generatedDays.length >= 1, `generatedDays is still empty — the horizon fill is not wired into the tick`);
  const today = Math.floor(state.clock.minutes / 1440);
  assert.ok(gen.generatedDays.includes(today), `today (${today}) is not in generatedDays ${JSON.stringify(gen.generatedDays)}`);
  // At reputation 60 with default pricing, a 20-slot sheet at ~0.4+ occupancy
  // booking zero parties across the whole horizon would itself be a defect.
  assert.ok(
    (state.reservations.booked || []).length >= 1,
    'the generated horizon booked no parties at healthy occupancy inputs',
  );
});
