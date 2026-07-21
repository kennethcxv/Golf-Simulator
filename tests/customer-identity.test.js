import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_IDENTITY_VERSION,
  CUSTOMER_PERSONALITIES,
  LOUNGE_PREFERENCES,
  PAYMENT_PREFERENCES,
  createCustomerIdentity,
  createCustomerRegistry,
  customerIdFor,
  initCustomerDirectory,
  ensureCustomerDirectory,
  allocateCustomerIdentity,
  customerIdentityById,
  identityForReservation,
  reconcileReservationCustomerIdentities,
  recordCustomerVisit,
  migrateLegacyCustomer,
  paymentChoiceDialogue,
} from '../src/sim/customerIdentity.js';

test('one seed/source ID pair always generates the same complete identity', () => {
  const first = createCustomerIdentity('course-42', 17);
  const second = createCustomerIdentity('course-42', 17);

  assert.deepEqual(first, second);
  assert.equal(first.customerId, customerIdFor('course-42', 17));
  assert.equal(first.schemaVersion, CUSTOMER_IDENTITY_VERSION);
  assert.equal(first.fullName, `${first.firstName} ${first.lastName}`);
  assert.equal(first.displayName, first.fullName);
  assert.equal(first.name, first.fullName, 'legacy alias never becomes abbreviated authority');
  assert.ok(PAYMENT_PREFERENCES.includes(first.paymentPreference));
  assert.ok(CUSTOMER_PERSONALITIES.includes(first.personality));
  assert.ok(LOUNGE_PREFERENCES.includes(first.loungePreference));
  assert.ok(first.patience >= 0 && first.patience <= 1);
  assert.ok(first.punctuality >= 0 && first.punctuality <= 1);
  assert.ok(first.travelDistance >= 2 && first.travelDistance <= 60);
  assert.ok(first.parkingSensitivity >= 0 && first.parkingSensitivity <= 1);
  assert.ok(first.weatherSensitivity >= 0 && first.weatherSensitivity <= 1);
});

test('different source IDs have stable unique authority IDs', () => {
  const ids = new Set();
  for (let sourceId = 0; sourceId < 500; sourceId += 1) {
    ids.add(createCustomerIdentity(91, sourceId).customerId);
  }
  assert.equal(ids.size, 500);
  assert.notEqual(customerIdFor(91, 'guest/a'), customerIdFor(91, 'guest%2Fa'));
});

test('a deterministic registry has no duplicate IDs or names', () => {
  const first = createCustomerRegistry('large-cohort', 5000);
  const again = createCustomerRegistry('large-cohort', 5000);
  const ids = first.customers.map((customer) => customer.customerId);
  const names = first.customers.map((customer) => customer.fullName);

  assert.deepEqual(first, again);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length, 'cycle suffixes keep names unique beyond the base name pool');
  assert.equal(first.nextOrdinal, 5000);
});

test('seeded name permutations stay valid across signed-hash edge cases', () => {
  for (let seed = 0; seed < 128; seed += 1) {
    const registry = createCustomerRegistry(`edge-${seed}`, 96);
    assert.ok(registry.customers.every((customer) => customer.firstName && customer.lastName));
    assert.equal(new Set(registry.customers.map((customer) => customer.fullName)).size, 96);
  }
});

test('registry ranges remain stable when generated in separate batches', () => {
  const all = createCustomerRegistry(1234, 120);
  const later = createCustomerRegistry(1234, 40, { startOrdinal: 80 });
  assert.deepEqual(later.customers, all.customers.slice(80));
  assert.throws(() => createCustomerRegistry(1, -1), RangeError);
  assert.throws(() => createCustomerRegistry(1, 1, { startOrdinal: -1 }), RangeError);
});

test('identity and registry records survive exact JSON round trips', () => {
  const identity = createCustomerIdentity('save-seed', 'booking-204');
  const registry = createCustomerRegistry('save-seed', 32);
  assert.deepEqual(JSON.parse(JSON.stringify(identity)), identity);
  assert.deepEqual(JSON.parse(JSON.stringify(registry)), registry);
});

test('legacy name-only records migrate without mutation and retain known history', () => {
  const legacy = {
    id: 73,
    name: 'Mara Vale',
    paymentMethod: 'cash',
    visits: 8,
    purchases: 5,
    noShows: 1,
    totalSpent: 284.5,
    lastVisitDayAbs: 12,
    lastPaymentMethod: 'card',
  };
  const before = structuredClone(legacy);
  const migrated = migrateLegacyCustomer(legacy, { seed: 'migration' });

  assert.deepEqual(legacy, before, 'migration is pure');
  assert.equal(migrated.fullName, 'Mara Vale');
  assert.equal(migrated.firstName, 'Mara');
  assert.equal(migrated.lastName, 'Vale');
  assert.equal(migrated.displayName, 'Mara Vale');
  assert.equal(migrated.paymentPreference, 'cash');
  assert.equal(migrated.visitHistory.totalVisits, 8);
  assert.equal(migrated.visitHistory.completedPurchases, 5);
  assert.equal(migrated.visitHistory.noShows, 1);
  assert.equal(migrated.visitHistory.lifetimeSpend, 284.5);
  assert.equal(migrated.visitHistory.lastVisitDayAbs, 12);
  assert.equal(migrated.visitHistory.lastPaymentMethod, 'card');
  assert.deepEqual(JSON.parse(JSON.stringify(migrated)), migrated);

  const fromString = migrateLegacyCustomer('Theo Nash', { seed: 'migration', sourceId: 74 });
  assert.equal(fromString.fullName, 'Theo Nash');
  assert.ok(fromString.customerId);
});

