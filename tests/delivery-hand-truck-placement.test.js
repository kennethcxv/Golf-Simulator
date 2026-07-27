import test from 'node:test';
import assert from 'node:assert/strict';

import { BOX_KINDS } from '../src/data/boxes.js';
import {
  HAND_TRUCK_BOX_SOCKET,
  HAND_TRUCK_BOX_SOCKET_ID,
  HAND_TRUCK_EQUIPMENT_ID,
  STOCKING_CART_BOX_SOCKET_ID,
  STOCKING_CART_EQUIPMENT_ID,
  deliveryEquipmentFit,
  deliveryEquipmentPlacementForBox,
  deliveryEquipmentSocket,
  normalizeDeliveryEquipmentId,
  preferredDeliveryEquipmentSocketIds,
} from '../src/data/deliveryEquipment.js';
import {
  BOX_LIFECYCLE,
  BOX_SCHEMA_VERSION,
  DELIVERIES_SCHEMA_VERSION,
  arriveOrder,
  boxAtStockroomLocation,
  boxesOf,
  deliveryEquipmentPlacementForCarriedBox,
  handTruckPlacementForCarriedBox,
  pickUpBox,
  putDownBox,
  stockingCartPlacementForCarriedBox,
} from '../src/sim/deliveries.js';
import { newGame } from '../src/sim/state.js';

const handTruckTarget = (equipmentId = HAND_TRUCK_EQUIPMENT_ID) => ({
  loc: 'equipment',
  equipmentId,
  socketId: HAND_TRUCK_BOX_SOCKET_ID,
});

const cartTarget = () => ({
  loc: 'equipment',
  equipmentId: STOCKING_CART_EQUIPMENT_ID,
  socketId: STOCKING_CART_BOX_SOCKET_ID,
});

function fresh(seed = 142) {
  return newGame('relaxed', seed);
}

function land(state, orderId, skuId = 'cap1', qty = 8) {
  return arriveOrder(state, { id: orderId, skuId, qty })[0];
}

function currentBox(id, overrides = {}) {
  const qty = overrides.qty ?? 8;
  const cap = overrides.cap ?? qty;
  return {
    id,
    skuId: overrides.skuId ?? 'cap1',
    orderId: overrides.orderId ?? 4200 + id,
    qty,
    cap,
    initialQty: overrides.initialQty ?? cap,
    lb: overrides.lb ?? 4.2,
    box: overrides.box ?? 'merchbox',
    loc: overrides.loc ?? 'stock',
    tape: overrides.tape ?? 0,
    cutProgress: overrides.cutProgress ?? 0,
    tapeSegments: overrides.tapeSegments ?? { centre: 0, left: 0, right: 0 },
    flaps: overrides.flaps ?? [0, 0],
    flapProgress: overrides.flapProgress ?? [0, 0, 0, 0],
    openingProgress: overrides.openingProgress ?? 0,
    flattenProgress: overrides.flattenProgress ?? 0,
    flat: overrides.flat ?? false,
    lifecycle: overrides.lifecycle ?? BOX_LIFECYCLE.SEALED,
    schemaVersion: BOX_SCHEMA_VERSION,
    ...overrides,
  };
}

function stateWithBoxes(boxes, seed = 242) {
  const state = fresh(seed);
  state.shop.deliveries = {
    schemaVersion: DELIVERIES_SCHEMA_VERSION,
    boxes,
    nextBoxId: boxes.reduce((greatest, box) => Math.max(greatest, box.id), 0) + 1,
    trash: 0,
    recycled: 0,
    shipments: [],
    arrivedOrderIds: [],
  };
  state.shop.carry = null;
  return state;
}

function quantityAndLifecycle(box) {
  return {
    qty: box.qty,
    cap: box.cap,
    initialQty: box.initialQty,
    lifecycle: box.lifecycle,
  };
}

