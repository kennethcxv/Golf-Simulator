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
} from '../src/sim/shop.js';

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
