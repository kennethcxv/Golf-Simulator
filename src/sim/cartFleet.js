// Property-scoped customer cart fleet, reservations, and round lifecycle.
//
// The player's utility cart lives in vehicles.js. This module owns the rentable
// fleet: future booking capacity, exact cart assignment, course trips, return
// and key handoff, charging/cleaning/maintenance, and their operating economics.

import { spend } from './economy.js';

export const CART_FLEET_SCHEMA = 1;
export const CART_SEATS = 2;
export const CART_RENTAL_RATE = 18;

export const CART_INFRASTRUCTURE = Object.freeze({
  parking: Object.freeze({ label: 'Fleet parking', maxLevel: 3, costs: [4200, 9000, 18000] }),
  charging: Object.freeze({ label: 'Charging bank', maxLevel: 3, costs: [3600, 7600, 14500] }),
  service: Object.freeze({ label: 'Cart service bay', maxLevel: 3, costs: [5200, 11000, 21000] }),
});

export const CART_TRIP_TIMING = Object.freeze({
  walkToCartMin: 2,
  loadMin: 2,
  driveToHoleMin: 1.5,
  playHoleMin: 6,
  returnMin: 3,
  keyReturnMin: 1,
});

const ACTIVE_TRIP_PHASES = new Set([
  'waiting-cart', 'walk-to-cart', 'loading', 'driving-to-hole',
  'parked-at-hole', 'returning', 'returning-key',
]);
const normalizedFleets = new WeakSet();
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(value)) ? Number(value) : hi));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;

function parkingCapacityFor(level) { return 4 + clamp(level, 0, 3) * 2; }
function overflowCapacityFor(level) { return 2 + Math.floor(clamp(level, 0, 3) / 2); }
function chargerCapacityFor(level) { return 2 + clamp(level, 0, 3) * 2; }
function serviceCapacityFor(level) { return 1 + clamp(level, 0, 3); }

function newCart(id, homeSlot) {
  return {
    id,
    homeSlot,
    status: 'available',
    assignedTripId: null,
    condition: 100,
    cleanliness: 100,
    charge: 100,
    odometerYd: 0,
    rounds: 0,
    lastServiceDay: -1,
  };
}

function newFleet() {
  return {
    schema: CART_FLEET_SCHEMA,
    nextCartId: 5,
    nextTripId: 1,
    rentalRate: CART_RENTAL_RATE,
    infrastructure: { parking: 0, charging: 0, service: 0 },
    carts: [1, 2, 3, 4].map((id) => newCart(`fleet-cart-${id}`, id - 1)),
    trips: [],
    lifetime: { rentals: 0, revenue: 0, unavailable: 0, cartRounds: 0 },
  };
}

export function initCartFleet(state) {
  state.cartFleet = newFleet();
  normalizedFleets.add(state.cartFleet);
  return state.cartFleet;
}

function normalizeCart(raw, fallbackId, homeSlot) {
  const id = String(raw?.id || fallbackId);
  const allowed = new Set(['available', 'assigned', 'on-course', 'parked-at-hole', 'returning', 'charging', 'cleaning', 'maintenance']);
  return {
    ...raw,
    id,
    homeSlot: Math.max(0, integer(raw?.homeSlot, homeSlot)),
    status: allowed.has(raw?.status) ? raw.status : 'available',
    assignedTripId: raw?.assignedTripId == null ? null : String(raw.assignedTripId),
    condition: clamp(raw?.condition, 0, 100),
    cleanliness: clamp(raw?.cleanliness, 0, 100),
    charge: clamp(raw?.charge, 0, 100),
    odometerYd: Math.max(0, finite(raw?.odometerYd, 0)),
    rounds: Math.max(0, integer(raw?.rounds, 0)),
    lastServiceDay: integer(raw?.lastServiceDay, -1),
  };
}

