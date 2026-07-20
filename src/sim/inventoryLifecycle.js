// PHYSICAL INVENTORY LIFECYCLE
//
// This module is the accounting seam between the existing shop, delivery,
// stocking, customer, checkout, and persistence systems. The systems keep
// their existing player-facing interfaces; every real movement also passes
// through this lot ledger so a unit can occupy exactly one lifecycle stage.
//
// Numeric shop inventory remains the fast rendering/gameplay projection. Lots
// are the auditable source of provenance and conservation. Reconciliation
// compares the two but never silently changes either outside the one-time
// migration of saves that predate this schema.

import { SHOP_CATALOG, skuById, LEAD_DAYS } from '../data/shopItems.js';
import { planShipment } from '../data/boxes.js';
import { SUPPLIERS, supplierFor, shipFee } from '../data/suppliers.js';
import { calendarOf } from './time.js';
import { addExpense, unbill } from './economy.js';
import { capacityOf } from '../data/fixtureSlots.js';

export const INVENTORY_LIFECYCLE_VERSION = 1;

export const INVENTORY_STAGE = Object.freeze({
  IN_TRANSIT: 'inTransit',
  DELIVERED_UNOPENED: 'deliveredUnopened',
  OPENED_BOX: 'openedBox',
  RESERVE: 'reserve',
  SHELF: 'shelf',
  CUSTOMER_HELD: 'customerHeld',
  SOLD: 'sold',
  DISPOSED_LOST: 'disposedLost',
});

export const INVENTORY_STAGES = Object.freeze(Object.values(INVENTORY_STAGE));

export const ORDER_STATE = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PROCESSING: 'Processing',
  DISPATCHED: 'Dispatched',
  ARRIVING: 'Arriving',
  DELIVERED: 'Delivered',
  PARTIALLY_RECEIVED: 'Partially received',
  RECEIVED: 'Received',
  PARTIALLY_UNPACKED: 'Partially unpacked',
  FULLY_UNPACKED: 'Fully unpacked',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
});

const EVENT_LIMIT = 300;
const DISCREPANCY_LIMIT = 300;
const OPERATION_LIMIT = 2500;
const DELIVERY_SLOTS = [[8, 10], [10, 12], [13, 15]];

const round2 = (value) => Math.round(value * 100) / 100;
const nowOf = (state) => (state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : 0);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function emptyBuckets() {
  return Object.fromEntries(INVENTORY_STAGES.map((stage) => [stage, 0]));
}

function totalBuckets(lot) {
  return INVENTORY_STAGES.reduce((sum, stage) => sum + (lot.buckets[stage] || 0), 0);
}

function emptyLifecycle() {
  return {
    schemaVersion: INVENTORY_LIFECYCLE_VERSION,
    nextLotId: 1,
    nextFailureId: 1,
    orders: [],
    failedOrders: [],
    lots: [],
    idempotency: { orders: {}, orderKeys: [] },
    operations: {},
    operationKeys: [],
    heldAllocations: {},
    events: [],
    discrepancies: [],
    migratedFromLegacy: false,
  };
}

function boundedPush(list, value, limit) {
  list.push(value);
  while (list.length > limit) list.shift();
}

function lifecycleEvent(state, kind, detail = {}) {
  const lifecycle = state.shop.inventoryLifecycle;
  boundedPush(lifecycle.events, { minute: nowOf(state), kind, ...detail }, EVENT_LIMIT);
}

function qaEnabled(state, options = {}) {
  return options.qa === true || state.qaMode === true || state.__qaMode === true;
}

function logDiscrepancy(state, discrepancy, options = {}) {
  if (!qaEnabled(state, options)) return;
  const lifecycle = state.shop.inventoryLifecycle;
  boundedPush(
    lifecycle.discrepancies,
    { minute: nowOf(state), context: options.context || null, ...discrepancy },
    DISCREPANCY_LIMIT,
  );
}

function makeLot(lifecycle, {
  source,
  orderId = null,
  lineId = null,
  skuId,
  quantity,
  stage,
  createdMin = 0,
  note = null,
}) {
  const buckets = emptyBuckets();
  buckets[stage] = quantity;
  const lot = {
    id: `lot-${lifecycle.nextLotId++}`,
    source,
    orderId,
    lineId,
    skuId,
    orderedQuantity: quantity,
    buckets,
    createdMin,
    active: true,
    note,
  };
  lifecycle.lots.push(lot);
  return lot;
}

function normalizeLifecycleShape(lifecycle) {
  lifecycle.schemaVersion = INVENTORY_LIFECYCLE_VERSION;
  lifecycle.nextLotId = Number.isSafeInteger(lifecycle.nextLotId) ? lifecycle.nextLotId : 1;
  lifecycle.nextFailureId = Number.isSafeInteger(lifecycle.nextFailureId) ? lifecycle.nextFailureId : 1;
  lifecycle.orders = Array.isArray(lifecycle.orders) ? lifecycle.orders : [];
  lifecycle.failedOrders = Array.isArray(lifecycle.failedOrders) ? lifecycle.failedOrders : [];
  lifecycle.lots = Array.isArray(lifecycle.lots) ? lifecycle.lots : [];
  lifecycle.idempotency = lifecycle.idempotency && typeof lifecycle.idempotency === 'object'
    ? lifecycle.idempotency
    : { orders: {}, orderKeys: [] };
  lifecycle.idempotency.orders = lifecycle.idempotency.orders || {};
  lifecycle.idempotency.orderKeys = Array.isArray(lifecycle.idempotency.orderKeys)
    ? lifecycle.idempotency.orderKeys
    : Object.keys(lifecycle.idempotency.orders);
  lifecycle.operations = lifecycle.operations && typeof lifecycle.operations === 'object'
    ? lifecycle.operations
    : {};
  lifecycle.operationKeys = Array.isArray(lifecycle.operationKeys)
    ? lifecycle.operationKeys
    : Object.keys(lifecycle.operations);
  lifecycle.heldAllocations = lifecycle.heldAllocations && typeof lifecycle.heldAllocations === 'object'
    ? lifecycle.heldAllocations
    : {};
  lifecycle.events = Array.isArray(lifecycle.events) ? lifecycle.events : [];
  lifecycle.discrepancies = Array.isArray(lifecycle.discrepancies) ? lifecycle.discrepancies : [];
  for (const lot of lifecycle.lots) {
    lot.buckets = lot.buckets && typeof lot.buckets === 'object' ? lot.buckets : emptyBuckets();
    for (const stage of INVENTORY_STAGES) {
      if (!Number.isSafeInteger(lot.buckets[stage]) || lot.buckets[stage] < 0) lot.buckets[stage] = 0;
    }
    if (lot.active === undefined) lot.active = true;
  }
}

function legacyStateFromStatus(status) {
  if (status === 'processing' || status === 'packed') return ORDER_STATE.PROCESSING;
  if (status === 'shipped' || status === 'out') return ORDER_STATE.DISPATCHED;
  if (status === 'arriving') return ORDER_STATE.ARRIVING;
  if (status === 'delivered') return ORDER_STATE.DELIVERED;
  return ORDER_STATE.SUBMITTED;
}

function orderLineFromLegacy(order) {
  const sku = skuById(order.skuId);
  return {
    id: `${order.id}-line-1`,
    skuId: order.skuId,
    quantity: order.qty,
    unitCost: sku ? sku.cost : round2((order.goods || 0) / Math.max(1, order.qty || 1)),
    goodsCost: Number.isFinite(order.goods) ? order.goods : round2((sku ? sku.cost : 0) * (order.qty || 0)),
    receivedQuantity: 0,
    unpackedQuantity: 0,
  };
}

