// PHYSICAL DELIVERIES — the truck leaves BOXES, not numbers. Contents enter
// the backroom only when a box is opened; carrying is one box at a time.
// Headless like every sim module; the clubhouse renders THIS state.

import { skuById } from '../data/shopItems.js';
import { placeableSpecBySkuId } from '../data/placeableItems.js';
import {
  BOX_KINDS,
  SHIPMENT_PACKAGING_SCHEMA_VERSION,
  boxWeight,
  packagingMetadataForSavedBox,
  planShipment,
} from '../data/boxes.js';
import { FLOOR_BOX_SURFACE_ID } from '../data/boxPlacementSurfaces.js';
import {
  assignDeliveryPallets, exposedDeliveryPadBoxIds,
} from '../data/deliveryStaging.js';
import {
  HAND_TRUCK_EQUIPMENT_ID,
  STOCKING_CART_EQUIPMENT_ID,
  deliveryEquipmentFit,
  deliveryEquipmentPlacementForBox,
  deliveryEquipmentSocketsConflict,
  normalizeDeliveryEquipmentId,
  preferredDeliveryEquipmentSocketIds,
} from '../data/deliveryEquipment.js';
import { armRoom, setCarry } from './stocking.js';
import { notify } from './notifications.js';
import {
  previewBoxPlacement,
  surfaceById,
} from './boxPlacement.js';
import {
  importLegacyStoredPlaceables,
  storeDeliveredPlaceables,
} from './propertyInventory.js';
import {
  ensureArrivalOrder,
  forgetInventoryOperationsForBox,
  openBoxInventory,
  receiveBoxInventory,
  refreshOrderFromLedger,
  takeBoxInventory,
} from './inventoryLifecycle.js';

// kept for old callers; the truth is unitsPerBox(sku), which knows that a stand bag
// does not pack twelve to a carton just because its category says 'accessories'
export const CASE_SIZE = {
  clubs: 2,
  balls: 12,
  apparel: 8,
  accessories: 12,
  provisions: 12,
  supplies: 1,
  decor: 1,
};

// THE SIX STATUSES AN ORDER WEARS WHILE IT IS STILL OUT THERE. The other three
// ('delivered', 'partial', 'unpacked') belong to a shipment on your floor, not to
// an order on a van — see shipmentStatus. Six plus three is the brief's nine.
export const ORDER_FLOW = ['received', 'processing', 'packed', 'shipped', 'out', 'arriving'];

// How many cartons will physically stand on the receiving pad. A van cannot unload into a
// full pad, and pretending it can is how you end up with a tower of cardboard in the yard.
export const PAD_CAPACITY = 9;
export const FALLBACK_CAPACITY = 12;

// Packaging evolves independently from the course save, so it carries a small local schema.
export const DELIVERIES_SCHEMA_VERSION = 5;
export const BOX_SCHEMA_VERSION = 5;

// Location and contents are separate facts. This is the one persisted lifecycle of the carton.
export const BOX_LIFECYCLE = Object.freeze({
  SEALED: 'SEALED',
  CUTTING: 'CUTTING',
  CUT_COMPLETE: 'CUT_COMPLETE',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  PARTIALLY_EMPTIED: 'PARTIALLY_EMPTIED',
  EMPTY: 'EMPTY',
  FLATTENING: 'FLATTENING',
  DISCARDED: 'DISCARDED',
});

const BOX_LIFECYCLE_ORDER = Object.freeze([
  BOX_LIFECYCLE.SEALED,
  BOX_LIFECYCLE.CUTTING,
  BOX_LIFECYCLE.CUT_COMPLETE,
  BOX_LIFECYCLE.OPENING,
  BOX_LIFECYCLE.OPEN,
  BOX_LIFECYCLE.PARTIALLY_EMPTIED,
  BOX_LIFECYCLE.EMPTY,
  BOX_LIFECYCLE.FLATTENING,
  BOX_LIFECYCLE.DISCARDED,
]);
const BOX_LIFECYCLE_SET = new Set(BOX_LIFECYCLE_ORDER);

// ensureDeliveries() is intentionally safe to call from renderer loops. A
// newly parsed save owns a new boxes array and is fully validated once even if
// it already claims the current schema. Subsequent calls pay only for this
// small deterministic signature unless a placement/layout blocker changes.
const WORLD_PLACEMENT_HEAL_CACHE = new WeakMap();

export function canTransitionBoxState(from, to) {
  const a = typeof from === 'object' && from ? boxLifecycleState(from) : from;
  const b = typeof to === 'object' && to ? boxLifecycleState(to) : to;
  const i = BOX_LIFECYCLE_ORDER.indexOf(a);
  return i >= 0 && BOX_LIFECYCLE_ORDER[i + 1] === b;
}

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

// One authored cut path drives three independently visible tape strips.
export const TAPE_SEGMENT_RANGES = Object.freeze({
  centre: Object.freeze([0, 0.6]),
  left: Object.freeze([0.6, 0.8]),
  right: Object.freeze([0.8, 1]),
});

function tapeSegmentsAt(progress) {
  const p = clamp01(progress);
  const segment = ([start, end]) => clamp01((p - start) / (end - start));
  return {
    centre: segment(TAPE_SEGMENT_RANGES.centre),
    left: segment(TAPE_SEGMENT_RANGES.left),
    right: segment(TAPE_SEGMENT_RANGES.right),
  };
}

function normalizeFlaps(flaps, legacyOpened = false) {
  if (!Array.isArray(flaps)) return legacyOpened ? [1, 1, 1, 1] : [0, 0, 0, 0];
  if (flaps.length === 2) {
    // The shipped controls opened two opposing pairs. Preserve that pose across four panels.
    return [clamp01(flaps[0]), clamp01(flaps[1]), clamp01(flaps[0]), clamp01(flaps[1])];
  }
  return [0, 1, 2, 3].map((i) => clamp01(flaps[i]));
}

function flapValues(box) {
  return Array.isArray(box.flapProgress) ? box.flapProgress : (box.flaps || []);
}

function inferredLifecycle(box) {
  if (box.discarded || box.recycled) return BOX_LIFECYCLE.DISCARDED;
  if (box.flat || (box.flattenProgress || 0) > 0) return BOX_LIFECYCLE.FLATTENING;
  if ((box.qty || 0) <= 0) return BOX_LIFECYCLE.EMPTY;
  if (flapsOpen(box)) {
    return isPartial(box) ? BOX_LIFECYCLE.PARTIALLY_EMPTIED : BOX_LIFECYCLE.OPEN;
  }
  if ((box.openingProgress || 0) > 0 || flapValues(box).some((f) => f > 0)) {
    return BOX_LIFECYCLE.OPENING;
  }
  if ((box.cutProgress ?? box.tape ?? 0) >= 1) return BOX_LIFECYCLE.CUT_COMPLETE;
  if ((box.cutProgress ?? box.tape ?? 0) > 0) return BOX_LIFECYCLE.CUTTING;
  return BOX_LIFECYCLE.SEALED;
}

export function boxLifecycleState(box) {
  return box && BOX_LIFECYCLE_SET.has(box.lifecycle) ? box.lifecycle : inferredLifecycle(box || {});
}