test('ref 42 persists the exact authored 0.60 x 0.40 allowance over its 0.50 x 0.40 toe plate', () => {
  assert.equal(HAND_TRUCK_EQUIPMENT_ID, 'delivery_hand_truck');
  assert.equal(HAND_TRUCK_BOX_SOCKET_ID, 'LOAD_ORIGIN');
  assert.deepEqual(
    {
      equipmentId: HAND_TRUCK_BOX_SOCKET.equipmentId,
      socketId: HAND_TRUCK_BOX_SOCKET.socketId,
      maxW: HAND_TRUCK_BOX_SOCKET.maxW,
      maxD: HAND_TRUCK_BOX_SOCKET.maxD,
      maxH: HAND_TRUCK_BOX_SOCKET.maxH,
      plateW: HAND_TRUCK_BOX_SOCKET.plateW,
      plateD: HAND_TRUCK_BOX_SOCKET.plateD,
      maximumSideOverhangEach: HAND_TRUCK_BOX_SOCKET.maximumSideOverhangEach,
      preferredForSealedBoxes: HAND_TRUCK_BOX_SOCKET.preferredForSealedBoxes,
      conflicts: HAND_TRUCK_BOX_SOCKET.conflicts,
    },
    {
      equipmentId: HAND_TRUCK_EQUIPMENT_ID,
      socketId: 'LOAD_ORIGIN',
      maxW: 0.6,
      maxD: 0.4,
      maxH: 0.65,
      plateW: 0.5,
      plateD: 0.4,
      maximumSideOverhangEach: 0.05,
      preferredForSealedBoxes: true,
      conflicts: [],
    },
  );
  assert.ok(Object.isFrozen(HAND_TRUCK_BOX_SOCKET));
  assert.ok(Object.isFrozen(HAND_TRUCK_BOX_SOCKET.conflicts));
  assert.ok(Math.abs(
    (HAND_TRUCK_BOX_SOCKET.maxW - HAND_TRUCK_BOX_SOCKET.plateW) / 2
      - HAND_TRUCK_BOX_SOCKET.maximumSideOverhangEach,
  ) < 1e-12, 'the 0.60 m allowance creates exactly 0.05 m overhang on each side');

  const exact = deliveryEquipmentFit(
    { box: { w: 0.6, d: 0.4, h: 0.65 }, qty: 1 },
    HAND_TRUCK_EQUIPMENT_ID,
    HAND_TRUCK_BOX_SOCKET_ID,
  );
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.dimensions, { w: 0.6, d: 0.4, h: 0.65 });

  const rotated = deliveryEquipmentFit(
    { box: { w: 0.4, d: 0.6, h: 0.65 }, qty: 1 },
    HAND_TRUCK_EQUIPMENT_ID,
    HAND_TRUCK_BOX_SOCKET_ID,
  );
  assert.equal(rotated.ok, true, 'the same authored footprint may rotate ninety degrees');

  assert.equal(deliveryEquipmentFit(
    { box: { w: 0.600002, d: 0.4, h: 0.4 }, qty: 1 },
    HAND_TRUCK_EQUIPMENT_ID,
    HAND_TRUCK_BOX_SOCKET_ID,
  ).code, 'oversize-footprint');
  assert.equal(deliveryEquipmentFit(
    { box: { w: 0.6, d: 0.400002, h: 0.4 }, qty: 1 },
    HAND_TRUCK_EQUIPMENT_ID,
    HAND_TRUCK_BOX_SOCKET_ID,
  ).code, 'oversize-footprint');
  assert.equal(deliveryEquipmentFit(
    { box: { w: 0.6, d: 0.4, h: 0.650002 }, qty: 1 },
    HAND_TRUCK_EQUIPMENT_ID,
    HAND_TRUCK_BOX_SOCKET_ID,
  ).code, 'too-tall');
});

