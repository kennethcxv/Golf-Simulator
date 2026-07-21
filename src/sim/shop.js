// FAIRWAY STATE — pro shop simulation: inventory, supplier orders, pricing,
// daily shopper flow, fittings, and rentals. Headless like every sim module;
// the walkable 3D shop is a live window onto THIS state, never a second sim.
//
// Customers are deliberately reactive, not autonomous: how many come follows
// rounds played + members + reputation; what they buy follows what is actually
// on the shelves, how it's priced, and whether anyone is working the floor.

import { rngOf, clamp, makeRng } from '../core/utils.js';
import { calendarOf } from './time.js';
import { addRevenue, addExpense, unbill } from './economy.js';
import { SHOP_CATALOG, skuById, SHELF_CAP, RETAIL_CATS, DECOR_SPOTS } from '../data/shopItems.js';
import { planShipment } from '../data/boxes.js';
import { capacityOf, homeFixture } from '../data/fixtureSlots.js';
import { INTERIOR, CLUTTER_SPOTS, WINDOWS } from '../data/shopLayout.js';
import {
  arriveOrder, openAllBoxes, ensureDeliveries, receivingFree,
} from './deliveries.js';
import { ROLE, bestSkill } from './staff.js';
import { TIERS } from './club.js';
import { members } from './golfers.js';
import { notify } from './notifications.js';
import { placedFixtures } from './layout.js';
import { initShopProgression, shopCategoryUnlocked } from './shopProgression.js';
import { placeableSpecBySkuId } from '../data/placeableItems.js';
import {
  cancelPlaceablePurchase,
  ensurePropertyInventory,
  importLegacyStoredPlaceables,
  moveOwnedPlacement,
  placeOwnedItem,
  placedPropertyItems,
  registerPlaceablePurchase,
  sellOwnedItem,
  storeOwnedPlacement,
} from './propertyInventory.js';

// --- restoration arc ------------------------------------------------------------
// The shop starts rundown and is cleaned/furnished up by hand: a grime grid over
// the floor (vacuumed patch by patch), clutter piles to haul out, and decor the
// player orders and places. Condition 0-100 is DERIVED from that state, never
// stored, so it can't drift: cleanliness carries 70 points, decor finish 30.
export const RENO = {
  clutterLayout: 2,           // v2 clears the register/queue sightline
  room: { w: INTERIOR.w, d: INTERIOR.d }, // the clubhouse plan's interior (shopLayout.js)
  grid: { w: 13, h: 8 },       // ~2-yd grime cells over the whole floor (stockroom included)
  startDirt: [0.58, 0.95],     // fresh-game dirt range per cell
  cleanRadius: 1.3,            // yards a vacuum pass reaches
  clutterWipe: 0.5,            // dirt removed under a hauled-out pile
  finishCap: 30,               // max condition points decor can supply
  trafficGrime: 0.0011,        // dirt tracked in per shopper per day, per cell
  trafficCap: 0.5,             // traffic alone plateaus at "needs a pass", never "wrecked"
};
const RENO_LAYOUT_VERSION = 2;

function renoRng(state) {
  // a LOCAL stream derived from the save seed — reno must never consume
  // state.rngState, or adding it would shift every draw that follows
  return makeRng(((state.seed >>> 0) ^ 0x51c7) || 1);
}

function startWindows(rng) {
  return WINDOWS.map(() => Math.round(rng.range(0.72, 0.95) * 100) / 100);
}

export function initShopReno(state) {
  const rng = renoRng(state);
  const cells = RENO.grid.w * RENO.grid.h;
  const grime = [];
  for (let i = 0; i < cells; i++) {
    grime.push(Math.round(rng.range(RENO.startDirt[0], RENO.startDirt[1]) * 1000) / 1000);
  }
  const clutter = CLUTTER_SPOTS.map((s) => ({
    x: Math.round((s.x + rng.range(-0.4, 0.4)) * 100) / 100,
    z: Math.round((s.z + rng.range(-0.3, 0.3)) * 100) / 100,
    ry: Math.round(rng.range(0, Math.PI * 2) * 100) / 100,
    cleared: false,
  }));
  state.shop.reno = {
    layoutVersion: RENO_LAYOUT_VERSION,
    grime,
    clutter,
    decor: [],
    windows: startWindows(rng),
  };
}

export function ensureShopReno(state) {
  if (!state.shop) return;
  if (!Number.isInteger(state.shop.nextTransactionId) || state.shop.nextTransactionId < 1) {
    state.shop.nextTransactionId = 1;
  }
  if (!Number.isInteger(state.shop.nextCommandId) || state.shop.nextCommandId < 1) {
    state.shop.nextCommandId = 1;
  }
  if (!Number.isInteger(state.shop.nextVisitorId) || state.shop.nextVisitorId < 1) {
    state.shop.nextVisitorId = 1;
  }
  if (!state.shop.reno) initShopReno(state);
  const reno = state.shop.reno;

  // FLOOR-PLAN MIGRATION (2026-07-13): saves from the 14×10 room carry a 7×5
  // grime grid and 5 clutter piles. Resample the dirt onto the new grid by
  // normalized position (cleaning progress carries over), and re-lay the
  // piles on the new plan's spots keeping each pile's hauled/unhauled flag
  // by index — a fully-hauled save never gets new junk dumped on it.
  const cells = RENO.grid.w * RENO.grid.h;
  if (reno.grime.length !== cells) {
    const old = reno.grime;
    let ow = 7, oh = 5; // the only legacy shape ever shipped
    if (old.length !== ow * oh) {
      ow = Math.max(1, Math.round(Math.sqrt(old.length * (RENO.grid.w / RENO.grid.h))));
      oh = Math.max(1, Math.round(old.length / ow));
    }
    const grime = [];
    for (let cy = 0; cy < RENO.grid.h; cy++) {
      for (let cx = 0; cx < RENO.grid.w; cx++) {
        const ox = Math.min(ow - 1, Math.floor(((cx + 0.5) / RENO.grid.w) * ow));
        const oy = Math.min(oh - 1, Math.floor(((cy + 0.5) / RENO.grid.h) * oh));
        const v = old[oy * ow + ox];
        grime.push(typeof v === 'number' ? v : 0);
      }
    }
    reno.grime = grime;
  }
  const outsideRoom = (c) => Math.abs(c.x) > RENO.room.w / 2 || Math.abs(c.z) > RENO.room.d / 2;
  if (
    reno.layoutVersion !== RENO_LAYOUT_VERSION
    || reno.clutter.length !== CLUTTER_SPOTS.length
    || reno.clutter.some(outsideRoom)
  ) {
    const flags = reno.clutter.map((c) => !!c.cleared);
    const allCleared = flags.length > 0 && flags.every(Boolean);
    const rng = renoRng(state);
    reno.clutter = CLUTTER_SPOTS.map((s, i) => ({
      x: Math.round((s.x + rng.range(-0.4, 0.4)) * 100) / 100,
      z: Math.round((s.z + rng.range(-0.3, 0.3)) * 100) / 100,
      ry: Math.round(rng.range(0, Math.PI * 2) * 100) / 100,
      cleared: i < flags.length ? flags[i] : allCleared,
    }));
    reno.layoutVersion = RENO_LAYOUT_VERSION;
  }

  // WINDOW FILM (production dirt pass): saves older than the window-grime
  // system get filmed panes; a save that wiped them keeps them wiped
  if (!Array.isArray(reno.windows) || reno.windows.length !== WINDOWS.length) {
    const prior = Array.isArray(reno.windows) ? reno.windows : null;
    const fresh = startWindows(renoRng(state));
    reno.windows = fresh.map((v, i) => (prior && typeof prior[i] === 'number' ? prior[i] : v));
  }

  // saves written before a catalog item existed need its inventory slot
  for (const sku of SHOP_CATALOG) {
    if (!state.shop.inventory[sku.id]) state.shop.inventory[sku.id] = { shelf: 0, back: 0 };
  }
  // Provisions joined the sellable catalog after launch. Preserve every
  // existing category setting while giving older saves a valid base markup.
  if (!state.shop.markup || typeof state.shop.markup !== 'object') state.shop.markup = {};
  if (!Number.isFinite(state.shop.markup.provisions)) state.shop.markup.provisions = 1.0;
  ensureDeliveries(state); // physical-retail block (2026-07-13)

  // EXTERIOR NEGLECT (2026-07-14 stabilization P2): pre-exterior saves gain the
  // rundown yard — weeds at the foundation, a choked gutter, cobwebbed porch
  // corners, a dead porch bulb, grimy siding patches
  if (!reno.exterior) {
    reno.exterior = {
      weeds: [1, 1, 1, 1, 1],
      gutter: 1,
      cobwebs: 1,
      light: 1,
      siding: [1, 1, 1],
    };
  }
  ensureCleaningToolState(state);
}

