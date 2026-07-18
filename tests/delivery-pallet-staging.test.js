import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DELIVERY_PALLET_STAGING, deliveryPalletCentres, planPalletizedPadBoxes,
  assignDeliveryPallets, deliveryBoxFitsPallet, deliveryPalletIndexForBox,
  sealedDeliveryBoxHeight,
} from '../src/data/deliveryStaging.js';
import { BOX_KINDS } from '../src/data/boxes.js';
import { DOOR_BACK, INTERIOR, STOCKROOM } from '../src/data/shopLayout.js';
import {
  DELIVERIES_SCHEMA_VERSION, arriveOrder, ensureDeliveries, pickUpBox, putDownBox,
} from '../src/sim/deliveries.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

const box = (id, kind = 'merchbox') => ({ id, box: kind, loc: 'pad' });

test('five ref-44 pallets fit the existing nine-carton receiving capacity', () => {
  const centres = deliveryPalletCentres();
  assert.equal(centres.length, 5);
  assert.deepEqual(centres.map(({ x, z }) => [+x.toFixed(2), +z.toFixed(2)]), [
    [11.65, 0.62], [13.00, 0.62], [14.35, 0.62], [12.32, -0.67], [13.68, -0.67],
  ]);
  const apron = DELIVERY_PALLET_STAGING.receivingApron;
  for (const centre of centres) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = centre.x + sx * DELIVERY_PALLET_STAGING.length / 2;
        const z = centre.z + sz * DELIVERY_PALLET_STAGING.width / 2;
        assert.ok(Math.abs(x - STOCKROOM.padOutside.x) <= apron.length / 2
          && Math.abs(z - STOCKROOM.padOutside.z) <= apron.width / 2,
        `pallet ${centre.palletIndex} corner remains inside the receiving apron`);
      }
    }
  }
  const rowOne = centres.slice(0, 3);
  const rowTwo = centres.slice(3);
  assert.ok(rowOne[1].x - rowOne[0].x - DELIVERY_PALLET_STAGING.length >= 0.14);
  assert.ok(rowTwo[1].x - rowTwo[0].x - DELIVERY_PALLET_STAGING.length >= 0.14);
  assert.ok(rowOne[0].z - rowTwo[0].z - DELIVERY_PALLET_STAGING.width >= 0.28,
    'staggered rows remain visually distinct and preserve opposing fork approaches');
});

test('pallet footprints leave a navigable exterior back-door clearway', () => {
  const exteriorClearway = {
    minX: INTERIOR.w / 2,
    maxX: INTERIOR.w / 2 + 0.65,
    minZ: DOOR_BACK.z - DOOR_BACK.w / 2 - 0.30,
    maxZ: DOOR_BACK.z + DOOR_BACK.w / 2 + 0.30,
  };
  for (const centre of deliveryPalletCentres()) {
    const pallet = {
      minX: centre.x - DELIVERY_PALLET_STAGING.length / 2,
      maxX: centre.x + DELIVERY_PALLET_STAGING.length / 2,
      minZ: centre.z - DELIVERY_PALLET_STAGING.width / 2,
      maxZ: centre.z + DELIVERY_PALLET_STAGING.width / 2,
    };
    const overlaps = pallet.minX < exteriorClearway.maxX && pallet.maxX > exteriorClearway.minX
      && pallet.minZ < exteriorClearway.maxZ && pallet.maxZ > exteriorClearway.minZ;
    assert.equal(overlaps, false, `pallet ${centre.palletIndex} stays out of the exterior door clearway`);
  }
});

test('nine pad boxes form five deterministic stacks with no more than two cartons each', () => {
  const plan = planPalletizedPadBoxes([
    box(1, 'merchbox'), box(2, 'apparel'), box(3, 'clubbox'),
    box(4, 'clubbox'), box(5, 'merchbox'), box(6, 'apparel'),
    box(7, 'carton'), box(8, 'carton'), box(9, 'carton'),
  ]);
  assert.equal(plan.length, 9);
  for (let palletIndex = 0; palletIndex < DELIVERY_PALLET_STAGING.count; palletIndex += 1) {
    const lane = plan.filter((slot) => slot.palletIndex === palletIndex);
    assert.ok(lane.length >= 1 && lane.length <= 2, `pallet ${palletIndex} carries one or two cartons`);
    assert.equal(lane[0].baseY, DELIVERY_PALLET_STAGING.height);
    if (lane[1]) {
      assert.equal(
        lane[1].baseY,
        lane[0].baseY + lane[0].stackHeight + DELIVERY_PALLET_STAGING.stackGap,
      );
    }
    const top = lane.at(-1).baseY + lane.at(-1).stackHeight;
    assert.ok(top <= DELIVERY_PALLET_STAGING.maxStackTop, `pallet ${palletIndex} top is reachable`);
  }
});

