import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKCOUNTER_EAST_BOX_SURFACE_ID,
  FLOOR_BOX_SURFACE_ID,
  PACKING_STATION_BOX_SURFACE_ID,
  deliveryShelfSurfaceId,
} from '../src/data/boxPlacementSurfaces.js';
import { OFFICE, STOCKROOM } from '../src/data/shopLayout.js';
import {
  BOX_PLACEMENT_CODES,
  boxPlacementDimensions,
  boxPlacementEnvelope,
  previewBoxPlacement,
} from '../src/sim/boxPlacement.js';
import {
  BOX_LIFECYCLE,
  BOX_SCHEMA_VERSION,
  DELIVERIES_SCHEMA_VERSION,
  ensureDeliveries,
} from '../src/sim/deliveries.js';
import { newGame } from '../src/sim/state.js';

const surfaceTarget = (surfaceId, x = 0, z = 0, ry = 0) => ({
  kind: 'surface', surfaceId, x, z, ry,
});

function currentBox(id, extra = {}) {
  return {
    id,
    orderId: `order-${id}`,
    skuId: 'tees1',
    box: 'carton',
    qty: 12,
    cap: 12,
    initialQty: 12,
    lb: 2.2,
    fragile: false,
    loc: 'stock',
    tape: 0,
    cutProgress: 0,
    tapeSegments: { centre: 0, left: 0, right: 0 },
    flaps: [0, 0],
    flapProgress: [0, 0, 0, 0],
    openingProgress: 0,
    flattenProgress: 0,
    flat: false,
    lifecycle: BOX_LIFECYCLE.SEALED,
    schemaVersion: BOX_SCHEMA_VERSION,
    ...extra,
  };
}

test('floor previews reject every audited non-fixture solid, including STOCKROOM.bin', () => {
  const state = newGame('relaxed', 1201);
  state.shop.reno.clutter.forEach((pile) => { pile.cleared = true; });
  state.shop.reno.decor = [];
  const box = currentBox(1, { loc: 'carried' });

  for (const probe of [
    { id: 'recycling-station', x: STOCKROOM.bin.x, z: STOCKROOM.bin.z },
    { id: 'office-desk', x: OFFICE.desk.x, z: OFFICE.desk.z },
    { id: 'office-chair', x: OFFICE.chair.x, z: OFFICE.chair.z },
    // Probe the cabinet's north half, outside the adjacent desk collider.
    { id: 'office-filing-cabinet', x: 9.92, z: 3.25 },
    { id: 'cleaning-corner', x: STOCKROOM.cleaning.x, z: STOCKROOM.cleaning.z },
    { id: 'lounge-chair-a', x: 3.2, z: -5.35 },
    // Use the table's north-east quadrant, clear of both adjacent chairs.
    { id: 'lounge-coffee-table', x: 4.15, z: -5.25 },
    { id: 'retail-gondola', x: 0.40, z: -0.90 },
  ]) {
    const result = previewBoxPlacement(
      state,
      box,
      surfaceTarget(FLOOR_BOX_SURFACE_ID, probe.x, probe.z),
    );
    assert.equal(result.code, BOX_PLACEMENT_CODES.FIXTURE_OVERLAP, probe.id);
    assert.equal(result.blockerId, probe.id, probe.id);
  }
});

test('live clutter and placed floor decor participate in the same floor authority', () => {
  const state = newGame('relaxed', 1202);
  const box = currentBox(1, { loc: 'carried' });
  state.shop.reno.clutter = [{ x: 0, z: 2, ry: 0.4, cleared: false }];
  state.shop.reno.decor = [];

  const clutter = previewBoxPlacement(
    state,
    box,
    surfaceTarget(FLOOR_BOX_SURFACE_ID, 0, 2),
  );
  assert.equal(clutter.code, BOX_PLACEMENT_CODES.FIXTURE_OVERLAP);
  assert.equal(clutter.blockerId, 'clutter:0');

  state.shop.reno.clutter[0].cleared = true;
  state.shop.reno.decor = [{ skuId: 'plant1', spot: 1 }];
  const plant = previewBoxPlacement(
    state,
    box,
    surfaceTarget(FLOOR_BOX_SURFACE_ID, -9.7, 5.5),
  );
  assert.equal(plant.code, BOX_PLACEMENT_CODES.FIXTURE_OVERLAP);
  assert.equal(plant.blockerId, 'decor:plant1:1');
});