function advanceLifecycle(box, target) {
  let current = boxLifecycleState(box);
  const targetIndex = BOX_LIFECYCLE_ORDER.indexOf(target);
  if (targetIndex < 0 || BOX_LIFECYCLE_ORDER.indexOf(current) > targetIndex) return false;
  while (current !== target) {
    const next = BOX_LIFECYCLE_ORDER[BOX_LIFECYCLE_ORDER.indexOf(current) + 1];
    if (!canTransitionBoxState(current, next)) return false;
    box.lifecycle = next;
    current = next;
  }
  return true;
}

function migrateBox(box) {
  const legacyOpened = !!(box.cut || box.opened);
  let cutProgress;
  if (Number.isFinite(box.cutProgress)) cutProgress = clamp01(box.cutProgress);
  else if (Number.isFinite(box.tape)) cutProgress = clamp01(box.tape);
  else cutProgress = legacyOpened ? 1 : 0;

  box.cutProgress = cutProgress;
  box.tape = cutProgress; // compatibility for already-shipped renderers and callers
  box.tapeSegments = tapeSegmentsAt(cutProgress);
  box.flapProgress = normalizeFlaps(
    Array.isArray(box.flapProgress) ? box.flapProgress : box.flaps,
    legacyOpened,
  );
  // `flaps` remains the shipped two-value compatibility mirror for the two
  // main panels; new visuals persist all four physical values above.
  box.flaps = [box.flapProgress[0], box.flapProgress[1]];
  box.openingProgress = clamp01(
    Number.isFinite(box.openingProgress)
      ? box.openingProgress
      : box.flapProgress.reduce((sum, flap) => sum + flap, 0) / box.flapProgress.length,
  );
  box.flattenProgress = clamp01(
    Number.isFinite(box.flattenProgress) ? box.flattenProgress : (box.flat ? 1 : 0),
  );
  box.flat = box.flattenProgress >= 1;
  const packaging = packagingMetadataForSavedBox(box);
  box.box = packaging.kind;
  box.familyId = packaging.familyId;
  box.layoutId = packaging.layoutId;
  box.shellId = packaging.shellId;
  box.modelId = packaging.modelId;
  box.packingState = packaging.packingState;
  box.packingOrientation = packaging.packingOrientation;
  box.contentScale = 1;
  box.fragile = packaging.fragile;
  box.longProduct = packaging.longProduct;
  if (box.cap === undefined) box.cap = box.qty;
  if (box.initialQty === undefined) box.initialQty = box.cap;
  if (box.lb === undefined) {
    const sku = skuById(box.skuId);
    if (sku) box.lb = boxWeight(sku, box.qty);
    else {
      const kind = BOX_KINDS[box.box] || BOX_KINDS.carton;
      box.lb = Math.round((kind.tare + 0.5 * Math.max(0, Number(box.qty) || 0)) * 10) / 10;
    }
  }
  box.lifecycle = inferredLifecycle(box);
  migrateEquipmentFields(box);
  if (box.loc === 'world') {
    if (!box.surfaceId) box.surfaceId = FLOOR_BOX_SURFACE_ID;
    if (box.ry === undefined) box.ry = 0;
  }
  box.schemaVersion = BOX_SCHEMA_VERSION;
  return box;
}

function clearEquipmentFields(box) {
  delete box.equipmentId;
  delete box.socketId;
  // Early development saves used these names before the persisted contract was
  // settled. Consume them once, then keep the save surface deliberately small.
  delete box.cartSocketId;
  delete box.equipmentSocketId;
  delete box.cartId;
  delete box.equipment;
}

function clearWorldFields(box) {
  delete box.surfaceId;
  delete box.x;
  delete box.z;
  delete box.ry;
}

function migrateEquipmentFields(box) {
  const legacyEquipmentLoc = box.loc === 'cart' || box.loc === 'stocking_cart';
  if (legacyEquipmentLoc) box.loc = 'equipment';
  if (box.loc !== 'equipment') {
    clearEquipmentFields(box);
    return;
  }

  const rawEquipmentId = box.equipmentId
    ?? box.equipment
    ?? box.cartId
    ?? (legacyEquipmentLoc ? STOCKING_CART_EQUIPMENT_ID : null);
  const rawSocketId = box.socketId ?? box.equipmentSocketId ?? box.cartSocketId;
  box.equipmentId = normalizeDeliveryEquipmentId(rawEquipmentId) || rawEquipmentId;
  box.socketId = rawSocketId;
  delete box.cartSocketId;
  delete box.equipmentSocketId;
  delete box.cartId;
  delete box.equipment;
  clearWorldFields(box);
  delete box.padPalletIndex;
  delete box.padStagingOverflow;
}

// Equipment references live on boxes, not in a parallel cart inventory. Heal
// malformed, incompatible, or duplicate references to the stockroom so no box
// (and therefore no quantity) can disappear from a legacy save.
function healEquipmentPlacements(boxes) {
  const occupied = [];
  for (const box of boxes) {
    migrateEquipmentFields(box);
    if (box.loc !== 'equipment') continue;
    const placement = deliveryEquipmentPlacementForBox(box);
    const fit = placement
      ? deliveryEquipmentFit(box, placement.equipmentId, placement.socketId)
      : { ok: false };
    const conflicts = placement && occupied.some((entry) => (
      entry.equipmentId === placement.equipmentId
      && deliveryEquipmentSocketsConflict(
        placement.equipmentId,
        entry.socketId,
        placement.socketId,
      )
    ));
    if (!fit.ok || conflicts) {
      box.loc = 'stock';
      clearEquipmentFields(box);
      clearWorldFields(box);
      delete box.padPalletIndex;
      delete box.padStagingOverflow;
      continue;
    }
    box.equipmentId = placement.equipmentId;
    box.socketId = placement.socketId;
    clearWorldFields(box);
    delete box.padPalletIndex;
    delete box.padStagingOverflow;
    occupied.push(placement);
  }
}

function stablePlacementNumber(value) {
  return Number.isFinite(value) ? value : String(value);
}

function worldPlacementHealingSignature(state, boxes) {
  const layout = state?.shop?.layout;
  const moved = Object.entries(layout?.moved || {})
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([id, pose]) => [
      id,
      stablePlacementNumber(pose?.x),
      stablePlacementNumber(pose?.z),
      stablePlacementNumber(pose?.ry),
    ]);
  const extra = (Array.isArray(layout?.extra) ? layout.extra : []).map((fixture) => [
    fixture?.id,
    fixture?.kind,
    stablePlacementNumber(fixture?.x),
    stablePlacementNumber(fixture?.z),
    stablePlacementNumber(fixture?.ry),
    !!fixture?.short,
  ]);
  const clutter = (Array.isArray(state?.shop?.reno?.clutter)
    ? state.shop.reno.clutter : []).map((pile) => [
    stablePlacementNumber(pile?.x),
    stablePlacementNumber(pile?.z),
    stablePlacementNumber(pile?.ry),
    !!pile?.cleared,
  ]);
  const decor = (Array.isArray(state?.shop?.reno?.decor)
    ? state.shop.reno.decor : []).map((entry) => [entry?.skuId, entry?.spot]);
  const placements = boxes.map((box) => [
    box?.id,
    box?.loc,
    box?.surfaceId,
    stablePlacementNumber(box?.x),
    stablePlacementNumber(box?.z),
    stablePlacementNumber(box?.ry),
    box?.box,
  ]);
  return JSON.stringify({
    placements,
    moved,
    stored: [...(Array.isArray(layout?.stored) ? layout.stored : [])].sort(),
    extra,
    poloShelf: [
      Number(state?.shop?.inventory?.polo1?.shelf) || 0,
      Number(state?.shop?.inventory?.polo2?.shelf) || 0,
    ],
    clutter,
    decor,
  });
}

