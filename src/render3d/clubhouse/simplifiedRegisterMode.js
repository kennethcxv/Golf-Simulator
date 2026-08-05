// SIMPLIFIED FRONT DESK REGISTER
//
// The transaction engine in sim/register.js remains the sole authority for scans,
// payment, drawer balancing, receipts, fulfillment, and exact-once banking. This
// module only presents those verbs through a readable shared monitor and a few
// forgiving physical interactions. Checkout props animate directly; detached
// first-person cashier hands are intentionally suppressed to match the supplied
// simulator reference and keep the shared counter readable.

import * as THREE from 'three';
import {
  FRONT_DESK_FRAME, REGISTER, COUNTER, COUNTER_TOP,
  frontDeskLocalPoint, frontDeskPoint, frontDeskVector, queueSlot,
} from '../../data/shopLayout.js';
import { skuById } from '../../data/shopItems.js';
import {
  BILLS, DENOMS, createTx, retailTransactionId, scanItem, bagScannedItem, unscannedCount, requestPayment,
  subtotal, discountOf, totalOf, dueOf, cashTotalOf,
  presentCard, insertCard, cardEnteredAmount, enterCardDigit, backspaceCardAmount,
  clearCardAmount, submitCardAmount,
  runCard, retryCard, cancelCard, abandonCardBeforeSubmit, payCashInstead,
  recoverUnresolvedCardAuthorization, recoverCashAcceptedCheckpoint,
  customerCash, acceptCash, openDrawer, depositTendered,
  depositPiece, takeFromDrawer, returnToDrawer, changeDue, handTotal,
  handOverChange, changeGivingState, MAX_EXTRA_CHANGE_CENTS,
  printReceipt, takeReceipt, packReceipt, bagItem, allBagged,
  handOverGoods, completeSale, voidTx, newDrawer, migrateDrawer, drawerContents,
  stackTotal, makeChange, makeChangeFrom, segmentHitsBox, netOf, taxOf,
} from '../../sim/register.js';
import { salesTaxRate, taxJurisdictionLabel } from '../../sim/salesTax.js';
import {
  createCheckoutFlow, transitionCheckout, checkoutStateTimedOut,
  recoverTimedOutCheckout, resumeCheckout, abandonCheckoutRecovery,
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
  changeBundleLayout, changeHandoffPoint, customerCardPoint,
  presentedTenderLayout, selectedChangeLayout as physicalChangeLayout,
} from './checkoutPaymentPresentation.js';
import { makeCashierHands } from './cashierHands.js';
import { createFrontDeskMonitorUi } from './frontDeskMonitorUi.js';
import {
  billFit, billLayout, clipFillRatio, coinLayout,
} from './drawerMoneyLayout.js';

import { createScopedBooleanOverride } from './scopedBooleanOverride.js';
import { suppressInteriorSunShadows } from './interiorShadowPolicy.js';

const SCREEN_W = 1024;
const SCREEN_H = 640;
// the live POS canvas plane hung on the kit monitor's POS_Screen face
const POS_PLANE_W = 0.34;
const POS_PLANE_H = 0.2125;
// The checkout-kit exports are compact desktop props.  Present them at the
// dimensions of a full-size retail touchscreen and countertop pin pad so the
// two devices carry the same visual weight as the supplied composition.
// Round 7: "make the screen a little bigger … so it's more visible" — 1.55
// with the monitor pulled toward frame centre (REGISTER.monitor) keeps every
// pixel of the glass inside the working frame.
const POS_HARDWARE_SCALE = 1.55;
const TERMINAL_HARDWARE_SCALE = 1.85;
// the live terminal canvas hung on the kit reader's Terminal_Screen face
const TERM_SCREEN_W = 0.070;
const TERM_SCREEN_H = 0.064;
const TERM_CANVAS_W = 512;
const TERM_CANVAS_H = 468;
export const TERMINAL_BUSY_DOT_HZ = 3;
export const CHECKOUT_DISPLAY_BRAND_PRESENTATION = Object.freeze({
  defaultClubName: 'Pine Hills Municipal Golf',
  // A STAMP, not a wrapper. At 0.268 x 0.285 the panel covered 89% of the
  // carrier's printed face edge to edge, and once the bag was laid flat that
  // full-bleed bordered rectangle read as a printed carton lid (playtest round
  // 5, 2026-07-30). Shrunk and moved back toward the closed base it reads as
  // shop branding screened onto kraft paper, with bare paper around it and the
  // rope handle clear of it.
  bagPanel: Object.freeze({ width: 0.176, height: 0.118, y: 0.150, z: 0.108 }),
  legacyNodes: Object.freeze({
    // NOT 'Bag_Body_2'. On the kit carrier that name is not a decal — it is the
    // loader's second primitive of Bag_Body, i.e. the PRINTED FRONT PANEL'S OWN
    // GEOMETRY. Hiding it punched a hole clean through the front of the bag and
    // left the dark liner showing through; the full-bleed dynamic panel used to
    // cover the hole, so nobody saw it while the bag stood upright with its face
    // to the customer. Laid flat that hole points at the ceiling, and a paper
    // bag you can see straight into is the "reads as a fallen box / open carton"
    // report (playtest round 5, 2026-07-30). The authored club marks on that
    // panel are a TEXTURE, and applyKraftBagStyle already drops every map it
    // finds — so the old branding goes and the paper stays.
    shoppingBag: Object.freeze([
      'PinehollowBadge',
      'PinehollowWordmark',
    ]),
    paymentTerminal: Object.freeze(['t_brand']),
  }),
});
const DEFAULT_DISPLAY_BRAND = CHECKOUT_DISPLAY_BRAND_PRESENTATION.defaultClubName;

export function checkoutDisplayClubName(state) {
  const value = String(state?.clubName || '').trim();
  return value || DEFAULT_DISPLAY_BRAND;
}

function setFittedCanvasFont(ctx, value, {
  maxWidth,
  startSize,
  minimumSize = 16,
  weight = 700,
  family = 'Arial, sans-serif',
} = {}) {
  let size = startSize;
  do {
    ctx.font = `${weight} ${Math.round(size)}px ${family}`;
    if (ctx.measureText(String(value)).width <= maxWidth || size <= minimumSize) break;
    size -= 2;
  } while (size > minimumSize);
  return size;
}

export function checkoutDisplayBrandLines(value) {
  const words = String(value || DEFAULT_DISPLAY_BRAND).trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return [words.join(' ')];
  let bestIndex = 1;
  let bestDelta = Infinity;
  for (let index = 1; index < words.length; index += 1) {
    const delta = Math.abs(words.slice(0, index).join(' ').length - words.slice(index).join(' ').length);
    if (delta < bestDelta) {
      bestIndex = index;
      bestDelta = delta;
    }
  }
  return [words.slice(0, bestIndex).join(' '), words.slice(bestIndex).join(' ')];
}

// The authored checkout kit predates Pine Hills' canonical public identity.
// Suppress only named presentation meshes; sockets, collision, geometry and
// every transaction-bearing object remain untouched.
export function suppressLegacyCheckoutBrandNodes(root, surface) {
  const names = new Set(CHECKOUT_DISPLAY_BRAND_PRESENTATION.legacyNodes[surface] || []);
  if (!root?.traverse || names.size === 0) return [];
  const suppressed = [];
  root.traverse((object) => {
    if (!names.has(object.name)) return;
    object.visible = false;
    object.userData = {
      ...object.userData,
      suppressedPlayerFacingLegacyBrand: true,
    };
    suppressed.push(object.name);
  });
  return suppressed;
}

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
// The keypad the screen used to draw is gone (2026-07-29): presses land on the
// GLB's Terminal_Key_* meshes, mapped in collectTerminalKeys below. Only the
// cancel-the-run X remains a screen element (TERM_X_BOX above) — it is a screen
// affordance, not a key.
const REST_Y = COUNTER_TOP + 0.012;
const CARRY_Y = COUNTER_TOP + 0.115;
const BAG_REACH = 0.34;
const SLIDE_DURATION = 0.55; // click-to-bag slide (2026-07-30 round 2)
// THE DEVICE BAY. Round 7, from the 2026-07-31 TCG screenshot: the counter's
// staff-facing front edge carries a dark-framed niche with a BRIGHT WHITE
// glowing back panel, and the card reader (plus a small pin pad) stands
// propped inside it. The reader used to hide 0.46 under the counter between
// card sales; now it PARKS in this bay, visible, exactly like the reference —
// "add a space in the desk for the card reader to be placed on."
export const CHECKOUT_TERMINAL_BAY = Object.freeze({
  // Left of the card station so the tray's right rail clears the drawer's
  // slide (drawer front spans local x 0.29..0.75).
  localX: -0.04,
  width: 0.56,
  height: 0.21,
  // Depth of the alcove. Round 8: 0.115 was too shallow for anything to LEAN
  // in — a device pitched back by seatPitch tipped its head straight through
  // the lit back panel, which is half of what "phasing through" was. Measured
  // in the bay's own frame, the parked reader sweeps 0.153 of depth, so 0.19
  // is what actually contains it with a margin at both ends.
  reach: 0.19,
  // High under the lip, so the tray's upper half and the parked devices'
  // heads read from the low round-6 working eye (the first seat at 0.145
  // fell almost entirely below the frame's bottom edge).
  belowTop: 0.115,
  // A SHALLOW lean. Measured 2026-08-02 in the bay's own frame: at -0.5 rad
  // the parked reader swept 0.161 of depth in a 0.15 alcove and its face hung
  // 0.023 proud of the opening. -0.32 stands it nearer upright — the way a
  // terminal actually sits in a shelf — and brings the whole device inside.
  seatPitch: -0.32,
  // The working-size reader is 0.405 tall — parked at full size its head
  // towered out of the tray and read as a loose slab on the counter. A real
  // terminal is pocket-sized at rest; it parks at this fraction of working
  // scale and the float grows it back to full size at the face. 0.42 is the
  // largest that still fits the opening AND the lean without clipping.
  parkScale: 0.42,
  // Where the parked reader's base stands, as a fraction of reach: far enough
  // forward that leaning back keeps its head clear of the panel.
  seatDepthFrac: 0.55,
  pinPadOffsetX: 0.17,   // the second small device beside the reader
});
const CARD_TIME = 1.15;
// No receipt timers: round 7 removed the receipt presentation outright. The
// sim still prints/files its durable record inside beginAutomaticReceipt, but
// no paper exists, so payment flows straight into the bag delivery.
const BAG_DELIVER_TIME = 0.78;
// C4 — daylight between the carrier and the slab while it is still over it.
// Small on purpose: the point is that it does not intersect, not that it flies.
const BAG_COUNTER_CLEARANCE = 0.02;
const BAG_CUSTOMER_HOLD = 1.25;
const CARD_INSERT_TIME = 0.72;
const AUTO_PAYMENT_HOLD = 0.38;

// The active register owns these automatic presentation/authorization states.
// Deliberate player waits are intentionally absent; customer approach, placement,
// and patience are owned by clubhouse.js before the register transaction begins.
export const SIMPLIFIED_REGISTER_WATCHDOG_STATES = Object.freeze([
  'EnteringCashierMode',
  'ProductHeld', 'ProductScanning', 'ProductScanned',
  'AllProductsScanned', 'ChoosingPayment',
  // CardInsertReady is deliberately absent: it waits for the player to click
  // the offered card, so it carries no contract timeout to watch (2026-08-03).
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
// BIGGER THAN LIFE SIZE, ON PURPOSE (C12, 2026-08-04).
//
// Three sizes now. 0.78 was chosen in round 5 when the counter was busier and
// the working frame sat further back. 1.00 followed the 2026-08-03 playtest
// ("the bag reads small and plain next to everything else on the counter now")
// on the reasoning that the kit's carrier is already a believable 0.26 x 0.30.
// It still read small: "You took it to life size last session and it still
// reads small on that counter. Go bigger than life size — it is a presentation
// object, not a measurement."
//
// So it was tied to the reader (TERMINAL_HARDWARE_SCALE, 1.85) — and K1
// (2026-08-05) untied it: "Make the bag smaller than it is now. Larger than
// the original. Judge it against the monitor and the reader." At 1.85 the
// laid carrier covered 20% of the working frame — 1.7x the POS glass and
// 2.3x the floating reader (measured, tools/qa/bag-presentation-shots.js).
// 1.35 sits between the two devices' own draw scales (POS 1.55, reader 1.85
// at the face), keeps the bag above life size (1.00) and far above round 5's
// 0.78, and in the frame it now reads as the largest PROP while both DEVICES
// out-present it.
//
// The lift below is DERIVED from this and the flatten factor rather than
// baked, which is what made the previous size change land the flank through
// the counter top.
const BAG_PRESENTATION_SCALE = 1.35;
const BAG_PRESENTATION_FLATTEN = 0.55;
export const CHECKOUT_BAG_PRESENTATION = Object.freeze({
  // FLAT, LONG, AND OPEN TOWARD THE COUNTER SPACE. Playtest round 5
  // (2026-07-30): "look at how the bag is laid flat and it's long, opened, and
  // small height. Then notice the space to the right of that to add the items."
  // Every reference (154454 / 154525 / 154641 and the 2026-07-30 counter shot)
  // has the kraft carrier ON ITS FACE at counter-left: long axis running down
  // the counter, only its 0.18 gusset depth off the surface, and the MOUTH
  // aimed right at the bare stretch where scanned goods land.
  //
  // The rotation is read as axes, not as a guessed euler. Euler(-PI/2, 0,
  // -PI/2) maps the bag's local +Y (its mouth) onto desk +X, its local +Z (the
  // printed front panel and the rope handle) onto world UP, and its local +X
  // (width) onto desk +Z, toward the cashier. That is the reference exactly:
  // one broad printed face up with the handle arcing across it, the closed base
  // at the far left, the open mouth pointing down-counter to the right.
  //
  // An earlier round tried this and a playtest called it "a fallen box". Two
  // things caused that and both are answered here: the flank SANK THROUGH the
  // counter (the model's origin is its base, so half the laid bag fell below
  // y=0 — counterLift now carries the real half-thickness), and the interior
  // was painted the same kraft as the outside, so the mouth read as a flat
  // seam rather than a cavity (applyKraftBagStyle now darkens the liner).
  // What must read is the OPENING.
  pitch: -Math.PI / 2,
  roll: -Math.PI / 2,
  scale: BAG_PRESENTATION_SCALE,
  // "SMALL HEIGHT". The authored carrier is a 0.18 deep standing bag; laid on
  // its face that is 56% of its own length off the counter, which is a carton's
  // proportion, not a paper bag's. Every reference bag is squashed to about a
  // quarter of its length — the gusset collapses when you lay a bag down. The
  // model's own depth axis is flattened by this factor inside the group, so the
  // group keeps a uniform scale and every authored anchor (mouth, contents,
  // handoff — all on the depth-free centre line) stays exactly where it was.
  flatten: BAG_PRESENTATION_FLATTEN,
  // Half the flattened gusset depth at the counter scale, plus a paper-thin
  // seat, so the laid flank rests ON the top instead of through it — the sink
  // the previous side-lying attempt was rejected for.
  //
  // 0.116, not the 0.101 that was here. Solved from the round-5 bag test's own
  // reading when the size changed: at 0.78 the flank already sat 3.4 mm below
  // the top and only passed on the 4 mm tolerance, and at life size the same
  // half-depth put it 5.3 mm under. min.y = COUNTER_TOP + lift - h*flatten*scale
  // with the measured min.y gives h = 0.116, which seats it 3 mm proud at any
  // scale instead of hiding an error inside a tolerance.
  counterLift: 0.116 * BAG_PRESENTATION_FLATTEN * BAG_PRESENTATION_SCALE + 0.003,
  // A rung-up item lands flat in the mouth; the bag's own roll must not tip it.
  itemRoll: 0,
});
// THE CASHIER'S OWN EYE LINE. Playtest round 5 (2026-07-30) reported the derived
// working frame as a "10ft tall cashier" bird's-eye. Measured, it had solved its
// way to 1.99 above the staff floor, because nothing pinned the height: the
// framing solver was free to buy any fit by floating up.
//
// The honest number is not a taste call. This game already knows how tall a
// person is — the walking player's eye rides 1.62 above whatever ground they
// stand on (courseScene's walk camera; broomViewmodel measures the floor as
// camera.y - 1.62). A cashier IS the player, standing behind the counter, so the
// working frame simply uses that same eye. Interior-local absolute y, the frame
// COUNTER_TOP (1.055) and the interior floor (0.3) live in.
export const CHECKOUT_STAFF_FLOOR_Y = 0.30;
export const CHECKOUT_STANDING_EYE_ABOVE_FLOOR = 1.62;
// ROUND 6: pinning the eye to the FLOOR was right in principle and wrong in
// this room. A standing eye 1.62 above the floor sits 0.865 above THIS counter,
// because the desk's top is only 0.755 off the staff floor — around 0.69 m,
// where a real shop counter is 0.90-1.00 m. So the eye ends up proportionally
// far higher above the work surface than a real cashier's (0.87x the counter's
// own height above it, against roughly 0.74x in life), and looking down from
// there turns the desk into a slab. The play-test read that as "still too high
// up" even though the height was physically honest.
//
// The composition constraint is the eye's height above the WORK, so that is
// what is authored. Raising the desk itself would be the deeper fix and would
// ripple through every fixture, collider and reach on it.
export const CHECKOUT_EYE_ABOVE_COUNTER = 0.56;
export const CHECKOUT_WORKING_EYE_Y = COUNTER_TOP + CHECKOUT_EYE_ABOVE_COUNTER;
// A standing adult's shoulder and hands above their own feet. The working frame
// holds the customer only to their HANDS, so the head crops off the top exactly
// as it does in Designs/CashRegister/Final and the 2026-07-30 counter shot; the
// shoulder height is what the round-5 pose test measures that crop against.
export const CHECKOUT_CUSTOMER_SHOULDER_Y = 1.34;
export const CHECKOUT_CUSTOMER_HANDS_Y = 0.95;
// The working lens. 48.5 was a lens that could only fit this counter's ~2 yd of
// kit from a yard and a half back, and from a yard and a half back a standing
// eye sees the counter's own front apron across the bottom third instead of the
// counter TOP. Widening to 54 buys the standoff the reference composition needs
// while keeping short-lens distortion off the POS glass.
export const CHECKOUT_WORKING_FOV = 54;
export const CHECKOUT_WORKING_GLANCE_SCALE = 0.34;
// THE DRAWER VIEW BARELY LEANS. Counting change means the cursor travels the
// whole width of the till, and at full lean that swung the POS cash summary —
// which the reference keeps directly ABOVE the drawer (154525 / 154641) — off
// the top of the frame exactly while the player needs to read Giving. A third
// of the lean is enough to glance at the pile without losing the panel.
export const CHECKOUT_CASH_GLANCE_SCALE = 0.3;

export function checkoutLookScale(workspaceName, shiftKey = false) {
  if (workspaceName === 'scan' || workspaceName === 'monitor') {
    return shiftKey ? CHECKOUT_WORKING_GLANCE_SCALE : 0;
  }
  if (workspaceName === 'cash') return CHECKOUT_CASH_GLANCE_SCALE;
  return 1;
}
const CARD_STATION = Object.freeze({ x: REGISTER.cardterm.x, z: REGISTER.cardterm.z });
const FRONT_DESK_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  FRONT_DESK_FRAME.ry,
);

function frontDeskOffsetVector3(localX = 0, localY = 0, localZ = 0) {
  const offset = frontDeskVector(localX, localZ);
  return new THREE.Vector3(offset.x, localY, offset.z);
}

function frontDeskQuaternion(localPitch = 0, localYaw = 0, localRoll = 0) {
  const local = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(localPitch, localYaw, localRoll),
  );
  return FRONT_DESK_QUATERNION.clone().multiply(local);
}

function frontDeskEuler(localPitch = 0, localYaw = 0, localRoll = 0) {
  if (localPitch === 0 && localRoll === 0) {
    return new THREE.Euler(0, FRONT_DESK_FRAME.ry + localYaw, 0);
  }
  return new THREE.Euler().setFromQuaternion(
    frontDeskQuaternion(localPitch, localYaw, localRoll),
    'XYZ',
  );
}

const DRAWER_BILLS = [1, 5, 10, 20, 50];
// 1¢ 5¢ 10¢ 25¢ 50¢ — the reference till's own five wells (154525 / 154641).
// The fourth well used to read "20¢", a coin that does not exist; see COINS in
// src/sim/register.js. The kit drawer authored its socket as COIN_20_SOCKET,
// so the quarter aliases onto that same physical well (see socketName below).
const DRAWER_COINS = [0.01, 0.05, 0.1, 0.25, 0.5];
// A till opening in roughly 0.31 s was over before the player could read the physical motion (and
// before a single full-resolution evidence frame could be retained). Give the opening stroke one
// deliberate second; closing can remain brisk after the handoff is complete.
// A till drawer is spring-loaded: it BANGS out when the solenoid releases. At 1
// it took a full second to clear the slab, which is the one moment the player
// is waiting on it. Opening is now nearly as brisk as closing.
const DRAWER_OPEN_SPEED = 3.2;
const DRAWER_CLOSE_SPEED = 2.4;
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
  0.01: 0.018, 0.05: 0.021, 0.1: 0.024, 0.25: 0.026, 0.5: 0.030,
};
// Money assets are authored in exact real-world metres.  Keep them at 1:1 so
// drawer fit, hand presentation, and denomination size comparisons stay true.
const MONEY_KIT_SCALE = 1.0;
const CLIP_LEVEL_QUAT = new THREE.Quaternion();

const moneyLabel = (denom) => (denom < 1
  ? `${Math.round(denom * 100)}¢`
  : `$${denom}`);

// The two rows the open till actually shows, top (notes) then bottom (coins),
// left to right. Exported so the label contract — "1¢ 5¢ 10¢ 25¢ 50¢", never a
// denomination this currency does not mint — is a test and not a screenshot.
export function checkoutDrawerSlotLabels() {
  return {
    bills: DRAWER_BILLS.map(moneyLabel),
    coins: DRAWER_COINS.map(moneyLabel),
  };
}

// WHAT THE PHYSICAL KEY IS CALLED, AND WHAT IT DOES. The GLB names every cap;
// this is the whole mapping, kept pure so a driver, the press raycast and the
// tests all read the same table.
export function checkoutTerminalKeyAction(name) {
  const digit = /^(?:Terminal_|t_glyph_)Key_(\d)$/.exec(name || '');
  if (digit) return `digit:${digit[1]}`;
  const button = /^(?:Terminal_|t_glyph_)(Confirm|Cancel|Back)Button$/.exec(name || '');
  if (!button) return null;
  return button[1] === 'Confirm' ? 'confirm' : button[1] === 'Back' ? 'backspace' : 'clear';
}

// The coloured caps, as the 2026-07-30 ruling names them: RED X cancels the
// entry, YELLOW backspaces, GREEN enters. The kit authored the confirm cap with
// a seven-segment "O" (a second zero on the pad) and the backspace cap with a
// bare "-", so the runtime redraws these three faces.
export const CHECKOUT_TERMINAL_KEY_ROLES = Object.freeze({
  clear: Object.freeze({ colour: 'red', label: 'X', role: 'cancel' }),
  backspace: Object.freeze({ colour: 'yellow', label: '⌫', role: 'backspace' }),
  confirm: Object.freeze({ colour: 'green', label: 'OK', role: 'enter' }),
});

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

export function cashConfirmationReadiness(flowState) {
  if ([
    'CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier',
    'EnteringCashierMode', 'WaitingForScan', 'ProductHeld', 'ProductScanning',
    'ProductScanned',
    'AllProductsScanned', 'ChoosingPayment', 'CashPresented', 'CashAccepted',
    'DrawerOpening', 'DepositingCash',
  ].includes(flowState)) return 'defer';
  if (flowState === 'SelectingChange') return 'ready';
  return 'reject';
}

const CASH_DRAWER_OPENING_CATCHUP = Object.freeze([
  'CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier',
  'EnteringCashierMode', 'WaitingForScan', 'ProductHeld', 'ProductScanning',
  'ProductScanned',
  'AllProductsScanned', 'ChoosingPayment', 'CashPresented', 'CashAccepted',
  'DrawerOpening',
]);

export function cashDrawerOpeningCatchupPath(flowState) {
  if (flowState === 'DepositingCash' || flowState === 'SelectingChange') return [];
  const index = CASH_DRAWER_OPENING_CATCHUP.indexOf(flowState);
  return index >= 0 ? CASH_DRAWER_OPENING_CATCHUP.slice(index + 1) : null;
}

const PAID_FLOW_CATCHUP = Object.freeze({
  card: Object.freeze([
    'CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier',
    'EnteringCashierMode', 'WaitingForScan', 'ProductHeld', 'ProductScanning',
    'ProductScanned',
    'AllProductsScanned', 'ChoosingPayment', 'CardPresented', 'CardInsertReady',
    'CardInserting', 'CardAmountEntry', 'CardProcessing', 'CardApproved',
    'PaymentComplete',
  ]),
  cash: Object.freeze([
    'CustomerApproaching', 'CustomerPlacingProducts', 'WaitingForCashier',
    'EnteringCashierMode', 'WaitingForScan', 'ProductHeld', 'ProductScanning',
    'ProductScanned',
    'AllProductsScanned', 'ChoosingPayment', 'CashPresented', 'CashAccepted',
    'DrawerOpening', 'DepositingCash', 'SelectingChange', 'GivingChange',
    'PaymentComplete',
  ]),
});

