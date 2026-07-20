// Pure presentation routing for the physical checkout. Keeping these decisions out
// of the Three.js frame code makes every required camera/hand verb independently
// testable without mutating transaction state or constructing a renderer.

export const CASHIER_CAMERA_VIEW = Object.freeze({
  INACTIVE: 'inactive',
  WIDE: 'cashier-wide',
  SCAN: 'scan-focus',
});

export const CASHIER_CAMERA_FOV = Object.freeze({
  WIDE: 66,
  SCAN: 58,
});

export function cashierCameraView({ active = false, flowState = null, grabbedKind = null } = {}) {
  if (!active) return CASHIER_CAMERA_VIEW.INACTIVE;
  if (grabbedKind === 'item' && (flowState === 'ProductHeld' || flowState === 'ProductScanning')) {
    return CASHIER_CAMERA_VIEW.SCAN;
  }
  return CASHIER_CAMERA_VIEW.WIDE;
}

export function cashierItemPickSize({ weightLb = 0, gripMode = null } = {}) {
  if (gripMode === 'small' || gripMode === 'medium') return gripMode;
  if (gripMode === 'two-hand' || gripMode === 'oversize') return 'medium';
  return Number(weightLb) <= 0.5 ? 'small' : 'medium';
}

export function cashierHandPoseForFrame({
  active = false,
  transientPose = null,
  hoveredItem = false,
  grabbedKind = null,
  grabbedFrom = null,
  grabbedIsBill = false,
  itemPickSize = 'medium',
  itemScanned = false,
  txStage = null,
  flowState = null,
  drawerOpen = false,
  receiptTaken = false,
  cardVisible = false,
  cardMoving = false,
  changeHandoff = false,
  hasSelectedChange = false,
  bagHandoff = false,
} = {}) {
  if (!active) return 'idle';
  if (transientPose) return transientPose;

  if (grabbedKind === 'item') {
    if (txStage === 'bagging') return 'bag-item';
    if (flowState === 'ProductScanning') return 'scan';
    if (itemScanned || flowState === 'ProductScanned') return 'place-item';
    return itemPickSize === 'small' ? 'pick-small' : 'pick-medium';
  }
  if (grabbedKind === 'money') {
    if (grabbedFrom === 'hand') return 'hold-change';
    if (grabbedFrom === 'tender' && !drawerOpen) {
      return grabbedIsBill ? 'accept-bill' : 'accept-coin';
    }
    return grabbedIsBill ? 'deposit-bill' : 'deposit-coin';
  }
  if (grabbedKind === 'receipt') {
    return receiptTaken && txStage === 'bagging' ? 'add-receipt' : 'collect-receipt';
  }
  if (grabbedKind === 'bag') return 'hand-bag';

  if (changeHandoff) return 'give-change';
  if (bagHandoff) return 'hand-bag';
  if (cardVisible) return cardMoving ? 'swipe-card' : 'hold-card';
  if (hasSelectedChange) return 'hold-change';
  if (txStage === 'bagging') return 'open-bag';
  if (hoveredItem) return 'reach';
  return 'idle';
}
