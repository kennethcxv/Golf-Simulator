import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKOUT_ANIMATION_RATE,
  CHECKOUT_POS_TARGET_PADDING,
  CHECKOUT_POS_TEXT_SCALE,
  checkoutAnimationDelta,
  checkoutMonitorAccessibility,
  checkoutPreferences,
  setCheckoutPreference,
  shouldAutoConfirmExactChange,
} from '../src/sim/checkoutPreferences.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

test('checkout accessibility defaults preserve the production interaction', () => {
  const state = newGame('relaxed', 811);
  assert.deepEqual(checkoutPreferences(state), {
    largeTextAndTargets: false,
    reducedCameraMotion: false,
    fasterAnimations: false,
    automaticExactChange: false,
    confirmCashPurchase: true,
  });
  assert.equal(checkoutAnimationDelta(0.5, checkoutPreferences(state)), 0.5);
  assert.deepEqual(checkoutMonitorAccessibility(checkoutPreferences(state)), {
    textScale: 1,
    targetPadding: 0,
  });
});

test('preferences normalize booleans, migrate legacy simplified checkout, and reject unknown keys', () => {
  const state = { shop: { simpleCheckout: true }, uiPrefs: {} };
  assert.equal(checkoutPreferences(state).largeTextAndTargets, true);
  assert.equal(checkoutPreferences(state).automaticExactChange, true);
  assert.equal(setCheckoutPreference(state, 'largeTextAndTargets', false), true);
  assert.equal(checkoutPreferences(state).largeTextAndTargets, false, 'an explicit choice overrides the legacy fallback');
  assert.equal(setCheckoutPreference(state, 'notARealPreference', true), false);
  assert.equal(state.uiPrefs.checkout.notARealPreference, undefined);
});

test('faster animation and monitor scaling helpers are bounded and opt-in', () => {
  const enabled = { fasterAnimations: true, largeTextAndTargets: true };
  assert.equal(checkoutAnimationDelta(0.5, enabled), 0.5 * CHECKOUT_ANIMATION_RATE);
  assert.equal(checkoutAnimationDelta(-1, enabled), 0);
  assert.equal(checkoutAnimationDelta(Number.NaN, enabled), 0);
  assert.deepEqual(checkoutMonitorAccessibility(enabled), {
    textScale: CHECKOUT_POS_TEXT_SCALE,
    targetPadding: CHECKOUT_POS_TARGET_PADDING,
  });
});

test('automatic handoff is limited to exact cash and never bypasses card confirmation', () => {
  const noCashConfirm = { confirmCashPurchase: false };
  assert.equal(shouldAutoConfirmExactChange(noCashConfirm, 'exact'), true);
  assert.equal(shouldAutoConfirmExactChange(noCashConfirm, 'short'), false);
  assert.equal(shouldAutoConfirmExactChange(noCashConfirm, 'over'), false);
  assert.equal(shouldAutoConfirmExactChange(noCashConfirm, 'excess'), false);
  assert.equal(shouldAutoConfirmExactChange({ confirmCashPurchase: true }, 'exact'), false);
});

test('checkout accessibility choices survive the real save/load path', () => {
  const state = newGame('relaxed', 812);
  for (const [key, value] of Object.entries({
    largeTextAndTargets: true,
    reducedCameraMotion: true,
    fasterAnimations: true,
    automaticExactChange: true,
    confirmCashPurchase: false,
  })) {
    assert.equal(setCheckoutPreference(state, key, value), true);
  }
  const loaded = deserialize(serialize(state));
  assert.deepEqual(checkoutPreferences(loaded), checkoutPreferences(state));
});
