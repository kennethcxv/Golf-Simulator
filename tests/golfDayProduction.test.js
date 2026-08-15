import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { configureTeeSheet,
  beginReservationPayment,
  bookSlot,
  checkInReservation,
  completeReservationPayment,
  confirmReservation,
  markReservationArrived,
} from '../src/sim/reservations.js';
import {
  assignMarshalPatrol,
  golfDayTick,
  liveGolfSummary,
  ROUND_STATE,
  setGolfSimulationFocus,
} from '../src/sim/golfDay.js';
import { hireStaff, ROLE } from '../src/sim/staff.js';

function checkedInParty(state, {
  minute = 480, arrivalMinute = minute - 30, holder = 'Production Round', size = 4, transport = 'walk',
} = {}) {
  state.clock.minutes = arrivalMinute;
  const customerNames = Array.from({ length: size }, (_, index) => index ? `${holder} Guest ${index + 1}` : holder);
  const reservation = bookSlot(state, 0, minute, {
    holder, customerNames, partySize: size, transport,
  }).res;
  assert.ok(markReservationArrived(state, reservation.id, arrivalMinute).ok);
  assert.ok(confirmReservation(state, reservation.id, arrivalMinute).ok);
  const payment = beginReservationPayment(state, reservation.id, 'card');
  assert.ok(payment.ok);
  assert.ok(completeReservationPayment(state, reservation.id, { transactionId: payment.transactionId }).ok);
  assert.ok(checkInReservation(state, reservation.id, { atMinute: arrivalMinute }).ok);
  return reservation;
}

function advance(state, target) {
  state.clock.minutes = target;
  golfDayTick(state, target);
  return state;
}

function advanceUntil(state, predicate, { from, to, step = 0.05 } = {}) {
  for (let minute = from; minute <= to; minute += step) {
    advance(state, +minute.toFixed(3));
    if (predicate(state)) return minute;
  }
  return null;
}

test('practice uses a routed arrival, warm-up, finite ball sequence, and tee-time callback', () => {
  const state = newGame('relaxed', 43101);
  checkedInParty(state, { arrivalMinute: 430, minute: 480, size: 2 });
  const reached = advanceUntil(state, (current) => current.golfDay.events.some((event) => event.type === 'practice-shot-started'), {
    from: 430, to: 470, step: 0.1,
  });
  assert.notEqual(reached, null);
  const party = state.golfDay.parties[0];
  assert.ok(state.golfDay.events.some((event) => event.type === 'round-state-changed'
    && event.detail.to === ROUND_STATE.TRAVELING_TO_PRACTICE));
  assert.ok(state.golfDay.events.some((event) => event.type === 'practice-warmup-swing'));
  assert.ok(party.practiceSession.plannedShots >= 4 && party.practiceSession.plannedShots <= 6);
  assert.ok(state.golfDay.balls.filter((ball) => ball.active).length <= 1);
  advance(state, 479);
  assert.ok(state.golfDay.events.some((event) => event.type === 'practice-complete'));
  assert.equal(state.golfDay.practice[party.practiceKind].occupants.length, 0);
  assert.ok(state.golfDay.starter.queue.includes(party.id)
    || [ROUND_STATE.CALLED_TO_TEE, ROUND_STATE.AT_TEE, ROUND_STATE.PREPARING_SHOT].includes(party.state));
});

test('cart return has unload, cleaning, charging, and available phases', () => {
  const state = newGame('relaxed', 43102);
  checkedInParty(state, { holder: 'Cart Lifecycle', size: 2, transport: 'ride', arrivalMinute: 470 });
  const returnedAt = advanceUntil(state, (current) => current.golfDay.carts.some((cart) => cart.status === 'cleaning'), {
    from: 470, to: 900, step: 0.15,
  });
  assert.notEqual(returnedAt, null);
  const cart = state.golfDay.carts.find((entry) => entry.status === 'cleaning');
  assert.equal(cart.assignedPartyId, null);
  assert.ok(state.golfDay.events.some((event) => event.type === 'cart-loaded'));
  assert.ok(state.golfDay.events.some((event) => event.type === 'cart-returned'));
  advance(state, cart.serviceReadyMinute + 0.05);
  assert.equal(cart.status, 'charging');
  advance(state, cart.serviceReadyMinute + 0.05);
  assert.equal(cart.status, 'available');
  assert.equal(cart.serviceReadyMinute, null);
});