// --- exterior restoration: real verbs against real state ---------------------------

export function exteriorState(state) {
  ensureShopReno(state);
  return state.shop.reno.exterior;
}

export function pullWeed(state, i) {
  const ex = exteriorState(state);
  if (!ex.weeds[i]) return { ok: false, reason: 'Already pulled.' };
  ex.weeds[i] = 0;
  return { ok: true, left: ex.weeds.filter(Boolean).length };
}

export function clearGutter(state) {
  const ex = exteriorState(state);
  if (!ex.gutter) return { ok: false, reason: 'The gutter runs clean.' };
  ex.gutter = 0;
  return { ok: true };
}

export function brushCobwebs(state) {
  const ex = exteriorState(state);
  if (!ex.cobwebs) return { ok: false, reason: 'No webs left.' };
  ex.cobwebs = 0;
  return { ok: true };
}

export const BULB_COST = 5;
export function replaceBulb(state) {
  const ex = exteriorState(state);
  if (!ex.light) return { ok: false, reason: 'The porch light works.' };
  if (state.cash < BULB_COST) return { ok: false, reason: 'Not enough cash for a bulb.' };
  addExpense(state, 'cleaningSupplies', BULB_COST, {
    idempotencyKey: `property:${state.property?.id || state.seed}:porch-bulb`, relatedId: 'porch-light',
    description: 'Replacement porch-light bulb', source: 'clubhouse-restoration',
  });
  ex.light = 0;
  return { ok: true };
}

// siding grime scrubs off in passes like the window film
export function scrubSiding(state, i) {
  const ex = exteriorState(state);
  const cur = ex.siding[i];
  if (typeof cur !== 'number' || cur <= 0) return { ok: false, left: 0 };
  const left = Math.max(0, Math.round((cur - 0.4) * 100) / 100);
  ex.siding[i] = left;
  return { ok: true, left };
}

// 0..1 curb appeal — every job weighs in
// The hand jobs only. Siding, foundation, porch and gable grime moved to the pressure washer
// (sim/washing.js) — the brief forbids clearing exterior grime with a generic [E] — so it is no
// longer counted here. `ex.siding` survives in old saves and is simply ignored.
export function exteriorScore(state) {
  const ex = exteriorState(state);
  const jobs = ex.weeds.length + 3; // weeds + gutter + cobwebs + bulb
  let done = ex.weeds.filter((w) => !w).length;
  done += ex.gutter ? 0 : 1;
  done += ex.cobwebs ? 0 : 1;
  done += ex.light ? 0 : 1;
  return Math.round((done / jobs) * 100) / 100;
}

// wipe one pane: three passes clear it; returns what's left on the glass
export function wipeWindow(state, index) {
  const reno = state.shop && state.shop.reno;
  if (!reno || !Array.isArray(reno.windows)) return { ok: false };
  const cur = reno.windows[index];
  if (typeof cur !== 'number' || cur <= 0) return { ok: false, left: 0 };
  const left = Math.max(0, Math.round((cur - 0.34) * 100) / 100);
  reno.windows[index] = left;
  return { ok: true, left };
}

export function windowDirtAvg(state) {
  const w = state.shop && state.shop.reno && state.shop.reno.windows;
  if (!w || !w.length) return 0;
  return w.reduce((a, v) => a + v, 0) / w.length;
}

const renoCellAt = (x, z) => {
  const cx = Math.floor(((x + RENO.room.w / 2) / RENO.room.w) * RENO.grid.w);
  const cy = Math.floor(((z + RENO.room.d / 2) / RENO.room.d) * RENO.grid.h);
  if (cx < 0 || cx >= RENO.grid.w || cy < 0 || cy >= RENO.grid.h) return -1;
  return cy * RENO.grid.w + cx;
};

export function shopCondition(state) {
  const reno = state.shop && state.shop.reno;
  if (!reno) return 0;
  const avgDirt = reno.grime.reduce((a, v) => a + v, 0) / reno.grime.length;
  let finish = 0;
  for (const d of reno.decor) {
    const sku = skuById(d.skuId);
    finish += (sku && sku.finish) || 0;
  }
  return Math.round(clamp(1 - avgDirt, 0, 1) * 70 + Math.min(finish, RENO.finishCap));
}