function healWorldBoxToStock(box) {
  // Preserve the same authoritative object and every inventory/lifecycle/order
  // field. Only the illegal placement ownership is cleared.
  box.loc = 'stock';
  clearEquipmentFields(box);
  clearWorldFields(box);
  delete box.padPalletIndex;
  delete box.padStagingOverflow;
}

function healWorldSurfacePlacements(state, boxes) {
  const before = worldPlacementHealingSignature(state, boxes);
  if (WORLD_PLACEMENT_HEAL_CACHE.get(boxes) === before) return;

  // Validate against a progressively accepted world set. Save-array order is
  // the stable tie-break: the earliest legal capacity-one shelf occupant stays,
  // while a later duplicate heals visibly instead of evicting the first box.
  const nonWorld = boxes.filter((box) => box?.loc !== 'world');
  const acceptedWorld = [];
  const validationDeliveries = {
    ...(state?.shop?.deliveries || {}),
    boxes: [],
  };
  const validationState = {
    ...state,
    shop: {
      ...state.shop,
      deliveries: validationDeliveries,
    },
  };

  for (const box of boxes) {
    if (box?.loc !== 'world') continue;
    if (!box.surfaceId) box.surfaceId = FLOOR_BOX_SURFACE_ID;
    validationDeliveries.boxes = [...nonWorld, ...acceptedWorld, box];
    const support = surfaceById(validationState, box.surfaceId);
    const ordinarySurface = support && !['equipment-socket', 'pallet'].includes(support.kind);
    const placement = ordinarySurface
      ? previewBoxPlacement(validationState, box, {
        kind: 'surface',
        surfaceId: box.surfaceId,
        x: box.x,
        z: box.z,
        ry: box.ry,
      })
      : { ok: false };
    if (placement.ok && placement.target?.loc === 'world') {
      acceptedWorld.push(box);
    } else {
      healWorldBoxToStock(box);
    }
  }

  WORLD_PLACEMENT_HEAL_CACHE.set(
    boxes,
    worldPlacementHealingSignature(state, boxes),
  );
}

function boxNeedsMigration(box) {
  const packaging = box && packagingMetadataForSavedBox(box);
  return !box
    || box.schemaVersion !== BOX_SCHEMA_VERSION
    || !Number.isFinite(box.cutProgress)
    || !box.tapeSegments
    || !Array.isArray(box.flapProgress)
    || box.flapProgress.length !== 4
    || !Array.isArray(box.flaps)
    || box.flaps.length !== 2
    || !Number.isFinite(box.openingProgress)
    || !Number.isFinite(box.flattenProgress)
    || !BOX_LIFECYCLE_SET.has(box.lifecycle)
    || box.cap === undefined
    || box.initialQty === undefined
    || box.lb === undefined
    || box.box !== packaging.kind
    || box.familyId !== packaging.familyId
    || box.layoutId !== packaging.layoutId
    || box.shellId !== packaging.shellId
    || box.modelId !== packaging.modelId
    || box.packingState !== packaging.packingState
    || box.packingOrientation !== packaging.packingOrientation
    || box.contentScale !== 1
    || box.fragile !== packaging.fragile
    || box.longProduct !== packaging.longProduct
    || (box.loc === 'world' && typeof box.surfaceId !== 'string');
}

export function initDeliveries(state) {
  state.shop.deliveries = {
    schemaVersion: DELIVERIES_SCHEMA_VERSION,
    boxes: [], nextBoxId: 1, trash: 0, recycled: 0, shipments: [], arrivedOrderIds: [],
  };
}

export function ensureDeliveries(state) {
  if (!state.shop) return;
  if (!state.shop.deliveries) initDeliveries(state);
  const d = state.shop.deliveries;
  if (!Array.isArray(d.boxes)) d.boxes = [];
  if (!d.shipments) d.shipments = [];        // saves written before shipments existed
  if (!Array.isArray(d.arrivedOrderIds)) {
    d.arrivedOrderIds = [...new Set([
      ...d.boxes.map((box) => box.orderId),
      ...d.shipments.map((shipment) => shipment.orderId),
    ].filter((id) => id !== undefined && id !== null))];
  }
  if (typeof d.trash !== 'number') d.trash = 0;
  if (typeof d.recycled !== 'number') d.recycled = 0;
  if (state.shop.carry === undefined) state.shop.carry = null;

  // BOXES FROM BEFORE THE TAPE EXISTED (2026-07-14). An old save's box carries `cut: true` and
  // nothing else. Without this, tapeCut() reads `b.tape || 0` -> 0, and a box the player had
  // already opened would silently seal itself back up and demand to be cut again.
  const deliveryNeedsMigration = d.schemaVersion !== DELIVERIES_SCHEMA_VERSION;
  const migrationFlags = d.boxes.map(boxNeedsMigration);
  const needsMetadataBackfill = deliveryNeedsMigration || migrationFlags.some(Boolean);
  const shipmentByOrder = needsMetadataBackfill
    ? new Map(d.shipments.map((shipment) => [shipment.orderId, shipment]))
    : null;
  for (let index = 0; index < d.boxes.length; index++) {
    const b = d.boxes[index];
    if (migrationFlags[index]) migrateBox(b);
    if (!shipmentByOrder) continue;
    const shipment = shipmentByOrder.get(b.orderId);
    if (!b.supplier && shipment) b.supplier = shipment.supplier || null;
    if (!b.supplierId && shipment) b.supplierId = shipment.supplierId || null;
  }
  healEquipmentPlacements(d.boxes);
  healWorldSurfacePlacements(state, d.boxes);
  // v4 persists a balanced physical pallet lane. Rebuild legacy layouts once;
  // thereafter safe assignments survive selective pickup and save/load.
  assignDeliveryPallets(d.boxes, { rebalance: deliveryNeedsMigration });
  if (!Number.isFinite(d.nextBoxId)) {
    d.nextBoxId = d.boxes.reduce((greatest, b) => Math.max(greatest, Number(b.id) || 0), 0) + 1;
  }
  d.schemaVersion = DELIVERIES_SCHEMA_VERSION;
}

export function boxesOf(state) {
  ensureDeliveries(state);
  return state.shop.deliveries.boxes;
}

export function shipmentsOf(state) {
  ensureDeliveries(state);
  return state.shop.deliveries.shipments;
}

export function padCount(state) {
  return boxesOf(state).filter((b) => b.loc === 'pad').length;
}

// is there room on the pad for a shipment of n boxes?
export function padHasRoom(state, n) {
  return padCount(state) + n <= PAD_CAPACITY;
}

export function fallbackCount(state) {
  return boxesOf(state).filter((box) => box.loc === 'receiving-fallback').length;
}

export function fallbackHasRoom(state, n) {
  return fallbackCount(state) + n <= FALLBACK_CAPACITY;
}

export function receivingFree(state) {
  return Math.max(0, PAD_CAPACITY - padCount(state))
    + Math.max(0, FALLBACK_CAPACITY - fallbackCount(state));
}