test('only physically compatible box families are accepted by the hand truck', () => {
  const expected = new Map([
    ['carton', true],
    ['ballcase', false],
    ['merchbox', true],
    ['apparel', true],
    ['shoebox', false],
    ['clubbox', false],
    ['bagcarton', false],
    ['fixture', false],
    ['crate', false],
    ['provisions', true],
    ['umbrella', false],
    ['ironset', false],
  ]);
  assert.deepEqual(new Set(Object.keys(BOX_KINDS)), new Set(expected.keys()),
    'adding a box family requires an explicit Ref42 compatibility decision');

  for (const [kind, shouldFit] of expected) {
    const box = { box: kind, qty: 1, flat: false };
    const fit = deliveryEquipmentFit(
      box,
      HAND_TRUCK_EQUIPMENT_ID,
      HAND_TRUCK_BOX_SOCKET_ID,
    );
    assert.equal(fit.ok, shouldFit, kind + ' compatibility');
    assert.deepEqual(
      preferredDeliveryEquipmentSocketIds(box, HAND_TRUCK_EQUIPMENT_ID),
      shouldFit ? [HAND_TRUCK_BOX_SOCKET_ID] : [],
      kind + ' preferred hand-truck socket',
    );
  }
});

test('generic and Ref42 carried-box helpers return one canonical non-mutating LOAD_ORIGIN target', () => {
  const state = fresh();
  const box = land(state, 1);
  assert.ok(pickUpBox(state, box.id).ok);
  const before = JSON.stringify(state);
  const expected = {
    ok: true,
    equipmentId: HAND_TRUCK_EQUIPMENT_ID,
    socketId: HAND_TRUCK_BOX_SOCKET_ID,
    target: handTruckTarget(),
  };

  assert.deepEqual(
    deliveryEquipmentPlacementForCarriedBox(state, box.id, HAND_TRUCK_EQUIPMENT_ID),
    expected,
  );
  assert.deepEqual(handTruckPlacementForCarriedBox(state, box.id), expected);
  assert.deepEqual(
    deliveryEquipmentPlacementForCarriedBox(state, box.id, 'handTruck'),
    expected,
    'the generic helper canonicalizes an early camel-case equipment alias',
  );
  assert.equal(JSON.stringify(state), before, 'queries never reserve or move the real carton');

  const unknown = deliveryEquipmentPlacementForCarriedBox(state, box.id, 'forklift_01');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'unknown-equipment');
  assert.equal(JSON.stringify(state), before, 'an invalid query is also non-mutating');
});

test('LOAD_ORIGIN has exact single occupancy and refuses a duplicate without losing units', () => {
  const state = fresh(143);
  const first = land(state, 1);
  const second = land(state, 2);
  const invariants = new Map(boxesOf(state).map((box) => [box.id, quantityAndLifecycle(box)]));

  assert.ok(pickUpBox(state, first.id).ok);
  assert.ok(putDownBox(state, first.id, handTruckTarget()).ok);
  assert.ok(pickUpBox(state, second.id).ok);

  const pure = handTruckPlacementForCarriedBox(state, second.id);
  assert.equal(pure.ok, false);
  assert.equal(pure.code, 'no-free-socket');
  assert.match(pure.reason, /hand truck|occupied/i);

  const refused = putDownBox(state, second.id, handTruckTarget());
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'socket-occupied');
  assert.equal(refused.occupiedByBoxId, first.id);
  assert.equal(refused.conflictingSocketId, HAND_TRUCK_BOX_SOCKET_ID);
  assert.match(refused.reason, /LOAD_ORIGIN.*hand truck.*occupied/i);
  assert.deepEqual(
    {
      first: {
        loc: first.loc,
        equipmentId: first.equipmentId,
        socketId: first.socketId,
      },
      second: {
        loc: second.loc,
        equipmentId: second.equipmentId,
        socketId: second.socketId,
      },
    },
    {
      first: {
        loc: 'equipment',
        equipmentId: HAND_TRUCK_EQUIPMENT_ID,
        socketId: HAND_TRUCK_BOX_SOCKET_ID,
      },
      second: {
        loc: 'carried',
        equipmentId: undefined,
        socketId: undefined,
      },
    },
  );
  for (const box of boxesOf(state)) {
    assert.deepEqual(quantityAndLifecycle(box), invariants.get(box.id));
  }
});