// the vacuum, aimed at (x, z): full strength on the aimed cell, half on the
// ring of cells whose centers fall inside cleanRadius
export function cleanGrimeAt(state, x, z, amount) {
  const reno = state.shop && state.shop.reno;
  if (!reno) return { cleaned: 0 };
  let cleaned = 0;
  const cellW = RENO.room.w / RENO.grid.w;
  const cellD = RENO.room.d / RENO.grid.h;
  for (let cy = 0; cy < RENO.grid.h; cy++) {
    for (let cx = 0; cx < RENO.grid.w; cx++) {
      const cxYd = -RENO.room.w / 2 + (cx + 0.5) * cellW;
      const czYd = -RENO.room.d / 2 + (cy + 0.5) * cellD;
      const dist = Math.hypot(cxYd - x, czYd - z);
      const idx = cy * RENO.grid.w + cx;
      const strength = dist < 0.9 ? 1 : dist < RENO.cleanRadius + 0.6 ? 0.45 : 0;
      if (strength <= 0 || reno.grime[idx] <= 0) continue;
      const take = Math.min(reno.grime[idx], amount * strength);
      reno.grime[idx] = Math.round((reno.grime[idx] - take) * 1000) / 1000;
      cleaned += take;
    }
  }
  return { cleaned };
}

// foot traffic tracks a little grime back in each day — the vacuum is upkeep,
// not a one-time chore. Capped well below fixer-upper filth: neglect makes the
// shop read "needs a pass", it never re-wrecks the place on its own.
export function shopDailyGrime(state, shoppers) {
  const reno = state.shop && state.shop.reno;
  if (!reno || shoppers <= 0) return;
  const add = Math.min(0.05, shoppers * RENO.trafficGrime);
  for (let i = 0; i < reno.grime.length; i++) {
    if (reno.grime[i] < RENO.trafficCap) {
      reno.grime[i] = Math.min(RENO.trafficCap, Math.round((reno.grime[i] + add) * 1000) / 1000);
    }
  }
}

export function clearClutter(state, idx) {
  const reno = state.shop && state.shop.reno;
  const pile = reno && reno.clutter[idx];
  if (!pile || pile.cleared) return { ok: false };
  pile.cleared = true;
  cleanGrimeAt(state, pile.x, pile.z, RENO.clutterWipe);
  return { ok: true };
}

// put an owned decor item down on one of its valid spots
export function placeDecor(state, skuId, spot) {
  const reno = state.shop && state.shop.reno;
  const sku = skuById(skuId);
  const spots = DECOR_SPOTS[skuId];
  if (!reno || !sku || sku.cat !== 'decor' || !spots) return { ok: false, reason: 'Not a decor item.' };
  if (!Number.isInteger(spot) || spot < 0 || spot >= spots.length) return { ok: false, reason: 'No spot there.' };
  const inv = state.shop.inventory[skuId];
  if (!inv || inv.back <= 0) return { ok: false, reason: 'None in the backroom — order it first.' };
  if (reno.decor.some((d) => d.skuId === skuId && d.spot === spot)) return { ok: false, reason: 'That spot is taken.' };
  importLegacyStoredPlaceables(state, skuId, inv.back);
  const authored = spots[spot];
  const placed = placeOwnedItem(state, skuId, {
    area: 'clubhouse',
    mount: authored.mount,
    x: authored.x,
    z: authored.z,
    ry: authored.ry,
    surfaceId: `decor-anchor:${skuId}:${spot}`,
    authoredSpot: spot,
  });
  if (!placed.ok) return placed;
  inv.back -= 1;
  reno.decor.push({ skuId, spot, placementId: placed.placement.id });
  return { ok: true, placement: placed.placement };
}

// Free-placement counterpart to the authored renovation anchors. Ownership is
// consumed only after the caller has validated the exact preview pose.
export function placeDecorFree(state, skuId, pose) {
  const reno = state.shop && state.shop.reno;
  const sku = skuById(skuId);
  const inv = state.shop?.inventory?.[skuId];
  if (!reno || !sku || sku.cat !== 'decor') return { ok: false, reason: 'Not a decor item.' };
  if (!inv || inv.back <= 0) return { ok: false, reason: 'None in property storage.' };
  importLegacyStoredPlaceables(state, skuId, inv.back);
  const placed = placeOwnedItem(state, skuId, pose);
  if (!placed.ok) return placed;
  inv.back -= 1;
  reno.decor.push({ skuId, spot: null, placementId: placed.placement.id });
  return { ok: true, placement: placed.placement };
}

export function moveDecorPlacement(state, placementId, pose) {
  const reno = state.shop?.reno;
  if (!reno?.decor?.some((entry) => entry.placementId === placementId)) {
    return { ok: false, reason: 'That decor placement is not in this clubhouse.' };
  }
  return moveOwnedPlacement(state, placementId, pose);
}

export function removeDecorPlacement(state, placementId) {
  const reno = state.shop?.reno;
  if (!reno) return { ok: false, reason: 'No clubhouse renovation state.' };
  const index = reno.decor.findIndex((entry) => entry.placementId === placementId);
  if (index < 0) return { ok: false, reason: 'That decor placement is not in this clubhouse.' };
  const decor = reno.decor[index];
  const stored = storeOwnedPlacement(state, placementId);
  if (!stored.ok) return stored;
  reno.decor.splice(index, 1);
  const inv = state.shop.inventory[decor.skuId];
  if (inv) inv.back += 1;
  return { ok: true, placement: stored.placement, skuId: decor.skuId };
}

export function sellStoredDecor(state, skuId, operationId = null) {
  const inv = state.shop?.inventory?.[skuId];
  if (!inv || inv.back < 1) return { ok: false, reason: 'None of that item is in storage.' };
  importLegacyStoredPlaceables(state, skuId, inv.back);
  const sold = sellOwnedItem(state, skuId, { quantity: 1, operationId });
  if (!sold.ok || sold.replay) return sold;
  inv.back -= 1;
  return sold;
}

// pack a placed piece back up: the spot frees, the item returns to the backroom
export function removeDecor(state, skuId, spot) {
  const reno = state.shop && state.shop.reno;
  if (!reno) return { ok: false };
  const idx = reno.decor.findIndex((d) => d.skuId === skuId && d.spot === spot);
  if (idx < 0) return { ok: false };
  ensurePropertyInventory(state);
  const decor = reno.decor[idx];
  const placement = decor.placementId
    ? placedPropertyItems(state).find((entry) => entry.id === decor.placementId)
    : placedPropertyItems(state).find((entry) => (
      entry.assetId === placeableSpecBySkuId(skuId)?.assetId
        && entry.pose?.authoredSpot === spot
    ));
  if (!placement) return { ok: false, reason: 'That decor placement has no ownership record.' };
  const stored = storeOwnedPlacement(state, placement.id);
  if (!stored.ok) return stored;
  reno.decor.splice(idx, 1);
  const inv = state.shop.inventory[skuId];
  if (inv) inv.back += 1;
  return { ok: true, placement: stored.placement };
}

