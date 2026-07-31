import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  CARD_HELD_PITCH, cashGpuPrewarmReleaseReady, cashGpuPrewarmShouldRelease,
  checkoutMoneyAssetStem, checkoutMoneyGpuPrewarmStems,
  drawerPresentationVisible,
  shouldPrewarmDrawerCoin,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

test('Sheet-01 five-unit hero coin is tender-only visual routing', () => {
  assert.equal(checkoutMoneyAssetStem(0.05, 'tender'), 'cash_coin_05_sheet01');
  assert.equal(checkoutMoneyAssetStem(0.05, 'drawer'), 'cash_coin_05');
  assert.equal(checkoutMoneyAssetStem(0.05, 'change'), 'cash_coin_05');
});

test('money visual routing preserves every other denomination stem', () => {
  assert.equal(checkoutMoneyAssetStem(20, 'tender'), 'cash_bill_20');
  assert.equal(checkoutMoneyAssetStem(50, 'drawer'), 'cash_bill_50');
  assert.equal(checkoutMoneyAssetStem(0.01, 'change'), 'cash_coin_01');
  assert.equal(checkoutMoneyAssetStem(0.1, 'drawer'), 'cash_coin_10');
  assert.equal(checkoutMoneyAssetStem(0.5, 'tender'), 'cash_coin_50');
});

test('opaque-veil GPU warm-up covers every drawer asset and the tender-only hero coin', () => {
  assert.deepEqual(checkoutMoneyGpuPrewarmStems(), [
    'cash_bill_50', 'cash_bill_20', 'cash_bill_10', 'cash_bill_5', 'cash_bill_1',
    'cash_coin_50', 'cash_coin_25', 'cash_coin_10', 'cash_coin_05', 'cash_coin_01',
    'cash_coin_05_sheet01',
  ]);
});

test('cash GPU representatives release only after every expected model was drawn', () => {
  assert.equal(cashGpuPrewarmReleaseReady({ ready: true, built: 11, expected: 11, drawn: 11 }), true);
  assert.equal(cashGpuPrewarmReleaseReady({ ready: false, built: 11, expected: 11, drawn: 11 }), false);
  assert.equal(cashGpuPrewarmReleaseReady({ ready: true, built: 0, expected: 11, drawn: 0 }), false);
  assert.equal(cashGpuPrewarmReleaseReady({ ready: true, built: 10, expected: 11, drawn: 10 }), false);
  assert.equal(cashGpuPrewarmReleaseReady({ ready: true, built: 11, expected: 11, drawn: 0 }), false);
});

test('a completed warm-up render retires representatives even after bounded readiness times out', () => {
  assert.equal(cashGpuPrewarmShouldRelease({
    ready: false, built: 0, expected: 11, drawn: 0,
  }, { renderFinished: true }), true);
  assert.equal(cashGpuPrewarmShouldRelease({
    ready: true, built: 10, expected: 11, drawn: 10,
  }, { renderFinished: true }), true);
  assert.equal(cashGpuPrewarmShouldRelease({
    ready: false, built: 0, expected: 11, drawn: 0,
  }), false);
});

test('closed drawer presentation stays culled while every coin atlas prewarms', () => {
  assert.equal(drawerPresentationVisible(0, 0), false);
  assert.equal(drawerPresentationVisible(1, 0), true);
  assert.equal(drawerPresentationVisible(0, 0.5), true);
  for (const denomination of [0.01, 0.05, 0.1, 0.25, 0.5]) {
    assert.equal(shouldPrewarmDrawerCoin(denomination), true);
  }
  for (const denomination of [0, 1, 5, 10, 20, 50, null, undefined]) {
    assert.equal(shouldPrewarmDrawerCoin(denomination), false);
  }
});

test('the customer-held payment card presents its face toward the cashier', () => {
  const normal = new THREE.Vector3(0, 1, 0)
    .applyEuler(new THREE.Euler(CARD_HELD_PITCH, 0, 0));
  assert.ok(normal.z > 0.5, `held card face normal should point toward staff (+Z), got ${normal.z}`);
});
