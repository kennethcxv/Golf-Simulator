// Cleaning progress and in-flight interaction state survive a save. Wetness is
// visual feedback, but solution is also the cloth's authority, so an interrupted
// spray/wipe or mop loop must resume without changing what the player can use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, snapshot } from '../src/sim/state.js';
import { ensureDebris, debrisState, seedDebris, totalDebris, collectAt } from '../src/sim/cleaningDebris.js';
import { ensureWet, wetAt, wetLevel } from '../src/sim/cleaningWet.js';
import { ensureWash, washState, washAt, surfaceClean, WASH_SURFACES } from '../src/sim/washing.js';

const GEOM = { w: 82, h: 52, cell: 0.25 };

const reload = (state) => JSON.parse(JSON.stringify(snapshot(state)));

test('swept-up debris stays swept up after a save and reload', () => {
  const s = newGame('relaxed', 7);
  ensureDebris(s);
  seedDebris(s, 24, 12, 8, 5);
  const before = totalDebris(s);
  assert.ok(before > 0);

  collectAt(s, debrisState(s)[0].x, debrisState(s)[0].z, 0.62);
  const afterWork = totalDebris(s);
  assert.ok(afterWork < before, 'the pan took something off the floor');

  const back = reload(s);
  ensureDebris(back);
  assert.ok(Math.abs(totalDebris(back) - afterWork) < 1e-6,
    'the floor must come back exactly as clean as you left it');
});

test('the dustpan and bag loads persist', () => {
  const s = newGame('relaxed', 7);
  ensureDebris(s);
  s.shop.reno.pan = 0.4;
  s.shop.reno.bag = 1.25;
  const back = reload(s);
  assert.equal(back.shop.reno.pan, 0.4);
  assert.equal(back.shop.reno.bag, 1.25);
});

test('exterior washing survives the round trip', () => {
  const s = newGame('relaxed', 7);
  ensureWash(s);
  const surf = WASH_SURFACES[0];
  washAt(s, surf.id, 0.5, 0.5, 0.6, 1.4, 1.0, 99);
  const cleaned = surfaceClean(s, surf.id);
  assert.ok(cleaned > 0);

  const back = reload(s);
  ensureWash(back);
  assert.ok(Math.abs(surfaceClean(back, surf.id) - cleaned) < 1e-6,
    'washed siding must not re-dirty itself on load');
  assert.deepEqual(washState(back)[surf.id].grime, washState(s)[surf.id].grime);
});

test('mop water and cleaning solution survive a save taken mid-stroke', () => {
  const s = newGame('relaxed', 7);
  ensureWet(s, GEOM.w, GEOM.h);
  wetAt(s, GEOM, 3, 3, 0.5);
  s.shop.reno.solution[GEOM.w * 3 + 3] = 0.625;
  assert.ok(wetLevel(s, GEOM, 3, 3) > 0, 'the floor is wet before saving');

  const back = reload(s);
  ensureWet(back, GEOM.w, GEOM.h);
  assert.equal(wetLevel(back, GEOM, 3, 3), wetLevel(s, GEOM, 3, 3));
  assert.equal(back.shop.reno.solution[GEOM.w * 3 + 3], 0.625);
  assert.equal(back.shop.reno.wet.length, GEOM.w * GEOM.h);
});

test('dropping the transient fields does not disturb the live game state', () => {
  const s = newGame('relaxed', 7);
  ensureWet(s, GEOM.w, GEOM.h);
  wetAt(s, GEOM, 4, 4, 0.5);
  const wetBefore = wetLevel(s, GEOM, 4, 4);
  snapshot(s); // saving must not mutate what the player is looking at
  assert.equal(wetLevel(s, GEOM, 4, 4), wetBefore,
    'taking a save must not dry the floor under the player');
});

test('the save carries the grime mask, which IS progress', () => {
  const s = newGame('relaxed', 7);
  const before = s.shop.reno.grime.slice();
  s.shop.reno.grime[0] = 0;
  const back = reload(s);
  assert.equal(back.shop.reno.grime[0], 0, 'cleaned floor grime must persist');
  assert.equal(back.shop.reno.grime.length, before.length);
});

test('a save round trip does not duplicate debris piles', () => {
  const s = newGame('relaxed', 7);
  ensureDebris(s);
  seedDebris(s, 16, 10, 7, 3);
  const count = debrisState(s).length;
  let back = reload(s);
  ensureDebris(back);
  back = reload(back);
  ensureDebris(back);
  assert.equal(debrisState(back).length, count,
    'saving twice must not grow the pile list');
});