export function initShop(state) {
  const inventory = {};
  for (const sku of SHOP_CATALOG) inventory[sku.id] = { shelf: 0, back: 0 };
  // the fixer-upper opens with a sad little spread: cheap balls, tees, a few gloves
  inventory.balls1.shelf = 10;
  inventory.tees1.shelf = 14;
  inventory.glove1.shelf = 4;
  inventory.cap1.shelf = 5;
  state.shop = {
    unlockedTier: 1,
    inventory,
    orders: [],
    nextOrderId: 1,
    markup: { clubs: 1.0, balls: 1.0, apparel: 1.0, accessories: 1.0, provisions: 1.0 },
    // The entrance feature is the authored rangefinder display. Rangefinders
    // are accessories, so its attention nudge must agree with what is visible.
    featureCategory: 'accessories',
    rentalFleet: { sets: 3, condition: 55, pricePerRound: 18 },
    deliveries: { boxes: [], nextBoxId: 1, trash: 0, recycled: 0, shipments: [] },
    held: [],            // individual customer-owned units reserved for checkout
    carry: null,         // WHAT IS IN YOUR HANDS: {skuId, qty} — see sim/stocking.js
    lostSalesYesterday: 0,
    lostSalesTotal: 0,
    salesYesterday: { units: 0, revenue: 0 },
    salesToday: {},      // per-SKU units sold since the last day close (both selling paths)
    salesWindow: [],     // the last seven closed days of the same — velocity reads this
    transactionHistory: [], // completed physical-register tickets, newest first
    nextTransactionNo: 1,
    fittingsYesterday: 0,
    log: [], // recent notable sales for the panel/3D flavor
  };
  initShopProgression(state);
  initShopReno(state);
}

// --- pricing --------------------------------------------------------------------

export function priceFor(sku, markup, memberTier) {
  const discount = memberTier ? TIERS[memberTier].shopDiscount || 0 : 0;
  return Math.round(sku.msrp * markup * (1 - discount) * 100) / 100;
}

// willingness to pay: 1.0 markup is book price; buyers thin out fast past ~1.2×
function priceAcceptance(markup, wealth, tier) {
  const tolerance = 1 + (wealth - 1) * 0.11 + (tier - 1) * 0.05;
  return clamp(Math.pow(tolerance / markup, 2.6), 0.04, 1.25);
}

// --- ordering ----------------------------------------------------------------------

export function orderCost(sku, qty) {
  return Math.round(sku.cost * qty * 100) / 100;
}

// each order ships into a two-hour window on its arrival day; the truck lands
// at a specific (deterministic per order) minute inside it
export function placeOrder(state, skuId, qty) {
  const sku = skuById(skuId);
  if (!sku) return { ok: false, reason: 'No such item.' };
  if (RETAIL_CATS.has(sku.cat) && !shopCategoryUnlocked(state, sku.cat)) {
    return { ok: false, reason: `${sku.cat === 'clubs' ? 'Club' : 'Provisions'} ordering opens with the STANDARD shop.` };
  }
  if (sku.tier > state.shop.unlockedTier) return { ok: false, reason: 'Supplier account not unlocked yet.' };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: 'Order quantity must be a positive whole number.' };

  const purchase = submitPurchaseOrders(state, { lines: [{ skuId, quantity: qty }] });
  if (!purchase.ok) return { ok: false, reason: purchase.reason };
  const purchasedOrder = purchase.orders[0];
  return {
    ok: true,
    cost: purchasedOrder.totalCost,
    goods: purchasedOrder.goods,
    fee: purchasedOrder.shippingCost,
    order: purchasedOrder,
    boxes: purchasedOrder.manifest.boxCount,
    weight: purchasedOrder.manifest.weight,
    supplier: purchasedOrder.supplier,
  };

  // pack it NOW. The manifest is what the Orders screen promises and what the receiving pad
  // stands there — one object, read twice, so the two can never disagree.
  const manifest = planShipment(sku, qty);
  // One order has to fit on an EMPTY receiving pad. Several smaller orders may
  // still queue and arrive as the player clears cartons, but a single manifest
  // larger than the pad can never satisfy the atomic unloading contract below.
  // Reject it before billing instead of creating paid stock that circles forever.
  if (manifest.boxCount > PAD_CAPACITY) {
    return {
      ok: false,
      reason: `This order needs ${manifest.boxCount} boxes, but the receiving pad holds ${PAD_CAPACITY}. Split it into smaller orders.`,
      boxes: manifest.boxCount,
      capacity: PAD_CAPACITY,
    };
  }
  const goods = orderCost(sku, qty);
  const fee = manifest.fee;
  const starter = isStarterDelivery(state);
  const id = state.shop.nextOrderId;
  const eta = quoteDelivery(state, sku, qty, { service, orderId: id, starter, goods, freight: fee });
  const expressFee = eta.expressFee;
  const cost = Math.round((goods + fee + expressFee) * 100) / 100;
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash.' };

  state.shop.nextOrderId++;
  if (starter && state.shop.starterOrderMin == null) state.shop.starterOrderMin = state.clock.minutes;
  const order = {
    id,
    skuId,
    qty,
    cost,        // goods + freight: the number that left your account
    goods,
    fee,
    expressFee,
    service: eta.service,
    pace: eta.pace,
    supplier: manifest.supplier,
    accountingClass: purchaseClass,
    ledgerKeys,
    manifest,
    arrivesDay: eta.arrivesDay,
    placedMin: state.clock.minutes,
    window: eta.window,
    deliveryMin: eta.deliveryMin,
    timing: {
      processingMinutes: eta.processingMinutes,
      transitMinutes: eta.transitMinutes,
      dispatchMin: eta.dispatchMin,
      supplierSpeedModifier: eta.supplierSpeedModifier,
      expressModifier: eta.expressModifier,
    },
    status: 'received',
    notif: {},
  };
  if (placeableSpecBySkuId(skuId)) {
    const ownership = registerPlaceablePurchase(state, skuId, qty, {
      sourceId: `shop-order:${id}`,
      purchasePrice: sku.cost,
    });
    if (!ownership.ok) {
      unbill(state, 'shopOrders', cost);
      return ownership;
    }
  }
  state.shop.orders.push(order);
  return {
    ok: true,
    cost: purchasedOrder.totalCost,
    goods: purchasedOrder.goods,
    fee: purchasedOrder.shippingCost,
    order: purchasedOrder,
    boxes: purchasedOrder.manifest.boxCount,
    weight: purchasedOrder.manifest.weight,
    supplier: purchasedOrder.supplier,
  };

}

