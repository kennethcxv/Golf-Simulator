// LIVE CHECKOUT — the walk-in customers you can SEE pick real units off real
// shelves, and the player rings them through at the register. This is
// additive revenue on top of the statistical daily accrual (the reservations
// precedent): the accrual models the day's crowd; these are the sales that
// happen in front of you. Counters here are session-flavor; the money is
// real (addRevenue → ledger → closeBooks like everything else).

import { t } from '../core/i18n.js';
import {
  ensureSalesTax,
  SALES_TAX_LINE,
  salesTaxOn,
  salesTaxRate,
} from './salesTax.js';
import { skuById } from '../data/shopItems.js';
import { shelfCapacity, skuDisplayIsPlaced } from './shop.js';
import {
  INVENTORY_STAGE,
  allocationsForHeldUnit,
  forgetHeldAllocations,
  moveInventory,
  rememberHeldAllocations,
} from './inventoryLifecycle.js';
import {
  bindCheckoutPriceAuthority,
  checkoutTicketByTransaction,
  checkoutWalIsQuarantined,
  pendingCheckout,
  pendingCheckoutCount,
  prepareCheckoutInventory,
  preparePendingCheckout,
  reconcilePendingCheckout,
} from './checkoutSettlement.js';

// --- units in flight --------------------------------------------------------------
// A unit a shopper is carrying is off the shelf but not yet sold. That in-between
// used to be nowhere at all: `pickFromShelf` debited the shelf and the unit simply
// stopped existing until the shopper was either served or deleted. In memory that
// was fine, because `removeCustomer` put it back. On DISK it was a hole — the
// day-rollover autosave (main.js) snapshots `state` live, so a save taken while
// someone was at the counter persisted the missing stock but not the pending sale,
// and reloading destroyed the units outright.
//
// So "in a shopper's hands" is now a real, saved location. `shop.held` is the
// ledger, `recoverCheckout` is what a reload does with it.

export function heldUnits(state) {
  if (!state.shop.held) state.shop.held = [];
  return state.shop.held;
}

function priorCustomerPick(state, uid) {
  return state.shop?.inventoryLifecycle?.operations?.[`customer-pick:${uid}`] || null;
}

function allocateHeldUid(state) {
  state.shop.nextHeldId = Number.isSafeInteger(state.shop.nextHeldId)
    && state.shop.nextHeldId > 0
    ? state.shop.nextHeldId
    : 1;
  const held = heldUnits(state);
  let uid;
  do {
    uid = `anonymous-${state.shop.nextHeldId++}`;
  } while (held.some((unit) => unit.uid === uid) || priorCustomerPick(state, uid));
  return uid;
}

export function pickFromShelf(state, skuId, uid = null) {
  const inv = state.shop.inventory[skuId];
  if (!inv || inv.shelf <= 0) return { ok: false, reason: 'Nothing on the display.' };
  if (!skuDisplayIsPlaced(state, skuId)) return { ok: false, reason: 'That display is stored.' };
  const heldUid = uid || allocateHeldUid(state);
  if (heldUnits(state).some((unit) => unit.uid === heldUid)) {
    return { ok: false, reason: 'This product is already being held.' };
  }
  // A physical unit identity is single-use. The lifecycle operation journal is
  // deliberately persisted across reloads, so reusing a renderer-local UID
  // would replay the old lot movement while the shelf/held projections changed
  // a second time. Reject it before touching either projection.
  if (priorCustomerPick(state, heldUid)) {
    return { ok: false, reason: 'This product identity was already used.' };
  }
  const moved = moveInventory(state, {
    from: INVENTORY_STAGE.SHELF,
    to: INVENTORY_STAGE.CUSTOMER_HELD,
    skuId,
    quantity: 1,
    referenceId: `customer-pick:${heldUid}`,
    reason: `Customer ${heldUid} picked up product`,
  });
  if (!moved.ok) return moved;
  inv.shelf -= 1;
  heldUnits(state).push({ uid: heldUid, skuId });
  rememberHeldAllocations(state, heldUid, moved.allocations);
  return { ok: true, uid: heldUid };
}

