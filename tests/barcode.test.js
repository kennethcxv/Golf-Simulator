import test from 'node:test';
import assert from 'node:assert/strict';
import { barcodeFor, judgeBarcodeRead, BARCODE_MSG } from '../src/sim/barcode.js';

test('each SKU/price pair gets a stable twelve-digit barcode identity', () => {
  const balls = barcodeFor('balls3', 47);
  assert.match(balls, /^\d{12}$/);
  assert.equal(balls, barcodeFor('balls3', 47));
  assert.notEqual(balls, barcodeFor('glove1', 47));
  assert.notEqual(balls, barcodeFor('balls3', 48));
});

test('a barcode requires zone contact, readable facing, ownership, and a fresh item', () => {
  const base = {
    barcode: barcodeFor('balls3', 47), scanHit: true, facingDot: -0.8,
    itemUid: 'order-a-1', expectedUid: 'order-a-1', alreadyScanned: false,
  };
  assert.equal(judgeBarcodeRead(base).ok, true);
  assert.equal(judgeBarcodeRead({ ...base, barcode: '' }).code, 'missing');
  assert.equal(judgeBarcodeRead({ ...base, scanHit: false }).code, 'outside-zone');
  assert.equal(judgeBarcodeRead({ ...base, facingDot: 0.2 }).code, 'orientation');
  assert.equal(judgeBarcodeRead({ ...base, expectedUid: 'order-b-1' }).code, 'wrong-customer');
  assert.equal(judgeBarcodeRead({ ...base, alreadyScanned: true }).code, 'duplicate');
});

test('every physical barcode rejection has actionable feedback', () => {
  for (const code of ['missing', 'wrong-customer', 'duplicate', 'outside-zone', 'orientation']) {
    assert.ok(BARCODE_MSG[code]);
  }
});
