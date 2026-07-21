import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import {
  BOX_LIFECYCLE,
  BOX_SCHEMA_VERSION,
  DELIVERIES_SCHEMA_VERSION,
  arriveOrder,
  boxAtStockroomLocation,
  boxesOf,
  cutTape,
  pickUpBox,
  putDownBox,
  stockingCartPlacementForCarriedBox,
} from '../src/sim/deliveries.js';
import {
  STOCKING_CART_EQUIPMENT_ID,
  STOCKING_CART_BOX_SOCKET,
  STOCKING_CART_BOX_SOCKET_ID,
  STOCKING_CART_PLACEMENT_SOCKETS,
  STOCKING_CART_SOCKET_IDS,
  STOCKING_CART_SOCKETS,
  deliveryEquipmentFit,
  deliveryEquipmentSocketsConflict,
  preferredDeliveryEquipmentSocketIds,
} from '../src/data/deliveryEquipment.js';
import { FLOOR_BOX_SURFACE_ID } from '../src/data/boxPlacementSurfaces.js';

const target = (socketId, equipmentId = STOCKING_CART_EQUIPMENT_ID) => ({
  loc: 'equipment', equipmentId, socketId,
});

const floorTarget = (x, z, ry = 0) => ({
  kind: 'surface', surfaceId: FLOOR_BOX_SURFACE_ID, x, z, ry,
});

function fresh(seed = 43) {
  return newGame('relaxed', seed);
}

function land(st, id, skuId = 'tees1', qty = 12) {
  return arriveOrder(st, { id, skuId, qty })[0];
}

function emptyFlatCarton(id) {
  return {
    id,
    skuId: 'tees1',
    orderId: 1000 + id,
    qty: 0,
    initialQty: 0,
    cap: 0,
    lb: 0.6,
    box: 'carton',
    loc: 'stock',
    tape: 1,
    cutProgress: 1,
    tapeSegments: { centre: 1, left: 1, right: 1 },
    flaps: [1, 1],
    flapProgress: [1, 1, 1, 1],
    openingProgress: 1,
    flattenProgress: 1,
    flat: true,
    lifecycle: BOX_LIFECYCLE.FLATTENING,
    schemaVersion: BOX_SCHEMA_VERSION,
  };
}

test('ref 43 data contract mirrors all six authored cart sockets and clearances', () => {
  assert.equal(STOCKING_CART_EQUIPMENT_ID, 'delivery_stocking_cart');
  assert.deepEqual(STOCKING_CART_SOCKET_IDS, [
    'STOCK_SOCKET_01', 'STOCK_SOCKET_02', 'STOCK_SOCKET_03',
    'STOCK_SOCKET_04', 'STOCK_SOCKET_05', 'STOCK_SOCKET_06',
  ]);
  assert.equal(STOCKING_CART_SOCKETS.length, 6);
  assert.deepEqual(
    STOCKING_CART_SOCKETS.map(({ maxW, maxD, maxH }) => [maxW, maxD, maxH]),
    [
      [0.42, 0.36, 0.22], [0.42, 0.36, 0.22],
      [0.42, 0.36, 0.22], [0.42, 0.36, 0.22],
      [0.42, 0.36, 0.50], [0.42, 0.36, 0.50],
    ],
  );
  assert.deepEqual(
    {
      socketId: STOCKING_CART_BOX_SOCKET.socketId,
      maxW: STOCKING_CART_BOX_SOCKET.maxW,
      maxD: STOCKING_CART_BOX_SOCKET.maxD,
      maxH: STOCKING_CART_BOX_SOCKET.maxH,
      shelf: STOCKING_CART_BOX_SOCKET.shelf,
      conflicts: STOCKING_CART_BOX_SOCKET.conflicts,
    },
    {
      socketId: 'STOCK_BOX_SOCKET_TOP',
      maxW: 0.62,
      maxD: 0.42,
      maxH: 0.50,
      shelf: 3,
      conflicts: ['STOCK_SOCKET_05', 'STOCK_SOCKET_06'],
    },
    'the logical centered top-deck socket spans both authored top positions',
  );
  assert.equal(STOCKING_CART_PLACEMENT_SOCKETS.length, 7);
  assert.equal(deliveryEquipmentSocketsConflict(
    STOCKING_CART_EQUIPMENT_ID,
    'STOCK_SOCKET_05',
    STOCKING_CART_BOX_SOCKET_ID,
  ), true);
  assert.equal(deliveryEquipmentSocketsConflict(
    STOCKING_CART_EQUIPMENT_ID,
    'STOCK_SOCKET_05',
    'STOCK_SOCKET_06',
  ), false);
});

