import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHITECTURE_COMPONENTS,
  ARCHITECTURE_COMPONENT_LABELS,
  ARCHITECTURE_FINISH_OPTIONS,
  ARCHITECTURE_PAINT_COSTS,
  ARCHITECTURE_REPAIR_SKU,
  ensureClubhouseRestoration,
  restorationAction,
  restorationSnapshot,
} from '../src/sim/clubhouseRestoration.js';
import { availableSupplyUnits } from '../src/sim/supplyUnits.js';

// First-person structural repair and refinishing, owned by the restoration
// action dispatcher: hold progress persists, completion consumes exactly one
// repair-components unit, refinishing pays the works ledger exactly once per
// application, and neither verb can substitute for the other.

const workState = ({ cash = 500, kits = 2 } = {}) => ({
  seed: 11,
  property: { id: 'pine-hills-work' },
  cash,
  club: { reputation: 30 },
  shop: {
    inventory: {
      [ARCHITECTURE_REPAIR_SKU]: { shelf: 0, back: kits },
    },
    carry: null,
    reno: {},
  },
});

test('repair progress accumulates monotonically and persists partial work', () => {
  const state = workState();
  const partial = restorationAction(state, {
    type: 'repair-component', component: 'panels', progress: 0.4,
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.changed, true);
  assert.equal(partial.restored, false);

  const regression = restorationAction(state, {
    type: 'repair-component', component: 'panels', progress: 0.2,
  });
  assert.equal(regression.ok, true);
  assert.equal(regression.changed, false);
  assert.equal(regression.progress, 0.4);

  // Partial work must survive a JSON save round trip.
  const reloaded = JSON.parse(JSON.stringify(state));
  ensureClubhouseRestoration(reloaded);
  assert.equal(reloaded.shop.reno.componentRepairProgress.panels, 0.4);
  assert.equal(reloaded.shop.reno.architecture.components.panels.restored, false);
});

test('repair completion consumes exactly one kit, restores the component, and awards exactly once', () => {
  const state = workState({ kits: 2 });
  const done = restorationAction(state, {
    type: 'repair-component', component: 'panels', progress: 1,
  });
  assert.equal(done.ok, true);
  assert.equal(done.changed, true);
  assert.equal(done.restored, true);
  assert.equal(done.consumedFrom, 'backroom');
  assert.equal(state.shop.inventory[ARCHITECTURE_REPAIR_SKU].back, 1);
  assert.equal(state.shop.reno.architecture.components.panels.restored, true);
  assert.equal(done.awards.length, 2);
  assert.ok(done.events.some((event) => event.type === 'audio'
    && event.cue === 'clubhouse-component-repaired'));

  // Repeating the completed repair is safe: no kit, no award, no change.
  const repeat = restorationAction(state, {
    type: 'repair-component', component: 'panels', progress: 1,
  });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.changed, false);
  assert.equal(repeat.restored, true);
  assert.equal(state.shop.inventory[ARCHITECTURE_REPAIR_SKU].back, 1);
  assert.equal(repeat.awards.length, 0);
});

