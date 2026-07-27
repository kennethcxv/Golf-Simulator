import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { DOOR_MAIN, SHELL } from '../src/data/shopLayout.js';
import { sweptBy, SWING } from '../src/data/doorMath.js';
import { buildDoors } from '../src/render3d/clubhouse/doors.js';

function fixture({ left = 'closed', right = 'closed' } = {}) {
  const group = new THREE.Group();
  const colliders = [];
  const props = [];
  const sounds = [];
  const state = {
    shop: {
      deliveries: { boxes: [] },
      reno: {
        architecture: {
          version: 1,
          components: {
            shell: { restored: false, finish: 'warm-cream' },
            porch: { restored: false, finish: 'natural-oak' },
            windows: { restored: false, finish: 'deep-golf-green' },
            panels: { restored: false, finish: 'muted-sage' },
            trim: { restored: false, finish: 'warm-cream' },
            ceiling: { restored: false, finish: 'warm-cream' },
            floor: { restored: false, finish: 'natural-oak' },
          },
          doors: { main: { left, right } },
        },
      },
    },
    tutorial: { flags: {}, step: 0, complete: false },
  };
  const material = () => new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mats = {
    brass: material(), glass: material(), walnut: material(),
    walnutDark: material(), trimPaint: material(),
  };
  const walk = { active: false, x: 0, z: 0, radius: 0.34 };
  const api = buildDoors({
    group,
    mats,
    addCol: (collider) => colliders.push(collider),
    removeCol: (collider) => {
      const index = colliders.indexOf(collider);
      if (index >= 0) colliders.splice(index, 1);
    },
    addProp: (prop) => props.push(prop),
    removeProp: (prop) => {
      const index = props.indexOf(prop);
      if (index >= 0) props.splice(index, 1);
    },
    colBoxAt: (x, z, w, d) => ({
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    }),
    L2W: (x, z) => ({ x, z }),
    W2L: (x, z) => ({ x, z }),
    FLOOR_TOP: 0.3,
    state,
    hooks: { sfx: (name) => sounds.push(name), toast: () => {} },
    walk,
    getCustomers: () => [],
  });
  const mainProp = props.find((prop) => /^Shop door/.test(prop.label()));
  return { api, colliders, group, mainProp, mats, props, sounds, state, walk };
}

test('the live entrance uses two mirrored leaf colliders at the exact authored opening', () => {
  const { api, colliders, mainProp, props } = fixture();
  const [left, right] = api.mainDoor.leaves;
  const serviceDoors = api.doors.filter((door) => !door.isMain);
  assert.equal(api.doors.length, 4, 'two entrance leaves plus two service doors');
  assert.equal(colliders.length, 4);
  assert.equal(props.length, 3, 'one entrance interaction plus two service interactions');
  assert.ok(mainProp);
  assert.equal(left.closedSign, 1);
  assert.equal(right.closedSign, -1);
  assert.equal(left.mainLeaf, 'left');
  assert.equal(right.mainLeaf, 'right');
  assert.equal(left.collisionPad, 0.12);
  assert.ok(serviceDoors.every((door) => door.collisionPad === 0.055),
    'service leaf collision follows the authored six-centimetre slab');
  assert.ok(Math.abs(left.lx - (DOOR_MAIN.x - DOOR_MAIN.w / 2 + 0.09)) < 1e-12);
  assert.ok(Math.abs(right.lx - (DOOR_MAIN.x + DOOR_MAIN.w / 2 - 0.09)) < 1e-12);
  assert.ok(Math.abs(left.slabW - right.slabW) < 1e-12);
  assert.ok(left.collider.maxX <= right.collider.maxX);
  assert.equal(api.mainEntranceDiagnostics().leafCount, 2);
  assert.equal(api.mainEntranceDiagnostics().colliderCount, 2);
  assert.ok(Math.abs(DOOR_MAIN.w * 0.9144 - 1.8) < 1e-12);
  assert.ok(Math.abs(DOOR_MAIN.h * 0.9144 - 2.45) < 1e-12);
});

