// YOUR HANDS, AND WHAT GOES ON WHAT.
//
// The missing link in the whole retail loop. Stock used to move from a box straight into
// `inventory.back` — a number — and from `inventory.back` straight onto a shelf, with one E press
// at each end. Nothing was ever carried. So steps 10, 11 and 12 of the brief ("Remove products or
// cases · Carry them to storage or sales fixtures · Stock the correct fixture") had no machinery
// at all, and "Enforce: hats on hat fixtures, balls on ball shelves" could not even be TESTED,
// because there was no way to be holding a hat in front of a ball shelf.
//
// So: a unit lives in exactly one of four places — in a box, IN YOUR HANDS, in the backroom, or on
// a shelf. Every verb here moves one from one place to another. None of them makes or unmakes one.
//
// The compatibility table is not a new table. It is FIXTURES[].skus (data/shopLayout.js), which
// already said what belongs on what — the shop just never asked. A second table would be a second
// truth, and the two would disagree the first time anyone moved a line to a different wall.

import { skuById, RETAIL_CATS } from '../data/shopItems.js';
import { FIXTURES } from '../data/shopLayout.js';
import { capacityOf, homeFixture } from '../data/fixtureSlots.js';

// how many of a thing you can hold at once. Not a number of items — a pair of arms.
const ARMFUL_CAT = {
  clubs: 2,
  balls: 6,
  // Two folded garments make the hero carton deplete through full, 3/4,
  // half, low and empty states while remaining a believable two-hand bundle.
  apparel: 2,
  accessories: 8,
  supplies: 1,
  decor: 1,
};
const ARMFUL_ID = {
  bag1: 1,       // a stand bag IS the carry
  irons1: 1, irons2: 1,
  shoe1: 3,
  range2: 4,
  umb1: 4,
  jacket2: 4,
};

export function armfulOf(sku) {
  if (!sku) return 6;
  return ARMFUL_ID[sku.id] || ARMFUL_CAT[sku.cat] || 6;
}

// --- what is in your hands ---------------------------------------------------------------------

export function carriedGoods(state) {
  return (state.shop && state.shop.carry) || null;
}

export function setCarry(state, skuId, qty) {
  if (qty <= 0) state.shop.carry = null;
  else state.shop.carry = { skuId, qty };
  return state.shop.carry;
}

// room left in your arms for this line (0 if you are holding something else)
export function armRoom(state, skuId) {
  const sku = skuById(skuId);
  const max = armfulOf(sku);
  const c = carriedGoods(state);
  if (!c) return max;
  if (c.skuId !== skuId) return 0;
  return Math.max(0, max - c.qty);
}

// --- where a thing belongs ----------------------------------------------------------------------

// the fixture that accepts this line. FIXTURES[].skus is the table; nothing else gets a vote.
export function homeOf(skuId) {
  return homeFixture(skuId);
}

export function fixtureById(id) {
  return FIXTURES.find((f) => f.id === id) || null;
}

export function accepts(fixture, skuId) {
  return !!fixture && fixture.skus.includes(skuId);
}

// --- putting it on the shelf ---------------------------------------------------------------------

// Stock a fixture from what is in your hands. `units` is how many to try — 1 for a tap, a big
// number for hold-to-stock, which the scene calls once per tick with a rate.
//
// Three ways this refuses, and each says something the player can act on:
//   - nothing in your hands
//   - the wrong fixture, and WHERE THE RIGHT ONE IS
//   - the shelf is full, and the leftovers STAY IN YOUR ARMS (the brief: "Retain leftovers")
export function stockFixture(state, fixtureId, units = 1) {
  const c = carriedGoods(state);
  if (!c) return { ok: false, reason: 'Your hands are empty.' };
  const f = fixtureById(fixtureId);
  if (!f) return { ok: false, reason: 'No fixture there.' };
  const sku = skuById(c.skuId);

  if (!accepts(f, c.skuId)) {
    const home = homeOf(c.skuId);
    const where = home ? `${sku.name} goes on the ${home.title.toLowerCase()}.` : `${sku.name} does not go on a shelf.`;
    return { ok: false, invalid: true, reason: `Not on the ${f.title.toLowerCase()} — ${where}` };
  }

  const inv = state.shop.inventory[c.skuId];
  const cap = capacityOf(c.skuId);
  const room = cap - inv.shelf;
  if (room <= 0) {
    return { ok: false, full: true, reason: `The ${f.title.toLowerCase()} is full — ${inv.shelf} of ${cap}.` };
  }

  const moved = Math.min(units, c.qty, room);
  inv.shelf += moved;
  setCarry(state, c.skuId, c.qty - moved);
  const left = carriedGoods(state);
  return {
    ok: true,
    moved,
    onShelf: inv.shelf,
    capacity: cap,
    full: inv.shelf >= cap,
    left: left ? left.qty : 0,
  };
}