export function receivingHasRoom(state, n) {
  return receivingFree(state) >= n;
}

function occupiedReceivingSlots(boxes, location, capacity) {
  const used = new Set();
  const needSlot = [];
  for (const box of boxes.filter((candidate) => candidate.loc === location)) {
    const slot = box.receivingSlot;
    if (Number.isSafeInteger(slot) && slot >= 0 && slot < capacity && !used.has(slot)) {
      used.add(slot);
    } else {
      needSlot.push(box);
    }
  }
  // Saves from before receiving slots existed still occupy real floor space.
  // Give those cartons stable identities before calculating space for a new van.
  for (const box of needSlot) {
    const slot = Array.from({ length: capacity }, (_, index) => index)
      .find((index) => !used.has(index));
    if (slot === undefined) break;
    box.receivingSlot = slot;
    used.add(slot);
  }
  return used;
}

// --- WHAT STATE IS THIS BOX IN --------------------------------------------------------------
//
// The brief lists fourteen box states. They are not fourteen flags — they are three independent
// axes, and writing them as fourteen booleans is how you end up with a box that is both `empty`
// and `full` because two code paths disagreed. So: WHERE it is (loc), HOW SEALED it is (tape,
// flaps), and WHAT IS LEFT IN IT (qty against cap). Everything below is derived from those.
export const tapeUncut = (b) => (b.cutProgress ?? b.tape ?? 0) <= 0;
export const tapePartlyCut = (b) => (b.cutProgress ?? b.tape ?? 0) > 0 && (b.cutProgress ?? b.tape ?? 0) < 1;
export const tapeCut = (b) => (b.cutProgress ?? b.tape ?? 0) >= 1;
export const flapsClosed = (b) => !flapValues(b).length || flapValues(b).every((flap) => flap <= 0);
export const flapsOpen = (b) => flapValues(b).length >= 2 && flapValues(b).every((flap) => flap >= 1);
export const isEmpty = (b) => (b.qty || 0) <= 0;
export const isFull = (b) => (b.qty || 0) >= (b.cap || b.qty || 0);
export const isPartial = (b) => !isEmpty(b) && !isFull(b);
// "opened" in the everyday sense the screens use: someone has been at it
export const boxOpened = (b) => (b.tape || 0) > 0 || !!b.cut;

// one word for the whole box, for a label or a test
export function boxState(b) {
  if (boxLifecycleState(b) === BOX_LIFECYCLE.DISCARDED || b.recycled) return 'recycled';
  if (b.flat) return 'flattened';
  if (b.loc === 'carried') return 'carried';
  if (isEmpty(b)) return 'empty';
  if (flapsOpen(b)) return isPartial(b) ? 'partial contents' : 'full contents';
  if (tapeCut(b)) return flapsClosed(b) ? 'flaps closed' : 'flaps open';
  if (tapePartlyCut(b)) return 'tape partially cut';
  return b.loc === 'pad' ? 'delivered' : 'placed';
}

// WHAT A LANDED SHIPMENT IS DOING. Derived from its boxes, never stored — a stored status is a
// status that drifts the first time someone empties a box by another route.
export function shipmentStatus(state, sh) {
  const boxes = boxesOf(state).filter((b) => b.orderId === sh.orderId);
  const left = boxes.reduce((a, b) => a + (b.qty || 0), 0);
  if (left <= 0) return 'unpacked';                       // fully unpacked
  const opened = boxes.some((b) => (b.tape || 0) > 0 || b.cut);
  const receivedUnits = Number.isSafeInteger(sh.receivedUnits) ? sh.receivedUnits : sh.units;
  return (left < receivedUnits || opened) ? 'partial' : 'delivered';  // partially unpacked
}

// a shipment is done with when every box it brought has been recycled
export function retireShipments(state) {
  const d = state.shop.deliveries;
  if (!d.shipments) return;
  const live = new Set(d.boxes.map((b) => b.orderId));
  for (const order of state.shop.orders || []) live.add(order.id);
  d.shipments = d.shipments.filter((s) => live.has(s.orderId));
}

// an order landed: stand its manifest on the receiving pad, box for box.
//
// The manifest was packed once, at order time (data/boxes.js planShipment), and the laptop has
// already promised it to you. So this does NOT re-pack — it reads. Re-packing here is how the
// screen and the pad end up one box apart with nobody able to say which is right.
const positiveSafeInteger = (value) => Number.isSafeInteger(value) && value > 0;

function arrivedBoxesForReplay(state, orderId) {
  if (orderId === undefined || orderId === null) return null;
  const deliveries = state?.shop?.deliveries;
  if (!deliveries) return null;
  const boxes = Array.isArray(deliveries.boxes) ? deliveries.boxes : [];
  const shipments = Array.isArray(deliveries.shipments) ? deliveries.shipments : [];
  const knownArrival = (
    Array.isArray(deliveries.arrivedOrderIds)
      && deliveries.arrivedOrderIds.includes(orderId)
  ) || shipments.some((shipment) => shipment?.orderId === orderId);
  if (!knownArrival) return null;

  // Preserve the old duplicate-arrival contract for legacy saves: the replay
  // still performs their normal delivery/box migrations, but never mints a
  // second carton or consumes another ID.
  ensureDeliveries(state);
  return state.shop.deliveries.boxes.filter((box) => box.orderId === orderId);
}

function manifestDimensionsAreValid(box, kind) {
  const axes = ['w', 'h', 'd'];
  const supplied = axes.map((axis) => box[axis] !== undefined);
  // Compact pre-dimension manifests are still safe: physical dimensions have
  // always resolved from the registered kind, not from fields copied to boxes.
  if (supplied.every((present) => !present)) return true;
  if (!supplied.every(Boolean)) return false;
  return axes.every((axis) => (
    Number.isFinite(box[axis])
    && box[axis] > 0
    && box[axis] === kind[axis]
  ));
}

const PACKAGING_MANIFEST_FIELDS = Object.freeze([
  'familyId',
  'layoutId',
  'shellId',
  'modelId',
  'packingState',
  'packingOrientation',
  'contentScale',
]);

function hasAnyPackagingManifestField(box) {
  if (!box || typeof box !== 'object' || Array.isArray(box)) return false;
  return PACKAGING_MANIFEST_FIELDS.some((field) => (
    Object.prototype.hasOwnProperty.call(box, field)
  ));
}

function strictManifestBoxMatches(box, expected) {
  if (box.kind !== expected.kind || box.qty !== expected.qty) return false;
  if (!Number.isFinite(box.lb) || box.lb !== expected.lb) return false;
  if (box.fragile !== expected.fragile || box.longProduct !== expected.longProduct) return false;
  return PACKAGING_MANIFEST_FIELDS.every((field) => (
    Object.prototype.hasOwnProperty.call(box, field)
    && box[field] === expected[field]
  ));
}

function normalizedLegacyManifest(manifest, planned, sku) {
  // Pre-contract orders stored only kind/qty/dimensions. Re-plan their physical
  // shell identity at the migration boundary while retaining its promised box
  // split and every paid unit. The saved promise object itself is never mutated.
  const authored = planned.boxes[0];
  const boxes = manifest.boxes.map((legacy) => ({
    ...authored,
    qty: legacy.qty,
    lb: boxWeight(sku, legacy.qty),
  }));
  return {
    ...planned,
    boxes,
    boxCount: boxes.length,
    weight: Math.round(boxes.reduce((sum, box) => sum + box.lb, 0) * 10) / 10,
    supplierId: manifest.supplierId || planned.supplierId,
    supplier: manifest.supplier || planned.supplier,
    fee: Number.isFinite(manifest.fee) ? manifest.fee : planned.fee,
  };
}