test('sealed dimensions stay exact while open and flat packaging reserves its visible silhouette', () => {
  const sealed = currentBox(1, {
    box: 'merchbox', skuId: 'cap1', qty: 8, cap: 8, initialQty: 8,
  });
  assert.deepEqual(boxPlacementDimensions(sealed), { w: 0.60, d: 0.40, h: 0.405 });

  const frontOpening = {
    ...sealed,
    flapProgress: [0.01, 0, 0, 0],
    flaps: [0.01, 0],
    openingProgress: 0.0025,
    lifecycle: BOX_LIFECYCLE.OPENING,
  };
  const frontDimensions = boxPlacementDimensions(frontOpening);
  assert.equal(frontDimensions.w, 0.60, 'a front flap does not invent side-flap width');
  assert.ok(frontDimensions.d > 0.40, 'the complete opening arc is reserved immediately');
  assert.ok(frontDimensions.h > 0.405, 'the raised panel is included in clearance');

  const allOpen = {
    ...sealed,
    tape: 1,
    cutProgress: 1,
    flapProgress: [1, 1, 1, 1],
    flaps: [1, 1],
    openingProgress: 1,
    lifecycle: BOX_LIFECYCLE.OPEN,
  };
  const openDimensions = boxPlacementDimensions(allOpen);
  assert.ok(openDimensions.w > 0.60);
  assert.ok(openDimensions.d > 0.40);
  assert.ok(openDimensions.h > 0.60);

  const authoredFlat = boxPlacementDimensions({
    ...allOpen, qty: 0, flat: true, flattenProgress: 1, lifecycle: BOX_LIFECYCLE.FLATTENING,
  });
  assert.deepEqual(authoredFlat, { w: 0.60, d: 0.40, h: 0.40 * 0.11 });

  const scaledGenericFlat = currentBox(2, {
    qty: 0,
    flat: true,
    flattenProgress: 1,
    lifecycle: BOX_LIFECYCLE.FLATTENING,
  });
  assert.deepEqual(boxPlacementDimensions(scaledGenericFlat), {
    w: 0.42,
    d: 0.36,
    h: 0.30 * 0.11,
  });

  const envelope = boxPlacementEnvelope(allOpen, { x: 2, z: -1, ry: Math.PI / 4 });
  assert.ok(envelope.halfX > 0.53 && envelope.halfZ > 0.53,
    'arbitrary-yaw collision projection uses the expanded open silhouette');
});

test('surface and equipment previews reject protruding lifecycle poses that sealed boxes fit', () => {
  const state = newGame('relaxed', 1203);
  state.shop.reno.clutter.forEach((pile) => { pile.cleared = true; });
  const shelf = deliveryShelfSurfaceId(1, 1);
  const sealed = currentBox(1, { loc: 'carried' });
  assert.equal(previewBoxPlacement(state, sealed, surfaceTarget(shelf)).ok, true);

  const opening = {
    ...sealed,
    tape: 1,
    cutProgress: 1,
    flapProgress: [0.01, 0, 0, 0],
    flaps: [0.01, 0],
    lifecycle: BOX_LIFECYCLE.OPENING,
  };
  const shelfResult = previewBoxPlacement(state, opening, surfaceTarget(shelf));
  assert.equal(shelfResult.code, BOX_PLACEMENT_CODES.OUTSIDE_SUPPORT);

  const flat = {
    ...opening,
    qty: 0,
    flat: true,
    flattenProgress: 1,
    lifecycle: BOX_LIFECYCLE.FLATTENING,
  };
  assert.equal(previewBoxPlacement(state, flat, surfaceTarget(shelf)).ok, true,
    'the scaled authored flat bundle stays inside its sealed footprint');
  assert.equal(previewBoxPlacement(state, flat, {
    kind: 'equipment',
    equipmentId: 'delivery_stocking_cart',
    socketId: 'STOCK_SOCKET_01',
  }).ok, true, 'the exact 0.42 x 0.36 flat bundle fits its authored cart socket');
  const equipmentOpening = {
    ...opening,
    flapProgress: [1, 1, 1, 1],
    flaps: [1, 1],
    openingProgress: 1,
    lifecycle: BOX_LIFECYCLE.OPEN,
  };
  assert.equal(
    previewBoxPlacement(state, equipmentOpening, {
      kind: 'equipment',
      equipmentId: 'delivery_stocking_cart',
      socketId: 'STOCK_BOX_SOCKET_TOP',
    }).code,
    BOX_PLACEMENT_CODES.OVERSIZE_FOOTPRINT,
  );

  const packing = previewBoxPlacement(
    state,
    opening,
    surfaceTarget(PACKING_STATION_BOX_SURFACE_ID),
  );
  assert.equal(packing.ok, true, packing.reason);
});

