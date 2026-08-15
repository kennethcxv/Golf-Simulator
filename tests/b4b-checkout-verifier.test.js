import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const verifier = fs.readFileSync(
  new URL('../tools/qa/electron-b-checkout-unsticks.js', import.meta.url),
  'utf8',
);
const clubhouse = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);
const registerMode = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

function extractedVerifierConst(name, nextName) {
  const start = verifier.indexOf(`const ${name} =`);
  const end = verifier.indexOf(`\n  const ${nextName} =`, start);
  assert.ok(start >= 0 && end > start, `could not isolate ${name}`);
  const declaration = verifier.slice(start, end);
  return Function(`${declaration}; return ${name};`)();
}

function durableAccountingArtifact() {
  const identity = {
    transactionId: 'retail:test:1',
    referenceId: 'reservation:1:check-in',
    customerId: 'customer-1',
    reservationId: 1,
    visitDayAbs: 0,
    expectedGoods: [
      { uid: 'goods-1', skuId: 'balls1', priceCents: 1500 },
      { uid: 'goods-2', skuId: 'glove1', priceCents: 1900 },
    ],
    expectedGoodsNetCents: 3400,
    expectedServiceTotalCents: 3200,
    expectedTaxRate: 0.07,
    expectedTaxCents: 238,
    expectedTotalCents: 6838,
    expectedGoodsCostCents: 1600,
    shopSalesBeforeCents: 0,
    greenFeesBeforeCents: 0,
    salesTaxBefore: {
      collectedCents: 0,
      owedCents: 0,
      taxableSalesCents: 0,
    },
  };
  const visitId = 'checkout:retail:test:1:customer-visit';
  const visitSignature = JSON.stringify([
    'customer-1', 0, 'tee-time+retail', ['purchase', 'check-in'],
    true, 'card', 68.38, '1',
  ]);
  const entries = [
    {
      id: 'entry-cogs',
      idempotencyKey: 'checkout:retail:test:1:cogs',
      amountCents: 1600,
      units: 2,
      cashImpactCents: 0,
      profitImpactCents: -1600,
      metadata: [['skuIds', ['balls1', 'glove1']]],
    },
    {
      id: 'entry-sale',
      idempotencyKey: 'checkout:retail:test:1:sale',
      amountCents: 3400,
      units: 2,
      cashImpactCents: 3400,
      profitImpactCents: 3400,
      metadata: [
        ['tax', 2.38], ['taxRate', 0.07], ['ticketTotal', 68.38],
      ],
    },
    {
      id: 'entry-tax',
      idempotencyKey: 'checkout:retail:test:1:salestax',
      amountCents: 238,
      cashImpactCents: 238,
      profitImpactCents: 0,
      metadata: [['taxRate', 0.07], ['ticketTotal', 68.38]],
    },
    {
      id: 'entry-service',
      idempotencyKey: 'service:reservation-check-in:reservation:1:check-in:revenue',
      amountCents: 3200,
      cashImpactCents: 3200,
      profitImpactCents: 3200,
      metadata: [['method', 'card']],
    },
  ];
  const outcome = {
    id: 'outcome-1',
    idempotencyKey: 'checkout:retail:test:1:completed',
    amountCents: 6838,
  };
  return {
    identity,
    digest: {
      history: {
        ticket: {
          transactionId: 'retail:test:1',
          netCents: 3400,
          taxCents: 238,
          taxRate: 0.07,
          serviceTotalCents: 3200,
          totalCents: 6838,
          items: [
            { uid: 'goods-1', skuId: 'balls1', priceCents: 1500 },
            { uid: 'goods-2', skuId: 'glove1', priceCents: 1900 },
            { uid: 'service-1', skuId: 'service:green-fee', priceCents: 3200 },
          ],
          customerVisitEvent: {
            schemaVersion: 1,
            id: visitId,
            customerId: 'customer-1',
            dayAbs: 0,
            purpose: 'tee-time+retail',
            outcomes: ['purchase', 'check-in'],
            countsAsVisit: true,
            paymentMethod: 'card',
            amountCents: 6838,
            reservationId: '1',
            status: 'applied',
            failureReason: null,
          },
        },
      },
      books: {
        entries,
        processedEntries: entries.map((entry) => [entry.idempotencyKey, entry.id]),
        outcomes: [outcome],
        processedOutcomes: [[outcome.idempotencyKey, outcome.id]],
        todayRevenue: [['greenFees', 3200], ['shopSales', 3400]],
        // COGS is an immutable profit-impact entry with aggregate:null; it is
        // deliberately absent from the cash-expense aggregate.
        todayExpense: [],
      },
      salesTax: {
        collectedCents: 238,
        owedCents: 238,
        taxableSalesCents: 3400,
      },
      customer: {
        visitHistory: { appliedEvents: [{ id: visitId, signature: visitSignature }] },
      },
    },
  };
}