function validatedArrival(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
  if (!positiveSafeInteger(order.qty)) return null;
  const sku = skuById(order.skuId);
  if (!sku) return null;

  const planned = planShipment(sku, order.qty);
  // A missing manifest is the supported pre-manifest save path. Keep its
  // deterministic planner fallback, after the strict boundary check above.
  const manifest = order.manifest == null ? planned : order.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  if (!Array.isArray(manifest.boxes) || manifest.boxes.length === 0) return null;
  if (manifest.boxCount !== undefined && (
    !positiveSafeInteger(manifest.boxCount)
    || manifest.boxCount !== manifest.boxes.length
  )) return null;

  const hasPackagingMetadata = manifest.boxes.some(hasAnyPackagingManifestField);
  const strictContractManifest = hasPackagingMetadata
    || manifest.packagingSchemaVersion !== undefined;
  if (strictContractManifest
    && manifest.packagingSchemaVersion !== SHIPMENT_PACKAGING_SCHEMA_VERSION) return null;
  let units = 0;
  for (let index = 0; index < manifest.boxes.length; index++) {
    const box = manifest.boxes[index];
    if (!box || typeof box !== 'object' || Array.isArray(box)) return null;
    if (!positiveSafeInteger(box.qty)) return null;
    const kind = typeof box.kind === 'string'
      && Object.prototype.hasOwnProperty.call(BOX_KINDS, box.kind)
      ? BOX_KINDS[box.kind]
      : null;
    if (!kind || !manifestDimensionsAreValid(box, kind)) return null;
    if (strictContractManifest) {
      const expected = planned.boxes[index];
      if (!expected || !strictManifestBoxMatches(box, expected)) return null;
    }
    units += box.qty;
    if (!Number.isSafeInteger(units) || units > order.qty) return null;
  }
  if (units !== order.qty) return null;

  if (!strictContractManifest) {
    return { sku, manifest: normalizedLegacyManifest(manifest, planned, sku) };
  }
  if (manifest.boxes.length !== planned.boxes.length) return null;
  if (manifest.weight !== undefined && manifest.weight !== planned.weight) return null;
  return {
    sku,
    manifest: {
      ...manifest,
      boxCount: manifest.boxes.length,
      weight: manifest.weight ?? planned.weight,
    },
  };
}

export function arriveOrder(state, order, { maxBoxes = Infinity } = {}) {
  // Replays short-circuit before inspecting payload details, matching the
  // shipped idempotency behavior even if a retry carries stale/corrupt fields.
  const replay = arrivedBoxesForReplay(state, order?.id);
  if (replay) return replay;

  // Rejection is deliberately a read-only empty result. In particular, it
  // happens before ensureDeliveries(), notification allocation, pallet
  // assignment, shipment writes, or nextBoxId consumption.
  const validated = validatedArrival(order);
  if (!validated) return [];

  ensureDeliveries(state);
  const d = state.shop.deliveries;
  if (order.id !== undefined && order.id !== null && d.arrivedOrderIds.includes(order.id)) {
    return d.boxes.filter((box) => box.orderId === order.id);
  }
  const { sku, manifest } = validated;
  const arrivalOrder = ensureArrivalOrder(state, order);
  if (!arrivalOrder) return [];
  if (!Array.isArray(arrivalOrder.receivedManifestBoxIndexes)) {
    arrivalOrder.receivedManifestBoxIndexes = [];
  }
  const receivedIndexes = new Set(arrivalOrder.receivedManifestBoxIndexes);
  const boxLimit = Number.isSafeInteger(maxBoxes) && maxBoxes >= 0
    ? maxBoxes
    : manifest.boxes.length;
  const landing = manifest.boxes
    .map((box, index) => ({ box, index }))
    .filter(({ index }) => !receivedIndexes.has(index))
    .slice(0, boxLimit);
  const usedPadSlots = occupiedReceivingSlots(d.boxes, 'pad', PAD_CAPACITY);
  const usedFallbackSlots = occupiedReceivingSlots(
    d.boxes,
    'receiving-fallback',
    FALLBACK_CAPACITY,
  );
  const freeSlots = (capacity, used) => Array.from(
    { length: capacity },
    (_, index) => index,
  ).filter((index) => !used.has(index));
  const padSlots = freeSlots(PAD_CAPACITY, usedPadSlots);
  const fallbackSlots = freeSlots(FALLBACK_CAPACITY, usedFallbackSlots);
  const made = [];
  for (const { box: manifestBox, index: manifestIndex } of landing) {
    if (!padSlots.length && !fallbackSlots.length) break;
    const id = d.nextBoxId++;
    const skuId = manifestBox.skuId || order.skuId;
    const lineId = manifestBox.lineId
      || (order.lines && order.lines.find((line) => line.skuId === skuId)?.id)
      || `${order.id}-line-1`;
    const loc = padSlots.length > 0 ? 'pad' : 'receiving-fallback';
    const receivingSlot = loc === 'pad' ? padSlots.shift() : fallbackSlots.shift();
    const received = receiveBoxInventory(state, arrivalOrder.id, id, [{
      lineId,
      skuId,
      quantity: manifestBox.qty,
    }]);
    if (!received.ok) return [];
    made.push({
      id,
      persistentId: `box-${id}`,
      skuId,
      orderId: arrivalOrder.id,
      parentOrderId: arrivalOrder.id,
      qty: manifestBox.qty,
      initialQty: manifestBox.qty,
      initialQuantity: manifestBox.qty,
      remainingQuantity: manifestBox.qty,
      cap: manifestBox.qty,   // what it shipped with — 'partial contents' means qty < cap
      lb: manifestBox.lb,
      box: manifestBox.kind,
      fragile: !!manifestBox.fragile,
      longProduct: !!manifestBox.longProduct,
      familyId: manifestBox.familyId,
      layoutId: manifestBox.layoutId,
      shellId: manifestBox.shellId,
      modelId: manifestBox.modelId,
      packingState: manifestBox.packingState,
      packingOrientation: manifestBox.packingOrientation,
      contentScale: manifestBox.contentScale,
      supplierId: manifest.supplierId || arrivalOrder.supplierId || null,
      supplier: manifest.supplier || arrivalOrder.supplier || null,
      loc,
      currentLocation: loc,
      receivingSlot,
      currentCarrier: null,
      contents: received.contents,
      tape: 0,                // compatibility mirror of cutProgress
      cutProgress: 0,
      tapeSegments: tapeSegmentsAt(0),
      flaps: [0, 0],           // compatibility: the two opposing-pair inputs
      flapProgress: [0, 0, 0, 0], // four physical panels, each 0 closed .. 1 open
      openingProgress: 0,
      flattenProgress: 0,
      openedState: 'unopened',
      inventoryOpened: false,
      damageState: 'intact',
      disposalState: 'active',
      manifestIndex,
      flat: false,
      lifecycle: BOX_LIFECYCLE.SEALED,
      schemaVersion: BOX_SCHEMA_VERSION,
    });
    arrivalOrder.receivedManifestBoxIndexes.push(manifestIndex);
  }
  assignDeliveryPallets([
    ...d.boxes.filter((box) => box.loc === 'pad'),
    ...made,
  ]);
  d.boxes.push(...made);
  const complete = arrivalOrder.receivedManifestBoxIndexes.length >= manifest.boxes.length;
  if (complete && arrivalOrder.id !== undefined && arrivalOrder.id !== null) {
    d.arrivedOrderIds.push(arrivalOrder.id);
  }
  let shipment = d.shipments.find((candidate) => candidate.orderId === arrivalOrder.id);
  if (!shipment) {
    shipment = {
      orderId: arrivalOrder.id,
      skuId: arrivalOrder.skuId || null,
      lines: (arrivalOrder.lines || []).map((line) => ({ skuId: line.skuId, quantity: line.quantity })),
      supplierId: manifest.supplierId || arrivalOrder.supplierId || null,
      supplier: manifest.supplier || arrivalOrder.supplier || null,
      units: arrivalOrder.quantity || arrivalOrder.qty,
      receivedUnits: 0,
      boxCount: manifest.boxCount,
      receivedBoxCount: 0,
      weight: manifest.weight,
      boxIds: [],
      usedFallback: false,
      landedMin: (state.clock && state.clock.minutes) || 0,
    };
    d.shipments.push(shipment);
  }
  shipment.boxIds.push(...made.map((box) => box.id));
  shipment.receivedBoxCount += made.length;
  shipment.receivedUnits += made.reduce((sum, box) => sum + box.initialQuantity, 0);
  shipment.usedFallback ||= made.some((box) => box.loc === 'receiving-fallback');
  shipment.lastLandedMin = (state.clock && state.clock.minutes) || 0;
  refreshOrderFromLedger(state, arrivalOrder.id);
  notify(state, {
    kind: 'delivery',
    text: `Delivery arriving: ${sku.name} × ${arrivalOrder.qty} — the van checked in with ${manifest.boxCount} box${manifest.boxCount === 1 ? '' : 'es'} for receiving.`,
    dedupeKey: `arrived:${arrivalOrder.id}`,
  });
  return made;
}

