// SIMPLIFIED FRONT DESK REGISTER
//
// The transaction engine in sim/register.js remains the sole authority for scans,
// payment, drawer balancing, receipts, fulfillment, and exact-once banking. This
// module only presents those verbs through a readable shared monitor and a few
// forgiving physical interactions. First-person hands appear only while they
// have a real prop target, keeping the shared counter readable between verbs.

import * as THREE from 'three';
import { REGISTER, COUNTER, COUNTER_TOP } from '../../data/shopLayout.js';
import { skuById } from '../../data/shopItems.js';
import {
  BILLS, DENOMS, createTx, scanItem, unscannedCount, requestPayment,
  subtotal, discountOf, totalOf, dueOf, cashTotalOf,
  presentCard, insertCard, cardEnteredAmount, enterCardDigit,
  backspaceCardAmount, clearCardAmount, submitCardAmount,
  runCard, retryCard, cancelCard, abandonCardBeforeSubmit, payCashInstead,
  recoverUnresolvedCardAuthorization, recoverCashAcceptedCheckpoint,
  customerCash, acceptCash, openDrawer,
  depositTendered, takeFromDrawer, returnToDrawer, changeDue, handTotal,
  handOverChange, changeGivingState, MAX_EXTRA_CHANGE_CENTS,
  printReceipt, takeReceipt, packReceipt, bagItem,
  handOverGoods, completeSale, voidTx, newDrawer, migrateDrawer, drawerContents,
  stackTotal, makeChange, makeChangeFrom,
} from '../../sim/register.js';
import {
  createCheckoutFlow, transitionCheckout, checkoutStateTimedOut,
  recoverTimedOutCheckout, resumeCheckout,
} from '../../sim/registerFlow.js';
import {
  checkoutAnimationDelta, checkoutMonitorAccessibility, checkoutPreferences,
  shouldAutoConfirmExactChange,
} from '../../sim/checkoutPreferences.js';
import { dueForCheckIn, fmtSlot } from '../../sim/reservations.js';
import {
  createReservationCheckInTx, finalizeReservationCheckIn,
} from '../../sim/reservationCheckIn.js';
import { BARCODE_MSG, barcodeFor, judgeBarcodeRead } from '../../sim/barcode.js';
import { createRegisterItemResources } from './registerItemResources.js';
import {
  buildCatalogProductProxy, catalogCheckoutLayout,
} from './catalogProductVisual.js';
import {
  barcodeBits, CHECKOUT_SCAN_TARGET,
  scanChoreographyAt, scanDuration, scannerReadFacts,
} from './checkoutScanPresentation.js';
import {
  changeBundleLayout, changeHandoffPoint, customerCardPoint, customerCashPoint,
  presentedTenderLayout, selectedChangeLayout as physicalChangeLayout,
} from './checkoutPaymentPresentation.js';
import { makeCashierHands } from './cashierHands.js';
import { createFrontDeskMonitorUi } from './frontDeskMonitorUi.js';
import {
  billFit, billLayout, clipFillRatio, coinLayout,
} from './drawerMoneyLayout.js';
import {
  cardHandoffPose, cardTerminalPose, fulfillmentHandoffPose,
} from './registerCameraPoses.js';
import { createScopedBooleanOverride } from './scopedBooleanOverride.js';
import { suppressInteriorSunShadows } from './interiorShadowPolicy.js';

const SCREEN_W = 1024;
const SCREEN_H = 640;
// the live POS canvas plane hung on the kit monitor's POS_Screen face
const POS_PLANE_W = 0.34;
const POS_PLANE_H = 0.2125;
// the live terminal canvas hung on the kit reader's Terminal_Screen face
const TERM_SCREEN_W = 0.070;
const TERM_SCREEN_H = 0.064;
const TERM_CANVAS_W = 512;
const TERM_CANVAS_H = 468;
export const TERMINAL_BUSY_DOT_HZ = 3;

export function terminalBusyDotPhase(elapsedSeconds) {
  const elapsed = Number(elapsedSeconds);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.floor(elapsed * TERMINAL_BUSY_DOT_HZ) % 3;
}

export function advanceTerminalBusyDots(elapsedSeconds, deltaSeconds) {
  const previousElapsed = Number.isFinite(Number(elapsedSeconds))
    ? Math.max(0, Number(elapsedSeconds))
    : 0;
  const delta = Number.isFinite(Number(deltaSeconds))
    ? Math.max(0, Number(deltaSeconds))
    : 0;
  const previousPhase = terminalBusyDotPhase(previousElapsed);
  const elapsed = previousElapsed + delta;
  const phase = terminalBusyDotPhase(elapsed);
  return { elapsed, phase, changed: phase !== previousPhase };
}
// the reader's cancel-the-run X, top-right of the screen, in canvas pixels
const TERM_X_BOX = { x0: TERM_CANVAS_W - 70, y0: 12, x1: TERM_CANVAS_W - 14, y1: 68 };
const REST_Y = COUNTER_TOP + 0.012;
const SCAN_Y = COUNTER_TOP + 0.13;
const CARD_TIME = 1.15;
const RECEIPT_TIME = 1.1;
const RECEIPT_READY_HOLD = 0.42;
const RECEIPT_DELIVER_TIME = 0.72;
const RECEIPT_CUSTOMER_HOLD = 0.62;
const BAG_DELIVER_TIME = 0.78;
const BAG_CUSTOMER_HOLD = 0.78;
const CARD_STOW_TIME = 0.44;
const CARD_PICKUP_DELAY = 0.30;
const RECEIPT_CASHIER_GRIP = new THREE.Vector3(0, 0.018, 0);

// The active register owns these automatic presentation/authorization states.
// Deliberate player waits are intentionally absent; customer approach, placement,
// and patience are owned by clubhouse.js before the register transaction begins.
export const SIMPLIFIED_REGISTER_WATCHDOG_STATES = Object.freeze([
  'EnteringCashierMode',
  'ProductHeld', 'ProductScanning', 'ProductScanned',
  'AllProductsScanned', 'ChoosingPayment',
  'CardPresented', 'CardInserting', 'CardProcessing', 'CardApproved',
  'CashAccepted', 'DrawerOpening', 'DepositingCash', 'GivingChange',
  'PaymentComplete', 'ReceiptPrinting', 'Bagging', 'BagHandoff', 'CustomerLeaving',
]);
const SIMPLIFIED_REGISTER_WATCHDOG_SET = new Set(SIMPLIFIED_REGISTER_WATCHDOG_STATES);
// ISO/IEC 7810 ID-1 proportions, kept at believable real-world scale.
const CARD_WIDTH = 0.086;
const CARD_HEIGHT = 0.054;
const CARD_THICKNESS = 0.0014;
export const CARD_HELD_PITCH = 0.62;
const CARD_STATION = Object.freeze({ x: REGISTER.cardterm.x, z: REGISTER.cardterm.z });

// Card staging, refined against the kit terminal's CARD_INSERT_SOCKET when it
// loads; these are the geometric fallbacks for the procedural reader.
const INSERT_READY = {
  x: CARD_STATION.x,
  y: COUNTER_TOP + 0.12,
  z: CARD_STATION.z + 0.40,
};
const INSERTED = {
  x: CARD_STATION.x,
  y: COUNTER_TOP + 0.075,
  z: CARD_STATION.z + 0.27,
};

const DRAWER_BILLS = [1, 5, 10, 20, 50];
const DRAWER_COINS = [0.01, 0.05, 0.1, 0.2, 0.5];
const SLOT = {};
const SLOT_META = {};
const SLOT_CLIP = {};
// Fallbacks only — the kit drawer's authored money sockets remap these on load.
// SLOT sits AT the compartment floor; SLOT_META mirrors the sockets' authored
// placement contract (world units after the kit scale is applied).
const FALLBACK_BILL_META = {
  well_w: 0.070, well_d: 0.250, wall_h: 0.053, max_pieces: 12, spacing: 0.0019, hinge_drop: 0.047,
};
const FALLBACK_COIN_META = {
  well_w: 0.070, well_d: 0.185, wall_h: 0.034, max_pieces: 30, pile_h: 0.0039,
};
DRAWER_BILLS.forEach((denom, index) => {
  SLOT[denom] = { x: -0.164 + index * 0.082, y: 0.101, z: 0.095 };
  SLOT_META[denom] = { ...FALLBACK_BILL_META };
});
DRAWER_COINS.forEach((denom, index) => {
  SLOT[denom] = { x: -0.164 + index * 0.082, y: 0.095, z: -0.098 };
  SLOT_META[denom] = { ...FALLBACK_COIN_META };
});
// the Sheet-02 note footprint (metres, pre kit-scale) — drawer bills stretch to fill
// their well the way the reference drawer reads, so the sizes matter here
const BILL_FOOTPRINT = {
  1: [0.122, 0.054], 5: [0.132, 0.057], 10: [0.142, 0.061], 20: [0.156, 0.066], 50: [0.156, 0.066],
};
// Sheet-02 coin blanks (diameter, metres, pre kit-scale) — the mound math needs
// each piece's real radius and thickness to keep piles inside their well
const COIN_BLANK = {
  0.01: 0.018, 0.05: 0.021, 0.1: 0.024, 0.2: 0.026, 0.5: 0.030,
};
// Money assets are authored in exact real-world metres.  Keep them at 1:1 so
// drawer fit, hand presentation, and denomination size comparisons stay true.
const MONEY_KIT_SCALE = 1.0;
const CLIP_LEVEL_QUAT = new THREE.Quaternion();

const moneyLabel = (denom) => (denom < 1
  ? `${Math.round(denom * 100)}¢`
  : `$${denom}`);

// Visual routing only: both five-unit variants keep the same logical
// denomination in transaction and save data. The larger Sheet-01 coin appears
// in incoming customer tender; the smaller Sheet-02 coin remains in the drawer
// and in selected change.
export function checkoutMoneyAssetStem(denom, from) {
  if (BILLS.includes(denom)) return `cash_bill_${denom}`;
  if (denom === 0.05 && from === 'tender') return 'cash_coin_05_sheet01';
  return `cash_coin_${String(Math.round(denom * 100)).padStart(2, '0')}`;
}

export function checkoutMoneyGpuPrewarmStems(denoms = DENOMS) {
  return [...new Set([
    ...denoms.map((denom) => checkoutMoneyAssetStem(denom, 'drawer')),
    checkoutMoneyAssetStem(0.05, 'tender'),
  ])];
}

export function cashGpuPrewarmReleaseReady({ ready, built, expected, drawn } = {}) {
  const expectedCount = Number(expected);
  return ready === true
    && Number.isInteger(expectedCount)
    && expectedCount > 0
    && Number(built) === expectedCount
    && Number(drawn) === expectedCount;
}

export function cashGpuPrewarmShouldRelease(status, { renderFinished = false } = {}) {
  // A bounded asset wait may expire before the merchandise callback fires. Once
  // the opaque warm-up render has finished, the offscreen representative root
  // must still be retired so late model readiness cannot leak hidden scene nodes.
  return renderFinished === true || cashGpuPrewarmReleaseReady(status);
}

export function shouldPrewarmDrawerCoin(denom) {
  const value = Number(denom);
  return Number.isFinite(value) && value > 0 && value < 1;
}

export function checkoutTexturePrewarmPlan({ itemTextures = [], coinTextures = [] } = {}) {
  const seen = new Set();
  const plan = [];
  const append = (kind, textures) => {
    for (const texture of textures) {
      if (!texture?.isTexture || seen.has(texture)) continue;
      seen.add(texture);
      plan.push({ kind, texture });
    }
  };
  // Products are the first player-facing camera transition. Coins remain paced
  // behind them and are ready before the drawer can open.
  append('item', itemTextures);
  append('coin', coinTextures);
  return plan;
}

export function drawerPresentationVisible(want, amount) {
  return Number(want) > 0 || Number(amount) > 0.001;
}

