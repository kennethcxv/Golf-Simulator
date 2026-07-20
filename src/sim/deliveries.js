// PHYSICAL DELIVERIES — the truck leaves BOXES, not numbers. Contents enter
// the backroom only when a box is opened; carrying is one box at a time.
// Headless like every sim module; the clubhouse renders THIS state.

import { skuById } from '../data/shopItems.js';
import { boxKindFor, planShipment, boxWeight } from '../data/boxes.js';
import { armRoom, setCarry } from './stocking.js';
import {
  ensureArrivalOrder,
  openBoxInventory,
  receiveBoxInventory,
  refreshOrderFromLedger,
  takeBoxInventory,
} from './inventoryLifecycle.js';

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
export const FALLBACK_CAPACITY = 12;

export function initDeliveries(state) {
  state.shop.deliveries = {
    boxes: [], nextBoxId: 1, trash: 0, recycled: 0, shipments: [], arrivedOrderIds: [],
  };
}

export function ensureDeliveries(state) {
  if (!state.shop) return;
  if (!state.shop.deliveries) initDeliveries(state);
  const d = state.shop.deliveries;
  if (!d.shipments) d.shipments = [];        // saves written before shipments existed
  if (!Array.isArray(d.arrivedOrderIds)) {
    d.arrivedOrderIds = [...new Set(d.shipments.map((shipment) => shipment.orderId).filter((id) => id != null))];
  }
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
    b.persistentId = b.persistentId || `box-${b.id}`;
    b.parentOrderId = b.parentOrderId ?? b.orderId ?? null;
    b.initialQuantity = Number.isSafeInteger(b.initialQuantity) ? b.initialQuantity : b.cap;
    b.remainingQuantity = Number.isSafeInteger(b.remainingQuantity) ? b.remainingQuantity : b.qty;
    b.weightClass = b.weightClass || (b.lb >= 40 ? 'heavy' : b.lb >= 16 ? 'medium' : 'light');
    b.openedState = b.openedState || (boxOpened(b) ? 'opened' : 'unopened');
    b.currentLocation = b.currentLocation || b.loc || 'stock';
    b.currentCarrier = b.currentCarrier || (b.loc === 'carried' ? 'player' : null);
    b.damageState = b.damageState || 'intact';
    b.disposalState = b.disposalState || (b.flat ? 'flattened' : 'active');
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

export function fallbackCount(state) {
  return boxesOf(state).filter((box) => box.loc === 'receiving-fallback').length;
}

export function fallbackHasRoom(state, n) {
  return fallbackCount(state) + n <= FALLBACK_CAPACITY;
}

export function receivingFree(state) {
  return Math.max(0, PAD_CAPACITY - padCount(state))
    + Math.max(0, FALLBACK_CAPACITY - fallbackCount(state));
}

export function receivingHasRoom(state, n) {
  return receivingFree(state) >= n;
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
  const receivedUnits = Number.isSafeInteger(sh.receivedUnits) ? sh.receivedUnits : sh.units;
  return (left < receivedUnits || opened) ? 'partial' : 'delivered';  // partially unpacked
}

// a shipment is done with when every box it brought has been recycled
export function retireShipments(state) {
  const d = state.shop.deliveries;
  if (!d.shipments) return;
  const live = new Set(d.boxes.map((b) => b.orderId));
  for (const order of state.shop.orders || []) live.add(order.id);
  d.shipments = d.shipments.filter((s) => live.has(s.orderId));
}

// an order landed: stand its manifest on the receiving pad, box for box.
//
// The manifest was packed once, at order time (data/boxes.js planShipment), and the laptop has
// already promised it to you. So this does NOT re-pack — it reads. Re-packing here is how the
// screen and the pad end up one box apart with nobody able to say which is right.
export function arriveOrder(state, order, { maxBoxes = Infinity } = {}) {
  ensureDeliveries(state);
  const deliveries = state.shop.deliveries;
  if (deliveries.arrivedOrderIds.includes(order.id)) {
    return deliveries.boxes.filter((box) => box.orderId === order.id);
  }
  const sku = skuById(order.skuId);
  const manifest = order.manifest || planShipment(sku, order.qty);
  if (!manifest || !Array.isArray(manifest.boxes) || !manifest.boxes.length) return [];
  const recordedOrder = ensureArrivalOrder(state, { ...order, manifest });
  if (!recordedOrder) return [];
  order = recordedOrder;
  order.receivedManifestBoxIndexes = Array.isArray(order.receivedManifestBoxIndexes)
    ? order.receivedManifestBoxIndexes
    : [];
  const receivedIndexes = new Set(order.receivedManifestBoxIndexes);
  const pending = manifest.boxes
    .map((box, index) => ({ box, index }))
    .filter((entry) => !receivedIndexes.has(entry.index));
  const take = Math.min(pending.length, receivingFree(state), Math.max(0, Math.floor(maxBoxes)));
  if (take <= 0) return [];
  const landing = pending.slice(0, take);

  let padFree = Math.max(0, PAD_CAPACITY - padCount(state));
  let fallbackSlot = fallbackCount(state);
  const made = [];
  for (const { box: manifestBox, index: manifestIndex } of landing) {
    const id = deliveries.nextBoxId++;
    const skuId = manifestBox.skuId || order.skuId;
    const lineId = manifestBox.lineId
      || (order.lines && order.lines.find((line) => line.skuId === skuId)?.id)
      || `${order.id}-line-1`;
    const loc = padFree > 0 ? 'pad' : 'receiving-fallback';
    const receivingSlot = loc === 'pad' ? PAD_CAPACITY - padFree : fallbackSlot++;
    if (padFree > 0) padFree--;
    const received = receiveBoxInventory(state, order.id, id, [{
      lineId,
      skuId,
      quantity: manifestBox.qty,
    }]);
    if (!received.ok) return [];
    made.push({
      id,
      persistentId: `box-${id}`,
      skuId,
      orderId: order.id,
      parentOrderId: order.id,
      supplierId: manifest.supplierId || order.supplierId || null,
      supplier: manifest.supplier || order.supplier || null,
      qty: manifestBox.qty,
      initialQuantity: manifestBox.qty,
      remainingQuantity: manifestBox.qty,
      cap: manifestBox.qty,
      lb: manifestBox.lb,
      weightClass: manifestBox.lb >= 40 ? 'heavy' : manifestBox.lb >= 16 ? 'medium' : 'light',
      box: manifestBox.kind,
      fragile: !!manifestBox.fragile,
      contents: received.contents,
      loc,
      currentLocation: loc,
      receivingSlot,
      currentCarrier: null,
      tape: 0,
      flaps: [0, 0],
      openedState: 'unopened',
      inventoryOpened: false,
      damageState: 'intact',
      disposalState: 'active',
      manifestIndex,
      flat: false,
    });
    order.receivedManifestBoxIndexes.push(manifestIndex);
  }
  deliveries.boxes.push(...made);
  const complete = order.receivedManifestBoxIndexes.length >= manifest.boxes.length;
  if (complete) deliveries.arrivedOrderIds.push(order.id);
  let shipment = deliveries.shipments.find((candidate) => candidate.orderId === order.id);
  if (!shipment) {
    shipment = {
      orderId: order.id,
      skuId: order.skuId || null,
      lines: (order.lines || []).map((line) => ({ skuId: line.skuId, quantity: line.quantity })),
      supplier: manifest.supplier,
      units: order.quantity || order.qty,
      receivedUnits: 0,
      boxCount: manifest.boxCount,
      receivedBoxCount: 0,
      weight: manifest.weight,
      boxIds: [],
      usedFallback: false,
      landedMin: (state.clock && state.clock.minutes) || 0,
    };
    deliveries.shipments.push(shipment);
  }
  shipment.boxIds.push(...made.map((box) => box.id));
  shipment.receivedBoxCount += made.length;
  shipment.receivedUnits += made.reduce((sum, box) => sum + box.initialQuantity, 0);
  shipment.usedFallback ||= made.some((box) => box.loc === 'receiving-fallback');
  shipment.lastLandedMin = (state.clock && state.clock.minutes) || 0;
  refreshOrderFromLedger(state, order.id);
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
  box.currentLocation = 'carried';
  box.currentCarrier = 'player';
  return { ok: true, box };
}

// spot: {x, z, ry} places the box exactly there in the world (building-local
// coords) — the normal path; the legacy zone strings keep old callers working
export function putDownBox(state, id, spot = 'stock') {
  const box = findBox(state, id);
  if (!box || box.loc !== 'carried') return { ok: false, reason: 'Not carrying that.' };
  if (spot && typeof spot === 'object') {
    box.loc = 'world';
    box.currentLocation = 'world';
    box.x = spot.x;
    box.z = spot.z;
    box.ry = spot.ry || 0;
  } else {
    box.loc = spot === 'pad' ? 'pad' : spot === 'receiving-fallback' ? 'receiving-fallback' : 'stock';
    box.currentLocation = box.loc;
    delete box.x;
    delete box.z;
    delete box.ry;
  }
  box.currentCarrier = null;
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
  if (!box.inventoryOpened) {
    const opened = openBoxInventory(state, box);
    if (!opened.ok && !opened.done) return opened;
  }
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
  const c = state.shop.carry;
  const before = box.qty;
  const moved = takeBoxInventory(
    state,
    box,
    box.skuId,
    taken,
    `take-box:${box.id}:${box.cap - before}:${taken}`,
  );
  if (!moved.ok) return moved;
  const allocations = [...((c && c.allocations) || []), ...moved.allocations];
  setCarry(state, box.skuId, (c ? c.qty : 0) + taken, allocations);
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
  box.disposalState = 'flattened';
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
  if (!box.inventoryOpened) {
    const opened = openBoxInventory(state, box);
    if (!opened.ok && !opened.done) return opened;
  }
  if (qty > 0) {
    const unpacked = takeBoxInventory(state, box, box.skuId, qty, `staff-unpack-box:${box.id}`);
    if (!unpacked.ok) return unpacked;
  }
  if (inv) inv.back += qty;
  d.boxes.splice(d.boxes.indexOf(box), 1);
  box.recycled = true;
  box.disposalState = 'recycled';
  // they break it down and stack it by the bin — the cardboard does not evaporate just because
  // somebody else handled it. `trash` is what is waiting to go out; `recycled` is what has gone.
  d.trash = (d.trash || 0) + 1;
  d.openedTotal = (d.openedTotal || 0) + 1;
  box.disposalState = 'flattened';
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
