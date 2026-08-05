// Stable, serialization-safe customer identities.
//
// This module deliberately has no dependency on state, reservations, or the
// register.  It can therefore be used by each of those systems without making
// identity generation depend on frame timing or mutation order.

export const CUSTOMER_IDENTITY_VERSION = 1;

export const PAYMENT_PREFERENCES = Object.freeze(['cash', 'card']);
export const CUSTOMER_PERSONALITIES = Object.freeze([
  'friendly',
  'reserved',
  'hurried',
  'chatty',
  'exacting',
  'relaxed',
]);
export const LOUNGE_PREFERENCES = Object.freeze(['lounge', 'shop', 'outside']);

const FIRST_NAMES = Object.freeze([
  'Avery', 'Mara', 'Theo', 'Nina', 'Caleb', 'June', 'Miles', 'Elena',
  'Jonah', 'Iris', 'Graham', 'Tessa', 'Leo', 'Priya', 'Owen', 'Mae',
  'Felix', 'Lena', 'Simon', 'Ada', 'Elliot', 'Clara', 'Nolan', 'Vera',
  'Jasper', 'Maya', 'Arthur', 'Ruby', 'Silas', 'Nora', 'Emmett', 'Cora',
  'Julian', 'Amara', 'Hugo', 'Alice', 'Rowan', 'Freya', 'Isaac', 'Zoe',
  'Dylan', 'Leah', 'Micah', 'Esme', 'Bennett', 'Sofia', 'Reid', 'Lila',
  'Wesley', 'Mina', 'Dean', 'Anya', 'Grant', 'Sadie', 'Cole', 'Rhea',
  'Peter', 'Layla', 'Sam', 'Willa', 'Max', 'Eden', 'Henry', 'Skye',
]);

const LAST_NAMES = Object.freeze([
  'Abbott', 'Bennett', 'Carver', 'Dalton', 'Ellis', 'Falk', 'Garner', 'Hale',
  'Irwin', 'Jordan', 'Keane', 'Lang', 'Mercer', 'Nash', 'Osborne', 'Palmer',
  'Quinn', 'Reeves', 'Sutton', 'Turner', 'Underwood', 'Vale', 'Walker', 'Young',
  'Archer', 'Brooks', 'Clarke', 'Dawson', 'Everett', 'Foster', 'Green', 'Hayes',
  'Ingram', 'James', 'Keller', 'Lawson', 'Morris', 'North', 'Owens', 'Parker',
  'Reed', 'Sawyer', 'Thorne', 'Vance', 'West', 'York', 'Atwood', 'Blake',
  'Cross', 'Dunn', 'Emery', 'Fields', 'Gray', 'Hart', 'Iverson', 'Knox',
  'Lane', 'Moore', 'Price', 'Rhodes', 'Stone', 'Webb', 'Alden', 'Bell',
]);

const NAME_CAPACITY = FIRST_NAMES.length * LAST_NAMES.length;

function seedKey(seed) {
  if (seed === undefined || seed === null || seed === '') return 'default';
  return String(seed);
}

function stableKey(stableId) {
  if (stableId === undefined || stableId === null || stableId === '') return '0';
  return String(stableId);
}

