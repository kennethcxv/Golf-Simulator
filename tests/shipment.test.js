// AN ORDER IS A SHIPMENT, NOT A LINE ITEM.
//
// The brief wants an order to carry: order time, processing time, delivery day, arrival window,
// supplier, delivery fee, number of boxes, box dimensions, estimated weight and status. Most of
// those did not exist — you paid a number and boxes appeared.
//
// The load-bearing property here is that the MANIFEST IS A PROMISE. The laptop tells you three
// boxes and forty-one pounds before the van leaves; three boxes and forty-one pounds is what has
// to be standing on the pad. If the manifest were computed twice — once for the screen, once for
// the world — they would drift, and the screen would be lying by a box.
//
// Statuses split across two lists, and that split is deliberate: `shop.orders` means IN TRANSIT
// (every reader in the game treats it that way — the Home page's "on the truck", the Finances
// page's "stock already paid for", the conservation test's on-order units). A landed shipment
// therefore leaves `orders` and becomes a `shipment`, whose state is DERIVED from its boxes.
// Six statuses on the truck, three on the floor: exactly the brief's nine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  placeOrder, cancelOrder, deliverOrdersDue, tickDeliveries,
} from '../src/sim/shop.js';
import { skuById, SHOP_CATALOG } from '../src/data/shopItems.js';
import { planShipment, unitsPerBox, boxKindFor, BOX_KINDS } from '../src/data/boxes.js';
import { supplierFor, SUPPLIERS } from '../src/data/suppliers.js';
import {
  boxesOf, shipmentsOf, shipmentStatus, ORDER_FLOW,
  PAD_CAPACITY, FALLBACK_CAPACITY, padCount as padCountOf, fallbackCount,
} from '../src/sim/deliveries.js';

const setup = () => {
  const s = newGame('relaxed', 7);
  s.cash = 90000;
  s.shop.unlockedTier = 3;
  s.shop.progression.tier = 'luxury';
  return s;
};

test('every catalog line has a supplier, a unit weight and a box that holds a whole number of it', () => {
  for (const sku of SHOP_CATALOG) {
    const sup = supplierFor(sku);
    assert.ok(sup && sup.name, `${sku.id} ships from someone`);
    assert.ok(SUPPLIERS[sup.id], `${sku.id}'s supplier is a real one`);
    assert.ok(typeof sku.lb === 'number' && sku.lb > 0, `${sku.id} has a real weight (${sku.lb})`);
    const per = unitsPerBox(sku);
    assert.ok(Number.isInteger(per) && per >= 1, `${sku.id} packs a whole number per box (${per})`);
    assert.ok(BOX_KINDS[boxKindFor(sku).id], `${sku.id} has real packaging`);
  }
});

test('a golf bag ships one to a carton - the per-category default would have sent twelve', () => {
  // bag1's CATEGORY is 'accessories', which packs twelve to a carton. Twelve stand bags in one
  // box is the kind of thing a category default does to you when nobody looks at the result.
  assert.equal(unitsPerBox(skuById('bag1')), 1);
  assert.equal(unitsPerBox(skuById('irons1')), 1, 'an iron set is already eight clubs');
  assert.equal(unitsPerBox(skuById('tees1')), 12, 'but tee bags really do pack twelve');
});

test('the manifest is a promise: what the screen says is what lands on the pad', () => {
  const s = setup();
  const res = placeOrder(s, 'balls2', 30); // 30 dozen: 12 to a case -> 3 cases (12/12/6)
  assert.ok(res.ok);
  const o = s.shop.orders[0];

  assert.ok(o.manifest, 'the order carries its manifest');
  assert.equal(o.manifest.boxCount, 3, 'three cases');
  assert.equal(o.manifest.boxes.reduce((a, b) => a + b.qty, 0), 30, 'holding exactly what was ordered');
  assert.ok(o.manifest.weight > 0, 'and an estimated weight');
  assert.equal(o.manifest.supplier, supplierFor(skuById('balls2')).name);
  for (const b of o.manifest.boxes) {
    assert.ok(b.w > 0 && b.h > 0 && b.d > 0, 'every box on the manifest has dimensions');
    assert.ok(b.lb > 0, 'and a weight');
  }

  tickDeliveries(s, o.deliveryMin + 1);
  const landed = boxesOf(s).filter((b) => b.orderId === o.id);
  assert.equal(landed.length, o.manifest.boxCount, 'the pad has exactly the promised boxes');
  assert.equal(landed.reduce((a, b) => a + b.qty, 0), 30, 'holding exactly the promised units');
  assert.deepEqual(
    landed.map((b) => b.qty).sort(),
    o.manifest.boxes.map((b) => b.qty).sort(),
    'split the same way, too - not three boxes of ten',
  );
});