test('a coarse service tick cannot collapse cleaning and charging into one frame', () => {
  const state = newGame('relaxed', 431021);
  checkedInParty(state, { holder: 'Coarse Cart Lifecycle', size: 2, transport: 'ride', arrivalMinute: 470 });
  const returnedAt = advanceUntil(state, (current) => current.golfDay.carts.some((cart) => cart.status === 'cleaning'), {
    from: 470, to: 900, step: 0.15,
  });
  assert.notEqual(returnedAt, null);
  const cart = state.golfDay.carts.find((entry) => entry.status === 'cleaning');
  const lateTick = cart.serviceReadyMinute + 10;
  advance(state, lateTick);
  assert.equal(cart.status, 'charging');
  assert.ok(cart.serviceReadyMinute > lateTick);
  assert.equal(state.golfDay.events.some((event) => event.type === 'cart-ready' && event.detail.cartId === cart.id), false);
  advance(state, cart.serviceReadyMinute + 0.05);
  assert.equal(cart.status, 'available');
});

test('completed scorecards and experience rollups contain operational truth', () => {
  const state = newGame('relaxed', 43103);
  const reservation = checkedInParty(state, { holder: 'Experience Four', transport: 'walk' });
  advance(state, 1200);
  const summary = state.golfDay.completed.find((round) => round.reservationId === reservation.id);
  assert.ok(summary);
  assert.equal(summary.scorecard.length, 9);
  assert.ok(summary.scorecard.every((hole) => hole.complete && hole.startedMinute != null && hole.completedMinute != null));
  assert.ok(summary.scorecard.every((hole) => hole.durationMinutes >= 0 && hole.paceTargetMinutes > 0));
  for (const golfer of summary.scores) {
    assert.equal(golfer.total, golfer.holes.reduce((sum, score) => sum + score, 0));
    assert.equal(golfer.totalPenalties, golfer.penalties.reduce((sum, penalty) => sum + penalty, 0));
  }
  assert.ok(summary.scorecardMeta.startMinute != null);
  assert.ok(summary.scorecardMeta.finishMinute >= summary.scorecardMeta.startMinute);
  assert.ok(summary.scorecardMeta.returnedMinute >= summary.scorecardMeta.finishMinute);
  assert.ok(summary.experience.overall >= 0 && summary.experience.overall <= 100);
  assert.deepEqual(Object.keys(summary.experience.components).sort(), [
    'arrival', 'cart', 'checkIn', 'courseDesign', 'courseQuality', 'pace', 'practice',
    'service', 'startPunctuality', 'value',
  ].sort());
  assert.equal(state.golfDay.experience.rounds, 1);
  assert.equal(state.club.reviews.filter((review) => review.roundId === summary.id).length, 1);
});

test('an assigned marshal patrol travels before improving pace', () => {
  const state = newGame('relaxed', 43104);
  const candidate = state.staff.market.find((entry) => entry.role === ROLE.MARSHAL);
  assert.ok(candidate);
  assert.ok(hireStaff(state, candidate.id).ok);
  assert.ok(assignMarshalPatrol(state, candidate.id).ok);
  checkedInParty(state, { holder: 'Patrol Target', size: 2, transport: 'walk', arrivalMinute: 475 });
  advance(state, 540);
  const party = state.golfDay.parties[0];
  party.pace.waitingMinutes = 7;
  party.nextActionMinute = 540.01;
  advance(state, 541);
  const task = state.golfDay.marshalTasks.find((entry) => entry.status === 'enroute');
  assert.ok(task);
  assert.equal(task.assignedTo, candidate.id);
  const creditBefore = party.pace.interventionCreditMinutes;
  advance(state, task.dueMinute + 0.01);
  assert.equal(task.status, 'complete');
  const target = state.golfDay.parties.find((entry) => entry.id === task.partyId);
  assert.ok(target.pace.interventionCreditMinutes > creditBefore);
  assert.ok(target.pace.paceBoostUntilMinute > task.completedMinute);
});

