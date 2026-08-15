import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  barcodeBits,
  CHECKOUT_SCAN_TARGET,
  CHECKOUT_SCAN_TIMING,
  scanChoreographyAt,
  scanDuration,
  scannerReadFacts,
} from '../src/render3d/clubhouse/checkoutScanPresentation.js';

test('runtime checkout barcodes have guards, a center marker, and stable SKU bits', () => {
  const first = barcodeBits('012345678901');
  assert.match(first, /^101[01]+01010[01]+101$/);
  assert.equal(first, barcodeBits('012345678901'));
  assert.notEqual(first, barcodeBits('112345678901'));
  assert.equal(barcodeBits(''), '');
});

test('one click has a readable scanner hold before the product travels to the bag', () => {
  const total = scanDuration();
  assert.equal(total, Object.values(CHECKOUT_SCAN_TIMING).reduce((sum, value) => sum + value, 0));
  assert.equal(scanChoreographyAt(0).phase, 'pickup');
  assert.equal(scanChoreographyAt(CHECKOUT_SCAN_TIMING.pickup + 0.01).phase, 'scan-approach');
  const hold = scanChoreographyAt(
    CHECKOUT_SCAN_TIMING.pickup + CHECKOUT_SCAN_TIMING.approach + 0.01,
  );
  assert.equal(hold.phase, 'scan-hold');
  assert.equal(hold.shouldCommitScan, true);
  assert.equal(scanChoreographyAt(total - 0.01).phase, 'bag');
  assert.equal(scanChoreographyAt(total + 1).complete, true);
});

test('scanner contact requires the barcode to cross the ray and face back toward it', () => {
  const aligned = scannerReadFacts({
    barcodePosition: [0, 0, 0.12],
    barcodeNormal: [0, 0, -1],
    rayOrigin: [0, 0, 0],
    rayDirection: [0, 0, 1],
  });
  assert.equal(aligned.scanHit, true);
  assert.equal(aligned.facingDot, -1);
  assert.ok(aligned.lateralDistance < 1e-8);

  const visibleEdge = scannerReadFacts({
    barcodePosition: [
      CHECKOUT_SCAN_TARGET.sideOffset,
      CHECKOUT_SCAN_TARGET.upOffset,
      CHECKOUT_SCAN_TARGET.distance,
    ],
    barcodeNormal: [0, 0, -1],
    rayOrigin: [0, 0, 0],
    rayDirection: [0, 0, 1],
  });
  assert.equal(visibleEdge.scanHit, true);
  assert.ok(visibleEdge.lateralDistance < CHECKOUT_SCAN_TARGET.maximumLateralDistance);

  const offWindow = scannerReadFacts({
    barcodePosition: [0.08, 0, 0.12],
    barcodeNormal: [0, 0, -1],
    rayOrigin: [0, 0, 0],
    rayDirection: [0, 0, 1],
  });
  assert.equal(offWindow.scanHit, false);

  const reversed = scannerReadFacts({
    barcodePosition: [0, 0, 0.12],
    barcodeNormal: [0, 0, 1],
    rayOrigin: [0, 0, 0],
    rayDirection: [0, 0, 1],
  });
  assert.equal(reversed.facingDot, 1);
});

