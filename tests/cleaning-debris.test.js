// SWEEPING MOVES DIRT. It does not delete it.
//
// The brief is explicit that a broom which makes debris vanish is a failed broom: you sweep it
// into a pile, the pile gets denser as you work it, and then a dustpan or a vacuum takes it away.
// Deleting debris under the bristles is the exact failure these tests exist to prevent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  ensureDebris, debrisState, seedDebris, sweepAt, collectAt, suckAt,
  totalDebris, clusterCount, DEBRIS_MERGE_YD,
} from '../src/sim/cleaningDebris.js';

function scene() {
  const state = { shop: { reno: {} } };
  ensureDebris(state);
  return state;
}

test('a neglected floor starts with loose debris scattered across it', () => {
  const s = scene();
  seedDebris(s, 24, 8, 6, 1234);
  assert.ok(clusterCount(s) > 8, 'expected scattered debris, not one heap');
  assert.ok(totalDebris(s) > 0);
});

test('sweeping moves debris downrange instead of destroying it', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 0, z: 0, a: 1 });

  const before = totalDebris(s);
  // sweep toward +x
  sweepAt(s, 0, 0, 1, 0, 0.5, 0.2);
  const after = totalDebris(s);

  assert.ok(Math.abs(after - before) < 1e-6,
    `sweeping destroyed ${(before - after).toFixed(3)} of debris - it must only move it`);
  assert.ok(debrisState(s)[0].x > 0, 'the debris must have travelled the way it was swept');
});

test('debris never gets launched across the room in one stroke', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 0, z: 0, a: 1 });
  sweepAt(s, 0, 0, 1, 0, 0.5, 1.0); // a long, greedy stroke
  assert.ok(debrisState(s)[0].x < 1.2,
    `debris flew to ${debrisState(s)[0].x.toFixed(2)} yd - a broom is not a golf club`);
});

test('repeated sweeps consolidate scattered debris into fewer, denser piles', () => {
  const s = scene();
  debrisState(s).length = 0;
  // a line of small scattered bits
  for (let i = 0; i < 8; i++) debrisState(s).push({ x: -1.4 + i * 0.18, z: 0, a: 0.2 });
  const startCount = clusterCount(s);
  const startTotal = totalDebris(s);

  for (let i = 0; i < 24; i++) sweepAt(s, -1.4 + (i % 8) * 0.18, 0, 1, 0, 0.55, 0.1);

  assert.ok(clusterCount(s) < startCount,
    `sweeping should merge piles: ${startCount} -> ${clusterCount(s)}`);
  assert.ok(Math.abs(totalDebris(s) - startTotal) < 1e-6,
    'consolidating must conserve the amount of debris');
});

test('two piles closer than the merge distance become one', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 0, z: 0, a: 0.4 });
  debrisState(s).push({ x: DEBRIS_MERGE_YD * 0.5, z: 0, a: 0.4 });
  sweepAt(s, -0.3, 0, 1, 0, 0.6, 0.05);
  assert.equal(clusterCount(s), 1, 'overlapping piles must merge');
  assert.ok(Math.abs(totalDebris(s) - 0.8) < 1e-6, 'merging conserves the total');
});

// --- the dustpan -------------------------------------------------------------------------------

test('the dustpan collects a pile it is held near, and reports what it took', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 0.2, z: 0.1, a: 0.7 });

  const got = collectAt(s, 0.2, 0.1, 0.42);
  assert.ok(got > 0.6, `expected to collect the pile, got ${got.toFixed(3)}`);
  assert.equal(clusterCount(s), 0, 'the pile is gone once it is in the pan');
});

test('the final conserved debris pickup completes generic cleanup exactly once', () => {
  const state = newGame('relaxed', 44);
  state.shop.reno.clutter.forEach((entry) => { entry.cleared = true; });
  state.shop.reno.debris = [{ x: 0, z: 0, a: 0.5, kind: 'grit' }];
  const reputationBefore = state.reputation.categories.cleanliness;

  assert.equal(collectAt(state, 0, 0, 0.42), 0.5);
  assert.equal(state.shop.reno.cleanupMilestones['generic-debris'], true);
  assert.equal(state.reputation.categories.cleanliness, reputationBefore + 0.6);
  assert.ok(state.reputation.processedIds[
    'clubhouse-restoration:property:44:1:milestone:generic-debris'
  ]);

  const after = state.reputation.categories.cleanliness;
  state.shop.reno.debris = [{ x: 0, z: 0, a: 0.2, kind: 'grit' }];
  assert.equal(collectAt(state, 0, 0, 0.42), 0.2);
  assert.equal(state.reputation.categories.cleanliness, after);
});

test('the dustpan is forgiving - you do not have to hit the pile exactly', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 0, z: 0, a: 0.5 });
  const got = collectAt(s, 0.30, 0.18, 0.42); // ~0.35 yd off centre
  assert.ok(got > 0, 'a near miss should still collect - no pixel hunting');
});

