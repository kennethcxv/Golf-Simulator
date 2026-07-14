// PACKAGING — a driver does not arrive in a glove box.
//
// Every delivery used to come in one identical 0.52 x 0.40 x 0.46 carton, so a golf bag and a
// sleeve of tees looked the same on the receiving pad and the stockroom read as a pile of clones.
// Packaging follows contents now, and the size lives HERE rather than inside the mesh builder, so
// the carton, its collider, how much of a doorway it blocks and how it stacks all agree.
//
// Dimensions are yards. A yard is close enough to a metre for these to read at real-world scale.

export const BOX_KINDS = {
  carton: {
    id: 'carton', label: 'Accessories carton',
    w: 0.42, h: 0.30, d: 0.36, mass: 'light',
  },
  ballcase: {
    id: 'ballcase', label: 'Golf-ball case',
    w: 0.52, h: 0.34, d: 0.42, mass: 'heavy', // balls are dense: a full case is a lift
  },
  apparel: {
    id: 'apparel', label: 'Apparel carton',
    w: 0.66, h: 0.40, d: 0.50, mass: 'light', // big and airy
  },
  shoebox: {
    id: 'shoebox', label: 'Shoe carton',
    w: 0.58, h: 0.32, d: 0.44, mass: 'medium',
  },
  clubbox: {
    id: 'clubbox', label: 'Long club box',
    w: 1.32, h: 0.22, d: 0.30, mass: 'medium', // a driver is 45 inches of box
  },
  bagcarton: {
    id: 'bagcarton', label: 'Golf-bag carton',
    w: 0.72, h: 1.05, d: 0.52, mass: 'heavy', // tall enough to be a nuisance, which is the point
  },
};

// The oversized lines, by id. Matching on the NAME is a trap: the catalogue has a "Tee bag", a
// "Bag towel" and an "Ironwood stand bag", and the shoes are called "spikes".
const BY_ID = {
  bag1: BOX_KINDS.bagcarton, // Ironwood stand bag
  shoe1: BOX_KINDS.shoebox, // North Ridge spikes
};

// what a given product ships in
export function boxKindFor(sku) {
  if (!sku) return BOX_KINDS.carton;
  if (BY_ID[sku.id]) return BY_ID[sku.id];
  if (sku.cat === 'clubs') return BOX_KINDS.clubbox;
  if (sku.cat === 'balls') return BOX_KINDS.ballcase;
  if (sku.cat === 'apparel') return BOX_KINDS.apparel;
  return BOX_KINDS.carton; // gloves, tees, towels, markers, the vacuum
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
