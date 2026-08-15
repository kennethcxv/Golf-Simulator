// SHED CLEANING — the 11 discrete shed targets: their tool schedules, the
// monotonic set-progress reducer, the window film/target mirror, the
// checklist view, and the full-completion predicate. THREE-free; this is the
// sim half the (later) renderer task drives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHED_TARGET_IDS, SHED_TARGET_SCHEDULES, shedTargetAction, applyShedToolProgress,
  cleanShedWindow, shedView, shedCleanupComplete,
} from '../src/sim/shedCleaning.js';
import { buildShedEmpire, ensureShedScene } from '../src/sim/shedScene.js';
import { activeState } from '../src/sim/empire.js';
import { addToBag, tieBag, disposeTiedBag } from '../src/sim/cleaningToolState.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
let seed = 200;
const freshState = () => activeState(buildShedEmpire(seed++));

test('SHED_TARGET_IDS lists exactly the 11 authored targets', () => {
  assert.deepEqual(SHED_TARGET_IDS, [
    'web:corner-nw', 'web:corner-ne', 'bench:grease', 'wall:scuff-door', 'floor:oil-patch',
    'shelf:dust', 'entry:leaf-drift', 'trash:cans', 'trash:pizza-box', 'window:south', 'window:east',
  ]);
});

test('every target id owns a schedule entry', () => {
  for (const id of SHED_TARGET_IDS) {
    assert.ok(SHED_TARGET_SCHEDULES[id], `${id} has a schedule`);
  }
});

// --- per-target tool schedules -----------------------------------------------------

test('cobweb corners accept only the vacuum, at the baseline rate', () => {
  const state = freshState();
  const wrong = applyShedToolProgress(state, 'web:corner-nw', 'cloth', 1);
  assert.equal(wrong.blocked, true);
  assert.equal(wrong.reason, 'wrong-tool');
  const result = applyShedToolProgress(state, 'web:corner-nw', 'vacuum', 1);
  assert.equal(result.blocked, false);
  assert.equal(result.did, 0.5);
});

test('bench grease needs spray before sponge; sponge-first is refused spray-first', () => {
  const state = freshState();
  const refused = applyShedToolProgress(state, 'bench:grease', 'sponge', 1);
  assert.equal(refused.blocked, true);
  assert.equal(refused.reason, 'spray-first');
  const sprayed = applyShedToolProgress(state, 'bench:grease', 'spray', 1);
  assert.equal(sprayed.blocked, false);
  assert.equal(sprayed.did, 0.28);
  const sponged = applyShedToolProgress(state, 'bench:grease', 'sponge', 1);
  assert.equal(sponged.blocked, false);
  assert.ok(sponged.did > 0);
});

test('wall scuff accepts cloth OR sponge once sprayed, refuses either one first', () => {
  const state = freshState();
  const clothFirst = applyShedToolProgress(state, 'wall:scuff-door', 'cloth', 1);
  assert.equal(clothFirst.reason, 'spray-first');
  const spongeFirst = applyShedToolProgress(state, 'wall:scuff-door', 'sponge', 1);
  assert.equal(spongeFirst.reason, 'spray-first');
  applyShedToolProgress(state, 'wall:scuff-door', 'spray', 1);
  const cloth = applyShedToolProgress(state, 'wall:scuff-door', 'cloth', 1);
  assert.equal(cloth.blocked, false);
});

test('the oil patch is sponge-only and cleans slower than the baseline rate (x0.45)', () => {
  const state = freshState();
  const wrong = applyShedToolProgress(state, 'floor:oil-patch', 'cloth', 1);
  assert.equal(wrong.reason, 'wrong-tool');
  const result = applyShedToolProgress(state, 'floor:oil-patch', 'sponge', 1);
  assert.equal(result.blocked, false);
  assert.ok(Math.abs(result.did - 0.225) < 1e-9, `0.45x baseline (got ${result.did})`);
  assert.ok(result.did < 0.5, 'strictly slower than the 0.5/sec baseline');
});

test('shelf dust is cloth-only at the baseline rate', () => {
  const state = freshState();
  const wrong = applyShedToolProgress(state, 'shelf:dust', 'vacuum', 1);
  assert.equal(wrong.reason, 'wrong-tool');
  const result = applyShedToolProgress(state, 'shelf:dust', 'cloth', 1);
  assert.equal(result.did, 0.5);
});

