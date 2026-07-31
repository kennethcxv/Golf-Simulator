// Exterior grime comes off with a pressure washer, and heavy staining only after soap.
//
// The brief is explicit: exterior grime must NOT be removable by a vacuum, a generic [E], a cloth,
// an instant upgrade or a menu purchase. The build shipped it as an [E] verb that wiped a whole
// siding patch in three presses. This replaces that with a real mask you erode under the stream —
// the clean material is revealed where the water actually lands, and nowhere else.
//
// Light dirt washes straight off. Algae, mould and bird residue laugh at plain water: soap has to
// go on and be given a moment to work before the jet bites.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  ensureWash, washState, surfaceById, WASH_SURFACES, WASHERS, HEAVY_FLOOR,
  soapAt, washAt, surfaceClean, exteriorWashScore, ownedWasher, buyWasher,
} from '../src/sim/washing.js';

const light = WASH_SURFACES.find((s) => s.kind === 'light');
const heavy = WASH_SURFACES.find((s) => s.kind === 'heavy');

test('a neglected property starts filthy, on every washable surface', () => {
  const st = newGame('relaxed', 4);
  ensureWash(st);
  assert.ok(WASH_SURFACES.length >= 4, 'siding, foundation, porch, trim...');
  for (const s of WASH_SURFACES) {
    assert.ok(surfaceClean(st, s.id) < 0.2, `${s.id} starts dirty`);
  }
  assert.ok(exteriorWashScore(st) < 0.2);
});

test('the jet only cleans where it actually lands', () => {
  const st = newGame('relaxed', 4);
  ensureWash(st);
  const w = washState(st)[light.id];
  const before = [...w.grime];

  // hold the stream on one spot for a second
  for (let i = 0; i < 30; i++) washAt(st, light.id, 0.25, 0.5, 0.15, 1.0, 1 / 30, i / 30);

  const surf = surfaceById(light.id);
  const idxAt = (u, v) => Math.floor(v * surf.grid.h) * surf.grid.w + Math.floor(u * surf.grid.w);
  const hit = idxAt(0.25, 0.5);
  const far = idxAt(0.85, 0.5);

  assert.ok(w.grime[hit] < before[hit] - 0.3, 'the spot under the stream came clean');
  assert.equal(w.grime[far], before[far], 'the far end of the wall is untouched');
});

test('plain water strips the film off a heavy stain, then stalls dead on it', () => {
  // you can SEE it stop working — the wall lightens and then simply refuses to go further.
  // That is the game telling you to fetch the soap, without a tooltip having to say it.
  const st = newGame('relaxed', 4);
  ensureWash(st);
  const w = washState(st)[heavy.id];
  const surf = surfaceById(heavy.id);
  const hit = Math.floor(0.5 * surf.grid.h) * surf.grid.w + Math.floor(0.5 * surf.grid.w);
  const before = w.grime[hit];

  let blockedOnce = false;
  for (let i = 0; i < 120; i++) {
    const r = washAt(st, heavy.id, 0.5, 0.5, 0.2, 1.4, 1 / 30, i / 30);
    if (r.blocked) blockedOnce = true;
  }
  assert.ok(w.grime[hit] < before, 'the loose film did come off');
  assert.ok(w.grime[hit] >= HEAVY_FLOOR - 1e-6, `and it stops at the bonded stain (${w.grime[hit]})`);
  assert.ok(blockedOnce, 'and the game reports it, rather than silently doing nothing');
  assert.ok(surfaceClean(st, heavy.id) < 0.75, 'the wall is nowhere near clean');
});

test('soap, a moment to work, then the jet — and the stain lifts', () => {
  const st = newGame('relaxed', 4);
  ensureWash(st);
  const w = washState(st)[heavy.id];
  const surf = surfaceById(heavy.id);
  const hit = Math.floor(0.5 * surf.grid.h) * surf.grid.w + Math.floor(0.5 * surf.grid.w);

  // strip the film first, so we are up against the stain itself
  for (let i = 0; i < 120; i++) washAt(st, heavy.id, 0.5, 0.5, 0.2, 1.4, 1 / 30, i / 30);
  const stalled = w.grime[hit];
  assert.ok(stalled >= HEAVY_FLOOR - 1e-6);

  soapAt(st, heavy.id, 0.5, 0.5, 0.2, 10);

  // straight away, the soap has not had time to bite: still stuck at the floor
  for (let i = 0; i < 10; i++) washAt(st, heavy.id, 0.5, 0.5, 0.2, 1.4, 1 / 30, 10.2 + i / 30);
  assert.ok(w.grime[hit] >= HEAVY_FLOOR - 1e-6, 'you have to give it a second to work');

  // let it dwell past SOAP_DWELL_SEC, then wash
  for (let i = 0; i < 60; i++) washAt(st, heavy.id, 0.5, 0.5, 0.2, 1.4, 1 / 30, 13 + i / 30);
  assert.ok(w.grime[hit] < 0.05, `the stain finally lifts (${stalled} -> ${w.grime[hit]})`);
});