function normalizeTrip(raw) {
  const phase = ACTIVE_TRIP_PHASES.has(raw?.phase) || raw?.phase === 'complete' ? raw.phase : 'complete';
  return {
    ...raw,
    id: String(raw?.id || ''),
    reservationId: raw?.reservationId,
    cartIds: [...new Set(Array.isArray(raw?.cartIds) ? raw.cartIds.map(String) : [])],
    cartsRequested: Math.max(1, integer(raw?.cartsRequested, 1)),
    partySize: Math.max(1, integer(raw?.partySize, 1)),
    holeIds: Array.isArray(raw?.holeIds) ? [...raw.holeIds] : [],
    holeIndex: Math.max(0, integer(raw?.holeIndex, 0)),
    phase,
    startedAt: finite(raw?.startedAt, 0),
    assignedAt: raw?.assignedAt == null ? null : finite(raw.assignedAt, null),
    nextTransitionAt: raw?.nextTransitionAt == null ? null : finite(raw.nextTransitionAt, null),
    equipmentLoaded: raw?.equipmentLoaded === true,
    keyReturned: raw?.keyReturned === true,
    completedAt: raw?.completedAt == null ? null : finite(raw.completedAt, null),
  };
}

export function ensureCartFleet(state) {
  if (!state.cartFleet || typeof state.cartFleet !== 'object') return initCartFleet(state);
  if (state.cartFleet.schema === CART_FLEET_SCHEMA && normalizedFleets.has(state.cartFleet)) {
    return state.cartFleet;
  }
  const source = state.cartFleet;
  const carts = [];
  const ids = new Set();
  for (const raw of Array.isArray(source.carts) ? source.carts : []) {
    const id = String(raw?.id || '').trim();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    carts.push(normalizeCart(raw, id, carts.length));
  }
  if (!carts.length) carts.push(...newFleet().carts);

  const trips = [];
  const tripIds = new Set();
  for (const raw of Array.isArray(source.trips) ? source.trips : []) {
    const trip = normalizeTrip(raw);
    if (!trip.id || tripIds.has(trip.id)) continue;
    tripIds.add(trip.id);
    trip.cartIds = trip.cartIds.filter((id) => ids.has(id));
    trips.push(trip);
  }
  const activeById = new Map(trips.filter((trip) => ACTIVE_TRIP_PHASES.has(trip.phase)).map((trip) => [trip.id, trip]));
  for (const cart of carts) {
    const trip = cart.assignedTripId && activeById.get(cart.assignedTripId);
    if (!trip || !trip.cartIds.includes(cart.id)) {
      cart.assignedTripId = null;
      if (['assigned', 'on-course', 'parked-at-hole', 'returning'].includes(cart.status)) cart.status = readyStatus(cart);
    }
  }

  const infrastructure = source.infrastructure && typeof source.infrastructure === 'object'
    ? source.infrastructure : {};
  state.cartFleet = {
    schema: CART_FLEET_SCHEMA,
    nextCartId: Math.max(integer(source.nextCartId, 1), carts.reduce((max, cart) => {
      const match = cart.id.match(/(\d+)$/);
      return Math.max(max, match ? Number(match[1]) + 1 : 1);
    }, 1)),
    nextTripId: Math.max(integer(source.nextTripId, 1), trips.reduce((max, trip) => {
      const match = trip.id.match(/(\d+)$/);
      return Math.max(max, match ? Number(match[1]) + 1 : 1);
    }, 1)),
    rentalRate: round2(clamp(finite(source.rentalRate, CART_RENTAL_RATE), 0, 200)),
    infrastructure: {
      parking: clamp(integer(infrastructure.parking, 0), 0, CART_INFRASTRUCTURE.parking.maxLevel),
      charging: clamp(integer(infrastructure.charging, 0), 0, CART_INFRASTRUCTURE.charging.maxLevel),
      service: clamp(integer(infrastructure.service, 0), 0, CART_INFRASTRUCTURE.service.maxLevel),
    },
    carts,
    trips,
    lifetime: {
      rentals: Math.max(0, integer(source.lifetime?.rentals, 0)),
      revenue: Math.max(0, finite(source.lifetime?.revenue, 0)),
      unavailable: Math.max(0, integer(source.lifetime?.unavailable, 0)),
      cartRounds: Math.max(0, integer(source.lifetime?.cartRounds, 0)),
    },
  };
  normalizedFleets.add(state.cartFleet);
  return state.cartFleet;
}

function readyStatus(cart) {
  if (cart.condition < 55) return 'maintenance';
  if (cart.cleanliness < 55) return 'cleaning';
  if (cart.charge < 28) return 'charging';
  return 'available';
}

export function cartsRequiredForParty(partySize) {
  return Math.max(1, Math.ceil(Math.max(1, integer(partySize, 1)) / CART_SEATS));
}

