// THE MANUAL ACCEPTANCE TEST, AS A TEST.
//
// The brief's acceptance script: order and receive a small accessory, a golf-ball case, apparel, a
// club, a golf bag and a fixture; drop every box a few times; SAVE WITH BOXES PARTIALLY OPENED;
// reload; finish stocking. The manual run (with screenshots) lives in tools/qa; this pins the part
// a screenshot cannot — that not one unit is created or lost across the whole thing, and that a
// half-unpacked shipment survives the save exactly as it stood.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { placeOrder, tickDeliveries } from '../src/sim/shop.js';
import { skuById } from '../src/data/shopItems.js';
import {
  boxesOf, shipmentsOf, shipmentStatus, cutTape, openFlap, takeFromBox,
  flattenBox, recycleBox, pickUpBox, putDownBox, boxState, flapsOpen,
} from '../src/sim/deliveries.js';
import { exposedDeliveryPadBoxIds } from '../src/data/deliveryStaging.js';
import {
  carriedGoods, stockFixture, storeInBack, homeOf,
} from '../src/sim/stocking.js';

// One of each of the six kinds the brief names. Quantities chosen so the whole delivery is seven
// cartons — under the nine the receiving pad holds, because a real delivery has to fit on the pad
// (that a bigger order would need unpacking between vans is its own tested behaviour).
const ORDER = [
  ['tees1', 20],    // small accessories carton — 2 boxes (12 + 8)
  ['balls1', 12],   // golf-ball case — 1 box
  ['polo1', 8],     // apparel carton — 1 box
  ['driver1', 2],   // long club carton — 1 box
  ['bag1', 1],      // golf-bag carton — 1 box
  ['light1', 1],    // fixture package — 1 box
];

function totalUnits(st) {
  const acc = {};
  const add = (id, n) => { acc[id] = (acc[id] || 0) + n; };
  for (const inv of Object.entries(st.shop.inventory)) add(inv[0], inv[1].shelf + inv[1].back);
  for (const b of boxesOf(st)) add(b.skuId, b.qty || 0);
  for (const o of st.shop.orders) add(o.skuId, o.qty);
  const c = carriedGoods(st);
  if (c) add(c.skuId, c.qty);
  return acc;
}

test('order six kinds, receive them, and the pad holds exactly what was ordered', () => {
  const st = newGame('relaxed', 11);
  st.cash = 200000;
  st.shop.unlockedTier = 3;

  const want = {};
  for (const [id, q] of ORDER) {
    const r = placeOrder(st, id, q);
    assert.ok(r.ok, `${id} ordered`);
    want[id] = (want[id] || 0) + q;
  }
  // land every order
  for (let i = 0; i < ORDER.length; i++) {
    const o = st.shop.orders[0];
    if (!o) break;
    tickDeliveries(st, o.deliveryMin + 1);
  }
  assert.equal(st.shop.orders.length, 0, 'all six landed');
  assert.equal(shipmentsOf(st).length, 6, 'six shipments on the floor');

  for (const [id, q] of ORDER) {
    const inCartons = boxesOf(st).filter((b) => b.skuId === id).reduce((a, b) => a + b.qty, 0);
    assert.equal(inCartons, q, `${skuById(id).name}: the cartons hold exactly the ${q} ordered`);
  }
});

test('drop every box a few times: identities and contents survive, nothing duplicates', () => {
  const st = newGame('relaxed', 12);
  st.cash = 200000; st.shop.unlockedTier = 3;
  for (const [id, q] of ORDER) placeOrder(st, id, q);
  for (let i = 0; i < ORDER.length; i++) { const o = st.shop.orders[0]; if (o) tickDeliveries(st, o.deliveryMin + 1); }

  const before = totalUnits(st);
  const ids = boxesOf(st).map((b) => b.id);
  const staged = boxesOf(st).map((entry) => ({ ...entry }));
  const pickupOrder = [];
  while (staged.length) {
    const exposed = exposedDeliveryPadBoxIds(staged);
    const next = staged.find((entry) => exposed.has(entry.id));
    pickupOrder.push(next.id);
    staged.splice(staged.indexOf(next), 1);
  }
  // pick each box up and set it down three times, in different spots
  for (const id of pickupOrder) {
    for (let k = 0; k < 3; k++) {
      const up = pickUpBox(st, id);
      assert.ok(up.ok, `box ${id} lifted (drop ${k})`);
      putDownBox(st, id, { x: 6 + (k * 0.3), z: -5 + (id % 3) * 0.4, ry: k });
      const still = boxesOf(st).find((b) => b.id === id);
      assert.ok(still, `box ${id} did not vanish on drop ${k}`);
    }
  }
  assert.deepEqual(totalUnits(st), before, 'dropping boxes created and destroyed nothing');
  assert.equal(new Set(boxesOf(st).map((b) => b.id)).size, ids.length, 'no box duplicated');
});