// ================================================================================================
// THE BOX, AS A PHYSICAL OBJECT
// ================================================================================================
//
// "No part of this loop should be replaced by one E press."
//
// It was. One press set `cut = true` and the box was open. One press emptied it and TELEPORTED the
// contents into `inventory.back`. There was no tape to cut through, no flap to lift, nothing inside
// to see, and — the real hole — nothing was ever CARRIED between the carton and the shelf.
//
// Now: cut the tape (a cut, not a switch), open one flap, open the other, and take an armful out
// INTO YOUR HANDS (sim/stocking.js). Then walk it somewhere.

export function findBox(state, id) {
  return boxesOf(state).find((b) => b.id === id) || null;
}

export function carriedBox(state) {
  return boxesOf(state).find((b) => b.loc === 'carried') || null;
}

// The cart is a stockroom workstation. Render/input code can combine this with
// its existing world-coordinate stockroom check for freely placed floor boxes.
export function boxAtStockroomLocation(box) {
  return box?.loc === 'stock' || box?.loc === 'equipment';
}

function deliveryEquipmentPlacementBlocker(boxes, boxId, equipmentId, socketId) {
  return boxes.find((entry) => (
    entry.id !== boxId
    && entry.loc === 'equipment'
    && normalizeDeliveryEquipmentId(entry.equipmentId) === equipmentId
    && deliveryEquipmentSocketsConflict(equipmentId, entry.socketId, socketId)
  )) || null;
}

// Pure placement query for input/render code. Persisted box locations are the
// occupancy authority; this does not migrate, heal, reserve, or move anything.
// Pass the successful `target` straight to putDownBox for the authoritative
// validation-and-write step.
export function deliveryEquipmentPlacementForCarriedBox(
  state,
  id,
  requestedEquipmentId = STOCKING_CART_EQUIPMENT_ID,
) {
  const boxes = state?.shop?.deliveries?.boxes;
  if (!Array.isArray(boxes)) {
    return { ok: false, code: 'no-deliveries', reason: 'Delivery state is not available.' };
  }
  const box = boxes.find((entry) => entry.id === id);
  if (!box || box.loc !== 'carried') {
    return { ok: false, code: 'not-carried', reason: 'Not carrying that box.' };
  }

  const equipmentId = normalizeDeliveryEquipmentId(requestedEquipmentId);
  if (!equipmentId) {
    return { ok: false, code: 'unknown-equipment', reason: 'That delivery equipment is not available.' };
  }
  const equipmentName = equipmentId === HAND_TRUCK_EQUIPMENT_ID
    ? 'hand truck' : 'stocking cart';
  const socketIds = preferredDeliveryEquipmentSocketIds(box, equipmentId);
  if (!socketIds.length) {
    return {
      ok: false,
      code: 'no-compatible-socket',
      reason: `That carton does not fit on the ${equipmentName}.`,
    };
  }
  for (const socketId of socketIds) {
    const blocker = deliveryEquipmentPlacementBlocker(
      boxes,
      box.id,
      equipmentId,
      socketId,
    );
    if (blocker) continue;
    const target = {
      loc: 'equipment',
      equipmentId,
      socketId,
    };
    return {
      ok: true,
      equipmentId,
      socketId,
      target,
    };
  }
  return {
    ok: false,
    code: 'no-free-socket',
    reason: `Every compatible ${equipmentName} position is occupied.`,
  };
}

export function stockingCartPlacementForCarriedBox(state, id) {
  return deliveryEquipmentPlacementForCarriedBox(state, id, STOCKING_CART_EQUIPMENT_ID);
}

export function handTruckPlacementForCarriedBox(state, id) {
  return deliveryEquipmentPlacementForCarriedBox(state, id, HAND_TRUCK_EQUIPMENT_ID);
}

export function pickUpBox(state, id) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'pad') {
    const padBoxes = boxesOf(state).filter((entry) => entry.loc === 'pad');
    if (!exposedDeliveryPadBoxIds(padBoxes).has(box.id)) {
      return { ok: false, reason: 'Move the carton stacked above it first.' };
    }
  }
  if (carriedBox(state)) return { ok: false, reason: 'Your arms are full — set that one down first.' };
  // arms are arms: a box OR an armful of goods, never both
  const goods = state.shop.carry;
  if (goods) {
    const sku = skuById(goods.skuId);
    return { ok: false, reason: `Not with your arms full of ${(sku ? sku.name : 'stock').toLowerCase()}.` };
  }
  box.loc = 'carried';
  delete box.padPalletIndex;
  delete box.padStagingOverflow;
  clearEquipmentFields(box);
  clearWorldFields(box);
  return { ok: true, box };
}

