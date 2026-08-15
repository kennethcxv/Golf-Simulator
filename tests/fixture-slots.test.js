// A SHELF HOLDS WHAT IT HAS ROOM FOR.
//
// Capacity used to be a number in a table (SHELF_CAP: accessories 24) and the renderer used to be
// a separate opinion about how many things to draw (`Math.min(count, 12)`). Those two numbers were
// never checked against each other, so:
//
//   - a full accessories shelf (24) drew twelve, and looked half empty at capacity;
//   - a full ball wall (24) drew fifteen, plus a decorative second row of boxes behind them that
//     represented no stock at all — the definition of visually faking a full shelf;
//   - `bag1`'s category is 'accessories', so a golf-bag platform had a capacity of TWENTY-FOUR
//     stand bags and drew four;
//   - and the three ball lanes were laid out 0.52 apart while each lane was 0.69 wide, so the
//     lanes overlapped and the boxes of one line grew through the boxes of the next.
//
// So capacity is not a number any more. It is the number of PLACES there are to put one. The sim
// asks how many slots a line has; the renderer puts one item in each slot. They cannot disagree,
// because there is only one of them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOP_CATALOG, skuById, RETAIL_CATS } from '../src/data/shopItems.js';
import { FIXTURES, FIXTURE_HALF } from '../src/data/shopLayout.js';
import {
  APPAREL_TINTS, slotsFor, capacityOf, homeFixture, laneOf,
  stockPresentationState, visibleSlotsFor,
} from '../src/data/fixtureSlots.js';
import { shelfCapacity } from '../src/sim/shop.js';

const onSale = SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat));

test('every line for sale has a fixture to live on, and a real number of places on it', () => {
  for (const sku of onSale) {
    const f = homeFixture(sku.id);
    assert.ok(f, `${sku.id} has a home fixture`);
    assert.ok(f.skus.includes(sku.id), `${sku.id} is on ${f.id}'s list`);
    const cap = capacityOf(sku.id);
    assert.ok(cap >= 4 && cap <= 40, `${sku.id} holds a plausible number (${cap})`);
    assert.equal(slotsFor(sku.id).length, cap, 'capacity IS the slot count');
  }
});

test('THE INVARIANT: the shelf capacity the sim enforces is the number of slots the shop can show', () => {
  for (const sku of onSale) {
    assert.equal(
      shelfCapacity(sku), capacityOf(sku.id),
      `${sku.id}: the sim would let you stack ${shelfCapacity(sku)} where there are ${capacityOf(sku.id)} places to put one`,
    );
  }
});

test('a shared golf-bag platform gives each line four physical positions, not category capacity', () => {
  assert.equal(capacityOf('bag1'), 4);
  assert.equal(capacityOf('bag3'), 4);
  assert.equal(shelfCapacity(skuById('bag1')), 4);
  // and the category default it used to inherit is nothing to do with it
  assert.notEqual(capacityOf('bag1'), capacityOf('tees1'));
});

test('Asset 20 has one stable outerwear home with four hanging and four folded places', () => {
  const rail = homeFixture('jacket2');
  assert.equal(rail.id, 'rail_outer');
  assert.equal(rail.kind, 'rail');
  assert.deepEqual(rail.skus, ['jacket2']);
  const slots = slotsFor('jacket2');
  assert.equal(capacityOf('jacket2'), 8);
  assert.deepEqual(slots.map((s) => s.socketName), [
    'APPAREL_HANGER_SLOT_01', 'APPAREL_HANGER_SLOT_02',
    'APPAREL_HANGER_SLOT_03', 'APPAREL_HANGER_SLOT_04',
    'APPAREL_FOLD_SLOT_01', 'APPAREL_FOLD_SLOT_02',
    'APPAREL_FOLD_SLOT_03', 'APPAREL_FOLD_SLOT_04',
  ]);
  assert.ok(slots.slice(0, 4).every((s) => !s.folded));
  assert.ok(slots.slice(4).every((s) => s.folded));
  assert.deepEqual(slots.slice(0, 4).map((s) => s.tint), [...APPAREL_TINTS]);
  assert.deepEqual(slots.slice(4).map((s) => s.tint), [...APPAREL_TINTS]);
  assert.ok(slots[4].y < slots[6].y, 'folded stock fills the lower shelf first');
});

