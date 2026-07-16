// SIMPLIFIED FRONT DESK REGISTER
//
// The transaction engine in sim/register.js remains the sole authority for scans,
// payment, drawer balancing, receipts, fulfillment, and exact-once banking. This
// module only presents those verbs through a readable shared monitor and a few
// forgiving physical interactions. There are deliberately no first-person hands,
// staging mat, manual bag, drawer pull, or receipt pickup in this live path.

import * as THREE from 'three';
import { REGISTER, COUNTER, COUNTER_TOP } from '../../data/shopLayout.js';
import { skuById } from '../../data/shopItems.js';
import {
  BILLS, DENOMS, createTx, scanItem, unscannedCount, requestPayment,
  subtotal, discountOf, totalOf, dueOf, cashTotalOf,
  presentCard, insertCard, cardEnteredAmount, enterCardDigit,
  backspaceCardAmount, clearCardAmount, submitCardAmount,
  runCard, retryCard, cancelCard, payCashInstead,
  customerCash, acceptCash, openDrawer, depositPiece,
  depositTendered, takeFromDrawer, returnToDrawer, changeDue, handTotal,
  handOverChange, printReceipt, takeReceipt, packReceipt, bagItem,
  handOverGoods, completeSale, voidTx, newDrawer, migrateDrawer, drawerContents,
  stackTotal, makeChange, makeChangeFrom,
} from '../../sim/register.js';
import {
  createCheckoutFlow, transitionCheckout,
} from '../../sim/registerFlow.js';
import { dueForCheckIn, fmtSlot } from '../../sim/reservations.js';
import {
  createReservationCheckInTx, finalizeReservationCheckIn,
} from '../../sim/reservationCheckIn.js';
import { createRegisterItemResources } from './registerItemResources.js';
import {
  buildCatalogProductProxy, catalogCheckoutLayout,
} from './catalogProductVisual.js';
import { createFrontDeskMonitorUi } from './frontDeskMonitorUi.js';

const SCREEN_W = 1024;
const SCREEN_H = 640;
const REST_Y = COUNTER_TOP + 0.012;
const SCAN_Y = COUNTER_TOP + 0.13;
const CARD_TIME = 1.15;
const RECEIPT_TIME = 0.9;
// Preserve the physical work triangle instead of turning each task into an
// isolated close-up. The reference composition keeps the customer, main POS,
// and active device readable together.
const MONITOR_FOV = 56;
const SCAN_FOV = 58;
const CARD_FOV = 46;
const CASH_FOV = 48;
// ISO/IEC 7810 ID-1 proportions, kept at believable real-world scale.
const CARD_WIDTH = 0.086;
const CARD_HEIGHT = 0.054;
const CARD_THICKNESS = 0.0014;
const CARD_STATION = Object.freeze({ x: 1.78, z: 4.38 });
const CARD_PANEL_W = 0.235;
const CARD_PANEL_H = 0.39;
const CARD_KEY_LABELS = Object.freeze([
  Object.freeze(['1', '2', '3']),
  Object.freeze(['4', '5', '6']),
  Object.freeze(['7', '8', '9']),
  Object.freeze(['CLEAR', '0', 'OK']),
]);

const INSERT_READY = {
  x: CARD_STATION.x,
  // Stage the customer's card at a believable hand height before the slot so
  // both the card and the down-and-forward insertion gesture remain visible.
  y: COUNTER_TOP + 0.12,
  // Begin with the entire ID-1 card clearly in front of the reader. The old
  // point sat on the reader shell, making ready and inserted states identical.
  z: CARD_STATION.z + 0.40,
};
const INSERTED = {
  x: CARD_STATION.x,
  y: COUNTER_TOP + 0.075,
  // Stop at the authored slot instead of burying the card beneath the reader.
  z: CARD_STATION.z + 0.27,
};

const DRAWER_BILLS = [1, 5, 10, 20, 50];
const DRAWER_COINS = [0.01, 0.05, 0.1, 0.25, 0.5];
const SLOT = {};
DRAWER_BILLS.forEach((denom, index) => {
  SLOT[denom] = { x: -0.164 + index * 0.082, y: 0.118, z: 0.095 };
});
DRAWER_COINS.forEach((denom, index) => {
  SLOT[denom] = { x: -0.164 + index * 0.082, y: 0.112, z: -0.098 };
});