export function cartRoundDurationMin(holes = 18) {
  const count = holes === 9 ? 9 : 18;
  return CART_TRIP_TIMING.walkToCartMin + CART_TRIP_TIMING.loadMin
    + count * (CART_TRIP_TIMING.driveToHoleMin + CART_TRIP_TIMING.playHoleMin)
    + CART_TRIP_TIMING.returnMin + CART_TRIP_TIMING.keyReturnMin;
}

export function cartReservationQuote(state, {
  dayAbs,
  minute,
  partySize = 1,
  holes = 18,
  excludeReservationId = null,
} = {}) {
  const fleet = ensureCartFleet(state);
  const requested = cartsRequiredForParty(partySize);
  const start = finite(dayAbs, 0) * 1440 + finite(minute, 0) - 5;
  const end = start + cartRoundDurationMin(holes) + 10;
  let committed = 0;
  for (const reservation of state.reservations?.booked || []) {
    if (reservation.id === excludeReservationId || reservation.status === 'cancelled' || reservation.status === 'noShow') continue;
    if (reservation.transport !== 'cart') continue;
    const otherStart = finite(reservation.dayAbs, 0) * 1440 + finite(reservation.minute, 0) - 5;
    const otherEnd = otherStart + cartRoundDurationMin(reservation.holes) + 10;
    if (start < otherEnd && end > otherStart) {
      committed += Math.max(1, integer(reservation.cartsRequested, cartsRequiredForParty(reservation.groupSize)));
    }
  }
  const serviceable = fleet.carts.filter((cart) => cart.condition >= 40).length;
  const available = Math.max(0, serviceable - committed);
  return {
    requested,
    committed,
    available,
    ok: available >= requested,
    fee: round2(requested * fleet.rentalRate),
    reason: available >= requested
      ? null
      : `Only ${available} rental cart${available === 1 ? '' : 's'} remain for that tee time.`,
  };
}

function reservationById(state, id) {
  return (state.reservations?.booked || []).find((entry) => String(entry.id) === String(id)) || null;
}

function usableCarts(fleet) {
  return fleet.carts.filter((cart) => cart.status === 'available'
    && cart.assignedTripId == null && cart.condition >= 40 && cart.charge >= 20);
}

function tryAssignTrip(state, trip, at) {
  const fleet = ensureCartFleet(state);
  const candidates = usableCarts(fleet)
    .sort((a, b) => b.cleanliness - a.cleanliness || b.condition - a.condition || a.id.localeCompare(b.id));
  if (candidates.length < trip.cartsRequested) return false;
  const chosen = candidates.slice(0, trip.cartsRequested);
  trip.cartIds = chosen.map((cart) => cart.id);
  trip.assignedAt = at;
  trip.phase = 'walk-to-cart';
  trip.nextTransitionAt = at + CART_TRIP_TIMING.walkToCartMin;
  trip.assignmentSnapshot = chosen.map((cart) => ({
    id: cart.id, condition: cart.condition, cleanliness: cart.cleanliness, charge: cart.charge,
  }));
  for (const cart of chosen) {
    cart.assignedTripId = trip.id;
    cart.status = 'assigned';
  }
  const reservation = reservationById(state, trip.reservationId);
  if (reservation?.cartService) {
    reservation.cartService.outcome = 'assigned';
    reservation.cartService.cartIds = [...trip.cartIds];
    reservation.cartService.waitMin = round2(Math.max(0, at - trip.startedAt));
  }
  return true;
}

