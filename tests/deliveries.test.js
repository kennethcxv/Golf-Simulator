// PHYSICAL DELIVERIES — orders no longer teleport into the backroom. The
// truck drops labeled BOXES on the receiving pad; you carry them into the
// stockroom, open them (contents enter the backroom), and flatten the
// empties. Shops with pro-shop staff keep working hands-off: the morning
// crew opens whatever the truck left before they shelve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  placeOrder, deliverOrdersDue, vacuumOwned, restockShelvesByStaff,
} from '../src/sim/shop.js';
import {
  CASE_SIZE, boxesOf, pickUpBox, putDownBox, carriedBox, openBox, emptyTrash,
  ensureDeliveries,
} from '../src/sim/deliveries.js';
import { skuById, LEAD_DAYS } from '../src/data/shopItems.js';
import { calendarOf } from '../src/sim/time.js';
import { ROLE } from '../src/sim/staff.js';

const dayNow = (st) => calendarOf(st.clock.minutes).dayAbs;

function orderAndArrive(st, skuId, qty) {
  const res = placeOrder(st, skuId, qty);
  assert.ok(res.ok, `ordering ${skuId} works`);
  // windowed orders land inside their window; +1 uses the past-day force path
  deliverOrdersDue(st, dayNow(st) + LEAD_DAYS[skuById(skuId).cat] + 1);
}

test('an arriving order becomes labeled boxes on the pad, not backroom numbers', () => {
  const st = newGame('relaxed', 42);
  const backBefore = st.shop.inventory.balls2.back;
  orderAndArrive(st, 'balls2', 30); // case of 12 → 3 boxes
  assert.equal(st.shop.inventory.balls2.back, backBefore, 'nothing enters the backroom on arrival');
  const boxes = boxesOf(st);
  assert.equal(boxes.length, Math.ceil(30 / CASE_SIZE.balls), 'the truck left ceil(qty/case) boxes');
  assert.ok(boxes.every((b) => b.skuId === 'balls2' && b.loc === 'pad' && !b.opened), 'boxes sit unopened on the pad');
  assert.equal(boxes.reduce((a, b) => a + b.qty, 0), 30, 'the boxes hold the whole order');
});

test('you carry ONE box at a time: pick up, set down in the stockroom', () => {
  const st = newGame('relaxed', 42);
  orderAndArrive(st, 'balls1', 24);
  const [a, b] = boxesOf(st);
  assert.ok(pickUpBox(st, a.id).ok, 'first pickup works');
  assert.equal(carriedBox(st).id, a.id, 'the box is in your arms');
  assert.equal(pickUpBox(st, b.id).ok, false, 'two boxes at once is refused');
  assert.ok(putDownBox(st, a.id).ok, 'set it down in the stockroom');
  assert.equal(a.loc, 'stock', 'the box now lives in the stockroom');
  assert.equal(carriedBox(st), null, 'hands free again');
});

test('opening a box moves its contents into the backroom and leaves an empty', () => {
  const st = newGame('relaxed', 42);
  orderAndArrive(st, 'glove1', 8);
  const box = boxesOf(st)[0];
  assert.ok(pickUpBox(st, box.id).ok);
  assert.equal(openBox(st, box.id).ok, false, 'cannot open a box in your arms');
  putDownBox(st, box.id);
  const res = openBox(st, box.id);
  assert.ok(res.ok, 'opening a set-down box works');
  assert.equal(st.shop.inventory.glove1.back, 8, 'contents entered the backroom');
  assert.equal(boxesOf(st).length, 0, 'the box is gone');
  assert.equal(st.shop.deliveries.trash, 1, 'an empty is left to flatten');
  assert.ok(emptyTrash(st).ok, 'flattening the empties clears them');
  assert.equal(st.shop.deliveries.trash, 0);
});

test('the vacuum is owned when its BOX is opened, not when the truck arrives', () => {
  const st = newGame('relaxed', 42);
  orderAndArrive(st, 'vac1', 1);
  assert.equal(vacuumOwned(st), false, 'still boxed on the pad');
  const box = boxesOf(st)[0];
  openBox(st, box.id);
  assert.equal(vacuumOwned(st), true, 'owned once unboxed');
});

test('pro-shop staff open the morning deliveries before they shelve', () => {
  const st = newGame('relaxed', 42);
  st.staff.employees.push({ id: 999, role: ROLE.PROSHOP, name: 'Pat', skill: 3, wage: 90, trainingDays: 0 });
  orderAndArrive(st, 'balls1', 24);
  assert.ok(boxesOf(st).length > 0, 'the truck left boxes');
  const moved = restockShelvesByStaff(st);
  assert.equal(boxesOf(st).length, 0, 'staff opened every box');
  assert.ok(moved > 0, 'and shelved the stock');
  assert.ok(st.shop.inventory.balls1.shelf > 0, 'the shelves gained real units');
});

test('boxes survive save/load exactly; pre-delivery saves migrate clean', () => {
  const st = newGame('relaxed', 42);
  orderAndArrive(st, 'towel1', 12);
  pickUpBox(st, boxesOf(st)[0].id);
  putDownBox(st, boxesOf(st)[0].id);
  const loaded = deserialize(serialize(st));
  assert.deepEqual(loaded.shop.deliveries, st.shop.deliveries, 'boxes round-trip exactly');

  const raw = JSON.parse(serialize(st));
  delete raw.shop.deliveries;
  const migrated = deserialize(JSON.stringify(raw));
  assert.ok(migrated.shop.deliveries, 'old saves gain the deliveries block');
  assert.equal(migrated.shop.deliveries.boxes.length, 0, 'empty, no phantom boxes');
  ensureDeliveries(migrated); // idempotent
  assert.ok(Array.isArray(migrated.shop.deliveries.boxes));
});