// Receipt printing reveals the strip by scaling local Y. Older loose-receipt
// exports placed their long edge on Z, so accepting them here would reveal the
// shallow paper thickness instead of its length. Reject that orientation and
// use the owned procedural strip below; current authored receipts keep Y as the
// dominant feed axis.
export function receiptGeometryUsesFeedAxis(size) {
  const x = Number(size?.x);
  const y = Number(size?.y);
  const z = Number(size?.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    && x > 0 && y > 0 && z >= 0
    && y >= x * 1.4 && y >= z * 1.4;
}

function textTexture(text, {
  width = 512,
  height = 192,
  background = '#173f2d',
  foreground = '#fff8e8',
  accent = '#b9974e',
  subline = '',
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.fillStyle = foreground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(height * 0.31)}px Arial, sans-serif`;
  ctx.fillText(String(text), width / 2, subline ? height * 0.40 : height / 2);
  if (subline) {
    ctx.fillStyle = '#d8dfcf';
    ctx.font = `600 ${Math.round(height * 0.15)}px Arial, sans-serif`;
    ctx.fillText(String(subline), width / 2, height * 0.72);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function productBarcodeTexture(code) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const bits = barcodeBits(code);
  ctx.fillStyle = '#fffdf5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#171916';
  const quiet = 34;
  const top = 18;
  const barHeight = 176;
  const moduleWidth = (canvas.width - quiet * 2) / Math.max(1, bits.length);
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] !== '1') continue;
    const guard = index < 3 || index >= bits.length - 3
      || Math.abs(index - bits.length / 2) < 3;
    ctx.fillRect(
      quiet + index * moduleWidth,
      top,
      Math.max(1, Math.ceil(moduleWidth)),
      guard ? barHeight + 13 : barHeight,
    );
  }
  ctx.fillStyle = '#173f2d';
  ctx.font = '600 27px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(code), canvas.width / 2, 226);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function billTexture(denom) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 168;
  const ctx = canvas.getContext('2d');
  const base = { 1: '#cad4bf', 5: '#d8c1b7', 10: '#c1ccd8', 20: '#c2d5be', 50: '#d2c6dc' }[denom];
  const ink = { 1: '#345033', 5: '#704238', 10: '#294a68', 20: '#285b34', 50: '#4b3562' }[denom];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, 368, 152);
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 348, 132);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = '700 72px Georgia, serif';
  ctx.fillText(String(denom), 78, 108);
  ctx.fillText(String(denom), 306, 108);
  ctx.font = '700 23px Georgia, serif';
  ctx.fillText('FAIRWAY RESERVE', 192, 64);
  ctx.font = '600 15px Arial, sans-serif';
  ctx.fillText('PINEHOLLOW', 192, 127);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function coinTexture(denom) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(55, 48, 8, 80, 80, 75);
  gradient.addColorStop(0, '#eef0ec');
  gradient.addColorStop(0.52, '#b2b6b1');
  gradient.addColorStop(1, '#777d79');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(80, 80, 76, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#626965';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(80, 80, 64, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#3f4742';
  ctx.textAlign = 'center';
  ctx.font = '700 55px Georgia, serif';
  ctx.fillText(String(Math.round(denom * 100)), 80, 92);
  ctx.font = '700 16px Arial, sans-serif';
  ctx.fillText('CENTS', 80, 121);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paymentCardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 768, 480);
  gradient.addColorStop(0, '#173f2d');
  gradient.addColorStop(1, '#0e2d21');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 768, 480);
  ctx.strokeStyle = '#b9974e';
  ctx.lineWidth = 8;
  ctx.strokeRect(20, 20, 728, 440);
  ctx.fillStyle = '#f8f0dc';
  ctx.font = '700 52px Georgia, serif';
  ctx.fillText('PINEHOLLOW', 58, 105);
  ctx.fillStyle = '#d6bd81';
  ctx.font = '700 24px Arial, sans-serif';
  ctx.fillText('FAIRWAY MEMBER', 60, 150);
  ctx.fillStyle = '#d9bd76';
  ctx.fillRect(62, 210, 145, 105);
  ctx.strokeStyle = '#73551f';
  ctx.lineWidth = 4;
  ctx.strokeRect(62, 210, 145, 105);
  ctx.fillStyle = '#f8f0dc';
  ctx.font = '600 27px monospace';
  ctx.fillText('MEMBER 042 718', 62, 382);
  ctx.fillStyle = '#d6bd81';
  ctx.font = 'italic 22px Georgia, serif';
  ctx.fillText('Play the long game.', 510, 410);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function orientPlane(plane, cx, cy, cz, nx, ny, nz) {
  plane.position.set(cx, cy, cz);
  const normal = new THREE.Vector3(nx, ny, nz).normalize();
  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.dot(up)) > 0.97) up = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(normal, right).normalize();
  plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, correctedUp, normal));
  plane.translateZ(0.006);
}

export function createRegisterMode(B) {
  const { interior, mats, merch, hooks, state, L2W } = B;
  const camera = B.ctx.camera;
  const renderer = B.ctx.renderer || null;
  const canvas = B.ctx.canvas || document.querySelector('canvas');
  const focusOn = B.ctx.focusOn || (() => {});
  const clearFocus = B.ctx.clearFocus || (() => {});
  const sfx = (name) => { if (hooks.sfx) hooks.sfx(name); };
  const toast = (message, kind) => (hooks.toast ? hooks.toast(message, kind) : null);
  const activeRegisterGtaoOverride = createScopedBooleanOverride({
    read: B.ctx.postEffects?.getGtaoEnabled,
    write: B.ctx.postEffects?.setGtaoEnabled,
    overrideValue: false,
  });
  // The laptop cannot be open while the cashier station owns input, so one
  // normalized snapshot per entry keeps the frame loop allocation-free. A new
  // transaction/entry refreshes choices made since the last visit.
  let accessibilityPrefs = checkoutPreferences(state);
  const refreshAccessibilityPreferences = () => {
    accessibilityPrefs = checkoutPreferences(state);
    return accessibilityPrefs;
  };

  const root = new THREE.Group();
  root.name = 'SimplifiedFrontDeskRegister';
  interior.add(root);
  const cashierHands = makeCashierHands(root);
  suppressInteriorSunShadows(cashierHands.root);

  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = SCREEN_W;
  screenCanvas.height = SCREEN_H;
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.anisotropy = 8;
  const screenMaterial = new THREE.MeshBasicMaterial({
    map: screenTexture,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const monitorUi = createFrontDeskMonitorUi(screenCanvas);
  let screenPlane = null;
  let registerFurniture = null;

  // THE ONE PHYSICAL PAYMENT TERMINAL. Its GLB is the only card device: the
  // live canvas hangs on its Terminal_Screen face, its Terminal_Key_* meshes
  // are the clickable keypad, and the card enters its CARD_INSERT_SOCKET.
  // There is no floating keypad panel and no second reader model.
  const termCanvas = document.createElement('canvas');
  termCanvas.width = TERM_CANVAS_W;
  termCanvas.height = TERM_CANVAS_H;
  const termContext = termCanvas.getContext('2d');
  const termGlow = termContext.createLinearGradient(0, 0, 0, TERM_CANVAS_H);
  termGlow.addColorStop(0, '#16211c');
  termGlow.addColorStop(1, '#0b110e');
  const termTexture = new THREE.CanvasTexture(termCanvas);
  termTexture.colorSpace = THREE.SRGBColorSpace;
  termTexture.anisotropy = 8;
  const termMaterial = new THREE.MeshBasicMaterial({
    map: termTexture,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  let termObject = null;
  let termScreenPlane = null;
  const termKeys = new Map();       // label -> { mesh, base, press }
  let cardSocketNode = null;

  // The authored counter scanner is the one physical read source. Products
  // commit only while their visible barcode crosses this socket's +Z ray.
  let scannerObject = null;
  let scannerRayOrigin = null;
  const scannerFeedback = [];
  let scannerFeedbackMode = 'idle';
  let scannerPulse = 0;
  let lastScanEvidence = null;

  let printerRoll = null;
  let printerPaper = null;
  let printerOutputSocket = null;
  let printerPaperBaseY = 0;
  let receiptMesh = null;
  let receiptTimer = 0;
  let autoFulfilled = false;
  let finalizeTimer = 0;

  function disposeReceiptMesh() {
    if (!receiptMesh) return false;
    receiptMesh.removeFromParent();
    if (receiptMesh.geometry) receiptMesh.geometry.dispose();
    const materials = Array.isArray(receiptMesh.material) ? receiptMesh.material : [receiptMesh.material];
    for (const material of materials) {
      if (!material) continue;
      if (material.map) material.map.dispose();
      material.dispose();
    }
    receiptMesh = null;
    return true;
  }

  // The shopping bag sits at counter-left; a clicked product arcs into its mouth
  // and drops out of sight (it is now "in the bag"). Positions are tuned to the
  // reference composition and refined once the rebuilt bag asset lands.
  let bagGroup = null;
  let bagContentsNode = null;
  let bagHandoffNode = null;
  const BAG_COUNTER_SCALE = 0.86;
  const bagHandoffLocal = new THREE.Vector3(0, 0.30, 0);
  const bagDeliverAnchorFrom = new THREE.Vector3();
  const bagDeliverAnchorAt = new THREE.Vector3();
  let bagDeliverScaleFrom = BAG_COUNTER_SCALE;
  // Counter-left, toward the staff edge, so it sits in the near-left of the
  // cashier frame like the reference (and clear of the POS at x 2.25).
  const BAG_POS = new THREE.Vector3(REGISTER.bag.x, COUNTER_TOP, REGISTER.bag.z);
  const bagMouth = new THREE.Vector3(BAG_POS.x + 0.02, COUNTER_TOP + 0.18, BAG_POS.z - 0.03);

  const itemResources = createRegisterItemResources();
  const itemMeshes = new Map();
  // One representative of every authored cash model sits well outside the
  // player frustum only while courseScene performs its opaque-veil GPU warm-up.
  // That warm-up temporarily disables frustum culling, so the exact shared
  // geometry/materials used by later tender clones receive one real draw. The
  // representatives are then detached without disposing their shared assets.
  const cashGpuPrewarmRoot = new THREE.Group();
  cashGpuPrewarmRoot.name = 'CheckoutCashGpuPrewarm';
  cashGpuPrewarmRoot.position.set(0, -1000, 0);
  root.add(cashGpuPrewarmRoot);
  const cashGpuPrewarmExpected = checkoutMoneyGpuPrewarmStems().length;
  let cashGpuPrewarmReleased = false;
  let cashGpuPrewarmReady = false;
  let cashGpuPrewarmBuilt = 0;
  let cashGpuPrewarmDrawn = 0;
  let cashGpuPrewarmReleasedCount = 0;
  const cashGpuPrewarmWaiters = new Set();
  let drawerPrewarmToken = 0;
  let drawerPrewarm = {
    kind: 'checkout-first-use-textures',
    pendingTextures: 0,
    warmedTextures: 0,
    item: { total: 0, pending: 0, warmed: 0 },
    coin: { total: 0, pending: 0, warmed: 0 },
    complete: true,
  };
  const loose = [];
  // A product remains a one-click target, but the owned mesh and barcode now
  // cross the physical reader before the transaction engine receives its scan.

  const hoverBounds = new THREE.Box3();
  const hoverBox = new THREE.Box3Helper(hoverBounds, 0xb9974e);
  hoverBox.visible = false;
  root.add(hoverBox);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const projection = new THREE.Vector3();

  let active = false;
  let tx = null;
  let cust = null;
  let transactionKind = 'retail';
  let activeTab = 'checkout';
  let workspace = 'monitor';

  function assignWorkspace(next) {
    workspace = next;
  }
  let selectedReservationId = null;
  let selectedWalkInCustomerId = null;
  let checkInPage = 0;
  let postSaleDisplay = null;
  let restorePointerLock = false;
  let pointerRestoreTimer = null;
  let previousFov = null;
  let cameraPose = null;
  let activePoseKey = null;
  // mouse look-around WITHIN the pose: the cursor's screen position leans the
  // head (left edge looks left, top looks up), eased so it feels like a neck
  let lookYaw = 0;
  let lookPitch = 0;
  let lookTargetYaw = 0;
  let lookTargetPitch = 0;
  let enterTimer = 0;
  // receipt/bag delivery sequencing: null | 'receipt-print' | 'receipt-ready'
  // | 'receipt-deliver' | 'receipt-customer-hold' | 'bag-deliver'
  // | 'bag-customer-hold' | 'released'
  let deliveryPhase = null;
  let deliveryTimer = 0;
  let deliveryFrom = null;
  let deliveryTo = null;

  let selectedItem = null;
  let scanDrag = null;
  let scanMotion = null;
  let scanReturnTimer = 0;
  let paymentAutoTimer = 0;
  let hoveredItem = null;

  let cardMesh = null;
  let cardU = 0;
  let cardPresentationTimer = 0;
  let cardProcessingTimer = 0;
  let cardResultTimer = 0;
  let insertDrag = null;
  let insertSnap = false;
  let insertMessage = '';
  let cardEjectTimer = 0;
  let cardPickupDelay = 0;

  let drawer = null;
  let drawerWant = 0;
  let drawerAmount = 0;
  let drawerGroup = null;
  let drawerMotionRoot = null;
  let drawerMoney = null;
  let drawerAssetSlide = null;
  let drawerAssetSlideBaseZ = 0;
  let drawerAssetSlideWorldScale = 1;
  const slotHotspots = [];
  const slotLabels = [];
  const slotTags = {};
  let tenderMeshes = [];
  let tenderHandful = null;
  let selectedChangeMeshes = [];
  let cashMotions = [];
  let cashMotionRefillPending = false;
  let exactChangeAssistancePending = false;
  let cashAutoConfirmPhase = 'idle'; // idle | waiting | fired
  let cashAutoConfirmTimer = 0;
  let cashRecoveryTimer = 0;
  let cashHandoffBundle = null;
  let cashHandoffHoldTimer = 0;
  let cashHandoffPhase = null;
  let cashierCashAction = null;
  let cashValidationToast = null;
  let checkoutWatchdogRunning = false;
  let checkoutWatchdogPostResume = null;
  const checkoutWatchdogEvents = [];

  function clearCashValidationToast() {
    if (cashValidationToast && typeof cashValidationToast.remove === 'function') {
      cashValidationToast.remove();
    }
    cashValidationToast = null;
  }

  function cashValidationWarning(message) {
    clearCashValidationToast();
    cashValidationToast = toast(message, 'warn');
    return cashValidationToast;
  }

  const flowNow = () => performance.now();
  const checkoutFlowState = () => (tx && tx.checkoutFlow ? tx.checkoutFlow.state : null);
  const preferredPayment = () => (
    (tx && (tx.prefer === 'cash' || tx.prefer === 'card') && tx.prefer)
    || (cust && (cust.paymentPreference === 'cash' || cust.paymentPreference === 'card') && cust.paymentPreference)
    || (cust && (cust.payMethod === 'cash' || cust.payMethod === 'card') && cust.payMethod)
    || 'card'
  );

  function paymentChoiceLine() {
    const name = cust && (cust.fullName || cust.name) ? (cust.fullName || cust.name) : 'Customer';
    return preferredPayment() === 'cash'
      ? `${name}: Cash is fine.`
      : `${name}: I'll use my card.`;
  }

  function paymentChoiceVisible() {
    if (!tx) return Boolean(postSaleDisplay && postSaleDisplay.method);
    if (tx.stage === 'scanning') return unscannedCount(tx) === 0;
    return tx.stage !== 'void';
  }

  function syncFlow(flow) {
    if (!tx || !flow) return false;
    tx.checkoutFlow = flow;
    if (cust) cust.checkoutFlow = flow;
    return true;
  }

  function flowTo(next, event) {
    if (!tx || !tx.checkoutFlow) return false;
    const result = transitionCheckout(tx.checkoutFlow, next, {
      nowMs: flowNow(),
      event,
    });
    if (!result.ok) return false;
    syncFlow(result.flow);
    drawScreen();
    return true;
  }

  function poseBetween(eye, at) {
    const world = L2W(eye.x, eye.z);
    const dx = at.x - eye.x;
    const dy = at.y - eye.y;
    const dz = at.z - eye.z;
    const horizontal = Math.hypot(dx, dz) || 1;
    return {
      x: world.x,
      y: interior.position.y + eye.y,
      z: world.z,
      yaw: Math.atan2(-dx / horizontal, -dz / horizontal),
      pitch: Math.atan2(dy, horizontal),
    };
  }

  // STATE-SPECIFIC CAMERA PRESETS. One compromised angle cannot serve reading a
  // reservation, keying a terminal, and counting a drawer. Each checkout state
  // owns a pose (eye, look-target, fov); transitions are short timed tweens,
  // and the mouse leans the view around each pose (see updateCamera) so the
  // cashier can glance left and right without leaving the station.
  // Eyes sit at STANDING height (~1.7) — the till is worked upright, looking
  // DOWN at the counter, never chin-on-the-glass.
  //   overview  – goods centre, readable POS right, customer across the counter.
  //   checkin   – nearly straight-on, POS dominates the frame.
  //   scan      – every unscanned product + bag mouth + POS.
  //   cash      – POS above, open drawer below, both readable at once.
  // The card flow's two frames (cardTake handoff, card terminal-entry) are NOT
  // here: they are computed live in dynamicPose() from where the customer stands
  // and where the terminal floats, so they track a moving subject.
  // THE ONE WORKING FRAME. Browsing, scanning and the receipt all share a single composed
  // pose — goods on the left half, POS readable on the right, reference-style — so serving
  // a customer stops feeling like a camera ride. Only the drawer (cash), the terminal
  // (card) and the check-in tab still move the eye, because their hardware needs it.
  const MIXED_POSE = { pose: poseBetween(
    { x: 2.84, y: 1.70, z: 5.38 },
    { x: 2.96, y: 1.26, z: 4.05 },
  ), fov: 50 };
  const POSES = {
    overview: MIXED_POSE,
    checkin: { pose: poseBetween(
      { x: 3.42, y: 1.68, z: 5.02 },
      { x: 3.42, y: 1.44, z: 4.37 },
    ), fov: 42 },
    scan: MIXED_POSE,
    cash: { pose: poseBetween(
      { x: 3.42, y: 2.12, z: 5.78 },
      { x: 3.42, y: 0.72, z: 4.66 },
    ), fov: 50 },
  };

  // A timed, eased move between two poses: short, predictable, and stable while
  // the player is clicking (no perpetual exponential drift under the cursor).
  const CAMERA_TWEEN_SECONDS = 0.30;
  let cameraTween = null;

  function lerpPose(a, b, t) {
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: a.yaw + dy * t,
      pitch: a.pitch + (b.pitch - a.pitch) * t,
    };
  }

  function setNdc(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  // how far the head leans with the cursor: enough to glance around the shop
  // from the till, never enough to lose the station
  const LOOK_YAW_MAX = 0.34;
  const LOOK_PITCH_MAX = 0.16;

  function updateLookTarget(event) {
    // Product clicks must not steer the composed scan view toward the last
    // item and push the next edge item off-screen. Keep this workspace fixed;
    // the cursor still raycasts every product without moving the camera.
    if (accessibilityPrefs.reducedCameraMotion || workspace === 'scan') {
      lookTargetYaw = 0;
      lookTargetPitch = 0;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const nyRaw = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    lookTargetYaw = -THREE.MathUtils.clamp(nx, -1, 1) * LOOK_YAW_MAX;
    lookTargetPitch = -THREE.MathUtils.clamp(nyRaw, -1, 1) * LOOK_PITCH_MAX;
  }

  function projectLocal(point) {
    projection.set(
      point.x + interior.position.x,
      point.y + interior.position.y,
      point.z + interior.position.z,
    );
    projection.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((projection.x + 1) / 2) * rect.width,
      y: rect.top + ((-projection.y + 1) / 2) * rect.height,
    };
  }

  function monitorActionAt(event) {
    if (!screenPlane) return null;
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(screenPlane, false)[0];
    if (!hit || !hit.uv) return null;
    return monitorUi.hit(hit.uv.x * SCREEN_W, (1 - hit.uv.y) * SCREEN_H);
  }

  function reservationBridge() {
    return B.frontDeskReservations || null;
  }

  // Where the current customer is, in register-local space.
  function customerLocalPosition() {
    if (cust && cust.mesh) {
      root.updateMatrixWorld(true);
      const world = cust.mesh.getWorldPosition(new THREE.Vector3());
      return root.worldToLocal(world);
    }
    return new THREE.Vector3(1.60, 0, 3.05); // the head of the counter queue
  }

  function customerGripNode(side = 'R') {
    const char = cust && cust.mesh && cust.mesh.userData && cust.mesh.userData.char;
    return char && typeof char.carryGrip === 'function' ? char.carryGrip(side) : null;
  }

  function customerGripPoint(side = 'R') {
    const grip = customerGripNode(side);
    if (!grip) return null;
    root.updateMatrixWorld(true);
    cust.mesh.updateMatrixWorld(true);
    return root.worldToLocal(grip.getWorldPosition(new THREE.Vector3()));
  }

  function poseCustomerForCheckout(mode) {
    const char = cust && cust.mesh && cust.mesh.userData && cust.mesh.userData.char;
    if (!char) return false;
    char.setMode(mode);
    char.update(0);
    cust.mesh.updateMatrixWorld(true);
    return true;
  }

  function checkoutWatchdogFacts() {
    const paymentAuthorized = !!(tx && (
      tx.cardResult === 'approved'
      || ['receipt', 'bagging', 'done', 'complete'].includes(tx.stage)
    ));
    return {
      allProductsScanned: !!(tx && unscannedCount(tx) === 0),
      allScannedItemsStaged: !!(tx && tx.items.every((item) => !item.scanned || item.staged)),
      paymentAuthorized,
      customerOwnsBag: deliveryPhase === 'released',
      saleBanked: !!(tx && tx.banked),
    };
  }

  function clearCardWatchdogWork() {
    // Authorization is synchronous in the domain; the renderer's timer is its
    // only pending callback. Zero it before changing tx.stage so no late result
    // can land after the recovery checkpoint resumes.
    cardProcessingTimer = 0;
    termDotsTimer = 0;
    cardResultTimer = 0;
    cardEjectTimer = 0;
    cardPickupDelay = 0;
    insertDrag = null;
    insertSnap = false;
    cardU = 0;
    insertMessage = '';
  }

  function restoreAcceptedTenderMeshes() {
    tenderMeshes.forEach((mesh) => mesh.removeFromParent());
    selectedChangeMeshes.forEach((mesh) => mesh.removeFromParent());
    clearCashHandoffBundle();
    cashMotions.forEach((motion) => motion.mesh.removeFromParent());
    tenderMeshes = [];
    selectedChangeMeshes = [];
    cashMotions = [];
    cashMotionRefillPending = false;
    clearTenderHandful();
    const bundle = new THREE.Vector3(
      REGISTER.changeHandoff.x,
      COUNTER_TOP + 0.13,
      REGISTER.changeHandoff.z + 0.01,
    );
    let pieceIndex = 0;
    for (const [rawDenom, count] of Object.entries(tx.tendered || {})) {
      for (let index = 0; index < count; index += 1) {
        const mesh = makeMoney(Number(rawDenom), 'tender');
        mesh.userData.pick = false;
        mesh.position.copy(bundle).add(new THREE.Vector3(
          ((pieceIndex % 3) - 1) * 0.012,
          Math.floor(pieceIndex / 3) * 0.005,
          (pieceIndex % 2 ? 1 : -1) * 0.008,
        ));
        root.add(mesh);
        tenderMeshes.push(mesh);
        pieceIndex += 1;
      }
    }
  }

  function reconcileCheckoutWatchdog(fromState, resumeState) {
    scanDrag = null;
    selectedItem = null;
    hoveredItem = null;
    hoverBox.visible = false;
    setHoverCursor(false);
    clearCashValidationToast();

    if (resumeState === 'WaitingForCashier') {
      enterTimer = 0;
      setWorkspace('monitor');
      return { ok: true };
    }

    if (resumeState === 'WaitingForScan' || resumeState === 'AllProductsScanned') {
      if (scanMotion) {
        const item = tx.items.find((entry) => entry.uid === scanMotion.mesh?.userData?.uid);
        if (item?.scanned && item?.staged) settleScannedProduct(scanMotion.mesh);
        else layoutGoods();
      }
      scanMotion = null;
      setScannerFeedback('idle');
      scanReturnTimer = 0;
      paymentAutoTimer = 0;
      setWorkspace(resumeState === 'WaitingForScan' ? 'scan' : 'monitor');
      return { ok: true };
    }

    if (resumeState === 'ChoosingPayment') {
      if (tx.stage !== 'scanning' || unscannedCount(tx) !== 0) {
        return { ok: false, reason: 'Payment choice no longer matches the scanned basket.' };
      }
      paymentAutoTimer = 0;
      setWorkspace('monitor');
      return { ok: true };
    }

    if (resumeState === 'CardInsertReady') {
      if (tx.method !== 'card' || tx.stage !== 'card-ready') {
        return { ok: false, reason: 'Card insertion recovery lost its unapproved card checkpoint.' };
      }
      clearCardWatchdogWork();
      if (!cardMesh) createCardMesh();
      cardTravel.ready.copy(customerCardReadyPoint());
      if (cardMesh) cardMesh.position.copy(cardTravel.ready);
      setWorkspace('card');
      return { ok: true };
    }

    if (resumeState === 'CardPresented') {
      clearCardWatchdogWork();
      if (fromState === 'CardProcessing') {
        const rollback = recoverUnresolvedCardAuthorization(tx);
        if (!rollback.ok) return rollback;
      }
      if (tx.method !== 'card' || tx.stage !== 'card-present') {
        return { ok: false, reason: 'Card presentation recovery has no unresolved card.' };
      }
      if (cardMesh) cardMesh.removeFromParent();
      cardMesh = null;
      createCardMesh();
      cardTravel.ready.copy(customerCardReadyPoint());
      cardPresentationTimer = 0.55;
      setWorkspace('card');
      return { ok: true };
    }

    if (resumeState === 'CashAccepted') {
      const rollback = recoverCashAcceptedCheckpoint(tx, drawer);
      if (!rollback.ok) return rollback;
      restoreAcceptedTenderMeshes();
      drawerWant = 0;
      drawerAmount = 0;
      if (drawerMotionRoot) drawerMotionRoot.position.z = 0;
      if (drawerAssetSlide) drawerAssetSlide.position.z = drawerAssetSlideBaseZ;
      refillDrawerMoney();
      exactChangeAssistancePending = false;
      cashAutoConfirmPhase = 'idle';
      cashAutoConfirmTimer = 0;
      cashRecoveryTimer = 0;
      setWorkspace('cash');
      return { ok: true };
    }

    if (['PaymentComplete', 'ReceiptPrinting', 'Bagging', 'CustomerLeaving'].includes(resumeState)) {
      if (!checkoutWatchdogFacts().paymentAuthorized) {
        return { ok: false, reason: 'Paid presentation recovery has no authorization checkpoint.' };
      }
      clearCardWatchdogWork();
      if (cardMesh) cardMesh.removeFromParent();
      cardMesh = null;
      receiptTimer = 0;
      deliveryTimer = 0;
      finalizeTimer = 0;
      if (resumeState === 'Bagging') {
        autoFulfilled = false;
        deliveryPhase = null;
        if (transactionKind === 'retail') resetBagAtCounter();
      }
      setWorkspace('monitor');
      return { ok: true };
    }

    return { ok: false, reason: `No simplified-register recovery adapter for ${resumeState}.` };
  }

  function runCheckoutWatchdogPostResume() {
    const resumeState = checkoutWatchdogPostResume;
    if (!resumeState || !tx || checkoutFlowState() !== resumeState) {
      checkoutWatchdogPostResume = null;
      return false;
    }
    checkoutWatchdogPostResume = null;
    if (resumeState === 'WaitingForCashier') {
      leave({ restorePointer: false });
      return true;
    }
    if (resumeState === 'AllProductsScanned' || resumeState === 'ChoosingPayment') {
      paymentAutoTimer = 0.35;
      return true;
    }
    if (resumeState === 'CashAccepted') {
      cashRecoveryTimer = 0.22;
      return true;
    }
    if (resumeState === 'PaymentComplete' || resumeState === 'ReceiptPrinting') {
      beginAutomaticReceipt();
      return true;
    }
    if (resumeState === 'Bagging') {
      ensureReceiptMesh({ fullyExposed: true, resetToPrinter: true });
      finishAutomaticFulfillment();
      return true;
    }
    if (resumeState === 'CustomerLeaving') {
      if (tx.stage === 'done' && autoFulfilled && deliveryPhase === 'released') finalizeTimer = 0.2;
      return true;
    }
    return false;
  }

  function updateCashWatchdogRecovery(dt) {
    if (cashRecoveryTimer <= 0) return false;
    cashRecoveryTimer = Math.max(0, cashRecoveryTimer - dt);
    if (cashRecoveryTimer > 0) return true;
    if (!sortReceivedCash()) {
      toast('Cash recovery could not reopen the transaction-local drawer.', 'warn');
      return true;
    }
    setWorkspace('cash');
    return true;
  }

  function recoverCheckoutWatchdog(nowMs = flowNow()) {
    const flow = tx && tx.checkoutFlow;
    if (!flow || checkoutWatchdogRunning
        || !SIMPLIFIED_REGISTER_WATCHDOG_SET.has(flow.state)
        || !checkoutStateTimedOut(flow, nowMs)) return false;
    checkoutWatchdogRunning = true;
    const fromState = flow.state;
    try {
      const entered = recoverTimedOutCheckout(flow, {
        nowMs,
        facts: checkoutWatchdogFacts(),
      });
      if (!entered.ok) return false;
      syncFlow(entered.flow);
      const resumeState = entered.flow.recovery.resumeState;
      const reconciled = reconcileCheckoutWatchdog(fromState, resumeState);
      if (!reconciled.ok) {
        checkoutWatchdogEvents.push({
          atMs: nowMs, fromState, resumeState, ok: false, reason: reconciled.reason,
          recoverySequence: entered.flow.sequence,
        });
        checkoutWatchdogEvents.splice(0, Math.max(0, checkoutWatchdogEvents.length - 16));
        toast(`Checkout recovery paused safely: ${reconciled.reason}`, 'warn');
        drawScreen();
        drawTerm();
        return true;
      }
      const resumed = resumeCheckout(tx.checkoutFlow, { nowMs: nowMs + 0.001 });
      if (!resumed.ok) {
        toast(`Checkout recovery could not resume: ${resumed.reason}`, 'warn');
        return true;
      }
      syncFlow(resumed.flow);
      checkoutWatchdogPostResume = resumeState;
      checkoutWatchdogEvents.push({
        atMs: nowMs,
        fromState,
        resumeState,
        ok: true,
        recoverySequence: entered.flow.sequence,
        resumeSequence: resumed.flow.sequence,
      });
      checkoutWatchdogEvents.splice(0, Math.max(0, checkoutWatchdogEvents.length - 16));
      toast(`Checkout recovered from ${fromState}.`);
      drawScreen();
      drawTerm();
      return true;
    } finally {
      checkoutWatchdogRunning = false;
    }
  }

  function customerAnchor(yOffset = 1.18, side = 'R') {
    const grip = customerGripPoint(side);
    if (grip) return grip;
    const at = customerLocalPosition();
    return new THREE.Vector3(at.x, yOffset, at.z + 0.18);
  }

  function bagHandlePoint() {
    if (!bagGroup) return null;
    root.updateMatrixWorld(true);
    bagGroup.updateWorldMatrix(true, true);
    return root.worldToLocal(bagGroup.localToWorld(bagHandoffLocal.clone()));
  }

  function customerHandPoint(y = COUNTER_TOP + 0.06) {
    const grip = customerGripPoint('R');
    if (grip) return grip;
    const at = customerLocalPosition();
    // the customer reaches OUT over the counter to hand payment across — z sits
    // just past the counter's front edge (3.7), above the surface, so the card
    // or cash fan is held clear of the customer's body and their carried goods
    return new THREE.Vector3(
      THREE.MathUtils.clamp(at.x, 2.0, 3.4),
      y,
      3.9,
    );
  }

  function customerCardReadyPoint() {
    const point = customerCardPoint(customerHandPoint(COUNTER_TOP + 0.30));
    return new THREE.Vector3(point.x, point.y, point.z);
  }

  function customerChangePoint() {
    const point = changeHandoffPoint(customerHandPoint(COUNTER_TOP + 0.06));
    return new THREE.Vector3(point.x, point.y, point.z);
  }

  function reservationsWaiting() {
    const bridge = reservationBridge();
    const list = bridge && typeof bridge.list === 'function'
      ? bridge.list()
      : dueForCheckIn(state);
    return [...(list || [])].sort((a, b) => a.minute - b.minute || a.id - b.id);
  }

  function walkInsWaiting() {
    const bridge = reservationBridge();
    return bridge && typeof bridge.walkIns === 'function' ? bridge.walkIns() : [];
  }

  function activeWalkIn() {
    return walkInsWaiting().find((customer) => customer.customerId === selectedWalkInCustomerId) || null;
  }

  function walkInSlots(customerId) {
    const bridge = reservationBridge();
    return bridge && typeof bridge.walkInSlotsFor === 'function'
      ? bridge.walkInSlotsFor(customerId)
      : [];
  }

  function activeReservation() {
    return reservationsWaiting().find((reservation) => reservation.id === selectedReservationId) || null;
  }

  function readyReservationCustomer(reservationId) {
    const bridge = reservationBridge();
    if (!bridge) return null;
    if (typeof bridge.readyCustomerFor === 'function') {
      return bridge.readyCustomerFor(reservationId);
    }
    const customer = typeof bridge.customerFor === 'function'
      ? bridge.customerFor(reservationId)
      : null;
    return customer && customer.queued && !customer.reservationReleased
      && customer.checkoutPhase === 'reservation-waiting'
      ? customer
      : null;
  }

  function checkoutStage() {
    if (postSaleDisplay && !tx) return 'complete';
    if (!tx) return 'waiting';
    if (tx.stage === 'scanning') {
      if (unscannedCount(tx) === 0) return 'all-items-scanned';
      return workspace === 'scan' ? 'scanning' : 'products-ready';
    }
    if (tx.stage === 'payment') return 'select-payment';
    if (tx.stage.startsWith('card')) return 'card-payment';
    if (tx.stage === 'cash-tender') return 'cash-payment';
    if (tx.stage === 'cash-drawer') return tx.deposited ? 'change-selection' : 'cash-payment';
    if (deliveryPhase === 'receipt-deliver') return 'receipt-delivering';
    if (deliveryPhase === 'bag-deliver') return 'bag-transfer';
    if (tx.stage === 'receipt') return 'payment-complete';
    if (tx.stage === 'bagging' || tx.stage === 'done') return 'ready-to-finalize';
    return 'waiting';
  }

  function checkoutStatus() {
    if (postSaleDisplay && !tx) return 'TRANSACTION COMPLETE';
    if (!tx) return 'WAITING FOR CUSTOMER';
    if (tx.stage === 'card-busy') return 'PROCESSING';
    if (tx.stage === 'card-declined') return tx.cardResult === 'timeout' ? 'CARD TIMEOUT' : 'CARD DECLINED';
    if (tx.stage === 'receipt' || tx.stage === 'bagging') return 'PAYMENT ACCEPTED';
    if (tx.stage === 'done') return autoFulfilled ? 'HANDOFF IN PROGRESS' : 'HANDOFF PAUSED';
    if (tx.stage === 'cash-drawer' && tx.deposited) {
      const delta = Math.round((handTotal(tx) - changeDue(tx)) * 100);
      return delta === 0 ? 'CHANGE READY' : 'SELECT CHANGE';
    }
    if (tx.stage === 'cash-drawer') return 'SORT RECEIVED CASH';
    if (tx.stage === 'cash-tender') return 'CASH PRESENTED';
    if (tx.stage === 'card-entry') return tx.cardEntryError || 'CONFIRM CARD TOTAL';
    if (tx.stage === 'card-ready') return 'CLICK THE CARD';
    if (tx.stage === 'card-present') return 'CARD PRESENTED';
    if (unscannedCount(tx) === 0) return 'ALL ITEMS SCANNED';
    return workspace === 'scan' ? 'SCANNING ITEMS' : 'PRODUCTS READY';
  }

  function checkoutInstruction() {
    if (!tx) return 'The register is ready for the next customer.';
    if (tx.stage === 'scanning') {
      if (unscannedCount(tx)) {
        return 'Click each product on the counter to ring it up and bag it.';
      }
      return `The customer is getting their ${preferredPayment() === 'cash' ? 'cash' : 'card'} out.`;
    }
    if (tx.stage === 'card-present') return 'The customer is handing their card across the counter.';
    if (tx.stage === 'card-ready') return 'Click the customer’s card — the reader does the rest.';
    if (tx.stage === 'card-entry') return `Confirm the prefilled $${totalOf(tx).toFixed(2)} total on the reader.`;
    if (tx.stage === 'card-busy') return 'The card reader is processing the payment.';
    if (tx.stage === 'card-declined') return 'Try a replacement card or switch this transaction to cash.';
    if (tx.stage === 'cash-tender') return 'Click the customer’s cash — the register takes it and the drawer opens itself.';
    if (tx.stage === 'cash-drawer' && !tx.deposited) return 'The received cash is being sorted into its labeled compartments.';
    if (tx.stage === 'cash-drawer') {
      if (exactChangeAssistancePending) return 'The register will count exact change from the available drawer pieces.';
      if (shouldAutoConfirmExactChange(accessibilityPrefs, changeGivingState(tx).state)) {
        return 'Exact change is ready and will be handed over automatically.';
      }
      return 'Click drawer money to count change: exact, or up to $5.00 extra.';
    }
    if (deliveryPhase === 'receipt-deliver') return 'The receipt is being handed to the customer.';
    if (deliveryPhase === 'bag-deliver') return 'The bag is being handed to the customer.';
    if (tx.stage === 'receipt') return 'Payment is accepted. The receipt is printing automatically.';
    if (tx.stage === 'done') return 'The receipt and bag are on their way to the customer.';
    return 'Follow the front-desk prompts.';
  }

  function checkoutActions() {
    if (postSaleDisplay && !tx) return [{ id: 'exit', label: 'Return to Shop', kind: 'primary' }];
    if (!tx) return [];
    if (tx.stage === 'scanning') {
      if (unscannedCount(tx) > 0) {
        return workspace === 'monitor'
          ? [{ id: 'start-scanning', label: 'Bag Items', kind: 'primary' }]
          : [];
      }
      return [];
    }
    if (tx.stage === 'card-present' || tx.stage === 'card-ready' || tx.stage === 'card-entry') {
      return [{ id: 'open-card-reader', label: 'Open Card Reader', kind: 'primary' }];
    }
    if (tx.stage === 'card-busy') return [];
    if (tx.stage === 'card-declined') {
      return [
        { id: 'retry-card', label: 'Try Another Card', kind: 'primary' },
        { id: 'card-to-cash', label: 'Switch to Cash', kind: 'cash' },
      ];
    }
    // The dedicated cash screen (monitorModel's 'cash' app) owns Undo/Clear/
    // Done for the whole cash exchange; the checkout summary offers nothing.
    if (tx.stage === 'cash-tender' || tx.stage === 'cash-drawer') return [];
    if (tx.stage === 'receipt') return [];
    if (tx.stage === 'bagging' || tx.stage === 'done') {
      // The delivery pipeline banks the sale by itself the moment the receipt
      // (and bag) reach the customer — flashing a one-second Complete button
      // during that animation only begs for a pointless race. The button
      // exists solely as a recovery handle if the automatic path ever stalls.
      if (autoFulfilled) return [];
      return [{ id: 'retry-fulfillment', label: 'Retry Receipt & Handoff', kind: 'success' }];
    }
    return [];
  }

  function monitorModel() {
    if (activeTab === 'home') {
      return {
        app: 'home',
        heading: 'Pinehollow Front Desk',
        message: tx
          ? `${cust ? (cust.fullName || cust.name) : 'A customer'} is waiting. Continue their active transaction when ready.`
          : `${reservationsWaiting().length} reservations and ${walkInsWaiting().length} walk-in tee requests are active.`,
      };
    }

    if (activeTab === 'check-in') {
      const selected = activeReservation();
      const selectedWalkIn = activeWalkIn();
      const locked = !!tx;
      const selectedReady = selected ? !!readyReservationCustomer(selected.id) : false;
      const reservationRows = reservationsWaiting().map((reservation) => ({
        id: reservation.id,
        name: reservation.fullName || reservation.name,
        time: fmtSlot(reservation.minute),
        partySize: reservation.partySize || 1,
        status: readyReservationCustomer(reservation.id)
          ? 'AT DESK'
          : reservation.currentDestination === 'lounge' ? 'IN LOUNGE'
            : reservation.arrivalStatus === 'arrived' ? 'ARRIVING' : 'EN ROUTE',
        disabled: locked,
      }));
      const walkInRows = walkInsWaiting().map((customer) => ({
        id: `walkin:${customer.customerId}`,
        actionId: `select-walkin:${customer.customerId}`,
        name: customer.fullName || customer.name,
        time: 'Walk-in tee request',
        partySize: customer.partySize || 1,
        status: customer.queueIndex === 0 ? 'AT DESK' : 'IN QUEUE',
        disabled: locked,
      }));
      const slots = selectedWalkIn ? walkInSlots(selectedWalkIn.customerId).slice(0, 3) : [];
      const allRows = [...walkInRows, ...reservationRows];
      const rowsPerPage = 5;
      const pageCount = Math.max(1, Math.ceil(allRows.length / rowsPerPage));
      checkInPage = Math.min(checkInPage, pageCount - 1);
      return {
        app: 'check-in',
        reservations: allRows.slice(checkInPage * rowsPerPage, checkInPage * rowsPerPage + rowsPerPage),
        reservationCount: allRows.length,
        page: checkInPage,
        pageCount,
        selectedReservation: selectedWalkIn ? {
          id: `walkin:${selectedWalkIn.customerId}`,
          name: selectedWalkIn.fullName || selectedWalkIn.name,
          time: 'Choose an available tee time',
          partySize: selectedWalkIn.partySize || 1,
          visit: 'Walk-in tee request',
          extras: 'Manual same-day slot selection',
          depositPaid: 0,
          balanceDue: (state.club ? state.club.greenFee : 0) * (selectedWalkIn.partySize || 1),
          status: selectedWalkIn.queueIndex === 0 ? 'READY AT DESK' : 'WAITING IN QUEUE',
          note: slots.length ? 'Choose one of the next capacity-safe openings.' : 'No same-day capacity remains.',
        } : selected ? {
          ...selected,
          name: selected.fullName || selected.name,
          time: fmtSlot(selected.minute),
          partySize: selected.partySize || 1,
          visit: selected.holes ? `${selected.holes} holes` : 'Tee-time reservation',
          extras: selected.extras || selected.rentalRequirements?.join(', ') || 'No extras recorded',
          depositPaid: selected.depositPaid ?? selected.deposit ?? 0,
          balanceDue: selected.balanceDue ?? selected.fee,
          status: selectedReady ? 'READY AT DESK' : 'WAITING FOR GUEST',
        } : null,
        actions: selectedWalkIn ? [
          ...slots.map((slot) => ({
            id: `select-walkin-slot:${selectedWalkIn.customerId}:${slot.dayAbs}:${slot.minute}`,
            label: `${fmtSlot(slot.minute)} · ${slot.remainingCapacity} open`,
            kind: 'primary',
            disabled: locked || selectedWalkIn.queueIndex !== 0,
          })),
          {
            id: 'reject-walkin',
            label: slots.length ? 'Cannot Accommodate' : 'No Times Available',
            kind: 'danger',
            disabled: locked || selectedWalkIn.queueIndex !== 0,
          },
        ] : selected ? [{
          id: 'reservation-check-in',
          label: `Check In · ${(selected.paymentPreference || 'card').toUpperCase()}`,
          kind: selected.paymentPreference === 'cash' ? 'cash' : 'primary',
          disabled: locked || !selectedReady,
        }] : [],
      };
    }

    // The dedicated cash screen owns the monitor for the whole cash exchange:
    // it is the Received/Total/Change/Giving display above the open drawer.
    if (tx && tx.method === 'cash'
        && (tx.stage === 'cash-tender' || tx.stage === 'cash-drawer')) {
      return cashScreenModel();
    }

    const display = tx || postSaleDisplay || {};
    const shownItems = tx
      ? tx.items.map((item) => ({
        name: item.name,
        qty: 1,
        unitPrice: item.price,
        subtotal: item.price,
        scanned: item.scanned,
      }))
      : (postSaleDisplay && postSaleDisplay.items) || [];
    return {
      app: 'checkout',
      stage: checkoutStage(),
      customer: cust ? (cust.fullName || cust.name) : (display.customer || 'No customer'),
      transactionNumber: tx ? tx.number : (display.number || '--'),
      items: shownItems,
      itemsRemaining: tx ? unscannedCount(tx) : 0,
      subtotal: tx ? subtotal(tx) : (display.subtotal || display.total || 0),
      discount: tx ? discountOf(tx) : 0,
      total: tx ? dueOf(tx) : (display.total || 0),
      payment: tx ? (tx.method || null) : display.method,
      customerChoice: paymentChoiceVisible() ? (tx ? preferredPayment() : display.method) : null,
      paymentDialogue: paymentChoiceVisible() && cust ? paymentChoiceLine() : '',
      tendered: tx && tx.method === 'cash'
        ? (tx.tenderedTotal != null ? tx.tenderedTotal : stackTotal(tx.tendered || {}))
        : undefined,
      changeDue: tx && tx.method === 'cash' ? changeDue(tx) : undefined,
      selectedChange: tx && tx.method === 'cash' ? handTotal(tx) : undefined,
      status: checkoutStatus(),
      instruction: checkoutInstruction(),
      actions: checkoutActions(),
    };
  }

  function drawScreen() {
    monitorUi.draw({
      ...monitorModel(),
      accessibility: checkoutMonitorAccessibility(accessibilityPrefs),
    });
    screenTexture.needsUpdate = true;
  }

  // The terminal's OWN screen. It is the only place card-payment state renders:
  // IDLE → INSERT CARD → PAYMENT (Required/Entered) → INCORRECT AMOUNT →
  // PROCESSING → APPROVED. Fonts are sized for the CardAmountEntry close-up.
  let termDotsTimer = 0;
  let termRenderSignature = null;

  function terminalVisualSignature() {
    if (!tx || tx.method !== 'card') return 'ready';
    const stage = tx.stage;
    const common = `${stage}|${totalOf(tx).toFixed(2)}|${terminalXVisible() ? 1 : 0}`;
    if (stage === 'card-present' || stage === 'card-ready') {
      return `${common}|${insertMessage || ''}`;
    }
    if (stage === 'card-entry') {
      return `${common}|${cardEnteredAmount(tx).toFixed(2)}|${tx.cardEntryDigits || ''}|${tx.cardEntryError || ''}`;
    }
    if (stage === 'card-busy') {
      return `${common}|${terminalBusyDotPhase(termDotsTimer)}`;
    }
    if (stage === 'card-declined') return `${common}|${tx.cardResult || ''}`;
    if (['receipt', 'bagging', 'done'].includes(stage)) return `approved|${totalOf(tx).toFixed(2)}`;
    return common;
  }

  function drawTerm() {
    const signature = terminalVisualSignature();
    if (signature === termRenderSignature) return false;
    const ctx = termContext;
    const W = termCanvas.width;
    const H = termCanvas.height;
    ctx.fillStyle = '#0e1512';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = termGlow;
    ctx.fillRect(6, 6, W - 12, H - 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cardActive = !!(tx && tx.method === 'card');
    if (!cardActive) {
      ctx.fillStyle = '#e9e2cc';
      ctx.font = '700 58px Arial, sans-serif';
      ctx.fillText('FAIRHOLLOW', W / 2, H * 0.40);
      ctx.fillStyle = '#7d8b81';
      ctx.font = '600 34px Arial, sans-serif';
      ctx.fillText('READY', W / 2, H * 0.62);
      termRenderSignature = signature;
      termTexture.needsUpdate = true;
      return true;
    }

    const stage = tx.stage;
    if (stage === 'card-present' || stage === 'card-ready') {
      ctx.fillStyle = '#f5efdb';
      ctx.font = '700 52px Arial, sans-serif';
      ctx.fillText(insertMessage || 'INSERT CARD', W / 2, H * 0.34);
      ctx.fillStyle = '#9db3a4';
      ctx.font = '600 36px Arial, sans-serif';
      ctx.fillText(`TOTAL  $${totalOf(tx).toFixed(2)}`, W / 2, H * 0.58);
      ctx.fillStyle = '#5f6f64';
      ctx.font = '600 26px Arial, sans-serif';
      ctx.fillText('CHIP FIRST, FACE UP', W / 2, H * 0.78);
    } else if (stage === 'card-entry') {
      ctx.fillStyle = '#8fb99f';
      ctx.font = '700 30px Arial, sans-serif';
      ctx.fillText('PAYMENT', W / 2, 44);
      ctx.fillStyle = '#b8c4ba';
      ctx.font = '600 32px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('REQUIRED', 36, 116);
      ctx.textAlign = 'right';
      ctx.fillText(`$${totalOf(tx).toFixed(2)}`, W - 36, 116);
      ctx.strokeStyle = '#2c3a32';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(36, 150);
      ctx.lineTo(W - 36, 150);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e9e2cc';
      ctx.font = '700 34px Arial, sans-serif';
      ctx.fillText('ENTERED', 36, 212);
      ctx.textAlign = 'right';
      ctx.font = '700 62px Arial, sans-serif';
      ctx.fillStyle = '#fff8e8';
      ctx.fillText(`$${cardEnteredAmount(tx).toFixed(2)}`, W - 36, 214);
      ctx.textAlign = 'center';
      if (tx.cardEntryError) {
        ctx.fillStyle = '#ff6f61';
        ctx.font = '700 40px Arial, sans-serif';
        ctx.fillText(tx.cardEntryError === 'AMOUNT MUST MATCH TOTAL'
          ? 'INCORRECT AMOUNT'
          : tx.cardEntryError, W / 2, 306);
        ctx.fillStyle = '#c98f88';
        ctx.font = '600 26px Arial, sans-serif';
        ctx.fillText('MUST MATCH THE REQUIRED TOTAL', W / 2, 352);
      } else {
        ctx.fillStyle = '#7d8b81';
        ctx.font = '600 28px Arial, sans-serif';
        ctx.fillText(String(tx.cardEntryDigits || '').length
          ? 'TOTAL READY — PRESS GREEN TO CONFIRM'
          : 'KEY THE TOTAL ON THE PAD', W / 2, 316);
      }
      ctx.fillStyle = '#44534a';
      ctx.font = '600 22px Arial, sans-serif';
      ctx.fillText('X CLEARS  ·  − DELETES  ·  O CONFIRMS', W / 2, H - 38);
    } else if (stage === 'card-busy') {
      const dots = '.'.repeat(1 + (Math.floor(termDotsTimer * 3) % 3));
      ctx.fillStyle = '#f5efdb';
      ctx.font = '700 54px Arial, sans-serif';
      ctx.fillText(`PROCESSING${dots}`, W / 2, H * 0.42);
      ctx.fillStyle = '#7d8b81';
      ctx.font = '600 30px Arial, sans-serif';
      ctx.fillText(`$${totalOf(tx).toFixed(2)}`, W / 2, H * 0.64);
    } else if (stage === 'card-declined') {
      ctx.fillStyle = '#ff6f61';
      ctx.font = '700 58px Arial, sans-serif';
      ctx.fillText(tx.cardResult === 'timeout' ? 'TIMEOUT' : 'DECLINED', W / 2, H * 0.42);
      ctx.fillStyle = '#c98f88';
      ctx.font = '600 28px Arial, sans-serif';
      ctx.fillText('TRY ANOTHER CARD OR CASH', W / 2, H * 0.66);
    } else if (['receipt', 'bagging', 'done'].includes(stage)) {
      ctx.fillStyle = '#63d68f';
      ctx.font = '700 66px Arial, sans-serif';
      ctx.fillText('APPROVED', W / 2, H * 0.42);
      ctx.fillStyle = '#9db3a4';
      ctx.font = '600 32px Arial, sans-serif';
      ctx.fillText(`$${totalOf(tx).toFixed(2)}`, W / 2, H * 0.66);
    } else {
      ctx.fillStyle = '#e9e2cc';
      ctx.font = '700 50px Arial, sans-serif';
      ctx.fillText('FAIRHOLLOW', W / 2, H * 0.45);
    }
    // The cancel-the-run X, drawn last so it sits over whatever the stage shows.
    // It appears ONLY before the amount is submitted; while the reader is
    // processing (card-busy) there is no X — the payment cannot be pulled.
    if (terminalXVisible()) {
      const b = TERM_X_BOX;
      const r = 10;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(b.x0 + r, b.y0);
      ctx.arcTo(b.x1, b.y0, b.x1, b.y1, r);
      ctx.arcTo(b.x1, b.y1, b.x0, b.y1, r);
      ctx.arcTo(b.x0, b.y1, b.x0, b.y0, r);
      ctx.arcTo(b.x0, b.y0, b.x1, b.y0, r);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,28,24,0.92)';
      ctx.fill();
      ctx.strokeStyle = '#ffd9d2';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#fff3ee';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      const pad = 16;
      ctx.beginPath();
      ctx.moveTo(b.x0 + pad, b.y0 + pad);
      ctx.lineTo(b.x1 - pad, b.y1 - pad);
      ctx.moveTo(b.x1 - pad, b.y0 + pad);
      ctx.lineTo(b.x0 + pad, b.y1 - pad);
      ctx.stroke();
      ctx.restore();
    }
    termRenderSignature = signature;
    termTexture.needsUpdate = true;
    return true;
  }

  // The reader is MODAL while a card is running: only its on-screen X leaves it.
  // The X shows (and cancels) only before the amount is submitted — never while
  // the authorization is in flight, so a payment can't be pulled mid-settle.
  function terminalXVisible() {
    return !!(active && tx && tx.method === 'card'
      && ['card-present', 'card-ready', 'card-entry'].includes(tx.stage));
  }

  // True whenever the card reader owns the screen — Escape is swallowed for every
  // one of these states (including card-busy and the brief declined result), so a
  // stray Escape can never cancel a payment, drop the card, or break camera lock.
  function cardTerminalLocked() {
    return !!(active && workspace === 'card' && tx && tx.method === 'card'
      && ['card-present', 'card-ready', 'card-entry', 'card-busy', 'card-declined'].includes(tx.stage));
  }

  function terminalScreenUV(event) {
    if (!termScreenPlane) return null;
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(termScreenPlane, false)[0];
    if (!hit || !hit.uv) return null;
    return { u: hit.uv.x, v: 1 - hit.uv.y }; // v measured from the top, like the canvas
  }

  function terminalXHitAt(event) {
    if (!terminalXVisible()) return false;
    const uv = terminalScreenUV(event);
    if (!uv) return false;
    const px = uv.u * TERM_CANVAS_W;
    const py = uv.v * TERM_CANVAS_H;
    const pad = accessibilityPrefs.largeTextAndTargets ? 18 : 0;
    return px >= TERM_X_BOX.x0 - pad && px <= TERM_X_BOX.x1 + pad
      && py >= TERM_X_BOX.y0 - pad && py <= TERM_X_BOX.y1 + pad;
  }

  // Pull the card run from the reader's X. Legal only before submit; returns the
  // sale to the post-scan choice point and re-arms the automatic re-presentation
  // so the customer is never stranded. The card mesh goes back to the customer.
  function cancelCardAtTerminal() {
    if (!tx || tx.method !== 'card') return false;
    const abandoned = abandonCardBeforeSubmit(tx);
    if (!abandoned.ok) return false; // card-busy / resolved — the X is not offered then
    if (checkoutFlowState() && checkoutFlowState().startsWith('Card')) {
      flowTo('AllProductsScanned', 'cashier-pulled-card-at-reader');
    }
    if (cardMesh) cardMesh.removeFromParent();
    cardMesh = null;
    cardU = 0;
    insertSnap = false;
    insertDrag = null;
    insertMessage = '';
    cardPresentationTimer = 0;
    cardEjectTimer = 0;
    cardPickupDelay = 0;
    setWorkspace('monitor');
    paymentAutoTimer = 1.35; // the customer re-presents their payment after a beat
    drawScreen();
    drawTerm();
    return true;
  }

  // A click anywhere on the terminal resolves to its nearest physical key. The
  // authored glyphs sit a fifth of a millimetre proud of the key caps, so the
  // nearest-key-centre rule covers both without per-node bookkeeping.
  function terminalKeyAt(event) {
    if (!termObject || !termKeys.size) return null;
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    // The raycaster does not skip invisible meshes — the kit's hidden COL_*
    // collision box would swallow every click, so filter hidden branches out.
    const hits = ray.intersectObject(termObject, true).filter((hit) => {
      for (let o = hit.object; o; o = o.parent) if (o.visible === false) return false;
      return true;
    });
    if (!hits.length) return null;
    const point = hits[0].point;
    let best = null;
    let bestDistance = Infinity;
    const keyWorld = new THREE.Vector3();
    for (const [label, entry] of termKeys) {
      entry.mesh.getWorldPosition(keyWorld);
      const distance = keyWorld.distanceTo(point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = label;
      }
    }
    // a generous pad: anything within ~1.8 key pitches counts as that key
    const keyReach = accessibilityPrefs.largeTextAndTargets ? 0.078 : 0.062;
    return bestDistance <= keyReach ? best : null;
  }

  function pressTerminalKey(label) {
    const entry = termKeys.get(label);
    if (entry) entry.press = 1;
  }

  function updateTerminalKeys(dt) {
    if (!termKeys.size || !termScreenPlane) return;
    const inward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(termScreenPlane.getWorldQuaternion(new THREE.Quaternion()));
    for (const entry of termKeys.values()) {
      if (entry.press <= 0) continue;
      entry.press = Math.max(0, entry.press - dt * 7);
      const parentInward = inward.clone();
      entry.mesh.parent.getWorldQuaternion(tmpQuat).invert();
      parentInward.applyQuaternion(tmpQuat);
      entry.mesh.position.copy(entry.base)
        .addScaledVector(parentInward, 0.0026 * Math.sin(Math.min(1, entry.press) * Math.PI));
    }
  }
  const tmpQuat = new THREE.Quaternion();

  // The cash screen lives ON THE POS MONITOR (monitorUi's 'cash' app), exactly
  // like the reference: orange Received/Total/Change block, navy Giving strip,
  // and Undo/Clear/Done buttons — one display, directly above the open drawer.
  function cashScreenModel() {
    const received = tx
      ? (tx.tenderedTotal != null ? Number(tx.tenderedTotal) : stackTotal(tx.tendered || {}))
      : 0;
    const giving = tx ? changeGivingState(tx) : null;
    const autoExactHandoff = shouldAutoConfirmExactChange(
      accessibilityPrefs,
      giving ? giving.state : 'short',
    );
    const cashActions = tx && tx.deposited ? [
      { id: 'undo-change', label: 'Undo', kind: 'secondary', disabled: !selectedChangeMeshes.length },
      { id: 'clear-change', label: 'Clear', kind: 'secondary', disabled: !selectedChangeMeshes.length },
      ...(!autoExactHandoff ? [{
        id: 'confirm-change',
        label: 'Done',
        kind: 'success',
        disabled: !(giving && (giving.state === 'exact' || giving.state === 'over')),
      }] : []),
    ] : [];
    return {
      app: 'cash',
      customer: cust ? (cust.fullName || cust.name) : 'Customer',
      transactionNumber: tx ? tx.number : '--',
      received,
      total: tx ? cashTotalOf(tx) : 0,
      changeDue: tx ? changeDue(tx) : 0,
      giving: tx ? handTotal(tx) : 0,
      givingState: giving ? giving.state : 'short',
      givingDeltaCents: giving ? giving.deltaCents : 0,
      awaitingCash: !!(tx && tx.stage === 'cash-tender'),
      deposited: !!(tx && tx.deposited),
      maxExtraCents: MAX_EXTRA_CHANGE_CENTS,
      actions: cashActions,
    };
  }

  function attachScreen(registerObject) {
    // The checkout-kit POS carries a dedicated POS_Screen face (clean 0..1 UVs);
    // hang the live canvas directly on it so the display inherits the head's tilt.
    const kitScreen = registerObject.getObjectByName('POS_Screen');
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(POS_PLANE_W, POS_PLANE_H), screenMaterial);
    plane.name = 'FrontDeskLiveMonitor';
    if (kitScreen) {
      // The exporter's Y-up conversion already turns the authored screen quad into
      // a three-native XY plane facing +Z — same frame as PlaneGeometry, so the
      // live canvas parents on with identity rotation, just proud of the glass.
      plane.position.z = 0.002;
      kitScreen.add(plane);
    } else {
      orientPlane(plane, 0.019, 0.315, 0, 0.84, 0.54, 0);
      registerObject.add(plane);
    }
    registerFurniture = registerObject;
    screenPlane = plane;
    drawScreen();
  }

  function attachTerm(terminal) {
    // Bring the authored reader into the same visible work plane as the POS.
    terminal.position.set(CARD_STATION.x, COUNTER_TOP, CARD_STATION.z);
    termObject = terminal;
    termKeys.clear();

    const kitScreen = terminal.getObjectByName('Terminal_Screen');
    if (kitScreen) {
      // The exporter's Y-up conversion turns the authored screen quad into a
      // three-native XY plane facing +Z — the live canvas parents on with
      // identity rotation, just proud of the glass. Same trick as the POS.
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(TERM_SCREEN_W, TERM_SCREEN_H),
        termMaterial,
      );
      plane.name = 'TerminalLiveScreen';
      plane.position.z = 0.0015;
      kitScreen.add(plane);
      termScreenPlane = plane;
    } else {
      // legacy readers carry no usable screen face — hang a small live plane
      const production = !!terminal.getObjectByName('ReaderScreen');
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.052), termMaterial);
      if (production) orientPlane(plane, 0, 0.089, -0.040, 0, 0.988, -0.156);
      else orientPlane(plane, 0.004, 0.057, -0.049, 0, 0.05, -1);
      terminal.add(plane);
      termScreenPlane = plane;
    }

    // The physical keypad: every authored key mesh becomes a click target with
    // a small press-in animation. Cancel clears, Back deletes, Confirm submits.
    const KEY_NODES = {
      Terminal_CancelButton: 'CANCEL',
      Terminal_BackButton: 'BACK',
      Terminal_ConfirmButton: 'OK',
    };
    for (let digit = 0; digit <= 9; digit += 1) KEY_NODES[`Terminal_Key_${digit}`] = String(digit);
    for (const [node, label] of Object.entries(KEY_NODES)) {
      const mesh = terminal.getObjectByName(node);
      if (!mesh) continue;
      termKeys.set(label, { mesh, base: mesh.position.clone(), press: 0 });
    }

    // The card's travel derives from the authored CARD_INSERT_SOCKET so the
    // chip end really enters the terminal's slot, whatever its recline.
    cardSocketNode = terminal.getObjectByName('CARD_INSERT_SOCKET') || null;
    refreshCardTravel();
    drawTerm();
  }

  // World-space card staging from the socket: the inserted pose sits at the
  // socket with the card's long axis along the slot's insertion direction;
  // ready floats one card-length out along that same axis.
  const FLAT_QUAT = new THREE.Quaternion();
  // how a customer actually holds a card out: tilted up toward the cashier
  const HELD_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(CARD_HELD_PITCH, 0, 0));
  const cardTravel = {
    ready: new THREE.Vector3(INSERT_READY.x, INSERT_READY.y, INSERT_READY.z),
    inserted: new THREE.Vector3(INSERTED.x, INSERTED.y, INSERTED.z),
    mouth: null, // one card-length out along the slot axis — the corner the path must round
    quaternion: new THREE.Quaternion(),
    fromSocket: false,
  };

  // The card mesh's local frame (after glTF import): +X long edge (chip near
  // -X), +Y face normal, -Z its short-edge height. The socket's local frame:
  // +Y is the slide axis INTO the reader, +Z is where the card's face points.
  // Chip end leading means card -X maps onto socket +Y.
  const CARD_TO_SOCKET = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, -1, 0),  // card +X →
      new THREE.Vector3(0, 0, 1),   // card +Y (face) →
      new THREE.Vector3(-1, 0, 0),  // card +Z →
    ),
  );

  function refreshCardTravel() {
    if (!cardSocketNode) return;
    root.updateMatrixWorld(true);
    const socketWorld = cardSocketNode.getWorldPosition(new THREE.Vector3());
    const socketQuat = cardSocketNode.getWorldQuaternion(new THREE.Quaternion());
    const inserted = root.worldToLocal(socketWorld.clone());
    cardTravel.inserted.copy(inserted);
    // the card waits FLAT on the counter in front of the slot, then rises and
    // tilts up into it (the slot mouth sits barely above the countertop, so an
    // in-axis ready pose would bury the card in the counter)
    cardTravel.ready.set(inserted.x, COUNTER_TOP + 0.02, inserted.z + 0.20);
    // the slot MOUTH: a card-length back out along the socket's slide axis. Travel between
    // mouth and seat is purely axial (card stays in the slot plane), so neither inserting
    // nor ejecting ever cuts the reader's face — the eject used to leave on the diagonal
    // and phase through the housing's lip.
    cardTravel.mouth = root.worldToLocal(cardSocketNode.localToWorld(new THREE.Vector3(0, -0.085, 0)));
    cardTravel.quaternion.copy(socketQuat).multiply(CARD_TO_SOCKET);
    cardTravel.fromSocket = true;
    INSERT_READY.x = cardTravel.ready.x;
    INSERT_READY.y = cardTravel.ready.y;
    INSERT_READY.z = cardTravel.ready.z;
    INSERTED.x = cardTravel.inserted.x;
    INSERTED.y = cardTravel.inserted.y;
    INSERTED.z = cardTravel.inserted.z;
  }

  function setScannerFeedback(mode = 'idle', seconds = 0) {
    scannerFeedbackMode = mode;
    scannerPulse = mode === 'idle'
      ? 0
      : Math.max(scannerPulse, Number(seconds) || 0);
    for (const entry of scannerFeedback) {
      const material = entry.material;
      if (!material) continue;
      if (material.emissive && entry.emissive) material.emissive.copy(entry.emissive);
      if (Number.isFinite(entry.emissiveIntensity)) {
        material.emissiveIntensity = entry.emissiveIntensity;
      }
      if (mode === 'active' && material.emissive) {
        material.emissive.setHex(0xd94b42);
        material.emissiveIntensity = Math.max(1.8, entry.emissiveIntensity + 1.1);
      } else if (mode === 'success' && material.emissive) {
        material.emissive.setHex(0x65d58d);
        material.emissiveIntensity = Math.max(2.4, entry.emissiveIntensity + 1.7);
      } else if (mode === 'invalid' && material.emissive) {
        material.emissive.setHex(0xe1a545);
        material.emissiveIntensity = Math.max(2.2, entry.emissiveIntensity + 1.5);
      }
      material.needsUpdate = true;
    }
  }

  function attachScanner(object) {
    scannerObject = object;
    scannerRayOrigin = object.getObjectByName('SCAN_RAY_ORIGIN') || null;
    scannerFeedback.length = 0;
    const seen = new Set();
    for (const name of ['Scanner_Window', 'Scanner_LED', 'Scanner_CashierLED']) {
      const node = object.getObjectByName(name);
      const materials = Array.isArray(node?.material) ? node.material : [node?.material];
      for (const material of materials) {
        if (!material || seen.has(material)) continue;
        seen.add(material);
        scannerFeedback.push({
          material,
          emissive: material.emissive ? material.emissive.clone() : null,
          emissiveIntensity: Number(material.emissiveIntensity) || 0,
        });
      }
    }
    const authoredBeam = object.getObjectByName('ScannerBeam');
    if (authoredBeam) authoredBeam.visible = false;
    setScannerFeedback('idle');
  }

  function scannerRayPose() {
    root.updateMatrixWorld(true);
    if (scannerRayOrigin) {
      scannerObject.updateWorldMatrix(true, true);
      const worldOrigin = scannerRayOrigin.getWorldPosition(new THREE.Vector3());
      const worldTip = scannerRayOrigin.localToWorld(new THREE.Vector3(0, 0, 0.10));
      const origin = root.worldToLocal(worldOrigin.clone());
      const tip = root.worldToLocal(worldTip.clone());
      return {
        source: 'authored-socket',
        origin,
        direction: tip.sub(origin).normalize(),
        worldOrigin,
        worldDirection: worldTip.sub(worldOrigin).normalize(),
      };
    }
    // The GLB loads asynchronously. This socket-equivalent pose keeps an early
    // transaction usable without inventing a second visible scanner.
    const origin = new THREE.Vector3(
      REGISTER.scanner.x,
      COUNTER_TOP + 0.185,
      REGISTER.scanner.z,
    );
    const direction = new THREE.Vector3(0, -0.18, 1)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), REGISTER.scanner.ry)
      .normalize();
    const worldOrigin = root.localToWorld(origin.clone());
    const worldTip = root.localToWorld(origin.clone().add(direction));
    return {
      source: 'layout-fallback',
      origin,
      direction,
      worldOrigin,
      worldDirection: worldTip.sub(worldOrigin).normalize(),
    };
  }

  function attachPrinter(printerObject) {
    printerRoll = printerObject.getObjectByName('PaperRollPivot');
    printerOutputSocket = printerObject.getObjectByName('RECEIPT_OUTPUT_SOCKET')
      || printerObject.getObjectByName('ANCHOR_ReceiptFeed');
    const authoredPaper = printerObject.getObjectByName('ReceiptPaper');
    if (authoredPaper) authoredPaper.visible = false;
    // checkout-kit printer: the Receipt_Paper strip feeds upward while printing
    printerPaper = printerObject.getObjectByName('Receipt_Paper');
    if (printerPaper) {
      printerPaperBaseY = printerPaper.position.y;
      printerPaper.visible = false;
    }
  }

  function setPlacementPreview() {
    // The live monitor stays focused on the active transaction; the customer still
    // performs the existing sequential counter placement before begin() is called.
    if (!tx) drawScreen();
  }

  function buildItemMesh(item) {
    const sku = skuById(item.skuId);
    const built = buildCatalogProductProxy({ sku, merch, mats, resources: itemResources });
    const mesh = built.root;
    const barcode = barcodeFor(item.skuId, item.price);
    const barcodeTexture = itemResources.texture(productBarcodeTexture(barcode));
    const barcodeCarrier = new THREE.Group();
    barcodeCarrier.name = 'RuntimeProductBarcodeCarrier';
    // A restrained 9.5 cm retail swing keeps the label outside every product
    // silhouette at the reader. The scanner still validates the label plane's
    // real transform; this is a physical affordance, not an overlay.
    barcodeCarrier.position.x = 0.095;
    const barcodeTether = new THREE.Mesh(
      itemResources.geometry(new THREE.BoxGeometry(0.095, 0.005, 0.002)),
      itemResources.material(new THREE.MeshBasicMaterial({
        color: 0xb9974e,
        toneMapped: false,
      })),
    );
    barcodeTether.name = 'RuntimeProductBarcodeTether';
    barcodeTether.position.x = 0.0475;
    built.barcodeAnchor.add(barcodeTether);
    const barcodeBacking = new THREE.Mesh(
      itemResources.geometry(new THREE.PlaneGeometry(0.086, 0.052)),
      itemResources.material(new THREE.MeshBasicMaterial({
        color: 0x173f2d,
        toneMapped: false,
        side: THREE.DoubleSide,
      })),
    );
    barcodeBacking.name = 'RuntimeProductBarcodeBacking';
    barcodeBacking.position.z = -0.001;
    barcodeCarrier.add(barcodeBacking);
    const barcodeMesh = new THREE.Mesh(
      itemResources.geometry(new THREE.PlaneGeometry(0.074, 0.040)),
      itemResources.material(new THREE.MeshBasicMaterial({
        map: barcodeTexture,
        toneMapped: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })),
    );
    barcodeMesh.name = 'RuntimeProductBarcode';
    barcodeMesh.position.z = 0.001;
    barcodeMesh.userData = { barcode, itemUid: item.uid };
    barcodeCarrier.add(barcodeMesh);
    built.barcodeAnchor.add(barcodeCarrier);
    mesh.userData = {
      ...mesh.userData,
      pick: true,
      kind: 'item',
      uid: item.uid,
      skuId: item.skuId,
      originalScale: mesh.scale.clone(),
      barcode,
      barcodeAnchor: built.barcodeAnchor,
      barcodeCarrier,
      barcodeMesh,
    };
    // A generous invisible click pad wrapping the whole product. A driver is a
    // centimetre-thin shaft — asking the player to hit that exact cylinder is
    // pixel hunting. The pad takes the click; the visual mesh takes the arc.
    mesh.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    if (!bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3());
      const center = mesh.worldToLocal(bounds.getCenter(new THREE.Vector3()));
      const padMargin = accessibilityPrefs.largeTextAndTargets ? 0.10 : 0.05;
      const pad = new THREE.Mesh(
        itemResources.geometry(
          new THREE.BoxGeometry(
            size.x + padMargin,
            Math.max(size.y, 0.04) + padMargin,
            size.z + padMargin,
          ),
        ),
        itemResources.material(new THREE.MeshBasicMaterial({ visible: false })),
      );
      pad.name = 'ItemClickPad';
      pad.position.copy(center);
      pad.userData = { pick: true, kind: 'item', uid: item.uid, skuId: item.skuId };
      mesh.add(pad);
    }
    suppressInteriorSunShadows(mesh);
    return mesh;
  }

  function scheduleCheckoutTexturePrewarm() {
    const token = ++drawerPrewarmToken;
    const itemTextures = new Set();
    for (const mesh of itemMeshes.values()) {
      mesh.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) {
            if (value?.isTexture) itemTextures.add(value);
          }
        }
      });
    }
    const coinTextures = new Set();
    drawerMoney?.traverse((object) => {
      if (!shouldPrewarmDrawerCoin(object.userData?.denom)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value?.isTexture) coinTextures.add(value);
        }
      }
    });
    const pending = checkoutTexturePrewarmPlan({ itemTextures, coinTextures });
    const itemTotal = pending.filter((entry) => entry.kind === 'item').length;
    const coinTotal = pending.filter((entry) => entry.kind === 'coin').length;
    drawerPrewarm = {
      kind: 'checkout-first-use-textures',
      pendingTextures: pending.length,
      warmedTextures: 0,
      item: { total: itemTotal, pending: itemTotal, warmed: 0 },
      coin: { total: coinTotal, pending: coinTotal, warmed: 0 },
      complete: pending.length === 0 || !renderer?.initTexture,
    };
    if (drawerPrewarm.complete) return;

    // The authored products are already instantiated and decoded. Upload their
    // existing textures first, then the closed-drawer coin atlases, one texture
    // per frame while the customer waits. No material/model clones are created.
    // The token makes transaction teardown cancel the remaining callbacks before
    // item-owned fallback resources can be disposed.
    const warmNext = () => {
      if (token !== drawerPrewarmToken || !tx) return;
      const entry = pending.shift();
      if (entry) {
        try { renderer.initTexture(entry.texture); } catch (_) { /* context loss retries on draw */ }
        drawerPrewarm.warmedTextures += 1;
        drawerPrewarm.pendingTextures = pending.length;
        drawerPrewarm[entry.kind].warmed += 1;
        drawerPrewarm[entry.kind].pending -= 1;
      }
      if (pending.length) requestAnimationFrame(warmNext);
      else drawerPrewarm.complete = true;
    };
    requestAnimationFrame(warmNext);
  }

  function layoutGoods() {
    if (!tx || transactionKind !== 'retail') return;
    const poses = catalogCheckoutLayout(
      tx.items.map((item) => ({ sku: skuById(item.skuId) })),
      REGISTER.staging,
      REST_Y,
    );
    tx.items.forEach((item, index) => {
      const mesh = itemMeshes.get(item.uid);
      if (!mesh) return;
      const pose = item.placedAt || poses[index];
      mesh.position.set(pose.x, REST_Y, pose.z);
      mesh.rotation.set(0, pose.ry || 0, 0);
    });
  }

  const billMaterials = new Map();
  const coinMaterials = new Map();
  const billGeometry = new THREE.BoxGeometry(0.152, 0.0022, 0.066);
  const coinGeometry = new THREE.CylinderGeometry(0.0145, 0.0145, 0.0028, 20);

  function moneyMaterial(denom) {
    if (BILLS.includes(denom)) {
      if (!billMaterials.has(denom)) {
        billMaterials.set(denom, new THREE.MeshStandardMaterial({
          map: billTexture(denom),
          roughness: 0.86,
        }));
      }
      return billMaterials.get(denom);
    }
    if (!coinMaterials.has(denom)) {
      const face = new THREE.MeshStandardMaterial({
        map: coinTexture(denom),
        roughness: 0.38,
        metalness: 0.58,
      });
      const edge = new THREE.MeshStandardMaterial({
        color: 0x8d948f,
        roughness: 0.42,
        metalness: 0.62,
      });
      coinMaterials.set(denom, [edge, face, face]);
    }
    return coinMaterials.get(denom);
  }

  function makeMoney(denom, from) {
    // Prefer the finished checkout-kit denominations (fictional Fairhollow
    // club notes and coins); fall back to procedural pieces if the kit is absent.
    let mesh = null;
    if (merch && merch.hasKit) {
      const name = checkoutMoneyAssetStem(denom, from);
      if (merch.hasKit(name)) mesh = merch.instantiateKit(name, { scale: MONEY_KIT_SCALE });
      // The large Sheet-01 five-unit piece is a presentation variant only. If
      // that optional hero model is unavailable, retain the normal five-unit
      // asset before dropping all the way to procedural fallback geometry.
      if (!mesh && denom === 0.05 && merch.hasKit('cash_coin_05')) {
        mesh = merch.instantiateKit('cash_coin_05', { scale: MONEY_KIT_SCALE });
      }
    }
    if (!mesh) {
      mesh = new THREE.Mesh(
        BILLS.includes(denom) ? billGeometry : coinGeometry,
        moneyMaterial(denom),
      );
    }
    const data = { pick: true, kind: 'money', denom, from };
    mesh.userData = data;
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.userData = { ...o.userData, ...data };
      }
    });
    suppressInteriorSunShadows(mesh);
    return mesh;
  }

  function cashGpuPrewarmStatus() {
    const complete = cashGpuPrewarmReady && cashGpuPrewarmBuilt === cashGpuPrewarmExpected;
    return {
      ready: cashGpuPrewarmReady,
      complete,
      expected: cashGpuPrewarmExpected,
      built: cashGpuPrewarmBuilt,
      drawn: cashGpuPrewarmDrawn,
      released: cashGpuPrewarmReleased,
      aborted: cashGpuPrewarmReleased && !complete,
      releasedCount: cashGpuPrewarmReleasedCount,
      representatives: cashGpuPrewarmRoot.children.length,
    };
  }

  function resolveCashGpuPrewarmWaiters() {
    const status = cashGpuPrewarmStatus();
    for (const waiter of cashGpuPrewarmWaiters) waiter(status);
    cashGpuPrewarmWaiters.clear();
  }

  function waitForCashGpuPrewarmRepresentatives(timeoutMs = 12000) {
    if (cashGpuPrewarmReady) return Promise.resolve(cashGpuPrewarmStatus());
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        cashGpuPrewarmWaiters.delete(finish);
        clearTimeout(timer);
        resolve(status || cashGpuPrewarmStatus());
      };
      cashGpuPrewarmWaiters.add(finish);
      const timer = setTimeout(() => finish(cashGpuPrewarmStatus()), Math.max(0, Number(timeoutMs) || 0));
    });
  }

  function buildCashGpuPrewarmRepresentatives() {
    if (cashGpuPrewarmReleased || cashGpuPrewarmRoot.children.length || !merch?.instantiateKit) return;
    for (const stem of checkoutMoneyGpuPrewarmStems()) {
      const model = merch.instantiateKit(stem, { scale: MONEY_KIT_SCALE });
      if (!model) continue;
      model.name = `GPU_PREWARM_${stem}`;
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.userData = { ...object.userData, gpuPrewarm: stem };
      });
      suppressInteriorSunShadows(model);
      cashGpuPrewarmRoot.add(model);
    }
    cashGpuPrewarmBuilt = cashGpuPrewarmRoot.children.length;
    cashGpuPrewarmReady = true;
    resolveCashGpuPrewarmWaiters();
  }

  function releaseCashGpuPrewarmRepresentatives({ drawn = false } = {}) {
    if (cashGpuPrewarmReleased) return cashGpuPrewarmStatus();
    if (drawn) cashGpuPrewarmDrawn = cashGpuPrewarmRoot.children.length;
    const status = {
      ready: cashGpuPrewarmReady,
      built: cashGpuPrewarmBuilt,
      expected: cashGpuPrewarmExpected,
      drawn: cashGpuPrewarmDrawn,
    };
    if (!cashGpuPrewarmShouldRelease(status, { renderFinished: drawn })) {
      return cashGpuPrewarmStatus();
    }
    cashGpuPrewarmReleasedCount = cashGpuPrewarmRoot.children.length;
    cashGpuPrewarmReleased = true;
    cashGpuPrewarmRoot.clear();
    cashGpuPrewarmRoot.removeFromParent();
    return cashGpuPrewarmStatus();
  }

  if (merch) merch.onReady(buildCashGpuPrewarmRepresentatives);

  function makeFlatLabel(label, width = 0.075, height = 0.035) {
    const texture = textTexture(label, {
      width: 256,
      height: 112,
      background: '#f4eddb',
      foreground: '#173f2d',
      accent: '#b9974e',
    });
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  function resetBagAtCounter() {
    if (!bagGroup) return;
    bagGroup.visible = true;
    bagGroup.position.copy(BAG_POS);
    bagGroup.rotation.set(0, 0, 0);
    bagGroup.scale.setScalar(BAG_COUNTER_SCALE);
  }

  function buildBag() {
    if (bagGroup) return;
    const builtBag = new THREE.Group();
    bagGroup = builtBag;
    builtBag.name = 'FrontDeskShoppingBag';
    builtBag.position.copy(BAG_POS);
    builtBag.scale.setScalar(BAG_COUNTER_SCALE);
    root.add(builtBag);
    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.30, 0.17),
      new THREE.MeshStandardMaterial({ color: 0xbda274, roughness: 0.92, metalness: 0.0 }),
    );
    fallback.position.y = 0.15;
    fallback.name = 'BagFallback';
    fallback.userData.checkoutOwnedFallback = true;
    builtBag.add(fallback);
    if (merch) {
      merch.onReady(() => {
        // This callback can resolve after the previous customer has taken their
        // bag and a new counter wrapper exists. Never graft that late model (or
        // its anchors) onto a different transaction's carrier.
        if (bagGroup !== builtBag) return;
        const model = (merch.instantiateKit && merch.instantiateKit('shopping_bag', { scale: 1.0 }))
          || merch.instantiate('checkout_shopping_bag');
        if (!model) return;
        fallback.removeFromParent();
        fallback.geometry.dispose();
        fallback.material.dispose();
        suppressInteriorSunShadows(model);
        builtBag.add(model);
        bagContentsNode = model.getObjectByName('ANCHOR_BagContents');
        bagHandoffNode = model.getObjectByName('ANCHOR_BagHandoff')
          || model.getObjectByName('ANCHOR_BagHandleFront');
        if (bagHandoffNode) {
          builtBag.updateWorldMatrix(true, true);
          bagHandoffLocal.copy(
            builtBag.worldToLocal(bagHandoffNode.getWorldPosition(new THREE.Vector3())),
          );
        }
        const drop = model.getObjectByName('ANCHOR_BagDrop');
        if (drop) {
          root.updateMatrixWorld(true);
          bagMouth.copy(root.worldToLocal(drop.getWorldPosition(new THREE.Vector3())));
        }
      });
    }
  }

  function settleScannedProduct(mesh) {
    if (!mesh || !tx) return;
    const descriptor = mesh.userData.catalogVisual || {};
    const baseScale = mesh.userData.originalScale || new THREE.Vector3(1, 1, 1);
    mesh.visible = true;
    mesh.userData.pick = false;
    mesh.traverse((object) => { if (object.userData) object.userData.pick = false; });

    if (descriptor.separateHandoff) {
      const oversize = tx.items
        .filter((item) => item.scanned
          && itemMeshes.get(item.uid)?.userData?.catalogVisual?.separateHandoff);
      const index = Math.max(0, oversize.findIndex((item) => item.uid === mesh.userData.uid));
      mesh.scale.copy(baseScale);
      mesh.position.set(1.88 + index * 0.07, REST_Y + index * 0.025, 4.08 + index * 0.055);
      mesh.rotation.set(0, -0.10 + index * 0.08, 0);
      mesh.userData.checkoutVisualState = 'oversize-set-aside';
      return;
    }

    const compact = tx.items
      .filter((item) => item.scanned
        && !itemMeshes.get(item.uid)?.userData?.catalogVisual?.separateHandoff);
    const index = Math.max(0, compact.findIndex((item) => item.uid === mesh.userData.uid));
    bagGroup.add(mesh);
    const contents = bagContentsNode
      ? bagGroup.worldToLocal(bagContentsNode.getWorldPosition(new THREE.Vector3()))
      : new THREE.Vector3(0, 0.20, 0);
    const column = index % 3;
    const row = Math.floor(index / 3);
    mesh.position.set(
      contents.x + (column - 1) * 0.065,
      contents.y + 0.220 + row * 0.030,
      contents.z + ((index % 2) ? 0.025 : -0.020),
    );
    mesh.scale.set(baseScale.x * 0.48, baseScale.y * 0.48, baseScale.z * 0.48);
    mesh.rotation.set(-0.34 + row * 0.08, (column - 1) * 0.24, 0.12 * (index % 2 ? 1 : -1));
    mesh.userData.checkoutVisualState = 'visible-in-bag';
  }

  function buildSlotFurniture() {
    // The fallback drawer builds these once, then an authored drawer can remap
    // every well after its GLB arrives. Release the replaced fallback targets;
    // merely detaching them leaves their GPU buffers resident in Three's cache.
    for (const spot of slotHotspots) {
      spot.removeFromParent();
      spot.geometry?.dispose();
      spot.material?.dispose();
    }
    for (const label of slotLabels) {
      label.removeFromParent();
      label.geometry?.dispose();
      if (label.material?.map) label.material.map.dispose();
      label.material?.dispose();
    }
    slotHotspots.length = 0;
    slotLabels.length = 0;
    for (const denom of DENOMS) {
      const slot = SLOT[denom];
      const meta = SLOT_META[denom];
      const bill = BILLS.includes(denom);
      // Targets HUG their wells — sized from the AUTHORED compartment bounds so
      // each box fills exactly its own well volume (a click near a divider goes
      // to the compartment the cursor is visually over, never its neighbour),
      // and stays LOW so the coin row can't shadow the bill row from the cash pose.
      const hotspot = new THREE.Mesh(
        new THREE.BoxGeometry(meta.well_w, meta.wall_h, meta.well_d),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hotspot.position.set(slot.x, slot.y + meta.wall_h / 2, slot.z);
      hotspot.userData = { pick: true, kind: 'drawer-slot', denom };
      drawerMotionRoot.add(hotspot);
      slotHotspots.push(hotspot);
      // The value reads at the BOTTOM-FRONT of each compartment, reference-style:
      // bold white text with a dark stroke hugging the money. refillDrawerMoney
      // re-seats it on top of the stack/pile as the count changes.
      const tag = makeMoneyTag(moneyLabel(denom));
      tag.position.set(slot.x, slot.y + 0.0022, slot.z + meta.well_d / 2 - (bill ? 0.026 : 0.020));
      drawerMotionRoot.add(tag);
      slotLabels.push(tag);
      slotTags[denom] = tag;
    }
  }

  // TCG-style denomination tag: white 900-weight text, dark outline, transparent
  // ground, always readable over whatever money sits beneath it.
  function makeMoneyTag(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const c2 = canvas.getContext('2d');
    c2.clearRect(0, 0, 256, 128);
    c2.fillStyle = 'rgba(18, 50, 35, 0.94)';
    c2.fillRect(8, 10, 240, 108);
    c2.strokeStyle = '#c6a45b';
    c2.lineWidth = 8;
    c2.strokeRect(12, 14, 232, 100);
    c2.font = '900 78px "Segoe UI", Arial, sans-serif';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.lineWidth = 10;
    c2.lineJoin = 'round';
    c2.strokeStyle = 'rgba(20,22,20,0.9)';
    c2.strokeText(text, 128, 68);
    c2.fillStyle = '#ffffff';
    c2.fillText(text, 128, 68);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.066, 0.033),
      new THREE.MeshBasicMaterial({
        map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 4;
    return mesh;
  }

  function buildDrawer() {
    if (drawerGroup) return;
    const drawerZ = COUNTER.z + COUNTER.depth / 2 - 0.06;
    drawerGroup = new THREE.Group();
    drawerGroup.position.set(REGISTER.drawer.x, REGISTER.drawer.y, drawerZ);
    root.add(drawerGroup);
    drawerMotionRoot = new THREE.Group();
    drawerMotionRoot.visible = false;
    drawerGroup.add(drawerMotionRoot);
    drawerMoney = new THREE.Group();
    drawerMoney.name = 'SimplifiedDrawerMoney';
    drawerMotionRoot.add(drawerMoney);

    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(0.49, 0.10, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x30332f, roughness: 0.48, metalness: 0.28 }),
    );
    fallback.position.set(0, 0.05, 0);
    drawerMotionRoot.add(fallback);

    buildSlotFurniture();

    if (merch) {
      merch.onReady(() => {
        // The checkout-kit drawer: charcoal housing, light-gray insert with five
        // labelled bill wells + five coin cups, and a CashDrawer_Tray that slides
        // toward the staff side. Origin is the housing's back-bottom-centre.
        const kitScale = 1.0;
        const kit = merch.instantiateKit && merch.instantiateKit('cash_drawer', { scale: kitScale });
        const model = kit || merch.instantiate('checkout_cash_drawer') || merch.instantiate('cash_drawer');
        if (!model) return;
        fallback.visible = false;
        suppressInteriorSunShadows(model);
        if (kit) {
          // seat the housing under the countertop with its face flush to the
          // counter's staff side (drawerGroup sits at that face)
          model.position.set(0, -0.045, 0.10 - 0.41 * kitScale);
          drawerGroup.add(model);
          drawerAssetSlide = model.getObjectByName('CashDrawer_Tray');
          if (drawerAssetSlide) {
            drawerAssetSlideBaseZ = drawerAssetSlide.position.z;
            drawerGroup.updateMatrixWorld(true);
            drawerAssetSlideWorldScale = drawerAssetSlide.getWorldScale(new THREE.Vector3()).z || 1;
          }
          // Re-derive the denomination slots from the kit's authored money
          // sockets so hotspots, labels and cash stacks land exactly in the wells.
          // Each socket ALSO carries its compartment's placement contract
          // (interior bounds, wall height, piece cap, note spacing, clip hinge
          // drop) as authored extras — scaled here into world units once.
          root.updateMatrixWorld(true);
          const socketName = (denom) => (BILLS.includes(denom)
            ? `BILL_${denom}_SOCKET`
            : `COIN_${String(Math.round(denom * 100)).padStart(2, '0')}_SOCKET`);
          let remapped = 0;
          for (const denom of DENOMS) {
            const socket = model.getObjectByName(socketName(denom));
            if (!socket) continue;
            const local = drawerMotionRoot.worldToLocal(socket.getWorldPosition(new THREE.Vector3()));
            SLOT[denom] = { x: local.x, y: local.y, z: local.z };
            const s = socket.getWorldScale(new THREE.Vector3()).x || 1;
            const u = socket.userData || {};
            if (u.well_w && u.well_d) {
              SLOT_META[denom] = BILLS.includes(denom)
                ? {
                  well_w: u.well_w * s,
                  well_d: u.well_d * s,
                  wall_h: (u.wall_h || 0.044) * s,
                  max_pieces: u.max_pieces || 12,
                  spacing: (u.spacing_m || 0.0016) * s,
                  hinge_drop: (u.hinge_drop_m || 0.039) * s,
                }
                : {
                  well_w: u.well_w * s,
                  well_d: u.well_d * s,
                  wall_h: (u.wall_h || 0.028) * s,
                  max_pieces: u.max_pieces || 30,
                  pile_h: (u.pile_h_m || 0.0032) * s,
                };
            }
            // the authored retaining clip: rest pose = paddle on the slot floor;
            // refills slerp it up so it rides the top of the note stack
            if (u.clip) {
              const clip = model.getObjectByName(u.clip);
              if (clip) SLOT_CLIP[denom] = { object: clip, rest: clip.quaternion.clone() };
            }
            remapped += 1;
          }
          // apply whatever the kit authored; a denomination the tray predates (an older
          // GLB without the $100 well) keeps its fallback slot instead of dragging every
          // OTHER well back to fallbacks with it
          if (remapped > 0) buildSlotFurniture();
        } else {
          drawerGroup.add(model);
          drawerAssetSlide = model.getObjectByName('DrawerSlide');
          if (drawerAssetSlide) {
            drawerAssetSlideBaseZ = drawerAssetSlide.position.z;
            drawerGroup.updateMatrixWorld(true);
            drawerAssetSlideWorldScale = drawerAssetSlide.getWorldScale(new THREE.Vector3()).z || 1;
          }
        }
        if (tx) {
          refillDrawerMoney();
          scheduleCheckoutTexturePrewarm();
        }
      });
    }
  }

  function refillDrawerMoney() {
    if (!drawerMoney || !drawer || !tx) return;
    drawerMoney.clear();
    const contents = drawerContents(tx, drawer);
    for (const denom of DENOMS) {
      const bill = BILLS.includes(denom);
      const meta = SLOT_META[denom];
      const slot = SLOT[denom];               // the socket sits AT the well floor
      const count = Math.min(contents[denom] || 0, meta.max_pieces);
      if (bill) {
        // notes lie FLAT, aligned front-to-back, filling their slot the way the
        // reference drawer reads — sized against the AUTHORED interior, not tuned
        const [len, wid] = BILL_FOOTPRINT[denom] || [0.15, 0.064];
        const fit = billFit(meta, len * MONEY_KIT_SCALE, wid * MONEY_KIT_SCALE);
        for (const p of billLayout(meta, count, denom)) {
          const piece = makeMoney(denom, 'drawer');
          piece.scale.x *= fit.scaleLen;
          piece.scale.z *= fit.scaleWid;
          piece.position.set(slot.x + p.dx, slot.y + p.dy, slot.z + p.dz);
          piece.rotation.y = Math.PI / 2 + p.ry;
          drawerMoney.add(piece);
        }
        // the retaining clip rides the top of the stack: rest pose (authored)
        // = paddle on the floor, level = a stack tall enough to reach the hinge
        const clip = SLOT_CLIP[denom];
        if (clip) {
          clip.object.quaternion.copy(clip.rest).slerp(CLIP_LEVEL_QUAT, clipFillRatio(meta, count));
        }
      } else {
        // a scrambled mound: dense, centre-high, every coin inside its well
        const coinR = ((COIN_BLANK[denom] || 0.024) * MONEY_KIT_SCALE) / 2;
        const coinT = meta.pile_h;
        for (const p of coinLayout(meta, count, coinR, coinT, denom).pieces) {
          const piece = makeMoney(denom, 'drawer');
          piece.position.set(slot.x + p.dx, slot.y + p.dy, slot.z + p.dz);
          piece.rotation.set(p.rx, p.ry, p.rz);
          drawerMoney.add(piece);
        }
      }
      // the denomination tag hugs the money at the well's FRONT (bottom-front
      // region, reference-style): on the note stack for bills, riding the
      // front slope of the pile for coins — updated every refill
      const tag = slotTags[denom];
      if (tag) {
        const stackTop = bill
          ? (count > 0 ? 0.0015 + count * meta.spacing : 0)
          : (count > 0 ? meta.pile_h * 1.6 : 0);
        tag.position.set(
          slot.x,
          slot.y + stackTop + 0.0022,
          slot.z + meta.well_d / 2 - (bill ? 0.026 : 0.020),
        );
      }
    }
  }

  // The presented cash rides IN THE CUSTOMER'S OUTSTRETCHED HAND — a fan held
  // over the counter facing the cashier's eye (not edge-on to it), never laid
  // out on the desk. One click anywhere on the handful accepts all of it.
  function tenderPose(index) {
    const layout = presentedTenderLayout(
      tenderMeshes.map((mesh) => mesh.userData.denom),
      customerHandPoint(COUNTER_TOP + 0.24),
    )[index];
    return {
      position: new THREE.Vector3(
        layout.position.x, layout.position.y, layout.position.z,
      ),
      rotation: new THREE.Euler(
        layout.rotation.x, layout.rotation.y, layout.rotation.z,
      ),
    };
  }

  function drawerSlotPosition(denom, stackOffset = 0) {
    const slot = SLOT[denom];
    if (!slot || !drawerMotionRoot) return new THREE.Vector3();
    root.updateMatrixWorld(true);
    // deposits land at the well FLOOR (the socket sits on it) — the refill
    // pass then folds them into the flat-note / coin-mound look
    const world = drawerMotionRoot.localToWorld(new THREE.Vector3(
      slot.x,
      slot.y + 0.002 + stackOffset,
      slot.z,
    ));
    return root.worldToLocal(world);
  }

  function queueCashMotion(mesh, to, {
    delay = 0,
    duration = 0.42,
    remove = false,
    enablePick = false,
    kind = 'cash',
    drawerDenom = null,
    stackOffset = 0,
    toRotation = null,
    via = null,
    lift = 0,
    targetProvider = null,
    onComplete = null,
  } = {}) {
    if (!mesh) return;
    const from = mesh.position.clone();
    const fromQuaternion = mesh.quaternion.clone();
    // default landing pose is drawer-flat; a presentation (the held fan) passes
    // its own facing so the piece arrives readable, not edge-on
    const toQuaternion = new THREE.Quaternion().setFromEuler(
      toRotation || (BILLS.includes(mesh.userData.denom)
        ? new THREE.Euler(0, Math.PI / 2, 0)
        : new THREE.Euler(0, 0, 0)),
    );
    // a piece in flight takes no clicks — including its child meshes, whose
    // copied pick flags would otherwise route a click into a stale branch
    mesh.userData.pick = false;
    mesh.traverse((o) => { if (o.userData) o.userData.pick = false; });
    cashMotions.push({
      mesh,
      from,
      to: to.clone(),
      fromQuaternion,
      toQuaternion,
      delay,
      elapsed: 0,
      duration,
      remove,
      enablePick,
      kind,
      drawerDenom,
      stackOffset,
      via: via ? via.clone() : null,
      lift,
      targetProvider,
      onComplete,
    });
  }

  function presentTender() {
    tenderMeshes.forEach((mesh, index) => {
      const pose = tenderPose(index);
      // the notes come UP from the customer's pocket into their held-out hand
      const hand = customerHandPoint(COUNTER_TOP + 0.24);
      mesh.position.set(
        hand.x - 0.10 + (index % 4) * 0.03,
        hand.y - 0.22 + Math.floor(index / 4) * 0.006,
        hand.z - 0.18,
      );
      mesh.rotation.set(-0.3, -0.06, 0);
      queueCashMotion(mesh, pose.position, {
        delay: index * 0.055,
        duration: 0.48,
        enablePick: true,
        kind: 'tender-present',
        toRotation: pose.rotation,
      });
    });
    // ...and the WHOLE handful is one generous click target: the player clicks
    // the money in the customer's hand, not a two-pixel note edge. Tracked
    // apart from tenderMeshes so it never rides the deposit choreography.
    clearTenderHandful();
    const cashPoint = customerCashPoint(customerHandPoint(COUNTER_TOP + 0.24));
    tenderHandful = new THREE.Mesh(
      new THREE.SphereGeometry(accessibilityPrefs.largeTextAndTargets ? 0.22 : 0.15, 10, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    tenderHandful.position.set(cashPoint.x, cashPoint.y, cashPoint.z);
    tenderHandful.userData = {
      pick: true, kind: 'money', from: 'tender', denom: Number(Object.keys(tx.tendered || { 1: 1 })[0]),
    };
    root.add(tenderHandful);
  }

  function clearTenderHandful() {
    if (!tenderHandful) return;
    tenderHandful.removeFromParent();
    // This generous invisible hit target is transaction-owned (unlike the
    // shared denomination meshes). Dispose it on every cancel/settlement so a
    // long cash-register session does not retain one sphere buffer per sale.
    tenderHandful.geometry?.dispose();
    tenderHandful.material?.dispose();
    tenderHandful = null;
  }

  // Selected change stacks inside the authored cashier-side handoff tray where
  // both the money and the Giving line on the POS read together.
  function layoutSelectedChange() {
    const layout = physicalChangeLayout(
      selectedChangeMeshes.map((mesh) => mesh.userData.denom),
      REGISTER.changeHandoff,
      COUNTER_TOP,
    );
    selectedChangeMeshes.forEach((mesh, index) => {
      const pose = layout[index];
      mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      mesh.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
    });
  }

  function clearCashHandoffBundle() {
    if (cashHandoffBundle) cashHandoffBundle.removeFromParent();
    cashHandoffBundle = null;
    cashHandoffHoldTimer = 0;
    cashHandoffPhase = null;
  }

  function finishChangeHandoff(bundle = null) {
    if (bundle && bundle !== cashHandoffBundle) return false;
    if (bundle) {
      const grip = customerGripNode('R');
      if (grip) {
        grip.updateWorldMatrix(true, true);
        grip.attach(bundle);
      }
      cashHandoffPhase = 'customer-hold';
      cashHandoffHoldTimer = 0.85;
    } else {
      cashHandoffPhase = 'no-change';
    }
    if (checkoutFlowState() === 'GivingChange') {
      flowTo('PaymentComplete', bundle
        ? 'physical-change-bundle-reached-customer-palm'
        : 'cash-payment-required-no-change');
    }
    sfx('changeHandoff');
    if (!bundle) beginAutomaticReceipt();
    return true;
  }

  function beginChangeHandoff(meshes) {
    if (!meshes.length) return finishChangeHandoff();
    clearCashHandoffBundle();
    const bundle = new THREE.Group();
    bundle.name = 'CheckoutChangeHandoffBundle';
    bundle.userData = { kind: 'change-handoff', denom: 1 };
    bundle.position.set(
      REGISTER.changeHandoff.x - 0.018,
      COUNTER_TOP + 0.026,
      REGISTER.changeHandoff.z - 0.020,
    );
    root.add(bundle);
    const layout = changeBundleLayout(meshes.map((mesh) => mesh.userData.denom));
    meshes.forEach((mesh, index) => {
      const pose = layout[index];
      mesh.userData.pick = false;
      bundle.add(mesh);
      mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      mesh.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
    });
    cashHandoffBundle = bundle;
    cashHandoffPhase = 'travel';
    queueCashMotion(bundle, customerChangePoint(), {
      duration: 0.62,
      kind: 'change-handoff',
      lift: 0.14,
      toRotation: new THREE.Euler(0.94, -0.04, 0),
      targetProvider: customerChangePoint,
      onComplete: finishChangeHandoff,
    });
    return true;
  }

  function updateCashHandoffHold(dt) {
    if (!cashHandoffBundle || cashHandoffPhase !== 'customer-hold') return;
    cashHandoffHoldTimer = Math.max(0, cashHandoffHoldTimer - dt);
    if (cashHandoffHoldTimer > 0) return;
    cashHandoffBundle.removeFromParent();
    cashHandoffBundle = null;
    cashHandoffPhase = 'stowed';
    beginAutomaticReceipt();
  }

  function clearPhysicalTransaction({
    resetCounterBag = true,
    preserveCustomerBag = false,
    preserveCustomerReceipt = false,
  } = {}) {
    drawerPrewarmToken += 1;
    drawerPrewarm = {
      kind: 'checkout-first-use-textures',
      pendingTextures: 0,
      warmedTextures: 0,
      item: { total: 0, pending: 0, warmed: 0 },
      coin: { total: 0, pending: 0, warmed: 0 },
      complete: true,
    };
    for (const mesh of itemMeshes.values()) {
      mesh.removeFromParent();
      itemResources.dispose(mesh);
    }
    itemMeshes.clear();
    loose.length = 0;
    tenderMeshes.forEach((mesh) => mesh.removeFromParent());
    tenderMeshes = [];
    clearTenderHandful();
    selectedChangeMeshes.forEach((mesh) => mesh.removeFromParent());
    selectedChangeMeshes = [];
    clearCashHandoffBundle();
    cashMotions.forEach((motion) => motion.mesh.removeFromParent());
    cashMotions = [];
    cashMotionRefillPending = false;
    if (cardMesh) cardMesh.removeFromParent();
    cardMesh = null;
    if (preserveCustomerReceipt && receiptMesh?.userData.checkoutOwner === 'customer') {
      receiptMesh = null;
    } else {
      if (cust?.handoffReceipt === receiptMesh) cust.handoffReceipt = null;
      disposeReceiptMesh();
    }
    receiptTimer = 0;
    autoFulfilled = false;
    deliveryPhase = null;
    deliveryTimer = 0;
    deliveryFrom = null;
    deliveryTo = null;
    if (preserveCustomerBag && bagGroup?.userData.checkoutOwner === 'customer') {
      bagGroup = null;
      bagContentsNode = null;
      bagHandoffNode = null;
    } else if (resetCounterBag) {
      if (!bagGroup) buildBag();
      resetBagAtCounter();
      if (cust) cust.checkoutHandoffBag = null;
    } else if (bagGroup) {
      bagGroup.visible = false;
    }
    selectedItem = null;
    scanDrag = null;
    scanMotion = null;
    setScannerFeedback('idle');
    scanReturnTimer = 0;
    paymentAutoTimer = 0;
    finalizeTimer = 0;
    insertDrag = null;
    insertSnap = false;
    insertMessage = '';
    cardU = 0;
    cardPresentationTimer = 0;
    cardProcessingTimer = 0;
    termDotsTimer = 0;
    cardResultTimer = 0;
    cardEjectTimer = 0;
    cardPickupDelay = 0;
    exactChangeAssistancePending = false;
    cashAutoConfirmPhase = 'idle';
    cashAutoConfirmTimer = 0;
    cashRecoveryTimer = 0;
    checkoutWatchdogRunning = false;
    checkoutWatchdogPostResume = null;
    cashierCashAction = null;
    cashierHands.hideImmediately();
    clearCashValidationToast();
    drawerWant = 0;
    drawerAmount = 0;
    if (drawerMotionRoot) {
      drawerMotionRoot.position.z = 0;
      drawerMotionRoot.visible = false;
    }
    if (drawerAssetSlide) drawerAssetSlide.position.z = drawerAssetSlideBaseZ;
    if (printerPaper) {
      printerPaper.visible = false;
      printerPaper.position.y = printerPaperBaseY;
    }
    for (const entry of termKeys.values()) {
      entry.press = 0;
      entry.mesh.position.copy(entry.base);
    }
    hoverBox.visible = false;
    hoveredItem = null;
  }

  function begin(customer) {
    if (tx) return false;
    refreshAccessibilityPreferences();
    lastScanEvidence = null;
    const items = (customer.cart || []).map((item, index) => ({
      uid: item.uid || `${customer.id || customer.name}-${index}`,
      skuId: item.skuId,
      name: (skuById(item.skuId) || {}).name || item.skuId,
      price: item.price,
      placedAt: item.placedAt ? { ...item.placedAt } : null,
    }));
    if (!items.length) return false;
    state.shop.drawer = state.shop.drawer ? migrateDrawer(state.shop.drawer) : newDrawer();
    drawer = state.shop.drawer;
    tx = createTx({
      items,
      mode: state.mode,
      discount: customer.discount || 0,
      prefer: customer.payMethod || customer.paymentPreference || 'card',
    });
    tx.number = Math.max(1, Number(state.shop.nextTransactionNo || 1));
    tx.checkoutFlow = customer.checkoutFlow || createCheckoutFlow({
      state: 'WaitingForCashier',
      nowMs: flowNow(),
    });
    tx.items.forEach((item, index) => {
      item.placedAt = items[index].placedAt;
      item.staged = false;
    });
    transactionKind = 'retail';
    cust = customer;
    cust.tx = tx;
    cust.checkoutFlow = tx.checkoutFlow;
    postSaleDisplay = null;
    selectedReservationId = null;
    selectedWalkInCustomerId = null;
    activeTab = 'checkout';
    // A basket on the counter IS the work — open on the goods framing (the same wide-left
    // pose an item click uses), with the POS readable at the right. Check-ins keep the
    // straight-on monitor view; they have nothing on the counter to look at.
    assignWorkspace(tx.stage === 'scanning' && unscannedCount(tx) > 0 ? 'scan' : 'monitor');
    clearPhysicalTransaction();
    // clearPhysicalTransaction intentionally does not clear tx/cust; it only removes
    // stale meshes and gesture state from a prior completed presentation.
    for (const item of tx.items) {
      const mesh = buildItemMesh(item);
      itemMeshes.set(item.uid, mesh);
      loose.push(mesh);
      root.add(mesh);
    }
    layoutGoods();
    buildDrawer();
    refillDrawerMoney();
    scheduleCheckoutTexturePrewarm();
    drawScreen();
    drawTerm();
    return true;
  }

  function beginReservationPayment(reservation) {
    if (!reservation || tx) return false;
    refreshAccessibilityPreferences();
    const waitingCustomer = readyReservationCustomer(reservation.id);
    if (!waitingCustomer) {
      toast(`${reservation.fullName || reservation.name} has not reached the front desk yet.`, 'warn');
      drawScreen();
      return false;
    }
    const method = reservation.paymentPreference || waitingCustomer.paymentPreference || 'card';
    const created = createReservationCheckInTx(state, reservation.id, {
      method,
      rng: Math.random,
    });
    if (!created.ok) {
      toast(created.reason || 'That reservation cannot be checked in.', 'warn');
      return false;
    }
    tx = created.tx;
    tx.number = Math.max(1, Number(state.shop.nextTransactionNo || 1));
    tx.checkoutFlow = createCheckoutFlow({
      state: 'AllProductsScanned',
      nowMs: flowNow(),
    });
    transactionKind = 'reservation';
    selectedReservationId = reservation.id;
    selectedWalkInCustomerId = null;
    cust = waitingCustomer;
    cust.tx = tx;
    cust.checkoutFlow = tx.checkoutFlow;
    activeTab = 'checkout';
    assignWorkspace('monitor');
    state.shop.drawer = state.shop.drawer ? migrateDrawer(state.shop.drawer) : newDrawer();
    drawer = state.shop.drawer;
    buildDrawer();
    refillDrawerMoney();
    drawScreen();
    choosePayment(method);
    return true;
  }

  function abandon() {
    if (tx && !tx.banked) voidTx(tx);
    clearPhysicalTransaction();
    if (cust) cust.tx = null;
    tx = null;
    cust = null;
    transactionKind = 'retail';
    assignWorkspace('monitor');
    drawScreen();
    drawTerm();
  }

  // THE TILL SCREENS YOU IN — the camera glides between the station's staged
  // poses (monitor, terminal, drawer, counter) exactly as the checkout state
  // needs, standing at full height, and the mouse leans the view around each
  // pose so the cashier can glance left and right without leaving the frame.
  // The cursor is the whole interface; Escape or right-click steps away.
  function enter() {
    if (active) return false;
    refreshAccessibilityPreferences();
    active = true;
    let entered = false;
    try {
      // Checkout's fixed close cameras make the whole active register the
      // measured allocation hotspot, not only the card workspace. Hold the
      // player's exact prior AO setting once per entry and restore it on every
      // exit; workspace transitions must not recapture or release the scope.
      activeRegisterGtaoOverride.setActive(true);
      restorePointerLock = !!document.pointerLockElement;
      previousFov = camera.fov;
      // Re-entering mid-transaction resumes the workspace that stage needs —
      // a suspended cash count re-opens over the drawer, a suspended card
      // payment re-opens at the terminal. Otherwise the drawer/keypad would be
      // unreachable after an Escape-out.
      let openingWorkspace = 'monitor';
      if (tx && tx.method === 'cash' && tx.stage === 'cash-drawer' && tx.deposited) {
        openingWorkspace = 'cash';
      } else if (tx && ['card-ready', 'card-entry', 'card-busy', 'card-declined'].includes(tx.stage)) {
        openingWorkspace = 'card';
      } else if (tx && transactionKind === 'retail' && tx.stage === 'scanning' && unscannedCount(tx) > 0) {
        openingWorkspace = 'scan'; // stepping back in mid-basket resumes on the goods, same as arriving
      }
      assignWorkspace(openingWorkspace);
      activeTab = tx ? 'checkout' : 'home';
      enterTimer = 0.30;
      if (checkoutFlowState() === 'WaitingForCashier') {
        flowTo('EnteringCashierMode', 'player-opened-front-desk-monitor');
      }
      const opening = dynamicPose(poseKey());
      cameraPose = { ...opening.pose };
      activePoseKey = poseKey();
      cameraTween = null;
      lookYaw = 0;
      lookPitch = 0;
      lookTargetYaw = 0;
      lookTargetPitch = 0;
      camera.fov = opening.fov;
      camera.updateProjectionMatrix();
      focusOn(cameraPose);
      if (document.pointerLockElement) document.exitPointerLock();
      document.body.classList.add('register-mode');
      drawScreen();
      drawTerm();
      entered = true;
      return true;
    } finally {
      if (!entered) {
        active = false;
        activeRegisterGtaoOverride.restore();
      }
    }
  }

  function leave({ restorePointer = true } = {}) {
    // Teardown calls leave even when the register is already inactive. Restore
    // first so a partial/context-loss exit can never strand the player's AO off.
    activeRegisterGtaoOverride.restore();
    if (pointerRestoreTimer !== null) {
      clearTimeout(pointerRestoreTimer);
      pointerRestoreTimer = null;
    }
    if (!active) {
      if (!restorePointer) restorePointerLock = false;
      return;
    }
    recoverInput('front-desk exit');
    active = false;
    setWorkspace('monitor');
    clearFocus();
    setHoverCursor(false);
    document.body.classList.remove('register-mode');
    if (previousFov != null && camera.fov !== previousFov) {
      camera.fov = previousFov;
      camera.updateProjectionMatrix();
    }
    if (restorePointer && restorePointerLock && document.hasFocus() && canvas.requestPointerLock) {
      pointerRestoreTimer = setTimeout(() => {
        pointerRestoreTimer = null;
        try {
          const promise = canvas.requestPointerLock();
          if (promise && promise.catch) promise.catch(() => {});
        } catch (_) {
          // Browsers may require the next direct user gesture. Normal click-to-look
          // remains available in main.js if restoration is rejected.
        }
      }, 0);
    }
    restorePointerLock = false;
  }

  function recoverInput() {
    if (insertDrag || insertSnap) {
      insertDrag = null;
      insertSnap = false;
      cardU = 0;
      insertMessage = 'INSERT CARD';
      if (checkoutFlowState() === 'CardInserting') {
        flowTo('CardInsertReady', 'card-insertion-cancelled-safely');
      }
    }
    scanDrag = null;
    hoverBox.visible = false;
    drawScreen();
    drawTerm();
    return true;
  }

  function beginCardProcessing() {
    if (!tx || tx.stage !== 'card-entry') return false;
    const submitted = submitCardAmount(tx);
    if (!submitted.ok) {
      toast(submitted.reason, 'warn');
      sfx('thunk');
      drawTerm();
      drawScreen();
      return false;
    }
    cardProcessingTimer = CARD_TIME;
    termDotsTimer = 0;
    if (checkoutFlowState() === 'CardAmountEntry') {
      flowTo('CardProcessing', 'matching-card-amount-submitted');
    }
    sfx('cardProcessing');
    drawTerm();
    drawScreen();
    return true;
  }

  function applyCardKey(label) {
    if (!tx || tx.stage !== 'card-entry') return false;
    if (label === 'OK') {
      pressTerminalKey('OK');
      return beginCardProcessing();
    }
    if (label === 'CLEAR' || label === 'CANCEL') {
      clearCardAmount(tx);
      pressTerminalKey('CANCEL');
    } else if (label === 'BACK') {
      backspaceCardAmount(tx);
      pressTerminalKey('BACK');
    } else if (/^\d$/.test(String(label))) {
      enterCardDigit(tx, Number(label));
      pressTerminalKey(String(label));
    } else return false;
    sfx('uiTick');
    drawTerm();
    drawScreen();
    return true;
  }

  function handleCardKeypadAt(event) {
    if (!tx || tx.stage !== 'card-entry') return false;
    const label = terminalKeyAt(event);
    return label ? applyCardKey(label) : false;
  }

  function setWorkspace(next) {
    assignWorkspace(next);
    if (next !== 'scan') {
      selectedItem = null;
      scanDrag = null;
      hoverBox.visible = false;
    }
    // The real POS monitor stays present in every workspace — during cash it
    // carries the orange Received/Total/Change/Giving screen directly above the
    // open drawer, exactly like the reference. No stand-in panels exist.
    drawScreen();
    drawTerm();
  }

  function createCardMesh() {
    if (cardMesh) cardMesh.removeFromParent();
    // The finished Fairhollow member card from the checkout kit; the
    // procedural card remains only as a fallback if the kit failed to load.
    let base = (merch && merch.instantiateKit)
      ? merch.instantiateKit('payment_card', { scale: 1.0 })
      : null;
    if (!base) {
      base = new THREE.Mesh(
        new THREE.BoxGeometry(CARD_WIDTH, CARD_THICKNESS, CARD_HEIGHT),
        new THREE.MeshStandardMaterial({ color: 0x173f2d, roughness: 0.36 }),
      );
      const faceTexture = paymentCardTexture();
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(CARD_WIDTH - 0.004, CARD_HEIGHT - 0.004),
        new THREE.MeshStandardMaterial({
          map: faceTexture,
          emissive: 0xffffff,
          emissiveMap: faceTexture,
          emissiveIntensity: 0.16,
          roughness: 0.42,
        }),
      );
      face.rotation.x = -Math.PI / 2;
      face.position.y = CARD_THICKNESS / 2 + 0.0002;
      base.add(face);
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(CARD_WIDTH - 0.004, 0.0008, 0.014),
        new THREE.MeshStandardMaterial({ color: 0x111411, roughness: 0.5 }),
      );
      stripe.position.set(0, -CARD_THICKNESS / 2 - 0.0003, -0.016);
      base.add(stripe);
    }
    base.position.set(INSERT_READY.x, INSERT_READY.y, INSERT_READY.z);
    base.rotation.set(0, 0, 0);
    const data = { pick: true, kind: 'payment-card' };
    base.userData = data;
    base.traverse((o) => { if (o.isMesh) o.userData = { ...o.userData, ...data }; });
    suppressInteriorSunShadows(base);
    root.add(base);
    cardMesh = base;
  }

  function createTender() {
    tenderMeshes.forEach((mesh) => mesh.removeFromParent());
    tenderMeshes = [];
    clearTenderHandful();
    customerCash(tx);
    if (!makeChangeFrom(drawerContents(tx, drawer), changeDue(tx))) {
      tx.tendered = makeChange(cashTotalOf(tx));
      toast('The customer provides exact cash because the till cannot make that change.');
    }
    for (const [rawDenom, count] of Object.entries(tx.tendered || {})) {
      const denom = Number(rawDenom);
      for (let index = 0; index < count; index += 1) {
        const mesh = makeMoney(denom, 'tender');
        root.add(mesh);
        tenderMeshes.push(mesh);
      }
    }
    presentTender();
    sfx('cashPresent');
  }

  function choosePayment(method) {
    if (!tx || tx.stage !== 'scanning') return false;
    tx.prefer = method;
    if (checkoutFlowState() === 'AllProductsScanned') {
      flowTo('ChoosingPayment', 'player-selected-payment-on-monitor');
    }
    const result = requestPayment(tx);
    if (!result.ok) {
      toast(result.reason, 'warn');
      return false;
    }
    if (method === 'card') {
      if (checkoutFlowState() === 'ChoosingPayment') flowTo('CardPresented', 'customer-presented-card');
      poseCustomerForCheckout('Present');
      createCardMesh();
      // the card waits HELD OUT in the customer's hand, not laid on the counter — the
      // eject leg returns it to the same hand
      cardTravel.ready.copy(customerCardReadyPoint());
      cardPresentationTimer = 0.55;
      cardU = 0;
      insertDrag = null;
      insertSnap = false;
      insertMessage = '';
      cardEjectTimer = 0;
      cardPickupDelay = 0;
      setWorkspace('card');
    } else {
      if (checkoutFlowState() === 'ChoosingPayment') flowTo('CashPresented', 'customer-presented-cash');
      poseCustomerForCheckout('Present');
      // The customer holds their cash out across the counter. The player CLICKS
      // the handful: it slides into the register, the drawer opens on its
      // own, and the change count begins — no dragging, no sorting mini-game.
      createTender();
    }
    drawScreen();
    drawTerm();
    return true;
  }

  // The single cash acceptance click. Everything after it is automatic: the
  // tender snaps into its labelled wells, the drawer slides open, and the
  // camera moves to the drawer-and-monitor view for change selection.
  function acceptPresentedCash() {
    if (!tx || tx.method !== 'cash' || tx.stage !== 'cash-tender') return false;
    if (!sortReceivedCash()) return false;
    setWorkspace('cash');
    return true;
  }

  function switchDeclinedCardToCash() {
    if (!tx || tx.stage !== 'card-declined') return false;
    const cancelled = cancelCard(tx);
    if (!cancelled.ok) return false;
    if (checkoutFlowState() === 'CardDeclined') flowTo('ChoosingPayment', 'customer-switched-to-cash');
    const changed = payCashInstead(tx);
    if (!changed.ok) return false;
    if (cardMesh) cardMesh.removeFromParent();
    cardMesh = null;
    if (checkoutFlowState() === 'ChoosingPayment') flowTo('CashPresented', 'customer-presented-cash-after-decline');
    poseCustomerForCheckout('Present');
    createTender();
    // Match the normal cash route: first present the customer's tender in the
    // shared counter frame. Only the acceptance click opens the drawer and
    // moves to the downward change-counting camera.
    setWorkspace('monitor');
    drawTerm();
    return true;
  }

  function startScanning() {
    if (!tx || tx.stage !== 'scanning' || unscannedCount(tx) === 0) return false;
    setWorkspace('scan');
    selectedItem = null;
    scanMotion = null;
    scanDrag = null;
    return true;
  }

  function scanPoseFor(mesh) {
    const barcodeAnchor = mesh?.userData?.barcodeAnchor;
    const barcodeMesh = mesh?.userData?.barcodeMesh;
    if (!barcodeAnchor || !barcodeMesh) return null;
    mesh.updateWorldMatrix(true, true);
    const barcodeLocalPosition = mesh.worldToLocal(
      barcodeMesh.getWorldPosition(new THREE.Vector3()),
    );
    const meshWorldQuaternion = mesh.getWorldQuaternion(new THREE.Quaternion());
    const barcodeLocalQuaternion = meshWorldQuaternion.clone().invert().multiply(
      barcodeMesh.getWorldQuaternion(new THREE.Quaternion()),
    );
    const scanner = scannerRayPose();
    const normal = scanner.direction.clone().multiplyScalar(-1).normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(up.dot(normal)) > 0.96) up = new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const correctedUp = new THREE.Vector3().crossVectors(normal, right).normalize();
    const anchorQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, correctedUp, normal),
    );
    const meshQuaternion = anchorQuaternion.clone().multiply(
      barcodeLocalQuaternion.invert(),
    );
    const anchorOffset = barcodeLocalPosition
      .multiply(mesh.scale)
      .applyQuaternion(meshQuaternion);
    const tangent = new THREE.Vector3().crossVectors(
      new THREE.Vector3(0, 1, 0), scanner.direction,
    ).normalize();
    const centerTarget = scanner.origin.clone()
      .addScaledVector(scanner.direction, CHECKOUT_SCAN_TARGET.distance)
      .addScaledVector(tangent, CHECKOUT_SCAN_TARGET.sideOffset)
      .addScaledVector(correctedUp, CHECKOUT_SCAN_TARGET.upOffset);
    const entryTarget = centerTarget.clone()
      .addScaledVector(tangent, -CHECKOUT_SCAN_TARGET.sweep);
    const exitTarget = centerTarget.clone()
      .addScaledVector(tangent, CHECKOUT_SCAN_TARGET.sweep);
    return {
      scanner,
      quaternion: meshQuaternion,
      entry: entryTarget.sub(anchorOffset),
      center: centerTarget.sub(anchorOffset),
      exit: exitTarget.sub(anchorOffset),
    };
  }

  function scanReadFor(motion) {
    root.updateMatrixWorld(true);
    const barcodeMesh = motion.mesh.userData.barcodeMesh;
    const barcodePosition = barcodeMesh.getWorldPosition(new THREE.Vector3());
    const barcodeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      barcodeMesh.getWorldQuaternion(new THREE.Quaternion()),
    ).normalize();
    const scanner = scannerRayPose();
    const facts = scannerReadFacts({
      barcodePosition: barcodePosition.toArray(),
      barcodeNormal: barcodeNormal.toArray(),
      rayOrigin: scanner.worldOrigin.toArray(),
      rayDirection: scanner.worldDirection.toArray(),
    });
    const judgment = judgeBarcodeRead({
      barcode: motion.barcode,
      scanHit: facts.scanHit,
      facingDot: facts.facingDot,
      itemUid: motion.uid,
      expectedUid: motion.item.uid,
      alreadyScanned: motion.item.scanned,
    });
    lastScanEvidence = {
      uid: motion.uid,
      skuId: motion.item.skuId,
      barcode: motion.barcode,
      scannerSource: scanner.source,
      phase: motion.phase,
      ok: judgment.ok,
      code: judgment.code,
      scanHit: facts.scanHit,
      facingDot: facts.facingDot,
      distanceAlongRay: facts.distanceAlongRay,
      lateralDistance: facts.lateralDistance,
      barcodePosition: barcodePosition.toArray(),
      barcodeNormal: barcodeNormal.toArray(),
      rayOrigin: scanner.worldOrigin.toArray(),
      rayDirection: scanner.worldDirection.toArray(),
      capturedAtMs: performance.now(),
    };
    return { judgment, facts };
  }

  function rejectScanMotion(motion, message) {
    motion.mesh.position.copy(motion.from);
    motion.mesh.quaternion.copy(motion.fromQuaternion);
    motion.mesh.scale.copy(motion.fromScale);
    scanMotion = null;
    setScannerFeedback('invalid', 0.48);
    toast(message, 'warn');
    sfx('scanInvalid');
    if (checkoutFlowState() === 'ProductScanning') {
      flowTo('ProductHeld', `barcode-read-rejected:${motion.uid}`);
    }
    if (checkoutFlowState() === 'ProductHeld') {
      flowTo('WaitingForScan', `product-restaged:${motion.uid}`);
    }
    return false;
  }

  function commitScanMotion(motion) {
    if (motion.committed) return true;
    const { judgment } = scanReadFor(motion);
    if (!judgment.ok) {
      return rejectScanMotion(
        motion,
        BARCODE_MSG[judgment.code] || 'The scanner could not read that barcode.',
      );
    }
    const result = scanItem(tx, motion.uid);
    if (!result.ok) return rejectScanMotion(motion, result.reason);
    motion.item.staged = true;
    motion.committed = true;
    if (checkoutFlowState() === 'ProductScanning') {
      flowTo('ProductScanned', `barcode-read:${motion.uid}`);
    }
    setScannerFeedback('success', 0.55);
    sfx('scanSuccess');
    sfx('posAdd');
    drawScreen();
    return true;
  }

  // CLICK TO SCAN AND BAG. One forgiving product click owns the entire physical
  // gesture: pickup, visible barcode alignment, reader contact, POS commit, and
  // bag/set-aside placement. There is no drag or hidden second click.
  function bagProduct(picked) {
    if (!picked || !tx || tx.stage !== 'scanning' || scanMotion) return false;
    // The pick may be the invisible click pad; choreography animates the real item.
    const mesh = itemMeshes.get(picked.userData.uid) || picked;
    const item = tx.items.find((candidate) => candidate.uid === mesh.userData.uid);
    if (!item || item.scanned) return false;
    if (checkoutFlowState() === 'WaitingForScan') {
      flowTo('ProductHeld', `picked-product:${item.uid}`);
    }
    if (checkoutFlowState() === 'ProductHeld') {
      flowTo('ProductScanning', `moving-product-to-reader:${item.uid}`);
    }
    const scanPose = scanPoseFor(mesh);
    if (!scanPose) return rejectScanMotion({
      mesh,
      uid: item.uid,
      from: mesh.position.clone(),
      fromQuaternion: mesh.quaternion.clone(),
      fromScale: mesh.scale.clone(),
    }, 'This product has no readable barcode mount.');
    hoverBox.visible = false;
    hoveredItem = null;
    selectedItem = null;
    sfx('productPickup');
    sfx('scannerActivate');
    setScannerFeedback('active', 0.62);
    const separateHandoff = !!mesh.userData.catalogVisual?.separateHandoff;
    const oversizeCount = tx.items.filter((candidate) => candidate.scanned
      && itemMeshes.get(candidate.uid)?.userData?.catalogVisual?.separateHandoff).length;
    const destination = separateHandoff
      ? new THREE.Vector3(1.88 + oversizeCount * 0.07, REST_Y, 4.08)
      : bagMouth.clone();
    // Compact goods leave the reader for the carrier; full-size goods leave it
    // for the clearly separated oversize handoff zone.
    scanMotion = {
      phase: 'pickup',
      destinationKind: separateHandoff ? 'oversize' : 'bag',
      mesh,
      item,
      uid: item.uid,
      barcode: mesh.userData.barcode,
      committed: false,
      elapsed: 0,
      duration: scanDuration(),
      from: mesh.position.clone(),
      to: destination,
      fromQuaternion: mesh.quaternion.clone(),
      fromScale: mesh.scale.clone(),
      scanEntry: scanPose.entry,
      scanCenter: scanPose.center,
      scanExit: scanPose.exit,
      scanQuaternion: scanPose.quaternion,
      toQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, Math.PI * 0.6, 0.4)),
    };
    return true;
  }

  function updateScanMotion(dt) {
    if (!scanMotion) return;
    const motion = scanMotion;
    motion.elapsed = Math.min(motion.duration, motion.elapsed + dt);
    const choreography = scanChoreographyAt(motion.elapsed);
    motion.phase = choreography.phase;
    const eased = THREE.MathUtils.smoothstep(choreography.phaseT, 0, 1);
    motion.mesh.scale.copy(motion.fromScale);
    if (choreography.phase === 'pickup') {
      motion.mesh.position.lerpVectors(motion.from, motion.scanEntry, eased);
      motion.mesh.position.y += Math.sin(choreography.phaseT * Math.PI) * 0.10;
      motion.mesh.quaternion.slerpQuaternions(
        motion.fromQuaternion, motion.scanQuaternion, eased,
      );
    } else if (choreography.phase === 'scan-approach') {
      motion.mesh.position.lerpVectors(motion.scanEntry, motion.scanCenter, eased);
      motion.mesh.quaternion.copy(motion.scanQuaternion);
    } else if (choreography.phase === 'scan-hold') {
      motion.mesh.position.copy(motion.scanCenter);
      motion.mesh.quaternion.copy(motion.scanQuaternion);
    } else if (choreography.phase === 'scan-exit') {
      motion.mesh.position.lerpVectors(motion.scanCenter, motion.scanExit, eased);
      motion.mesh.quaternion.copy(motion.scanQuaternion);
    } else {
      motion.mesh.position.lerpVectors(motion.scanExit, motion.to, eased);
      motion.mesh.position.y += Math.sin(choreography.phaseT * Math.PI) * 0.20;
      motion.mesh.quaternion.slerpQuaternions(
        motion.scanQuaternion, motion.toQuaternion, eased,
      );
    }
    if (choreography.shouldCommitScan && !motion.committed) {
      if (!commitScanMotion(motion)) return;
    }
    // Compact goods scale down only while descending through the bag opening.
    if (motion.destinationKind === 'bag' && choreography.phase === 'bag'
        && choreography.phaseT > 0.60) {
      const s = 1 - ((choreography.phaseT - 0.60) / 0.40) * 0.52;
      const base = motion.mesh.userData.originalScale;
      if (base) motion.mesh.scale.set(base.x * s, base.y * s, base.z * s);
    }
    if (!choreography.complete) return;
    scanMotion = null;
    settleScannedProduct(motion.mesh);
    if (motion.destinationKind === 'bag') sfx('bagItem');
    selectedItem = null;
    const remaining = unscannedCount(tx);
    if (checkoutFlowState() === 'ProductScanned') {
      flowTo(
        remaining ? 'WaitingForScan' : 'AllProductsScanned',
        remaining ? 'bagged-product-auto-finished' : 'all-products-bagged',
      );
    }
    if (!remaining) {
      scanReturnTimer = 0.42;
      paymentAutoTimer = 1.35;
      drawScreen();
    }
  }

  function updateScannerFeedback(dt) {
    if (scannerPulse <= 0) return;
    scannerPulse = Math.max(0, scannerPulse - dt);
    if (scannerPulse === 0) setScannerFeedback('idle');
  }

  function insertionProgressAt(event) {
    const ready = projectLocal(INSERT_READY);
    const inserted = projectLocal(INSERTED);
    const vx = inserted.x - ready.x;
    const vy = inserted.y - ready.y;
    const lengthSq = Math.max(1, vx * vx + vy * vy);
    return THREE.MathUtils.clamp(
      ((event.clientX - ready.x) * vx + (event.clientY - ready.y) * vy) / lengthSq,
      0,
      1,
    );
  }

  function startInsert(event) {
    if (!tx || tx.stage !== 'card-ready' || cardPresentationTimer > 0 || insertSnap) return false;
    const ready = projectLocal(INSERT_READY);
    const rect = canvas.getBoundingClientRect();
    const hitX = Math.max(110, rect.width * 0.09);
    const hitY = Math.max(90, rect.height * 0.12);
    if (Math.abs(event.clientX - ready.x) > hitX || Math.abs(event.clientY - ready.y) > hitY) {
      insertMessage = 'CLICK THE CARD';
      toast('Click the aligned card, then push it into the chip slot.', 'warn');
      sfx('thunk');
      drawTerm();
      return false;
    }
    insertDrag = { startedAt: performance.now() };
    insertMessage = '';
    if (checkoutFlowState() === 'CardInsertReady') {
      flowTo('CardInserting', 'player-started-card-insertion');
    }
    // The insert cue fires from autoInsertCard (the live path); the manual
    // fallback stays silent to keep a single one-shot edge for the sound.
    feedInsert(event);
    return true;
  }

  function feedInsert(event) {
    if (!insertDrag) return;
    cardU = Math.max(cardU, insertionProgressAt(event));
  }

  function endInsert(event) {
    if (!insertDrag || !tx || tx.stage !== 'card-ready') return false;
    if (event) feedInsert(event);
    insertDrag = null;
    // A click, short push, fast move, or slow move all snap to the same stop.
    // The interaction communicates insertion without grading mouse technique.
    insertSnap = true;
    cardPickupDelay = 0;
    insertMessage = 'INSERTING';
    drawTerm();
    return true;
  }

  function retryDeclinedCard() {
    if (!tx || tx.stage !== 'card-declined') return false;
    const result = retryCard(tx);
    if (!result.ok) return false;
    if (checkoutFlowState() === 'CardDeclined') {
      flowTo('CardPresented', 'customer-presented-replacement-card');
    }
    poseCustomerForCheckout('Present');
    createCardMesh();
    cardU = 0;
    cardTravel.ready.copy(customerCardReadyPoint()); // the replacement is held out too
    cardPresentationTimer = 0.52;
    insertDrag = null;
    insertSnap = false;
    insertMessage = '';
    cardEjectTimer = 0;
    cardPickupDelay = 0;
    setWorkspace('card');
    return true;
  }

  function ensureCashDrawerStarted() {
    if (!tx || tx.method !== 'cash') return false;
    if (tx.stage === 'cash-tender') {
      const accepted = acceptCash(tx);
      if (!accepted.ok) {
        toast(accepted.reason, 'warn');
        return false;
      }
      if (checkoutFlowState() === 'CashPresented') {
        flowTo('CashAccepted', 'player-clicked-received-cash');
      }
    }
    if (tx.stage !== 'cash-drawer') return false;
    if (!tx.drawerOpen) {
      const opened = openDrawer(tx);
      if (!opened.ok) {
        toast(opened.reason, 'warn');
        return false;
      }
      drawerWant = 1;
      if (checkoutFlowState() === 'CashAccepted') {
        flowTo('DrawerOpening', 'cash-pile-auto-opened-drawer');
      }
      sfx('drawerUnlock');
      sfx('drawerOpen');
    }
    drawScreen();
    return true;
  }

  function sortReceivedCash() {
    if (!ensureCashDrawerStarted()) return false;
    if (tx.deposited) {
      toast('The received cash is already sorted.');
      return true;
    }
    const sorted = depositTendered(tx, drawer);
    if (!sorted.ok) {
      toast(sorted.reason, 'warn');
      return false;
    }
    const depositedMeshes = [...tenderMeshes];
    exactChangeAssistancePending = accessibilityPrefs.automaticExactChange;
    cashAutoConfirmPhase = 'idle';
    cashAutoConfirmTimer = 0;
    tenderMeshes = [];
    clearTenderHandful();
    const perDenom = new Map();
    // Every piece first converges through one tight bundle above the handoff
    // tray, then separates into its labelled well. The former straight fan-to-
    // well paths briefly looked like unrelated floating bills.
    const bundlePoint = new THREE.Vector3(
      REGISTER.changeHandoff.x,
      COUNTER_TOP + 0.13,
      REGISTER.changeHandoff.z + 0.01,
    );
    depositedMeshes.forEach((mesh, index) => {
      const denom = Number(mesh.userData.denom);
      const stackIndex = perDenom.get(denom) || 0;
      perDenom.set(denom, stackIndex + 1);
      mesh.userData.from = 'settling';
      queueCashMotion(mesh, drawerSlotPosition(denom, stackIndex * 0.003), {
        delay: index * 0.018,
        duration: 0.56,
        remove: true,
        kind: 'cash-deposit',
        drawerDenom: denom,
        stackOffset: stackIndex * 0.003,
        via: bundlePoint.clone().add(new THREE.Vector3(
          ((index % 3) - 1) * 0.008,
          Math.floor(index / 3) * 0.003,
          (index % 2 ? 1 : -1) * 0.005,
        )),
        lift: 0.08,
      });
    });
    cashMotionRefillPending = depositedMeshes.length > 0;
    if (!depositedMeshes.length) refillDrawerMoney();
    if (checkoutFlowState() === 'DrawerOpening') {
      // The physical slide may still be opening; update() advances to DepositingCash
      // at the stop, then immediately to SelectingChange from the deposited fact.
    } else if (checkoutFlowState() === 'DepositingCash') {
      flowTo('SelectingChange', 'accessibility-sort-completed');
    }
    sfx('billHandle');
    drawScreen();
    return true;
  }

  function selectChangeFromSlot(denom, {
    assisted = false,
    silent = false,
    deferDraw = false,
  } = {}) {
    if (!tx || !tx.drawerOpen || !tx.deposited) return false;
    if (!assisted) exactChangeAssistancePending = false;
    const result = takeFromDrawer(tx, drawer, denom);
    if (!result.ok) {
      toast(result.reason, 'warn');
      sfx('thunk');
      return false;
    }
    clearCashValidationToast();
    const mesh = makeMoney(denom, 'change');
    root.add(mesh);
    selectedChangeMeshes.push(mesh);
    layoutSelectedChange();
    pulseCashierHand(mesh, 'select-change', 0.08);
    refillDrawerMoney();
    if (!silent) sfx('changeSelect');
    if (!deferDraw) drawScreen();
    return true;
  }

  function returnSelectedChange(mesh) {
    if (!mesh || !tx || mesh.userData.from !== 'change') return false;
    exactChangeAssistancePending = false;
    cashAutoConfirmPhase = 'idle';
    cashAutoConfirmTimer = 0;
    const result = returnToDrawer(tx, drawer, mesh.userData.denom);
    if (!result.ok) return false;
    clearCashValidationToast();
    pulseCashierHand(cashierTargetFor(mesh), 'select-change', 0.08);
    mesh.removeFromParent();
    selectedChangeMeshes = selectedChangeMeshes.filter((candidate) => candidate !== mesh);
    layoutSelectedChange();
    refillDrawerMoney();
    drawScreen();
    sfx(BILLS.includes(mesh.userData.denom) ? 'billHandle' : 'coinHandle');
    return true;
  }

  function undoLastChange() {
    if (!selectedChangeMeshes.length) return false;
    return returnSelectedChange(selectedChangeMeshes[selectedChangeMeshes.length - 1]);
  }

  function clearSelectedChange() {
    if (!selectedChangeMeshes.length) return false;
    while (selectedChangeMeshes.length) {
      if (!returnSelectedChange(selectedChangeMeshes[selectedChangeMeshes.length - 1])) break;
    }
    return true;
  }

  function applyExactChangeAssistance() {
    exactChangeAssistancePending = false;
    if (!tx || tx.stage !== 'cash-drawer' || !tx.drawerOpen || !tx.deposited) return false;
    if (selectedChangeMeshes.length || handTotal(tx) > 0) return false;
    const plan = makeChangeFrom(drawerContents(tx, drawer), changeDue(tx));
    if (!plan) {
      toast('The drawer cannot make exact change. Choose an allowed amount manually.', 'warn');
      return false;
    }
    let pieces = 0;
    for (const denom of DENOMS) {
      const count = Number(plan[denom]) || 0;
      for (let index = 0; index < count; index += 1) {
        if (!selectChangeFromSlot(denom, { assisted: true, silent: true, deferDraw: true })) {
          clearSelectedChange();
          toast('Exact-change assistance stopped before moving any money.', 'warn');
          return false;
        }
        pieces += 1;
      }
    }
    if (pieces) sfx('changeSelect');
    toast(pieces ? 'Exact change counted for you.' : 'No change is due.');
    drawScreen();
    return true;
  }

  function updateCashAccessibility(dt) {
    if (!tx || tx.stage !== 'cash-drawer' || !tx.deposited) {
      cashAutoConfirmPhase = 'idle';
      cashAutoConfirmTimer = 0;
      return;
    }
    const depositMoving = cashMotions.some((motion) => motion.kind === 'cash-deposit');
    if (exactChangeAssistancePending && drawerAmount >= 0.98 && !depositMoving) {
      applyExactChangeAssistance();
    }
    const readyForHandoff = drawerAmount >= 0.98
      && !depositMoving
      && checkoutFlowState() === 'SelectingChange';
    if (!readyForHandoff) {
      cashAutoConfirmPhase = 'idle';
      cashAutoConfirmTimer = 0;
      return;
    }
    const giving = changeGivingState(tx);
    if (!shouldAutoConfirmExactChange(accessibilityPrefs, giving.state)) {
      cashAutoConfirmPhase = 'idle';
      cashAutoConfirmTimer = 0;
      return;
    }
    if (cashAutoConfirmPhase === 'idle') {
      cashAutoConfirmPhase = 'waiting';
      cashAutoConfirmTimer = 0.28;
      return;
    }
    if (cashAutoConfirmPhase !== 'waiting') return;
    cashAutoConfirmTimer = Math.max(0, cashAutoConfirmTimer - dt);
    if (cashAutoConfirmTimer > 0) return;
    cashAutoConfirmPhase = 'fired';
    if (!confirmChange(true)) cashAutoConfirmPhase = 'idle';
  }

  // DONE. Completion follows the change window exactly: at least the required
  // change, at most $5.00 extra. Under and beyond-the-ceiling both refuse with
  // the drawer still open; an allowed overage books as till shortage.
  function confirmChange(automatic = false) {
    if (!tx || tx.stage !== 'cash-drawer' || !tx.deposited) return false;
    const giving = changeGivingState(tx);
    if (giving.state === 'short') {
      cashValidationWarning(`Short by $${(Math.abs(giving.deltaCents) / 100).toFixed(2)} — the customer must receive full change.`);
      sfx('thunk');
      drawScreen();
      return false;
    }
    if (giving.state === 'excess') {
      cashValidationWarning('Too much — the register allows at most $5.00 extra.');
      sfx('thunk');
      drawScreen();
      return false;
    }
    if (checkoutFlowState() === 'SelectingChange') {
      flowTo(
        'GivingChange',
        automatic ? 'accessibility-auto-confirmed-exact-change' : 'player-confirmed-monitor-change-total',
      );
    }
    const handed = handOverChange(tx, drawer);
    if (!handed.ok) {
      toast(handed.reason, 'warn');
      return false;
    }
    clearCashValidationToast();
    // The counted pieces become one held stack. Its carrier follows the live
    // articulated palm, so bills and coins cannot fan out across the counter.
    const handedMeshes = [...selectedChangeMeshes];
    selectedChangeMeshes = [];
    beginChangeHandoff(handedMeshes);
    // The till closes while the cashier's hand crosses the counter. Receipt
    // printing begins only after the physical bundle reaches the customer.
    drawerWant = 0;
    sfx('drawerClose');
    setWorkspace('monitor');
    return true;
  }

  // --- THE PHYSICAL RECEIPT -------------------------------------------------
  // A real curled paper strip whose texture is the actual transaction: header,
  // items, totals, payment, the change breakdown (including any courtesy
  // extra), and the tee-time confirmation for check-ins. It feeds out of the
  // printer slot, pauses, then flies to the customer — and only after they
  // hold it does the bag follow and the sale bank.

  function receiptContentTexture() {
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 256;
    canvas2d.height = 720;
    const ctx = canvas2d.getContext('2d');
    ctx.fillStyle = '#faf6ea';
    ctx.fillRect(0, 0, 256, 720);
    ctx.fillStyle = '#2a332c';
    ctx.textAlign = 'center';
    let y = 46;
    ctx.font = '700 26px Georgia, serif';
    ctx.fillText('FAIRHOLLOW', 128, y); y += 26;
    ctx.font = '600 15px Arial, sans-serif';
    ctx.fillStyle = '#5d6a60';
    ctx.fillText('GOLF CLUB · PRO SHOP', 128, y); y += 22;
    const clockMinutes = state.clock ? state.clock.minutes : 0;
    const dayNumber = Math.floor(clockMinutes / 1440) + 1;
    const minuteOfDay = clockMinutes % 1440;
    const hour12 = ((Math.floor(minuteOfDay / 60) + 11) % 12) + 1;
    const minutePart = String(minuteOfDay % 60).padStart(2, '0');
    const meridiem = minuteOfDay < 720 ? 'AM' : 'PM';
    ctx.fillText(`DAY ${dayNumber}  ·  ${hour12}:${minutePart} ${meridiem}`, 128, y); y += 20;
    const customerName = cust ? (cust.fullName || cust.name || 'Guest') : 'Guest';
    ctx.fillText(customerName.toUpperCase(), 128, y); y += 16;

    const rule = () => {
      ctx.strokeStyle = '#b9b2a0';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(18, y);
      ctx.lineTo(238, y);
      ctx.stroke();
      ctx.setLineDash([]);
      y += 22;
    };
    rule();

    ctx.font = '600 15px Arial, sans-serif';
    ctx.fillStyle = '#2a332c';
    for (const item of tx.items.slice(0, 8)) {
      ctx.textAlign = 'left';
      const label = item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name;
      ctx.fillText(label, 20, y);
      ctx.textAlign = 'right';
      ctx.fillText(`$${item.price.toFixed(2)}`, 236, y);
      y += 21;
    }
    if (tx.items.length > 8) {
      ctx.textAlign = 'left';
      ctx.fillText(`+ ${tx.items.length - 8} more`, 20, y);
      y += 21;
    }
    y += 2;
    rule();

    const money = (label, value, strong = false) => {
      ctx.font = strong ? '700 18px Arial, sans-serif' : '600 15px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, 20, y);
      ctx.textAlign = 'right';
      ctx.fillText(`$${Number(value).toFixed(2)}`, 236, y);
      y += strong ? 25 : 21;
    };
    money('SUBTOTAL', subtotal(tx));
    if (discountOf(tx) > 0) money('DISCOUNT', -discountOf(tx));
    money('TOTAL', dueOf(tx), true);
    ctx.textAlign = 'left';
    ctx.fillText(tx.method === 'cash' ? 'PAID · CASH' : 'PAID · CARD (APPROVED)', 20, y);
    y += 21;
    if (tx.method === 'cash') {
      money('CASH RECEIVED', tx.tenderedTotal != null ? tx.tenderedTotal : 0);
      money('REQUIRED CHANGE', changeDue(tx));
      money('CHANGE GIVEN', tx.changeGiven != null ? tx.changeGiven : changeDue(tx));
      const extra = Math.max(0, tx.lost || 0);
      if (extra > 0) money('EXTRA CHANGE', extra);
    }
    if (transactionKind === 'reservation' && tx.servicePayment) {
      y += 2;
      rule();
      const reservation = activeReservation();
      ctx.textAlign = 'center';
      ctx.font = '700 16px Arial, sans-serif';
      ctx.fillText('TEE-TIME CHECK-IN', 128, y); y += 21;
      ctx.font = '600 15px Arial, sans-serif';
      if (reservation) ctx.fillText(`TEE TIME  ${fmtSlot(reservation.minute)}`, 128, y), y += 20;
      ctx.fillText(`RES #${tx.servicePayment.reservationId ?? tx.servicePayment.referenceId}`, 128, y);
      y += 20;
      ctx.fillText('CONFIRMED — ENJOY YOUR ROUND', 128, y);
      y += 4;
    }
    y += 2;
    rule();
    ctx.textAlign = 'center';
    ctx.font = '600 15px Arial, sans-serif';
    ctx.fillText('THANK YOU FOR VISITING', 128, y); y += 20;
    ctx.font = 'italic 600 14px Georgia, serif';
    ctx.fillStyle = '#776850';
    ctx.fillText('SEE YOU ON THE FAIRWAY.', 128, y);

    // Map only the printed stock to the physical strip. The old fixed 720 px
    // canvas left almost half of a normal three-item receipt blank, making the
    // print look vertically misregistered from the player camera. Keep enough
    // breathing room for the header/footer while allowing long receipts to use
    // the full source canvas.
    const usedHeight = Math.min(canvas2d.height, Math.max(480, Math.ceil(y + 34)));
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = canvas2d.width;
    textureCanvas.height = usedHeight;
    const textureContext = textureCanvas.getContext('2d');
    textureContext.drawImage(
      canvas2d,
      0, 0, canvas2d.width, usedHeight,
      0, 0, textureCanvas.width, textureCanvas.height,
    );
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  // a paper strip anchored at its bottom edge, curling gently away at the top
  function buildReceiptGeometry(width, length, segments = 10, curl = 0.30) {
    const geometry = new THREE.PlaneGeometry(width, length, 1, segments);
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      const yy = position.getY(index) + length / 2;
      const t = yy / length;
      position.setY(index, yy);
      position.setZ(index, -curl * length * t * t * 0.35);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  function printerSlotLocal() {
    if (printerOutputSocket) {
      root.updateMatrixWorld(true);
      const world = printerOutputSocket.getWorldPosition(new THREE.Vector3());
      return root.worldToLocal(world);
    }
    if (printerPaper) {
      root.updateMatrixWorld(true);
      const world = printerPaper.getWorldPosition(new THREE.Vector3());
      return root.worldToLocal(world);
    }
    return new THREE.Vector3(REGISTER.printer.x, COUNTER_TOP + 0.10, REGISTER.printer.z - 0.05);
  }

  function ensureReceiptMesh({ fullyExposed = false, resetToPrinter = false } = {}) {
    if (!receiptMesh) {
      let geometry = null;
      const receiptPrototype = merch && merch.instantiateKit
        ? merch.instantiateKit('loose_receipt', { scale: 1.0 })
        : null;
      const authoredStrip = receiptPrototype?.getObjectByName('Receipt_Strip');
      if (authoredStrip?.geometry) {
        authoredStrip.updateMatrix();
        geometry = authoredStrip.geometry.clone().applyMatrix4(authoredStrip.matrix);
        geometry.computeBoundingBox();
        const authoredSize = geometry.boundingBox?.getSize(new THREE.Vector3());
        if (!receiptGeometryUsesFeedAxis(authoredSize)) {
          geometry.dispose();
          geometry = null;
        }
      }
      receiptMesh = new THREE.Mesh(
        geometry || buildReceiptGeometry(0.075, 0.185),
        new THREE.MeshBasicMaterial({
          map: receiptContentTexture(),
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      receiptMesh.name = 'PrintedReceipt';
      receiptMesh.userData.authoredGeometry = !!geometry;
      receiptMesh.userData.checkoutOwnedReceipt = true;
      root.add(receiptMesh);
      resetToPrinter = true;
    }
    if (resetToPrinter) {
      // A recovery may find the same receipt parented to a customer grip after
      // an interrupted handoff. Reuse that one mesh and put it back at the
      // printer rather than creating a duplicate paper prop.
      root.updateMatrixWorld(true);
      root.attach(receiptMesh);
      const slot = printerSlotLocal();
      slot.y += 0.012;
      slot.z += 0.022;
      receiptMesh.position.copy(slot);
      receiptMesh.rotation.set(-0.42, 0, 0);
    }
    receiptMesh.visible = true;
    receiptMesh.scale.y = fullyExposed ? 1 : 0.04;
    return receiptMesh;
  }

  function beginAutomaticReceipt() {
    if (!tx || tx.stage !== 'receipt' || receiptTimer > 0 || autoFulfilled) return false;
    if (checkoutFlowState() === 'CardApproved') {
      flowTo('PaymentComplete', 'card-approval-read-on-terminal');
    }
    if (checkoutFlowState() === 'PaymentComplete') {
      flowTo('ReceiptPrinting', 'automatic-receipt-started');
    }
    const printed = printReceipt(tx);
    if (!printed.ok && !tx.receiptPrinted) {
      toast(printed.reason, 'warn');
      return false;
    }
    // Stand the paper proud of the slot so it never feeds through the housing.
    ensureReceiptMesh({ resetToPrinter: true });
    deliveryPhase = 'receipt-print';
    receiptTimer = RECEIPT_TIME;
    setWorkspace('monitor');
    sfx('receiptPrint');
    drawScreen();
    return true;
  }

  function finishAutomaticFulfillment() {
    if (!tx || tx.banked || autoFulfilled
        || !['receipt', 'bagging', 'done'].includes(tx.stage)) return false;

    // Resume from durable domain flags. Each verb is called only in the stage
    // where it can advance, so retrying this presentation cannot print, pack,
    // bag, hand over, or settle money twice.
    if (tx.stage === 'receipt') {
      if (!tx.receiptPrinted) {
        const printed = printReceipt(tx);
        if (!printed.ok) return false;
      }
      const taken = takeReceipt(tx);
      if (!taken.ok) {
        toast(taken.reason, 'warn');
        return false;
      }
    }
    if (checkoutFlowState() === 'ReceiptPrinting') {
      flowTo('Bagging', 'receipt-auto-filed-no-player-pickup');
    }
    if (tx.stage === 'bagging' && !tx.receiptPacked) {
      const packed = packReceipt(tx);
      if (!packed.ok) {
        toast(packed.reason, 'warn');
        return false;
      }
    }
    if (tx.stage === 'bagging') {
      for (const item of tx.items) {
        if (!item.bagged) {
          const result = bagItem(tx, item.uid);
          if (!result.ok) {
            toast(result.reason, 'warn');
            return false;
          }
        }
      }
      const handed = handOverGoods(tx);
      if (!handed.ok) {
        toast(handed.reason, 'warn');
        return false;
      }
    }
    ensureReceiptMesh({ fullyExposed: true });
    autoFulfilled = true;
    // The sim-side order is complete (receipt packed, goods bagged). Now the
    // PHYSICAL delivery runs: receipt to the customer, then the bag, and only
    // then does finalize bank the sale.
    deliveryPhase = 'receipt-ready';
    deliveryTimer = RECEIPT_READY_HOLD;
    sfx('receiptTear');
    drawScreen();
    return true;
  }

  function retryFulfillmentPresentation() {
    if (!tx || tx.banked || !['receipt', 'bagging', 'done'].includes(tx.stage)) return false;
    receiptTimer = 0;
    deliveryPhase = null;
    deliveryTimer = 0;
    finalizeTimer = 0;
    ensureReceiptMesh({ fullyExposed: true, resetToPrinter: true });
    resetBagAtCounter();
    const restarted = finishAutomaticFulfillment();
    if (restarted) toast('Receipt and order handoff restarted safely.');
    return restarted;
  }

  function finalizeTransaction() {
    if (!tx || tx.stage !== 'done') {
      toast('Finish payment before finalizing.', 'warn');
      return false;
    }
    if (checkoutFlowState() !== 'CustomerLeaving') {
      toast('Finish the physical customer handoff before banking the sale.', 'warn');
      return false;
    }
    const finishedTx = tx;
    const finishedCustomer = cust;
    const finishedReservationId = transactionKind === 'reservation'
      ? tx.servicePayment && tx.servicePayment.reservationId
      : null;
    let result;
    if (transactionKind === 'reservation') {
      result = finalizeReservationCheckIn(state, tx, finishedReservationId);
    } else {
      result = completeSale(state, tx, cust || 'A customer');
    }
    if (!result.ok) {
      toast(result.reason, 'warn');
      return false;
    }
    if (transactionKind === 'reservation') {
      const bridge = reservationBridge();
      if (bridge && typeof bridge.completeCustomer === 'function') {
        bridge.completeCustomer(finishedReservationId);
      }
      sfx('doorbell');
    } else if (finishedCustomer && finishedCustomer.onPaid) {
      finishedCustomer.onPaid(finishedTx);
    }
    if (finishedTx.checkoutFlow && finishedTx.checkoutFlow.state === 'CustomerLeaving') {
      const completed = transitionCheckout(finishedTx.checkoutFlow, 'TransactionComplete', {
        nowMs: flowNow(),
        event: 'customer-released-after-exact-once-bank',
      });
      if (completed.ok) finishedTx.checkoutFlow = completed.flow;
    }
    const displayItems = finishedTx.items.map((item) => ({
      name: item.name,
      qty: 1,
      unitPrice: item.price,
      subtotal: item.price,
      scanned: true,
    }));
    postSaleDisplay = {
      number: finishedTx.number,
      customer: finishedCustomer ? (finishedCustomer.fullName || finishedCustomer.name) : 'Guest',
      total: dueOf(finishedTx),
      subtotal: totalOf(finishedTx),
      method: finishedTx.method,
      items: displayItems,
    };
    // (the till already slid shut with its sound the moment the change was handed
    // over in confirmChange — see the drawerClose there; nothing to close here)
    sfx('checkoutComplete');
    clearPhysicalTransaction({
      resetCounterBag: false,
      preserveCustomerBag: true,
      preserveCustomerReceipt: true,
    });
    if (finishedCustomer) finishedCustomer.tx = null;
    tx = null;
    cust = null;
    transactionKind = 'retail';
    selectedReservationId = null;
    activeTab = 'checkout';
    assignWorkspace('monitor');
    drawScreen();
    drawTerm();
    return true;
  }

  function handleMonitorAction(action) {
    if (!action) return false;
    if (action === 'exit') {
      leave();
      return true;
    }
    if (action === 'home') {
      activeTab = 'home';
      drawScreen();
      return true;
    }
    if (action === 'tab-checkout') {
      activeTab = 'checkout';
      drawScreen();
      return true;
    }
    if (action === 'tab-check-in') {
      activeTab = 'check-in';
      checkInPage = 0;
      drawScreen();
      return true;
    }
    if (action.startsWith('select-walkin:')) {
      if (tx) {
        toast('Finish the active transaction before helping another customer.', 'warn');
        return true;
      }
      selectedWalkInCustomerId = action.slice('select-walkin:'.length);
      selectedReservationId = null;
      drawScreen();
      return true;
    }
    if (action.startsWith('select-walkin-slot:')) {
      if (tx) return false;
      const payload = action.slice('select-walkin-slot:'.length);
      const parts = payload.split(':');
      const minute = Number(parts.pop());
      const dayAbs = Number(parts.pop());
      const customerId = parts.join(':');
      const bridge = reservationBridge();
      const booked = bridge && typeof bridge.bookWalkIn === 'function'
        ? bridge.bookWalkIn(customerId, dayAbs, minute)
        : { ok: false, reason: 'Walk-in booking is unavailable.' };
      if (!booked.ok) {
        toast(booked.reason || 'That slot was just taken. Choose another.', 'warn');
        drawScreen();
        return true;
      }
      selectedWalkInCustomerId = null;
      selectedReservationId = booked.res.id;
      toast(`${booked.res.fullName || booked.res.name}: I'll pay with ${booked.res.paymentPreference || 'card'}.`);
      return beginReservationPayment(booked.res);
    }
    if (action === 'reject-walkin') {
      const walkIn = activeWalkIn();
      const bridge = reservationBridge();
      const rejected = walkIn && bridge && typeof bridge.rejectWalkIn === 'function'
        ? bridge.rejectWalkIn(walkIn.customerId)
        : false;
      if (rejected) {
        toast(`No tee time was available for ${walkIn.fullName || walkIn.name}.`);
        selectedWalkInCustomerId = null;
        drawScreen();
      }
      return Boolean(rejected);
    }
    if (action.startsWith('select-reservation:')) {
      if (tx) {
        toast('Finish the active transaction before selecting another reservation.', 'warn');
        return true;
      }
      const raw = action.slice('select-reservation:'.length);
      const reservation = reservationsWaiting().find((entry) => String(entry.id) === raw);
      if (reservation) {
        selectedReservationId = reservation.id;
        selectedWalkInCustomerId = null;
      }
      drawScreen();
      return true;
    }
    if (action === 'reservation-check-in') {
      const reservation = activeReservation();
      if (reservation) toast(`${reservation.fullName || reservation.name}: I'll pay with ${reservation.paymentPreference || 'card'}.`);
      return beginReservationPayment(reservation);
    }
    if (action === 'start-scanning') return startScanning();
    if (action === 'open-card-reader') {
      setWorkspace('card');
      return true;
    }
    if (action === 'retry-card') return retryDeclinedCard();
    if (action === 'card-to-cash') return switchDeclinedCardToCash();
    if (action === 'open-cash-workspace') {
      setWorkspace('cash');
      return true;
    }
    if (action === 'sort-received-cash') {
      const result = tx && tx.stage === 'cash-tender' ? acceptPresentedCash() : sortReceivedCash();
      if (result) setWorkspace('cash');
      return result;
    }
    if (action === 'undo-change') return undoLastChange();
    if (action === 'clear-change') return clearSelectedChange();
    if (action === 'confirm-change') return confirmChange();
    if (action === 'checkin-prev') {
      checkInPage = Math.max(0, checkInPage - 1);
      drawScreen();
      return true;
    }
    if (action === 'checkin-next') {
      checkInPage += 1;
      drawScreen();
      return true;
    }
    if (action === 'retry-fulfillment') return retryFulfillmentPresentation();
    return false;
  }

  function physicalPick(event) {
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    const presentedCash = tx && tx.stage === 'cash-tender'
      ? [...tenderMeshes, ...(tenderHandful ? [tenderHandful] : [])]
      : [];
    // Counter products are live click targets whenever the order is still
    // ringing up — clicking the goods IS the interaction, no "Bag Items"
    // button first.
    const counterItems = tx && tx.stage === 'scanning' ? loose : [];
    // the drawer money itself is a click target: any part of the $5 stack IS
    // the $5 well, not just the invisible hotspot floating over it
    const candidates = workspace === 'scan'
      ? loose
      : workspace === 'cash'
        ? [...presentedCash, ...selectedChangeMeshes, ...slotHotspots, ...slotLabels,
          ...(drawerMoney ? [drawerMoney] : [])]
        : [...presentedCash, ...counterItems];
    // items already dropped into the bag are hidden, not removed — they must
    // not keep swallowing clicks (the raycaster tests invisible meshes too)
    const hits = ray.intersectObjects(candidates, true).filter((hit) => {
      for (let o = hit.object; o; o = o.parent) if (o.visible === false) return false;
      return true;
    });
    if (!hits.length) return null;
    // What the player SEES always wins: a click on one product's visible shaft
    // must not be stolen by a neighbour's invisible click pad hanging closer to
    // the camera. Pads only catch clicks that hit no real geometry at all.
    const primary = hits.find((hit) => hit.object.name !== 'ItemClickPad') || hits[0];
    let object = primary.object;
    while (object && !object.userData.pick && object.parent) object = object.parent;
    return object && object.userData.pick ? object : null;
  }

  // Did this click land on the customer's presented card?  The card close-up
  // pose makes the card a large target; nothing else in that view takes clicks
  // at the card-ready stage.
  function cardHitAt(event) {
    if (!cardMesh) return false;
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObject(cardMesh, true).length > 0) return true;
    if (!accessibilityPrefs.largeTextAndTargets) return false;
    root.updateMatrixWorld(true);
    const projected = cardMesh.getWorldPosition(new THREE.Vector3()).project(camera);
    if (projected.z < -1 || projected.z > 1) return false;
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + ((projected.x + 1) / 2) * rect.width;
    const y = rect.top + ((-projected.y + 1) / 2) * rect.height;
    // This fallback only runs in CardInsertReady, where the presented card is
    // the sole physical action. It enlarges the target without adding geometry
    // that could intercept the terminal later in the run.
    return Math.abs(event.clientX - x) <= Math.max(96, rect.width * 0.07)
      && Math.abs(event.clientY - y) <= Math.max(72, rect.height * 0.09);
  }

  function handleCashPick(object) {
    if (!object) return false;
    const kind = object.userData.kind;
    // one click on the presented cash accepts the whole handful
    if (kind === 'money' && object.userData.from === 'tender') {
      return acceptPresentedCash();
    }
    if (kind === 'money' && object.userData.from === 'change') {
      return returnSelectedChange(object);
    }
    if (kind === 'money' && object.userData.from === 'drawer') {
      if (tx && tx.deposited) return selectChangeFromSlot(object.userData.denom);
      return false;
    }
    if (kind === 'drawer-slot') {
      if (tx && tx.deposited) return selectChangeFromSlot(object.userData.denom);
      return false;
    }
    return false;
  }

  // the cursor itself says "clickable": a pointer over money, wells, goods,
  // the handed card and the monitor's buttons
  function setHoverCursor(on) {
    if (canvas && canvas.style) canvas.style.cursor = on ? 'pointer' : '';
  }

  // Hover feedback for money: a brass outline over whatever the cursor would
  // take — the whole labeled well for drawer money, the piece itself for
  // presented cash and counted change.
  function updateCashHover(event) {
    const object = physicalPick(event);
    let target = null;
    if (object) {
      const kind = object.userData.kind;
      if (kind === 'drawer-slot' || (kind === 'money' && object.userData.from === 'drawer')) {
        if (tx && tx.deposited) {
          target = slotHotspots.find(
            (spot) => Number(spot.userData.denom) === Number(object.userData.denom),
          ) || object;
        }
      } else if (kind === 'money') {
        target = object;
      }
    }
    if (target) {
      hoverBounds.setFromObject(target);
      hoverBox.visible = true;
    } else {
      hoverBox.visible = false;
    }
    // denomination identity is carried by the permanent white tags over each well
    setHoverCursor(!!target || !!monitorActionAt(event));
  }

  function onDown(event) {
    if (!active) return false;
    if (event.button === 2) {
      // right-click backs out of the register — but NOT while the card reader is
      // modal, or it would be a second way to abandon a running payment
      if (!cardTerminalLocked()) leave();
      return true;
    }
    if (event.button !== 0) return true;
    if (workspace === 'monitor') {
      const action = monitorActionAt(event);
      if (action) {
        sfx('uiTick');
        handleMonitorAction(action);
        return true;
      }
      const object = physicalPick(event);
      // Clicking a counter product from the monitor IS the scan: it rings up
      // and arcs into the bag in one gesture. With more goods still waiting,
      // the camera swings to the counter for the rest of the order.
      if (object && object.userData.kind === 'item') {
        const moreAfterThis = tx && unscannedCount(tx) > 1;
        if (bagProduct(object) && moreAfterThis) setWorkspace('scan');
        return true;
      }
      // the customer's presented cash waits on the counter in this view
      if (object) handleCashPick(object);
      return true;
    }
    if (workspace === 'card') {
      // the reader's on-screen X is the ONLY way to leave a running card payment
      if (terminalXHitAt(event)) {
        sfx('uiTick');
        cancelCardAtTerminal();
        return true;
      }
      if (tx && tx.stage === 'card-entry') handleCardKeypadAt(event);
      // The handed card is the click target: one click runs the whole insert.
      else if (tx && tx.stage === 'card-ready' && cardHitAt(event)) autoInsertCard();
      return true;
    }
    if (workspace === 'scan') {
      const object = physicalPick(event);
      if (object && object.userData.kind === 'item') bagProduct(object);
      return true;
    }
    if (workspace === 'cash') {
      // the POS carries Undo/Clear/Done during the cash count
      const action = monitorActionAt(event);
      if (action) {
        sfx('uiTick');
        handleMonitorAction(action);
        return true;
      }
      const object = physicalPick(event);
      handleCashPick(object);
      return true;
    }
    return true;
  }

  function onMove(event) {
    if (!active) return false;
    updateLookTarget(event);   // the cursor leans the view around the pose
    if (workspace === 'card' && insertDrag) {
      feedInsert(event);
      return true;
    }
    if (workspace === 'card' && tx && tx.stage === 'card-ready' && !insertSnap) {
      // the handed card glows under the cursor so "click the card" is obvious
      if (cardHitAt(event)) {
        hoverBounds.setFromObject(cardMesh);
        hoverBox.visible = true;
      } else {
        hoverBox.visible = false;
      }
      setHoverCursor(hoverBox.visible);
      return true;
    }
    if (workspace === 'scan' && !scanMotion) {
      const object = physicalPick(event);
      hoveredItem = object && object.userData.kind === 'item'
        && tx && !tx.items.find((item) => item.uid === object.userData.uid)?.scanned
        ? (itemMeshes.get(object.userData.uid) || object)
        : null;
      hoverBox.visible = !!hoveredItem;
      if (hoveredItem) hoverBounds.setFromObject(hoveredItem);
      setHoverCursor(!!hoveredItem);
      return true;
    }
    if (workspace === 'cash') {
      updateCashHover(event);
      return true;
    }
    if (workspace === 'monitor' && tx) {
      // counter goods and presented cash glow under the cursor — both are
      // direct click targets from the monitor view
      const object = physicalPick(event);
      let target = null;
      if (object && object.userData.kind === 'item'
          && !tx.items.find((item) => item.uid === object.userData.uid)?.scanned) {
        target = itemMeshes.get(object.userData.uid) || object;
      } else if (object && object.userData.kind === 'money' && object.userData.from === 'tender') {
        target = object;
      }
      if (target) {
        hoverBounds.setFromObject(target);
        hoverBox.visible = true;
      } else {
        hoverBox.visible = false;
      }
      setHoverCursor(!!target || !!monitorActionAt(event));
      return true;
    }
    if (workspace === 'monitor') {
      setHoverCursor(!!monitorActionAt(event));
      return true;
    }
    if (hoverBox.visible) hoverBox.visible = false;
    setHoverCursor(false);
    return true;
  }

  function onUp(event) {
    if (!active) return false;
    if (workspace === 'card' && insertDrag) {
      endInsert(event);
      return true;
    }
    return true;
  }

  function onWheel() {
    // Product orientation is automatic in the simplified scanner. Swallowing the
    // wheel prevents accidental camera/page changes while the workstation is active.
    return active;
  }

  function onKey(key) {
    if (!active) return false;
    if (key === 'Escape') {
      // The card reader is MODAL while a payment is running: Escape must not
      // cancel it, drop the card, leave the register, or break the camera lock.
      // Only the reader's on-screen X leaves this state.
      if (cardTerminalLocked()) return true;
      if (workspace !== 'monitor') {
        setWorkspace('monitor');
      } else if (selectedWalkInCustomerId != null) {
        selectedWalkInCustomerId = null;
        drawScreen();
      } else if (selectedReservationId != null && !tx) {
        selectedReservationId = null;
        drawScreen();
      } else if (activeTab !== 'home') {
        activeTab = 'home';
        drawScreen();
      } else {
        leave();
      }
      return true;
    }
    if (tx && tx.stage === 'card-entry') {
      if (/^\d$/.test(key)) applyCardKey(key);
      else if (key === 'Backspace') applyCardKey('BACK');
      else if (key === 'Delete') applyCardKey('CLEAR');
      else if (key === 'Enter') applyCardKey('OK');
      return true;
    }
    // (No letter shortcuts for the cash flow: S is a walking key now that the
    // player moves freely at the till — the presented pile takes the click.)
    if ((key === 'Enter' || key === ' ') && tx && tx.stage === 'cash-drawer' && tx.deposited) {
      confirmChange();
      return true;
    }
    if ((key === 'z' || key === 'Z') && tx && tx.stage === 'cash-drawer' && tx.deposited) {
      undoLastChange();
      return true;
    }
    return true;
  }

  function tapTerminal() {
    if (!tx || tx.method !== 'card') return false;
    if (tx.stage === 'card-present' || tx.stage === 'card-ready'
        || tx.stage === 'card-entry' || tx.stage === 'card-declined') {
      setWorkspace('card');
      return true;
    }
    return false;
  }

  // The customer hands the card across the counter; the PLAYER runs it: one
  // click on the presented card starts the full insert animation (rise, tilt,
  // seat in the chip slot) — no drag gesture, no push. After that the player
  // types the total on the keypad.
  function autoInsertCard() {
    if (!tx || tx.stage !== 'card-ready' || insertSnap || cardU >= 1) return;
    insertSnap = true;
    // Keep the card supported in the customer's palm while the view pans to the
    // terminal. The cashier takes ownership only once that close work area is
    // framed, avoiding a stretched arm across the full counter.
    cardPickupDelay = CARD_PICKUP_DELAY;
    insertMessage = 'INSERTING';
    if (checkoutFlowState() === 'CardInsertReady') {
      flowTo('CardInserting', 'player-clicked-presented-card');
    }
    hoverBox.visible = false;
    sfx('cardInsert');
  }

  function updateCard(dt) {
    if (!tx || tx.method !== 'card') return;
    if (!insertSnap && cardU === 0
        && (cardPresentationTimer > 0 || tx.stage === 'card-ready')) {
      cardTravel.ready.copy(customerCardReadyPoint());
    }
    if (tx.stage === 'receipt' && cardResultTimer > 0) {
      // Approval keeps the customer in the Present pose until the card is back
      // in their hand. Follow that live grip throughout the reverse slot path
      // and pocket motion instead of aiming at its pre-approval snapshot.
      cardTravel.ready.copy(customerCardReadyPoint());
    }
    if (cardPresentationTimer > 0) {
      cardPresentationTimer = Math.max(0, cardPresentationTimer - dt);
      const progress = 1 - cardPresentationTimer / 0.55;
      if (cardMesh) {
        // out of the customer's pocket, up into their outstretched hand
        const start = new THREE.Vector3(
          cardTravel.ready.x + 0.06,
          cardTravel.ready.y - 0.24,
          cardTravel.ready.z - 0.20,
        );
        const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
        cardMesh.position.lerpVectors(start, cardTravel.ready, eased);
        cardMesh.quaternion.copy(HELD_QUAT); // held tilted toward the cashier, readable
      }
      if (cardPresentationTimer === 0 && tx.stage === 'card-present') {
        const presented = presentCard(tx);
        if (presented.ok) {
          if (checkoutFlowState() === 'CardPresented') {
            flowTo('CardInsertReady', 'card-handed-awaiting-player-click');
          }
          // the card now WAITS at the counter for the player's click
          insertMessage = '';
        }
        sfx('cardTap');
        drawTerm();
        drawScreen();
      } else if (cardPresentationTimer === 0 && tx.stage === 'card-ready'
          && !insertSnap && cardU < 1) {
        if (checkoutFlowState() === 'CardPresented') {
          flowTo('CardInsertReady', 'replacement-card-awaiting-player-click');
        }
        insertMessage = '';
      }
    }

    if (insertSnap && tx.stage === 'card-ready') {
      if (cardPickupDelay > 0) cardPickupDelay = Math.max(0, cardPickupDelay - dt);
      else cardU = Math.min(1, cardU + dt * 2.8);
      if (cardU >= 1) {
        insertSnap = false;
        const inserted = insertCard(tx);
        if (!inserted.ok) {
          cardU = 0;
          insertMessage = 'INSERT AGAIN';
          if (checkoutFlowState() === 'CardInserting') {
            flowTo('CardInsertReady', 'card-insert-domain-rejected');
          }
          toast(inserted.reason, 'warn');
          sfx('thunk');
        } else {
          insertMessage = '';
          if (checkoutFlowState() === 'CardInserting') {
            flowTo('CardAmountEntry', 'card-reached-chip-slot-stop');
          }
          drawTerm();
          drawScreen();
        }
      }
    }

    if (cardEjectTimer > 0) {
      cardEjectTimer = Math.max(0, cardEjectTimer - dt);
      cardU = cardEjectTimer / 0.64;
      if (cardEjectTimer === 0) cardU = 0;
    }

    if (cardMesh && cardPresentationTimer <= 0) {
      const travel = THREE.MathUtils.smoothstep(cardU, 0, 1);
      if (cardTravel.fromSocket && cardTravel.mouth) {
        // two legs, both directions: counter ↔ slot mouth (rise + tilt), then mouth ↔ seat
        // strictly along the slot axis at full tilt — the card can only enter or leave the
        // reader through its own slot
        const SPLIT = 0.62;
        if (travel >= SPLIT) {
          const axial = (travel - SPLIT) / (1 - SPLIT);
          cardMesh.position.lerpVectors(cardTravel.mouth, cardTravel.inserted, axial);
          cardMesh.quaternion.copy(cardTravel.quaternion);
        } else {
          const approach = travel / SPLIT;
          cardMesh.position.lerpVectors(cardTravel.ready, cardTravel.mouth, approach);
          cardMesh.position.y += Math.sin(approach * Math.PI) * 0.022;
          cardMesh.quaternion.slerpQuaternions(HELD_QUAT, cardTravel.quaternion, approach);
          // waiting in the hand, the card breathes — an obvious "click me"
          if (!insertSnap && cardU === 0) {
            cardMesh.position.y += Math.sin(performance.now() / 420) * 0.006;
          }
        }
      } else {
        cardMesh.position.lerpVectors(cardTravel.ready, cardTravel.inserted, travel);
        cardMesh.rotation.set(0, 0, 0);
      }
    }

    if (tx.stage === 'card-busy') {
      cardProcessingTimer = Math.max(0, cardProcessingTimer - dt);
      if (cardProcessingTimer === 0) {
        const result = runCard(tx);
        if (result.result === 'approved') {
          if (checkoutFlowState() === 'CardProcessing') {
            flowTo('CardApproved', 'card-authorization-approved');
          }
          sfx('cardApproved');
          cardResultTimer = 1.16;
        } else {
          if (checkoutFlowState() === 'CardProcessing') {
            flowTo('CardDeclined', `card-authorization-${result.result || 'declined'}`);
          }
          sfx('cardDeclined');
          cardResultTimer = 1.34;
        }
        cardEjectTimer = 0.64;
        drawTerm();
        drawScreen();
      }
    }

    if (cardResultTimer > 0) {
      cardResultTimer = Math.max(0, cardResultTimer - dt);
      if (tx.stage === 'receipt' && cardMesh && cardEjectTimer === 0
          && cardResultTimer <= CARD_STOW_TIME) {
        // Once an approved card has returned through the chip slot, the
        // customer pockets it before accepting the receipt. This keeps two
        // full-size props from occupying the same palm during the handoff.
        const progress = 1 - cardResultTimer / CARD_STOW_TIME;
        const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
        const stowX = cardTravel.ready.x + 0.06;
        const stowY = cardTravel.ready.y - 0.24;
        const stowZ = cardTravel.ready.z - 0.20;
        cardMesh.position.set(
          THREE.MathUtils.lerp(cardTravel.ready.x, stowX, eased),
          THREE.MathUtils.lerp(cardTravel.ready.y, stowY, eased),
          THREE.MathUtils.lerp(cardTravel.ready.z, stowZ, eased),
        );
        cardMesh.quaternion.copy(HELD_QUAT);
        if (progress >= 0.98) cardMesh.visible = false;
      }
      if (cardResultTimer === 0) {
        setWorkspace('monitor');
        if (tx && tx.stage === 'receipt') beginAutomaticReceipt();
      }
    }
  }

  function updateReceipt(dt) {
    if (!tx || tx.stage !== 'receipt') return;
    // Cash settlement reaches the domain's receipt stage before the physical
    // bundle reaches and clears the customer's palm. Do not let the generic
    // auto-start path overlap those two props or skip the observable handoff.
    if (tx.method === 'cash'
        && ['travel', 'customer-hold'].includes(cashHandoffPhase)) return;
    // Keep ACCEPTED readable on the physical card terminal before returning to
    // the monitor and starting the automatic printer sequence.
    if (cardResultTimer > 0) return;
    if (!receiptTimer && !autoFulfilled) beginAutomaticReceipt();
    if (receiptTimer <= 0) return;
    receiptTimer = Math.max(0, receiptTimer - dt);
    const progress = 1 - receiptTimer / RECEIPT_TIME;
    if (printerRoll) printerRoll.rotation.x += dt * 10;
    if (receiptMesh) {
      // the paper feeds up out of the slot to its full believable length
      const eased = 1 - Math.pow(1 - progress, 2.2);
      receiptMesh.scale.y = Math.max(0.04, eased);
    }
    if (receiptTimer === 0) finishAutomaticFulfillment();
  }

  function attachReceiptToCustomer() {
    const grip = customerGripNode('R');
    if (!receiptMesh || !grip) return false;
    root.updateMatrixWorld(true);
    grip.updateWorldMatrix(true, true);
    grip.attach(receiptMesh);
    // Receipt_Strip is authored from its bottom edge. Land that edge in the
    // palm, then let the articulated customer grip own it through departure.
    receiptMesh.position.set(0, 0, 0);
    receiptMesh.userData.checkoutOwner = 'customer';
    if (cust) cust.handoffReceipt = receiptMesh;
    return true;
  }

  function beginBagDeliveryOrRelease() {
    const wantsBag = transactionKind === 'retail' && bagGroup;
    if (checkoutFlowState() === 'Bagging') {
      flowTo(
        'BagHandoff',
        wantsBag
          ? 'physical-bag-transfer-started-after-receipt-contact'
          : 'receipt-only-handoff-ready-for-release',
      );
    }
    if (wantsBag) {
      poseCustomerForCheckout('ReceiveBag');
      deliveryPhase = 'bag-deliver';
      deliveryTimer = BAG_DELIVER_TIME;
      bagDeliverScaleFrom = bagGroup.scale.x;
      const handle = bagHandlePoint();
      bagDeliverAnchorFrom.copy(handle || bagDeliverFrom);
    } else {
      if (checkoutFlowState() === 'BagHandoff') {
        flowTo('CustomerLeaving', 'receipt-only-handoff-reached-customer');
      }
      deliveryPhase = 'released';
      finalizeTimer = 0.28;
    }
    drawScreen();
  }

  function holdBagAtCustomer() {
    if (!bagGroup) return false;
    const to = customerAnchor(COUNTER_TOP + 0.10, 'L');
    bagGroup.rotation.set(0.035, 0.16, -0.055);
    bagGroup.position.copy(to);
    bagGroup.updateWorldMatrix(true, true);
    const anchorAt = bagHandlePoint();
    if (anchorAt) bagGroup.position.add(to).sub(anchorAt);
    return true;
  }

  // The delivery choreography that runs after payment and printing succeed:
  //   receipt-print → cashier pickup → customer receipt hold
  //   → cashier bag transfer → customer bag hold
  //   → released (finalizeTimer banks the sale and the customer leaves).
  function updateDelivery(dt) {
    if (!tx || !deliveryPhase || deliveryPhase === 'released') return;
    if (deliveryPhase === 'receipt-print') return; // updateReceipt owns this leg
    deliveryTimer = Math.max(0, deliveryTimer - dt);
    if (deliveryPhase === 'receipt-ready') {
      if (deliveryTimer === 0 && receiptMesh) {
        poseCustomerForCheckout('Receive');
        deliveryPhase = 'receipt-deliver';
        deliveryTimer = RECEIPT_DELIVER_TIME;
        deliveryFrom = receiptMesh.position.clone();
        deliveryTo = customerAnchor(1.18, 'R');
      }
      return;
    }
    if (deliveryPhase === 'receipt-deliver') {
      if (receiptMesh) {
        // Character nod/bob motion continues during the transfer. Refresh the
        // authored palm endpoint so the last delivery frame cannot snap.
        deliveryTo.copy(customerAnchor(1.18, 'R'));
        const t = 1 - deliveryTimer / RECEIPT_DELIVER_TIME;
        const eased = THREE.MathUtils.smoothstep(t, 0, 1);
        // a real hand-over arc: up out of the printer, OVER the register gear, down to
        // the customer — a quadratic bezier whose apex clears the tallest thing between
        // the slot and the hand (the straight lerp used to cut through the housing)
        const apexY = Math.max(deliveryFrom.y, deliveryTo.y) + 0.28;
        const inv = 1 - eased;
        const midX = (deliveryFrom.x + deliveryTo.x) / 2;
        const midZ = (deliveryFrom.z + deliveryTo.z) / 2;
        receiptMesh.position.set(
          inv * inv * deliveryFrom.x + 2 * inv * eased * midX + eased * eased * deliveryTo.x,
          inv * inv * deliveryFrom.y + 2 * inv * eased * apexY + eased * eased * deliveryTo.y,
          inv * inv * deliveryFrom.z + 2 * inv * eased * midZ + eased * eased * deliveryTo.z,
        );
        receiptMesh.rotation.x = -0.42 + eased * 0.30;
        receiptMesh.rotation.y = eased * 0.5;
        receiptMesh.rotation.z = -eased * 0.28;
      }
      if (deliveryTimer === 0) {
        attachReceiptToCustomer();
        deliveryPhase = 'receipt-customer-hold';
        deliveryTimer = RECEIPT_CUSTOMER_HOLD;
        drawScreen();
      }
      return;
    }
    if (deliveryPhase === 'receipt-customer-hold') {
      if (deliveryTimer === 0) beginBagDeliveryOrRelease();
      return;
    }
    if (deliveryPhase === 'bag-deliver') {
      if (bagGroup) {
        const t = 1 - deliveryTimer / BAG_DELIVER_TIME;
        const eased = THREE.MathUtils.smoothstep(t, 0, 1);
        const to = customerAnchor(COUNTER_TOP + 0.10, 'L');
        bagDeliverAnchorAt.lerpVectors(bagDeliverAnchorFrom, to, eased);
        bagDeliverAnchorAt.y += Math.sin(t * Math.PI) * 0.14;
        bagGroup.scale.setScalar(bagDeliverScaleFrom);
        // Drive the authored handle socket—not the bag's floor origin—to the
        // hand. At t=1 this is exact, so the transfer has visible contact.
        bagGroup.position.copy(bagDeliverAnchorAt)
          .addScaledVector(bagHandoffLocal, -bagDeliverScaleFrom);
        bagGroup.rotation.set(0.035 * eased, 0.16 * eased, -0.055 * eased);
      }
      if (deliveryTimer === 0) {
        holdBagAtCustomer();
        if (cust) cust.checkoutHandoffBag = bagGroup;
        deliveryPhase = 'bag-customer-hold';
        deliveryTimer = BAG_CUSTOMER_HOLD;
        sfx('bagHandoff');
        drawScreen();
      }
      return;
    }
    if (deliveryPhase === 'bag-customer-hold') {
      holdBagAtCustomer();
      if (deliveryTimer === 0) {
        if (checkoutFlowState() === 'BagHandoff') {
          flowTo('CustomerLeaving', 'customer-held-bag-acceptance-beat-complete');
        }
        deliveryPhase = 'released';
        finalizeTimer = 0.28;
        drawScreen();
      }
    }
  }

  function updateCashMotions(dt) {
    for (let index = cashMotions.length - 1; index >= 0; index -= 1) {
      const motion = cashMotions[index];
      if (!motion.mesh || !motion.mesh.parent) {
        cashMotions.splice(index, 1);
        continue;
      }
      if (motion.delay > 0) {
        motion.delay = Math.max(0, motion.delay - dt);
        continue;
      }
      if (motion.drawerDenom != null) {
        motion.to.copy(drawerSlotPosition(motion.drawerDenom, motion.stackOffset));
      }
      if (typeof motion.targetProvider === 'function') {
        const target = motion.targetProvider();
        if (target?.isVector3) motion.to.copy(target);
      }
      motion.elapsed = Math.min(motion.duration, motion.elapsed + dt);
      const linear = motion.duration > 0 ? motion.elapsed / motion.duration : 1;
      const eased = linear * linear * (3 - 2 * linear);
      if (motion.via) {
        const midpoint = 0.52;
        if (eased <= midpoint) {
          motion.mesh.position.lerpVectors(motion.from, motion.via, eased / midpoint);
        } else {
          motion.mesh.position.lerpVectors(
            motion.via,
            motion.to,
            (eased - midpoint) / (1 - midpoint),
          );
        }
      } else {
        motion.mesh.position.lerpVectors(motion.from, motion.to, eased);
      }
      if (motion.lift) motion.mesh.position.y += Math.sin(linear * Math.PI) * motion.lift;
      motion.mesh.quaternion.slerpQuaternions(motion.fromQuaternion, motion.toQuaternion, eased);
      if (linear < 1) continue;
      if (motion.remove) motion.mesh.removeFromParent();
      else if (motion.enablePick) motion.mesh.userData.pick = true;
      cashMotions.splice(index, 1);
      if (typeof motion.onComplete === 'function') motion.onComplete(motion.mesh);
    }
    if (cashMotionRefillPending
        && !cashMotions.some((motion) => motion.kind === 'cash-deposit')) {
      cashMotionRefillPending = false;
      refillDrawerMoney();
    }
  }

  function cashierTargetFor(object, localOffset = null) {
    if (!object?.isObject3D) return object?.isVector3 ? object.clone() : null;
    root.updateMatrixWorld(true);
    object.updateWorldMatrix(true, false);
    const world = localOffset
      ? object.localToWorld(localOffset.clone())
      : object.getWorldPosition(new THREE.Vector3());
    return root.worldToLocal(world);
  }

  function pulseCashierHand(target, pose, seconds = 0.30) {
    cashierCashAction = {
      object: target?.isObject3D ? target : null,
      point: target?.isVector3 ? target.clone() : null,
      pose,
      timer: seconds,
    };
  }

  function updateCashierHandPresentation(dt) {
    if (cashierCashAction) {
      cashierCashAction.timer = Math.max(0, cashierCashAction.timer - dt);
      if (cashierCashAction.timer === 0) cashierCashAction = null;
    }

    let rightTarget = null;
    let leftTarget = null;
    let pose = 'idle';

    if (active && receiptMesh
        && ['receipt-ready', 'receipt-deliver'].includes(deliveryPhase)) {
      rightTarget = cashierTargetFor(receiptMesh, RECEIPT_CASHIER_GRIP);
      pose = deliveryPhase === 'receipt-ready' ? 'collect-receipt' : 'add-receipt';
    } else if (active && bagGroup && deliveryPhase === 'bag-deliver') {
      leftTarget = bagHandlePoint();
      pose = 'hand-bag';
    } else if (active && scanMotion?.mesh) {
      const primary = scanMotion.mesh.userData.gripPrimary || scanMotion.mesh;
      const secondary = scanMotion.mesh.userData.gripSecondary || null;
      rightTarget = cashierTargetFor(primary);
      leftTarget = cashierTargetFor(secondary);
      pose = ['scan-approach', 'scan-hold', 'scan-exit'].includes(scanMotion.phase)
        ? 'scan'
        : (scanMotion.destinationKind === 'bag' ? 'bag-item' : 'place-item');
    } else if (active && cardMesh && insertSnap && tx?.stage === 'card-ready') {
      rightTarget = cashierTargetFor(cardMesh, new THREE.Vector3(CARD_WIDTH * 0.38, 0, 0));
      pose = cardPickupDelay > 0 ? 'hold-card' : 'swipe-card';
    } else if (active) {
      const activeCashMotion = cashMotions.find((motion) => (
        ['cash-deposit', 'change-handoff'].includes(motion.kind)
        && motion.delay <= 0 && motion.elapsed < motion.duration
      ));
      if (activeCashMotion) {
        rightTarget = cashierTargetFor(activeCashMotion.mesh);
        if (activeCashMotion.kind === 'change-handoff') pose = 'give-change';
        else pose = BILLS.includes(activeCashMotion.mesh.userData.denom)
          ? 'deposit-bill'
          : 'deposit-coin';
      } else if (cashierCashAction) {
        rightTarget = cashierTargetFor(cashierCashAction.object) || cashierCashAction.point;
        pose = cashierCashAction.pose;
      }
    }

    cashierHands.update(dt, camera, {
      rightTarget,
      leftTarget,
      pose,
      visible: !!(rightTarget || leftTarget),
    });
  }

  function updateDrawer(dt) {
    if (!drawerMotionRoot) return;
    if (drawerPresentationVisible(drawerWant, drawerAmount)
        && !drawerMotionRoot.visible) drawerMotionRoot.visible = true;
    if (Math.abs(drawerAmount - drawerWant) > 0.001) {
      const speed = drawerWant > drawerAmount ? 3.2 : 2.4;
      drawerAmount += Math.sign(drawerWant - drawerAmount)
        * Math.min(Math.abs(drawerWant - drawerAmount), dt * speed);
      drawerMotionRoot.position.z = drawerAmount * REGISTER.drawer.travel;
      if (drawerAssetSlide) {
        drawerAssetSlide.position.z = drawerAssetSlideBaseZ
          + (drawerAmount * REGISTER.drawer.travel) / drawerAssetSlideWorldScale;
      }
    }
    if (!drawerPresentationVisible(drawerWant, drawerAmount)) drawerMotionRoot.visible = false;
    if (checkoutFlowState() === 'DrawerOpening' && drawerAmount >= 0.98) {
      flowTo('DepositingCash', 'cash-drawer-reached-open-stop');
    }
    if (checkoutFlowState() === 'DepositingCash' && tx && tx.deposited) {
      flowTo('SelectingChange', 'all-received-cash-secured');
    }
  }

  // Which preset the current checkout state deserves. Workspaces map directly;
  // the monitor workspace splits by what the player is actually doing there.
  function poseKey() {
    if (deliveryPhase && deliveryPhase !== 'released') return 'fulfillment';
    if (workspace === 'scan') return 'scan';
    if (workspace === 'card') {
      // Frame the CUSTOMER while the card waits in their outstretched hand. The
      // instant the player clicks it (insert begins, or it is already travelling
      // or ejecting), switch to the terminal so the camera pans WITH the card up
      // to the raised reader — never a snap to an old low counter preset.
      const waiting = tx && (tx.stage === 'card-present'
        || (tx.stage === 'card-ready' && cardU === 0 && cardEjectTimer === 0
          && (!insertSnap || cardPickupDelay > 0)));
      return waiting ? 'cardTake' : 'card';
    }
    if (workspace === 'cash') return 'cash';
    // the receipt/bag handover plays out inside the working frame — no jump to watch paper
    if (activeTab === 'check-in') return 'checkin';
    return 'overview';
  }

  // The card flow's two poses are computed live: handoff frames the actual
  // customer and entry closes in on the reader at its fixed counter station.
  // All other states keep their static presets.
  function dynamicPose(key) {
    if (key === 'fulfillment') {
      const p = fulfillmentHandoffPose(customerLocalPosition(), REGISTER.printer, COUNTER_TOP);
      return { pose: poseBetween(p.eye, p.look), fov: p.fov };
    }
    if (key === 'cardTake') {
      const p = cardHandoffPose(customerLocalPosition(), COUNTER_TOP);
      return { pose: poseBetween(p.eye, p.look), fov: p.fov };
    }
    if (key === 'card') {
      // The reader stays seated; only the camera closes in for a readable view.
      const p = cardTerminalPose(CARD_STATION, COUNTER_TOP);
      return { pose: poseBetween(p.eye, p.look), fov: p.fov };
    }
    return POSES[key] || POSES.overview;
  }

  function updateCamera(dt) {
    if (!active) return;
    const key = poseKey();
    // dynamic poses (cardTake/card) re-read their live target EVERY frame, so
    // the camera follows the customer and rises with the floating reader; static
    // poses return a constant, so tracking them each frame is a no-op.
    const target = dynamicPose(key);
    if (accessibilityPrefs.reducedCameraMotion) {
      // Required close views remain readable, but transitions become immediate
      // cuts and the camera stops chasing customer animation or cursor sway.
      if (!cameraPose || key !== activePoseKey) cameraPose = { ...target.pose };
      activePoseKey = key;
      cameraTween = null;
      lookYaw = 0;
      lookPitch = 0;
      lookTargetYaw = 0;
      lookTargetPitch = 0;
      if (Math.abs(target.fov - camera.fov) > 0.001) {
        camera.fov = target.fov;
        camera.updateProjectionMatrix();
      }
      focusOn(cameraPose);
      return;
    }
    if (!cameraPose) {
      cameraPose = { ...target.pose };
      activePoseKey = key;
      camera.fov = target.fov;
      camera.updateProjectionMatrix();
    }
    if (key !== activePoseKey) {
      // ease in from wherever the camera currently is; the tween chases the LIVE
      // target below, so a moving subject is followed rather than snapped to
      cameraTween = { from: { ...cameraPose }, fovFrom: camera.fov, t: 0 };
      activePoseKey = key;
    }
    let desiredFov = target.fov;
    if (cameraTween) {
      cameraTween.t = Math.min(1, cameraTween.t + dt / CAMERA_TWEEN_SECONDS);
      const s = THREE.MathUtils.smoothstep(cameraTween.t, 0, 1);
      cameraPose = lerpPose(cameraTween.from, target.pose, s);
      desiredFov = THREE.MathUtils.lerp(cameraTween.fovFrom, target.fov, s);
      if (cameraTween.t >= 1) cameraTween = null;
    } else {
      cameraPose = target.pose; // track the live target (constant for static poses)
    }
    if (Math.abs(desiredFov - camera.fov) > 0.001) {
      camera.fov = desiredFov;
      camera.updateProjectionMatrix();
    }
    // the mouse leans the head around the pose — eased, so it reads as a neck
    // Scanning is a fixed working frame: a click near one edge cannot pan the
    // remaining products out of reach. Other workspaces retain the eased neck
    // motion used to glance between their hardware and customer targets.
    if (workspace === 'scan') {
      lookYaw = 0;
      lookPitch = 0;
      lookTargetYaw = 0;
      lookTargetPitch = 0;
    } else {
      const ease = Math.min(1, dt * 7);
      lookYaw += (lookTargetYaw - lookYaw) * ease;
      lookPitch += (lookTargetPitch - lookPitch) * ease;
    }
    focusOn({
      ...cameraPose,
      yaw: cameraPose.yaw + lookYaw,
      pitch: cameraPose.pitch + lookPitch,
    });
  }

  function update(dt) {
    const animationDt = checkoutAnimationDelta(dt, accessibilityPrefs);
    // Settings are inaccessible while the register owns input, but a renderer
    // refresh can still replace the live value. Reassert without recapturing;
    // inactive front-desk play never reads or writes the player's setting.
    if (active) activeRegisterGtaoOverride.setActive(true);
    // Recovery owns this frame, and the resumed state owns the next one. That
    // frame boundary prevents a timed-out animation from both rolling back and
    // advancing again from stale timers/callback state in the same update.
    if (recoverCheckoutWatchdog()) return;
    if (runCheckoutWatchdogPostResume()) return;
    if (updateCashWatchdogRecovery(animationDt)) return;
    if (enterTimer > 0) {
      enterTimer = Math.max(0, enterTimer - animationDt);
      if (enterTimer === 0 && checkoutFlowState() === 'EnteringCashierMode') {
        flowTo('WaitingForScan', 'monitor-camera-and-pointer-ready');
      }
    }
    updateScanMotion(animationDt);
    updateScannerFeedback(animationDt);
    if (scanReturnTimer > 0) {
      scanReturnTimer = Math.max(0, scanReturnTimer - animationDt);
      if (scanReturnTimer === 0) setWorkspace('monitor');
    }
    if (active && paymentAutoTimer > 0 && workspace === 'monitor'
        && tx && tx.stage === 'scanning' && unscannedCount(tx) === 0) {
      paymentAutoTimer = Math.max(0, paymentAutoTimer - animationDt);
      if (paymentAutoTimer === 0) choosePayment(preferredPayment());
    }
    // Once the receipt and bag have physically reached the customer, the sale
    // banks itself and the customer leaves — no separate "finalize" click. A
    // failed attempt re-arms the timer: with no manual button in the automatic
    // flow, a transient refusal must never strand a paid customer.
    if (finalizeTimer > 0 && tx && tx.stage === 'done' && autoFulfilled
        && deliveryPhase === 'released') {
      finalizeTimer = Math.max(0, finalizeTimer - animationDt);
      if (finalizeTimer === 0 && !finalizeTransaction()) finalizeTimer = 0.6;
    }
    if (tx && tx.stage === 'card-busy') {
      const dots = advanceTerminalBusyDots(termDotsTimer, dt);
      termDotsTimer = dots.elapsed;
      if (dots.changed) drawTerm();
    }
    updateTerminalKeys(animationDt);
    updateCard(animationDt);
    updateDrawer(animationDt);
    updateCashMotions(animationDt);
    updateCashHandoffHold(animationDt);
    updateCashAccessibility(animationDt);
    updateReceipt(animationDt);
    updateDelivery(animationDt);
    updateCamera(animationDt);
    updateCashierHandPresentation(animationDt);
  }

  function hint() {
    if (workspace === 'monitor') {
      if (tx && tx.stage === 'cash-tender') {
        return { text: 'Click the customer’s cash to take it', total: false, drawer: false };
      }
      return { text: 'Use the front-desk monitor. Right-click or Escape exits safely.', total: false, drawer: false };
    }
    if (workspace === 'scan') {
      return {
        text: 'Click each item to scan it and place it in the bag',
        total: false,
        drawer: false,
      };
    }
    if (workspace === 'card') {
      return { text: tx && tx.stage === 'card-entry' ? 'Confirm the prefilled total with the green key' : checkoutStatus(), total: false, drawer: false };
    }
    if (workspace === 'cash') {
      return { text: 'Click drawer money to count change — exact, or up to $5.00 over. Enter confirms.', total: false, drawer: true };
    }
    return { text: 'Front desk active', total: false, drawer: false };
  }

  function label() {
    if (tx) {
      const remaining = unscannedCount(tx);
      return `${cust ? cust.name : 'Customer'} is waiting - [E] open front desk${remaining ? ` (${remaining} to scan)` : ''}`;
    }
    const waiting = reservationsWaiting();
    if (waiting.length) return `${waiting[0].name} is ready to check in - [E] open front desk`;
    return 'Front desk monitor - [E] open';
  }

  function monitorActionPoint(actionId) {
    const point = monitorUi.actionPoint(actionId);
    return point ? { ...point, width: SCREEN_W, height: SCREEN_H } : null;
  }

  function monitorScreenPoint(actionId) {
    const point = monitorUi.actionPoint(actionId);
    if (!point || !screenPlane) return null;
    const world = new THREE.Vector3(
      (point.x / SCREEN_W - 0.5) * POS_PLANE_W,
      (0.5 - point.y / SCREEN_H) * POS_PLANE_H,
      0.01,
    );
    screenPlane.localToWorld(world);
    world.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }

  // Screen-space centre of a PHYSICAL terminal key (QA drivers click these).
  function cardKeyScreenPoint(label) {
    const aliases = { CLEAR: 'CANCEL', DELETE: 'BACK' };
    const entry = termKeys.get(aliases[String(label)] || String(label));
    if (!entry) return null;
    root.updateMatrixWorld(true);
    const world = entry.mesh.getWorldPosition(new THREE.Vector3());
    world.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }

  // Where the reader's cancel-the-run X projects to on screen, so a driver can
  // click it and assert it is shown only before the amount is submitted.
  function cardXScreenPoint() {
    if (!termScreenPlane) return null;
    const cx = (TERM_X_BOX.x0 + TERM_X_BOX.x1) / 2;
    const cy = (TERM_X_BOX.y0 + TERM_X_BOX.y1) / 2;
    const lx = (cx / TERM_CANVAS_W - 0.5) * TERM_SCREEN_W;
    const ly = (0.5 - cy / TERM_CANVAS_H) * TERM_SCREEN_H;
    root.updateMatrixWorld(true);
    const world = termScreenPlane.localToWorld(new THREE.Vector3(lx, ly, 0.003));
    world.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      visible: terminalXVisible(),
    };
  }

  buildDrawer();
  buildBag();
  drawScreen();
  drawTerm();

  // Where the presented cash handful / card project to on screen — stable click
  // targets for a driver, from the actual mesh world position (not a re-derived
  // local point that drifts if the register root is offset from the interior).
  function meshScreenPoint(mesh) {
    if (!mesh) return null;
    root.updateMatrixWorld(true);
    const world = mesh.getWorldPosition(new THREE.Vector3());
    world.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }
  const presentedCashScreenPoint = () => meshScreenPoint(tenderHandful);
  const presentedCardScreenPoint = () => meshScreenPoint(cardMesh);
  const scanPresentation = () => {
    const choreography = scanMotion ? scanChoreographyAt(scanMotion.elapsed) : null;
    return {
      active: !!scanMotion,
      phase: scanMotion?.phase || null,
      phaseT: choreography?.phaseT || 0,
      uid: scanMotion?.uid || null,
      elapsed: scanMotion?.elapsed || 0,
      duration: scanMotion?.duration || scanDuration(),
      committed: !!scanMotion?.committed,
      scannerFeedback: scannerFeedbackMode,
      lastRead: lastScanEvidence ? {
        ...lastScanEvidence,
        barcodePosition: [...lastScanEvidence.barcodePosition],
        barcodeNormal: [...lastScanEvidence.barcodeNormal],
        rayOrigin: [...lastScanEvidence.rayOrigin],
        rayDirection: [...lastScanEvidence.rayDirection],
      } : null,
    };
  };
  const scanAlignment = () => {
    const scanner = scannerRayPose();
    return {
      attached: !!scannerObject,
      raySocket: !!scannerRayOrigin,
      source: scanner.source,
      origin: scanner.origin.toArray(),
      direction: scanner.direction.toArray(),
    };
  };
  const cashHandoffPresentation = () => {
    const position = cashierTargetFor(cashHandoffBundle);
    const target = cust ? customerChangePoint() : null;
    return {
      active: !!cashHandoffBundle,
      phase: cashHandoffPhase,
      holdRemaining: cashHandoffHoldTimer,
      position: position ? position.toArray() : null,
      target: target ? target.toArray() : null,
      distanceToPalm: position && target ? position.distanceTo(target) : null,
      cashierHandsVisible: cashierHands.root.visible,
      parentedToCustomer: !!(cashHandoffBundle
        && cashHandoffBundle.parent
        && cashHandoffBundle.parent !== root),
    };
  };
  const deliveryPresentation = () => {
    const receiptPosition = cashierTargetFor(receiptMesh);
    const receiptTarget = cust ? customerGripPoint('R') : null;
    const bagPosition = bagHandlePoint();
    const bagTarget = cust ? customerGripPoint('L') : null;
    return {
      active: !!deliveryPhase && deliveryPhase !== 'released',
      phase: deliveryPhase,
      holdRemaining: deliveryTimer,
      receiptPosition: receiptPosition ? receiptPosition.toArray() : null,
      receiptTarget: receiptTarget ? receiptTarget.toArray() : null,
      receiptDistanceToPalm: receiptPosition && receiptTarget
        ? receiptPosition.distanceTo(receiptTarget) : null,
      receiptParentedToCustomer: !!(receiptMesh
        && receiptMesh.parent === customerGripNode('R')),
      bagHandlePosition: bagPosition ? bagPosition.toArray() : null,
      bagTarget: bagTarget ? bagTarget.toArray() : null,
      bagDistanceToPalm: bagPosition && bagTarget ? bagPosition.distanceTo(bagTarget) : null,
      bagAcceptedByCustomer: !!(bagGroup && cust?.checkoutHandoffBag === bagGroup),
      cashierHandsVisible: cashierHands.root.visible,
    };
  };

  return {
    simplified: true,
    presentedCashScreenPoint,
    presentedCardScreenPoint,
    root,
    screenMaterial,
    termMaterial,
    attachScreen,
    attachTerm,
    attachScanner,
    attachPrinter,
    setPlacementPreview,
    isActive: () => active,
    hasTx: () => !!tx,
    getTx: () => tx,
    getCustomer: () => cust,
    getFlow: () => (tx && tx.checkoutFlow ? tx.checkoutFlow : null),
    checkoutWatchdogDiagnostics: () => ({
      managedStates: [...SIMPLIFIED_REGISTER_WATCHDOG_STATES],
      events: checkoutWatchdogEvents.map((entry) => ({ ...entry })),
      running: checkoutWatchdogRunning,
      pendingPostResume: checkoutWatchdogPostResume,
      cashRecoveryPending: cashRecoveryTimer > 0,
    }),
    accessibilityPreferences: () => ({ ...accessibilityPrefs }),
    scanPresentation,
    scanAlignment,
    cashHandoffPresentation,
    deliveryPresentation,
    drawerPrewarmStatus: () => ({ ...drawerPrewarm }),
    cashGpuPrewarmStatus,
    waitForCashGpuPrewarmRepresentatives,
    releaseCashGpuPrewarmRepresentatives,
    // Read-only choreography state for browser acceptance evidence. Gameplay
    // still advances this exclusively through updateReceipt/updateDelivery.
    deliveryPhase: () => deliveryPhase,
    hint,
    insertAt: () => ({
      ready: { ...INSERT_READY },
      inserted: { ...INSERTED },
      u: cardU,
      ejecting: cardEjectTimer > 0,
      pickupDelay: cardPickupDelay,
      cashierHandsVisible: cashierHands.root.visible,
    }),
    monitorActionPoint,
    monitorScreenPoint,
    cardKeyScreenPoint,
    cardXScreenPoint,
    cardTerminalLocked: () => cardTerminalLocked(),
    monitorHotspots: () => monitorUi.hotspots(),
    // dev-only: what would a click at these client coordinates pick?
    debugPickAt: (clientX, clientY) => {
      const object = physicalPick({ clientX, clientY });
      return {
        monitorAction: monitorActionAt({ clientX, clientY }),
        physical: object ? {
          name: object.name || '(anon)',
          kind: object.userData.kind,
          uid: object.userData.uid,
          denom: object.userData.denom,
          from: object.userData.from,
        } : null,
      };
    },
    workspace: () => workspace,
    begin,
    abandon,
    enter,
    leave,
    update,
    onDown,
    onMove,
    onUp,
    onWheel,
    onKey,
    recoverInput,
    tapTerminal,
    drawScreen,
    label,
  };
}