test('durable accounting oracle rejects artifact-shaped accounting corruption', () => {
  const oracle = extractedVerifierConst(
    'exactCheckoutDurableAccounting',
    'validCheckoutSaveDigest',
  );
  const { digest, identity } = durableAccountingArtifact();
  assert.equal(new Map(digest.books.todayExpense).has('costOfGoods'), false,
    'production keeps non-cash COGS out of the cash-expense aggregate');
  assert.equal(oracle(digest, identity), true,
    'the exact production-shaped valid artifact passes');

  const wrongTicketIdentity = structuredClone(digest);
  wrongTicketIdentity.history.ticket.transactionId = 'retail:test:999';
  assert.equal(oracle(wrongTicketIdentity, identity), false,
    'the durable ticket must carry the ledger idempotency transaction identity');

  const duplicateLedgerKey = structuredClone(digest);
  duplicateLedgerKey.books.entries[3].idempotencyKey =
    duplicateLedgerKey.books.entries[2].idempotencyKey;
  assert.equal(oracle(duplicateLedgerKey, identity), false,
    'a duplicate ledger key cannot be hidden by Map collapse');

  const duplicateProcessedKey = structuredClone(digest);
  duplicateProcessedKey.books.processedEntries[3][0] =
    duplicateProcessedKey.books.processedEntries[2][0];
  assert.equal(oracle(duplicateProcessedKey, identity), false,
    'a duplicate processed key cannot replace the expected mapping');

  const wrongCogs = structuredClone(digest);
  wrongCogs.books.entries[0].amountCents = 1;
  assert.equal(oracle(wrongCogs, identity), false,
    'persisted COGS must equal catalog cost independently of internal consistency');

  const wrongTaxRate = structuredClone(digest);
  wrongTaxRate.history.ticket.taxRate = 0.42;
  assert.equal(oracle(wrongTaxRate, identity), false,
    'the ticket tax rate must equal the captured production rate');

  const wrongTax = structuredClone(digest);
  wrongTax.history.ticket.taxCents = 239;
  assert.equal(oracle(wrongTax, identity), false,
    'tax cents must equal both the captured value and the rate equation');

  const wrongEquation = structuredClone(digest);
  wrongEquation.history.ticket.totalCents += 1;
  assert.equal(oracle(wrongEquation, identity), false,
    'ticket totals must satisfy the independent accounting equation');

  const wrongVisitSignature = structuredClone(digest);
  wrongVisitSignature.customer.visitHistory.appliedEvents[0].signature = 'bogus';
  assert.equal(oracle(wrongVisitSignature, identity), false,
    'the applied visit signature must be canonically derived from the sale');
  assert.match(verifier, /expectedTaxRate = salesTax\.salesTaxRate\(app\.state\)/,
    'expected tax rate comes from the property jurisdiction, not the ticket under test');
});

test('cash variance oracle requires explicit finite zero fields', () => {
  const oracle = extractedVerifierConst(
    'cashVarianceFieldsAreExplicitAndZero',
    'cashCompletedCorrectly',
  );
  assert.equal(oracle({ books: { lost: 0, extraChange: 0 } }), true);
  assert.equal(oracle({ books: { extraChange: 0 } }), false,
    'a missing lost field cannot coerce to zero');
  assert.equal(oracle({ books: { lost: 0 } }), false,
    'a missing extra-change field cannot coerce to zero');
  assert.equal(oracle({ books: { lost: Number.NaN, extraChange: 0 } }), false);
  assert.equal(oracle({ books: { lost: 0, extraChange: 0.01 } }), false);
});

test('load repair notice classifier detects deserialize and schema repair notices', () => {
  const isRepairNotice = extractedVerifierConst(
    'isDeserializeOrSchemaRepairNotice',
    'manualCheckoutSaveLoad',
  );
  assert.equal(isRepairNotice('Slot 1 repaired 2 invalid save field(s).'), true);
  assert.equal(isRepairNotice('Slot 1 migrated 1 save schema step(s).'), true);
  assert.equal(isRepairNotice('Game loaded from Slot 1.'), false);
});

