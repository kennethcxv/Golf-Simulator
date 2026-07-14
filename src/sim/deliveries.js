// PHYSICAL DELIVERIES — the truck leaves BOXES, not numbers. Contents enter
// the backroom only when a box is opened; carrying is one box at a time.
// Headless like every sim module; the clubhouse renders THIS state.

import { skuById } from '../data/shopItems.js';
import { boxKindFor, planShipment } from '../data/boxes.js';

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

// spot: {x, z, ry} places the box exactly there in the world (building-local
// coords) — the normal path; the legacy zone strings keep old callers working
export function putDownBox(state, id, spot = 'stock') {
  const box = boxesOf(state).find((b) => b.id === id);
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

// --- physical opening: cut → take armfuls → flatten the empty ---------------------

export function cutBox(state, id) {
  const box = boxesOf(state).find((b) => b.id === id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  if (box.cut) return { ok: false, reason: 'Already open.' };
  box.cut = true;
  return { ok: true };
}

// an armful at a time — a big case takes more than one trip into the backroom
export function takeFromBox(state, id, max = 6) {
  const box = boxesOf(state).find((b) => b.id === id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (box.loc === 'carried') return { ok: false, reason: 'Set it down first.' };
  if (!box.cut) return { ok: false, reason: 'Cut the tape first.' };
  if (box.qty <= 0) return { ok: false, reason: 'It is empty.' };
  const taken = Math.min(max, box.qty);
  box.qty -= taken;
  const inv = state.shop.inventory[box.skuId];
  if (inv) inv.back += taken;
  if (box.qty <= 0) {
    box.empty = true;
    const d = state.shop.deliveries;
    d.openedTotal = (d.openedTotal || 0) + 1;
  }
  return { ok: true, taken, left: box.qty };
}

export function flattenBox(state, id) {
  const d = state.shop.deliveries;
  const box = d.boxes.find((b) => b.id === id);
  if (!box) return { ok: false, reason: 'No box there.' };
  if (!box.empty) return { ok: false, reason: 'Still has stock in it.' };
  d.boxes.splice(d.boxes.indexOf(box), 1);
  d.trash += 1;
  return { ok: true };
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
  d.openedTotal = (d.openedTotal || 0) + 1; // lifetime unboxings (onboarding reads this)
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
