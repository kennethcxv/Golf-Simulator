import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stockDriver = fs.readFileSync('tools/qa/sku-stock-lifecycle-qa.js', 'utf8');
const deliveryDriver = fs.readFileSync('tools/qa/live-laptop-order-delivery-qa.js', 'utf8');
const frontDeskLifecycleDriver = fs.readFileSync(
  'tools/qa/simplified-front-desk-lifecycle-acceptance.mjs',
  'utf8',
);
const patienceDriver = fs.readFileSync('tools/qa/patience-geometry-churn.js', 'utf8');
const registerAcceptanceDriver = fs.readFileSync(
  'tools/qa/register-acceptance-driver.mjs',
  'utf8',
);
const simplifiedRegisterAcceptanceDriver = fs.readFileSync(
  'tools/qa/simplified-register-acceptance.mjs',
  'utf8',
);

test('stock and delivery browser drivers resolve output and runtime URL from the assigned worktree', () => {
  for (const [name, source] of [
    ['stock', stockDriver],
    ['delivery', deliveryDriver],
  ]) {
    assert.match(source, /process\.env\.QA_REPO_ROOT \|\| process\.cwd\(\)/, `${name} output root`);
    assert.match(source, /process\.env\.QA_BASE_URL \|\| 'http:\/\/localhost:8457\/'/, `${name} runtime URL`);
    assert.doesNotMatch(source, /C:\\\\Users\\\\Kenneth\\\\Documents\\\\GitHub\\\\Golf-Flipper/i,
      `${name} driver must not write to the original checkout`);
  }
});

test('front-desk lifecycle evidence resolves the runtime URL from the assigned worktree', () => {
  assert.match(frontDeskLifecycleDriver,
    /process\.env\.QA_BASE_URL \|\| 'http:\/\/localhost:8457\/'/);
  assert.match(frontDeskLifecycleDriver, /const plannedArrival = deskReadyAt - 2;/,
    'the fixture keeps a bounded but visible lounge window');
  assert.ok((frontDeskLifecycleDriver.match(/page\.keyboard\.press\('3'\)/g) || []).length >= 2,
    'arrival and no-show clocks advance through the production 16x time control');
});

test('register acceptance follows the active clubhouse transform instead of a legacy world origin', () => {
  assert.match(registerAcceptanceDriver, /const origin = clubhouse\.interior\.position;/);
  assert.match(registerAcceptanceDriver, /const \{ REGISTER: liveRegister \} = await import/);
  assert.match(registerAcceptanceDriver, /walk\.x = liveRegister\.stand\.x \+ origin\.x;/);
  assert.match(registerAcceptanceDriver, /walk\.z = liveRegister\.stand\.z \+ origin\.z;/);
  assert.doesNotMatch(registerAcceptanceDriver, /walk\.x = 2\.80 - 8;/);
  assert.doesNotMatch(registerAcceptanceDriver, /walk\.z = 5\.35 \+ 228;/);
});

// The receipt-phase capture-order test retired 2026-07-30 round 2: the physical
// receipt was removed from the checkout outright, so the cash route no longer
// enters a receipt-print phase for the driver to photograph.
test('front-desk cash evidence accepts the presented handful before opening the drawer view', () => {
  const routeStart = frontDeskLifecycleDriver.indexOf('async function completeCashService');
  const routeEnd = frontDeskLifecycleDriver.indexOf('async function walkInScenario', routeStart);
  const route = frontDeskLifecycleDriver.slice(routeStart, routeEnd);
  const monitorCamera = route.indexOf("await waitCamera(page, 'monitor')");
  const tenderClick = route.indexOf('await page.mouse.click(handful.x, handful.y)');
  const cashCamera = route.indexOf("await waitCamera(page, 'cash')", tenderClick);
  assert.ok(monitorCamera >= 0 && tenderClick > monitorCamera && cashCamera > tenderClick,
    'cash stays in the customer presentation frame until the handful is accepted');
});

test('front-desk no-show evidence uses the production Tee Times laptop label', () => {
  assert.match(frontDeskLifecycleDriver,
    /querySelectorAll\('\.lt-navbtn'\)[\s\S]*includes\('Tee Times'\)/);
  assert.doesNotMatch(frontDeskLifecycleDriver,
    /textContent\.trim\(\)\.includes\('Reservations'\)/);
  assert.match(frontDeskLifecycleDriver, /\/no\[\\s-\]\?show\/i\.test\(laptopText\)/,
    'the assertion accepts the player-facing No show status');
});

test('front-desk cancellation evidence uses the normal laptop confirmation route', () => {
  for (const proof of [
    "name: 'Cancel booking'",
    "name: 'Cancel the booking'",
    "toastText.includes('spot is open again')",
    "reservation?.status === 'cancelled'",
    'fixture.bookedSlot.bookedPlayers - fixture.reservation.partySize',
    'fixture.identityBefore.visitHistory.cancellations + 1',
    'cancellation-second-load-idempotent.png',
  ]) {
    assert.ok(frontDeskLifecycleDriver.includes(proof), `missing cancellation proof: ${proof}`);
  }
});

test('patience evidence proves real abandonment and resolves URL/output from the worktree', () => {
  assert.match(patienceDriver, /process\.env\.QA_BASE_URL \|\| 'http:\/\/localhost:8457\/'/);
  assert.match(patienceDriver, /process\.env\.PATIENCE_QA_ROOT/);
  for (const proof of [
    'giveUpHandled',
    'fixtureHeld.length === 0',
    "cited?.includes('waitTime')",
    'lostSales === fixture.lostSalesBefore + 1',
    'customer-physically-departed.png',
  ]) {
    assert.ok(patienceDriver.includes(proof), `missing patience proof: ${proof}`);
  }
});

test('delivery visibility evidence supplies the active camera before scene-wide sprite raycasts', () => {
  const raycasterDeclaration = deliveryDriver.indexOf('const raycaster = new THREE.Raycaster();');
  const cameraAssignment = deliveryDriver.indexOf('raycaster.camera = camera;', raycasterDeclaration);
  const sceneIntersection = deliveryDriver.indexOf('raycaster.intersectObjects(scene.children, true)', raycasterDeclaration);

  assert.ok(raycasterDeclaration >= 0, 'delivery evidence declares its visibility raycaster');
  assert.ok(cameraAssignment > raycasterDeclaration, 'delivery evidence assigns the active camera');
  assert.ok(sceneIntersection > cameraAssignment, 'camera assignment precedes scene-wide intersection');
});

test('delivery and stock evidence retain separate phase and iteration directories', () => {
  assert.match(stockDriver, /SKU_STOCK_QA_PHASE/);
  assert.match(stockDriver, /SKU_STOCK_QA_ITERATION/);
  assert.match(deliveryDriver, /DELIVERY_ORDER_QA_PHASE/);
  assert.match(deliveryDriver, /DELIVERY_ORDER_QA_ITERATION/);
});

test('delivery evidence separates the wide pallet proof from close label inspection', () => {
  assert.match(deliveryDriver, /const inspection = \{/);
  assert.match(deliveryDriver, /capture\('03-boxes-staged-wide\.png'/);
  const inspectionCamera = deliveryDriver.indexOf('await setPlayerCamera(cameras.inspection);');
  const stagedReadback = deliveryDriver.indexOf('const staged = await page.evaluate', inspectionCamera);
  assert.ok(inspectionCamera >= 0 && stagedReadback > inspectionCamera,
    'readability diagnostics run from the close normal-player inspection camera');
  assert.match(deliveryDriver, /capture\('04-box-labels-inspected\.png'/);
});
