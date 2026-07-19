import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const DRIVERS = [
  'tools/qa/simplified-register-acceptance.mjs',
  'tools/qa/simplified-register-queue-acceptance.mjs',
  'tools/qa/simplified-register-product-matrix.mjs',
  'tools/qa/simplified-register-save-reload.mjs',
  'tools/qa/simplified-register-recovery-accessibility.mjs',
];
const URL_CONFIGURED_DRIVERS = [
  'tools/qa/register-acceptance-driver.mjs',
  'tools/qa/register-recovery-driver.mjs',
  ...DRIVERS,
  'tools/qa/simplified-register-performance.mjs',
  'tools/qa/simplified-register-lifecycle-stress.mjs',
];
const EVIDENCE_PLAN_GENERATOR = 'tools/qa/generate-cashier-master-evidence-plan.mjs';

test('cashier browser QA supports an isolated server and a cross-worktree run lock', () => {
  for (const file of URL_CONFIGURED_DRIVERS) {
    assert.match(fs.readFileSync(file, 'utf8'), /process\.env\.QA_BASE_URL/, file);
  }
  assert.match(fs.readFileSync('tools/qa/run-playwright.cjs', 'utf8'),
    /process\.env\.QA_BASE_URL/);
  assert.match(fs.readFileSync('tools/qa/playwright-run-lock.cjs', 'utf8'),
    /process\.env\.PLAYWRIGHT_RUN_LOCK_PATH/);
});

test('all cashier evidence drivers gate one pre/post production snapshot and PNG inventory', () => {
  for (const file of DRIVERS) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /from '\.\/cashier-build-snapshot\.mjs';/, file);
    assert.match(source, /const productionBuildBefore = captureCashierBuildSnapshot\(\);/, file);
    assert.match(source, /finalizeCashierQaResult\(\{/, file);
    assert.match(source, /beforeSnapshot: productionBuildBefore/, file);
    assert.match(source, /evidencePngs(?:\s*:|\s*,)/, file);
    assert.match(source, /evidenceRoot:/, file);
  }
});