test('repair completion without repair components refuses and keeps the hold progress', () => {
  const state = workState({ kits: 0 });
  restorationAction(state, { type: 'repair-component', component: 'trim', progress: 0.9 });
  const blocked = restorationAction(state, {
    type: 'repair-component', component: 'trim', progress: 1,
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /unpacked and carried|backroom shelving/);
  assert.equal(state.shop.reno.componentRepairProgress.trim, 0.9);
  assert.equal(state.shop.reno.architecture.components.trim.restored, false);
  assert.equal(availableSupplyUnits(state, ARCHITECTURE_REPAIR_SKU), 0);
});

test('a carried repair kit is consumed from the hands first', () => {
  const state = workState({ kits: 1 });
  state.shop.carry = { skuId: ARCHITECTURE_REPAIR_SKU, qty: 1 };
  const done = restorationAction(state, {
    type: 'repair-component', component: 'floor', progress: 1,
  });
  assert.equal(done.ok, true);
  assert.equal(done.consumedFrom, 'hands');
  assert.equal(state.shop.carry, null);
  assert.equal(state.shop.inventory[ARCHITECTURE_REPAIR_SKU].back, 1);
});

test('painting requires the component to be repaired first and never repairs it', () => {
  const state = workState();
  const blocked = restorationAction(state, {
    type: 'paint-component', component: 'panels', finish: 'medium-walnut',
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /repaired before/);
  assert.equal(state.shop.reno.architecture.components.panels.restored, false);
  assert.equal(state.shop.reno.architecture.components.panels.finish, 'muted-sage');
});

test('painting a repaired component pays the works ledger exactly once and changes only the finish', () => {
  const state = workState({ cash: 500 });
  restorationAction(state, { type: 'repair-component', component: 'panels', progress: 1 });
  const startCash = state.cash;

  const painted = restorationAction(state, {
    type: 'paint-component', component: 'panels', finish: 'medium-walnut',
  });
  assert.equal(painted.ok, true);
  assert.equal(painted.changed, true);
  assert.equal(painted.cost, ARCHITECTURE_PAINT_COSTS.panels);
  assert.equal(state.shop.reno.architecture.components.panels.finish, 'medium-walnut');
  assert.equal(state.shop.reno.architecture.components.panels.restored, true);
  assert.equal(state.cash, startCash - ARCHITECTURE_PAINT_COSTS.panels);
  assert.ok(painted.events.some((event) => event.type === 'audio'
    && event.cue === 'clubhouse-paint-applied'));

  // Re-applying the same finish is free and changes nothing.
  const repeat = restorationAction(state, {
    type: 'paint-component', component: 'panels', finish: 'medium-walnut',
  });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.changed, false);
  assert.equal(repeat.cost, 0);
  assert.equal(state.cash, startCash - ARCHITECTURE_PAINT_COSTS.panels);

  // A different finish is a new application and pays again.
  const second = restorationAction(state, {
    type: 'paint-component', component: 'panels', finish: 'warm-cream',
  });
  assert.equal(second.ok, true);
  assert.equal(second.application, 2);
  assert.equal(state.cash, startCash - 2 * ARCHITECTURE_PAINT_COSTS.panels);
  assert.equal(state.shop.reno.componentPaintApplications.panels, 2);
});

test('painting refuses invalid finishes and insufficient cash without mutating state', () => {
  const state = workState({ cash: 10 });
  restorationAction(state, { type: 'repair-component', component: 'trim', progress: 1 });
  const wrongFinish = restorationAction(state, {
    type: 'paint-component', component: 'trim', finish: 'natural-oak',
  });
  assert.equal(wrongFinish.ok, false);
  assert.match(wrongFinish.reason, /not valid/);

  const broke = restorationAction(state, {
    type: 'paint-component', component: 'trim', finish: 'restrained-brass',
  });
  assert.equal(broke.ok, false);
  assert.match(broke.reason, /Not enough cash/);
  assert.equal(state.shop.reno.architecture.components.trim.finish, 'warm-cream');
  assert.equal(state.cash, 10);
});

test('completed repairs and finishes survive a JSON save round trip', () => {
  const state = workState();
  restorationAction(state, { type: 'repair-component', component: 'panels', progress: 1 });
  restorationAction(state, { type: 'paint-component', component: 'panels', finish: 'warm-cream' });
  restorationAction(state, { type: 'repair-component', component: 'windows', progress: 0.55 });

  const reloaded = JSON.parse(JSON.stringify(state));
  const reno = ensureClubhouseRestoration(reloaded);
  assert.equal(reno.architecture.components.panels.restored, true);
  assert.equal(reno.architecture.components.panels.finish, 'warm-cream');
  assert.equal(reno.componentRepairProgress.panels, 1);
  assert.equal(reno.componentRepairProgress.windows, 0.55);
  assert.equal(reno.componentPaintApplications.panels, 1);

  // The reloaded reputation ledger blocks a double award for the same repair.
  const replay = restorationAction(reloaded, {
    type: 'repair-component', component: 'panels', progress: 1,
  });
  assert.equal(replay.changed, false);
  assert.equal(replay.awards.length, 0);
});

test('the snapshot exposes structural work maps to the renderers', () => {
  const state = workState();
  restorationAction(state, { type: 'repair-component', component: 'porch', progress: 0.25 });
  const snapshot = restorationSnapshot(state);
  assert.deepEqual(Object.keys(snapshot.componentRepairProgress).sort(),
    [...ARCHITECTURE_COMPONENTS].sort());
  assert.equal(snapshot.componentRepairProgress.porch, 0.25);
  assert.equal(snapshot.componentPaintApplications.porch, 0);
  // Snapshot mutation must not write through to the live state.
  snapshot.componentRepairProgress.porch = 1;
  assert.equal(state.shop.reno.componentRepairProgress.porch, 0.25);
});

test('every component has a label, paint costs, and at least two finish options', () => {
  for (const component of ARCHITECTURE_COMPONENTS) {
    assert.ok(ARCHITECTURE_COMPONENT_LABELS[component], component);
    assert.ok(Number.isFinite(ARCHITECTURE_PAINT_COSTS[component]), component);
    assert.ok(ARCHITECTURE_PAINT_COSTS[component] > 0, component);
    assert.ok(ARCHITECTURE_FINISH_OPTIONS[component].length >= 2, component);
  }
});
