import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

import { makeCharacter } from '../src/render3d/characterAsset.js';
import {
  PAID_BAG_ACCEPTANCE_HOLD_SEC, attachPaidBagToCustomer,
  createPaidBagResourceLedger, disposePaidBagFromCustomer,
  paidBagAttachedToCustomer, retainedPaidBagDisposalStatus,
  retryRetainedPaidBagDisposals, salvagePaidBagToCustomer, syncPaidBagCarry,
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

test('paid carrier departure disposes only its owned resources beneath the upright carry root', () => {
  const customer = { mesh: new THREE.Group() };
  const grip = new THREE.Group();
  customer.mesh.add(grip);
  const bag = new THREE.Group();
  const resources = createPaidBagResourceLedger();
  const ownedGeometry = resources.ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const ownedMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial());
  const sharedGeometry = new THREE.SphereGeometry(1);
  const sharedMaterial = new THREE.MeshStandardMaterial();
  const ownedCounts = { geometry: 0, material: 0 };
  const sharedCounts = { geometry: 0, material: 0 };
  ownedGeometry.addEventListener('dispose', () => { ownedCounts.geometry += 1; });
  ownedMaterial.addEventListener('dispose', () => { ownedCounts.material += 1; });
  sharedGeometry.addEventListener('dispose', () => { sharedCounts.geometry += 1; });
  sharedMaterial.addEventListener('dispose', () => { sharedCounts.material += 1; });
  bag.add(
    new THREE.Mesh(ownedGeometry, ownedMaterial),
    new THREE.Mesh(sharedGeometry, sharedMaterial),
  );
  bag.userData.disposeCheckoutPaidBagResources = () => resources.dispose();

  attachPaidBagToCustomer(customer, bag, { productionBag: false, carryTarget: grip });
  assert.equal(paidBagAttachedToCustomer(customer), true);
  const first = disposePaidBagFromCustomer(customer);
  const second = disposePaidBagFromCustomer(customer);

  assert.deepEqual(ownedCounts, { geometry: 1, material: 1 });
  assert.deepEqual(sharedCounts, { geometry: 0, material: 0 });
  assert.deepEqual(
    { geometries: first.resources.geometries, materials: first.resources.materials },
    { geometries: 1, materials: 1 },
  );
  assert.equal(second.hadBag, false, 'the departure funnel is exact-once');
  assert.equal(bag.parent, null);
  assert.equal(customer.bagCarryRoot, null);
  assert.equal(customer.bagCarryTarget, null);
  assert.equal(customer.bagMesh, null);

  sharedGeometry.dispose();
  sharedMaterial.dispose();
});

test('a throwing paid-bag disposer detaches the actor but retains an explicit retry owner', () => {
  const customer = { mesh: new THREE.Group(), checkoutHandoffBag: null };
  const bag = new THREE.Group();
  let disposeCalls = 0;
  bag.userData.disposeCheckoutPaidBagResources = () => {
    disposeCalls += 1;
    if (disposeCalls === 1) throw new Error('synthetic paid-bag disposal failure');
    return { liveGeometries: 0, liveMaterials: 0, errors: [] };
  };
  attachPaidBagToCustomer(customer, bag);
  customer.checkoutHandoffBag = bag;
  assert.equal(paidBagAttachedToCustomer(customer), true);

  const result = disposePaidBagFromCustomer(customer);
  assert.equal(result.errors.some((entry) => entry.stage === 'owned-resources'), true);
  assert.equal(result.retained, true,
    'clearing the actor pointer cannot make the failed disposer unreachable');
  assert.equal(result.retainedStatus.retained, 1);
  assert.equal(bag.parent, null);
  assert.equal(customer.bagMesh, null);
  assert.equal(customer.bagCarryRoot, null);
  assert.equal(customer.bagCarryTarget, null);
  assert.equal(customer.checkoutHandoffBag, null);

  const retried = retryRetainedPaidBagDisposals();
  assert.equal(retried.released, 1);
  assert.equal(retried.retained, 0);
  assert.equal(disposeCalls, 2);
  assert.equal(retainedPaidBagDisposalStatus().retained, 0);
});

test('paid-bag ledger failure exhausts siblings and retains only the failed resource for retry', () => {
  const customer = { mesh: new THREE.Group(), checkoutHandoffBag: null };
  const bag = new THREE.Group();
  const resources = createPaidBagResourceLedger();
  const brokenMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial());
  const goodMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial());
  const goodGeometry = resources.ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const calls = { broken: 0, material: 0, geometry: 0 };
  const originalBrokenDispose = brokenMaterial.dispose.bind(brokenMaterial);
  brokenMaterial.dispose = () => {
    calls.broken += 1;
    if (calls.broken === 1) throw new Error('synthetic paid-bag material failure');
    originalBrokenDispose();
  };
  goodMaterial.addEventListener('dispose', () => { calls.material += 1; });
  goodGeometry.addEventListener('dispose', () => { calls.geometry += 1; });
  bag.add(new THREE.Mesh(goodGeometry, [brokenMaterial, goodMaterial]));
  bag.userData.disposeCheckoutPaidBagResources = () => resources.dispose();
  attachPaidBagToCustomer(customer, bag);

  const first = disposePaidBagFromCustomer(customer);
  assert.equal(first.retained, true);
  assert.equal(first.resources.liveMaterials, 1);
  assert.equal(first.resources.liveGeometries, 0);
  assert.deepEqual(calls, { broken: 1, material: 1, geometry: 1 },
    'the throwing material cannot abort its owned siblings');
  assert.equal(customer.bagMesh, null, 'customer removal remains independent of GPU failure');
  assert.equal(retainedPaidBagDisposalStatus().retained, 1);

  const retry = retryRetainedPaidBagDisposals();
  assert.equal(retry.retained, 0);
  assert.equal(retry.released, 1);
  assert.deepEqual(calls, { broken: 2, material: 1, geometry: 1 },
    'retry touches only the resource that remained live');
  assert.deepEqual(resources.status(), {
    geometriesCreated: 1,
    materialsCreated: 2,
    geometriesDisposed: 1,
    materialsDisposed: 2,
    liveGeometries: 0,
    liveMaterials: 0,
    disposalErrors: 1,
    disposed: true,
  });
});