// spot: {x, z, ry} places the box exactly there in the world (building-local
// coords) — the normal path; the legacy zone strings keep old callers working
export function putDownBox(state, id, spot = 'stock') {
  const box = findBox(state, id);
  if (!box || box.loc !== 'carried') return { ok: false, reason: 'Not carrying that.' };
  if (spot && typeof spot === 'object') {
    const requested = (
      spot.loc || spot.kind || spot.type || spot.surfaceId
      || spot.equipmentId !== undefined || spot.socketId !== undefined
    ) ? spot : {
      loc: 'world',
      surfaceId: FLOOR_BOX_SURFACE_ID,
      x: spot.x,
      z: spot.z,
      ry: spot.ry || 0,
    };
    // Preview and commit share this exact validator. Re-running it here closes
    // the race where another box or a moved fixture invalidates a green ghost
    // between frames; rejection leaves the carried carton wholly unchanged.
    const placement = previewBoxPlacement(state, box, requested);
    if (!placement.ok) return placement;
    const target = placement.target;
    if (target.loc === 'equipment') {
      box.loc = 'equipment';
      box.equipmentId = target.equipmentId;
      box.socketId = target.socketId;
      clearWorldFields(box);
      delete box.padPalletIndex;
      delete box.padStagingOverflow;
    } else if (target.loc === 'pad') {
      box.loc = 'pad';
      clearEquipmentFields(box);
      clearWorldFields(box);
      box.padPalletIndex = target.padPalletIndex;
      delete box.padStagingOverflow;
      assignDeliveryPallets(state.shop.deliveries.boxes);
    } else if (target.loc === 'world') {
      box.loc = 'world';
      clearEquipmentFields(box);
      delete box.padPalletIndex;
      delete box.padStagingOverflow;
      box.surfaceId = target.surfaceId;
      box.x = target.x;
      box.z = target.z;
      box.ry = target.ry;
    } else {
      return { ok: false, code: 'invalid-target', reason: 'That placement target cannot hold a delivery box.' };
    }
    return { ok: true, box, placement };
  } else {
    if (spot === 'pad' && padCount(state) >= PAD_CAPACITY) {
      return { ok: false, reason: 'The receiving pad is full.' };
    }
    box.loc = spot === 'pad' ? 'pad' : 'stock';
    clearEquipmentFields(box);
    delete box.padPalletIndex;
    delete box.padStagingOverflow;
    clearWorldFields(box);
    if (box.loc === 'pad') assignDeliveryPallets(state.shop.deliveries.boxes);
  }
  box.currentCarrier = null;
  return { ok: true, box };
}

// --- the tape ------------------------------------------------------------------------------------
//
// A cut, not a switch. `amount` is how far the blade travels this call — the scene passes dt times
// a rate, so holding the button runs the knife down the seam, and letting go leaves it HALF CUT,
// which is a state the box keeps and the save remembers.
//
// The centre seam goes first, then the two side tapes: that is the order a person does it in, and
// it gives the sound and the animation something true to follow.
export const CENTRE_SEAM = 0.6;

export function cutTape(state, id, amount = 1) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first — you need both hands.' };
  if (box.flat) return { ok: false, reason: 'It is already flattened.' };
  if (tapeCut(box)) return { ok: false, reason: 'The tape is already cut.', done: true };
  const before = box.cutProgress ?? box.tape ?? 0;
  const step = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  box.cutProgress = Math.min(1, before + step);
  box.tape = box.cutProgress;
  box.tapeSegments = tapeSegmentsAt(box.cutProgress);
  if (box.cutProgress > 0) advanceLifecycle(box, BOX_LIFECYCLE.CUTTING);
  if (box.cutProgress >= 1) advanceLifecycle(box, BOX_LIFECYCLE.CUT_COMPLETE);
  return {
    ok: true,
    tape: box.tape,
    cutProgress: box.cutProgress,
    tapeSegments: { ...box.tapeSegments },
    seam: before < CENTRE_SEAM ? 'centre' : 'side',
    done: box.cutProgress >= 1,
  };
}

// --- the flaps -----------------------------------------------------------------------------------
// Medium-carton sequence: front main flap, back main flap, then both side
// flaps. Incremental amounts let the scene author a smooth deterministic arc.
export function openFlap(state, id, amount = 1) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  if (!tapeCut(box)) return { ok: false, reason: 'Cut the tape first.' };
  box.flapProgress = normalizeFlaps(
    Array.isArray(box.flapProgress) ? box.flapProgress : box.flaps,
  );
  const phases = [[0], [1], [2, 3]];
  const i = phases.findIndex((phase) => phase.some((flap) => box.flapProgress[flap] < 1));
  if (i < 0) return { ok: false, reason: 'All four flaps are open.', done: true };
  const step = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  if (step <= 0) return { ok: false, reason: 'Keep opening the flap.' };
  for (const flap of phases[i]) {
    box.flapProgress[flap] = Math.min(1, box.flapProgress[flap] + step);
  }
  box.flaps = [box.flapProgress[0], box.flapProgress[1]];
  box.openingProgress = box.flapProgress.reduce((sum, flap) => sum + flap, 0)
    / box.flapProgress.length;
  advanceLifecycle(box, BOX_LIFECYCLE.OPENING);
  const done = flapsOpen(box);
  if (done) {
    const opened = openBoxInventory(state, box);
    if (!opened.ok && !opened.done) return opened;
    advanceLifecycle(box, isPartial(box) ? BOX_LIFECYCLE.PARTIALLY_EMPTIED : BOX_LIFECYCLE.OPEN);
  }
  return {
    ok: true,
    flap: i,
    physicalFlaps: [...phases[i]],
    progress: box.openingProgress,
    done,
  };
}

// --- reaching in ----------------------------------------------------------------------------------
//
// The contents come out INTO YOUR HANDS. They do not appear in the backroom: the backroom is a
// place you have to walk to, and walking there is step 11 of the brief.
export function takeFromBox(state, id, want) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  if (!tapeCut(box)) return { ok: false, reason: 'Cut the tape first.' };
  if (!flapsOpen(box)) return { ok: false, reason: 'Open the flaps first.' };
  if (box.qty <= 0) return { ok: false, reason: 'It is empty.' };
  if (carriedBox(state)) return { ok: false, reason: 'Set the box you are carrying down first.' };
  if (!box.inventoryOpened) {
    const opened = openBoxInventory(state, box);
    if (!opened.ok && !opened.done) return opened;
  }

  // Starter assortments deliberately share one physical carton. Continue the
  // line already in the player's hands when possible; otherwise expose the
  // first conserved line that still has units in this box. Legacy/single-SKU
  // cartons retain their original path through the fallback.
  const carriedSkuId = state.shop.carry?.skuId;
  const remainingContents = Array.isArray(box.contents)
    ? box.contents.filter((entry) => (entry.remainingQuantity || 0) > 0)
    : [];
  const activeSkuId = (
    remainingContents.find((entry) => entry.skuId === carriedSkuId)?.skuId
    || remainingContents[0]?.skuId
    || box.skuId
  );
  const activeAvailable = remainingContents.length
    ? remainingContents
      .filter((entry) => entry.skuId === activeSkuId)
      .reduce((sum, entry) => sum + (entry.remainingQuantity || 0), 0)
    : box.qty;
  const room = armRoom(state, activeSkuId);
  if (room <= 0) {
    const c = state.shop.carry;
    const holding = c && c.skuId !== activeSkuId ? skuById(c.skuId) : null;
    return {
      ok: false,
      reason: holding
        ? `You are already carrying ${holding.name.toLowerCase()} — put those down first.`
        : 'Your arms are full — go and put those down.',
    };
  }

  const requested = want == null
    ? room
    : Math.max(0, Math.floor(Number.isFinite(want) ? want : 0));
  const taken = Math.min(requested, room, box.qty, activeAvailable);
  if (taken <= 0) return { ok: false, reason: 'Choose at least one item to take.' };
  const c = state.shop.carry;
  const before = box.qty;
  const moved = takeBoxInventory(
    state,
    box,
    activeSkuId,
    taken,
    `take-box:${box.id}:${box.cap - before}:${taken}`,
  );
  if (!moved.ok) return moved;
  const allocations = [...((c && c.allocations) || []), ...moved.allocations];
  setCarry(state, activeSkuId, (c ? c.qty : 0) + taken, allocations);
  if (box.qty <= 0) {
    advanceLifecycle(box, BOX_LIFECYCLE.EMPTY);
    const d = state.shop.deliveries;
    d.openedTotal = (d.openedTotal || 0) + 1;   // lifetime unboxings (onboarding reads this)
  } else {
    advanceLifecycle(box, BOX_LIFECYCLE.PARTIALLY_EMPTIED);
  }
  return {
    ok: true,
    skuId: activeSkuId,
    taken,
    left: box.qty,
    carrying: state.shop.carry.qty,
  };
}

