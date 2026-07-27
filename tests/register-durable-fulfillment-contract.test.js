import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

function retryProjectionSource() {
  const retry = registerFunction('retryFulfillmentPresentation');
  const helperNames = [...retry.matchAll(
    /\b([A-Za-z_$][\w$]*(?:project|restore|reconcile|rebuild)[A-Za-z_$\d]*)\s*\(/gi,
  )].map((match) => match[1]);
  const helpers = [];
  for (const name of new Set(helperNames)) {
    if (registerSource.includes(`  function ${name}(`)) helpers.push(registerFunction(name));
  }
  return { retry, projection: [retry, ...helpers].join('\n') };
}

test('retail retry projects receipt and product presentation from durable transaction facts', () => {
  const { retry, projection } = retryProjectionSource();
  assert.match(retry, /transactionKind\s*===\s*'retail'/,
    'retail retry has a projection path distinct from receipt-only service automation');
  assert.match(projection, /tx\.receiptPacked/,
    'retry reads the durable receipt checkpoint before deciding where paper belongs');
  assert.match(projection, /for \(const item of tx\.items\)/,
    'retry reconciles every exact transaction UID');
  assert.match(projection, /item\.bagged/,
    'retry reads each durable item checkpoint instead of replaying every bag action');
  assert.match(
    projection,
    /tx\.receiptPacked[\s\S]*?(?:bagGroup\.add\(receiptMesh\)|(?:project|restore|reconcile|rebuild)\w*Receipt)/i,
    'a packed receipt is projected into the carrier rather than made pickable at the printer',
  );
  assert.match(
    projection,
    /item\.bagged[\s\S]*?(?:bagGroup\.add\([^)]*mesh|(?:project|restore|reconcile|rebuild)\w*(?:Item|Product))/i,
    'bagged item flags drive their rendered ownership or placement',
  );
  assert.doesNotMatch(projection, /\b(?:packReceipt|bagItem|handOverGoods)\s*\(/,
    'presentation retry cannot advance durable fulfillment verbs');
});

test('a durable done retry resumes handoff instead of resurrecting packed inputs', () => {
  const { projection } = retryProjectionSource();
  assert.match(
    projection,
    /tx\.stage\s*===\s*'done'[\s\S]*?(?:beginBagDeliveryOrRelease|deliveryPhase\s*=\s*'bag-deliver')/,
    'a domain-complete order resumes its physical delivery checkpoint',
  );
});

test('manual retry and watchdog recovery share the same durable retail projector', () => {
  const retry = registerFunction('retryFulfillmentPresentation');
  const watchdogResume = registerFunction('runCheckoutWatchdogPostResume');
  assert.match(
    retry,
    /transactionKind\s*===\s*'retail'[\s\S]*durableProjectRetailFulfillment\(\)/,
    'the player retry cannot drift into a second reconstruction algorithm',
  );
  assert.match(
    watchdogResume,
    /resumeState\s*===\s*'Bagging'[\s\S]*transactionKind\s*===\s*'retail'[\s\S]*durableProjectRetailFulfillment\(\)/,
    'timed-out retail bagging uses the same durable presentation projection',
  );

  const projector = registerFunction('durableProjectRetailFulfillment');
  const clearDropMotions = projector.indexOf('bagDropMotions.length = 0');
  const clearDrag = projector.indexOf('scanDrag = null');
  const clearScanMotion = projector.indexOf('scanMotion = null');
  const rebuild = projector.indexOf('resetBagAtCounter()');
  assert.ok(
    clearDropMotions >= 0
      && clearDrag > clearDropMotions
      && clearScanMotion > clearDrag
      && rebuild > clearScanMotion,
    'projection releases every transient mesh owner before rebuilding from durable facts',
  );
});

test('durable projection clears stale customer handoff owners before rebuilding visuals', () => {
  const projector = registerFunction('durableProjectRetailFulfillment');
  const clearBag = projector.indexOf('cust.checkoutHandoffBag = null');
  const clearReceipt = projector.indexOf('cust.handoffReceipt = null');
  const clearProducts = projector.indexOf('cust.checkoutHandoffProducts = []');
  const clearDisposer = projector.indexOf('cust.checkoutHandoffProductDisposer = null');
  const clearOversize = projector.indexOf('cust.checkoutHandoffOversizeProducts = []');
  const rebuildReceipt = projector.indexOf('ensureReceiptMesh(');
  const rebuildItems = projector.indexOf('for (const item of tx.items)');

  for (const [label, at] of [
    ['bag pointer', clearBag],
    ['receipt pointer', clearReceipt],
    ['product pointer list', clearProducts],
    ['product disposer', clearDisposer],
    ['oversize pointer list', clearOversize],
  ]) {
    assert.ok(at >= 0 && at < rebuildReceipt && at < rebuildItems,
      `${label} is released before durable presentation is reconstructed`);
  }
});

test('packing a receipt after retry unlocks every scanned unbagged product', () => {
  const settleReceipt = registerFunction('settleReceiptDrag');
  const packReceiptAt = settleReceipt.indexOf('packReceipt(tx)');
  assert.ok(packReceiptAt >= 0, 'receipt contact commits the durable packed checkpoint');

  const afterPack = settleReceipt.slice(packReceiptAt);
  assert.match(afterPack, /for \(const item of tx\.items\)/,
    'successful receipt packing refreshes the transaction products');
  assert.match(afterPack, /itemMeshes\.get\(item\.uid\)/,
    'pickability is restored on each exact transaction mesh');
  assert.match(afterPack, /item\.scanned[\s\S]*?!item\.bagged/,
    'only scanned products that still need fulfillment are unlocked');
  assert.match(afterPack, /setObjectPickable\([^,]+,\s*true\)/,
    'retry-projected goods become draggable without another retry');
});

test('cash confirmation cannot strand GivingChange ahead of a refused domain commit', () => {
  const confirm = registerFunction('confirmChange');
  const transitionMatch = /flowTo\(\s*'GivingChange'/.exec(confirm);
  const preflightMatch = /const\s+(\w+)\s*=\s*transitionCheckout\(\s*tx\.checkoutFlow,\s*'GivingChange'/.exec(confirm);
  const domainCommit = confirm.indexOf('handOverChange(tx, drawer)');
  assert.ok((transitionMatch || preflightMatch) && domainCommit >= 0,
    'cash confirmation has both commit boundaries');

  const presentation = confirm.indexOf('beginChangeHandoff(');
  if (preflightMatch) {
    const preflight = preflightMatch.index;
    const preflightResult = preflightMatch[1];
    const rejectsInvalidFlow = new RegExp(`if \\(!${preflightResult}\\.ok\\) return false`).exec(confirm);
    const flowCommit = confirm.indexOf(`syncFlow(${preflightResult}.flow)`, domainCommit);
    assert.ok(
      preflight < domainCommit
        && rejectsInvalidFlow
        && rejectsInvalidFlow.index > preflight
        && rejectsInvalidFlow.index < domainCommit
        && flowCommit > domainCommit,
      'preflight the immutable flow, commit the domain, then synchronize the prepared flow',
    );
    assert.ok(presentation > flowCommit,
      'cash and drawer visuals start only after the prepared flow is committed');
    return;
  }

  const transition = transitionMatch.index;
  const domainFirst = domainCommit < transition;
  const beforeTransition = confirm.slice(0, transition);
  const flowSnapshot = /const\s+(\w+)\s*=\s*tx\.checkoutFlow\s*;/.exec(beforeTransition);
  const refusal = confirm.slice(confirm.indexOf('if (!handed.ok)', domainCommit));
  const rollsBackFlow = !!flowSnapshot
    && new RegExp(`syncFlow\\(${flowSnapshot[1]}\\)`).test(refusal);

  assert.ok(
    domainFirst || rollsBackFlow,
    'commit the domain before GivingChange, or restore the exact prior flow when the domain refuses',
  );

  assert.ok(presentation > transition && presentation > domainCommit,
    'cash and drawer visuals start only after both durable and flow commits succeed');
});

test('separate-handoff products never enter the compact bag-drop scale path', () => {
  const settle = registerFunction('settleBaggingProduct');
  const classification = settle.indexOf('catalogVisual?.separateHandoff');
  const separateBranch = settle.indexOf('if (separateHandoff)', classification);
  const compactDrop = settle.indexOf('bagDropMotions.push(');
  assert.ok(classification >= 0 && separateBranch > classification && compactDrop > separateBranch,
    'bagging classifies oversize goods and handles them before the compact drop queue');

  const oversizePath = settle.slice(separateBranch, compactDrop);
  assert.match(oversizePath, /scale\.copy\((?:drag\.fromScale|[^)]*originalScale)/,
    'separate goods retain their authored checkout scale');
  assert.match(oversizePath, /return true\s*;/,
    'separate goods leave the function before compact bag-drop motion is queued');
  assert.doesNotMatch(oversizePath, /multiplyScalar\(0\.38\)|bagGroup\.add\(/,
    'separate goods are neither miniaturized nor parented into the paper carrier');

  const compactMotion = registerFunction('updateBagDropMotions');
  assert.match(compactMotion, /multiplyScalar\(0\.38\)/,
    'the compact visual treatment remains explicit and isolated');
});

test('separate-handoff products require customer-side contact before their durable commit', () => {
  const settle = registerFunction('settleBaggingProduct');
  const classification = settle.indexOf('catalogVisual?.separateHandoff');
  const targetMeasurement = settle.search(/(?:distanceToTarget|\.distanceTo\(fulfillmentTarget\))/);
  const domainCommit = settle.indexOf('bagItem(tx, drag.uid)');
  assert.ok(classification >= 0 && targetMeasurement > classification,
    'oversize goods are classified before choosing a physical drop target');
  assert.ok(domainCommit > classification,
    'the durable bagged checkpoint follows separate-handoff classification');

  const beforeCommit = settle.slice(classification, domainCommit);
  assert.match(
    beforeCommit,
    /separateHandoff[\s\S]*?(?:customerGripPoint|customerAnchor|oversize(?:Handoff|Drop|Contact|Target|Point))/i,
    'separate goods use a customer-side handoff target rather than the paper bag mouth',
  );
  assert.match(beforeCommit, /(?:distanceTo|\.distanceTo\()[\s\S]*?(?:if \(!?\w+\)|accepted)/,
    'customer-side contact is validated before the durable item commit');

  const transfer = registerFunction('transferBagOwnershipToCustomer');
  const separatePath = settle.slice(settle.indexOf('if (separateHandoff)', domainCommit));
  assert.match(separatePath, /cust(?:\?\.?)?\.mesh\.(?:add|attach)\(drag\.mesh\)/,
    'accepted separate goods immediately reparent the exact mesh to the customer');
  assert.match(transfer, /product\.userData\.checkoutOwner\s*=\s*'customer'/,
    'physical ownership is committed before banking');
  assert.match(transfer, /checkoutHandoffOversizeProducts\s*=\s*oversizeProducts/,
    'the customer retains exact oversize mesh identities across the banking boundary');

  const delivery = registerFunction('updateDelivery');
  const physicalTransfer = delivery.indexOf('transferBagOwnershipToCustomer()');
  const released = delivery.indexOf("deliveryPhase = 'released'", physicalTransfer);
  assert.ok(physicalTransfer >= 0 && released > physicalTransfer,
    'exact-mesh ownership crosses to the customer before release and downstream banking');
});

test('paid oversize carry prefers the exact handed meshes instead of cloning transaction lines', () => {
  const transfer = registerFunction('transferBagOwnershipToCustomer');
  assert.match(transfer, /catalogVisual\?\.separateHandoff/,
    'ownership transfer distinguishes separate goods from bag descendants');
  assert.match(transfer, /checkoutHandoffOversizeProducts/,
    'the exact separately fulfilled meshes cross the banking boundary by UID');

  const attachOversize = clubhouseFunction('attachOversizePurchaseVisuals');
  const handedMeshes = attachOversize.indexOf('checkoutHandoffOversizeProducts');
  const fallbackBuild = attachOversize.indexOf('buildCatalogProductProxy(');
  assert.ok(handedMeshes >= 0 && (fallbackBuild < 0 || handedMeshes < fallbackBuild),
    'customer carry consumes handed meshes before any legacy reconstruction fallback');
  assert.doesNotMatch(attachOversize, /multiplyScalar\(0\.38\)/,
    'customer oversize carry never inherits compact-bag scale');
});

test('a failed done-stage delivery remains retryable', () => {
  const projector = registerFunction('durableProjectRetailFulfillment');
  const doneAt = projector.indexOf("tx.stage === 'done'");
  assert.ok(doneAt >= 0, 'durable done projection has an explicit delivery branch');
  const doneBranch = projector.slice(doneAt);
  const deliveryResult = /const\s+(\w+)\s*=\s*beginBagDeliveryOrRelease\(\)\s*;/.exec(doneBranch);
  assert.ok(deliveryResult,
    'done projection records whether the physical delivery actually started');

  const resultName = deliveryResult[1];
  const afterDelivery = doneBranch.slice(deliveryResult.index);
  const mirrorsResult = new RegExp(`autoFulfilled\\s*=\\s*${resultName}\\s*;`).test(afterDelivery);
  const handlesFailure = new RegExp(
    `if \\(!${resultName}\\)[\\s\\S]*?autoFulfilled\\s*=\\s*false[\\s\\S]*?return false`,
  ).test(afterDelivery);
  const enablesAfterSuccess = new RegExp(
    `if \\(!${resultName}\\)[\\s\\S]*?return false[\\s\\S]*?autoFulfilled\\s*=\\s*true`,
  ).test(afterDelivery);
  assert.ok(mirrorsResult || (handlesFailure && enablesAfterSuccess),
    'retry suppression mirrors delivery success and stays false when the transition refuses');
});

test('released durable handoff cannot be stranded by a transient fulfillment flag', () => {
  const update = registerFunction('update');
  const start = update.indexOf("if (tx && tx.stage === 'done'");
  const end = update.indexOf("if (tx && tx.stage === 'card-busy'", start);
  assert.ok(start >= 0 && end > start, 'the frame loop has a bounded finalization gate');
  const gate = update.slice(start, end);

  assert.match(gate, /tx\.stage === 'done'/,
    'only a domain-complete transaction can bank');
  assert.match(gate, /deliveryPhase === 'released'/,
    'the physical carrier must have reached the customer');
  assert.match(gate, /checkoutFlowState\(\) === 'CustomerLeaving'/,
    'the visible state machine must confirm the handoff');
  assert.doesNotMatch(gate, /autoFulfilled/,
    'a transient presentation cache cannot veto three durable completion facts');
  assert.doesNotMatch(gate, /finalizeTimer > 0/,
    'a lost one-shot timer cannot permanently suppress an otherwise complete sale');
  assert.match(gate, /finalizeTimer = Math\.max\(0, finalizeTimer - animationDt\)/,
    'the visible acceptance delay is still honored when its timer is available');
  assert.match(gate, /!finalizeTransaction\(\)\) finalizeTimer = 0\.6/,
    'a rejected atomic bank remains retryable');

  const recovery = registerFunction('runCheckoutWatchdogPostResume');
  const customerLeaving = recovery.slice(recovery.indexOf("resumeState === 'CustomerLeaving'"));
  assert.match(customerLeaving,
    /tx\.stage === 'done' && deliveryPhase === 'released'[\s\S]*?finalizeTimer = 0\.2/,
    'watchdog recovery re-arms finalization from durable release facts');
  assert.doesNotMatch(customerLeaving.split('return true;')[0], /&& autoFulfilled/,
    'recovery cannot depend on a transient flag that it is responsible for rebuilding');
});

test('the rendered register keys retail sales from persisted ticket identity', () => {
  const begin = registerFunction('begin');
  const numberAt = begin.indexOf('const transactionNumber =');
  const identityAt = begin.indexOf('id: retailTransactionId(state, transactionNumber)');
  const assignAt = begin.indexOf('tx.number = transactionNumber');
  assert.ok(numberAt >= 0 && identityAt > numberAt && assignAt > identityAt,
    'the ledger id and ticket number come from one persisted monotonic sequence');
  assert.doesNotMatch(begin, /createTx\(\{\s*items,/,
    'rendered checkout cannot fall back to the module-local transient counter');
});