test('normal controls animate both leaves inward, update both colliders, persist, and emit audio hooks', () => {
  const { api, mainProp, sounds, state } = fixture();
  const [left, right] = api.mainDoor.leaves;
  const leftClosed = { ...left.collider };
  const rightClosed = { ...right.collider };

  mainProp.action();
  assert.deepEqual(state.shop.reno.architecture.doors.main, { left: 'open', right: 'open' });
  assert.deepEqual(sounds, ['doorbell', 'doorSwing']);
  api.updateDoors(1, 1);
  assert.ok(left.angle > 1.7 && left.angle < 1.8);
  assert.ok(right.angle < -1.7 && right.angle > -1.8);
  assert.equal(left.hinge.rotation.y, left.angle);
  assert.equal(right.hinge.rotation.y, right.angle);
  assert.notDeepEqual(left.collider, leftClosed);
  assert.notDeepEqual(right.collider, rightClosed);
  assert.equal(sweptBy(left, left.lx + left.slabW * 0.4, left.lz, 0.2), true);
  assert.equal(sweptBy(right, right.lx - right.slabW * 0.4, right.lz, 0.2), true,
    'mirrored high-hinge leaf uses the same occupancy rule');

  mainProp.action();
  assert.deepEqual(state.shop.reno.architecture.doors.main, { left: 'closed', right: 'closed' });
  assert.equal(sounds.at(-1), 'doorShut');
  api.updateDoors(1, 2);
  assert.ok(Math.abs(left.angle) < 1e-12);
  assert.ok(Math.abs(right.angle) < 1e-12);
});

test('service doors open automatically for unpacked delivery goods in the player\'s hands', () => {
  const { api, state, walk } = fixture();
  const stockroomDoor = api.doors.find((door) => door.name === 'Stockroom door');
  assert.ok(stockroomDoor);

  state.shop.carry = { skuId: 'desk1', qty: 1 };
  walk.active = true;
  walk.x = stockroomDoor.world.x;
  walk.z = stockroomDoor.world.z;
  api.updateDoors(0.2, 1);

  assert.equal(stockroomDoor.open, true);
  assert.equal(stockroomDoor.swingTarget, SWING,
    'the leaf parks in the stockroom instead of pinching the furnished office aisle');
  assert.equal(stockroomDoor.angle, SWING);
});

test('manual service-door interaction survives the outer edge of its focus radius', () => {
  const { api, props, walk } = fixture();
  const receivingDoor = api.doors.find((door) => door.name === 'Receiving door');
  const receivingProp = props.find((prop) => /^Receiving door/.test(prop.label()));
  assert.ok(receivingDoor);
  assert.ok(receivingProp);

  walk.active = true;
  walk.x = receivingDoor.world.x - 2.05;
  walk.z = receivingDoor.world.z;
  api.updateDoors(0.016, 100);
  receivingProp.action();
  api.updateDoors(0.016, 100.016);

  assert.equal(receivingDoor.open, true,
    'the 2.1-yard interaction band must not be cancelled by the 2.0-yard passive hold band');
  assert.equal(receivingDoor.lastNear, 100);
  api.updateDoors(0.016, 102.6);
  assert.equal(receivingDoor.open, false, 'normal auto-close still runs after the manual grace period');
});

test('the receiving door always swings outward so a carried freight crate cannot seal the backroom lane', () => {
  const { api, state, walk } = fixture();
  const receivingDoor = api.doors.find((door) => door.name === 'Receiving door');
  assert.ok(receivingDoor);
  assert.equal(receivingDoor.fixedSwing, SWING);

  state.shop.deliveries.boxes.push({ id: 1, skuId: 'desk1', qty: 1, loc: 'carried' });
  walk.active = true;
  // Approach from the exterior. The generic away-from-opener rule would use
  // -SWING here and put the leaf across the interior freight lane.
  walk.x = receivingDoor.world.x + 1.2;
  walk.z = receivingDoor.world.z;
  api.updateDoors(0.2, 1);

  assert.equal(receivingDoor.open, true);
  assert.equal(receivingDoor.swingTarget, SWING);
  api.updateDoors(1, 2);
  assert.equal(receivingDoor.angle, SWING);
  assert.ok(receivingDoor.collider.minX >= receivingDoor.lx - receivingDoor.collisionPad,
    'the open leaf stays on the exterior side of the east-wall hinge');
});

