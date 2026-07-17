import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, HOLE_STATUS, ZONE } from '../src/sim/constants.js';
import { BALANCE } from '../src/sim/balance.js';
import { SAVE_VERSION, newGame, serialize, deserialize, update, rngOf } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { bookSlot, generateOnlineReservations } from '../src/sim/reservations.js';
import { customerIdentityById } from '../src/sim/customerIdentity.js';
import { stackTotal } from '../src/sim/register.js';
import { addRevenue, addExpense } from '../src/sim/economy.js';

test('newGame builds a complete starting state per mode', () => {
  const st = newGame('relaxed', 42);
  assert.equal(st.mode, 'relaxed');
  assert.equal(st.cash, BALANCE.startingCash.relaxed);
  assert.equal(st.course.holes.length, 9);
  assert.ok(st.sections.length > 0, 'sections precomputed');
  const st2 = newGame('realistic', 42);
  assert.equal(st2.cash, BALANCE.startingCash.realistic);
});

test('state serializes to JSON and back without losing the world', () => {
  const st = newGame('realistic', 1234);
  const json = serialize(st);
  assert.equal(typeof json, 'string');
  const back = deserialize(json);
  assert.equal(back.mode, st.mode);
  assert.equal(back.cash, st.cash);
  assert.equal(back.clock.minutes, st.clock.minutes);
  assert.deepEqual(Array.from(back.course.zones), Array.from(st.course.zones));
  assert.equal(back.course.holes.length, 9);
  assert.deepEqual(back.course.holes[3].pin, st.course.holes[3].pin);
  assert.ok(back.sections.length > 0, 'sections rebuilt on load');
});

test('a corrupted (NaN/null) cash balance heals on save and on load', () => {
  // NaN serializes to JSON null; without the heal every register sale then
  // refuses to bank ("The club books are not available") forever after.
  const st = newGame('relaxed', 77);
  st.cash = NaN;
  const raw = JSON.parse(serialize(st));
  assert.equal(raw.cash, 0, 'serialize never writes a non-finite balance');
  const doctored = JSON.parse(serialize(newGame('relaxed', 78)));
  doctored.cash = null; // a save written by an older build
  const healed = deserialize(JSON.stringify(doctored));
  assert.equal(healed.cash, 0, 'deserialize heals a null balance to a finite number');
  assert.ok(Number.isFinite(healed.cash));
});

test('the books refuse a non-finite amount at the gateway', () => {
  // `NaN <= 0` is false, so the old positive-amount guard let NaN through and
  // one bad posting corrupted cash forever after.
  const st = newGame('relaxed', 91);
  const cash = st.cash;
  const fees = st.ledger.today.revenue.greenFees;
  addRevenue(st, 'greenFees', NaN);
  addRevenue(st, 'greenFees', undefined);
  addRevenue(st, 'greenFees', Infinity);
  addExpense(st, 'upkeep', NaN);
  assert.equal(st.cash, cash, 'cash never moves on a non-finite amount');
  assert.equal(st.ledger.today.revenue.greenFees, fees, 'no ledger line moves either');
  addRevenue(st, 'greenFees', 12.5);
  assert.equal(st.cash, cash + 12.5, 'real money still books normally');
});

test('a ledger poisoned by an old build heals to zeros on load', () => {
  const st = newGame('relaxed', 92);
  st.ledger.today.revenue.greenFees = NaN;
  st.ledger.yesterday = { revenue: { greenFees: NaN }, expense: {}, revenueTotal: NaN, net: NaN };
  st.ledger.history.push({ day: 1, revenue: { greenFees: NaN }, expense: {}, net: NaN });
  const healed = deserialize(serialize(st)); // NaN crosses JSON as null
  assert.equal(healed.ledger.today.revenue.greenFees, 0);
  assert.equal(healed.ledger.yesterday.revenue.greenFees, 0);
  assert.equal(healed.ledger.yesterday.net, 0);
  assert.equal(healed.ledger.history.at(-1).net, 0);
  assert.ok(Number.isFinite(healed.ledger.yesterday.revenueTotal));
});

test('legacy drawers rebalance into penny and half-dollar slots without minting value', () => {
  const state = newGame('relaxed', 4321);
  state.shop.drawer = { 20: 5, 10: 8, 5: 10, 1: 25, 0.25: 20, 0.1: 20, 0.05: 20 };
  const opening = stackTotal(state.shop.drawer);
  const loaded = deserialize(serialize(state));
  assert.equal(stackTotal(loaded.shop.drawer), opening);
  assert.ok(loaded.shop.drawer[0.5] >= 16, 'old float funds the half-dollar slot');
  assert.ok(loaded.shop.drawer[0.01] >= 50, 'old float funds the penny slot');
  const loadedAgain = deserialize(serialize(loaded));
  assert.deepEqual(loadedAgain.shop.drawer, loaded.shop.drawer, 'drawer migration is idempotent');
});

