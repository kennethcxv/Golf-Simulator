// CUSTOMER SIMULATION — the serializable, authoritative clubhouse population.
//
// Rendering owns meshes and motion. This module owns who a customer is, why they
// arrived, their one explicit lifecycle state, queue/socket ownership, real stock
// reservations, experience evidence, recovery escalation, and reload policy.
// Nothing in here imports Three.js or the DOM, so lifecycle invariants are testable
// headlessly and saves never contain renderer objects.

import { clamp, rngOf } from '../core/utils.js';
import { genName } from '../data/names.js';
import { RETAIL_CATS, SHOP_CATALOG, skuById } from '../data/shopItems.js';
import { calendarOf } from './time.js';
import { clubRatings } from './club.js';
import { heldUnits, pickFromShelf, returnToShelf } from './checkout.js';
import { priceFor, shopCondition } from './shop.js';

export const CUSTOMER_SIM_VERSION = 1;
export const MAX_ACTIVE_CUSTOMERS = 12;
export const MAX_SERVICE_QUEUE = 6;
export const MAX_CUSTOMER_HISTORY = 80;
export const MAX_TRANSITION_EVENTS = 300;
export const MAX_STATE_HISTORY = 24;

export const CUSTOMER_STATE = Object.freeze({
  SCHEDULED: 'Scheduled',
  AWAITING_ARRIVAL: 'Awaiting arrival',
  APPROACHING_PROPERTY: 'Approaching property',
  EXTERIOR_ARRIVAL: 'Parking or exterior arrival',
  WALKING_TO_ENTRANCE: 'Walking to entrance',
  WAITING_FOR_DOOR: 'Waiting for door',
  ENTERING: 'Entering',
  CHOOSING_ACTIVITY: 'Choosing activity',
  BROWSING: 'Browsing',
  MOVING_TO_DISPLAY: 'Moving to display',
  INSPECTING_PRODUCT: 'Inspecting product',
  SELECTING_PRODUCT: 'Selecting product',
  CARRYING_PRODUCT: 'Carrying product',
  MOVING_TO_QUEUE: 'Moving to queue',
  WAITING_IN_QUEUE: 'Waiting in queue',
  MOVING_TO_REGISTER: 'Moving to register',
  STAGING_PRODUCTS: 'Staging products',
  WAITING_FOR_CASHIER: 'Waiting for cashier',
  PAYING: 'Paying',
  RECEIVING_BAG_AND_RECEIPT: 'Receiving bag and receipt',
  FRONT_DESK_INQUIRY: 'Front-desk inquiry',
  CHECK_IN: 'Check-in',
  LOUNGE_USE: 'Lounge use',
  LEAVING: 'Leaving',
  EXITING: 'Exiting',
  DESPAWNED: 'Despawned',
  RECOVERY: 'Recovery',
});

// D2 (Goal 20): how far ahead somebody standing at the desk asks to tee off.
// Exported because it is the contract the desk, the sheet and the tests all
// have to agree on, and because a lead time buried in an expression is how it
// came to be five hours without anyone noticing.
export const WALK_IN_ASK_MIN = 20;
export const WALK_IN_ASK_MAX = 65;

// A2 (Goal 21) — THE FRONT OF THE LINE NEVER LEAVES.
//
// The owner's worst bug of the night: a customer queues, waits while the player
// serves the person ahead, reaches the front — and walks out before they can be
// served. Whatever the simulation thought it was modelling, what the player
// experiences is being punished for doing the job correctly.
//
// So the first two positions are unconditional. However long it takes, they
// wait. From third place back, patience is real, and that is where the pressure
// the game wants actually lives — it is felt by the people you have not started
// on yet, not by the one you are halfway through serving.
export const QUEUE_NEVER_ABANDON_DEPTH = 2;

/** @param queueIndex 0-based position in the service line; negative = not in it */
export function queuePositionMayAbandon(queueIndex) {
  // Number(null) is 0, and 0 is finite and is the front of the line — so a
  // customer whose position came back null would have been pinned in place for
  // ever, unable to leave the shop. The raw value has to be tested before it is
  // coerced. This is the second time this exact coercion has bitten.
  if (queueIndex === null || queueIndex === undefined || queueIndex === '') return true;
  const index = Number(queueIndex);
  if (!Number.isFinite(index) || index < 0) return true; // not in the line at all
  return index >= QUEUE_NEVER_ABANDON_DEPTH;
}

/**
 * The ask, chosen off a real slot grid. THE SECOND GENERATOR (Goal 20, found by
 * Verifier 1): the arrival planner below is not the only place a walk-in
 * acquires a time. A golfer who spawns on the shop floor gets one from
 * clubhouse.js, which had its own rule — the nearest ten slots ahead, biased
 * toward soon — and on a thirty-minute grid that is FIVE HOURS. Fixing the
 * planner alone left half the walk-ins asking for the afternoon, which is the
 * two-populations fault exactly: the check passed because it only ever measured
 * one of them.
 *
 * Both sites call this now, so there is one rule and one place to change it.
 *
 * @param roll 0..1, the caller's own deterministic draw
 */
export function walkInAskFrom(nowMinute, gridMinutes, roll = 0.5) {
  const grid = (Array.isArray(gridMinutes) ? gridMinutes : []).filter(Number.isFinite);
  if (!grid.length) return null;
  const lo = nowMinute + WALK_IN_ASK_MIN;
  // NO slack past the window. The first draft allowed a grid step of it, on the
  // reasoning that an ask should be able to round up to the next real slot —
  // and that alone put 12:30 back within reach of a 10:58 arrival, 92 minutes,
  // which is the very number Verifier 1 photographed and questioned. The
  // fallback below already covers the case the slack was meant to protect.
  const hi = nowMinute + WALK_IN_ASK_MAX;
  const within = grid.filter((minute) => minute >= lo && minute <= hi);
  // Nothing inside the window (late in the day, or a sparse grid): take the
  // very next slot that exists rather than reaching hours out. Somebody at the
  // desk at ten to six asks about the last light, not tomorrow afternoon.
  const pool = within.length ? within : grid.filter((minute) => minute >= lo).slice(0, 1);
  if (!pool.length) return null;
  const reach = Math.pow(Math.min(0.999999, Math.max(0, roll)), 1.6); // biased toward soon
  return pool[Math.min(pool.length - 1, Math.floor(reach * pool.length))];
}

export const CUSTOMER_INTENT = Object.freeze({
  PRO_SHOP_SHOPPER: 'pro-shop-shopper',
  RESERVATION_CHECK_IN: 'reservation-check-in',
  WALK_IN_TEE_TIME: 'walk-in-tee-time',
  BROWSER: 'browser',
  SPECIFIC_ITEM: 'specific-item',
  LOUNGE_VISITOR: 'lounge-visitor',
});

export const CUSTOMER_OUTCOME = Object.freeze({
  SATISFIED: 'Satisfied',
  NEUTRAL: 'Neutral',
  DISSATISFIED: 'Dissatisfied',
});

export const RECOVERY_ACTION = Object.freeze({
  REPATH: 'repath',
  ALTERNATE_APPROACH: 'alternate-local-approach-slot',
  RELEASE_OPTIONAL: 'release-optional-target',
  SAFE_ANCHOR: 'return-to-safe-anchor',
  EMERGENCY_REPOSITION: 'hidden-emergency-reposition',
});