test('modern room leaves bind to the shared door authority and preserve their authored closed pose', () => {
  const { api, colliders, props, walk } = fixture();
  const root = new THREE.Group();
  const specs = [
    { key: 'employee', name: 'Employee door', pivotName: 'PIVOT_Interior_EmployeeRoom', cx: 5.8, cz: 4.0, width: 1.0, height: 2.3, along: 'z', closedSign: -1, hingeLx: 5.8, hingeLz: 4.5, fixedSwing: -SWING },
    { key: 'storage', name: 'Storage door', pivotName: 'PIVOT_Interior_Storage', cx: 5.8, cz: 0, width: 1.0, height: 2.3, along: 'z', closedSign: -1, hingeLx: 5.8, hingeLz: 0.5, fixedSwing: -SWING },
    { key: 'restroom', name: 'Restroom door', pivotName: 'PIVOT_Interior_Irrigation', cx: 5.8, cz: -4.0, width: 1.0, height: 2.3, along: 'z', closedSign: -1, hingeLx: 5.8, hingeLz: -3.5, fixedSwing: -SWING },
  ];
  for (const spec of specs) {
    const pivot = new THREE.Group();
    pivot.name = spec.pivotName;
    pivot.rotation.y = Math.PI / 2;
    root.add(pivot);
  }

  const binding = api.bindModernRoomDoorVisuals(root, specs);
  assert.deepEqual(binding, {
    ok: true,
    reused: false,
    bound: 3,
    keys: ['employee', 'storage', 'restroom'],
  });
  assert.equal(api.doors.length, 7);
  assert.equal(colliders.length, 7);
  assert.equal(props.length, 6);
  assert.equal(api.modernRoomDoorDiagnostics().count, 3);
  assert.equal(root.getObjectByName('PIVOT_Interior_Storage').rotation.y, Math.PI / 2);

  const storageDoor = api.doors.find((door) => door.modernRoomKey === 'storage');
  const storageProp = props.find((prop) => /^Storage door/.test(prop.label()));
  walk.active = true;
  walk.x = storageDoor.world.x - 1.0;
  walk.z = storageDoor.world.z;
  api.updateDoors(0.016, 4);
  storageProp.action();
  api.updateDoors(1, 4.016);
  assert.equal(storageDoor.angle, -SWING);
  assert.ok(Math.abs(storageDoor.authoredPivot.rotation.y - (Math.PI / 2 - SWING)) < 1e-12);

  const unbound = api.unbindModernRoomDoorVisuals();
  assert.deepEqual(unbound, { removed: 3, keys: ['employee', 'storage', 'restroom'] });
  assert.equal(api.doors.length, 4);
  assert.equal(colliders.length, 4);
  assert.equal(props.length, 3);
  for (const spec of specs) {
    assert.equal(root.getObjectByName(spec.pivotName).rotation.y, Math.PI / 2);
  }
});

test('Asset 53 pivots bind to the controller without replacing analytic collision or save authority', () => {
  const { api, mainProp } = fixture({ left: 'open', right: 'closed' });
  const authored = new THREE.Group();
  const leftPivot = new THREE.Group();
  const rightPivot = new THREE.Group();
  leftPivot.name = 'PIVOT_DoorLeft';
  rightPivot.name = 'PIVOT_DoorRight';
  authored.add(leftPivot, rightPivot);

  const bound = api.bindMainEntranceVisual(authored);
  assert.deepEqual(bound, { ok: true, leafCount: 2 });
  assert.equal(api.mainEntranceFallback.visible, false);
  assert.equal(authored.userData.sheet06DoorCollisionAuthority, 'ANALYTIC_DOUBLE_LEAF');
  api.updateDoors(1, 1);
  assert.equal(leftPivot.rotation.y, api.mainDoor.leaves[0].angle);
  assert.equal(rightPivot.rotation.y, api.mainDoor.leaves[1].angle);
  assert.ok(leftPivot.rotation.y > 1.7);
  assert.equal(rightPivot.rotation.y, 0);

  // Closing the aggregate from an independently restored save remains safe.
  mainProp.action();
  api.updateDoors(1, 2);
  assert.equal(leftPivot.rotation.y, 0);
  assert.equal(rightPivot.rotation.y, 0);
  assert.equal(api.unbindMainEntranceVisual().wasBound, true);
  assert.equal(api.mainEntranceFallback.visible, true);
});

test('an invalid authored root leaves the procedural entrance visible', () => {
  const { api } = fixture();
  const invalid = new THREE.Group();
  invalid.add(Object.assign(new THREE.Group(), { name: 'PIVOT_DoorLeft' }));
  assert.deepEqual(api.bindMainEntranceVisual(invalid), {
    ok: false, reason: 'missing-double-leaf-pivots',
  });
  assert.equal(api.mainEntranceFallback.visible, true);
  assert.equal(api.mainEntranceDiagnostics().authoredBound, false);
});