export function returnToShelf(state, skuId, uid = null) {
  const inv = state.shop.inventory[skuId];
  if (!inv) return { ok: false };
  const held = heldUnits(state);
  const i = uid
    ? held.findIndex((entry) => entry.uid === uid)
    : held.findIndex((entry) => entry.skuId === skuId && String(entry.uid).startsWith('anonymous-'));
  if (i < 0) return { ok: false, reason: 'That product is not customer-held.' };
  const entry = held[i];
  const sku = skuById(skuId);
  if (!sku) return { ok: false };
  const cap = shelfCapacity(sku);
  // A held unit still belongs to the shop even when its display was refilled
  // while the customer had it. Fill the real fixture first, then preserve the
  // overflow in back stock instead of silently deleting it at the capacity cap.
  const toShelf = skuDisplayIsPlaced(state, skuId) && inv.shelf < cap;
  const moved = moveInventory(state, {
    from: INVENTORY_STAGE.CUSTOMER_HELD,
    to: toShelf ? INVENTORY_STAGE.SHELF : INVENTORY_STAGE.RESERVE,
    skuId,
    quantity: 1,
    allocations: allocationsForHeldUnit(state, entry.uid),
    referenceId: `customer-return:${entry.uid}`,
    reason: `Customer ${entry.uid} abandoned purchase`,
  });
  if (!moved.ok) return moved;
  if (toShelf) inv.shelf += 1;
  else inv.back = (inv.back || 0) + 1;
  held.splice(i, 1);
  forgetHeldAllocations(state, entry.uid);
  return { ok: true, location: toShelf ? 'shelf' : 'back' };
}

// the unit left the building in a paid-for bag: it is gone from the shelf and gone
// from the held ledger, and that is the ONLY way a held unit is allowed to vanish
export function consumeHeld(state, uid, skuId = null) {
  const held = heldUnits(state);
  const i = uid
    ? held.findIndex((entry) => entry.uid === uid)
    : held.findIndex((entry) => entry.skuId === skuId && String(entry.uid).startsWith('anonymous-'));
  if (i < 0) return false;
  const entry = held[i];
  const moved = moveInventory(state, {
    from: INVENTORY_STAGE.CUSTOMER_HELD,
    to: INVENTORY_STAGE.SOLD,
    skuId: entry.skuId,
    quantity: 1,
    allocations: allocationsForHeldUnit(state, entry.uid),
    referenceId: `checkout-sale:${entry.uid}`,
    reason: `Paid checkout for ${entry.uid}`,
  });
  if (!moved.ok) return false;
  held.splice(i, 1);
  forgetHeldAllocations(state, entry.uid);
  return true;
}

function allocationBatchForHeld(state, entries) {
  const allocations = [];
  for (const entry of entries) {
    const heldAllocations = allocationsForHeldUnit(state, entry.uid);
    if (!Array.isArray(heldAllocations) || heldAllocations.length === 0) {
      return { ok: false, reason: 'Checkout inventory provenance is incomplete.' };
    }
    for (const allocation of heldAllocations) {
      if (
        !allocation
        || typeof allocation !== 'object'
        || typeof allocation.lotId !== 'string'
        || !allocation.lotId
        || !Number.isFinite(allocation.quantity)
        || allocation.quantity <= 0
      ) {
        return { ok: false, reason: 'Checkout inventory provenance is incomplete.' };
      }
      allocations.push(allocation);
    }
  }
  const allocated = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  if (allocated !== entries.length) {
    return { ok: false, reason: 'Checkout inventory provenance is incomplete.' };
  }
  return { ok: true, allocations };
}

function validatedCheckoutBatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: 'The sale has no held products.' };
  }
  const seen = new Set();
  const pairs = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Every sold product needs a held UID and SKU.',
      };
    }
    if (typeof item.uid !== 'string' || !item.uid.trim()) {
      return { ok: false, reason: 'Every sold product needs a held UID.' };
    }
    if (typeof item.skuId !== 'string' || !item.skuId.trim()) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: `Held UID ${item.uid} needs a SKU.`,
      };
    }
    if (seen.has(item.uid)) {
      return { ok: false, reason: `Held UID ${item.uid} appears twice in the sale.` };
    }
    seen.add(item.uid);
    pairs.push([item.uid, item.skuId]);
  }
  pairs.sort((left, right) => {
    if (left[0] < right[0]) return -1;
    if (left[0] > right[0]) return 1;
    if (left[1] < right[1]) return -1;
    if (left[1] > right[1]) return 1;
    return 0;
  });
  return { ok: true, pairs };
}

function checkoutBatchReference(validated, transactionId = null) {
  return `checkout-sale-batch:v2:${JSON.stringify({
    transactionId: transactionId == null ? null : String(transactionId),
    items: validated.pairs,
  })}`;
}

