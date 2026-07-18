// Player-facing checkout accessibility preferences.
//
// These live under state.uiPrefs so they travel with manual saves, autosaves,
// and empire snapshots. Reading preferences is side-effect free; the laptop is
// the only place that writes them. Defaults deliberately preserve the tactile
// production checkout.

export const CHECKOUT_PREFERENCE_DEFAULTS = Object.freeze({
  largeTextAndTargets: false,
  reducedCameraMotion: false,
  fasterAnimations: false,
  automaticExactChange: false,
  confirmCashPurchase: true,
});

export const CHECKOUT_ANIMATION_RATE = 1.65;
export const CHECKOUT_POS_TEXT_SCALE = 1.14;
export const CHECKOUT_POS_TARGET_PADDING = 8;

const PREFERENCE_KEYS = new Set(Object.keys(CHECKOUT_PREFERENCE_DEFAULTS));
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

/**
 * Return a normalized snapshot without mutating a save. The old laptop's
 * `shop.simpleCheckout` flag never reached the active register; honour it as a
 * migration fallback until the player makes an explicit choice in the new UI.
 */
export function checkoutPreferences(state) {
  const saved = state?.uiPrefs?.checkout;
  const source = saved && typeof saved === 'object' ? saved : {};
  const legacySimplified = state?.shop?.simpleCheckout === true;
  return {
    largeTextAndTargets: owns(source, 'largeTextAndTargets')
      ? source.largeTextAndTargets === true
      : legacySimplified,
    reducedCameraMotion: source.reducedCameraMotion === true,
    fasterAnimations: source.fasterAnimations === true,
    automaticExactChange: owns(source, 'automaticExactChange')
      ? source.automaticExactChange === true
      : legacySimplified,
    confirmCashPurchase: owns(source, 'confirmCashPurchase')
      ? source.confirmCashPurchase !== false
      : true,
  };
}

export function setCheckoutPreference(state, key, enabled) {
  if (!state || !PREFERENCE_KEYS.has(key)) return false;
  if (!state.uiPrefs || typeof state.uiPrefs !== 'object') state.uiPrefs = {};
  if (!state.uiPrefs.checkout || typeof state.uiPrefs.checkout !== 'object') {
    state.uiPrefs.checkout = {};
  }
  state.uiPrefs.checkout[key] = Boolean(enabled);
  return true;
}

export function checkoutAnimationDelta(deltaSeconds, preferences) {
  const delta = Number(deltaSeconds);
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return delta * (preferences?.fasterAnimations ? CHECKOUT_ANIMATION_RATE : 1);
}

export function checkoutMonitorAccessibility(preferences) {
  const large = preferences?.largeTextAndTargets === true;
  return {
    textScale: large ? CHECKOUT_POS_TEXT_SCALE : 1,
    targetPadding: large ? CHECKOUT_POS_TARGET_PADDING : 0,
  };
}

export function shouldAutoConfirmExactChange(preferences, givingState) {
  return preferences?.confirmCashPurchase === false && givingState === 'exact';
}
