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

// what freight costs for a shipment of n boxes from this supplier
export function shipFee(supplier, boxCount) {
  const s = supplier || SUPPLIERS.fairway;
  return Math.round((s.feeBase + s.feePerBox * Math.max(1, boxCount)) * 100) / 100;
}