function validatePriorCheckoutMove(state, priorMove, validated) {
  const expectedCount = validated.pairs.length;
  if (
    !priorMove
    || typeof priorMove !== 'object'
    || priorMove.ok !== true
    || priorMove.from !== INVENTORY_STAGE.CUSTOMER_HELD
    || priorMove.to !== INVENTORY_STAGE.SOLD
    || priorMove.moved !== expectedCount
    || !Array.isArray(priorMove.allocations)
    || priorMove.allocations.length === 0
  ) {
    return {
      ok: false,
      reason: t('checkout.integrityUnavailable'),
      diagnostic: 'Checkout inventory replay checkpoint is corrupt.',
    };
  }

  const expectedSkuQuantities = new Map();
  for (const [, skuId] of validated.pairs) {
    expectedSkuQuantities.set(skuId, (expectedSkuQuantities.get(skuId) || 0) + 1);
  }
  const actualSkuQuantities = new Map();
  const lots = new Map(
    (state?.shop?.inventoryLifecycle?.lots || []).map((lot) => [lot?.id, lot]),
  );
  let allocated = 0;
  for (const allocation of priorMove.allocations) {
    if (
      !allocation
      || typeof allocation !== 'object'
      || typeof allocation.lotId !== 'string'
      || !allocation.lotId
      || !Number.isSafeInteger(allocation.quantity)
      || allocation.quantity <= 0
    ) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Checkout inventory replay checkpoint is corrupt.',
      };
    }
    const lot = lots.get(allocation.lotId);
    if (!lot || typeof lot.skuId !== 'string' || !lot.skuId) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Checkout inventory replay checkpoint is corrupt.',
      };
    }
    allocated += allocation.quantity;
    actualSkuQuantities.set(
      lot.skuId,
      (actualSkuQuantities.get(lot.skuId) || 0) + allocation.quantity,
    );
  }
  if (allocated !== expectedCount || actualSkuQuantities.size !== expectedSkuQuantities.size) {
    return {
      ok: false,
      reason: t('checkout.integrityUnavailable'),
      diagnostic: 'Checkout inventory replay checkpoint is corrupt.',
    };
  }
  for (const [skuId, quantity] of expectedSkuQuantities) {
    if (actualSkuQuantities.get(skuId) !== quantity) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Checkout inventory replay checkpoint is corrupt.',
      };
    }
  }
  for (const allocation of priorMove.allocations) {
    const lot = lots.get(allocation.lotId);
    if (Number(lot?.buckets?.[INVENTORY_STAGE.SOLD] || 0) < allocation.quantity) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'Checkout inventory replay checkpoint is corrupt.',
      };
    }
  }
  return { ok: true };
}

// Consume a finished basket as one checked operation. `completeSale` must never
// bank first and then discover that one of its product UIDs was already returned,
// duplicated in the basket, or belongs to another SKU. Validate the whole set
// before removing anything, then splice from the end so indices stay stable.
export function consumeHeldBatch(state, items, transactionId = null) {
  const validated = validatedCheckoutBatch(items);
  if (!validated.ok) return validated;
  const referenceId = checkoutBatchReference(validated, transactionId);
  const held = Array.isArray(state?.shop?.held) ? state.shop.held : [];
  // A checkout helper can be interrupted after the lifecycle transfer but
  // before it removes the renderer-facing held rows. The lifecycle operation
  // is already idempotent on this exact UID batch; finish only that projection
  // on retry instead of treating already-sold stock as a new shortage.
  const priorMove = state?.shop?.inventoryLifecycle?.operations?.[referenceId];
  if (priorMove !== undefined) {
    const checkpoint = validatePriorCheckoutMove(state, priorMove, validated);
    if (!checkpoint.ok) return checkpoint;

    // Missing rows are expected after an interruption that happened partway
    // through the held-ledger projection. Validate every row first, so a late
    // duplicate or SKU mismatch cannot leave an earlier row removed.
    const indices = [];
    const liveEntries = [];
    for (const [uid, skuId] of validated.pairs) {
      const matches = [];
      for (let index = 0; index < held.length; index += 1) {
        if (held[index]?.uid === uid) matches.push(index);
      }
      if (matches.length > 1) {
        return {
          ok: false,
          reason: t('checkout.integrityUnavailable'),
          diagnostic: `Held UID ${uid} is ambiguous in inventory.`,
        };
      }
      if (matches.length === 1) {
        const index = matches[0];
        if (held[index]?.skuId !== skuId) {
          return {
            ok: false,
            reason: t('checkout.integrityUnavailable'),
            diagnostic: `Held UID ${uid} does not match ${skuId}.`,
          };
        }
        indices.push(index);
        liveEntries.push(held[index]);
      }
    }

    // If renderer-facing rows still exist, their exact lot ownership must be
    // part of the already-committed movement. SKU totals alone are insufficient:
    // two same-SKU lots are distinct conservation authorities.
    if (liveEntries.length > 0) {
      const liveAllocations = allocationBatchForHeld(state, liveEntries);
      if (!liveAllocations.ok) return liveAllocations;
      const priorTotals = new Map();
      for (const allocation of priorMove.allocations) {
        priorTotals.set(allocation.lotId, (priorTotals.get(allocation.lotId) || 0) + allocation.quantity);
      }
      const liveTotals = new Map();
      for (const allocation of liveAllocations.allocations) {
        liveTotals.set(
          allocation.lotId,
          (liveTotals.get(allocation.lotId) || 0) + allocation.quantity,
        );
      }
      const covered = [...liveTotals].every(([lotId, quantity]) => (
        (priorTotals.get(lotId) || 0) >= quantity
      ));
      if (!covered) {
        return {
          ok: false,
          reason: t('checkout.integrityUnavailable'),
          diagnostic: 'Checkout inventory replay checkpoint is corrupt.',
        };
      }
    }

    indices.sort((a, b) => b - a);
    for (const index of indices) held.splice(index, 1);
    // Allocation ownership belongs to the completed lifecycle move, even if a
    // previous attempt already removed the matching renderer-facing held row.
    for (const [uid] of validated.pairs) forgetHeldAllocations(state, uid);
    return {
      ...priorMove,
      ok: true,
      consumed: validated.pairs.length,
      projectedRowsRemoved: indices.length,
      recovered: true,
      referenceId,
    };
  }

  const indices = [];
  for (const [uid, skuId] of validated.pairs) {
    const matches = [];
    for (let i = 0; i < held.length; i += 1) {
      if (held[i]?.uid === uid) matches.push(i);
    }
    if (matches.length === 0) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: `Held UID ${uid} is no longer available.`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: `Held UID ${uid} is ambiguous in inventory.`,
      };
    }
    const index = matches[0];
    if (held[index]?.skuId !== skuId) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: `Held UID ${uid} does not match ${skuId}.`,
      };
    }
    indices.push(index);
  }

  const selected = indices.map((index) => held[index]);
  const allocationBatch = allocationBatchForHeld(state, selected);
  if (!allocationBatch.ok) return allocationBatch;
  const { allocations } = allocationBatch;
  const sold = moveInventory(state, {
    from: INVENTORY_STAGE.CUSTOMER_HELD,
    to: INVENTORY_STAGE.SOLD,
    quantity: selected.length,
    allocations,
    referenceId,
    reason: `Paid checkout for ${selected.map((entry) => entry.uid).join(', ')}`,
  });
  if (!sold.ok) return sold;

  indices.sort((a, b) => b - a);
  for (const index of indices) {
    const [entry] = held.splice(index, 1);
    if (entry) forgetHeldAllocations(state, entry.uid);
  }
  return { ok: true, consumed: indices.length, recovered: false, referenceId };
}