function enrichLegacyOrder(order, state) {
  const lines = Array.isArray(order.lines) && order.lines.length ? order.lines : [orderLineFromLegacy(order)];
  const quantity = lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
  order.lines = lines;
  order.createdMin = Number.isFinite(order.createdMin) ? order.createdMin : (order.placedMin || 0);
  order.placedMin = Number.isFinite(order.placedMin) ? order.placedMin : order.createdMin;
  order.processingState = order.processingState || legacyStateFromStatus(order.status);
  order.dispatchState = order.dispatchState || (['shipped', 'out', 'arriving', 'delivered'].includes(order.status)
    ? 'Dispatched'
    : 'Pending');
  order.deliveredState = order.deliveredState || 'Not delivered';
  order.receivingState = order.receivingState || 'Awaiting delivery';
  order.completionState = order.completionState || 'Open';
  order.state = order.state || legacyStateFromStatus(order.status);
  order.boxIds = Array.isArray(order.boxIds) ? order.boxIds : [];
  order.remainingUnreceivedQuantity = Number.isSafeInteger(order.remainingUnreceivedQuantity)
    ? order.remainingUnreceivedQuantity
    : quantity;
  order.receivedQuantity = Number.isSafeInteger(order.receivedQuantity) ? order.receivedQuantity : 0;
  order.charged = order.charged !== false;
  order.chargeAmount = Number.isFinite(order.chargeAmount) ? order.chargeAmount : (order.cost || 0);
  order.refunded = !!order.refunded;
  order.stateHistory = Array.isArray(order.stateHistory)
    ? order.stateHistory
    : [{ state: order.state, minute: order.createdMin, note: 'Migrated legacy order' }];
  order.notif = order.notif || {};
  order.supplierId = order.supplierId || (order.manifest && order.manifest.supplierId) || null;
  order.deliveryEtaMin = Number.isFinite(order.deliveryEtaMin) ? order.deliveryEtaMin : order.deliveryMin;
  order.createdDay = calendarOf(order.createdMin).dayAbs;
  return order;
}

function isBoxOpened(box) {
  // New lifecycle boxes explicitly record when their inventory crossed from
  // deliveredUnopened to openedBox. Tape progress alone means the player is
  // still cutting a sealed carton. Retain the visual-state inference only for
  // legacy saves that predate inventoryOpened.
  if (typeof box.inventoryOpened === 'boolean') return box.inventoryOpened;
  return box.openedState === 'opened'
    || !!box.cut
    || (box.tape || 0) > 0
    || (Array.isArray(box.flaps) && box.flaps.some((flap) => flap > 0));
}

function bootstrapLegacyState(state, lifecycle) {
  const shop = state.shop;
  const minute = nowOf(state);

  // Active supplier orders become real conserved in-transit lots.
  for (const active of shop.orders || []) {
    const order = enrichLegacyOrder(active, state);
    if (!lifecycle.orders.some((candidate) => candidate.id === order.id)) lifecycle.orders.push(order);
    for (const line of order.lines) {
      if (!positiveInteger(line.quantity) || !skuById(line.skuId)) continue;
      makeLot(lifecycle, {
        source: 'order', orderId: order.id, lineId: line.id, skuId: line.skuId,
        quantity: line.quantity, stage: INVENTORY_STAGE.IN_TRANSIT,
        createdMin: order.createdMin, note: 'Migrated active order',
      });
    }
  }

  // Existing physical boxes are preserved exactly. Their historic removed
  // quantities cannot be attributed safely, so only the remaining contents are
  // represented as migration lots; current shelf/back/carry quantities are
  // separately captured as opening balance below.
  const boxes = (shop.deliveries && shop.deliveries.boxes) || [];
  for (const box of boxes) {
    const remaining = Math.max(0, Math.floor(box.qty || 0));
    box.persistentId = box.persistentId || `box-${box.id}`;
    box.parentOrderId = box.parentOrderId ?? box.orderId ?? null;
    box.supplier = box.supplier || null;
    box.initialQuantity = Number.isSafeInteger(box.initialQuantity)
      ? box.initialQuantity
      : (Number.isSafeInteger(box.cap) ? box.cap : remaining);
    box.remainingQuantity = remaining;
    box.weightClass = box.weightClass || (box.lb >= 40 ? 'heavy' : box.lb >= 16 ? 'medium' : 'light');
    box.openedState = isBoxOpened(box) ? 'opened' : 'unopened';
    box.inventoryOpened = isBoxOpened(box);
    box.currentLocation = box.currentLocation || box.loc || 'stock';
    box.currentCarrier = box.currentCarrier || (box.loc === 'carried' ? 'player' : null);
    box.damageState = box.damageState || 'intact';
    box.disposalState = box.disposalState || (box.flat ? 'flattened' : 'active');
    if (remaining <= 0) {
      box.contents = Array.isArray(box.contents) ? box.contents : [];
      continue;
    }
    const stage = isBoxOpened(box) ? INVENTORY_STAGE.OPENED_BOX : INVENTORY_STAGE.DELIVERED_UNOPENED;
    const lot = makeLot(lifecycle, {
      source: 'migration', orderId: box.orderId ?? null,
      lineId: `migration-box-${box.id}`, skuId: box.skuId,
      quantity: remaining, stage, createdMin: minute,
      note: 'Remaining contents of pre-ledger box',
    });
    if (!Array.isArray(box.contents) || !box.contents.length) {
      box.contents = [{
        lineId: lot.lineId,
        lotId: lot.id,
        skuId: box.skuId,
        quantity: remaining,
        remainingQuantity: remaining,
      }];
    }
  }

  // Everything already in the building is an opening-balance lot. Reserve
  // includes both stockroom numbers and products in the player's hands.
  const heldCounts = {};
  for (const held of shop.held || []) heldCounts[held.skuId] = (heldCounts[held.skuId] || 0) + (held.qty || 1);
  for (const sku of SHOP_CATALOG) {
    const inv = shop.inventory[sku.id] || { shelf: 0, back: 0 };
    const carried = shop.carry && shop.carry.skuId === sku.id ? shop.carry.qty || 0 : 0;
    const shelf = Math.max(0, Math.floor(inv.shelf || 0));
    const reserve = Math.max(0, Math.floor((inv.back || 0) + carried));
    const customerHeld = Math.max(0, Math.floor(heldCounts[sku.id] || 0));
    for (const [stage, quantity] of [
      [INVENTORY_STAGE.SHELF, shelf],
      [INVENTORY_STAGE.RESERVE, reserve],
      [INVENTORY_STAGE.CUSTOMER_HELD, customerHeld],
    ]) {
      if (quantity > 0) {
        const lot = makeLot(lifecycle, {
          source: 'opening', skuId: sku.id, quantity, stage, createdMin: minute,
          note: 'Opening balance captured during lifecycle migration',
        });
        if (stage === INVENTORY_STAGE.RESERVE && carried > 0 && shop.carry) {
          shop.carry.allocations = [{ lotId: lot.id, quantity: carried }];
        }
        if (stage === INVENTORY_STAGE.CUSTOMER_HELD && customerHeld > 0) {
          for (const held of (shop.held || []).filter((entry) => entry.skuId === sku.id)) {
            lifecycle.heldAllocations[held.uid] = [{ lotId: lot.id, quantity: held.qty || 1 }];
          }
        }
      }
    }
  }
  lifecycle.migratedFromLegacy = true;
  lifecycleEvent(state, 'migration', { lots: lifecycle.lots.length, orders: lifecycle.orders.length });
}