test('fresh current-schema loads heal fully in stable save order without duplication', () => {
  const state = newGame('relaxed', 1204);
  state.shop.reno.clutter.forEach((pile) => { pile.cleared = true; });
  state.shop.reno.decor = [];
  const lowerShelf = deliveryShelfSurfaceId(1, 1);
  const heightShelf = deliveryShelfSurfaceId(2, 1);
  const boxes = [
    // Array order, not numeric id, is the deterministic survivor rule.
    currentBox(90, { loc: 'world', surfaceId: lowerShelf, x: 0, z: 0, ry: 0 }),
    currentBox(1, {
      loc: 'world', surfaceId: lowerShelf, x: 0, z: 0, ry: 0,
      qty: 7, tape: 0.4, cutProgress: 0.4,
      tapeSegments: { centre: 0.66, left: 0, right: 0 },
      lifecycle: BOX_LIFECYCLE.CUTTING,
    }),
    currentBox(2, {
      loc: 'world', surfaceId: PACKING_STATION_BOX_SURFACE_ID, x: 99, z: 0, ry: 0,
    }),
    currentBox(3, {
      loc: 'world', surfaceId: heightShelf, x: 0, z: 0, ry: 0,
      box: 'fixture', skuId: 'vac1', qty: 1, cap: 1, initialQty: 1,
    }),
    currentBox(4, { loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x: 0, z: 2, ry: 0 }),
    currentBox(5, { loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x: 0.1, z: 2, ry: 0 }),
    currentBox(6, {
      loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID,
      x: STOCKROOM.bin.x, z: STOCKROOM.bin.z, ry: 0,
    }),
    currentBox(7, {
      loc: 'world', surfaceId: BACKCOUNTER_EAST_BOX_SURFACE_ID, x: 0, z: 0, ry: 0,
    }),
  ];
  state.shop.deliveries = {
    schemaVersion: DELIVERIES_SCHEMA_VERSION,
    boxes,
    nextBoxId: 91,
    trash: 0,
    recycled: 0,
    shipments: [],
    arrivedOrderIds: [],
  };

  // JSON parsing produces a brand-new authority object. It must be audited
  // despite every saved schema marker already claiming to be current.
  const loaded = JSON.parse(JSON.stringify(state));
  const identities = [...loaded.shop.deliveries.boxes];
  const invariants = identities.map((box) => ({
    id: box.id,
    qty: box.qty,
    orderId: box.orderId,
    lifecycle: box.lifecycle,
    cutProgress: box.cutProgress,
  }));
  const totalQty = identities.reduce((sum, box) => sum + box.qty, 0);

  ensureDeliveries(loaded);
  const healed = loaded.shop.deliveries.boxes;
  assert.equal(healed.length, identities.length);
  assert.equal(healed.reduce((sum, box) => sum + box.qty, 0), totalQty);
  healed.forEach((box, index) => {
    assert.equal(box, identities[index], `box ${box.id} retains object identity`);
    assert.deepEqual({
      id: box.id,
      qty: box.qty,
      orderId: box.orderId,
      lifecycle: box.lifecycle,
      cutProgress: box.cutProgress,
    }, invariants[index]);
  });

  assert.equal(healed[0].loc, 'world', 'the earliest valid shelf occupant survives');
  assert.equal(healed[0].id, 90, 'healing does not sort by id');
  for (const index of [1, 2, 3, 5, 6]) {
    assert.equal(healed[index].loc, 'stock', `invalid placement ${healed[index].id} heals visibly`);
    assert.equal(healed[index].surfaceId, undefined);
    assert.equal(healed[index].x, undefined);
    assert.equal(healed[index].z, undefined);
    assert.equal(healed[index].ry, undefined);
  }
  assert.equal(healed[4].loc, 'world', 'the earliest non-overlapping floor box survives');
  assert.equal(healed[7].loc, 'world', 'an independent valid counter box survives');

  const stableShape = JSON.stringify(healed);
  ensureDeliveries(loaded);
  assert.equal(JSON.stringify(healed), stableShape, 'cached repeat reads are idempotent');

  // A later placement-field edit invalidates the cheap signature and runs the
  // authority again; this is not a schema-only or one-shot repair.
  healed[0].x = 99;
  ensureDeliveries(loaded);
  assert.equal(healed[0].loc, 'stock');
  assert.equal(healed[0].id, 90);
  assert.equal(healed.length, identities.length);
  assert.equal(healed.reduce((sum, box) => sum + box.qty, 0), totalQty);
});

test('dynamic-blocker changes invalidate cached healing without touching legal cartons', () => {
  const state = newGame('relaxed', 1205);
  state.shop.reno.clutter.forEach((pile) => { pile.cleared = true; });
  const box = currentBox(1, {
    loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x: 0, z: 2, ry: 0,
  });
  state.shop.deliveries = {
    schemaVersion: DELIVERIES_SCHEMA_VERSION,
    boxes: [box],
    nextBoxId: 2,
    trash: 0,
    recycled: 0,
    shipments: [],
    arrivedOrderIds: [],
  };
  ensureDeliveries(state);
  assert.equal(box.loc, 'world');

  state.shop.reno.clutter = [{ x: 0, z: 2, ry: 0, cleared: false }];
  ensureDeliveries(state);
  assert.equal(box.loc, 'stock');
  assert.equal(box.id, 1);
  assert.equal(box.qty, 12);
});