export function beginCartTrip(state, reservation, { at = state.clock?.minutes ?? 0 } = {}) {
  const fleet = ensureCartFleet(state);
  if (!reservation || reservation.transport !== 'cart') {
    if (reservation) reservation.cartService ??= { requested: false, outcome: 'walking' };
    return { ok: true, assigned: false, walking: true, reservation };
  }
  if (reservation.cartTripId) {
    const existing = fleet.trips.find((trip) => trip.id === reservation.cartTripId);
    if (existing) return { ok: true, already: true, assigned: existing.cartIds.length > 0, trip: existing, reservation };
  }

  const openHoleIds = (state.course?.holes || [])
    .filter((hole) => hole.status === 'open' && hole.tee && hole.pin)
    .map((hole) => hole.id);
  const holesRequested = reservation.holes === 9 ? 9 : 18;
  const holeIds = openHoleIds.length
    ? openHoleIds.slice(0, Math.min(holesRequested, openHoleIds.length))
    : [null];
  const trip = {
    id: `cart-trip-${fleet.nextTripId++}`,
    reservationId: reservation.id,
    partySize: Math.max(1, integer(reservation.groupSize ?? reservation.partySize, 1)),
    cartsRequested: Math.max(1, integer(reservation.cartsRequested, cartsRequiredForParty(reservation.groupSize))),
    cartIds: [],
    holeIds,
    holeIndex: 0,
    phase: 'waiting-cart',
    startedAt: at,
    assignedAt: null,
    nextTransitionAt: at + 1,
    equipmentLoaded: false,
    keyReturned: false,
    completedAt: null,
  };
  fleet.trips.push(trip);
  reservation.cartTripId = trip.id;
  reservation.currentDestination = 'cart-bay';
  reservation.cartService = {
    requested: true,
    cartsRequested: trip.cartsRequested,
    cartIds: [],
    outcome: 'waiting',
    waitMin: 0,
    rentalFee: round2(reservation.cartRentalFee || 0),
    satisfactionDelta: null,
  };
  const assigned = tryAssignTrip(state, trip, at);
  if (!assigned) fleet.lifetime.unavailable += 1;
  return { ok: true, assigned, waiting: !assigned, trip, reservation };
}

function cartsForTrip(fleet, trip) {
  const ids = new Set(trip.cartIds);
  return fleet.carts.filter((cart) => ids.has(cart.id));
}

function updateReservationSatisfaction(state, reservation, trip, carts) {
  const avg = (key, fallback) => carts.length
    ? carts.reduce((sum, cart) => sum + finite(cart[key], fallback), 0) / carts.length : fallback;
  const condition = avg('condition', 50);
  const cleanliness = avg('cleanliness', 50);
  const waitMin = Math.max(0, finite(trip.assignedAt, trip.startedAt) - trip.startedAt);
  const delta = round2(clamp((condition - 72) * 0.08 + (cleanliness - 72) * 0.1 - waitMin * 0.45, -18, 8));
  reservation.cartService = {
    ...(reservation.cartService || {}),
    outcome: 'completed',
    cartIds: [...trip.cartIds],
    waitMin: round2(waitMin),
    condition: round2(condition),
    cleanliness: round2(cleanliness),
    keyReturned: true,
    equipmentLoaded: true,
    holesCompleted: trip.holeIds.length,
    satisfactionDelta: delta,
  };
  reservation.serviceSatisfaction = clamp(finite(reservation.serviceSatisfaction, 65) + delta, 0, 100);
  const names = new Set((reservation.groupMembers || []).map((member) => member.fullName || member.name));
  names.add(reservation.fullName || reservation.name);
  for (const golfer of state.golfers?.pool || []) {
    if (names.has(golfer.name)) golfer.satisfaction = clamp(golfer.satisfaction + delta, 0, 100);
  }
  if (state.club) {
    state.club.reputation = clamp(state.club.reputation + delta * 0.025, 0, 100);
    if (Math.abs(delta) >= 4) {
      state.club.feed ??= [];
      state.club.feed.unshift({
        kind: delta > 0 ? 'cart-praise' : 'cart-complaint',
        day: Math.floor((state.clock?.minutes || 0) / 1440),
        text: delta > 0
          ? `${reservation.fullName || reservation.name} praised the clean, ready cart.`
          : `${reservation.fullName || reservation.name} was disappointed by the cart service.`,
      });
      if (state.club.feed.length > 20) state.club.feed.length = 20;
    }
  }
}

function completeTrip(state, fleet, trip, at) {
  const carts = cartsForTrip(fleet, trip);
  trip.phase = 'complete';
  trip.completedAt = at;
  trip.nextTransitionAt = null;
  trip.keyReturned = true;
  trip.equipmentLoaded = false;
  for (const cart of carts) {
    cart.assignedTripId = null;
    cart.status = readyStatus(cart);
    cart.rounds += 1;
  }
  const reservation = reservationById(state, trip.reservationId);
  if (reservation) {
    reservation.currentDestination = 'departed';
    reservation.roundCompletedAt = at;
    updateReservationSatisfaction(state, reservation, trip, carts);
  }
  fleet.lifetime.rentals += 1;
  fleet.lifetime.revenue = round2(fleet.lifetime.revenue + finite(reservation?.cartRentalFee, 0));
  fleet.lifetime.cartRounds += carts.length;
}

