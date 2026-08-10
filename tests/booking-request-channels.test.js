// D3 (Goal 18) — the email and phone booking channels, at the sim layer.
//
// Requests trickle in through open hours; an email waits, a phone call
// expires into 'missed' if unanswered; accepting EITHER books through the
// same bookSlot path and lands on the same sheet as every other channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, update } from '../src/sim/state.js';
import {
  pendingBookingRequests, acceptBookingRequest, declineBookingRequest,
  reservationById, PHONE_RING_MINUTES,
} from '../src/sim/reservations.js';

function stateWithRequests(seed = 606) {
  const state = newGame('relaxed', seed);
  state.clock.minutes = 9 * 60;
  for (let hour = 0; hour < 30 && !pendingBookingRequests(state).length; hour++) {
    update(state, 60);
    if (Math.floor(state.clock.minutes / 60) % 24 >= 18) update(state, 14 * 60); // skip the night
  }
  return state;
}

test('requests arrive through open hours and accept books the real sheet', () => {
  const state = stateWithRequests();
  const pending = pendingBookingRequests(state);
  assert.ok(pending.length >= 1, 'no booking request arrived across 30 open hours');
  const request = pending[0];
  assert.ok(['email', 'phone'].includes(request.channel));
  const accepted = acceptBookingRequest(state, request.id);
  assert.equal(accepted.ok, true, accepted.reason);
  const reservation = reservationById(state, accepted.res.id);
  assert.equal(reservation.status, 'booked');
  assert.equal(reservation.source, request.channel, 'the sheet records which channel booked it');
  assert.equal(request.status, 'accepted');
  // the same request cannot book twice
  assert.equal(acceptBookingRequest(state, request.id).ok, false);
});

test('a declined request stays declined and books nothing', () => {
  const state = stateWithRequests(707);
  const request = pendingBookingRequests(state)[0];
  assert.ok(request, 'no request to decline');
  const before = state.reservations.booked.length;
  assert.equal(declineBookingRequest(state, request.id).ok, true);
  assert.equal(request.status, 'declined');
  assert.equal(state.reservations.booked.length, before);
});

test('an unanswered phone call rings out into missed', () => {
  const state = stateWithRequests(808);
  // find (or wait for) a phone request specifically
  let phone = pendingBookingRequests(state, 'phone')[0];
  for (let hour = 0; hour < 40 && !phone; hour++) {
    update(state, 60);
    if (Math.floor(state.clock.minutes / 60) % 24 >= 18) update(state, 14 * 60);
    phone = pendingBookingRequests(state, 'phone')[0];
  }
  assert.ok(phone, 'no phone request arrived across the wait');
  update(state, PHONE_RING_MINUTES + 2);
  assert.equal(phone.status, 'missed', 'the unanswered call must ring out, not linger');
});