// WHERE AN ORDER IS, AT A GIVEN MINUTE.
//
// Derived from the clock, never accumulated, so a save that sleeps through four days wakes up with
// the right status instead of the one it was wearing when you quit. The thresholds run backwards
// from the truck's own minute: the van is loaded and out before the window opens (that is what a
// delivery window IS — a promise made while the van is already moving), and "arriving soon" is the
// last half hour.
export function orderStatusAt(o, nowMin) {
  if (nowMin >= o.deliveryMin) return 'delivered';
  if (nowMin >= o.deliveryMin - 30) return 'arriving';
  const timing = deliveryTimingOf(o);
  const lead = Math.max(1, o.deliveryMin - o.placedMin);
  // Even the short opening promise wears every truthful stage. Reserve at
  // least fifteen game minutes for "shipped" before the local van is "out".
  const outLead = Math.min(60, Math.max(45, lead * 0.2));
  const outMin = Math.max(timing.dispatchMin + 1, Math.min(o.deliveryMin - 31, o.deliveryMin - outLead));
  if (nowMin >= outMin) return 'out';
  const t = nowMin - o.placedMin;
  if (nowMin >= timing.dispatchMin) return 'shipped';
  if (t >= lead * 0.30) return 'packed';
  if (t >= lead * 0.08) return 'processing';
  return 'received';
}

// --- WHAT ACTUALLY SOLD, LINE BY LINE ------------------------------------------------------
//
// The shop only ever kept an aggregate (`salesYesterday: {units, revenue}`), so the Inventory
// page's sales velocity and days-of-supply, and Analytics' best-sellers and sellouts, had
// nowhere truthful to come from. Rather than invent them on the screen — which is the worst
// thing a management screen can do, because you then make decisions on it — the shop keeps a
// per-SKU tally and rolls it into a seven-day window each night.
//
// BOTH selling paths feed this: the offline day simulation below, and the physical register
// (registerMode -> completeSale). A velocity that counts only half the sales is a lie with a
// decimal point on it.
export function recordSale(state, skuId, qty = 1) {
  const s = state.shop;
  if (!s.salesToday) s.salesToday = {};
  s.salesToday[skuId] = (s.salesToday[skuId] || 0) + qty;
}

export function rollSalesWindow(state) {
  const s = state.shop;
  if (!s.salesWindow) s.salesWindow = [];
  s.salesWindow.push(s.salesToday || {});
  while (s.salesWindow.length > 7) s.salesWindow.shift();
  s.salesToday = {};
}

// units a day, averaged over the days we ACTUALLY have — not over a hardcoded seven, which
// would quietly report a new shop as selling a seventh of what it really sells.
export function velocity(state, skuId) {
  const w = (state.shop && state.shop.salesWindow) || [];
  if (!w.length) return 0;
  let n = 0;
  for (const day of w) n += day[skuId] || 0;
  return n / w.length;
}

// how long the shelf and the back room last at that rate.
export function daysOfSupply(state, skuId) {
  const inv = state.shop.inventory[skuId];
  if (!inv) return 0;
  const onHand = inv.shelf + inv.back;
  const v = velocity(state, skuId);
  if (v <= 0) return onHand > 0 ? Infinity : 0; // dead stock lasts forever, and that IS the finding
  return onHand / v;
}

// Stop an order before it lands. The Orders application needs this — a screen that can watch an
// order and not stop it is a readout, not an application.
//
// The order was PAID FOR when it was placed, so this reverses that booking exactly (see
// economy.unbill): cash back to the penny, the expense line back down, no trace in the day's
// books. Splicing the order out FIRST is what makes it un-refundable twice — the second call
// cannot find it, so there is nothing to pay back. There is no window where both are true.
export function cancelOrder(state, id) {
  const orders = state.shop.orders;
  const i = orders.findIndex((o) => o.id === id);
  if (i < 0) return { ok: false, reason: 'No such order.' };
  const o = orders[i];
  // once it is inside its delivery window the goods are on the pad any minute — too late.
  // A blocked van has explicitly unloaded nothing, so it can still be turned
  // away. This also rescues legacy oversized paid manifests from permanent limbo.
  if ((o.status === 'arriving' || o.status === 'delivered') && !o.blocked) {
    return { ok: false, reason: 'The van is at the door — too late to cancel.' };
  }
  if (placeableSpecBySkuId(o.skuId)) {
    const ownership = cancelPlaceablePurchase(state, `shop-order:${o.id}`);
    if (!ownership.ok) return ownership;
  }
  orders.splice(i, 1);
  if (o.ledgerKeys) {
    if (o.goods > 0) {
      unbill(state, 'shopOrders', o.goods, {
        idempotencyKey: `cancel:${o.ledgerKeys.goods}`,
        relatedId: o.id,
        description: `Cancelled supplier order â€” goods refund`,
        source: 'supplier-order',
        accountingClass: o.accountingClass || 'inventory',
      });
    }
    if (o.fee > 0) {
      unbill(state, 'deliveryCosts', o.fee, {
        idempotencyKey: `cancel:${o.ledgerKeys.delivery}`,
        relatedId: o.id,
        description: `Cancelled supplier order â€” delivery refund`,
        source: 'supplier-order',
        accountingClass: o.accountingClass || 'inventory',
      });
    }
  } else {
    // Pre-ledger-v2 orders were booked as a single merchandise expense.
    unbill(state, 'shopOrders', o.cost, {
      idempotencyKey: `legacy-order:${o.id}:cancel`,
      relatedId: o.id,
      source: 'supplier-order',
    });
  }
  return { ok: true, refund: o.cost };
}