function rewireActiveOrders(state, lifecycle) {
  if (!Array.isArray(state.shop.orders)) state.shop.orders = [];
  state.shop.orders = state.shop.orders.map((active) => {
    const archived = lifecycle.orders.find((order) => order.id === active.id);
    if (!archived) {
      const enriched = enrichLegacyOrder(active, state);
      lifecycle.orders.push(enriched);
      return enriched;
    }
    // The active copy contains the most recent clock-driven status from the
    // saved shop projection; merge it once and then share one runtime object.
    Object.assign(archived, active);
    enrichLegacyOrder(archived, state);
    return archived;
  });
}

export function ensureInventoryLifecycle(state) {
  if (!state || !state.shop) return null;
  if (!state.shop.inventoryLifecycle) {
    state.shop.inventoryLifecycle = emptyLifecycle();
    bootstrapLegacyState(state, state.shop.inventoryLifecycle);
  } else {
    normalizeLifecycleShape(state.shop.inventoryLifecycle);
  }
  const lifecycle = state.shop.inventoryLifecycle;
  rewireActiveOrders(state, lifecycle);
  return lifecycle;
}

export function inventoryLots(state, filter = {}) {
  const lifecycle = ensureInventoryLifecycle(state);
  if (!lifecycle) return [];
  return lifecycle.lots.filter((lot) => (
    (filter.active === undefined || lot.active === filter.active)
    && (filter.skuId === undefined || lot.skuId === filter.skuId)
    && (filter.orderId === undefined || lot.orderId === filter.orderId)
    && (filter.lineId === undefined || lot.lineId === filter.lineId)
    && (filter.source === undefined || lot.source === filter.source)
  ));
}

export function allocationsForHeldUnit(state, uid) {
  const lifecycle = ensureInventoryLifecycle(state);
  return lifecycle && Array.isArray(lifecycle.heldAllocations[uid])
    ? lifecycle.heldAllocations[uid]
    : null;
}

export function rememberHeldAllocations(state, uid, allocations) {
  const lifecycle = ensureInventoryLifecycle(state);
  if (!lifecycle || !uid) return;
  lifecycle.heldAllocations[uid] = allocations.map((allocation) => ({ ...allocation }));
}

export function forgetHeldAllocations(state, uid) {
  const lifecycle = ensureInventoryLifecycle(state);
  if (lifecycle && uid) delete lifecycle.heldAllocations[uid];
}

export function allocationsForStage(state, {
  stage,
  quantity,
  skuId = undefined,
  orderId = undefined,
  lineId = undefined,
  excludeAllocations = null,
} = {}) {
  if (!INVENTORY_STAGES.includes(stage) || !positiveInteger(quantity)) {
    return { ok: false, reason: 'Invalid allocation request.' };
  }
  const candidates = inventoryLots(state, { active: true, skuId, orderId, lineId })
    .filter((lot) => (lot.buckets[stage] || 0) > 0)
    .sort((a, b) => a.createdMin - b.createdMin || a.id.localeCompare(b.id));
  const allocations = [];
  const excluded = new Map();
  for (const allocation of excludeAllocations || []) {
    excluded.set(allocation.lotId, (excluded.get(allocation.lotId) || 0) + (allocation.quantity || 0));
  }
  let left = quantity;
  for (const lot of candidates) {
    const available = Math.max(0, (lot.buckets[stage] || 0) - (excluded.get(lot.id) || 0));
    const take = Math.min(left, available);
    if (take > 0) allocations.push({ lotId: lot.id, quantity: take });
    left -= take;
    if (left <= 0) break;
  }
  return left > 0
    ? { ok: false, reason: `Only ${quantity - left} of ${quantity} units are available in ${stage}.` }
    : { ok: true, allocations };
}

// Explicit compatibility intake for code-level scenario builders that inject a
// physical unit through the old public state projection. Runtime gameplay never
// calls this path: boxes/backroom APIs already provide provenance. Recording an
// external-source lot keeps the action auditable instead of silently changing an
// existing order lot to make the books fit.
export function adoptExternalInventory(state, {
  skuId,
  quantity,
  stage,
  note = 'External inventory intake',
} = {}) {
  const lifecycle = ensureInventoryLifecycle(state);
  if (!lifecycle || !skuById(skuId) || !positiveInteger(quantity) || !INVENTORY_STAGES.includes(stage)) {
    return { ok: false, reason: 'Invalid external inventory intake.' };
  }
  const lot = makeLot(lifecycle, {
    source: 'external', skuId, quantity, stage,
    createdMin: nowOf(state), note,
  });
  lifecycleEvent(state, 'external-inventory-intake', {
    lotId: lot.id, skuId, quantity, stage, note,
  });
  return { ok: true, allocations: [{ lotId: lot.id, quantity }] };
}

function operationReplay(lifecycle, referenceId) {
  if (!referenceId) return null;
  const prior = lifecycle.operations[referenceId];
  return prior ? { ...prior, replayed: true } : null;
}

function rememberOperation(lifecycle, referenceId, result) {
  if (!referenceId) return;
  lifecycle.operations[referenceId] = result;
  lifecycle.operationKeys.push(referenceId);
  while (lifecycle.operationKeys.length > OPERATION_LIMIT) {
    const oldest = lifecycle.operationKeys.shift();
    delete lifecycle.operations[oldest];
  }
}

