import test from 'node:test';
import assert from 'node:assert/strict';

import { BOX_KINDS } from '../src/data/boxes.js';
import {
  DELIVERY_VAN_CARGO_GAP_M,
  DELIVERY_VAN_CARGO_MARGIN_M,
  DELIVERY_VAN_CARGO_VOLUME,
  DELIVERY_VAN_MAX_BOXES_PER_LOAD,
  DELIVERY_VAN_MIN_SUPPORT_RATIO,
  deliveryVanCargoBoxesOverlap,
  deliveryVanCargoOrientations,
  planDeliveryVanCargo,
} from '../src/data/deliveryVanCargo.js';

function boxes(kind, count, prefix = kind, extra = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    box: kind,
    ...extra,
  }));
}

function sortedTypedIds(values) {
  return values.map((value) => `${typeof value}:${value}`).sort();
}

function assertValidPlan(plan, input) {
  assert.equal(plan.inputCount, input.length);
  assert.equal(plan.placedCount, input.length);
  assert.equal(plan.diagnostics.identityCountPreserved, true);
  assert.equal(plan.diagnostics.allWithinBounds, true);
  assert.equal(plan.diagnostics.noPairwiseOverlap, true);
  assert.equal(plan.diagnostics.supportRulesSatisfied, true);
  assert.deepEqual(sortedTypedIds(plan.allBoxIds), sortedTypedIds(input.map((box) => box.id)));
  assert.equal(plan.loads.reduce((total, load) => total + load.placements.length, 0), input.length);

  for (const [loadIndex, load] of plan.loads.entries()) {
    assert.equal(load.loadIndex, loadIndex);
    assert.equal(load.loadSequence, loadIndex + 1);
    assert.equal(load.loadId, `ref41-load-${String(loadIndex + 1).padStart(2, '0')}`);
    assert.ok(load.placements.length <= DELIVERY_VAN_MAX_BOXES_PER_LOAD);
    assert.equal(load.diagnostics.allWithinBounds, true);
    assert.equal(load.diagnostics.noPairwiseOverlap, true);
    assert.equal(load.diagnostics.supportRulesSatisfied, true);
    assert.deepEqual(load.boxIds, load.placements.map((entry) => entry.boxId));

    for (let i = 0; i < load.placements.length; i += 1) {
      const placement = load.placements[i];
      assert.equal(placement.loadId, load.loadId);
      assert.equal(placement.loadIndex, loadIndex);
      assert.equal(placement.placementIndex, i);
      assert.equal(placement.withinBounds, true);
      assert.equal(placement.clearance.withinBounds, true);
      assert.equal(placement.clearance.roofSafe, true);
      assert.ok(placement.clearance.minimum >= DELIVERY_VAN_CARGO_MARGIN_M - 1e-7);
      assert.ok(placement.clearance.faces.roof >= DELIVERY_VAN_CARGO_MARGIN_M - 1e-7);
      assert.equal(placement.support.valid, true);
      assert.ok(placement.localQuaternion && Number.isFinite(placement.localQuaternion.w));
      assert.equal(placement.localEuler.order, 'YXZ');
      assert.ok(placement.orientedDimensions.x > 0);
      assert.ok(placement.orientedDimensions.y > 0);
      assert.ok(placement.orientedDimensions.z > 0);
      for (let j = i + 1; j < load.placements.length; j += 1) {
        assert.equal(
          deliveryVanCargoBoxesOverlap(placement, load.placements[j]),
          false,
          `${placement.boxId} overlaps ${load.placements[j].boxId} in ${load.loadId}`,
        );
      }
    }
  }
}

test('Ref 41 exposes the authored shell and a 20 mm inset usable cargo volume', () => {
  assert.deepEqual(DELIVERY_VAN_CARGO_VOLUME.physical, {
    min: { x: -0.3575, y: 0.5, z: -0.75 },
    max: { x: 2.4975, y: 2.1875, z: 0.75 },
  });
  assert.deepEqual(DELIVERY_VAN_CARGO_VOLUME.usable, {
    min: { x: -0.3375, y: 0.52, z: -0.73 },
    max: { x: 2.4775, y: 2.1675, z: 0.73 },
  });
  assert.equal(DELIVERY_VAN_CARGO_VOLUME.margin, 0.02);
  assert.equal(DELIVERY_VAN_CARGO_GAP_M, 0.02);
});

test('every BOX_KIND has at least one legal in-volume rest and keeps its identity', () => {
  for (const kind of Object.keys(BOX_KINDS)) {
    const input = [{ id: `only-${kind}`, box: kind, fragile: kind === 'apparel' }];
    const orientations = deliveryVanCargoOrientations(kind);
    assert.ok(orientations.length >= 1, `${kind} has a legal rest`);
    const plan = planDeliveryVanCargo(input);
    assertValidPlan(plan, input);
    assert.equal(plan.loadCount, 1);
    assert.equal(plan.placements[0].kind, kind);
    assert.ok(orientations.some((orientation) => orientation.id === plan.placements[0].orientationId));
  }
});