test('a hand-truck placement survives JSON save/reload without parallel inventory or lifecycle drift', () => {
  const state = fresh(144);
  const box = land(state, 1);
  const invariant = quantityAndLifecycle(box);
  assert.ok(pickUpBox(state, box.id).ok);
  assert.ok(putDownBox(state, box.id, handTruckTarget()).ok);
  assert.equal(boxAtStockroomLocation(box), true);

  const loaded = JSON.parse(JSON.stringify(state));
  const reloaded = boxesOf(loaded).find((entry) => entry.id === box.id);
  assert.deepEqual(
    {
      loc: reloaded.loc,
      equipmentId: reloaded.equipmentId,
      socketId: reloaded.socketId,
      placement: deliveryEquipmentPlacementForBox(reloaded),
    },
    {
      loc: 'equipment',
      equipmentId: HAND_TRUCK_EQUIPMENT_ID,
      socketId: HAND_TRUCK_BOX_SOCKET_ID,
      placement: {
        equipmentId: HAND_TRUCK_EQUIPMENT_ID,
        socketId: HAND_TRUCK_BOX_SOCKET_ID,
        socket: HAND_TRUCK_BOX_SOCKET,
      },
    },
  );
  assert.deepEqual(quantityAndLifecycle(reloaded), invariant);
  assert.equal(loaded.shop.deliveries.boxes.length, 1,
    'equipment ownership stays on the box instead of creating an equipment inventory');
  assert.equal(reloaded.x, undefined);
  assert.equal(reloaded.z, undefined);
  assert.equal(reloaded.ry, undefined);
});

test('pickup clears Ref42 ownership and the same carton can be re-placed repeatedly', () => {
  const state = fresh(145);
  const box = land(state, 1);
  const invariant = quantityAndLifecycle(box);
  assert.ok(pickUpBox(state, box.id).ok);
  assert.ok(putDownBox(state, box.id, handTruckTarget()).ok);

  for (let cycle = 0; cycle < 2; cycle += 1) {
    assert.ok(pickUpBox(state, box.id).ok);
    assert.deepEqual(
      { loc: box.loc, equipmentId: box.equipmentId, socketId: box.socketId },
      { loc: 'carried', equipmentId: undefined, socketId: undefined },
    );
    assert.deepEqual(quantityAndLifecycle(box), invariant);

    const placement = handTruckPlacementForCarriedBox(state, box.id);
    assert.equal(placement.ok, true);
    assert.ok(putDownBox(state, box.id, placement.target).ok);
    assert.deepEqual(
      { loc: box.loc, equipmentId: box.equipmentId, socketId: box.socketId },
      {
        loc: 'equipment',
        equipmentId: HAND_TRUCK_EQUIPMENT_ID,
        socketId: HAND_TRUCK_BOX_SOCKET_ID,
      },
    );
    assert.deepEqual(quantityAndLifecycle(box), invariant);
    assert.equal(boxesOf(state).filter((entry) => entry.id === box.id).length, 1);
  }
});

test('legacy Ref42 ids and early generic equipment fields migrate to one canonical save shape', () => {
  const cases = [
    {
      name: 'snake-case id',
      fields: { equipmentId: 'hand_truck', socketId: HAND_TRUCK_BOX_SOCKET_ID },
    },
    {
      name: 'camel-case id in generic fields',
      fields: { equipment: 'handTruck', equipmentSocketId: HAND_TRUCK_BOX_SOCKET_ID },
    },
    {
      name: 'snake-case id in earliest cart-named fields',
      fields: { cartId: 'hand_truck', cartSocketId: HAND_TRUCK_BOX_SOCKET_ID },
    },
  ];

  assert.equal(normalizeDeliveryEquipmentId('hand_truck'), HAND_TRUCK_EQUIPMENT_ID);
  assert.equal(normalizeDeliveryEquipmentId('handTruck'), HAND_TRUCK_EQUIPMENT_ID);
  assert.equal(deliveryEquipmentSocket('hand_truck', HAND_TRUCK_BOX_SOCKET_ID),
    HAND_TRUCK_BOX_SOCKET);

  for (let index = 0; index < cases.length; index += 1) {
    const entry = currentBox(index + 1, {
      loc: 'equipment',
      ...cases[index].fields,
    });
    const invariant = quantityAndLifecycle(entry);
    const state = stateWithBoxes([entry], 250 + index);
    const migrated = boxesOf(state)[0];
    assert.deepEqual(
      {
        loc: migrated.loc,
        equipmentId: migrated.equipmentId,
        socketId: migrated.socketId,
      },
      {
        loc: 'equipment',
        equipmentId: HAND_TRUCK_EQUIPMENT_ID,
        socketId: HAND_TRUCK_BOX_SOCKET_ID,
      },
      cases[index].name,
    );
    assert.equal(migrated.equipment, undefined);
    assert.equal(migrated.equipmentSocketId, undefined);
    assert.equal(migrated.cartId, undefined);
    assert.equal(migrated.cartSocketId, undefined);
    assert.deepEqual(quantityAndLifecycle(migrated), invariant);
  }
});