test('visual fallback notices and HTTP errors are hard acceptance failures', () => {
  const isVisualFallbackNotice = extractedVerifierConst(
    'isVisualFallbackNotice',
    'manualCheckoutSaveLoad',
  );
  assert.equal(isVisualFallbackNotice('Some sheet06 used safe fallback visuals.'), true);
  assert.equal(isVisualFallbackNotice('Game loaded from Slot 1.'), false);
  assert.match(verifier, /page\.on\('response'[\s\S]*response\.status\(\) < 400[\s\S]*out\.httpErrors\.push/,
    'HTTP 4xx/5xx responses are captured independently of transport failures');
  assert.match(verifier, /noHttpErrors:\s*out\.httpErrors\.length === 0/,
    'captured HTTP errors fail the final acceptance result');
});

test('paid bag resource oracle uses per-run disposal deltas', () => {
  const oracle = extractedVerifierConst(
    'paidBagResourcesReleasedForRun',
    'cashVarianceFieldsAreExplicitAndZero',
  );
  const run = {
    saleIdentity: {
      paidBagResourcesBefore: {
        transferredBags: 4,
        successfullyDisposedBags: 4,
        failedDisposals: 0,
        ownedGeometriesTransferred: 8,
        ownedMaterialsTransferred: 6,
        ownedGeometriesDisposed: 8,
        ownedMaterialsDisposed: 6,
        livePaidBags: 0,
      },
    },
    afterVisit: {
      paidBagResources: {
        transferredBags: 5,
        successfullyDisposedBags: 5,
        failedDisposals: 0,
        ownedGeometriesTransferred: 11,
        ownedMaterialsTransferred: 8,
        ownedGeometriesDisposed: 11,
        ownedMaterialsDisposed: 8,
        livePaidBags: 0,
      },
    },
  };
  assert.equal(oracle(run), true, 'one run transfers and fully disposes one paid bag');

  const leaked = structuredClone(run);
  leaked.afterVisit.paidBagResources.livePaidBags = 1;
  assert.equal(oracle(leaked), false);

  const failed = structuredClone(run);
  failed.afterVisit.paidBagResources.failedDisposals = 1;
  assert.equal(oracle(failed), false);

  const mismatchedResources = structuredClone(run);
  mismatchedResources.afterVisit.paidBagResources.ownedGeometriesDisposed -= 1;
  assert.equal(oracle(mismatchedResources), false);
});

test('B4b matches the prepended sale by captured transaction and customer identity', () => {
  assert.match(verifier, /number:\s*tx\?\.number/,
    'the verifier captures the active ticket before it banks');
  assert.match(verifier, /exactRows\.length - identity\.matchingRowsBefore/,
    'the exact transaction count remains valid when capped history evicts an old row');
  assert.match(verifier, /Number\(row\.number\) === Number\(identity\.number\)/);
  assert.match(verifier, /row\.customerId[\s\S]*identity\.customerId/);
  assert.doesNotMatch(verifier, /rows\.length - identity\.historyBefore/,
    'a capped history length delta cannot be used as the banking oracle');
  assert.doesNotMatch(verifier, /rows\[before\]/,
    'the old index selected the prior accepted visit during the refusal run');
});

test('banked merchandise ownership is checked before and after departure', () => {
  assert.match(verifier, /customerCartLength: c\?\.cart\?\.length/,
    'the live identity-matched actor cart must be empty immediately after banking');
  assert.match(verifier, /everyBankedSaleTransfersGoodsWithoutRestocking/);
  assert.match(verifier, /heldGoodsBeforeBank\?\.length === 2[\s\S]*books\?\.heldGoods\?\.length === 0[\s\S]*afterVisit\?\.heldGoods\?\.length === 0/,
    'sold held-unit ownership must be consumed and remain consumed after departure');
  assert.match(verifier, /books\?\.inventoryMatchesPreBank === true[\s\S]*afterVisit\?\.inventoryMatchesPreBank === true/,
    'departure must not return sold shelf or back inventory');
  assert.match(verifier, /ch\.customers\(\)\.find\(\(customer\)[\s\S]*customer\.customerId/,
    'the post-bank actor is resolved by stable customer identity, not display name');
});

test('B4b hotspot comparison surrounds one real selection click', () => {
  const before = verifier.indexOf('const hotspotsBeforeSelect =');
  const click = verifier.indexOf('run.trail.push(await clickDesk(selectionAction))');
  const after = verifier.indexOf('const hotspotsAfterSelect =');
  assert.ok(before >= 0 && before < click && click < after,
    'the baseline precedes the player click and the result follows it');
  assert.doesNotMatch(verifier, /deskAction\?\s*\(|\.deskAction\(`/,
    'the probe must not dispatch the selection a second time');
});

test('B4 acceptance gates visible click consequences and the real checkout presentation', () => {
  assert.match(verifier, /if \(!pt\.inView\) return/,
    'an off-camera hotspot is not a successful player click');
  assert.match(verifier, /run\.selectionApplied = await page\.waitForFunction/,
    'row selection waits for newly drawn enabled controls');
  assert.match(verifier, /const errandCleared = await page\.waitForFunction/,
    'the answer waits for its domain consequence');
  assert.match(verifier, /run\.answerTabPixels = await page\.evaluate/,
    'the answer samples the newly-painted canvas exactly once');
  assert.match(verifier, /run\.answerApplied = errandCleared[\s\S]*answerTabPixels\.checkout/,
    'the answer requires both the domain and visible screen consequence');
  assert.match(verifier, /debugMonitorTabPixels/,
    'the driver samples the real canvas rather than trusting an activeTab string');
  assert.match(clubhouse,
    /debugMonitorTabPixels:\s*\(\)\s*=>\s*register\.debugMonitorTabPixels\(\)/,
    'the narrow clubhouse register facade exposes the real canvas sampler');
  const samplerAt = registerMode.indexOf('debugMonitorTabPixels: () => {');
  const sampler = registerMode.slice(samplerAt, samplerAt + 900);
  assert.equal((sampler.match(/getImageData\(/g) || []).length, 1,
    'the real canvas is read once so the probe cannot stall the payment animation');
  assert.match(verifier, /cameraPositionDelta[\s\S]*<= 0\.05/,
    'the authored checkout pose is an acceptance gate');
  assert.match(verifier, /returnPresentation\?\.card\?\.inView === true/,
    'the offered card must actually be in the player camera');
  assert.match(verifier, /Number\.isFinite\(run\.returnPresentation\?\.cameraPositionDelta\)/,
    'a missing solved camera cannot coerce to a passing zero');
  assert.match(verifier, /yawDelta[\s\S]*pitchDelta[\s\S]*rollMagnitude/,
    'the return gates the authored camera orientation as well as position');
  assert.match(verifier, /returnHoverAffordance\?\.cursor === 'pointer'/,
    'hovering the physical tender must restore the player-facing pointer affordance');
  assert.match(verifier, /returnHoverAffordance\?\.physical\?\.kind === 'payment-card'[\s\S]*kind === 'money'[\s\S]*from === 'tender'/,
    'the pointer proof must land on the shipping card or tender pick target');
  assert.match(verifier, /returnCameraStable === true/,
    'the neutral shipping camera must settle before its return pose is measured');
  const stageWaitAt = verifier.indexOf('run.returnTenderStageReached = await page.waitForFunction');
  const targetReadAt = verifier.indexOf('run.returnHoverTarget = await page.evaluate');
  assert.ok(stageWaitAt >= 0 && stageWaitAt < targetReadAt,
    'the driver waits on the cheap stage predicate before projecting the physical target once');
  assert.match(verifier, /returnPresentation\?\.pointerLocked === false/,
    'register input ownership is checked at the return boundary');
  assert.match(verifier, /returned-to-checkout\.png`\),[\s\S]{0,80}scale: 'css'/,
    'visual evidence is captured at CSS resolution without a high-DPR renderer stall');
});

test('isolated accepted and refused processes require the exact new sale row', () => {
  assert.match(verifier, /GOAL24_CHECKOUT_CASE/);
  assert.match(verifier, /requestedCase === 'book'/);
  assert.match(verifier, /requestedCase === 'refuse'/);
  assert.match(verifier, /books\?\.rowsAdded === 1/,
    'a pre-existing or duplicated history row cannot make the visit green');
  assert.match(verifier, /serviceLineCount === 1/,
    'accepted return shows one fee on the open ticket');
  assert.match(verifier, /serviceLineCount === 0/,
    'refused return shows a goods-only open ticket');
});

test('cash acceptance can aim at the real drawer denomination hotspots', () => {
  assert.match(registerMode,
    /drawerSlotScreenPoint = \(denom\)[\s\S]*visiblePieces[\s\S]*meshScreenPoint\(target\)/,
    'the QA point projects the visible drawer piece with the production hotspot as fallback');
  assert.match(clubhouse,
    /drawerSlotScreenPoint:\s*\(denom\)\s*=>\s*register\.drawerSlotScreenPoint\(denom\)/,
    'the narrow clubhouse facade forwards the drawer hotspot projection');
  assert.match(verifier, /const drawerTarget = \(denom\)[\s\S]*debugPickAt/,
    'each denomination resolves through the real production raycaster');
  assert.match(verifier, /for \(let count = 0; count < slot\.count; count \+= 1\)[\s\S]*await drawerTarget\(slot\.denom\)/,
    'the target is re-projected for every physical piece');
  assert.match(verifier, /changedExactly/,
    'a click must add the exact denomination, not merely increase the hand');
  assert.match(verifier, /beforeConfirm\?\.giving\?\.state === 'exact'/);
  assert.match(verifier, /persistentDrawerStillBaseline/);
  assert.match(verifier, /expectedCommittedDrawer/);
  assert.doesNotMatch(verifier, /selectChangeFromSlot\s*\(/,
    'the verifier must not call the cash sim action directly');
});

test('adjusted, existing, card, and cash routes are dispatched and scenario-gated', () => {
  assert.match(verifier, /requestedCase === 'adjusted'[\s\S]*playVisit\('adjusted'/);
  assert.match(verifier, /requestedCase === 'existing'[\s\S]*playVisit\('existing'/);
  assert.match(verifier, /adjustedSlotIsDifferentAndCarriesOneGreenFee/);
  assert.match(verifier, /existingBookingCarriesOneGreenFeeAndIsPlayed/);
  assert.match(verifier, /Make this shopper the booking owner before the browser yields a frame[\s\S]*bookReservation[\s\S]*c\.reservationId = reservationId/,
    'the existing-booking fixture must not leave a frame where arrivals can spawn a duplicate character');
  assert.match(verifier, /sameReservationCharacterCount === 1[\s\S]*sameIdentityCharacterCount === 1/,
    'the existing-booking route must prove one presentation character owns the reservation and identity');
  assert.match(verifier, /run\.method === 'card'[\s\S]*returnPresentation\?\.card[\s\S]*returnPresentation\?\.cash/);
  assert.match(verifier, /everyCashVisitUsesExactPhysicalChangeAndBalancesTheDrawer/);
});

test('cold-process checkout acceptance requires every payment GPU representative', () => {
  assert.match(verifier, /paymentGpuPrewarmDrewAndReleasedEveryTender/);
  assert.match(verifier,
    /expected === 12[\s\S]*built === 12[\s\S]*drawn === 12[\s\S]*released === true/,
    'all cash models and the exact payment card must draw behind the veil before release');
  assert.match(verifier,
    /expectedDrawUnits\) > 12[\s\S]*observedDrawUnits\)[\s\S]*expectedDrawUnits\)[\s\S]*observedStems\.length === 12/,
    'the verifier must count every submitted mesh draw, not only representative roots');
  assert.match(verifier, /exactVariantStems\.length === 12/,
    'all observed representatives must use the exact live material variants');
  assert.match(verifier,
    /expectedCardVariants === 6[\s\S]*observedCardVariants === 6[\s\S]*cachedCardVariants === 6/,
    'all six customer-specific CanvasTextures must be cached and observed behind the veil');
  assert.match(verifier,
    /observedCardVariantIds[\s\S]*expectedCardVariantIds/,
    'six arbitrary card draws cannot satisfy the exact customer-card set gate');
  assert.match(verifier, /aborted === false[\s\S]*releasedCount === 12[\s\S]*representatives === 0/,
    'the prewarm cannot abort or remain resident after its one real draw');
});

test('B checkout adversarial modes inject and prove every recovered post-bank boundary fault', () => {
  assert.match(verifier, /GOAL24_CHECKOUT_FAULT/);
  assert.match(verifier, /requestedCase !== 'book' \|\| requestedMethod !== 'card'/,
    'fault acceptance is isolated to one deterministic combined card sale');
  assert.doesNotMatch(verifier, /\.onPaid\s*=/,
    'the driver must not replace the actor callback from outside production ownership');
  const identityAt = verifier.indexOf('run.saleIdentity = await page.evaluate');
  const armAt = verifier.indexOf('register[fault.armMethod]', identityAt);
  const paymentAt = verifier.indexOf("if (method === 'cash')", armAt);
  assert.ok(identityAt >= 0 && armAt > identityAt && paymentAt > armAt,
    'the one-shot is armed against the captured identity before real payment controls begin');
  assert.match(verifier, /postBankPresentationFailureRecoversWithoutDuplication/);
  assert.match(verifier, /postBankReleaseFailureRecoversWithoutDuplication/);
  assert.match(verifier, /bankHelperPartialCommitRecoversWithoutDuplication/);
  assert.match(verifier, /failuresAdded\?\.length === 1[\s\S]*expectedPostBankFault\.stage/);
  assert.match(verifier, /registerTxReleased === true[\s\S]*registerCustomerReleased === true[\s\S]*queueHasCustomer === false/);
  assert.match(verifier,
    /recoverySnapshots\?\.length === 1[\s\S]*salvageSucceeded === true[\s\S]*authoritativeReleaseSucceeded === true/,
    'the acceptance gate reads the synchronous recovery boundary, not a departed-actor shortcut');
  const immediateAt = verifier.indexOf('run.postBankFault.immediate = await page.evaluate');
  const immediate = verifier.slice(immediateAt, immediateAt + 5000);
  assert.match(immediate,
    /const recoveries = register\.checkoutWatchdogDiagnostics\?\.\(\)\.postBankRecoveries \|\| \[\][\s\S]*matchingRecoveries = recoveries\.filter/,
    'the isolated browser closure must read its own recovery diagnostics before filtering them');
  assert.match(verifier,
    /customerBagDescendsFromCustomer === true[\s\S]*customerBagOwner === 'customer'/,
    'live bag salvage uses descendant ancestry plus customer ownership');
  assert.match(verifier,
    /customerBagOwnerBeforeCleanup === 'customer'[\s\S]*customerOwnedUnderRegisterBeforeCleanup\?\.length === 0/,
    'the immutable recovery snapshot preserves pre-teardown ownership evidence');
  assert.doesNotMatch(verifier, /bagMesh\.parent === c\.mesh/,
    'nested paid-bag assemblies cannot be rejected by a direct-parent-only check');
  assert.doesNotMatch(verifier,
    /customerAlreadyGone === true \|\|/,
    'actor departure is not accepted as evidence that synchronous bag salvage worked');
  assert.match(verifier,
    /visitHistoryDelta\?\.totalVisits === 1[\s\S]*completedCheckIns === 1[\s\S]*completedPurchases === 1[\s\S]*cardPayments === 1[\s\S]*lifetimeSpendCents/,
    'the injected post-bank fault must preserve the exact combined-visit accounting projection');
  assert.match(verifier, /afterVisit\?\.exactRowsAdded === 1/,
    'the exact ticket remains single after the released actor has departed');
  assert.match(registerMode, /checkoutBagOwnershipStatus:[\s\S]*customerOwnedUnderRegister/,
    'the orphan assertion reads the actual register subtree');
  assert.match(registerMode,
    /postBankRecoveries:[\s\S]*customerOwnedUnderRegisterBeforeCleanup/,
    'the runtime publishes an immutable pre-cleanup recovery snapshot for acceptance evidence');
  assert.match(clubhouse, /debugFailNextPaidCustomerRelease/,
    'the real player-owned release callback has an exact-identity one-shot fault seam');
  assert.match(clubhouse,
    /QA injected paid-customer route-release failure[\s\S]*releasePaidCustomerFromCheckoutAuthoritative/,
    'the injected ordinary release failure precedes the independent authoritative fallback');
  assert.match(registerMode,
    /debugFailNextBankHelperReturn[\s\S]*qaBankHelperReturnFault/,
    'the bank return seam is armed against the live exact ticket');
  assert.match(registerMode,
    /QA injected bank-helper interruption after core commit[\s\S]*finishedTx\.commitPrepared[\s\S]*bank-helper-partial-commit-recovered/,
    'the fault interrupts the real WAL between core settlement and ticket append, then retries it');
});

test('banking and queue release share one irreversible recovery boundary', () => {
  const start = registerMode.indexOf('  function finalizeTransaction() {');
  const end = registerMode.indexOf('\n  function handleMonitorAction(action) {', start);
  assert.ok(start >= 0 && end > start);
  const finalize = registerMode.slice(start, end);
  const outerTry = finalize.indexOf('    try {');
  const bank = finalize.indexOf('finalizeReservationCheckIn(', outerTry);
  const finallyAt = finalize.indexOf('} finally {', bank);
  const authoritativeRelease = finalize.indexOf('runPaidCustomerAuthoritativeRelease({', finallyAt);
  const physicalCleanup = finalize.indexOf("attempt('post-bank-physical-cleanup'", authoritativeRelease);
  assert.ok(outerTry >= 0 && bank > outerTry && finallyAt > bank,
    'the bank helper itself is inside the finalizer try/finally');
  assert.ok(authoritativeRelease > finallyAt && physicalCleanup > authoritativeRelease,
    'an idempotent queue release is guaranteed before physical register teardown');
  assert.match(finalize,
    /actorRelease:\s*actorAuthoritativeRelease[\s\S]*bridgeRelease:\s*bridgeAuthoritativeRelease/,
    'a failed actor release must fall through to the independent clubhouse bridge');
  assert.match(finalize, /if \(!finishedTx\.banked\)[\s\S]*return false;/,
    'a pre-bank exception keeps the live ticket available for retry');
  assert.match(finalize, /bank-helper-partial-commit-recovered/,
    'an interruption after the WAL core commit is diagnosable and recovered');
  assert.match(clubhouse,
    /releasePaidCustomerFromCheckoutAuthoritative[\s\S]*counterQueue\.indexOf\(c\) < 0/,
    'clubhouse owns an exact-identity non-visual queue-release primitive');
  assert.match(clubhouse,
    /B\.releasePaidCustomerFromCheckoutAuthoritative[\s\S]*createRegisterMode\(B\)/,
    'the primitive remains available even if an actor callback is missing');
});

test('accepted combined checkout performs an exact manual slot save/load round trip', () => {
  const digestAt = verifier.indexOf('const checkoutSaveDigest = async');
  const roundTripAt = verifier.indexOf('const manualCheckoutSaveLoad = async', digestAt);
  const invokeAt = verifier.indexOf('run.saveLoad = await manualCheckoutSaveLoad', roundTripAt);
  assert.ok(digestAt >= 0 && roundTripAt > digestAt && invokeAt > roundTripAt,
    'the isolated accepted card visit runs the real round-trip after departure');
  const roundTrip = verifier.slice(roundTripAt, invokeAt);
  assert.match(roundTrip, /keyboard\.press\('p'\)/,
    'the player opens the shipping pause menu');
  assert.match(roundTrip, /getByRole\('button', \{ name: 'Save game', exact: true \}\)/);
  assert.match(roundTrip,
    /locator\('\.slot-card'\)\.nth\(0\)[\s\S]*getByText\('Slot 1', \{ exact: true \}\)[\s\S]*name: 'Save here', exact: true/,
    'Slot 1 is addressed by stable card order and its exact visible label');
  assert.match(verifier,
    /readNativeSlotEvidence[\s\S]*fairwayNative\.loadStatus\('slot1', \{ repair: false \}\)[\s\S]*loadStatus\('slot1-meta', \{ repair: false \}\)/,
    'the read-only evidence requires both native Electron save and metadata primaries');
  assert.doesNotMatch(roundTrip, /localStorage/,
    'Electron acceptance cannot fall back to a different browser storage authority');
  assert.match(verifier,
    /storage\.source === 'primary'[\s\S]*storage\.recovered === false[\s\S]*metadataFresh === true[\s\S]*storageAfter\?\.sha256 === b\.saveLoad\.storage\.sha256/,
    'acceptance requires a fresh native primary and unchanged post-load readback hash');
  assert.match(roundTrip,
    /name: 'Resume', exact: true[\s\S]*keyboard\.press\('Space'\)[\s\S]*savedMinute \+ 2[\s\S]*durableChanged/,
    'a normal-control clock canary proves Load restored the slot instead of current memory');
  assert.match(roundTrip, /name: 'Load game', exact: true[\s\S]*name: 'Load slot 1\?', exact: true/);
  assert.match(roundTrip, /scene3d !== window\.__goal24SceneBeforeSlotLoad/,
    'a same-scene no-op cannot pass as a load');
  assert.match(roundTrip, /beforeJson === afterJson && beforeSha256 === afterSha256/,
    'the canonical durable projection must survive byte-for-byte');
  assert.match(roundTrip,
    /MutationObserver[\s\S]*\.notification-message[\s\S]*deserializeOrSchemaRepairNotices/,
    'the round trip captures delayed deserialize and schema repair notices');
  assert.match(verifier,
    /deserializeOrSchemaRepairNotices\?\.length === 0/,
    'a load that repairs or migrates the saved payload cannot pass acceptance');
  assert.match(verifier,
    /visualFallbackNotices\?\.length === 0/,
    'a load that falls back from authored production visuals cannot pass acceptance');
  assert.match(roundTrip,
    /firstDoorVisibility:\s*app\.scene3d\.firstDoorVisibilityReport[\s\S]*sheet06:[\s\S]*paymentGpuPrewarm:/,
    'the reconstructed scene captures the full first-door, Sheet-6, and payment readiness evidence');
  assert.match(verifier,
    /firstDoorVisibility\?\.status === 'ready'[\s\S]*sheet06\?\.activationStatus === 'active'[\s\S]*paymentGpuPrewarm\?\.drawn === 12/,
    'post-load acceptance requires authored Sheet-6 activation and a fresh exact payment prewarm');
  const restoredAt = roundTrip.indexOf('const restoredRuntime = await page.evaluate');
  const restoredPauseAt = roundTrip.indexOf("await page.keyboard.press('Space')", restoredAt);
  assert.ok(restoredAt >= 0 && restoredPauseAt > restoredAt,
    'restored runtime is observed before any normal-control pause input');
  assert.doesNotMatch(roundTrip, /window\.__fw\.speedIdx\s*=(?!=)|walk\.clearKeys/,
    'the load verifier cannot normalize restored runtime state directly');
  const digest = verifier.slice(digestAt, roundTripAt);
  for (const field of [
    'transactionHistory', 'reservation', 'inventory', 'shopMovement', 'soldHeldUids', 'drawer',
    'salesLive', 'entries', 'processedEntries', 'outcomes', 'processedOutcomes',
    'visitHistory', 'registerHasTx', 'targetInQueue', 'cardOwnedLive',
    'customerVisitEvent', 'customerVisitRecorded', 'appliedEvents', 'salesTax',
    'clockMinutes', 'propertyId', 'holdingId',
  ]) {
    assert.match(digest, new RegExp(field), `save digest includes ${field}`);
  }
  assert.match(verifier, /acceptedCombinedSaleSurvivesManualSlotRoundTrip/);
});

test('every departed paid bag must release all transferred owned resources', () => {
  assert.match(verifier, /paidBagResourcesBefore: register\.paidBagResourceStatus/,
    'each run captures its own cumulative resource baseline before payment');
  assert.match(verifier, /paidBagResources: ch\.register\.paidBagResourceStatus/,
    'departure captures the cumulative resource state after disposal');
  assert.match(verifier, /everyPaidBagTransferReleasesItsOwnedResources/);
});

test('checkout fixture stays within authored stock and freezes unrelated booking automation', () => {
  assert.match(verifier, /resetGolfOperationsQA\(app\.state\)/);
  assert.match(verifier,
    /configureTeeSheet\(app\.state, \{ autoBookings: false \}\)/,
    'the production configuration API disables unrelated horizon generation');
  assert.match(verifier, /fixtures\.capacityOf\(id\)/);
  assert.match(verifier, /entry\.shelf < 1 \|\| entry\.shelf > entry\.capacity/);
  assert.doesNotMatch(verifier, /Math\.max\(inv\.shelf, 8\)/,
    'the verifier may not inject stock beyond a physical fixture');
  assert.match(verifier, /leaveRegisterThroughPlayerControls[\s\S]*keyboard\.press\('Escape'\)/,
    'the save boundary exits cashier mode through normal player controls');
  assert.match(verifier, /two consecutive identical samples/,
    'both sides of the slot round trip must settle before comparison');
});

test('card checkout proves the natural customer identity selects the cached exact artwork', () => {
  assert.match(verifier, /const naturalSha256 = await hashCanvas\(register\.cardBrandCanvas\?\.\(\)\)/);
  assert.match(verifier,
    /const expectedSha256 = await hashCanvas\([\s\S]*register\.debugPaymentCardCanvas\?\.\(expectedCardId\)/,
    'the natural face is compared to its exact cached design without repaint side effects');
  const naturalProbeAt = verifier.indexOf('run.naturalCardBrand = await page.evaluate');
  const cashierEntryAt = verifier.indexOf("await page.keyboard.press('e')", naturalProbeAt);
  const naturalProbe = verifier.slice(naturalProbeAt, cashierEntryAt);
  assert.doesNotMatch(naturalProbe, /repaintBrand|__qaPaymentCardId/,
    'the oracle cannot create texture work immediately before cashier entry');
  assert.match(verifier, /everyNaturalCustomerCardUsesItsExactCachedIdentityVariant/);
  assert.match(verifier,
    /naturalSha256 === run\.naturalCardBrand\.expectedSha256/);
  assert.match(clubhouse,
    /cardTextureCacheStatus:\s*\(\)\s*=>\s*\(register\.cardTextureCacheStatus/,
    'the narrow facade reports the real live cache rather than reconstructing it');
  assert.match(clubhouse, /debugPaymentCardCanvas:/,
    'the exact cached canvas is exposed read-only through the narrow facade');
  assert.match(verifier,
    /register\.isActive\(\) && register\.getFlow\?\.\(\)\?\.state === 'WaitingForScan'/,
    'scanning begins only after the authored cashier-entry state completes');
});
