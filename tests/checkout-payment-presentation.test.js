import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeBundleLayout, changeHandoffPoint, customerCardPoint,
  presentedTenderLayout, selectedChangeLayout,
} from '../src/render3d/clubhouse/checkoutPaymentPresentation.js';

test('the customer pinches the card edge instead of occupying its centre', () => {
  const hand = { x: 3, y: 1.2, z: 3.9 };
  const card = customerCardPoint(hand);
  assert.deepEqual(card, { x: 2.97, y: 1.218, z: 3.928 });
  assert.ok(Math.abs(card.x - hand.x) < 0.043, 'the hand still overlaps an ID-1 card edge');
});

test('presented tender is a compact, readable handful', () => {
  const layout = presentedTenderLayout([20, 20, 0.25, 0.01], { x: 3, y: 1.2, z: 3.9 });
  const xs = layout.map((entry) => entry.position.x);
  const zs = layout.map((entry) => entry.position.z);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.06);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 0.07);
  assert.equal(layout[0].rotation.x, 1.04);
  assert.ok(Math.abs(layout[1].position.x - layout[0].position.x - 0.009) < 1e-9);
});

test('exact $4.28 stays grouped within the authored handoff tray', () => {
  const denoms = [1, 1, 1, 1, 0.2, 0.05, 0.01, 0.01, 0.01];
  const handoff = { x: 3.1, z: 4.6 };
  const layout = selectedChangeLayout(denoms, handoff, 0.92);
  for (const entry of layout) {
    assert.ok(Math.abs(entry.position.x - handoff.x) <= 0.19);
    assert.ok(Math.abs(entry.position.z - handoff.z) <= 0.10);
  }
  const bills = layout.filter((entry) => entry.denom >= 1);
  assert.ok(Math.max(...bills.map((entry) => entry.position.x))
    - Math.min(...bills.map((entry) => entry.position.x)) <= 0.0181);
});

test('confirmed change has one compact carrier and a palm-contact endpoint', () => {
  const layout = changeBundleLayout([1, 1, 1, 1, 0.2, 0.05, 0.01, 0.01, 0.01]);
  assert.equal(layout.length, 9);
  assert.ok(Math.max(...layout.map((entry) => entry.position.x))
    - Math.min(...layout.map((entry) => entry.position.x)) < 0.07);
  const point = changeHandoffPoint({ x: 3, y: 1.2, z: 3.9 });
  assert.ok(Math.abs(point.x - 2.982) < 1e-9);
  assert.ok(Math.abs(point.y - 1.225) < 1e-9);
  assert.ok(Math.abs(point.z - 3.93) < 1e-9);
});