// Atomically move a quantity between lifecycle stages. If allocations are
// supplied, those exact lots must fund the movement; otherwise FIFO lots that
// match the order/line/SKU filters are selected. Physical projections should be
// changed only after this returns ok.
export function moveInventory(state, {
  from,
  to,
  quantity,
  skuId = undefined,
  orderId = undefined,
  lineId = undefined,
  allocations = null,
  referenceId = null,
  reason = null,
  qa = false,
  refreshOrder = true,
} = {}) {
  const lifecycle = ensureInventoryLifecycle(state);
  if (!lifecycle) return { ok: false, reason: 'Shop inventory is unavailable.' };
  const replay = operationReplay(lifecycle, referenceId);
  if (replay) return replay;
  if (!INVENTORY_STAGES.includes(from) || !INVENTORY_STAGES.includes(to) || from === to) {
    return { ok: false, reason: 'Invalid inventory movement.' };
  }
  if (!positiveInteger(quantity)) return { ok: false, reason: 'Quantity must be a positive whole number.' };

  let candidates;
  if (Array.isArray(allocations) && allocations.length) {
    const requested = new Map();
    for (const allocation of allocations) {
      if (!allocation || !positiveInteger(allocation.quantity)) {
        return { ok: false, reason: 'Invalid lot allocation.' };
      }
      requested.set(allocation.lotId, (requested.get(allocation.lotId) || 0) + allocation.quantity);
    }
    if ([...requested.values()].reduce((sum, value) => sum + value, 0) !== quantity) {
      return { ok: false, reason: 'Lot allocations do not match requested quantity.' };
    }
    candidates = [...requested].map(([lotId, wanted]) => ({
      lot: lifecycle.lots.find((candidate) => candidate.id === lotId),
      wanted,
    }));
  } else {
    candidates = lifecycle.lots
      .filter((lot) => lot.active !== false
        && (skuId === undefined || lot.skuId === skuId)
        && (orderId === undefined || lot.orderId === orderId)
        && (lineId === undefined || lot.lineId === lineId)
        && (lot.buckets[from] || 0) > 0)
      .sort((a, b) => a.createdMin - b.createdMin || a.id.localeCompare(b.id))
      .map((lot) => ({ lot, wanted: null }));
  }

  const plan = [];
  let left = quantity;
  for (const candidate of candidates) {
    const lot = candidate.lot;
    if (!lot || lot.active === false
      || (skuId !== undefined && lot.skuId !== skuId)
      || (orderId !== undefined && lot.orderId !== orderId)
      || (lineId !== undefined && lot.lineId !== lineId)) {
      const result = { ok: false, reason: 'Requested inventory lot is unavailable.' };
      logDiscrepancy(state, { kind: 'transfer-lot-missing', from, to, quantity, skuId, orderId, lineId }, { qa });
      return result;
    }
    const available = lot.buckets[from] || 0;
    const take = candidate.wanted == null ? Math.min(left, available) : candidate.wanted;
    if (take > available) {
      logDiscrepancy(state, {
        kind: 'transfer-insufficient-lot', lotId: lot.id, from, to,
        requested: take, available,
      }, { qa });
      return { ok: false, reason: 'Not enough inventory in the requested lot.' };
    }
    if (take > 0) {
      plan.push({ lot, quantity: take });
      left -= take;
    }
    if (left <= 0) break;
  }
  if (left > 0) {
    const available = quantity - left;
    logDiscrepancy(state, {
      kind: 'transfer-insufficient-stage', from, to, requested: quantity, available,
      skuId, orderId, lineId,
    }, { qa });
    return { ok: false, reason: `Only ${available} of ${quantity} units are available in ${from}.` };
  }

  for (const entry of plan) {
    entry.lot.buckets[from] -= entry.quantity;
    entry.lot.buckets[to] += entry.quantity;
  }
  const result = {
    ok: true,
    moved: quantity,
    from,
    to,
    allocations: plan.map((entry) => ({ lotId: entry.lot.id, quantity: entry.quantity })),
  };
  rememberOperation(lifecycle, referenceId, result);
  lifecycleEvent(state, 'inventory-move', {
    from, to, quantity, skuId: skuId ?? null, orderId: orderId ?? null,
    referenceId, reason,
  });
  if (refreshOrder && orderId !== undefined && orderId !== null) refreshOrderFromLedger(state, orderId);
  return result;
}

export function disposeInventory(state, options = {}) {
  if (!options.reason) return { ok: false, reason: 'Disposal requires an explicit reason.' };
  return moveInventory(state, { ...options, to: INVENTORY_STAGE.DISPOSED_LOST });
}

function normalizedLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return { ok: false, reason: 'Order has no products.' };
  const quantities = new Map();
  for (const input of lines) {
    const skuId = input && input.skuId;
    const quantity = input && input.quantity;
    if (!skuById(skuId)) return { ok: false, reason: `Unknown product: ${skuId || 'missing SKU'}.` };
    if (!positiveInteger(quantity)) return { ok: false, reason: 'Order quantities must be positive whole numbers.' };
    quantities.set(skuId, (quantities.get(skuId) || 0) + quantity);
  }
  return {
    ok: true,
    lines: [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([skuId, quantity]) => ({ skuId, quantity })),
  };
}

function payloadFingerprint(lines) {
  return lines.map((line) => `${line.skuId}:${line.quantity}`).join('|');
}

function rememberOrderKey(lifecycle, key, value) {
  if (!key) return;
  lifecycle.idempotency.orders[key] = value;
  lifecycle.idempotency.orderKeys.push(key);
  while (lifecycle.idempotency.orderKeys.length > OPERATION_LIMIT) {
    const oldest = lifecycle.idempotency.orderKeys.shift();
    delete lifecycle.idempotency.orders[oldest];
  }
}

function failedOrder(state, lines, reason, idempotencyKey, fingerprint) {
  const lifecycle = ensureInventoryLifecycle(state);
  const minute = nowOf(state);
  const order = {
    id: `failed-${lifecycle.nextFailureId++}`,
    supplierId: null,
    supplier: null,
    lines,
    quantity: lines.reduce((sum, line) => sum + (line.quantity || 0), 0),
    goods: 0,
    shippingCost: 0,
    totalCost: 0,
    cost: 0,
    createdMin: minute,
    placedMin: minute,
    processingState: ORDER_STATE.FAILED,
    dispatchState: 'Not dispatched',
    deliveredState: 'Not delivered',
    receivingState: 'Not received',
    completionState: ORDER_STATE.FAILED,
    state: ORDER_STATE.FAILED,
    status: 'failed',
    boxIds: [],
    remainingUnreceivedQuantity: 0,
    charged: false,
    refunded: false,
    failureReason: reason,
    idempotencyKey: idempotencyKey || null,
    stateHistory: [{ state: ORDER_STATE.FAILED, minute, note: reason }],
  };
  lifecycle.failedOrders.push(order);
  boundedPush(lifecycle.orders, order, 2000);
  rememberOrderKey(lifecycle, idempotencyKey, {
    fingerprint,
    ok: false,
    reason,
    orderIds: [order.id],
  });
  lifecycleEvent(state, 'order-failed', { orderId: order.id, reason });
  return { ok: false, reason, orders: [order], charged: 0 };
}

function buildOrderDraft(state, supplier, inputs, id) {
  const minute = nowOf(state);
  const dayAbs = calendarOf(minute).dayAbs;
  const lines = [];
  const boxes = [];
  let goods = 0;
  let leadDays = 1;
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const sku = skuById(input.skuId);
    const lineId = `${id}-line-${index + 1}`;
    const goodsCost = round2(sku.cost * input.quantity);
    const plan = planShipment(sku, input.quantity);
    lines.push({
      id: lineId,
      skuId: sku.id,
      quantity: input.quantity,
      unitCost: sku.cost,
      goodsCost,
      receivedQuantity: 0,
      unpackedQuantity: 0,
    });
    for (const box of plan.boxes) boxes.push({ ...box, skuId: sku.id, lineId });
    goods += goodsCost;
    leadDays = Math.max(leadDays, LEAD_DAYS[sku.cat] || 1);
  }
  goods = round2(goods);
  const shippingCost = shipFee(supplier, boxes.length);
  const totalCost = round2(goods + shippingCost);
  const arrivesDay = dayAbs + leadDays;
  const numeric = Number.isSafeInteger(id) ? id : lines.length;
  const slot = DELIVERY_SLOTS[(numeric * 7) % DELIVERY_SLOTS.length];
  const open = arrivesDay * 1440 + slot[0] * 60;
  const close = arrivesDay * 1440 + slot[1] * 60;
  const deliveryMin = open + ((numeric * 37) % Math.max(1, close - open));
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const weight = round2(boxes.reduce((sum, box) => sum + box.lb, 0));
  return {
    id,
    supplierId: supplier.id,
    supplier: supplier.name,
    lines,
    skuId: lines.length === 1 ? lines[0].skuId : null,
    qty: quantity,
    quantity,
    goods,
    fee: shippingCost,
    shippingCost,
    cost: totalCost,
    totalCost,
    createdMin: minute,
    placedMin: minute,
    createdDay: dayAbs,
    processingState: ORDER_STATE.SUBMITTED,
    dispatchState: 'Pending',
    deliveredState: 'Not delivered',
    receivingState: 'Awaiting delivery',
    completionState: 'Open',
    state: ORDER_STATE.SUBMITTED,
    status: 'received',
    arrivesDay,
    deliveryEtaMin: deliveryMin,
    deliveryMin,
    window: { open, close },
    manifest: {
      supplierId: supplier.id,
      supplier: supplier.name,
      boxes,
      boxCount: boxes.length,
      weight,
      fee: shippingCost,
    },
    boxIds: [],
    remainingUnreceivedQuantity: quantity,
    receivedQuantity: 0,
    unpackedQuantity: 0,
    charged: false,
    chargeAmount: totalCost,
    chargeReference: null,
    refunded: false,
    idempotencyKey: null,
    notif: {},
    stateHistory: [{ state: ORDER_STATE.DRAFT, minute, note: 'Order prepared' }],
  };
}

