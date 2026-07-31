import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  changeBundleLayout, changeHandoffPoint, customerCardPoint,
  presentedTenderLayout, selectedChangeLayout,
} from '../src/render3d/clubhouse/checkoutPaymentPresentation.js';
import { FRONT_DESK_FRAME, frontDeskLocalPoint } from '../src/data/shopLayout.js';

const EPSILON = 1e-9;

function localDelta(from, to) {
  const start = frontDeskLocalPoint(from.x, from.z);
  const end = frontDeskLocalPoint(to.x, to.z);
  return { x: end.x - start.x, y: to.y - from.y, z: end.z - start.z };
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: ${actual}`);
}

function assertDeskRotation(rotation, localRotation, message) {
  const actual = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    rotation.x,
    rotation.y,
    rotation.z,
  ));
  const expected = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    FRONT_DESK_FRAME.ry,
  ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
    localRotation.x,
    localRotation.y,
    localRotation.z,
  )));
  assert.ok(actual.angleTo(expected) <= 1e-7, message);
}

test('the customer pinches the card edge instead of occupying its centre', () => {
  const hand = { x: 3, y: 1.2, z: 3.9 };
  const card = customerCardPoint(hand);
  const delta = localDelta(hand, card);
  assertClose(delta.x, -0.030, 'card pinch keeps its desk-local x offset');
  assertClose(delta.y, 0.018, 'card pinch keeps its vertical offset');
  assertClose(delta.z, 0.028, 'card pinch keeps its desk-local z offset');
  assert.ok(Math.hypot(card.x - hand.x, card.z - hand.z) < 0.043,
    'the hand still overlaps an ID-1 card edge');
});

test('presented tender is a compact, readable handful', () => {
  const layout = presentedTenderLayout([20, 20, 0.25, 0.01], { x: 3, y: 1.2, z: 3.9 });
  const local = layout.map((entry) => frontDeskLocalPoint(entry.position.x, entry.position.z));
  const xs = local.map((point) => point.x);
  const zs = local.map((point) => point.z);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.06);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 0.07);
  const billStep = localDelta(layout[0].position, layout[1].position);
  assertClose(billStep.x, 0.009, 'bill stack advances along local x');
  assertClose(billStep.y, 0.0022, 'bill stack advances vertically');
  assertClose(billStep.z, 0.002, 'bill stack advances along local z');
  assertDeskRotation(layout[0].rotation, { x: 1.04, y: -0.05, z: 0 },
    'the tilted note rotates with the front desk');
});

test('exact $4.28 lies as a compact FLAT pile on the bare counter', () => {
  // The handoff tray prop was deleted (checkout-physicality round 2026-07-30):
  // counted change now reads like the reference — separate flat notes fanned
  // sideways with coins flat beside them, directly on the counter top.
  const denoms = [1, 1, 1, 1, 0.2, 0.05, 0.01, 0.01, 0.01];
  const handoff = { x: 3.1, z: 4.6 };
  const layout = selectedChangeLayout(denoms, handoff, 0.92);
  const local = layout.map((entry) => ({
    entry,
    delta: localDelta({ ...handoff, y: 0.92 }, entry.position),
  }));
  for (const { delta } of local) {
    assert.ok(Math.abs(delta.x) <= 0.19, 'the pile keeps its authored footprint in x');
    assert.ok(Math.abs(delta.z) <= 0.10, 'the pile keeps its authored footprint in z');
    assert.ok(delta.y >= 0 && delta.y <= 0.015,
      'every piece lies flat ON the counter, never floating at tray height');
  }
  const bills = local.filter(({ entry }) => entry.denom >= 1);
  const billSpan = Math.max(...bills.map(({ delta }) => delta.x))
    - Math.min(...bills.map(({ delta }) => delta.x));
  assert.ok(billSpan >= 0.06 && billSpan <= 0.16,
    `notes fan sideways as separate flat bills, not one stack (span ${billSpan})`);
  assertDeskRotation(layout[0].rotation, { x: 0, y: -0.08, z: 0 },
    'counted notes lie flat and rotate with the desk frame');
});

test('confirmed change has one compact carrier and a palm-contact endpoint', () => {
  const layout = changeBundleLayout([1, 1, 1, 1, 0.2, 0.05, 0.01, 0.01, 0.01]);
  assert.equal(layout.length, 9);
  assert.ok(Math.max(...layout.map((entry) => entry.position.x))
    - Math.min(...layout.map((entry) => entry.position.x)) < 0.07);
  const hand = { x: 3, y: 1.2, z: 3.9 };
  const point = changeHandoffPoint(hand);
  const delta = localDelta(hand, point);
  assertClose(delta.x, -0.018, 'change endpoint meets the palm along local x');
  assertClose(delta.y, 0.025, 'change endpoint meets the palm vertically');
  assertClose(delta.z, 0.030, 'change endpoint meets the palm along local z');
});