test('no two items on a fixture stand in the same place', () => {
  // The ball lanes used to be pitched 0.52 apart and drawn 0.69 wide, so the Tour-soft boxes grew
  // through the Pro-V boxes. A slot is a place; two things cannot be in one.
  for (const f of FIXTURES) {
    if (!f.skus.length) continue;
    const seen = [];
    for (const id of f.skus) {
      for (const s of slotsFor(id)) {
        for (const p of seen) {
          const d = Math.hypot(s.x - p.x, (s.y - p.y) * 2, s.z - p.z);
          assert.ok(d > 0.06, `${f.id}: two slots on top of each other at (${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})`);
        }
        seen.push(s);
      }
    }
  }
});

test('every slot is inside the fixture it belongs to - nothing hangs in mid-air off the end', () => {
  for (const f of FIXTURES) {
    if (!f.skus.length) continue;
    const [hx, hz] = FIXTURE_HALF[f.kind] || [1.6, 0.5];
    for (const id of f.skus) {
      for (const s of slotsFor(id)) {
        assert.ok(Math.abs(s.x) <= hx + 0.15, `${id}: a slot at x=${s.x.toFixed(2)} is off the end of a ${f.kind} (half ${hx})`);
        assert.ok(Math.abs(s.z) <= hz + 0.35, `${id}: a slot at z=${s.z.toFixed(2)} is off the front of a ${f.kind} (half ${hz})`);
        assert.ok(s.y >= 0 && s.y <= 2.3, `${id}: a slot at y=${s.y.toFixed(2)} is off the top`);
      }
    }
  }
});

test('the lanes of a shared fixture do not grow through each other', () => {
  const balls = FIXTURES.find((f) => f.id === 'shelf_balls');
  assert.equal(balls.skus.length, 3, 'three lines share the ball wall');
  const spans = balls.skus.map((id) => {
    const xs = slotsFor(id).map((s) => s.x);
    return { id, lane: laneOf(id), min: Math.min(...xs), max: Math.max(...xs) };
  }).sort((a, b) => a.lane - b.lane);
  for (let i = 1; i < spans.length; i++) {
    assert.ok(
      spans[i].min > spans[i - 1].max,
      `${spans[i - 1].id} runs to x=${spans[i - 1].max.toFixed(2)} and ${spans[i].id} starts at x=${spans[i].min.toFixed(2)}`,
    );
  }
});

test('slots are ordered so a part-full shelf fills from the bottom, not from thin air', () => {
  // Three boxes on a wall unit sit on the BOTTOM board. They do not float on the top one with
  // nothing under them, which is what an unordered slot list gives you.
  const s = slotsFor('balls1');
  assert.ok(s[0].y <= s[s.length - 1].y, 'the first slots are the low ones');
  const firstBoard = s.slice(0, 5).map((p) => p.y);
  assert.ok(Math.max(...firstBoard) - Math.min(...firstBoard) < 0.01, 'and the first five share a board');
});

test('empty, partial and full visual states show exactly the saved quantity', () => {
  for (const sku of onSale) {
    const cap = capacityOf(sku.id);
    const partial = Math.max(1, Math.floor(cap / 2));
    assert.deepEqual(stockPresentationState(sku.id, 0), { count: 0, capacity: cap, state: 'empty' });
    assert.deepEqual(stockPresentationState(sku.id, partial), { count: partial, capacity: cap, state: 'partial' });
    assert.deepEqual(stockPresentationState(sku.id, cap), { count: cap, capacity: cap, state: 'full' });
    assert.equal(visibleSlotsFor(sku.id, cap + 99).length, cap, `${sku.id} cannot render phantom overflow`);
    assert.equal(visibleSlotsFor(sku.id, -5).length, 0, `${sku.id} cannot render negative stock`);
  }
});
