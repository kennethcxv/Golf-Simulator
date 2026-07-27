import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SAVE_MIGRATIONS,
  SAVE_VERSION,
  deserialize,
  deserializeWithReport,
  newGame,
  serialize,
  snapshot,
  update,
  validateGameSave,
} from '../src/sim/state.js';
import {
  EMPIRE_VERSION,
  buyProperty,
  deserializeEmpire,
  deserializeEmpireWithReport,
  empireSnapshot,
  holdingValue,
  newEmpire,
} from '../src/sim/empire.js';
import { getGeom } from '../src/sim/courseVec.js';
import { arriveOrder } from '../src/sim/deliveries.js';
import { bookReservation } from '../src/sim/reservations.js';
import { pickFromShelf } from '../src/sim/checkout.js';
import { ensureLayout } from '../src/sim/layout.js';
import { notify } from '../src/sim/notifications.js';
import { WASH_SURFACES } from '../src/sim/washing.js';
import { addToBag, addToPan, cleaningStatus } from '../src/sim/cleaningToolState.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

test('all historical game versions migrate through the ordered registry', () => {
  const current = snapshot(newGame('relaxed', 731));
  for (let version = 1; version < SAVE_VERSION; version += 1) {
    const raw = clone(current);
    raw.version = version;
    const { state, report } = deserializeWithReport(raw);
    assert.equal(state.version, SAVE_VERSION);
    assert.deepEqual(
      report.migrations.map((migration) => migration.version),
      SAVE_MIGRATIONS.filter((migration) => migration.version > version)
        .map((migration) => migration.version),
      `schema ${version} runs every later migration in order`,
    );
    assert.doesNotThrow(() => update(state, 1));
  }

  const versionless = clone(current);
  delete versionless.version;
  const migrated = deserializeWithReport(versionless);
  assert.equal(migrated.report.persistedVersion, 0);
  assert.equal(migrated.state.version, SAVE_VERSION);
});

test('future game and empire schemas are refused without mutating the payload', () => {
  const game = snapshot(newGame('relaxed', 90));
  game.version = SAVE_VERSION + 1;
  const originalGame = JSON.stringify(game);
  assert.throws(() => deserialize(game), (error) => error.code === 'SAVE_VERSION_UNSUPPORTED');
  assert.equal(JSON.stringify(game), originalGame);
  assert.equal(validateGameSave(game).compatible, false);

  const portfolio = empireSnapshot(newEmpire('relaxed', 90));
  portfolio.empireVersion = EMPIRE_VERSION + 1;
  const originalPortfolio = JSON.stringify(portfolio);
  assert.throws(
    () => deserializeEmpire(portfolio),
    (error) => error.code === 'SAVE_VERSION_UNSUPPORTED',
  );
  assert.equal(JSON.stringify(portfolio), originalPortfolio);
});

test('fresh, partial, malformed, and corrupt JSON saves have explicit outcomes', () => {
  const fresh = deserializeWithReport(serialize(newGame('relaxed', 400)));
  assert.equal(fresh.report.recovered, false);
  assert.equal(fresh.report.repairs.length, 0);

  const partial = deserializeWithReport({
    version: 1,
    mode: 'relaxed',
    seed: 400,
    cash: 1234,
    clock: { minutes: 600 },
  });
  assert.equal(partial.state.cash, 1234);
  assert.ok(partial.state.course.holes.length > 0);
  assert.equal(
    partial.state.shop.reno.wet.length,
    fresh.state.shop.reno.wet.length,
    'partial saves derive the current clubhouse cleaning field instead of a stale room-size literal',
  );
  assert.equal(partial.report.recovered, true);
  assert.doesNotThrow(() => update(partial.state, 1));

  const malformed = validateGameSave('{"version":');
  assert.equal(malformed.valid, false);
  assert.equal(malformed.error.code, 'SAVE_PARSE_ERROR');
  const wrongRoot = validateGameSave('[]');
  assert.equal(wrongRoot.valid, false);
  assert.equal(wrongRoot.error.code, 'SAVE_ROOT_INVALID');
});

