import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import { COUNTER, FIXTURES } from '../src/data/shopLayout.js';
import {
  APPAREL_TABLE_BOX_SURFACE_ID,
  BACKCOUNTER_EAST_BOX_SURFACE_ID,
  BOX_PLACEMENT_SURFACE_TEMPLATES,
  FLOOR_BOX_SURFACE_ID,
  HAND_TRUCK_BOX_SURFACE_ID,
  PACKING_STATION_BOX_SURFACE_ID,
  deliveryPalletSurfaceId,
  deliveryShelfSurfaceId,
  stockingCartSurfaceId,
} from '../src/data/boxPlacementSurfaces.js';
import {
  BOX_PLACEMENT_CODES,
  boxPlacementCapabilities,
  boxPlacementEnvelope,
  boxPlacementSurfaces,
  boxesOnSurface,
  previewBoxPlacement,
  resolveBoxPose,
  resolveSurfacePose,
  snapBoxPlacementTarget,
  surfaceById,
} from '../src/sim/boxPlacement.js';

const fresh = () => newGame('relaxed', 801);
const carton = (id = 100, extra = {}) => ({
  id,
  skuId: 'tees1',
  box: 'carton',
  qty: 12,
  cap: 12,
  loc: 'carried',
  ...extra,
});

const worldTarget = (surfaceId, x = 0, z = 0, ry = 0) => ({
  kind: 'surface', surfaceId, x, z, ry,
});

test('the allowlist has stable IDs and exact authored support contracts', () => {
  assert.equal(BOX_PLACEMENT_SURFACE_TEMPLATES.length, 25);
  assert.equal(new Set(BOX_PLACEMENT_SURFACE_TEMPLATES.map((surface) => surface.id)).size, 25);

  const state = fresh();
  const floor = surfaceById(state, FLOOR_BOX_SURFACE_ID);
  assert.deepEqual(floor.bounds, { minX: -8.95, maxX: 8.95, minZ: -5.5, maxZ: 5.5 });

  const table = surfaceById(state, APPAREL_TABLE_BOX_SURFACE_ID);
  assert.deepEqual(table.localPose, { x: 0, y: 0.801, z: 0, ry: 0 });
  assert.deepEqual(table.bounds, { minX: -0.76, maxX: 0.76, minZ: -0.41, maxZ: 0.41 });
  assert.deepEqual(table.worldPose, { x: -6, y: 0.801, z: 0.65, ry: 0 });

  const lowerWest = surfaceById(state, deliveryShelfSurfaceId(1, 1));
  const topEast = surfaceById(state, deliveryShelfSurfaceId(2, 4));
  assert.deepEqual(lowerWest.localPose, { x: -0.44, y: 0.3336, z: 0, ry: 0 });
  assert.deepEqual(topEast.localPose, { x: 0.44, y: 1.9084, z: 0, ry: 0 });
  assert.equal(lowerWest.maxHeight, 0.44);
  assert.equal(topEast.maxHeight, 0.33);

  const counter = surfaceById(state, BACKCOUNTER_EAST_BOX_SURFACE_ID);
  const backcounter = FIXTURES.find((fixture) => fixture.id === 'backcounter');
  const localX = counter.localPose.x;
  const localZ = counter.localPose.z;
  const expectedX = backcounter.x
    + localX * Math.cos(backcounter.ry) + localZ * Math.sin(backcounter.ry);
  const expectedZ = backcounter.z
    - localX * Math.sin(backcounter.ry) + localZ * Math.cos(backcounter.ry);
  assert.ok(Math.abs(counter.worldPose.x - expectedX) < 1e-12);
  assert.equal(counter.worldPose.y, 1.01);
  assert.ok(Math.abs(counter.worldPose.z - expectedZ) < 1e-12);
  assert.equal(counter.worldPose.ry, backcounter.ry);
  assert.deepEqual(counter.bounds, { minX: -0.95, maxX: 0.95, minZ: -0.23, maxZ: 0.23 });

  const centres = [
    [10.35, 0.62], [11.7, 0.62], [13.049999999999999, 0.62], [11.024999999999999, -0.67], [12.375, -0.67],
  ];
  centres.forEach(([x, z], index) => {
    const pallet = surfaceById(state, deliveryPalletSurfaceId(index));
    assert.deepEqual([pallet.worldPose.x, pallet.worldPose.y, pallet.worldPose.z], [x, 0.14, z]);
    assert.equal(pallet.capacity, 2);
  });

  const top = surfaceById(state, stockingCartSurfaceId('STOCK_BOX_SOCKET_TOP'));
  assert.deepEqual(top.worldPose, { x: 6.35, y: 0.803, z: -3.4, ry: 0 });
  assert.deepEqual(top.bounds, { minX: -0.31, maxX: 0.31, minZ: -0.21, maxZ: 0.21 });
});