test('leaf drift sweeps to a 0.66 cap; trashbag-first is refused sweep-first', () => {
  const state = freshState();
  const early = applyShedToolProgress(state, 'entry:leaf-drift', 'trashbag', 1, { bagSpace: 5, bagTied: false });
  assert.equal(early.reason, 'sweep-first');
  const swept = applyShedToolProgress(state, 'entry:leaf-drift', 'broom', 3);
  assert.equal(swept.did, 0.66, 'broom phase caps at 0.66 even for a long stroke');
  const cappedAgain = applyShedToolProgress(state, 'entry:leaf-drift', 'broom', 3);
  assert.equal(cappedAgain.did, 0, 'broom contributes nothing past its own cap');
  const bagged = applyShedToolProgress(state, 'entry:leaf-drift', 'trashbag', 1, { bagSpace: 5, bagTied: false });
  assert.equal(bagged.blocked, false);
  assert.ok(Math.abs(bagged.did - 0.34) < 1e-9, 'trashbag jumps the swept pile to 1');
});

test('leaf drift trashbag phase is gated on bag space and tie state', () => {
  const state = freshState();
  applyShedToolProgress(state, 'entry:leaf-drift', 'broom', 3);
  const tied = applyShedToolProgress(state, 'entry:leaf-drift', 'trashbag', 1, { bagSpace: 5, bagTied: true });
  assert.equal(tied.reason, 'bag-tied');
  const full = applyShedToolProgress(state, 'entry:leaf-drift', 'trashbag', 1, { bagSpace: 0, bagTied: false });
  assert.equal(full.reason, 'bag-full');
});

test('trash cans use the trashbag under the same bag gates', () => {
  const state = freshState();
  const tied = applyShedToolProgress(state, 'trash:cans', 'trashbag', 1, { bagSpace: 5, bagTied: true });
  assert.equal(tied.reason, 'bag-tied');
  const full = applyShedToolProgress(state, 'trash:cans', 'trashbag', 1, { bagSpace: 0, bagTied: false });
  assert.equal(full.reason, 'bag-full');
  const ok = applyShedToolProgress(state, 'trash:cans', 'trashbag', 1, { bagSpace: 5, bagTied: false });
  assert.equal(ok.blocked, false);
  assert.ok(ok.did > 0);
});

test('the pizza box takes no tool - applyShedToolProgress always refuses it directly', () => {
  const state = freshState();
  const result = applyShedToolProgress(state, 'trash:pizza-box', 'trashbag', 1, { bagSpace: 5, bagTied: false });
  assert.equal(result.blocked, true);
  assert.ok(result.reason);
  const direct = shedTargetAction(state, { targetId: 'trash:pizza-box', progress: 1 });
  assert.equal(direct.ok, true);
  assert.equal(direct.completed, true);
});

test('window targets need spray to loosen the film to 0.3 before cloth wipes it', () => {
  const state = freshState();
  const early = applyShedToolProgress(state, 'window:south', 'cloth', 1);
  assert.equal(early.reason, 'spray-first');
  const sprayed = applyShedToolProgress(state, 'window:south', 'spray', 1);
  assert.equal(sprayed.did, 0.3);
  const wiped = applyShedToolProgress(state, 'window:south', 'cloth', 1);
  assert.equal(wiped.blocked, false);
});

test('applyShedToolProgress refuses an unknown target id', () => {
  const state = freshState();
  const result = applyShedToolProgress(state, 'not-a-target', 'vacuum', 1);
  assert.equal(result.blocked, true);
});

test('applyShedToolProgress is a cheap no-op once a target is already complete', () => {
  const state = freshState();
  shedTargetAction(state, { targetId: 'shelf:dust', progress: 1 });
  const result = applyShedToolProgress(state, 'shelf:dust', 'cloth', 1);
  assert.equal(result.did, 0);
  assert.equal(result.blocked, false);
});

// --- shedTargetAction reducer --------------------------------------------------------

test('shedTargetAction rejects an unknown target id', () => {
  const state = freshState();
  const result = shedTargetAction(state, { targetId: 'not-a-target', progress: 0.5 });
  assert.equal(result.ok, false);
});

test('shedTargetAction rejects invalid progress values', () => {
  const state = freshState();
  for (const bad of [-0.1, 1.1, NaN, Infinity, 'half', undefined]) {
    const result = shedTargetAction(state, { targetId: 'shelf:dust', progress: bad });
    assert.equal(result.ok, false, `progress ${bad} rejected`);
  }
});

test('shedTargetAction rounds progress to three decimal places', () => {
  const state = freshState();
  const result = shedTargetAction(state, { targetId: 'shelf:dust', progress: 0.123456 });
  assert.equal(result.progress, 0.123);
});

test('shedTargetAction is monotonic - stored progress never decreases', () => {
  const state = freshState();
  shedTargetAction(state, { targetId: 'shelf:dust', progress: 0.7 });
  const lowered = shedTargetAction(state, { targetId: 'shelf:dust', progress: 0.2 });
  assert.equal(lowered.changed, false);
  assert.equal(lowered.progress, 0.7);
  assert.equal(state.shop.reno.shed.targets['shelf:dust'], 0.7);
});