test('unhandled pace alerts close when their party leaves the property', () => {
  const state = newGame('relaxed', 43114);
  checkedInParty(state, { holder: 'Departing Alert', size: 2, transport: 'walk', arrivalMinute: 475 });
  advance(state, 540);
  const party = state.golfDay.parties[0];
  party.pace.waitingMinutes = 7;
  party.nextActionMinute = 540.01;
  advance(state, 541);
  const task = state.golfDay.marshalTasks.find((entry) => entry.status === 'alert');
  assert.ok(task);
  advance(state, 1200);
  assert.equal(state.golfDay.parties.some((entry) => entry.id === task.partyId), false);
  assert.equal(task.status, 'complete');
  assert.equal(task.completionReason, 'party-departed');
});

test('restore policy is safe during practice, first tee, riding, mid-hole, and final hole', () => {
  // Practice shot checkpoint.
  let practice = newGame('relaxed', 43105);
  checkedInParty(practice, { holder: 'Save Practice', arrivalMinute: 430, minute: 480, size: 2 });
  assert.notEqual(advanceUntil(practice, (state) => state.golfDay.parties[0]?.practiceSession?.activeGolferId != null, {
    from: 430, to: 470, step: 0.05,
  }), null);
  const practiceStarted = practice.golfDay.parties[0].practiceSession.shotsStarted;
  practice = deserialize(serialize(practice));
  assert.equal(practice.golfDay.parties[0].state, ROUND_STATE.PRACTICING);
  assert.equal(practice.golfDay.parties[0].practiceSession.activeGolferId, null);
  assert.equal(practice.golfDay.parties[0].practiceSession.shotsStarted, practiceStarted - 1);
  assert.equal(liveGolfSummary(practice).activeBalls, 0);

  // First tee stable wait.
  let tee = newGame('relaxed', 43106);
  checkedInParty(tee, { holder: 'Save Tee', arrivalMinute: 470, minute: 480, size: 2 });
  assert.notEqual(advanceUntil(tee, (state) => [ROUND_STATE.WAITING_FOR_STARTER, ROUND_STATE.CALLED_TO_TEE, ROUND_STATE.AT_TEE].includes(state.golfDay.parties[0]?.state), {
    from: 470, to: 510, step: 0.1,
  }), null);
  const teeId = tee.golfDay.parties[0].id;
  tee = deserialize(serialize(tee));
  assert.equal(tee.golfDay.parties.filter((party) => party.id === teeId).length, 1);
  assert.equal(new Set(tee.golfDay.starter.queue).size, tee.golfDay.starter.queue.length);

  // Riding route retains one cart and route progress.
  let riding = newGame('relaxed', 43107);
  checkedInParty(riding, { holder: 'Save Ride', arrivalMinute: 470, minute: 480, size: 2, transport: 'ride' });
  assert.notEqual(advanceUntil(riding, (state) => state.golfDay.parties[0]?.routeTransport === 'ride'
    && state.golfDay.parties[0]?.route?.length > 1, { from: 470, to: 600, step: 0.05 }), null);
  const cartId = riding.golfDay.parties[0].cartId;
  riding = deserialize(serialize(riding));
  assert.equal(riding.golfDay.parties[0].cartId, cartId);
  assert.equal(riding.golfDay.carts.filter((cart) => cart.assignedPartyId === riding.golfDay.parties[0].id).length, 1);

  // Mid-hole transient shot replays from address.
  let shot = newGame('relaxed', 43108);
  checkedInParty(shot, { holder: 'Save Shot', arrivalMinute: 475, size: 2 });
  assert.notEqual(advanceUntil(shot, (state) => state.golfDay.parties[0]?.state === ROUND_STATE.BALL_IN_PLAY, {
    from: 475, to: 600, step: 0.02,
  }), null);
  const strokes = shot.golfDay.parties[0].golfers.reduce((sum, golfer) => sum + golfer.holeStrokes, 0);
  shot = deserialize(serialize(shot));
  assert.equal(shot.golfDay.parties[0].state, ROUND_STATE.PREPARING_SHOT);
  assert.equal(shot.golfDay.parties[0].golfers.reduce((sum, golfer) => sum + golfer.holeStrokes, 0), strokes - 1);

  // Final-hole save completes all irreversible effects exactly once.
  let final = newGame('relaxed', 43109);
  checkedInParty(final, { holder: 'Save Final', arrivalMinute: 475, size: 2 });
  assert.notEqual(advanceUntil(final, (state) => state.golfDay.parties[0]?.holeIndex === 8, {
    from: 475, to: 1000, step: 0.2,
  }), null);
  final = deserialize(serialize(final));
  advance(final, 1200);
  const summary = final.golfDay.completed.find((round) => round.partyName === 'Save Final');
  assert.ok(summary);
  const reviewCount = final.club.reviews.filter((review) => review.roundId === summary.id).length;
  const roundsPlayed = final.golfers.pool.find((golfer) => golfer.name === 'Save Final').roundsPlayed;
  final = deserialize(serialize(final));
  advance(final, 1300);
  assert.equal(final.club.reviews.filter((review) => review.roundId === summary.id).length, reviewCount);
  assert.equal(final.golfers.pool.find((golfer) => golfer.name === 'Save Final').roundsPlayed, roundsPlayed);
});