test('surface enumeration and pose queries never mutate save state', () => {
  const state = fresh();
  const before = JSON.stringify(state);
  assert.equal(boxPlacementSurfaces(state).length, 25);
  assert.ok(resolveSurfacePose(state, worldTarget(APPAREL_TABLE_BOX_SURFACE_ID, 0.25, 0, 0)).ok);
  assert.ok(previewBoxPlacement(state, carton(), worldTarget(FLOOR_BOX_SURFACE_ID, 4, 0, 0)).ok);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.shop.layout.version, 2, 'pure queries preserve the canonical layout state');
});

test('yaw-aware envelopes use the full cosine/sine projection at arbitrary angles', () => {
  const club = { box: 'clubbox', qty: 2 };
  const envelope = boxPlacementEnvelope(club, { x: 4, z: -2, ry: Math.PI / 4, baseY: 0.8 });
  const expectedHalf = (Math.SQRT1_2 * 1.25 + Math.SQRT1_2 * 0.18) / 2;
  assert.ok(Math.abs(envelope.halfX - expectedHalf) < 1e-12);
  assert.ok(Math.abs(envelope.halfZ - expectedHalf) < 1e-12);
  assert.equal(envelope.minY, 0.8);
  assert.equal(envelope.maxY, 0.98);
});

test('surface containment is rotation-aware and returns exact diagnostics', () => {
  const state = fresh();
  const longBox = carton(1, { box: 'clubbox', skuId: 'driver1', qty: 2, cap: 2 });
  const alongTable = previewBoxPlacement(
    state, longBox, worldTarget(APPAREL_TABLE_BOX_SURFACE_ID, 0, 0, 0),
  );
  assert.equal(alongTable.ok, true, alongTable.reason);

  const acrossTable = previewBoxPlacement(
    state, longBox, worldTarget(APPAREL_TABLE_BOX_SURFACE_ID, 0, 0, Math.PI / 2),
  );
  assert.equal(acrossTable.ok, false);
  assert.equal(acrossTable.code, BOX_PLACEMENT_CODES.OUTSIDE_SUPPORT);
  assert.match(acrossTable.reason, /hang beyond/i);

  const missingCoordinates = previewBoxPlacement(
    state, longBox, { kind: 'surface', surfaceId: APPAREL_TABLE_BOX_SURFACE_ID },
  );
  assert.equal(missingCoordinates.code, BOX_PLACEMENT_CODES.INVALID_POSITION);
});

test('shelf clearance, capacity, and separated vertical levels are enforced from boxes only', () => {
  const state = fresh();
  const lower = deliveryShelfSurfaceId(1, 1);
  const upper = deliveryShelfSurfaceId(1, 2);
  const existing = carton(1, {
    loc: 'world', surfaceId: lower, x: 0, z: 0, ry: 0,
  });
  state.shop.deliveries.boxes.push(existing);

  assert.deepEqual(boxesOnSurface(state, lower).map((box) => box.id), [1]);
  const full = previewBoxPlacement(state, carton(2), worldTarget(lower));
  assert.equal(full.code, BOX_PLACEMENT_CODES.SURFACE_FULL);
  assert.deepEqual(full.occupiedByBoxIds, [1]);

  const verticallyClear = previewBoxPlacement(state, carton(2), worldTarget(upper));
  assert.equal(verticallyClear.ok, true, verticallyClear.reason);
  assert.equal(verticallyClear.pose.x, resolveBoxPose(state, existing).pose.x);
  assert.equal(verticallyClear.pose.z, resolveBoxPose(state, existing).pose.z);
  assert.ok(verticallyClear.pose.baseY > resolveBoxPose(state, existing).envelope.maxY);

  const tooTall = previewBoxPlacement(
    state,
    carton(3, { box: 'fixture', qty: 1, cap: 1 }),
    worldTarget(deliveryShelfSurfaceId(2, 1)),
  );
  assert.equal(tooTall.code, BOX_PLACEMENT_CODES.TOO_TALL);
});

