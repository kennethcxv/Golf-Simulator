// Live golf-day simulation.
//
// This is the canonical round lifecycle. A checked-in operations reservation is
// adapted once into a party here; renderers only present these records and never
// advance a second, cosmetic golfer simulation.

import { clamp } from '../core/utils.js';
import { calendarOf } from './time.js';
import { holePar } from './course.js';
import { courseAggregates } from './rounds.js';
import { amenityScore, clubRatings, fairGreenFee } from './club.js';
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
import { ROLE, staffByRole } from './staff.js';
import { golfCartTier, initialGolfCartTier } from '../data/golfCarts.js';

export const ROUND_STATE = Object.freeze({
  PREPARING: 'preparing',
  TRAVELING_TO_PRACTICE: 'traveling-to-practice',
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
  LIGHT: 'light',
  MODERATE: 'moderate',
  HEAVY: 'heavy',
  GRIDLOCKED: 'gridlocked',
  // Compatibility names for callers written before the five-level operations scale.
  WATCH: 'light',
  SLOW: 'moderate',
  SEVERE: 'heavy',
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
const PRACTICE_SHOT_GAP_MIN = 0.42;
const CART_CLEAN_MIN = 1.2;
const CART_CHARGE_MIN = 2.2;

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function clockLabel(absoluteMinute) {
  const minuteOfDay = ((Math.floor(absoluteMinute) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

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
  return Array.from({ length: count }, (_, index) => {
    const tierId = initialGolfCartTier(index);
    return {
      id: `cart-${index + 1}`,
      tierId,
      status: 'available',
      assignedPartyId: null,
      assignedStaffId: null,
      condition: 82 + (index % 4) * 3,
      batteryPercent: 88 + (index % 4) * 4,
      position: null,
      yaw: 0,
      lightsOn: false,
      parkedByPlayer: false,
      drivenDistanceYd: 0,
      homeSlot: index,
      trips: 0,
      upgrades: 0,
      purchasedMinute: 0,
      serviceReadyMinute: null,
      lastReturnedMinute: null,
    };
  });
}

function emptyExperience() {
  return {
    rounds: 0,
    ratingTotal: 0,
    averageRating: 0,
    paceMinutesTotal: 0,
    waitMinutesTotal: 0,
    averagePaceMinutes: 0,
    averageWaitMinutes: 0,
    congestion: { clear: 0, light: 0, moderate: 0, heavy: 0, gridlocked: 0 },
    problemHoles: {},
    cartRequests: 0,
    cartUnavailable: 0,
    conditionComplaints: 0,
    skillDistribution: { lowHandicap: 0, midHandicap: 0, developing: 0 },
    recommendations: [],
    lastRoundId: null,
  };
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
    partyPool: [],
    completed: [],
    events: [],
    presentationShots: [],
    carts: initialCarts(cartCount),
    balls: initialBalls(),
    practice: {
      range: { capacity: 6, occupants: [], bucketsAvailable: 8, bucketsInUse: [] },
      putting: { capacity: 6, occupants: [] },
      chipping: { capacity: 4, occupants: [] },
    },
    starter: {
      queue: [],
      currentPartyId: null,
      lastStartMinute: null,
      announcements: [],
      display: { partyName: null, teeTime: null, hole: 1, status: 'TEE OPEN', delayMinutes: 0, notice: null, nextUp: null, onDeck: null },
      lastAnnouncementMinute: null,
    },
    marshalTasks: [],
    marshal: { patrolEmployeeId: null, patrolActive: false, interventions: 0 },
    experience: emptyExperience(),
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
      partyPoolReuses: 0,
    },
    lastProcessedMinute: Math.floor(state.clock?.minutes || 0),
  };
  return state.golfDay;
}

function ensureShapes(day) {
  day.parties ||= [];
  day.partyPool ||= [];
  day.completed ||= [];
  day.events ||= [];
  day.presentationShots ||= [];
  day.carts ||= initialCarts();
  for (let index = 0; index < day.carts.length; index++) {
    const cart = day.carts[index];
    cart.tierId = golfCartTier(cart.tierId || initialGolfCartTier(index)).id;
    cart.condition = clamp(Number(cart.condition ?? 85), 0, 100);
    cart.batteryPercent = clamp(Number(cart.batteryPercent ?? 100), 0, 100);
    cart.assignedPartyId ??= null;
    cart.assignedStaffId ??= null;
    cart.yaw = Number.isFinite(Number(cart.yaw)) ? Number(cart.yaw) : 0;
    cart.lightsOn = Boolean(cart.lightsOn);
    cart.parkedByPlayer = Boolean(cart.parkedByPlayer);
    cart.drivenDistanceYd = Math.max(0, Number(cart.drivenDistanceYd || 0));
    cart.homeSlot ??= index;
    cart.trips ??= 0;
    cart.upgrades ??= 0;
    cart.purchasedMinute ??= 0;
    cart.serviceReadyMinute ??= null;
    cart.lastReturnedMinute ??= null;
  }
  day.balls ||= initialBalls();
  day.practice ||= {};
  for (const [name, capacity] of [['range', 6], ['putting', 6], ['chipping', 4]]) {
    day.practice[name] ||= { capacity, occupants: [] };
    day.practice[name].occupants ||= [];
  }
  day.practice.range.bucketsAvailable ??= 8;
  day.practice.range.bucketsInUse ||= [];
  day.starter ||= { queue: [], currentPartyId: null, lastStartMinute: null, announcements: [] };
  day.starter.queue ||= [];
  day.starter.announcements ||= [];
  day.starter.display ||= { partyName: null, teeTime: null, hole: 1, status: 'TEE OPEN', delayMinutes: 0, notice: null, nextUp: null, onDeck: null };
  day.starter.display.nextUp ??= null;
  day.starter.display.onDeck ??= null;
  day.starter.lastAnnouncementMinute ??= null;
  day.marshalTasks ||= [];
  day.marshal ||= { patrolEmployeeId: null, patrolActive: false, interventions: 0 };
  day.marshal.patrolEmployeeId ??= null;
  day.marshal.patrolActive ??= false;
  day.marshal.interventions ??= 0;
  day.experience ||= emptyExperience();
  const experienceDefaults = emptyExperience();
  for (const [key, value] of Object.entries(experienceDefaults)) {
    if (day.experience[key] == null) day.experience[key] = value;
  }
  day.experience.congestion = { ...experienceDefaults.congestion, ...day.experience.congestion };
  day.experience.problemHoles ||= {};
  day.experience.skillDistribution = {
    ...experienceDefaults.skillDistribution,
    ...day.experience.skillDistribution,
  };
  day.experience.recommendations ||= [];
  day.metrics ||= {};
  for (const [key, value] of Object.entries({
    created: 0, started: 0, completed: 0, reviewed: 0, recovered: 0,
    peakActive: 0, peakBalls: 0, poolExhaustions: 0, partyPoolReuses: 0,
  })) day.metrics[key] ??= value;
  day.nextPartyId ||= 1;
  day.nextEventSequence ||= 1;
  day.nextMarshalTaskId ||= 1;
  day.congestion ||= { level: CONGESTION.CLEAR, score: 0, waits: 0, holes: [] };
}

function ensurePartyShapes(day) {
  for (const party of day.parties) {
    party.requestedTransport ??= party.scorecardMeta?.transport || party.transport;
    party.practiceSession ??= null;
    party.cartLoaded ??= party.transport !== 'ride' || party.startedMinute != null;
    party.cartReturned ??= false;
    party.routeTransport ??= party.route ? party.transport : null;
    party.experience ??= null;
    party.weatherHoldApplied ??= false;
    party.maintenanceBriefingApplied ??= false;
    party.pace ||= {};
    Object.assign(party.pace, {
      scheduledIntervalMinutes: party.pace.scheduledIntervalMinutes ?? STARTER_GAP_MIN,
      actualStartDelayMinutes: party.pace.actualStartDelayMinutes ?? 0,
      distanceAheadYd: party.pace.distanceAheadYd ?? null,
      distanceBehindYd: party.pace.distanceBehindYd ?? null,
      searchMinutes: party.pace.searchMinutes ?? 0,
      maintenanceDelayMinutes: party.pace.maintenanceDelayMinutes ?? 0,
      weatherDelayMinutes: party.pace.weatherDelayMinutes ?? 0,
      holeTimes: party.pace.holeTimes || [],
      waitReasons: party.pace.waitReasons || {},
      rawBehindMinutes: party.pace.rawBehindMinutes ?? party.pace.behindMinutes ?? 0,
      interventionCreditMinutes: party.pace.interventionCreditMinutes ?? 0,
      paceBoostUntilMinute: party.pace.paceBoostUntilMinute ?? null,
    });
    party.observations ||= {};
    for (const [key, value] of Object.entries({
      cartUnavailable: false,
      checkInMinutes: 0,
      startDelayMinutes: 0,
      greenQuality: null,
      bunkerQuality: null,
      roughDifficulty: null,
      designRating: null,
      sceneryRating: null,
      practiceShots: 0,
      practicePuttsHoled: 0,
      practiceBallPickups: 0,
    })) party.observations[key] ??= value;
    party.scorecardMeta ||= {
      teeSet: 'club', startMinute: party.startedMinute, finishMinute: party.completedMinute,
      returnedMinute: null, transport: party.transport, courseCondition: party.conditionRating ?? null,
    };
    for (const row of party.scorecard || []) {
      row.teeSet ||= party.scorecardMeta.teeSet;
      row.penalties ||= row.scores?.map(() => 0) || [];
      row.startedMinute ??= null;
      row.completedMinute ??= null;
      row.durationMinutes ??= null;
      row.paceTargetMinutes ??= round1(Number(row.par || 4) * 3.4 + 3);
      row.condition ??= null;
    }
    for (const golfer of party.golfers || []) {
      golfer.currentTarget ??= null;
      golfer.holePenalties ??= 0;
      golfer.totalPenalties ??= 0;
      golfer.penalties ||= [];
      golfer.equipment ||= { club: null, bag: 'stand-bag', cartSeat: null };
      golfer.recovery ||= { checkpoint: 'stable-wait', count: 0, lastReason: null };
    }
  }
}

export function ensureGolfDay(state, options = {}) {
  if (!state.golfDay || state.golfDay.version !== GOLF_DAY_VERSION) initGolfDay(state, options);
  const day = state.golfDay;
  ensureShapes(day);
  ensurePartyShapes(day);
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
    currentTarget: null,
    holeStrokes: 0,
    holePenalties: 0,
    totalStrokes: 0,
    totalPenalties: 0,
    holes: [],
    penalties: [],
    holed: false,
    animation: 'idle',
    equipment: { club: null, bag: 'stand-bag', cartSeat: null },
    recovery: { checkpoint: 'stable-wait', count: 0, lastReason: null },
  };
}

function assignCart(day, partyId, position, partySize = 1) {
  const available = day.carts.filter((entry) => entry.status === 'available');
  const serviceable = available.filter((entry) => entry.batteryPercent >= 15 && entry.condition >= 25);
  const candidates = (serviceable.length ? serviceable : available).sort((left, right) => {
    const leftTier = golfCartTier(left.tierId);
    const rightTier = golfCartTier(right.tierId);
    const leftFits = leftTier.capacity >= partySize ? 0 : 1;
    const rightFits = rightTier.capacity >= partySize ? 0 : 1;
    return leftFits - rightFits
      || Math.abs(leftTier.capacity - partySize) - Math.abs(rightTier.capacity - partySize)
      || right.condition - left.condition
      || right.batteryPercent - left.batteryPercent
      || leftTier.rank - rightTier.rank;
  });
  const cart = candidates[0];
  if (!cart) return null;
  cart.status = 'assigned';
  cart.assignedPartyId = partyId;
  cart.assignedStaffId = null;
  cart.position = { ...position };
  cart.yaw = 0;
  cart.lightsOn = false;
  cart.parkedByPlayer = false;
  cart.trips++;
  cart.batteryPercent = clamp(cart.batteryPercent - 2, 0, 100);
  return cart;
}

function chooseTransport(reservation) {
  const requested = reservation.transport || reservation.party?.transport;
  if (requested === 'walk' || requested === 'ride') return requested;
  if (requested === 'walking') return 'walk';
  if (requested === 'cart') return 'ride';
  const memberCount = reservation.party.members.filter((member) => member.memberStatus === 'member').length;
  return (stableHash(reservation.id, reservation.partySize) + memberCount) % 5 < 3 ? 'ride' : 'walk';
}

function choosePractice(state, reservation, minute) {
  const scheduled = reservation.dayAbs * 1440 + reservation.minute;
  const available = scheduled - minute;
  if (available < 8) return null;
  const day = state.golfDay;
  const members = reservation.party?.members || [];
  const averageSkill = members.reduce((sum, member) => {
    const persistent = existingGolfer(state, member.name);
    return sum + Number(persistent?.skill ?? (12 + stableHash(member.name) % 14));
  }, 0) / Math.max(1, members.length);
  const personas = new Set(members.map((member) => existingGolfer(state, member.name)?.persona).filter(Boolean));
  const preferred = averageSkill >= 19
    ? ['range', 'chipping', 'putting']
    : personas.has('pace') || averageSkill <= 10
      ? ['putting', 'chipping', 'range']
      : ['chipping', 'range', 'putting'];
  const start = stableHash(reservation.id, reservation.partySize, Math.round(averageSkill)) % preferred.length;
  for (let offset = 0; offset < preferred.length; offset++) {
    const kind = preferred[(start + offset) % preferred.length];
    if (kind === 'range' && day.practice.range.bucketsAvailable <= 0) continue;
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
  day.practice.range.bucketsInUse = (day.practice.range.bucketsInUse || [])
    .filter((entry) => entry.partyId !== partyId);
  day.practice.range.bucketsAvailable = Math.max(0, 8 - day.practice.range.bucketsInUse.length);
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
    return {
      holeId: routeHole.id,
      number: index + 1,
      par: holePar(hole),
      teeSet: 'club',
      scores: [],
      penalties: [],
      complete: false,
      startedMinute: null,
      completedMinute: null,
      durationMinutes: null,
      paceTargetMinutes: round1(holePar(hole) * 3.4 + 3),
      condition: null,
    };
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
  const reusedPartyShell = day.partyPool.length > 0;
  const party = day.partyPool.pop() || {};
  if (Object.keys(party).length) {
    for (const key of Object.keys(party)) delete party[key];
  }
  if (reusedPartyShell) day.metrics.partyPoolReuses++;
  Object.assign(party, {
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
    requestedTransport: transportRequested,
    transport: transportRequested,
    cartId: null,
    cartLoaded: transportRequested !== 'ride',
    cartReturned: false,
    practiceKind: null,
    practiceMinutes: 0,
    practiceSession: null,
    weatherHoldApplied: false,
    maintenanceBriefingApplied: false,
    holeIndex: 0,
    currentGolferIndex: 0,
    position: { ...facilities.clubhouse },
    destination: null,
    route: null,
    routeStartedMinute: null,
    routeEndsMinute: null,
    routeTransport: null,
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
      scheduledIntervalMinutes: STARTER_GAP_MIN,
      actualStartDelayMinutes: 0,
      distanceAheadYd: null,
      distanceBehindYd: null,
      searchMinutes: 0,
      maintenanceDelayMinutes: 0,
      weatherDelayMinutes: 0,
      holeTimes: [],
      waitReasons: {},
      congestion: CONGESTION.CLEAR,
      rawBehindMinutes: 0,
      interventionCreditMinutes: 0,
      paceBoostUntilMinute: null,
    },
    observations: {
      safetyWaits: 0,
      waterAvoided: 0,
      bunkerShots: 0,
      fairwaysFound: 0,
      greensReached: 0,
      marshalVisits: 0,
      cartCondition: null,
      cartUnavailable: false,
      checkInMinutes: 0,
      startDelayMinutes: 0,
      greenQuality: null,
      bunkerQuality: null,
      roughDifficulty: null,
      designRating: null,
      sceneryRating: null,
      practiceShots: 0,
      practicePuttsHoled: 0,
      practiceBallPickups: 0,
    },
    satisfactionDelta: 0,
    reviewId: null,
    summaryPosted: false,
    recoveryCount: 0,
    experience: null,
    scorecardMeta: {
      teeSet: 'club',
      startMinute: null,
      finishMinute: null,
      returnedMinute: null,
      transport: transportRequested,
      courseCondition: null,
    },
  });

  if (transportRequested === 'ride') {
    const cart = assignCart(day, id, facilities.cartBarn, reservation.party.members.length);
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
  party.observations.checkInMinutes = round1(Math.max(0,
    Number(reservation.checkIn?.checkedInAtMinute ?? minute)
      - Number(reservation.arrival?.arrivedAtMinute ?? reservation.checkIn?.checkedInAtMinute ?? minute)));
  party.observations.designRating = round1(clubRatings(state).design);
  party.observations.sceneryRating = round1(clubRatings(state).design * 0.75 + clubRatings(state).condition * 0.25);
  party.pace.expectedMinutes = party.scorecard.reduce((sum, hole) => sum + hole.par * 3.4 + 3, 0);
  day.parties.push(party);
  reservation.courseAccess.departurePlannedAtMinute = null;
  day.metrics.created++;
  day.metrics.peakActive = Math.max(day.metrics.peakActive, day.parties.length);
  emit(state, party, 'round-created', minute, {
    partySize: party.golfers.length,
    transport: party.transport,
    cartId: party.cartId,
    cartTier: party.cartId ? day.carts.find((cart) => cart.id === party.cartId)?.tierId || null : null,
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

function practiceTargetFor(state, party) {
  const facilities = state.golfDay.routeNetwork.facilities;
  if (party.practiceKind === 'range') return facilities.range.target;
  if (party.practiceKind === 'putting') return facilities.putting.center;
  const start = party.position;
  const toward = facilities.range.target;
  const dx = toward.x - start.x;
  const dz = toward.z - start.z;
  const distance = Math.hypot(dx, dz) || 1;
  return { x: start.x + (dx / distance) * 24, z: start.z + (dz / distance) * 24 };
}

function startPracticeSession(state, party, minute, durationMinutes) {
  const plannedShots = party.practiceKind === 'range' ? 6 : party.practiceKind === 'putting' ? 4 : 4;
  const session = {
    kind: party.practiceKind,
    startedMinute: round2(minute),
    endsMinute: round2(Math.min(minute + durationMinutes, party.scheduledMinute - 1.5)),
    plannedShots,
    shotsStarted: 0,
    shotsCompleted: 0,
    puttsHoled: 0,
    ballPickups: 0,
    activeGolferId: null,
    bucketId: null,
    calledBack: false,
    warmupComplete: false,
  };
  if (party.practiceKind === 'range') {
    const range = state.golfDay.practice.range;
    if (range.bucketsAvailable > 0) {
      session.bucketId = `range-bucket:${party.id}`;
      range.bucketsInUse.push({ id: session.bucketId, partyId: party.id, balls: plannedShots });
      range.bucketsAvailable--;
    }
  }
  party.practiceSession = session;
  party.nextActionMinute = round2(minute + 0.35);
  return session;
}

function finishPracticeSession(state, party, minute, reason = 'sequence-complete') {
  const session = party.practiceSession;
  for (const golfer of party.golfers) {
    releaseBall(state, golfer);
    golfer.currentShot = null;
    golfer.currentTarget = null;
    golfer.animation = reason === 'starter-call' ? 'starter-called' : 'waiting';
  }
  if (session) {
    party.observations.practiceShots += session.shotsCompleted;
    party.observations.practicePuttsHoled += session.puttsHoled;
    party.observations.practiceBallPickups += session.ballPickups;
  }
  emit(state, party, 'practice-complete', minute, {
    practice: party.practiceKind,
    reason,
    shots: session?.shotsCompleted || 0,
    puttsHoled: session?.puttsHoled || 0,
    pickups: session?.ballPickups || 0,
  });
  removePracticeOccupant(state.golfDay, party.id);
  queueForStarter(state, party, minute);
}

function processPractice(state, party, minute) {
  const session = party.practiceSession;
  if (!session) {
    startPracticeSession(state, party, minute, party.practiceMinutes || 3);
    return;
  }
  if (!session.warmupComplete) {
    session.warmupComplete = true;
    for (const golfer of party.golfers) golfer.animation = 'practice-swing';
    party.nextActionMinute = round2(minute + 0.45);
    emit(state, party, 'practice-warmup-swing', minute, { practice: party.practiceKind });
    return;
  }
  const teeCutoff = party.scheduledMinute - 1.5;
  if (minute >= teeCutoff || minute >= session.endsMinute) {
    session.calledBack = minute >= teeCutoff;
    finishPracticeSession(state, party, minute, session.calledBack ? 'starter-call' : 'time-window');
    return;
  }

  const active = session.activeGolferId == null
    ? null
    : party.golfers.find((golfer) => golfer.id === session.activeGolferId);
  if (active?.currentShot) {
    const shot = active.currentShot;
    releaseBall(state, active);
    active.currentShot = null;
    active.currentTarget = null;
    active.animation = shot.holed ? 'celebrate' : shot.type === 'putt' ? 'pickup-ball' : 'watching-ball';
    session.activeGolferId = null;
    session.shotsCompleted++;
    if (shot.type === 'putt') {
      if (shot.holed) session.puttsHoled++;
      session.ballPickups++;
      emit(state, party, 'practice-ball-picked-up', minute, { golferId: active.id });
    }
    emit(state, party, 'practice-shot-complete', minute, {
      golferId: active.id,
      practice: party.practiceKind,
      shot: shot.type,
      holed: shot.holed,
    });
    if (session.shotsCompleted >= session.plannedShots) {
      finishPracticeSession(state, party, minute, 'sequence-complete');
    } else party.nextActionMinute = round2(minute + PRACTICE_SHOT_GAP_MIN);
    return;
  }

  const golfer = party.golfers[session.shotsStarted % party.golfers.length];
  const target = practiceTargetFor(state, party);
  const forcedShotType = party.practiceKind === 'putting' ? 'putt'
    : party.practiceKind === 'chipping' ? 'chip'
      : session.shotsStarted % 3 === 0 ? 'driver' : 'iron';
  const shot = planGolfShot({
    course: state.course,
    partyId: `${party.id}:practice`,
    golfer,
    holeIndex: -1,
    shotNumber: session.shotsStarted + 1,
    start: party.position,
    target,
    startMinute: minute,
    context: {
      seed: state.seed,
      courseCondition: party.conditionRating,
      greenQuality: party.courseSnapshot.greensHealth / 100,
      greenSpeed: party.courseSnapshot.greensSpeed,
      windMph: state.weather?.today?.windMph || 0,
      forcedShotType,
      allowPracticeSurface: true,
      practice: true,
    },
  });
  const ball = acquireBall(state, party, golfer, shot);
  if (!ball) {
    party.nextActionMinute = round2(minute + 0.1);
    return;
  }
  if (party.practiceKind === 'range' && session.bucketId) {
    const bucket = state.golfDay.practice.range.bucketsInUse.find((entry) => entry.id === session.bucketId);
    if (bucket) bucket.balls = Math.max(0, bucket.balls - 1);
  }
  session.activeGolferId = golfer.id;
  session.shotsStarted++;
  golfer.currentTarget = { ...target };
  golfer.equipment.club = shot.club;
  golfer.animation = shot.type === 'putt' ? 'putt' : shot.type === 'chip' ? 'chip' : `${shot.type}-swing`;
  state.golfDay.presentationShots.push({
    id: `${party.id}:practice:${golfer.id}:${session.shotsStarted}`,
    sequence: state.golfDay.nextEventSequence,
    partyId: party.id,
    golferId: golfer.id,
    hole: 0,
    practice: party.practiceKind,
    shot: { ...shot },
  });
  if (state.golfDay.presentationShots.length > 32) {
    state.golfDay.presentationShots.splice(0, state.golfDay.presentationShots.length - 32);
  }
  emit(state, party, 'practice-shot-started', minute, {
    golferId: golfer.id,
    practice: party.practiceKind,
    shot: shot.type,
    bucketId: session.bucketId,
  });
  party.nextActionMinute = round2(shot.endMinute);
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
  for (const golfer of party.golfers) golfer.animation = party.routeTransport === 'ride' ? 'riding' : 'walking';
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

function groupBehind(state, party) {
  return state.golfDay.parties
    .filter((other) => (
      other.id !== party.id
      && other.startedMinute != null
      && other.completedMinute == null
      && party.startedMinute != null
      && (other.startedMinute > party.startedMinute
        || (other.startedMinute === party.startedMinute && other.sequence > party.sequence))
    ))
    .sort((a, b) => a.startedMinute - b.startedMinute)[0] || null;
}

function starterHoldReason(state, party, minute) {
  const last = state.golfDay.starter.lastStartMinute;
  if (last != null && minute - last < STARTER_GAP_MIN) return 'scheduled-tee-interval';
  const ahead = state.golfDay.parties.find((other) => (
    other.id !== party.id && other.startedMinute != null && other.holeIndex === 0
    && ![ROUND_STATE.HOLE_COMPLETE, ROUND_STATE.TRAVELING_NEXT_HOLE].includes(other.state)
  ));
  if (!ahead) return null;
  const tee = currentRouteHole(state, party)?.tee;
  if (!tee) return 'first-tee-route-unavailable';
  return Math.hypot(ahead.position.x - tee.x, ahead.position.z - tee.z) >= SAFE_SHOT_GAP_YD
    ? null : 'first-landing-area-occupied';
}

function safeToStart(state, party, minute) {
  return starterHoldReason(state, party, minute) == null;
}

function hitHoldReason(state, party) {
  const ahead = groupAhead(state, party);
  if (!ahead || ahead.holeIndex > party.holeIndex) return null;
  const golfer = currentGolfer(party);
  if (!golfer) return null;
  const distance = Math.hypot(ahead.position.x - golfer.position.x, ahead.position.z - golfer.position.z);
  if (distance >= SAFE_SHOT_GAP_YD) return null;
  const pin = currentRouteHole(state, party)?.pin;
  const aheadAtGreen = pin && Math.hypot(ahead.position.x - pin.x, ahead.position.z - pin.z) < 45;
  return aheadAtGreen ? 'green-occupied' : 'landing-zone-occupied';
}

function safeToHit(state, party) {
  return hitHoldReason(state, party) == null;
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

function beginRoute(state, party, route, destination, minute, nextState, multiplier = 1, routeTransport = party.transport) {
  party.route = route?.length ? route : [{ ...party.position }, { ...destination }];
  party.destination = { ...destination };
  party.routeStartedMinute = minute;
  party.routeTransport = routeTransport;
  const marshalPaceFactor = Number(party.pace?.paceBoostUntilMinute) > minute ? 0.88 : 1;
  party.routeEndsMinute = round2(minute + routeDuration(party.route, routeTransport, multiplier * marshalPaceFactor));
  setRoundState(state, party, nextState, minute, party.routeEndsMinute - minute);
}

function completeRoute(party) {
  if (party.destination) party.position = { ...party.destination };
  for (const golfer of party.golfers) golfer.animation = 'idle';
  party.route = null;
  party.destination = null;
  party.routeStartedMinute = null;
  party.routeEndsMinute = null;
  party.routeTransport = null;
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
      windMph: state.weather?.today?.windMph || 0,
      avoidPositions: state.golfDay.parties
        .filter((other) => other.id !== party.id && other.holeIndex === party.holeIndex)
        .flatMap((other) => other.golfers.map((entry) => entry.position)),
      minimumSeparationYd: SAFE_SHOT_GAP_YD,
    },
  });
}

function updatePace(state, party, minute) {
  if (party.startedMinute == null) return;
  party.pace.elapsedMinutes = round1(Math.max(0, minute - party.startedMinute));
  const completedTarget = party.scorecard
    .slice(0, party.holeIndex)
    .reduce((sum, row) => sum + Number(row.paceTargetMinutes || 0), 0);
  const current = party.scorecard[party.holeIndex];
  const currentElapsed = current?.startedMinute == null ? 0 : Math.max(0, minute - current.startedMinute);
  const expectedSoFar = completedTarget + Math.min(currentElapsed, Number(current?.paceTargetMinutes || 0));
  party.pace.rawBehindMinutes = round1(Math.max(0, party.pace.elapsedMinutes - expectedSoFar - 4));
  party.pace.behindMinutes = round1(Math.max(
    0,
    party.pace.rawBehindMinutes - Number(party.pace.interventionCreditMinutes || 0),
  ));
  const ahead = groupAhead(state, party);
  const behind = groupBehind(state, party);
  party.pace.distanceAheadYd = ahead?.holeIndex === party.holeIndex
    ? round1(Math.hypot(ahead.position.x - party.position.x, ahead.position.z - party.position.z)) : null;
  party.pace.distanceBehindYd = behind?.holeIndex === party.holeIndex
    ? round1(Math.hypot(behind.position.x - party.position.x, behind.position.z - party.position.z)) : null;
  party.pace.congestion = party.pace.behindMinutes >= 24 ? CONGESTION.GRIDLOCKED
    : party.pace.behindMinutes >= 16 ? CONGESTION.HEAVY
      : party.pace.behindMinutes >= 9 ? CONGESTION.MODERATE
        : party.pace.waitingMinutes >= 3 ? CONGESTION.LIGHT : CONGESTION.CLEAR;
}

function maybeCreateMarshalTask(state, party, minute) {
  const day = state.golfDay;
  if (party.startedMinute == null || party.completedMinute != null) return;
  if (party.pace.waitingMinutes < 5 && party.pace.behindMinutes < 14) return;
  const targetParty = party.pace.waitingMinutes >= 5 ? groupAhead(state, party) || party : party;
  const open = day.marshalTasks.find((task) => task.partyId === targetParty.id && task.status !== 'complete');
  if (open) return;
  const employee = staffByRole(state, ROLE.MARSHAL, { available: true })
    .find((entry) => entry.id === day.marshal.patrolEmployeeId);
  const autoDispatch = Boolean(employee && day.marshal.patrolActive);
  const staffCart = employee ? day.carts.find((cart) => (
    cart.status === 'staff-assigned'
      && cart.assignedStaffId === employee.id
      && cart.batteryPercent >= 10
      && cart.condition >= 20
  )) : null;
  const responseMinutes = (2.5 + targetParty.holeIndex * 0.2) * (staffCart ? 0.68 : 1);
  if (staffCart) {
    staffCart.trips++;
    staffCart.batteryPercent = clamp(staffCart.batteryPercent - 0.8, 0, 100);
    staffCart.condition = clamp(staffCart.condition - 0.04, 0, 100);
  }
  const task = {
    id: `marshal-${day.nextMarshalTaskId++}`,
    partyId: targetParty.id,
    reportingPartyId: party.id,
    hole: targetParty.holeIndex + 1,
    createdMinute: round2(minute),
    dispatchedMinute: autoDispatch ? round2(minute) : null,
    dueMinute: autoDispatch ? round2(minute + responseMinutes) : null,
    completedMinute: null,
    status: autoDispatch ? 'enroute' : 'alert',
    assignedTo: autoDispatch ? employee.id : null,
    cartId: autoDispatch ? staffCart?.id || null : null,
    action: 'pace-reminder',
    reason: targetParty.pace.behindMinutes >= 14 ? 'pace-behind' : 'course-congestion',
  };
  day.marshalTasks.push(task);
  emit(state, targetParty, autoDispatch ? 'marshal-dispatched' : 'pace-alert', minute, {
    taskId: task.id,
    reason: task.reason,
    assignedTo: task.assignedTo,
  });
}

function resolveMarshalTasks(state, minute) {
  for (const task of state.golfDay.marshalTasks) {
    if (task.status !== 'enroute' || minute < Number(task.dueMinute)) continue;
    const party = state.golfDay.parties.find((entry) => entry.id === task.partyId);
    task.status = 'complete';
    task.completedMinute = round2(task.dueMinute);
    if (party) {
      party.observations.marshalVisits++;
      const improvement = task.action === 'clear-cart-path' ? 4 : task.action === 'assist-lost-group' ? 3.5 : 3;
      party.pace.interventionCreditMinutes = round1(
        Number(party.pace.interventionCreditMinutes || 0) + improvement,
      );
      party.pace.paceBoostUntilMinute = round2(task.dueMinute + 25);
      state.golfDay.marshal.interventions++;
      emit(state, party, 'marshal-visit-complete', task.dueMinute, {
        taskId: task.id,
        action: task.action,
        improvementMinutes: improvement,
      });
    }
  }
  if (state.golfDay.marshalTasks.length > 100) state.golfDay.marshalTasks.splice(0, state.golfDay.marshalTasks.length - 100);
}

export function dispatchMarshalTask(state, taskId, options = {}) {
  const day = ensureGolfDay(state);
  const task = day.marshalTasks.find((entry) => entry.id === taskId);
  if (!task) return { ok: false, reason: 'Pace alert no longer exists.' };
  if (task.status !== 'alert') return { ok: false, reason: 'That response is already underway or complete.' };
  const minute = Number(options.minute ?? state.clock?.minutes ?? day.lastProcessedMinute ?? 0);
  const employee = options.employeeId == null ? null
    : staffByRole(state, ROLE.MARSHAL, { available: true }).find((entry) => entry.id === options.employeeId);
  if (options.employeeId != null && !employee) return { ok: false, reason: 'That marshal is not available.' };
  const staffCart = employee ? day.carts.find((cart) => (
    cart.status === 'staff-assigned'
      && cart.assignedStaffId === employee.id
      && cart.batteryPercent >= 10
      && cart.condition >= 20
  )) : null;
  task.status = 'enroute';
  task.assignedTo = employee?.id ?? 'player';
  task.cartId = staffCart?.id || null;
  task.action = options.action || 'pace-reminder';
  task.dispatchedMinute = round2(minute);
  const responseMinutes = task.action === 'clear-cart-path' ? 1.5 : 2.5 + task.hole * 0.2;
  task.dueMinute = round2(minute + responseMinutes * (staffCart ? 0.68 : 1));
  if (staffCart) {
    staffCart.trips++;
    staffCart.batteryPercent = clamp(staffCart.batteryPercent - 0.8, 0, 100);
    staffCart.condition = clamp(staffCart.condition - 0.04, 0, 100);
  }
  const party = day.parties.find((entry) => entry.id === task.partyId);
  emit(state, party, 'marshal-dispatched', minute, {
    taskId: task.id,
    action: task.action,
    assignedTo: task.assignedTo,
    cartId: task.cartId,
  });
  return { ok: true, task };
}

export function assignMarshalPatrol(state, employeeId, active = true) {
  const day = ensureGolfDay(state);
  if (!active) {
    day.marshal.patrolActive = false;
    day.marshal.patrolEmployeeId = null;
    return { ok: true, employee: null };
  }
  const employee = staffByRole(state, ROLE.MARSHAL, { available: true })
    .find((entry) => entry.id === employeeId);
  if (!employee) return { ok: false, reason: 'Hire an available marshal before assigning a patrol.' };
  day.marshal.patrolEmployeeId = employee.id;
  day.marshal.patrolActive = true;
  return { ok: true, employee };
}

function scoreHole(state, party, minute) {
  const row = party.scorecard[party.holeIndex];
  row.scores = party.golfers.map((golfer) => golfer.holeStrokes);
  row.penalties = party.golfers.map((golfer) => golfer.holePenalties || 0);
  row.complete = true;
  row.completedMinute = round2(minute);
  row.durationMinutes = round1(Math.max(0, minute - Number(row.startedMinute ?? minute)));
  row.condition = {
    rating: party.conditionRating,
    greenQuality: party.observations.greenQuality,
    bunkerQuality: party.observations.bunkerQuality,
    roughDifficulty: party.observations.roughDifficulty,
  };
  party.pace.holeTimes[party.holeIndex] = row.durationMinutes;
  for (const golfer of party.golfers) {
    golfer.holes.push(golfer.holeStrokes);
    golfer.penalties.push(golfer.holePenalties || 0);
    golfer.totalStrokes += golfer.holeStrokes;
    golfer.totalPenalties += golfer.holePenalties || 0;
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
    golfer.holePenalties = 0;
    golfer.holed = false;
    golfer.animation = 'idle';
  }
  party.currentGolferIndex = 0;
  party.position = { ...tee };
}

function recordRoundExperience(state, party) {
  if (party.experience) return party.experience;
  const ratings = clubRatings(state);
  const fairFee = fairGreenFee(ratings.overall, amenityScore(state));
  const reservation = reservationById(state, party.reservationId);
  const arrivalMinute = Number(reservation?.arrival?.arrivedAtMinute ?? party.checkedInMinute);
  const arrivalDelta = Math.max(0, arrivalMinute - party.scheduledMinute);
  const fee = Number(reservation?.fee ?? state.club?.greenFee ?? 0);
  const components = {
    arrival: round1(clamp(100 - arrivalDelta * 6, 20, 100)),
    checkIn: round1(clamp(100 - party.observations.checkInMinutes * 7, 25, 100)),
    startPunctuality: round1(clamp(100 - party.pace.actualStartDelayMinutes * 5, 5, 100)),
    pace: round1(clamp(100 - party.pace.waitingMinutes * 4 - party.pace.behindMinutes * 2, 5, 100)),
    courseQuality: round1(clamp(party.conditionRating, 0, 100)),
    courseDesign: round1(clamp(ratings.design, 0, 100)),
    cart: party.requestedTransport === 'ride'
      ? round1(party.observations.cartUnavailable ? 10 : clamp(party.observations.cartCondition, 0, 100))
      : null,
    practice: round1(party.practiceKind ? clamp(72 + party.observations.practiceShots * 3, 72, 94) : 68),
    value: round1(clamp((fairFee / Math.max(1, fee)) * 82, 20, 100)),
    service: round1(clamp(82 - party.observations.checkInMinutes * 3
      + (party.observations.marshalVisits > 0 ? 8 : 0), 25, 100)),
  };
  const weighted = [
    ['arrival', 0.65], ['checkIn', 0.8], ['startPunctuality', 1.1], ['pace', 1.35],
    ['courseQuality', 1.35], ['courseDesign', 0.8], ['practice', 0.45],
    ['value', 0.85], ['service', 0.7], ['cart', 0.6],
  ].filter(([key]) => components[key] != null);
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  const overall = round1(weighted.reduce((sum, [key, weight]) => sum + components[key] * weight, 0) / totalWeight);
  const problemHoles = party.scorecard
    .filter((row) => row.durationMinutes > row.paceTargetMinutes + 3 || Number(row.condition?.rating || 100) < 50)
    .map((row) => row.number);
  const reasons = [];
  if (party.pace.waitingMinutes >= 5) reasons.push('pace-waiting');
  if (party.pace.actualStartDelayMinutes >= 5) reasons.push('late-start');
  if (party.conditionRating < 55) reasons.push('course-condition');
  if (party.observations.cartUnavailable) reasons.push('cart-unavailable');
  if (components.value < 48) reasons.push('value');
  party.experience = {
    overall,
    components,
    problemHoles,
    reasons,
    revenue: {
      greenFeePerPlayer: fee,
      amountPaid: Number(reservation?.payment?.amountPaid || 0),
      paymentStatus: reservation?.payment?.status || null,
    },
    feeds: ['reputation-via-review', 'booking-demand-via-reputation', 'pricing-feedback', 'property-value-via-reputation-and-revenue'],
  };
  party.satisfactionDelta = round1((overall - 60) * 0.12);

  const rollup = state.golfDay.experience;
  rollup.rounds++;
  rollup.ratingTotal = round1(rollup.ratingTotal + overall);
  rollup.paceMinutesTotal = round1(rollup.paceMinutesTotal + party.pace.elapsedMinutes);
  rollup.waitMinutesTotal = round1(rollup.waitMinutesTotal + party.pace.waitingMinutes);
  rollup.averageRating = round1(rollup.ratingTotal / rollup.rounds);
  rollup.averagePaceMinutes = round1(rollup.paceMinutesTotal / rollup.rounds);
  rollup.averageWaitMinutes = round1(rollup.waitMinutesTotal / rollup.rounds);
  rollup.congestion[party.pace.congestion] = (rollup.congestion[party.pace.congestion] || 0) + 1;
  for (const hole of problemHoles) rollup.problemHoles[hole] = (rollup.problemHoles[hole] || 0) + 1;
  if (party.requestedTransport === 'ride') rollup.cartRequests++;
  if (party.observations.cartUnavailable) rollup.cartUnavailable++;
  if (party.conditionRating < 55) rollup.conditionComplaints++;
  for (const golfer of party.golfers) {
    const bucket = golfer.skill <= 9 ? 'lowHandicap' : golfer.skill <= 18 ? 'midHandicap' : 'developing';
    rollup.skillDistribution[bucket]++;
  }
  const recommendations = [];
  if (rollup.averageWaitMinutes >= 5) recommendations.push('Widen tee intervals or assign a marshal patrol.');
  if (rollup.cartUnavailable > 0) recommendations.push('Add or service carts before accepting more ride requests.');
  if (rollup.conditionComplaints > 0) recommendations.push('Prioritize the lowest-condition playing surfaces.');
  if (components.value < 55) recommendations.push(`Review the $${Math.round(fee)} green fee against the $${Math.round(fairFee)} fair-fee estimate.`);
  if (!party.practiceKind) recommendations.push('Increase early-arrival practice capacity and wayfinding.');
  rollup.recommendations = [...new Set(recommendations)].slice(0, 5);
  rollup.lastRoundId = party.id;
  return party.experience;
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
    golfer.satisfaction = clamp(
      golfer.satisfaction + conditionBonus + scoreMood - pacePenalty + party.satisfactionDelta,
      0,
      100,
    );
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
    penalties: [...golfer.penalties],
    totalPenalties: golfer.totalPenalties,
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
    requestedTransport: party.requestedTransport,
    transport: party.transport,
    cartId: party.cartId,
    practiceKind: party.practiceKind,
    par,
    scores,
    pace: { ...party.pace },
    observations: { ...party.observations },
    conditionRating: party.conditionRating,
    reviewId: party.reviewId,
    scorecard: party.scorecard.map((row) => ({
      ...row,
      scores: [...row.scores],
      penalties: [...row.penalties],
      condition: row.condition ? { ...row.condition } : null,
    })),
    scorecardMeta: { ...party.scorecardMeta },
    experience: party.experience ? {
      ...party.experience,
      components: { ...party.experience.components },
      problemHoles: [...party.experience.problemHoles],
      reasons: [...party.experience.reasons],
      revenue: { ...party.experience.revenue },
      feeds: [...party.experience.feeds],
    } : null,
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
    cartRequested: party.requestedTransport === 'ride',
    transport: party.transport,
    cartCondition: party.observations.cartCondition,
    cartUnavailable: party.observations.cartUnavailable,
    marshalVisits: party.observations.marshalVisits,
    checkInMinutes: party.observations.checkInMinutes,
    startDelayMinutes: party.pace.actualStartDelayMinutes,
    greenQuality: party.observations.greenQuality,
    bunkerQuality: party.observations.bunkerQuality,
    roughDifficulty: party.observations.roughDifficulty,
    designRating: party.observations.designRating,
    sceneryRating: party.observations.sceneryRating,
    valueRating: party.experience?.components?.value,
    serviceRating: party.experience?.components?.service,
    overallExperience: party.experience?.overall,
  }, stableHash(state.seed, party.id));
  review.roundId = party.id;
  review.golferId = primary.id;
  review.source = 'completed-round';
  postReview(state, review);
  party.reviewId = `review:${party.id}`;
  state.golfDay.metrics.reviewed++;
  emit(state, party, 'review-generated', minute, { reviewId: party.reviewId, stars: review.stars });
}

function beginCartService(state, party, minute) {
  if (!party.cartId) return;
  const cart = state.golfDay.carts.find((entry) => entry.id === party.cartId);
  if (!cart) return;
  cart.status = 'cleaning';
  cart.assignedPartyId = null;
  cart.assignedStaffId = null;
  cart.position = { ...state.golfDay.routeNetwork.facilities.cartBarn };
  cart.yaw = 0;
  cart.lightsOn = false;
  cart.parkedByPlayer = false;
  cart.lastReturnedMinute = round2(minute);
  cart.serviceReadyMinute = round2(minute + CART_CLEAN_MIN);
  const tier = golfCartTier(cart.tierId);
  cart.batteryPercent = clamp(cart.batteryPercent - (11 + tier.rank * 1.5), 0, 100);
  cart.condition = clamp(cart.condition - (0.28 + tier.rank * 0.04), 0, 100);
  emit(state, party, 'cart-cleaning', minute, {
    cartId: cart.id,
    cartTier: cart.tierId,
    readyMinute: cart.serviceReadyMinute,
  });
}

function updateCartService(state, minute) {
  for (const cart of state.golfDay.carts) {
    if (cart.status === 'cleaning' && minute >= Number(cart.serviceReadyMinute)) {
      cart.status = 'charging';
      // Anchor the next service phase to the moment it was actually observed.
      // A coarse/late tick must not collapse cleaning and charging into one
      // invisible transition.
      cart.serviceReadyMinute = round2(minute + (golfCartTier(cart.tierId).chargeMinutes || CART_CHARGE_MIN));
      emit(state, null, 'cart-charging', minute, {
        cartId: cart.id,
        cartTier: cart.tierId,
        readyMinute: cart.serviceReadyMinute,
      });
    } else if (cart.status === 'charging' && minute >= Number(cart.serviceReadyMinute)) {
      cart.status = 'available';
      cart.serviceReadyMinute = null;
      cart.batteryPercent = 100;
      emit(state, null, 'cart-ready', minute, { cartId: cart.id, cartTier: cart.tierId });
    }
  }
}

function completeRound(state, party, minute) {
  if (party.completedMinute != null) return;
  party.completedMinute = round2(minute);
  updatePace(state, party, minute);
  party.scorecardMeta.finishMinute = party.completedMinute;
  recordRoundExperience(state, party);
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
  updatePace(state, party, minute);
  maybeCreateMarshalTask(state, party, minute);
  const routeHole = currentRouteHole(state, party);

  switch (party.state) {
    case ROUND_STATE.PREPARING: {
      party.courseSnapshot ||= courseAggregates(state);
      party.conditionRating ??= round1(clubRatings(state).condition);
      if (party.transport === 'ride' && !party.cartLoaded) {
        party.cartLoaded = true;
        for (const golfer of party.golfers) golfer.animation = golfer.order === 0 ? 'loading-bag' : 'cart-entry';
        party.nextActionMinute = round2(minute + 0.65);
        emit(state, party, 'cart-loaded', minute, { cartId: party.cartId, bags: party.golfers.length });
        break;
      }
      if (!party.weatherHoldApplied && Number(state.weather?.today?.rainIn || 0) > 0.6) {
        const delay = round1(1.5 + Math.min(2.5, Number(state.weather.today.rainIn)));
        party.weatherHoldApplied = true;
        party.pace.weatherDelayMinutes = round1(party.pace.weatherDelayMinutes + delay);
        party.pace.waitReasons['weather-delay'] = round1((party.pace.waitReasons['weather-delay'] || 0) + delay);
        party.nextActionMinute = round2(minute + delay);
        emit(state, party, 'weather-delay', minute, { durationMinutes: delay, rainIn: state.weather.today.rainIn });
        break;
      }
      const closedHoles = state.course.holes.filter((hole) => hole.status !== 'open').length;
      if (!party.maintenanceBriefingApplied && closedHoles > 0) {
        const delay = round1(Math.min(2, closedHoles * 0.35));
        party.maintenanceBriefingApplied = true;
        party.pace.maintenanceDelayMinutes = round1(party.pace.maintenanceDelayMinutes + delay);
        party.pace.waitReasons['maintenance-closure'] = round1((party.pace.waitReasons['maintenance-closure'] || 0) + delay);
        party.nextActionMinute = round2(minute + delay);
        emit(state, party, 'course-closure-briefing', minute, { durationMinutes: delay, closedHoles });
        break;
      }
      const practice = choosePractice(state, reservationById(state, party.reservationId), minute);
      if (practice) {
        party.practiceKind = practice;
        party.practiceMinutes = Math.min(8, Math.max(3, party.scheduledMinute - minute - 2));
        party.pace.practiceMinutes = party.practiceMinutes;
        addPracticeOccupant(day, practice, party.id);
        const facility = day.routeNetwork.facilities[practice];
        const practiceSpots = facility.bays || facility.positions || [facility.center];
        const practiceIndex = Math.max(0, day.practice[practice].occupants.indexOf(party.id));
        const target = practiceSpots[practiceIndex % practiceSpots.length] || facility.center;
        const route = findCourseRoute(
          state.course,
          gridPoint(state.course, party.position),
          gridPoint(state.course, target),
          party.transport === 'ride' ? 'cart' : 'walk',
          { parkNearGoal: true },
        );
        beginRoute(state, party, route, target, minute, ROUND_STATE.TRAVELING_TO_PRACTICE);
      } else queueForStarter(state, party, minute);
      break;
    }
    case ROUND_STATE.TRAVELING_TO_PRACTICE:
      completeRoute(party);
      for (const golfer of party.golfers) golfer.position = { ...party.position };
      setRoundState(state, party, ROUND_STATE.PRACTICING, minute, 0.35, { practice: party.practiceKind });
      startPracticeSession(state, party, minute, party.practiceMinutes);
      emit(state, party, 'practice-started', minute, { practice: party.practiceKind, durationMinutes: party.practiceMinutes });
      break;
    case ROUND_STATE.PRACTICING:
      processPractice(state, party, minute);
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
        const delay = round1(Math.max(0, minute - party.scheduledMinute));
        const notice = state.course.holes.some((hole) => hole.status !== 'open')
          ? 'Follow today\'s posted hole routing.'
          : Number(state.weather?.today?.windMph || 0) >= 18
            ? 'Strong wind is in play.' : null;
        const message = `${party.partyName}, ${clockLabel(party.scheduledMinute)} tee time, Hole 1. You are up${delay > 0 ? ` after a ${Math.ceil(delay)} minute delay` : ''}.${notice ? ` ${notice}` : ''}`;
        day.starter.announcements.unshift({ minute: round2(minute), partyId: party.id, message });
        if (day.starter.announcements.length > 20) day.starter.announcements.length = 20;
        day.starter.lastAnnouncementMinute = round2(minute);
        day.starter.display = {
          partyName: party.partyName,
          teeTime: clockLabel(party.scheduledMinute),
          hole: 1,
          status: delay > 0 ? 'DELAYED — NOW CALLING' : 'NOW CALLING',
          delayMinutes: delay,
          notice,
          nextUp: party.partyName,
          onDeck: day.starter.queue.length ? day.parties.find((entry) => entry.id === day.starter.queue[0])?.partyName || null : null,
        };
        setRoundState(state, party, ROUND_STATE.CALLED_TO_TEE, minute, 0.45);
        emit(state, party, 'starter-called-party', minute, { message });
      } else {
        if (atTime) {
          party.pace.waitingMinutes = round1(party.pace.waitingMinutes + 0.5);
          const reason = starterHoldReason(state, party, minute) || 'starter-queue';
          party.pace.waitReasons[reason] = round1((party.pace.waitReasons[reason] || 0) + 0.5);
        }
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
        party.pace.actualStartDelayMinutes = round1(Math.max(0, minute - party.scheduledMinute));
        party.observations.startDelayMinutes = party.pace.actualStartDelayMinutes;
        party.scorecardMeta.startMinute = round2(minute);
        party.scorecardMeta.courseCondition = party.conditionRating;
        party.scorecard[0].startedMinute = round2(minute);
        party.observations.greenQuality = party.courseSnapshot.greensHealth;
        party.observations.bunkerQuality = round1(clamp(
          party.conditionRating - party.courseSnapshot.diseasedGreens * 5,
          0,
          100,
        ));
        party.observations.roughDifficulty = round1(clamp(
          (party.courseSnapshot.roughHeightMm - 25) / 65 * 100,
          0,
          100,
        ));
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
        const reason = hitHoldReason(state, party) || 'landing-zone-occupied';
        party.pace.waitReasons[reason] = party.pace.waitReasons[reason] || 0;
        setRoundState(state, party, ROUND_STATE.WAITING_ON_GROUP, minute, 0.65, { reason });
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
      golfer.currentTarget = { ...shot.target };
      golfer.equipment.club = shot.club;
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
      golfer.currentTarget = null;
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
      const searchMinutes = golfer.lie?.kind === 'rough'
        ? round1(clamp((party.courseSnapshot.roughHeightMm - 45) / 55, 0.15, 1.6))
        : 0;
      party.pace.searchMinutes = round1(party.pace.searchMinutes + searchMinutes);
      party.pace.travelMinutes = round1(party.pace.travelMinutes + duration + searchMinutes);
      beginRoute(state, party, route, destination, minute, ROUND_STATE.TRAVELING_TO_BALL);
      if (searchMinutes > 0) {
        party.routeEndsMinute = round2(party.routeEndsMinute + searchMinutes);
        party.nextActionMinute = party.routeEndsMinute;
        emit(state, party, 'ball-search-started', minute, {
          golferId: golfer.id,
          durationMinutes: searchMinutes,
          roughHeightMm: party.courseSnapshot.roughHeightMm,
        });
      }
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
      {
      const waited = Math.max(0, minute - Number(party.lastWaitAccountedMinute ?? party.stateEnteredMinute));
      party.pace.waitingMinutes = round1(party.pace.waitingMinutes + waited);
      const reason = hitHoldReason(state, party) || 'landing-zone-occupied';
      party.pace.waitReasons[reason] = round1((party.pace.waitReasons[reason] || 0) + waited);
      party.lastWaitAccountedMinute = round2(minute);
      if (safeToHit(state, party)) {
        const golfer = currentGolfer(party);
        setRoundState(state, party, golfer?.lie?.kind === 'green' ? ROUND_STATE.PUTTING : ROUND_STATE.PREPARING_SHOT, minute, 0.7);
      } else party.nextActionMinute = round2(minute + 0.65);
      break;
      }
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
      party.scorecard[party.holeIndex].startedMinute = round2(minute);
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
      if (!party.cartReturned) {
        completeRoute(party);
        beginCartService(state, party, minute);
        party.cartReturned = true;
        for (const golfer of party.golfers) golfer.animation = golfer.order === 0 ? 'unloading-bag' : 'cart-exit';
        setRoundState(state, party, ROUND_STATE.RETURNING_CART, minute, 0.7);
        emit(state, party, 'cart-returned', minute, { cartId: party.cartId });
      } else {
        const destination = day.routeNetwork.facilities.clubhouse;
        const walkRoute = findCourseRoute(
          state.course,
          gridPoint(state.course, party.position),
          gridPoint(state.course, destination),
          'walk',
        );
        beginRoute(state, party, walkRoute, destination, minute, ROUND_STATE.RETURNING_SCORECARD, 1, 'walk');
      }
      break;
    case ROUND_STATE.RETURNING_SCORECARD:
      completeRoute(party);
      party.scorecardMeta.returnedMinute ??= round2(minute);
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

function refreshStarterDisplay(state, minute) {
  const starter = state.golfDay.starter;
  if (starter.currentPartyId) return;
  const queue = starter.queue
    .map((id) => state.golfDay.parties.find((party) => party.id === id))
    .filter(Boolean)
    .sort((a, b) => a.scheduledMinute - b.scheduledMinute || a.sequence - b.sequence);
  const next = queue[0];
  if (!next) {
    starter.display = {
      partyName: null,
      teeTime: null,
      hole: 1,
      status: 'TEE OPEN',
      delayMinutes: 0,
      notice: null,
      nextUp: null,
      onDeck: null,
    };
    return;
  }
  const delay = round1(Math.max(0, minute - next.scheduledMinute));
  starter.display = {
    partyName: next.partyName,
    teeTime: clockLabel(next.scheduledMinute),
    hole: 1,
    status: minute >= next.scheduledMinute ? 'NEXT UP — HOLD' : 'ON DECK',
    delayMinutes: delay,
    notice: starterHoldReason(state, next, minute),
    nextUp: next.partyName,
    onDeck: queue[1]?.partyName || null,
  };
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
    level: score >= 10 ? CONGESTION.GRIDLOCKED
      : score >= 7 ? CONGESTION.HEAVY
        : score >= 4 ? CONGESTION.MODERATE
          : score >= 1 ? CONGESTION.LIGHT : CONGESTION.CLEAR,
    score,
    waits,
    holes: congested,
  };
}

function pruneDespawned(state, minute) {
  const removed = state.golfDay.parties.filter((party) => party.state === ROUND_STATE.DESPAWNED);
  const removedIds = new Set(removed.map((party) => party.id));
  for (const task of state.golfDay.marshalTasks) {
    if (task.status === 'complete' || !removedIds.has(task.partyId)) continue;
    task.status = 'complete';
    task.completedMinute = round2(minute);
    task.completionReason = 'party-departed';
  }
  for (const party of removed) {
    removePracticeOccupant(state.golfDay, party.id);
    state.golfDay.starter.queue = state.golfDay.starter.queue.filter((id) => id !== party.id);
  }
  state.golfDay.parties = state.golfDay.parties.filter((party) => party.state !== ROUND_STATE.DESPAWNED);
  for (const party of removed) {
    for (const key of Object.keys(party)) delete party[key];
    if (state.golfDay.partyPool.length < 16) state.golfDay.partyPool.push(party);
  }
}

export function golfDayTick(state, targetMinute = state.clock?.minutes || 0) {
  const day = ensureGolfDay(state);
  const target = Number(targetMinute);
  updateCartService(state, target);
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
  updateCartService(state, target);
  updateBalls(state, target);
  for (const party of day.parties) {
    updateRoutePosition(party, target);
    updatePace(state, party, target);
  }
  updateCongestion(state);
  refreshStarterDisplay(state, target);
  pruneDespawned(state, target);
  day.lastProcessedMinute = Math.max(Number(day.lastProcessedMinute || 0), target);
  return day;
}

export function recoverGolfDay(state) {
  const day = state.golfDay;
  const now = Number(state.clock?.minutes || day.lastProcessedMinute || 0);
  day.presentationShots = [];
  // A save made from the driver's seat resumes with the physical cart parked
  // at its last authored position. Runtime ownership cannot survive a reload,
  // so release only that transient status while preserving position, yaw,
  // battery, wear, and light state.
  for (const cart of day.carts) {
    if (cart.status !== 'player-driving') continue;
    cart.status = 'available';
    cart.assignedPartyId = null;
    cart.assignedStaffId = null;
    cart.parkedByPlayer = true;
  }
  const seenPartyIds = new Set();
  day.parties = day.parties.filter((party) => {
    if (seenPartyIds.has(party.id)) return false;
    seenPartyIds.add(party.id);
    return true;
  });
  const seenCompletedIds = new Set();
  day.completed = day.completed.filter((round) => {
    if (seenCompletedIds.has(round.id)) return false;
    seenCompletedIds.add(round.id);
    return true;
  });
  for (const ball of day.balls) {
    ball.active = false;
    ball.partyId = null;
    ball.golferId = null;
    ball.shot = null;
    ball.position = null;
  }
  for (const facility of Object.values(day.practice)) facility.occupants = [];
  day.practice.range.bucketsInUse = [];
  day.practice.range.bucketsAvailable = 8;
  day.starter.queue = [...new Set(day.starter.queue)].filter((id) => seenPartyIds.has(id));
  const claimedCarts = new Set();
  for (const party of day.parties) {
    for (const golfer of party.golfers) {
      if (party.state !== ROUND_STATE.BALL_IN_PLAY && party.state !== ROUND_STATE.PRACTICING) {
        golfer.ballId = null;
        golfer.currentShot = null;
      }
    }
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
    } else if (party.state === ROUND_STATE.PRACTICING) {
      const active = party.practiceSession?.activeGolferId == null ? null
        : party.golfers.find((golfer) => golfer.id === party.practiceSession.activeGolferId);
      if (active?.currentShot || active?.ballId) {
        active.ballId = null;
        active.currentShot = null;
        active.currentTarget = null;
        active.animation = 'address';
        party.practiceSession.shotsStarted = Math.max(
          party.practiceSession.shotsCompleted,
          party.practiceSession.shotsStarted - 1,
        );
        party.practiceSession.activeGolferId = null;
        party.recoveryCount = (party.recoveryCount || 0) + 1;
        day.metrics.recovered++;
        emit(state, party, 'practice-shot-recovered-after-load', now);
      }
      addPracticeOccupant(day, party.practiceKind, party.id);
      if (party.practiceKind === 'range' && party.practiceSession?.bucketId) {
        day.practice.range.bucketsInUse.push({
          id: party.practiceSession.bucketId,
          partyId: party.id,
          balls: Math.max(0, party.practiceSession.plannedShots - party.practiceSession.shotsCompleted),
        });
        day.practice.range.bucketsAvailable = Math.max(0, day.practice.range.bucketsAvailable - 1);
      }
      party.nextActionMinute = round2(now + 0.2);
    } else if (!Number.isFinite(party.nextActionMinute) || party.nextActionMinute < now - 1440) {
      party.nextActionMinute = now + 0.1;
    }
    const needsCart = party.transport === 'ride' && ![
      ROUND_STATE.RETURNING_SCORECARD, ROUND_STATE.LEAVING_PROPERTY,
      ROUND_STATE.REVIEW_GENERATED, ROUND_STATE.DESPAWNED,
    ].includes(party.state);
    if (needsCart && party.cartId && !claimedCarts.has(party.cartId)) {
      const cart = day.carts.find((entry) => entry.id === party.cartId);
      if (cart && !['cleaning', 'charging'].includes(cart.status)) {
        claimedCarts.add(cart.id);
        cart.status = 'assigned';
        cart.assignedPartyId = party.id;
      } else party.cartId = null;
    }
    if (needsCart && !party.cartId) {
      const unavailableIds = new Set(claimedCarts);
      const reservedStatuses = new Map();
      for (const cart of day.carts) {
        if (!unavailableIds.has(cart.id)) continue;
        reservedStatuses.set(cart.id, cart.status);
        cart.status = 'reserved-after-load';
      }
      const replacement = assignCart(
        day,
        party.id,
        day.routeNetwork.facilities.cartBarn,
        party.golfers?.length || 1,
      );
      for (const [id, status] of reservedStatuses) {
        const reserved = day.carts.find((cart) => cart.id === id);
        if (reserved) reserved.status = status;
      }
      if (replacement) {
        party.cartId = replacement.id;
        claimedCarts.add(replacement.id);
        emit(state, party, 'cart-recovered-after-load', now, { cartId: replacement.id, cartTier: replacement.tierId });
      } else {
        party.transport = 'walk';
        party.observations.cartUnavailable = true;
        emit(state, party, 'cart-fallback-after-load', now);
      }
    }
  }
  for (const cart of day.carts) {
    if (cart.status === 'assigned' && !claimedCarts.has(cart.id)) {
      cart.status = 'available';
      cart.assignedPartyId = null;
    }
  }
  day.starter.queue = day.starter.queue.filter((id) => {
    const party = day.parties.find((entry) => entry.id === id);
    return party && [ROUND_STATE.TRAVELING_TO_STARTER, ROUND_STATE.WAITING_FOR_STARTER].includes(party.state);
  });
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
  const tiers = { near: 0, mid: 0, far: 0 };
  for (const party of day.parties) tiers[party.simulationTier] = (tiers[party.simulationTier] || 0) + 1;
  return {
    activeParties: day.parties.length,
    activeGolfers: day.parties.reduce((sum, party) => sum + party.golfers.length, 0),
    activeBalls: day.balls.filter((ball) => ball.active).length,
    cartsAssigned: day.carts.filter((cart) => cart.status === 'assigned').length,
    starterQueue: [...day.starter.queue],
    practice: Object.fromEntries(Object.entries(day.practice).map(([key, value]) => [key, value.occupants.length])),
    practiceSupply: {
      rangeBucketsAvailable: day.practice.range.bucketsAvailable,
      rangeBucketsInUse: day.practice.range.bucketsInUse.length,
      rangeBallsRemaining: day.practice.range.bucketsInUse.reduce((sum, bucket) => sum + Number(bucket.balls || 0), 0),
    },
    congestion: { ...day.congestion },
    marshalOpen: day.marshalTasks.filter((task) => task.status !== 'complete').length,
    simulationTiers: tiers,
    cartsByStatus: day.carts.reduce((counts, cart) => {
      counts[cart.status] = (counts[cart.status] || 0) + 1;
      return counts;
    }, {}),
    resources: {
      partyPoolActive: day.parties.length,
      partyPoolSpare: day.partyPool.length,
      characterActive: day.parties.reduce((sum, party) => sum + party.golfers.length, 0),
      ballActive: day.balls.filter((ball) => ball.active).length,
      ballCapacity: day.balls.length,
      cartActive: day.carts.filter((cart) => cart.status !== 'available').length,
      cartCapacity: day.carts.length,
      eventCount: day.events.length,
      eventCapacity: EVENT_LIMIT,
      presentationShotCount: day.presentationShots.length,
      presentationShotCapacity: 32,
    },
    performance: day.performance ? { ...day.performance } : null,
    latestCompleted: day.completed[0] || null,
  };
}
