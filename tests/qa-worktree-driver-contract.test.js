import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stockDriver = fs.readFileSync('tools/qa/sku-stock-lifecycle-qa.js', 'utf8');
const deliveryDriver = fs.readFileSync('tools/qa/live-laptop-order-delivery-qa.js', 'utf8');

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