test('retail stock reserves its footprint while the cleared packing worktop stays usable', () => {
  const state = fresh();
  state.shop.inventory.polo1.shelf = 1;

  const poloStack = previewBoxPlacement(
    state, carton(1), worldTarget(APPAREL_TABLE_BOX_SURFACE_ID, -0.50, -0.20),
  );
  assert.equal(poloStack.code, BOX_PLACEMENT_CODES.RESERVED_SPACE);
  assert.match(poloStack.reason, /polo1 display stack/i);

  const otherEnd = previewBoxPlacement(
    state, carton(1), worldTarget(APPAREL_TABLE_BOX_SURFACE_ID, 0.45, 0.20),
  );
  assert.equal(otherEnd.ok, true, otherEnd.reason);

  const clipboard = previewBoxPlacement(
    state, carton(2), worldTarget(PACKING_STATION_BOX_SURFACE_ID, -0.4, 0.1),
  );
  assert.equal(clipboard.ok, true, clipboard.reason);

  const clearWorkEnd = previewBoxPlacement(
    state, carton(2), worldTarget(PACKING_STATION_BOX_SURFACE_ID, 0.55, 0.18),
  );
  assert.equal(clearWorkEnd.ok, true, clearWorkEnd.reason);
});

test('floor validation covers geometry, fixtures, door clearways, staff space, and other boxes', () => {
  const state = fresh();
  const open = previewBoxPlacement(state, carton(1), worldTarget(FLOOR_BOX_SURFACE_ID, 4, 0));
  assert.equal(open.ok, true, open.reason);

  const wall = previewBoxPlacement(state, carton(1), worldTarget(FLOOR_BOX_SURFACE_ID, 0, -6.45));
  assert.equal(wall.code, BOX_PLACEMENT_CODES.WALL);

  const fixture = previewBoxPlacement(state, carton(1), worldTarget(FLOOR_BOX_SURFACE_ID, -7.2, -5.05));
  assert.equal(fixture.code, BOX_PLACEMENT_CODES.FIXTURE_OVERLAP);

  const doorway = previewBoxPlacement(state, carton(1), worldTarget(FLOOR_BOX_SURFACE_ID, -0.8, 5.0));
  assert.equal(doorway.code, BOX_PLACEMENT_CODES.DOORWAY_BLOCKED);

  const staff = previewBoxPlacement(
    state, carton(1),
    worldTarget(FLOOR_BOX_SURFACE_ID, COUNTER.staffStand.x, COUNTER.staffStand.z),
  );
  assert.equal(staff.code, BOX_PLACEMENT_CODES.STAFF_WORKSPACE);

  state.shop.deliveries.boxes.push(carton(2, {
    loc: 'world', x: 4, z: 0, ry: Math.PI / 4,
  }));
  const overlap = previewBoxPlacement(state, carton(3), worldTarget(FLOOR_BOX_SURFACE_ID, 4.1, 0));
  assert.equal(overlap.code, BOX_PLACEMENT_CODES.BOX_OVERLAP);
  assert.equal(overlap.occupiedByBoxId, 2);
});

