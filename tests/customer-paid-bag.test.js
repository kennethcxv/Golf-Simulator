import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

import { makeCharacter } from '../src/render3d/characterAsset.js';
import {
  PAID_BAG_ACCEPTANCE_HOLD_SEC, attachPaidBagToCustomer, syncPaidBagCarry,
} from '../src/render3d/clubhouse/customerPaidBag.js';

const close = (a, b, epsilon = 1e-8) => a.distanceTo(b) <= epsilon;

const registerSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);
const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);

function registerFunction(name) {
  const start = registerSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = registerSource.indexOf('\n  function ', start + 1);
  return registerSource.slice(start, end === -1 ? registerSource.length : end);
}

function clubhouseFunction(name) {
  const start = clubhouseSource.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = clubhouseSource.indexOf('\n  function ', start + 1);
  return clubhouseSource.slice(start, end === -1 ? clubhouseSource.length : end);
}

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

test('the acceptance beat keeps the authored bag handle in the receiving palm', () => {
  const char = makeCharacter();
  char.setMode('ReceiveBag');
  char.update(0);
  char.root.updateMatrixWorld(true);
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
    carryTarget: char.carryGrip('L'),
  });
  char.root.updateMatrixWorld(true);
  assert.ok(close(
    handoff.getWorldPosition(new THREE.Vector3()),
    char.carryGrip('L').getWorldPosition(new THREE.Vector3()),
  ), 'acceptance starts with the authored handoff socket exactly in the palm');

  customer.bagAcceptanceHold = 0;
  char.setMode('WalkBag');
  char.update(0.6);
  syncPaidBagCarry(customer, 1 / 60);
  char.root.updateMatrixWorld(true);
  assert.ok(close(
    handoff.getWorldPosition(new THREE.Vector3()),
    char.carryGrip('L').getWorldPosition(new THREE.Vector3()),
  ), 'the bag remains exactly attached to the animated walking palm');
});

test('handed-off bag cleanup preserves the customer copy and retry resets safely', () => {
  const clearPhysicalTransaction = registerFunction('clearPhysicalTransaction');
  assert.match(
    clearPhysicalTransaction,
    /preserveCustomerBag && bagGroup\?\.userData\.checkoutOwner === 'customer'[\s\S]*bagGroup = null/,
    'finalization releases the register pointer without hiding the customer-owned bag',
  );
  // no receipt pointer exists any more (round 7 removed the paper entirely)
  assert.doesNotMatch(clearPhysicalTransaction, /receiptMesh/,
    'there is no receipt mesh left to preserve or dispose');

  const retryFulfillmentPresentation = registerFunction('retryFulfillmentPresentation');
  assert.equal(
    retryFulfillmentPresentation.match(/\bresetBagAtCounter\(\)/g)?.length,
    1,
    'retry restores exactly one fresh bag at the counter',
  );
  assert.doesNotMatch(
    retryFulfillmentPresentation,
    /\bresetCounterBag\b/,
    'retry cannot reference clearPhysicalTransaction\'s out-of-scope option',
  );
});

test('exactly the physically handed bag survives the banking boundary - with no paper', () => {
  const onCustomerPaid = clubhouseFunction('onCustomerPaid');
  assert.match(onCustomerPaid, /const handedBag = c\.checkoutHandoffBag \|\| null/,
    'paid ownership reuses the bag seen reaching the customer');
  assert.doesNotMatch(onCustomerPaid, /loose_receipt/,
    'round 7: no receipt prop rides in the departure bag');
  assert.match(onCustomerPaid, /attachPaidBagToCustomer\(c, bag/,
    'the handed bag transfers to the durable articulated carry root');

  const removeCustomer = clubhouseFunction('removeCustomer');
  assert.match(removeCustomer, /disposeCustomerHandoffReceipt\(c\)/,
    'the departure funnel still releases any legacy carried receipt safely');
});

test('late bag asset readiness cannot mutate a newer transaction carrier', () => {
  const buildBag = registerFunction('buildBag');
  assert.match(buildBag, /const builtBag = new THREE\.Group\(\)/,
    'each async asset request captures its own carrier wrapper');
  assert.match(buildBag, /if \(bagGroup !== builtBag\) return/,
    'a superseded wrapper rejects late merchandise callbacks');
  assert.match(buildBag, /builtBag\.add\(model\)/,
    'the production model attaches only to its captured wrapper');
});

test('each persisted customer owns a distinct review id across repeated checkouts', () => {
  assert.match(clubhouseSource,
    /const customerId = c\?\.customerId \|\| c\?\.id/,
    'the persisted customer-directory id is the primary review authority');
  assert.equal((clubhouseSource.match(/reviewId: reviewIdOfCustomer\(c\)/g) || []).length, 3,
    'purchase, walkout, and ordinary departure share the same identity helper');
  assert.doesNotMatch(clubhouseSource, /reviewId:[^\n]*\$\{c\.id\}/,
    'modern customers cannot collapse onto an undefined legacy id');
});