test('one order larger than the receiving pad is rejected before a cent is billed', () => {
  const s = setup();
  const cash0 = s.cash;
  const spent0 = s.ledger.today.expense.shopOrders || 0;
  const nextOrderId0 = s.shop.nextOrderId;

  const res = placeOrder(s, 'bag1', PAD_CAPACITY + 1); // one golf bag per carton

  assert.equal(res.ok, false);
  assert.equal(res.boxes, PAD_CAPACITY + 1);
  assert.equal(res.capacity, PAD_CAPACITY);
  assert.match(res.reason, /split.*smaller|holds 9/i);
  assert.equal(s.cash, cash0, 'cash never moved');
  assert.equal(s.ledger.today.expense.shopOrders || 0, spent0, 'the ledger was never billed');
  assert.equal(s.shop.orders.length, 0, 'no impossible paid order was created');
  assert.equal(s.shop.nextOrderId, nextOrderId0, 'a rejected order does not consume an id');
});

test('the delivery fee is real money, and cancelling gives back the fee as well as the goods', () => {
  const s = setup();
  const cash0 = s.cash;
  const spent0 = s.ledger.today.expense.shopOrders || 0;

  const p = placeOrder(s, 'driver1', 4);
  assert.ok(p.ok);
  assert.ok(p.fee > 0, 'freight is not free');
  assert.equal(p.cost, p.goods + p.fee, 'what you paid is goods plus freight');
  assert.equal(s.cash, cash0 - p.cost, 'and that is what left the account');

  const c = cancelOrder(s, s.shop.orders[0].id);
  assert.ok(c.ok);
  assert.equal(c.refund, p.cost, 'the freight comes back too - the van never rolled');
  assert.equal(s.cash, cash0);
  assert.equal(s.ledger.today.expense.shopOrders || 0, spent0, 'no trace in the books');
});

test('the status walks the whole flow - received to arriving - in order, and never backwards', () => {
  const s = setup();
  placeOrder(s, 'polo1', 8);
  const o = s.shop.orders[0];

  const seen = [];
  const span = o.deliveryMin - o.placedMin;
  for (let t = o.placedMin; t < o.deliveryMin; t += Math.max(1, Math.floor(span / 400))) {
    tickDeliveries(s, t);
    if (seen[seen.length - 1] !== o.status) seen.push(o.status);
  }
  assert.deepEqual(seen, ORDER_FLOW, `every status, in order (saw ${seen.join(' -> ')})`);
});

test('a shipment on the floor reports delivered, then partially unpacked, then fully unpacked', () => {
  const s = setup();
  placeOrder(s, 'balls1', 24); // two cases of twelve
  const o = s.shop.orders[0];
  tickDeliveries(s, o.deliveryMin + 1);

  assert.equal(s.shop.orders.length, 0, 'it is off the truck');
  const sh = shipmentsOf(s)[0];
  assert.ok(sh, 'and on the floor as a shipment');
  assert.equal(sh.orderId, o.id);
  assert.equal(shipmentStatus(s, sh), 'delivered');

  const boxes = boxesOf(s).filter((b) => b.orderId === o.id);
  boxes[0].qty = 4; // half-emptied by hand
  assert.equal(shipmentStatus(s, sh), 'partial', 'partially unpacked');

  for (const b of boxes) b.qty = 0;
  assert.equal(shipmentStatus(s, sh), 'unpacked', 'fully unpacked');
});

