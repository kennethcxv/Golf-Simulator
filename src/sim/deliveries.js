// PHYSICAL DELIVERIES — the truck leaves BOXES, not numbers. Contents enter
// the backroom only when a box is opened; carrying is one box at a time.
// Headless like every sim module; the clubhouse renders THIS state.

import { skuById } from '../data/shopItems.js';
import { boxKindFor, planShipment, boxWeight } from '../data/boxes.js';
import { armRoom, setCarry } from './stocking.js';

// kept for old callers; the truth is unitsPerBox(sku), which knows that a stand bag
// does not pack twelve to a carton just because its category says 'accessories'
export const CASE_SIZE = { clubs: 2, balls: 12, apparel: 8, accessories: 12, supplies: 1, decor: 1 };

// THE SIX STATUSES AN ORDER WEARS WHILE IT IS STILL OUT THERE. The other three
// ('delivered', 'partial', 'unpacked') belong to a shipment on your floor, not to
// an order on a van — see shipmentStatus. Six plus three is the brief's nine.
export const ORDER_FLOW = ['received', 'processing', 'packed', 'shipped', 'out', 'arriving'];

// How many cartons will physically stand on the receiving pad. A van cannot unload into a
// full pad, and pretending it can is how you end up with a tower of cardboard in the yard.
export const PAD_CAPACITY = 9;

export function initDeliveries(state) {
  state.shop.deliveries = {
    boxes: [], nextBoxId: 1, trash: 0, recycled: 0, shipments: [],
  };
}

