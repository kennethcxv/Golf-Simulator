import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { makeCharacter } from '../src/render3d/characterAsset.js';
import {
  PAID_BAG_ACCEPTANCE_HOLD_SEC, attachPaidBagToCustomer, syncPaidBagCarry,
} from '../src/render3d/clubhouse/customerPaidBag.js';

const close = (a, b, epsilon = 1e-8) => a.distanceTo(b) <= epsilon;

test('the customer rig exposes a scale-independent carry grip beside each hand', () => {
  const char = makeCharacter();
  char.root.scale.setScalar(0.93);
  char.root.updateMatrixWorld(true);

  for (const side of ['L', 'R']) {
    const hand = char.hand(side);
    const grip = char.carryGrip(side);
    assert.equal(grip.parent, hand.parent, `${side} grip follows the same articulated elbow`);
    assert.notEqual(grip, hand, `${side} grip is not the non-uniformly scaled hand mesh`);
    assert.ok(grip.position.distanceTo(hand.position) < 0.06, `${side} grip remains inside the palm`);
    const worldScale = grip.getWorldScale(new THREE.Vector3());
    assert.ok(close(worldScale, new THREE.Vector3(0.93, 0.93, 0.93)), `${side} grip inherits only customer scale`);
  }
});

test('the paid bag follows the authored palm point while staying gravity-upright', () => {
  const char = makeCharacter();
  char.root.scale.setScalar(0.93);
  char.root.rotation.y = 0.7;
  char.setMode('ReceiveBag');
  char.update(0.2);
  char.root.updateMatrixWorld(true);

  // A synthetic production-bag hierarchy exercises the same authored anchor
  // contract as checkout_shopping_bag.glb without coupling the unit test to a
  // binary loader.
  const bag = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.50, 0.18));
  body.position.y = -0.25;
  bag.add(body);
  const handoff = new THREE.Group();
  handoff.name = 'ANCHOR_BagHandoff';
  bag.add(handoff);
  bag.scale.setScalar(0.68);

  const customer = { mesh: char.root };
  const grip = char.carryGrip('R');
  attachPaidBagToCustomer(customer, bag, { productionBag: true, carryTarget: grip });
  char.root.updateMatrixWorld(true);

  assert.equal(customer.bagMesh, bag);
  assert.equal(bag.parent, customer.bagCarryRoot, 'bag ownership transfers to the upright carrier');
  assert.notEqual(bag.parent, grip, 'forearm pitch cannot rotate the bag horizontal');
  assert.ok(close(
    grip.getWorldPosition(new THREE.Vector3()),
    handoff.getWorldPosition(new THREE.Vector3()),
  ), 'authored bag handoff anchor lands exactly at the palm grip');

  char.setMode('WalkBag');
  char.update(0.6);
  syncPaidBagCarry(customer);
  char.root.updateMatrixWorld(true);
  assert.ok(close(
    grip.getWorldPosition(new THREE.Vector3()),
    handoff.getWorldPosition(new THREE.Vector3()),
  ), 'bag continues following the articulated grip during departure');

  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bag.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(up.dot(new THREE.Vector3(0, 1, 0)) > 0.99, 'bag remains visually upright');
  assert.ok(PAID_BAG_ACCEPTANCE_HOLD_SEC >= 1.2, 'acceptance pose remains visible long enough to read');
});

test('the acceptance beat holds the paid bag clear of the cashier POS before easing to the walking hand', () => {
  const char = makeCharacter();
  const bag = new THREE.Group();
  const handoff = new THREE.Group();
  handoff.name = 'ANCHOR_BagHandoff';
  bag.add(handoff);
  const customer = {
    mesh: char.root,
    bagAcceptanceHold: PAID_BAG_ACCEPTANCE_HOLD_SEC,
  };

  attachPaidBagToCustomer(customer, bag, {
    productionBag: true,
    carryTarget: char.carryGrip('R'),
  });
  assert.ok(close(
    customer.bagCarryRoot.position,
    new THREE.Vector3(0.40, 1.40, 0.46),
  ), 'bag is staged against the receiving torso where the cashier can see it');

  customer.bagAcceptanceHold = 0;
  const before = customer.bagCarryRoot.position.clone();
  syncPaidBagCarry(customer, 1 / 60);
  assert.ok(customer.bagCarryRoot.position.distanceTo(before) > 0,
    'bag begins a smooth move toward the walking grip when the hold expires');
  assert.ok(customer.bagCarryRoot.position.distanceTo(char.carryGrip('R').position) > 0.01,
    'the first walking frame does not pop directly to the side carry pose');
});