test('a sealed 0.60 × 0.40 carton uses the centered top surface and survives JSON reload', () => {
  const st = fresh();
  const box = land(st, 1, 'cap1', 8);
  const originalQty = box.qty;
  assert.equal(box.box, 'merchbox');

  assert.ok(pickUpBox(st, box.id).ok);
  const placed = putDownBox(st, box.id, target(STOCKING_CART_BOX_SOCKET_ID));
  assert.ok(placed.ok, placed.reason);
  assert.equal(box.loc, 'equipment');
  assert.equal(box.equipmentId, STOCKING_CART_EQUIPMENT_ID);
  assert.equal(box.socketId, STOCKING_CART_BOX_SOCKET_ID);
  assert.equal(box.qty, originalQty, 'equipment never mirrors, consumes, or creates stock');
  assert.equal(box.x, undefined);
  assert.equal(box.z, undefined);
  assert.equal(boxAtStockroomLocation(box), true, 'the cart is a stockroom work location');

  const snapshot = JSON.stringify(st);
  const loaded = JSON.parse(snapshot);
  const reloaded = boxesOf(loaded).find((entry) => entry.id === box.id);
  assert.deepEqual(
    { loc: reloaded.loc, equipmentId: reloaded.equipmentId, socketId: reloaded.socketId, qty: reloaded.qty },
    {
      loc: 'equipment',
      equipmentId: STOCKING_CART_EQUIPMENT_ID,
      socketId: STOCKING_CART_BOX_SOCKET_ID,
      qty: originalQty,
    },
  );
  assert.ok(cutTape(loaded, reloaded.id, 0.25).ok, 'a cart box is unpackable in place');
  assert.equal(reloaded.qty, originalQty, 'cutting packaging does not alter its contents');
});

test('an occupied socket rejects a duplicate without moving either carton', () => {
  const st = fresh(44);
  const first = land(st, 1);
  const second = land(st, 2);
  assert.ok(pickUpBox(st, first.id).ok);
  assert.ok(putDownBox(st, first.id, target('STOCK_SOCKET_05')).ok);
  assert.ok(pickUpBox(st, second.id).ok);

  const before = boxesOf(st).reduce((total, box) => total + box.qty, 0);
  const duplicate = putDownBox(st, second.id, target('STOCK_SOCKET_05'));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'socket-occupied');
  assert.match(duplicate.reason, /occupied|empty slot/i);
  assert.equal(duplicate.occupiedByBoxId, first.id);
  assert.equal(first.loc, 'equipment');
  assert.equal(second.loc, 'carried', 'a refused set-down stays safely in the player hands');
  assert.equal(boxesOf(st).reduce((total, box) => total + box.qty, 0), before);

  assert.ok(putDownBox(st, second.id, target('STOCK_SOCKET_06')).ok);
  assert.equal(new Set(boxesOf(st).map((box) => box.socketId)).size, 2);
});

test('picking a cart box clears ownership and it can be replaced exactly once', () => {
  const st = fresh(45);
  const box = land(st, 1);
  assert.ok(pickUpBox(st, box.id).ok);
  assert.ok(putDownBox(st, box.id, target('STOCK_SOCKET_05')).ok);

  assert.ok(pickUpBox(st, box.id).ok);
  assert.equal(box.loc, 'carried');
  assert.equal(box.equipmentId, undefined);
  assert.equal(box.socketId, undefined);
  assert.ok(putDownBox(st, box.id, target('STOCK_SOCKET_05')).ok);
  assert.equal(box.loc, 'equipment');
  assert.equal(box.socketId, 'STOCK_SOCKET_05');

  assert.ok(pickUpBox(st, box.id).ok);
  assert.ok(putDownBox(st, box.id, floorTarget(9, -5, 0.4)).ok);
  assert.equal(box.loc, 'world', 'ordinary world placement behavior is preserved');
  assert.equal(box.surfaceId, FLOOR_BOX_SURFACE_ID);
  assert.equal(box.equipmentId, undefined);
  assert.equal(box.socketId, undefined);
});