// minute-grained delivery tick: progresses statuses, fires each heads-up once,
// and lands the truck at its minute. Returns the events that just happened so
// the UI can speak them; safe to call as often as you like (idempotent).
export function tickDeliveries(state, nowMin) {
  const events = [];
  if (!state.shop || !state.shop.orders || !state.shop.orders.length) return events;
  const arrivals = [];
  // Space taken by vans already waved through ON THIS TICK. Their boxes do not exist yet —
  // arriveOrder runs below, after the loop — so without this, four vans landing on the same
  // minute each look at the same empty pad, all unload, and the pad ends up over capacity.
  // (It did: thirteen cartons on a nine-carton pad, found by watching the running game.)
  let reserved = 0;
  for (const o of state.shop.orders) {
    if (o.window === undefined) continue; // pre-window legacy order: dailyTick path delivers it
    if (!o.notif) o.notif = {};
    o.status = orderStatusAt(o, nowMin);
    syncOrderTransitState(state, o, o.status);

    if (o.status === 'delivered') {
      // THE PAD HAS TO HAVE ROOM. A driver with nowhere to put nine cartons does not stack them
      // to the roof and drive off; he tells you he could not deliver. The order stays out there —
      // it is not lost, and it is not silently teleported into the backroom either.
      const totalBoxes = (o.manifest && o.manifest.boxCount) || 1;
      const receivedBoxes = Array.isArray(o.receivedManifestBoxIndexes) ? o.receivedManifestBoxIndexes.length : 0;
      const need = Math.max(0, totalBoxes - receivedBoxes);
      const free = Math.max(0, receivingFree(state) - reserved);
      if (free <= 0) {
        o.status = 'arriving';        // still circling
        syncOrderTransitState(state, o, 'arriving');
        if (!o.blocked) {
          o.blocked = true;
          events.push({ kind: 'blocked', order: o, need, free: PAD_CAPACITY - padCount(state) - reserved });
          notify(state, {
            kind: 'delivery',
            text: `A van could not unload — the receiving pad is full. Order #${o.id} is circling until you clear cartons.`,
          });
        }
        continue;
      }
      o.blocked = false;
      const unloading = Math.min(need, free);
      reserved += unloading;
      arrivals.push({ order: o, count: unloading });
      continue;
    }

    const timing = deliveryTimingOf(o);
    if (!o.notif.dispatched && nowMin >= timing.dispatchMin && nowMin < o.deliveryMin) {
      o.notif.dispatched = true;
      events.push({ kind: 'dispatched', order: o });
    }
    if (!o.notif.soon && nowMin >= o.deliveryMin - 30 && nowMin < o.deliveryMin) {
      o.notif.soon = true;
      events.push({ kind: 'soon', order: o });
    }
  }
  if (arrivals.length) {
    const completed = [];
    for (const arrival of arrivals) {
      const o = arrival.order;
      const boxes = arriveOrder(state, o, { maxBoxes: arrival.count });
      const complete = o.remainingUnreceivedQuantity <= 0;
      if (complete) completed.push(o);
      events.push({
        kind: complete ? 'arrived' : 'partial-arrival',
        order: o,
        boxes,
        usedFallback: boxes.some((box) => box.loc === 'receiving-fallback'),
      });
    }
    state.shop.orders = state.shop.orders.filter((order) => !completed.includes(order));
  }
  return events;
}

// day-grained force-delivery: the parked-property reconcile and the midnight
// safety net (anything the minute tick somehow missed lands with the day)
export function deliverOrdersDue(state, dayAbs) {
  // windowed orders due TODAY belong to their window (tickDeliveries) — only
  // strictly-past days force-land here; legacy windowless orders keep day-of
  const due = (o) => (o.window === undefined ? o.arrivesDay <= dayAbs : o.arrivesDay < dayAbs);
  const arrived = [];
  let reserved = 0;
  for (const order of state.shop.orders) {
    if (!due(order)) continue;
    const need = (order.manifest && order.manifest.boxCount) || 1;
    if (!padHasRoom(state, need + reserved)) {
      order.status = 'arriving';
      if (!order.blocked) {
        order.blocked = true;
        notify(state, {
          kind: 'delivery',
          text: `A van could not unload — the receiving pad is full. Order #${order.id} is waiting until you clear cartons.`,
        });
      }
      continue;
    }
    order.blocked = false;
    reserved += need;
    arrived.push(order);
  }
  state.shop.orders = state.shop.orders.filter((order) => !arrived.includes(order));
  // 2026-07-13 physical retail: arrivals are BOXES on the receiving pad —
  // contents reach the backroom when someone opens them (you, or the
  // morning floor staff in restockShelvesByStaff)
  const completed = [];
  const received = [];
  for (const arrival of arrivals) {
    const boxes = arriveOrder(state, arrival.order, { maxBoxes: arrival.count });
    if (boxes.length) received.push(arrival.order);
    if (arrival.order.remainingUnreceivedQuantity <= 0) completed.push(arrival.order);
  }
  state.shop.orders = state.shop.orders.filter((order) => !completed.includes(order));
  return received;
}

// --- restocking ------------------------------------------------------------------------

// HOW MANY OF THIS THE SHELF HOLDS — which is the number of places there are to put one.
//
// It used to be a per-category number, and the renderer had a different opinion, and nobody
// compared them: a "full" accessories shelf (24) drew twelve of them, and `bag1`'s category is
// 'accessories', so a golf-bag platform could be stacked with twenty-four stand bags and drew
// four. Capacity is the slot count now (data/fixtureSlots.js) — the same list the shop walks to
// put the things on the shelf. SHELF_CAP survives only for a line with no fixture to stand on.
export function shelfCapacity(sku) {
  const slots = capacityOf(sku.id);
  return slots > 0 ? slots : SHELF_CAP[sku.cat];
}

function placedFixtureIds(state) {
  return new Set(placedFixtures(state).map((fixture) => fixture.id));
}

function skuDisplayIsInSet(skuId, fixtureIds) {
  const fixture = homeFixture(skuId);
  // Catalog lines without an authored fixture retain their legacy behavior.
  // Authored lines, however, are sellable/shelfable only while that one real
  // display is on the floor.
  return !fixture || fixtureIds.has(fixture.id);
}

export function skuDisplayIsPlaced(state, skuId) {
  return skuDisplayIsInSet(skuId, placedFixtureIds(state));
}

// does the shop own its vacuum yet? (equipment lives in .back, never on shelves)
export function vacuumOwned(state) {
  const inv = state.shop.inventory.vac1;
  return !!inv && inv.back > 0;
}

// the player, standing at a shelf in the 3D shop
export function restockShelfFromBackroom(state, skuId) {
  const sku = skuById(skuId);
  if (!RETAIL_CATS.has(sku.cat)) return { ok: false, reason: 'Equipment stays in the back.' };
  if (!skuDisplayIsPlaced(state, skuId)) return { ok: false, reason: 'That display is stored.' };
  const inv = state.shop.inventory[skuId];
  const space = shelfCapacity(sku) - inv.shelf;
  const move = Math.min(space, inv.back);
  if (move <= 0) return { ok: false, reason: inv.back <= 0 ? 'Backroom is empty.' : 'Shelf is full.' };
  const ledgerMove = moveInventory(state, {
    from: INVENTORY_STAGE.RESERVE,
    to: INVENTORY_STAGE.SHELF,
    skuId,
    quantity: move,
    reason: 'Restocked shelf from backroom',
  });
  if (!ledgerMove.ok) return ledgerMove;
  inv.back -= move;
  inv.shelf += move;
  return { ok: true, moved: move };
}

// floor staff work through the backroom each morning; skill = how much gets out
export function restockShelvesByStaff(state) {
  const skill = bestSkill(state, ROLE.PROSHOP);
  if (skill <= 0) return 0;
  openAllBoxes(state); // the crew unboxes the truck's drop before shelving
  const floorFixtures = placedFixtureIds(state);
  let capacity = 30 + skill * 25; // units they can shelve in a morning
  let moved = 0;
  for (const sku of SHOP_CATALOG) {
    if (capacity <= 0) break;
    if (!RETAIL_CATS.has(sku.cat)) continue; // your vacuum is not for sale
    if (!skuDisplayIsInSet(sku.id, floorFixtures)) continue;
    const inv = state.shop.inventory[sku.id];
    const space = shelfCapacity(sku) - inv.shelf;
    const move = Math.min(space, inv.back, capacity);
    if (move > 0) {
      const ledgerMove = moveInventory(state, {
        from: INVENTORY_STAGE.RESERVE,
        to: INVENTORY_STAGE.SHELF,
        skuId: sku.id,
        quantity: move,
        reason: 'Floor staff restock',
      });
      if (!ledgerMove.ok) continue;
      inv.back -= move;
      inv.shelf += move;
      capacity -= move;
      moved += move;
    }
  }
  return moved;
}

