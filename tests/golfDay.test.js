import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BALANCE } from '../src/sim/balance.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';

// ROUND MECHANICS AT BASELINE COMPRESSION. D1 (2026-07-30) prices route travel
// so bodies hold the authored WALL rate on any day length — on the shipped
// 4x-compressed day a route therefore spans 4x the game minutes, which is the
// ruling's intended day-economics change, not a defect. This file tests the
// ROUND MACHINERY (starter, practice, carts, marshals, scorecards), whose
// minute expectations were authored against the baseline day; it pins the
// baseline so those mechanics stay tested independently of day length.
// tests/golfer-pace.test.js owns the compression behaviour itself.
BALANCE.gameMinutesPerRealSecond = BALANCE.npcTimingBaselineGameMinutesPerRealSecond;
import {
  beginReservationPayment,
  bookSlot,
  checkInReservation,
  completeReservationPayment,
  confirmReservation,
  markReservationArrived,
  reservationById,
} from '../src/sim/reservations.js';
import {
  dispatchMarshalTask, golfDayTick, liveGolfSummary, ROUND_STATE,
} from '../src/sim/golfDay.js';

function checkedInParty(state, { minute = 480, arrivalMinute = minute - 30, holder = 'Live Round', size = 4, transport } = {}) {
  state.clock.minutes = arrivalMinute;
  const customerNames = Array.from({ length: size }, (_, index) => index ? `${holder} Guest ${index + 1}` : holder);
  const reservation = bookSlot(state, 0, minute, {
    holder,
    customerNames,
    partySize: size,
    transport,
  }).res;
  assert.ok(markReservationArrived(state, reservation.id, arrivalMinute).ok);
  assert.ok(confirmReservation(state, reservation.id, arrivalMinute).ok);
  const payment = beginReservationPayment(state, reservation.id, 'card');
  assert.ok(payment.ok);
  assert.ok(completeReservationPayment(state, reservation.id, { transactionId: payment.transactionId }).ok);
  assert.ok(checkInReservation(state, reservation.id, { atMinute: arrivalMinute }).ok);
  return reservation;
}

test('a paid check-in becomes one deterministic round and starter owns the departure', () => {
  const state = newGame('relaxed', 33001);
  const reservation = checkedInParty(state, { transport: 'walk' });
  golfDayTick(state, 451);
  const party = state.golfDay.parties[0];
  assert.equal(party.id, `round-${reservation.id}`);
  assert.equal(party.reservationId, reservation.id);
  assert.equal(party.transport, 'walk');
  assert.equal(reservation.courseAccess.departurePlannedAtMinute, null);
  assert.notEqual(reservation.courseAccess.status, 'departed');
  golfDayTick(state, 490);
  assert.equal(reservation.courseAccess.status, 'departed');
  assert.ok(party.startedMinute >= 480);
  assert.equal(state.golfDay.metrics.created, 1);
  golfDayTick(state, 490);
  assert.equal(state.golfDay.metrics.created, 1, 'repeat ticks do not clone a round');
});

test('early groups use bounded practice occupancy and then enter the starter queue', () => {
  const state = newGame('relaxed', 33002);
  checkedInParty(state, { arrivalMinute: 440, minute: 480, size: 2 });
  let party;
  for (let minute = 440; minute <= 455; minute += 0.25) {
    golfDayTick(state, minute);
    party = state.golfDay.parties[0];
    if (party?.state === ROUND_STATE.PRACTICING
      && state.golfDay.events.some((event) => event.type === 'practice-shot-started')) break;
  }
  assert.equal(party.state, ROUND_STATE.PRACTICING);
  assert.ok(['range', 'putting', 'chipping'].includes(party.practiceKind));
  assert.equal(state.golfDay.practice[party.practiceKind].occupants.length, 1);
  assert.ok(state.golfDay.events.some((event) => event.type === 'practice-warmup-swing'));
  assert.ok(state.golfDay.events.some((event) => event.type === 'practice-shot-started'));
  golfDayTick(state, 479);
  assert.equal(state.golfDay.practice[party.practiceKind].occupants.length, 0);
  assert.ok([ROUND_STATE.WAITING_FOR_STARTER, ROUND_STATE.CALLED_TO_TEE, ROUND_STATE.AT_TEE].includes(party.state));
});

test('starter separation, safety waits, congestion, and marshal work derive from live parties', () => {
  const state = newGame('relaxed', 33003);
  const first = checkedInParty(state, { holder: 'First Pair', size: 2, arrivalMinute: 470, minute: 480, transport: 'walk' });
  const second = checkedInParty(state, { holder: 'Second Pair', size: 2, arrivalMinute: 471, minute: 480, transport: 'walk' });
  golfDayTick(state, 472);
  assert.notDeepEqual(state.golfDay.parties[0].position, state.golfDay.parties[1].position,
    'practice groups use separate bays or short-game positions');
  golfDayTick(state, 560);
  const starts = [first, second].map((reservation) => reservationById(state, reservation.id).actualStartMinute).sort((a, b) => a - b);
  assert.ok(starts[1] - starts[0] >= 7, `${starts[0]} and ${starts[1]} must preserve starter gap`);
  assert.ok(state.golfDay.events.some((event) => event.type === 'starter-called-party'));
  assert.ok(state.golfDay.events.some((event) => event.type === 'shot-started'));
  assert.ok(state.golfDay.presentationShots.length > 0);
  assert.ok(['clear', 'light', 'moderate', 'heavy', 'gridlocked'].includes(state.golfDay.congestion.level));
  // Inject a measured delay into the canonical pace record to test dispatch and
  // completion without inventing a second marshal-only scenario.
  const active = state.golfDay.parties[0];
  active.pace.waitingMinutes = 7;
  active.nextActionMinute = Math.min(active.nextActionMinute, 560.01);
  golfDayTick(state, 565);
  const task = state.golfDay.marshalTasks.find((entry) => entry.status === 'alert');
  assert.ok(task, 'early game reports a pace alert instead of teleporting a marshal');
  assert.ok(dispatchMarshalTask(state, task.id, { minute: 565, action: 'pace-reminder' }).ok);
  assert.equal(task.status, 'enroute');
  golfDayTick(state, 570);
  assert.equal(task.status, 'complete');
});

