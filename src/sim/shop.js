// FAIRWAY STATE — pro shop simulation: inventory, supplier orders, pricing,
// daily shopper flow, fittings, and rentals. Headless like every sim module;
// the walkable 3D shop is a live window onto THIS state, never a second sim.
//
// Customers are deliberately reactive, not autonomous: how many come follows
// rounds played + members + reputation; what they buy follows what is actually
// on the shelves, how it's priced, and whether anyone is working the floor.

import { rngOf, clamp, makeRng } from '../core/utils.js';
import { calendarOf } from './time.js';
import { addRevenue, addExpense } from './economy.js';
import { SHOP_CATALOG, skuById, LEAD_DAYS, SHELF_CAP, RETAIL_CATS, DECOR_SPOTS } from '../data/shopItems.js';
import { INTERIOR, CLUTTER_SPOTS } from '../data/shopLayout.js';
import { arriveOrder, openAllBoxes, ensureDeliveries } from './deliveries.js';
import { ROLE, bestSkill } from './staff.js';
import { TIERS } from './club.js';
import { members } from './golfers.js';

// --- restoration arc ------------------------------------------------------------
// The shop starts rundown and is cleaned/furnished up by hand: a grime grid over
// the floor (vacuumed patch by patch), clutter piles to haul out, and decor the
// player orders and places. Condition 0-100 is DERIVED from that state, never
// stored, so it can't drift: cleanliness carries 70 points, decor finish 30.
export const RENO = {
  room: { w: INTERIOR.w, d: INTERIOR.d }, // the clubhouse plan's interior (shopLayout.js)
  grid: { w: 13, h: 8 },       // ~2-yd grime cells over the whole floor (stockroom included)
  startDirt: [0.58, 0.95],     // fresh-game dirt range per cell
  cleanRadius: 1.3,            // yards a vacuum pass reaches
  clutterWipe: 0.5,            // dirt removed under a hauled-out pile
  finishCap: 30,               // max condition points decor can supply
  trafficGrime: 0.0011,        // dirt tracked in per shopper per day, per cell
  trafficCap: 0.5,             // traffic alone plateaus at "needs a pass", never "wrecked"
};

function renoRng(state) {
  // a LOCAL stream derived from the save seed — reno must never consume
  // state.rngState, or adding it would shift every draw that follows
  return makeRng(((state.seed >>> 0) ^ 0x51c7) || 1);
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
  state.shop.reno = { grime, clutter, decor: [] };
}

export function ensureShopReno(state) {
  if (!state.shop) return;
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
  if (reno.clutter.length !== CLUTTER_SPOTS.length || reno.clutter.some(outsideRoom)) {
    const flags = reno.clutter.map((c) => !!c.cleared);
    const allCleared = flags.length > 0 && flags.every(Boolean);
    const rng = renoRng(state);
    reno.clutter = CLUTTER_SPOTS.map((s, i) => ({
      x: Math.round((s.x + rng.range(-0.4, 0.4)) * 100) / 100,
      z: Math.round((s.z + rng.range(-0.3, 0.3)) * 100) / 100,
      ry: Math.round(rng.range(0, Math.PI * 2) * 100) / 100,
      cleared: i < flags.length ? flags[i] : allCleared,
    }));
  }

  // saves written before a catalog item existed need its inventory slot
  for (const sku of SHOP_CATALOG) {
    if (!state.shop.inventory[sku.id]) state.shop.inventory[sku.id] = { shelf: 0, back: 0 };
  }
  ensureDeliveries(state); // physical-retail block (2026-07-13)
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
  inv.back -= 1;
  reno.decor.push({ skuId, spot });
  return { ok: true };
}

