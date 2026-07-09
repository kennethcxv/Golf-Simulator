// FAIRWAY STATE — pro shop catalog.
// tier 1 = value, 2 = standard, 3 = premium (premium lines unlock via progression).
// cost = what the supplier charges you; msrp = the book price a 1.0 markup sells at.

export const SHOP_CATALOG = [
  // clubs — the big-ticket, assisted-sale items
  { id: 'driver1', cat: 'clubs', tier: 1, name: 'Fairline driver', cost: 95, msrp: 179 },
  { id: 'driver2', cat: 'clubs', tier: 2, name: 'Apex TD driver', cost: 210, msrp: 399 },
  { id: 'driver3', cat: 'clubs', tier: 3, name: 'Apex TD Pro driver', cost: 320, msrp: 599 },
  { id: 'irons1', cat: 'clubs', tier: 1, name: 'Fairline iron set', cost: 240, msrp: 449 },
  { id: 'irons2', cat: 'clubs', tier: 2, name: 'Apex forged irons', cost: 480, msrp: 899 },
  { id: 'putter1', cat: 'clubs', tier: 1, name: 'Roll-true putter', cost: 55, msrp: 109 },
  { id: 'putter2', cat: 'clubs', tier: 2, name: 'Milled blade putter', cost: 130, msrp: 249 },
  { id: 'wedge1', cat: 'clubs', tier: 1, name: 'Scoop 56° wedge', cost: 48, msrp: 89 },
  { id: 'wedge2', cat: 'clubs', tier: 2, name: 'Spin-mill wedge', cost: 78, msrp: 149 },

  // balls — the bread and butter
  { id: 'balls1', cat: 'balls', tier: 1, name: 'Range-rock dozen', cost: 7, msrp: 15 },
  { id: 'balls2', cat: 'balls', tier: 2, name: 'Tour-soft dozen', cost: 14, msrp: 28 },
  { id: 'balls3', cat: 'balls', tier: 3, name: 'Pro-V dozen', cost: 24, msrp: 47 },

  // apparel — seasonal swing
  { id: 'glove1', cat: 'apparel', tier: 1, name: 'Cabretta glove', cost: 9, msrp: 19 },
  { id: 'polo1', cat: 'apparel', tier: 1, name: 'Club polo', cost: 16, msrp: 34 },
  { id: 'polo2', cat: 'apparel', tier: 2, name: 'Tour polo', cost: 26, msrp: 55 },
  { id: 'cap1', cat: 'apparel', tier: 1, name: 'Willow Creek cap', cost: 8, msrp: 22 },
  { id: 'jacket2', cat: 'apparel', tier: 2, name: 'Storm shell', cost: 45, msrp: 95, coldSeason: true },

  // accessories — impulse rack
  { id: 'tees1', cat: 'accessories', tier: 1, name: 'Tee bag (50)', cost: 2.5, msrp: 6 },
  { id: 'towel1', cat: 'accessories', tier: 1, name: 'Bag towel', cost: 6, msrp: 14 },
  { id: 'marker1', cat: 'accessories', tier: 1, name: 'Ball marker set', cost: 3, msrp: 8 },
  { id: 'range2', cat: 'accessories', tier: 3, name: 'Laser rangefinder', cost: 140, msrp: 279 },
];

const BY_ID = new Map(SHOP_CATALOG.map((s) => [s.id, s]));

export function skuById(id) {
  return BY_ID.get(id);
}

// supplier lead time in days by category (clubs ship slow)
export const LEAD_DAYS = { clubs: 4, balls: 2, apparel: 3, accessories: 2 };

// shelf capacity per sku by category (one facing)
export const SHELF_CAP = { clubs: 6, balls: 24, apparel: 16, accessories: 24 };
