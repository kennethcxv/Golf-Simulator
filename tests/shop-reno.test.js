// PRO SHOP RESTORATION — the shop starts rundown and is cleaned/furnished up
// through real player action. This file covers the sim side: the reno state
// (grime grid + clutter + decor), the 0-100 condition value derived from it,
// and the mutations the tools drive (vacuum cleaning, clutter hauling).
//
// The reno grid draws from a LOCAL rng derived from the save seed — never the
// shared state.rngState stream — so adding it can't shift any other system.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  RENO, shopCondition, cleanGrimeAt, clearClutter, ensureShopReno,
  placeOrder, deliverOrdersDue, vacuumOwned, restockShelvesByStaff, restockShelfFromBackroom,
} from '../src/sim/shop.js';
import { skuById, LEAD_DAYS, SHOP_CATALOG } from '../src/data/shopItems.js';
import { calendarOf } from '../src/sim/time.js';

const cellCenter = (cx, cy) => ({
  x: -RENO.room.w / 2 + (cx + 0.5) * (RENO.room.w / RENO.grid.w),
  z: -RENO.room.d / 2 + (cy + 0.5) * (RENO.room.d / RENO.grid.h),
});

test('a fresh game boots a visibly rundown shop: dirty grime grid, clutter, no decor', () => {
  const state = newGame('relaxed', 42);
  const reno = state.shop.reno;
  assert.ok(reno, 'state.shop.reno exists on a fresh game');
  assert.equal(reno.grime.length, RENO.grid.w * RENO.grid.h, 'one dirt value per floor cell');
  const avg = reno.grime.reduce((a, v) => a + v, 0) / reno.grime.length;
  assert.ok(avg >= 0.55 && avg <= 0.92, `average dirt ${avg.toFixed(2)} starts high (0.55-0.92)`);
  for (const v of reno.grime) assert.ok(v >= 0 && v <= 1, 'dirt values live on 0..1');
  assert.ok(reno.clutter.length >= 3, `${reno.clutter.length} clutter piles to haul out`);
  for (const c of reno.clutter) {
    assert.ok(Math.abs(c.x) < RENO.room.w / 2 && Math.abs(c.z) < RENO.room.d / 2, 'clutter sits inside the room');
    assert.equal(c.cleared, false, 'clutter starts uncleared');
  }
  assert.deepEqual(reno.decor, [], 'no decor placed yet');
});

test('shop condition is a 0-100 integer and starts low on a fresh game', () => {
  const state = newGame('relaxed', 42);
  const c = shopCondition(state);
  assert.equal(c, Math.round(c), 'condition is an integer');
  assert.ok(c >= 0 && c <= 100, 'condition lives on 0..100');
  assert.ok(c < 30, `fresh-game condition ${c} reads clearly rundown (< 30)`);
});

test('the grime layout is seed-deterministic', () => {
  const a = newGame('relaxed', 1234);
  const b = newGame('relaxed', 1234);
  assert.deepEqual(a.shop.reno.grime, b.shop.reno.grime, 'same seed, same dirt');
  assert.deepEqual(a.shop.reno.clutter, b.shop.reno.clutter, 'same seed, same clutter spots');
  const c = newGame('relaxed', 1235);
  assert.notDeepEqual(a.shop.reno.grime, c.shop.reno.grime, 'different seed, different dirt');
});

test('reno state never draws from the shared rng stream (stream-neutral migration)', () => {
  const state = newGame('relaxed', 7);
  const fresh = state.shop.reno.grime.slice();
  const rngBefore = state.rngState;
  delete state.shop.reno;
  ensureShopReno(state);
  assert.equal(state.rngState, rngBefore, 'ensureShopReno consumed nothing from state.rngState');
  assert.deepEqual(state.shop.reno.grime, fresh, 'rebuilt grime matches the original derivation');
  const again = state.shop.reno;
  ensureShopReno(state);
  assert.equal(state.shop.reno, again, 'ensureShopReno is a no-op when reno already exists');
});

test('cleaning a patch reduces dirt locally, floors at zero, and raises condition', () => {
  const state = newGame('relaxed', 42);
  const reno = state.shop.reno;
  const target = cellCenter(0, 0);
  const far = RENO.grid.w * RENO.grid.h - 1; // opposite corner cell
  const dirtBefore = reno.grime[0];
  const farBefore = reno.grime[far];
  const condBefore = shopCondition(state);

  const res = cleanGrimeAt(state, target.x, target.z, 0.3);
  assert.ok(res.cleaned > 0, 'cleaning near a dirty cell removes dirt');
  assert.ok(reno.grime[0] < dirtBefore, 'the aimed cell got cleaner');
  assert.equal(reno.grime[far], farBefore, 'the far corner is untouched');
  assert.ok(shopCondition(state) >= condBefore, 'condition never drops from cleaning');

  for (let i = 0; i < 12; i++) cleanGrimeAt(state, target.x, target.z, 0.5);
  assert.equal(reno.grime[0], 0, 'repeated cleaning floors the cell at zero');
  const res2 = cleanGrimeAt(state, target.x, target.z, 0.5);
  assert.equal(res2.cleaned, 0, 'cleaning an already-clean patch reports nothing removed');
});

