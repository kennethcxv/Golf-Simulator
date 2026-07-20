// Live golf-day simulation.
//
// This is the canonical round lifecycle. A checked-in operations reservation is
// adapted once into a party here; renderers only present these records and never
// advance a second, cosmetic golfer simulation.

import { clamp } from '../core/utils.js';
import { calendarOf } from './time.js';
import { holePar } from './course.js';
import { courseAggregates } from './rounds.js';
import { clubRatings } from './club.js';
import { reservationById, markCourseDeparture } from './reservations.js';
import {
  ensureCourseRouteNetwork,
  findCourseRoute,
  gridPoint,
  positionAlongRoute,
  routeDistance,
} from './golfRoutes.js';
import { lieAtWorld, planGolfShot, sampleBallPosition } from './golfShots.js';
import { postReview, reviewForCompletedRound } from './reviews.js';

export const ROUND_STATE = Object.freeze({
  PREPARING: 'preparing',
  PRACTICING: 'practicing',
  TRAVELING_TO_STARTER: 'traveling-to-starter',
  WAITING_FOR_STARTER: 'waiting-for-starter',
  CALLED_TO_TEE: 'called-to-tee',
  AT_TEE: 'at-tee',
  PREPARING_SHOT: 'preparing-shot',
  BALL_IN_PLAY: 'ball-in-play',
  TRAVELING_TO_BALL: 'traveling-to-ball',
  WAITING_ON_GROUP: 'waiting-on-group-ahead',
  ON_GREEN: 'on-green',
  PUTTING: 'putting',
  HOLE_COMPLETE: 'hole-complete',
  TRAVELING_NEXT_HOLE: 'traveling-next-hole',
  TURN_STOP: 'turn-stop',
  ROUND_COMPLETE: 'round-complete',
  RETURNING_CART: 'returning-cart',
  RETURNING_SCORECARD: 'returning-scorecard',
  LEAVING_PROPERTY: 'leaving-property',
  REVIEW_GENERATED: 'review-generated',
  DESPAWNED: 'despawned',
  RECOVERY: 'recovery',
});

export const SIMULATION_TIER = Object.freeze({
  NEAR: 'near',
  MID: 'mid',
  FAR: 'far',
});

export const CONGESTION = Object.freeze({
  CLEAR: 'clear',
  WATCH: 'watch',
  SLOW: 'slow',
  SEVERE: 'severe',
});

