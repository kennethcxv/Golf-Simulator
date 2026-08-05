// A driver does not arrive in a glove box.
//
// Every delivery, whatever it was, came in one identical 0.52 x 0.40 x 0.46 carton — so a golf bag
// and a sleeve of tees looked exactly the same on the receiving pad, and the stockroom read as a
// pile of clones. The brief wants content-driven packaging: small accessories cartons, ball cases,
// apparel cartons, shoe boxes, long club boxes, bag cartons.
//
// The size is data, not a magic number in the mesh builder, so the carton, its collider, how much
// it blocks a doorway, and how it stacks all agree.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { SHOP_CATALOG, skuById } from '../src/data/shopItems.js';
import { boxesOf, arriveOrder } from '../src/sim/deliveries.js';
import { BOX_KINDS, boxKindFor, boxDims } from '../src/data/boxes.js';

test('there is a real range of packaging, not one carton for everything', () => {
  const kinds = Object.values(BOX_KINDS);
  assert.ok(kinds.length >= 5, `several kinds of box (${kinds.length})`);
  const vols = kinds.map((k) => k.w * k.h * k.d);
  assert.ok(Math.max(...vols) / Math.min(...vols) > 4,
    'the biggest is meaningfully bigger than the smallest');
  for (const k of kinds) {
    assert.ok(k.w > 0.1 && k.w < 2.0, `${k.id} is a plausible width (${k.w})`);
    assert.ok(k.h > 0.05 && k.h < 1.6, `${k.id} is a plausible height (${k.h})`);
    assert.ok(k.label, `${k.id} has a name a person would use`);
  }
});

test('a club ships in a long box and a tee bag does not', () => {
  const driver = SHOP_CATALOG.find((s) => s.cat === 'clubs');
  const tees = SHOP_CATALOG.find((s) => s.cat === 'accessories');
  const clubBox = boxDims(boxKindFor(driver));
  const smallBox = boxDims(boxKindFor(tees));
  // the distinguishing feature of a club box is that it is 45 inches long, not that it is bulky
  assert.ok(clubBox.w > smallBox.w * 2.5, `a club box is long (${clubBox.w} vs ${smallBox.w})`);
  assert.ok(clubBox.h < smallBox.h, 'and flat - it is a sleeve, not a crate');
});

test('a golf bag gets the tallest carton on the pad', () => {
  const bagKind = BOX_KINDS.bagcarton;
  for (const k of Object.values(BOX_KINDS)) {
    if (k.id === 'bagcarton') continue;
    assert.ok(bagKind.h >= k.h, `a bag carton stands taller than a ${k.id}`);
  }
  assert.ok(bagKind.h > 0.9, 'tall enough to be a genuine nuisance to carry, which is the point');
});

test('every catalog line has packaging - nothing falls through to a default', () => {
  for (const sku of SHOP_CATALOG) {
    const kind = boxKindFor(sku);
    assert.ok(kind, `${sku.id} (${sku.cat}) has a box kind`);
    assert.ok(BOX_KINDS[kind.id], `${sku.id} maps to a real kind`);
  }
});

test('a delivered box carries its packaging with it, and it survives a save', () => {
  const st = newGame('relaxed', 4);
  const driver = SHOP_CATALOG.find((s) => s.cat === 'clubs');
  arriveOrder(st, { id: 1, skuId: driver.id, qty: 4 });

  const boxes = boxesOf(st);
  assert.ok(boxes.length > 0, 'something arrived');
  const b = boxes[0];
  assert.ok(b.box, `the carton knows what kind it is (${JSON.stringify(b.box)})`);
  assert.equal(b.box, boxKindFor(driver).id);
  assert.equal(b.box, 'clubbox');

  const loaded = JSON.parse(JSON.stringify(st));
  assert.equal(boxesOf(loaded)[0].box, b.box, 'and it comes back the same size');
});

test('two different products on the same pad look different', () => {
  const st = newGame('relaxed', 4);
  const club = SHOP_CATALOG.find((s) => s.cat === 'clubs');
  const balls = SHOP_CATALOG.find((s) => s.cat === 'balls');
  const tees = SHOP_CATALOG.find((s) => s.cat === 'accessories');
  arriveOrder(st, { id: 1, skuId: club.id, qty: 2 });
  arriveOrder(st, { id: 2, skuId: balls.id, qty: 12 });
  arriveOrder(st, { id: 3, skuId: tees.id, qty: 12 });

  const kinds = new Set(boxesOf(st).map((b) => b.box));
  assert.ok(kinds.size >= 3, `the pad is not a pile of clones (${[...kinds].join(', ')})`);
});

test('the carton is big enough to hold what is in it', () => {
  // a case of 12 dozen balls should not ship in a box the size of a matchbox
  for (const sku of SHOP_CATALOG) {
    const d = boxDims(boxKindFor(sku));
    const vol = d.w * d.h * d.d;
    assert.ok(vol > 0.01, `${sku.id}'s carton has real volume (${vol.toFixed(3)})`);
  }
});