function transitionTrip(state, fleet, trip, at) {
  const carts = cartsForTrip(fleet, trip);
  const reservation = reservationById(state, trip.reservationId);
  if (trip.phase === 'waiting-cart') {
    if (!tryAssignTrip(state, trip, at)) trip.nextTransitionAt = at + 1;
    return;
  }
  if (trip.phase === 'walk-to-cart') {
    trip.phase = 'loading';
    trip.nextTransitionAt = at + CART_TRIP_TIMING.loadMin;
    if (reservation) reservation.currentDestination = 'cart-loading';
    return;
  }
  if (trip.phase === 'loading') {
    trip.phase = 'driving-to-hole';
    trip.equipmentLoaded = true;
    trip.nextTransitionAt = at + CART_TRIP_TIMING.driveToHoleMin;
    for (const cart of carts) cart.status = 'on-course';
    if (reservation) reservation.currentDestination = 'course';
    return;
  }
  if (trip.phase === 'driving-to-hole') {
    trip.phase = 'parked-at-hole';
    trip.nextTransitionAt = at + CART_TRIP_TIMING.playHoleMin;
    for (const cart of carts) cart.status = 'parked-at-hole';
    return;
  }
  if (trip.phase === 'parked-at-hole') {
    for (const cart of carts) {
      cart.charge = Math.max(0, cart.charge - 1.55);
      cart.condition = Math.max(0, cart.condition - 0.16);
      cart.cleanliness = Math.max(0, cart.cleanliness - 0.7);
      cart.odometerYd += 620;
    }
    trip.holeIndex += 1;
    if (trip.holeIndex >= trip.holeIds.length) {
      trip.phase = 'returning';
      trip.nextTransitionAt = at + CART_TRIP_TIMING.returnMin;
      for (const cart of carts) cart.status = 'returning';
      if (reservation) reservation.currentDestination = 'cart-bay';
    } else {
      trip.phase = 'driving-to-hole';
      trip.nextTransitionAt = at + CART_TRIP_TIMING.driveToHoleMin;
      for (const cart of carts) cart.status = 'on-course';
    }
    return;
  }
  if (trip.phase === 'returning') {
    trip.phase = 'returning-key';
    trip.nextTransitionAt = at + CART_TRIP_TIMING.keyReturnMin;
    if (reservation) reservation.currentDestination = 'front-desk';
    return;
  }
  if (trip.phase === 'returning-key') completeTrip(state, fleet, trip, at);
}

export function advanceCartFleet(state, { at = state.clock?.minutes ?? 0 } = {}) {
  const fleet = ensureCartFleet(state);
  for (const trip of fleet.trips) {
    let transitions = 0;
    while (ACTIVE_TRIP_PHASES.has(trip.phase)
      && trip.nextTransitionAt != null && at >= trip.nextTransitionAt && transitions < 80) {
      const transitionAt = trip.nextTransitionAt;
      transitionTrip(state, fleet, trip, transitionAt);
      transitions += 1;
    }
  }
  return fleet;
}

export function fleetDailyTick(state, dayAbs) {
  const fleet = advanceCartFleet(state);
  const chargers = chargerCapacityFor(fleet.infrastructure.charging);
  const serviceBays = serviceCapacityFor(fleet.infrastructure.service);
  const chargeQueue = fleet.carts.filter((cart) => cart.assignedTripId == null && (cart.status === 'charging' || cart.charge < 92));
  const serviceQueue = fleet.carts.filter((cart) => cart.assignedTripId == null
    && (cart.status === 'cleaning' || cart.status === 'maintenance' || cart.cleanliness < 80 || cart.condition < 75));
  let serviceCost = 0;
  for (const cart of chargeQueue.slice(0, chargers)) {
    cart.charge = Math.min(100, cart.charge + 65);
    serviceCost += 5;
  }
  for (const cart of serviceQueue.slice(0, serviceBays)) {
    if (cart.condition < 75) {
      const repaired = Math.min(24, 100 - cart.condition);
      cart.condition += repaired;
      serviceCost += repaired * 4;
    }
    cart.cleanliness = Math.min(100, cart.cleanliness + 55);
    cart.lastServiceDay = dayAbs;
    serviceCost += 12;
  }
  for (const cart of fleet.carts) {
    if (cart.assignedTripId == null) cart.status = readyStatus(cart);
  }
  spend(state, 'rentalFleet', round2(fleet.carts.length * 7 + serviceCost));
  fleet.trips = fleet.trips.filter((trip) => trip.phase !== 'complete' || trip.completedAt == null || trip.completedAt >= (dayAbs - 3) * 1440);
  return fleetSummary(state);
}