export function paidCheckoutCatchupPath(method, flowState) {
  if (flowState === 'ReceiptPrinting') return [];
  const sequence = PAID_FLOW_CATCHUP[method];
  const index = sequence ? sequence.indexOf(flowState) : -1;
  return index >= 0 ? sequence.slice(index + 1) : null;
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

function billTexture(denom, clubName = DEFAULT_DISPLAY_BRAND) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 168;
  const ctx = canvas.getContext('2d');
  // Round 7: every note prints on the SAME dollar-green stock ("make it how
  // they were before"); the big numerals and the well tags carry identity.
  const base = { 1: '#ccd6c1', 5: '#c7d2bc', 10: '#c2ceb7', 20: '#bdcab2', 50: '#b8c6ad' }[denom] || '#c2ceb7';
  const ink = '#2f4c31';
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
  setFittedCanvasFont(ctx, checkoutDisplayClubName({ clubName }).toUpperCase(), {
    maxWidth: 230,
    startSize: 15,
    minimumSize: 10,
    weight: 600,
  });
  ctx.fillText(checkoutDisplayClubName({ clubName }).toUpperCase(), 192, 127);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The PENNY is copper and every other coin is silver — the one colour cue that
// separates a coin row at drawer distance (reference 154525 / 154641). The
// procedural fallback carried a single grey disc for all five, which is the
// "dark indistinct blobs" the playtest called out; each face now mints in its
// own alloy, and the drawn value stays legible on both.
const COIN_ALLOY = {
  0.01: ['#f0c39a', '#c07a41', '#7c4a24', '#4a2c15'],
  0.05: ['#eceeee', '#adb3b4', '#71787a', '#39403f'],
  0.1: ['#f8fafb', '#c9d0d2', '#868f92', '#3f4742'],
  0.25: ['#f2f5f6', '#bcc3c5', '#7c8486', '#3b4243'],
  0.5: ['#fbf7ee', '#cfc8b8', '#8b8578', '#403c34'],
};

function coinTexture(denom) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const [hi, mid, lo, ink] = COIN_ALLOY[denom] || COIN_ALLOY[0.1];
  const gradient = ctx.createRadialGradient(55, 48, 8, 80, 80, 75);
  gradient.addColorStop(0, hi);
  gradient.addColorStop(0.52, mid);
  gradient.addColorStop(1, lo);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(80, 80, 76, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = lo;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(80, 80, 64, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = '700 55px Georgia, serif';
  ctx.fillText(String(Math.round(denom * 100)), 80, 92);
  ctx.font = '700 16px Arial, sans-serif';
  ctx.fillText('CENTS', 80, 121);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function paymentCardTexture(clubName = DEFAULT_DISPLAY_BRAND) {
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
  const brand = checkoutDisplayClubName({ clubName }).toUpperCase();
  setFittedCanvasFont(ctx, brand, {
    maxWidth: 650,
    startSize: 52,
    minimumSize: 28,
    weight: 700,
    family: 'Georgia, serif',
  });
  ctx.fillText(brand, 58, 105);
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

function displayBrandTexture(clubName, {
  width = 768,
  height = 480,
  background = '#173f2d',
  backgroundEnd = '#0e2d21',
  border = '#b9974e',
  foreground = '#f8f0dc',
  subtitle = '#d6bd81',
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, background);
  gradient.addColorStop(1, backgroundEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(4, Math.round(width * 0.012));
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = foreground;
  const lines = checkoutDisplayBrandLines(clubName);
  const lineSize = lines.length === 1 ? height * 0.22 : height * 0.17;
  lines.forEach((line, index) => {
    // K1: the floor is a FIT floor, not a taste floor. On the portrait bag
    // stamp (640x760) the old height*0.10 minimum was 76 px, at which
    // "MUNICIPAL GOLF" measured ~660 px on a 640 px canvas — the fitter gave
    // up above the canvas width and the stamp printed cut off mid-letter on
    // every bag (photographed, qa/electron/bag-presentation-k1/before).
    setFittedCanvasFont(ctx, line, {
      maxWidth: width - 100,
      startSize: lineSize,
      minimumSize: height * 0.04,
      weight: 700,
      family: 'Georgia, serif',
    });
    const offset = lines.length === 1 ? 0 : (index === 0 ? -height * 0.10 : height * 0.10);
    ctx.fillText(line, width / 2, height * 0.44 + offset);
  });
  ctx.fillStyle = subtitle;
  // the subtitle got no fitting at all — same clipped fate on narrow canvases
  setFittedCanvasFont(ctx, 'PRO SHOP  ·  FIRST TEE', {
    maxWidth: width - 110,
    startSize: height * 0.072,
    minimumSize: height * 0.035,
    weight: 700,
  });
  ctx.fillText('PRO SHOP  ·  FIRST TEE', width / 2, height * 0.76);
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
  const displayClubName = () => checkoutDisplayClubName(state);
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
  let physicalBrandSignature = '';
  const bagBrandMaterial = new THREE.MeshBasicMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const cardBrandMaterial = new THREE.MeshBasicMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  function syncPhysicalBrand() {
    const signature = displayClubName();
    if (signature === physicalBrandSignature) return false;
    bagBrandMaterial.map?.dispose();
    cardBrandMaterial.map?.dispose();
    bagBrandMaterial.map = displayBrandTexture(signature, {
      width: 640,
      height: 760,
      background: '#c3a06d',
      backgroundEnd: '#a77f4e',
      border: '#6c4b29',
      foreground: '#173f2d',
      subtitle: '#294f37',
    });
    // The card wears an actual CARD face — chip, member number, brand — not
    // the shop wordmark panel. Round 7: "make the card look better when
    // inserted": the wordmark read as a green sliver in the reader's slot;
    // the bank-card layout reads as a card at any protrusion.
    cardBrandMaterial.map = paymentCardTexture(signature);
    bagBrandMaterial.needsUpdate = true;
    cardBrandMaterial.needsUpdate = true;
    physicalBrandSignature = signature;
    return true;
  }
  syncPhysicalBrand();
  const cashierHands = makeCashierHands(root);
  suppressInteriorSunShadows(cashierHands.root);
  const customerPalm = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 12, 8),
    new THREE.MeshStandardMaterial({
      color: 0xf0d8b4,
      roughness: 0.85,
      transparent: true,
      opacity: 0.30,
      depthWrite: false,
    }),
  );
  customerPalm.name = 'CheckoutCustomerPalmTarget';
  customerPalm.userData = { pick: true, kind: 'palm' };
  customerPalm.visible = false;
  root.add(customerPalm);

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
  // live canvas hangs on its Terminal_Screen face and the authored reader
  // screen supplies the amount keypad. There is no duplicate card UI.
  const termCanvas = document.createElement('canvas');
  termCanvas.width = TERM_CANVAS_W;
  termCanvas.height = TERM_CANVAS_H;
  const termContext = termCanvas.getContext('2d');
  // K5: the light theme's idle ground — a top-lit LCD grey-green, not the
  // near-black it replaced (judged "too dark" at the counter)
  const termGlow = termContext.createLinearGradient(0, 0, 0, TERM_CANVAS_H);
  termGlow.addColorStop(0, '#E9EEE9');
  termGlow.addColorStop(1, '#D6DDD6');
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
  let cardSocketNode = null;

  // THE PHYSICAL KEYPAD. The GLB models every key — Terminal_Key_0..9 and the
  // Back/Cancel/Confirm buttons, each with a t_glyph_* face — and pressing them
  // raycasts to those meshes. The keypad the screen used to draw is gone:
  // reported 2026-07-29, "the player presses the physical number keys modelled
  // in Blender. The display shows the amount and prompts, not the digits."
  // THE READER COMES TO THE PLAYER. Playtest 2026-07-30: the camera cut to the
  // terminal made the player dizzy — so the camera now holds the working frame
  // and the READER lifts off the counter and floats in front of the current
  // eye for amount entry, then settles back onto its seat when the payment
  // resolves. The keys ride with it (they are its children), so the physical
  // keypad works at the face exactly as it does on the counter.
  const TERMINAL_FLOAT_RATE = 6.5;          // 1/s toward the target
  // ROUND 7: "the card reader is centered and directly in front of the user's
  // face" — the centre-left offset is gone; the device hangs dead on the view
  // axis. Its screen shows the total, so nothing readable is lost behind it
  // while the amount is keyed. The clearance clamp below keeps its base (and
  // the card hanging from it) out of the counter now that the working eye
  // rides much lower than when 1.16 m was first tuned.
  // ROUND 8: "make the buttons and the overall thing bigger and closer so it's
  // easier to use." The reference (Designs/CashRegister/Final 154618) holds the
  // terminal at arm's length filling better than half the frame height; at
  // 1.16 m ours filled about a third and the physical keys were small targets.
  // 0.74 m is the same device 57% nearer — every key grows with it, since the
  // pad is modelled geometry rather than drawn UI.
  const TERMINAL_FLOAT_DISTANCE = 0.74;     // metres along the VIEW AXIS
  const TERMINAL_FLOAT_LEFT = 0;            // dead centre (round 7)
  const TERMINAL_FLOAT_DROP = 0.02;         // essentially on the view axis
  // The device origin is its BASE and the inserted card hangs below that.
  // Keep base-minus-card above the counter top wherever the view axis lands.
  const TERMINAL_FLOAT_COUNTER_CLEARANCE = 0.16;
  // A few degrees of roll: the reference unit is canted like something held,
  // not bolted. Facing stays yaw-only (playtest 2026-07-30 round 2) so the
  // glass never rakes away from the eye.
  // ROUND 9: 0. "The reader screen is tilted. Straighten it. Do not rotate the
  // reader." -0.075 rad is 4.3 degrees of roll about the device's own face
  // axis, which is exactly enough to read as a crooked screen without reading
  // as a deliberate angle — every horizontal in the UI (the status strip, the
  // keypad rows, the amount) sloped together. Note the comment at the facing
  // solve already claimed "a yaw-only facing, no pitch or roll" while this
  // constant was quietly rolling it; the claim is now true.
  //
  // Straightening the SCREEN is done by removing the roll rather than by
  // counter-rotating the screen inside the device, because the device is one
  // rigid object: rolling the body and unrolling the glass would put the
  // keypad and the card slot back out of true instead.
  const TERMINAL_FLOAT_ROLL = 0;
  let terminalFloat = 0;                    // 0 seated .. 1 at the face
  let termCentreOffsetY = 0.10;             // origin(base) -> device centre, measured at attach
  let terminalFloatAnchor = null;           // frozen at lift-off; null when seated
  let termSeatPosition = null;
  let termSeatQuaternion = null;
  // scratch for the rise/descent curve; allocated once, this runs every frame
  const _termPathControl = new THREE.Vector3();
  let termBaseScale = TERMINAL_HARDWARE_SCALE; // working size; parked shrinks by BAY.parkScale
  let cardMeshOnTerminal = false;

  function terminalShouldFloat() {
    // From the moment the player TAKES the offered card until the payment
    // resolves. Not during the offer itself — the parked reader would rise
    // into the middle of the screen in front of the card being clicked.
    if (!active || !tx || tx.method !== 'card') return false;
    if (['card-entry', 'card-busy', 'card-declined'].includes(tx.stage)) return true;
    return tx.stage === 'card-ready' && cardAccepted;
  }

  function updateTerminalFloat(dt) {
    if (!termObject || !termSeatPosition) return;
    const target = terminalShouldFloat() ? 1 : 0;
    const step = 1 - Math.exp(-TERMINAL_FLOAT_RATE * dt);
    terminalFloat += (target - terminalFloat) * step;
    if (cardMeshOnTerminal) {
      // Legacy re-rooting: the card used to be PARENTED to the reader so it
      // would ride the lift. It also meant every insert/eject lerp — which
      // works in root-local vectors — ran in the wrong frame, and the inserted
      // card ended up somewhere inside the reader's own silhouette instead of
      // protruding from its base (measured 2026-07-30). The card now stays
      // rooted and refreshCardInsertPath re-reads the LIVE socket each frame,
      // so it tracks the rising reader in the space its animation is authored
      // in. This branch only unwinds a card left parented by an older frame.
      if (cardMesh && cardMesh.parent === termObject) root.attach(cardMesh);
      cardMeshOnTerminal = false;
    }
    if (terminalFloat < 0.001 && target === 0) {
      if (terminalFloat !== 0) {
        terminalFloat = 0;
        termObject.position.copy(termSeatPosition);
        termObject.quaternion.copy(termSeatQuaternion);
        termObject.scale.setScalar(termBaseScale * CHECKOUT_TERMINAL_BAY.parkScale);
      }
      terminalFloatAnchor = null;
      return;
    }
    // THE ANCHOR FREEZES AT LIFT-OFF. The first take recomputed the face point
    // every frame so the reader tracked head sway — which meant it also chased
    // the cursor, and any projected key/X point went stale the moment the mouse
    // moved toward it: the acceptance click on the reader's X sampled a point,
    // travelled, and landed on the key the reader had swayed onto. A floated
    // device that HOLDS STILL is both calmer and clickable.
    if (!terminalFloatAnchor) {
      root.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const eye = camera.getWorldPosition(new THREE.Vector3());
      const forward = camera.getWorldDirection(new THREE.Vector3());
      const flatForward = new THREE.Vector3(forward.x, 0, forward.z);
      if (flatForward.lengthSq() < 1e-6) flatForward.set(0, 0, -1);
      flatForward.normalize();
      // ANCHOR ON THE VIEW AXIS, NOT ON WORLD DOWN. The working frame looks
      // DOWN about 32°, so "0.13 m below the eye, 0.74 m ahead horizontally"
      // put the device far ABOVE the centre of the picture — measured
      // 2026-07-30: its glass sat entirely off the top of the viewport and
      // only the keypad was in shot. Stepping along the camera's own forward,
      // right and up axes lands it where the frame actually is, at any pitch.
      const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      // targetWorld is where the device's CENTRE should hang; the origin (its
      // base) goes centre-offset lower so the glass sits on the anchor.
      // The lateral step puts it centre-LEFT, reference-style, leaving the POS
      // beside it instead of behind it.
      const targetWorld = eye.clone()
        .addScaledVector(forward, TERMINAL_FLOAT_DISTANCE)
        .addScaledVector(camRight, -TERMINAL_FLOAT_LEFT)
        .addScaledVector(camUp, -TERMINAL_FLOAT_DROP)
        .add(new THREE.Vector3(0, -termCentreOffsetY, 0));
      // STRAIGHT, not slanted (playtest 2026-07-30 round 2): the device stands
      // upright with its glass square to the player — a yaw-only facing, no
      // pitch or roll. The earlier full lookAt tilted the whole reader toward
      // the eye line and it read as askew. The exporter turns the screen face
      // to +Z, so +Z must aim back along the flattened view direction.
      const yaw = Math.atan2(-flatForward.x, -flatForward.z);
      const faceWorldQuat = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1), TERMINAL_FLOAT_ROLL,
        ));
      const rootQuatInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const anchorLocal = root.worldToLocal(targetWorld.clone());
      // ROUND 7 ("not colliding with any desk, screen etc"): the round-6 eye
      // sits 0.56 above the counter, so a point 1.16 m down the pitched view
      // axis can land the device's base INSIDE the counter slab — measured on
      // the old constants the base solved ~0.15 below the top and the keypad
      // and inserted card were buried in wood. Root-local y IS interior-local
      // y here, so clamp the base above the top wherever the axis lands.
      anchorLocal.y = Math.max(anchorLocal.y, COUNTER_TOP + TERMINAL_FLOAT_COUNTER_CLEARANCE);
      terminalFloatAnchor = {
        position: anchorLocal,
        quaternion: rootQuatInv.clone().multiply(faceWorldQuat),
      };
    }
    const ease = THREE.MathUtils.smoothstep(terminalFloat, 0, 1);
    // OUT OF THE BAY FIRST, THEN UP — AND THE SAME CURVE BACK DOWN.
    //
    // Reported as "the reader phases through the counter on its way home". Two
    // geometric tests (corner containment by ray parity, and a swept-segment
    // test between consecutive frames, both against the VISIBLE counter meshes)
    // found zero crossings on the straight lerp — the honest finding is in
    // OVERNIGHT_REPORT_6. What the straight lerp DOES do is travel diagonally
    // from the under-counter bay to the face, which passes very close to the
    // slab edge and reads as going through it as the device shrinks away.
    //
    // A quadratic Bezier through a control point at SEAT HEIGHT but at the
    // face's horizontal position turns that diagonal into a rounded L: the
    // device slides forward out of the bay while still low, clears the
    // counter's front edge, and only then climbs. Coming home it runs the same
    // curve in reverse. No new constants — the control point is derived from
    // the two ends the animation already had.
    const control = _termPathControl.set(
      terminalFloatAnchor.position.x,
      termSeatPosition.y,
      terminalFloatAnchor.position.z,
    );
    const inv = 1 - ease;
    const a = inv * inv;
    const b = 2 * inv * ease;
    const c = ease * ease;
    termObject.position.set(
      a * termSeatPosition.x + b * control.x + c * terminalFloatAnchor.position.x,
      a * termSeatPosition.y + b * control.y + c * terminalFloatAnchor.position.y,
      a * termSeatPosition.z + b * control.z + c * terminalFloatAnchor.position.z,
    );
    termObject.quaternion.slerpQuaternions(termSeatQuaternion, terminalFloatAnchor.quaternion, ease);
    // pocket-sized in the bay, working-sized at the face
    const park = CHECKOUT_TERMINAL_BAY.parkScale;
    termObject.scale.setScalar(termBaseScale * (park + (1 - park) * ease));
  }

  const terminalKeyByAction = new Map();   // action -> [key mesh, glyph mesh]
  const terminalKeyPickables = [];
  const terminalKeyPulses = new Map();     // action -> seconds remaining
  const TERMINAL_KEY_PULSE_S = 0.14;

  const terminalKeyActionForName = (name) => checkoutTerminalKeyAction(name);

  // WHAT EACH COLOURED KEY DOES, WRITTEN ON THE KEY. The kit authored the
  // confirm cap with a seven-segment "O" (indistinguishable from a zero — the
  // pad then showed two 0 keys) and the backspace cap with a bare "-". Ruling
  // 2026-07-30: red X cancels, YELLOW backspaces, GREEN enters. The authored
  // glyph mesh is hidden and a drawn decal takes its exact place, so the labels
  // are right without rebuilding the hash-gated checkout kit.
  const TERMINAL_KEY_DECALS = {
    confirm: { text: CHECKOUT_TERMINAL_KEY_ROLES.confirm.label, ink: '#f2fff4', ratio: 0.62 },
    backspace: { glyph: 'backspace', ink: '#2b2410', ratio: 0.86 },
    clear: { text: CHECKOUT_TERMINAL_KEY_ROLES.clear.label, ink: '#fff1ee', ratio: 0.62 },
  };
  const terminalDecalMaterials = new Map();

  // The backspace arrow is DRAWN, not typed: "⌫" depends on a symbol font
  // being installed, and a missing glyph on the one key that undoes a mistake
  // is a worse failure than a slightly plain arrow.
  function paintBackspaceGlyph(ctx, cx, cy, w, h, ink) {
    const nose = cx - w / 2;
    const tail = cx + w / 2;
    const shoulder = nose + h * 0.62;
    ctx.beginPath();
    ctx.moveTo(nose, cy);
    ctx.lineTo(shoulder, cy - h / 2);
    ctx.lineTo(tail, cy - h / 2);
    ctx.lineTo(tail, cy + h / 2);
    ctx.lineTo(shoulder, cy + h / 2);
    ctx.closePath();
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(12,14,12,0.55)';
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fill();
    // the little × inside, so it reads "delete" and not "back"
    const arm = h * 0.20;
    const mx = (shoulder + tail) / 2 + h * 0.06;
    ctx.strokeStyle = 'rgba(250,246,236,0.96)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx - arm, cy - arm);
    ctx.lineTo(mx + arm, cy + arm);
    ctx.moveTo(mx + arm, cy - arm);
    ctx.lineTo(mx - arm, cy + arm);
    ctx.stroke();
  }

  function terminalDecalMaterial(action) {
    if (terminalDecalMaterials.has(action)) return terminalDecalMaterials.get(action);
    const spec = TERMINAL_KEY_DECALS[action];
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 160);
    if (spec.glyph === 'backspace') {
      paintBackspaceGlyph(ctx, 128, 80, 168, 96, spec.ink);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 104px "Segoe UI", Arial, sans-serif';
      ctx.lineWidth = 12;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(12,14,12,0.55)';
      ctx.strokeText(spec.text, 128, 84);
      ctx.fillStyle = spec.ink;
      ctx.fillText(spec.text, 128, 84);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, toneMapped: false, depthWrite: false,
    });
    terminalDecalMaterials.set(action, material);
    return material;
  }

  // Replace one authored glyph with a drawn decal occupying the same slab of
  // space. The decal is parented to the KEY (so it rides the press pulse) and
  // its facing is derived from where the glyph sits relative to the cap, which
  // is the exporter-independent way to find "out of the deck".
  function decalTerminalKey(action, key, glyph) {
    if (!TERMINAL_KEY_DECALS[action] || !key || !glyph || glyph.userData.terminalDecalDone) return;
    glyph.userData.terminalDecalDone = true;
    root.updateMatrixWorld(true);
    const glyphWorld = glyph.getWorldPosition(new THREE.Vector3());
    const keyWorld = new THREE.Box3().setFromObject(key).getCenter(new THREE.Vector3());
    const outward = glyphWorld.clone().sub(keyWorld);
    if (outward.lengthSq() < 1e-12) return;
    outward.normalize();
    const keyBox = new THREE.Box3().setFromObject(key);
    const size = keyBox.getSize(new THREE.Vector3());
    // The cap's two largest world extents are its face; the smallest is depth.
    const face = [size.x, size.y, size.z].sort((a, b) => b - a);
    const height = face[1] * TERMINAL_KEY_DECALS[action].ratio;
    const width = height * 1.6;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      terminalDecalMaterial(action),
    );
    decal.name = `TerminalKeyDecal_${action}`;
    decal.renderOrder = 5;
    // "up" on the deck: the world axis most orthogonal to both outward and the
    // cap's long side. The reader stands upright, so world +Y projected into
    // the face plane is the honest answer and needs no exporter assumptions.
    const up = new THREE.Vector3(0, 1, 0).projectOnPlane(outward);
    if (up.lengthSq() < 1e-8) up.set(0, 0, 1).projectOnPlane(outward);
    up.normalize();
    const basisX = new THREE.Vector3().crossVectors(up, outward).normalize();
    const worldQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(basisX, up, outward),
    );
    key.add(decal);
    key.updateWorldMatrix(true, false);
    decal.position.copy(key.worldToLocal(
      glyphWorld.clone().addScaledVector(outward, 0.0006),
    ));
    decal.quaternion.copy(
      key.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQuat),
    );
    glyph.visible = false;
  }

  function collectTerminalKeys(terminal) {
    terminalKeyByAction.clear();
    terminalKeyPickables.length = 0;
    terminal.traverse((node) => {
      if (!node.isMesh) return;
      const action = terminalKeyActionForName(node.name);
      if (!action) return;
      node.userData.terminalKeyAction = action;
      terminalKeyPickables.push(node);
      const list = terminalKeyByAction.get(action) || [];
      list.push(node);
      terminalKeyByAction.set(action, list);
      if (!node.userData.terminalKeyBaseScale) {
        node.userData.terminalKeyBaseScale = node.scale.clone();
      }
    });
    for (const [action, meshes] of terminalKeyByAction) {
      if (!TERMINAL_KEY_DECALS[action]) continue;
      const cap = meshes.find((mesh) => mesh.name.startsWith('Terminal_'));
      const glyph = meshes.find((mesh) => mesh.name.startsWith('t_glyph_'));
      decalTerminalKey(action, cap, glyph);
    }
    // The hidden glyph must not swallow a click meant for its cap.
    for (let index = terminalKeyPickables.length - 1; index >= 0; index -= 1) {
      if (!terminalKeyPickables[index].visible) terminalKeyPickables.splice(index, 1);
    }
  }

  // A pressed key visibly gives: a short scale dip on the key AND its glyph.
  // Scale rather than translation because the deck is sloped and the exporter
  // owns the key's local axes — a scale pulse reads as a press from any angle.
  function pulseTerminalKey(action) {
    if (terminalKeyByAction.has(action)) terminalKeyPulses.set(action, TERMINAL_KEY_PULSE_S);
  }

  function updateTerminalKeyPulses(dt) {
    if (!terminalKeyPulses.size) return;
    for (const [action, left] of [...terminalKeyPulses]) {
      const next = left - dt;
      const meshes = terminalKeyByAction.get(action) || [];
      if (next <= 0) {
        for (const mesh of meshes) mesh.scale.copy(mesh.userData.terminalKeyBaseScale);
        terminalKeyPulses.delete(action);
        continue;
      }
      // dip to 0.85 at the middle of the pulse, back out by the end
      const t = 1 - next / TERMINAL_KEY_PULSE_S;
      const dip = 1 - 0.15 * Math.sin(Math.PI * Math.min(1, t));
      for (const mesh of meshes) {
        mesh.scale.copy(mesh.userData.terminalKeyBaseScale).multiplyScalar(dip);
      }
      terminalKeyPulses.set(action, next);
    }
  }

  // The authored counter scanner is the one physical read source. Products
  // commit only while their visible barcode crosses this socket's +Z ray.
  let scannerObject = null;
  let scannerRayOrigin = null;
  const scannerFeedback = [];
  let scannerFeedbackMode = 'idle';
  let scannerPulse = 0;
  let lastScanEvidence = null;

  // No printer, no paper, no receipt mesh — round 7 removed the receipt
  // presentation entirely. The sim's print/take/pack verbs still run silently
  // inside beginAutomaticReceipt so exact-once banking keeps its contract.
  let autoFulfilled = false;
  let finalizeTimer = 0;

  // The shopping bag sits at counter-left; the player drags paid products through
  // its mouth. Positions are tuned to the reference composition.
  let bagGroup = null;
  let bagContentsNode = null;
  let bagHandoffNode = null;
  const BAG_COUNTER_SCALE = CHECKOUT_BAG_PRESENTATION.scale;
  const BAG_FLATTEN = CHECKOUT_BAG_PRESENTATION.flatten;
  const bagCounterQuaternion = () => frontDeskQuaternion(
    CHECKOUT_BAG_PRESENTATION.pitch, 0, CHECKOUT_BAG_PRESENTATION.roll,
  );
  const bagHandoffLocal = new THREE.Vector3(0, 0.30, 0);
  const bagDeliverAnchorFrom = new THREE.Vector3();
  const bagDeliverAnchorAt = new THREE.Vector3();
  const _bagClearScratch = new THREE.Vector3();
  let bagDeliverScaleFrom = BAG_COUNTER_SCALE;
  // The laid carrier's CLOSED BASE sits exactly on its authored layout point —
  // the counter's LEFT end, on the staff half, left of every staged item — and
  // the bag runs from there down-counter with its mouth aimed at the goods.
  const BAG_POS = new THREE.Vector3(
    REGISTER.bag.x,
    COUNTER_TOP + CHECKOUT_BAG_PRESENTATION.counterLift,
    REGISTER.bag.z,
  );
  const bagMouth = new THREE.Vector3(0, 0.36 * BAG_COUNTER_SCALE, 0)
    .applyQuaternion(frontDeskQuaternion(
      CHECKOUT_BAG_PRESENTATION.pitch, 0, CHECKOUT_BAG_PRESENTATION.roll,
    ))
    .add(BAG_POS);

  // --- THE DEVICE BAY ------------------------------------------------------
  // A CLOSED ALCOVE: back panel, floor, ceiling and two side walls, opening
  // toward the staff. Round 8 (2026-08-02) rebuilt it — the round-7 version
  // was four loose rails around a floating white slab, so the panel bled past
  // the frame, the box had no floor to sit on, and the pin pad hung straight
  // through the bottom ("they look super weird like they are phasing though
  // and the back is white for some reason"). Every wall is dark and shares
  // the counter's own material family; the only bright surface is the back
  // panel, and it is now BOUNDED on all four sides so it reads as a lit
  // recess instead of a white sheet stuck to the desk. Nothing inside may
  // exceed the opening — enforced by BAY_INNER below.
  const BAY = CHECKOUT_TERMINAL_BAY;
  const BAY_WALL = 0.018;
  const bayFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x1e2125, roughness: 0.62 });
  // Not pure white: a warm off-white at a restrained emissive lift reads as a
  // lit shelf. 0xffffff unlit-basic was the "the back is white" report.
  const bayGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8ebe6,
    emissive: 0xfaf6ea,
    emissiveIntensity: 0.42,
    roughness: 0.9,
  });
  const terminalBay = new THREE.Group();
  terminalBay.name = 'CheckoutTerminalBay';
  {
    const face = frontDeskPoint(BAY.localX, COUNTER.depth / 2 + 0.004);
    terminalBay.position.set(face.x, COUNTER_TOP - BAY.belowTop, face.z);
    terminalBay.quaternion.copy(frontDeskQuaternion());
    const halfW = BAY.width / 2;
    const halfH = BAY.height / 2;
    // the lit back, inset behind the opening
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(BAY.width, BAY.height, 0.008),
      bayGlowMaterial,
    );
    glow.position.set(0, 0, 0.004);
    terminalBay.add(glow);
    // floor, ceiling and jambs — a real box, flush at the opening so the
    // alcove is closed on every side except the one you look into
    const walls = [
      [BAY.width + BAY_WALL * 2, BAY_WALL, BAY.reach, 0, halfH + BAY_WALL / 2, BAY.reach / 2],
      [BAY.width + BAY_WALL * 2, BAY_WALL, BAY.reach, 0, -halfH - BAY_WALL / 2, BAY.reach / 2],
      [BAY_WALL, BAY.height, BAY.reach, -halfW - BAY_WALL / 2, 0, BAY.reach / 2],
      [BAY_WALL, BAY.height, BAY.reach, halfW + BAY_WALL / 2, 0, BAY.reach / 2],
    ];
    for (const [w, h, d, x, y, z] of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bayFrameMaterial);
      wall.position.set(x, y, z);
      terminalBay.add(wall);
    }
    // the second small device from the reference: a white-faced pin pad
    // standing on the alcove floor, leaning back against the lit panel. Sized
    // from the opening so it cannot poke through any wall.
    const padH = Math.min(0.108, BAY.height - 0.03);
    const pinPad = new THREE.Group();
    const pinBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, padH, 0.017),
      new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5 }),
    );
    const pinFaceCanvas = document.createElement('canvas');
    pinFaceCanvas.width = 96;
    pinFaceCanvas.height = 160;
    {
      const c2 = pinFaceCanvas.getContext('2d');
      c2.fillStyle = '#eef0ec';
      c2.fillRect(0, 0, 96, 160);
      c2.fillStyle = '#20241f';
      c2.fillRect(10, 10, 76, 34); // its own little screen
      c2.fillStyle = '#c2c7c0';
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          c2.fillRect(12 + col * 26, 56 + row * 25, 20, 17);
        }
      }
    }
    const pinFaceTexture = new THREE.CanvasTexture(pinFaceCanvas);
    pinFaceTexture.colorSpace = THREE.SRGBColorSpace;
    const pinFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.054, padH - 0.008),
      new THREE.MeshBasicMaterial({ map: pinFaceTexture, toneMapped: false }),
    );
    pinFace.position.z = 0.0091;
    pinPad.add(pinBody, pinFace);
    // stand it on the floor: half its leaned height above the floor plane,
    // and far enough forward that leaning back keeps it clear of the panel
    const lean = BAY.seatPitch;
    const padRise = (padH / 2) * Math.cos(lean);
    const padSet = (padH / 2) * Math.abs(Math.sin(lean));
    pinPad.position.set(
      BAY.pinPadOffsetX,
      -halfH + padRise + 0.004,
      Math.min(BAY.reach - 0.02, 0.014 + padSet + 0.012),
    );
    pinPad.rotation.x = lean;
    terminalBay.add(pinPad);
    suppressInteriorSunShadows(terminalBay);
    root.add(terminalBay);
  }

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
  // Each product is one direct click: ring once, animate into the open bag,
  // then let the customer payment preference advance automatically.

  // NO HOVER OUTLINE. Playtest round 5 (2026-07-30): "when hovering over an
  // item don't have the orange box around it anymore." The brass Box3Helper
  // that used to rim every hovered product, drawer well and counted coin is
  // gone; the pointer cursor alone says "clickable". The ONE outline that
  // remains is the green payment rim below, which the same playtester asked
  // for and which the reference carries.
  // THE GRABBABLE HIGHLIGHT IS AN OUTLINE. Round 5's green Box3Helper cage and
  // round 6's emissive brightening + additive halo were both rejected — round
  // 7: "make sure that the highlight for selecting a card or cash is just an
  // outline of the card or cash, not a full blob over it."
  //
  // K3 (2026-08-05): the round-7 answer — an inverted-hull shell grown by a
  // fixed rim on EVERY axis — degenerates on exactly the geometry it exists
  // for. A note is a 2.2 mm slab of paper; growing it 4.5 mm per side makes an
  // 11 mm shell five times the note's own thickness, and from the register's
  // glancing view its walls and flipped faces render as blank cream SHEETS
  // lying over the money (photographed: qa/electron/cash-hover-k3, the run
  // that failed). So flat meshes now get a border FRAME instead: a thin ring
  // hugging the face's footprint, floating a hair off each face, which reads
  // as a true outline from every angle. Chunky meshes keep the inverted hull,
  // which is correct for them. Nothing about the money's own surface changes.
  const GRAB_OUTLINE_COLOR = 0xffe9a8;   // warm paper-gold rim
  const GRAB_OUTLINE_RIM = 0.0045;       // metres of visible edge
  const GRAB_OUTLINE_LIFT = 0.0012;      // frame's clearance off a flat face
  const grabOutlineMaterial = new THREE.MeshBasicMaterial({
    color: GRAB_OUTLINE_COLOR,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const grabOutlineFlatMaterial = new THREE.MeshBasicMaterial({
    color: GRAB_OUTLINE_COLOR,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const grabOutlineShells = []; // shells parented onto the highlighted meshes
  function clearGrabHighlight() {
    for (const shell of grabOutlineShells) {
      shell.removeFromParent();
      // frames own their ShapeGeometry; hull shells borrow the mesh's own
      if (shell.userData.grabOutlineOwnsGeometry) shell.geometry.dispose();
    }
    grabOutlineShells.length = 0;
  }
  // The ring geometry for one flat face: outer edge GRAB_OUTLINE_RIM outside
  // the footprint, inner edge exactly on it, elliptical for coin-like rounds.
  function grabOutlineFrameGeometry(halfX, halfY, round) {
    const shape = new THREE.Shape();
    const hole = new THREE.Path();
    if (round) {
      shape.absellipse(0, 0, halfX + GRAB_OUTLINE_RIM, halfY + GRAB_OUTLINE_RIM, 0, Math.PI * 2);
      hole.absellipse(0, 0, halfX, halfY, 0, Math.PI * 2, true);
    } else {
      const ox = halfX + GRAB_OUTLINE_RIM;
      const oy = halfY + GRAB_OUTLINE_RIM;
      shape.moveTo(-ox, -oy); shape.lineTo(ox, -oy);
      shape.lineTo(ox, oy); shape.lineTo(-ox, oy); shape.closePath();
      hole.moveTo(-halfX, -halfY); hole.lineTo(-halfX, halfY);
      hole.lineTo(halfX, halfY); hole.lineTo(halfX, -halfY); hole.closePath();
    }
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape, round ? 48 : 2);
  }
  function applyGrabHighlight(list) {
    for (const object of list) {
      object.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.geometry) return;
        if (mesh.userData.grabOutlineShell) return; // never outline an outline
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        if (!box || box.isEmpty()) return;
        const size = new THREE.Vector3();
        box.getSize(size);
        const centre = new THREE.Vector3();
        box.getCenter(centre);
        const axes = ['x', 'y', 'z'].sort((a, b) => size[a] - size[b]);
        const thin = axes[0];
        const flat = size[thin] < Math.max(size[axes[1]], 1e-6) * 0.35;
        if (flat) {
          // ---- the frame path: notes, the card, coins ----
          const round = /Cylinder/i.test(mesh.geometry.type || '');
          // ShapeGeometry lies in XY with +Z normal; rotate it so the normal
          // runs down the thin axis and the shape spans the two broad ones.
          let halfX; let halfY; let rotate = null;
          if (thin === 'y') {
            halfX = size.x / 2; halfY = size.z / 2;
            rotate = (g) => g.rotateX(Math.PI / 2);
          } else if (thin === 'x') {
            halfX = size.z / 2; halfY = size.y / 2;
            rotate = (g) => g.rotateY(Math.PI / 2);
          } else {
            halfX = size.x / 2; halfY = size.y / 2;
          }
          // one frame off each broad face, so the outline reads from both
          // sides of a note or a held card
          for (const sign of [1, -1]) {
            const geometry = grabOutlineFrameGeometry(halfX, halfY, round);
            if (rotate) rotate(geometry);
            const frame = new THREE.Mesh(geometry, grabOutlineFlatMaterial);
            frame.userData = { grabOutlineShell: true, grabOutlineOwnsGeometry: true, pick: false };
            frame.position.copy(centre);
            frame.position[thin] += sign * (size[thin] / 2 + GRAB_OUTLINE_LIFT);
            frame.raycast = () => {}; // the outline must never eat the click
            mesh.add(frame);
            grabOutlineShells.push(frame);
          }
          return;
        }
        const shell = new THREE.Mesh(mesh.geometry, grabOutlineMaterial);
        shell.userData = { grabOutlineShell: true, pick: false };
        // Grow by an ABSOLUTE rim per axis, so small and large props carry the
        // same visible edge. The scale is about the geometry origin; for these
        // small centred props the rim error that introduces is far below the
        // rim itself.
        shell.scale.set(
          size.x > 1e-6 ? (size.x + GRAB_OUTLINE_RIM * 2) / size.x : 1,
          size.y > 1e-6 ? (size.y + GRAB_OUTLINE_RIM * 2) / size.y : 1,
          size.z > 1e-6 ? (size.z + GRAB_OUTLINE_RIM * 2) / size.z : 1,
        );
        shell.raycast = () => {}; // the outline must never eat the click
        mesh.add(shell);
        grabOutlineShells.push(shell);
      });
    }
  }

  function setGrabOutline(target) {
    const list = (Array.isArray(target) ? target : [target]).filter(Boolean);
    clearGrabHighlight();
    if (!list.length) return;
    applyGrabHighlight(list);
  }

  // THE DIEGETIC TOOLTIP CHIP — the reference's floating price-bubble idea in
  // the game's own toast styling (.register-tip, styles.css): one DOM chip that
  // names what a hover would do. Drawer wells and the offered payment use it.
  const tipChip = document.createElement('div');
  tipChip.className = 'register-tip';
  tipChip.style.display = 'none';
  // Headless test harnesses stub document.body without appendChild; the chip
  // is pure presentation, so it simply stays detached there.
  if (typeof document.body?.appendChild === 'function') {
    document.body.appendChild(tipChip);
  }
  let tipText = '';

  function showTip(text, event) {
    if (!text || !event) {
      hideTip();
      return;
    }
    if (text !== tipText) {
      tipChip.textContent = text;
      tipText = text;
    }
    tipChip.style.display = 'block';
    tipChip.style.left = `${Math.round(event.clientX + 18)}px`;
    tipChip.style.top = `${Math.round(event.clientY - 36)}px`;
  }

  function hideTip() {
    if (tipChip.style.display !== 'none') tipChip.style.display = 'none';
    tipText = '';
  }

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
    if (next !== workspace) workingGlanceActive = false;
    workspace = next;
  }
  let selectedReservationId = null;
  let selectedWalkInCustomerId = null;
  let checkInPage = 0;
  let postSaleDisplay = null;
  // A finished sale is a receipt you glance at, not a screen you dismiss. It used
  // to sit there until the player pressed "Return to Shop" — which is why the
  // only way to serve the next person was to leave the station and walk back in.
  // Held long enough to read the total, then cleared, and cleared instantly the
  // moment someone is actually waiting.
  const POST_SALE_HOLD_S = 5.0;
  let postSaleHold = 0;
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
  let workingGlanceActive = false;
  let enterTimer = 0;
  // bag delivery sequencing (the receipt was removed in round 7):
  // null | 'bag-deliver' | 'bag-customer-hold' | 'released'
  // (+ 'bagging-manual' / 'bag-drag' while the player carries it by hand)
  let deliveryPhase = null;
  let deliveryTimer = 0;

  let selectedItem = null;
  let scanDrag = null;
  let scanMotion = null;
  let lastPhysicalDropEvidence = null;
  const dragPlane = new THREE.Plane();
  const dragPlaneNormal = new THREE.Vector3();
  const dragPlanePoint = new THREE.Vector3();
  const dragHit = new THREE.Vector3();
  const bagDropMotions = [];
  let scanReturnTimer = 0;
  let paymentAutoTimer = 0;
  let paymentAutoSuppressed = false;
  let hoveredItem = null;

  let cardMesh = null;
  let cardU = 0;
  let cardPresentationTimer = 0;
  let cardInsertTimer = 0;
  let cardProcessingTimer = 0;
  let cardResultTimer = 0;
  let cardMessage = '';
  let cardEjectTimer = 0;

  let drawer = null;
  let drawerWant = 0;
  let drawerAmount = 0;
  let drawerGroup = null;
  // Measured 2026-07-30: 5.2 per lamp blew the tray to flat white and erased
  // the very denomination differences the lamps exist to reveal. 1.35 lifts
  // the wells clear of the counter's shadow and keeps the ink.
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
  let pendingChangeConfirmation = null;
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

  function beginCashierEntry(event) {
    if (checkoutFlowState() !== 'WaitingForCashier') return false;
    if (!flowTo('EnteringCashierMode', event)) return false;
    enterTimer = 0.30;
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

  const deskCameraPoint = (localX, y, localZ) => ({
    ...frontDeskPoint(localX, localZ),
    y,
  });

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
  // The working frame must contain the whole physical line, not only the POS.
  // Checkout-physicality round 2026-07-30: the carrier STANDS at the counter's
  // left END again (reference 154454), which no square-on frame can hold
  // together with the POS. The working frame is now the reference's own
  // diagonal — eye near the register block looking down-counter to the left —
  // solved numerically so the upright bag, every staged product, the customer
  // and the complete POS all sit inside the 16:9 safe area at once.
  // Playtest round 5 (2026-07-30): the eye moved from 1.60 to the game's own
  // standing eye line, CHECKOUT_WORKING_EYE_Y — the same height the derived
  // frame is pinned to, so mounting the bag never re-frames the shot. Aimed at
  // the counter it works, that is a ~33° working glance, which is the frame the
  // reference has: counter receding across the lower two thirds, customer
  // cropped through the chest.
  const MIXED_POSE = { pose: poseBetween(
    deskCameraPoint(0.75, CHECKOUT_WORKING_EYE_Y, 1.10),
    deskCameraPoint(0.05, 1.08, 0.00),
  ), fov: CHECKOUT_WORKING_FOV };
  const POSES = {
    overview: MIXED_POSE,
    // Working the screen is done from BELOW it, looking UP. The old pose put the
    // eye at 1.68 looking down to 1.44 — above the glass, staring at the top
    // bezel, which is why the screen read as a distant slab tipped away from you.
    // The POS_Screen face sits ~0.31 above the counter (≈1.37). Dropping the eye
    // to 1.26 and aiming at 1.41 gives ~14.5° of UPWARD look, so the screen faces
    // the camera square instead of raking away.
    checkin: { pose: poseBetween(
      deskCameraPoint(0.52, 1.26, 0.82),
      deskCameraPoint(0.52, 1.41, 0.24),
    ), fov: 44 },
    scan: MIXED_POSE,
    cash: { pose: poseBetween(
      // One stable reference-style frame contains the orange/navy POS summary
      // above and every drawer denomination below.  Keeping it fixed prevents
      // the count crossing "exact" from moving a slot out from under a click.
      deskCameraPoint(0.32, 1.82, 1.46),
      deskCameraPoint(0.22, 1.04, 0.22),
    ), fov: 52 },
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

  function cursorAtLocalHeight(y) {
    root.updateMatrixWorld(true);
    dragPlanePoint.copy(root.localToWorld(new THREE.Vector3(0, y, 0)));
    dragPlaneNormal.set(0, 1, 0).transformDirection(root.matrixWorld);
    dragPlane.setFromNormalAndCoplanarPoint(dragPlaneNormal, dragPlanePoint);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(dragPlane, dragHit)) return null;
    return root.worldToLocal(dragHit.clone());
  }

  // how far the head leans with the cursor: enough to glance around the shop
  // from the till, never enough to lose the station
  const LOOK_YAW_MAX = 0.34;
  const LOOK_PITCH_MAX = 0.16;

  function updateLookTarget(event) {
    // Product clicks must not steer the composed scan view toward the last
    // item and push the next edge item off-screen. Holding Shift deliberately
    // unlocks a smaller, interaction-safe glance; releasing it snaps the view
    // back before the next projected click. Hardware views retain full lean.
    const workingWorkspace = workspace === 'scan' || workspace === 'monitor';
    const scale = checkoutLookScale(workspace, !!event.shiftKey);
    if (accessibilityPrefs.reducedCameraMotion || scale === 0) {
      workingGlanceActive = false;
      lookTargetYaw = 0;
      lookTargetPitch = 0;
      if (workingWorkspace && (lookYaw !== 0 || lookPitch !== 0)) {
        lookYaw = 0;
        lookPitch = 0;
        if (cameraPose) focusOn(cameraPose);
      }
      return;
    }
    workingGlanceActive = workingWorkspace;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const nyRaw = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    lookTargetYaw = -THREE.MathUtils.clamp(nx, -1, 1) * LOOK_YAW_MAX * scale;
    lookTargetPitch = -THREE.MathUtils.clamp(nyRaw, -1, 1) * LOOK_PITCH_MAX * scale;
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
    const fallback = queueSlot(0);
    return new THREE.Vector3(fallback.x, 0, fallback.z); // the head of the counter queue
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
    cardInsertTimer = 0;
    cardU = 0;
    cardMessage = '';
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
      REGISTER.changeHandoff.z,
    ).add(frontDeskOffsetVector3(0, 0, 0.01));
    let pieceIndex = 0;
    for (const [rawDenom, count] of Object.entries(tx.tendered || {})) {
      for (let index = 0; index < count; index += 1) {
        const mesh = makeMoney(Number(rawDenom), 'tender');
        mesh.userData.pick = false;
        mesh.position.copy(bundle).add(frontDeskOffsetVector3(
          ((pieceIndex % 3) - 1) * 0.012,
          Math.floor(pieceIndex / 3) * 0.005,
          (pieceIndex % 2 ? 1 : -1) * 0.008,
        ));
        mesh.rotation.copy(frontDeskEuler(
          0,
          BILLS.includes(mesh.userData.denom) ? Math.PI / 2 : 0,
          0,
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
      setWorkspace(resumeState === 'WaitingForScan' ? 'scan' : 'monitor');
      if (resumeState === 'AllProductsScanned') {
        paymentAutoTimer = AUTO_PAYMENT_HOLD;
        paymentAutoSuppressed = false;
      }
      return { ok: true };
    }

    if (resumeState === 'ChoosingPayment') {
      if (tx.stage !== 'scanning' || unscannedCount(tx) !== 0) {
        return { ok: false, reason: 'Payment choice no longer matches the scanned basket.' };
      }
      setWorkspace('monitor');
      return { ok: true };
    }

    if (resumeState === 'CardInsertReady' || resumeState === 'CardAmountEntry') {
      if (tx.method !== 'card' || tx.stage !== 'card-ready') {
        if (!(resumeState === 'CardAmountEntry' && tx.stage === 'card-entry')) {
          return { ok: false, reason: 'Card recovery lost its unapproved insertion checkpoint.' };
        }
      }
      clearCardWatchdogWork();
      cardReady.copy(customerCardReadyPoint());
      if (!cardMesh) createCardMesh();
      if (resumeState === 'CardAmountEntry') {
        refreshCardInsertPath();
        if (cardMesh) {
          if (cardMesh.parent !== root) root.attach(cardMesh);
          cardMesh.position.copy(cardInserted);
          cardMesh.quaternion.copy(cardInsertQuaternion);
        }
      } else if (cardMesh) {
        if (cardMesh.parent !== root) root.attach(cardMesh);
        cardMesh.position.copy(cardReady);
        attachCardToCustomerHand();
      }
      setWorkspace('card');
      return { ok: true };
    }

    if (resumeState === 'CardPresented') {
      clearCardWatchdogWork();
      if (fromState === 'CardProcessing') {
        const rollback = recoverUnresolvedCardAuthorization(tx);
        if (!rollback.ok) return rollback;
      }
      // 'card-ready' counts. A card the customer is HOLDING OUT is every bit as
      // unresolved as one about to be drawn — insisting on 'card-present' made
      // every CardInsertReady/CardInserting recovery unreconcilable, which is
      // what parked the flow in Recovery and killed the till (2026-08-03).
      // Re-presenting from 'card-ready' is the same beat: the presentation
      // timer's else-branch re-arms CardInsertReady and, with cardAccepted
      // cleared below, puts the card back in the customer's hand.
      if (tx.method !== 'card' || !['card-present', 'card-ready'].includes(tx.stage)) {
        return { ok: false, reason: 'Card presentation recovery has no unresolved card.' };
      }
      if (cardMesh) cardMesh.removeFromParent();
      cardMesh = null;
      createCardMesh();
      cardPresentationTimer = 0.55;
      cardAccepted = false;
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
    if (resumeState === 'AllProductsScanned') {
      paymentAutoTimer = AUTO_PAYMENT_HOLD;
      paymentAutoSuppressed = false;
      return true;
    }
    if (resumeState === 'ChoosingPayment') return true;
    if (resumeState === 'CashAccepted') {
      cashRecoveryTimer = 0.22;
      return true;
    }
    if (resumeState === 'PaymentComplete' || resumeState === 'ReceiptPrinting') {
      beginAutomaticReceipt();
      return true;
    }
    if (resumeState === 'Bagging') {
      if (transactionKind === 'retail') {
        return durableProjectRetailFulfillment();
      }
      // no receipt exists to restage — the remaining physical work is the bag
      for (const item of tx.items) {
        const mesh = itemMeshes.get(item.uid);
        if (mesh && item.scanned && !item.bagged) setObjectPickable(mesh, true);
      }
      deliveryPhase = 'bagging-manual';
      return true;
    }
    if (resumeState === 'CustomerLeaving') {
      if (tx.stage === 'done' && deliveryPhase === 'released') {
        autoFulfilled = true;
        finalizeTimer = 0.2;
      }
      return true;
    }
    return false;
  }

  function updateCashWatchdogRecovery(dt) {
    if (cashRecoveryTimer <= 0) return false;
    cashRecoveryTimer = Math.max(0, cashRecoveryTimer - dt);
    if (cashRecoveryTimer > 0) return true;
    layoutAcceptedTender();
    setWorkspace('cash');
    toast('Cash restored safely. Press D to reopen the drawer.');
    return true;
  }

  // The last resort behind the watchdog: give the player a working till back.
  // No money has moved (abandonCheckoutRecovery refuses an authorized sale), so
  // the card run is pulled at the domain level and the flow returns to the scan
  // checkpoint with the basket intact — the same place the reader's X lands.
  function releaseUnreconcilableRecovery(nowMs) {
    const flow = tx && tx.checkoutFlow;
    if (!flow) return { ok: false, reason: 'No checkout flow to release.' };
    const facts = checkoutWatchdogFacts();
    const released = abandonCheckoutRecovery(flow, { nowMs: nowMs + 0.001, facts });
    if (!released.ok) return released;
    if (tx.method === 'card') {
      // pre-submit pulls the run; anything later already failed the authorized
      // guard above, so cancelCard is the honest fallback for a card-stage tx
      if (!abandonCardBeforeSubmit(tx).ok && String(tx.stage).startsWith('card')) {
        cancelCard(tx);
      }
    }
    syncFlow(released.flow);
    clearCardWatchdogWork();
    if (cardMesh) cardMesh.removeFromParent();
    cardMesh = null;
    cardAccepted = false;
    cardPresentationTimer = 0;
    // …and re-arm the automatic payment beat, or the sale would sit at a
    // post-scan monitor that never asks for payment again.
    paymentAutoTimer = AUTO_PAYMENT_HOLD;
    paymentAutoSuppressed = false;
    customerPalm.visible = false;
    setWorkspace('monitor');
    return released;
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
        // NEVER PARK HERE. Recovery only permits its stored resume state, so a
        // checkpoint the renderer cannot rebuild used to leave every later verb
        // refused — a dead register with a customer still at it. Let go instead:
        // pull the unauthorized card run and drop back to the scan checkpoint.
        const released = releaseUnreconcilableRecovery(nowMs);
        checkoutWatchdogEvents.push({
          atMs: nowMs, fromState, resumeState, ok: false, reason: reconciled.reason,
          released: released.ok, releasedTo: released.resumeState || null,
          releaseReason: released.ok ? null : released.reason,
          recoverySequence: entered.flow.sequence,
        });
        checkoutWatchdogEvents.splice(0, Math.max(0, checkoutWatchdogEvents.length - 16));
        toast(released.ok
          ? `Checkout recovered to the scanned basket: ${reconciled.reason}`
          : `Checkout recovery paused safely: ${reconciled.reason}`, 'warn');
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
    return new THREE.Vector3(at.x, yOffset, at.z)
      .add(frontDeskOffsetVector3(0, 0, 0.18));
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
    // Keep the fallback handoff on local customer -z, just beyond the counter
    // edge. Desk-local authoring makes card and cash direction survive ry = PI.
    const local = frontDeskLocalPoint(at.x, at.z);
    const hand = frontDeskPoint(
      THREE.MathUtils.clamp(local.x, -0.90, 0.50),
      -0.30,
    );
    return new THREE.Vector3(hand.x, y, hand.z);
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
      if (cashMotions.some((motion) => motion.kind === 'cash-deposit')) return 'STOWING CASH';
      const delta = Math.round((handTotal(tx) - changeDue(tx)) * 100);
      return delta === 0 ? 'CHANGE READY' : 'SELECT CHANGE';
    }
    if (tx.stage === 'cash-drawer') return 'SORT RECEIVED CASH';
    if (tx.stage === 'cash-tender') return 'CASH PRESENTED';
    if (tx.stage === 'card-ready') return 'INSERTING CARD';
    if (tx.stage === 'card-entry') return 'ENTER CARD TOTAL';
    if (tx.stage === 'card-present') return 'CARD PRESENTED';
    if (unscannedCount(tx) === 0) return 'ALL ITEMS BAGGED';
    return workspace === 'scan' ? 'RINGING PRODUCTS' : 'PRODUCTS READY';
  }

  function checkoutInstruction() {
    if (!tx) return 'The register is ready for the next customer.';
    if (tx.stage === 'scanning') {
      if (unscannedCount(tx)) return 'Click each product once to ring it up and place it in the bag.';
      return `All items are bagged. The customer’s ${preferredPayment() === 'cash' ? 'cash' : 'card'} is being prepared.`;
    }
    if (tx.stage === 'card-present') return 'The customer is handing their card across the counter.';
    if (tx.stage === 'card-ready') return 'The customer’s card is inserting automatically.';
    if (tx.stage === 'card-entry') return 'Type the exact total on the terminal, then press OK.';
    if (tx.stage === 'card-busy') return 'The card reader is processing the payment.';
    if (tx.stage === 'card-declined') return 'Try a replacement card or switch this transaction to cash.';
    if (tx.stage === 'cash-tender') return 'Click the customer’s cash; the drawer will open and stow it automatically.';
    if (tx.stage === 'cash-drawer' && !tx.deposited) return 'The register is stowing the received cash.';
    if (tx.stage === 'cash-drawer') {
      if (cashMotions.some((motion) => motion.kind === 'cash-deposit')) {
        return 'Received cash is moving into the drawer. Change controls unlock when it settles.';
      }
      if (exactChangeAssistancePending) return 'The register will count exact change from the available drawer pieces.';
      if (shouldAutoConfirmExactChange(accessibilityPrefs, changeGivingState(tx).state)) {
        return 'Exact change is ready and will be handed over automatically.';
      }
      return 'Click drawer money to count change: exact, or up to $5.00 extra.';
    }
    if (deliveryPhase === 'bag-deliver') return 'The bag is being handed to the customer.';
    // no receipt exists (round 7) — the stage is pure paperwork and passes
    // in the same frame it is reached
    if (tx.stage === 'receipt') return 'Payment is accepted.';
    if (tx.stage === 'bagging') {
      const hasSeparateHandoff = tx.items.some((item) => !item.bagged
        && itemMeshes.get(item.uid)?.userData?.catalogVisual?.separateHandoff);
      return hasSeparateHandoff
        ? 'Drag full-size purchases to the customer\'s free hand; put compact goods in the shopping bag.'
        : 'Drag every paid product into the shopping bag.';
    }
    if (tx.stage === 'done') return 'Grip the bag handles and drag them to the customer’s open palm.';
    return 'Follow the front-desk prompts.';
  }

  function clearPostSale() {
    if (!postSaleDisplay) return false;
    postSaleDisplay = null;
    postSaleHold = 0;
    activeTab = 'checkout';
    assignWorkspace('monitor');
    drawScreen();
    drawTerm();
    return true;
  }

  function checkoutActions() {
    if (postSaleDisplay && !tx) {
      // "Ready for the next customer" leads, because that is what happens next
      // in a shop. Returning to the floor is the secondary act, not — as it was
      // — the ONLY thing on offer, which is why serving a second person meant
      // walking out of the station and back into it.
      //
      // Deliberately not a count. The register learns about a retail shopper
      // when the clubhouse loop hands it one; it cannot see who is queueing, and
      // a label that guessed would be wrong exactly when the shop is busy.
      return [
        { id: 'clear-post-sale', label: 'Ready for the next customer', kind: 'primary' },
        { id: 'exit', label: 'Return to Shop' },
      ];
    }
    if (!tx) return [];
    if (tx.stage === 'scanning') {
      if (unscannedCount(tx) > 0) {
        return workspace === 'monitor'
          ? [{ id: 'start-scanning', label: 'Ring Up Products', kind: 'primary' }]
          : [];
      }
      return [];
    }
    if (['card-present', 'card-ready', 'card-entry'].includes(tx.stage)) return [];
    if (tx.stage === 'card-busy') return [];
    if (tx.stage === 'card-declined') {
      return [
        { id: 'retry-card', label: 'Try Another Card', kind: 'primary' },
        { id: 'card-to-cash', label: 'Switch to Cash', kind: 'cash' },
      ];
    }
    // The dedicated cash screen owns Undo/Clear while the physical customer
    // palm is the only completion target; the checkout summary offers nothing.
    if (tx.stage === 'cash-tender' || tx.stage === 'cash-drawer') return [];
    if (tx.stage === 'receipt') return [];
    if (tx.stage === 'bagging' || tx.stage === 'done') {
      // The delivery pipeline banks the sale by itself the moment the receipt
      // (and bag) reach the customer — flashing a one-second Complete button
      // during that animation only begs for a pointless race. The button
      // exists solely as a recovery handle if the automatic path ever stalls.
      if (autoFulfilled) return [];
      return [{ id: 'retry-fulfillment', label: 'Retry Handoff', kind: 'success' }];
    }
    return [];
  }

  const finiteOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  function monitorModel() {
    if (activeTab === 'home') {
      return {
        app: 'home',
        heading: `${displayClubName()} Front Desk`,
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
      // SALES TAX ON THE CUSTOMER-FACING SUMMARY.
      //
      // Measured 2026-07-29 (qa/.../cash/12b-receipt-printing.png): the monitor read
      // SUBTOTAL $35.72, DISCOUNT $0.00, TOTAL $38.22 — the customer was being asked for
      // $2.50 that nothing on the screen accounted for. The line is always sent, including at
      // 0%, so the label can say the jurisdiction either way.
      tax: tx ? taxOf(tx) : finiteOr(display.tax, 0),
      taxRate: tx ? (Number(tx.taxRate) || 0) : (Number(display.taxRate) || 0),
      taxLabel: tx ? (tx.taxLabel || null) : (display.taxLabel || null),
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
    syncPhysicalBrand();
    monitorUi.draw({
      ...monitorModel(),
      clubName: displayClubName(),
      accessibility: checkoutMonitorAccessibility(accessibilityPrefs),
    });
    screenTexture.needsUpdate = true;
  }

  // The terminal's OWN screen. It is the only place card-payment state renders:
  // IDLE → AUTO INSERT → AMOUNT KEYPAD → PROCESSING → APPROVED.
  let termDotsTimer = 0;
  let termRenderSignature = null;

  function terminalVisualSignature() {
    const brand = displayClubName().toUpperCase();
    if (!tx || tx.method !== 'card') return `ready|${brand}`;
    const stage = tx.stage;
    const common = `${stage}|${totalOf(tx).toFixed(2)}|${terminalXVisible() ? 1 : 0}`;
    if (stage === 'card-present' || stage === 'card-ready') {
      return `${common}|${cardMessage || ''}`;
    }
    if (stage === 'card-entry') {
      return `${common}|${tx.cardEntryDigits || ''}|${tx.cardEntryError || ''}`;
    }
    if (stage === 'card-busy') {
      return `${common}|${terminalBusyDotPhase(termDotsTimer)}`;
    }
    if (stage === 'card-declined') return `${common}|${tx.cardResult || ''}`;
    if (['receipt', 'bagging', 'done'].includes(stage)) return `approved|${totalOf(tx).toFixed(2)}`;
    return common;
  }

  // THE REFERENCE READER'S BANDED FACE (Designs/CashRegister/Final 154606 /
  // 154618), polished for round 7 ("make the card reader look a lot better as
  // far as the UI on the screen"): a rounded glass card with a soft edge
  // shadow, a branded status strip, a caption band and a deep-navy amount band
  // — both with a gentle vertical gradient so they read as lit LCD rather than
  // flat fills — and the hint line set in a pill chip. Everything stays
  // LEFT-ALIGNED like the reference; the keypad remains physical.
  const TERM_PAD = 10;
  function termRoundedPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // THE READER'S FACE (round 10, 2026-08-03).
  //
  // What this replaced: a stack of full-bleed gradient bands — a slate status
  // strip, a mid-blue caption band, a navy amount band, and the prompt in a
  // tinted pill. Four competing backgrounds on a 70 mm screen, with the amount
  // no more prominent than the word above it. Reported as "the DUE / TOTAL
  // panel reads dated".
  //
  // What replaces it is how a current payment terminal actually reads: ONE
  // ground, and hierarchy carried by type and space instead of by coloured
  // boxes. A quiet status line at the top; a small letterspaced eyebrow naming
  // what the figure is; the figure itself dominant, left-aligned on a real
  // margin; a hairline; the prompt small and muted underneath. Colour appears
  // once, as the accent — green normally, red on a decline or an entry error —
  // and never as a background.
  //
  // K5 (2026-08-05): that ground was near-black (#0D1211, luma 17/255) and was
  // judged "too dark. Lighten it. Keep the amount dominant." Lightening a dark
  // ground under a near-white figure can only CUT the figure's contrast, so
  // the theme flips polarity instead — light glass, near-black amount — the
  // way a real terminal's light mode reads. Both themes are measured on the
  // live canvas by tools/qa/reader-theme-shots.js (K5_LEG=before|after); the
  // measured deltas live in qa/electron/reader-theme-k5/. The hierarchy
  // (152 px figure over a 52 px KEYED line) is untouched.
  const TERM_INK = '#0B100D';
  const TERM_INK_MUTED = '#5E6C64';
  const TERM_ACCENT = '#178A52';
  const TERM_WARN = '#BC3F30';
  // canvas letterSpacing is Chromium-only; the caps still read without it
  const setTermTracking = (ctx, px) => {
    try { ctx.letterSpacing = `${px}px`; } catch { /* older canvas */ }
  };
  function paintTermBandedFace(ctx, W, H, {
    caption, amount, footer, caret = false, accent = TERM_ACCENT,
    // C13 — the running entry, drawn UNDER the dominant figure rather than in
    // place of it. `caret` follows this line when it is present.
    entry = null, entryLabel = 'KEYED',
    // retained so the older call shape stays valid; the face no longer paints
    // bands, so these only pick the accent
    footerInk = null, amountInk = null,
  }) {
    const tone = footerInk || accent;
    const x0 = TERM_PAD;
    const w = W - TERM_PAD * 2;
    const inner = H - TERM_PAD * 2;
    const left = x0 + 34;              // the margin everything hangs off
    ctx.save();
    termRoundedPath(ctx, x0, TERM_PAD, w, inner, 16);
    ctx.fillStyle = '#F4F7F4';
    ctx.fill();
    ctx.clip();

    // --- status line ---------------------------------------------------------
    const statusY = TERM_PAD + 40;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.arc(left + 5, statusY, 6, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    setTermTracking(ctx, 2.2);
    ctx.font = '600 21px Arial, sans-serif';
    ctx.fillStyle = TERM_INK_MUTED;
    ctx.fillText('PAYMENT', left + 24, statusY + 1);
    // measured while the tracked font is still set, or the gap is understated
    const paymentEnd = left + 24 + ctx.measureText('PAYMENT').width;
    setTermTracking(ctx, 0);
    // …and the club name after it, clear of BOTH neighbours. The cancel X is
    // drawn last over everything, so a name right-aligned to the glass edge
    // vanishes under it; a name sized only against the X ran into "PAYMENT"
    // instead. Give it the measured gap on the left and the badge on the right,
    // and let it shrink into whatever is actually free.
    const brandRight = TERM_X_BOX.x0 - 18;
    const brandLeft = paymentEnd + 34;
    const brandName = displayClubName().toUpperCase();
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(94,108,100,0.80)';
    setFittedCanvasFont(ctx, brandName, {
      maxWidth: Math.max(60, brandRight - brandLeft), startSize: 18, minimumSize: 11, weight: 600,
    });
    ctx.fillText(brandName, brandRight, statusY + 1);
    ctx.fillStyle = 'rgba(15,23,18,0.14)';
    ctx.fillRect(left, statusY + 30, w - 68, 2);

    // --- the eyebrow: what the figure below IS -------------------------------
    ctx.textAlign = 'left';
    setTermTracking(ctx, 3.4);
    ctx.font = '700 22px Arial, sans-serif';
    ctx.fillStyle = tone;
    ctx.fillText(String(caption).toUpperCase(), left, statusY + 88);
    setTermTracking(ctx, 0);

    // --- the figure, dominant ------------------------------------------------
    // C13: 118 -> 152. This is the only number on the glass that decides
    // anything, and at 118 it shared the frame with a 25 px line carrying the
    // amount owed. It is fitted, so a five-figure ticket still shrinks to fit
    // rather than running off the edge.
    const amountY = statusY + (entry ? 158 : 176);
    ctx.fillStyle = amountInk || TERM_INK;
    const amountSize = setFittedCanvasFont(ctx, amount, {
      maxWidth: w - 68 - (caret && !entry ? 26 : 0), startSize: 152, minimumSize: 46, weight: 800,
    });
    ctx.fillText(amount, left, amountY);
    if (caret && !entry) {
      // where the next digit lands, sized off the figure it follows
      ctx.fillStyle = accent;
      ctx.fillRect(
        left + ctx.measureText(amount).width + 12,
        amountY - amountSize * 0.36,
        8,
        amountSize * 0.72,
      );
    }

    // --- the running entry, clearly legible but not the headline -------------
    let tailY = amountY;
    if (entry) {
      // +96, not +76: the dominant figure is 152 px, so its glyphs reach about
      // 55 px below its baseline and a label 46 px under it was drawn straight
      // into them. Photographed at the counter before the gap was widened.
      const entryY = amountY + 96;
      setTermTracking(ctx, 2.6);
      ctx.font = '700 20px Arial, sans-serif';
      ctx.fillStyle = TERM_INK_MUTED;
      ctx.fillText(entryLabel, left, entryY - 34);
      setTermTracking(ctx, 0);
      ctx.fillStyle = amountInk || TERM_INK;
      const entrySize = setFittedCanvasFont(ctx, entry, {
        maxWidth: w - 68 - (caret ? 26 : 0), startSize: 52, minimumSize: 26, weight: 700,
      });
      ctx.fillText(entry, left, entryY);
      if (caret) {
        ctx.fillStyle = accent;
        ctx.fillRect(
          left + ctx.measureText(entry).width + 10,
          entryY - entrySize * 0.36,
          6,
          entrySize * 0.72,
        );
      }
      tailY = entryY;
    }

    // --- the prompt, secondary ----------------------------------------------
    if (footer) {
      ctx.fillStyle = 'rgba(15,23,18,0.14)';
      ctx.fillRect(left, tailY + 44, w - 68, 2);
      setTermTracking(ctx, 1.4);
      ctx.fillStyle = footerInk ? tone : TERM_INK_MUTED;
      setFittedCanvasFont(ctx, footer, {
        maxWidth: w - 68, startSize: 25, minimumSize: 16, weight: 600,
      });
      ctx.fillText(footer, left, tailY + 78);
      setTermTracking(ctx, 0);
    }

    // a single hairline edge, so the glass reads as glass and not as a hole
    termRoundedPath(ctx, x0 + 1.5, TERM_PAD + 1.5, w - 3, inner - 3, 15);
    ctx.strokeStyle = 'rgba(15,23,18,0.20)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }


  function drawTerm() {
    const signature = terminalVisualSignature();
    if (signature === termRenderSignature) return false;
    const ctx = termContext;
    const W = termCanvas.width;
    const H = termCanvas.height;
    ctx.fillStyle = '#1A211D';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = termGlow;
    ctx.fillRect(6, 6, W - 12, H - 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cardActive = !!(tx && tx.method === 'card');
    if (!cardActive) {
      const brand = displayClubName().toUpperCase();
      ctx.fillStyle = '#1B241F';
      setFittedCanvasFont(ctx, brand, {
        maxWidth: W - 70,
        startSize: 58,
        minimumSize: 28,
      });
      ctx.fillText(brand, W / 2, H * 0.40);
      ctx.fillStyle = '#5E6C64';
      ctx.font = '600 34px Arial, sans-serif';
      ctx.fillText('READY', W / 2, H * 0.62);
      termRenderSignature = signature;
      termTexture.needsUpdate = true;
      return true;
    }

    const stage = tx.stage;
    if (stage === 'card-present' || stage === 'card-ready') {
      paintTermBandedFace(ctx, W, H, {
        caption: cardMessage ? String(cardMessage) : 'Insert card',
        amount: `$${totalOf(tx).toFixed(2)}`,
        footer: 'CLICK THE OFFERED CARD TO TAKE IT',
      });
    } else if (stage === 'card-entry') {
      // THE GLASS SHOWS THE AMOUNT DUE AND THE AMOUNT BEING TYPED. The dots-
      // like-a-PIN-pad take (2026-07-29) lasted one playtest: with the reader
      // floating at the face, hiding the entry made keying the total feel like
      // guesswork. The keypad stays physical — the canvas draws no keys — but
      // the running figure renders live as it is typed (2026-07-30 ruling).
      // C13 reverses which of the two is the headline. Round 10 made the
      // eyebrow name the big figure - the amount being KEYED - which pushed
      // what is OWED into a 25 px footer line. "It is the one number that
      // matters on that display and it should dominate everything else on the
      // glass": the amount due is the target you are keying toward, and it was
      // the smallest text on the face. It is the 152 px figure now.
      //
      // Round 10's finding still holds and is NOT undone - hiding the entry
      // made keying the total feel like guesswork - so the running figure
      // stays live, labelled KEYED and carrying the caret. At 52 px it is
      // plainly readable and plainly not the headline.
      const typed = String(tx.cardEntryDigits || '').length
        ? `$${cardEnteredAmount(tx).toFixed(2)}`
        : '$0.00';
      paintTermBandedFace(ctx, W, H, {
        caption: 'Amount due',
        amount: `$${totalOf(tx).toFixed(2)}`,
        entry: typed,
        entryLabel: 'KEYED',
        caret: true,
        accent: tx.cardEntryError ? TERM_WARN : TERM_ACCENT,
        footer: tx.cardEntryError ? tx.cardEntryError.toUpperCase() : 'PRESS OK TO SUBMIT',
        footerInk: tx.cardEntryError ? TERM_WARN : null,
      });
    } else if (stage === 'card-busy') {
      const dots = '.'.repeat(1 + (Math.floor(termDotsTimer * 3) % 3));
      paintTermBandedFace(ctx, W, H, {
        caption: `Processing${dots}`,
        amount: `$${totalOf(tx).toFixed(2)}`,
        footer: 'AUTHORIZING - DO NOT REMOVE THE CARD',
      });
    } else if (stage === 'card-declined') {
      paintTermBandedFace(ctx, W, H, {
        caption: tx.cardResult === 'timeout' ? 'Timeout' : 'Declined',
        amount: `$${totalOf(tx).toFixed(2)}`,
        accent: TERM_WARN,
        footer: 'TRY ANOTHER CARD OR CASH',
        footerInk: TERM_WARN,
      });
    } else if (['receipt', 'bagging', 'done'].includes(stage)) {
      paintTermBandedFace(ctx, W, H, {
        caption: 'Approved',
        amount: `$${totalOf(tx).toFixed(2)}`,
        accent: TERM_ACCENT,
        footer: 'THANK YOU',
        footerInk: TERM_ACCENT,
      });
    } else {
      const brand = displayClubName().toUpperCase();
      ctx.fillStyle = '#1B241F';
      setFittedCanvasFont(ctx, brand, {
        maxWidth: W - 70,
        startSize: 50,
        minimumSize: 26,
      });
      ctx.fillText(brand, W / 2, H * 0.45);
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
    // The hit region reaches the glass's top edge. Measured 2026-07-30 on the
    // floated reader: a click at the projected centre of the drawn X (canvas
    // y 40) ray-hits the plane at y≈5 — a stable ~35 px vertical offset between
    // the forward projection and the pick ray whose root cause did not yield
    // to instrumentation this pass. Accepting the whole top-right corner strip
    // is visually the same target and tolerant of the offset in either
    // direction; nothing else is drawn in that corner.
    return px >= TERM_X_BOX.x0 - pad && px <= TERM_X_BOX.x1 + pad
      && py >= 0 && py <= TERM_X_BOX.y1 + pad;
  }

  function terminalKeyAt(event) {
    if (!tx || tx.stage !== 'card-entry') return null;
    if (!terminalKeyPickables.length) return null;
    // The keys are MESHES on the reader's deck, so a press is a raycast against
    // them — not a UV lookup on the screen canvas, which no longer draws keys.
    const cast = (offsetX, offsetY) => {
      setNdc({ clientX: event.clientX + offsetX, clientY: event.clientY + offsetY });
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(terminalKeyPickables, false)[0];
      return hit ? hit.object.userData.terminalKeyAction : null;
    };
    let action = cast(0, 0);
    if (!action) {
      // A NEAR MISS IS STILL A PRESS. The caps are ~2 cm of modelled plastic
      // with 4 mm gutters; on screen the gutters are wide enough that ordinary
      // aim lands between keys and nothing happens — the "keys do nothing"
      // report (playtest 2026-07-30). Sample outward rings and take the first
      // key found, so the nearest cap wins and a click in the gutter still
      // presses the key the player was aiming at. Large-target accessibility
      // widens the same search rather than being the only thing that enables it.
      const reach = accessibilityPrefs.largeTextAndTargets ? 22 : 13;
      for (let radius = 5; radius <= reach && !action; radius += 4) {
        for (let step = 0; step < 8 && !action; step += 1) {
          const angle = (step / 8) * Math.PI * 2;
          action = cast(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
      }
    }
    return action ? { id: action } : null;
  }

  function handleTerminalKey(action) {
    if (!action || !tx || tx.stage !== 'card-entry') return false;
    let result = null;
    if (action.startsWith('digit:')) {
      result = enterCardDigit(tx, Number(action.slice('digit:'.length)));
    } else if (action === 'clear') {
      result = clearCardAmount(tx);
    } else if (action === 'backspace') {
      result = backspaceCardAmount(tx);
    } else if (action === 'confirm') {
      result = submitCardAmount(tx);
      if (result.ok) {
        cardProcessingTimer = CARD_TIME;
        termDotsTimer = 0;
        hooks.clearToasts?.('checkout');
        if (checkoutFlowState() === 'CardAmountEntry') {
          flowTo('CardProcessing', 'player-submitted-exact-card-total');
        }
        sfx('cardProcessing');
      }
    }
    if (!result?.ok) {
      toast(result?.reason || 'That key is unavailable.', 'warn');
      sfx('thunk');
    } else if (action !== 'confirm') {
      sfx('uiTick');
    }
    if (result?.ok) pulseTerminalKey(action); // the physical key visibly gives
    drawTerm();
    drawScreen();
    return true;
  }

  // Pull the card run from the reader's X. Legal only before submit; returns the
  // sale to the post-scan choice point so the player can deliberately total it
  // again. The card mesh goes back to the customer.
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
    cardMessage = '';
    cardPresentationTimer = 0;
    cardInsertTimer = 0;
    cardEjectTimer = 0;
    // Cancellation returns to the readable post-scan beat, then the same
    // customer preference starts again automatically. With no manual payment
    // buttons in the simple flow, leaving this suppressed would strand the
    // transaction after a perfectly valid X click.
    paymentAutoTimer = AUTO_PAYMENT_HOLD;
    paymentAutoSuppressed = false;
    bagDropMotions.length = 0;
    customerPalm.visible = false;
    setWorkspace('monitor');
    drawScreen();
    drawTerm();
    return true;
  }

  // The cash screen lives ON THE POS MONITOR (monitorUi's 'cash' app), exactly
  // like the reference: orange Received/Total/Change block, navy Giving strip,
  // and Undo/Clear buttons — one display, directly above the open drawer.
  function cashScreenModel() {
    const received = tx
      ? (tx.tenderedTotal != null ? Number(tx.tenderedTotal) : stackTotal(tx.tendered || {}))
      : 0;
    const giving = tx ? changeGivingState(tx) : null;
    const canFinish = giving && (giving.state === 'exact' || giving.state === 'over');
    const cashActions = tx && tx.deposited ? [
      { id: 'undo-change', label: 'Undo', kind: 'secondary', disabled: !selectedChangeMeshes.length },
      { id: 'clear-change', label: 'Clear', kind: 'secondary', disabled: !selectedChangeMeshes.length },
      { id: 'confirm-change', label: 'Done', kind: 'primary', disabled: !canFinish },
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
    registerObject.scale.multiplyScalar(POS_HARDWARE_SCALE);
    registerFurniture = registerObject;
    screenPlane = plane;
    cashPoseCache = null; // the drawer view solves against the mounted glass
    drawScreen();
  }

  function attachTerm(terminal) {
    // THE READER PARKS IN THE DEVICE BAY (round 7, 2026-07-31 reference): it
    // stands propped in the glowing tray on the desk's front edge — VISIBLE
    // between card sales, exactly like the screenshot — and rises to the
    // player's face when a card payment starts.
    const seatSpot = frontDeskPoint(
      BAY.localX - 0.11,
      COUNTER.depth / 2 + 0.004 + BAY.reach * BAY.seatDepthFrac,
    );
    terminal.position.set(seatSpot.x, COUNTER_TOP - BAY.belowTop - BAY.height / 2 + 0.004, seatSpot.z);
    terminal.quaternion.copy(frontDeskQuaternion(BAY.seatPitch, 0, 0));
    terminal.scale.multiplyScalar(TERMINAL_HARDWARE_SCALE);
    termBaseScale = terminal.scale.x;
    termObject = terminal;
    suppressLegacyCheckoutBrandNodes(terminal, 'paymentTerminal');

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

    termSeatPosition = terminal.position.clone();
    termSeatQuaternion = terminal.quaternion.clone();
    terminalFloat = 0;
    // The float aims the device's CENTRE at the eye line, so measure where the
    // centre sits relative to the origin. The origin is the BASE (it stood on
    // the counter), and floating the base to eye height put the glass ~0.45 m
    // above the viewport — measured 2026-07-30: the X projected at page
    // y = -441 and the acceptance stability gate starved forever.
    terminal.updateWorldMatrix(true, true);
    const termBox = new THREE.Box3().setFromObject(terminal);
    termCentreOffsetY = termBox.isEmpty()
      ? 0.10
      : termBox.getCenter(new THREE.Vector3()).y - terminal.getWorldPosition(new THREE.Vector3()).y;
    // PARK SMALL. The centre offset above is measured at working scale (the
    // float aims the full-size device); only after measuring does the parked
    // pocket size apply, and updateTerminalFloat swells it back on the rise.
    terminal.scale.setScalar(termBaseScale * BAY.parkScale);
    // ...AND SEAT IT BY MEASUREMENT, NOT BY ASSUMPTION. Round 7 placed the
    // reader by assuming its origin was its base; probed 2026-08-02 the kit
    // model hangs 0.037 BELOW its own origin, so the parked device sank
    // through the alcove floor — the other half of "they look like they are
    // phasing through". Measure the real box in the BAY's own frame and lift
    // and push it until every corner is inside, whatever the GLB's origin is.
    terminal.updateWorldMatrix(true, true);
    terminalBay.updateWorldMatrix(true, false);
    const seatedBox = new THREE.Box3().setFromObject(terminal);
    if (!seatedBox.isEmpty()) {
      const lowFront = terminalBay.worldToLocal(
        new THREE.Vector3(seatedBox.min.x, seatedBox.min.y, seatedBox.min.z),
      );
      const highBack = terminalBay.worldToLocal(
        new THREE.Vector3(seatedBox.max.x, seatedBox.max.y, seatedBox.max.z),
      );
      const floorY = -BAY.height / 2;
      const nearestZ = Math.min(lowFront.z, highBack.z);
      const lowestY = Math.min(lowFront.y, highBack.y);
      const lift = Math.max(0, floorY + 0.004 - lowestY);
      const push = Math.max(0, 0.012 - nearestZ);
      if (lift > 0 || push > 0) {
        // bay and terminal are both children of root, so a bay-local delta
        // rotates into root-local by the bay's own quaternion
        terminal.position.add(
          new THREE.Vector3(0, lift, push).applyQuaternion(terminalBay.quaternion),
        );
      }
    }
    // The authored card socket anchors the automatic chip insertion path.
    cardSocketNode = terminal.getObjectByName('CARD_INSERT_SOCKET') || null;
    collectTerminalKeys(terminal);
    refreshCardInsertPath();
    drawTerm();
  }

  // The customer-held pose stays independent from the reader. The authored
  // chip socket below anchors one short automatic insertion.
  const HELD_QUAT = frontDeskQuaternion(CARD_HELD_PITCH, 0, 0);
  // C11 — where a finished card lies: flat on the counter beside the reader, on
  // the customer's side of the goods lane, a card's thickness proud of the top
  // so it reads as resting rather than inlaid.
  //
  // Pitch ZERO, not -PI/2. The card model is already thin in its own Y (the
  // fallback is BoxGeometry(w, CARD_THICKNESS, h)), so identity IS flat and a
  // quarter turn stands it on edge — measured 38.4 mm of vertical extent and
  // 15.5 mm below the counter top before this was corrected.
  const CARD_FLAT_QUAT = frontDeskQuaternion(0, 0, 0);
  const cardDeskRest = new THREE.Vector3(
    CARD_STATION.x, COUNTER_TOP + 0.004, CARD_STATION.z,
  ).add(frontDeskOffsetVector3(0.22, 0, -0.20));
  const cardReady = new THREE.Vector3(
    CARD_STATION.x, COUNTER_TOP + 0.22, CARD_STATION.z,
  ).add(frontDeskOffsetVector3(0.30, 0, -0.12));
  const cardInsertStart = new THREE.Vector3(
    CARD_STATION.x, COUNTER_TOP + 0.18, CARD_STATION.z,
  );
  const cardInserted = new THREE.Vector3(
    CARD_STATION.x, COUNTER_TOP + 0.08, CARD_STATION.z,
  );
  const cardInsertQuaternion = frontDeskQuaternion(Math.PI / 2, 0, Math.PI / 2);

  function refreshCardInsertPath() {
    if (!cardSocketNode) return false;
    // Own-chain updates only: this runs every frame while a card is in the
    // reader, and a full descendant walk of the register root (drawer, bag,
    // every staged product) would be paid for nothing — worldToLocal needs the
    // root's own matrix and the socket's own chain, nothing below them.
    root.updateWorldMatrix(true, false);
    cardSocketNode.updateWorldMatrix(true, false);
    const socketWorld = cardSocketNode.getWorldPosition(new THREE.Vector3());
    const socketQuaternion = cardSocketNode.getWorldQuaternion(new THREE.Quaternion());
    // THE CARD HANGS OUT OF THE READER'S BASE, NOT INTO THE LENS. The authored
    // slot vector points down AND toward the staff side; with the reader
    // floated to the face and the working frame looking down ~32°, that vector
    // is almost the view axis — probed 2026-07-30, a card pushed 0.155 m along
    // it moved SEVEN screen pixels and stayed inside the reader's silhouette.
    // The travel is taken from the READER'S OWN DOWN AXIS instead, which is
    // screen-down for an upright device at any camera pitch, and the card is
    // squared to the reader's face so it still reads as coming out of the slot.
    const bodyDown = termObject
      ? new THREE.Vector3().setFromMatrixColumn(termObject.matrixWorld, 1).normalize().negate()
      : new THREE.Vector3(0, -1, 0);
    const bodyFace = termObject
      ? new THREE.Vector3().setFromMatrixColumn(termObject.matrixWorld, 2).normalize()
      : new THREE.Vector3(0, 0, -1).applyQuaternion(socketQuaternion).normalize();
    const out = bodyDown.clone().sub(
      bodyFace.clone().multiplyScalar(bodyDown.dot(bodyFace)),
    );
    if (out.lengthSq() < 1e-8) out.copy(bodyDown);
    out.normalize();
    const shortEdge = new THREE.Vector3().crossVectors(out, bodyFace).normalize();
    const worldBasis = new THREE.Matrix4().makeBasis(out, bodyFace, shortEdge);
    const worldQuaternion = new THREE.Quaternion().setFromRotationMatrix(worldBasis);
    const rootQuaternion = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    cardInsertQuaternion.copy(rootQuaternion.multiply(worldQuaternion));
    cardInsertStart.copy(root.worldToLocal(socketWorld.clone().addScaledVector(out, 0.17)));
    // Seated at 0.03 the card vanished inside the riser; the reference
    // (154606) keeps the inserted card VISIBLY sticking out of the reader's
    // base while the total is keyed and processed. Probed 2026-07-30: the
    // socket sits 0.048 above the body's underside and the card is 0.086 long,
    // so ~0.06 leaves its head in the slot and hangs the rest clear — 0.135
    // flew it off the reader entirely and landed it on the counter. Round 7
    // nudged it out a little further so the card FACE (chip and brand) reads
    // below the base instead of a bare edge.
    // THE CARD HAS TO BE THE READER'S SCALE, NOT THE WORLD'S. Both assets are
    // authored life-size — payment_card.glb measures 0.0856 x 0.054 (a real
    // credit card) and payment_terminal.glb 0.100 wide — so a card in that slot
    // should be about 86% of the reader's width. It was rendering at roughly a
    // quarter of it, because the reader is presented at TERMINAL_HARDWARE_SCALE
    // (1.85x life size, growing from parkScale as it rises to the face) while
    // the card hangs off `root` at 1.0 and inherited none of that. Life-size
    // beside a 1.85x reader is 54% too small, which is the "the card is too
    // small and does not read as inserted" note.
    //
    // Matching termObject's CURRENT scale keeps the pair in proportion through
    // the whole rise rather than only when parked or only when floated, and the
    // seating offset scales with it so the card does not swim in the slot.
    const termScale = termObject ? termObject.scale.x || 1 : 1;
    if (cardMesh) cardMesh.scale.setScalar(termScale);
    // SEATED MEANS THE HEAD IS AT THE CONTACTS. 0.062 was hand-tuned when the
    // card still drew at world scale; against the 1.85x reader it left only 7.9%
    // of the card inside the device (measured 2026-08-03, tools/qa/checkout-
    // reader-geometry.js) with the rest hanging in mid-air below it — "it sits
    // against the reader rather than in it". Offsetting by the card's own
    // HALF-LENGTH puts its top edge exactly on the authored socket, which the
    // kit places 0.0148 above the deck origin inside Terminal_ChipSlot. Just
    // under a third of the card is then swallowed and the rest shows, which is
    // what a chip card in a terminal looks like — and it stays right at any
    // scale, because it is the card's own measurement rather than a constant.
    cardInserted.copy(root.worldToLocal(
      socketWorld.clone().addScaledVector(out, (CARD_WIDTH / 2) * termScale),
    ));
    return true;
  }

  function terminalHitAt(event) {
    if (!termObject) return false;
    setNdc(event);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObject(termObject, true).length > 0;
  }

  // Set by clicking the offered card; nothing inserts until the player takes it.
  let cardAccepted = false;

  // THE OFFERED CARD RIDES THE HAND. Mirrors the cash fix (PayCash/PayCard's
  // static reach + grip-point layout): once the presentation reach lands, the
  // card is PARENTED to the customer's carry grip, so the pinched fingers and
  // the card can never drift apart while the offer is held out. The insert
  // path animates in register-root space, so beginAutomaticCardInsert re-roots
  // the card the moment the player takes it.
  function attachCardToCustomerHand() {
    const grip = customerGripNode('R');
    if (!cardMesh || !grip || cardMesh.parent === grip) return false;
    root.updateMatrixWorld(true);
    grip.updateWorldMatrix(true, true);
    // Back to life size in a hand. The reader's presentation scale belongs to
    // the reader; a card held by a person is measured against the person.
    cardMesh.scale.setScalar(1);
    grip.attach(cardMesh);
    return true;
  }

  function acceptPresentedCard() {
    if (!tx || tx.stage !== 'card-ready' || cardAccepted) return false;
    cardAccepted = true;
    sfx('cardTap');
    return beginAutomaticCardInsert();
  }

  function beginAutomaticCardInsert() {
    if (!tx || tx.stage !== 'card-ready' || !cardMesh) return false;
    // THE PLAYER TAKES THE CARD. The insertion used to start on a timer, which
    // made the whole card route a cutscene; now the offered card waits in the
    // customer's hand — outlined under the cursor — until it is clicked.
    if (!cardAccepted) return false;
    // …and the reader must be UP first: it parks under the counter, and the
    // insert path is sampled from its socket, so inserting mid-rise would aim
    // the card at a point the socket has already left. updateCard retries this
    // every frame until the rise settles.
    if (terminalShouldFloat() && terminalFloat < 0.95) return false;
    // the insert lerp runs in register-root coordinates — take the card out of
    // the customer's hand before animating it toward the socket
    if (cardMesh.parent !== root) root.attach(cardMesh);
    refreshCardInsertPath();
    if (checkoutFlowState() === 'CardInsertReady'
        && !flowTo('CardInserting', 'automatic-card-insertion-started')) return false;
    cardInsertTimer = CARD_INSERT_TIME;
    cardU = 0;
    cardMessage = 'INSERTING';
    sfx('cardInsert');
    setWorkspace('card');
    drawTerm();
    drawScreen();
    return true;
  }

  function finishAutomaticCardInsert() {
    if (!tx || tx.stage !== 'card-ready') return false;
    const inserted = insertCard(tx);
    if (!inserted.ok) {
      toast(inserted.reason, 'warn');
      return false;
    }
    cardU = 1;
    cardMessage = '';
    if (cardMesh) {
      cardMesh.position.copy(cardInserted);
      cardMesh.quaternion.copy(cardInsertQuaternion);
    }
    if (checkoutFlowState() === 'CardInserting') {
      flowTo('CardAmountEntry', 'automatic-card-insertion-complete');
    }
    sfx('cardTap');
    drawTerm();
    drawScreen();
    return true;
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
    // H3 (2026-08-05): NO SWING TAG. This used to hang a brass tether and a
    // green-backed label 9.5 cm off every checkout item — C7 deleted the shelf
    // rails and the product swing tags, and this was the third tag nobody
    // caught, riding every product across the counter. What remains is a flush
    // barcode STICKER on the package face at the product's own anchor: the
    // sticker is packaging, the tag was signage. The mesh keeps its name and
    // userData because the scanner validates this plane's real transform.
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
    built.barcodeAnchor.add(barcodeMesh);
    mesh.userData = {
      ...mesh.userData,
      pick: true,
      kind: 'item',
      uid: item.uid,
      skuId: item.skuId,
      originalScale: mesh.scale.clone(),
      barcode,
      barcodeAnchor: built.barcodeAnchor,
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

  // Toggle only nodes that already participate in the physical-pick contract.
  // Product roots and their forgiving ItemClickPad both carry an explicit
  // `pick` flag; blindly stamping every GLB child would make an untyped visual
  // mesh win the raycast before its item/receipt/money owner can handle it.
  function setObjectPickable(object, pickable) {
    if (!object) return;
    object.traverse((node) => {
      if (node === object || Object.hasOwn(node.userData || {}, 'pick')) {
        node.userData = { ...(node.userData || {}), pick: !!pickable };
      }
    });
  }

  function scannedStagingPose(index = 0) {
    const rect = REGISTER.scannedStaging;
    const localCorners = [
      frontDeskLocalPoint(rect.minX, rect.minZ),
      frontDeskLocalPoint(rect.minX, rect.maxZ),
      frontDeskLocalPoint(rect.maxX, rect.minZ),
      frontDeskLocalPoint(rect.maxX, rect.maxZ),
    ];
    const minX = Math.min(...localCorners.map((point) => point.x));
    const maxX = Math.max(...localCorners.map((point) => point.x));
    const minZ = Math.min(...localCorners.map((point) => point.z));
    const maxZ = Math.max(...localCorners.map((point) => point.z));
    const columns = 3;
    const column = Math.max(0, index) % columns;
    const row = Math.floor(Math.max(0, index) / columns);
    const x = THREE.MathUtils.lerp(minX + 0.08, maxX - 0.08, column / (columns - 1));
    const z = THREE.MathUtils.lerp(minZ + 0.045, maxZ - 0.045, row % 2);
    const point = frontDeskPoint(x, z);
    return {
      position: new THREE.Vector3(point.x, REST_Y + row * 0.012, point.z),
      quaternion: frontDeskQuaternion(0, (column - 1) * 0.10, 0),
    };
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
  // EVERY DENOMINATION MUST READ APART AT A GLANCE (checkout-physicality
  // 2026-07-30, item 3). The kit notes are printed on near-identical pale
  // stock, so in the drawer camera the bill row read as five identical
  // rectangles and the coin row as five dark blobs. These tints are multiplied
  // onto the kit's own baked maps — the engraving survives, the INK changes —
  // and a matching emissive lift keeps the tray legible in the counter's
  // shadow. Reference 154525 / 154641: distinct note ink per value, a copper
  // penny and silver coins of visibly different sizes.
  // ROUND 7: "fix the dollar sign colors — make it how they were before." The
  // five-hue pass (ochre $5, blue $10, violet $50 …) read as toy money, and
  // the play-test rejected it outright. US notes are ONE green; what tells
  // them apart is the printed numeral and the angled $-tags now standing at
  // the front of each well. A whisper of shade variation survives so a stack
  // edge still reads, but every note is unmistakably a dollar.
  const MONEY_TINT = {
    1: 0xa9bfa0,      // dollar green, lightest
    5: 0xa2bb9a,
    10: 0x9cb794,
    20: 0x96b28e,
    50: 0x8fae88,     // dollar green, deepest
    0.01: 0xc06a2c,   // COPPER — the penny, unmistakably
    // The kit coin maps are printed on warm brass, so a near-white tint reads
    // GOLD, not silver. Every non-penny tint is deliberately cool to pull the
    // alloy back to the reference's silver.
    0.05: 0x7e8c96,   // nickel: the dullest, coolest silver
    0.1: 0xb6cbd8,    // dime: the brightest, smallest silver
    0.25: 0x96a6b0,   // quarter: mid silver
    0.5: 0xa4b4bc,    // half dollar: the largest silver
  };
  const MONEY_EMISSIVE = 0.15;
  const kitMoneyMaterials = new Map(); // `${denom}|${sourceMaterial.uuid}` -> tinted clone

  // Apply the denomination tint to an instantiated kit note/coin. Materials are
  // cloned once per (denomination, source material) so the tray costs a handful
  // of extra materials, not one per piece.
  function tintKitMoney(mesh, denom) {
    const tint = MONEY_TINT[denom];
    if (tint === undefined) return mesh;
    const coin = !BILLS.includes(denom);
    mesh.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const applied = source.map((material) => {
        if (!material) return material;
        const key = `${denom}|${material.uuid}`;
        let tinted = kitMoneyMaterials.get(key);
        if (!tinted) {
          tinted = material.clone();
          if (tinted.color) tinted.color.setHex(tint);
          if (tinted.emissive) {
            tinted.emissive.setHex(tint);
            tinted.emissiveMap = tinted.map || null;
            tinted.emissiveIntensity = MONEY_EMISSIVE;
          }
          // Fully metallic coins go BLACK anywhere the drawer light does not
          // reach. Half-metal keeps the mint sheen and still takes ambient.
          if (coin && typeof tinted.metalness === 'number') {
            tinted.metalness = Math.min(tinted.metalness, 0.45);
            tinted.roughness = Math.min(Math.max(tinted.roughness ?? 0.4, 0.26), 0.5);
          }
          tinted.needsUpdate = true;
          kitMoneyMaterials.set(key, tinted);
        }
        return tinted;
      });
      object.material = Array.isArray(object.material) ? applied : applied[0];
    });
    return mesh;
  }
  const billGeometry = new THREE.BoxGeometry(0.152, 0.0022, 0.066);
  const coinGeometry = new THREE.CylinderGeometry(0.0145, 0.0145, 0.0028, 20);
  // Selected coins rest flat on the bare counter pile. Their believable
  // diameter is too small for a reliable first-person target, so a shared
  // invisible 8 cm disc makes the visible coin forgiving without changing its
  // rendered scale.
  const selectedCoinPickGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.012, 16);
  const selectedCoinPickMaterial = new THREE.MeshBasicMaterial({ visible: false });

  function moneyMaterial(denom) {
    if (BILLS.includes(denom)) {
      if (!billMaterials.has(denom)) {
        billMaterials.set(denom, new THREE.MeshStandardMaterial({
          map: billTexture(denom, displayClubName()),
          roughness: 0.86,
        }));
      }
      return billMaterials.get(denom);
    }
    if (!coinMaterials.has(denom)) {
      const face = new THREE.MeshStandardMaterial({
        map: coinTexture(denom),
        roughness: 0.38,
        metalness: 0.42,
      });
      const edge = new THREE.MeshStandardMaterial({
        color: new THREE.Color((COIN_ALLOY[denom] || COIN_ALLOY[0.1])[2]),
        roughness: 0.42,
        metalness: 0.45,
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
      // The quarter well predates its own model in kits built before the
      // 20-unit coin was retired; the 20-unit blank is the same diameter, so
      // it stands in rather than dropping to procedural geometry.
      if (!mesh && denom === 0.25 && merch.hasKit('cash_coin_20')) {
        mesh = merch.instantiateKit('cash_coin_20', { scale: MONEY_KIT_SCALE });
      }
      if (mesh) tintKitMoney(mesh, denom);
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
    if (from === 'change' && !BILLS.includes(denom)) {
      const pickPad = new THREE.Mesh(selectedCoinPickGeometry, selectedCoinPickMaterial);
      pickPad.name = 'SelectedChangeCoinPickTarget';
      pickPad.userData = { ...data };
      mesh.add(pickPad);
    }
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
    bagGroup.quaternion.copy(bagCounterQuaternion());
    bagGroup.scale.setScalar(BAG_COUNTER_SCALE);
  }

  // Kraft outside, SHADOW inside. Laid on its face the bag is read almost
  // entirely by its mouth, and a mouth painted the same colour as the paper
  // around it is a seam, not an opening — which is what made an earlier
  // side-lying take read as "a fallen box". The authored liner shells
  // (bag_liner_*) get a much darker, rougher paper so the cavity is visible
  // from the working frame; the ropes stay cord-brown; everything else is the
  // reference's warm kraft.
  const BAG_LINER_COLOR = 0x4a3823;
  // K1: "add wrinkles to the bag to make it more like paper." One shared
  // 256px bump source — long soft creases over a fine paper tooth — baked
  // from a fixed LCG so every boot (and every screenshot) gets the same
  // sheet. Height data, so it stays linear; never give a bump map sRGB.
  let kraftWrinkleTexture = null;
  function kraftWrinkleBump() {
    if (kraftWrinkleTexture) return kraftWrinkleTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    ctx.lineCap = 'round';
    for (let crease = 0; crease < 46; crease += 1) {
      ctx.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.26)';
      ctx.lineWidth = 0.7 + rnd() * 1.9;
      ctx.beginPath();
      let x = rnd() * 256;
      let y = rnd() * 256;
      ctx.moveTo(x, y);
      const segments = 3 + Math.floor(rnd() * 4);
      for (let s = 0; s < segments; s += 1) {
        x += (rnd() - 0.5) * 130;
        y += (rnd() - 0.5) * 130;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let grain = 0; grain < 1500; grain += 1) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5);
    }
    kraftWrinkleTexture = new THREE.CanvasTexture(canvas);
    kraftWrinkleTexture.wrapS = THREE.RepeatWrapping;
    kraftWrinkleTexture.wrapT = THREE.RepeatWrapping;
    return kraftWrinkleTexture;
  }
  function applyKraftBagStyle(model) {
    model.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const styleMaterial = (material) => {
        const styled = material.clone();
        const label = `${object.name || ''} ${material.name || ''}`.toLowerCase();
        const handle = /handle|cord|rope/.test(label);
        const liner = /liner/.test(label);
        if (styled.color) {
          styled.color.setHex(handle ? 0x5b4026 : (liner ? BAG_LINER_COLOR : 0xc7a271));
        }
        // "Plain" was partly the finish. Kraft at 0.96 roughness is matte to the
        // point of being unlit — it took no highlight off the counter lamp and
        // read as a flat brown cut-out beside the terminal's glossy shell. Real
        // kraft has a low sheen; 0.86 gives the laid flank a soft gradient
        // across its width, which is what makes it read as a bag with a fold.
        if ('roughness' in styled) styled.roughness = handle ? 0.82 : 0.86;
        if ('metalness' in styled) styled.metalness = 0;
        if (!handle) styled.map = null;
        // K1: paper, not card — the creases catch the counter light on the
        // laid flank. Ropes stay smooth cord.
        if (!handle && 'bumpMap' in styled) {
          styled.bumpMap = kraftWrinkleBump();
          // bumpScale is a slope multiplier, not metres — 0.0025 was
          // invisible (photographed); 0.55 puts soft creases in the counter
          // light without reading as crumpled trash
          styled.bumpScale = 0.55;
        }
        styled.needsUpdate = true;
        return styled;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(styleMaterial)
        : styleMaterial(object.material);
    });
  }

  function buildBag() {
    if (bagGroup) return;
    const builtBag = new THREE.Group();
    bagGroup = builtBag;
    builtBag.name = 'FrontDeskShoppingBag';
    builtBag.userData = {
      pick: false,
      kind: 'bag',
      checkoutOwner: 'register',
    };
    builtBag.position.copy(BAG_POS);
    builtBag.quaternion.copy(bagCounterQuaternion());
    builtBag.scale.setScalar(BAG_COUNTER_SCALE);
    root.add(builtBag);
    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.30, 0.17 * BAG_FLATTEN),
      new THREE.MeshStandardMaterial({ color: 0xbda274, roughness: 0.92, metalness: 0.0 }),
    );
    fallback.position.y = 0.15;
    fallback.name = 'BagFallback';
    fallback.userData.checkoutOwnedFallback = true;
    builtBag.add(fallback);
    const bagPanel = CHECKOUT_DISPLAY_BRAND_PRESENTATION.bagPanel;
    const brandPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(bagPanel.width, bagPanel.height),
      bagBrandMaterial,
    );
    brandPanel.name = 'PineHillsDynamicBagBrand';
    // The panel rides just proud of the printed face, so it follows the same
    // gusset flattening the carrier itself gets.
    brandPanel.position.set(0, bagPanel.y, bagPanel.z * BAG_FLATTEN);
    // Laid flat, the printed face turns UP and the bag's own height axis runs
    // down-counter. Spin the panel a quarter turn on its normal so the shop
    // name reads ALONG the counter instead of running away from the player.
    brandPanel.rotation.z = Math.PI / 2;
    brandPanel.userData = { pick: false, kind: 'bag-brand' };
    builtBag.add(brandPanel);
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
        suppressLegacyCheckoutBrandNodes(model, 'shoppingBag');
        applyKraftBagStyle(model);
        suppressInteriorSunShadows(model);
        // Collapse the gusset. Scaling the MODEL rather than the group keeps the
        // group's scale uniform for every other consumer (handoff drag, delivery
        // tween, save/restore) and leaves the authored anchors — all of which sit
        // on the depth-free centre line — exactly where they were.
        model.scale.z = BAG_FLATTEN;
        builtBag.add(model);
        bagContentsNode = model.getObjectByName('ANCHOR_BagContents');
        bagHandoffNode = model.getObjectByName('ANCHOR_BagHandoff')
          || model.getObjectByName('ANCHOR_BagHandleFront');
        for (const handleName of [
          'ANCHOR_BagHandleFront', 'ANCHOR_BagHandleBack',
          'BagHandleFrontPivot', 'BagHandleBackPivot',
        ]) {
          const handle = model.getObjectByName(handleName);
          if (handle) handle.userData = { ...handle.userData, pick: false, kind: 'bag' };
        }
        if (bagHandoffNode) {
          builtBag.updateWorldMatrix(true, true);
          bagHandoffLocal.copy(
            builtBag.worldToLocal(bagHandoffNode.getWorldPosition(new THREE.Vector3())),
          );
        }
        const drop = model.getObjectByName('ANCHOR_BagDrop');
        if (drop) {
          root.updateMatrixWorld(true);
          // bagMouth is consumed by root-attached receipt/product drags. Keep the
          // authored socket in register-root space; bagGroup.worldToLocal() would
          // silently turn it into a near-origin bag-local point and reject every
          // visually correct drop at the counter.
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
    setObjectPickable(mesh, false);

    if (descriptor.separateHandoff) {
      const oversize = tx.items.filter((item) => item.scanned
        && itemMeshes.get(item.uid)?.userData?.catalogVisual?.separateHandoff);
      const index = Math.max(0, oversize.findIndex((item) => item.uid === mesh.userData.uid));
      const pose = frontDeskPoint(-1.02 + index * 0.07, -0.12 + index * 0.055);
      root.attach(mesh);
      mesh.scale.copy(baseScale);
      mesh.position.set(pose.x, REST_Y + index * 0.025, pose.z);
      mesh.quaternion.copy(frontDeskQuaternion(0, -0.10 + index * 0.08, 0));
      mesh.userData.checkoutVisualState = 'oversize-set-aside';
      return;
    }

    const compact = tx.items.filter((item) => item.scanned
      && !itemMeshes.get(item.uid)?.userData?.catalogVisual?.separateHandoff);
    const index = Math.max(0, compact.findIndex((item) => item.uid === mesh.userData.uid));
    const staging = scannedStagingPose(index);
    root.attach(mesh);
    mesh.scale.copy(baseScale);
    mesh.position.copy(staging.position);
    mesh.quaternion.copy(staging.quaternion);
    mesh.userData.checkoutVisualState = 'scanned-staging';
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
      // bold white text with a dark stroke hugging the money.
      //
      // COIN tags lie flat on the tray floor and read perfectly — nothing sits
      // between them and the cash camera. The BILL row's front edge is the
      // divider BEHIND the coin row, so a flat tag there is grazed by the
      // camera and buried under the note stack: round 7, "we can't see the
      // number currency for $1, $5 — it's blocked off from the angle. The 10¢
      // 25¢ look great." Bill tags now STAND at the divider, tilted back
      // toward the staff eye and proud of the wall, so neither the stack
      // behind nor the coin row in front covers them. refillDrawerMoney
      // re-seats only the coin tags.
      const tag = makeMoneyTag(moneyLabel(denom), bill ? 0.084 : 0.066, bill ? 0.042 : 0.033);
      if (bill) {
        tag.position.set(slot.x, slot.y + meta.wall_h + 0.010, slot.z + meta.well_d / 2 - 0.004);
        tag.rotation.x = -Math.PI / 2 + BILL_TAG_TILT;
      } else {
        tag.position.set(slot.x, slot.y + 0.0022, slot.z + meta.well_d / 2 - 0.020);
      }
      drawerMotionRoot.add(tag);
      slotLabels.push(tag);
      slotTags[denom] = tag;
    }
  }

  // How far the standing bill tags lean back from vertical toward the staff
  // eye (the cash camera looks down at the tray from the staff side).
  const BILL_TAG_TILT = 0.95;

  // TCG-style denomination tag: white 900-weight text, dark outline, transparent
  // ground, always readable over whatever money sits beneath it.
  function makeMoneyTag(text, width = 0.066, height = 0.033) {
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
      new THREE.PlaneGeometry(width, height),
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
    drawerGroup = new THREE.Group();
    drawerGroup.position.set(REGISTER.drawer.x, REGISTER.drawer.y, REGISTER.drawer.z);
    drawerGroup.rotation.y = COUNTER.ry;
    root.add(drawerGroup);
    drawerMotionRoot = new THREE.Group();
    drawerMotionRoot.visible = false;
    drawerGroup.add(drawerMotionRoot);
    drawerMoney = new THREE.Group();
    drawerMoney.name = 'SimplifiedDrawerMoney';
    drawerMotionRoot.add(drawerMoney);

    // NO LAMPS IN THE TILL. A previous round hung two point lights over the
    // wells because the tray read dark under the counter slab. With the round-6
    // working eye — lower, and much closer to the counter — the open tray sits
    // in the room's own key light and does not need them, and the play-test
    // asked for them gone. The denominations stay legible on their own tinted
    // materials; if the tray ever reads dark again the honest fix is the
    // material, not a lamp that lights nothing else in the room.

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
          const socketNames = (denom) => {
            if (BILLS.includes(denom)) return [`BILL_${denom}_SOCKET`];
            const code = String(Math.round(denom * 100)).padStart(2, '0');
            // The quarter occupies the well the kit authored as COIN_20_SOCKET:
            // same fourth compartment, corrected denomination. Kits rebuilt with
            // a COIN_25_SOCKET win; older trays still resolve.
            return denom === 0.25
              ? ['COIN_25_SOCKET', 'COIN_20_SOCKET']
              : [`COIN_${code}_SOCKET`];
          };
          let remapped = 0;
          for (const denom of DENOMS) {
            let socket = null;
            for (const name of socketNames(denom)) {
              socket = model.getObjectByName(name);
              if (socket) break;
            }
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
      // COIN tags ride the front slope of their pile so the value stays on
      // top of the metal. BILL tags are fixed standing plates at the divider
      // (buildSlotFurniture) — a tag that rode the stack was exactly the one
      // the round-7 play-test could not see.
      const tag = slotTags[denom];
      if (tag && !bill) {
        const pileTop = count > 0 ? meta.pile_h * 1.6 : 0;
        tag.position.set(
          slot.x,
          slot.y + pileTop + 0.0022,
          slot.z + meta.well_d / 2 - 0.020,
        );
      }
    }
  }

  // THE PRESENTED CASH LIES ON THE DESK. Round 7: "make it so the money goes
  // on the desk so the user can select the bills" — the customer sets their
  // notes down flat on their half of the counter (clear of the goods strip),
  // exactly like the reference's cash-on-the-table, instead of holding a fan
  // in the air. Every piece is its own click target and one generous unseen
  // pad over the pile still takes the lot.
  function tenderCounterPoint() {
    const at = customerLocalPosition();
    const local = frontDeskLocalPoint(at.x, at.z);
    const spot = frontDeskPoint(THREE.MathUtils.clamp(local.x, -0.70, -0.15), -0.30);
    return new THREE.Vector3(spot.x, COUNTER_TOP, spot.z);
  }

  function tenderPose(index) {
    const layout = presentedTenderLayout(
      tenderMeshes.map((mesh) => mesh.userData.denom),
      tenderCounterPoint(),
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
      // each note travels from the customer's reaching hand DOWN onto the
      // counter, and settles flat where the pile lies
      const hand = customerHandPoint(COUNTER_TOP + 0.20);
      mesh.position.copy(hand).add(frontDeskOffsetVector3(
        -0.06 + (index % 4) * 0.03,
        0.02 + Math.floor(index / 4) * 0.006,
        -0.10,
      ));
      mesh.rotation.copy(frontDeskEuler(-0.3, -0.06, 0));
      queueCashMotion(mesh, pose.position, {
        delay: index * 0.055,
        duration: 0.48,
        enablePick: true,
        kind: 'tender-present',
        toRotation: pose.rotation,
      });
    });
    // ...and the WHOLE pile is one generous click target hovering just over
    // the laid-out money, so taking the payment never means hunting a
    // two-millimetre note edge. Tracked apart from tenderMeshes so it never
    // rides the deposit choreography.
    clearTenderHandful();
    const pile = tenderCounterPoint();
    tenderHandful = new THREE.Mesh(
      new THREE.SphereGeometry(accessibilityPrefs.largeTextAndTargets ? 0.24 : 0.17, 10, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    tenderHandful.position.set(pile.x, pile.y + 0.04, pile.z);
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

  // Selected change accumulates as a FLAT PILE on the bare counter left of the
  // drawer (reference 154641) where both the money and the Giving line on the
  // POS read together. The authored handoff tray prop is gone.
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
      REGISTER.changeHandoff.x,
      COUNTER_TOP,
      REGISTER.changeHandoff.z,
    ).add(frontDeskOffsetVector3(-0.018, 0.026, -0.020));
    bundle.quaternion.copy(frontDeskQuaternion());
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
      toRotation: frontDeskEuler(0.94, -0.04, 0),
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
  } = {}) {
    pendingChangeConfirmation = null;
    // Motions retain mesh references. Release them before any item can be
    // disposed, reparented to a customer, or replaced by the next transaction.
    bagDropMotions.length = 0;
    drawerPrewarmToken += 1;
    drawerPrewarm = {
      kind: 'checkout-first-use-textures',
      pendingTextures: 0,
      warmedTextures: 0,
      item: { total: 0, pending: 0, warmed: 0 },
      coin: { total: 0, pending: 0, warmed: 0 },
      complete: true,
    };
    const transferredProducts = [];
    for (const mesh of itemMeshes.values()) {
      if (preserveCustomerBag
          && bagGroup?.userData.checkoutOwner === 'customer'
          && mesh.userData?.checkoutOwner === 'customer') {
        transferredProducts.push(mesh);
        continue;
      }
      mesh.removeFromParent();
      itemResources.dispose(mesh);
    }
    if (cust && transferredProducts.length) {
      cust.checkoutHandoffProducts = transferredProducts;
      cust.checkoutHandoffProductDisposer = (mesh) => itemResources.dispose(mesh);
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
    autoFulfilled = false;
    deliveryPhase = null;
    deliveryTimer = 0;
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
    paymentAutoSuppressed = false;
    finalizeTimer = 0;
    cardMessage = '';
    cardU = 0;
    cardPresentationTimer = 0;
    cardInsertTimer = 0;
    cardProcessingTimer = 0;
    termDotsTimer = 0;
    cardResultTimer = 0;
    cardEjectTimer = 0;
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
    cashPoseCache = null;
    if (drawerMotionRoot) {
      drawerMotionRoot.position.z = 0;
      drawerMotionRoot.visible = false;
    }
    if (drawerAssetSlide) drawerAssetSlide.position.z = drawerAssetSlideBaseZ;
    setGrabOutline(null);
    hideTip();
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
    const transactionNumber = Math.max(1, Number(state.shop.nextTransactionNo || 1));
    tx = createTx({
      id: retailTransactionId(state, transactionNumber),
      items,
      mode: state.mode,
      discount: customer.discount || 0,
      prefer: customer.payMethod || customer.paymentPreference || 'card',
      // Where the course is. Merchandise is taxable; the rate is frozen onto the ticket so the
      // number on the reader, the number on the receipt and the number banked are one number.
      taxRate: salesTaxRate(state),
      taxLabel: taxJurisdictionLabel(state),
    });
    tx.number = transactionNumber;
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
    // A cashier may remain at the desk between customers. In that case enter() will not run
    // again, so begin the same authored entry transition here; otherwise the payment verbs can
    // advance while the flow remains stranded at WaitingForCashier and the completed physical
    // handoff can never unlock exact-once banking.
    if (active && checkoutFlowState() === 'WaitingForCashier') {
      flowTo('EnteringCashierMode', 'customer-arrived-while-cashier-active');
      enterTimer = 0.30;
    }
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
    // The player may remain at the till while the paid customer leaves and the
    // next queued customer finishes placing their products. That new owner still
    // has a legitimate WaitingForCashier flow, but enter() will not run again
    // while the register is already active. Start the same adjacent camera/input
    // transition here so domain actions cannot outrun the physical flow contract.
    if (active) beginCashierEntry('active-cashier-accepted-next-queued-customer');
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
      // payment re-opens at the terminal. Otherwise the drawer/reader would be
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
      beginCashierEntry('player-opened-front-desk-monitor');
      const opening = dynamicPose(poseKey());
      cameraPose = { ...opening.pose };
      activePoseKey = poseKey();
      cameraTween = null;
      lookYaw = 0;
      lookPitch = 0;
      lookTargetYaw = 0;
      lookTargetPitch = 0;
      workingGlanceActive = false;
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
    setGrabOutline(null);
    hideTip();
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
    if (scanDrag) {
      const drag = scanDrag;
      if (drag.kind === 'item' && drag.scanning) {
        settleDraggedScan();
      } else {
        scanDrag = null;
        if (drag.kind === 'bag') {
          drag.mesh.position.copy(drag.from);
          drag.mesh.quaternion.copy(drag.fromQuaternion);
          drag.mesh.scale.copy(drag.fromScale);
          if (checkoutFlowState() === 'BagHandoff') {
            flowTo('Bagging', 'held-bag-cancelled-safely');
          }
          setBagPickable(true);
          deliveryPhase = 'bagging-manual';
        } else if (drag.mesh) {
          drag.mesh.position.copy(drag.from);
          drag.mesh.quaternion.copy(drag.fromQuaternion);
          if (drag.fromScale) drag.mesh.scale.copy(drag.fromScale);
          setObjectPickable(drag.mesh, true);
        }
      }
    }
    setGrabOutline(null);
    hideTip();
    drawScreen();
    drawTerm();
    return true;
  }

  function setWorkspace(next) {
    assignWorkspace(next);
    setGrabOutline(null);
    hideTip();
    if (next !== 'scan') {
      selectedItem = null;
      scanDrag = null;
    }
    // The real POS monitor stays present in every workspace — during cash it
    // carries the orange Received/Total/Change/Giving screen directly above the
    // open drawer, exactly like the reference. No stand-in panels exist.
    drawScreen();
    drawTerm();
  }

  function createCardMesh() {
    cardReady.copy(customerCardReadyPoint());
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
      const faceTexture = paymentCardTexture(displayClubName());
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
    syncPhysicalBrand();
    const brandPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_WIDTH - 0.005, CARD_HEIGHT - 0.005),
      cardBrandMaterial,
    );
    brandPanel.name = 'PineHillsDynamicPaymentCardBrand';
    brandPanel.rotation.x = -Math.PI / 2;
    brandPanel.position.y = 0.00102;
    base.add(brandPanel);
    base.position.copy(cardReady);
    base.quaternion.copy(HELD_QUAT);
    // Pickable: the player accepts the offered card by clicking it (playtest
    // 2026-07-30 — hover shows an outline, the click starts the insertion and
    // lifts the reader). Pick stays true through presentation; the accept
    // handler itself checks the stage.
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
    paymentAutoTimer = 0;
    paymentAutoSuppressed = false;
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
      // The HELD reach — customers.js re-asserts PayCard on every PAYING frame,
      // and the two must be the same pose or the arm pops between frames.
      poseCustomerForCheckout('PayCard');
      createCardMesh();
      // The customer presents the card; the reader then inserts it itself. No
      // detached cashier hand or pointer-driven card gesture appears.
      cardPresentationTimer = 0.55;
    cardAccepted = false;
      cardInsertTimer = 0;
      cardU = 0;
      cardMessage = '';
      cardEjectTimer = 0;
      setWorkspace('card');
    } else {
      if (checkoutFlowState() === 'ChoosingPayment') flowTo('CashPresented', 'customer-presented-cash');
      poseCustomerForCheckout('PayCash');
      // The customer holds their cash out across the counter. The player CLICKS
      // the handful: it slides into the register, the drawer opens on its
      // own, and the change count begins — no dragging, no sorting mini-game.
      createTender();
      setWorkspace('monitor');
    }
    drawScreen();
    drawTerm();
    return true;
  }

  function layoutAcceptedTender() {
    const count = Math.max(1, tenderMeshes.length);
    tenderMeshes.forEach((mesh, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      mesh.position.set(
        REGISTER.changeHandoff.x,
        REST_Y,
        REGISTER.changeHandoff.z,
      ).add(frontDeskOffsetVector3(
        -0.12 + column * 0.075,
        row * 0.006,
        -0.035 + row * 0.045,
      ));
      mesh.rotation.copy(frontDeskEuler(
        0,
        BILLS.includes(mesh.userData.denom) ? Math.PI / 2 : 0,
        0,
      ));
      mesh.userData.from = 'tender';
      setObjectPickable(mesh, true);
    });
  }

  // One click accepts the customer's offered pile. The drawer opens and the
  // received pieces file into their matching wells automatically; the player
  // only performs the reference-defining task of counting change.
  function acceptPresentedCash() {
    if (!tx || tx.method !== 'cash' || tx.stage !== 'cash-tender') return false;
    const accepted = acceptCash(tx);
    if (!accepted.ok) {
      toast(accepted.reason, 'warn');
      return false;
    }
    if (checkoutFlowState() === 'CashPresented') {
      flowTo('CashAccepted', 'player-took-presented-cash');
    }
    cashMotions = cashMotions.filter((motion) => {
      if (!tenderMeshes.includes(motion.mesh)) return true;
      motion.mesh.userData.pick = false;
      return false;
    });
    clearTenderHandful();
    const opened = openDrawer(tx);
    if (!opened.ok) {
      toast(opened.reason, 'warn');
      return false;
    }
    drawerWant = 1;
    if (checkoutFlowState() === 'CashAccepted') {
      flowTo('DrawerOpening', 'cash-accepted-and-drawer-opened-automatically');
    }
    tenderMeshes.forEach((mesh, index) => {
      const denom = Number(mesh.userData.denom);
      queueCashMotion(mesh, drawerSlotPosition(denom, index * 0.00035), {
        delay: 0.18 + index * 0.045,
        duration: 0.44,
        remove: true,
        kind: 'cash-deposit',
        drawerDenom: denom,
        stackOffset: index * 0.00035,
        lift: 0.08,
        onComplete: (completedMesh) => {
          tenderMeshes = tenderMeshes.filter((candidate) => candidate !== completedMesh);
        },
      });
    });
    const deposited = depositTendered(tx, drawer);
    if (!deposited.ok) {
      toast(deposited.reason, 'warn');
      return false;
    }
    cashMotionRefillPending = true;
    setWorkspace('cash');
    toast('Cash accepted. The drawer is opening; count the required change.');
    sfx('drawerUnlock');
    sfx('drawerOpen');
    sfx('billHandle');
    drawScreen();
    return true;
  }

  function switchDeclinedCardToCash() {
    if (!tx || tx.stage !== 'card-declined') return false;
    const cancelled = cancelCard(tx);
    if (!cancelled.ok) return false;
    cardResultTimer = 0;
    cardProcessingTimer = 0;
    termDotsTimer = 0;
    if (checkoutFlowState() === 'CardDeclined') flowTo('ChoosingPayment', 'customer-switched-to-cash');
    const changed = payCashInstead(tx);
    if (!changed.ok) return false;
    if (cardMesh) cardMesh.removeFromParent();
    cardMesh = null;
    if (checkoutFlowState() === 'ChoosingPayment') flowTo('CashPresented', 'customer-presented-cash-after-decline');
    poseCustomerForCheckout('PayCash');
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
    // No barcode judgment since the 2026-07-30 round-2 slide: the item never
    // passes the scanner, the register beep IS the scan. The evidence record
    // stays truthful about that — source 'click-slide', no ray facts claimed.
    const result = scanItem(tx, motion.uid);
    if (result.ok) {
      lastScanEvidence = {
        uid: motion.uid,
        skuId: motion.item.skuId,
        barcode: motion.barcode,
        scannerSource: 'click-slide',
        phase: motion.phase,
        ok: true,
        code: 'ok',
        capturedAtMs: performance.now(),
      };
    }
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
  // bag/set-aside placement. There is no drag, wheel puzzle, or hidden second
  // click — but the POS line and the success cues belong to the validated
  // barcode-contact edge inside commitScanMotion, never the click itself.
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
    hoveredItem = null;
    sfx('productPickup');
    const separateHandoff = !!mesh.userData.catalogVisual?.separateHandoff;
    const oversizeCount = tx.items.filter((candidate) => candidate.bagged
      && itemMeshes.get(candidate.uid)?.userData?.catalogVisual?.separateHandoff).length;
    const oversizePoint = frontDeskPoint(-1.02 + Math.max(0, oversizeCount - 1) * 0.07, -0.12);
    // LEVEL WITH THE COUNTER THE WHOLE WAY. Round 7: "the items … literally
    // just go in by sliding to the left" — the staging strip now shares the
    // laid bag's own line (shopLayout round-7 seam), and the slide target
    // keeps the item's resting height, so the good runs the surface straight
    // into the low half of the flattened mouth with no climb at all.
    const mouth = bagMouth.clone();
    mouth.y = REST_Y;
    const destination = separateHandoff
      ? new THREE.Vector3(oversizePoint.x, REST_Y, oversizePoint.z)
      : mouth;
    // ONE SLIDE, LEFT, INTO THE MOUTH. Playtest 2026-07-30 round 2 (reference:
    // TCG Card Shop Simulator / Bookshop): the five-phase pickup -> barcode
    // alignment -> reader pass -> bag arc read as ceremony. A click rings the
    // item up and slides it SIDEWAYS along the counter into the mouth of the
    // upright bag standing at the counter's left end (checkout-physicality
    // round: lateral travel dwarfs the small climb into the mouth, so it
    // reads as a slide toward the bag, never a drop from above); the register
    // beep IS the scan. The barcode pose requirement went with the arc — an
    // item without a readable mount is still sellable by hand.
    scanMotion = {
      phase: 'slide',
      destinationKind: separateHandoff ? 'oversize' : 'bag',
      mesh,
      item,
      uid: item.uid,
      barcode: mesh.userData.barcode,
      committed: false,
      elapsed: 0,
      duration: SLIDE_DURATION,
      from: mesh.position.clone(),
      to: destination,
      fromQuaternion: mesh.quaternion.clone(),
      fromScale: mesh.scale.clone(),
      toQuaternion: separateHandoff
        ? frontDeskQuaternion(-0.9, Math.PI * 0.6, 0.4)
        : frontDeskQuaternion(0, 0, CHECKOUT_BAG_PRESENTATION.itemRoll),
    };
    return true;
  }

  function updateScanMotion(dt) {
    if (!scanMotion) return;
    const motion = scanMotion;
    motion.elapsed = Math.min(motion.duration, motion.elapsed + dt);
    // The whole gesture is one lateral slide from the counter into the bag's
    // mouth (or across to the oversize staging spot). The ring-up commits at
    // mid-slide — the POS beep is the scan.
    const t = motion.duration > 0 ? motion.elapsed / motion.duration : 1;
    const eased = THREE.MathUtils.smoothstep(t, 0, 1);
    motion.phase = 'slide';
    motion.mesh.position.lerpVectors(motion.from, motion.to, eased);
    // NO HOP. Playtest round 6: "when you click the items, they slide without
    // going up, right into the bag." The comment above always claimed a lateral
    // slide while the code added a 0.07 arc on top of it, so a clicked product
    // lifted off the counter and dropped in from above. With the carrier now
    // lying flat and its mouth facing down-counter, a straight lerp across the
    // counter IS the gesture — the goods travel the surface into the opening.
    motion.mesh.quaternion.slerpQuaternions(
      motion.fromQuaternion, motion.toQuaternion, eased,
    );
    if (t >= 0.42 && !motion.committed) {
      if (!commitScanMotion(motion)) return;
    }
    // Compact goods scale down as they pass through the mouth.
    if (motion.destinationKind === 'bag' && t > 0.62) {
      const shrink = 1 - ((t - 0.62) / 0.38) * 0.52;
      motion.mesh.scale.copy(motion.fromScale).multiplyScalar(shrink);
    }
    if (motion.elapsed < motion.duration) return;
    scanMotion = null;
    const bagResult = bagScannedItem(tx, motion.uid);
    if (!bagResult.ok) toast(bagResult.reason, 'warn');
    setObjectPickable(motion.mesh, false);
    if (motion.destinationKind === 'bag') {
      bagGroup.add(motion.mesh);
      const contents = bagContentsNode
        ? bagGroup.worldToLocal(bagContentsNode.getWorldPosition(new THREE.Vector3()))
        : new THREE.Vector3(0, 0.18, 0);
      const compactIndex = tx.items.filter((candidate) => candidate.bagged
        && !itemMeshes.get(candidate.uid)?.userData?.catalogVisual?.separateHandoff).indexOf(motion.item);
      motion.mesh.position.set(
        contents.x + (compactIndex % 2 ? 0.04 : -0.04),
        contents.y + 0.05 + Math.floor(Math.max(0, compactIndex) / 2) * 0.03,
        contents.z,
      );
      motion.mesh.quaternion.identity();
      motion.mesh.scale.copy(motion.fromScale).multiplyScalar(0.38);
      motion.mesh.userData.checkoutVisualState = 'packed-in-bag';
      motion.mesh.userData.checkoutOwner = 'bag';
    } else {
      settleScannedProduct(motion.mesh);
    }
    sfx('bagItem');
    selectedItem = null;
    const remaining = unscannedCount(tx);
    if (checkoutFlowState() === 'ProductScanned') {
      flowTo(
        remaining ? 'WaitingForScan' : 'AllProductsScanned',
        remaining ? `product-bagged:${motion.uid}` : 'all-products-rung-and-bagged',
      );
    }
    if (!remaining) {
      paymentAutoTimer = AUTO_PAYMENT_HOLD;
      paymentAutoSuppressed = false;
      setWorkspace('monitor');
      drawScreen();
    }
  }

  function updateScannerFeedback(dt) {
    if (scannerPulse <= 0) return;
    scannerPulse = Math.max(0, scannerPulse - dt);
    if (scannerPulse === 0) setScannerFeedback('idle');
  }

  function rotateHeldProduct(deltaY, shiftKey = false) {
    // Ring-up is a deterministic one-click physical choreography. Wheel
    // input remains consumed in register mode so it cannot leak into locomotion,
    // but there is no legacy held-product rotation path to desynchronise it.
    void deltaY;
    void shiftKey;
    return true;
  }



  function retryDeclinedCard() {
    if (!tx || tx.stage !== 'card-declined') return false;
    const result = retryCard(tx);
    if (!result.ok) return false;
    // The declined-result hold belongs only to the rejected card. Clear it
    // before the replacement begins its automatic insertion.
    cardResultTimer = 0;
    cardProcessingTimer = 0;
    termDotsTimer = 0;
    if (checkoutFlowState() === 'CardDeclined') {
      flowTo('CardPresented', 'customer-presented-replacement-card');
    }
    poseCustomerForCheckout('PayCard');
    createCardMesh();
    cardU = 0;
    cardPresentationTimer = 0.52;
    cardAccepted = false;
    cardInsertTimer = 0;
    cardMessage = '';
    cardEjectTimer = 0;
    setWorkspace('card');
    return true;
  }

  function ensureCashDrawerStarted() {
    if (!tx || tx.method !== 'cash') return false;
    if (tx.stage === 'cash-tender') {
      toast('Take the customer\'s cash before opening the drawer.', 'warn');
      return false;
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
        flowTo('DrawerOpening', 'player-opened-cash-drawer');
      }
      sfx('drawerUnlock');
      sfx('drawerOpen');
    }
    drawScreen();
    return true;
  }

  function startTenderDrag(mesh) {
    mesh = tenderMeshes.find((candidate) => {
      for (let node = mesh; node; node = node.parent) if (node === candidate) return true;
      return false;
    }) || mesh;
    if (!mesh || !tx || tx.stage !== 'cash-drawer' || !tx.drawerOpen
        || mesh.userData.from !== 'tender') return false;
    scanDrag = {
      kind: 'money',
      mesh,
      denom: Number(mesh.userData.denom),
      from: mesh.position.clone(),
      fromQuaternion: mesh.quaternion.clone(),
    };
    setObjectPickable(mesh, false);
    pulseCashierHand(mesh, BILLS.includes(scanDrag.denom) ? 'hold-bill' : 'hold-coin', 0.18);
    return true;
  }

  function settleTenderDrag() {
    const drag = scanDrag;
    if (!drag || drag.kind !== 'money') return false;
    scanDrag = null;
    const target = drawerSlotPosition(drag.denom);
    const overMatchingWell = drawerAmount >= 0.92
      && Math.hypot(drag.mesh.position.x - target.x, drag.mesh.position.z - target.z) <= 0.16;
    if (!overMatchingWell) {
      drag.mesh.position.copy(drag.from);
      drag.mesh.quaternion.copy(drag.fromQuaternion);
      setObjectPickable(drag.mesh, true);
      toast('Put that piece in its matching labelled drawer well.', 'warn');
      sfx('thunk');
      return true;
    }
    const deposited = depositPiece(tx, drawer, drag.denom);
    if (!deposited.ok) {
      drag.mesh.position.copy(drag.from);
      drag.mesh.quaternion.copy(drag.fromQuaternion);
      setObjectPickable(drag.mesh, true);
      toast(deposited.reason, 'warn');
      return true;
    }
    drag.mesh.removeFromParent();
    tenderMeshes = tenderMeshes.filter((mesh) => mesh !== drag.mesh);
    refillDrawerMoney();
    sfx(BILLS.includes(drag.denom) ? 'billHandle' : 'coinHandle');
    if (deposited.deposited) {
      if (checkoutFlowState() === 'DrawerOpening' && drawerAmount >= 0.98) {
        flowTo('DepositingCash', 'drawer-open-and-player-depositing-cash');
      }
      if (checkoutFlowState() === 'DepositingCash') {
        flowTo('SelectingChange', 'player-secured-all-received-cash');
      }
      toast('All received cash is secured. Count the change.');
    }
    drawScreen();
    return true;
  }

  function selectChangeFromSlot(denom, {
    assisted = false,
    silent = false,
    deferDraw = false,
  } = {}) {
    if (!tx || !tx.drawerOpen || !tx.deposited) return false;
    if (cashMotions.some((motion) => motion.kind === 'cash-deposit')) return false;
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

  // The customer palm completes the change window: at least the required
  // change, at most $5.00 extra. Under and beyond-the-ceiling both refuse with
  // the drawer still open; an allowed overage books as till shortage.
  function confirmChange(automatic = false) {
    if (!tx || tx.stage !== 'cash-drawer' || !tx.deposited) return false;
    const giving = changeGivingState(tx);
    if (giving.state === 'short') {
      cashValidationWarning(`Short by $${(Math.abs(giving.deltaCents) / 100).toFixed(2)} - the customer must receive full change.`);
      sfx('thunk');
      drawScreen();
      return false;
    }
    if (giving.state === 'excess') {
      cashValidationWarning('Too much - the register allows at most $5.00 extra.');
      sfx('thunk');
      drawScreen();
      return false;
    }
    const readiness = cashConfirmationReadiness(checkoutFlowState());
    if (readiness === 'defer') {
      // The sim-side drawer can be deposited before the authored slide reaches
      // its open stop. Remember this normal click and replay it once updateDrawer
      // advances through DepositingCash to SelectingChange. Handing over now
      // would close the slide while the flow was still DrawerOpening and strand
      // the later receipt/bag choreography behind an impossible transition.
      pendingChangeConfirmation = { automatic };
      const catchup = cashDrawerOpeningCatchupPath(checkoutFlowState());
      if (!catchup) {
        pendingChangeConfirmation = null;
        return false;
      }
      for (const next of catchup) {
        if (!flowTo(next, 'durable-cash-drawer-catch-up')) {
          pendingChangeConfirmation = null;
          return false;
        }
      }
      if (!automatic) toast('Drawer is still opening. Change is queued.');
      return true;
    }
    if (readiness !== 'ready') return false;
    pendingChangeConfirmation = null;
    const previousCheckoutFlow = tx.checkoutFlow;
    if (!flowTo(
      'GivingChange',
      automatic ? 'accessibility-auto-confirmed-exact-change' : 'player-confirmed-monitor-change-total',
    )) return false;
    const handed = handOverChange(tx, drawer);
    if (!handed.ok) {
      // The flow transition is presentation state while handOverChange owns the
      // durable drawer commit. If that authority refuses, restore the exact
      // immutable flow snapshot so retry can still begin at SelectingChange.
      syncFlow(previousCheckoutFlow);
      drawScreen();
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

  // --- NO PHYSICAL RECEIPT --------------------------------------------------
  // Round 7 (2026-07-31): "please completely remove the receipt." The curled
  // paper strip, its printer, the feed animation and both delivery beats are
  // gone. The SIM's paperwork is untouched — printReceipt/takeReceipt/
  // packReceipt still run (silently, below) so exact-once banking and reload
  // recovery keep the same durable flow states; payment simply flows straight
  // into the bag handoff.

  function beginAutomaticReceipt() {
    if (!tx || tx.stage !== 'receipt' || autoFulfilled) return false;
    const catchup = paidCheckoutCatchupPath(tx.method, checkoutFlowState());
    if (!catchup) return false;
    for (const next of catchup) {
      if (!flowTo(next, `durable-${tx.method}-receipt-catch-up`)) return false;
    }
    if (checkoutFlowState() === 'PaymentComplete') {
      flowTo('ReceiptPrinting', 'automatic-receipt-started');
    }
    if (checkoutFlowState() !== 'ReceiptPrinting') return false;
    const printed = printReceipt(tx);
    if (!printed.ok && !tx.receiptPrinted) {
      toast(printed.reason, 'warn');
      return false;
    }
    setWorkspace('monitor');
    drawScreen();
    // no paper feeds and nothing travels — file the rest of the paperwork and
    // start the one physical delivery that remains, the bag
    return finishAutomaticFulfillment();
  }

  function finishAutomaticFulfillment() {
    if (!tx || tx.banked || autoFulfilled
        || !['receipt', 'bagging', 'done'].includes(tx.stage)) return false;

    // Retail products are already physically in the bag from ring-up. File the
    // printed receipt into that same carrier and hand it across automatically;
    // no second receipt/product/bag mini-game follows payment.
    if (transactionKind === 'retail') {
      if (tx.stage === 'receipt') {
        const taken = takeReceipt(tx);
        if (!taken.ok) {
          toast(taken.reason, 'warn');
          return false;
        }
      }
      if (checkoutFlowState() === 'ReceiptPrinting') {
        flowTo('Bagging', 'printed-receipt-filed-into-bag-automatically');
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
            const packedItem = bagItem(tx, item.uid);
            if (!packedItem.ok) {
              toast(packedItem.reason, 'warn');
              return false;
            }
          }
        }
      }
      durableProjectRetailFulfillment();
      const handed = handOverGoods(tx);
      if (!handed.ok) {
        toast(handed.reason, 'warn');
        return false;
      }
      autoFulfilled = true;
      deliveryPhase = null;
      return beginBagDeliveryOrRelease();
    }

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
    autoFulfilled = true;
    // The sim-side order is complete (receipt filed, goods bagged). The one
    // physical delivery left is the bag itself.
    drawScreen();
    beginBagDeliveryOrRelease();
    return true;
  }

  function setBagPickable(pickable) {
    if (!bagGroup) return;
    bagGroup.userData = { ...bagGroup.userData, pick: !!pickable, kind: 'bag' };
    for (const name of [
      'ANCHOR_BagHandleFront', 'ANCHOR_BagHandleBack',
      'BagHandleFrontPivot', 'BagHandleBackPivot',
    ]) {
      const handle = bagGroup.getObjectByName(name);
      if (handle) handle.userData = { ...handle.userData, pick: !!pickable, kind: 'bag' };
    }
  }

  function startBaggingProductDrag(picked) {
    if (!picked || !tx || tx.stage !== 'bagging' || scanDrag) {
      return false;
    }
    // The receipt is pure paperwork (round 7). A resumed save can land in
    // 'bagging' with it unfiled; file it silently on first contact so the
    // physical work is never deadlocked behind paper that no longer exists.
    if (!tx.receiptPacked) packReceipt(tx);
    if (!tx.receiptPacked) return false;
    const mesh = itemMeshes.get(picked.userData.uid) || picked;
    const item = tx.items.find((candidate) => candidate.uid === mesh.userData.uid);
    if (!item || !item.scanned || item.bagged) return false;
    root.updateMatrixWorld(true);
    root.attach(mesh);
    scanDrag = {
      kind: 'item',
      scanning: false,
      uid: item.uid,
      item,
      mesh,
      from: mesh.position.clone(),
      fromQuaternion: mesh.quaternion.clone(),
      fromScale: mesh.scale.clone(),
    };
    setObjectPickable(mesh, false);
    sfx('productPickup');
    return true;
  }

  function movePhysicalDrag(event) {
    const drag = scanDrag;
    if (!drag?.mesh) return false;
    setNdc(event);
    if (drag.kind === 'bag') {
      const target = customerGripPoint('L') || customerAnchor(COUNTER_TOP + 0.10, 'L');
      const cursor = cursorAtLocalHeight(target.y);
      const handle = bagHandlePoint();
      if (cursor && handle) drag.mesh.position.add(cursor.sub(handle));
      return true;
    }
    const separateHandoff = drag.kind === 'item'
      && drag.mesh.userData.catalogVisual?.separateHandoff;
    const separateTarget = separateHandoff
      ? (customerGripPoint('R') || customerAnchor(COUNTER_TOP + 0.10, 'R'))
      : null;
    const carryHeight = separateTarget?.y
      ?? (drag.kind === 'item' ? bagMouth.y : CARRY_Y);
    const cursor = cursorAtLocalHeight(carryHeight);
    if (cursor) drag.mesh.position.copy(cursor);
    return true;
  }

  function settleDraggedScan() {
    const drag = scanDrag;
    if (!drag || drag.kind !== 'item' || !drag.scanning) return false;
    scanDrag = null;
    drag.mesh.position.copy(drag.from);
    drag.mesh.quaternion.copy(drag.fromQuaternion);
    if (drag.fromScale) drag.mesh.scale.copy(drag.fromScale);
    setObjectPickable(drag.mesh, true);
    if (checkoutFlowState() === 'ProductScanning') {
      flowTo('ProductHeld', `held-scan-cancelled:${drag.uid}`);
    }
    if (checkoutFlowState() === 'ProductHeld') {
      flowTo('WaitingForScan', `product-restaged:${drag.uid}`);
    }
    return true;
  }

  function settleBaggingProduct() {
    const drag = scanDrag;
    if (!drag || drag.kind !== 'item' || drag.scanning) return false;
    scanDrag = null;
    const separateHandoff = !!drag.mesh.userData.catalogVisual?.separateHandoff;
    const fulfillmentTarget = separateHandoff
      ? (customerGripPoint('R') || customerAnchor(COUNTER_TOP + 0.10, 'R'))
      : bagMouth;
    const distanceToBagMouth = drag.mesh.position.distanceTo(bagMouth);
    const distanceToTarget = separateHandoff
      ? drag.mesh.position.distanceTo(fulfillmentTarget)
      : distanceToBagMouth;
    const near = distanceToTarget <= (separateHandoff ? 0.50 : BAG_REACH);
    lastPhysicalDropEvidence = {
      kind: separateHandoff ? 'oversize-item' : 'item',
      uid: drag.uid,
      position: drag.mesh.position.toArray(),
      target: fulfillmentTarget.toArray(),
      distance: distanceToTarget,
      accepted: near,
    };
    if (!near) {
      drag.mesh.position.copy(drag.from);
      drag.mesh.quaternion.copy(drag.fromQuaternion);
      drag.mesh.scale.copy(drag.fromScale);
      setObjectPickable(drag.mesh, true);
      toast(separateHandoff
        ? 'Offer that full-size purchase to the customer\'s free hand.'
        : 'That product missed the bag.', 'warn');
      return true;
    }
    const bagged = bagItem(tx, drag.uid);
    if (!bagged.ok) {
      setObjectPickable(drag.mesh, true);
      toast(bagged.reason, 'warn');
      return true;
    }
    setObjectPickable(drag.mesh, false);
    if (separateHandoff) {
      // Golf bags and other full-size purchases are paid through the same
      // physical gesture, but transfer into the customer's free arm. They must
      // never be miniaturized into the compact paper carrier or teleported back
      // to the counter after valid hand contact.
      cust.mesh.add(drag.mesh);
      drag.mesh.scale.copy(drag.mesh.userData.originalScale || drag.fromScale);
      const oversizeIndex = tx.items.filter((item) => item.bagged
        && item.uid !== drag.uid
        && itemMeshes.get(item.uid)?.userData?.catalogVisual?.separateHandoff).length;
      drag.mesh.position.set(
        -0.30 - oversizeIndex * 0.08,
        1.24 + oversizeIndex * 0.05,
        0.12 - oversizeIndex * 0.06,
      );
      drag.mesh.rotation.set(0, -0.10 + oversizeIndex * 0.08, -Math.PI / 2);
      drag.mesh.userData.checkoutVisualState = 'customer-held-separate-handoff';
      drag.mesh.userData.checkoutOwner = 'register';
      poseCustomerForCheckout('ReceiveBag');
      sfx('bagItem');
      drawScreen();
      return true;
    }
    bagDropMotions.push({
      mesh: drag.mesh,
      from: drag.mesh.position.clone(),
      to: bagMouth.clone(),
      fromQuaternion: drag.mesh.quaternion.clone(),
      elapsed: 0,
      duration: 0.46,
      baseScale: drag.fromScale.clone(),
    });
    drawScreen();
    return true;
  }

  function startBagHandoffDrag() {
    if (!bagGroup || !tx || tx.stage !== 'bagging' || !allBagged(tx)
        || bagDropMotions.length || checkoutFlowState() !== 'Bagging') {
      return false;
    }
    // same silent paperwork self-heal as startBaggingProductDrag
    if (!tx.receiptPacked) packReceipt(tx);
    if (!tx.receiptPacked) return false;
    if (!flowTo('BagHandoff', 'player-grabbed-filled-bag-handles')) return false;
    scanDrag = {
      kind: 'bag',
      mesh: bagGroup,
      from: bagGroup.position.clone(),
      fromQuaternion: bagGroup.quaternion.clone(),
      fromScale: bagGroup.scale.clone(),
    };
    setBagPickable(false);
    poseCustomerForCheckout('ReceiveBag');
    deliveryPhase = 'bag-drag';
    return true;
  }

  function settleBagHandoff() {
    const drag = scanDrag;
    if (!drag || drag.kind !== 'bag') return false;
    scanDrag = null;
    const handle = bagHandlePoint() || bagGroup.position;
    const target = customerGripPoint('L') || customerAnchor(COUNTER_TOP + 0.10, 'L');
    const reached = handle.distanceTo(target) <= 0.46;
    if (!reached) {
      bagGroup.position.copy(drag.from);
      bagGroup.quaternion.copy(drag.fromQuaternion);
      bagGroup.scale.copy(drag.fromScale);
      if (checkoutFlowState() === 'BagHandoff') {
        flowTo('Bagging', 'filled-bag-returned-to-counter');
      }
      setBagPickable(true);
      deliveryPhase = 'bagging-manual';
      toast('Offer the bag handles to the customer\'s open hand.', 'warn');
      return true;
    }
    const handed = handOverGoods(tx);
    if (!handed.ok) {
      toast(handed.reason, 'warn');
      if (checkoutFlowState() === 'BagHandoff') flowTo('Bagging', 'bag-handoff-domain-refused');
      setBagPickable(true);
      return true;
    }
    setBagPickable(false);
    const deliveryStarted = beginBagDeliveryOrRelease();
    if (!deliveryStarted) {
      toast('The customer handoff could not start. Try the bag handles again.', 'warn');
      return false;
    }
    autoFulfilled = true;
    return true;
  }

  function updateBagDropMotions(dt) {
    for (let index = bagDropMotions.length - 1; index >= 0; index -= 1) {
      const motion = bagDropMotions[index];
      motion.elapsed = Math.min(motion.duration, motion.elapsed + dt);
      const t = THREE.MathUtils.smoothstep(motion.elapsed / motion.duration, 0, 1);
      motion.mesh.position.lerpVectors(motion.from, motion.to, t);
      // Same rule as the clicked ring-up above: goods slide into the mouth,
      // they are not lobbed over the rim.
      motion.mesh.scale.copy(motion.baseScale).multiplyScalar(1 - t * 0.52);
      if (motion.elapsed < motion.duration) continue;
      bagDropMotions.splice(index, 1);
      bagGroup.add(motion.mesh);
      const contents = bagContentsNode
        ? bagGroup.worldToLocal(bagContentsNode.getWorldPosition(new THREE.Vector3()))
        : new THREE.Vector3(0, 0.18, 0);
      motion.mesh.position.set(contents.x, contents.y + 0.08, contents.z);
      motion.mesh.scale.copy(motion.baseScale).multiplyScalar(0.38);
      motion.mesh.userData.checkoutVisualState = 'packed-in-bag';
      sfx('bagItem');
    }
  }

  function updateCustomerPalmTarget() {
    if (!tx || !cust) {
      customerPalm.visible = false;
      return;
    }
    // Cash completion lives on the obvious POS Done button. Do not also expose
    // an unlabeled floating palm target for the same action.
    const wantsChange = false;
    const wantsOversize = tx.stage === 'bagging' && tx.receiptPacked
      && tx.items.some((item) => !item.bagged
        && itemMeshes.get(item.uid)?.userData?.catalogVisual?.separateHandoff);
    // The carrier is grabbable only once every dropped product has LANDED —
    // grabbing it mid-flight would carry the bag out from under them.
    const bagReady = tx.stage === 'bagging' && tx.receiptPacked && allBagged(tx)
      && bagDropMotions.length === 0;
    // ONLY WHEN THE PLAYER MUST AIM AT IT. Round 8 (2026-08-02): "when the
    // user purchases their item they have a grey white circle around one of
    // their arms." That was this translucent sphere, shown through the whole
    // AUTOMATIC bag delivery (bagReady + BagHandoff) where the player has
    // nothing to aim — it is a drop target, so it belongs only to the manual
    // oversize handoff, the one route that still asks for a drag.
    customerPalm.visible = wantsChange || wantsOversize;
    if (customerPalm.visible) {
      const side = 'R';
      customerPalm.position.copy(customerGripPoint(side) || customerAnchor(COUNTER_TOP + 0.10, side));
      customerPalm.material.opacity = 0.30 + Math.sin(performance.now() * 0.005) * 0.10;
    }
    // …and the bag's own readiness is independent of whether a target is drawn,
    // so the manual handles still arm on exactly the terms they always did.
    setBagPickable(bagReady && !scanDrag);
  }

  function durableProjectRetailFulfillment() {
    if (!tx || transactionKind !== 'retail' || tx.banked
        || !['receipt', 'bagging', 'done'].includes(tx.stage)) return false;

    bagDropMotions.length = 0;
    scanDrag = null;
    scanMotion = null;
    resetBagAtCounter();
    bagGroup.userData.checkoutOwner = 'register';
    if (cust) {
      // Retry reclaims renderer ownership from any interrupted handoff. Durable
      // transaction flags below immediately rebuild the correct presentation;
      // stale customer pointers must not survive as a second cleanup owner.
      cust.checkoutHandoffBag = null;
      cust.handoffReceipt = null;
      cust.checkoutHandoffProducts = [];
      cust.checkoutHandoffProductDisposer = null;
      cust.checkoutHandoffOversizeProducts = [];
    }

    // No paper to restage — the receipt's durable flags (printed/taken/packed)
    // are pure sim paperwork now, and this PROJECTION never advances them
    // (the durable-fulfillment contract). A resumed order still at the
    // receipt/unpacked checkpoints self-heals on the automatic path
    // (beginAutomaticReceipt) or on first bagging contact.

    let compactIndex = 0;
    let oversizeIndex = 0;
    for (const item of tx.items) {
      const mesh = itemMeshes.get(item.uid);
      if (!mesh) continue;
      const separateHandoff = !!mesh.userData.catalogVisual?.separateHandoff;
      if (item.bagged) {
        setObjectPickable(mesh, false);
        if (separateHandoff) {
          cust.mesh.add(mesh);
          mesh.scale.copy(mesh.userData.originalScale || new THREE.Vector3(1, 1, 1));
          mesh.position.set(
            -0.30 - oversizeIndex * 0.08,
            1.24 + oversizeIndex * 0.05,
            0.12 - oversizeIndex * 0.06,
          );
          mesh.rotation.set(0, -0.10 + oversizeIndex * 0.08, -Math.PI / 2);
          mesh.userData.checkoutVisualState = 'customer-held-separate-handoff';
          mesh.userData.checkoutOwner = 'register';
          oversizeIndex += 1;
          continue;
        }
        bagGroup.add(mesh);
        const contents = bagContentsNode
          ? bagGroup.worldToLocal(bagContentsNode.getWorldPosition(new THREE.Vector3()))
          : new THREE.Vector3(0, 0.18, 0);
        const column = compactIndex % 2;
        const row = Math.floor(compactIndex / 2);
        mesh.position.set(
          contents.x + (column ? 0.045 : -0.045),
          contents.y + 0.055 + row * 0.035,
          contents.z + (column ? 0.025 : -0.025),
        );
        mesh.quaternion.identity();
        mesh.scale.copy(mesh.userData.originalScale || new THREE.Vector3(1, 1, 1))
          .multiplyScalar(0.38);
        mesh.userData.checkoutVisualState = 'packed-in-bag';
        mesh.userData.checkoutOwner = 'bag';
        compactIndex += 1;
        continue;
      }
      if (item.scanned) {
        settleScannedProduct(mesh);
        setObjectPickable(mesh, tx.stage === 'bagging' && tx.receiptPacked);
      }
    }

    if (tx.stage === 'done') {
      setBagPickable(false);
      if (checkoutFlowState() === 'CustomerLeaving') {
        if (!holdBagAtCustomer() || !transferBagOwnershipToCustomer()) {
          autoFulfilled = false;
          return false;
        }
        deliveryPhase = 'released';
        finalizeTimer = 0.28;
        autoFulfilled = deliveryPhase === 'released';
        return autoFulfilled;
      }
      const deliveryStarted = beginBagDeliveryOrRelease();
      if (!deliveryStarted) {
        autoFulfilled = false;
        return false;
      }
      autoFulfilled = true;
      return true;
    }

    autoFulfilled = false;
    deliveryPhase = 'bagging-manual';
    setBagPickable(tx.receiptPacked && allBagged(tx));
    drawScreen();
    return true;
  }

  function retryFulfillmentPresentation() {
    if (!tx || tx.banked || !['receipt', 'bagging', 'done'].includes(tx.stage)) return false;
    deliveryPhase = null;
    deliveryTimer = 0;
    finalizeTimer = 0;
    if (transactionKind === 'retail') {
      if (tx.stage === 'receipt' && !tx.receiptPrinted) return beginAutomaticReceipt();
      const projected = durableProjectRetailFulfillment();
      if (projected) toast('Order handoff restored from the saved checkout progress.');
      return projected;
    }
    resetBagAtCounter();
    const restarted = finishAutomaticFulfillment();
    if (restarted) toast('Order handoff restarted safely.');
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
    postSaleHold = POST_SALE_HOLD_S;
    postSaleDisplay = {
      number: finishedTx.number,
      customer: finishedCustomer ? (finishedCustomer.fullName || finishedCustomer.name) : 'Guest',
      total: dueOf(finishedTx),
      subtotal: subtotal(finishedTx),
      tax: taxOf(finishedTx),
      taxRate: Number(finishedTx.taxRate) || 0,
      taxLabel: finishedTx.taxLabel || null,
      method: finishedTx.method,
      items: displayItems,
    };
    // (the till already slid shut with its sound the moment the change was handed
    // over in confirmChange — see the drawerClose there; nothing to close here)
    sfx('checkoutComplete');
    clearPhysicalTransaction({
      resetCounterBag: false,
      preserveCustomerBag: true,
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
    if (action === 'clear-post-sale') {
      clearPostSale();
      return true;
    }
    if (action === 'tab-checkout') {
      activeTab = 'checkout';
      if (!tx && !postSaleDisplay) {
        toast('No shopper is ready at the checkout yet. The screen will update when a customer reaches the counter.');
        setWorkspace('monitor');
      } else if (tx?.stage === 'scanning' && unscannedCount(tx) > 0) {
        setWorkspace('scan');
      } else if (tx?.method === 'card'
          && ['card-present', 'card-ready', 'card-entry', 'card-busy', 'card-declined'].includes(tx.stage)) {
        setWorkspace('card');
      } else if (tx?.method === 'cash' && tx.stage === 'cash-drawer') {
        setWorkspace('cash');
      }
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
      const result = tx && tx.stage === 'cash-tender' ? acceptPresentedCash() : false;
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
    const presentedCash = tx && (tx.stage === 'cash-tender'
      || (tx.stage === 'cash-drawer' && !tx.deposited))
      ? [...tenderMeshes, ...(tenderHandful ? [tenderHandful] : [])]
      : [];
    // Counter products are live click targets whenever the order is still
    // ringing up — clicking the goods IS the interaction, no "Bag Items"
    // button first.
    const counterItems = tx
      ? loose.filter((mesh) => {
        const item = tx.items.find((entry) => entry.uid === mesh.userData.uid);
        if (!item || item.bagged) return false;
        if (tx.stage === 'scanning') return !item.scanned;
        return tx.stage === 'bagging' && item.scanned;
      })
      : [];
    const fulfillment = [
      ...(bagGroup?.visible && bagGroup.userData.pick ? [bagGroup] : []),
      ...(customerPalm.visible ? [customerPalm] : []),
    ];
    // the drawer money itself is a click target: any part of the $5 stack IS
    // the $5 well, not just the invisible hotspot floating over it
    // The OFFERED card is a click target while it waits in the customer's hand
    // — the accept click is what starts the insertion (playtest 2026-07-30).
    const offeredCard = tx && tx.stage === 'card-ready' && cardMesh ? [cardMesh] : [];
    const candidates = workspace === 'scan'
      ? counterItems
      : workspace === 'cash'
        ? [...presentedCash, ...selectedChangeMeshes, ...slotHotspots, ...slotLabels,
          ...(drawerMoney ? [drawerMoney] : []), ...fulfillment]
        : [...presentedCash, ...offeredCard, ...counterItems, ...fulfillment];
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

  function handleCashPick(object) {
    if (!object) return false;
    const kind = object.userData.kind;
    if (kind === 'money' && object.userData.from === 'tender') {
      if (tx?.stage === 'cash-tender') return acceptPresentedCash();
      return startTenderDrag(object);
    }
    if (kind === 'money' && object.userData.from === 'change') {
      const selected = selectedChangeMeshes.find((candidate) => {
        for (let node = object; node; node = node.parent) if (node === candidate) return true;
        return false;
      }) || object;
      return returnSelectedChange(selected);
    }
    if (kind === 'money' && object.userData.from === 'drawer') {
      if (tx && tx.deposited) return selectChangeFromSlot(object.userData.denom);
      return false;
    }
    if (kind === 'drawer-slot') {
      if (tx && tx.deposited) return selectChangeFromSlot(object.userData.denom);
      return false;
    }
    if (kind === 'palm' && tx?.stage === 'cash-drawer' && tx.deposited) {
      return confirmChange();
    }
    return false;
  }

  // the cursor itself says "clickable": a pointer over money, wells, goods,
  // the handed card and the monitor's buttons
  function setHoverCursor(on) {
    if (canvas && canvas.style) canvas.style.cursor = on ? 'pointer' : '';
  }

  // Is this pick the payment the customer is holding out? Those get the green
  // grabbable rim; everything else keeps the brass working outline.
  function offeredPaymentTarget(object) {
    if (!object || !tx) return null;
    const kind = object.userData.kind;
    if (kind === 'payment-card' && tx.stage === 'card-ready' && cardMesh) {
      return [cardMesh];
    }
    const offeredCash = tx.stage === 'cash-tender'
      || (tx.stage === 'cash-drawer' && !tx.deposited);
    if (kind === 'money' && object.userData.from === 'tender' && offeredCash) {
      return tenderMeshes.length ? tenderMeshes : [object];
    }
    return null;
  }

  // Hover feedback for money: the offered payment rims BRIGHT GREEN (the
  // reference's grabbable affordance); a brass outline covers whatever else
  // the cursor would take — the whole labeled well for drawer money, the
  // piece itself for counted change.
  function updateCashHover(event) {
    const object = physicalPick(event);
    let target = null;
    let tip = '';
    const offered = offeredPaymentTarget(object);
    if (offered) {
      setGrabOutline(offered);
      showTip('Take payment', event);
      setHoverCursor(true);
      return;
    }
    if (object) {
      const kind = object.userData.kind;
      if (kind === 'drawer-slot' || (kind === 'money' && object.userData.from === 'drawer')) {
        if (tx && tx.deposited) {
          target = slotHotspots.find(
            (spot) => Number(spot.userData.denom) === Number(object.userData.denom),
          ) || object;
          tip = `${moneyLabel(Number(object.userData.denom))} - click: give one · right-click: take back`;
        }
      } else if (kind === 'money') {
        target = object;
        if (object.userData.from === 'change') {
          tip = `${moneyLabel(Number(object.userData.denom))} - click: take back`;
        }
      } else if (kind === 'payment-card' && tx?.stage === 'card-ready') {
        // the offered card reads as clickable before it is clicked
        target = cardMesh || object;
      }
    }
    setGrabOutline(null);
    showTip(tip, event);
    // denomination identity is carried by the permanent white tags over each well
    setHoverCursor(!!target || !!monitorActionAt(event));
  }

  // RIGHT-CLICK ON A DRAWER WELL TAKES ONE BACK (TCG change flow): the same
  // slot that gives a piece on left-click retracts the last counted piece of
  // that denomination from the counter pile on right-click. The counter pile
  // itself is untouched otherwise — no pixel-hunting the pile to fix an
  // over-count. Returns true only when the click was a retract.
  function retractChangeFromSlot(event) {
    if (!tx || tx.stage !== 'cash-drawer' || !tx.deposited) return false;
    const object = physicalPick(event);
    if (!object) return false;
    const kind = object.userData.kind;
    const overWell = kind === 'drawer-slot'
      || (kind === 'money' && object.userData.from === 'drawer');
    if (!overWell) return false;
    const denom = Number(object.userData.denom);
    const held = [...selectedChangeMeshes].reverse()
      .find((mesh) => Number(mesh.userData.denom) === denom);
    if (!held) {
      cashValidationWarning(`No ${moneyLabel(denom)} is counted out yet.`);
      sfx('thunk');
      return true; // the click WAS a retract attempt — do not fall through to exit
    }
    return returnSelectedChange(held) || true;
  }

  function onDown(event) {
    if (!active) return false;
    if (event.button === 2) {
      // Over an open drawer, right-click is the corrective verb: it takes one
      // of that well's denomination back off the counted change pile.
      if (workspace === 'cash' && retractChangeFromSlot(event)) return true;
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
      // Clicking an unscanned counter product from the monitor rings it up and
      // stages it in one gesture. Paid staged products become physical drags.
      // With more goods still waiting,
      // the camera swings to the counter for the rest of the order.
      if (object && object.userData.kind === 'item') {
        if (tx?.stage === 'bagging') startBaggingProductDrag(object);
        else bagProduct(object);
        if (tx?.stage === 'scanning') setWorkspace('scan');
        return true;
      }
      if (object?.userData.kind === 'bag') return startBagHandoffDrag();
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
      // The offered card: outlined on hover, clicked to take. Only then does
      // the chip insertion begin and the reader lift to the face.
      const picked = physicalPick(event);
      if (picked?.userData.kind === 'payment-card' && tx?.stage === 'card-ready') {
        return acceptPresentedCard();
      }
      const terminalKey = terminalKeyAt(event);
      if (terminalKey) return handleTerminalKey(terminalKey.id);
      if (tx?.stage === 'card-declined' && terminalHitAt(event)) {
        retryDeclinedCard();
      }
      return true;
    }
    if (workspace === 'scan') {
      const object = physicalPick(event);
      if (object && object.userData.kind === 'item') bagProduct(object);
      return true;
    }
    if (workspace === 'cash') {
      // the POS carries Undo/Clear during the cash count; the customer palm confirms.
      const action = monitorActionAt(event);
      if (action) {
        sfx('uiTick');
        handleMonitorAction(action);
        return true;
      }
      const object = physicalPick(event);
      if (object?.userData.kind === 'bag') startBagHandoffDrag();
      else handleCashPick(object);
      return true;
    }
    return true;
  }

  function onMove(event) {
    if (!active) return false;
    if (scanDrag) return movePhysicalDrag(event);
    updateLookTarget(event);   // the cursor leans the view around the pose
    if (workspace === 'card') {
      // the customer's offered card rims green under the cursor — the same
      // grabbable affordance the offered cash carries (reference 154506)
      const offered = offeredPaymentTarget(physicalPick(event));
      setGrabOutline(offered);
      showTip(offered ? 'Take payment' : '', event);
      setHoverCursor(!!offered || !!terminalKeyAt(event) || terminalXHitAt(event)
        || (tx?.stage === 'card-declined' && terminalHitAt(event)));
      return true;
    }
    if (workspace === 'scan') {
      const object = physicalPick(event);
      hoveredItem = object && object.userData.kind === 'item'
        && tx && !tx.items.find((item) => item.uid === object.userData.uid)?.scanned
        ? (itemMeshes.get(object.userData.uid) || object)
        : null;
      setHoverCursor(!!hoveredItem);
      return true;
    }
    if (workspace === 'cash') {
      updateCashHover(event);
      return true;
    }
    if (workspace === 'monitor' && tx) {
      // counter goods and presented cash glow under the cursor — both are
      // direct click targets from the monitor view. The customer's offered
      // cash gets the bright-green grabbable rim; goods keep the brass box.
      const object = physicalPick(event);
      const offered = offeredPaymentTarget(object);
      if (offered) {
        setGrabOutline(offered);
        showTip('Take payment', event);
        setHoverCursor(true);
        return true;
      }
      setGrabOutline(null);
      hideTip();
      let target = null;
      if (object && object.userData.kind === 'item') {
        const item = tx.items.find((candidate) => candidate.uid === object.userData.uid);
        const available = (tx.stage === 'scanning' && item && !item.scanned)
          || (tx.stage === 'bagging' && tx.receiptPacked && item?.scanned && !item.bagged);
        if (available) target = itemMeshes.get(object.userData.uid) || object;
      }
      setHoverCursor(!!target || !!monitorActionAt(event));
      return true;
    }
    if (workspace === 'monitor') {
      setHoverCursor(!!monitorActionAt(event));
      return true;
    }
    setGrabOutline(null);
    hideTip();
    setHoverCursor(false);
    return true;
  }

  function onUp(event) {
    if (!active) return false;
    if (scanDrag) {
      if (scanDrag.kind === 'money') return settleTenderDrag();
      if (scanDrag.kind === 'bag') return settleBagHandoff();
      if (scanDrag.kind === 'item' && scanDrag.scanning) return settleDraggedScan();
      if (scanDrag.kind === 'item') return settleBaggingProduct();
    }
    return true;
  }

  function onWheel(deltaY, shiftKey = false) {
    if (!active) return false;
    rotateHeldProduct(deltaY, shiftKey);
    return true;
  }

  function onKey(key) {
    if (!active) return false;
    if (key === 'Escape') {
      if (scanDrag) {
        recoverInput('player-cancelled-held-register-object');
        return true;
      }
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
    if (tx?.stage === 'card-entry' && /^\d$/.test(key)) {
      handleTerminalKey(`digit:${key}`);
      return true;
    }
    if (tx?.stage === 'card-entry' && key === 'Backspace') {
      handleTerminalKey('backspace');
      return true;
    }
    if (tx?.stage === 'card-entry' && key === 'Enter') {
      handleTerminalKey('confirm');
      return true;
    }
    // (No letter shortcuts for the cash flow: S is a walking key now that the
    // player moves freely at the till — the presented pile takes the click.)
    if ((key === 'z' || key === 'Z') && tx && tx.stage === 'cash-drawer' && tx.deposited) {
      undoLastChange();
      return true;
    }
    // SPACE FINISHES THE TRANSACTION at the drawer (TCG change flow): hands
    // the counted pile across exactly like the POS Done button. The sim's
    // change window still rules — short refuses, over is tolerated up to
    // MAX_EXTRA_CHANGE_CENTS, excess refuses.
    if (key === ' ' && tx && tx.stage === 'cash-drawer' && tx.deposited) {
      confirmChange();
      return true;
    }
    return true;
  }

  function tapTerminal() {
    if (!tx || tx.method !== 'card') return false;
    if (['card-present', 'card-ready', 'card-entry', 'card-declined'].includes(tx.stage)) {
      setWorkspace('card');
      return true;
    }
    return false;
  }

  function updateCard(dt) {
    if (!tx || tx.method !== 'card') return;
    // THE OFFERED CARD RIDES THE HAND, so the hand must HOLD the reach. The
    // customer controller only asserts PayCard once its sim state reaches
    // PAYING; before that its Stage pose would drop the arm every frame — and
    // the grip-parented card with it, out of sight behind the counter. The
    // register updates after customers.js in the clubhouse frame loop, so
    // re-asserting here pins the reach for the whole held-out offer.
    if (['card-present', 'card-ready'].includes(tx.stage)
        && cardInsertTimer <= 0 && cardU < 1) {
      poseCustomerForCheckout('PayCard');
    }
    if (cardPresentationTimer > 0 || (tx.stage === 'card-ready' && cardInsertTimer <= 0)) {
      cardReady.copy(customerCardReadyPoint());
    }
    if (tx.stage === 'receipt' && cardResultTimer > 0) {
      cardReady.copy(customerCardReadyPoint());
    }
    if (cardPresentationTimer > 0) {
      cardPresentationTimer = Math.max(0, cardPresentationTimer - dt);
      const progress = 1 - cardPresentationTimer / 0.55;
      if (cardMesh) {
        const start = cardReady.clone().add(
          frontDeskOffsetVector3(0.06, -0.24, -0.20),
        );
        const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
        cardMesh.position.lerpVectors(start, cardReady, eased);
        cardMesh.quaternion.copy(HELD_QUAT);
      }
      if (cardPresentationTimer === 0 && tx.stage === 'card-present') {
        const presented = presentCard(tx);
        if (presented.ok) {
          if (checkoutFlowState() === 'CardPresented') {
            flowTo('CardInsertReady', 'customer-card-ready-for-automatic-insertion');
          }
          if (!beginAutomaticCardInsert()) attachCardToCustomerHand();
        }
        sfx('cardTap');
        drawTerm();
        drawScreen();
      } else if (cardPresentationTimer === 0 && tx.stage === 'card-ready' && cardU < 1) {
        if (checkoutFlowState() === 'CardPresented') {
          flowTo('CardInsertReady', 'replacement-card-ready-for-automatic-insertion');
        }
        if (!beginAutomaticCardInsert() && cardInsertTimer === 0) attachCardToCustomerHand();
      }
    }

    if (tx.stage === 'card-ready' && cardPresentationTimer === 0
        && cardInsertTimer === 0 && checkoutFlowState() === 'CardInsertReady') {
      beginAutomaticCardInsert();
    }

    if (cardInsertTimer > 0) {
      cardInsertTimer = Math.max(0, cardInsertTimer - dt);
      const linear = 1 - cardInsertTimer / CARD_INSERT_TIME;
      const eased = THREE.MathUtils.smoothstep(linear, 0, 1);
      cardU = eased;
      if (cardMesh) {
        if (eased < 0.58) {
          cardMesh.position.lerpVectors(cardReady, cardInsertStart, eased / 0.58);
        } else {
          cardMesh.position.lerpVectors(cardInsertStart, cardInserted, (eased - 0.58) / 0.42);
        }
        cardMesh.position.y += Math.sin(linear * Math.PI) * 0.035;
        cardMesh.quaternion.slerpQuaternions(HELD_QUAT, cardInsertQuaternion, eased);
      }
      if (cardInsertTimer === 0) finishAutomaticCardInsert();
    }

    // The socket rides the reader, and the reader rises to the face. Re-read
    // the live insert path every frame the card is on its way in or seated, so
    // the protruding stub stays welded to the slot at any point of the lift.
    if (cardMesh && (cardInsertTimer > 0 || cardEjectTimer > 0
      || ['card-entry', 'card-busy', 'card-declined'].includes(tx.stage))) {
      refreshCardInsertPath();
    }
    if (cardEjectTimer > 0) {
      // C11 — NOTHING DECORATIVE ON THE WAY. This used to arc the card out of
      // the reader (a +0.025 sin hop) back to the held-out pose, and then a
      // second motion carried it down and across to the customer's side, where
      // it faded out. Two travels and a hop for a card that is simply done.
      //
      // The reader still releases it over cardEjectTimer — that part is the
      // machine giving the card back and it is not decoration — but it goes
      // straight out of the slot and DOWN ONTO THE DESK, flat, and stays there.
      // If the customer wants it they pick it up off the counter.
      cardEjectTimer = Math.max(0, cardEjectTimer - dt);
      const progress = THREE.MathUtils.smoothstep(1 - cardEjectTimer / 0.64, 0, 1);
      cardU = 1 - progress;
      if (cardMesh) {
        cardMesh.position.lerpVectors(cardInserted, cardDeskRest, progress);
        cardMesh.quaternion.slerpQuaternions(cardInsertQuaternion, CARD_FLAT_QUAT, progress);
      }
      if (cardEjectTimer === 0) cardU = 0;
    } else if (cardMesh && cardInsertTimer === 0
      && ['card-entry', 'card-busy', 'card-declined'].includes(tx.stage)) {
      cardMesh.position.copy(cardInserted);
      cardMesh.quaternion.copy(cardInsertQuaternion);
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
      // C11: the stow travel that used to live here is gone. The card was
      // already put down by the eject above; it stays on the desk where the
      // player can see it, rather than sliding off toward the customer and
      // fading out mid-slide.
      if (cardResultTimer === 0) {
        setWorkspace('monitor');
        if (tx && tx.stage === 'receipt') beginAutomaticReceipt();
      }
    }
  }

  // The domain's receipt STAGE still exists (paperwork), but no paper feeds:
  // this watcher only kicks the silent filing when the stage is reached
  // outside the automatic handoff paths (e.g. after a cash palm-clear).
  function updateReceipt() {
    if (!tx || tx.stage !== 'receipt') return;
    // Cash settlement reaches the domain's receipt stage before the physical
    // bundle reaches and clears the customer's palm. Wait for the handoff.
    if (tx.method === 'cash'
        && ['travel', 'customer-hold'].includes(cashHandoffPhase)) return;
    // Keep ACCEPTED readable on the physical card terminal before returning to
    // the monitor and finishing the fulfillment.
    if (cardResultTimer > 0) return;
    if (!tx.receiptPrinted && !autoFulfilled) beginAutomaticReceipt();
  }

  function transferBagOwnershipToCustomer() {
    if (!bagGroup || !cust) return false;
    bagGroup.userData = {
      ...bagGroup.userData,
      checkoutOwner: 'customer',
    };
    const oversizeProducts = [];
    for (const item of tx?.items || []) {
      if (!item.bagged) continue;
      const product = itemMeshes.get(item.uid);
      if (!product) continue;
      product.userData.checkoutOwner = 'customer';
      if (product.userData.catalogVisual?.separateHandoff) {
        cust.mesh.attach(product);
        oversizeProducts.push(product);
      }
    }
    cust.checkoutHandoffBag = bagGroup;
    cust.checkoutHandoffOversizeProducts = oversizeProducts;
    return true;
  }

  function beginBagDeliveryOrRelease() {
    const wantsBag = transactionKind === 'retail' && bagGroup;
    if (checkoutFlowState() === 'Bagging') {
      if (!flowTo(
        'BagHandoff',
        wantsBag
          ? 'physical-bag-transfer-started-after-receipt-contact'
          : 'receipt-only-handoff-ready-for-release',
      )) return false;
    }
    // Never let the renderer label goods released when an earlier physical
    // transition was rejected. Banking is downstream of this exact checkpoint.
    if (checkoutFlowState() !== 'BagHandoff') return false;
    if (wantsBag) {
      poseCustomerForCheckout('ReceiveBag');
      deliveryPhase = 'bag-deliver';
      deliveryTimer = BAG_DELIVER_TIME;
      bagDeliverScaleFrom = bagGroup.scale.x;
      const handle = bagHandlePoint();
      bagDeliverAnchorFrom.copy(handle || bagGroup.position);
    } else {
      if (!flowTo('CustomerLeaving', 'receipt-only-handoff-reached-customer')) return false;
      deliveryPhase = 'released';
      finalizeTimer = 0.28;
    }
    drawScreen();
    return true;
  }

  function holdBagAtCustomer() {
    if (!bagGroup) return false;
    const to = customerAnchor(COUNTER_TOP + 0.10, 'L');
    bagGroup.quaternion.copy(frontDeskQuaternion(0.035, 0.16, -0.055));
    bagGroup.position.copy(to);
    bagGroup.updateWorldMatrix(true, true);
    const anchorAt = bagHandlePoint();
    if (anchorAt) bagGroup.position.add(to).sub(anchorAt);
    return true;
  }

  // The delivery choreography that runs after payment succeeds. With the
  // receipt removed (round 7) there is exactly one physical delivery:
  //   cashier bag transfer → customer bag hold
  //   → released (finalizeTimer banks the sale and the customer leaves).
  function updateDelivery(dt) {
    if (!tx || !deliveryPhase || deliveryPhase === 'released') return;
    deliveryTimer = Math.max(0, deliveryTimer - dt);
    if (deliveryPhase === 'bag-deliver') {
      if (bagGroup) {
        const t = 1 - deliveryTimer / BAG_DELIVER_TIME;
        const eased = THREE.MathUtils.smoothstep(t, 0, 1);
        const to = customerAnchor(COUNTER_TOP + 0.10, 'L');
        bagDeliverAnchorAt.lerpVectors(bagDeliverAnchorFrom, to, eased);
        bagDeliverAnchorAt.y += Math.sin(t * Math.PI) * 0.14;
        // C4: ROUTE IT OVER THE DESK, NOT THROUGH IT.
        //
        // The destination is the customer's LEFT carry grip, and that grip is on
        // a hanging arm at hip height — well BELOW the counter top. A straight
        // lerp from a bag resting on the slab to a point under the slab goes
        // through it. Measured on a live card sale
        // (tools/qa/checkout-bag-handoff-path.js): 0.375 yd of the carrier was
        // under the counter top while its footprint was still on the counter,
        // against 0.000 for the same bag resting on it. The old +0.14 arc was
        // not close to covering that, and could not be — it is a constant, and
        // the depth it has to clear is the bag's own height.
        //
        // So: a derived floor rather than a bigger arc, applied AFTER the pose
        // so it is exact. Predicting the lift from the previous frame's box
        // left 12.6 mm of sink once C12 scaled the carrier up — the bag is
        // slerping upright through the handoff, so its hang below the handle
        // changes every frame and last frame's number is always short. This
        // measures what was actually drawn and corrects it.
        bagGroup.scale.setScalar(bagDeliverScaleFrom);
        // The carrier RESTS flat on the counter and is RIGHTED as it is lifted
        // into the customer's hand. Interpolating from identity would snap it
        // upright on the first frame of the handoff.
        bagGroup.quaternion.copy(bagCounterQuaternion())
          .slerp(frontDeskQuaternion(0.035, 0.16, -0.055), eased);
        // Drive the authored handle socket—not the bag's floor origin—to the
        // hand. At t=1 this is exact, so the transfer has visible contact.
        bagGroup.position.copy(bagDeliverAnchorAt);
        bagGroup.updateWorldMatrix(true, true);
        const handle = bagHandlePoint();
        if (handle) bagGroup.position.add(bagDeliverAnchorAt).sub(handle);
        {
          bagGroup.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(bagGroup);
          if (!box.isEmpty()) {
            // A POINT test cannot answer a question about a 0.5 yd wide object:
            // the first version tested the anchor's desk-local z and let the
            // bag's near face sit over the counter for another 0.13 yd. Test
            // the footprint.
            const planRadius = 0.5 * Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
            // WORLD -> ROOT before asking the desk frame anything. Box3 centres
            // are world; frontDeskLocalPoint takes root/interior-local, and the
            // interior sits ~360 yd out in x, so feeding it world coordinates
            // silently answered "nowhere near the counter" for every frame.
            const centre = root.worldToLocal(box.getCenter(_bagClearScratch));
            const local = frontDeskLocalPoint(centre.x, centre.z);
            if (Math.abs(local.z) - planRadius <= FRONT_DESK_FRAME.frontDepth / 2) {
              const topWorld = root.getWorldPosition(_bagClearScratch).y + COUNTER_TOP;
              const short = (topWorld + BAG_COUNTER_CLEARANCE) - box.min.y;
              if (short > 0) bagGroup.position.y += short;
            }
          }
        }
      }
      if (deliveryTimer === 0) {
        holdBagAtCustomer();
        if (!transferBagOwnershipToCustomer()) return;
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
        if (checkoutFlowState() !== 'BagHandoff'
            || !flowTo('CustomerLeaving', 'customer-held-bag-acceptance-beat-complete')) return;
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
    cashierHands.hideImmediately();
  }

  function updateDrawer(dt) {
    if (!drawerMotionRoot) return;
    if (drawerPresentationVisible(drawerWant, drawerAmount)
        && !drawerMotionRoot.visible) drawerMotionRoot.visible = true;
    if (Math.abs(drawerAmount - drawerWant) > 0.001) {
      const speed = drawerWant > drawerAmount ? DRAWER_OPEN_SPEED : DRAWER_CLOSE_SPEED;
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
    if (checkoutFlowState() === 'SelectingChange' && pendingChangeConfirmation) {
      const { automatic } = pendingChangeConfirmation;
      pendingChangeConfirmation = null;
      confirmChange(automatic);
    }
  }

  // Which preset the current checkout state deserves. Workspaces map directly;
  // the monitor workspace splits by what the player is actually doing there.
  function poseKey() {
    // THE CAMERA HOLDS STILL. Playtest 2026-07-30: "there is too much movement
    // going on... it makes the player dizzy." The fulfilment pan, the receipt
    // close-up and the card-terminal cut are all gone — scanning, payment
    // presentation, printing and the handovers share the one working frame, and
    // what needs attention comes TO the player (the reader lifts to the face
    // for card entry; the printer now sits beside the POS in frame). The only
    // camera moves left are the top-down drawer view — counting change on the
    // counter genuinely needs it — and the check-in glass.
    if (workspace === 'cash') return 'cash';
    if (activeTab === 'check-in' && !(deliveryPhase && deliveryPhase !== 'released')) return 'checkin';
    return 'overview';
  }

  // CHECK-IN, DERIVED FROM THE GLASS (greybox-walk item 9). The old authored
  // pose sat the eye at 1.26 looking 14.5° UP at the POS — the "watching the
  // screen from below the desk" read. Derive instead from the live screen quad:
  // eye on the screen's forward normal at the centre's own height, looking
  // straight at the face, standoff solved so the panel takes a comfortable
  // share of the frame. Falls back to the old preset until the POS mounts.
  const CHECKIN_FRAC_H = 0.60;
  function derivedCheckinPose() {
    const fallback = POSES.checkin;
    if (!screenPlane) return fallback;
    screenPlane.updateWorldMatrix(true, false);
    const centre = screenPlane.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1)
      .transformDirection(screenPlane.matrixWorld).normalize();
    const top = screenPlane.localToWorld(new THREE.Vector3(0, POS_PLANE_H / 2, 0));
    const worldH = top.distanceTo(centre) * 2;
    if (!(worldH > 0.01)) return fallback;
    const dist = (worldH / CHECKIN_FRAC_H)
      / (2 * Math.tan(THREE.MathUtils.degToRad(fallback.fov) / 2));
    // The quad's +Z must face the cashier; if an export or parent flip turns it
    // into the desk, the derived eye would sit behind the glass. The fallback
    // pose's own yaw/pitch encode the intended viewing direction — use it to
    // pick the side.
    const fb = fallback.pose;
    const intended = new THREE.Vector3(
      -Math.sin(fb.yaw) * Math.cos(fb.pitch),
      Math.sin(fb.pitch),
      -Math.cos(fb.yaw) * Math.cos(fb.pitch),
    );
    if (normal.dot(intended) > 0) normal.negate();
    const eyeWorld = centre.clone().addScaledVector(normal, Math.max(0.5, dist));
    // Poses live in interior-local coordinates (deskCameraPoint's frame);
    // projectLocal is the inverse of this conversion.
    const toLocal = (v) => ({
      x: v.x - interior.position.x,
      y: v.y - interior.position.y,
      z: v.z - interior.position.z,
    });
    return { pose: poseBetween(toLocal(eyeWorld), toLocal(centre)), fov: fallback.fov };
  }

  // THE DRAWER VIEW, DERIVED FROM THE DRAWER'S OWN BOUNDING BOX — the same
  // pattern the check-in glass uses (checkout-physicality round 2026-07-30:
  // "ease the camera to a pose derived from the drawer's bounding box"). The
  // authored POSES.cash sat the till in the frame's bottom-right corner where
  // the well labels went subpixel. This measures the OPEN tray and walks a
  // probe camera until every subject fits — every denomination readable and
  // clickable, the POS cash screen retained at the top of the frame. Falls
  // back to the authored pose until the kit drawer mounts. dynamicPose
  // re-reads it (cached per travel), so the normal CAMERA_TWEEN_SECONDS ease
  // glides onto it exactly like the other derived poses.
  // The frame must hold THREE subjects at once, reference-style (154525):
  // every well of the open tray below, the orange/navy POS cash screen above,
  // and the flat change pile growing on the counter between them. Cached per
  // drawer travel — the solve is a few hundred projections and must not run
  // per frame.

  // ONE FRAMING SOLVER FOR EVERY DERIVED POSE. Given the world points that
  // MUST be in shot and the direction the eye stands back along, this bisects
  // the standoff for the tightest frame that still holds every subject inside
  // the safe margins, then pans the aim so the subject box sits on the
  // requested anchor. Two passes, because panning changes what fits.
  // The multiplicative walk it replaced converged wherever it happened to
  // stop, which is why the till sat small and dead-centre with a third of the
  // frame given to bare counter on either side.
  //
  // eyeY PINS THE EYE TO A HEIGHT and solves everything else under it (playtest
  // round 5, 2026-07-30: "it's supposed to look like the view a normal cashier
  // would have, not a 10 ft tall cashier"). With it set, the bisection walks
  // the HORIZONTAL standoff only, the eye stays on that plane, and the down
  // angle falls out of wherever the aim lands — so a taller subject list can
  // never buy its fit by floating the camera up over the counter again.
  const framingProbe = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60);
  const framingScratch = new THREE.Vector3();
  const framingBackFlat = new THREE.Vector3();
  function solveFramingPose({
    subjects, look, back, fov, marginX, marginY,
    anchorX = 0, anchorY = 0, minDist = 0.40, maxDist = 5.0, aspect = 16 / 9,
    eyeY = null,
  }) {
    framingProbe.fov = fov;
    framingProbe.aspect = aspect;
    framingProbe.updateProjectionMatrix();
    const aim = look.clone();
    const half = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    let dist = maxDist;
    framingBackFlat.set(back.x, 0, back.z);
    if (framingBackFlat.lengthSq() < 1e-9) framingBackFlat.set(0, 0, 1);
    framingBackFlat.normalize();
    const place = (d) => {
      if (eyeY === null) framingProbe.position.copy(aim).addScaledVector(back, d);
      else {
        framingProbe.position.copy(aim).addScaledVector(framingBackFlat, d);
        framingProbe.position.y = eyeY;
      }
      framingProbe.lookAt(aim);
      framingProbe.updateMatrixWorld(true);
    };
    const measure = () => {
      let minX = Infinity; let maxX = -Infinity;
      let minY = Infinity; let maxY = -Infinity;
      for (const subject of subjects) {
        framingScratch.copy(subject).project(framingProbe);
        minX = Math.min(minX, framingScratch.x);
        maxX = Math.max(maxX, framingScratch.x);
        minY = Math.min(minY, framingScratch.y);
        maxY = Math.max(maxY, framingScratch.y);
      }
      return {
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        hx: (maxX - minX) / 2,
        hy: (maxY - minY) / 2,
      };
    };
    for (let pass = 0; pass < 2; pass += 1) {
      let lo = minDist;
      let hi = maxDist;
      for (let step = 0; step < 16; step += 1) {
        const mid = (lo + hi) / 2;
        place(mid);
        const box = measure();
        if (box.hx <= marginX && box.hy <= marginY) hi = mid; else lo = mid;
      }
      dist = hi;
      place(dist);
      const box = measure();
      // Pan the aim so the subject box lands on the anchor. One NDC unit is
      // dist*tan(fov/2) world units vertically, times the aspect horizontally.
      const right = new THREE.Vector3().setFromMatrixColumn(framingProbe.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(framingProbe.matrixWorld, 1);
      aim.addScaledVector(right, (box.cx - anchorX) * dist * half * aspect)
        .addScaledVector(up, (box.cy - anchorY) * dist * half);
    }
    place(dist);
    return { eye: framingProbe.position.clone(), look: aim.clone(), fov };
  }

  // Poses live in interior-local coordinates (deskCameraPoint's frame);
  // projectLocal is the inverse of this conversion.
  const poseLocal = (v) => ({
    x: v.x - interior.position.x,
    y: v.y - interior.position.y,
    z: v.z - interior.position.z,
  });
  const framedPose = (solved) => ({
    pose: poseBetween(poseLocal(solved.eye), poseLocal(solved.look)),
    fov: solved.fov,
  });
  // The staff-side normal, pitched up into a working stance. The reference
  // camera stands BEHIND the counter looking down about 40-45° (154454).
  function staffStandoffDirection(pitchRadians) {
    return frontDeskOffsetVector3(0, 0, 1).normalize()
      .multiplyScalar(Math.cos(pitchRadians))
      .add(new THREE.Vector3(0, Math.sin(pitchRadians), 0))
      .normalize();
  }

  const CASH_POSE_MARGIN_X = 0.97;
  const CASH_POSE_MARGIN_Y = 0.95;
  let cashPoseCache = null; // { amount, value }
  function derivedCashDrawerPose() {
    const fallback = POSES.cash;
    if (!drawerMotionRoot || !drawerMotionRoot.visible) return fallback;
    if (cashPoseCache && Math.abs(cashPoseCache.amount - drawerAmount) < 0.002) {
      return cashPoseCache.value;
    }
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(drawerMotionRoot);
    if (box.isEmpty()) return fallback;
    // Project the box to where the tray will REST once fully open, so the
    // tween lands on a stable frame instead of chasing the slide.
    box.translate(frontDeskOffsetVector3(0, 0, REGISTER.drawer.travel * (1 - drawerAmount)));
    const trayCentre = box.getCenter(new THREE.Vector3());
    const posCentre = screenPlane
      ? screenPlane.getWorldPosition(new THREE.Vector3())
      : root.localToWorld(new THREE.Vector3(
        REGISTER.monitor.x, COUNTER_TOP + 0.42, REGISTER.monitor.z,
      ));
    const posHalfH = POS_PLANE_H * POS_HARDWARE_SCALE * 0.55;
    const pile = root.localToWorld(new THREE.Vector3(
      REGISTER.changeHandoff.x, COUNTER_TOP, REGISTER.changeHandoff.z,
    ));
    const subjects = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          subjects.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    subjects.push(posCentre.clone().add(new THREE.Vector3(0, posHalfH, 0)));
    subjects.push(posCentre.clone().add(new THREE.Vector3(0, -posHalfH, 0)));
    subjects.push(pile.clone().add(frontDeskOffsetVector3(-REGISTER.changeHandoff.w / 2, 0, 0)));
    subjects.push(pile.clone().add(frontDeskOffsetVector3(REGISTER.changeHandoff.w / 2, 0, 0)));
    const fov = fallback.fov || 52;
    const value = framedPose(solveFramingPose({
      subjects,
      look: trayCentre.clone().lerp(posCentre, 0.34),
      // ≈34° above the counter, not 47°: a steeper eye foreshortens the tray's
      // depth so hard that the wells read square instead of the reference's
      // wide shallow row (154525), and the labels crowd together.
      back: staffStandoffDirection(0.60),
      fov,
      marginX: CASH_POSE_MARGIN_X,
      marginY: CASH_POSE_MARGIN_Y,
      // Reference 154525 puts the till in the LOWER-RIGHT quadrant with the
      // bare counter (and the growing change pile) to its left, so the whole
      // group sits right of centre rather than dead centre.
      anchorX: 0.13,
      minDist: 0.5,
      maxDist: 3.0,
    }));
    cashPoseCache = { amount: drawerAmount, value };
    return value;
  }

  // THE WORKING FRAME, DERIVED FROM WHAT IS ON THE COUNTER — checkout
  // physicality item 1 (2026-07-30). The authored diagonal put the eye at the
  // counter's right end looking down its length: the POS turned ~25° away and
  // clipped the frame edge, the bag hung half outside on the left, and the
  // customer's arm swung across the middle. Reference 154454 is a SQUARE-ON
  // view from behind the counter — bag left third, goods centre, POS right
  // third facing the player, the customer standing across it — so the eye is
  // solved on the counter's own perpendicular from the world positions of the
  // five things that must be in shot: bag, staged goods, POS glass, card
  // station, customer. Square-on is also what un-rotates the monitor: its
  // authored yaw is already zero, so a perpendicular camera sees it flat.
  //
  // PLAYTEST ROUND 5 (2026-07-30) — "why is the view of the checkout like birds
  // eye view? It's supposed to look like the view that a normal cashier would
  // have in real life, not a 10ft tall cashier." Measured, the old solve stood
  // the eye 1.99 above the staff floor: half a body height too tall, which is
  // exactly what "bird's eye" means. Two things caused it, and both are fixed
  // here rather than by typing coordinates:
  //   1 the eye height was a FREE variable. Pitching the standoff 32° up and
  //     bisecting the slant distance let the solver buy any fit it liked by
  //     floating higher. It is now PINNED (solveFramingPose's eyeY) to the
  //     counter's own standing eye line, and only the horizontal standoff and
  //     the resulting down angle are solved.
  //   2 the customer's CROWN was a subject, so the frame could never crop their
  //     head — and a frame that contains a whole standing adult across a
  //     counter is, necessarily, shot from above them. The reference crops the
  //     customer at the shoulders; so does this. Full containment of every
  //     subject is no longer the goal, the human eye line is.
  // "Nothing cut off by the frame edge" is therefore retired as an acceptance:
  // the margins now hold the WORKING SURFACE — bag, goods, POS, reader — while
  // the person across the counter is free to run off the top.
  // Just over 1: the counter kit is allowed to KISS the frame edges and let its
  // extremes — the bag's closed end, the monitor's outer bezel — run a few per
  // cent past them. Every tenth of margin here is standoff, and standoff is what
  // turns the counter top into an edge-on sliver with the cabinet below it.
  const WORK_POSE_MARGIN_X = 1.06;
  // Deliberately slack. If the vertical margin binds, the solver answers a tall
  // subject by retreating, and retreating flattens the counter into the thin
  // edge-on band the round-5 first cut produced. Height is composed, not fitted.
  const WORK_POSE_MARGIN_Y = 1.60;
  // Just above centre. -0.02 yielded the 35-36° working glance but sliced the
  // counter's front band off at the frame's bottom edge — and round 7 mounts
  // the glowing device bay ON that band. +0.045 raises the composition enough
  // that the bay's upper half and the parked reader's head read in frame,
  // while the customer still crops through the chest.
  const WORK_POSE_ANCHOR_Y = 0.045;
  let workPoseCache = null; // { key, value }
  // ONE FRAME FOR THE WHOLE SHIFT. Round 8 (2026-08-02): "after the transaction
  // is over it moves the screen to the right — make it stay in the same
  // forward facing view." Cause: every subject below used to be LIVE — the
  // bag group, each item mesh, the customer's real position — so when the sale
  // banked and all three vanished, the cache key changed and the solver
  // re-composed around what was left (bag + POS + card station), whose centre
  // sits well to the register side. The frame swung right on the last frame of
  // every sale.
  //
  // The composition is now built from LAYOUT ONLY: authored footprints and the
  // queue head, none of which depend on a transaction existing. The key is
  // therefore constant for a whole session and the frame is literally the same
  // one you entered on — which is what was asked for, and also why the "hold
  // still" ruling from 2026-07-30 survives its last leak.
  function derivedWorkingPose() {
    const fallback = MIXED_POSE;
    root.updateMatrixWorld(true);
    // screenPlane mounts with the deferred kit; before then the solve uses the
    // authored monitor point, so the key records which of the two it used.
    const key = screenPlane ? 'layout|glass' : 'layout|nominal';
    if (workPoseCache && workPoseCache.key === key) return workPoseCache.value;
    const subjects = [];
    const addBox = (object, inflate = 0) => {
      if (!object) return false;
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return false;
      if (inflate) box.expandByScalar(inflate);
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) subjects.push(new THREE.Vector3(x, y, z));
        }
      }
      return true;
    };
    // 1 — the carrier's authored footprint at counter-left (NOT the live bag,
    //     which travels to the customer during the handoff)
    // 2 — the goods: their authored staging footprints (NOT the live items,
    //     which are disposed the moment the sale banks)
    for (const rect of [REGISTER.bagging, REGISTER.staging, REGISTER.scannedStaging]) {
      for (const x of [rect.minX, rect.maxX]) {
        for (const z of [rect.minZ, rect.maxZ]) {
          subjects.push(root.localToWorld(new THREE.Vector3(x, COUNTER_TOP + 0.10, z)));
        }
      }
    }
    // 3 — the POS glass, corner to corner, so no edge of it clips out
    if (screenPlane) addBox(screenPlane, 0.02);
    else {
      subjects.push(root.localToWorld(new THREE.Vector3(
        REGISTER.monitor.x, COUNTER_TOP + 0.52, REGISTER.monitor.z,
      )));
    }
    // 4 — the card station, so the reader has somewhere to rise from in shot
    subjects.push(root.localToWorld(new THREE.Vector3(
      CARD_STATION.x, COUNTER_TOP + 0.04, CARD_STATION.z,
    )));
    // 5 — where a customer STANDS (the queue head), at hand height and nothing
    // higher. This one point keeps their side of the counter inside the frame;
    // everything above it is deliberately free to run off the top, which is how
    // a standing cashier actually sees the person opposite. The old solve asked
    // for the CROWN, and a frame that must contain a whole standing adult
    // across a counter can only be shot from above them — the bird's-eye
    // report. Taking the queue SLOT rather than the live body is what stops the
    // frame drifting when nobody is there.
    {
      const head = queueSlot(0);
      subjects.push(root.localToWorld(new THREE.Vector3(
        head.x, CHECKOUT_STAFF_FLOOR_Y + CHECKOUT_CUSTOMER_HANDS_Y, head.z,
      )));
    }
    if (subjects.length < 8) return fallback;
    const centre = new THREE.Box3().setFromPoints(subjects).getCenter(new THREE.Vector3());
    const value = framedPose(solveFramingPose({
      subjects,
      look: centre,
      // Purely horizontal: the counter's own normal. The eye's HEIGHT is the
      // pinned constraint below, so the standoff must carry no pitch of its own
      // or the two would fight and the solve would drift back up.
      back: staffStandoffDirection(0),
      eyeY: interior.position.y + CHECKOUT_WORKING_EYE_Y,
      // WIDTH sets the standoff, HEIGHT sets the tilt. The counter kit spans
      // ~2 yd of desk, so the horizontal fit is the only honest constraint on
      // how close a cashier can stand; the vertical margin is deliberately
      // slack and anchorY does the composing instead. Sitting the kit just
      // below frame centre is the same thing as tilting the eye ~36° DOWN,
      // which is what puts the counter's far edge a third of the way down, the
      // counter top across the lower two thirds, and the crop line through the
      // customer's chest. Round 7 lifts the anchor slightly so the counter's
      // FRONT BAND — the glowing device bay from the reference — enters the
      // bottom of the frame instead of being sliced off by it.
      anchorY: WORK_POSE_ANCHOR_Y,
      fov: fallback.fov || CHECKOUT_WORKING_FOV,
      marginX: WORK_POSE_MARGIN_X,
      marginY: WORK_POSE_MARGIN_Y,
      minDist: 0.55,
      maxDist: 5.0,
    }));
    workPoseCache = { key, value };
    return value;
  }

  // The check-in glass and the open drawer derive their frames from the live
  // hardware; every other state keeps its static preset.
  function dynamicPose(key) {
    if (key === 'checkin') return derivedCheckinPose();
    if (key === 'cash') return derivedCashDrawerPose();
    if (key === 'overview' || key === 'scan') return derivedWorkingPose();
    return POSES[key] || POSES.overview;
  }

  function updateCamera(dt) {
    if (!active) return;
    const key = poseKey();
    // Dynamic poses re-read their live target every frame, so fulfillment and
    // card handoff follow the customer. The seated card reader stays fixed;
    // static poses return a constant, so tracking them each frame is a no-op.
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
    // Scanner goods and monitor buttons stay fixed unless the player holds the
    // explicit Shift glance modifier. Hardware-focused workspaces retain the
    // eased neck motion used to glance between props.
    // …and NOT while the reader floats at the face. The floated terminal holds
    // one frozen anchor (playtest 2026-07-30: stillness), so a swaying camera
    // under it makes every projected key drift as the cursor travels toward it
    // — measured: the acceptance click on the reader's X sampled a stable point
    // and the sway then moved the glass 34 px before the click landed.
    if (((workspace === 'scan' || workspace === 'monitor') && !workingGlanceActive)
      || terminalShouldFloat()) {
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
    updateTerminalKeyPulses(dt);
    updateTerminalFloat(dt);
    const animationDt = checkoutAnimationDelta(dt, accessibilityPrefs);
    // Settings are inaccessible while the register owns input, but a renderer
    // refresh can still replace the live value. Reassert without recapturing;
    // inactive front-desk play never reads or writes the player's setting.
    if (active) activeRegisterGtaoOverride.setActive(true);
    // Recovery owns this frame, and the resumed state owns the next one. That
    // frame boundary prevents a timed-out animation from both rolling back and
    // advancing again from stale timers/callback state in the same update.
    // The finished sale clears itself. A receipt on screen with no way past it
    // but "Return to Shop" is what made the player leave the station between
    // every customer.
    if (postSaleDisplay && !tx && postSaleHold > 0) {
      postSaleHold -= dt;
      if (postSaleHold <= 0) clearPostSale();
    }
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
      if (scanReturnTimer === 0 && workspace === 'scan' && tx?.stage === 'scanning') {
        setWorkspace('monitor');
      }
    }
    if (paymentAutoTimer > 0 && !paymentAutoSuppressed && tx?.stage === 'scanning'
        && unscannedCount(tx) === 0 && !scanMotion) {
      paymentAutoTimer = Math.max(0, paymentAutoTimer - animationDt);
      if (paymentAutoTimer === 0) choosePayment(preferredPayment());
    }
    // Payment begins automatically after the last product reaches the bag.
    // Once the receipt and bag have physically reached the customer, the sale
    // banks itself and the customer leaves — no separate "finalize" click. A
    // failed attempt re-arms the timer: with no manual button in the automatic
    // flow, a transient refusal must never strand a paid customer.
    if (tx && tx.stage === 'done'
        && deliveryPhase === 'released' && checkoutFlowState() === 'CustomerLeaving') {
      finalizeTimer = Math.max(0, finalizeTimer - animationDt);
      if (finalizeTimer === 0 && !finalizeTransaction()) finalizeTimer = 0.6;
    }
    if (tx && tx.stage === 'card-busy') {
      const dots = advanceTerminalBusyDots(termDotsTimer, dt);
      termDotsTimer = dots.elapsed;
      if (dots.changed) drawTerm();
    }
    // The held-out cash needs the same per-frame reach as the card offer: the
    // fan is laid out at the grip, and a Stage-pose frame would pull the hand
    // away from underneath it (see the matching note in updateCard).
    if (tx && tx.method === 'cash' && tx.stage === 'cash-tender') {
      poseCustomerForCheckout('PayCash');
    }
    updateCard(animationDt);
    updateDrawer(animationDt);
    updateCashMotions(animationDt);
    updateCashHandoffHold(animationDt);
    updateCashAccessibility(animationDt);
    updateReceipt(animationDt);
    updateDelivery(animationDt);
    updateBagDropMotions(animationDt);
    updateCustomerPalmTarget();
    updateCamera(animationDt);
    updateCashierHandPresentation(animationDt);
  }

  function hint() {
    if (workspace === 'monitor') {
      if (tx && tx.stage === 'cash-tender') {
        return { text: 'Click the customer’s cash to take it', total: false, drawer: false };
      }
      return { text: 'Use the front-desk monitor. Hold Shift + move to glance; Escape exits safely.', total: false, drawer: false };
    }
    if (workspace === 'scan') {
      return {
        text: 'Click each product once to ring it up and place it in the bag.',
        total: false,
        drawer: false,
      };
    }
    if (workspace === 'card') {
      return { text: checkoutInstruction(), total: false, drawer: false };
    }
    if (workspace === 'cash') {
      return { text: checkoutInstruction(), total: false, drawer: true };
    }
    return { text: 'Front desk active', total: false, drawer: false };
  }

  function label() {
    if (tx) {
      const remaining = unscannedCount(tx);
      return `${cust ? cust.name : 'Customer'} is waiting - [E] open checkout${remaining ? ` (${remaining} to bag)` : ''}`;
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

  function cardKeyScreenPoint(actionId) {
    // The projection of the PHYSICAL key mesh — same contract every driver
    // already clicks, new target. The Terminal_* body is preferred over its
    // t_glyph_* face so the point lands on the cap, not the paint.
    //
    // Two driver families ask by LABEL ('OK') rather than by action id
    // ('confirm') — the old canvas-table lookup silently returned null for
    // those, which is a wrong answer dressed as an empty one. Normalise both.
    const id = String(actionId ?? '');
    const action = /^\d$/.test(id) ? `digit:${id}`
      : id === 'OK' ? 'confirm'
        : id === 'CLR' || id === 'X' ? 'clear'
          : id;
    const meshes = terminalKeyByAction.get(action);
    if (!meshes || !meshes.length) return null;
    const mesh = meshes.find((entry) => entry.name.startsWith('Terminal_')) || meshes[0];
    root.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    world.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      visible: tx?.stage === 'card-entry',
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
  const presentedCardScreenPoint = () => {
    const point = meshScreenPoint(cardMesh);
    return point ? { ...point, clickable: !!(tx && tx.stage === 'card-ready') } : null;
  };
  const cardTerminalScreenPoint = () => meshScreenPoint(termScreenPlane);
  const insertAt = () => ({
    start: { x: cardInsertStart.x, y: cardInsertStart.y, z: cardInsertStart.z },
    inserted: { x: cardInserted.x, y: cardInserted.y, z: cardInserted.z },
    u: cardU,
    automatic: true,
    cashierHandsVisible: cashierHands.root.visible,
  });
  const scanPresentation = () => {
    const phaseT = scanMotion?.duration
      ? THREE.MathUtils.clamp(scanMotion.elapsed / scanMotion.duration, 0, 1)
      : 0;
    return {
      active: !!scanMotion,
      phase: scanMotion?.phase || null,
      phaseT,
      uid: scanMotion?.uid || null,
      elapsed: scanMotion?.elapsed || 0,
      duration: scanMotion?.duration || 0.48,
      committed: !!scanMotion?.committed,
      scannerFeedback: scannerFeedbackMode,
      lastRead: lastScanEvidence ? {
        ...lastScanEvidence,
        ...(lastScanEvidence.barcodePosition
          ? { barcodePosition: [...lastScanEvidence.barcodePosition] } : {}),
        ...(lastScanEvidence.barcodeNormal
          ? { barcodeNormal: [...lastScanEvidence.barcodeNormal] } : {}),
        ...(lastScanEvidence.rayOrigin
          ? { rayOrigin: [...lastScanEvidence.rayOrigin] } : {}),
        ...(lastScanEvidence.rayDirection
          ? { rayDirection: [...lastScanEvidence.rayDirection] } : {}),
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
    const bagPosition = bagHandlePoint();
    const bagTarget = cust ? customerGripPoint('L') : null;
    return {
      active: !!deliveryPhase && deliveryPhase !== 'released',
      phase: deliveryPhase,
      holdRemaining: deliveryTimer,
      bagHandlePosition: bagPosition ? bagPosition.toArray() : null,
      bagTarget: bagTarget ? bagTarget.toArray() : null,
      bagDistanceToPalm: bagPosition && bagTarget ? bagPosition.distanceTo(bagTarget) : null,
      bagAcceptedByCustomer: !!(bagGroup && cust?.checkoutHandoffBag === bagGroup),
      bagMouth: bagMouth.toArray(),
      lastPhysicalDrop: lastPhysicalDropEvidence ? {
        ...lastPhysicalDropEvidence,
        position: [...lastPhysicalDropEvidence.position],
        target: [...lastPhysicalDropEvidence.target],
      } : null,
      cashierHandsVisible: cashierHands.root.visible,
    };
  };

  return {
    simplified: true,
    presentedCashScreenPoint,
    presentedCardScreenPoint,
    // QA-only: the game's own X hit-test and screen UV at a page point, so a
    // driver can measure the exact math a real click runs instead of rebuilding
    // it outside and diverging (which is how a probe blamed the wrong canvas).
    debugTerminalXAt: (x, y) => ({
      hit: terminalXHitAt({ clientX: x, clientY: y }),
      uv: terminalScreenUV({ clientX: x, clientY: y }),
      canvasRect: (() => { const r = canvas.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })(),
      xBox: TERM_X_BOX,
      canvasSize: { w: TERM_CANVAS_W, h: TERM_CANVAS_H },
    }),
    cardTerminalScreenPoint,
    // QA-only: the SOLVED working frame, so a driver can separate "the pose
    // re-composed" from "the live camera is mid-ease or leaning on the
    // cursor". Round 8 needed exactly that split to prove the post-sale swing
    // was gone rather than merely small.
    debugWorkingPose: () => {
      const solved = dynamicPose('overview');
      return { ...solved.pose, fov: solved.fov, poseKey: poseKey() };
    },
    insertAt,
    root,
    screenMaterial,
    termMaterial,
    attachScreen,
    attachTerm,
    attachScanner,
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
    monitorActionPoint,
    monitorScreenPoint,
    cardXScreenPoint,
    cardKeyScreenPoint,
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
