// The neglected exterior is real state with physical repair verbs: weeds pull
// one by one, the gutter clears, cobwebs brush away, the porch bulb costs a
// few dollars, siding grime scrubs off in passes — and all of it persists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  ensureShopReno, exteriorState, pullWeed, clearGutter, brushCobwebs,
  replaceBulb, scrubSiding, exteriorScore,
} from '../src/sim/shop.js';

test('a fixer-upper starts with a neglected exterior', () => {
  const st = newGame('relaxed', 11);
  const ex = exteriorState(st);
  assert.ok(ex.weeds.length >= 4, 'weeds along the foundation');
  assert.ok(ex.weeds.every((w) => w === 1), 'all standing');
  assert.equal(ex.gutter, 1);
  assert.equal(ex.cobwebs, 1);
  assert.equal(ex.light, 1, 'porch bulb is out');
  assert.ok(ex.siding.every((s) => s > 0), 'siding is grimy');
  assert.ok(exteriorScore(st) < 0.05, 'curb appeal starts near zero');
});

test('each verb repairs its thing and the score climbs to one', () => {
  const st = newGame('relaxed', 11);
  const ex = exteriorState(st);
  for (let i = 0; i < ex.weeds.length; i++) {
    assert.ok(pullWeed(st, i).ok, `weed ${i}`);
  }
  assert.equal(pullWeed(st, 0).ok, false, 'a pulled weed stays pulled');
  assert.ok(clearGutter(st).ok);
  assert.equal(clearGutter(st).ok, false, 'gutter clears once');
  assert.ok(brushCobwebs(st).ok);
  const cashBefore = st.cash;
  assert.ok(replaceBulb(st).ok);
  assert.ok(st.cash < cashBefore, 'the bulb cost real money');
  assert.equal(replaceBulb(st).ok, false, 'one bulb is enough');
  for (let i = 0; i < ex.siding.length; i++) {
    let guard = 0;
    while (ex.siding[i] > 0 && guard++ < 10) scrubSiding(st, i);
    assert.equal(ex.siding[i], 0, `siding patch ${i} scrubbed clean`);
  }
  assert.equal(exteriorScore(st), 1, 'curb appeal complete');
});

test('siding scrubs off in passes, not one press', () => {
  const st = newGame('relaxed', 11);
  const first = scrubSiding(st, 0);
  assert.ok(first.ok);
  assert.ok(first.left > 0, 'still grimy after one pass');
});

test('exterior state survives save/load and legacy saves migrate', () => {
  const st = newGame('relaxed', 11);
  pullWeed(st, 0);
  clearGutter(st);
  const loaded = JSON.parse(JSON.stringify(st));
  ensureShopReno(loaded);
  const ex = exteriorState(loaded);
  assert.equal(ex.weeds[0], 0);
  assert.equal(ex.gutter, 0);
  // a legacy save without the block gains a dirty one
  delete loaded.shop.reno.exterior;
  ensureShopReno(loaded);
  assert.ok(exteriorState(loaded).weeds.length >= 4);
});
