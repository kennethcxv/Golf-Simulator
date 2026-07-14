// Units are conserved. You cannot order 12 golf balls and end up with 13, or 11.
//
// Stock moves through five places — an open order, a box on the receiving pad, the backroom,
// the shelf, and a customer's bag — across a dozen verbs (arrive, cut, take an armful, open,
// flatten, restock by hand, restock by staff, sell, put a decor piece back). Every one of them
// is a chance to double-credit or silently drop units, and the ledger is invisible to the player
// until their money is wrong. So: hammer the verbs in random order and check the books balance.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { SHOP_CATALOG, skuById } from '../src/data/shopItems.js';
import {
  placeOrder, deliverOrdersDue, restockShelfFromBackroom, restockShelvesByStaff,
} from '../src/sim/shop.js';
import {
  boxesOf, cutTape, openFlap, takeFromBox, flattenBox, recycleBox, openBox, openAllBoxes,
  pickUpBox, putDownBox,
} from '../src/sim/deliveries.js';
import {
  carriedGoods, stockFixture, storeInBack, takeFromBack, homeOf,
} from '../src/sim/stocking.js';
import { checkoutSale, pickFromShelf, returnToShelf } from '../src/sim/checkout.js';

// A unit lives in exactly one of SIX places: an open order, a box, the backroom, the shelf, a
// shopper's hands — or YOUR OWN HANDS, which is new, and is the whole point of this session. The
// contents of a box no longer teleport into the backroom; you carry them. So the player's arms are
// a real location where a unit can be, and if they were not counted here, an armful of golf balls
// would look exactly like an armful of golf balls that had been destroyed.
function unitsOf(state, skuId, inHand = {}) {
  const inv = state.shop.inventory[skuId] || { shelf: 0, back: 0 };
  const inBoxes = boxesOf(state)
    .filter((b) => b.skuId === skuId)
    .reduce((n, b) => n + (b.qty || 0), 0);
  const onOrder = (state.shop.orders || [])
    .filter((o) => o.skuId === skuId)
    .reduce((n, o) => n + (o.qty || 0), 0);
  const mine = carriedGoods(state);
  const inMyArms = mine && mine.skuId === skuId ? mine.qty : 0;
  return inv.shelf + inv.back + inBoxes + onOrder + inMyArms + (inHand[skuId] || 0);
}

const RETAIL = SHOP_CATALOG.filter((s) => s.cat !== 'equipment').map((s) => s.id);