test('the production fixture and register wire the authored scanner to the counter', () => {
  const fixtures = fs.readFileSync('src/render3d/clubhouse/fixtures.js', 'utf8');
  const register = fs.readFileSync('src/render3d/clubhouse/simplifiedRegisterMode.js', 'utf8');
  const merch = fs.readFileSync('src/render3d/clubhouse/merch.js', 'utf8');
  assert.match(merch, /'barcode_scanner'/);
  assert.match(fixtures, /placeKit\('barcode_scanner', REGISTER\.scanner/);
  assert.match(fixtures, /B\.register\.attachScanner\(scanner\)/);
  // The barcode survives as a transaction STRING on the item's userData.
  assert.match(register, /barcodeFor\(item\.skuId, item\.price\)/);
});

// The tag was asked for three times and reported gone twice. Both earlier passes
// left a printed label on the goods and wrote assertions that REQUIRED it, so a
// green suite meant nothing. This test is the inverse: the register may not
// construct any printed product label, by any name.
test('no product carries a printed label of any kind at the register', () => {
  const register = fs.readFileSync('src/render3d/clubhouse/simplifiedRegisterMode.js', 'utf8');
  // Strip comments — the removal is documented in prose that names what is gone.
  const code = register
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  for (const banned of [
    'RuntimeProductBarcode', 'productBarcodeTexture', 'barcodeBits',
    'ProductSwingTag', 'RuntimeProductBarcodeTether',
    'RuntimeProductBarcodeBacking', 'RuntimeProductBarcodeCarrier',
    'PriceTag', 'HangTag', 'productQrTexture',
  ]) {
    assert.ok(!code.includes(banned),
      `register builds "${banned}" — the goods must carry no printed label`);
  }
  // Negative control: the same scan would fire on a label that did exist.
  assert.ok('const t = new THREE.Mesh(g, m); t.name = "RuntimeProductBarcode";'
    .includes('RuntimeProductBarcode'), 'the label scan can detect a label');
});

test('normal product clicks route both register workspaces through one-click scan choreography', () => {
  const register = fs.readFileSync('src/render3d/clubhouse/simplifiedRegisterMode.js', 'utf8');
  const onDownStart = register.indexOf('function onDown(event)');
  const onDownEnd = register.indexOf('function onMove(event)', onDownStart);
  assert.ok(onDownStart >= 0 && onDownEnd > onDownStart, 'register pointer-down handler is present');

  const onDown = register.slice(onDownStart, onDownEnd);
  const monitorStart = onDown.indexOf("if (workspace === 'monitor')");
  const cardStart = onDown.indexOf("if (workspace === 'card')", monitorStart);
  const scanStart = onDown.indexOf("if (workspace === 'scan')", cardStart);
  const cashStart = onDown.indexOf("if (workspace === 'cash')", scanStart);
  assert.ok(monitorStart >= 0 && cardStart > monitorStart, 'monitor click branch is present');
  assert.ok(scanStart > cardStart && cashStart > scanStart, 'scan click branch is present');

  const monitorBranch = onDown.slice(monitorStart, cardStart);
  const scanBranch = onDown.slice(scanStart, cashStart);
  assert.match(monitorBranch, /kind === 'item'[\s\S]*bagProduct\(object\)/);
  assert.match(scanBranch, /kind === 'item'\) bagProduct\(object\)/);
  assert.doesNotMatch(onDown, /\bstartProductDrag\b/);
  assert.doesNotMatch(register, /\bstartProductDrag\b/);
  assert.match(register, /function settleScannedProduct\(mesh\)/);
  assert.match(register, /checkoutVisualState = 'scanned-staging'/);
  assert.match(register, /checkoutVisualState = 'oversize-set-aside'/);
  assert.match(register, /function startBaggingProductDrag\(picked\)/);
  assert.match(register, /function movePhysicalDrag\(event\)/);
  assert.match(register, /tx\?\.stage === 'bagging'\) startBaggingProductDrag\(object\)/);
});

test('physical checkout defines a selective pickability toggle for settle and recovery', () => {
  const register = fs.readFileSync('src/render3d/clubhouse/simplifiedRegisterMode.js', 'utf8');
  assert.match(
    register,
    /function setObjectPickable\(object, pickable\) \{[\s\S]*?object\.traverse[\s\S]*?Object\.hasOwn\(node\.userData \|\| \{\}, 'pick'\)[\s\S]*?pick: !!pickable/,
    'the root and authored click pads toggle together without making arbitrary GLB children pickable',
  );
  assert.match(
    register,
    /function settleScannedProduct\(mesh\) \{[\s\S]*?setObjectPickable\(mesh, false\)/,
    'settled products stop intercepting later scan clicks',
  );
});