test('dynamic fixture transforms compose local surface coordinates without mutation', () => {
  const state = fresh();
  state.shop.layout = {
    moved: { table_polos: { x: 2, z: 1, ry: Math.PI / 2 } },
    stored: [],
    extra: [],
  };
  const result = resolveSurfacePose(
    state,
    worldTarget(APPAREL_TABLE_BOX_SURFACE_ID, 0.2, 0, Math.PI / 2),
  );
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.pose.x - 2) < 1e-12);
  assert.ok(Math.abs(result.pose.z - 0.8) < 1e-12);
  assert.ok(Math.abs(result.pose.ry - Math.PI) < 1e-12);

  state.shop.layout.stored.push('table_polos');
  const unavailable = previewBoxPlacement(
    state, carton(), worldTarget(APPAREL_TABLE_BOX_SURFACE_ID),
  );
  assert.equal(unavailable.code, BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE);
  assert.match(unavailable.reason, /storage/i);
});

test('pallet preview delegates current safe stacking plans and preserves explicit lanes', () => {
  const state = fresh();
  const target = { kind: 'pallet', palletIndex: 3 };
  const first = carton(1);
  const preview = previewBoxPlacement(state, first, target);
  assert.equal(preview.ok, true, preview.reason);
  assert.deepEqual(preview.target, { loc: 'pad', padPalletIndex: 3 });
  assert.deepEqual(
    [preview.pose.x, preview.pose.baseY, preview.pose.z],
    [11.024999999999999, 0.14, -0.67],
  );

  state.shop.deliveries.boxes.push(
    carton(10, { loc: 'pad', padPalletIndex: 0 }),
    carton(11, { loc: 'pad', padPalletIndex: 0 }),
  );
  const full = previewBoxPlacement(state, carton(12), { kind: 'pallet', palletIndex: 0 });
  assert.equal(full.code, BOX_PLACEMENT_CODES.SURFACE_FULL);
  assert.deepEqual(full.occupiedByBoxIds, [10, 11]);
});

test('cart sockets reuse authored fit/conflict rules and resolve deterministic fallback poses', () => {
  const state = fresh();
  const merchandise = carton(1, { box: 'merchbox', skuId: 'cap1', qty: 8, cap: 8 });
  const target = {
    kind: 'equipment',
    equipmentId: 'delivery_stocking_cart',
    socketId: 'STOCK_BOX_SOCKET_TOP',
  };
  const preview = previewBoxPlacement(state, merchandise, target);
  assert.equal(preview.ok, true, preview.reason);
  assert.deepEqual(preview.target, {
    loc: 'equipment',
    equipmentId: 'delivery_stocking_cart',
    socketId: 'STOCK_BOX_SOCKET_TOP',
  });
  assert.deepEqual([preview.pose.x, preview.pose.baseY, preview.pose.z], [6.35, 0.803, -3.4]);

  state.shop.deliveries.boxes.push(carton(2, {
    qty: 0,
    flat: true,
    loc: 'equipment',
    equipmentId: 'delivery_stocking_cart',
    socketId: 'STOCK_SOCKET_05',
  }));
  const blocked = previewBoxPlacement(state, merchandise, target);
  assert.equal(blocked.code, BOX_PLACEMENT_CODES.SOCKET_CONFLICT);
  assert.equal(blocked.occupiedByBoxId, 2);
  assert.equal(blocked.conflictingSocketId, 'STOCK_SOCKET_05');

  const tooTall = previewBoxPlacement(state, carton(3), {
    kind: 'equipment', equipmentId: 'delivery_stocking_cart', socketId: 'STOCK_SOCKET_01',
  });
  assert.equal(tooTall.code, BOX_PLACEMENT_CODES.TOO_TALL);
});

test('the reserved hand-truck ID aligns with the now-live LOAD_ORIGIN contract', () => {
  const state = fresh();
  const surface = surfaceById(state, HAND_TRUCK_BOX_SURFACE_ID);
  assert.equal(HAND_TRUCK_BOX_SURFACE_ID, 'equipment:delivery_hand_truck:LOAD_ORIGIN');
  assert.equal(surface.available, true);
  assert.deepEqual(surface.bounds, { minX: -0.3, maxX: 0.3, minZ: -0.2, maxZ: 0.2 });
  assert.equal(surface.localPose.y, 0.026);
  const preview = previewBoxPlacement(state, carton(), worldTarget(HAND_TRUCK_BOX_SURFACE_ID));
  assert.equal(preview.ok, true, preview.reason);
  assert.deepEqual(preview.target, {
    loc: 'equipment', equipmentId: 'delivery_hand_truck', socketId: 'LOAD_ORIGIN',
  });
});

