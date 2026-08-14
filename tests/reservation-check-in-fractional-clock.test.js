// P0 (Goal 25 round 3) — A CHECK-IN MUST SURVIVE A CLOCK THAT IS NOT ON A WHOLE
// MINUTE, which in the running game is essentially every frame.
//
// The owner reported "Checkout records are unavailable right now" three rounds
// running. Routing the diagnostic to crash.log named the predicate, and running
// HIS OWN saved reservation through the shipped check-in named the field:
//
//   clause 14: checkedInAt was 388.19651999997967, expected 388
//
// The ticket stamps `Math.round(clock.minutes)`; the settlement target stamped
// the raw clock. checkoutSettlement requires them to be identical, so the plan
// disagreed with its own ticket and the till refused after taking the money.
//
// WHY THE SUITE MISSED IT, and why this test is written the way it is: every
// existing check-in test runs on a clock that happens to sit on an integer
// minute, where the two derivations agree by accident. The bug lives entirely in
// the fraction, so the test has to put one there. The control below proves the
// old integer case still passes, so a green here is not just "both arms broken".
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { bookSlot } from '../src/sim/reservations.js';
import { calendarOf } from '../src/sim/time.js';
import { createReservationCheckInTx, finalizeReservationCheckIn } from '../src/sim/reservationCheckIn.js';
import {
  enterCardDigit, insertCard, presentCard, requestPayment, runCard,
  submitCardAmount, totalOf,
} from '../src/sim/register.js';

function bookedReservation(state, name) {
  const day = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, day, 8 * 60, name);
  assert.equal(made.ok, true, made.reason);
  return made.res;
}

function checkIn(state, reservation) {
  const made = createReservationCheckInTx(state, reservation.id, { method: 'card', rng: () => 0.9 });
  assert.equal(made.ok, true, made.reason || made.diagnostic);
  const { tx } = made;
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  for (const digit of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(digit));
  submitCardAmount(tx);
  assert.equal(runCard(tx).result, 'approved');
  return finalizeReservationCheckIn(state, tx);
}

// The fractions are the ones his own two saves were sitting on when the till
// refused, plus the two ends of the rounding interval, because .196 rounds down
// and .937 rounds up and a fix that only handles one direction is half a fix.
for (const fraction of [0.19651999997967, 0.936906666643, 0.5, 0.4999, 0.0001]) {
  test(`a reservation checks in with the clock at .${String(fraction).slice(2, 8)} of a minute`, () => {
    const state = newGame('relaxed', 3301);
    const reservation = bookedReservation(state, 'Fractional Clock Golfer');
    state.clock.minutes += fraction;
    assert.notEqual(state.clock.minutes % 1, 0, 'the clock must carry a fraction or this proves nothing');

    const result = checkIn(state, reservation);
    assert.equal(result.ok, true,
      `check-in refused on a fractional clock: ${result.diagnostic || result.reason}`);
    assert.equal(reservation.status, 'played');
    // and the stamp it wrote is a whole minute, matching the ticket's own
    assert.equal(Number.isInteger(reservation.checkedInAt ?? reservation.checkIn?.checkedInAtMinute), true,
      'the check-in stamp must be a whole minute, like the ticket it has to match');
  });
}

test('control: the whole-minute case that always worked still works', () => {
  const state = newGame('relaxed', 3301);
  const reservation = bookedReservation(state, 'Whole Minute Golfer');
  state.clock.minutes = Math.round(state.clock.minutes);
  const result = checkIn(state, reservation);
  assert.equal(result.ok, true, result.diagnostic || result.reason);
  assert.equal(reservation.status, 'played');
});