// pack a placed piece back up: the spot frees, the item returns to the backroom
export function removeDecor(state, skuId, spot) {
  const reno = state.shop && state.shop.reno;
  if (!reno) return { ok: false };
  const idx = reno.decor.findIndex((d) => d.skuId === skuId && d.spot === spot);
  if (idx < 0) return { ok: false };
  reno.decor.splice(idx, 1);
  const inv = state.shop.inventory[skuId];
  if (inv) inv.back += 1;
  return { ok: true };
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
    unlockedTier: 2, // premium (tier 3) lines arrive with progression
    inventory,
    orders: [],
    nextOrderId: 1,
    markup: { clubs: 1.0, balls: 1.0, apparel: 1.0, accessories: 1.0 },
    featureCategory: 'balls', // the front table the player merchandises
    rentalFleet: { sets: 3, condition: 55, pricePerRound: 18 },
    deliveries: { boxes: [], nextBoxId: 1, trash: 0 },
    lostSalesYesterday: 0,
    lostSalesTotal: 0,
    salesYesterday: { units: 0, revenue: 0 },
    fittingsYesterday: 0,
    log: [], // recent notable sales for the panel/3D flavor
  };
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

export function placeOrder(state, skuId, qty) {
  const sku = skuById(skuId);
  if (!sku) return { ok: false, reason: 'No such item.' };
  if (sku.tier > state.shop.unlockedTier) return { ok: false, reason: 'Supplier account not unlocked yet.' };
  const cost = orderCost(sku, qty);
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash.' };
  addExpense(state, 'shopOrders', cost);
  const dayAbs = calendarOf(state.clock.minutes).dayAbs;
  state.shop.orders.push({
    id: state.shop.nextOrderId++,
    skuId,
    qty,
    cost,
    arrivesDay: dayAbs + LEAD_DAYS[sku.cat],
  });
  return { ok: true, cost };
}

export function deliverOrdersDue(state, dayAbs) {
  const arrived = state.shop.orders.filter((o) => o.arrivesDay <= dayAbs);
  state.shop.orders = state.shop.orders.filter((o) => o.arrivesDay > dayAbs);
  // 2026-07-13 physical retail: arrivals are BOXES on the receiving pad —
  // contents reach the backroom when someone opens them (you, or the
  // morning floor staff in restockShelvesByStaff)
  for (const o of arrived) {
    arriveOrder(state, o);
  }
  return arrived;
}

// --- restocking ------------------------------------------------------------------------

export function shelfCapacity(sku) {
  return SHELF_CAP[sku.cat];
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
  const inv = state.shop.inventory[skuId];
  const space = shelfCapacity(sku) - inv.shelf;
  const move = Math.min(space, inv.back);
  if (move <= 0) return { ok: false, reason: inv.back <= 0 ? 'Backroom is empty.' : 'Shelf is full.' };
  inv.back -= move;
  inv.shelf += move;
  return { ok: true, moved: move };
}