test('malformed, incompatible, and duplicate Ref42 placements heal visibly without quantity or lifecycle loss', () => {
  const partial = {
    skuId: 'tees1',
    box: 'carton',
    qty: 5,
    cap: 12,
    initialQty: 12,
    tape: 1,
    cutProgress: 1,
    tapeSegments: { centre: 1, left: 1, right: 1 },
    flaps: [1, 1],
    flapProgress: [1, 1, 1, 1],
    openingProgress: 1,
    lifecycle: BOX_LIFECYCLE.PARTIALLY_EMPTIED,
  };
  const boxes = [
    currentBox(1, {
      loc: 'equipment',
      equipmentId: HAND_TRUCK_EQUIPMENT_ID,
      socketId: HAND_TRUCK_BOX_SOCKET_ID,
    }),
    currentBox(2, {
      ...partial,
      loc: 'equipment',
      equipmentId: 'handTruck',
      socketId: HAND_TRUCK_BOX_SOCKET_ID,
    }),
    currentBox(3, {
      loc: 'equipment',
      equipmentId: HAND_TRUCK_EQUIPMENT_ID,
    }),
    currentBox(4, {
      loc: 'equipment',
      equipmentId: HAND_TRUCK_EQUIPMENT_ID,
      socketId: STOCKING_CART_BOX_SOCKET_ID,
    }),
    currentBox(5, {
      skuId: 'driver1',
      box: 'clubbox',
      qty: 2,
      cap: 2,
      initialQty: 2,
      loc: 'equipment',
      equipmentId: HAND_TRUCK_EQUIPMENT_ID,
      socketId: HAND_TRUCK_BOX_SOCKET_ID,
    }),
    currentBox(6, {
      loc: 'equipment',
      equipmentId: 'forklift_01',
      socketId: HAND_TRUCK_BOX_SOCKET_ID,
    }),
    currentBox(7, {
      loc: 'world',
      x: 6.3,
      z: -2.8,
      ry: 0.4,
      equipmentId: 'hand_truck',
      socketId: HAND_TRUCK_BOX_SOCKET_ID,
    }),
    currentBox(8, {
      loc: 'equipment',
      equipmentId: 'stockingCart',
      socketId: STOCKING_CART_BOX_SOCKET_ID,
    }),
  ];
  const before = new Map(boxes.map((box) => [box.id, quantityAndLifecycle(box)]));
  const totalBefore = boxes.reduce((sum, box) => sum + box.qty, 0);
  const state = stateWithBoxes(boxes, 260);
  const healed = boxesOf(state);

  assert.deepEqual(
    {
      loc: healed[0].loc,
      equipmentId: healed[0].equipmentId,
      socketId: healed[0].socketId,
    },
    {
      loc: 'equipment',
      equipmentId: HAND_TRUCK_EQUIPMENT_ID,
      socketId: HAND_TRUCK_BOX_SOCKET_ID,
    },
    'the first valid Ref42 occupant remains authoritative',
  );
  assert.deepEqual(
    {
      loc: healed[7].loc,
      equipmentId: healed[7].equipmentId,
      socketId: healed[7].socketId,
    },
    {
      loc: 'equipment',
      equipmentId: STOCKING_CART_EQUIPMENT_ID,
      socketId: STOCKING_CART_BOX_SOCKET_ID,
    },
    'cart occupancy is independent from Ref42 occupancy',
  );

  for (const index of [1, 2, 3, 4, 5]) {
    assert.equal(healed[index].loc, 'stock',
      'malformed box ' + healed[index].id + ' heals to stock');
    assert.equal(healed[index].equipmentId, undefined);
    assert.equal(healed[index].socketId, undefined);
  }
  assert.equal(healed[1].lifecycle, BOX_LIFECYCLE.PARTIALLY_EMPTIED,
    'duplicate healing does not reseal or refill a partially emptied carton');
  assert.equal(healed[6].loc, 'world');
  assert.deepEqual(
    { x: healed[6].x, z: healed[6].z, ry: healed[6].ry },
    { x: 6.3, z: -2.8, ry: 0.4 },
  );
  assert.equal(healed[6].equipmentId, undefined);
  assert.equal(healed[6].socketId, undefined);

  assert.equal(healed.reduce((sum, box) => sum + box.qty, 0), totalBefore);
  for (const box of healed) {
    assert.deepEqual(quantityAndLifecycle(box), before.get(box.id),
      'box ' + box.id + ' invariant');
  }

  const once = healed.map((box) => ({
    id: box.id,
    loc: box.loc,
    equipmentId: box.equipmentId,
    socketId: box.socketId,
    ...quantityAndLifecycle(box),
  }));
  const twice = boxesOf(JSON.parse(JSON.stringify(state))).map((box) => ({
    id: box.id,
    loc: box.loc,
    equipmentId: box.equipmentId,
    socketId: box.socketId,
    ...quantityAndLifecycle(box),
  }));
  assert.deepEqual(twice, once, 'the healed save shape is idempotent after JSON reload');
});