test('payment dialogue names the customer and explicitly states cash or card', () => {
  const cashCustomer = { fullName: 'Mara Vale', paymentPreference: 'cash' };
  const cardCustomer = { fullName: 'Theo Nash', paymentPreference: 'card' };
  assert.equal(paymentChoiceDialogue(cashCustomer), 'Mara Vale: Cash is fine.');
  assert.equal(paymentChoiceDialogue(cardCustomer), "Theo Nash: I'll use my card.");
  assert.equal(paymentChoiceDialogue({
    fullName: 'Rhea Osborne',
    paymentPreference: 'card',
    payMethod: 'cash',
  }), 'Rhea Osborne: Cash is fine.');
  assert.match(paymentChoiceDialogue({ fullName: 'Fallback Guest' }), /use my card/i);
});

test('a persisted directory allocates stable unique visitors and records outcomes', () => {
  const state = { seed: 77 };
  const directory = initCustomerDirectory(state);
  const first = allocateCustomerIdentity(state);
  const second = allocateCustomerIdentity(state);
  const reservation = allocateCustomerIdentity(state, { sourceId: 'reservation:41' });
  assert.equal(directory.customers.length, 3);
  assert.equal(new Set(directory.customers.map((customer) => customer.customerId)).size, 3);
  assert.equal(new Set(directory.customers.map((customer) => customer.fullName)).size, 3);
  assert.equal(allocateCustomerIdentity(state, { sourceId: 'reservation:41' }), reservation);
  assert.equal(customerIdentityById(state, first.customerId), first);
  assert.notEqual(first.customerId, second.customerId);

  const visit = recordCustomerVisit(state, reservation.customerId, {
    dayAbs: 9,
    purpose: 'tee-time',
    outcome: 'check-in',
    paymentMethod: 'cash',
    amount: 72.5,
  });
  assert.equal(visit.ok, true);
  assert.equal(reservation.visitHistory.completedCheckIns, 1);
  assert.equal(reservation.visitHistory.cashPayments, 1);
  assert.equal(reservation.visitHistory.lifetimeSpend, 72.5);

  const loaded = { seed: 77, customerDirectory: JSON.parse(JSON.stringify(directory)) };
  assert.deepEqual(ensureCustomerDirectory(loaded), directory);
});

test('directory normalization repairs duplicate full names without losing identity traits', () => {
  const first = createCustomerIdentity('repair', 1);
  const second = {
    ...createCustomerIdentity('repair', 2),
    firstName: first.firstName,
    lastName: first.lastName,
    fullName: first.fullName,
    displayName: first.fullName,
    name: first.fullName,
    personality: 'chatty',
    patience: 0.91,
  };
  const state = {
    seed: 'repair',
    customerDirectory: {
      schemaVersion: CUSTOMER_IDENTITY_VERSION,
      seed: 'repair',
      nextOrdinal: 3,
      customers: [first, second],
    },
  };
  const directory = ensureCustomerDirectory(state);

  assert.equal(directory.customers.length, 2);
  assert.equal(new Set(directory.customers.map((customer) => customer.customerId)).size, 2);
  assert.equal(new Set(directory.customers.map((customer) => customer.fullName.toLowerCase())).size, 2);
  assert.equal(directory.customers[1].personality, 'chatty');
  assert.equal(directory.customers[1].patience, 0.91);
});

test('legacy reservations enroll once and use the directory as full-name authority', () => {
  const state = { seed: 404 };
  initCustomerDirectory(state);
  const reservation = {
    id: 7,
    customerId: 'reservation-customer-7',
    name: 'Mara Vale',
    paymentPreference: 'cash',
    personality: 'friendly',
    groupSize: 3,
    partySize: 3,
    groupMembers: [],
  };

  const identity = identityForReservation(state, reservation);
  assert.equal(identity.customerId, 'reservation-customer-7');
  assert.equal(identity.fullName, 'Mara Vale');
  assert.equal(identity.paymentPreference, 'cash');
  assert.equal(reservation.fullName, identity.fullName);
  assert.equal(reservation.name, identity.fullName);
  assert.equal(reservation.groupMembers.length, 3);
  assert.equal(new Set(reservation.groupMembers.map((member) => member.customerId)).size, 3);
  assert.equal(new Set(state.customerDirectory.customers.map((customer) => customer.fullName)).size, 3);
  assert.ok(reservation.groupMembers.every((member) => (
    customerIdentityById(state, member.customerId)?.fullName === member.fullName
  )));

  const count = state.customerDirectory.customers.length;
  assert.equal(identityForReservation(state, reservation), identity);
  assert.equal(state.customerDirectory.customers.length, count, 'repeat reconciliation creates nothing');

  state.reservations = { booked: [reservation] };
  const copy = JSON.parse(JSON.stringify(state));
  reconcileReservationCustomerIdentities(copy);
  assert.deepEqual(copy, state, 'JSON round-trip reconciliation retains the same authorities');
});