test('normal accelerated play completes scorecard, cart return, persistent golfers, and one review', () => {
  const state = newGame('relaxed', 33004);
  const reservation = checkedInParty(state, { holder: 'Complete Four', transport: 'ride' });
  const roundsBefore = state.golfers.pool.find((golfer) => golfer.name === 'Complete Four')?.roundsPlayed || 0;
  golfDayTick(state, 1200);
  const summary = state.golfDay.completed.find((entry) => entry.reservationId === reservation.id);
  assert.ok(summary);
  assert.equal(summary.scores.length, 4);
  assert.equal(summary.scores[0].holes.length, 9);
  assert.ok(summary.scores.every((score) => score.holes.every((value) => value >= 1)));
  assert.ok(summary.durationMinutes >= 90 && summary.durationMinutes <= 300, `duration ${summary.durationMinutes}`);
  const returnedCart = state.golfDay.carts.find((cart) => cart.id === summary.cartId);
  assert.ok(['cleaning', 'charging', 'available'].includes(returnedCart.status));
  assert.equal(returnedCart.assignedPartyId, null);
  assert.equal(state.golfDay.parties.length, 0);
  assert.equal(state.club.reviews.filter((review) => review.roundId === summary.id).length, 1);
  assert.equal(state.golfers.pool.find((golfer) => golfer.name === 'Complete Four').roundsPlayed, roundsBefore + 1);
  assert.equal(liveGolfSummary(state).activeBalls, 0);
  golfDayTick(state, 1300);
  assert.equal(returnedCart.status, 'available');
  assert.equal(state.club.reviews.filter((review) => review.roundId === summary.id).length, 1);
});

test('save/load replays an in-flight shot safely and never duplicates completion effects', () => {
  let state = newGame('relaxed', 33005);
  checkedInParty(state, { holder: 'Saved Round', size: 2, arrivalMinute: 475, transport: 'walk' });
  let minute = 480;
  for (; minute < 540; minute += 0.02) {
    golfDayTick(state, minute);
    if (state.golfDay.parties[0]?.state === ROUND_STATE.BALL_IN_PLAY) break;
  }
  assert.equal(state.golfDay.parties[0]?.state, ROUND_STATE.BALL_IN_PLAY);
  const strokesBefore = state.golfDay.parties[0].golfers.reduce((sum, golfer) => sum + golfer.holeStrokes, 0);
  state = deserialize(serialize(state));
  const recovered = state.golfDay.parties[0];
  assert.equal(recovered.state, ROUND_STATE.PREPARING_SHOT);
  assert.equal(state.golfDay.balls.filter((ball) => ball.active).length, 0);
  assert.equal(recovered.golfers.reduce((sum, golfer) => sum + golfer.holeStrokes, 0), strokesBefore - 1);
  golfDayTick(state, 1200);
  const summary = state.golfDay.completed.find((entry) => entry.partyName === 'Saved Round');
  assert.ok(summary);
  const persistent = state.golfers.pool.find((golfer) => golfer.name === 'Saved Round');
  const effects = { rounds: persistent.roundsPlayed, reviews: state.club.reviews.filter((review) => review.roundId === summary.id).length };
  const reloaded = deserialize(serialize(state));
  golfDayTick(reloaded, 1300);
  assert.equal(reloaded.golfers.pool.find((golfer) => golfer.name === 'Saved Round').roundsPlayed, effects.rounds);
  assert.equal(reloaded.club.reviews.filter((review) => review.roundId === summary.id).length, effects.reviews);
});

test('bounded ball and event pools survive several simultaneous rounds', () => {
  const state = newGame('relaxed', 33006);
  checkedInParty(state, { holder: 'Pool A', size: 2, minute: 480, arrivalMinute: 470 });
  checkedInParty(state, { holder: 'Pool B', size: 2, minute: 480, arrivalMinute: 471 });
  checkedInParty(state, { holder: 'Pool C', size: 2, minute: 510, arrivalMinute: 472 });
  checkedInParty(state, { holder: 'Pool D', size: 2, minute: 510, arrivalMinute: 473 });
  golfDayTick(state, 1400);
  assert.equal(state.golfDay.balls.length, 24);
  assert.ok(state.golfDay.presentationShots.length <= 32);
  assert.ok(state.golfDay.events.length <= 2400);
  assert.equal(state.golfDay.metrics.poolExhaustions, 0);
  assert.equal(state.golfDay.completed.length, 4);
});