const moneyLabel = (denom) => (denom < 1
  ? `${Math.round(denom * 100)}c`
  : `$${denom}`);

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
  const canvas = B.ctx.canvas || document.querySelector('canvas');
  const focusOn = B.ctx.focusOn || (() => {});
  const clearFocus = B.ctx.clearFocus || (() => {});
  const sfx = (name) => { if (hooks.sfx) hooks.sfx(name); };
  const toast = (message, kind) => { if (hooks.toast) hooks.toast(message, kind); };

  const root = new THREE.Group();
  root.name = 'SimplifiedFrontDeskRegister';
  interior.add(root);

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
  let cardStatusFurniture = null;
  let cardStatusPlane = null;

  const termCanvas = document.createElement('canvas');
  termCanvas.width = 384;
  termCanvas.height = 640;
  const termTexture = new THREE.CanvasTexture(termCanvas);
  termTexture.colorSpace = THREE.SRGBColorSpace;
  const termMaterial = new THREE.MeshBasicMaterial({
    map: termTexture,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  let printerRoll = null;
  let receiptMesh = null;
  let receiptTimer = 0;
  let autoFulfilled = false;
  let finalizeTimer = 0;

  // The shopping bag sits at counter-left; a clicked product arcs into its mouth
  // and drops out of sight (it is now "in the bag"). Positions are tuned to the
  // reference composition and refined once the rebuilt bag asset lands.
  let bagGroup = null;
  // Counter-left, toward the staff edge, so it sits in the near-left of the
  // cashier frame like the reference (and clear of the POS at x 2.25).
  const BAG_POS = new THREE.Vector3(2.06, COUNTER_TOP, 4.66);
  const bagMouth = new THREE.Vector3(BAG_POS.x + 0.02, COUNTER_TOP + 0.18, BAG_POS.z - 0.03);

  const itemResources = createRegisterItemResources();
  const itemMeshes = new Map();
  const loose = [];
  // No scanner in the click-to-bag flow: the counter carries no scan glass and no
  // laser beam. Items are bagged by a click, not swept over a scanner.

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
  let selectedReservationId = null;
  let selectedWalkInCustomerId = null;
  let postSaleDisplay = null;
  let restorePointerLock = false;
  let previousFov = null;
  let cameraPose = null;
  let cameraTarget = null;
  let enterTimer = 0;

  let selectedItem = null;
  let scanDrag = null;
  let scanMotion = null;
  let scanReturnTimer = 0;
  let paymentAutoTimer = 0;
  let cashAcceptTimer = 0;
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

  let drawer = null;
  let drawerWant = 0;
  let drawerAmount = 0;
  let drawerGroup = null;
  let drawerMotionRoot = null;
  let drawerMoney = null;
  let drawerAssetSlide = null;
  let drawerAssetSlideBaseZ = 0;
  const slotHotspots = [];
  const slotLabels = [];
  let tenderMeshes = [];
  let selectedTender = null;
  let selectedChangeMeshes = [];
  let cashMotions = [];
  let cashMotionRefillPending = false;
  let cashPanel = null;
  let cashPanelTexture = null;
  let cashPanelCanvas = null;
  let cashPanelFurniture = null;
  let cashSortHotspot = null;
  let cashReviewHotspot = null;
  let scanPanel = null;
  let scanPanelTexture = null;
  let scanPanelCanvas = null;
  let scanPanelFurniture = null;

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

  const POSES = {
    monitor: poseBetween(
      { x: 2.72, y: 1.55, z: 5.48 },
      { x: 2.48, y: 1.22, z: 4.18 },
    ),
    scan: poseBetween(
      // Centred, elevated over-counter shot: bag (left), products (centre) and
      // POS (right) read together above the counter, like the reference.
      { x: 2.62, y: 1.64, z: 5.55 },
      { x: 2.52, y: 1.03, z: 4.00 },
    ),
    card: poseBetween(
      // Look diagonally across the work triangle so the reader is no longer
      // hidden directly behind the larger POS kiosk. The reader remains left
      // of the total display, matching the physical checkout reference.
      { x: 1.52, y: 1.52, z: 5.44 },
      { x: 2.08, y: 1.24, z: 4.12 },
    ),
    cash: poseBetween(
      // Center the drawer and its dedicated display as one vertical workspace.
      // The lower target keeps the open tray and coin wells inside the frame.
      { x: 2.44, y: 2.15, z: 6.05 },
      { x: 2.40, y: 1.02, z: 4.75 },
    ),
  };

  function easePose(current, target, amount) {
    let dy = target.yaw - current.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    current.x += (target.x - current.x) * amount;
    current.y += (target.y - current.y) * amount;
    current.z += (target.z - current.z) * amount;
    current.yaw += dy * amount;
    current.pitch += (target.pitch - current.pitch) * amount;
    return current;
  }

  function setNdc(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
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
    if (tx.stage === 'done') return 'READY TO FINALIZE';
    if (tx.stage === 'cash-drawer' && tx.deposited) {
      const delta = Math.round((handTotal(tx) - changeDue(tx)) * 100);
      return delta === 0 ? 'CHANGE READY' : 'SELECT CHANGE';
    }
    if (tx.stage === 'cash-drawer') return 'SORT RECEIVED CASH';
    if (tx.stage === 'cash-tender') return 'CASH PRESENTED';
    if (tx.stage === 'card-entry') return tx.cardEntryError || 'ENTER CARD AMOUNT';
    if (tx.stage === 'card-ready') return 'INSERT CARD';
    if (tx.stage === 'card-present') return 'CARD PRESENTED';
    if (unscannedCount(tx) === 0) return 'ALL ITEMS SCANNED';
    return workspace === 'scan' ? 'SCANNING ITEMS' : 'PRODUCTS READY';
  }

  function checkoutInstruction() {
    if (!tx) return 'The register is ready for the next customer.';
    if (tx.stage === 'scanning') {
      if (unscannedCount(tx)) {
        return workspace === 'scan'
          ? 'Click each product to drop it into the bag.'
          : 'Open the counter, then click each product to bag it.';
      }
      return `Opening the ${preferredPayment() === 'cash' ? 'cash drawer' : 'card reader'} automatically.`;
    }
    if (tx.stage === 'card-present') return 'The card is moving into the reader. No hands are required.';
    if (tx.stage === 'card-ready') return 'Push the aligned card forward into the chip slot.';
    if (tx.stage === 'card-entry') return `Use the reader keypad to enter $${totalOf(tx).toFixed(2)}, then press OK.`;
    if (tx.stage === 'card-busy') return 'The card reader is processing the payment.';
    if (tx.stage === 'card-declined') return 'Try a replacement card or switch this transaction to cash.';
    if (tx.stage === 'cash-tender') return 'Open the cash workspace, then click the received cash to open the drawer.';
    if (tx.stage === 'cash-drawer' && !tx.deposited) return 'Select each received piece and its matching labeled compartment, or use Sort Received Cash.';
    if (tx.stage === 'cash-drawer') return 'Select the exact change from the labeled drawer, then review it on this monitor.';
    if (tx.stage === 'receipt') return 'Payment is accepted. The receipt is printing automatically.';
    if (tx.stage === 'done') return 'Finalize to bank the sale and release the customer.';
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
    if (tx.stage === 'cash-tender') {
      return [
        { id: 'open-cash-workspace', label: 'Open Cash', kind: 'primary' },
        { id: 'sort-received-cash', label: 'Auto-Sort', kind: 'cash' },
      ];
    }
    if (tx.stage === 'cash-drawer') {
      if (!tx.deposited) {
        return [
          { id: 'open-cash-workspace', label: 'Cash Drawer', kind: 'primary' },
          { id: 'sort-received-cash', label: 'Auto-Sort', kind: 'cash' },
        ];
      }
      const exact = Math.round(handTotal(tx) * 100) === Math.round(changeDue(tx) * 100);
      return [
        { id: 'open-cash-workspace', label: 'Edit Change', kind: 'secondary' },
        { id: 'confirm-change', label: changeDue(tx) > 0 ? `Confirm $${changeDue(tx).toFixed(2)}` : 'Confirm Exact', kind: 'primary', disabled: !exact },
      ];
    }
    if (tx.stage === 'receipt') return [];
    if (tx.stage === 'bagging' || tx.stage === 'done') {
      return [{ id: 'finalize-transaction', label: transactionKind === 'reservation' ? 'Complete Check-In' : 'Finalize Transaction', kind: 'success' }];
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
      return {
        app: 'check-in',
        reservations: [...walkInRows, ...reservationRows],
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
    monitorUi.draw(monitorModel());
    screenTexture.needsUpdate = true;
    drawScanPanel();
  }

  function drawTerm() {
    const ctx = termCanvas.getContext('2d');
    ctx.fillStyle = '#101713';
    ctx.fillRect(0, 0, termCanvas.width, termCanvas.height);
    ctx.strokeStyle = '#b9974e';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, termCanvas.width - 16, termCanvas.height - 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8f0dc';
    const entryActive = !!(tx && tx.stage === 'card-entry');
    const displayedAmount = entryActive ? cardEnteredAmount(tx) : (tx ? totalOf(tx) : 0);
    ctx.font = '700 47px Arial, sans-serif';
    ctx.fillText(tx && tx.method === 'card' ? `$${displayedAmount.toFixed(2)}` : 'PINEHOLLOW', 192, 72);
    let message = 'READY';
    let color = '#d7e2d5';
    if (tx && tx.method === 'card') {
      if (tx.stage === 'card-present') message = 'PRESENT CARD';
      else if (tx.stage === 'card-ready') message = insertMessage || 'INSERT CARD';
      else if (tx.stage === 'card-entry') {
        message = tx.cardEntryError
          || (String(tx.cardEntryDigits || '').length ? 'PRESS OK' : 'ENTER AMOUNT');
        if (tx.cardEntryError) color = '#f1a399';
      }
      else if (tx.stage === 'card-busy') message = 'PROCESSING';
      else if (tx.stage === 'card-declined') {
        message = tx.cardResult === 'timeout' ? 'TIMEOUT' : 'DECLINED';
        color = '#f1a399';
      } else if (['receipt', 'bagging', 'done'].includes(tx.stage)) {
        message = 'PAYMENT ACCEPTED';
        color = '#8fd1a5';
      }
    }
    ctx.font = `700 ${message.length > 14 ? 29 : 35}px Arial, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(message, 192, 152);
    ctx.font = '600 20px Arial, sans-serif';
    ctx.fillStyle = '#aebbb2';
    ctx.fillText(tx && tx.stage === 'card-ready'
      ? 'PUSH FORWARD'
      : (entryActive ? `TOTAL $${totalOf(tx).toFixed(2)}`
        : (cust && cust.name ? cust.name.toUpperCase() : 'FAIRWAY MEMBER')), 192, 206);

    const keyW = 92;
    const keyH = 66;
    const gap = 12;
    const startX = 42;
    const startY = 276;
    CARD_KEY_LABELS.forEach((row, rowIndex) => row.forEach((label, colIndex) => {
      const x = startX + colIndex * (keyW + gap);
      const y = startY + rowIndex * (keyH + gap);
      const confirm = label === 'OK';
      const clear = label === 'CLEAR';
      ctx.fillStyle = entryActive
        ? (confirm ? '#2d7650' : (clear ? '#76512d' : '#26342d'))
        : '#202722';
      ctx.fillRect(x, y, keyW, keyH);
      ctx.strokeStyle = entryActive ? '#b9974e' : '#4d554f';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, keyW, keyH);
      ctx.fillStyle = entryActive ? '#fff8e8' : '#687169';
      ctx.font = `700 ${label.length > 2 ? 19 : 29}px Arial, sans-serif`;
      ctx.fillText(label, x + keyW / 2, y + keyH / 2 + 1);
    }));
    termTexture.needsUpdate = true;
  }

  function cardKeyAtCanvas(x, y) {
    const keyW = 92;
    const keyH = 66;
    const gap = 12;
    const startX = 42;
    const startY = 276;
    for (let row = 0; row < CARD_KEY_LABELS.length; row += 1) {
      for (let col = 0; col < CARD_KEY_LABELS[row].length; col += 1) {
        const left = startX + col * (keyW + gap);
        const top = startY + row * (keyH + gap);
        if (x >= left && x <= left + keyW && y >= top && y <= top + keyH) {
          return CARD_KEY_LABELS[row][col];
        }
      }
    }
    return null;
  }

  function drawCashPanel() {
    if (!cashPanelCanvas || !cashPanelTexture) return;
    const ctx = cashPanelCanvas.getContext('2d');
    const received = tx
      ? (tx.tenderedTotal != null ? Number(tx.tenderedTotal) : stackTotal(tx.tendered || {}))
      : 0;
    const total = tx ? cashTotalOf(tx) : 0;
    const due = tx ? changeDue(tx) : 0;
    const giving = tx ? handTotal(tx) : 0;
    const exact = !!(tx && tx.deposited
      && Math.round(giving * 100) === Math.round(due * 100));

    ctx.fillStyle = '#eef3f3';
    ctx.fillRect(0, 0, cashPanelCanvas.width, cashPanelCanvas.height);
    ctx.fillStyle = '#ef9824';
    ctx.fillRect(12, 12, cashPanelCanvas.width - 24, 252);
    ctx.fillStyle = '#fff8e8';
    ctx.font = '700 18px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CASH PAYMENT', cashPanelCanvas.width / 2, 36);
    const rows = [
      ['RECEIVED', received],
      ['TOTAL', total],
      ['CHANGE', due],
    ];
    rows.forEach(([label, value], index) => {
      const y = 92 + index * 68;
      ctx.fillStyle = '#fff8e8';
      ctx.font = '700 27px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, 48, y);
      ctx.font = '700 32px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`$${Number(value).toFixed(2)}`, 462, y);
    });
    ctx.strokeStyle = '#a85c08';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(42, 173);
    ctx.lineTo(470, 173);
    ctx.stroke();

    ctx.fillStyle = '#163e5a';
    ctx.fillRect(12, 270, cashPanelCanvas.width - 24, 78);
    ctx.fillStyle = '#fff8e8';
    ctx.font = '700 29px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('GIVING', 48, 320);
    ctx.fillStyle = exact ? '#54ef48' : '#ff3b30';
    ctx.font = '700 35px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`$${giving.toFixed(2)}`, 462, 320);
    cashPanelTexture.needsUpdate = true;
  }

  function drawScanPanel() {
    if (!scanPanelCanvas || !scanPanelTexture) return;
    const ctx = scanPanelCanvas.getContext('2d');
    const selected = tx && selectedItem
      ? tx.items.find((item) => item.uid === selectedItem.userData.uid)
      : null;
    const remaining = tx ? unscannedCount(tx) : 0;
    const completed = tx ? tx.items.length - remaining : 0;
    ctx.fillStyle = '#f4eddb';
    ctx.fillRect(0, 0, scanPanelCanvas.width, scanPanelCanvas.height);
    ctx.fillStyle = '#173f2d';
    ctx.fillRect(0, 0, scanPanelCanvas.width, 58);
    ctx.fillStyle = '#fff8e8';
    ctx.font = '700 28px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ASSISTED SCAN', 24, 39);
    ctx.fillStyle = '#25332c';
    ctx.font = '700 34px Arial, sans-serif';
    const selectedName = selected ? selected.name : (remaining ? 'SELECT A PRODUCT' : 'ORDER SCANNED');
    ctx.fillText(selectedName.length > 24 ? `${selectedName.slice(0, 23)}…` : selectedName, 24, 106);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#173f2d';
    ctx.font = '700 34px Arial, sans-serif';
    ctx.fillText(selected ? `$${Number(selected.price).toFixed(2)}` : '', 616, 106);
    ctx.fillStyle = '#6c746e';
    ctx.font = '700 22px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${completed} SCANNED   •   ${remaining} REMAINING`, 24, 148);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8c6b2f';
    ctx.font = '700 25px Arial, sans-serif';
    ctx.fillText(`SUBTOTAL  $${tx ? subtotal(tx).toFixed(2) : '0.00'}`, 612, 148);
    ctx.fillStyle = '#173f2d';
    ctx.fillRect(18, 177, 604, 60);
    ctx.fillStyle = '#fff8e8';
    ctx.font = '700 22px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CLICK EACH ITEM TO BAG IT', 320, 215);
    scanPanelTexture.needsUpdate = true;
  }

  function attachScreen(registerObject) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.225), screenMaterial);
    plane.name = 'FrontDeskLiveMonitor';
    orientPlane(plane, 0.019, 0.315, 0, 0.84, 0.54, 0);
    registerObject.add(plane);
    registerFurniture = registerObject;
    registerFurniture.visible = workspace !== 'cash';
    screenPlane = plane;
    drawScreen();
  }

  function attachTerm(termObject) {
    // Bring the authored reader into the same visible work plane as the POS.
    // Its former customer-side position was completely hidden by the kiosk.
    termObject.position.set(CARD_STATION.x, COUNTER_TOP, CARD_STATION.z);
    const production = !!termObject.getObjectByName('ReaderScreen');
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.052), termMaterial);
    if (production) orientPlane(plane, 0, 0.089, -0.040, 0, 0.988, -0.156);
    else orientPlane(plane, 0.004, 0.057, -0.049, 0, 0.05, -1);
    termObject.add(plane);
    if (!cardStatusFurniture) {
      cardStatusFurniture = new THREE.Group();
      cardStatusFurniture.name = 'PhysicalCardStatusDisplay';
      cardStatusFurniture.visible = workspace === 'card';
      // A tall, self-contained payment terminal beside the POS.  The previous
      // postcard-sized status plaque sat behind a separate low reader and broke
      // the single-device silhouette shown by the reference.
      const x = CARD_STATION.x;
      const y = COUNTER_TOP + 0.235;
      const z = CARD_STATION.z;
      const backing = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.44, 0.034), mats.charcoal);
      backing.position.set(x, y, z - 0.013);
      cardStatusFurniture.add(backing);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.065, 0.035), mats.charcoal);
      stem.position.set(x, COUNTER_TOP + 0.032, z - 0.02);
      cardStatusFurniture.add(stem);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.024, 0.11), mats.charcoal);
      base.position.set(x, COUNTER_TOP + 0.012, z - 0.015);
      cardStatusFurniture.add(base);
      const statusPlane = new THREE.Mesh(new THREE.PlaneGeometry(CARD_PANEL_W, CARD_PANEL_H), termMaterial);
      statusPlane.name = 'ReadableCardTerminalStatus';
      statusPlane.position.set(x, y, z + 0.006);
      cardStatusFurniture.add(statusPlane);
      cardStatusPlane = statusPlane;
      root.add(cardStatusFurniture);
    }
    drawTerm();
  }

  function attachScanner(scannerObject) {
    const authoredBeam = scannerObject.getObjectByName('ScannerBeam');
    if (authoredBeam) authoredBeam.visible = false;
  }

  function attachPrinter(printerObject) {
    printerRoll = printerObject.getObjectByName('PaperRollPivot');
    const authoredPaper = printerObject.getObjectByName('ReceiptPaper');
    if (authoredPaper) authoredPaper.visible = false;
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
    mesh.userData = {
      ...mesh.userData,
      pick: true,
      kind: 'item',
      uid: item.uid,
      skuId: item.skuId,
      originalScale: mesh.scale.clone(),
    };
    mesh.castShadow = true;
    return mesh;
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
    const mesh = new THREE.Mesh(
      BILLS.includes(denom) ? billGeometry : coinGeometry,
      moneyMaterial(denom),
    );
    mesh.castShadow = from !== 'drawer';
    mesh.userData = { pick: true, kind: 'money', denom, from };
    return mesh;
  }

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

  function buildBag() {
    if (bagGroup) return;
    bagGroup = new THREE.Group();
    bagGroup.name = 'FrontDeskShoppingBag';
    bagGroup.position.copy(BAG_POS);
    root.add(bagGroup);
    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.30, 0.17),
      new THREE.MeshStandardMaterial({ color: 0xbda274, roughness: 0.92, metalness: 0.0 }),
    );
    fallback.position.y = 0.15;
    fallback.name = 'BagFallback';
    bagGroup.add(fallback);
    if (merch) {
      merch.onReady(() => {
        const model = merch.instantiate('checkout_shopping_bag');
        if (!model) return;
        fallback.visible = false;
        bagGroup.add(model);
      });
    }
  }

  function buildDrawer() {
    if (drawerGroup) return;
    const drawerZ = COUNTER.z + COUNTER.depth / 2 - 0.06;
    drawerGroup = new THREE.Group();
    drawerGroup.position.set(REGISTER.drawer.x, REGISTER.drawer.y, drawerZ);
    root.add(drawerGroup);
    drawerMotionRoot = new THREE.Group();
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

    for (const denom of DENOMS) {
      const slot = SLOT[denom];
      const bill = BILLS.includes(denom);
      const hotspot = new THREE.Mesh(
        new THREE.BoxGeometry(bill ? 0.082 : 0.074, 0.085, bill ? 0.19 : 0.12),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hotspot.position.set(
        slot.x,
        slot.y + 0.035,
        slot.z - (bill ? 0.055 : 0.030),
      );
      hotspot.userData = { pick: true, kind: 'drawer-slot', denom };
      drawerMotionRoot.add(hotspot);
      slotHotspots.push(hotspot);

      const label = makeFlatLabel(moneyLabel(denom), bill ? 0.073 : 0.064, 0.029);
      label.position.set(slot.x, slot.y + 0.049, slot.z - (bill ? 0.066 : 0.035));
      drawerMotionRoot.add(label);
      slotLabels.push(label);
    }

    cashPanelCanvas = document.createElement('canvas');
    cashPanelCanvas.width = 512;
    cashPanelCanvas.height = 360;
    cashPanelTexture = new THREE.CanvasTexture(cashPanelCanvas);
    cashPanelTexture.colorSpace = THREE.SRGBColorSpace;
    cashPanelTexture.anisotropy = 8;
    cashPanelTexture.minFilter = THREE.LinearFilter;
    cashPanelTexture.magFilter = THREE.LinearFilter;
    const panelMaterial = new THREE.MeshBasicMaterial({
      map: cashPanelTexture,
      toneMapped: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    cashPanelFurniture = new THREE.Group();
    cashPanelFurniture.name = 'CashWorkspaceDisplay';
    cashPanelFurniture.visible = workspace === 'cash';
    root.add(cashPanelFurniture);
    // Align the cash display directly above the drawer so totals, slots and
    // selected pieces read as one compact workspace.
    const cashPanelX = REGISTER.drawer.x;
    const cashPanelY = COUNTER_TOP + 0.235;
    const cashPanelZ = 4.47;
    const cashBacking = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.030), mats.charcoal);
    cashBacking.position.set(cashPanelX, cashPanelY, cashPanelZ - 0.012);
    cashPanelFurniture.add(cashBacking);
    const cashStem = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.16, 0.036), mats.charcoal);
    cashStem.position.set(cashPanelX, COUNTER_TOP + 0.08, cashPanelZ - 0.02);
    cashPanelFurniture.add(cashStem);
    const cashBase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.024, 0.11), mats.charcoal);
    cashBase.position.set(cashPanelX, COUNTER_TOP + 0.012, cashPanelZ - 0.01);
    cashPanelFurniture.add(cashBase);
    cashPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.40), panelMaterial);
    // Keep the live plane clear of the backing face. A coplanar first frame
    // produced a severe dotted z-fighting pattern while the drawer opened.
    cashPanel.position.set(cashPanelX, cashPanelY, cashPanelZ + 0.008);
    cashPanel.renderOrder = 2;
    cashPanelFurniture.add(cashPanel);

    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    cashSortHotspot = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.10, 0.12), invisible);
    cashSortHotspot.position.set(cashPanelX - 0.14, COUNTER_TOP + 0.13, cashPanelZ + 0.02);
    cashSortHotspot.userData = { pick: true, kind: 'cash-sort' };
    cashSortHotspot.visible = false;
    root.add(cashSortHotspot);
    cashReviewHotspot = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.10, 0.12), invisible);
    cashReviewHotspot.position.set(cashPanelX + 0.14, COUNTER_TOP + 0.13, cashPanelZ + 0.02);
    cashReviewHotspot.userData = { pick: true, kind: 'cash-review' };
    cashReviewHotspot.visible = false;
    root.add(cashReviewHotspot);

    scanPanelCanvas = document.createElement('canvas');
    scanPanelCanvas.width = 640;
    scanPanelCanvas.height = 256;
    scanPanelTexture = new THREE.CanvasTexture(scanPanelCanvas);
    scanPanelTexture.colorSpace = THREE.SRGBColorSpace;
    scanPanelTexture.anisotropy = 8;
    scanPanelFurniture = new THREE.Group();
    scanPanelFurniture.name = 'AssistedScanDisplay';
    scanPanelFurniture.visible = false;
    root.add(scanPanelFurniture);
    const scanBacking = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.23, 0.025), mats.charcoal);
    scanBacking.position.set(2.70, COUNTER_TOP + 0.25, 3.79);
    scanBacking.rotation.x = -0.08;
    scanPanelFurniture.add(scanBacking);
    const scanStem = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.16, 0.032), mats.charcoal);
    scanStem.position.set(2.70, COUNTER_TOP + 0.08, 3.79);
    scanPanelFurniture.add(scanStem);
    const scanBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.024, 0.10), mats.charcoal);
    scanBase.position.set(2.70, COUNTER_TOP + 0.012, 3.82);
    scanPanelFurniture.add(scanBase);
    scanPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.50, 0.20),
      new THREE.MeshBasicMaterial({
        map: scanPanelTexture,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    scanPanel.name = 'AssistedScanStatusPanel';
    // Keep the live canvas just beyond the backing's front face. The earlier
    // 3.800 position sat inside the 25 mm backing and rendered as a black panel.
    scanPanel.position.set(2.70, COUNTER_TOP + 0.25, 3.805);
    scanPanel.rotation.x = -0.08;
    scanPanelFurniture.add(scanPanel);
    drawScanPanel();

    if (merch) {
      merch.onReady(() => {
        const model = merch.instantiate('checkout_cash_drawer') || merch.instantiate('cash_drawer');
        if (!model) return;
        fallback.visible = false;
        drawerGroup.add(model);
        drawerAssetSlide = model.getObjectByName('DrawerSlide');
        if (drawerAssetSlide) drawerAssetSlideBaseZ = drawerAssetSlide.position.z;
      });
    }
  }

  function refillDrawerMoney() {
    if (!drawerMoney || !drawer || !tx) return;
    drawerMoney.clear();
    const contents = drawerContents(tx, drawer);
    for (const denom of DENOMS) {
      const count = Math.min(contents[denom] || 0, 7);
      const slot = SLOT[denom];
      for (let index = 0; index < count; index += 1) {
        const piece = makeMoney(denom, 'drawer');
        piece.position.set(
          slot.x,
          slot.y + 0.004 + index * (BILLS.includes(denom) ? 0.0024 : 0.0031),
          slot.z,
        );
        if (BILLS.includes(denom)) piece.rotation.y = Math.PI / 2 + (index % 3 - 1) * 0.018;
        drawerMoney.add(piece);
      }
    }
  }

  function tenderPose(index) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    return {
      position: new THREE.Vector3(
        1.80 + column * 0.062,
        COUNTER_TOP + 0.016 + row * 0.004,
        4.82 + row * 0.065,
      ),
      rotation: new THREE.Euler(0, -0.24 + column * 0.12, 0),
    };
  }

  function layoutTender() {
    tenderMeshes.forEach((mesh, index) => {
      const pose = tenderPose(index);
      mesh.position.copy(pose.position);
      mesh.rotation.copy(pose.rotation);
    });
  }

  function drawerSlotPosition(denom, stackOffset = 0) {
    const slot = SLOT[denom];
    if (!slot || !drawerMotionRoot) return new THREE.Vector3();
    root.updateMatrixWorld(true);
    const world = drawerMotionRoot.localToWorld(new THREE.Vector3(
      slot.x,
      slot.y + 0.012 + stackOffset,
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
  } = {}) {
    if (!mesh) return;
    const from = mesh.position.clone();
    const fromQuaternion = mesh.quaternion.clone();
    const toQuaternion = new THREE.Quaternion().setFromEuler(
      BILLS.includes(mesh.userData.denom)
        ? new THREE.Euler(0, Math.PI / 2, 0)
        : new THREE.Euler(0, 0, 0),
    );
    mesh.userData.pick = false;
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
    });
  }

  function presentTender() {
    tenderMeshes.forEach((mesh, index) => {
      const pose = tenderPose(index);
      mesh.position.set(
        1.78 + (index % 5) * 0.035,
        COUNTER_TOP + 0.11 + Math.floor(index / 5) * 0.006,
        3.72 - Math.floor(index / 5) * 0.035,
      );
      mesh.rotation.set(0, -0.06, 0);
      queueCashMotion(mesh, pose.position, {
        delay: index * 0.055,
        duration: 0.48,
        enablePick: true,
        kind: 'tender-present',
      });
    });
  }

  function layoutSelectedChange() {
    let bills = 0;
    let coins = 0;
    selectedChangeMeshes.forEach((mesh) => {
      if (BILLS.includes(mesh.userData.denom)) {
        mesh.position.set(1.80 + (bills % 5) * 0.062, COUNTER_TOP + 0.018 + Math.floor(bills / 5) * 0.004, 4.82);
        mesh.rotation.y = -0.24 + (bills % 5) * 0.12;
        bills += 1;
      } else {
        mesh.position.set(1.80 + (coins % 6) * 0.042, COUNTER_TOP + 0.026, 4.90);
        coins += 1;
      }
    });
  }

  function clearPhysicalTransaction() {
    for (const mesh of itemMeshes.values()) {
      mesh.removeFromParent();
      itemResources.dispose(mesh);
    }
    itemMeshes.clear();
    loose.length = 0;
    tenderMeshes.forEach((mesh) => mesh.removeFromParent());
    tenderMeshes = [];
    selectedChangeMeshes.forEach((mesh) => mesh.removeFromParent());
    selectedChangeMeshes = [];
    cashMotions.forEach((motion) => motion.mesh.removeFromParent());
    cashMotions = [];
    cashMotionRefillPending = false;
    selectedTender = null;
    if (cardMesh) cardMesh.removeFromParent();
    cardMesh = null;
    if (receiptMesh) receiptMesh.removeFromParent();
    receiptMesh = null;
    receiptTimer = 0;
    autoFulfilled = false;
    selectedItem = null;
    scanDrag = null;
    scanMotion = null;
    scanReturnTimer = 0;
    paymentAutoTimer = 0;
    cashAcceptTimer = 0;
    finalizeTimer = 0;
    insertDrag = null;
    insertSnap = false;
    insertMessage = '';
    cardU = 0;
    cardPresentationTimer = 0;
    cardProcessingTimer = 0;
    cardResultTimer = 0;
    cardEjectTimer = 0;
    drawerWant = 0;
    drawerAmount = 0;
    if (drawerMotionRoot) drawerMotionRoot.position.z = 0;
    if (drawerAssetSlide) drawerAssetSlide.position.z = drawerAssetSlideBaseZ;
    if (cashPanelFurniture) cashPanelFurniture.visible = false;
    if (cashSortHotspot) cashSortHotspot.visible = false;
    if (cashReviewHotspot) cashReviewHotspot.visible = false;
    if (scanPanelFurniture) scanPanelFurniture.visible = false;
    if (cardStatusFurniture) cardStatusFurniture.visible = false;
    hoverBox.visible = false;
    hoveredItem = null;
  }

  function begin(customer) {
    if (tx) return false;
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
    workspace = 'monitor';
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
    drawScreen();
    drawTerm();
    return true;
  }

  function beginReservationPayment(reservation) {
    if (!reservation || tx) return false;
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
    workspace = 'monitor';
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
    workspace = 'monitor';
    drawScreen();
    drawTerm();
  }

  function enter() {
    if (active) return false;
    active = true;
    restorePointerLock = !!document.pointerLockElement;
    previousFov = camera.fov;
    workspace = 'monitor';
    activeTab = tx ? 'checkout' : 'home';
    enterTimer = 0.30;
    if (checkoutFlowState() === 'WaitingForCashier') {
      flowTo('EnteringCashierMode', 'player-opened-front-desk-monitor');
    }
    cameraPose = { ...POSES.monitor };
    cameraTarget = POSES.monitor;
    camera.fov = MONITOR_FOV;
    camera.updateProjectionMatrix();
    focusOn(cameraPose);
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.classList.add('register-mode');
    drawScreen();
    drawTerm();
    return true;
  }

  function leave() {
    if (!active) return;
    recoverInput('front-desk exit');
    active = false;
    setWorkspace('monitor');
    clearFocus();
    document.body.classList.remove('register-mode');
    if (previousFov != null && camera.fov !== previousFov) {
      camera.fov = previousFov;
      camera.updateProjectionMatrix();
    }
    if (restorePointerLock && document.hasFocus() && canvas.requestPointerLock) {
      setTimeout(() => {
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
    selectedTender = null;
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
    if (label === 'OK') return beginCardProcessing();
    if (label === 'CLEAR') clearCardAmount(tx);
    else if (/^\d$/.test(String(label))) enterCardDigit(tx, Number(label));
    else return false;
    sfx('uiTick');
    drawTerm();
    drawScreen();
    return true;
  }

  function handleCardKeypadAt(event) {
    if (!cardStatusPlane || !tx || tx.stage !== 'card-entry') return false;
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(cardStatusPlane, false)[0];
    if (!hit || !hit.uv) return false;
    const label = cardKeyAtCanvas(
      hit.uv.x * termCanvas.width,
      (1 - hit.uv.y) * termCanvas.height,
    );
    return label ? applyCardKey(label) : false;
  }

  function setWorkspace(next) {
    workspace = next;
    cameraTarget = POSES[next] || POSES.monitor;
    if (next !== 'scan') {
      selectedItem = null;
      scanDrag = null;
      hoverBox.visible = false;
    }
    if (cashPanelFurniture) cashPanelFurniture.visible = next === 'cash';
    // The cash panel replaces the POS kiosk instead of intersecting it. It is
    // the transaction display for this task, directly above the open drawer.
    if (registerFurniture) registerFurniture.visible = next !== 'cash';
    if (cashSortHotspot) cashSortHotspot.visible = next === 'cash';
    if (cashReviewHotspot) cashReviewHotspot.visible = next === 'cash';
    // The live POS already carries scan progress, item rows and totals. Keeping
    // that screen visible mirrors the reference and avoids replacing it with a
    // second oversized instruction board during every scan.
    if (scanPanelFurniture) scanPanelFurniture.visible = false;
    if (cardStatusFurniture) cardStatusFurniture.visible = next === 'card';
    drawCashPanel();
    drawScreen();
  }

  function createCardMesh() {
    if (cardMesh) cardMesh.removeFromParent();
    const base = new THREE.Mesh(
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
    base.position.set(INSERT_READY.x, INSERT_READY.y, INSERT_READY.z);
    base.rotation.set(0, 0, 0);
    base.userData = { pick: true, kind: 'payment-card' };
    root.add(base);
    cardMesh = base;
  }

  function createTender() {
    tenderMeshes.forEach((mesh) => mesh.removeFromParent());
    tenderMeshes = [];
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
      createCardMesh();
      cardPresentationTimer = 0.55;
      cardU = 0;
      insertDrag = null;
      insertSnap = false;
      insertMessage = '';
      cardEjectTimer = 0;
      setWorkspace('card');
      sfx('cardPresent');
    } else {
      if (checkoutFlowState() === 'ChoosingPayment') flowTo('CashPresented', 'customer-presented-cash');
      createTender();
      setWorkspace('cash');
      // The customer hands the cash over; a beat later the register takes it,
      // the drawer opens on its own and the tender is deposited — the player's
      // only cash task is giving change.
      cashAcceptTimer = 1.0;
    }
    drawScreen();
    drawTerm();
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
    createTender();
    setWorkspace('cash');
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

  // CLICK TO BAG. A single click on a counter product rings it up on the POS and
  // drops it into the shopping bag in one gesture — no scanner, no barcode, no
  // drag. This is the whole item interaction the reference asks for.
  function bagProduct(mesh) {
    if (!mesh || !tx || tx.stage !== 'scanning' || scanMotion) return false;
    const item = tx.items.find((candidate) => candidate.uid === mesh.userData.uid);
    if (!item || item.scanned) return false;
    if (checkoutFlowState() === 'WaitingForScan') {
      flowTo('ProductHeld', `picked-product:${item.uid}`);
    }
    if (checkoutFlowState() === 'ProductHeld') {
      flowTo('ProductScanning', `ringing-product:${item.uid}`);
    }
    const result = scanItem(tx, mesh.userData.uid);
    if (!result.ok) {
      toast(result.reason, 'warn');
      sfx('scanInvalid');
      return false;
    }
    item.staged = true;
    if (checkoutFlowState() === 'ProductScanning') {
      flowTo('ProductScanned', `bagged-product:${item.uid}`);
    }
    hoverBox.visible = false;
    hoveredItem = null;
    selectedItem = null;
    sfx('productPickup');
    sfx('scannerActivate');
    sfx('scanSuccess');
    sfx('posAdd');
    // Arc the product up and over into the bag mouth, tumbling as it drops in.
    scanMotion = {
      phase: 'bag',
      mesh,
      elapsed: 0,
      duration: 0.5,
      lift: 0.26,
      from: mesh.position.clone(),
      to: bagMouth.clone(),
      fromQuaternion: mesh.quaternion.clone(),
      toQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, Math.PI * 0.6, 0.4)),
    };
    drawScreen();
    return true;
  }

  function updateScanMotion(dt) {
    if (!scanMotion) return;
    const motion = scanMotion;
    motion.elapsed = Math.min(motion.duration, motion.elapsed + dt);
    const linear = motion.duration > 0 ? motion.elapsed / motion.duration : 1;
    const eased = linear * linear * (3 - 2 * linear);
    motion.mesh.position.lerpVectors(motion.from, motion.to, eased);
    // A parabolic lift so the item rises off the counter and drops into the bag.
    if (motion.lift) motion.mesh.position.y += Math.sin(linear * Math.PI) * motion.lift;
    motion.mesh.quaternion.slerpQuaternions(motion.fromQuaternion, motion.toQuaternion, eased);
    // Shrink into the bag over the final third of the arc.
    if (motion.phase === 'bag' && linear > 0.66) {
      const s = 1 - (linear - 0.66) / 0.34;
      const base = motion.mesh.userData.originalScale;
      if (base) motion.mesh.scale.set(base.x * s, base.y * s, base.z * s);
    }
    if (linear < 1) return;
    scanMotion = null;
    // The product is now in the bag: hide it and count it toward the order.
    motion.mesh.visible = false;
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
    createCardMesh();
    cardU = 0;
    cardPresentationTimer = 0.52;
    insertDrag = null;
    insertSnap = false;
    insertMessage = '';
    cardEjectTimer = 0;
    setWorkspace('card');
    sfx('cardPresent');
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
    drawCashPanel();
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
    tenderMeshes = [];
    selectedTender = null;
    const perDenom = new Map();
    depositedMeshes.forEach((mesh, index) => {
      const denom = Number(mesh.userData.denom);
      const stackIndex = perDenom.get(denom) || 0;
      perDenom.set(denom, stackIndex + 1);
      mesh.userData.from = 'settling';
      queueCashMotion(mesh, drawerSlotPosition(denom, stackIndex * 0.003), {
        delay: index * 0.045,
        duration: 0.36,
        remove: true,
        kind: 'cash-deposit',
        drawerDenom: denom,
        stackOffset: stackIndex * 0.003,
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
    sfx('cashSort');
    drawCashPanel();
    drawScreen();
    return true;
  }

  function selectTenderPiece(mesh) {
    if (!mesh || !ensureCashDrawerStarted() || tx.deposited) return false;
    if (selectedTender && selectedTender.material) {
      const materials = Array.isArray(selectedTender.material) ? selectedTender.material : [selectedTender.material];
      materials.forEach((material) => { if (material && material.emissive) material.emissive.setHex(0x000000); });
    }
    selectedTender = mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (material && material.emissive) {
        material.emissive.setHex(0xb58a42);
        material.emissiveIntensity = 0.5;
      }
    });
    sfx(BILLS.includes(mesh.userData.denom) ? 'billHandle' : 'coinHandle');
    return true;
  }

  function depositSelectedTender(denom) {
    if (!selectedTender || !tx || !tx.drawerOpen || tx.deposited) return false;
    const selectedDenom = selectedTender.userData.denom;
    if (Number(selectedDenom) !== Number(denom)) {
      toast(`That is ${moneyLabel(selectedDenom)}. Choose its matching compartment.`, 'warn');
      sfx('thunk');
      return false;
    }
    const deposited = depositPiece(tx, drawer, denom);
    if (!deposited.ok) {
      toast(deposited.reason, 'warn');
      return false;
    }
    const settling = selectedTender;
    const denomIndex = cashMotions.filter((motion) => (
      motion.kind === 'cash-deposit' && Number(motion.drawerDenom) === Number(denom)
    )).length;
    tenderMeshes = tenderMeshes.filter((mesh) => mesh !== settling);
    selectedTender = null;
    settling.userData.from = 'settling';
    queueCashMotion(settling, drawerSlotPosition(denom, denomIndex * 0.003), {
      duration: 0.34,
      remove: true,
      kind: 'cash-deposit',
      drawerDenom: Number(denom),
      stackOffset: denomIndex * 0.003,
    });
    cashMotionRefillPending = true;
    sfx(BILLS.includes(denom) ? 'billHandle' : 'coinHandle');
    if (deposited.deposited && checkoutFlowState() === 'DepositingCash') {
      flowTo('SelectingChange', 'all-received-cash-snapped-into-slots');
    }
    drawCashPanel();
    drawScreen();
    return true;
  }

  function selectChangeFromSlot(denom) {
    if (!tx || !tx.drawerOpen || !tx.deposited) return false;
    const result = takeFromDrawer(tx, drawer, denom);
    if (!result.ok) {
      toast(result.reason, 'warn');
      sfx('thunk');
      return false;
    }
    const mesh = makeMoney(denom, 'change');
    root.add(mesh);
    selectedChangeMeshes.push(mesh);
    layoutSelectedChange();
    refillDrawerMoney();
    sfx('changeSelect');
    drawCashPanel();
    drawScreen();
    return true;
  }

  function returnSelectedChange(mesh) {
    if (!mesh || !tx || mesh.userData.from !== 'change') return false;
    const result = returnToDrawer(tx, drawer, mesh.userData.denom);
    if (!result.ok) return false;
    mesh.removeFromParent();
    selectedChangeMeshes = selectedChangeMeshes.filter((candidate) => candidate !== mesh);
    layoutSelectedChange();
    refillDrawerMoney();
    drawCashPanel();
    drawScreen();
    sfx(BILLS.includes(mesh.userData.denom) ? 'billHandle' : 'coinHandle');
    return true;
  }

  function reviewCashOnMonitor() {
    if (!tx || tx.method !== 'cash') return false;
    setWorkspace('monitor');
    activeTab = 'checkout';
    drawScreen();
    return true;
  }

  function confirmChange() {
    if (!tx || tx.stage !== 'cash-drawer' || !tx.deposited) return false;
    const delta = Math.round((handTotal(tx) - changeDue(tx)) * 100);
    if (delta !== 0) {
      toast(delta > 0 ? 'Too much change is selected.' : 'Not enough change is selected.', 'warn');
      sfx('thunk');
      return false;
    }
    if (checkoutFlowState() === 'SelectingChange') {
      flowTo('GivingChange', 'player-confirmed-monitor-change-total');
    }
    const handed = handOverChange(tx, drawer);
    if (!handed.ok) {
      toast(handed.reason, 'warn');
      return false;
    }
    selectedChangeMeshes.forEach((mesh) => mesh.removeFromParent());
    selectedChangeMeshes = [];
    if (checkoutFlowState() === 'GivingChange') {
      flowTo('PaymentComplete', 'change-slid-to-customer-without-hands');
    }
    sfx('changeHandoff');
    setWorkspace('monitor');
    drawCashPanel();
    beginAutomaticReceipt();
    return true;
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
    if (!receiptMesh) {
      const paperTexture = textTexture('PINEHOLLOW', {
        width: 256,
        height: 512,
        background: '#f8f5eb',
        foreground: '#28322c',
        accent: '#c9c1aa',
        subline: tx.method === 'cash' ? `CASH  $${dueOf(tx).toFixed(2)}` : `CARD  $${dueOf(tx).toFixed(2)}`,
      });
      receiptMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.09, 0.19),
        new THREE.MeshBasicMaterial({ map: paperTexture, side: THREE.DoubleSide, toneMapped: false }),
      );
      receiptMesh.position.set(REGISTER.printer.x, COUNTER_TOP + 0.09, REGISTER.printer.z + 0.03);
      receiptMesh.rotation.x = -Math.PI / 2 + 0.15;
      receiptMesh.scale.y = 0.04;
      root.add(receiptMesh);
    }
    receiptTimer = RECEIPT_TIME;
    setWorkspace('monitor');
    sfx('receiptPrint');
    drawScreen();
    return true;
  }

  function finishAutomaticFulfillment() {
    if (!tx || tx.stage !== 'receipt' || autoFulfilled) return false;
    if (!tx.receiptPrinted) {
      const printed = printReceipt(tx);
      if (!printed.ok) return false;
    }
    const taken = takeReceipt(tx);
    if (!taken.ok) {
      toast(taken.reason, 'warn');
      return false;
    }
    if (checkoutFlowState() === 'ReceiptPrinting') {
      flowTo('Bagging', 'receipt-auto-filed-no-player-pickup');
    }
    const packed = packReceipt(tx);
    if (!packed.ok) {
      toast(packed.reason, 'warn');
      return false;
    }
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
    autoFulfilled = true;
    // Bank the sale and release the customer automatically after a short beat.
    finalizeTimer = 0.75;
    sfx('receiptTear');
    sfx('posReady');
    drawScreen();
    return true;
  }

  function finalizeTransaction() {
    if (!tx || tx.stage !== 'done') {
      toast('Finish payment before finalizing.', 'warn');
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
    if (checkoutFlowState() === 'Bagging') {
      flowTo('BagHandoff', 'automatic-fulfillment-ready-at-finalize');
    }
    if (checkoutFlowState() === 'BagHandoff') {
      flowTo('CustomerLeaving', 'player-pressed-finalize-transaction');
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
    if (finishedTx.method === 'cash') sfx('drawerClose');
    sfx('checkoutComplete');
    clearPhysicalTransaction();
    if (finishedCustomer) finishedCustomer.tx = null;
    tx = null;
    cust = null;
    transactionKind = 'retail';
    selectedReservationId = null;
    activeTab = 'checkout';
    workspace = 'monitor';
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
      const result = sortReceivedCash();
      if (result) setWorkspace('cash');
      return result;
    }
    if (action === 'confirm-change') return confirmChange();
    if (action === 'finalize-transaction') return finalizeTransaction();
    return false;
  }

  function physicalPick(event) {
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    const candidates = workspace === 'scan'
      ? loose
      : workspace === 'cash'
        ? [
          ...tenderMeshes,
          ...selectedChangeMeshes,
          ...slotHotspots,
          cashSortHotspot,
          cashReviewHotspot,
        ].filter(Boolean)
        : [];
    const hits = ray.intersectObjects(candidates, true);
    if (!hits.length) return null;
    let object = hits[0].object;
    while (object && !object.userData.pick && object.parent) object = object.parent;
    return object && object.userData.pick ? object : null;
  }

  function handleCashPick(object) {
    if (!object) return false;
    const kind = object.userData.kind;
    if (kind === 'cash-sort') return sortReceivedCash();
    if (kind === 'cash-review') return reviewCashOnMonitor();
    if (kind === 'money' && object.userData.from === 'tender') {
      return selectTenderPiece(object);
    }
    if (kind === 'money' && object.userData.from === 'change') {
      return returnSelectedChange(object);
    }
    if (kind === 'drawer-slot') {
      if (selectedTender) return depositSelectedTender(object.userData.denom);
      if (tx && tx.deposited) return selectChangeFromSlot(object.userData.denom);
      toast('Select a received bill or coin first.', 'warn');
      return true;
    }
    return false;
  }

  function onDown(event) {
    if (!active) return false;
    if (event.button === 2) {
      leave();
      return true;
    }
    if (event.button !== 0) return true;
    if (workspace === 'monitor') {
      const action = monitorActionAt(event);
      if (action) {
        sfx('uiTick');
        handleMonitorAction(action);
      }
      return true;
    }
    if (workspace === 'card') {
      if (tx && tx.stage === 'card-entry') handleCardKeypadAt(event);
      else startInsert(event);
      return true;
    }
    if (workspace === 'scan') {
      const object = physicalPick(event);
      if (object && object.userData.kind === 'item') bagProduct(object);
      return true;
    }
    if (workspace === 'cash') {
      const object = physicalPick(event);
      handleCashPick(object);
      return true;
    }
    return true;
  }

  function onMove(event) {
    if (!active) return false;
    if (workspace === 'card' && insertDrag) {
      feedInsert(event);
      return true;
    }
    if (workspace === 'scan' && !scanMotion) {
      const object = physicalPick(event);
      hoveredItem = object && object.userData.kind === 'item'
        && tx && !tx.items.find((item) => item.uid === object.userData.uid)?.scanned
        ? object
        : null;
      hoverBox.visible = !!hoveredItem;
      if (hoveredItem) hoverBounds.setFromObject(hoveredItem);
    }
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
      else if (key === 'Backspace') {
        backspaceCardAmount(tx);
        sfx('uiTick');
        drawTerm();
        drawScreen();
      } else if (key === 'Delete') applyCardKey('CLEAR');
      else if (key === 'Enter') applyCardKey('OK');
      return true;
    }
    if ((key === 's' || key === 'S') && tx && tx.method === 'cash') {
      sortReceivedCash();
      return true;
    }
    if ((key === 'Enter' || key === ' ') && tx && tx.stage === 'cash-drawer' && tx.deposited) {
      reviewCashOnMonitor();
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

  // The customer hands the card and it enters the chip slot on its own — no
  // click, no push, no graded gesture. The player's only card action is typing
  // the total on the keypad; authorization then always approves (see runCard
  // force below). startInsert/endInsert remain as a harmless manual fallback.
  function autoInsertCard() {
    if (!tx || tx.stage !== 'card-ready' || insertSnap || cardU >= 1) return;
    insertSnap = true;
    insertMessage = 'INSERTING';
    if (checkoutFlowState() === 'CardInsertReady') {
      flowTo('CardInserting', 'card-auto-inserted-no-gesture');
    }
    sfx('cardInsert');
  }

  function updateCard(dt) {
    if (!tx || tx.method !== 'card') return;
    if (cardPresentationTimer > 0) {
      cardPresentationTimer = Math.max(0, cardPresentationTimer - dt);
      const progress = 1 - cardPresentationTimer / 0.55;
      if (cardMesh) {
        const start = new THREE.Vector3(
          CARD_STATION.x - 0.24,
          COUNTER_TOP + 0.22,
          CARD_STATION.z - 0.26,
        );
        const end = new THREE.Vector3(INSERT_READY.x, INSERT_READY.y, INSERT_READY.z);
        const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
        cardMesh.position.lerpVectors(start, end, eased);
        cardMesh.rotation.set(0, 0, 0);
      }
      if (cardPresentationTimer === 0 && tx.stage === 'card-present') {
        const presented = presentCard(tx);
        if (presented.ok) {
          if (checkoutFlowState() === 'CardPresented') {
            flowTo('CardInsertReady', 'card-auto-aligned-at-chip-slot');
          }
          autoInsertCard();
        }
        sfx('cardTap');
        drawTerm();
        drawScreen();
      } else if (cardPresentationTimer === 0 && tx.stage === 'card-ready'
          && !insertSnap && cardU < 1) {
        if (checkoutFlowState() === 'CardPresented') {
          flowTo('CardInsertReady', 'replacement-card-auto-aligned');
        }
        autoInsertCard();
      }
    }

    if (insertSnap && tx.stage === 'card-ready') {
      cardU = Math.min(1, cardU + dt * 3.4);
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
      cardMesh.position.set(
        THREE.MathUtils.lerp(INSERT_READY.x, INSERTED.x, cardU),
        THREE.MathUtils.lerp(INSERT_READY.y, INSERTED.y, cardU),
        THREE.MathUtils.lerp(INSERT_READY.z, INSERTED.z, cardU),
      );
      cardMesh.rotation.set(0, 0, 0);
    }

    if (tx.stage === 'card-busy') {
      cardProcessingTimer = Math.max(0, cardProcessingTimer - dt);
      if (cardProcessingTimer === 0) {
        // Gameplay never declines: the card always approves once the correct
        // total has been keyed. The rng decline path stays covered by
        // register-payment.test.js via un-forced runCard.
        const result = runCard(tx, { force: 'approved' });
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
      if (cardResultTimer === 0) {
        setWorkspace('monitor');
        if (tx && tx.stage === 'receipt') beginAutomaticReceipt();
      }
    }
  }

  function updateReceipt(dt) {
    if (!tx || tx.stage !== 'receipt') return;
    // Keep ACCEPTED readable on the physical card terminal before returning to
    // the monitor and starting the automatic printer sequence.
    if (cardResultTimer > 0) return;
    if (!receiptTimer && !autoFulfilled) beginAutomaticReceipt();
    if (receiptTimer <= 0) return;
    receiptTimer = Math.max(0, receiptTimer - dt);
    const progress = 1 - receiptTimer / RECEIPT_TIME;
    if (printerRoll) printerRoll.rotation.x += dt * 10;
    if (receiptMesh) {
      const eased = 1 - Math.pow(1 - progress, 3);
      receiptMesh.scale.y = Math.max(0.04, eased);
      receiptMesh.position.y = COUNTER_TOP + 0.09 + eased * 0.045;
      receiptMesh.position.z = REGISTER.printer.z + 0.03 + eased * 0.12;
    }
    if (receiptTimer === 0) finishAutomaticFulfillment();
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
      motion.elapsed = Math.min(motion.duration, motion.elapsed + dt);
      const linear = motion.duration > 0 ? motion.elapsed / motion.duration : 1;
      const eased = linear * linear * (3 - 2 * linear);
      motion.mesh.position.lerpVectors(motion.from, motion.to, eased);
      motion.mesh.quaternion.slerpQuaternions(motion.fromQuaternion, motion.toQuaternion, eased);
      if (linear < 1) continue;
      if (motion.remove) motion.mesh.removeFromParent();
      else if (motion.enablePick) motion.mesh.userData.pick = true;
      cashMotions.splice(index, 1);
    }
    if (cashMotionRefillPending
        && !cashMotions.some((motion) => motion.kind === 'cash-deposit')) {
      cashMotionRefillPending = false;
      refillDrawerMoney();
    }
  }

  function updateDrawer(dt) {
    if (!drawerMotionRoot) return;
    if (Math.abs(drawerAmount - drawerWant) > 0.001) {
      const speed = drawerWant > drawerAmount ? 3.2 : 2.4;
      drawerAmount += Math.sign(drawerWant - drawerAmount)
        * Math.min(Math.abs(drawerWant - drawerAmount), dt * speed);
      drawerMotionRoot.position.z = drawerAmount * REGISTER.drawer.travel;
      if (drawerAssetSlide) {
        drawerAssetSlide.position.z = drawerAssetSlideBaseZ + drawerAmount * REGISTER.drawer.travel;
      }
    }
    if (checkoutFlowState() === 'DrawerOpening' && drawerAmount >= 0.98) {
      flowTo('DepositingCash', 'cash-drawer-reached-open-stop');
    }
    if (checkoutFlowState() === 'DepositingCash' && tx && tx.deposited) {
      flowTo('SelectingChange', 'all-received-cash-secured');
    }
  }

  function updateCamera(dt) {
    if (!active) return;
    cameraTarget = POSES[workspace] || POSES.monitor;
    if (!cameraPose) cameraPose = { ...cameraTarget };
    easePose(cameraPose, cameraTarget, Math.min(1, dt / 0.22));
    focusOn(cameraPose);
    const targetFov = workspace === 'monitor'
      ? MONITOR_FOV
      : workspace === 'card' ? CARD_FOV
        : workspace === 'cash' ? CASH_FOV
          : SCAN_FOV;
    const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt / 0.20));
    if (Math.abs(nextFov - camera.fov) > 0.001) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  }

  function update(dt) {
    if (enterTimer > 0) {
      enterTimer = Math.max(0, enterTimer - dt);
      if (enterTimer === 0 && checkoutFlowState() === 'EnteringCashierMode') {
        flowTo('WaitingForScan', 'monitor-camera-and-pointer-ready');
      }
    }
    updateScanMotion(dt);
    if (scanReturnTimer > 0) {
      scanReturnTimer = Math.max(0, scanReturnTimer - dt);
      if (scanReturnTimer === 0) setWorkspace('monitor');
    }
    if (active && paymentAutoTimer > 0 && workspace === 'monitor'
        && tx && tx.stage === 'scanning' && unscannedCount(tx) === 0) {
      paymentAutoTimer = Math.max(0, paymentAutoTimer - dt);
      if (paymentAutoTimer === 0) choosePayment(preferredPayment());
    }
    // The register accepts the handed-over cash on its own: open the drawer and
    // deposit the tender so the only remaining cash task is giving change.
    if (cashAcceptTimer > 0 && tx && tx.method === 'cash' && !tx.deposited
        && (tx.stage === 'cash-tender' || tx.stage === 'cash-drawer')) {
      cashAcceptTimer = Math.max(0, cashAcceptTimer - dt);
      if (cashAcceptTimer === 0) sortReceivedCash();
    }
    // Once the bag is filled and the receipt is in, the sale banks itself and the
    // customer leaves — no separate "finalize" click.
    if (finalizeTimer > 0 && tx && tx.stage === 'done' && autoFulfilled) {
      finalizeTimer = Math.max(0, finalizeTimer - dt);
      if (finalizeTimer === 0) finalizeTransaction();
    }
    updateCard(dt);
    updateDrawer(dt);
    updateCashMotions(dt);
    updateReceipt(dt);
    updateCamera(dt);
  }

  function hint() {
    if (workspace === 'monitor') {
      return { text: 'Use the front-desk monitor. Right-click or Escape exits safely.', total: false, drawer: false };
    }
    if (workspace === 'scan') {
      return {
        text: 'Click each item to drop it in the bag',
        total: false,
        drawer: false,
      };
    }
    if (workspace === 'card') {
      return { text: tx && tx.stage === 'card-ready' ? 'Click the card and push it into the chip slot' : checkoutStatus(), total: false, drawer: false };
    }
    if (workspace === 'cash') {
      return { text: 'Click cash, then its matching labeled drawer compartment. S auto-sorts.', total: false, drawer: true };
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
      (point.x / SCREEN_W - 0.5) * 0.36,
      (0.5 - point.y / SCREEN_H) * 0.225,
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

  function cardKeyScreenPoint(label) {
    if (!cardStatusPlane) return null;
    let rowIndex = -1;
    let colIndex = -1;
    CARD_KEY_LABELS.forEach((labels, index) => {
      const col = labels.indexOf(String(label));
      if (col >= 0) {
        rowIndex = index;
        colIndex = col;
      }
    });
    if (rowIndex < 0) return null;
    const keyW = 92;
    const keyH = 66;
    const gap = 12;
    const canvasX = 42 + colIndex * (keyW + gap) + keyW / 2;
    const canvasY = 276 + rowIndex * (keyH + gap) + keyH / 2;
    const world = new THREE.Vector3(
      (canvasX / termCanvas.width - 0.5) * CARD_PANEL_W,
      (0.5 - canvasY / termCanvas.height) * CARD_PANEL_H,
      0.01,
    );
    cardStatusPlane.localToWorld(world);
    world.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }

  buildDrawer();
  buildBag();
  drawScreen();
  drawTerm();

  return {
    simplified: true,
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
    hint,
    insertAt: () => ({
      ready: { ...INSERT_READY },
      inserted: { ...INSERTED },
      u: cardU,
      ejecting: cardEjectTimer > 0,
    }),
    monitorActionPoint,
    monitorScreenPoint,
    cardKeyScreenPoint,
    monitorHotspots: () => monitorUi.hotspots(),
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