test('simulation tiers change presentation fidelity without changing round state', () => {
  const state = newGame('relaxed', 43110);
  checkedInParty(state, { holder: 'Tier Group', arrivalMinute: 475, size: 4 });
  advance(state, 490);
  const party = state.golfDay.parties[0];
  const before = {
    id: party.id, hole: party.holeIndex, state: party.state,
    scores: party.scorecard.map((hole) => [...hole.scores]),
  };
  setGolfSimulationFocus(state, party.position);
  assert.equal(party.simulationTier, 'near');
  setGolfSimulationFocus(state, { x: party.position.x + 160, z: party.position.z });
  assert.equal(party.simulationTier, 'mid');
  setGolfSimulationFocus(state, { x: party.position.x + 600, z: party.position.z });
  assert.equal(party.simulationTier, 'far');
  assert.deepEqual({
    id: party.id, hole: party.holeIndex, state: party.state,
    scores: party.scorecard.map((hole) => [...hole.scores]),
  }, before);
  assert.deepEqual(liveGolfSummary(state).simulationTiers, { near: 0, mid: 0, far: 1 });
});

test('pool and exact-once guards stay bounded under a full tee sheet', () => {
  const state = newGame('relaxed', 43111);
  configureTeeSheet(state, { autoBookings: false }); // the census counts ONLY its six parties
  const holders = ['Sheet A', 'Sheet B', 'Sheet C', 'Sheet D', 'Sheet E', 'Sheet F'];
  holders.forEach((holder, index) => checkedInParty(state, {
    holder,
    size: 2,
    minute: 480 + Math.floor(index / 2) * 30,
    // D2: check-in is windowed (60 min) — each pair arrives half an hour
    // before ITS OWN slot, not everyone at dawn
    arrivalMinute: 480 + Math.floor(index / 2) * 30 - 30 + (index % 2),
    transport: index % 2 ? 'ride' : 'walk',
  }));
  advance(state, 1400);
  const ids = state.golfDay.completed.map((round) => round.id);
  assert.equal(ids.length, holders.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(state.golfDay.balls.length, 24);
  assert.ok(state.golfDay.events.length <= 2400);
  assert.ok(state.golfDay.presentationShots.length <= 32);
  assert.equal(state.golfDay.metrics.poolExhaustions, 0);
  assert.equal(state.golfDay.parties.length, 0);
  assert.ok(state.golfDay.partyPool.length > 0 && state.golfDay.partyPool.length <= 16);
  assert.equal(state.golfDay.carts.filter((cart) => cart.assignedPartyId != null).length, 0);
  assert.equal(state.club.reviews.filter((review) => ids.includes(review.roundId)).length, holders.length);
});