const GOLF_DAY_VERSION = 1;
const EVENT_LIMIT = 2400;
const SUMMARY_LIMIT = 90;
const MAX_BALLS = 24;
const DEFAULT_CARTS = 8;
const STARTER_GAP_MIN = 7;
const SAFE_SHOT_GAP_YD = 70;
// Effective on-course pace includes club selection, parking, dismounting and
// regrouping. It is intentionally lower than a vehicle's top road speed.
const WALK_YD_PER_MIN = 58;
const CART_YD_PER_MIN = 105;
const MAX_EVENTS_PER_TICK = 5000;

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function stableHash(...values) {
  let hash = 2166136261;
  for (const value of values) {
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function initialCarts(count = DEFAULT_CARTS) {
  return Array.from({ length: count }, (_, index) => ({
    id: `cart-${index + 1}`,
    status: 'available',
    assignedPartyId: null,
    condition: 82 + (index % 4) * 3,
    position: null,
    trips: 0,
  }));
}

function initialBalls(count = MAX_BALLS) {
  return Array.from({ length: count }, (_, index) => ({
    id: `round-ball-${index + 1}`,
    active: false,
    partyId: null,
    golferId: null,
    shot: null,
    position: null,
  }));
}

export function initGolfDay(state, options = {}) {
  const cartCount = Math.max(0, Math.floor(options.cartCount ?? DEFAULT_CARTS));
  state.golfDay = {
    version: GOLF_DAY_VERSION,
    nextPartyId: 1,
    nextEventSequence: 1,
    nextMarshalTaskId: 1,
    parties: [],
    completed: [],
    events: [],
    presentationShots: [],
    carts: initialCarts(cartCount),
    balls: initialBalls(),
    practice: {
      range: { capacity: 6, occupants: [] },
      putting: { capacity: 6, occupants: [] },
      chipping: { capacity: 4, occupants: [] },
    },
    starter: {
      queue: [],
      currentPartyId: null,
      lastStartMinute: null,
      announcements: [],
    },
    marshalTasks: [],
    // Built lazily on the first live-round query. Most headless economy states
    // never need A* paths, and new-game/save tests should not pay for nine-hole
    // routing when no golfer has checked in.
    routeNetwork: null,
    congestion: { level: CONGESTION.CLEAR, score: 0, waits: 0, holes: [] },
    metrics: {
      created: 0,
      started: 0,
      completed: 0,
      reviewed: 0,
      recovered: 0,
      peakActive: 0,
      peakBalls: 0,
      poolExhaustions: 0,
    },
    lastProcessedMinute: Math.floor(state.clock?.minutes || 0),
  };
  return state.golfDay;
}

function ensureShapes(day) {
  day.parties ||= [];
  day.completed ||= [];
  day.events ||= [];
  day.presentationShots ||= [];
  day.carts ||= initialCarts();
  day.balls ||= initialBalls();
  day.practice ||= {};
  for (const [name, capacity] of [['range', 6], ['putting', 6], ['chipping', 4]]) {
    day.practice[name] ||= { capacity, occupants: [] };
    day.practice[name].occupants ||= [];
  }
  day.starter ||= { queue: [], currentPartyId: null, lastStartMinute: null, announcements: [] };
  day.starter.queue ||= [];
  day.starter.announcements ||= [];
  day.marshalTasks ||= [];
  day.metrics ||= {};
  for (const [key, value] of Object.entries({
    created: 0, started: 0, completed: 0, reviewed: 0, recovered: 0,
    peakActive: 0, peakBalls: 0, poolExhaustions: 0,
  })) day.metrics[key] ??= value;
  day.nextPartyId ||= 1;
  day.nextEventSequence ||= 1;
  day.nextMarshalTaskId ||= 1;
  day.congestion ||= { level: CONGESTION.CLEAR, score: 0, waits: 0, holes: [] };
}

export function ensureGolfDay(state, options = {}) {
  if (!state.golfDay || state.golfDay.version !== GOLF_DAY_VERSION) initGolfDay(state, options);
  const day = state.golfDay;
  ensureShapes(day);
  day.routeNetwork = ensureCourseRouteNetwork(state.course, day.routeNetwork);
  if (options.restoring) recoverGolfDay(state);
  return day;
}

function emit(state, party, type, minute, detail = {}) {
  const day = state.golfDay;
  const event = {
    sequence: day.nextEventSequence++,
    type,
    minute: round2(minute),
    partyId: party?.id || null,
    reservationId: party?.reservationId || null,
    detail,
  };
  day.events.push(event);
  if (day.events.length > EVENT_LIMIT) day.events.splice(0, day.events.length - EVENT_LIMIT);
  return event;
}

function setRoundState(state, party, next, minute, delay = 0, detail = {}) {
  if (party.state !== next) emit(state, party, 'round-state-changed', minute, {
    from: party.state,
    to: next,
    hole: party.holeIndex + 1,
    ...detail,
  });
  party.state = next;
  party.stateEnteredMinute = round2(minute);
  party.nextActionMinute = round2(minute + Math.max(0, delay));
  party.lastWaitAccountedMinute = next === ROUND_STATE.WAITING_ON_GROUP ? round2(minute) : null;
}

function existingGolfer(state, name) {
  return state.golfers?.pool?.find((entry) => entry.name === name) || null;
}

function persistentGolfer(state, member, reservation, index) {
  let golfer = existingGolfer(state, member.name);
  if (!golfer) {
    const seed = stableHash(state.seed, reservation.id, member.name, index);
    golfer = {
      id: state.golfers.nextId++,
      name: member.name,
      wealth: 1 + (seed % 4),
      persona: ['conditions', 'value', 'pace', 'service', 'shop'][seed % 5],
      skill: 8 + (seed % 20),
      memberTier: member.memberStatus === 'member' ? 'weekday' : null,
      satisfaction: 48 + (seed % 14),
      joinedDay: member.memberStatus === 'member' ? calendarOf(state.clock.minutes).dayAbs : -1,
      lastVisitDay: -1,
      memory: [],
      roundsPlayed: 0,
      bestScore: null,
      champion: false,
      leftForever: false,
      fittedDay: null,
      skillDelta30: 0,
    };
    state.golfers.pool.push(golfer);
  }
  return golfer;
}

function liveGolfer(state, persistent, index, start) {
  const seed = stableHash(state.seed, persistent.id, persistent.name);
  return {
    id: persistent.id,
    name: persistent.name,
    persistentId: persistent.id,
    skill: persistent.skill,
    persona: persistent.persona,
    memberTier: persistent.memberTier,
    order: index,
    shotTendencies: {
      shape: seed % 3 === 0 ? 'draw' : seed % 3 === 1 ? 'fade' : 'straight',
      aggression: round2(0.3 + ((seed >>> 5) % 55) / 100),
      missBias: round2((((seed >>> 11) % 101) - 50) / 100),
    },
    position: { ...start },
    lie: null,
    currentShot: null,
    ballId: null,
    holeStrokes: 0,
    totalStrokes: 0,
    holes: [],
    holed: false,
    animation: 'idle',
  };
}

function assignCart(day, partyId, position) {
  const cart = day.carts.find((entry) => entry.status === 'available');
  if (!cart) return null;
  cart.status = 'assigned';
  cart.assignedPartyId = partyId;
  cart.position = { ...position };
  cart.trips++;
  return cart;
}

function chooseTransport(reservation) {
  const requested = reservation.transport || reservation.party?.transport;
  if (requested === 'walk' || requested === 'ride') return requested;
  const memberCount = reservation.party.members.filter((member) => member.memberStatus === 'member').length;
  return (stableHash(reservation.id, reservation.partySize) + memberCount) % 5 < 3 ? 'ride' : 'walk';
}

function choosePractice(state, reservation, minute) {
  const scheduled = reservation.dayAbs * 1440 + reservation.minute;
  const available = scheduled - minute;
  if (available < 8) return null;
  const day = state.golfDay;
  const preferred = state.club?.amenities?.range > 0
    ? ['range', 'putting', 'chipping']
    : ['putting', 'chipping'];
  const start = stableHash(reservation.id, reservation.partySize) % preferred.length;
  for (let offset = 0; offset < preferred.length; offset++) {
    const kind = preferred[(start + offset) % preferred.length];
    if (day.practice[kind].occupants.length < day.practice[kind].capacity) return kind;
  }
  return null;
}

function addPracticeOccupant(day, kind, partyId) {
  if (!kind) return;
  const occupants = day.practice[kind].occupants;
  if (!occupants.includes(partyId)) occupants.push(partyId);
}

function removePracticeOccupant(day, partyId) {
  for (const facility of Object.values(day.practice)) {
    facility.occupants = facility.occupants.filter((id) => id !== partyId);
  }
}

function routeDuration(route, transport, multiplier = 1) {
  const speed = transport === 'ride' ? CART_YD_PER_MIN : WALK_YD_PER_MIN;
  return clamp(routeDistance(route) / speed * multiplier, 0.12, 8);
}

function openHoles(state) {
  return state.golfDay.routeNetwork.holes.filter((entry) => {
    const hole = state.course.holes.find((candidate) => candidate.id === entry.id);
    return hole && hole.status === 'open';
  });
}

function scorecardFor(state) {
  return openHoles(state).map((routeHole, index) => {
    const hole = state.course.holes.find((entry) => entry.id === routeHole.id);
    return { holeId: routeHole.id, number: index + 1, par: holePar(hole), scores: [], complete: false };
  });
}

function createParty(state, reservation, minute) {
  const day = state.golfDay;
  const routeHoles = openHoles(state);
  if (!routeHoles.length) return null;
  const id = `round-${reservation.id}`;
  if (day.parties.some((entry) => entry.id === id) || day.completed.some((entry) => entry.id === id)) return null;
  const facilities = day.routeNetwork.facilities;
  const transportRequested = chooseTransport(reservation);
  const party = {
    id,
    sequence: day.nextPartyId++,
    reservationId: reservation.id,
    partyName: reservation.party.holder,
    dayAbs: reservation.dayAbs,
    scheduledMinute: reservation.dayAbs * 1440 + reservation.minute,
    checkedInMinute: reservation.checkIn.checkedInAtMinute ?? minute,
    startedMinute: null,
    completedMinute: null,
    state: null,
    stateEnteredMinute: minute,
    nextActionMinute: minute,
    simulationTier: SIMULATION_TIER.FAR,
    transport: transportRequested,
    cartId: null,
    practiceKind: null,
    practiceMinutes: 0,
    holeIndex: 0,
    currentGolferIndex: 0,
    position: { ...facilities.clubhouse },
    destination: null,
    route: null,
    routeStartedMinute: null,
    routeEndsMinute: null,
    golfers: [],
    scorecard: scorecardFor(state),
    pace: {
      expectedMinutes: 0,
      elapsedMinutes: 0,
      behindMinutes: 0,
      waitingMinutes: 0,
      travelMinutes: 0,
      shotMinutes: 0,
      practiceMinutes: 0,
      congestion: CONGESTION.CLEAR,
    },
    observations: {
      safetyWaits: 0,
      waterAvoided: 0,
      bunkerShots: 0,
      fairwaysFound: 0,
      greensReached: 0,
      marshalVisits: 0,
      cartCondition: null,
    },
    satisfactionDelta: 0,
    reviewId: null,
    summaryPosted: false,
    recoveryCount: 0,
  };

  if (transportRequested === 'ride') {
    const cart = assignCart(day, id, facilities.cartBarn);
    if (cart) {
      party.cartId = cart.id;
      party.observations.cartCondition = cart.condition;
    } else {
      party.transport = 'walk';
      party.observations.cartUnavailable = true;
    }
  }

  party.golfers = reservation.party.members.map((member, index) => {
    const persistent = persistentGolfer(state, member, reservation, index);
    return liveGolfer(state, persistent, index, facilities.clubhouse);
  });
  party.pace.expectedMinutes = party.scorecard.reduce((sum, hole) => sum + hole.par * 3.4 + 3, 0);
  day.parties.push(party);
  reservation.courseAccess.departurePlannedAtMinute = null;
  day.metrics.created++;
  day.metrics.peakActive = Math.max(day.metrics.peakActive, day.parties.length);
  emit(state, party, 'round-created', minute, {
    partySize: party.golfers.length,
    transport: party.transport,
    cartId: party.cartId,
  });
  setRoundState(state, party, ROUND_STATE.PREPARING, minute, 0.75);
  return party;
}

function importCheckedInReservations(state, minute) {
  const booked = state.reservations?.booked || [];
  for (const reservation of booked) {
    if (reservation.checkIn?.status !== 'checked-in') continue;
    if (!['granted', 'departed'].includes(reservation.courseAccess?.status)) continue;
    createParty(state, reservation, Number(reservation.checkIn.checkedInAtMinute ?? minute));
  }
}

function acquireBall(state, party, golfer, shot) {
  const ball = state.golfDay.balls.find((entry) => !entry.active);
  if (!ball) {
    state.golfDay.metrics.poolExhaustions++;
    return null;
  }
  ball.active = true;
  ball.partyId = party.id;
  ball.golferId = golfer.id;
  ball.shot = shot;
  ball.position = { ...shot.start, phase: 'launch' };
  golfer.ballId = ball.id;
  golfer.currentShot = shot;
  const active = state.golfDay.balls.filter((entry) => entry.active).length;
  state.golfDay.metrics.peakBalls = Math.max(state.golfDay.metrics.peakBalls, active);
  return ball;
}

function releaseBall(state, golfer) {
  if (!golfer?.ballId) return;
  const ball = state.golfDay.balls.find((entry) => entry.id === golfer.ballId);
  if (ball) {
    ball.active = false;
    ball.partyId = null;
    ball.golferId = null;
    ball.shot = null;
    ball.position = null;
  }
  golfer.ballId = null;
}

function currentRouteHole(state, party) {
  return openHoles(state)[party.holeIndex] || null;
}

function currentGolfer(party) {
  return party.golfers[party.currentGolferIndex] || null;
}

function updateRoutePosition(party, minute) {
  if (!party.route?.length || party.routeEndsMinute == null) return;
  const duration = Math.max(0.001, party.routeEndsMinute - party.routeStartedMinute);
  const progress = clamp((minute - party.routeStartedMinute) / duration, 0, 1);
  party.position = positionAlongRoute(party.route, progress);
  if (party.cartId) party.cartPosition = { ...party.position };
  for (const golfer of party.golfers) golfer.animation = party.transport === 'ride' ? 'riding' : 'walking';
}

function groupAhead(state, party) {
  return state.golfDay.parties
    .filter((other) => (
      other.id !== party.id
      && other.startedMinute != null
      && other.completedMinute == null
      && party.startedMinute != null
      && (other.startedMinute < party.startedMinute
        || (other.startedMinute === party.startedMinute && other.sequence < party.sequence))
    ))
    .filter((other) => other.holeIndex >= party.holeIndex)
    .sort((a, b) => a.startedMinute - b.startedMinute)[0] || null;
}

function safeToStart(state, party, minute) {
  const last = state.golfDay.starter.lastStartMinute;
  if (last != null && minute - last < STARTER_GAP_MIN) return false;
  const ahead = state.golfDay.parties.find((other) => (
    other.id !== party.id && other.startedMinute != null && other.holeIndex === 0
    && ![ROUND_STATE.HOLE_COMPLETE, ROUND_STATE.TRAVELING_NEXT_HOLE].includes(other.state)
  ));
  if (!ahead) return true;
  const tee = currentRouteHole(state, party)?.tee;
  return tee ? Math.hypot(ahead.position.x - tee.x, ahead.position.z - tee.z) >= SAFE_SHOT_GAP_YD : false;
}

function safeToHit(state, party) {
  const ahead = groupAhead(state, party);
  if (!ahead || ahead.holeIndex > party.holeIndex) return true;
  const golfer = currentGolfer(party);
  if (!golfer) return true;
  return Math.hypot(ahead.position.x - golfer.position.x, ahead.position.z - golfer.position.z) >= SAFE_SHOT_GAP_YD;
}

function queueForStarter(state, party, minute) {
  removePracticeOccupant(state.golfDay, party.id);
  if (!state.golfDay.starter.queue.includes(party.id)) state.golfDay.starter.queue.push(party.id);
  state.golfDay.starter.queue.sort((a, b) => {
    const pa = state.golfDay.parties.find((entry) => entry.id === a);
    const pb = state.golfDay.parties.find((entry) => entry.id === b);
    return (pa?.scheduledMinute || 0) - (pb?.scheduledMinute || 0) || (pa?.sequence || 0) - (pb?.sequence || 0);
  });
  const queueIndex = state.golfDay.starter.queue.indexOf(party.id);
  const staging = state.golfDay.routeNetwork.facilities.staging;
  let target = staging[Math.min(queueIndex, staging.length - 1)];
  if (queueIndex >= staging.length && staging.length >= 2) {
    const last = staging[staging.length - 1];
    const previous = staging[staging.length - 2];
    const dx = last.x - previous.x;
    const dz = last.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const extra = (queueIndex - staging.length + 1) * 4;
    target = { x: last.x + (dx / length) * extra, z: last.z + (dz / length) * extra };
  }
  const route = findCourseRoute(
    state.course,
    gridPoint(state.course, party.position),
    gridPoint(state.course, target),
    party.transport === 'ride' ? 'cart' : 'walk',
    { parkNearGoal: true },
  );
  const destination = route?.[route.length - 1] || target;
  beginRoute(state, party, route, destination, minute, ROUND_STATE.TRAVELING_TO_STARTER);
  emit(state, party, 'starter-queue-entered', minute, { position: queueIndex + 1 });
}

function beginRoute(state, party, route, destination, minute, nextState, multiplier = 1) {
  party.route = route?.length ? route : [{ ...party.position }, { ...destination }];
  party.destination = { ...destination };
  party.routeStartedMinute = minute;
  party.routeEndsMinute = round2(minute + routeDuration(party.route, party.transport, multiplier));
  setRoundState(state, party, nextState, minute, party.routeEndsMinute - minute);
}

function completeRoute(party) {
  if (party.destination) party.position = { ...party.destination };
  for (const golfer of party.golfers) golfer.animation = 'idle';
  party.route = null;
  party.destination = null;
  party.routeStartedMinute = null;
  party.routeEndsMinute = null;
}

function nextPlayableGolfer(party, afterIndex = party.currentGolferIndex) {
  for (let offset = 1; offset <= party.golfers.length; offset++) {
    const index = (afterIndex + offset) % party.golfers.length;
    if (!party.golfers[index].holed) return index;
  }
  return -1;
}

function allGolfersHoled(party) {
  return party.golfers.every((golfer) => golfer.holed);
}

function planCurrentShot(state, party, minute) {
  const golfer = currentGolfer(party);
  const routeHole = currentRouteHole(state, party);
  if (!golfer || !routeHole) return null;
  const aggregates = party.courseSnapshot;
  return planGolfShot({
    course: state.course,
    partyId: party.id,
    golfer,
    holeIndex: party.holeIndex,
    shotNumber: golfer.holeStrokes + 1,
    start: golfer.position,
    target: routeHole.pin,
    startMinute: minute,
    context: {
      seed: state.seed,
      courseCondition: party.conditionRating,
      greenQuality: aggregates.greensHealth / 100,
      greenSpeed: aggregates.greensSpeed,
      roughPenalty: aggregates.roughHeightMm > 65 ? 0.16 : 0.08,
      bunkerQuality: clamp((party.conditionRating - aggregates.diseasedGreens * 5) / 100, 0.2, 1),
    },
  });
}

function updatePace(party, minute) {
  if (party.startedMinute == null) return;
  party.pace.elapsedMinutes = round1(Math.max(0, minute - party.startedMinute));
  const fraction = party.scorecard.length ? party.holeIndex / party.scorecard.length : 0;
  const expectedSoFar = party.pace.expectedMinutes * fraction;
  party.pace.behindMinutes = round1(Math.max(0, party.pace.elapsedMinutes - expectedSoFar - 8));
  party.pace.congestion = party.pace.behindMinutes >= 18 ? CONGESTION.SEVERE
    : party.pace.behindMinutes >= 10 ? CONGESTION.SLOW
      : party.pace.waitingMinutes >= 3 ? CONGESTION.WATCH : CONGESTION.CLEAR;
}

function maybeCreateMarshalTask(state, party, minute) {
  const day = state.golfDay;
  if (party.pace.waitingMinutes < 5 && party.pace.behindMinutes < 14) return;
  const open = day.marshalTasks.find((task) => task.partyId === party.id && task.status !== 'complete');
  if (open) return;
  const task = {
    id: `marshal-${day.nextMarshalTaskId++}`,
    partyId: party.id,
    hole: party.holeIndex + 1,
    createdMinute: round2(minute),
    dueMinute: round2(minute + 3),
    completedMinute: null,
    status: 'dispatched',
    reason: party.pace.behindMinutes >= 14 ? 'pace-behind' : 'course-congestion',
  };
  day.marshalTasks.push(task);
  emit(state, party, 'marshal-dispatched', minute, { taskId: task.id, reason: task.reason });
}

function resolveMarshalTasks(state, minute) {
  for (const task of state.golfDay.marshalTasks) {
    if (task.status === 'complete' || minute < task.dueMinute) continue;
    const party = state.golfDay.parties.find((entry) => entry.id === task.partyId);
    task.status = 'complete';
    task.completedMinute = round2(task.dueMinute);
    if (party) {
      party.observations.marshalVisits++;
      party.pace.behindMinutes = round1(Math.max(0, party.pace.behindMinutes - 3));
      emit(state, party, 'marshal-visit-complete', task.dueMinute, { taskId: task.id });
    }
  }
  if (state.golfDay.marshalTasks.length > 100) state.golfDay.marshalTasks.splice(0, state.golfDay.marshalTasks.length - 100);
}

function scoreHole(state, party, minute) {
  const row = party.scorecard[party.holeIndex];
  row.scores = party.golfers.map((golfer) => golfer.holeStrokes);
  row.complete = true;
  row.completedMinute = round2(minute);
  for (const golfer of party.golfers) {
    golfer.holes.push(golfer.holeStrokes);
    golfer.totalStrokes += golfer.holeStrokes;
  }
  emit(state, party, 'hole-complete', minute, {
    hole: row.number,
    par: row.par,
    scores: [...row.scores],
  });
}

function resetGolfersForHole(party, tee) {
  for (const golfer of party.golfers) {
    golfer.position = { ...tee };
    golfer.lie = null;
    golfer.currentShot = null;
    golfer.ballId = null;
    golfer.holeStrokes = 0;
    golfer.holed = false;
    golfer.animation = 'idle';
  }
  party.currentGolferIndex = 0;
  party.position = { ...tee };
}

function finishPersistentGolfers(state, party, minute) {
  const dayAbs = calendarOf(minute).dayAbs;
  for (const live of party.golfers) {
    const golfer = state.golfers.pool.find((entry) => entry.id === live.persistentId);
    if (!golfer) continue;
    const priorSkill = golfer.skill;
    const score = live.totalStrokes;
    const par = party.scorecard.reduce((sum, row) => sum + row.par, 0);
    const pacePenalty = Math.max(0, party.pace.waitingMinutes - 4) * 0.35;
    const conditionBonus = (party.conditionRating - 60) * 0.045;
    const scoreMood = clamp((par + 10 - score) * 0.16, -3.5, 2.5);
    golfer.satisfaction = clamp(golfer.satisfaction + conditionBonus + scoreMood - pacePenalty, 0, 100);
    golfer.skill = Math.max(2, round2(golfer.skill - (party.practiceKind ? 0.08 : 0.045)));
    golfer.skillDelta30 = round2((golfer.skillDelta30 || 0) * 0.9 + golfer.skill - priorSkill);
    golfer.roundsPlayed = (golfer.roundsPlayed || 0) + 1;
    golfer.lastVisitDay = dayAbs;
    if (golfer.bestScore == null || score < golfer.bestScore) golfer.bestScore = score;
    golfer.memory ||= [];
    golfer.memory.unshift({
      day: dayAbs,
      score,
      thoughts: [
        party.pace.waitingMinutes > 6 ? 'The course backed up.' : 'The round moved along.',
        party.conditionRating >= 70 ? 'Course conditions rewarded good shots.' : 'Course condition affected play.',
      ],
      roundId: party.id,
    });
    if (golfer.memory.length > 8) golfer.memory.length = 8;
  }
}

function summaryFor(party) {
  const par = party.scorecard.reduce((sum, row) => sum + row.par, 0);
  const scores = party.golfers.map((golfer) => ({
    golferId: golfer.id,
    name: golfer.name,
    total: golfer.totalStrokes,
    toPar: golfer.totalStrokes - par,
    holes: [...golfer.holes],
  }));
  return {
    id: party.id,
    reservationId: party.reservationId,
    dayAbs: party.dayAbs,
    startedMinute: party.startedMinute,
    completedMinute: party.completedMinute,
    durationMinutes: round1(party.completedMinute - party.startedMinute),
    partyName: party.partyName,
    partySize: party.golfers.length,
    transport: party.transport,
    cartId: party.cartId,
    practiceKind: party.practiceKind,
    par,
    scores,
    pace: { ...party.pace },
    observations: { ...party.observations },
    conditionRating: party.conditionRating,
    reviewId: party.reviewId,
  };
}

function postRoundReview(state, party, minute) {
  if (party.reviewId) return;
  const primary = party.golfers[0];
  const review = reviewForCompletedRound(state, {
    id: party.id,
    golferId: primary.id,
    golferName: primary.name,
    score: primary.totalStrokes,
    par: party.scorecard.reduce((sum, row) => sum + row.par, 0),
    durationMinutes: party.pace.elapsedMinutes,
    waitingMinutes: party.pace.waitingMinutes,
    conditionRating: party.conditionRating,
    practiceKind: party.practiceKind,
    transport: party.transport,
    cartCondition: party.observations.cartCondition,
    marshalVisits: party.observations.marshalVisits,
  }, stableHash(state.seed, party.id));
  review.roundId = party.id;
  review.golferId = primary.id;
  review.source = 'completed-round';
  postReview(state, review);
  party.reviewId = `review:${party.id}`;
  state.golfDay.metrics.reviewed++;
  emit(state, party, 'review-generated', minute, { reviewId: party.reviewId, stars: review.stars });
}

function releaseCart(state, party) {
  if (!party.cartId) return;
  const cart = state.golfDay.carts.find((entry) => entry.id === party.cartId);
  if (!cart) return;
  cart.status = 'available';
  cart.assignedPartyId = null;
  cart.position = { ...state.golfDay.routeNetwork.facilities.cartBarn };
}

function completeRound(state, party, minute) {
  if (party.completedMinute != null) return;
  party.completedMinute = round2(minute);
  updatePace(party, minute);
  finishPersistentGolfers(state, party, minute);
  state.golfDay.metrics.completed++;
  emit(state, party, 'round-complete', minute, {
    durationMinutes: party.pace.elapsedMinutes,
    scores: party.golfers.map((golfer) => golfer.totalStrokes),
  });
}

function processParty(state, party, minute) {
  const day = state.golfDay;
  updateRoutePosition(party, minute);
  updatePace(party, minute);
  maybeCreateMarshalTask(state, party, minute);
  const routeHole = currentRouteHole(state, party);

  switch (party.state) {
    case ROUND_STATE.PREPARING: {
      party.courseSnapshot ||= courseAggregates(state);
      party.conditionRating ??= round1(clubRatings(state).condition);
      const practice = choosePractice(state, reservationById(state, party.reservationId), minute);
      if (practice) {
        party.practiceKind = practice;
        party.practiceMinutes = Math.min(8, Math.max(3, party.scheduledMinute - minute - 2));
        party.pace.practiceMinutes = party.practiceMinutes;
        addPracticeOccupant(day, practice, party.id);
        const facility = day.routeNetwork.facilities[practice];
        const practiceSpots = facility.bays || facility.positions || [facility.center];
        const practiceIndex = Math.max(0, day.practice[practice].occupants.indexOf(party.id));
        party.position = { ...(practiceSpots[practiceIndex % practiceSpots.length] || facility.center) };
        for (const golfer of party.golfers) golfer.position = { ...party.position };
        setRoundState(state, party, ROUND_STATE.PRACTICING, minute, party.practiceMinutes, { practice });
        emit(state, party, 'practice-started', minute, { practice, durationMinutes: party.practiceMinutes });
      } else queueForStarter(state, party, minute);
      break;
    }
    case ROUND_STATE.PRACTICING:
      emit(state, party, 'practice-complete', minute, { practice: party.practiceKind });
      queueForStarter(state, party, minute);
      break;
    case ROUND_STATE.TRAVELING_TO_STARTER:
      completeRoute(party);
      setRoundState(state, party, ROUND_STATE.WAITING_FOR_STARTER, minute, 0.5);
      break;
    case ROUND_STATE.WAITING_FOR_STARTER: {
      const queueIndex = day.starter.queue.indexOf(party.id);
      const atTime = minute >= party.scheduledMinute;
      if (queueIndex === 0 && atTime && day.starter.currentPartyId == null && safeToStart(state, party, minute)) {
        day.starter.queue.shift();
        day.starter.currentPartyId = party.id;
        const message = `${party.partyName}, you are up on the first tee.`;
        day.starter.announcements.unshift({ minute: round2(minute), partyId: party.id, message });
        if (day.starter.announcements.length > 20) day.starter.announcements.length = 20;
        setRoundState(state, party, ROUND_STATE.CALLED_TO_TEE, minute, 0.45);
        emit(state, party, 'starter-called-party', minute, { message });
      } else {
        if (atTime) party.pace.waitingMinutes = round1(party.pace.waitingMinutes + 0.5);
        party.nextActionMinute = round2(minute + 0.5);
      }
      break;
    }
    case ROUND_STATE.CALLED_TO_TEE: {
      const tee = routeHole.tee;
      const route = findCourseRoute(state.course, gridPoint(state.course, party.position), gridPoint(state.course, tee), party.transport === 'ride' ? 'cart' : 'walk');
      beginRoute(state, party, route, tee, minute, ROUND_STATE.AT_TEE);
      break;
    }
    case ROUND_STATE.AT_TEE: {
      completeRoute(party);
      resetGolfersForHole(party, routeHole.tee);
      if (party.startedMinute == null) {
        const departure = markCourseDeparture(state, party.reservationId, { atMinute: minute });
        if (!departure.ok) {
          setRoundState(state, party, ROUND_STATE.RECOVERY, minute, 1, { reason: departure.reason });
          break;
        }
        party.startedMinute = minute;
        day.starter.lastStartMinute = minute;
        day.starter.currentPartyId = null;
        day.metrics.started++;
        emit(state, party, 'round-started', minute, { actualStartMinute: departure.actualStartMinute });
      }
      setRoundState(state, party, ROUND_STATE.PREPARING_SHOT, minute, 0.85);
      break;
    }
    case ROUND_STATE.PREPARING_SHOT:
    case ROUND_STATE.ON_GREEN:
    case ROUND_STATE.PUTTING: {
      if (!safeToHit(state, party)) {
        party.observations.safetyWaits++;
        setRoundState(state, party, ROUND_STATE.WAITING_ON_GROUP, minute, 0.65);
        break;
      }
      const golfer = currentGolfer(party);
      const shot = planCurrentShot(state, party, minute);
      if (!shot) {
        setRoundState(state, party, ROUND_STATE.RECOVERY, minute, 0.5, { reason: 'shot-plan-failed' });
        break;
      }
      const ball = acquireBall(state, party, golfer, shot);
      if (!ball) {
        party.nextActionMinute = round2(minute + 0.1);
        break;
      }
      golfer.animation = shot.type === 'putt' ? 'putting' : 'swinging';
      golfer.holeStrokes++;
      if (shot.type === 'bunker') party.observations.bunkerShots++;
      if (shot.safetyAdjusted) party.observations.waterAvoided++;
      day.presentationShots.push({
        id: `${party.id}:${party.holeIndex + 1}:${golfer.id}:${golfer.holeStrokes}`,
        sequence: day.nextEventSequence,
        partyId: party.id,
        golferId: golfer.id,
        hole: party.holeIndex + 1,
        shot: { ...shot },
      });
      if (day.presentationShots.length > 32) day.presentationShots.splice(0, day.presentationShots.length - 32);
      emit(state, party, 'shot-started', minute, {
        golferId: golfer.id,
        golferName: golfer.name,
        hole: party.holeIndex + 1,
        stroke: golfer.holeStrokes,
        club: shot.club,
        lie: shot.lie.kind,
      });
      party.pace.shotMinutes = round1(party.pace.shotMinutes + shot.endMinute - minute);
      setRoundState(state, party, ROUND_STATE.BALL_IN_PLAY, minute, shot.endMinute - minute);
      break;
    }
    case ROUND_STATE.BALL_IN_PLAY: {
      const golfer = currentGolfer(party);
      const shot = golfer?.currentShot;
      if (!golfer || !shot) {
        setRoundState(state, party, ROUND_STATE.RECOVERY, minute, 0.2, { reason: 'missing-active-shot' });
        break;
      }
      const ball = day.balls.find((entry) => entry.id === golfer.ballId);
      if (ball) ball.position = sampleBallPosition(shot, minute);
      releaseBall(state, golfer);
      golfer.position = { x: shot.stop.x, z: shot.stop.z };
      golfer.lie = lieAtWorld(state.course, golfer.position);
      golfer.animation = 'watching-ball';
      const par = party.scorecard[party.holeIndex].par;
      const forcedPickup = golfer.holeStrokes >= par + 5;
      golfer.holed = shot.holed || forcedPickup;
      emit(state, party, 'shot-complete', minute, {
        golferId: golfer.id,
        hole: party.holeIndex + 1,
        stroke: golfer.holeStrokes,
        lie: golfer.lie.kind,
        remainingYd: shot.remainingAfterYd,
        holed: golfer.holed,
        pickedUp: forcedPickup && !shot.holed,
      });
      if (allGolfersHoled(party)) {
        party.position = { ...routeHole.pin };
        setRoundState(state, party, ROUND_STATE.HOLE_COMPLETE, minute, 0.28);
        break;
      }
      const next = nextPlayableGolfer(party);
      party.currentGolferIndex = next;
      const destination = currentGolfer(party).position;
      const route = findCourseRoute(
        state.course,
        gridPoint(state.course, party.position),
        gridPoint(state.course, destination),
        party.transport === 'ride' ? 'cart' : 'walk',
        { parkNearGoal: true },
      );
      const duration = routeDuration(route, party.transport);
      party.pace.travelMinutes = round1(party.pace.travelMinutes + duration);
      beginRoute(state, party, route, destination, minute, ROUND_STATE.TRAVELING_TO_BALL);
      break;
    }
    case ROUND_STATE.TRAVELING_TO_BALL: {
      completeRoute(party);
      const golfer = currentGolfer(party);
      const onGreen = golfer?.lie?.kind === 'green';
      setRoundState(state, party, onGreen ? ROUND_STATE.ON_GREEN : ROUND_STATE.PREPARING_SHOT, minute, 0.78);
      break;
    }
    case ROUND_STATE.WAITING_ON_GROUP:
      party.pace.waitingMinutes = round1(party.pace.waitingMinutes
        + Math.max(0, minute - Number(party.lastWaitAccountedMinute ?? party.stateEnteredMinute)));
      party.lastWaitAccountedMinute = round2(minute);
      if (safeToHit(state, party)) {
        const golfer = currentGolfer(party);
        setRoundState(state, party, golfer?.lie?.kind === 'green' ? ROUND_STATE.PUTTING : ROUND_STATE.PREPARING_SHOT, minute, 0.7);
      } else party.nextActionMinute = round2(minute + 0.65);
      break;
    case ROUND_STATE.HOLE_COMPLETE: {
      scoreHole(state, party, minute);
      if (party.holeIndex >= party.scorecard.length - 1) {
        completeRound(state, party, minute);
        setRoundState(state, party, ROUND_STATE.ROUND_COMPLETE, minute, 0.35);
        break;
      }
      const completedIndex = party.holeIndex;
      party.holeIndex++;
      const nextHole = currentRouteHole(state, party);
      const route = day.routeNetwork.holes[completedIndex]?.transition?.[party.transport === 'ride' ? 'cart' : 'walk'];
      const duration = routeDuration(route, party.transport);
      party.pace.travelMinutes = round1(party.pace.travelMinutes + duration);
      beginRoute(state, party, route, nextHole.tee, minute, ROUND_STATE.TRAVELING_NEXT_HOLE);
      break;
    }
    case ROUND_STATE.TRAVELING_NEXT_HOLE:
      completeRoute(party);
      resetGolfersForHole(party, currentRouteHole(state, party).tee);
      if (party.holeIndex === 5 && party.scorecard.length >= 9) {
        setRoundState(state, party, ROUND_STATE.TURN_STOP, minute, 2.5);
        emit(state, party, 'turn-stop', minute, { durationMinutes: 2.5 });
      } else setRoundState(state, party, ROUND_STATE.PREPARING_SHOT, minute, 0.8);
      break;
    case ROUND_STATE.TURN_STOP:
      setRoundState(state, party, ROUND_STATE.PREPARING_SHOT, minute, 0.8);
      break;
    case ROUND_STATE.ROUND_COMPLETE: {
      const finalRoute = day.routeNetwork.holes[party.holeIndex]?.transition?.[party.transport === 'ride' ? 'cart' : 'walk'];
      const destination = party.transport === 'ride' ? day.routeNetwork.facilities.cartBarn : day.routeNetwork.facilities.clubhouse;
      beginRoute(state, party, finalRoute, destination, minute,
        party.transport === 'ride' ? ROUND_STATE.RETURNING_CART : ROUND_STATE.RETURNING_SCORECARD);
      break;
    }
    case ROUND_STATE.RETURNING_CART:
      completeRoute(party);
      releaseCart(state, party);
      setRoundState(state, party, ROUND_STATE.RETURNING_SCORECARD, minute, 0.8);
      emit(state, party, 'cart-returned', minute, { cartId: party.cartId });
      break;
    case ROUND_STATE.RETURNING_SCORECARD:
      completeRoute(party);
      postRoundReview(state, party, minute);
      if (!party.summaryPosted) {
        day.completed.unshift(summaryFor(party));
        if (day.completed.length > SUMMARY_LIMIT) day.completed.length = SUMMARY_LIMIT;
        party.summaryPosted = true;
      }
      setRoundState(state, party, ROUND_STATE.LEAVING_PROPERTY, minute, 0.7);
      break;
    case ROUND_STATE.LEAVING_PROPERTY:
      setRoundState(state, party, ROUND_STATE.REVIEW_GENERATED, minute, 0.4);
      break;
    case ROUND_STATE.REVIEW_GENERATED:
      setRoundState(state, party, ROUND_STATE.DESPAWNED, minute, 0);
      break;
    case ROUND_STATE.RECOVERY:
      party.recoveryCount++;
      day.metrics.recovered++;
      releaseBall(state, currentGolfer(party));
      if (!routeHole) {
        completeRound(state, party, minute);
        setRoundState(state, party, ROUND_STATE.ROUND_COMPLETE, minute, 0.2);
      } else setRoundState(state, party, ROUND_STATE.PREPARING_SHOT, minute, 0.2);
      break;
    default:
      setRoundState(state, party, ROUND_STATE.RECOVERY, minute, 0.1, { reason: 'unknown-state' });
  }
}

function updateBalls(state, minute) {
  for (const ball of state.golfDay.balls) {
    if (ball.active && ball.shot) ball.position = sampleBallPosition(ball.shot, minute);
  }
}

function updateCongestion(state) {
  const day = state.golfDay;
  const active = day.parties.filter((party) => party.state !== ROUND_STATE.DESPAWNED);
  const holes = new Map();
  let waits = 0;
  for (const party of active) {
    if (party.startedMinute == null || party.completedMinute != null) continue;
    const number = party.holeIndex + 1;
    holes.set(number, (holes.get(number) || 0) + 1);
    if (party.state === ROUND_STATE.WAITING_ON_GROUP) waits++;
  }
  const congested = [...holes.entries()].filter(([, count]) => count > 1).map(([hole, count]) => ({ hole, groups: count }));
  const score = congested.reduce((sum, entry) => sum + entry.groups - 1, 0) + waits * 2;
  day.congestion = {
    level: score >= 7 ? CONGESTION.SEVERE : score >= 4 ? CONGESTION.SLOW : score >= 1 ? CONGESTION.WATCH : CONGESTION.CLEAR,
    score,
    waits,
    holes: congested,
  };
}

function pruneDespawned(state) {
  const removed = state.golfDay.parties.filter((party) => party.state === ROUND_STATE.DESPAWNED);
  for (const party of removed) {
    removePracticeOccupant(state.golfDay, party.id);
    state.golfDay.starter.queue = state.golfDay.starter.queue.filter((id) => id !== party.id);
  }
  state.golfDay.parties = state.golfDay.parties.filter((party) => party.state !== ROUND_STATE.DESPAWNED);
}

export function golfDayTick(state, targetMinute = state.clock?.minutes || 0) {
  const day = ensureGolfDay(state);
  const target = Number(targetMinute);
  importCheckedInReservations(state, target);
  resolveMarshalTasks(state, target);
  let processed = 0;
  while (processed++ < MAX_EVENTS_PER_TICK) {
    let party = null;
    let nextMinute = Infinity;
    for (const candidate of day.parties) {
      if (candidate.state === ROUND_STATE.DESPAWNED) continue;
      const due = Number(candidate.nextActionMinute);
      if (Number.isFinite(due) && due <= target && due < nextMinute) {
        party = candidate;
        nextMinute = due;
      }
    }
    if (!party) break;
    processParty(state, party, nextMinute);
    resolveMarshalTasks(state, nextMinute);
  }
  if (processed >= MAX_EVENTS_PER_TICK) emit(state, null, 'golf-day-tick-guard', target, { active: day.parties.length });
  updateBalls(state, target);
  for (const party of day.parties) {
    updateRoutePosition(party, target);
    updatePace(party, target);
  }
  updateCongestion(state);
  pruneDespawned(state);
  day.lastProcessedMinute = Math.max(Number(day.lastProcessedMinute || 0), target);
  return day;
}

export function recoverGolfDay(state) {
  const day = state.golfDay;
  const now = Number(state.clock?.minutes || day.lastProcessedMinute || 0);
  for (const ball of day.balls) {
    ball.active = false;
    ball.partyId = null;
    ball.golferId = null;
    ball.shot = null;
    ball.position = null;
  }
  for (const party of day.parties) {
    if (party.state === ROUND_STATE.BALL_IN_PLAY) {
      const golfer = currentGolfer(party);
      if (golfer) {
        golfer.ballId = null;
        golfer.currentShot = null;
        golfer.animation = 'idle';
        golfer.holeStrokes = Math.max(0, golfer.holeStrokes - 1);
      }
      party.state = ROUND_STATE.PREPARING_SHOT;
      party.stateEnteredMinute = now;
      party.nextActionMinute = now + 0.2;
      party.recoveryCount = (party.recoveryCount || 0) + 1;
      day.metrics.recovered++;
      emit(state, party, 'shot-recovered-after-load', now);
    } else if (!Number.isFinite(party.nextActionMinute) || party.nextActionMinute < now - 1440) {
      party.nextActionMinute = now + 0.1;
    }
  }
  updateCongestion(state);
  return day;
}

export function setGolfSimulationFocus(state, worldPosition) {
  const day = state.golfDay || ensureGolfDay(state);
  for (const party of day.parties) {
    const distance = Math.hypot(party.position.x - worldPosition.x, party.position.z - worldPosition.z);
    party.simulationTier = distance <= 95 ? SIMULATION_TIER.NEAR : distance <= 260 ? SIMULATION_TIER.MID : SIMULATION_TIER.FAR;
  }
}

export function liveGolfSummary(state) {
  const day = state.golfDay || ensureGolfDay(state);
  return {
    activeParties: day.parties.length,
    activeGolfers: day.parties.reduce((sum, party) => sum + party.golfers.length, 0),
    activeBalls: day.balls.filter((ball) => ball.active).length,
    cartsAssigned: day.carts.filter((cart) => cart.status === 'assigned').length,
    starterQueue: [...day.starter.queue],
    practice: Object.fromEntries(Object.entries(day.practice).map(([key, value]) => [key, value.occupants.length])),
    congestion: { ...day.congestion },
    marshalOpen: day.marshalTasks.filter((task) => task.status !== 'complete').length,
    latestCompleted: day.completed[0] || null,
  };
}