test('register teardown drains retained paid-bag ownership after customer removal', () => {
  const disposeRegister = registerFunction('disposeRegisterModeResources');
  assert.match(disposeRegister, /let retainedPaidBags = retryRetainedPaidBagDisposals\(\)/);
  assert.match(disposeRegister, /retainedPaidBags\.retained === 0/,
    'teardown cannot report complete while a detached paid bag remains retained');
  assert.match(disposeRegister, /retainedPaidBags,/,
    'the disposal summary preserves failure/retry diagnostics');
});

test('an exception after the upright carrier mounts remains discoverable and disposable', () => {
  const customer = { mesh: new THREE.Group(), checkoutHandoffBag: null };
  const grip = new THREE.Group();
  customer.mesh.add(grip);
  const bag = new THREE.Group();
  const resources = createPaidBagResourceLedger();
  const geometry = resources.ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const material = resources.ownMaterial(new THREE.MeshStandardMaterial());
  const disposals = { geometry: 0, material: 0 };
  geometry.addEventListener('dispose', () => { disposals.geometry += 1; });
  material.addEventListener('dispose', () => { disposals.material += 1; });
  bag.add(new THREE.Mesh(geometry, material));
  bag.userData.disposeCheckoutPaidBagResources = () => resources.dispose();
  bag.getObjectByName = () => { throw new Error('synthetic authored-anchor failure'); };
  customer.checkoutHandoffBag = bag;

  assert.throws(
    () => attachPaidBagToCustomer(customer, bag, { productionBag: true, carryTarget: grip }),
    /synthetic authored-anchor failure/,
  );
  assert.equal(customer.bagMesh, bag,
    'departure ownership is established before authored anchor lookup can throw');
  assert.equal(paidBagAttachedToCustomer(customer), true,
    'the partially mounted carrier is already beneath the customer root');
  assert.equal(salvagePaidBagToCustomer(customer, bag), true,
    'salvage reports success only after verifying the ownership postcondition');
  assert.equal(customer.checkoutHandoffBag, null);

  const result = disposePaidBagFromCustomer(customer);
  assert.deepEqual(disposals, { geometry: 1, material: 1 });
  assert.deepEqual(
    { liveGeometries: result.resources.liveGeometries, liveMaterials: result.resources.liveMaterials },
    { liveGeometries: 0, liveMaterials: 0 },
  );
  assert.equal(bag.parent, null);
});

test('paid-bag salvage refuses false greens for wrong ownership and conflicting bags', () => {
  const customer = { mesh: new THREE.Group() };
  const bag = new THREE.Group();
  const otherBag = new THREE.Group();
  customer.mesh.add(bag);

  bag.userData.checkoutOwner = 'register';
  assert.equal(salvagePaidBagToCustomer(customer, bag), false,
    'ancestry alone is not paid ownership');

  bag.userData.checkoutOwner = 'customer';
  customer.bagMesh = otherBag;
  assert.equal(salvagePaidBagToCustomer(customer, bag), false,
    'salvage cannot replace a different departure owner and claim success');
  assert.equal(customer.bagMesh, otherBag);
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
  assert.match(
    buildBag,
    /if \(bagGroup !== builtBag \|\| builtBag\.userData\.checkoutOwner !== 'register'\) return/,
    'a superseded or already-transferred wrapper rejects late merchandise callbacks',
  );
  assert.match(buildBag, /builtBag\.add\(model\)/,
    'the production model attaches only to its captured wrapper');
});

test('post-transfer readiness cannot change the resource totals departure must reconcile', () => {
  const buildBag = registerFunction('buildBag');
  const callbackAt = buildBag.indexOf('merch.onReady(() => {');
  const ownershipGuardAt = buildBag.indexOf("builtBag.userData.checkoutOwner !== 'register'", callbackAt);
  const releaseFallbackAt = buildBag.indexOf('ownedResources.releaseGeometry(fallback.geometry)', callbackAt);
  const cloneMaterialAt = buildBag.indexOf('applyKraftBagStyle(model, ownedResources)', callbackAt);
  assert.ok(
    callbackAt >= 0
      && ownershipGuardAt > callbackAt
      && releaseFallbackAt > ownershipGuardAt
      && cloneMaterialAt > ownershipGuardAt,
    'the ownership guard runs before any late release or per-bag material allocation',
  );

  const resources = createPaidBagResourceLedger();
  resources.ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  resources.ownMaterial(new THREE.MeshStandardMaterial());
  const transferred = resources.status();
  const departed = resources.dispose();
  assert.equal(departed.geometries, transferred.liveGeometries);
  assert.equal(departed.materials, transferred.liveMaterials);
  assert.equal(departed.liveGeometries, 0);
  assert.equal(departed.liveMaterials, 0);
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