test('shedTargetAction fires completion events exactly once on the 0-to-1 edge', () => {
  const state = freshState();
  const first = shedTargetAction(state, { targetId: 'shelf:dust', progress: 1 });
  assert.equal(first.completed, true);
  assert.ok(first.events.some((e) => e.type === 'audio'));
  assert.ok(first.events.some((e) => e.type === 'toast'));
  const again = shedTargetAction(state, { targetId: 'shelf:dust', progress: 1 });
  assert.equal(again.changed, false);
  assert.deepEqual(again.events, []);
});

test('shedTargetAction never writes reputation', () => {
  const state = freshState();
  const before = clone(state.reputation);
  shedTargetAction(state, { targetId: 'shelf:dust', progress: 1 });
  assert.deepEqual(clone(state.reputation), before);
});

// --- window film mirror + milestone --------------------------------------------------

test('cleanShedWindow mirrors drained film into target progress (0.4 film -> 0.6 progress)', () => {
  const state = freshState();
  state.shop.reno.windows[0] = 0.75;
  const result = cleanShedWindow(state, 0, 0.35);
  assert.equal(result.left, 0.4);
  assert.equal(state.shop.reno.shed.targets['window:south'], 0.6);
});

test('both-panes milestone fires exactly once and survives being called again', () => {
  const state = freshState();
  const first = cleanShedWindow(state, 0, 10);
  assert.equal(first.milestone, null, 'only one pane clear so far');
  const firstComplete = cleanShedWindow(state, 1, 10);
  assert.ok(firstComplete.milestone);
  assert.equal(firstComplete.milestone.changed, true);
  const again = cleanShedWindow(state, 1, 10);
  assert.equal(again.milestone.changed, false, 'milestone does not re-fire');
});

// --- shedView + shedCleanupComplete --------------------------------------------------

test('shedView reports checklist counts and flags across a scripted clean', () => {
  const state = freshState();
  let view = shedView(state);
  assert.equal(view.complete, false);
  assert.equal(view.items.length, 5);
  const trashItem = () => view.items.find((i) => i.id === 'pick-up-trash');
  assert.equal(trashItem().done, false);
  assert.equal(trashItem().count, 0);

  shedTargetAction(state, { targetId: 'trash:cans', progress: 1 });
  shedTargetAction(state, { targetId: 'trash:pizza-box', progress: 1 });
  view = shedView(state);
  assert.equal(trashItem().done, true);
  assert.equal(trashItem().count, 2);

  const windowsItem = () => view.items.find((i) => i.id === 'windows');
  assert.equal(windowsItem().count, 0);
  cleanShedWindow(state, 0, 10);
  view = shedView(state);
  assert.equal(windowsItem().count, 1);
});

test('shedCleanupComplete stays false until every gate clears, including bag-disposed', () => {
  const state = freshState();
  assert.equal(shedCleanupComplete(state), false);

  for (const id of SHED_TARGET_IDS) {
    if (id === 'window:south' || id === 'window:east') continue;
    shedTargetAction(state, { targetId: id, progress: 1 });
  }
  cleanShedWindow(state, 0, 10);
  cleanShedWindow(state, 1, 10);
  assert.equal(shedCleanupComplete(state), false, 'grime + debris + disposal still outstanding');

  const grime = state.shop.reno.grime;
  for (let i = 0; i < grime.length; i++) grime[i] = 0;
  assert.equal(shedCleanupComplete(state), false, 'debris + bag disposal still missing');

  state.shop.reno.debris = [];
  assert.equal(shedCleanupComplete(state), false, 'bag has never been disposed');

  addToBag(state, 1);
  tieBag(state);
  disposeTiedBag(state);
  assert.equal(shedCleanupComplete(state), true);
  assert.ok(Number.isFinite(state.shop.reno.shed.completedAt));
});

// --- ensureShedScene healer -----------------------------------------------------------

test('ensureShedScene is idempotent on an already-canonical slice', () => {
  const state = freshState();
  shedTargetAction(state, { targetId: 'shelf:dust', progress: 0.4 });
  const before = clone(state.shop.reno.shed);
  ensureShedScene(state);
  assert.deepEqual(state.shop.reno.shed, before);
});

test('ensureShedScene repairs NaN progress, out-of-range progress, unknown keys, and a wrong version', () => {
  const state = freshState();
  const shed = state.shop.reno.shed;
  shed.version = 99;
  shed.targets['shelf:dust'] = NaN;
  shed.targets['bench:grease'] = 5;
  shed.targets['not-a-real-target'] = 0.4;
  shed.completedAt = 'yesterday';
  const repaired = ensureShedScene(state);
  assert.equal(repaired.version, 1);
  assert.equal(repaired.targets['shelf:dust'], 0);
  assert.equal(repaired.targets['bench:grease'], 1);
  assert.equal(repaired.targets['not-a-real-target'], undefined);
  assert.equal(repaired.completedAt, null);
});
