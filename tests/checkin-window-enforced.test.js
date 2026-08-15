// D2 (Goal 18) — the 60-minute check-in window is a GATE, not a caption.
//
// checkInWindow() existed with zero consumers: a party could book a
// mid-afternoon slot in the morning and check straight in. This pins the
// enforcement inside checkInReservation itself, at the sim layer every desk
// flow rides.
//
// Watched fail 2026-08-10: with the window check absent from
// checkInReservation, the "early" leg checked in successfully and this test
// failed on `earlyAttempt.ok === false`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, update } from '../src/sim/state.js';
import {
  bookSlot, checkInReservation, confirmReservation, markReservationArrived,
} from '../src/sim/reservations.js';

function bookedAt(state, minuteOfDay) {
  const dayAbs = Math.floor(state.clock.minutes / 1440);
  const result = bookSlot(state, dayAbs, minuteOfDay, {
    holder: 'Window Test', partySize: 1, paymentPlan: 'prepaid', source: 'test',
  });
  assert.ok(result.ok, `slot at ${minuteOfDay} did not book: ${result.reason}`);
  return result.res;
}

test('a party far ahead of its tee time cannot check in; inside the window it can', () => {
  const state = newGame('relaxed', 777);
  state.clock.minutes = 8 * 60; // 08:00
  const res = bookedAt(state, 14 * 60); // 14:00 tee
  markReservationArrived(state, res.id, state.clock.minutes, 'front-desk');
  confirmReservation?.(state, res.id);
  const earlyAttempt = checkInReservation(state, res.id, { atMinute: state.clock.minutes });
  assert.equal(earlyAttempt.ok, false, 'a 6-hours-early check-in was accepted');
  assert.match(String(earlyAttempt.reason), /opens .*minutes|minutes to go/i);

  // walk the clock to 40 minutes before the tee: inside the window
  update(state, (13 * 60 + 20) - state.clock.minutes);
  const insideAttempt = checkInReservation(state, res.id, { atMinute: state.clock.minutes });
  assert.equal(insideAttempt.ok, true, `inside-window check-in refused: ${insideAttempt.reason}`);
});

test('a missed tee time is refused with a plain answer', () => {
  const state = newGame('relaxed', 778);
  state.clock.minutes = 8 * 60;
  const res = bookedAt(state, 9 * 60);
  markReservationArrived(state, res.id, state.clock.minutes, 'front-desk');
  confirmReservation?.(state, res.id);
  state.clock.minutes = 9 * 60 + 30; // half an hour past the slot
  const late = checkInReservation(state, res.id, { atMinute: state.clock.minutes });
  assert.equal(late.ok, false, 'a missed tee time was checked in');
  assert.match(String(late.reason), /passed/i);
});