test('rng stream resumes identically after save/load', () => {
  const st = newGame('relaxed', 555);
  rngOf(st).next(); // advance a bit
  rngOf(st).next();
  const json = serialize(st);
  const back = deserialize(json);
  assert.equal(rngOf(st).next(), rngOf(back).next());
  assert.equal(rngOf(st).int(1000), rngOf(back).int(1000));
});

test('update advances the clock and runs daily ticks across midnight', () => {
  const st = newGame('realistic', 9);
  const hole = st.course.holes[0];
  hole.status = HOLE_STATUS.RENOVATION;
  hole.daysLeft = 1;
  const res = update(st, MINUTES_PER_DAY);
  assert.equal(res.daysPassed, 1);
  assert.equal(hole.status, HOLE_STATUS.OPEN, 'renovation completed on the daily tick');
});

test('a fresh game is playable: open holes and cash to work with', () => {
  const st = newGame('realistic', 42);
  const open = st.course.holes.filter((h) => h.status === HOLE_STATUS.OPEN);
  assert.equal(open.length, 9);
  assert.ok(st.cash > 0);
  // there is actual fairway on the ground
  let fairway = 0;
  for (const z of st.course.zones) if (z === ZONE.FAIRWAY) fairway++;
  assert.ok(fairway > 200, `only ${fairway} fairway cells`);
});

test('online reservations use unique persisted customer authorities across save/load', () => {
  const state = newGame('relaxed', 8765);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const generated = generateOnlineReservations(state, {
    dayAbs,
    count: 12,
    minGroupSize: 1,
    maxGroupSize: 3,
    noShowChance: 0,
  });
  assert.equal(generated.created.length, 12);

  const reservationIds = generated.created.map((reservation) => reservation.customerId);
  const reservationNames = generated.created.map((reservation) => reservation.fullName);
  const directoryIds = state.customerDirectory.customers.map((customer) => customer.customerId);
  const directoryNames = state.customerDirectory.customers.map((customer) => customer.fullName);
  assert.equal(new Set(reservationIds).size, reservationIds.length);
  assert.equal(new Set(reservationNames).size, reservationNames.length);
  assert.equal(new Set(directoryIds).size, directoryIds.length);
  assert.equal(new Set(directoryNames).size, directoryNames.length);
  for (const reservation of generated.created) {
    const identity = customerIdentityById(state, reservation.customerId);
    assert.ok(identity, `directory owns ${reservation.customerId}`);
    assert.equal(reservation.fullName, identity.fullName);
    for (const member of reservation.groupMembers) {
      assert.equal(customerIdentityById(state, member.customerId)?.fullName, member.fullName);
    }
  }

  const directoryBefore = structuredClone(state.customerDirectory);
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.customerDirectory, directoryBefore);
  assert.equal(new Set(loaded.customerDirectory.customers.map((customer) => customer.customerId)).size,
    loaded.customerDirectory.customers.length);
  assert.equal(new Set(loaded.customerDirectory.customers.map((customer) => customer.fullName)).size,
    loaded.customerDirectory.customers.length);
  for (const reservation of loaded.reservations.booked) {
    assert.equal(customerIdentityById(loaded, reservation.customerId)?.fullName, reservation.fullName);
  }
});

test('pre-directory saves migrate reservation contacts and group members exactly once', () => {
  const state = newGame('relaxed', 5150);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs + 1;
  const booked = bookSlot(state, dayAbs, 480, { name: 'Legacy Golfer', partySize: 2 });
  assert.equal(booked.ok, true);

  const raw = JSON.parse(serialize(state));
  delete raw.customerDirectory;
  raw.version = 3;
  const legacy = raw.reservations.booked[0];
  legacy.customerId = `reservation-customer-${legacy.id}`;
  legacy.name = 'Legacy Golfer';
  legacy.fullName = 'Legacy Golfer';
  legacy.groupMembers = [];

  const loaded = deserialize(JSON.stringify(raw));
  assert.equal(loaded.version, SAVE_VERSION, 'successful migration advances the save schema');
  const reservation = loaded.reservations.booked[0];
  const identity = customerIdentityById(loaded, reservation.customerId);
  assert.ok(identity);
  assert.equal(identity.customerId, `reservation-customer-${reservation.id}`);
  assert.equal(identity.fullName, 'Legacy Golfer');
  assert.equal(reservation.name, identity.fullName);
  assert.equal(reservation.fullName, identity.fullName);
  assert.equal(reservation.groupMembers.length, 2);
  assert.equal(new Set(reservation.groupMembers.map((member) => member.customerId)).size, 2);
  assert.equal(loaded.customerDirectory.customers.length, 2);

  const loadedAgain = deserialize(serialize(loaded));
  assert.deepEqual(loadedAgain.customerDirectory, loaded.customerDirectory);
  assert.equal(loadedAgain.customerDirectory.customers.length, 2, 'second migration allocates nobody');
});
