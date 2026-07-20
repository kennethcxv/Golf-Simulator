import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { DOOR_MAIN, SHELL } from '../src/data/shopLayout.js';
import { sweptBy } from '../src/data/doorMath.js';
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
    addProp: (prop) => props.push(prop),
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
  assert.equal(api.doors.length, 4, 'two entrance leaves plus two service doors');
  assert.equal(colliders.length, 4);
  assert.equal(props.length, 3, 'one entrance interaction plus two service interactions');
  assert.ok(mainProp);
  assert.equal(left.closedSign, 1);
  assert.equal(right.closedSign, -1);
  assert.equal(left.mainLeaf, 'left');
  assert.equal(right.mainLeaf, 'right');
  assert.ok(Math.abs(left.lx - (DOOR_MAIN.x - DOOR_MAIN.w / 2 + 0.09)) < 1e-12);
  assert.ok(Math.abs(right.lx - (DOOR_MAIN.x + DOOR_MAIN.w / 2 - 0.09)) < 1e-12);
  assert.ok(Math.abs(left.slabW - right.slabW) < 1e-12);
  assert.ok(left.collider.maxX <= right.collider.maxX);
  assert.equal(api.mainEntranceDiagnostics().leafCount, 2);
  assert.equal(api.mainEntranceDiagnostics().colliderCount, 2);
  assert.ok(Math.abs(DOOR_MAIN.w * 0.9144 - 1.8) < 1e-12);
  assert.ok(Math.abs(DOOR_MAIN.h * 0.9144 - 2.45) < 1e-12);
});

test('normal controls animate both leaves inward, update both colliders, and persist both states', () => {
  const { api, mainProp, state } = fixture();
  const [left, right] = api.mainDoor.leaves;
  const leftClosed = { ...left.collider };
  const rightClosed = { ...right.collider };

  mainProp.action();
  assert.deepEqual(state.shop.reno.architecture.doors.main, { left: 'open', right: 'open' });
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
  api.updateDoors(1, 2);
  assert.ok(Math.abs(left.angle) < 1e-12);
  assert.ok(Math.abs(right.angle) < 1e-12);
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
