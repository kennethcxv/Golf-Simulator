// PACKAGING — a driver does not arrive in a glove box.
//
// Every delivery used to come in one identical 0.52 x 0.40 x 0.46 carton, so a golf bag and a
// sleeve of tees looked the same on the receiving pad and the stockroom read as a pile of clones.
// Packaging follows contents now, and the size lives HERE rather than inside the mesh builder, so
// the carton, its collider, how much of a doorway it blocks and how it stacks all agree.
//
// This file is the whole of packaging: what a thing ships in, how many go in one, how big that is,
// and what it weighs. `planShipment` below turns an order into a manifest — and that manifest is
// the ONLY place a shipment is packed. The laptop reads it to promise you three boxes and forty-one
// pounds; the receiving pad reads the same object to decide what to stand there. Pack it twice and
// the screen would drift a box away from the world, and you would never know which one was lying.
//
// Dimensions are yards. A yard is close enough to a metre for these to read at real-world scale.
// Weights are pounds, because that is what a shipping label says.

import { supplierFor, shipFee } from './suppliers.js';

export const BOX_KINDS = {
  carton: {
    id: 'carton', label: 'Accessories carton',
    w: 0.42, h: 0.30, d: 0.36, mass: 'light', tare: 0.6,
  },
  ballcase: {
    id: 'ballcase', label: 'Golf-ball case',
    w: 0.52, h: 0.34, d: 0.42, mass: 'heavy', tare: 0.9, // balls are dense: a full case is a lift
  },
  merchbox: {
    id: 'merchbox', label: 'Merchandise carton',
    // Reference 46: a general 60 x 40 x 40 cm shipping case. It remains a
    // distinct kind instead of silently enlarging the small accessories box.
    w: 0.60, h: 0.40, d: 0.40, mass: 'medium', tare: 1.1,
  },
  apparel: {
    id: 'apparel', label: 'Apparel carton',
    // Reference 47: 60 x 40 x 35 cm. Runtime axes are width, height, depth.
    w: 0.60, h: 0.35, d: 0.40, mass: 'light', tare: 1.0,
  },
  shoebox: {
    id: 'shoebox', label: 'Shoe carton',
    w: 0.58, h: 0.32, d: 0.44, mass: 'medium', tare: 0.6,
  },
  clubbox: {
    id: 'clubbox', label: 'Long club box',
    w: 1.32, h: 0.22, d: 0.30, mass: 'medium', tare: 1.3, // a driver is 45 inches of box
  },
  bagcarton: {
    id: 'bagcarton', label: 'Golf-bag carton',
    w: 0.72, h: 1.05, d: 0.52, mass: 'heavy', tare: 1.7, // tall enough to be a nuisance, which is the point
  },
  // the two the brief asked for that had nowhere to come from: the shop's own kit ships too.
  fixture: {
    id: 'fixture', label: 'Fixture package',
    w: 0.62, h: 0.55, d: 0.40, mass: 'heavy', tare: 2.6, // a pendant light, an events board, the vacuum
  },
  crate: {
    id: 'crate', label: 'Furniture crate',
    w: 1.25, h: 0.98, d: 0.85, mass: 'freight', tare: 14, // timber, banded, and you will feel it
  },
};

// The oversized lines, by id. Matching on the NAME is a trap: the catalogue has a "Tee bag", a
// "Bag towel" and an "Ironwood stand bag", and the shoes are called "spikes".
const KIND_BY_ID = {
  cap1: BOX_KINDS.merchbox,     // eight structured caps fit the reference-46 2 x 2 x 2 case
  bag1: BOX_KINDS.bagcarton,   // Ironwood stand bag
  shoe1: BOX_KINDS.shoebox,    // North Ridge spikes
  vac1: BOX_KINDS.fixture,     // the shop vacuum
  light1: BOX_KINDS.fixture,   // green pendant light
  board1: BOX_KINDS.fixture,   // events board
  poster1: BOX_KINDS.fixture,  // framed, glazed, flat
  rug1: BOX_KINDS.crate,       // rolled and crated: 24 lb of wool
  lounge1: BOX_KINDS.crate,    // a whole seating suite, flat-packed
  plant1: BOX_KINDS.carton,
};

// what a given product ships in
export function boxKindFor(sku) {
  if (!sku) return BOX_KINDS.carton;
  if (KIND_BY_ID[sku.id]) return KIND_BY_ID[sku.id];
  if (sku.cat === 'clubs') return BOX_KINDS.clubbox;
  if (sku.cat === 'balls') return BOX_KINDS.ballcase;
  if (sku.cat === 'apparel') return BOX_KINDS.apparel;
  return BOX_KINDS.carton; // gloves, tees, towels, markers
}

// --- how many go in one box ---------------------------------------------------------------
// The category default is a decent guess and a bad law. `bag1`'s category is 'accessories', which
// packs TWELVE to a carton — so the per-category rule alone would have shipped a dozen stand bags
// in one box, and the pad would have shown one carton where five belong.
const PER_BOX_CAT = { clubs: 2, balls: 12, apparel: 8, accessories: 12, supplies: 1, decor: 1 };
const PER_BOX_ID = {
  bag1: 1,      // one stand bag to a carton, and it is already an awkward carry
  irons1: 1,    // an iron set IS eight clubs; you do not get two sets in a sleeve
  irons2: 1,
  shoe1: 4,     // four pairs to a shoe carton
  range2: 4,    // fragile optics, individually padded
  umb1: 6,
  jacket2: 6,
};

export function unitsPerBox(sku) {
  if (!sku) return 12;
  return PER_BOX_ID[sku.id] || PER_BOX_CAT[sku.cat] || 12;
}

export function boxDims(kind) {
  const k = typeof kind === 'string' ? BOX_KINDS[kind] : kind;
  const b = k || BOX_KINDS.carton;
  return { w: b.w, h: b.h, d: b.d };
}

// how far a carton of this kind sticks out from the point it was set down — used by the collider
// and by "will this fit through the door with me"
export function boxRadius(kind) {
  const d = boxDims(kind);
  return Math.hypot(d.w, d.d) / 2;
}

// what a box of `qty` of this thing weighs, on the label, in pounds
export function boxWeight(sku, qty) {
  const kind = boxKindFor(sku);
  const unit = (sku && sku.lb) || 0.5;
  return Math.round((kind.tare + unit * qty) * 10) / 10;
}

// --- THE MANIFEST -------------------------------------------------------------------------
// One order in, one packing plan out. Pure: no state, no randomness, no clock. The same order
// always packs the same way, which is what lets the screen and the pad agree without either of
// them asking the other.
export function planShipment(sku, qty) {
  const supplier = supplierFor(sku);
  const kind = boxKindFor(sku);
  const per = unitsPerBox(sku);
  const boxes = [];
  let left = Math.max(0, Math.floor(qty));
  while (left > 0) {
    const n = Math.min(per, left);
    left -= n;
    boxes.push({
      kind: kind.id,
      qty: n,
      w: kind.w, h: kind.h, d: kind.d,
      lb: boxWeight(sku, n),
      fragile: !!(sku && sku.fragile),
    });
  }
  const weight = Math.round(boxes.reduce((a, b) => a + b.lb, 0) * 10) / 10;
  return {
    supplierId: supplier.id,
    supplier: supplier.name,
    boxes,
    boxCount: boxes.length,
    weight,
    fee: shipFee(supplier, boxes.length),
  };
}
