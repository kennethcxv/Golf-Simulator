// WHO THE BOXES COME FROM.
//
// Stock used to materialise from nowhere: you paid a number and cardboard appeared. A delivery has
// a sender, and the sender is why the freight costs what it costs — a set of irons crosses the
// country in a long box on a pallet, a dozen tee bags go in the back of a van with everything else.
//
// The fee is base + per-box, because that is how freight actually prices: a second carton on the
// same van is cheap, but the van still has to come. It makes the order screen say something true —
// ordering two of a thing and two of another thing on separate days pays the base twice.
//
// The name on the label is the name here. Nothing else generates it.

export const SUPPLIERS = {
  fairway: {
    id: 'fairway',
    name: 'Fairway Supply Co.',
    cats: ['balls', 'accessories', 'provisions'],
    feeBase: 9,
    feePerBox: 3,
  },
  ironwood: {
    id: 'ironwood',
    name: 'Ironwood Golf',
    cats: ['clubs'],
    feeBase: 18,       // long boxes, insured, slow
    feePerBox: 7,
  },
  sunday: {
    id: 'sunday',
    name: 'Sunday Round Apparel',
    cats: ['apparel'],
    feeBase: 12,
    feePerBox: 4,
  },
  depot: {
    id: 'depot',
    name: 'Greenkeeper Depot',
    cats: ['supplies', 'decor'],
    feeBase: 26,       // fixtures and furniture ship freight, and freight is not cheap
    feePerBox: 14,
  },
};

const BY_CAT = {};
for (const s of Object.values(SUPPLIERS)) {
  for (const c of s.cats) BY_CAT[c] = s;
}

export function supplierFor(sku) {
  if (!sku) return SUPPLIERS.fairway;
  return BY_CAT[sku.cat] || SUPPLIERS.fairway;
}

// PAYING FOR TIME.
//
// Two services, and the difference has to be legible at the moment of choosing:
// express takes a day off the wait and costs two and a half times the freight.
// One multiplier rather than a base-plus-percentage, so the player can see what
// the second van costs without doing arithmetic — and because it scales with
// the size of the shipment, rushing a pallet of fixtures costs real money while
// rushing a couple of boxes of balls does not.
//
// A day off is the whole point. Standard is one day for most lines (two for
// clubs and fixtures), so express usually means "today" against "tomorrow" —
// the shortest possible sentence for what the money bought.
export const SHIPPING_SPEEDS = Object.freeze({
  standard: Object.freeze({ id: 'standard', label: 'Standard', feeMultiplier: 1, daysSaved: 0 }),
  express: Object.freeze({ id: 'express', label: 'Express', feeMultiplier: 2.5, daysSaved: 1 }),
});

export const DEFAULT_SHIPPING_SPEED = 'standard';

export function shippingSpeed(id) {
  return SHIPPING_SPEEDS[id] || SHIPPING_SPEEDS[DEFAULT_SHIPPING_SPEED];
}

// what freight costs for a shipment of n boxes from this supplier
export function shipFee(supplier, boxCount, speedId = DEFAULT_SHIPPING_SPEED) {
  const s = supplier || SUPPLIERS.fairway;
  const base = s.feeBase + s.feePerBox * Math.max(1, boxCount);
  return Math.round(base * shippingSpeed(speedId).feeMultiplier * 100) / 100;
}

// An order never arrives sooner than the same day, however much is paid.
export function shippingLeadDays(leadDays, speedId = DEFAULT_SHIPPING_SPEED) {
  return Math.max(0, leadDays - shippingSpeed(speedId).daysSaved);
}