// A reload lands here. Every customer in the building is gone — they live in the
// renderer, not in `state` — so anything they were holding has to go back on the
// shelf. No money moved, so none is unwound. Idempotent: loading twice does not
// mint a second copy of the stock.
export function recoverCheckout(state) {
  const held = heldUnits(state);
  if (!held.length) return { returned: 0 };
  if (checkoutWalIsQuarantined(state)) {
    return {
      returned: 0,
      quarantined: true,
      remaining: held.length,
      reason: t('checkout.integrityUnavailable'),
      diagnostic: 'Held checkout inventory is quarantined because its settlement journal is unavailable.',
    };
  }
  // Current customers are persisted simulation entities. Their cart and held
  // units survive together, so only recover legacy renderer-only or orphaned
  // inventory here; recoverCustomerSimulation will checkpoint real customers.
  const persistedCustomerUids = new Set(
    (state.shop?.customerSimulation?.active || [])
      .flatMap((customer) => (Array.isArray(customer.cart) ? customer.cart : []))
      .map((item) => item?.uid)
      .filter(Boolean),
  );
  // A prepared checkout is an irreversible commit decision, even if recovery
  // is temporarily blocked by a corrupt projection. Never return those exact
  // goods to the shelf while their durable settlement still owns them.
  const pendingSettlementUids = new Set(
    Object.values(state.shop?.pendingCheckouts || {})
      .flatMap((settlement) => (Array.isArray(settlement?.inventory?.entries)
        ? settlement.inventory.entries
        : []))
      .map((entry) => entry?.uid)
      .filter((uid) => typeof uid === 'string' && uid),
  );
  let returned = 0;
  let shelf = 0;
  let back = 0;
  for (const h of held.slice()) {
    if (persistedCustomerUids.has(h.uid) || pendingSettlementUids.has(h.uid)) continue;
    const res = returnToShelf(state, h.skuId, h.uid);
    if (!res.ok) continue;
    returned += 1;
    if (res.location === 'shelf') shelf += 1;
    else back += 1;
  }
  return { returned, shelf, back, remaining: heldUnits(state).length };
}

export function liveSales(state) {
  if (!state.shop.salesLive) state.shop.salesLive = { units: 0, revenue: 0 };
  return state.shop.salesLive;
}

