// PHYSICAL DELIVERIES — the truck leaves BOXES, not numbers. Contents enter
// the backroom only when a box is opened; carrying is one box at a time.
// Headless like every sim module; the clubhouse renders THIS state.

import { skuById } from '../data/shopItems.js';

// how many units ride in one case, by category (big items ship near-solo)
export const CASE_SIZE = { clubs: 2, balls: 12, apparel: 8, accessories: 12, supplies: 1, decor: 1 };

export function initDeliveries(state) {
  state.shop.deliveries = { boxes: [], nextBoxId: 1, trash: 0 };
}

export function ensureDeliveries(state) {
  if (!state.shop) return;
  if (!state.shop.deliveries) initDeliveries(state);
}

export function boxesOf(state) {
  ensureDeliveries(state);
  return state.shop.deliveries.boxes;
}

// an order landed: split it into cases on the receiving pad
export function arriveOrder(state, order) {
  ensureDeliveries(state);
  const d = state.shop.deliveries;
  const sku = skuById(order.skuId);
  const per = CASE_SIZE[sku ? sku.cat : 'accessories'] || 12;
  let left = order.qty;
  while (left > 0) {
    const qty = Math.min(per, left);
    left -= qty;
    d.boxes.push({ id: d.nextBoxId++, skuId: order.skuId, qty, orderId: order.id, loc: 'pad', opened: false });
  }
}

export function carriedBox(state) {
  return boxesOf(state).find((b) => b.loc === 'carried') || null;
}

export function pickUpBox(state, id) {
  const boxes = boxesOf(state);
  const box = boxes.find((b) => b.id === id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (carriedBox(state)) return { ok: false, reason: 'Your arms are full — set that one down first.' };
  box.loc = 'carried';
  return { ok: true, box };
}

export function putDownBox(state, id, loc = 'stock') {
  const box = boxesOf(state).find((b) => b.id === id);
  if (!box || box.loc !== 'carried') return { ok: false, reason: 'Not carrying that.' };
  box.loc = loc === 'pad' ? 'pad' : 'stock';
  return { ok: true, box };
}

export function openBox(state, id) {
  const d = state.shop.deliveries;
  const box = d.boxes.find((b) => b.id === id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  const inv = state.shop.inventory[box.skuId];
  if (inv) inv.back += box.qty;
  d.boxes.splice(d.boxes.indexOf(box), 1);
  d.trash += 1;
  return { ok: true, skuId: box.skuId, qty: box.qty };
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

export function emptyTrash(state) {
  ensureDeliveries(state);
  if (state.shop.deliveries.trash <= 0) return { ok: false };
  state.shop.deliveries.trash = 0;
  return { ok: true };
}