// --- demand ---------------------------------------------------------------------------------

// how much a category matters by season (0 Spring, 1 Summer, 2 Fall, 3 Winter)
export function demandWeight(cat, seasonIndex) {
  const table = {
    balls: [1.0, 1.2, 0.95, 0.35],
    clubs: [1.0, 1.1, 0.8, 0.4],
    apparel: [0.9, 0.8, 1.05, 1.35],
    accessories: [1.0, 1.0, 0.95, 0.6],
    provisions: [1.05, 1.35, 0.95, 0.55],
  };
  return table[cat][seasonIndex];
}

export function shopOpenStock(state) {
  const floorFixtures = placedFixtureIds(state);
  let units = 0;
  for (const [skuId, inv] of Object.entries(state.shop.inventory)) {
    if (skuDisplayIsInSet(skuId, floorFixtures)) units += inv.shelf;
  }
  return units;
}

// --- the daily pass (called from the midnight accrual) -----------------------------------------

export function shopDailyAccrual(state) {
  const shop = state.shop;
  const cal = calendarOf(state.clock.minutes);
  const dayAbs = Number.isInteger(state.ledger?.postingDay) ? state.ledger.postingDay : cal.dayAbs;
  if (shop.lastAccruedDay === dayAbs) return shop.lastAccrual || null;
  const rng = rngOf(state);
  const seasonIndex = cal.seasonIndex;
  const rounds = state.club.lastRounds || 0;
  const ms = members(state);

  const floorSkill = bestSkill(state, ROLE.PROSHOP);
  const proOnFloor = floorSkill > 0;

  // staff shelve stock before the doors open
  restockShelvesByStaff(state);
  const floorFixtures = placedFixtureIds(state);

  // shopper flow: players on the course + member drop-ins + reputation walk-ins
  const shoppers = Math.round(
    rounds * 0.45 + ms.length * 0.1 + state.club.reputation * 0.05 + rng.next() * 3,
  );

  let revenue = 0;
  let costOfGoods = 0;
  let units = 0;
  let lost = 0;
  let lostToStock = 0;
  let lostToPrice = 0;
  shop.log = [];

  const catalogByCat = {};
  for (const sku of SHOP_CATALOG) {
    if (sku.tier > shop.unlockedTier) continue;
    if (!RETAIL_CATS.has(sku.cat)) continue; // supplies/decor never reach shoppers
    if (!shopCategoryUnlocked(state, sku.cat)) continue;
    (catalogByCat[sku.cat] ||= []).push(sku);
  }

  for (let i = 0; i < shoppers; i++) {
    // who is shopping? members carry their tier discount and their feelings
    const member = ms.length && rng.chance(0.45) ? ms[rng.int(ms.length)] : null;
    const wealth = member ? member.wealth : 1 + rng.int(3);

    // what did they come in wanting?
    const catRoll = rng.next();
    let cat;
    const wBalls = 0.38 * demandWeight('balls', seasonIndex);
    const wAcc = 0.18 * demandWeight('accessories', seasonIndex);
    const wApp = 0.20 * demandWeight('apparel', seasonIndex);
    const wClubs = 0.11 * demandWeight('clubs', seasonIndex);
    const wProvisions = 0.13 * demandWeight('provisions', seasonIndex);
    const total = wBalls + wAcc + wApp + wClubs + wProvisions;
    if (catRoll < wBalls / total) cat = 'balls';
    else if (catRoll < (wBalls + wAcc) / total) cat = 'accessories';
    else if (catRoll < (wBalls + wAcc + wApp) / total) cat = 'apparel';
    else if (catRoll < (wBalls + wAcc + wApp + wProvisions) / total) cat = 'provisions';
    else cat = 'clubs';

    // the feature table nudges attention toward what you merchandise
    if (shop.featureCategory && rng.chance(0.15)) cat = shop.featureCategory;

    const options = (catalogByCat[cat] || []).filter((s) => {
      if (s.coldSeason && (seasonIndex === 1)) return false; // no storm shells in July
      return skuDisplayIsInSet(s.id, floorFixtures) && state.shop.inventory[s.id].shelf > 0;
    });

    if (!options.length) {
      lost++;
      lostToStock++;
      if (member) member.satisfaction = clamp(member.satisfaction - 2, 0, 100);
      continue;
    }

    // wealthier shoppers reach for higher tiers when stocked
    options.sort((a, b) => a.tier - b.tier);
    const pickIdx = clamp(Math.floor((wealth - 1 + rng.next()) / 4 * options.length), 0, options.length - 1);
    const sku = options[pickIdx];

    const markup = Number.isFinite(shop.markup[cat]) ? shop.markup[cat] : 1.0;
    let accept = priceAcceptance(markup, wealth, sku.tier);
    if (cat === 'clubs') accept *= proOnFloor ? 0.55 + floorSkill * 0.14 : 0.3; // big tickets need help
    else if (proOnFloor) accept *= 1 + floorSkill * 0.03;

    if (rng.chance(clamp(accept, 0, 0.97))) {
      const price = priceFor(sku, markup, member ? member.memberTier : null);
      revenue += price;
      costOfGoods += sku.cost || 0;
      units++;
      recordSale(state, sku.id);
      state.shop.inventory[sku.id].shelf--;
      if (member) member.satisfaction = clamp(member.satisfaction + (cat === 'clubs' ? 3 : 0.6), 0, 100);
      if (price > 80 || rng.chance(0.12)) {
        shop.log.unshift(`${member ? member.name : 'A visitor'} bought the ${sku.name} (${Math.round(price)} dollars)`);
        if (shop.log.length > 8) shop.log.pop();
      }
    } else {
      lost++;
      lostToPrice++;
      if (member) member.satisfaction = clamp(member.satisfaction - 1.2, 0, 100);
    }
  }

  if (revenue > 0) {
    addRevenue(state, 'shopSales', revenue, {
      idempotencyKey: `shop-simulation:${dayAbs}:sales`,
      relatedId: `shop-day-${dayAbs}`,
      description: 'Simulated pro-shop sales',
      source: 'shop-simulation',
      units,
      customerCount: units,
    });
    addCostOfGoods(state, costOfGoods, {
      idempotencyKey: `shop-simulation:${dayAbs}:cogs`,
      relatedId: `shop-day-${dayAbs}`,
      description: 'Cost of simulated pro-shop sales',
      source: 'shop-simulation',
      units,
    });
    recordOutcome(state, {
      idempotencyKey: `shop-simulation:${dayAbs}:served`,
      type: 'shopCustomersServed',
      count: units,
      amount: revenue,
      relatedId: `shop-day-${dayAbs}`,
      reason: `${units} shopper${units === 1 ? '' : 's'} found an item and completed a purchase.`,
    });
  }
  if (lost > 0) {
    recordOutcome(state, {
      idempotencyKey: `shop-simulation:${dayAbs}:missed`,
      type: 'missedSale',
      count: lost,
      relatedId: `shop-day-${dayAbs}`,
      reason: `${lost} shopper${lost === 1 ? '' : 's'} left because the requested category was out of stock.`,
      metadata: { stockouts: lostToStock, priceRejections: lostToPrice },
    });
  }
  if (shoppers > 0) {
    const conversion = units / Math.max(1, units + lost);
    const retailDelta = clamp((conversion - 0.62) * 1.8, -1.2, 0.45);
    applyReputationChange(state, {
      id: `shop-simulation:${dayAbs}:retail-reputation`, category: 'retail', delta: retailDelta,
      source: 'shop-simulation', sourceId: `shop-day-${dayAbs}`,
      reason: lost > 0
        ? `${units} purchases completed; ${lostToStock} stockout and ${lostToPrice} price rejection${lostToPrice === 1 ? '' : 's'} hurt conversion.`
        : `${units} shoppers found acceptable products and prices.`,
    });
    const cleanliness = shopCondition(state);
    applyReputationChange(state, {
      id: `shop-simulation:${dayAbs}:cleanliness-reputation`, category: 'cleanliness',
      delta: clamp((cleanliness - 50) / 70, -0.7, 0.45),
      source: 'shop-simulation', sourceId: `shop-day-${dayAbs}`,
      reason: `${shoppers} shopper${shoppers === 1 ? '' : 's'} experienced clubhouse cleanliness at ${Math.round(cleanliness)}.`,
    });
  }

  // a line that sold down to nothing today is a fact worth filing — once per line per day
  for (const sku of SHOP_CATALOG) {
    if (!RETAIL_CATS.has(sku.cat) || sku.tier > shop.unlockedTier) continue;
    const inv = shop.inventory[sku.id];
    if (inv && inv.shelf === 0 && inv.back === 0 && velocity(state, sku.id) > 0) {
      notify(state, {
        kind: 'stock',
        text: `Sold out: ${sku.name}. Nothing on the shelf, nothing in the back.`,
        dedupeKey: `sellout:${sku.id}:${cal.dayAbs}`,
      });
    }
  }

  // --- rentals: guests without clubs -------------------------------------------
  const fleet = shop.rentalFleet;
  let rentalRevenue = 0;
  if (fleet.sets > 0 && fleet.condition > 15) {
    const guests = Math.max(0, rounds - ms.length * 0.3);
    const potentialRenters = Math.min(Math.round(guests * 0.16), fleet.sets * 2);
    const fairRental = 10 + fleet.condition * 0.14;
    const rentalDemand = clamp(Math.pow(fairRental / Math.max(1, fleet.pricePerRound), 1.7), 0.1, 1.6);
    const renters = Math.min(potentialRenters, Math.round(potentialRenters * Math.min(1, rentalDemand)));
    if (renters > 0) {
      rentalRevenue = renters * fleet.pricePerRound;
      addRevenue(state, 'rentals', rentalRevenue, {
        idempotencyKey: `shop-simulation:${dayAbs}:rentals`,
        relatedId: `shop-day-${dayAbs}`,
        description: `${renters} club-rental round${renters === 1 ? '' : 's'}`,
        source: 'shop-simulation',
        units: renters,
        customerCount: renters,
      });
      fleet.condition = clamp(fleet.condition - renters * 0.5, 0, 100);
    }
  }

  // --- fittings: needs a real pro and members who care --------------------------
  let fittings = 0;
  const proSkill = Math.max(bestSkill(state, ROLE.INSTRUCTOR), floorSkill >= 4 ? floorSkill - 1 : 0);
  if (proSkill > 0 && ms.length > 0) {
    const demand = clamp(ms.length * 0.03 + state.club.reputation * 0.008, 0, 2.4);
    fittings = Math.min(Math.floor(demand + (rng.chance(demand % 1) ? 1 : 0)), 3);
    if (fittings > 0) {
      addRevenue(state, 'fittings', fittings * 120, {
        idempotencyKey: `shop-simulation:${dayAbs}:fittings`,
        relatedId: `shop-day-${dayAbs}`,
        description: `${fittings} professional fitting${fittings === 1 ? '' : 's'}`,
        source: 'shop-simulation',
        units: fittings,
        customerCount: fittings,
      });
      for (let i = 0; i < fittings; i++) {
        const m = ms[rng.int(ms.length)];
        m.satisfaction = clamp(m.satisfaction + 6, 0, 100);
        m.fittedDay = calendarOf(state.clock.minutes).dayAbs; // Phase 5: plays better
      }
    }
  }

  shopDailyGrime(state, shoppers); // the day's feet track dirt back in

  shop.salesYesterday = { units, revenue: Math.round(revenue) };
  shop.lostSalesYesterday = lost;
  shop.lostSalesTotal = (shop.lostSalesTotal || 0) + lost;
  shop.fittingsYesterday = fittings;
  rollSalesWindow(state); // the day is done: today's per-SKU tally joins the seven-day window
  shop.lastAccruedDay = dayAbs;
  shop.lastAccrual = { dayAbs, shoppers, units, lost, lostToStock, lostToPrice, revenue: Math.round(revenue * 100) / 100, costOfGoods, rentalRevenue, fittings };
  return shop.lastAccrual;
}

// replacement rental sets
export function buyRentalSets(state, n = 1) {
  if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: 'Quantity must be a positive whole number.' };
  const cost = 220 * n;
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash.' };
  const commandId = state.shop.nextCommandId++;
  addExpense(state, 'rentalFleet', cost, {
    idempotencyKey: `rental-fleet:${commandId}`,
    relatedId: commandId,
    description: `${n} replacement rental set${n === 1 ? '' : 's'}`,
    source: 'shop-equipment',
    units: n,
  });
  state.shop.rentalFleet.sets += n;
  state.shop.rentalFleet.condition = clamp(
    (state.shop.rentalFleet.condition * (state.shop.rentalFleet.sets - n) + 100 * n) / state.shop.rentalFleet.sets,
    0, 100,
  );
  return { ok: true, cost };
}