test('standard, long, bag, and crate families expose only stable shipping rotations', () => {
  const standard = deliveryVanCargoOrientations('carton');
  assert.deepEqual(standard.map((entry) => entry.id), [
    'upright-longitudinal', 'upright-crosswise',
  ]);
  assert.deepEqual(standard.map((entry) => entry.orientedDimensions), [
    { x: 0.42, y: 0.30, z: 0.36 },
    { x: 0.36, y: 0.30, z: 0.42 },
  ]);

  const long = deliveryVanCargoOrientations('clubbox');
  assert.deepEqual(long.map((entry) => entry.id), ['longitudinal-low', 'crosswise-low']);
  assert.deepEqual(long[0].orientedDimensions, { x: 1.25, y: 0.18, z: 0.18 });

  const bag = deliveryVanCargoOrientations('bagcarton');
  assert.deepEqual(bag.map((entry) => entry.id), [
    'side-rest-longitudinal', 'side-rest-crosswise',
  ]);
  assert.deepEqual(bag.map((entry) => entry.orientedDimensions), [
    { x: 1.05, y: 0.72, z: 0.52 },
    { x: 0.52, y: 0.72, z: 1.05 },
  ]);

  const crate = deliveryVanCargoOrientations('crate');
  assert.deepEqual(crate.map((entry) => entry.id), [
    'broad-side-rest-longitudinal', 'broad-side-rest-crosswise',
  ]);
  assert.deepEqual(crate.map((entry) => entry.orientedDimensions), [
    { x: 1.25, y: 0.85, z: 0.98 },
    { x: 0.98, y: 0.85, z: 1.25 },
  ]);
  assert.ok([...bag, ...crate].every((entry) => entry.orientedDimensions.y < 1));
});

test('nine standard cartons fit one load without overlap or roof intrusion', () => {
  const input = boxes('carton', 9, 'standard');
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  assert.equal(plan.loadCount, 1);
  assert.equal(plan.loads[0].placements.length, 9);
  assert.ok(plan.placements.every((entry) => entry.restProfile === 'upright'));
});

test('nine 1.25 m clubboxes fit one load in legal low rests', () => {
  const input = boxes('clubbox', 9, 'club');
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  assert.equal(plan.loadCount, 1);
  assert.equal(plan.loads[0].placements.length, 9);
  assert.ok(plan.placements.every((entry) => entry.restProfile === 'longitudinal-low'));
  assert.ok(plan.placements.every((entry) => entry.orientedDimensions.y === 0.18));
});

test('bag-carton overflow becomes sequential complete loads instead of hidden cargo', () => {
  const input = boxes('bagcarton', 12, 'bag');
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  assert.equal(plan.requiresSequentialLoads, true);
  assert.deepEqual(plan.loads.map((load) => load.placements.length), [9, 3]);
  assert.ok(plan.placements.every((entry) => entry.restProfile === 'side-rest-longitudinal'));
});

test('broad-side furniture crates split on physical fit before the nine-box limit', () => {
  const input = boxes('crate', 5, 'crate');
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  assert.equal(plan.requiresSequentialLoads, true);
  assert.deepEqual(plan.loads.map((load) => load.placements.length), [2, 2, 1]);
  assert.ok(plan.placements.every((entry) => entry.support.type === 'floor'));
  assert.ok(plan.placements.every((entry) => entry.restProfile === 'broad-side-rest'));
});

test('twenty compatible cartons preserve all identities and deterministic poses across saved trips', () => {
  const input = boxes('merchbox', 20, 'overflow');
  const inputBefore = JSON.stringify(input);
  const plan = planDeliveryVanCargo(input);
  const roundTripped = JSON.parse(JSON.stringify([...input].reverse()));
  const restoredPlan = planDeliveryVanCargo(roundTripped);
  assertValidPlan(plan, input);
  assert.deepEqual(plan.loads.map((load) => load.placements.length), [9, 9, 2]);
  assert.equal(new Set(plan.allBoxIds).size, 20);
  assert.equal(plan.diagnostics.boundaryViolations.length, 0);
  assert.equal(plan.diagnostics.overlapPairs.length, 0);
  assert.deepEqual(restoredPlan, plan);
  assert.equal(JSON.stringify(input), inputBefore);
});

test('mixed BOX_KINDS pack together without losing the awkward or fragile identities', () => {
  const input = Object.keys(BOX_KINDS).map((kind, index) => ({
    id: index % 2 ? index : `mixed-${index}`,
    box: kind,
    fragile: kind === 'apparel',
  }));
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  assert.deepEqual(new Set(plan.placements.map((entry) => entry.kind)), new Set(Object.keys(BOX_KINDS)));
  assert.equal(plan.placements.find((entry) => entry.kind === 'apparel').fragile, true);
});