// --- the cardboard ----------------------------------------------------------------------------
// An empty carton is not gone. You break it down, you carry it to the bin, and THEN it is gone.

export function flattenBox(state, id, amount = 1) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  if (box.flat) return { ok: false, reason: 'Already flat.', done: true };
  if (!isEmpty(box)) return { ok: false, reason: 'Still has stock in it.' };
  const step = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  if (step <= 0) return { ok: false, reason: 'Keep folding the carton.' };
  advanceLifecycle(box, BOX_LIFECYCLE.FLATTENING);
  const before = box.flattenProgress || 0;
  box.flattenProgress = Math.min(1, before + step);
  box.flat = box.flattenProgress >= 1;
  box.flaps = [1, 1];
  box.flapProgress = [1, 1, 1, 1];
  if (box.flat && before < 1) {
    const d = state.shop.deliveries;
    d.trash = (d.trash || 0) + 1;
  }
  return { ok: true, progress: box.flattenProgress, done: box.flat };
}

export function recycleBox(state, id) {
  const d = state.shop.deliveries;
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (!box.flat) return { ok: false, reason: 'Break it down flat first.' };
  advanceLifecycle(box, BOX_LIFECYCLE.DISCARDED);
  box.discarded = true;
  d.boxes.splice(d.boxes.indexOf(box), 1);
  d.recycled = (d.recycled || 0) + 1;
  d.trash = Math.max(0, (d.trash || 0) - 1);
  forgetInventoryOperationsForBox(state, box.id);
  retireShipments(state);
  return { ok: true, box, state: BOX_LIFECYCLE.DISCARDED };
}

// The recycling-bin animation ends while the carton is still parented to the
// first-person carry rig. This is an explicit sink, not an unvalidated world
// drop: placement validation therefore remains authoritative everywhere a box
// is actually set down, while the bin can atomically consume carried cardboard.
export function recycleCarriedBox(state, id) {
  const box = findBox(state, id);
  if (!box || box.loc !== 'carried') {
    return { ok: false, reason: 'Carry the flattened carton to the recycling bin first.' };
  }
  if (!box.flat) return { ok: false, reason: 'Break it down flat first.' };
  return recycleBox(state, id);
}

// --- the employee path -------------------------------------------------------------------------
//
// The brief allows "faster equipment or employee stocking later", and this is the relief valve that
// makes the physical loop a choice rather than a chore: hire a floor hand and the morning's
// cardboard is dealt with before you get in. A person opens a box; they do not need it explained.
export function openBox(state, id) {
  const d = state.shop.deliveries;
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  const qty = box.qty;

  // Staff use the same inventory authority as the player's physical unpacking
  // loop. Open the shipping lot, then move its exact contents into reserve
  // before changing the fast back-stock projection or discarding the carton.
  // A failed ledger move leaves the box intact and retryable.
  if (!box.inventoryOpened) {
    const opened = openBoxInventory(state, box);
    if (!opened.ok && !opened.done) return opened;
  }
  const lines = Array.isArray(box.contents) && box.contents.length
    ? [...new Set(box.contents.map((entry) => entry.skuId))].map((skuId) => ({
      skuId,
      quantity: box.contents
        .filter((entry) => entry.skuId === skuId)
        .reduce((sum, entry) => sum + (entry.remainingQuantity || 0), 0),
    })).filter((line) => line.quantity > 0)
    : [{ skuId: box.skuId, quantity: qty }];
  for (const line of lines) {
    const inv = state.shop.inventory[line.skuId];
    if (!inv) return { ok: false, reason: 'That stock line is not in the catalog.' };
    const unpacked = takeBoxInventory(
      state,
      box,
      line.skuId,
      line.quantity,
      `employee-unpack-box:${box.id}:${line.skuId}`,
    );
    if (!unpacked.ok) return unpacked;
    inv.back += line.quantity;
    if (placeableSpecBySkuId(line.skuId)) {
      const stored = storeDeliveredPlaceables(state, line.skuId, line.quantity);
      if (!stored.ok) importLegacyStoredPlaceables(state, line.skuId, inv.back);
    }
  }
  box.cutProgress = 1;
  box.tape = 1;
  box.tapeSegments = tapeSegmentsAt(1);
  box.flaps = [1, 1];
  box.flapProgress = [1, 1, 1, 1];
  box.openingProgress = 1;
  advanceLifecycle(box, BOX_LIFECYCLE.OPEN);
  box.qty = 0;
  advanceLifecycle(box, BOX_LIFECYCLE.EMPTY);
  box.flattenProgress = 1;
  box.flat = true;
  advanceLifecycle(box, BOX_LIFECYCLE.FLATTENING);
  advanceLifecycle(box, BOX_LIFECYCLE.DISCARDED);
  box.discarded = true;
  d.boxes.splice(d.boxes.indexOf(box), 1);
  box.recycled = true;
  box.disposalState = 'recycled';
  // they break it down and stack it by the bin — the cardboard does not evaporate just because
  // somebody else handled it. `trash` is what is waiting to go out; `recycled` is what has gone.
  d.trash = (d.trash || 0) + 1;
  d.openedTotal = (d.openedTotal || 0) + 1;
  box.disposalState = 'flattened';
  forgetInventoryOperationsForBox(state, box.id);
  retireShipments(state);
  return { ok: true, skuId: box.skuId, qty };
}

// open everything sitting around — the morning crew's first job
export function openAllBoxes(state) {
  const d = state.shop.deliveries;
  if (!d) return 0;
  let opened = 0;
  for (const b of [...d.boxes]) {
    if (b.loc !== 'carried' && openBox(state, b.id).ok) opened++;
  }
  return opened;
}

// the bin by the stock door: every flattened carton in the building goes out
export function emptyTrash(state) {
  ensureDeliveries(state);
  const d = state.shop.deliveries;
  const flat = d.boxes.filter((b) => b.flat && b.loc !== 'carried');
  if (!flat.length && (d.trash || 0) <= 0) return { ok: false };
  for (const b of flat) recycleBox(state, b.id);
  d.recycled = (d.recycled || 0) + Math.max(0, (d.trash || 0));  // the stack the staff left, too
  d.trash = 0;
  return { ok: true, recycled: flat.length };
}