test('the dustpan does not reach across the room', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 3, z: 3, a: 0.5 });
  assert.equal(collectAt(s, 0, 0, 0.42), 0, 'debris well outside the pan is untouched');
  assert.equal(clusterCount(s), 1);
});

test('a seeded neglected room contains both grit and hand-pickable litter', () => {
  const s = scene();
  seedDebris(s, 32, 8, 6, 2026);
  const kinds = new Set(debrisState(s).map((cluster) => cluster.kind));
  assert.deepEqual(kinds, new Set(['grit', 'litter']),
    'trash bags need visible litter while brooms and pans still have grit to move');
});

test('a trash-bag predicate takes litter without deleting nearby grit', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push(
    { x: 0, z: 0, a: 0.6, kind: 'litter' },
    { x: 0.04, z: 0.02, a: 0.7, kind: 'grit' },
  );
  const got = collectAt(s, 0, 0, 0.5, Infinity, (cluster) => cluster.kind === 'litter');
  assert.ok(Math.abs(got - 0.6) < 1e-6, 'only the litter should enter the bag');
  assert.equal(debrisState(s).length, 1);
  assert.equal(debrisState(s)[0].kind, 'grit');
  assert.ok(Math.abs(totalDebris(s) - 0.7) < 1e-6, 'nearby grit must remain for the pan/vacuum');
});

// --- the vacuum --------------------------------------------------------------------------------

test('the vacuum draws debris toward the intake before it takes it', () => {
  const s = scene();
  debrisState(s).length = 0;
  // inside the suction field, but well beyond the mouth that actually swallows it
  debrisState(s).push({ x: 0.30, z: 0, a: 0.5 });

  // one short pull: it should move closer, not vanish
  const taken = suckAt(s, 0, 0, 0.34, 0.05);
  assert.equal(taken, 0, 'debris short of the nozzle must not be consumed at range');
  assert.ok(debrisState(s)[0].x < 0.30, 'it should have been drawn toward the intake');
  assert.ok(debrisState(s)[0].x > 0.16, 'one short pull must not teleport it into the mouth');
  assert.equal(clusterCount(s), 1, 'it still exists - it is being pulled, not deleted');
});

test('the vacuum only consumes debris at the nozzle', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 0.02, z: 0, a: 0.5 }); // already at the mouth
  const taken = suckAt(s, 0, 0, 0.34, 0.2);
  assert.ok(taken > 0, 'debris at the intake is picked up');
});

test('the vacuum cannot clear a room from one spot', () => {
  const s = scene();
  debrisState(s).length = 0;
  debrisState(s).push({ x: 6, z: 6, a: 1 });
  const taken = suckAt(s, 0, 0, 0.34, 0.5);
  assert.equal(taken, 0);
  const d = debrisState(s)[0];
  assert.ok(Math.abs(d.x - 6) < 1e-6 && Math.abs(d.z - 6) < 1e-6,
    'debris far outside the suction field must not even twitch');
});

// --- persistence -------------------------------------------------------------------------------

test('debris survives a save/load round trip without duplicating', () => {
  const s = scene();
  seedDebris(s, 20, 8, 5, 99);
  const before = totalDebris(s);
  const count = clusterCount(s);

  const json = JSON.parse(JSON.stringify(s));
  ensureDebris(json); // a load runs the healer

  assert.equal(clusterCount(json), count, 'reloading must not add or drop piles');
  assert.ok(Math.abs(totalDebris(json) - before) < 1e-6, 'reloading must not change the amount');
});

test('the healer repairs a legacy save with no debris field at all', () => {
  const legacy = { shop: { reno: {} } };
  ensureDebris(legacy);
  assert.ok(Array.isArray(debrisState(legacy)), 'an old save gets a valid, empty debris list');
  assert.equal(totalDebris(legacy), 0);
});

test('the healer discards corrupt entries rather than crashing the floor', () => {
  const s = { shop: { reno: { debris: [{ x: 1, z: 1, a: 0.5 }, { x: NaN, z: 0, a: 1 }, null, { x: 0, z: 0 }] } } };
  ensureDebris(s);
  for (const d of debrisState(s)) {
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.z) && Number.isFinite(d.a) && d.a > 0);
  }
});

test('the healer gives legacy untyped debris a stable kind', () => {
  const legacy = { shop: { reno: { debris: [{ x: 1.25, z: -0.5, a: 0.8 }] } } };
  ensureDebris(legacy);
  const first = debrisState(legacy)[0].kind;
  assert.ok(first === 'grit' || first === 'litter');
  const reloaded = JSON.parse(JSON.stringify(legacy));
  ensureDebris(reloaded);
  assert.equal(debrisState(reloaded)[0].kind, first, 'save/load cannot re-roll litter into grit');
});
