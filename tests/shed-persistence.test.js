// SHED PERSISTENCE — a shed-recipe state must survive the REAL save/load
// path unchanged: reno.shed round-trips intact, masked grime stays masked,
// the windows array keeps its length-4 shape, the debris list round-trips,
// and the full vanilla load heal chain (plus ensureShedScene, standing in
// for the later state.js wiring) is a no-op on an already-canonical state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize } from '../src/sim/state.js';
import { buildShedEmpire, ensureShedScene } from '../src/sim/shedScene.js';
import { activeState } from '../src/sim/empire.js';
import { ensureShopReno, RENO } from '../src/sim/shop.js';
import { ensureClubhouseRestoration } from '../src/sim/clubhouseRestoration.js';
import { ensureDebris } from '../src/sim/cleaningDebris.js';
import { ensureWet, wetGridForRoom } from '../src/sim/cleaningWet.js';
import { ensureWash } from '../src/sim/washing.js';
import { SHED_DEBRIS_SEED, insideShedRoom } from '../src/data/shedLayout.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const CLEANING_FIELD = wetGridForRoom(RENO.room);
let seed = 300;
const freshState = () => activeState(buildShedEmpire(seed++));

// The exact chain src/sim/state.js runs on load today (deserializeWithReport),
// plus ensureShedScene standing in for the later wiring task.
function healChain(state) {
  ensureShopReno(state);
  ensureClubhouseRestoration(state);
  ensureDebris(state);
  ensureWet(state, CLEANING_FIELD.w, CLEANING_FIELD.h);
  ensureWash(state);
  ensureShedScene(state);
}

test('a shed state survives the real save/load round trip with reno.shed intact', () => {
  const state = freshState();
  const before = clone(state.shop.reno.shed);
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored.shop.reno.shed, before);
});

test('masked grime cells stay masked after a round trip (healers do not resurrect them)', () => {
  const state = freshState();
  const beforeGrime = clone(state.shop.reno.grime);
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored.shop.reno.grime, beforeGrime);
  const cellW = RENO.room.w / RENO.grid.w;
  const cellD = RENO.room.d / RENO.grid.h;
  let outsideChecked = 0;
  for (let cy = 0; cy < RENO.grid.h; cy++) {
    for (let cx = 0; cx < RENO.grid.w; cx++) {
      const x = -RENO.room.w / 2 + (cx + 0.5) * cellW;
      const z = -RENO.room.d / 2 + (cy + 0.5) * cellD;
      if (!insideShedRoom(x, z)) {
        outsideChecked++;
        assert.equal(restored.shop.reno.grime[cy * RENO.grid.w + cx], 0, 'outside cell stays zeroed');
      }
    }
  }
  assert.ok(outsideChecked > 0, 'the test actually exercised masked cells');
});

test('the windows array keeps its authored length-4 shape and values through a round trip', () => {
  const state = freshState();
  const restored = deserialize(serialize(state));
  assert.equal(restored.shop.reno.windows.length, 4);
  assert.deepEqual(restored.shop.reno.windows, [0.85, 0.78, 0, 0]);
});

test('the shed debris list round-trips intact', () => {
  const state = freshState();
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored.shop.reno.debris, SHED_DEBRIS_SEED);
});

test('the full vanilla load heal chain leaves a recipe-built state unchanged', () => {
  const state = freshState();
  const before = clone(state.shop.reno);
  healChain(state);
  assert.deepEqual(clone(state.shop.reno), before);
});

test('the full vanilla load heal chain leaves a round-tripped shed save unchanged', () => {
  const state = freshState();
  const restored = deserialize(serialize(state));
  const before = clone(restored.shop.reno);
  healChain(restored);
  assert.deepEqual(clone(restored.shop.reno), before);
});