test('all six sockets have independent occupancy for physically compatible flat cartons', () => {
  const st = fresh(46);
  st.shop.deliveries = {
    schemaVersion: DELIVERIES_SCHEMA_VERSION,
    boxes: Array.from({ length: 7 }, (_, index) => emptyFlatCarton(index + 1)),
    nextBoxId: 8,
    trash: 7,
    recycled: 0,
    shipments: [],
    arrivedOrderIds: [],
  };

  for (let index = 0; index < STOCKING_CART_SOCKET_IDS.length; index += 1) {
    const box = boxesOf(st)[index];
    assert.ok(pickUpBox(st, box.id).ok);
    const result = putDownBox(st, box.id, target(STOCKING_CART_SOCKET_IDS[index]));
    assert.ok(result.ok, `${STOCKING_CART_SOCKET_IDS[index]}: ${result.reason || 'placed'}`);
  }
  const placed = boxesOf(st).filter((box) => box.loc === 'equipment');
  assert.equal(placed.length, 6);
  assert.equal(new Set(placed.map((box) => box.socketId)).size, 6);

  const seventh = boxesOf(st)[6];
  assert.ok(pickUpBox(st, seventh.id).ok);
  const topConflict = putDownBox(st, seventh.id, target(STOCKING_CART_BOX_SOCKET_ID));
  assert.equal(topConflict.ok, false);
  assert.equal(topConflict.code, 'socket-conflict');
  assert.match(topConflict.reason, /overlap|top shelf/i);
  const full = putDownBox(st, seventh.id, target('STOCK_SOCKET_01'));
  assert.equal(full.ok, false);
  assert.equal(full.code, 'socket-occupied');
  assert.equal(seventh.loc, 'carried');
  assert.equal(boxesOf(st).reduce((sum, box) => sum + box.qty, 0), 0);
});

test('the centered top carton socket and authored top positions conflict in both directions', () => {
  const st = fresh(49);
  const fullCarton = land(st, 1, 'cap1', 8);
  const flat = emptyFlatCarton(200);
  st.shop.deliveries.boxes.push(flat);

  assert.ok(pickUpBox(st, fullCarton.id).ok);
  assert.ok(putDownBox(st, fullCarton.id, target(STOCKING_CART_BOX_SOCKET_ID)).ok);
  assert.ok(pickUpBox(st, flat.id).ok);
  const authoredBlocked = putDownBox(st, flat.id, target('STOCK_SOCKET_05'));
  assert.equal(authoredBlocked.code, 'socket-conflict');
  assert.equal(authoredBlocked.occupiedByBoxId, fullCarton.id);
  assert.equal(authoredBlocked.conflictingSocketId, STOCKING_CART_BOX_SOCKET_ID);
  assert.equal(flat.loc, 'carried');

  assert.ok(putDownBox(st, flat.id, 'stock').ok);
  assert.ok(pickUpBox(st, fullCarton.id).ok);
  assert.ok(putDownBox(st, fullCarton.id, 'stock').ok);
  assert.ok(pickUpBox(st, flat.id).ok);
  assert.ok(putDownBox(st, flat.id, target('STOCK_SOCKET_05')).ok);
  assert.ok(pickUpBox(st, fullCarton.id).ok);
  const centeredBlocked = putDownBox(st, fullCarton.id, target(STOCKING_CART_BOX_SOCKET_ID));
  assert.equal(centeredBlocked.code, 'socket-conflict');
  assert.equal(centeredBlocked.occupiedByBoxId, flat.id);
  assert.equal(centeredBlocked.conflictingSocketId, 'STOCK_SOCKET_05');
  assert.equal(fullCarton.loc, 'carried');
  assert.equal(fullCarton.qty, 8);
});