// Submit one player basket. Lines are grouped into one purchase order per
// supplier so freight base charges happen once per supplier. The entire basket
// is preflighted before cash or inventory changes, then charged once.
export function quotePurchaseOrders(state, lines) {
  const normalized = normalizedLines(lines);
  if (!normalized.ok) return normalized;
  const groups = new Map();
  for (const line of normalized.lines) {
    const sku = skuById(line.skuId);
    if (sku.tier > state.shop.unlockedTier) {
      return { ok: false, reason: `${sku.name} is not available from the current supplier account.` };
    }
    const supplier = supplierFor(sku);
    if (!groups.has(supplier.id)) groups.set(supplier.id, { supplier, lines: [] });
    groups.get(supplier.id).lines.push(line);
  }
  let nextOrderId = Number.isSafeInteger(state.shop.nextOrderId) ? state.shop.nextOrderId : 1;
  const orders = [...groups.values()].map((group) => buildOrderDraft(state, group.supplier, group.lines, nextOrderId++));
  return {
    ok: true,
    orders,
    goods: round2(orders.reduce((sum, order) => sum + order.goods, 0)),
    freight: round2(orders.reduce((sum, order) => sum + order.shippingCost, 0)),
    total: round2(orders.reduce((sum, order) => sum + order.totalCost, 0)),
    boxes: orders.reduce((sum, order) => sum + order.manifest.boxCount, 0),
    weight: round2(orders.reduce((sum, order) => sum + order.manifest.weight, 0)),
  };
}

export function submitPurchaseOrders(state, {
  lines,
  idempotencyKey = null,
} = {}) {
  const lifecycle = ensureInventoryLifecycle(state);
  if (!lifecycle) return { ok: false, reason: 'Shop inventory is unavailable.' };
  const normalized = normalizedLines(lines);
  const fingerprint = normalized.ok ? payloadFingerprint(normalized.lines) : JSON.stringify(lines || []);
  if (idempotencyKey && lifecycle.idempotency.orders[idempotencyKey]) {
    const prior = lifecycle.idempotency.orders[idempotencyKey];
    if (prior.fingerprint !== fingerprint) {
      return { ok: false, reason: 'This order key was already used for different products.' };
    }
    const all = [...lifecycle.orders, ...lifecycle.failedOrders];
    const orders = prior.orderIds.map((id) => all.find((order) => order.id === id)).filter(Boolean);
    return { ok: prior.ok, reason: prior.reason, orders, charged: 0, replayed: true };
  }
  if (!normalized.ok) return failedOrder(state, [], normalized.reason, idempotencyKey, fingerprint);

  const groups = new Map();
  for (const line of normalized.lines) {
    const sku = skuById(line.skuId);
    if (sku.tier > state.shop.unlockedTier) {
      return failedOrder(
        state, normalized.lines,
        `${sku.name} is not available from the current supplier account.`,
        idempotencyKey, fingerprint,
      );
    }
    const supplier = supplierFor(sku);
    if (!groups.has(supplier.id)) groups.set(supplier.id, { supplier, lines: [] });
    groups.get(supplier.id).lines.push(line);
  }

  // Reserve IDs only in local drafts until every validation succeeds.
  let nextOrderId = Number.isSafeInteger(state.shop.nextOrderId) ? state.shop.nextOrderId : 1;
  const drafts = [...groups.values()].map((group) => buildOrderDraft(state, group.supplier, group.lines, nextOrderId++));
  const totalCost = round2(drafts.reduce((sum, order) => sum + order.totalCost, 0));
  if (!Number.isFinite(state.cash) || state.cash < totalCost) {
    return failedOrder(state, normalized.lines, 'Not enough cash.', idempotencyKey, fingerprint);
  }

  const minute = nowOf(state);
  const chargeReference = idempotencyKey || `purchase-${minute}-${drafts.map((order) => order.id).join('-')}`;
  // The physical lifecycle owns ordering, and the immutable journal owns money.
  // One stable basket entry preserves the existing shopOrders compatibility line
  // while its metadata exposes goods and freight without a second purchase path.
  const charged = addExpense(state, 'shopOrders', totalCost, {
    idempotencyKey: `inventory-order:${chargeReference}:charge`,
    relatedId: chargeReference,
    description: `${drafts.length} supplier purchase order${drafts.length === 1 ? '' : 's'}`,
    source: 'inventory-order',
    units: drafts.reduce((sum, order) => sum + order.quantity, 0),
    metadata: {
      orderIds: drafts.map((order) => order.id),
      supplierIds: drafts.map((order) => order.supplierId),
      goods: round2(drafts.reduce((sum, order) => sum + order.goods, 0)),
      shipping: round2(drafts.reduce((sum, order) => sum + order.shippingCost, 0)),
    },
  });
  if (!charged.ok || charged.duplicate) {
    return failedOrder(
      state,
      normalized.lines,
      charged.duplicate ? 'This purchase command was already charged.' : charged.reason,
      idempotencyKey,
      fingerprint,
    );
  }
  state.shop.nextOrderId = nextOrderId;
  for (const order of drafts) {
    order.charged = true;
    order.chargeReference = chargeReference;
    order.ledgerKeys = { charge: charged.entry?.idempotencyKey || null };
    order.ledgerEntryId = charged.entry?.id || null;
    order.idempotencyKey = idempotencyKey;
    order.stateHistory.push({ state: ORDER_STATE.SUBMITTED, minute, note: 'Supplier order submitted and charged' });
    lifecycle.orders.push(order);
    state.shop.orders.push(order);
    for (const line of order.lines) {
      makeLot(lifecycle, {
        source: 'order', orderId: order.id, lineId: line.id, skuId: line.skuId,
        quantity: line.quantity, stage: INVENTORY_STAGE.IN_TRANSIT, createdMin: minute,
        note: `Purchase order ${order.id}`,
      });
    }
    lifecycleEvent(state, 'order-submitted', {
      orderId: order.id, supplierId: order.supplierId,
      quantity: order.quantity, totalCost: order.totalCost,
    });
  }
  rememberOrderKey(lifecycle, idempotencyKey, {
    fingerprint,
    ok: true,
    reason: null,
    orderIds: drafts.map((order) => order.id),
  });
  return {
    ok: true,
    orders: drafts,
    cost: totalCost,
    charged: totalCost,
    boxes: drafts.reduce((sum, order) => sum + order.manifest.boxCount, 0),
    replayed: false,
  };
}

export function purchaseOrderById(state, id) {
  const lifecycle = ensureInventoryLifecycle(state);
  return lifecycle ? lifecycle.orders.find((order) => order.id === id) || null : null;
}