test('every player-owned domain survives one current-schema round trip', () => {
  const state = newGame('relaxed', 20260718);
  state.cash = 98765.43;
  state.clock.minutes = 4123;
  state.turf.health[0] = 73.25;
  state.maintenance.policies.green.mowHeightMm = 4.75;
  state.golfers.pool[0].satisfaction = 81;
  const hired = state.staff.market.shift();
  state.staff.employees.push(hired);
  state.club.greenFee = 47;
  state.club.reviews.unshift({
    stars: 4,
    text: 'The restored shop was worth the visit.',
    factors: [],
    cited: ['shopClean'],
    worst: null,
    best: null,
    day: 2,
  });
  state.ledger.today.revenue.shopSales = 321.45;
  state.shop.inventory.balls1.back = 7;
  state.shop.drawer[20] = 9;
  state.shop.paymentBag = ['cash', 'card', 'cash'];
  ensureLayout(state);
  state.shop.layout.moved.table_polos = { x: -5.5, z: 1.5, ry: 0 };
  arriveOrder(state, { id: 501, skuId: 'polo1', qty: 8 });
  const reservation = bookReservation(state, {
    dayAbs: 3,
    minute: 510,
    name: 'Save Stability',
    partySize: 2,
    fee: 94,
  });
  assert.equal(reservation.ok, true, reservation.reason);
  state.tractor.steps.cleared = true;
  state.props.litter[0].cleared = true;
  state.progression.prestige = 27;
  state.tutorial.flags['save-stability'] = true;
  notify(state, { kind: 'system', text: 'Persistence checkpoint.', dedupeKey: 'save-stability' });
  state.uiPrefs.courseEditor = { selectedHoleId: 1, cameraView: 'green', lighting: 'golden' };
  state.property.arrears = 123.45;
  state.shop.reno.grime[0] = 0.125;
  state.shop.reno.wet[10] = 0.875;
  state.shop.reno.solution[11] = 0.625;
  state.shop.reno.debris = [{ x: 1.25, z: -2.5, a: 0.4, kind: 'grit' }];
  assert.equal(addToPan(state, 0.35).accepted, 0.35);
  assert.equal(addToBag(state, 1.75).accepted, 1.75);
  const wash = WASH_SURFACES[0];
  state.shop.reno.wash[wash.id].grime[0] = 0.2;
  state.shop.reno.wash[wash.id].soap[0] = 55;
  state.shop.reno.architecture.components.floor.restored = true;
  state.shop.reno.architecture.doors.main.left = 'open';

  const { state: back, report } = deserializeWithReport(serialize(state));
  assert.equal(report.recovered, false);
  assert.equal(back.cash, 98765.43);
  assert.equal(back.clock.minutes, 4123);
  assert.equal(back.turf.health[0], Math.fround(73.3));
  assert.equal(back.maintenance.policies.green.mowHeightMm, 4.75);
  assert.equal(back.golfers.pool[0].satisfaction, 81);
  assert.equal(back.staff.employees.some((employee) => employee.id === hired.id), true);
  assert.equal(back.club.greenFee, 47);
  assert.equal(back.club.reviews[0].text, 'The restored shop was worth the visit.');
  assert.equal(back.ledger.today.revenue.shopSales, 321.45);
  assert.equal(back.shop.inventory.balls1.back, 7);
  assert.equal(back.shop.drawer[20], 9);
  assert.deepEqual(back.shop.paymentBag, ['cash', 'card', 'cash']);
  assert.deepEqual(back.shop.layout.moved.table_polos, { x: -5.5, z: 1.5, ry: 0 });
  assert.equal(back.shop.deliveries.boxes.length > 0, true);
  assert.equal(back.reservations.booked[0].fullName, 'Save Stability');
  assert.equal(back.customerDirectory.customers.length >= 2, true);
  assert.equal(back.tractor.steps.cleared, true);
  assert.equal(back.props.litter[0].cleared, true);
  assert.equal(back.progression.prestige, 27);
  assert.equal(back.tutorial.flags['save-stability'], true);
  assert.equal(back.notifications.items[0].text, 'Persistence checkpoint.');
  assert.deepEqual(back.uiPrefs.courseEditor, state.uiPrefs.courseEditor);
  assert.equal(back.property.arrears, 123.45);
  assert.equal(back.shop.reno.grime[0], 0.125);
  assert.equal(back.shop.reno.wet[10], 0.875);
  assert.equal(back.shop.reno.solution[11], 0.625);
  assert.deepEqual(back.shop.reno.debris, [{ x: 1.25, z: -2.5, a: 0.4, kind: 'grit' }]);
  assert.equal(cleaningStatus(back).pan.load, 0.35);
  assert.equal(cleaningStatus(back).bag.load, 1.75);
  assert.equal(back.shop.reno.pan, 0.35);
  assert.equal(back.shop.reno.bag, 1.75);
  assert.equal(back.shop.reno.wash[wash.id].grime[0], 0.2);
  assert.equal(back.shop.reno.wash[wash.id].soap[0], 55);
  assert.equal(back.shop.reno.architecture.components.floor.restored, true);
  assert.equal(back.shop.reno.architecture.doors.main.left, 'open');
});

