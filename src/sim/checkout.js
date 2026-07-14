// LIVE CHECKOUT — the walk-in customers you can SEE pick real units off real
// shelves, and the player rings them through at the register. This is
// additive revenue on top of the statistical daily accrual (the reservations
// precedent): the accrual models the day's crowd; these are the sales that
// happen in front of you. Counters here are session-flavor; the money is
// real (addRevenue → ledger → closeBooks like everything else).

import { addRevenue } from './economy.js';
import { skuById, SHELF_CAP } from '../data/shopItems.js';

export function pickFromShelf(state, skuId) {
  const inv = state.shop.inventory[skuId];
  if (!inv || inv.shelf <= 0) return { ok: false, reason: 'Nothing on the display.' };
  inv.shelf -= 1;
  return { ok: true };
}

export function returnToShelf(state, skuId) {
  const inv = state.shop.inventory[skuId];
  if (!inv) return { ok: false };
  const sku = skuById(skuId);
  const cap = sku ? SHELF_CAP[sku.cat] : 0;
  inv.shelf = Math.min(cap, inv.shelf + 1);
  return { ok: true };
}

export function liveSales(state) {
  if (!state.shop.salesLive) state.shop.salesLive = { units: 0, revenue: 0 };
  return state.shop.salesLive;
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