// Compatibility boundary for deterministic tests and pre-v4 callers that hand
// arriveOrder a real manifest object directly. It records that object as an
// uncharged external order before receipt; production laptop orders already
// exist and simply pass through unchanged.
export function ensureArrivalOrder(state, input) {
  const existing = purchaseOrderById(state, input && input.id);
  if (existing) return existing;
  if (!input || input.id == null || !skuById(input.skuId) || !positiveInteger(input.qty)) return null;
  const lifecycle = ensureInventoryLifecycle(state);
  const order = enrichLegacyOrder({
    ...input,
    cost: Number.isFinite(input.cost) ? input.cost : 0,
    goods: Number.isFinite(input.goods) ? input.goods : 0,
    fee: Number.isFinite(input.fee) ? input.fee : 0,
    charged: false,
    status: 'delivered',
  }, state);
  order.state = ORDER_STATE.DELIVERED;
  order.processingState = 'Complete';
  order.dispatchState = 'Dispatched';
  order.deliveredState = ORDER_STATE.DELIVERED;
  order.receivingState = 'Awaiting box receipt';
  order.completionState = 'Open';
  order.stateHistory.push({
    state: ORDER_STATE.DELIVERED,
    minute: nowOf(state),
    note: 'External manifest registered at arrival boundary',
  });
  lifecycle.orders.push(order);
  for (const line of order.lines) {
    makeLot(lifecycle, {
      source: 'external-order', orderId: order.id, lineId: line.id, skuId: line.skuId,
      quantity: line.quantity, stage: INVENTORY_STAGE.IN_TRANSIT,
      createdMin: order.createdMin, note: 'External arrival compatibility order',
    });
  }
  lifecycleEvent(state, 'external-order-registered', { orderId: order.id, quantity: order.qty });
  return order;
}

export function setOrderState(state, orderOrId, nextState, note = null) {
  const order = typeof orderOrId === 'object' ? orderOrId : purchaseOrderById(state, orderOrId);
  if (!order || !Object.values(ORDER_STATE).includes(nextState)) return null;
  if (order.state !== nextState) {
    order.state = nextState;
    if (!Array.isArray(order.stateHistory)) order.stateHistory = [];
    order.stateHistory.push({ state: nextState, minute: nowOf(state), note });
    lifecycleEvent(state, 'order-state', { orderId: order.id, state: nextState, note });
  }
  return order;
}

export function syncOrderTransitState(state, order, legacyStatus) {
  if (!order) return null;
  order.status = legacyStatus;
  if ((order.receivedQuantity || 0) > 0) {
    refreshOrderFromLedger(state, order);
    return order;
  }
  if (legacyStatus === 'processing' || legacyStatus === 'packed') {
    order.processingState = ORDER_STATE.PROCESSING;
    setOrderState(state, order, ORDER_STATE.PROCESSING, `Supplier status: ${legacyStatus}`);
  } else if (legacyStatus === 'shipped' || legacyStatus === 'out') {
    order.processingState = 'Complete';
    order.dispatchState = ORDER_STATE.DISPATCHED;
    setOrderState(state, order, ORDER_STATE.DISPATCHED, `Dispatch status: ${legacyStatus}`);
  } else if (legacyStatus === 'arriving') {
    order.dispatchState = ORDER_STATE.ARRIVING;
    setOrderState(state, order, ORDER_STATE.ARRIVING, 'Delivery vehicle approaching');
  }
  return order;
}

export function cancelPurchaseOrder(state, id) {
  const lifecycle = ensureInventoryLifecycle(state);
  const order = lifecycle && lifecycle.orders.find((candidate) => candidate.id === id);
  if (!order) return { ok: false, reason: 'No such order.' };
  if (order.state === ORDER_STATE.CANCELLED) return { ok: false, reason: 'Order already cancelled.', refund: 0 };
  if (order.state === ORDER_STATE.FAILED) return { ok: false, reason: 'Failed orders were never charged.' };
  if ([
    ORDER_STATE.ARRIVING,
    ORDER_STATE.DELIVERED,
    ORDER_STATE.PARTIALLY_RECEIVED,
    ORDER_STATE.RECEIVED,
    ORDER_STATE.PARTIALLY_UNPACKED,
    ORDER_STATE.FULLY_UNPACKED,
  ].includes(order.state)) {
    return { ok: false, reason: 'The shipment is already at the property.' };
  }
  const activeIndex = state.shop.orders.findIndex((candidate) => candidate.id === id);
  if (activeIndex < 0) return { ok: false, reason: 'Order is no longer cancellable.' };

  const lots = lifecycle.lots.filter((lot) => lot.active !== false && lot.orderId === id);
  if (lots.some((lot) => (lot.buckets[INVENTORY_STAGE.IN_TRANSIT] || 0) !== lot.orderedQuantity)) {
    return { ok: false, reason: 'Some of this shipment has already been received.' };
  }
  state.shop.orders.splice(activeIndex, 1);
  for (const lot of lots) {
    lot.active = false;
    lot.cancelledQuantity = lot.orderedQuantity;
    lot.buckets = emptyBuckets();
  }
  let refund = 0;
  if (order.charged && !order.refunded) {
    refund = order.chargeAmount || order.totalCost || order.cost || 0;
    const reversal = unbill(state, 'shopOrders', refund, {
      idempotencyKey: `inventory-order:${order.chargeReference || order.id}:cancel:${order.id}`,
      relatedId: order.id,
      description: `Cancelled supplier order ${order.id}`,
      source: 'inventory-order',
      units: order.quantity,
      metadata: { chargeReference: order.chargeReference, supplierId: order.supplierId },
    });
    order.refunded = true;
    order.refundAmount = refund;
    order.refundedMin = nowOf(state);
    order.refundLedgerEntryId = reversal.entry?.id || null;
  }
  order.processingState = ORDER_STATE.CANCELLED;
  order.dispatchState = 'Not dispatched';
  order.receivingState = 'Cancelled before receipt';
  order.completionState = ORDER_STATE.CANCELLED;
  order.remainingUnreceivedQuantity = 0;
  setOrderState(state, order, ORDER_STATE.CANCELLED, 'Player cancelled before receipt');
  return { ok: true, refund, order };
}

