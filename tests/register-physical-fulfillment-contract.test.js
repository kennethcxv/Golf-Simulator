import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  runCheckoutCleanupSteps, runPaidCustomerAuthoritativeRelease,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

const registerSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

function functionBody(source, name, indent = '  ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const parametersOpen = source.indexOf('(', start);
  let parameterDepth = 0;
  let parametersClose = -1;
  for (let index = parametersOpen; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')' && --parameterDepth === 0) {
      parametersClose = index;
      break;
    }
  }
  assert.notEqual(parametersClose, -1, `${name} has a complete parameter list`);
  const open = source.indexOf('{', parametersClose);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

const registerFunction = (name) => functionBody(registerSource, name);
const clubhouseFunction = (name) => functionBody(clubhouseSource, name);

test('product drops resolve against the production bag mouth socket', () => {
  const buildBag = registerFunction('buildBag');
  assert.match(buildBag, /getObjectByName\('ANCHOR_BagDrop'\)/,
    'the production bag exposes its authored drop socket');
  assert.match(
    buildBag,
    /bagMouth\.copy\(root\.worldToLocal\(drop\.getWorldPosition\(new THREE\.Vector3\(\)\)\)\)/,
    'the authored world-space socket is converted into the register drag frame',
  );

  // (the receipt drag retired with the receipt itself — round 7)
  const settleProduct = registerFunction('settleBaggingProduct');
  assert.match(settleProduct, /distanceTo\(bagMouth\)/,
    'product acceptance measures physical 3D contact with the authored mouth');
  // F3 (Full_Goal_16): the drop still travels THROUGH the authored mouth and
  // then continues INSIDE along the mouth's own axis — the continuation is
  // derived from the same two authored points (base minus mouth), never a
  // separate target.
  assert.match(settleProduct, /to:\s*bagMouth\.clone\(\)\.add\(dropInto\)/,
    'the accepted product travels through the authored mouth and on inside');
  assert.match(settleProduct, /BAG_POS\.clone\(\)\.sub\(bagMouth\)/,
    'the into-bag continuation is the mouth socket\'s own axis, not a new target');
});

test('pending product-drop animations block handoff and teardown releases every motion', () => {
  const update = registerFunction('update');
  const advanceMotions = update.indexOf('updateBagDropMotions(animationDt)');
  const exposeHandoff = update.indexOf('updateCustomerPalmTarget()');
  assert.ok(advanceMotions >= 0 && advanceMotions < exposeHandoff,
    'the frame loop settles product drops before exposing bag-handoff input');

  const startHandoff = registerFunction('startBagHandoffDrag');
  const motionGuard = startHandoff.indexOf('bagDropMotions.length');
  const dragStart = startHandoff.indexOf('scanDrag = {');
  assert.ok(motionGuard >= 0 && motionGuard < dragStart,
    'the player cannot grab the carrier while a paid product is still falling into it');

  const updatePalm = registerFunction('updateCustomerPalmTarget');
  const readiness = updatePalm.indexOf('bagDropMotions.length === 0');
  const makePickable = updatePalm.indexOf('setBagPickable(');
  assert.ok(readiness >= 0 && readiness < makePickable,
    'the bag handles and palm target stay inactive until every product lands');

  const clearPhysicalTransaction = registerFunction('clearPhysicalTransaction');
  const clearMotions = clearPhysicalTransaction.indexOf('bagDropMotions.length = 0');
  const disposeItems = clearPhysicalTransaction.indexOf('for (const mesh of clearingItemMeshes)');
  assert.ok(clearMotions >= 0 && clearMotions < disposeItems,
    'transaction teardown drops stale animation references before disposing their meshes');

  const abandon = registerFunction('abandon');
  assert.match(abandon, /clearPhysicalTransaction\(\)/,
    'voiding a transaction uses the same motion-clearing teardown');
});

test('manual bag handoff requires Bagging and propagates transition or delivery refusal', () => {
  const startHandoff = registerFunction('startBagHandoffDrag');
  const stateGate = startHandoff.indexOf("checkoutFlowState() !== 'Bagging'");
  const transition = startHandoff.indexOf("flowTo('BagHandoff'");
  const dragStart = startHandoff.indexOf('scanDrag = {');
  assert.ok(stateGate >= 0 && stateGate < transition,
    'only the Bagging state may attempt the manual handoff transition');
  assert.match(startHandoff, /if \(!flowTo\('BagHandoff',[\s\S]*?\)\) return false/,
    'a rejected BagHandoff transition must fail closed');
  assert.ok(transition < dragStart,
    'bag motion starts only after the flow transition succeeds');

  const settleHandoff = registerFunction('settleBagHandoff');
  const domainHandoff = settleHandoff.indexOf('handOverGoods(tx)');
  const deliveryStart = settleHandoff.indexOf('beginBagDeliveryOrRelease()');
  const fulfilled = settleHandoff.indexOf('autoFulfilled = true');
  assert.ok(domainHandoff >= 0 && domainHandoff < deliveryStart && deliveryStart < fulfilled,
    'successful domain handoff and physical delivery start both precede fulfillment');
  assert.match(
    settleHandoff,
    /(?:if \(!beginBagDeliveryOrRelease\(\)\)|const \w+ = beginBagDeliveryOrRelease\(\);[\s\S]*?if \(!\w+\))/,
    'delivery-start refusal must be observed instead of being discarded',
  );
});

test('banking preserves packed bag descendants until the customer cleanup funnel', () => {
  const finalize = registerFunction('finalizeTransaction');
  const customerOwnsSale = finalize.indexOf('finishedCustomer.onPaid(finishedTx)');
  const registerTeardown = finalize.indexOf('clearPhysicalTransaction({');
  assert.ok(customerOwnsSale >= 0 && customerOwnsSale < registerTeardown,
    'the customer takes ownership before register presentation cleanup begins');
  assert.match(finalize, /preserveCustomerBag:\s*true/);

  const clearPhysicalTransaction = registerFunction('clearPhysicalTransaction');
  const preserveCheck = clearPhysicalTransaction.indexOf('preserveCustomerBag');
  const customerOwnerCheck = clearPhysicalTransaction.indexOf("checkoutOwner === 'customer'");
  const preserveContents = clearPhysicalTransaction.indexOf('continue;', customerOwnerCheck);
  const disposeMesh = clearPhysicalTransaction.indexOf('itemResources.dispose(mesh)');
  assert.ok(
    preserveCheck >= 0
      && customerOwnerCheck > preserveCheck
      && preserveContents > customerOwnerCheck
      && preserveContents < disposeMesh,
    'customer-bag descendants skip register-owned item disposal',
  );

  const onCustomerPaid = clubhouseFunction('onCustomerPaid');
  assert.match(onCustomerPaid, /const handedBag = c\.checkoutHandoffBag \|\| null/);
  assert.match(onCustomerPaid, /attachPaidBagToCustomer\(c, bag/,
    'the carrier and its packed descendants attach to the durable customer root');

  const removeCustomer = clubhouseFunction('removeCustomer');
  const cleanupProducts = removeCustomer.indexOf('for (const product of c.checkoutHandoffProducts || [])');
  const disposeCarrier = removeCustomer.indexOf('disposePaidBagFromCustomer(c)');
  const detachProduct = removeCustomer.indexOf('product.removeFromParent()', cleanupProducts);
  const disposeProduct = removeCustomer.indexOf('c.checkoutHandoffProductDisposer(product)', cleanupProducts);
  const clearTransferredProducts = removeCustomer.indexOf('c.checkoutHandoffProducts = []', cleanupProducts);
  const removeCarrier = removeCustomer.indexOf('custGroup.remove(c.mesh)');
  assert.ok(
    disposeCarrier >= 0
      && cleanupProducts > disposeCarrier
      && detachProduct > cleanupProducts
      && disposeProduct > detachProduct
      && clearTransferredProducts > disposeProduct
      && removeCarrier > clearTransferredProducts,
    'paid carrier cleanup cannot be skipped by a later optional product cleanup failure',
  );
});

test('physical cleanup attempts every later substep after a failure', () => {
  const visited = [];
  const failures = runCheckoutCleanupSteps([
    { stage: 'first', run: () => { visited.push('first'); throw new Error('synthetic'); } },
    { stage: 'second', run: () => { visited.push('second'); } },
    { stage: 'third', run: () => { visited.push('third'); } },
  ]);
  assert.deepEqual(visited, ['first', 'second', 'third']);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].stage, 'first');
  assert.match(failures[0].error.message, /synthetic/);

  const clearPhysicalTransaction = registerFunction('clearPhysicalTransaction');
  assert.match(clearPhysicalTransaction, /itemResources\.dispose\(mesh, \{[\s\S]*onError:/,
    'owned item cleanup reports resource failures without skipping siblings');
  assert.match(clearPhysicalTransaction, /clearTenderHandful\(capture\)/);
  assert.match(clearPhysicalTransaction, /disposeCardMesh\(capture\)/);
  assert.match(clearPhysicalTransaction, /return \{ ok: failures\.length === 0, failures \}/);

  const clearCustomerItems = clubhouseFunction('clearCustomerItemMeshes');
  assert.match(clearCustomerItems, /for \(const mesh of c\.itemMeshes\.values\(\)\) \{[\s\S]*try \{[\s\S]*disposeCustomerProductMesh\(c, mesh\)/,
    'one hostile customer-product disposer cannot skip its siblings');
  assert.match(clearCustomerItems, /c\.itemMeshes\.clear\(\)/,
    'the customer resource authority is cleared after best-effort disposal');
  assert.match(clearCustomerItems, /return \{ ok: failures\.length === 0, failures \}/,
    'customer cleanup exposes diagnostics without aborting departure');
});

test('authoritative paid release falls through a throwing or refusing actor hook', () => {
  const failures = [];
  const attempt = (stage, operation) => {
    try { return { ok: true, value: operation() }; } catch (error) {
      failures.push({ stage, error });
      return { ok: false, error };
    }
  };
  let bridgeCalls = 0;
  const throwing = runPaidCustomerAuthoritativeRelease({
    actorRelease: () => { throw new Error('synthetic actor release failure'); },
    bridgeRelease: () => { bridgeCalls += 1; return true; },
    attempt,
  });
  assert.equal(throwing.ok, true);
  assert.equal(throwing.value, true);
  assert.equal(throwing.source, 'bridge');
  assert.equal(bridgeCalls, 1);
  assert.equal(failures[0].stage, 'paid-customer-authoritative-release');

  const refusing = runPaidCustomerAuthoritativeRelease({
    actorRelease: () => false,
    bridgeRelease: () => { bridgeCalls += 1; return true; },
    attempt,
  });
  assert.equal(refusing.ok, true);
  assert.equal(refusing.source, 'bridge');
  assert.equal(bridgeCalls, 2);
  assert.match(failures[1].error.message, /did not confirm release/);
});

test('authoritative paid release neither double-calls nor hides a failed bridge', () => {
  let bridgeCalls = 0;
  const actor = runPaidCustomerAuthoritativeRelease({
    actorRelease: () => true,
    bridgeRelease: () => { bridgeCalls += 1; return true; },
  });
  assert.equal(actor.source, 'actor');
  assert.equal(bridgeCalls, 0, 'a confirmed actor release remains exact-once');

  const failed = runPaidCustomerAuthoritativeRelease({
    actorRelease: () => false,
    bridgeRelease: () => false,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.source, null);
  assert.equal(failed.actor.ok, false);
  assert.equal(failed.bridge.ok, false);
});

test('per-bag ownership ledger excludes shared GLB geometry, brand material, and bump texture', () => {
  const buildBag = registerFunction('buildBag');
  assert.match(buildBag, /ownGeometry\(new THREE\.BoxGeometry\(0\.26/);
  assert.match(buildBag, /ownMaterial\(new THREE\.MeshStandardMaterial/);
  assert.match(buildBag, /ownGeometry\(new THREE\.PlaneGeometry/);
  assert.doesNotMatch(buildBag, /ownMaterial\(bagBrandMaterial\)/,
    'the shared dynamic brand material stays under register ownership');
  assert.doesNotMatch(buildBag, /ownGeometry\([^\n]*model/,
    'merchandise-cache geometry is never claimed by a paid bag');
  const style = registerFunction('applyKraftBagStyle');
  assert.match(style, /ownedResources\?\.ownMaterial\(styled\)/,
    'only per-bag material clones enter the departure ledger');
  assert.doesNotMatch(style, /ownMaterial\([^\n]*kraftWrinkleTexture/,
    'the shared wrinkle texture is not claimed by a paid bag');
});

test('cleanup failures enter the post-bank recovery record before it is constructed', () => {
  const finalize = registerFunction('finalizeTransaction');
  const cleanup = finalize.indexOf("const physicalCleanup = attempt('post-bank-physical-cleanup'");
  const capture = finalize.indexOf('for (const failure of physicalCleanup.value?.failures || [])');
  const recovery = finalize.indexOf('const recovery = postBankFailure ?');
  assert.ok(cleanup >= 0 && capture > cleanup && recovery > capture);
  assert.match(finalize, /recordPostBankFailure\([\s\S]*post-bank-physical-cleanup:\$\{failure\.stage\}/);
});

test('legacy fulfillment input and delivery paths contain no unresolved identifiers', () => {
  const rotateHeldProduct = registerFunction('rotateHeldProduct');
  assert.doesNotMatch(rotateHeldProduct, /\bbarcodeLocalPoint\s*\(/,
    'wheel input cannot call the removed barcode-local helper');
  const beginDelivery = registerFunction('beginBagDeliveryOrRelease');
  assert.doesNotMatch(beginDelivery, /\bbagDeliverFrom\b/,
    'bag delivery fallback must use a declared anchor or position');
});

test('selected physical coins expose a forgiving but invisible tray target', () => {
  const makeMoney = registerFunction('makeMoney');
  assert.match(makeMoney, /from === 'change' && !BILLS\.includes\(denom\)/);
  assert.match(makeMoney, /SelectedChangeCoinPickTarget/);
  assert.match(makeMoney, /selectedCoinPickGeometry/);
  assert.match(makeMoney, /selectedCoinPickMaterial/);
});

test('the final scan return timer cannot steal an already-started payment workspace', () => {
  const update = registerFunction('update');
  const timer = update.indexOf('if (scanReturnTimer > 0)');
  const paymentBoundary = update.indexOf('// Payment begins automatically', timer);
  assert.ok(timer >= 0 && paymentBoundary > timer,
    'the scan-return timer remains an explicit frame-loop checkpoint');

  const returnBlock = update.slice(timer, paymentBoundary);
  assert.match(returnBlock, /scanReturnTimer === 0\s*&&\s*workspace === 'scan'/,
    'only the scan camera can be returned by the stale animation timer');
  assert.match(returnBlock, /tx\?\.stage === 'scanning'/,
    'the transaction must still be pre-payment before the timer changes workspace');
  assert.match(returnBlock, /setWorkspace\('monitor'\)/,
    'the guarded timer still restores the normal monitor view after scanning');

  const choosePayment = registerFunction('choosePayment');
  const cashBranch = choosePayment.slice(choosePayment.indexOf('} else {'));
  const tender = cashBranch.indexOf('createTender()');
  const monitor = cashBranch.indexOf("setWorkspace('monitor')");
  assert.ok(tender >= 0 && monitor > tender,
    'cash presentation explicitly owns the monitor even when T beats the scan-return timer');
});