export function fleetCapacity(state) {
  const fleet = ensureCartFleet(state);
  const parking = parkingCapacityFor(fleet.infrastructure.parking);
  const overflow = overflowCapacityFor(fleet.infrastructure.parking);
  return {
    parking,
    overflow,
    total: parking + overflow,
    chargers: chargerCapacityFor(fleet.infrastructure.charging),
    serviceBays: serviceCapacityFor(fleet.infrastructure.service),
  };
}

export function fleetSummary(state) {
  const fleet = ensureCartFleet(state);
  const capacity = fleetCapacity(state);
  const counts = {};
  for (const cart of fleet.carts) counts[cart.status] = (counts[cart.status] || 0) + 1;
  const average = (key) => fleet.carts.length
    ? round2(fleet.carts.reduce((sum, cart) => sum + cart[key], 0) / fleet.carts.length) : 0;
  return {
    carts: fleet.carts.length,
    counts,
    capacity,
    overflowUsed: Math.max(0, fleet.carts.length - capacity.parking),
    averageCondition: average('condition'),
    averageCleanliness: average('cleanliness'),
    averageCharge: average('charge'),
    activeTrips: fleet.trips.filter((trip) => ACTIVE_TRIP_PHASES.has(trip.phase)).length,
    rentalRate: fleet.rentalRate,
    lifetime: { ...fleet.lifetime },
  };
}

export function purchaseFleetCart(state) {
  const fleet = ensureCartFleet(state);
  const capacity = fleetCapacity(state);
  if (fleet.carts.length >= capacity.total) return { ok: false, reason: 'Expand fleet parking before buying another cart.' };
  const cost = 4500 + Math.max(0, fleet.carts.length - 4) * 900;
  if (!Number.isFinite(state.cash) || state.cash < cost) return { ok: false, reason: 'Not enough cash.' };
  spend(state, 'rentalFleet', cost);
  const id = `fleet-cart-${fleet.nextCartId++}`;
  const cart = newCart(id, fleet.carts.length);
  fleet.carts.push(cart);
  return { ok: true, cost, cart };
}

export function upgradeFleetInfrastructure(state, kind) {
  const fleet = ensureCartFleet(state);
  const spec = CART_INFRASTRUCTURE[kind];
  if (!spec) return { ok: false, reason: 'Unknown fleet project.' };
  const level = fleet.infrastructure[kind];
  if (level >= spec.maxLevel) return { ok: false, reason: 'Already at its best.' };
  const cost = spec.costs[level];
  if (!Number.isFinite(state.cash) || state.cash < cost) return { ok: false, reason: 'Not enough cash.' };
  spend(state, 'rentalFleet', cost);
  fleet.infrastructure[kind] = level + 1;
  return { ok: true, kind, level: level + 1, cost };
}

export function serviceFleetCart(state, cartId, action) {
  const fleet = ensureCartFleet(state);
  const cart = fleet.carts.find((entry) => entry.id === cartId);
  if (!cart) return { ok: false, reason: 'Cart not found.' };
  if (cart.assignedTripId) return { ok: false, reason: 'That cart is assigned to golfers.' };
  let cost = 0;
  if (action === 'charge') {
    cost = round2((100 - cart.charge) * 0.18);
  } else if (action === 'clean') {
    cost = round2(12 + (100 - cart.cleanliness) * 0.22);
  } else if (action === 'repair') {
    cost = round2((100 - cart.condition) * 8);
  } else return { ok: false, reason: 'Choose charge, clean, or repair.' };
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash.' };
  spend(state, 'rentalFleet', cost);
  if (action === 'charge') cart.charge = 100;
  else if (action === 'clean') cart.cleanliness = 100;
  else cart.condition = 100;
  cart.status = readyStatus(cart);
  return { ok: true, cart, action, cost };
}