test('duplicate authorities are reconciled without duplicating stock, people, bookings, or boxes', () => {
  const state = newGame('relaxed', 8080);
  assert.equal(pickFromShelf(state, 'balls1', 'held-1').ok, true);
  const raw = snapshot(state);
  raw.shop.held.push(clone(raw.shop.held[0]));
  arriveOrder(state, { id: 71, skuId: 'polo1', qty: 8 });
  const withBox = snapshot(state);
  raw.shop.deliveries = clone(withBox.shop.deliveries);
  raw.shop.deliveries.boxes.push(clone(raw.shop.deliveries.boxes[0]));
  raw.shop.deliveries.shipments.push(clone(raw.shop.deliveries.shipments[0]));
  raw.shop.deliveries.arrivedOrderIds.push(raw.shop.deliveries.arrivedOrderIds[0]);
  raw.golfers.pool.push(clone(raw.golfers.pool[0]));
  raw.staff.market.push(clone(raw.staff.market[0]));
  const booked = bookReservation(state, {
    dayAbs: 2, minute: 510, name: 'One Booking', partySize: 1,
  });
  assert.equal(booked.ok, true);
  const booking = snapshot(state).reservations.booked[0];
  raw.reservations.booked = [booking, clone(booking)];

  const beforeShelf = raw.shop.inventory.balls1.shelf;
  const { state: back, report } = deserializeWithReport(raw);
  assert.equal(report.recovered, true);
  assert.equal(back.shop.held.length, 0, 'one recovered held unit is returned exactly once');
  assert.equal(back.shop.inventory.balls1.shelf, beforeShelf + 1);
  assert.equal(new Set(back.shop.deliveries.boxes.map((box) => box.id)).size, back.shop.deliveries.boxes.length);
  assert.equal(new Set(back.shop.deliveries.shipments.map((shipment) => shipment.orderId)).size, back.shop.deliveries.shipments.length);
  assert.equal(new Set(back.golfers.pool.map((golfer) => golfer.id)).size, back.golfers.pool.length);
  assert.equal(new Set(back.staff.market.map((candidate) => candidate.id)).size, back.staff.market.length);
  assert.equal(back.reservations.booked.length, 1);

  const second = deserializeWithReport(serialize(back));
  assert.equal(second.report.recovered, false, 'repair output is canonical on its next load');
  assert.equal(second.state.shop.inventory.balls1.shelf, back.shop.inventory.balls1.shelf);
});

test('fifty game save/reload cycles do not grow bounded authorities', () => {
  let state = newGame('relaxed', 5050);
  arriveOrder(state, { id: 88, skuId: 'polo1', qty: 8 });
  state.shop.reno.debris = [{ x: 0, z: 0, a: 0.25 }];
  const expected = {
    golfers: state.golfers.pool.length,
    staffMarket: state.staff.market.length,
    boxes: state.shop.deliveries.boxes.length,
    debris: state.shop.reno.debris.length,
    customers: state.customerDirectory.customers.length,
  };
  for (let cycle = 0; cycle < 50; cycle += 1) {
    const loaded = deserializeWithReport(serialize(state));
    assert.equal(loaded.report.recovered, false, `cycle ${cycle + 1} is already canonical`);
    state = loaded.state;
  }
  assert.deepEqual({
    golfers: state.golfers.pool.length,
    staffMarket: state.staff.market.length,
    boxes: state.shop.deliveries.boxes.length,
    debris: state.shop.reno.debris.length,
    customers: state.customerDirectory.customers.length,
  }, expected);
});