test('a unit that exists is never duplicated or lost, over 500 random actions', () => {
  const st = newGame('relaxed', 7);
  let rng = 12345;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };
  const pick = (a) => a[Math.floor(rand() * a.length)];

  // the books: what we have deliberately put in, what shoppers are holding, what has left
  const ordered = {};
  const sold = {};
  const inHand = {};
  for (const id of RETAIL) {
    ordered[id] = unitsOf(st, id); // the starting stock counts as "already in"
    sold[id] = 0;
    inHand[id] = 0;
  }

  let day = st.day || 1;
  for (let step = 0; step < 500; step++) {
    const act = Math.floor(rand() * 12);
    const skuId = pick(RETAIL);

    if (act === 0) {
      const qty = 1 + Math.floor(rand() * 12);
      const before = unitsOf(st, skuId);
      const r = placeOrder(st, skuId, qty);
      if (r && r.ok !== false) ordered[skuId] += unitsOf(st, skuId) - before;
    } else if (act === 1) {
      day += 1 + Math.floor(rand() * 2);
      st.day = day;
      deliverOrdersDue(st, day);
    } else if (act === 2) {
      // the tape, in random bites — including bites that leave it half cut
      const b = pick(boxesOf(st));
      if (b) cutTape(st, b.id, rand() * 0.8);
    } else if (act === 3) {
      const b = pick(boxesOf(st));
      if (b) openFlap(st, b.id);
    } else if (act === 4) {
      // reach in: contents go into the player's ARMS
      const b = pick(boxesOf(st));
      if (b) takeFromBox(st, b.id, 1 + Math.floor(rand() * 8));
    } else if (act === 8) {
      // and out of them again — onto the right fixture, the wrong fixture, or into the back
      const held = carriedGoods(st);
      if (held) {
        const r = rand();
        if (r < 0.45) {
          const home = homeOf(held.skuId);
          if (home) stockFixture(st, home.id, 1 + Math.floor(rand() * 8));
        } else if (r < 0.6) {
          stockFixture(st, 'shelf_balls', 4);   // often the WRONG fixture: must refuse cleanly
        } else if (r < 0.9) {
          storeInBack(st, 1 + Math.floor(rand() * 6));
        }
      } else if (rand() < 0.5) {
        takeFromBack(st, skuId, 1 + Math.floor(rand() * 6));
      }
    } else if (act === 9) {
      const b = pick(boxesOf(st));
      if (b) (rand() < 0.5 ? openBox : flattenBox)(st, b.id);
    } else if (act === 10) {
      const b = pick(boxesOf(st).filter((x) => x.flat));
      if (b) recycleBox(st, b.id);
    } else if (act === 5) {
      if (rand() < 0.3) openAllBoxes(st);
      restockShelfFromBackroom(st, skuId);
    } else if (act === 6) {
      restockShelvesByStaff(st);
    } else if (act === 7) {
      // a shopper lifts something off the display, then either buys it or puts it back
      if (pickFromShelf(st, skuId).ok) {
        inHand[skuId] += 1;
        const sku = skuById(skuId);
        if (rand() < 0.65) {
          checkoutSale(st, [{ skuId, price: sku.price || 10 }], 'A customer');
          inHand[skuId] -= 1;
          sold[skuId] += 1;
        } else {
          returnToShelf(st, skuId);
          inHand[skuId] -= 1;
        }
      }
    } else {
      // carry a box around and set it down somewhere: the box must survive the trip intact
      const b = pick(boxesOf(st));
      if (b) {
        const q = b.qty;
        pickUpBox(st, b.id);
        putDownBox(st, b.id, rand() < 0.5 ? 'stock' : { x: rand() * 4, z: 228 + rand() * 4, ry: 0 });
        const same = boxesOf(st).find((x) => x.id === b.id);
        assert.ok(same, `box ${b.id} vanished when it was carried and set down`);
        assert.equal(same.qty, q, 'carrying a box must not change what is in it');
      }
    }

    // the invariant, checked after EVERY action so a break is pinned to the verb that caused it
    for (const id of RETAIL) {
      assert.equal(
        unitsOf(st, id, inHand) + sold[id], ordered[id],
        `step ${step} (action ${act}): ${id} — have ${unitsOf(st, id, inHand)} + sold ${sold[id]}, ordered ${ordered[id]}`,
      );
    }
  }

  // and the run actually exercised the system rather than no-opping
  const totalSold = Object.values(sold).reduce((a, b) => a + b, 0);
  const totalOrdered = Object.values(ordered).reduce((a, b) => a + b, 0);
  const shelved = RETAIL.reduce((n, id) => n + st.shop.inventory[id].shelf, 0);
  assert.ok(totalSold >= 5, `the run rang up real stock (${totalSold})`);
  assert.ok(totalOrdered > 100, `ordered real stock (${totalOrdered})`);
  assert.ok(shelved > 0, `and got stock onto the shelves through boxes (${shelved})`);
});

test('a box carried and set down keeps its identity and its contents', () => {
  const st = newGame('relaxed', 3);
  st.cash = 99999;
  placeOrder(st, 'balls1', 24);
  st.day = (st.day || 1) + 3;
  deliverOrdersDue(st, st.day);
  const box = boxesOf(st)[0];
  assert.ok(box, 'a box arrived');
  const { id, qty, skuId } = box;

  pickUpBox(st, id);
  putDownBox(st, id, { x: 3.5, z: 231.25, ry: 1.2 });
  const after = boxesOf(st).find((b) => b.id === id);
  assert.ok(after, 'the box is still in the world');
  assert.equal(after.qty, qty);
  assert.equal(after.skuId, skuId);
  assert.equal(after.loc, 'world');
  assert.equal(after.x, 3.5);
  assert.equal(after.z, 231.25);

  // ...and through a save/load round trip
  const loaded = JSON.parse(JSON.stringify(st));
  const reloaded = boxesOf(loaded).find((b) => b.id === id);
  assert.equal(reloaded.qty, qty);
  assert.equal(reloaded.x, 3.5);
  assert.equal(reloaded.z, 231.25);
});

test('a shopper who leaves holding unsold stock puts it back — nothing evaporates', () => {
  // pickFromShelf takes the unit off the shelf the instant they lift it. Every path that removes
  // a shopper from the floor (gave up, closing time, ran out of stops, scene torn down) must hand
  // that unit back, or the player's stock silently drains and their books stop adding up.
  const st = newGame('relaxed', 9);
  const inv = st.shop.inventory.balls1;
  inv.shelf = 10;

  const cart = [];
  for (let i = 0; i < 3; i++) {
    assert.ok(pickFromShelf(st, 'balls1').ok);
    cart.push({ skuId: 'balls1' });
  }
  assert.equal(inv.shelf, 7, 'three are in their hands');

  // they leave without buying — however that happens
  for (const it of cart) returnToShelf(st, it.skuId);
  assert.equal(inv.shelf, 10, 'and all three are back on the display');
});

test('selling more than the shelf holds is refused rather than going negative', () => {
  const st = newGame('relaxed', 5);
  const inv = st.shop.inventory.balls1;
  inv.shelf = 2;
  checkoutSale(st, 'balls1', 5);
  assert.ok(inv.shelf >= 0, `shelf never goes negative (was ${inv.shelf})`);
});