// --- payment: what happens once everything is scanned -----------------------------
// The customer presents cash (real bills, real change) or a card (which can
// decline and retry). Relaxed refuses a wrong count so nobody loses money;
// Realistic accepts it and the till comes up short.

export const DENOMS = [20, 10, 5, 1];

// what a person actually hands over: the next clean bill amount above the total
export function cashTender(total, rng = Math.random) {
  const t = Math.ceil(total);
  if (t % 20 === 0) return t;
  // most people round up to a stack of twenties; some hand closer-to-exact bills
  if (rng() < 0.7) return Math.ceil(t / 20) * 20;
  for (const d of [10, 5, 1]) {
    const up = Math.ceil(t / d) * d;
    if (up >= t) return up;
  }
  return t;
}

export function startPayment(total, mode = 'relaxed', rng = Math.random) {
  const method = rng() < 0.35 ? 'card' : 'cash';
  return {
    total,
    mode,
    method,
    tendered: method === 'cash' ? cashTender(total, rng) : null,
    stage: method === 'cash' ? 'change' : 'card',
    declines: 0,
    rng,
  };
}

export function changeDue(tx) {
  return tx.method === 'cash' ? Math.max(0, (tx.tendered || 0) - tx.total) : 0;
}

// the player hands back `amount`. Correct → receipt. Wrong → Relaxed keeps the
// drawer open for a recount; Realistic completes and records what the till lost.
export function giveChange(tx, amount) {
  if (tx.stage !== 'change') return { ok: false, reason: 'No change due.' };
  const due = changeDue(tx);
  const diff = Math.round((amount - due) * 100) / 100;
  if (diff === 0) {
    tx.stage = 'receipt';
    return { ok: true, lost: 0 };
  }
  if (tx.mode === 'relaxed') {
    return { ok: false, reason: diff > 0 ? 'Too much - count it again.' : 'Not enough - count it again.' };
  }
  tx.stage = 'receipt';
  return { ok: true, lost: diff }; // + overpaid the customer, − shorted them
}

// one terminal attempt: ~6% declines; a declined card retries clean
export function processCard(tx) {
  if (tx.stage !== 'card' && tx.stage !== 'declined') return { approved: false, reason: 'No card out.' };
  const roll = tx.rng ? tx.rng() : Math.random();
  if (tx.stage === 'card' && roll < 0.06) {
    tx.stage = 'declined';
    tx.declines += 1;
    return { approved: false, declined: true };
  }
  tx.stage = 'receipt';
  return { approved: true };
}


const checkoutRound2 = (value) => Math.round(Number(value) * 100) / 100;

function directTicketNumber(state) {
  const history = state?.shop?.transactionHistory;
  const persistedNext = Number(state?.shop?.nextTransactionNo);
  if (!Array.isArray(history) || !Number.isSafeInteger(persistedNext) || persistedNext < 1) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket authority is unavailable.' };
  }
  let greatest = 0;
  for (const ticket of history) {
    const number = Number(ticket?.number);
    if (!(number > 0)) continue;
    if (!Number.isSafeInteger(number)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket history contains an invalid number.' };
    }
    greatest = Math.max(greatest, number);
  }
  const ticketNumber = Math.max(greatest + 1, persistedNext);
  if (!Number.isSafeInteger(ticketNumber) || !Number.isSafeInteger(ticketNumber + 1)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket counter has reached its safe limit.' };
  }
  return { ok: true, ticketNumber };
}

function directTicketMatches(ticket, { id, customer, items, saleRevenue, saleTax, taxRate, ticketTotal }) {
  if (!ticket || ticket.checkoutKind !== 'direct' || ticket.transactionId !== id
      || ticket.customer !== customer || ticket.method !== 'card'
      || checkoutRound2(ticket.total) !== ticketTotal
      || checkoutRound2(ticket.net) !== saleRevenue
      || checkoutRound2(ticket.tax || 0) !== saleTax
      || checkoutRound2(ticket.taxRate || 0) !== checkoutRound2(taxRate)
      || !Array.isArray(ticket.items) || ticket.items.length !== items.length) return false;
  return ticket.items.every((ticketItem, index) => {
    const item = items[index];
    return ticketItem?.skuId === item.skuId
      && checkoutRound2(ticketItem.price) === checkoutRound2(item.price)
      && (!item.uid || ticketItem.uid === item.uid);
  });
}

function appendDirectLog(state, message) {
  try {
    if (!Array.isArray(state.shop.log)) state.shop.log = [];
    if (state.shop.log[0] !== message) state.shop.log.unshift(message);
    if (state.shop.log.length > 8) state.shop.log.length = 8;
  } catch {
    // Flavor text is not settlement authority.
  }
}

