// P0 (Goal 25 round 3) — "The pending checkout reservation target disagrees
// with its ticket."
//
// The owner's crash.log named it. That is the diagnostic channel working: three
// rounds of "Checkout records are unavailable right now" became one sentence
// pointing at one predicate, reservationTargetMatchesTicket.
//
// It is a RESERVATION CHECK-IN failure, not a retail sale, which fits what he
// described: the queue head is desk business (a tee time), and the refusal
// happens when he takes their money.
//
// The predicate has fourteen ways to say no, so it is now instrumented to record
// WHICH clause. This walks the reservation variations a real game produces --
// the happy path is covered by the suite and passes, so the interesting arms are
// the ones the tests never build.
import { newGame } from '../../../src/sim/state.js';
import { bookSlot } from '../../../src/sim/reservations.js';
import { calendarOf } from '../../../src/sim/time.js';
import { createReservationCheckInTx, finalizeReservationCheckIn } from '../../../src/sim/reservationCheckIn.js';
import {
  enterCardDigit, insertCard, presentCard, requestPayment, runCard,
  submitCardAmount, totalOf,
} from '../../../src/sim/register.js';

function reservationFor(state, name) {
  const day = calendarOf(state.clock.minutes).dayAbs + 1;
  const made = bookSlot(state, day, 8 * 60, name);
  if (!made.ok) throw new Error(`bookSlot failed: ${made.reason}`);
  return made.res;
}

function approvedTx(state, reservation) {
  const made = createReservationCheckInTx(state, reservation.id, { method: 'card', rng: () => 0.9 });
  if (!made.ok) return { txError: made.reason || made.diagnostic || 'createReservationCheckInTx failed' };
  const { tx } = made;
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  for (const digit of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(digit));
  submitCardAmount(tx);
  const ran = runCard(tx);
  if (ran.result !== 'approved') return { txError: `card ${ran.result}` };
  return { tx };
}

function arm(label, mutate) {
  const state = newGame('relaxed', 3301);
  let reservation;
  try {
    reservation = reservationFor(state, `Repro ${label}`);
  } catch (e) {
    return { label, setupError: String(e.message) };
  }
  // the mutation happens BEFORE the ticket is created, the way the world would
  // have left the reservation before the player walked up to the desk
  try { mutate?.(reservation, state); } catch (e) { return { label, mutateError: String(e.message) }; }
  const built = approvedTx(state, reservation);
  if (built.txError) return { label, txError: built.txError };
  let result;
  let threw = null;
  try { result = finalizeReservationCheckIn(state, built.tx); } catch (e) { threw = String(e?.message || e); }
  return {
    label,
    threw,
    ok: result?.ok ?? null,
    diagnostic: result?.diagnostic ?? null,
    reservationStatus: reservation.status ?? null,
  };
}

const arms = [
  arm('baseline (the suite covers this)', null),
  // A party that has already been marked arrived by the world before the player
  // reaches the desk.
  arm('already arrived', (r) => { r.arrival = { ...(r.arrival || {}), status: 'arrived', arrivedAtMinute: 400 }; }),
  arm('already checked-in', (r) => { r.checkIn = { ...(r.checkIn || {}), status: 'checked-in', checkedInAtMinute: 400 }; }),
  // A deposit taken at booking time.
  arm('deposit paid', (r) => { r.depositPaid = 5; r.depositReferenceId = 'deposit:repro'; }),
  // A partially paid reservation.
  arm('partly paid', (r) => {
    r.payment = {
      ...(r.payment || {}),
      total: Number(r.fee) || 0,
      amountPaid: 5,
      amountDue: Math.max(0, (Number(r.fee) || 0) - 5),
      status: 'partial',
      method: 'card',
      pending: false,
    };
  }),
  // Course access already granted.
  arm('course access granted', (r) => { r.courseAccess = { ...(r.courseAccess || {}), status: 'granted', grantedAtMinute: 400 }; }),
  // A reservation whose status is no longer exactly 'booked'.
  arm('status confirmed', (r) => { r.status = 'confirmed'; }),
  // Balances present on the reservation.
  arm('balances present', (r) => { r.balanceDue = 0; r.remainingBalance = 0; }),
];

for (const a of arms) console.log(JSON.stringify(a));
const failing = arms.filter((a) => a.ok === false);
console.log('\nREPRODUCED:', failing.length > 0);
for (const f of failing) console.log('  ', f.label, '->', f.diagnostic);