test('pure carried-box placement chooses the preferred centered socket without mutating the save', () => {
  const st = fresh(50);
  const carton = land(st, 1, 'cap1', 8);
  assert.ok(pickUpBox(st, carton.id).ok);
  const before = JSON.stringify(st);

  const placement = stockingCartPlacementForCarriedBox(st, carton.id);
  assert.deepEqual(placement, {
    ok: true,
    equipmentId: STOCKING_CART_EQUIPMENT_ID,
    socketId: STOCKING_CART_BOX_SOCKET_ID,
    target: {
      loc: 'equipment',
      equipmentId: STOCKING_CART_EQUIPMENT_ID,
      socketId: STOCKING_CART_BOX_SOCKET_ID,
    },
  });
  assert.equal(JSON.stringify(st), before, 'querying a target does not reserve or move the carton');
  assert.equal(carton.loc, 'carried');
});

test('pure placement skips an occupied exact socket and returns the next compatible position', () => {
  const st = fresh(51);
  st.shop.deliveries = {
    schemaVersion: DELIVERIES_SCHEMA_VERSION,
    boxes: [emptyFlatCarton(1), emptyFlatCarton(2)],
    nextBoxId: 3,
    trash: 2,
    recycled: 0,
    shipments: [],
    arrivedOrderIds: [],
  };
  assert.ok(pickUpBox(st, 1).ok);
  assert.ok(putDownBox(st, 1, target('STOCK_SOCKET_01')).ok);
  assert.ok(pickUpBox(st, 2).ok);
  const before = JSON.stringify(st);

  const placement = stockingCartPlacementForCarriedBox(st, 2);
  assert.equal(placement.ok, true);
  assert.equal(placement.socketId, 'STOCK_SOCKET_02');
  assert.equal(JSON.stringify(st), before);
  assert.equal(boxesOf(st).find((box) => box.id === 1).socketId, 'STOCK_SOCKET_01');
  assert.equal(boxesOf(st).find((box) => box.id === 2).loc, 'carried');
});

test('pure placement honors centered-top conflicts with 05/06 using saved occupancy only', () => {
  for (const [occupiedSocket, expectedSocket] of [
    ['STOCK_SOCKET_05', 'STOCK_SOCKET_06'],
    ['STOCK_SOCKET_06', 'STOCK_SOCKET_05'],
  ]) {
    const st = fresh(52);
    const sealed = land(st, 1, 'tees1', 12);
    const flat = emptyFlatCarton(200);
    st.shop.deliveries.boxes.push(flat);
    assert.ok(pickUpBox(st, flat.id).ok);
    assert.ok(putDownBox(st, flat.id, target(occupiedSocket)).ok);
    assert.ok(pickUpBox(st, sealed.id).ok);
    const before = JSON.stringify(st);

    const placement = stockingCartPlacementForCarriedBox(st, sealed.id);
    assert.equal(placement.ok, true);
    assert.equal(placement.socketId, expectedSocket,
      `center conflicts and ${occupiedSocket} is exact-occupied, so ${expectedSocket} is first free`);
    assert.equal(JSON.stringify(st), before);
  }

  const blocked = fresh(53);
  const merchandise = land(blocked, 1, 'cap1', 8);
  const flat = emptyFlatCarton(201);
  blocked.shop.deliveries.boxes.push(flat);
  pickUpBox(blocked, flat.id);
  putDownBox(blocked, flat.id, target('STOCK_SOCKET_05'));
  pickUpBox(blocked, merchandise.id);
  const beforeBlocked = JSON.stringify(blocked);
  const noTop = stockingCartPlacementForCarriedBox(blocked, merchandise.id);
  assert.equal(noTop.ok, false);
  assert.equal(noTop.code, 'no-free-socket');
  assert.match(noTop.reason, /occupied/i);
  assert.equal(JSON.stringify(blocked), beforeBlocked);
});

test('pure placement rejects long and oversize cartons without mutating them', () => {
  for (const [seed, skuId, qty] of [[54, 'driver1', 2], [55, 'lounge1', 1]]) {
    const st = fresh(seed);
    const box = land(st, 1, skuId, qty);
    assert.ok(pickUpBox(st, box.id).ok);
    const before = JSON.stringify(st);
    const placement = stockingCartPlacementForCarriedBox(st, box.id);
    assert.equal(placement.ok, false);
    assert.equal(placement.code, 'no-compatible-socket');
    assert.match(placement.reason, /does not fit/i);
    assert.equal(JSON.stringify(st), before);
    assert.equal(box.loc, 'carried');
    assert.equal(box.qty, qty);
  }
});