export function ensureDeliveries(state) {
  if (!state.shop) return;
  if (!state.shop.deliveries) initDeliveries(state);
  const d = state.shop.deliveries;
  if (!d.shipments) d.shipments = [];        // saves written before shipments existed
  if (typeof d.recycled !== 'number') d.recycled = 0;
  if (state.shop.carry === undefined) state.shop.carry = null;

  // BOXES FROM BEFORE THE TAPE EXISTED (2026-07-14). An old save's box carries `cut: true` and
  // nothing else. Without this, tapeCut() reads `b.tape || 0` -> 0, and a box the player had
  // already opened would silently seal itself back up and demand to be cut again.
  for (const b of d.boxes) {
    if (b.tape === undefined) b.tape = (b.cut || b.opened) ? 1 : 0;
    if (!Array.isArray(b.flaps)) b.flaps = (b.cut || b.opened) ? [1, 1] : [0, 0];
    if (b.cap === undefined) b.cap = b.qty;   // best guess: what is in it is what it came with
    if (b.flat === undefined) b.flat = false;
    if (b.lb === undefined) {
      const sku = skuById(b.skuId);
      b.lb = boxWeight(sku, b.qty);
    }
  }
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

// --- WHAT STATE IS THIS BOX IN --------------------------------------------------------------
//
// The brief lists fourteen box states. They are not fourteen flags — they are three independent
// axes, and writing them as fourteen booleans is how you end up with a box that is both `empty`
// and `full` because two code paths disagreed. So: WHERE it is (loc), HOW SEALED it is (tape,
// flaps), and WHAT IS LEFT IN IT (qty against cap). Everything below is derived from those.
export const tapeUncut = (b) => (b.tape || 0) <= 0;
export const tapePartlyCut = (b) => (b.tape || 0) > 0 && (b.tape || 0) < 1;
export const tapeCut = (b) => (b.tape || 0) >= 1;
export const flapsClosed = (b) => !b.flaps || (b.flaps[0] <= 0 && b.flaps[1] <= 0);
export const flapsOpen = (b) => !!b.flaps && b.flaps[0] >= 1 && b.flaps[1] >= 1;
export const isEmpty = (b) => (b.qty || 0) <= 0;
export const isFull = (b) => (b.qty || 0) >= (b.cap || b.qty || 0);
export const isPartial = (b) => !isEmpty(b) && !isFull(b);
// "opened" in the everyday sense the screens use: someone has been at it
export const boxOpened = (b) => (b.tape || 0) > 0 || !!b.cut;

// one word for the whole box, for a label or a test
export function boxState(b) {
  if (b.recycled) return 'recycled';
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
  return (left < sh.units || opened) ? 'partial' : 'delivered';  // partially unpacked
}

// a shipment is done with when every box it brought has been recycled
export function retireShipments(state) {
  const d = state.shop.deliveries;
  if (!d.shipments) return;
  const live = new Set(d.boxes.map((b) => b.orderId));
  d.shipments = d.shipments.filter((s) => live.has(s.orderId));
}

// an order landed: stand its manifest on the receiving pad, box for box.
//
// The manifest was packed once, at order time (data/boxes.js planShipment), and the laptop has
// already promised it to you. So this does NOT re-pack — it reads. Re-packing here is how the
// screen and the pad end up one box apart with nobody able to say which is right.
export function arriveOrder(state, order) {
  ensureDeliveries(state);
  const d = state.shop.deliveries;
  const sku = skuById(order.skuId);
  const manifest = order.manifest || planShipment(sku, order.qty);
  const made = [];
  for (const b of manifest.boxes) {
    made.push({
      id: d.nextBoxId++,
      skuId: order.skuId,
      orderId: order.id,
      qty: b.qty,
      cap: b.qty,             // what it shipped with — 'partial contents' means qty < cap
      lb: b.lb,
      box: b.kind,
      fragile: !!b.fragile,
      loc: 'pad',
      tape: 0,                // 0 uncut · 0<t<1 partially cut · 1 cut
      flaps: [0, 0],          // two flaps, each 0 closed .. 1 open
      flat: false,
    });
  }
  d.boxes.push(...made);
  d.shipments.push({
    orderId: order.id,
    skuId: order.skuId,
    supplier: manifest.supplier,
    units: order.qty,
    boxCount: manifest.boxCount,
    weight: manifest.weight,
    landedMin: (state.clock && state.clock.minutes) || 0,
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

export function pickUpBox(state, id) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (carriedBox(state)) return { ok: false, reason: 'Your arms are full — set that one down first.' };
  // arms are arms: a box OR an armful of goods, never both
  const goods = state.shop.carry;
  if (goods) {
    const sku = skuById(goods.skuId);
    return { ok: false, reason: `Not with your arms full of ${(sku ? sku.name : 'stock').toLowerCase()}.` };
  }
  box.loc = 'carried';
  return { ok: true, box };
}

// spot: {x, z, ry} places the box exactly there in the world (building-local
// coords) — the normal path; the legacy zone strings keep old callers working
export function putDownBox(state, id, spot = 'stock') {
  const box = findBox(state, id);
  if (!box || box.loc !== 'carried') return { ok: false, reason: 'Not carrying that.' };
  if (spot && typeof spot === 'object') {
    box.loc = 'world';
    box.x = spot.x;
    box.z = spot.z;
    box.ry = spot.ry || 0;
  } else {
    box.loc = spot === 'pad' ? 'pad' : 'stock';
    delete box.x;
    delete box.z;
    delete box.ry;
  }
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
  const before = box.tape || 0;
  box.tape = Math.min(1, before + Math.max(0, amount));
  return {
    ok: true,
    tape: box.tape,
    seam: before < CENTRE_SEAM ? 'centre' : 'side',
    done: box.tape >= 1,
  };
}

// --- the flaps -----------------------------------------------------------------------------------
// Two of them. They open one at a time, and not through the tape.
export function openFlap(state, id) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  if (!tapeCut(box)) return { ok: false, reason: 'Cut the tape first.' };
  if (!box.flaps) box.flaps = [0, 0];
  const i = box.flaps.findIndex((f) => f < 1);
  if (i < 0) return { ok: false, reason: 'Both flaps are open.', done: true };
  box.flaps[i] = 1;
  return { ok: true, flap: i, done: flapsOpen(box) };
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

  const room = armRoom(state, box.skuId);
  if (room <= 0) {
    const c = state.shop.carry;
    const holding = c && c.skuId !== box.skuId ? skuById(c.skuId) : null;
    return {
      ok: false,
      reason: holding
        ? `You are already carrying ${holding.name.toLowerCase()} — put those down first.`
        : 'Your arms are full — go and put those down.',
    };
  }

  const taken = Math.min(want == null ? room : want, room, box.qty);
  box.qty -= taken;
  const c = state.shop.carry;
  setCarry(state, box.skuId, (c ? c.qty : 0) + taken);
  if (box.qty <= 0) {
    const d = state.shop.deliveries;
    d.openedTotal = (d.openedTotal || 0) + 1;   // lifetime unboxings (onboarding reads this)
  }
  return { ok: true, taken, left: box.qty, carrying: state.shop.carry.qty };
}

// --- the cardboard ----------------------------------------------------------------------------
// An empty carton is not gone. You break it down, you carry it to the bin, and THEN it is gone.

export function flattenBox(state, id) {
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  if (box.flat) return { ok: false, reason: 'Already flat.' };
  if (!isEmpty(box)) return { ok: false, reason: 'Still has stock in it.' };
  box.flat = true;
  box.flaps = [1, 1];
  const d = state.shop.deliveries;
  d.trash = (d.trash || 0) + 1;
  return { ok: true };
}

export function recycleBox(state, id) {
  const d = state.shop.deliveries;
  const box = findBox(state, id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (!box.flat) return { ok: false, reason: 'Break it down flat first.' };
  d.boxes.splice(d.boxes.indexOf(box), 1);
  d.recycled = (d.recycled || 0) + 1;
  d.trash = Math.max(0, (d.trash || 0) - 1);
  retireShipments(state);
  return { ok: true };
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
  const inv = state.shop.inventory[box.skuId];
  const qty = box.qty;
  if (inv) inv.back += qty;
  box.qty = 0;
  d.boxes.splice(d.boxes.indexOf(box), 1);
  // they break it down and stack it by the bin — the cardboard does not evaporate just because
  // somebody else handled it. `trash` is what is waiting to go out; `recycled` is what has gone.
  d.trash = (d.trash || 0) + 1;
  d.openedTotal = (d.openedTotal || 0) + 1;
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