function advanceGeneratedCheckoutId(state, sequence) {
  const next = sequence + 1;
  if (Number.isSafeInteger(next)
      && (!Number.isSafeInteger(state.shop.nextTransactionId)
        || state.shop.nextTransactionId < next)) {
    state.shop.nextTransactionId = next;
  }
}

function nextGeneratedCheckoutId(state, propertyId) {
  let sequence = Number.isSafeInteger(state.shop.nextTransactionId)
    && state.shop.nextTransactionId > 0 ? state.shop.nextTransactionId : 1;
  const prefix = `${propertyId}:legacy-register-`;
  for (const ticket of state.shop.transactionHistory || []) {
    if (ticket?.checkoutKind !== 'direct' || ticket.generatedTransactionId !== true
        || typeof ticket.transactionId !== 'string'
        || !ticket.transactionId.startsWith(prefix)) continue;
    const prior = Number(ticket.transactionId.slice(prefix.length));
    if (Number.isSafeInteger(prior) && prior > 0 && Number.isSafeInteger(prior + 1)) {
      sequence = Math.max(sequence, prior + 1);
    }
  }
  return sequence;
}

function directResult(state, ticket, recovered = false) {
  const saleKey = ticket.ledgerIdempotencyKeys?.sale || `checkout:${ticket.transactionId}:sale`;
  return {
    ok: true,
    ...(recovered ? { recovered: true } : {}),
    total: checkoutRound2(ticket.total),
    goods: checkoutRound2(ticket.net),
    net: checkoutRound2(ticket.net),
    tax: checkoutRound2(ticket.tax || 0),
    transactionId: ticket.transactionId,
    ledgerEntryId: ticket.ledgerEntryIds?.sale || state.ledger?.processedIds?.[saleKey] || null,
  };
}