test('sealed tall, long, oversize, unknown-equipment and unknown-socket targets explain rejection', () => {
  const st = fresh(47);
  const carton = land(st, 1, 'tees1', 12);
  pickUpBox(st, carton.id);
  const lower = putDownBox(st, carton.id, target('STOCK_SOCKET_01'));
  assert.equal(lower.ok, false);
  assert.equal(lower.code, 'too-tall');
  assert.match(lower.reason, /too tall|top shelf|flatten/i);
  assert.equal(carton.loc, 'carried');
  putDownBox(st, carton.id, 'stock');

  const club = land(st, 2, 'driver1', 2);
  pickUpBox(st, club.id);
  const long = putDownBox(st, club.id, target(STOCKING_CART_BOX_SOCKET_ID));
  assert.equal(long.ok, false);
  assert.equal(long.code, 'oversize-footprint');
  assert.match(long.reason, /too long|wide/i);
  assert.equal(club.loc, 'carried');
  putDownBox(st, club.id, 'stock');

  const crate = land(st, 3, 'lounge1', 1);
  pickUpBox(st, crate.id);
  const oversize = putDownBox(st, crate.id, target(STOCKING_CART_BOX_SOCKET_ID));
  assert.equal(oversize.ok, false);
  assert.equal(oversize.code, 'oversize-footprint');
  assert.equal(crate.loc, 'carried');

  const unknownSocket = putDownBox(st, crate.id, target('STOCK_SOCKET_99'));
  assert.equal(unknownSocket.code, 'unknown-socket');
  assert.match(unknownSocket.reason, /does not exist/i);
  const unknownEquipment = putDownBox(st, crate.id, target('STOCK_SOCKET_05', 'forklift_01'));
  assert.equal(unknownEquipment.code, 'unknown-equipment');
  assert.match(unknownEquipment.reason, /not available/i);
  assert.equal(crate.loc, 'carried', 'every rejected target is non-mutating');
});

test('legacy aliases migrate and malformed, duplicate or incompatible placements heal to stock', () => {
  const st = fresh(48);
  st.shop.deliveries = {
    schemaVersion: 4,
    nextBoxId: 9,
    trash: 0,
    recycled: 0,
    shipments: [],
    arrivedOrderIds: [],
    boxes: [
      { id: 1, skuId: 'tees1', orderId: 1, qty: 12, cap: 12, box: 'carton', loc: 'cart', cartSocketId: 'STOCK_SOCKET_05' },
      { id: 2, skuId: 'cap1', orderId: 2, qty: 8, cap: 8, box: 'merchbox', loc: 'equipment', equipmentId: 'stocking_cart', socketId: 'STOCK_SOCKET_05' },
      { id: 3, skuId: 'tees1', orderId: 3, qty: 7, cap: 12, box: 'carton', loc: 'equipment', equipmentId: 'stocking_cart' },
      { id: 4, skuId: 'tees1', orderId: 4, qty: 6, cap: 12, box: 'carton', loc: 'equipment', equipmentId: 'unknown_cart', socketId: 'STOCK_SOCKET_06' },
      { id: 5, skuId: 'driver1', orderId: 5, qty: 2, cap: 2, box: 'clubbox', loc: 'equipment', equipmentId: 'stocking_cart', socketId: 'STOCK_SOCKET_06' },
      { id: 6, skuId: 'tees1', orderId: 6, qty: 5, cap: 12, box: 'carton', loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x: 7.2, z: -5.3, ry: 0, equipmentId: 'stocking_cart', socketId: 'STOCK_SOCKET_06' },
      { id: 7, skuId: 'tees1', orderId: 7, qty: 4, cap: 12, box: 'carton', loc: 'equipment', equipment: 'stockingCart', equipmentSocketId: 'STOCK_SOCKET_06' },
      { id: 8, skuId: 'cap1', orderId: 8, qty: 8, cap: 8, box: 'merchbox', loc: 'equipment', equipmentId: 'stocking_cart', socketId: 'STOCK_BOX_SOCKET_TOP' },
    ],
  };
  const quantities = st.shop.deliveries.boxes.map((box) => box.qty);

  const healed = boxesOf(st);
  assert.equal(st.shop.deliveries.schemaVersion, DELIVERIES_SCHEMA_VERSION);
  assert.deepEqual(healed.map((box) => box.qty), quantities, 'healing never transfers or rewrites units');
  assert.deepEqual(
    { loc: healed[0].loc, equipmentId: healed[0].equipmentId, socketId: healed[0].socketId },
    { loc: 'equipment', equipmentId: STOCKING_CART_EQUIPMENT_ID, socketId: 'STOCK_SOCKET_05' },
    'the valid early cart alias migrates to the canonical schema',
  );
  assert.equal(healed[6].loc, 'equipment');
  assert.equal(healed[6].equipmentId, STOCKING_CART_EQUIPMENT_ID);
  assert.equal(healed[6].socketId, 'STOCK_SOCKET_06');
  assert.equal(healed[7].loc, 'stock', 'a legacy overlapping top-deck placement heals visibly');
  assert.equal(healed[7].qty, 8, 'conflict healing preserves the full carton quantity');
  assert.equal(healed[7].equipmentId, undefined);
  assert.equal(healed[7].socketId, undefined);

  for (const index of [1, 2, 3, 4]) {
    assert.equal(healed[index].loc, 'stock', `malformed box ${healed[index].id} heals visibly to stock`);
    assert.equal(healed[index].equipmentId, undefined);
    assert.equal(healed[index].socketId, undefined);
  }
  assert.equal(healed[5].loc, 'world', 'a valid non-equipment location is otherwise untouched');
  assert.deepEqual({ x: healed[5].x, z: healed[5].z }, { x: 7.2, z: -5.3 });
  assert.equal(healed[5].equipmentId, undefined, 'stray ownership fields are removed');
  assert.equal(healed[5].socketId, undefined);

  const roundTrip = JSON.parse(JSON.stringify(st));
  const twice = boxesOf(roundTrip);
  assert.deepEqual(
    twice.map((box) => ({ id: box.id, loc: box.loc, equipmentId: box.equipmentId, socketId: box.socketId, qty: box.qty })),
    healed.map((box) => ({ id: box.id, loc: box.loc, equipmentId: box.equipmentId, socketId: box.socketId, qty: box.qty })),
    'the healed representation is stable on its next reload',
  );
});

