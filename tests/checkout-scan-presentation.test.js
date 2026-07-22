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

test('the production fixture and register wire the authored scanner into physical barcode validation', () => {
  const fixtures = fs.readFileSync('src/render3d/clubhouse/fixtures.js', 'utf8');
  const register = fs.readFileSync('src/render3d/clubhouse/simplifiedRegisterMode.js', 'utf8');
  const merch = fs.readFileSync('src/render3d/clubhouse/merch.js', 'utf8');
  assert.match(merch, /'barcode_scanner'/);
  assert.match(fixtures, /placeKit\('barcode_scanner', REGISTER\.scanner/);
  assert.match(fixtures, /B\.register\.attachScanner\(scanner\)/);
  assert.match(register, /barcodeFor\(item\.skuId, item\.price\)/);
  assert.match(register, /judgeBarcodeRead\(/);
  assert.match(register, /RuntimeProductBarcode/);
});