export function checkoutSale(state, items, who = 'A customer', transactionId = null, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: 'Nothing to ring up.' };
  if (!state?.shop || !state?.ledger || !Number.isFinite(state.cash)) {
    return { ok: false, reason: 'The club books are not available.' };
  }
  if (checkoutWalIsQuarantined(state)) {
    return { ok: false, quarantined: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The shop checkout journal is quarantined.' };
  }
  if (items.some((item) => !item || typeof item.skuId !== 'string' || !item.skuId
      || !Number.isFinite(item.price) || item.price <= 0)) {
    return { ok: false, reason: 'Every checkout item needs a SKU and positive finite price.' };
  }

  const customer = String(who);
  const itemTotal = checkoutRound2(items.reduce((sum, item) => sum + item.price, 0));
  const saleRevenue = checkoutRound2(options.total ?? itemTotal);
  const discountAmount = checkoutRound2(itemTotal - saleRevenue);
  if (!Number.isFinite(saleRevenue) || saleRevenue <= 0
      || !Number.isFinite(discountAmount) || discountAmount < 0) {
    return { ok: false, reason: 'Checkout total must be positive and finite.' };
  }
  const taxRate = Math.round((Number.isFinite(Number(options.taxRate))
    ? Math.max(0, Number(options.taxRate)) : salesTaxRate(state)) * 100000) / 100000;
  const canonicalTax = salesTaxOn(saleRevenue, taxRate);
  const saleTax = Number.isFinite(Number(options.tax))
    ? checkoutRound2(Number(options.tax)) : canonicalTax;
  const ticketTotal = checkoutRound2(saleRevenue + saleTax);
  if (!Number.isFinite(saleTax) || saleTax < 0 || saleTax !== canonicalTax
      || !Number.isFinite(ticketTotal) || ticketTotal <= 0) {
    return { ok: false, reason: 'Checkout tax and total must be non-negative finite amounts.' };
  }

  const generated = transactionId == null;
  const propertyId = state.property?.id || `club-${state.seed}`;
  const nextTransactionId = generated
    ? nextGeneratedCheckoutId(state, propertyId)
    : (Number.isSafeInteger(state.shop.nextTransactionId)
      && state.shop.nextTransactionId > 0 ? state.shop.nextTransactionId : 1);
  const id = generated
    ? `${propertyId}:legacy-register-${nextTransactionId}`
    : String(transactionId);
  if (!id) return { ok: false, reason: 'Checkout needs a stable transaction identity.' };
  const expected = { id, customer, items, saleRevenue, saleTax, taxRate, ticketTotal };
  const settlementId = `checkout:${id}`;

  const pending = pendingCheckout(state, settlementId);
  if (pending) {
    if (!directTicketMatches(pending.ticketDraft, expected)) {
      return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending direct sale does not match this checkout.' };
    }
    const resumed = reconcilePendingCheckout(state, settlementId, {
      qaFaultAfterInventory: options.qaFaultAfterInventory,
      qaFaultAfterCoreCommit: options.qaFaultAfterCoreCommit,
    });
    if (!resumed.ok) return resumed;
    if (resumed.pendingTail) {
      return { ok: false, pending: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The direct sale has a pending durable projection.' };
    }
    if (generated) advanceGeneratedCheckoutId(state, nextTransactionId);
    appendDirectLog(state, `${customer} bought ${resumed.ticket.items.map((item) => item.name).join(' + ')} at the counter (${Math.round(ticketTotal)} dollars)`);
    return directResult(state, resumed.ticket, true);
  }

  const matchingTickets = (Array.isArray(state.shop.transactionHistory)
    ? state.shop.transactionHistory : []).filter((ticket) => ticket?.transactionId === id);
  if (matchingTickets.length > 1) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'That checkout identity has ambiguous ticket provenance.' };
  }
  const existing = checkoutTicketByTransaction(state, id);
  if (existing) {
    if (!directTicketMatches(existing, expected)) {
      return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'That checkout identity belongs to a different ticket.' };
    }
    // A history row is a publication projection, not recovery authority. A
    // genuine interrupted settlement still has its WAL until reconciliation;
    // after the WAL is retired, repeat calls are closed duplicates. This also
    // prevents a forged ticket from claiming that money, stock, tax, COGS,
    // analytics, and outcome were durably committed together.
    return { ok: false, reason: 'Already banked.', duplicate: true, transactionId: id };
  }
  if (pendingCheckoutCount(state) > 0) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Resolve the pending register settlement before banking another sale.' };
  }

  const heldMatches = [];
  const available = heldUnits(state).slice();
  for (const item of items) {
    const index = item.uid
      ? available.findIndex((entry) => entry.uid === item.uid)
      : available.findIndex((entry) => entry.skuId === item.skuId
        && String(entry.uid).startsWith('anonymous-'));
    if (index < 0) {
      heldMatches.push(null);
      continue;
    }
    const held = available[index];
    if (held.skuId !== item.skuId) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${held.uid} does not match ${item.skuId}.` };
    }
    heldMatches.push(available.splice(index, 1)[0]);
  }
  if (heldMatches.some((held) => !held)) {
    return { ok: false, reason: 'Every checkout item must still be held by this customer.' };
  }
  const goodsLines = items.map((item, index) => ({
    uid: heldMatches[index].uid,
    skuId: item.skuId,
    name: skuById(item.skuId)?.name || item.skuId,
    price: item.price,
  }));
  const pricing = {
    goodsSubtotal: itemTotal,
    discountAmount,
    saleRevenue,
    taxRate,
    tax: saleTax,
    serviceTotal: 0,
    total: ticketTotal,
  };
  const priceAuthority = bindCheckoutPriceAuthority(state, goodsLines, id, pricing);
  if (!priceAuthority.ok) return priceAuthority;
  const inventoryPlan = prepareCheckoutInventory(
    state,
    goodsLines,
    id,
    priceAuthority.authority,
  );
  if (!inventoryPlan.ok) return inventoryPlan;

  const minute = Number.isFinite(state.clock?.minutes) ? Math.round(state.clock.minutes) : 0;
  const day = Math.floor(minute / 1440);
  const saleKey = `checkout:${id}:sale`;
  const taxKey = `checkout:${id}:salestax`;
  const cogsKey = `checkout:${id}:cogs`;
  const metadata = options.metadata && typeof options.metadata === 'object'
    && !Array.isArray(options.metadata) ? options.metadata : {};
  const postings = [{ component: 'sale', spec: {
    strictIdentity: true,
    idempotencyKey: saleKey,
    relatedId: id,
    direction: 'revenue',
    lineKey: 'shopSales',
    category: 'shopSales',
    amount: saleRevenue,
    day,
    timestamp: minute,
    description: `Register sale - ${customer}`,
    source: 'checkout',
    units: goodsLines.length,
    customerCount: 1,
    metadata: { skuIds: goodsLines.map((item) => item.skuId), ...metadata, tax: saleTax, taxRate, ticketTotal },
  } }];
  if (saleTax > 0) postings.push({ component: 'sales-tax', spec: {
    strictIdentity: true,
    idempotencyKey: taxKey,
    relatedId: id,
    direction: 'revenue',
    lineKey: SALES_TAX_LINE,
    category: SALES_TAX_LINE,
    accountingClass: 'liability',
    profitImpact: 0,
    aggregate: null,
    amount: saleTax,
    day,
    timestamp: minute,
    description: `Sales tax collected - ${customer}`,
    source: 'checkout',
    customerCount: 1,
    metadata: { taxRate, ticketTotal },
  } });
  const goodsCost = checkoutRound2(goodsLines.reduce(
    (sum, item) => sum + (skuById(item.skuId)?.cost || 0), 0,
  ));
  if (goodsCost > 0) postings.push({ component: 'cogs', spec: {
    strictIdentity: true,
    idempotencyKey: cogsKey,
    relatedId: id,
    direction: 'expense',
    lineKey: 'costOfGoods',
    category: 'costOfGoods',
    accountingClass: 'cogs',
    cashImpact: 0,
    aggregate: null,
    amount: goodsCost,
    day,
    timestamp: minute,
    description: `Cost of goods - ${customer}`,
    source: 'checkout',
    units: goodsLines.length,
    metadata: { skuIds: goodsLines.map((item) => item.skuId) },
  } });

  const numbered = directTicketNumber(state);
  if (!numbered.ok) return numbered;
  const ledgerEntryIds = Object.fromEntries(postings.map((posting) => [
    posting.component, `le:${propertyId}:${posting.spec.idempotencyKey}`,
  ]));
  const ledgerIdempotencyKeys = Object.fromEntries(postings.map((posting) => [
    posting.component, posting.spec.idempotencyKey,
  ]));
  const ticket = {
    checkoutKind: 'direct',
    generatedTransactionId: generated,
    number: numbered.ticketNumber,
    transactionId: id,
    customer,
    method: 'card',
    total: ticketTotal,
    net: saleRevenue,
    tax: saleTax,
    taxRate,
    pricing: {
      version: 1,
      ...pricing,
    },
    cash: ticketTotal,
    lost: 0,
    items: goodsLines,
    ledgerEntryIds,
    ledgerIdempotencyKeys,
    minute,
  };

  const perSku = {};
  for (const item of goodsLines) perSku[item.skuId] = (perSku[item.skuId] || 0) + 1;
  const salesBefore = {
    units: state.shop.salesLive?.units ?? 0,
    revenue: state.shop.salesLive?.revenue ?? 0,
    perSku: Object.fromEntries(Object.keys(perSku).map((skuId) => [skuId, state.shop.salesToday?.[skuId] ?? 0])),
  };
  const projections = [{
    id: `checkout:${id}:sales-projection`,
    kind: 'sales',
    delta: { units: goodsLines.length, revenue: saleRevenue, perSku },
    before: salesBefore,
    after: {
      units: salesBefore.units + goodsLines.length,
      revenue: checkoutRound2(salesBefore.revenue + saleRevenue),
      perSku: Object.fromEntries(Object.entries(perSku).map(([skuId, quantity]) => [skuId, salesBefore.perSku[skuId] + quantity])),
    },
  }];
  if (saleTax > 0) {
    const tax = ensureSalesTax(state);
    const taxBefore = { collected: tax.collected, owed: tax.owed, taxableSales: tax.taxableSales };
    projections.push({
      id: `checkout:${id}:tax-projection`,
      kind: 'tax',
      delta: { collected: saleTax, owed: saleTax, taxableSales: saleRevenue },
      before: taxBefore,
      after: {
        collected: checkoutRound2(taxBefore.collected + saleTax),
        owed: checkoutRound2(taxBefore.owed + saleTax),
        taxableSales: checkoutRound2(taxBefore.taxableSales + saleRevenue),
      },
    });
  }
  const outcomeSpec = {
    idempotencyKey: `checkout:${id}:completed`,
    type: 'checkoutCompleted',
    count: 1,
    amount: ticketTotal,
    day,
    timestamp: minute,
    relatedId: id,
    reason: `${customer} completed a register purchase with ${goodsLines.length} item${goodsLines.length === 1 ? '' : 's'}.`,
    metadata: { units: goodsLines.length, method: 'card' },
  };
  const prepared = preparePendingCheckout(state, {
    settlementId,
    ticketNumber: numbered.ticketNumber,
    ticketKey: { kind: 'transaction', transactionId: id },
    alternateTicketKeys: [],
    ticketDraft: ticket,
    inventory: inventoryPlan.inventory,
    drawer: null,
    postings,
    projections,
    outcomeSpec,
    reservationTarget: null,
  });
  if (!prepared.ok) return prepared;
  priceAuthority.commit();
  const settled = reconcilePendingCheckout(state, settlementId, {
    qaFaultAfterInventory: options.qaFaultAfterInventory,
    qaFaultAfterCoreCommit: options.qaFaultAfterCoreCommit,
  });
  if (!settled.ok) return settled;
  if (settled.pendingTail) {
    return { ok: false, pending: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The direct sale has a pending durable projection.' };
  }
  if (generated) advanceGeneratedCheckoutId(state, nextTransactionId);
  appendDirectLog(state, `${customer} bought ${goodsLines.map((item) => item.name).join(' + ')} at the counter (${Math.round(ticketTotal)} dollars)`);
  return directResult(state, settled.ticket, prepared.already || settled.recovered);
}