test('THE ACCEPTANCE FLOW: partially open, SAVE, reload, finish stocking — conserved throughout', () => {
  let st = newGame('relaxed', 13);
  st.cash = 200000; st.shop.unlockedTier = 3;
  for (const [id, q] of ORDER) placeOrder(st, id, q);
  for (let i = 0; i < ORDER.length; i++) { const o = st.shop.orders[0]; if (o) tickDeliveries(st, o.deliveryMin + 1); }

  const grandTotal = totalUnits(st);

  // partially open TWO of the shipments: cut, open flaps, take one armful, leave the rest
  const partials = ['balls1', 'polo1'];
  for (const id of partials) {
    const box = boxesOf(st).find((b) => b.skuId === id);
    cutTape(st, box.id, 1);
    openFlap(st, box.id); openFlap(st, box.id); openFlap(st, box.id);
    const t = takeFromBox(st, box.id);
    assert.ok(t.ok);
    storeInBack(st);   // put the armful in the back so we can open the next box
    assert.ok(box.qty > 0, `${id} is a PARTIAL box — some left in the cardboard`);
    assert.equal(boxState(box), 'partial contents');
  }
  // the shipments report partially unpacked
  for (const sh of shipmentsOf(st)) {
    if (partials.includes(sh.skuId)) assert.equal(shipmentStatus(st, sh), 'partial');
  }

  // --- SAVE (a plain JSON round trip, exactly what the game's autosave does) ---
  const saved = JSON.stringify(st);
  st = JSON.parse(saved);
  // the game touches deliveries through ensureDeliveries on load; force it
  boxesOf(st);

  // everything came back exactly
  assert.deepEqual(totalUnits(st), grandTotal, 'the save conserved every unit');
  for (const id of partials) {
    const box = boxesOf(st).find((b) => b.skuId === id);
    assert.ok(box, `${id}'s partial box survived the save`);
    assert.equal(box.tape, 1, 'still cut');
    assert.deepEqual(box.flaps, [1, 1], 'still open');
    assert.ok(box.qty > 0 && box.qty < box.cap, 'still partial');
  }

  // --- FINISH STOCKING: empty every box, take the goods to their fixtures ---
  let guard = 300;
  while (guard-- > 0) {
    const box = boxesOf(st).find((b) => b.qty > 0 && b.loc !== 'carried');
    if (!box) break;
    if (!boxesOf(st).find((b) => b.id === box.id).tape) cutTape(st, box.id, 1);
    if (box.tape < 1) cutTape(st, box.id, 1);
    for (let phase = 0; phase < 3 && !flapsOpen(box); phase += 1) openFlap(st, box.id);
    const t = takeFromBox(st, box.id);
    if (!t.ok) break;
    const held = carriedGoods(st);
    const home = held ? homeOf(held.skuId) : null;
    if (home) {
      const r = stockFixture(st, home.id, 99);
      if (!r.ok || carriedGoods(st)) storeInBack(st);   // shelf full or non-retail -> to the back
    } else {
      storeInBack(st);                                  // the fixture package has no shelf
    }
  }

  // every carton is empty; break them down and recycle
  for (const box of [...boxesOf(st)]) {
    if (box.qty <= 0) { flattenBox(st, box.id); recycleBox(st, box.id); }
  }

  assert.deepEqual(totalUnits(st), grandTotal, 'finishing the job conserved every unit');
  assert.equal(boxesOf(st).length, 0, 'all the cardboard is recycled');
  assert.equal(carriedGoods(st), null, 'hands empty');
  assert.equal(shipmentsOf(st).length, 0, 'every shipment cleared once its last carton was binned');
  assert.ok(st.shop.deliveries.recycled >= 6, 'and the recycling counted them');

  // the retail lines are on the shelf or in the back — not lost to the fixture package's non-home
  for (const [id] of ORDER) {
    if (id === 'light1') continue;   // a fixture package has no retail home; it lives in the back
    const inv = st.shop.inventory[id];
    assert.ok(inv.shelf + inv.back > 0, `${skuById(id).name} ended up stocked, not lost`);
  }
});