const RETAIL = SHOP_CATALOG.filter((sku) => RETAIL_CATS.has(sku.cat));
const CHECKOUT_STATES = new Set([
  CUSTOMER_STATE.MOVING_TO_REGISTER,
  CUSTOMER_STATE.STAGING_PRODUCTS,
  CUSTOMER_STATE.WAITING_FOR_CASHIER,
  CUSTOMER_STATE.PAYING,
  CUSTOMER_STATE.RECEIVING_BAG_AND_RECEIPT,
]);
const QUEUE_STATES = new Set([
  CUSTOMER_STATE.MOVING_TO_QUEUE,
  CUSTOMER_STATE.WAITING_IN_QUEUE,
  CUSTOMER_STATE.MOVING_TO_REGISTER,
  CUSTOMER_STATE.STAGING_PRODUCTS,
  CUSTOMER_STATE.WAITING_FOR_CASHIER,
  CUSTOMER_STATE.PAYING,
  CUSTOMER_STATE.FRONT_DESK_INQUIRY,
  CUSTOMER_STATE.CHECK_IN,
]);

const NEXT = new Map([
  [CUSTOMER_STATE.AWAITING_ARRIVAL, new Set([CUSTOMER_STATE.APPROACHING_PROPERTY, CUSTOMER_STATE.DESPAWNED])],
  [CUSTOMER_STATE.APPROACHING_PROPERTY, new Set([CUSTOMER_STATE.EXTERIOR_ARRIVAL, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.EXTERIOR_ARRIVAL, new Set([CUSTOMER_STATE.WALKING_TO_ENTRANCE, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.WALKING_TO_ENTRANCE, new Set([CUSTOMER_STATE.WAITING_FOR_DOOR, CUSTOMER_STATE.ENTERING, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.WAITING_FOR_DOOR, new Set([CUSTOMER_STATE.ENTERING, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.ENTERING, new Set([CUSTOMER_STATE.CHOOSING_ACTIVITY, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.CHOOSING_ACTIVITY, new Set([
    CUSTOMER_STATE.MOVING_TO_DISPLAY,
    CUSTOMER_STATE.MOVING_TO_QUEUE,
    CUSTOMER_STATE.LOUNGE_USE,
    CUSTOMER_STATE.LEAVING,
  ])],
  [CUSTOMER_STATE.MOVING_TO_DISPLAY, new Set([CUSTOMER_STATE.BROWSING, CUSTOMER_STATE.INSPECTING_PRODUCT, CUSTOMER_STATE.CHOOSING_ACTIVITY, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.BROWSING, new Set([CUSTOMER_STATE.INSPECTING_PRODUCT, CUSTOMER_STATE.CHOOSING_ACTIVITY, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.INSPECTING_PRODUCT, new Set([CUSTOMER_STATE.SELECTING_PRODUCT, CUSTOMER_STATE.CHOOSING_ACTIVITY, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.SELECTING_PRODUCT, new Set([CUSTOMER_STATE.CARRYING_PRODUCT, CUSTOMER_STATE.CHOOSING_ACTIVITY, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.CARRYING_PRODUCT, new Set([CUSTOMER_STATE.MOVING_TO_DISPLAY, CUSTOMER_STATE.MOVING_TO_QUEUE, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.MOVING_TO_QUEUE, new Set([CUSTOMER_STATE.WAITING_IN_QUEUE, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.WAITING_IN_QUEUE, new Set([CUSTOMER_STATE.MOVING_TO_REGISTER, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.MOVING_TO_REGISTER, new Set([CUSTOMER_STATE.STAGING_PRODUCTS, CUSTOMER_STATE.FRONT_DESK_INQUIRY, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.STAGING_PRODUCTS, new Set([CUSTOMER_STATE.WAITING_FOR_CASHIER, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.WAITING_FOR_CASHIER, new Set([CUSTOMER_STATE.PAYING, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.PAYING, new Set([CUSTOMER_STATE.RECEIVING_BAG_AND_RECEIPT, CUSTOMER_STATE.WAITING_FOR_CASHIER, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.RECEIVING_BAG_AND_RECEIPT, new Set([CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.FRONT_DESK_INQUIRY, new Set([CUSTOMER_STATE.CHECK_IN, CUSTOMER_STATE.LEAVING])],
  // CHECK_IN may flow into shopping: a combined visit (walk report B6) checks
  // in for the round AND picks up goods before leaving — one guest, two tills.
  [CUSTOMER_STATE.CHECK_IN, new Set([CUSTOMER_STATE.LEAVING, CUSTOMER_STATE.CHOOSING_ACTIVITY])],
  [CUSTOMER_STATE.LOUNGE_USE, new Set([CUSTOMER_STATE.CHOOSING_ACTIVITY, CUSTOMER_STATE.LEAVING])],
  [CUSTOMER_STATE.LEAVING, new Set([CUSTOMER_STATE.EXITING, CUSTOMER_STATE.DESPAWNED])],
  [CUSTOMER_STATE.EXITING, new Set([CUSTOMER_STATE.DESPAWNED])],
  [CUSTOMER_STATE.RECOVERY, new Set(Object.values(CUSTOMER_STATE).filter((state) => state !== CUSTOMER_STATE.SCHEDULED))],
]);

const defaultExperience = (state) => ({
  waitTimeSec: 0,
  queueLengthOnJoin: 0,
  productAvailability: null,
  desiredProductFound: null,
  cleanliness: clamp(shopCondition(state) / 100, 0, 1),
  navigationCongestion: 0,
  checkoutSuccess: null,
  checkInSuccess: null,
  pricing: null,
  storeCondition: clamp(shopCondition(state) / 100, 0, 1),
  courseCondition: null,
  abandonedReason: null,
});

function makeBlock() {
  return {
    version: CUSTOMER_SIM_VERSION,
    nextCustomerId: 1,
    nextArrivalId: 1,
    nextUnitId: 1,
    plannedDays: [],
    scheduled: [],
    active: [],
    history: [],
    serviceQueue: [],
    socketClaims: {},
    transitionEvents: [],
    metrics: {
      spawned: 0,
      completed: 0,
      abandoned: 0,
      noShows: 0,
      recovered: 0,
      emergencyRepositions: 0,
      maxActiveObserved: 0,
      maxQueueObserved: 0,
    },
  };
}

export function initCustomerSimulation(state) {
  if (!state.shop) throw new Error('Customer simulation requires an initialized shop.');
  state.shop.customerSimulation = makeBlock();
  return state.shop.customerSimulation;
}

export function customerSimulationOf(state) {
  if (!state.shop.customerSimulation) initCustomerSimulation(state);
  return state.shop.customerSimulation;
}

function normalizeCustomer(customer, state) {
  customer.state ||= CUSTOMER_STATE.AWAITING_ARRIVAL;
  customer.stateEnteredAt ??= state.clock?.minutes || 0;
  customer.stateHistory = Array.isArray(customer.stateHistory) ? customer.stateHistory.slice(-MAX_STATE_HISTORY) : [];
  customer.cart = Array.isArray(customer.cart) ? customer.cart : [];
  customer.requestedTeeMinute ??= null;
  customer.currentPath = Array.isArray(customer.currentPath) ? customer.currentPath : [];
  customer.position ||= null;
  customer.target ||= null;
  customer.blockedDuration = Number(customer.blockedDuration) || 0;
  customer.totalBlockedDuration = Number(customer.totalBlockedDuration) || 0;
  customer.lastProgressTime ??= customer.stateEnteredAt;
  customer.recoveryAttempts = Number(customer.recoveryAttempts) || 0;
  customer.queueAssignment ||= null;
  customer.browseAssignment ||= null;
  customer.doorAssignment ||= null;
  customer.occupancyAssignment ||= null;
  customer.experience = { ...defaultExperience(state), ...(customer.experience || {}) };
  customer.reasons = Array.isArray(customer.reasons) ? customer.reasons : [];
  customer.transactionRelationship ||= null;
  customer.activityCount = Number(customer.activityCount) || 0;
  customer.maxActivities ??= 1;
  customer.patienceSec ??= 90;
  return customer;
}

export function ensureCustomerSimulation(state) {
  const sim = customerSimulationOf(state);
  const defaults = makeBlock();
  for (const [key, value] of Object.entries(defaults)) {
    if (sim[key] === undefined) sim[key] = value;
  }
  sim.version = CUSTOMER_SIM_VERSION;
  sim.plannedDays = [...new Set(sim.plannedDays || [])].slice(-8);
  sim.scheduled = Array.isArray(sim.scheduled) ? sim.scheduled : [];
  sim.active = Array.isArray(sim.active) ? sim.active.map((customer) => normalizeCustomer(customer, state)) : [];
  sim.history = Array.isArray(sim.history) ? sim.history.slice(-MAX_CUSTOMER_HISTORY) : [];
  sim.serviceQueue = Array.isArray(sim.serviceQueue) ? [...new Set(sim.serviceQueue)] : [];
  sim.socketClaims = sim.socketClaims && typeof sim.socketClaims === 'object' ? sim.socketClaims : {};
  sim.transitionEvents = Array.isArray(sim.transitionEvents) ? sim.transitionEvents.slice(-MAX_TRANSITION_EVENTS) : [];
  sim.metrics = { ...defaults.metrics, ...(sim.metrics || {}) };
  syncQueueAssignments(state);
  return sim;
}

function arrivalIntent(rng) {
  const roll = rng.next();
  if (roll < 0.42) return CUSTOMER_INTENT.PRO_SHOP_SHOPPER;
  if (roll < 0.62) return CUSTOMER_INTENT.BROWSER;
  if (roll < 0.78) return CUSTOMER_INTENT.SPECIFIC_ITEM;
  if (roll < 0.90) return CUSTOMER_INTENT.LOUNGE_VISITOR;
  return CUSTOMER_INTENT.WALK_IN_TEE_TIME;
}

function wantedSku(state, rng) {
  const unlocked = state.shop?.unlockedTier || 1;
  const candidates = RETAIL.filter((sku) => sku.tier <= unlocked);
  return candidates.length ? candidates[rng.int(candidates.length)].id : null;
}

function pushArrival(sim, arrival) {
  sim.scheduled.push({
    id: `arrival-${sim.nextArrivalId++}`,
    status: CUSTOMER_STATE.SCHEDULED,
    partySize: 1,
    noShow: false,
    ...arrival,
  });
}

export function scheduleReservationCustomer(state, reservation, options = {}) {
  const sim = ensureCustomerSimulation(state);
  if (!reservation || reservation.status !== 'booked') return null;
  const existing = sim.scheduled.find((arrival) => (
    arrival.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN
    && arrival.reservationId === reservation.id
    && !['Cancelled', 'No-show'].includes(arrival.status)
  ));
  const rng = options.rng || rngOf(state);
  const dayStart = reservation.dayAbs * 1440;
  const intendedMinute = dayStart + reservation.minute;
  const canonicalPlannedMinute = Number(reservation.arrival?.plannedMinute);
  const fallbackLate = !Number.isFinite(canonicalPlannedMinute)
    && options.arrivalOffsetMin == null
    && rng.chance(options.lateChance ?? 0.12);
  const offset = Number.isFinite(canonicalPlannedMinute)
    ? canonicalPlannedMinute - intendedMinute
    : options.arrivalOffsetMin != null
      ? Number(options.arrivalOffsetMin)
      : fallbackLate ? rng.range(2, 12) : -rng.range(10, 20);
  const descriptor = {
    dayAbs: reservation.dayAbs,
    scheduledMinute: intendedMinute + offset,
    intendedMinute,
    intent: CUSTOMER_INTENT.RESERVATION_CHECK_IN,
    reservationId: reservation.id,
    name: reservation.reservationHolder || reservation.name,
    partyId: reservation.party?.id || `reservation-${reservation.id}`,
    partySize: Math.max(1, Math.min(4, reservation.partySize || 1)),
    noShow: reservation.arrival?.intendedOutcome === 'no-show'
      || (reservation.arrival?.intendedOutcome == null && rng.chance(options.noShowChance ?? 0.07)),
    arrivalOffsetMin: Math.round(offset * 10) / 10,
  };
  if (existing) {
    if (existing.status === CUSTOMER_STATE.SCHEDULED) Object.assign(existing, descriptor);
    return existing;
  }
  pushArrival(sim, descriptor);
  sim.scheduled.sort((a, b) => a.scheduledMinute - b.scheduledMinute || a.id.localeCompare(b.id));
  return sim.scheduled.find((arrival) => arrival.reservationId === reservation.id && arrival.status === CUSTOMER_STATE.SCHEDULED) || null;
}

export function cancelReservationCustomer(state, reservationId) {
  const sim = ensureCustomerSimulation(state);
  let cancelled = 0;
  for (const arrival of sim.scheduled) {
    if (arrival.reservationId === reservationId && [CUSTOMER_STATE.SCHEDULED, 'Released', 'Active'].includes(arrival.status)) {
      arrival.status = 'Cancelled';
      cancelled += 1;
    }
  }
  for (const customer of [...sim.active]) {
    if (customer.reservationId !== reservationId
      || [CUSTOMER_STATE.LEAVING, CUSTOMER_STATE.EXITING, CUSTOMER_STATE.DESPAWNED].includes(customer.state)) continue;
    releaseCustomerProducts(state, customer);
    leaveServiceQueue(state, customer);
    releaseSocket(state, customer);
    transitionCustomer(state, customer, CUSTOMER_STATE.LEAVING, 'reservation cancelled by golf operations', state.clock.minutes, { force: true });
    cancelled += 1;
  }
  return cancelled;
}

export function planCustomerArrivals(state, dayAbs = calendarOf(state.clock.minutes).dayAbs, options = {}) {
  const sim = ensureCustomerSimulation(state);
  if (sim.plannedDays.includes(dayAbs)) return sim.scheduled.filter((arrival) => arrival.dayAbs === dayAbs);
  const rng = options.rng || rngOf(state);
  const dayStart = dayAbs * 1440;
  for (const reservation of state.reservations?.booked || []) {
    if (reservation.dayAbs !== dayAbs || reservation.status !== 'booked') continue;
    scheduleReservationCustomer(state, reservation, { ...options, rng });
  }

  const reputation = clamp(state.club?.reputation ?? 45, 0, 100);
  const capacityPressure = clamp(options.capacityPressure ?? 0, 0, 1);
  const target = options.shopperCount ?? Math.round((14 + reputation * 0.16) * (1 - capacityPressure * 0.45));
  let minute = 360 + rng.range(4, 18);
  let created = 0;
  while (minute < 1200 && created < target) {
    const hour = Math.floor(minute / 60);
    const meanGap = hour < 9 ? 44 : hour < 12 ? 24 : hour < 15 ? 18 : hour < 18 ? 27 : 42;
    const interval = clamp(-Math.log(Math.max(0.0001, 1 - rng.next())) * meanGap, 7, 78);
    minute += interval;
    if (minute >= 1200) break;
    const intent = arrivalIntent(rng);
    // A walk-in golfer arrives WITH a time in mind, the way people do — "have
    // you got anything around 4?" — snapped to the half hour because that is
    // how the ask is phrased, not to what happens to be open. The scheduler
    // (resolveTeeTimeRequest) is what reconciles the ask with the sheet.
    //
    // D2 (Goal 20) — AND THAT TIME IS SOON, BECAUSE THEY ARE STANDING HERE.
    //
    // The lead used to be `45 + rng.int(300)`: up to FIVE HOURS. That is how a
    // clubhouse at 6:46 in the morning ended up full of people asking to tee
    // off at 8:30 — they were not walk-ins in any sense a player could read,
    // they were strangers who had driven to the club to make an advance
    // booking in person and then wait two hours. Somebody who plans that far
    // ahead rings up or emails, which is exactly what C1 made worth doing.
    //
    // A walk-in wants the next hour. Snapped to the half hour, that is the
    // next slot or the one after it, and the bookings correlate with the clock
    // on the wall.
    const requestedTeeMinute = intent === CUSTOMER_INTENT.WALK_IN_TEE_TIME
      ? Math.min(19 * 60, Math.round(
        (minute + WALK_IN_ASK_MIN + rng.int(WALK_IN_ASK_MAX - WALK_IN_ASK_MIN)) / 30,
      ) * 30)
      : null;
    pushArrival(sim, {
      dayAbs,
      scheduledMinute: dayStart + minute,
      intendedMinute: dayStart + minute,
      intent,
      desiredSkuId: intent === CUSTOMER_INTENT.SPECIFIC_ITEM ? wantedSku(state, rng) : null,
      requestedTeeMinute,
      name: genName(rng),
      arrivalOffsetMin: 0,
    });
    created += 1;
  }

  sim.scheduled.sort((a, b) => a.scheduledMinute - b.scheduledMinute || a.id.localeCompare(b.id));
  sim.plannedDays.push(dayAbs);
  sim.plannedDays = sim.plannedDays.slice(-8);
  return sim.scheduled.filter((arrival) => arrival.dayAbs === dayAbs);
}

export function releaseDueArrivals(state, nowMinute = state.clock.minutes, environment = {}) {
  const sim = ensureCustomerSimulation(state);
  const day = calendarOf(nowMinute).dayAbs;
  planCustomerArrivals(state, day, environment);
  const maxActive = environment.maxActive ?? MAX_ACTIVE_CUSTOMERS;
  const activeCount = environment.activeCount ?? sim.active.length;
  const queueLength = environment.queueLength ?? sim.serviceQueue.length;
  const releaseLimit = Number.isFinite(environment.releaseLimit)
    ? Math.max(0, Math.floor(environment.releaseLimit))
    : Infinity;
  let room = Math.max(0, maxActive - activeCount);
  const released = [];
  let reservationWaitingForRoom = false;
  const dueArrivals = sim.scheduled
    .filter((arrival) => arrival.status === CUSTOMER_STATE.SCHEDULED && arrival.scheduledMinute <= nowMinute)
    .sort((a, b) => {
      const reservationPriority = Number(b.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN)
        - Number(a.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN);
      return reservationPriority || a.scheduledMinute - b.scheduledMinute || a.id.localeCompare(b.id);
    });

  for (const arrival of dueArrivals) {
    if (arrival.noShow) {
      arrival.status = 'No-show';
      arrival.resolvedMinute = nowMinute;
      sim.metrics.noShows += 1;
      continue;
    }
    const isScheduled = arrival.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN;
    if (!isScheduled && nowMinute - arrival.scheduledMinute > 90) {
      arrival.status = 'Throttled away';
      arrival.resolvedMinute = nowMinute;
      continue;
    }
    const party = Math.max(1, arrival.partySize || 1);
    if (released.length >= releaseLimit) continue;
    if (party > room) {
      if (isScheduled) reservationWaitingForRoom = true;
      continue;
    }
    if (!isScheduled && reservationWaitingForRoom) continue;
    if (!isScheduled && queueLength >= 4) continue;
    arrival.status = 'Released';
    arrival.releasedMinute = nowMinute;
    released.push(arrival);
    room -= party;
  }
  return released;
}

function makeCustomer(state, arrival, nowMinute, partyIndex = 0) {
  const sim = ensureCustomerSimulation(state);
  const id = `customer-${sim.nextCustomerId++}`;
  const isReservation = arrival.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN;
  // A party arrives together, but only its lead guest owns the booking. The
  // others use the lounge instead of independently charging one reservation.
  const intent = isReservation && partyIndex > 0
    ? CUSTOMER_INTENT.LOUNGE_VISITOR
    : arrival.intent;
  const customer = normalizeCustomer({
    id,
    name: partyIndex === 0 ? arrival.name : `${arrival.name} · guest ${partyIndex + 1}`,
    intent,
    desiredSkuId: arrival.desiredSkuId || null,
    requestedTeeMinute: partyIndex === 0 ? (arrival.requestedTeeMinute ?? null) : null,
    reservationId: arrival.reservationId || null,
    partyId: arrival.partyId || null,
    partyIndex,
    state: CUSTOMER_STATE.AWAITING_ARRIVAL,
    stateEnteredAt: nowMinute,
    stateHistory: [],
    createdAt: nowMinute,
    scheduledMinute: arrival.scheduledMinute,
    intendedMinute: arrival.intendedMinute ?? arrival.scheduledMinute,
    arrivalOffsetMin: arrival.arrivalOffsetMin || 0,
    speed: 1.08 + ((sim.nextCustomerId * 17) % 36) / 100,
    patienceSec: isReservation ? 150 : 80 + ((sim.nextCustomerId * 13) % 45),
    maxActivities: intent === CUSTOMER_INTENT.BROWSER ? 2 : intent === CUSTOMER_INTENT.LOUNGE_VISITOR ? 1 : 2,
    activityCount: 0,
    cart: [],
    payMethod: (sim.nextCustomerId + partyIndex) % 3 === 0 ? 'cash' : 'card',
    position: null,
    target: null,
    currentPath: [],
    pathVersion: 0,
    blockedDuration: 0,
    totalBlockedDuration: 0,
    lastProgressTime: nowMinute,
    recoveryAttempts: 0,
    queueAssignment: null,
    browseAssignment: null,
    doorAssignment: null,
    occupancyAssignment: null,
    transactionRelationship: null,
    experience: defaultExperience(state),
    reasons: [],
    outcome: null,
  }, state);
  sim.active.push(customer);
  sim.metrics.spawned += 1;
  sim.metrics.maxActiveObserved = Math.max(sim.metrics.maxActiveObserved, sim.active.length);
  transitionCustomer(state, customer, CUSTOMER_STATE.APPROACHING_PROPERTY, 'arrival released', nowMinute);
  return customer;
}

export function activateArrival(state, arrivalOrId, nowMinute = state.clock.minutes) {
  const sim = ensureCustomerSimulation(state);
  const arrival = typeof arrivalOrId === 'string'
    ? sim.scheduled.find((entry) => entry.id === arrivalOrId)
    : arrivalOrId;
  if (!arrival || arrival.status !== 'Released') return [];
  if (sim.active.length + (arrival.partySize || 1) > MAX_ACTIVE_CUSTOMERS) return [];
  arrival.status = 'Active';
  arrival.activatedMinute = nowMinute;
  const party = [];
  for (let i = 0; i < Math.max(1, arrival.partySize || 1); i += 1) {
    party.push(makeCustomer(state, arrival, nowMinute, i));
  }
  return party;
}

function reservationArrival(sim, reservationId) {
  return sim.scheduled.find((entry) => (
    entry.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN
    && String(entry.reservationId) === String(reservationId)
    && !['Cancelled', 'No-show', 'Completed'].includes(entry.status)
  )) || null;
}

// Golf operations owns the booking. This adapter only gives that booking one
// physical party in the customer lifecycle, including an immediately-created
// walk-in that needs to appear at the desk without waiting for the next tick.
export function activateReservationCustomer(state, reservation, nowMinute = state.clock.minutes) {
  const sim = ensureCustomerSimulation(state);
  if (!reservation || reservation.status !== 'booked') {
    return { ok: false, reason: 'Only an open booking can create a customer party.', party: [] };
  }
  const active = sim.active.filter((customer) => String(customer.reservationId) === String(reservation.id));
  let arrival = reservationArrival(sim, reservation.id);
  if (active.length) return { ok: true, idempotent: true, arrival, party: active };
  if (!arrival) arrival = scheduleReservationCustomer(state, reservation);
  if (!arrival) return { ok: false, reason: 'No customer arrival exists for that booking.', party: [] };
  if (arrival.status === CUSTOMER_STATE.SCHEDULED) {
    arrival.status = 'Released';
    arrival.releasedMinute = nowMinute;
  }
  if (arrival.status !== 'Released') {
    return { ok: false, reason: `The booking arrival is ${arrival.status}.`, arrival, party: [] };
  }
  const party = activateArrival(state, arrival, nowMinute);
  if (!party.length) return { ok: false, reason: 'The active customer limit prevented this party from spawning.', arrival, party };
  reservation.arrival.spawnedAtMinute ??= Math.floor(nowMinute);
  return { ok: true, arrival, party };
}

// A spontaneous physical walk-in may create a canonical booking while already
// standing at the desk. Claim the scheduled arrival for that person instead of
// spawning a duplicate lead customer or inventing a second reservation model.
export function claimReservationCustomer(state, customerOrId, reservation, nowMinute = state.clock.minutes) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer || !sim.active.includes(customer)) return { ok: false, reason: 'Unknown physical customer.', party: [] };
  if (!reservation || reservation.status !== 'booked') return { ok: false, reason: 'No open booking to claim.', party: [] };
  const alreadyActive = sim.active.filter((entry) => (
    entry !== customer && String(entry.reservationId) === String(reservation.id)
  ));
  if (alreadyActive.length) {
    return { ok: false, reason: 'That booking already has a physical party.', party: alreadyActive };
  }

  let arrival = reservationArrival(sim, reservation.id);
  if (!arrival) arrival = scheduleReservationCustomer(state, reservation);
  if (!arrival || ![CUSTOMER_STATE.SCHEDULED, 'Released', 'Active'].includes(arrival.status)) {
    return { ok: false, reason: 'That booking arrival cannot be claimed.', arrival, party: [] };
  }
  arrival.status = 'Active';
  arrival.releasedMinute ??= nowMinute;
  arrival.activatedMinute ??= nowMinute;
  arrival.claimedCustomerId = customer.id;
  customer.intent = CUSTOMER_INTENT.RESERVATION_CHECK_IN;
  customer.reservationId = reservation.id;
  customer.partyId = reservation.party?.id || `reservation-${reservation.id}`;
  customer.partyIndex = 0;
  customer.name = reservation.reservationHolder || reservation.name || customer.name;
  customer.scheduledMinute = arrival.scheduledMinute;
  customer.intendedMinute = arrival.intendedMinute ?? arrival.scheduledMinute;
  customer.arrivalOffsetMin = arrival.arrivalOffsetMin || 0;

  const party = [customer];
  const targetSize = Math.max(1, Math.min(4, reservation.partySize || 1));
  for (let partyIndex = 1; partyIndex < targetSize && sim.active.length < MAX_ACTIVE_CUSTOMERS; partyIndex += 1) {
    party.push(makeCustomer(state, arrival, nowMinute, partyIndex));
  }
  reservation.arrival.spawnedAtMinute ??= Math.floor(nowMinute);
  return { ok: true, arrival, party };
}

// The front-desk UI performs the authoritative check-in and exact-once money
// work first. Its success callback only advances the matching physical party.
export function completeReservationCustomerParty(state, reservationId, nowMinute = state.clock.minutes) {
  const sim = ensureCustomerSimulation(state);
  const reservation = state.reservations?.booked?.find((entry) => String(entry.id) === String(reservationId));
  if (!reservation || reservation.checkIn?.status !== 'checked-in') {
    return { ok: false, reason: 'Canonical golf-operations check-in has not completed.', completed: 0, party: [] };
  }
  const party = sim.active.filter((customer) => String(customer.reservationId) === String(reservationId));
  let completed = 0;
  for (const customer of party) {
    if ([CUSTOMER_STATE.LEAVING, CUSTOMER_STATE.EXITING, CUSTOMER_STATE.DESPAWNED].includes(customer.state)) continue;
    markCheckInCompleted(state, customer, true, 'canonical golf-operations check-in completed');
    completed += 1;
  }
  for (const arrival of sim.scheduled) {
    if (String(arrival.reservationId) !== String(reservationId)) continue;
    if (!['Cancelled', 'No-show', 'Completed'].includes(arrival.status)) {
      arrival.status = 'Completed';
      arrival.resolvedMinute = nowMinute;
    }
  }
  return { ok: true, completed, party };
}

export function createFixtureCustomer(state, intent = CUSTOMER_INTENT.PRO_SHOP_SHOPPER, options = {}) {
  const sim = ensureCustomerSimulation(state);
  const partySize = Math.max(1, Math.min(4, options.partySize || 1));
  if (!options.ignoreCap && sim.active.length + partySize > MAX_ACTIVE_CUSTOMERS) return null;
  const arrival = {
    id: `fixture-${sim.nextArrivalId++}`,
    status: 'Released',
    scheduledMinute: options.scheduledMinute ?? state.clock.minutes,
    intendedMinute: options.intendedMinute ?? state.clock.minutes,
    intent,
    desiredSkuId: options.desiredSkuId || null,
    reservationId: options.reservationId || null,
    partyId: options.partyId || null,
    partySize,
    name: options.name || genName(options.rng || rngOf(state)),
    arrivalOffsetMin: options.arrivalOffsetMin || 0,
  };
  const party = [];
  for (let i = 0; i < arrival.partySize; i += 1) party.push(makeCustomer(state, arrival, state.clock.minutes, i));
  return party[0] || null;
}

export function customerById(state, customerId) {
  return ensureCustomerSimulation(state).active.find((customer) => customer.id === customerId) || null;
}

export function transitionCustomer(state, customerOrId, nextState, reason = '', atMinute = state.clock.minutes, options = {}) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer || customer.state === nextState) return { ok: false, reason: customer ? 'Already in that state.' : 'Unknown customer.' };
  const allowed = NEXT.get(customer.state);
  const recovery = nextState === CUSTOMER_STATE.RECOVERY;
  const terminal = nextState === CUSTOMER_STATE.DESPAWNED;
  if (!options.force && !recovery && !terminal && (!allowed || !allowed.has(nextState))) {
    return { ok: false, reason: `${customer.state} cannot transition to ${nextState}.` };
  }
  const from = customer.state;
  customer.state = nextState;
  customer.stateEnteredAt = atMinute;
  customer.stateReason = reason;
  const event = { customerId: customer.id, at: atMinute, from, to: nextState, reason };
  customer.stateHistory.push(event);
  if (customer.stateHistory.length > MAX_STATE_HISTORY) customer.stateHistory.shift();
  sim.transitionEvents.push(event);
  if (sim.transitionEvents.length > MAX_TRANSITION_EVENTS) sim.transitionEvents.shift();
  return { ok: true, event };
}

function syncQueueAssignments(state) {
  const sim = state.shop?.customerSimulation;
  if (!sim) return;
  const activeIds = new Set(sim.active.map((customer) => customer.id));
  sim.serviceQueue = [...new Set(sim.serviceQueue)].filter((id) => activeIds.has(id));
  for (const customer of sim.active) customer.queueAssignment = null;
  sim.serviceQueue.forEach((id, index) => {
    const customer = sim.active.find((entry) => entry.id === id);
    if (customer) customer.queueAssignment = { queueId: 'service', position: index };
  });
  sim.metrics.maxQueueObserved = Math.max(sim.metrics.maxQueueObserved || 0, sim.serviceQueue.length);
}

export function joinServiceQueue(state, customerOrId, atMinute = state.clock.minutes) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false, reason: 'Unknown customer.' };
  const existing = sim.serviceQueue.indexOf(customer.id);
  if (existing >= 0) return { ok: true, position: existing, existing: true };
  if (sim.serviceQueue.length >= MAX_SERVICE_QUEUE) return { ok: false, reason: 'The service queue is full.' };
  sim.serviceQueue.push(customer.id);
  customer.queueEnteredAt = atMinute;
  customer.experience.queueLengthOnJoin = sim.serviceQueue.length - 1;
  syncQueueAssignments(state);
  return { ok: true, position: sim.serviceQueue.length - 1 };
}

export function leaveServiceQueue(state, customerOrId, atMinute = state.clock.minutes) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false };
  const index = sim.serviceQueue.indexOf(customer.id);
  if (index < 0) return { ok: false };
  sim.serviceQueue.splice(index, 1);
  customer.queueEnteredAt = null;
  customer.queueAssignment = null;
  syncQueueAssignments(state);
  return { ok: true, previousPosition: index };
}

export function tickCustomerQueueWait(customer, elapsedSeconds) {
  if (!customer?.queueAssignment || elapsedSeconds <= 0) return 0;
  customer.experience.waitTimeSec = Math.max(0, (customer.experience.waitTimeSec || 0) + elapsedSeconds);
  return customer.experience.waitTimeSec;
}

export function serviceQueuePosition(state, customerOrId) {
  const sim = ensureCustomerSimulation(state);
  const id = typeof customerOrId === 'string' ? customerOrId : customerOrId?.id;
  return sim.serviceQueue.indexOf(id);
}

export function claimSocket(state, customerOrId, group, candidateIds) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer || !group || !candidateIds?.length) return null;
  sim.socketClaims[group] ||= {};
  const claims = sim.socketClaims[group];
  for (const [socketId, owner] of Object.entries(claims)) {
    if (owner === customer.id && candidateIds.includes(socketId)) return socketId;
  }
  const offset = Math.abs(Number(customer.id.replace(/\D/g, '')) || 0) % candidateIds.length;
  for (let i = 0; i < candidateIds.length; i += 1) {
    const socketId = candidateIds[(i + offset) % candidateIds.length];
    if (!claims[socketId] || claims[socketId] === customer.id) {
      claims[socketId] = customer.id;
      return socketId;
    }
  }
  return null;
}

export function releaseSocket(state, customerOrId, group = null) {
  const sim = ensureCustomerSimulation(state);
  const id = typeof customerOrId === 'string' ? customerOrId : customerOrId?.id;
  let released = 0;
  for (const [groupId, claims] of Object.entries(sim.socketClaims)) {
    if (group && groupId !== group) continue;
    for (const [socketId, owner] of Object.entries(claims)) {
      if (owner === id) {
        delete claims[socketId];
        released += 1;
      }
    }
  }
  return released;
}

export function reserveCustomerProduct(state, customerOrId, skuId, options = {}) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  const sku = skuById(skuId);
  if (!customer || !sku || !RETAIL_CATS.has(sku.cat)) return { ok: false, reason: 'That is not a retail product.' };
  const uid = options.uid || `customer-unit-${sim.nextUnitId++}`;
  if (heldUnits(state).some((held) => held.uid === uid) || sim.active.some((entry) => entry.cart.some((item) => item.uid === uid))) {
    return { ok: false, reason: 'That unit is already reserved.' };
  }
  const result = pickFromShelf(state, skuId, uid);
  if (!result.ok) {
    customer.experience.productAvailability = 0;
    customer.experience.desiredProductFound = false;
    customer.reasons.push(`wanted ${sku.name}, but it was unavailable`);
    return result;
  }
  const markup = state.shop.markup?.[sku.cat] || 1;
  const item = {
    uid,
    skuId,
    price: options.price ?? priceFor(sku, markup, options.memberTier || null),
    reservedAt: options.atMinute ?? state.clock.minutes,
  };
  customer.cart.push(item);
  customer.experience.productAvailability = 1;
  if (!customer.desiredSkuId || customer.desiredSkuId === skuId) customer.experience.desiredProductFound = true;
  return { ok: true, item };
}

export function releaseCustomerProducts(state, customerOrId) {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return 0;
  let returned = 0;
  for (const item of [...customer.cart]) {
    if (returnToShelf(state, item.skuId, item.uid).ok) returned += 1;
  }
  customer.cart = [];
  return returned;
}

export function markCheckoutStarted(state, customerOrId, transactionId = null) {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false };
  customer.transactionRelationship = { id: transactionId || `checkout-${customer.id}`, status: 'active' };
  customer.experience.checkoutSuccess = null;
  return transitionCustomer(state, customer, CUSTOMER_STATE.PAYING, 'checkout transaction started');
}

export function markCheckoutFailed(state, customerOrId, reason = 'checkout cancelled') {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false };
  customer.experience.checkoutSuccess = 0;
  customer.reasons.push(reason);
  if (customer.transactionRelationship) customer.transactionRelationship.status = 'failed';
  return transitionCustomer(state, customer, CUSTOMER_STATE.WAITING_FOR_CASHIER, reason, state.clock.minutes, { force: true });
}

export function markCheckoutCompleted(state, customerOrId) {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false };
  customer.experience.checkoutSuccess = 1;
  customer.transactionRelationship = {
    ...(customer.transactionRelationship || { id: `checkout-${customer.id}` }),
    status: 'completed',
  };
  customer.cart = [];
  return transitionCustomer(state, customer, CUSTOMER_STATE.RECEIVING_BAG_AND_RECEIPT, 'checkout completion event received', state.clock.minutes, { force: true });
}

/** A walk-in whose ask cannot be met inside the window leaves, saying why. */
export function walkInRequestDeclined(state, customerOrId, reason = '') {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false };
  if (reason) customer.reasons.push(reason);
  customer.experience.checkInSuccess = 0;
  return transitionCustomer(
    state,
    customer,
    CUSTOMER_STATE.LEAVING,
    reason || 'no tee time near their ask',
    state.clock.minutes,
    { force: true },
  );
}

export function markCheckInCompleted(state, customerOrId, ok, reason = '') {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false };
  customer.experience.checkInSuccess = ok ? 1 : 0;
  if (!ok && reason) customer.reasons.push(reason);
  return transitionCustomer(
    state,
    customer,
    ok ? CUSTOMER_STATE.CHECK_IN : CUSTOMER_STATE.FRONT_DESK_INQUIRY,
    reason || (ok ? 'front-desk confirmation received' : 'front-desk request unresolved'),
    state.clock.minutes,
    { force: true },
  );
}

export function noteCustomerProgress(customer, atTime, position = null) {
  customer.blockedDuration = 0;
  customer.lastProgressTime = atTime;
  if (position) customer.position = { x: position.x, z: position.z };
}

export function noteCustomerBlocked(customer, seconds) {
  customer.blockedDuration = Math.max(0, (customer.blockedDuration || 0) + seconds);
  customer.totalBlockedDuration = Math.max(0, (customer.totalBlockedDuration || 0) + seconds);
  customer.experience.navigationCongestion = clamp(customer.totalBlockedDuration / 60, 0, 1);
  return customer.blockedDuration;
}

export function requestCustomerRecovery(state, customerOrId, atTime = state.clock.minutes) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return null;
  if (customer.state !== CUSTOMER_STATE.RECOVERY) customer.recoveryResumeState = customer.state;
  customer.recoveryAttempts += 1;
  const sequence = [
    RECOVERY_ACTION.REPATH,
    RECOVERY_ACTION.ALTERNATE_APPROACH,
    RECOVERY_ACTION.RELEASE_OPTIONAL,
    RECOVERY_ACTION.SAFE_ANCHOR,
    RECOVERY_ACTION.EMERGENCY_REPOSITION,
  ];
  const action = sequence[Math.min(sequence.length - 1, customer.recoveryAttempts - 1)];
  customer.recoveryAction = action;
  customer.blockedDuration = 0;
  transitionCustomer(state, customer, CUSTOMER_STATE.RECOVERY, action, atTime, { force: true });
  sim.metrics.recovered += 1;
  if (action === RECOVERY_ACTION.EMERGENCY_REPOSITION) sim.metrics.emergencyRepositions += 1;
  return action;
}

export function resumeCustomerAfterRecovery(state, customerOrId, atTime = state.clock.minutes) {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer || customer.state !== CUSTOMER_STATE.RECOVERY) return { ok: false };
  const next = customer.recoveryResumeState || CUSTOMER_STATE.CHOOSING_ACTIVITY;
  customer.recoveryResumeState = null;
  customer.recoveryAction = null;
  return transitionCustomer(state, customer, next, 'recovery action completed', atTime, { force: true });
}

function markupScore(state) {
  const values = Object.values(state.shop?.markup || {});
  if (!values.length) return 1;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return clamp(1 - Math.max(0, average - 1) / 0.7, 0, 1);
}

export function evaluateCustomerSatisfaction(state, customerOrId) {
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return null;
  const experience = customer.experience;
  experience.cleanliness = clamp(shopCondition(state) / 100, 0, 1);
  experience.storeCondition = experience.cleanliness;
  experience.pricing = markupScore(state);
  if (customer.intent === CUSTOMER_INTENT.RESERVATION_CHECK_IN || customer.intent === CUSTOMER_INTENT.WALK_IN_TEE_TIME) {
    experience.courseCondition = clamp((clubRatings(state).condition || 0) / 100, 0, 1);
  }
  const factors = [
    { id: 'waitTime', label: 'Wait time', score: clamp(1 - (experience.waitTimeSec || 0) / 180, 0, 1), weight: 1.3 },
    { id: 'cleanliness', label: 'Cleanliness', score: experience.cleanliness, weight: 1 },
    { id: 'navigationCongestion', label: 'Navigation congestion', score: 1 - clamp(experience.navigationCongestion || 0, 0, 1), weight: 0.9 },
    { id: 'pricing', label: 'Pricing', score: experience.pricing, weight: 0.7 },
    { id: 'storeCondition', label: 'Store condition', score: experience.storeCondition, weight: 0.8 },
  ];
  if (experience.productAvailability != null) factors.push({
    id: 'productAvailability', label: 'Product availability', score: experience.productAvailability, weight: 1.2,
  });
  if (experience.checkoutSuccess != null) factors.push({
    id: 'checkoutSuccess', label: 'Checkout success', score: experience.checkoutSuccess, weight: 1.4,
  });
  if (experience.checkInSuccess != null) factors.push({
    id: 'checkInSuccess', label: 'Check-in success', score: experience.checkInSuccess, weight: 1.4,
  });
  if (experience.courseCondition != null) factors.push({
    id: 'courseCondition', label: 'Course condition', score: experience.courseCondition, weight: 1,
  });
  const weight = factors.reduce((sum, factor) => sum + factor.weight, 0) || 1;
  const score = factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / weight;
  const outcome = score >= 0.68
    ? CUSTOMER_OUTCOME.SATISFIED
    : score >= 0.42 ? CUSTOMER_OUTCOME.NEUTRAL : CUSTOMER_OUTCOME.DISSATISFIED;
  const low = factors.filter((factor) => factor.score < 0.5).sort((a, b) => a.score - b.score);
  const high = factors.filter((factor) => factor.score > 0.72).sort((a, b) => b.score - a.score);
  const reasons = [
    ...customer.reasons,
    ...low.slice(0, 3).map((factor) => `${factor.label.toLowerCase()} was poor`),
  ];
  if (!reasons.length && high.length) reasons.push(`${high[0].label.toLowerCase()} was good`);
  customer.outcome = outcome;
  customer.satisfactionScore = Math.round(score * 100);
  customer.satisfactionFactors = factors;
  customer.outcomeReasons = [...new Set(reasons)].slice(0, 5);
  return { outcome, score, factors, reasons: customer.outcomeReasons };
}

export function reviewVisitForCustomer(customer, propertyId = 'club') {
  return {
    reviewId: `${propertyId}:${customer.id}:review`,
    waitedSec: Math.round(customer.experience?.waitTimeSec || 0),
    queueLen: customer.experience?.queueLengthOnJoin || 0,
    bought: customer.experience?.checkoutSuccess === 1,
    played: [CUSTOMER_INTENT.RESERVATION_CHECK_IN, CUSTOMER_INTENT.WALK_IN_TEE_TIME].includes(customer.intent)
      && customer.experience?.checkInSuccess === 1,
    foundWhatTheyWanted: customer.experience?.desiredProductFound !== false,
    cleanliness: customer.experience?.cleanliness,
    storeCondition: customer.experience?.storeCondition,
    productAvailability: customer.experience?.productAvailability,
    pricing: customer.experience?.pricing,
    courseCondition: customer.experience?.courseCondition,
    navigationCongestion: customer.experience?.navigationCongestion || 0,
    checkoutSuccess: customer.experience?.checkoutSuccess,
    checkInSuccess: customer.experience?.checkInSuccess,
    customerOutcome: customer.outcome,
    outcomeReasons: customer.outcomeReasons || [],
  };
}

export function despawnCustomer(state, customerOrId, options = {}) {
  const sim = ensureCustomerSimulation(state);
  const customer = typeof customerOrId === 'string' ? customerById(state, customerOrId) : customerOrId;
  if (!customer) return { ok: false };
  if (customer.cart.length && !options.keepProducts) releaseCustomerProducts(state, customer);
  leaveServiceQueue(state, customer);
  releaseSocket(state, customer);
  evaluateCustomerSatisfaction(state, customer);
  transitionCustomer(state, customer, CUSTOMER_STATE.DESPAWNED, options.reason || 'left property', state.clock.minutes, { force: true });
  const index = sim.active.indexOf(customer);
  if (index >= 0) sim.active.splice(index, 1);
  const archived = {
    id: customer.id,
    name: customer.name,
    intent: customer.intent,
    createdAt: customer.createdAt,
    departedAt: state.clock.minutes,
    outcome: customer.outcome,
    satisfactionScore: customer.satisfactionScore,
    reasons: customer.outcomeReasons,
    recoveryAttempts: customer.recoveryAttempts,
    stateHistory: customer.stateHistory.slice(-MAX_STATE_HISTORY),
  };
  sim.history.push(archived);
  if (sim.history.length > MAX_CUSTOMER_HISTORY) sim.history.shift();
  sim.metrics.completed += 1;
  if (customer.experience.abandonedReason) sim.metrics.abandoned += 1;
  return { ok: true, archived };
}

export function recoverCustomerSimulation(state) {
  const sim = ensureCustomerSimulation(state);
  sim.socketClaims = {};
  const held = heldUnits(state);
  const heldByUid = new Map();
  for (const entry of held) {
    if (!entry?.uid || heldByUid.has(entry.uid)) continue;
    heldByUid.set(entry.uid, entry);
  }
  const claimed = new Set();

  for (const customer of sim.active) {
    customer.cart = customer.cart.filter((item) => {
      if (!item?.uid || claimed.has(item.uid)) return false;
      const heldEntry = heldByUid.get(item.uid);
      if (!heldEntry || heldEntry.skuId !== item.skuId) return false;
      claimed.add(item.uid);
      return true;
    });
  }
  for (const entry of [...held]) {
    if (!claimed.has(entry.uid)) returnToShelf(state, entry.skuId, entry.uid);
  }

  const previousQueue = [...sim.serviceQueue];
  sim.serviceQueue = [];
  const queued = new Set();
  const addQueue = (customer) => {
    if (queued.has(customer.id) || sim.serviceQueue.length >= MAX_SERVICE_QUEUE) return;
    queued.add(customer.id);
    sim.serviceQueue.push(customer.id);
  };
  for (const id of previousQueue) {
    const customer = sim.active.find((entry) => entry.id === id);
    if (customer) addQueue(customer);
  }

  for (const customer of sim.active) {
    customer.currentPath = [];
    customer.target = null;
    customer.blockedDuration = 0;
    customer.lastProgressTime = state.clock.minutes;
    customer.queueAssignment = null;
    customer.browseAssignment = null;
    customer.doorAssignment = null;
    customer.occupancyAssignment = null;
    customer.transactionRelationship = null;

    if (CHECKOUT_STATES.has(customer.state)) {
      if (customer.cart.length) {
        customer.state = CUSTOMER_STATE.WAITING_IN_QUEUE;
        customer.stateReason = 'reload checkpoint: retry checkout without repeating payment';
        addQueue(customer);
      } else {
        customer.state = CUSTOMER_STATE.LEAVING;
        customer.stateReason = 'reload checkpoint: completed goods were already consumed';
      }
    } else if (QUEUE_STATES.has(customer.state)) {
      customer.state = CUSTOMER_STATE.WAITING_IN_QUEUE;
      customer.stateReason = 'reload checkpoint: queue rebuilt';
      addQueue(customer);
    } else if ([
      CUSTOMER_STATE.BROWSING,
      CUSTOMER_STATE.MOVING_TO_DISPLAY,
      CUSTOMER_STATE.INSPECTING_PRODUCT,
      CUSTOMER_STATE.SELECTING_PRODUCT,
      CUSTOMER_STATE.CARRYING_PRODUCT,
      CUSTOMER_STATE.LOUNGE_USE,
    ].includes(customer.state)) {
      customer.state = customer.cart.length ? CUSTOMER_STATE.MOVING_TO_QUEUE : CUSTOMER_STATE.CHOOSING_ACTIVITY;
      customer.stateReason = 'reload checkpoint: optional occupancy released';
    } else if ([CUSTOMER_STATE.EXITING, CUSTOMER_STATE.RECOVERY].includes(customer.state)) {
      customer.state = CUSTOMER_STATE.LEAVING;
      customer.stateReason = 'reload checkpoint: safe exit anchor';
    } else if ([
      CUSTOMER_STATE.APPROACHING_PROPERTY,
      CUSTOMER_STATE.EXTERIOR_ARRIVAL,
      CUSTOMER_STATE.WALKING_TO_ENTRANCE,
      CUSTOMER_STATE.WAITING_FOR_DOOR,
      CUSTOMER_STATE.ENTERING,
    ].includes(customer.state)) {
      customer.state = CUSTOMER_STATE.WALKING_TO_ENTRANCE;
      customer.stateReason = 'reload checkpoint: exterior safe anchor';
    }
  }
  syncQueueAssignments(state);
  return {
    active: sim.active.length,
    queued: sim.serviceQueue.length,
    held: heldUnits(state).length,
    policy: 'checkout retries from queue; optional targets release; exterior and exits restart from safe anchors',
  };
}

export function customerSimulationSummary(state) {
  const sim = ensureCustomerSimulation(state);
  const byState = {};
  const byIntent = {};
  for (const customer of sim.active) {
    byState[customer.state] = (byState[customer.state] || 0) + 1;
    byIntent[customer.intent] = (byIntent[customer.intent] || 0) + 1;
  }
  return {
    active: sim.active.length,
    scheduled: sim.scheduled.filter((arrival) => arrival.status === CUSTOMER_STATE.SCHEDULED).length,
    queue: [...sim.serviceQueue],
    byState,
    byIntent,
    socketClaims: structuredClone(sim.socketClaims),
    metrics: { ...sim.metrics },
    recentTransitions: sim.transitionEvents.slice(-40),
  };
}
