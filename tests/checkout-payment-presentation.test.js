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

test('presented tender lies flat ON the counter as a readable fan', () => {
  // Round 7: "make it so the money goes on the desk" — the anchor is a point
  // on the counter top, every note rests flat (paper-thin y climb only), and
  // the fan spreads wide enough that each piece reads as its own bill.
  const anchor = { x: 3, y: 1.055, z: 3.9 };
  const layout = presentedTenderLayout([20, 20, 0.25, 0.01], anchor);
  for (const entry of layout) {
    const lift = entry.position.y - anchor.y;
    assert.ok(lift >= 0 && lift <= 0.02,
      `every piece lies on the counter, never held in the air (lift ${lift})`);
  }
  const billStep = localDelta(layout[0].position, layout[1].position);
  assert.ok(Math.abs(billStep.x) >= 0.04, 'notes fan sideways as separate flat bills');
  assertClose(billStep.y, 0.0016, 'the overlap climbs only paper thickness');
  assertDeskRotation(layout[0].rotation, { x: 0, y: -0.10 - 0.14, z: 0 },
    'notes lie FLAT (no held-fan pitch) and rotate with the front desk');
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