test('sealed visual envelopes account for authored trim and procedural tape crowns', () => {
  assert.equal(sealedDeliveryBoxHeight('merchbox'), 0.405);
  assert.equal(sealedDeliveryBoxHeight('apparel'), 0.366);
  assert.equal(sealedDeliveryBoxHeight('clubbox'), 0.180);
  assert.equal(sealedDeliveryBoxHeight('carton'), 0.312);
  assert.equal(sealedDeliveryBoxHeight('shoebox'), 0.332);
});

test('persisted least-loaded assignment defeats skewed ids and survives selective pickup', () => {
  const boxes = Array.from({ length: 9 }, (_, index) => box(1 + index * 3, 'carton'));
  assignDeliveryPallets(boxes);
  const laneCounts = Array.from({ length: DELIVERY_PALLET_STAGING.count }, (_, palletIndex) => (
    boxes.filter((entry) => entry.padPalletIndex === palletIndex).length
  ));
  assert.deepEqual([...laneCounts].sort((a, b) => a - b), [1, 2, 2, 2, 2]);
  const before = new Map(planPalletizedPadBoxes(boxes).map((slot) => [slot.boxId, slot]));
  const after = new Map(planPalletizedPadBoxes(boxes.filter((entry) => entry.id !== 13))
    .map((slot) => [slot.boxId, slot]));
  for (const [id, slot] of after) {
    assert.equal(slot.palletIndex, before.get(id).palletIndex, `box ${id} keeps its pallet lane`);
    assert.equal(slot.x, before.get(id).x, `box ${id} keeps its pallet x`);
    assert.equal(slot.z, before.get(id).z, `box ${id} keeps its pallet z`);
    assert.equal(slot.baseY, before.get(id).baseY, `box ${id} keeps its support height`);
  }
  assert.equal(deliveryPalletIndexForBox(boxes[7]), boxes[7].padPalletIndex);
  const reloaded = JSON.parse(JSON.stringify(boxes));
  assert.deepEqual(
    reloaded.map((entry) => entry.padPalletIndex),
    boxes.map((entry) => entry.padPalletIndex),
  );
});

test('every box family fits and nine of any family remain supported below 2.3 m', () => {
  for (const kind of Object.values(BOX_KINDS)) {
    assert.equal(deliveryBoxFitsPallet(kind.id), true, `${kind.id} fits the ref-44 deck`);
    const boxes = Array.from({ length: 9 }, (_, index) => box(101 + index * 7, kind.id));
    assignDeliveryPallets(boxes);
    const plan = planPalletizedPadBoxes(boxes);
    for (let palletIndex = 0; palletIndex < DELIVERY_PALLET_STAGING.count; palletIndex += 1) {
      const lane = plan.filter((slot) => slot.palletIndex === palletIndex);
      assert.ok(lane.length <= DELIVERY_PALLET_STAGING.maxBoxesPerPallet);
      if (!lane.length) continue;
      const top = lane.at(-1).baseY + lane.at(-1).stackHeight;
      assert.ok(top <= DELIVERY_PALLET_STAGING.maxStackTop,
        `${kind.id} stack ${palletIndex} ends at ${top.toFixed(3)} m`);
      assert.ok(lane.every((slot) => slot.footprintSupported));
    }
  }
});

test('heavy supports carry smaller fragile cartons while long cartons pair only with long cartons', () => {
  const boxes = [
    { ...box(2, 'carton'), padPalletIndex: 0, fragile: true, lb: 2 },
    { ...box(1, 'crate'), padPalletIndex: 0, fragile: false, lb: 80 },
    { ...box(4, 'clubbox'), padPalletIndex: 1, fragile: false, lb: 7 },
    { ...box(3, 'clubbox'), padPalletIndex: 1, fragile: false, lb: 8 },
  ];
  const plan = planPalletizedPadBoxes(boxes);
  assert.deepEqual(plan.filter((slot) => slot.palletIndex === 0).map((slot) => slot.boxId), [1, 2]);
  assert.deepEqual(plan.filter((slot) => slot.palletIndex === 1).map((slot) => slot.boxId), [3, 4]);
  assert.ok(plan.every((slot) => slot.footprintSupported));
});