export function refreshOrderFromLedger(state, orderOrId) {
  const order = typeof orderOrId === 'object' ? orderOrId : purchaseOrderById(state, orderOrId);
  if (!order || [ORDER_STATE.CANCELLED, ORDER_STATE.FAILED].includes(order.state)) return order;
  const lots = inventoryLots(state, { orderId: order.id, active: true });
  if (!lots.length) return order;
  const sums = emptyBuckets();
  for (const lot of lots) {
    for (const stage of INVENTORY_STAGES) sums[stage] += lot.buckets[stage] || 0;
  }
  const total = lots.reduce((sum, lot) => sum + lot.orderedQuantity, 0);
  const inTransit = sums[INVENTORY_STAGE.IN_TRANSIT];
  const boxUnits = sums[INVENTORY_STAGE.DELIVERED_UNOPENED] + sums[INVENTORY_STAGE.OPENED_BOX];
  const unpacked = total - inTransit - boxUnits;
  order.quantity = total;
  order.qty = total;
  order.remainingUnreceivedQuantity = inTransit;
  order.receivedQuantity = total - inTransit;
  order.unpackedQuantity = unpacked;
  for (const line of order.lines || []) {
    const lineLots = lots.filter((lot) => lot.lineId === line.id);
    const lineTransit = lineLots.reduce((sum, lot) => sum + lot.buckets[INVENTORY_STAGE.IN_TRANSIT], 0);
    const lineBoxes = lineLots.reduce((sum, lot) => sum
      + lot.buckets[INVENTORY_STAGE.DELIVERED_UNOPENED]
      + lot.buckets[INVENTORY_STAGE.OPENED_BOX], 0);
    line.receivedQuantity = line.quantity - lineTransit;
    line.unpackedQuantity = line.quantity - lineTransit - lineBoxes;
  }

  if (inTransit > 0 && inTransit < total) {
    order.deliveredState = 'Partially delivered';
    order.receivingState = ORDER_STATE.PARTIALLY_RECEIVED;
    order.completionState = 'Open';
    setOrderState(state, order, ORDER_STATE.PARTIALLY_RECEIVED, 'Only part of the manifest has arrived');
  } else if (inTransit === 0) {
    order.deliveredState = ORDER_STATE.DELIVERED;
    if (unpacked >= total) {
      order.receivingState = ORDER_STATE.RECEIVED;
      order.completionState = ORDER_STATE.FULLY_UNPACKED;
      setOrderState(state, order, ORDER_STATE.FULLY_UNPACKED, 'Every delivered unit left its shipping box');
    } else if (unpacked > 0) {
      order.receivingState = ORDER_STATE.RECEIVED;
      order.completionState = ORDER_STATE.PARTIALLY_UNPACKED;
      setOrderState(state, order, ORDER_STATE.PARTIALLY_UNPACKED, 'Some delivered units remain boxed');
    } else {
      order.receivingState = ORDER_STATE.RECEIVED;
      order.completionState = 'Awaiting unpacking';
      setOrderState(state, order, ORDER_STATE.RECEIVED, 'Manifest received into physical boxes');
    }
  }
  return order;
}

// Receive one physical box. Call after the box has its persistent ID but before
// exposing it to gameplay. Each entry is tied to its order line; a replay of the
// same box ID is harmless.
export function receiveBoxInventory(state, orderId, boxId, entries) {
  const order = purchaseOrderById(state, orderId);
  if (!order) return { ok: false, reason: 'Parent order is missing.' };
  if (!Array.isArray(entries) || !entries.length) return { ok: false, reason: 'Box has no manifest contents.' };
  const plans = [];
  const allAllocations = [];
  let total = 0;
  for (const entry of entries) {
    if (!entry || !positiveInteger(entry.quantity)) return { ok: false, reason: 'Invalid box content quantity.' };
    const allocation = allocationsForStage(state, {
      stage: INVENTORY_STAGE.IN_TRANSIT,
      quantity: entry.quantity,
      skuId: entry.skuId,
      orderId,
      lineId: entry.lineId,
      excludeAllocations: allAllocations,
    });
    if (!allocation.ok) return allocation;
    plans.push({ entry, allocations: allocation.allocations });
    allAllocations.push(...allocation.allocations);
    total += entry.quantity;
  }
  const moved = moveInventory(state, {
    from: INVENTORY_STAGE.IN_TRANSIT,
    to: INVENTORY_STAGE.DELIVERED_UNOPENED,
    quantity: total,
    orderId,
    allocations: allAllocations,
    referenceId: `receive-box:${boxId}`,
    reason: `Received in box ${boxId}`,
    refreshOrder: false,
  });
  if (!moved.ok) return moved;
  const contents = [];
  for (const plan of plans) {
    for (const allocation of plan.allocations) {
      contents.push({
        lineId: plan.entry.lineId,
        lotId: allocation.lotId,
        skuId: plan.entry.skuId,
        quantity: allocation.quantity,
        remainingQuantity: allocation.quantity,
      });
    }
  }
  const firstBox = order.boxIds.length === 0;
  if (!order.boxIds.includes(boxId)) order.boxIds.push(boxId);
  order.deliveredState = ORDER_STATE.DELIVERED;
  if (firstBox) setOrderState(state, order, ORDER_STATE.DELIVERED, `Box ${boxId} reached the receiving zone`);
  refreshOrderFromLedger(state, order);
  return { ok: true, contents };
}

export function openBoxInventory(state, box) {
  ensureInventoryLifecycle(state);
  if (!box || !Array.isArray(box.contents)) return { ok: false, reason: 'Box contents are unavailable.' };
  if (box.inventoryOpened) return { ok: false, reason: 'Box inventory is already open.', done: true };
  const allocations = box.contents
    .filter((content) => (content.remainingQuantity || 0) > 0)
    .map((content) => ({ lotId: content.lotId, quantity: content.remainingQuantity }));
  const quantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  let moved = { ok: true, allocations: [] };
  if (quantity > 0) {
    moved = moveInventory(state, {
      from: INVENTORY_STAGE.DELIVERED_UNOPENED,
      to: INVENTORY_STAGE.OPENED_BOX,
      quantity,
      orderId: box.orderId,
      allocations,
      referenceId: `open-box:${box.id}`,
      reason: `Shipping box ${box.id} opened`,
      refreshOrder: false,
    });
    if (!moved.ok) return moved;
  }
  box.inventoryOpened = true;
  box.openedState = 'opened';
  if (box.orderId !== undefined && box.orderId !== null) refreshOrderFromLedger(state, box.orderId);
  return { ok: true, allocations: moved.allocations };
}

// Move exact visible contents into reserve/carry accounting. The caller updates
// the player's carry projection only after this succeeds.
export function takeBoxInventory(state, box, skuId, quantity, referenceId = null) {
  ensureInventoryLifecycle(state);
  if (!box || !Array.isArray(box.contents)) return { ok: false, reason: 'Box contents are unavailable.' };
  if (!box.inventoryOpened) return { ok: false, reason: 'Open the box first.' };
  const available = box.contents
    .filter((content) => content.skuId === skuId)
    .reduce((sum, content) => sum + (content.remainingQuantity || 0), 0);
  if (!positiveInteger(quantity) || available < quantity) return { ok: false, reason: 'Not enough product remains in the box.' };
  const contentPlan = [];
  let left = quantity;
  for (const content of box.contents) {
    if (content.skuId !== skuId || left <= 0) continue;
    const take = Math.min(left, content.remainingQuantity || 0);
    if (take > 0) contentPlan.push({ content, quantity: take });
    left -= take;
  }
  const allocations = contentPlan.map(({ content, quantity: amount }) => ({ lotId: content.lotId, quantity: amount }));
  const moved = moveInventory(state, {
    from: INVENTORY_STAGE.OPENED_BOX,
    to: INVENTORY_STAGE.RESERVE,
    quantity,
    skuId,
    orderId: box.orderId,
    allocations,
    referenceId,
    reason: `Removed product from box ${box.id}`,
  });
  if (!moved.ok) return moved;
  for (const entry of contentPlan) entry.content.remainingQuantity -= entry.quantity;
  box.remainingQuantity = box.contents.reduce((sum, content) => sum + (content.remainingQuantity || 0), 0);
  box.qty = box.remainingQuantity;
  if (box.orderId !== undefined && box.orderId !== null) refreshOrderFromLedger(state, box.orderId);
  return moved;
}