// floor staff work through the backroom each morning; skill = how much gets out
export function restockShelvesByStaff(state) {
  const skill = bestSkill(state, ROLE.PROSHOP);
  if (skill <= 0) return 0;
  openAllBoxes(state); // the crew unboxes the truck's drop before shelving
  let capacity = 30 + skill * 25; // units they can shelve in a morning
  let moved = 0;
  for (const sku of SHOP_CATALOG) {
    if (capacity <= 0) break;
    if (!RETAIL_CATS.has(sku.cat)) continue; // your vacuum is not for sale
    const inv = state.shop.inventory[sku.id];
    const space = shelfCapacity(sku) - inv.shelf;
    const move = Math.min(space, inv.back, capacity);
    if (move > 0) {
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
  };
  return table[cat][seasonIndex];
}

export function shopOpenStock(state) {
  let units = 0;
  for (const inv of Object.values(state.shop.inventory)) units += inv.shelf;
  return units;
}

// --- the daily pass (called from the midnight accrual) -----------------------------------------

export function shopDailyAccrual(state) {
  const shop = state.shop;
  const rng = rngOf(state);
  const cal = calendarOf(state.clock.minutes);
  const seasonIndex = cal.seasonIndex;
  const rounds = state.club.lastRounds || 0;
  const ms = members(state);

  const floorSkill = bestSkill(state, ROLE.PROSHOP);
  const proOnFloor = floorSkill > 0;

  // staff shelve stock before the doors open
  restockShelvesByStaff(state);

  // shopper flow: players on the course + member drop-ins + reputation walk-ins
  const shoppers = Math.round(
    rounds * 0.45 + ms.length * 0.1 + state.club.reputation * 0.05 + rng.next() * 3,
  );

  let revenue = 0;
  let units = 0;
  let lost = 0;
  shop.log = [];

  const catalogByCat = {};
  for (const sku of SHOP_CATALOG) {
    if (sku.tier > shop.unlockedTier) continue;
    if (!RETAIL_CATS.has(sku.cat)) continue; // supplies/decor never reach shoppers
    (catalogByCat[sku.cat] ||= []).push(sku);
  }

  for (let i = 0; i < shoppers; i++) {
    // who is shopping? members carry their tier discount and their feelings
    const member = ms.length && rng.chance(0.45) ? ms[rng.int(ms.length)] : null;
    const wealth = member ? member.wealth : 1 + rng.int(3);

    // what did they come in wanting?
    const catRoll = rng.next();
    let cat;
    const wBalls = 0.44 * demandWeight('balls', seasonIndex);
    const wAcc = 0.2 * demandWeight('accessories', seasonIndex);
    const wApp = 0.24 * demandWeight('apparel', seasonIndex);
    const wClubs = 0.12 * demandWeight('clubs', seasonIndex);
    const total = wBalls + wAcc + wApp + wClubs;
    if (catRoll < wBalls / total) cat = 'balls';
    else if (catRoll < (wBalls + wAcc) / total) cat = 'accessories';
    else if (catRoll < (wBalls + wAcc + wApp) / total) cat = 'apparel';
    else cat = 'clubs';

    // the feature table nudges attention toward what you merchandise
    if (shop.featureCategory && rng.chance(0.15)) cat = shop.featureCategory;

    const options = (catalogByCat[cat] || []).filter((s) => {
      if (s.coldSeason && (seasonIndex === 1)) return false; // no storm shells in July
      return state.shop.inventory[s.id].shelf > 0;
    });

    if (!options.length) {
      lost++;
      if (member) member.satisfaction = clamp(member.satisfaction - 2, 0, 100);
      continue;
    }

    // wealthier shoppers reach for higher tiers when stocked
    options.sort((a, b) => a.tier - b.tier);
    const pickIdx = clamp(Math.floor((wealth - 1 + rng.next()) / 4 * options.length), 0, options.length - 1);
    const sku = options[pickIdx];

    let accept = priceAcceptance(shop.markup[cat], wealth, sku.tier);
    if (cat === 'clubs') accept *= proOnFloor ? 0.55 + floorSkill * 0.14 : 0.3; // big tickets need help
    else if (proOnFloor) accept *= 1 + floorSkill * 0.03;

    if (rng.chance(clamp(accept, 0, 0.97))) {
      const price = priceFor(sku, shop.markup[cat], member ? member.memberTier : null);
      revenue += price;
      units++;
      state.shop.inventory[sku.id].shelf--;
      if (member) member.satisfaction = clamp(member.satisfaction + (cat === 'clubs' ? 3 : 0.6), 0, 100);
      if (price > 80 || rng.chance(0.12)) {
        shop.log.unshift(`${member ? member.name : 'A visitor'} bought the ${sku.name} (${Math.round(price)} dollars)`);
        if (shop.log.length > 8) shop.log.pop();
      }
    }
  }

  if (revenue > 0) addRevenue(state, 'shopSales', revenue);

  // --- rentals: guests without clubs -------------------------------------------
  const fleet = shop.rentalFleet;
  let rentalRevenue = 0;
  if (fleet.sets > 0 && fleet.condition > 15) {
    const guests = Math.max(0, rounds - ms.length * 0.3);
    const renters = Math.min(Math.round(guests * 0.16), fleet.sets * 2);
    if (renters > 0) {
      rentalRevenue = renters * fleet.pricePerRound;
      addRevenue(state, 'rentals', rentalRevenue);
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
      addRevenue(state, 'fittings', fittings * 120);
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
}

// replacement rental sets
export function buyRentalSets(state, n = 1) {
  const cost = 220 * n;
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash.' };
  addExpense(state, 'rentalFleet', cost);
  state.shop.rentalFleet.sets += n;
  state.shop.rentalFleet.condition = clamp(
    (state.shop.rentalFleet.condition * (state.shop.rentalFleet.sets - n) + 100 * n) / state.shop.rentalFleet.sets,
    0, 100,
  );
  return { ok: true, cost };
}