test('Ref42 occupancy does not regress the persisted Ref43 top-deck path', () => {
  const state = fresh(146);
  const handBox = land(state, 1);
  const cartBox = land(state, 2);
  const invariants = new Map(boxesOf(state).map((box) => [box.id, quantityAndLifecycle(box)]));

  assert.ok(pickUpBox(state, handBox.id).ok);
  assert.ok(putDownBox(state, handBox.id, handTruckTarget('hand_truck')).ok,
    'putDownBox canonicalizes Ref42 aliases');

  assert.ok(pickUpBox(state, cartBox.id).ok);
  const genericDefault = deliveryEquipmentPlacementForCarriedBox(state, cartBox.id);
  const cartWrapper = stockingCartPlacementForCarriedBox(state, cartBox.id);
  assert.deepEqual(genericDefault, cartWrapper);
  assert.deepEqual(cartWrapper, {
    ok: true,
    equipmentId: STOCKING_CART_EQUIPMENT_ID,
    socketId: STOCKING_CART_BOX_SOCKET_ID,
    target: cartTarget(),
  });
  assert.ok(putDownBox(state, cartBox.id, cartWrapper.target).ok);

  assert.deepEqual(
    boxesOf(state).map((box) => ({
      id: box.id,
      equipmentId: box.equipmentId,
      socketId: box.socketId,
    })),
    [
      {
        id: handBox.id,
        equipmentId: HAND_TRUCK_EQUIPMENT_ID,
        socketId: HAND_TRUCK_BOX_SOCKET_ID,
      },
      {
        id: cartBox.id,
        equipmentId: STOCKING_CART_EQUIPMENT_ID,
        socketId: STOCKING_CART_BOX_SOCKET_ID,
      },
    ],
  );
  assert.equal(deliveryEquipmentFit(
    { box: 'merchbox', qty: 8 },
    STOCKING_CART_EQUIPMENT_ID,
    STOCKING_CART_BOX_SOCKET_ID,
  ).ok, true);
  assert.equal(
    preferredDeliveryEquipmentSocketIds(
      { box: 'merchbox', qty: 8 },
      STOCKING_CART_EQUIPMENT_ID,
    )[0],
    STOCKING_CART_BOX_SOCKET_ID,
  );
  for (const box of boxesOf(state)) {
    assert.deepEqual(quantityAndLifecycle(box), invariants.get(box.id));
  }
});