test('fit checks keep authored orientation support without accepting a club sleeve', () => {
  const rotatedSmall = deliveryEquipmentFit(
    { box: 'carton', flat: true, qty: 0 },
    STOCKING_CART_EQUIPMENT_ID,
    'STOCK_SOCKET_01',
  );
  assert.ok(rotatedSmall.ok);
  const malformedNonemptyFlat = deliveryEquipmentFit(
    { box: 'carton', flat: true, qty: 1 },
    STOCKING_CART_EQUIPMENT_ID,
    'STOCK_SOCKET_01',
  );
  assert.equal(malformedNonemptyFlat.code, 'too-tall', 'nonempty cartons never gain folded clearance');
  const club = deliveryEquipmentFit(
    { box: 'clubbox' },
    STOCKING_CART_EQUIPMENT_ID,
    'STOCK_SOCKET_05',
  );
  assert.equal(club.ok, false);
  assert.equal(club.code, 'oversize-footprint');

  const merchandise = { box: 'merchbox', flat: false, qty: 8 };
  assert.equal(
    deliveryEquipmentFit(
      merchandise,
      STOCKING_CART_EQUIPMENT_ID,
      STOCKING_CART_BOX_SOCKET_ID,
    ).ok,
    true,
  );
  assert.equal(
    deliveryEquipmentFit(
      { box: 'apparel', flat: false, qty: 8 },
      STOCKING_CART_EQUIPMENT_ID,
      STOCKING_CART_BOX_SOCKET_ID,
    ).ok,
    true,
  );
  assert.equal(
    preferredDeliveryEquipmentSocketIds(merchandise)[0],
    STOCKING_CART_BOX_SOCKET_ID,
    'the centered top surface is the first sealed-carton candidate',
  );
  assert.notEqual(
    preferredDeliveryEquipmentSocketIds({ box: 'carton', flat: true, qty: 0 })[0],
    STOCKING_CART_BOX_SOCKET_ID,
    'flat cardboard prefers one of the six smaller authored positions',
  );
});