test('corrupt authored geometry is pruned before renderer geometry can consume it', () => {
  const raw = snapshot(newGame('relaxed', 6104));
  const vectorHole = raw.course.vec.holes[0];
  vectorHole.line = [{ x: 2, y: 2 }, { x: 9, y: 7 }];
  vectorHole.width = [{ t: 'near', w: 4 }, { t: 1.5, w: 99_999 }];
  vectorHole.tees = [{ x: 3, y: 3, rot: 'north', w: -3, d: 0 }];
  vectorHole.green = { pts: [{ x: 3, y: 3 }, { x: 'bad', y: 4 }] };
  vectorHole.bunkers = [
    { pts: [{ x: 2, y: 2 }], depth: 'deep' },
    { pts: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }], depth: -8, lip: 999 },
  ];
  raw.course.vec.waters.push({ id: 999001, pts: [{ x: 1, y: 1 }], depth: 'deep' });
  raw.course.vec.streams.push({ id: 999002, pts: 'not-points', w: -5 });
  raw.course.vec.mounds.push({ id: 999003, x: 5, y: 5, r: -1, h: 'tall' });
  raw.course.vec.lawns.push({ x: 5, y: 5, w: 0, d: 4 });
  raw.course.paths.push({ id: 999004, pts: [{ x: 2, y: 2 }, { x: 4, y: 4 }], width: 'wide' });
  raw.course.objects.push({ id: 999005, type: 'tree', x: 2, y: 2, rot: 'bad', scale: -1 });
  raw.course.structures.push({ type: 'clubhouse', x: 1, y: 1, w: -5, h: 3 });
  raw.shop.carry = { skuId: 'not-a-real-sku', qty: 999 };

  const first = deserializeWithReport(raw);
  assert.equal(first.report.recovered, true);
  assert.doesNotThrow(() => getGeom(first.state.course));
  assert.equal(first.state.course.vec.waters.some((feature) => feature.id === 999001), false);
  assert.equal(first.state.course.vec.streams.some((feature) => feature.id === 999002), false);
  assert.equal(first.state.course.vec.mounds.some((feature) => feature.id === 999003), false);
  assert.equal(first.state.course.paths.find((path) => path.id === 999004).width, 3.2);
  assert.equal(first.state.course.objects.find((object) => object.id === 999005).scale, 0.01);
  assert.equal(first.state.course.structures.some((entry) => entry.w < 0), false);
  assert.equal(first.state.shop.carry, null);

  const second = deserializeWithReport(serialize(first.state));
  assert.equal(second.report.recovered, false, 'geometry repair is canonical after one load');
  assert.doesNotThrow(() => getGeom(second.state.course));
});

test('portfolio recovery removes duplicate holdings and owned market listings once', () => {
  const empire = newEmpire('relaxed', 222);
  empire.cash = 10_000_000;
  assert.equal(buyProperty(empire, 'willow-creek').ok, true);
  const raw = empireSnapshot(empire);
  raw.holdings.push(clone(raw.holdings[0]));
  raw.market.push(clone(raw.holdings[0].property));

  const first = deserializeEmpireWithReport(raw);
  assert.equal(first.report.recovered, true);
  assert.equal(first.empire.holdings.length, 1);
  assert.equal(first.empire.market.some((property) => property.id === 'willow-creek'), false);
  const second = deserializeEmpireWithReport(empireSnapshot(first.empire));
  assert.equal(second.report.recovered, false);
  assert.equal(second.empire.holdings.length, 1);
});

test('corrupt market layouts and passive summaries recover to finite buildable values', () => {
  const empire = newEmpire('relaxed', 9191);
  empire.cash = 10_000_000;
  assert.equal(buyProperty(empire, 'willow-creek').ok, true);
  assert.equal(buyProperty(empire, 'bent-pines').ok, true);
  const raw = empireSnapshot(empire);
  const parked = raw.holdings.find((holding) => holding.property.id === 'bent-pines');
  parked.passive = {
    conditionEst: 'dead',
    design: Number.POSITIVE_INFINITY,
    members: -40,
    reputation: 999,
    greenFee: -5,
    duesPerDay: Number.NaN,
    days: -9,
    lastNet: 'loss',
    sinceVisitNet: Number.NEGATIVE_INFINITY,
    accruedNet: {},
  };
  const listing = raw.market.find((property) => property.id === 'thornbury-estate');
  listing.askingPrice = 'free';
  listing.condition = 999;
  listing.layout = {
    kind: 'serpentine',
    margin: 'edge',
    bands: 0,
    fairwayR: -5,
    roughR: Number.NaN,
    greenR: Number.POSITIVE_INFINITY,
    greenRJitter: -2,
    doglegChance: 4,
    bunkers: -10,
    ponds: 999,
    elevAmp: 'high',
    parMix: [],
    parRange: { 4: 'long' },
  };

  const first = deserializeEmpireWithReport(raw);
  assert.equal(first.report.recovered, true);
  const recoveredParked = first.empire.holdings.find(
    (holding) => holding.property.id === 'bent-pines',
  );
  assert.ok(Number.isFinite(holdingValue(first.empire, recoveredParked)));
  assert.ok(Object.values(recoveredParked.passive).every(Number.isFinite));
  first.empire.cash = 10_000_000;
  const purchase = buyProperty(first.empire, 'thornbury-estate');
  assert.equal(purchase.ok, true, purchase.reason);
  assert.equal(purchase.state.course.holes.length, 18);

  const second = deserializeEmpireWithReport(empireSnapshot(first.empire));
  assert.equal(second.report.recovered, false, 'portfolio repair is canonical after one load');
});
