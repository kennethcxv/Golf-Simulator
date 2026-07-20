// LIVE CHECKOUT — the walk-in customers you can SEE pick real units off real
// shelves, and the player rings them through at the register. This is
// additive revenue on top of the statistical daily accrual (the reservations
// precedent): the accrual models the day's crowd; these are the sales that
// happen in front of you. Counters here are session-flavor; the money is
// real (addRevenue → ledger → closeBooks like everything else).

import { addRevenue } from './economy.js';
import { skuById } from '../data/shopItems.js';
import { shelfCapacity, skuDisplayIsPlaced } from './shop.js';

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
  if (!skuDisplayIsPlaced(state, skuId)) return { ok: false, reason: 'That display is stored.' };
  if (uid && heldUnits(state).some((unit) => unit.uid === uid)) {
    return { ok: false, reason: 'That held UID is already in use.' };
  }
  inv.shelf -= 1;
  if (uid) heldUnits(state).push({ uid, skuId });
  return { ok: true };
}

export function returnToShelf(state, skuId, uid = null) {
  const inv = state.shop.inventory[skuId];
  if (!inv) return { ok: false };
  const sku = skuById(skuId);
  if (!sku) return { ok: false };
  let heldIndex = -1;
  if (uid) {
    heldIndex = heldUnits(state).findIndex((h) => h.uid === uid && h.skuId === skuId);
    if (heldIndex < 0) return { ok: false, reason: 'That held unit is no longer available.' };
  }
  const cap = shelfCapacity(sku);
  // A held unit still belongs to the shop even when its display was refilled
  // while the customer had it. Fill the real fixture first, then preserve the
  // overflow in back stock instead of silently deleting it at the capacity cap.
  const location = skuDisplayIsPlaced(state, skuId) && inv.shelf < cap ? 'shelf' : 'back';
  inv[location] = (inv[location] || 0) + 1;
  if (uid) {
    heldUnits(state).splice(heldIndex, 1);
  }
  return { ok: true, location };
}

// the unit left the building in a paid-for bag: it is gone from the shelf and gone
// from the held ledger, and that is the ONLY way a held unit is allowed to vanish
export function consumeHeld(state, uid) {
  const held = heldUnits(state);
  const i = held.findIndex((h) => h.uid === uid);
  if (i < 0) return false;
  held.splice(i, 1);
  return true;
}

// Consume a finished basket as one checked operation. `completeSale` must never
// bank first and then discover that one of its product UIDs was already returned,
// duplicated in the basket, or belongs to another SKU. Validate the whole set
// before removing anything, then splice from the end so indices stay stable.
export function consumeHeldBatch(state, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: 'The sale has no held products.' };
  }

  const held = heldUnits(state);
  const seen = new Set();
  const indices = [];
  for (const item of items) {
    if (!item || typeof item.uid !== 'string' || !item.uid) {
      return { ok: false, reason: 'Every sold product needs a held UID.' };
    }
    if (seen.has(item.uid)) {
      return { ok: false, reason: `Held UID ${item.uid} appears twice in the sale.` };
    }
    seen.add(item.uid);
    const matches = [];
    for (let i = 0; i < held.length; i += 1) {
      if (held[i].uid === item.uid) matches.push(i);
    }
    if (matches.length === 0) {
      return { ok: false, reason: `Held UID ${item.uid} is no longer available.` };
    }
    if (matches.length > 1) {
      return { ok: false, reason: `Held UID ${item.uid} is ambiguous in inventory.` };
    }
    const index = matches[0];
    if (held[index].skuId !== item.skuId) {
      return { ok: false, reason: `Held UID ${item.uid} does not match ${item.skuId}.` };
    }
    indices.push(index);
  }

  indices.sort((a, b) => b - a);
  for (const index of indices) held.splice(index, 1);
  return { ok: true, consumed: indices.length };
}

// A reload lands here. Every customer in the building is gone — they live in the
// renderer, not in `state` — so anything they were holding has to go back on the
// shelf. No money moved, so none is unwound. Idempotent: loading twice does not
// mint a second copy of the stock.
export function recoverCheckout(state) {
  const held = heldUnits(state);
  if (!held.length) return { returned: 0 };
  let returned = 0;
  let shelf = 0;
  let back = 0;
  for (const h of held.slice()) {
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
  return { ok: true, total };
}