export function inventoryPosition(state, skuId) {
  const buckets = emptyBuckets();
  for (const lot of inventoryLots(state, { skuId, active: true })) {
    for (const stage of INVENTORY_STAGES) buckets[stage] += lot.buckets[stage] || 0;
  }
  const onHand = buckets[INVENTORY_STAGE.DELIVERED_UNOPENED]
    + buckets[INVENTORY_STAGE.OPENED_BOX]
    + buckets[INVENTORY_STAGE.RESERVE]
    + buckets[INVENTORY_STAGE.SHELF]
    + buckets[INVENTORY_STAGE.CUSTOMER_HELD];
  return {
    skuId,
    ...buckets,
    onHand,
    available: buckets[INVENTORY_STAGE.RESERVE] + buckets[INVENTORY_STAGE.SHELF],
    committed: buckets[INVENTORY_STAGE.CUSTOMER_HELD],
    incoming: buckets[INVENTORY_STAGE.IN_TRANSIT],
  };
}

export function reorderSuggestion(state, skuId) {
  const sku = skuById(skuId);
  if (!sku) return null;
  const position = inventoryPosition(state, skuId);
  const window = (state.shop && state.shop.salesWindow) || [];
  const soldInWindow = window.reduce((sum, day) => sum + (day[skuId] || 0), 0);
  const dailyVelocity = window.length ? soldInWindow / window.length : 0;
  const leadDays = LEAD_DAYS[sku.cat] || 1;
  const shelfCapacity = capacityOf(skuId);
  const shelfLowAt = Math.max(1, Math.ceil(shelfCapacity * 0.25));
  const target = Math.max(shelfCapacity, Math.ceil(dailyVelocity * (leadDays + 7)));
  const supply = position.onHand + position.inTransit;
  const suggestedQuantity = Math.max(0, target - supply);
  const supplier = supplierFor(sku);
  const activeEtas = (state.shop.orders || [])
    .filter((order) => (order.lines || []).some((line) => line.skuId === skuId))
    .map((order) => order.deliveryEtaMin || order.deliveryMin)
    .filter(Number.isFinite);
  return {
    skuId,
    supplierId: supplier.id,
    supplier: supplier.name,
    supplierAvailable: sku.tier <= state.shop.unlockedTier,
    shelfLow: position.shelf <= shelfLowAt,
    totalLow: supply <= Math.max(shelfLowAt, Math.ceil(dailyVelocity * leadDays)),
    outOfStock: position.onHand <= 0,
    suggestedQuantity,
    incoming: position.inTransit,
    earliestEtaMin: activeEtas.length ? Math.min(...activeEtas) : null,
    leadDays,
    dailyVelocity,
  };
}

function addCount(table, skuId, stage, quantity) {
  if (!table[skuId]) table[skuId] = emptyBuckets();
  table[skuId][stage] += quantity;
}

function actualPhysicalCounts(state) {
  const counts = {};
  for (const order of state.shop.orders || []) {
    if ([ORDER_STATE.CANCELLED, ORDER_STATE.FAILED].includes(order.state)) continue;
    for (const line of order.lines || []) {
      const remaining = Number.isSafeInteger(line.receivedQuantity)
        ? Math.max(0, line.quantity - line.receivedQuantity)
        : line.quantity;
      addCount(counts, line.skuId, INVENTORY_STAGE.IN_TRANSIT, remaining);
    }
  }
  for (const box of (state.shop.deliveries && state.shop.deliveries.boxes) || []) {
    if (box.disposalState === 'disposed' || box.recycled) continue;
    if (Array.isArray(box.contents) && box.contents.length) {
      for (const content of box.contents) {
        const stage = box.inventoryOpened || isBoxOpened(box)
          ? INVENTORY_STAGE.OPENED_BOX
          : INVENTORY_STAGE.DELIVERED_UNOPENED;
        addCount(counts, content.skuId, stage, Math.max(0, content.remainingQuantity || 0));
      }
    } else if ((box.qty || 0) > 0) {
      const stage = isBoxOpened(box) ? INVENTORY_STAGE.OPENED_BOX : INVENTORY_STAGE.DELIVERED_UNOPENED;
      addCount(counts, box.skuId, stage, box.qty);
    }
  }
  for (const sku of SHOP_CATALOG) {
    const inv = state.shop.inventory[sku.id] || { shelf: 0, back: 0 };
    addCount(counts, sku.id, INVENTORY_STAGE.SHELF, Math.max(0, inv.shelf || 0));
    addCount(counts, sku.id, INVENTORY_STAGE.RESERVE, Math.max(0, inv.back || 0));
  }
  const carry = state.shop.carry;
  if (carry) addCount(counts, carry.skuId, INVENTORY_STAGE.RESERVE, Math.max(0, carry.qty || 0));
  for (const held of state.shop.held || []) {
    addCount(counts, held.skuId, INVENTORY_STAGE.CUSTOMER_HELD, Math.max(0, held.qty || 1));
  }
  return counts;
}

export function reconcileInventory(state, options = {}) {
  const lifecycle = ensureInventoryLifecycle(state);
  if (!lifecycle) return { ok: false, discrepancies: [{ kind: 'shop-missing' }] };
  const discrepancies = [];
  const ledgerCounts = {};
  for (const lot of lifecycle.lots) {
    if (lot.active === false) continue;
    const bucketTotal = totalBuckets(lot);
    if (bucketTotal !== lot.orderedQuantity) {
      discrepancies.push({
        kind: 'lot-conservation', lotId: lot.id, skuId: lot.skuId,
        expected: lot.orderedQuantity, actual: bucketTotal,
      });
    }
    for (const stage of INVENTORY_STAGES) addCount(ledgerCounts, lot.skuId, stage, lot.buckets[stage] || 0);
  }

  const physicalCounts = actualPhysicalCounts(state);
  const skuIds = new Set([...Object.keys(ledgerCounts), ...Object.keys(physicalCounts)]);
  const externallyProjected = [
    INVENTORY_STAGE.IN_TRANSIT,
    INVENTORY_STAGE.DELIVERED_UNOPENED,
    INVENTORY_STAGE.OPENED_BOX,
    INVENTORY_STAGE.RESERVE,
    INVENTORY_STAGE.SHELF,
    INVENTORY_STAGE.CUSTOMER_HELD,
  ];
  for (const skuId of skuIds) {
    for (const stage of externallyProjected) {
      const ledger = (ledgerCounts[skuId] && ledgerCounts[skuId][stage]) || 0;
      const physical = (physicalCounts[skuId] && physicalCounts[skuId][stage]) || 0;
      if (ledger !== physical) {
        discrepancies.push({ kind: 'projection-mismatch', skuId, stage, ledger, physical });
      }
    }
  }
  for (const discrepancy of discrepancies) logDiscrepancy(state, discrepancy, options);
  return {
    ok: discrepancies.length === 0,
    discrepancies,
    ledger: ledgerCounts,
    physical: physicalCounts,
    orderedQuantity: lifecycle.lots
      .filter((lot) => lot.active !== false && lot.source === 'order')
      .reduce((sum, lot) => sum + lot.orderedQuantity, 0),
  };
}

export function inventoryLifecycleSummary(state) {
  const lifecycle = ensureInventoryLifecycle(state);
  const totals = emptyBuckets();
  for (const lot of lifecycle.lots) {
    if (lot.active === false) continue;
    for (const stage of INVENTORY_STAGES) totals[stage] += lot.buckets[stage] || 0;
  }
  return {
    schemaVersion: lifecycle.schemaVersion,
    activeOrders: state.shop.orders.length,
    archivedOrders: lifecycle.orders.length,
    lots: lifecycle.lots.filter((lot) => lot.active !== false).length,
    totals,
  };
}

export function supplierById(id) {
  return SUPPLIERS[id] || null;
}