// FNV-1a with Math.imul keeps the hash identical in browsers and Node.
function hash32(value) {
  const input = String(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unit(seed, id, field) {
  return hash32(`${seedKey(seed)}|${stableKey(id)}|${field}`) / 0x100000000;
}

function rounded(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function pick(list, value) {
  return list[Math.min(list.length - 1, Math.floor(value * list.length))];
}

function generatedName(seed, stableId) {
  const isOrdinal = Number.isSafeInteger(stableId) && stableId >= 0;
  const ordinal = isOrdinal ? stableId : hash32(stableKey(stableId));
  const offset = hash32(`${seedKey(seed)}|name-offset`) % NAME_CAPACITY;
  // NAME_CAPACITY is a power of two.  Every odd step is coprime to it, so the
  // first NAME_CAPACITY ordinals form a permutation rather than colliding.
  const step = (hash32(`${seedKey(seed)}|name-step`) % NAME_CAPACITY) | 1;
  const withinCycle = ordinal % NAME_CAPACITY;
  const slot = (offset + withinCycle * step) % NAME_CAPACITY;
  // Registry ordinals receive a suffix after each full permutation.  Arbitrary
  // string source IDs use their hash only as a slot and keep natural names.
  const cycle = isOrdinal ? Math.floor(ordinal / NAME_CAPACITY) : 0;
  const firstName = FIRST_NAMES[slot % FIRST_NAMES.length];
  const baseLastName = LAST_NAMES[Math.floor(slot / FIRST_NAMES.length)];
  const lastName = cycle === 0 ? baseLastName : `${baseLastName}-${cycle + 1}`;
  return { firstName, lastName };
}

function fullName(firstName, lastName) {
  return `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
}

function defaultVisitHistory() {
  return {
    totalVisits: 0,
    completedPurchases: 0,
    completedCheckIns: 0,
    noShows: 0,
    cancellations: 0,
    cashPayments: 0,
    cardPayments: 0,
    lifetimeSpend: 0,
    // L3: the ledger book's "first visit" column. Set once, never rewritten.
    firstVisitDayAbs: null,
    lastVisitDayAbs: null,
    lastVisitPurpose: null,
    lastPaymentMethod: null,
  };
}

/**
 * Return the stable authority ID for one seed/source-ID pair.
 * Unique source IDs under the same seed remain visibly distinct in the output;
 * no probabilistic hash collision can merge them.
 */
export function customerIdFor(seed, sourceId) {
  const seedPart = hash32(seedKey(seed)).toString(36).padStart(7, '0');
  const sourcePart = encodeURIComponent(stableKey(sourceId));
  return `customer_${seedPart}_${sourcePart}`;
}

/**
 * Generate one deterministic customer from a stable seed and source ID.
 * Scores are normalized to 0..1; travelDistance is stored in kilometres.
 */
export function createCustomerIdentity(seed, sourceId = 0) {
  const id = stableKey(sourceId);
  const names = generatedName(seed, sourceId);
  const name = fullName(names.firstName, names.lastName);
  const punctuality = rounded(0.2 + unit(seed, id, 'punctuality') * 0.8);
  const patience = rounded(0.2 + unit(seed, id, 'patience') * 0.8);

  return {
    schemaVersion: CUSTOMER_IDENTITY_VERSION,
    customerId: customerIdFor(seed, sourceId),
    firstName: names.firstName,
    lastName: names.lastName,
    fullName: name,
    displayName: name,
    // `name` is a full-name compatibility alias for legacy consumers.  It is
    // never an abbreviated or independent source of authority.
    name,
    // A neutral coin. Counter payments are governed by the balanced shuffled
    // bag (sim/paymentBag.js); this trait is only a fallback/dialogue flavour.
    paymentPreference: unit(seed, id, 'payment') < 0.5 ? 'cash' : 'card',
    personality: pick(CUSTOMER_PERSONALITIES, unit(seed, id, 'personality')),
    patience,
    punctuality,
    travelDistance: rounded(2 + unit(seed, id, 'travel-distance') * 58, 1),
    parkingSensitivity: rounded(unit(seed, id, 'parking-sensitivity')),
    weatherSensitivity: rounded(unit(seed, id, 'weather-sensitivity')),
    loungePreference: pick(LOUNGE_PREFERENCES, unit(seed, id, 'lounge')),
    visitProfile: {
      typicalArrivalLeadMinutes: Math.round(8 + punctuality * 17),
      usualPartySize: 1 + Math.floor(unit(seed, id, 'party-size') * 4),
      preferredPurpose: unit(seed, id, 'visit-purpose') < 0.58 ? 'tee-time' : 'retail',
    },
    visitHistory: defaultVisitHistory(),
  };
}

/**
 * Build a JSON-safe registry.  Sequential ordinals use a seeded permutation of
 * 4,096 name pairs and a deterministic cycle suffix beyond that, guaranteeing
 * unique IDs and full names for every member of the returned cohort.
 */
export function createCustomerRegistry(seed, count, { startOrdinal = 0 } = {}) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Customer count must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(startOrdinal) || startOrdinal < 0) {
    throw new RangeError('Customer startOrdinal must be a non-negative safe integer.');
  }

  const customers = [];
  for (let index = 0; index < count; index += 1) {
    customers.push(createCustomerIdentity(seed, startOrdinal + index));
  }

  return {
    schemaVersion: CUSTOMER_IDENTITY_VERSION,
    seed: seedKey(seed),
    nextOrdinal: startOrdinal + count,
    customers,
  };
}

/** Initialize the persisted directory that owns every generated visitor record. */
export function initCustomerDirectory(state) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('A game state is required to initialize customer identities.');
  }
  state.customerDirectory = {
    schemaVersion: CUSTOMER_IDENTITY_VERSION,
    seed: seedKey(state.seed),
    nextOrdinal: 0,
    customers: [],
  };
  return state.customerDirectory;
}

function uniqueDirectoryName(directory, identity) {
  const used = new Set(directory.customers.map((customer) => customer.fullName));
  if (!used.has(identity.fullName)) return identity;
  let suffix = 2;
  while (used.has(`${identity.fullName} ${suffix}`)) suffix += 1;
  const lastName = `${identity.lastName} ${suffix}`;
  const name = fullName(identity.firstName, lastName);
  return { ...identity, lastName, fullName: name, displayName: name, name };
}

/**
 * Normalize a loaded directory in place. Old saves gain an empty directory;
 * legacy entries gain complete identities while retaining their authority IDs.
 */
export function ensureCustomerDirectory(state) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('A game state is required to ensure customer identities.');
  }
  if (!state.customerDirectory || typeof state.customerDirectory !== 'object') {
    return initCustomerDirectory(state);
  }
  const directory = state.customerDirectory;
  const seenIds = new Set();
  const seenNames = new Set();
  const alreadyCurrent = directory.schemaVersion === CUSTOMER_IDENTITY_VERSION
    && typeof directory.seed === 'string'
    && directory.seed.length > 0
    && Array.isArray(directory.customers)
    && Number.isSafeInteger(directory.nextOrdinal)
    && directory.nextOrdinal >= 0
    && directory.customers.every((customer) => (
      customer
      && customer.schemaVersion === CUSTOMER_IDENTITY_VERSION
      && typeof customer.customerId === 'string'
      && customer.customerId.trim().length > 0
      && typeof customer.firstName === 'string'
      && customer.firstName.trim().length > 0
      && typeof customer.lastName === 'string'
      && customer.lastName.trim().length > 0
      && typeof customer.fullName === 'string'
      && customer.fullName === fullName(customer.firstName, customer.lastName)
      && customer.displayName === customer.fullName
      && customer.name === customer.fullName
      && customer.visitHistory && typeof customer.visitHistory === 'object'
      && !seenIds.has(customer.customerId)
      && !seenNames.has(customer.fullName.trim().toLowerCase())
      && Boolean(seenIds.add(customer.customerId))
      && Boolean(seenNames.add(customer.fullName.trim().toLowerCase()))
    ));
  if (alreadyCurrent) return directory;
  directory.schemaVersion = CUSTOMER_IDENTITY_VERSION;
  directory.seed = seedKey(directory.seed ?? state.seed);
  directory.nextOrdinal = Number.isSafeInteger(directory.nextOrdinal) && directory.nextOrdinal >= 0
    ? directory.nextOrdinal
    : 0;
  const source = Array.isArray(directory.customers) ? directory.customers : [];
  directory.customers = [];
  for (let index = 0; index < source.length; index += 1) {
    const migrated = migrateLegacyCustomer(source[index], {
      seed: directory.seed,
      sourceId: source[index]?.customerId ?? `legacy:${index}`,
    });
    if (directory.customers.some((customer) => customer.customerId === migrated.customerId)) continue;
    directory.customers.push(uniqueDirectoryName(directory, migrated));
  }
  return directory;
}

/** Look up one persisted identity without manufacturing a second record. */
export function customerIdentityById(state, customerId) {
  const directory = ensureCustomerDirectory(state);
  return directory.customers.find((customer) => customer.customerId === customerId) || null;
}

/**
 * Return or create one identity in the persisted directory. A supplied sourceId
 * is stable for reservations/imports; omitted IDs allocate a unique visit ordinal.
 */
export function allocateCustomerIdentity(state, { sourceId = null, legacy = null } = {}) {
  const directory = ensureCustomerDirectory(state);
  let stableSource = sourceId;
  if (stableSource === null || stableSource === undefined || stableSource === '') {
    do {
      stableSource = `visitor:${directory.nextOrdinal++}`;
    } while (directory.customers.some(
      (customer) => customer.customerId === customerIdFor(directory.seed, stableSource),
    ));
  }
  const wantedId = legacy?.customerId || customerIdFor(directory.seed, stableSource);
  const existing = directory.customers.find((customer) => customer.customerId === wantedId);
  if (existing) return existing;
  const generated = legacy
    ? migrateLegacyCustomer(legacy, { seed: directory.seed, sourceId: stableSource })
    : createCustomerIdentity(directory.seed, stableSource);
  const identity = uniqueDirectoryName(directory, generated);
  directory.customers.push(identity);
  return identity;
}

function reservationKey(reservation) {
  return reservation?.reservationId ?? reservation?.id ?? 'legacy';
}

function reservationPartySize(reservation) {
  const value = Number(reservation?.groupSize ?? reservation?.partySize ?? 1);
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(16, value)) : 1;
}

function reservationLegacyIdentity(reservation) {
  return {
    customerId: reservation.customerId,
    name: reservation.fullName ?? reservation.name,
    paymentPreference: reservation.paymentPreference,
    personality: reservation.personality,
    patience: reservation.patience,
    punctuality: reservation.punctuality,
    travelDistance: reservation.travelDistance,
    parkingSensitivity: reservation.parkingSensitivity,
    weatherSensitivity: reservation.weatherSensitivity,
    loungePreference: reservation.loungePreference,
    visitHistory: reservation.visitHistory,
  };
}

/**
 * Resolve a reservation to the one persisted customer authority and repair its
 * compatibility name fields. Legacy reservations are enrolled exactly once;
 * repeat calls and save/load reconciliation return the existing record.
 */
export function identityForReservation(state, reservation) {
  if (!reservation || typeof reservation !== 'object') {
    throw new TypeError('A reservation record is required to resolve its customer identity.');
  }
  const directory = ensureCustomerDirectory(state);
  const key = reservationKey(reservation);
  let identity = typeof reservation.customerId === 'string'
    ? directory.customers.find((customer) => customer.customerId === reservation.customerId)
    : null;
  if (!identity) {
    identity = allocateCustomerIdentity(state, {
      sourceId: `reservation:${String(key)}`,
      legacy: reservationLegacyIdentity(reservation),
    });
  }

  const formerPrimaryId = reservation.customerId;
  const persistedPaymentPreference = reservation.paymentPreference;
  reservation.customerId = identity.customerId;
  reservation.fullName = identity.fullName;
  reservation.name = identity.fullName;
  reservation.paymentPreference = persistedPaymentPreference === 'cash'
    || persistedPaymentPreference === 'card'
    ? persistedPaymentPreference
    : null;

  const suppliedMembers = Array.isArray(reservation.groupMembers)
    ? reservation.groupMembers.filter((member) => member && typeof member === 'object')
    : [];
  const partySize = reservationPartySize(reservation);
  const members = [];
  const usedIds = new Set();

  const contactIndex = suppliedMembers.findIndex((member) => (
    member.role === 'booking-contact'
    || member.customerId === formerPrimaryId
    || member.customerId === identity.customerId
  ));
  const contact = contactIndex >= 0 ? suppliedMembers[contactIndex] : {};
  members.push({
    ...contact,
    customerId: identity.customerId,
    fullName: identity.fullName,
    name: identity.fullName,
    role: 'booking-contact',
  });
  usedIds.add(identity.customerId);

  const remaining = suppliedMembers.filter((_, index) => index !== contactIndex);
  for (let index = 0; members.length < partySize; index += 1) {
    const member = remaining[index] || {};
    const memberPosition = members.length;
    let memberIdentity = typeof member.customerId === 'string' && !usedIds.has(member.customerId)
      ? directory.customers.find((customer) => customer.customerId === member.customerId)
      : null;
    if (!memberIdentity) {
      const legacy = {
        ...member,
        // A repeated contact ID is not a second identity. Omit it so the stable
        // reservation/member source key allocates a distinct authority record.
        customerId: usedIds.has(member.customerId) ? undefined : member.customerId,
        name: member.fullName ?? member.name,
      };
      memberIdentity = allocateCustomerIdentity(state, {
        sourceId: `reservation:${String(key)}:member:${memberPosition}`,
        legacy,
      });
    }
    if (usedIds.has(memberIdentity.customerId)) continue;
    members.push({
      ...member,
      customerId: memberIdentity.customerId,
      fullName: memberIdentity.fullName,
      name: memberIdentity.fullName,
      role: member.role === 'booking-contact' ? 'golfer' : (member.role || 'golfer'),
    });
    usedIds.add(memberIdentity.customerId);
  }
  reservation.groupMembers = members;
  reservation.groupSize = partySize;
  reservation.partySize = partySize;
  return identity;
}

/** Reconcile every loaded reservation with the persisted identity directory. */
export function reconcileReservationCustomerIdentities(state) {
  const directory = ensureCustomerDirectory(state);
  const booked = Array.isArray(state?.reservations?.booked) ? state.reservations.booked : [];
  for (const reservation of booked) identityForReservation(state, reservation);
  return directory;
}

/** Record one completed or failed visit once the authoritative outcome occurs. */
export function recordCustomerVisit(state, customerId, {
  dayAbs = null,
  purpose = 'retail',
  outcome = 'visit',
  paymentMethod = null,
  amount = 0,
  // C6: a combined visit files TWO outcomes — a check-in and a purchase — for
  // one walk through the door. Both must count against their own tallies; the
  // second must not count as a second visit.
  countsAsVisit = true,
} = {}) {
  const customer = customerIdentityById(state, customerId);
  if (!customer) return { ok: false, reason: 'Unknown customer identity.' };
  const history = customer.visitHistory;
  if (countsAsVisit) history.totalVisits += 1;
  if (countsAsVisit && history.firstVisitDayAbs == null && Number.isFinite(dayAbs)) {
    history.firstVisitDayAbs = dayAbs;
  }
  if (outcome === 'purchase') history.completedPurchases += 1;
  if (outcome === 'check-in') history.completedCheckIns += 1;
  if (outcome === 'no-show') history.noShows += 1;
  if (outcome === 'cancelled') history.cancellations += 1;
  if (paymentMethod === 'cash') history.cashPayments += 1;
  if (paymentMethod === 'card') history.cardPayments += 1;
  history.lifetimeSpend = rounded(history.lifetimeSpend + Math.max(0, Number(amount) || 0), 2);
  history.lastVisitDayAbs = Number.isFinite(dayAbs) ? dayAbs : history.lastVisitDayAbs;
  history.lastVisitPurpose = purpose;
  history.lastPaymentMethod = PAYMENT_PREFERENCES.includes(paymentMethod)
    ? paymentMethod
    : history.lastPaymentMethod;
  return { ok: true, customer };
}

function finiteNonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nullableFinite(value, fallback = null) {
  return value === null ? null : (Number.isFinite(value) ? value : fallback);
}

function migratedHistory(legacy, baseline) {
  const source = legacy && typeof legacy.visitHistory === 'object' && legacy.visitHistory
    ? legacy.visitHistory
    : legacy || {};
  return {
    totalVisits: finiteNonNegative(source.totalVisits ?? source.visits, baseline.totalVisits),
    completedPurchases: finiteNonNegative(source.completedPurchases ?? source.purchases, baseline.completedPurchases),
    completedCheckIns: finiteNonNegative(source.completedCheckIns ?? source.checkIns, baseline.completedCheckIns),
    noShows: finiteNonNegative(source.noShows, baseline.noShows),
    cancellations: finiteNonNegative(source.cancellations, baseline.cancellations),
    cashPayments: finiteNonNegative(source.cashPayments, baseline.cashPayments),
    cardPayments: finiteNonNegative(source.cardPayments, baseline.cardPayments),
    lifetimeSpend: finiteNonNegative(source.lifetimeSpend ?? source.totalSpent, baseline.lifetimeSpend),
    firstVisitDayAbs: nullableFinite(source.firstVisitDayAbs, baseline.firstVisitDayAbs),
    lastVisitDayAbs: nullableFinite(source.lastVisitDayAbs, baseline.lastVisitDayAbs),
    lastVisitPurpose: typeof source.lastVisitPurpose === 'string' ? source.lastVisitPurpose : baseline.lastVisitPurpose,
    lastPaymentMethod: PAYMENT_PREFERENCES.includes(source.lastPaymentMethod)
      ? source.lastPaymentMethod
      : baseline.lastPaymentMethod,
  };
}

function legacyNameParts(rawName, generated) {
  const clean = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return generated;
  const words = clean.split(' ');
  if (words.length === 1) return { firstName: words[0], lastName: generated.lastName };
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

/**
 * Upgrade a legacy string or `{ name }` record without mutating the source.
 * Known payment/history data is retained; missing profile data is generated
 * deterministically from the supplied seed and sourceId.
 */
export function migrateLegacyCustomer(legacy, { seed = 'legacy', sourceId } = {}) {
  const source = typeof legacy === 'string' ? { name: legacy } : (legacy || {});
  const resolvedSourceId = sourceId ?? source.customerId ?? source.id ?? 0;
  const generated = createCustomerIdentity(seed, resolvedSourceId);
  const names = legacyNameParts(source.fullName ?? source.displayName ?? source.name, generated);
  const name = fullName(names.firstName, names.lastName);
  const paymentPreference = PAYMENT_PREFERENCES.includes(source.paymentPreference)
    ? source.paymentPreference
    : (PAYMENT_PREFERENCES.includes(source.paymentMethod) ? source.paymentMethod : generated.paymentPreference);
  const visitProfile = source.visitProfile && typeof source.visitProfile === 'object'
    ? {
        typicalArrivalLeadMinutes: finiteNonNegative(
          source.visitProfile.typicalArrivalLeadMinutes,
          generated.visitProfile.typicalArrivalLeadMinutes,
        ),
        usualPartySize: Math.max(1, Math.min(16, Math.round(finiteNonNegative(
          source.visitProfile.usualPartySize,
          generated.visitProfile.usualPartySize,
        )))),
        preferredPurpose: typeof source.visitProfile.preferredPurpose === 'string'
          ? source.visitProfile.preferredPurpose
          : generated.visitProfile.preferredPurpose,
      }
    : generated.visitProfile;

  return {
    ...generated,
    customerId: typeof source.customerId === 'string' && source.customerId.trim()
      ? source.customerId.trim()
      : generated.customerId,
    firstName: names.firstName,
    lastName: names.lastName,
    fullName: name,
    displayName: name,
    name,
    paymentPreference,
    personality: CUSTOMER_PERSONALITIES.includes(source.personality)
      ? source.personality
      : generated.personality,
    patience: rounded(Math.max(0, Math.min(1, finiteNonNegative(source.patience, generated.patience)))),
    punctuality: rounded(Math.max(0, Math.min(1, finiteNonNegative(source.punctuality, generated.punctuality)))),
    travelDistance: rounded(finiteNonNegative(source.travelDistance, generated.travelDistance), 1),
    parkingSensitivity: rounded(Math.max(0, Math.min(1, finiteNonNegative(
      source.parkingSensitivity,
      generated.parkingSensitivity,
    )))),
    weatherSensitivity: rounded(Math.max(0, Math.min(1, finiteNonNegative(
      source.weatherSensitivity,
      generated.weatherSensitivity,
    )))),
    loungePreference: LOUNGE_PREFERENCES.includes(source.loungePreference)
      ? source.loungePreference
      : generated.loungePreference,
    visitProfile,
    visitHistory: migratedHistory(source, generated.visitHistory),
  };
}

/** A concise line suitable for both speech bubbles and the shared POS UI. */
export function paymentChoiceDialogue(customer) {
  const method = PAYMENT_PREFERENCES.includes(customer?.payMethod)
    ? customer.payMethod
    : (PAYMENT_PREFERENCES.includes(customer?.paymentPreference)
      ? customer.paymentPreference
      : 'card');
  const speaker = String(customer?.fullName || customer?.displayName || customer?.name || 'Customer').trim();
  const phrase = method === 'cash' ? 'Cash is fine.' : "I'll use my card.";
  return `${speaker}: ${phrase}`;
}