test('arrival persists balanced pallet lanes and v3 saves migrate exactly once', () => {
  const state = newGame('relaxed', 4401);
  const made = [];
  for (let orderId = 1; orderId <= 9; orderId += 1) {
    made.push(...arriveOrder(state, { id: orderId, skuId: 'bag1', qty: 1 }));
  }
  const arrivalCounts = Array.from({ length: DELIVERY_PALLET_STAGING.count }, (_, palletIndex) => (
    made.filter((entry) => entry.padPalletIndex === palletIndex).length
  ));
  assert.deepEqual([...arrivalCounts].sort((a, b) => a - b), [1, 2, 2, 2, 2]);

  state.shop.deliveries.schemaVersion = DELIVERIES_SCHEMA_VERSION - 1;
  for (let index = 0; index < made.length; index += 1) {
    made[index].id = 1 + index * 3;
    delete made[index].padPalletIndex;
  }
  ensureDeliveries(state);
  const migrated = made.map((entry) => entry.padPalletIndex);
  const migrationCounts = Array.from({ length: DELIVERY_PALLET_STAGING.count }, (_, palletIndex) => (
    migrated.filter((entry) => entry === palletIndex).length
  ));
  assert.deepEqual([...migrationCounts].sort((a, b) => a - b), [1, 2, 2, 2, 2]);
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.shop.deliveries.schemaVersion, DELIVERIES_SCHEMA_VERSION);
  assert.deepEqual(
    loaded.shop.deliveries.boxes.map((entry) => entry.padPalletIndex),
    migrated,
  );
});

test('legacy over-capacity saves keep every carton in stable marked overflow lanes', () => {
  const boxes = Array.from({ length: 11 }, (_, index) => box(900 + index * 5, 'bagcarton'));
  assignDeliveryPallets(boxes, { rebalance: true });
  assert.equal(boxes.length, 11);
  assert.ok(boxes.some((entry) => entry.padStagingOverflow), 'legacy excess is explicit');
  assert.ok(boxes.every((entry) => Number.isInteger(entry.padPalletIndex)));
  const first = JSON.stringify(boxes.map((entry) => ({
    id: entry.id,
    pallet: entry.padPalletIndex,
    overflow: !!entry.padStagingOverflow,
  })));
  assignDeliveryPallets(boxes);
  assert.equal(JSON.stringify(boxes.map((entry) => ({
    id: entry.id,
    pallet: entry.padPalletIndex,
    overflow: !!entry.padStagingOverflow,
  }))), first, 'repeated reads never reshuffle a legacy overflow save');
  assert.equal(planPalletizedPadBoxes(boxes).length, 11, 'migration loses no physical carton');
});

test('buried cartons are rejected by simulation and a returned carton gets a fresh safe lane', () => {
  const state = newGame('relaxed', 4402);
  const made = [];
  for (let orderId = 1; orderId <= 6; orderId += 1) {
    made.push(...arriveOrder(state, { id: 100 + orderId, skuId: 'bag1', qty: 1 }));
  }
  assert.equal(made[0].padPalletIndex, made[5].padPalletIndex);
  const buried = pickUpBox(state, made[0].id);
  assert.equal(buried.ok, false);
  assert.match(buried.reason, /stacked above/i);

  assert.equal(pickUpBox(state, made[5].id).ok, true);
  assert.equal(made[5].padPalletIndex, undefined, 'leaving the pad releases the persisted lane');
  assert.equal(putDownBox(state, made[5].id, 'pad').ok, true);
  assert.ok(Number.isInteger(made[5].padPalletIndex));
  const laneCounts = new Map();
  for (const entry of state.shop.deliveries.boxes) {
    laneCounts.set(entry.padPalletIndex, (laneCounts.get(entry.padPalletIndex) || 0) + 1);
  }
  assert.ok([...laneCounts.values()].every((count) => count <= 2));
});

test('a ref-48 long carton has only the intentional 2.5 cm end overhang', () => {
  const [slot] = planPalletizedPadBoxes([box(1, 'clubbox')]);
  const overhang = Math.max(0, (slot.dimensions.w - DELIVERY_PALLET_STAGING.length) / 2);
  assert.ok(overhang <= 0.0251, `long-carton end overhang ${overhang.toFixed(4)} m`);
  assert.equal(slot.baseY, DELIVERY_PALLET_STAGING.height);
});

test('preload fallback can stage boxes on ground until the authored pallet is ready', () => {
  const [slot] = planPalletizedPadBoxes([box(1)], { palletHeight: 0 });
  assert.equal(slot.baseY, 0);
});
