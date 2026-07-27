// WINDOW GRIME — the production dirt pass makes the glass part of the
// neglect: every window carries a film value the player wipes off pane by
// pane. State lives in shop.reno.windows (one entry per plan window),
// migrates into old saves, persists, and feeds the visible film.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { ensureShopReno, wipeWindow, windowDirtAvg } from '../src/sim/shop.js';
import { WINDOWS } from '../src/data/shopLayout.js';

test('a new fixer-upper starts with filmed-over windows, one entry per plan window', () => {
  const st = newGame('realistic', 42);
  assert.ok(Array.isArray(st.shop.reno.windows), 'windows state exists');
  assert.equal(st.shop.reno.windows.length, WINDOWS.length, 'one film value per window');
  for (const v of st.shop.reno.windows) {
    assert.ok(v >= 0.6 && v <= 1.0, `starts properly grimy (${v})`);
  }
});

test('wiping a window takes three passes and stays clean', () => {
  const st = newGame('realistic', 42);
  const before = st.shop.reno.windows[0];
  assert.ok(before > 0.6);
  const r1 = wipeWindow(st, 0);
  assert.ok(r1.ok && r1.left < before, 'first wipe takes film off');
  wipeWindow(st, 0);
  const r3 = wipeWindow(st, 0);
  assert.equal(r3.left, 0, 'third pass finishes the pane');
  const r4 = wipeWindow(st, 0);
  assert.equal(r4.ok, false, 'a clean pane has nothing to wipe');
  assert.ok(windowDirtAvg(st) > 0, 'the other windows are still dirty');
});

test('wiping the final pane records the window milestone and reputation exactly once', () => {
  const st = newGame('realistic', 43);
  const reputationBefore = st.reputation.categories.cleanliness;
  let finalResult = null;
  for (let index = 0; index < st.shop.reno.windows.length; index++) {
    while (st.shop.reno.windows[index] > 0) finalResult = wipeWindow(st, index);
  }

  assert.equal(st.shop.reno.cleanupMilestones.windows, true);
  assert.equal(finalResult.restoration.changed, true);
  assert.equal(st.reputation.categories.cleanliness, reputationBefore + 0.6);
  assert.ok(st.reputation.processedIds['clubhouse-restoration:property:43:1:milestone:windows']);
  const after = st.reputation.categories.cleanliness;
  assert.equal(wipeWindow(st, 0).ok, false);
  assert.equal(st.reputation.categories.cleanliness, after);
});

test('legacy saves without window state get filmed windows on load', () => {
  const st = newGame('realistic', 42);
  const raw = JSON.parse(serialize(st));
  delete raw.shop.reno.windows;
  const back = deserialize(JSON.stringify(raw));
  assert.ok(Array.isArray(back.shop.reno.windows), 'migration adds the array');
  assert.equal(back.shop.reno.windows.length, WINDOWS.length);
});

test('window film survives save/load exactly', () => {
  const st = newGame('realistic', 42);
  wipeWindow(st, 1);
  wipeWindow(st, 1);
  wipeWindow(st, 1);
  const back = deserialize(serialize(st));
  assert.equal(back.shop.reno.windows[1], 0, 'the wiped pane stays wiped');
  assert.equal(back.shop.reno.windows[0], st.shop.reno.windows[0], 'others carry over');
  ensureShopReno(back);
  assert.equal(back.shop.reno.windows[1], 0, 'ensure does not re-dirty cleaned glass');
});