// --- the backroom -----------------------------------------------------------------------------

// put what you are holding on the backroom shelving
export function storeInBack(state, units = 999) {
  const c = carriedGoods(state);
  if (!c) return { ok: false, reason: 'Your hands are empty.' };
  const moved = Math.min(units, c.qty);
  state.shop.inventory[c.skuId].back += moved;
  setCarry(state, c.skuId, c.qty - moved);
  const left = carriedGoods(state);
  return { ok: true, moved, left: left ? left.qty : 0 };
}

// take an armful back off the backroom shelving
export function takeFromBack(state, skuId, want = 999) {
  const inv = state.shop.inventory[skuId];
  if (!inv || inv.back <= 0) return { ok: false, reason: 'None of that in the back.' };
  const room = armRoom(state, skuId);
  if (room <= 0) {
    const c = carriedGoods(state);
    const holding = c && c.skuId !== skuId ? skuById(c.skuId) : null;
    return {
      ok: false,
      reason: holding ? `You are already carrying ${holding.name.toLowerCase()}.` : 'Your arms are full.',
    };
  }
  const taken = Math.min(want, room, inv.back);
  inv.back -= taken;
  const c = carriedGoods(state);
  setCarry(state, skuId, (c ? c.qty : 0) + taken);
  return { ok: true, taken, left: inv.back };
}

// --- weight -------------------------------------------------------------------------------------

// what is in your arms, in pounds. A box knows what it weighs (it is on the label).
export function carryWeight(state) {
  const boxes = (state.shop.deliveries && state.shop.deliveries.boxes) || [];
  const box = boxes.find((b) => b.loc === 'carried');
  if (box) {
    if (box.flat) return 2;                              // flattened cardboard weighs nothing
    const sku = skuById(box.skuId);
    const unit = (sku && sku.lb) || 0.5;
    return (box.lb != null ? box.lb - unit * ((box.cap || 0) - box.qty) : unit * box.qty + 1);
  }
  const c = carriedGoods(state);
  if (!c) return 0;
  const sku = skuById(c.skuId);
  return ((sku && sku.lb) || 0.5) * c.qty;
}

// How much a load slows you. A 124 lb lounge crate is a shuffle; a box of tees is nothing.
// Floored at 0.45 — you can always get where you are going, it just takes a while, which is the
// argument for a hand truck and for hiring someone.
export const CARRY_SLOW_LB = 140;
export const CARRY_SLOW_FLOOR = 0.45;

export function carrySpeedFactor(state) {
  const lb = carryWeight(state);
  if (lb <= 0) return 1;
  return Math.max(CARRY_SLOW_FLOOR, 1 - lb / CARRY_SLOW_LB);
}

// --- the shelf, for a label ----------------------------------------------------------------------

// everything a fixture prompt needs to say: name, what is out, what it holds, what is in the back
export function fixtureReadout(state, fixtureId) {
  const f = fixtureById(fixtureId);
  if (!f) return null;
  const lines = f.skus.filter((id) => RETAIL_CATS.has((skuById(id) || {}).cat)).map((id) => {
    const inv = state.shop.inventory[id] || { shelf: 0, back: 0 };
    return {
      skuId: id,
      name: skuById(id).name,
      shelf: inv.shelf,
      capacity: capacityOf(id),
      back: inv.back,
    };
  });
  return { fixture: f, lines };
}