test('capabilities derive from the saved box surface without parallel state', () => {
  const state = fresh();
  assert.equal(boxPlacementCapabilities(state, carton(1, {
    loc: 'world', surfaceId: PACKING_STATION_BOX_SURFACE_ID, x: 0.55, z: 0.18, ry: 0,
  })).canUnpack, true);
  assert.equal(boxPlacementCapabilities(state, carton(2, {
    loc: 'world', surfaceId: APPAREL_TABLE_BOX_SURFACE_ID, x: 0, z: 0, ry: 0,
  })).canUnpack, true, 'the apparel table is an approved unpacking work surface');
  assert.equal(boxPlacementCapabilities(state, carton(3, {
    loc: 'world', surfaceId: BACKCOUNTER_EAST_BOX_SURFACE_ID, x: 0, z: 0, ry: 0,
  })).canUnpack, true, 'the approved back-counter bay supports unpacking');
  assert.equal(boxPlacementCapabilities(state, carton(4, {
    loc: 'equipment', equipmentId: 'delivery_hand_truck', socketId: 'LOAD_ORIGIN',
  })).canUnpack, true, 'a transport socket opens boxes, exactly like the stocking cart');
  assert.equal(boxPlacementCapabilities(state, carton(5, {
    loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x: 8.65, z: -5.1, ry: 0,
  })).canUnpack, true, 'stockroom floor');
  assert.equal(boxPlacementCapabilities(state, carton(6, {
    loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x: 0, z: 2, ry: 0,
  })).canUnpack, true, 'and the sales floor - the invisible stockroom line is gone');
});

// The rule, as one assertion. Seven surfaces used to accept a carton and then
// refuse to open it, including the receiving pallet a delivery lands on and the
// floor — the two a player meets first. Nothing on screen distinguished them
// from a bench, so the loop simply dead-ended.
test('every surface that accepts a box also opens it', () => {
  const refuses = BOX_PLACEMENT_SURFACE_TEMPLATES
    .filter((t) => t.capabilities.placeBox && !t.capabilities.canUnpack)
    .map((t) => t.id);
  assert.deepEqual(refuses, [], 'a box that can be put down must be openable where it sits');
});

test('no surface carries a positional unpacking policy any more', () => {
  // The floor used to open boxes only inside STOCKROOM.bounds: an invisible
  // line across an unbroken floor, with the same carton and the same cutter
  // working on one side of it and not the other.
  for (const t of BOX_PLACEMENT_SURFACE_TEMPLATES) {
    assert.equal(t.unpackPolicy, undefined, `${t.id} still has a positional unpack policy`);
  }
});

test('legacy world boxes resolve to the identity floor surface and target snapping is explicit', () => {
  const state = fresh();
  const legacy = carton(1, { loc: 'world', x: 0.37, z: 1.88, ry: 0.1 });
  state.shop.deliveries.boxes.push(legacy);
  const pose = resolveBoxPose(state, legacy);
  assert.equal(pose.ok, true, pose.reason);
  assert.equal(pose.surfaceId, FLOOR_BOX_SURFACE_ID);
  assert.deepEqual([pose.pose.x, pose.pose.z, pose.pose.ry], [0.37, 1.88, 0.1]);
  assert.deepEqual(pose.target, {
    loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x: 0.37, z: 1.88, ry: 0.1,
  });

  const snapped = snapBoxPlacementTarget(
    state,
    worldTarget(FLOOR_BOX_SURFACE_ID, 0.37, 1.88, 1.3),
  );
  assert.deepEqual(snapped, {
    kind: 'surface', surfaceId: FLOOR_BOX_SURFACE_ID,
    x: 0.25, z: 2, ry: Math.PI / 2,
  });

  const unknown = previewBoxPlacement(state, carton(2), worldTarget('mesh:any-upward-face'));
  assert.equal(unknown.code, BOX_PLACEMENT_CODES.UNKNOWN_SURFACE);
  assert.match(unknown.reason, /not registered/i);
});