test('every stacked box has heavy/large, non-fragile support and at least 85% footprint', () => {
  const input = [
    ...boxes('bagcarton', 5, 'heavy-base'),
    ...boxes('apparel', 4, 'light-top'),
  ];
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  const stacked = plan.placements.filter((entry) => entry.support.type === 'box');
  assert.ok(stacked.length >= 4, 'the fixture forces real stacked support checks');

  for (const upper of stacked) {
    const load = plan.loads[upper.loadIndex];
    const lower = load.placements.find((entry) => entry.boxId === upper.support.boxId);
    assert.ok(lower, `${upper.boxId} names its lower support`);
    assert.ok(lower.massRank >= upper.massRank, 'lower cargo is at least as heavy');
    assert.ok(lower.volume >= upper.volume, 'lower cargo is at least as large by sealed volume');
    assert.equal(lower.fragile, false);
    assert.equal(upper.support.massCompatible, true);
    assert.equal(upper.support.sizeCompatible, true);
    assert.equal(upper.support.nonFragile, true);
    assert.ok(upper.support.footprintRatio >= DELIVERY_VAN_MIN_SUPPORT_RATIO);
  }
});

test('fragile lower cartons never become supports and incompatible tops move to the next load', () => {
  const input = [
    ...boxes('bagcarton', 5, 'fragile-base', { fragile: true }),
    ...boxes('apparel', 4, 'safe-top'),
  ];
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  assert.equal(plan.loadCount, 2);
  const supportIds = new Set(plan.placements
    .filter((entry) => entry.support.type === 'box')
    .map((entry) => entry.support.boxId));
  assert.ok(plan.placements.filter((entry) => entry.fragile)
    .every((entry) => !supportIds.has(entry.boxId)));
});

test('pairwise AABB checks reject overlap and all generated loads remain disjoint', () => {
  const overlappingA = { bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } };
  const overlappingB = { bounds: { min: { x: 0.9, y: 0.2, z: 0.2 }, max: { x: 1.2, y: 0.8, z: 0.8 } } };
  const touching = { bounds: { min: { x: 1, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } } };
  assert.equal(deliveryVanCargoBoxesOverlap(overlappingA, overlappingB), true);
  assert.equal(deliveryVanCargoBoxesOverlap(overlappingA, touching), false);

  const input = [
    ...boxes('crate', 3, 'pair-crate'),
    ...boxes('bagcarton', 7, 'pair-bag'),
    ...boxes('ballcase', 8, 'pair-ball'),
  ];
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
});

test('the highest legal stacks retain the 20 mm modeled roof clearance', () => {
  const input = boxes('bagcarton', 9, 'roof');
  const plan = planDeliveryVanCargo(input);
  assertValidPlan(plan, input);
  const highest = plan.placements.reduce((best, entry) => (
    entry.bounds.max.y > best.bounds.max.y ? entry : best
  ));
  assert.ok(highest.bounds.max.y <= DELIVERY_VAN_CARGO_VOLUME.usable.max.y + 1e-7);
  assert.ok(highest.clearance.faces.roof >= DELIVERY_VAN_CARGO_MARGIN_M - 1e-7);
  assert.ok(highest.support.type === 'box', 'roof fixture exercises a real second tier');
});

test('planning is deterministic after input permutation and a JSON save roundtrip', () => {
  const input = [
    ...boxes('carton', 4, 'det-carton'),
    ...boxes('clubbox', 5, 'det-club'),
    ...boxes('bagcarton', 4, 'det-bag'),
    ...boxes('crate', 3, 'det-crate'),
    { id: 82, box: 'ballcase', fragile: false },
    { id: 17, box: 'apparel', fragile: true },
  ];
  const untouched = JSON.stringify(input);
  const first = planDeliveryVanCargo(input);
  const roundTrippedAndPermuted = JSON.parse(JSON.stringify([...input].reverse()));
  const second = planDeliveryVanCargo(roundTrippedAndPermuted);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(input), untouched, 'the pure planner does not mutate boxes[]');
  assertValidPlan(first, input);
});

test('invalid or duplicate box identities fail explicitly instead of disappearing', () => {
  assert.throws(() => planDeliveryVanCargo([{ id: 'bad', box: 'not-a-box-kind' }]), /Unknown/);
  assert.throws(() => planDeliveryVanCargo([
    { id: 'same', box: 'carton' },
    { id: 'same', box: 'clubbox' },
  ]), /Duplicate/);
  assert.throws(() => planDeliveryVanCargo([{ box: 'carton' }]), /needs a finite number or string id/);
});