test('cleaning the whole floor lifts cleanliness to its full 70-point share', () => {
  const state = newGame('relaxed', 42);
  for (let cy = 0; cy < RENO.grid.h; cy++) {
    for (let cx = 0; cx < RENO.grid.w; cx++) {
      const p = cellCenter(cx, cy);
      for (let i = 0; i < 8; i++) cleanGrimeAt(state, p.x, p.z, 0.6);
    }
  }
  assert.equal(shopCondition(state), 70, 'spotless floor + no decor = 70 (decor supplies the rest)');
});

test('hauling out clutter works once per pile and wipes the dirt under it', () => {
  const state = newGame('relaxed', 42);
  const reno = state.shop.reno;
  const pile = reno.clutter[0];
  const sumBefore = reno.grime.reduce((a, v) => a + v, 0);
  const res = clearClutter(state, 0);
  assert.ok(res.ok, 'first haul succeeds');
  assert.equal(pile.cleared, true);
  assert.ok(reno.grime.reduce((a, v) => a + v, 0) < sumBefore, 'the floor under the pile got cleaner');
  const res2 = clearClutter(state, 0);
  assert.equal(res2.ok, false, 'a cleared pile cannot be hauled twice');
});

// --- Task 2: the vacuum, bought through the real supplier system ---------------------

test('the vacuum is a real catalog item that ships through the existing order system', () => {
  const state = newGame('relaxed', 42);
  const sku = skuById('vac1');
  assert.ok(sku, 'vac1 exists in the catalog');
  assert.equal(sku.cat, 'supplies', 'cleaning gear is its own non-retail category');
  assert.ok(LEAD_DAYS.supplies >= 1, 'supplies have a real lead time');

  assert.equal(vacuumOwned(state), false, 'the fixer-upper does not come with a vacuum');
  const res = placeOrder(state, 'vac1', 1);
  assert.ok(res.ok, 'ordering a vacuum works');
  assert.equal(vacuumOwned(state), false, 'not owned until the truck arrives');
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  deliverOrdersDue(state, dayAbs + LEAD_DAYS.supplies);
  assert.equal(vacuumOwned(state), true, 'owned once the order is delivered');
});

test('supplies and decor never leak into retail: staff do not shelve them, shoppers cannot buy them', () => {
  const state = newGame('relaxed', 42);
  state.shop.inventory.vac1.back = 1;
  // hire-free check: bestSkill is 0 with no staff, so force the player-side path too
  const moved = restockShelvesByStaff(state);
  assert.equal(state.shop.inventory.vac1.back, 1, `staff left the vacuum in the back (moved ${moved} retail units)`);
  assert.equal(state.shop.inventory.vac1.shelf, 0, 'vacuum never reaches a sales shelf');
  const hand = restockShelfFromBackroom(state, 'vac1');
  assert.equal(hand.ok, false, 'hand-shelving equipment is refused');
  for (const sku of SHOP_CATALOG) {
    if (sku.cat === 'supplies' || sku.cat === 'decor') {
      assert.equal(state.shop.inventory[sku.id].shelf, 0, `${sku.id} has no shelf presence`);
    }
  }
});

test('saves written before a catalog item existed gain its inventory slot on load', () => {
  const state = newGame('relaxed', 42);
  const raw = JSON.parse(serialize(state));
  delete raw.shop.inventory.vac1; // simulate a save from before the vacuum existed
  const migrated = deserialize(JSON.stringify(raw));
  assert.ok(migrated.shop.inventory.vac1, 'missing catalog SKUs are backfilled');
  const res = placeOrder(migrated, 'vac1', 1);
  assert.ok(res.ok, 'the migrated save can order the new item');
});

test('reno state survives save/load exactly, and pre-reno saves migrate to a dirty shop', () => {
  const state = newGame('relaxed', 42);
  cleanGrimeAt(state, 0, 0, 0.4); // mutate so round-trip is non-trivial
  clearClutter(state, 1);
  const loaded = deserialize(serialize(state));
  assert.deepEqual(loaded.shop.reno.grime, state.shop.reno.grime, 'grime round-trips exactly');
  assert.deepEqual(loaded.shop.reno.clutter, state.shop.reno.clutter, 'clutter round-trips');

  // a save written before the restoration arc existed: shop present, no reno
  const raw = JSON.parse(serialize(state));
  delete raw.shop.reno;
  const migrated = deserialize(JSON.stringify(raw));
  assert.ok(migrated.shop.reno, 'old saves gain a reno block on load');
  const avg = migrated.shop.reno.grime.reduce((a, v) => a + v, 0) / migrated.shop.reno.grime.length;
  assert.ok(avg >= 0.55, 'migrated shops start dirty too — every property is a fixer-upper');
});