test('a better washer cleans faster, and a wider one covers more', () => {
  const mk = () => { const s = newGame('relaxed', 4); ensureWash(s); return s; };
  const rental = WASHERS[0];
  const pro = WASHERS[WASHERS.length - 1];
  assert.ok(pro.power > rental.power, 'more power');
  assert.ok(pro.radius > rental.radius, 'wider fan');

  const a = mk(); const b = mk();
  for (let i = 0; i < 20; i++) {
    washAt(a, light.id, 0.5, 0.5, rental.radius, rental.power, 1 / 30, i / 30);
    washAt(b, light.id, 0.5, 0.5, pro.radius, pro.power, 1 / 30, i / 30);
  }
  assert.ok(surfaceClean(b, light.id) > surfaceClean(a, light.id), 'the pro machine gets more done');
});

test('the inherited washer clears a player-sized sweep without becoming an instant wall upgrade', () => {
  const st = newGame('relaxed', 4);
  ensureWash(st);
  const rental = WASHERS[0];
  const surfaceId = 'sidingSE';
  const before = surfaceClean(st, surfaceId);

  // Roughly 0.8 yd between horizontal stops and 0.65 yd between rows mirrors
  // a player sweeping the live one-metre fan across the south wall.
  for (const v of [0.055, 0.352, 0.648, 0.945]) {
    for (let index = 0; index < 11; index += 1) {
      const u = 0.045 + 0.91 * (index / 10);
      washAt(st, surfaceId, u, v, rental.radius, rental.power, 0.28, 10);
    }
  }
  const cleaned = surfaceClean(st, surfaceId);
  assert.ok(cleaned >= 0.80, `one deliberate wall sweep is productive (${cleaned})`);
  assert.ok(cleaned < 0.95, 'edge/corner cleanup still rewards a finishing pass');
  assert.ok(cleaned > before + 0.65, 'the opening campaign no longer requires stationary pixel hunting');
});

test('the good machines are not simply handed to you', () => {
  const st = newGame('relaxed', 4);
  ensureWash(st);
  assert.equal(ownedWasher(st).id, WASHERS[0].id, 'you start on the cheap rental');

  const pro = WASHERS[WASHERS.length - 1];
  st.cash = 10;
  assert.equal(buyWasher(st, pro.id).ok, false, 'cannot afford it');

  st.cash = pro.cost + 50;
  const r = buyWasher(st, pro.id);
  assert.equal(r.ok, true);
  assert.equal(ownedWasher(st).id, pro.id);
  assert.ok(st.cash < pro.cost + 50, 'and it cost real money');
});

test('washing the whole building drives the score to one, and it persists', () => {
  const st = newGame('relaxed', 4);
  ensureWash(st);
  const t0 = 10;
  for (const s of WASH_SURFACES) {
    // work over every part of the face: soap it, let it dwell, then put the stream on all of it
    const cells = [];
    for (let cy = 0; cy < s.grid.h; cy++) {
      for (let cx = 0; cx < s.grid.w; cx++) {
        cells.push([(cx + 0.5) / s.grid.w, (cy + 0.5) / s.grid.h]);
      }
    }
    for (const [u, v] of cells) soapAt(st, s.id, u, v, 0.35, t0);
    for (let pass = 0; pass < 3; pass++) {
      for (const [u, v] of cells) washAt(st, s.id, u, v, 0.35, 1.5, 0.25, t0 + 5 + pass);
    }
    assert.ok(surfaceClean(st, s.id) > 0.98, `${s.id} came clean (${surfaceClean(st, s.id).toFixed(2)})`);
  }
  assert.ok(exteriorWashScore(st) > 0.98);

  const loaded = JSON.parse(JSON.stringify(st));
  ensureWash(loaded);
  assert.ok(exteriorWashScore(loaded) > 0.98, 'a clean building stays clean across a save');
});

test('a legacy save with no wash data gains a dirty building, not a crash', () => {
  const st = newGame('relaxed', 4);
  ensureWash(st);
  delete st.shop.reno.wash;
  ensureWash(st);
  assert.ok(exteriorWashScore(st) < 0.2);
});