test('success and blocker paths retain every driver-specific screenshot reference', () => {
  const acceptance = fs.readFileSync(DRIVERS[0], 'utf8');
  assert.match(acceptance, /evidencePngs: evidence/);
  assert.match(acceptance, /object\.name === 'CashDrawer_Tray'/);
  assert.match(acceptance, /REGISTER\.drawer\.travel/);
  assert.match(acceptance, /progress < 0\.25 \|\| progress > 0\.75/);
  assert.doesNotMatch(acceptance, /waitForTimeout\(230\)/,
    'drawer-opening evidence must be transform-driven rather than timer-driven');
  const drawerBaseline = acceptance.indexOf('const drawerTravelStart = await page.evaluate');
  const drawerObserver = acceptance.indexOf('const drawerMidpointPromise = page.waitForFunction');
  const cashInput = acceptance.indexOf('await page.mouse.click(handful.x, handful.y)');
  const drawerOpeningState = acceptance.indexOf("tx.checkoutFlow?.state === 'DrawerOpening'", cashInput);
  const cashClicked = acceptance.indexOf("await shot('08a-cash-clicked.png')");
  const drawerMidpointAwait = acceptance.indexOf('await drawerMidpointPromise');
  const drawerMidpointRead = acceptance.indexOf('window.__registerQaCashDrawerMidpoint', drawerMidpointAwait);
  const drawerOpening = acceptance.indexOf("await shot('08b-cash-clicked-drawer-opening.png')");
  assert.ok(drawerBaseline >= 0 && drawerObserver > drawerBaseline
      && cashInput > drawerObserver
      && drawerOpeningState > cashInput && cashClicked > drawerOpeningState
      && drawerMidpointAwait > cashClicked && drawerMidpointRead > drawerMidpointAwait
      && drawerOpening > drawerMidpointRead,
    'cash evidence must arm its authored transform observer before input, retain the midpoint, and capture drawer opening');

  const performance = fs.readFileSync('tools/qa/simplified-register-performance.mjs', 'utf8');
  const scanClick = performance.indexOf('await page.mouse.click(product.x, product.y)');
  const scanReleaseWait = performance.indexOf("state === 'WaitingForScan'", scanClick);
  const finalScanRelease = performance.indexOf("state === 'AllProductsScanned'", scanReleaseWait);
  assert.ok(scanClick >= 0 && scanReleaseWait > scanClick && finalScanRelease > scanReleaseWait,
    'performance QA must wait for the visible scan arc to release input before clicking another product');

  const queue = fs.readFileSync(DRIVERS[1], 'utf8');
  assert.match(queue, /evidencePngs: evidence/);
  assert.match(queue, /evidencePngs: \[\.\.\.evidence, failureShot\]/);
  assert.match(queue, /!register\.getTx\(\)/);
  assert.match(queue, /!register\.getCustomer\(\)/);
  assert.match(queue, /clubhouse\.checkoutQueue\(\)\.length === 0/);
  assert.match(queue, /customer\.customerId === firstId \|\| customer\.customerId === secondId/);
  assert.match(queue, /07b-register-reset-empty\.png/);
  const queueCompleted = queue.indexOf("await shot('07-second-complete-queue-empty.png'");
  const queueReset = queue.indexOf("await shot('07b-register-reset-empty.png'");
  const queueExit = queue.indexOf('await exitFrontDesk(page);', queueReset);
  const queueReleased = queue.indexOf("await shot('08-front-desk-released-after-queue.png'");
  assert.ok(queueCompleted >= 0 && queueReset > queueCompleted
      && queueExit > queueReset && queueReleased > queueExit,
  'queue evidence must capture an empty in-register reset before normal Escape/release');

  const productMatrix = fs.readFileSync(DRIVERS[2], 'utf8');
  assert.match(productMatrix, /caseResults\.flatMap\(\(entry\) => entry\.evidence\)/);
  const reportWrite = productMatrix.indexOf("fs.writeFileSync(path.join(root, 'REPORT.md')");
  const passResultWrite = productMatrix.indexOf("fs.writeFileSync(path.join(root, 'latest-result.json')");
  assert.ok(reportWrite >= 0, 'product matrix must persist its human-readable report');
  assert.ok(passResultWrite > reportWrite,
    'product matrix latest-result.json must be the final persisted success marker');
  // Preserve the independently-landed provisions matrix coverage.
  assert.match(productMatrix, /'clubs', 'balls', 'apparel', 'accessories', 'provisions'/);
  const productSpec = fs.readFileSync('tools/qa/simplified-register-product-matrix-spec.mjs', 'utf8');
  assert.match(productSpec, /'water1', 'snack1'/);
  assert.match(productSpec, /'provisions'/);

  const saveReload = fs.readFileSync(DRIVERS[3], 'utf8');
  assert.match(saveReload, /evidencePngs\.push\(file\)/);
  assert.match(saveReload, /evidencePngs\.push\(blockerPath\)/);
  assert.match(saveReload, /const finalized = finalizeCashierQaResult/);

  const recoveryAccessibility = fs.readFileSync(DRIVERS[4], 'utf8');
  assert.match(recoveryAccessibility, /evidencePngs: evidence,/);
  assert.match(recoveryAccessibility, /evidencePngs: blockerEvidence,/);
  assert.match(recoveryAccessibility, /REGISTER_RECOVERY_ACCESSIBILITY_ROOT/);
  assert.match(recoveryAccessibility, /evidenceRoot: out,/);

  const evidencePlan = fs.readFileSync(EVIDENCE_PLAN_GENERATOR, 'utf8');
  assert.match(evidencePlan, /number: 19[^\n]+08a-cash-clicked\.png/);
  assert.match(evidencePlan, /number: 20[^\n]+08b-cash-clicked-drawer-opening\.png/);
  assert.match(evidencePlan, /number: 21[^\n]+09b-cash-drawer-open\.png/);
  assert.match(evidencePlan, /number: 30[^\n]+07b-register-reset-empty\.png/);
  assert.match(evidencePlan, /number: 31[^\n]+01-two-customer-queue-first-owner\.png/);
  assert.match(evidencePlan, /number: 36[^\n]+10-received-cash-sorted\.png/);
  assert.match(evidencePlan, /state\.queue\.length !== 0/);
  assert.match(evidencePlan, /state\?\.first != null \|\| state\?\.second != null/);
});
