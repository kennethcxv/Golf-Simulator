// LIVE CHECKOUT — the walk-in customers you can SEE pick real units off real
// shelves, and the player rings them through at the register. This is
// additive revenue on top of the statistical daily accrual (the reservations
// precedent): the accrual models the day's crowd; these are the sales that
// happen in front of you. Counters here are session-flavor; the money is
// real (addRevenue → ledger → closeBooks like everything else).

import { addRevenue } from './economy.js';
import { skuById, SHELF_CAP } from '../data/shopItems.js';
import { capacityOf } from '../data/fixtureSlots.js';
import {
  INVENTORY_STAGE,
  allocationsForHeldUnit,
  forgetHeldAllocations,
  moveInventory,
  rememberHeldAllocations,
} from './inventoryLifecycle.js';

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

export function pickFromShelf(state, skuId, uid = null) {
  const inv = state.shop.inventory[skuId];
  if (!inv || inv.shelf <= 0) return { ok: false, reason: 'Nothing on the display.' };
  state.shop.nextHeldId = Number.isSafeInteger(state.shop.nextHeldId) ? state.shop.nextHeldId : 1;
  const heldUid = uid || `anonymous-${state.shop.nextHeldId++}`;
  if (heldUnits(state).some((held) => held.uid === heldUid)) {
    return { ok: false, reason: 'This product is already being held.' };
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
  const cap = sku ? (capacityOf(skuId) || SHELF_CAP[sku.cat]) : 0;
  const toShelf = inv.shelf < cap;
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
  else inv.back += 1;
  held.splice(i, 1);
  forgetHeldAllocations(state, entry.uid);
  return { ok: true, location: toShelf ? 'shelf' : 'reserve' };
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

// A reload lands here. Every customer in the building is gone — they live in the
// renderer, not in `state` — so anything they were holding has to go back on the
// shelf. No money moved, so none is unwound. Idempotent: loading twice does not
// mint a second copy of the stock.
export function recoverCheckout(state) {
  const held = heldUnits(state);
  if (!held.length) return { returned: 0 };
  const n = held.length;
  for (const h of held.slice()) returnToShelf(state, h.skuId, h.uid);
  state.shop.held = [];
  return { returned: n };
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
    return { ok: false, reason: diff > 0 ? 'Too much — count it again.' : 'Not enough — count it again.' };
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

export function checkoutSale(state, items, who = 'A customer') {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: 'Nothing to ring up.' };
  const heldMatches = [];
  const available = heldUnits(state).slice();
  for (const item of items) {
    const index = item.uid
      ? available.findIndex((entry) => entry.uid === item.uid)
      : available.findIndex((entry) => entry.skuId === item.skuId && String(entry.uid).startsWith('anonymous-'));
    if (index >= 0) heldMatches.push(available.splice(index, 1)[0]);
    else heldMatches.push(null);
  }
  if (heldMatches.some((held) => !held)) {
    return { ok: false, reason: 'Every checkout item must still be held by this customer.' };
  }
  const allocations = heldMatches.flatMap((held) => allocationsForHeldUnit(state, held.uid));
  const allocated = allocations.reduce((sum, allocation) => sum + (allocation.quantity || 0), 0);
  if (allocated !== heldMatches.length) {
    return { ok: false, reason: 'Checkout inventory provenance is incomplete.' };
  }
  // One atomic ledger transfer covers mixed-SKU baskets. Revenue is recorded
  // only after this succeeds, so a stale or repeated checkout cannot be paid twice.
  const sold = moveInventory(state, {
    from: INVENTORY_STAGE.CUSTOMER_HELD,
    to: INVENTORY_STAGE.SOLD,
    quantity: heldMatches.length,
    allocations,
    referenceId: `checkout-sale-batch:${heldMatches.map((held) => held.uid).sort().join('|')}`,
    reason: `Paid checkout for ${heldMatches.map((held) => held.uid).join(', ')}`,
  });
  if (!sold.ok) return sold;
  const heldLedger = heldUnits(state);
  for (const held of heldMatches) {
    const index = heldLedger.findIndex((entry) => entry.uid === held.uid);
    if (index >= 0) heldLedger.splice(index, 1);
    forgetHeldAllocations(state, held.uid);
  }
  let total = 0;
  for (const it of items) total += it.price || 0;
  total = Math.round(total * 100) / 100;
  addRevenue(state, 'shopSales', total);
  const live = liveSales(state);
  live.units += items.length;
  live.revenue = Math.round((live.revenue + total) * 100) / 100;
  const names = items.map((i) => {
    const s = skuById(i.skuId);
    return s ? s.name : i.skuId;
  });
  state.shop.log.unshift(`${who} bought ${names.join(' + ')} at the counter (${Math.round(total)} dollars)`);
  if (state.shop.log.length > 8) state.shop.log.pop();
  for (let index = 0; index < items.length; index++) {
    state.shop.salesToday ||= {};
    state.shop.salesToday[items[index].skuId] = (state.shop.salesToday[items[index].skuId] || 0) + 1;
  }
  return { ok: true, total };
}