test('a full preferred pad uses safe fallback, while two full receiving zones block cleanly', () => {
  const s = setup();
  // fill the pad to its capacity with someone else's delivery
  for (let i = 0; i < PAD_CAPACITY; i++) {
    boxesOf(s).push({ id: 900 + i, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'pad', receivingSlot: i, box: 'carton' });
  }
  placeOrder(s, 'balls1', 12);
  const o = s.shop.orders[0];

  const events = tickDeliveries(s, o.deliveryMin + 1);
  assert.ok(events.some((event) => event.kind === 'arrived' && event.usedFallback), 'fallback arrival is reported');
  assert.equal(s.shop.orders.includes(o), false, 'the order arrived');
  assert.equal(boxesOf(s).filter((box) => box.orderId === o.id && box.loc === 'receiving-fallback').length, 1);

  while (fallbackCount(s) < FALLBACK_CAPACITY) {
    const id = 1000 + fallbackCount(s);
    boxesOf(s).push({ id, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'receiving-fallback', receivingSlot: fallbackCount(s), box: 'carton' });
  }
  placeOrder(s, 'balls2', 12);
  const blockedOrder = s.shop.orders[0];
  const blockedEvents = tickDeliveries(s, blockedOrder.deliveryMin + 1);
  assert.ok(blockedEvents.some((event) => event.kind === 'blocked'), 'the player is told when both zones are full');
  assert.ok(s.shop.orders.includes(blockedOrder), 'the paid order remains in transit');
  assert.equal(boxesOf(s).filter((box) => box.orderId === blockedOrder.id).length, 0);
});

test('two vans landing on the same minute cannot both take the last slot on the pad', () => {
  // Found by watching the running game, not by reading the code: the capacity check asked how
  // full the pad was, but the boxes of every order approved earlier in the SAME tick had not been
  // built yet (arriveOrder runs after the loop). So four vans arriving together each looked at an
  // empty pad, and the pad ended up over capacity. The check has to reserve as it goes.
  const s = setup();
  // room for exactly 2 more boxes
  for (let i = 0; i < PAD_CAPACITY - 2; i++) {
    boxesOf(s).push({ id: 800 + i, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'pad', box: 'carton' });
  }
  for (let i = 0; i < FALLBACK_CAPACITY; i++) {
    boxesOf(s).push({ id: 850 + i, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'receiving-fallback', box: 'carton' });
  }
  // three orders of two boxes each, all landing at the same minute
  placeOrder(s, 'balls1', 24);
  placeOrder(s, 'balls2', 24);
  placeOrder(s, 'balls3', 24);
  const when = Math.max(...s.shop.orders.map((o) => o.deliveryMin)) + 1;

  tickDeliveries(s, when);
  assert.ok(padCountOf(s) <= PAD_CAPACITY, `the pad never goes over capacity (${padCountOf(s)} of ${PAD_CAPACITY})`);
  assert.equal(s.shop.orders.length, 2, 'one landed; the other two are still circling');
  assert.ok(s.shop.orders.every((o) => o.blocked), 'and both know they were turned away');
});

test('the past-day delivery safety net obeys the same receiving capacity', () => {
  const s = setup();
  for (let i = 0; i < PAD_CAPACITY - 1; i++) {
    boxesOf(s).push({ id: 700 + i, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'pad', box: 'carton' });
  }
  placeOrder(s, 'tees1', 1);
  placeOrder(s, 'glove1', 1);
  const overdueDay = Math.max(...s.shop.orders.map((order) => order.arrivesDay)) + 1;

  const arrived = deliverOrdersDue(s, overdueDay);
  assert.equal(arrived.length, 1, 'only the one remaining pallet spot is admitted');
  assert.equal(padCountOf(s), PAD_CAPACITY);
  assert.equal(s.shop.orders.length, 1, 'the other paid order remains pending, not lost');
  assert.equal(s.shop.orders[0].blocked, true);
});

test('planShipment is pure - the same order always packs the same way', () => {
  const a = planShipment(skuById('shoe1'), 9);
  const b = planShipment(skuById('shoe1'), 9);
  assert.deepEqual(a, b);
  assert.equal(a.boxes.reduce((n, x) => n + x.qty, 0), 9);
  assert.ok(a.weight >= 9 * skuById('shoe1').lb, 'the cardboard weighs something too');
});
