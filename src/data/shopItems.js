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

  // supplies — the shop's own equipment, never sold to shoppers (restoration arc)
  { id: 'vac1', cat: 'supplies', tier: 1, name: 'Shop vacuum', cost: 140, msrp: 0 },

  // decor — furnishing the shop up to the ClubHouseInterior reference; finish
  // feeds shopCondition (capped), placement via DECOR_SPOTS below
  { id: 'rug1', cat: 'decor', tier: 1, name: 'Pine lounge rug', cost: 120, msrp: 0, finish: 8 },
  { id: 'plant1', cat: 'decor', tier: 1, name: 'Potted plant', cost: 45, msrp: 0, finish: 4 },
  { id: 'poster1', cat: 'decor', tier: 1, name: 'Course poster', cost: 35, msrp: 0, finish: 4 },
  { id: 'board1', cat: 'decor', tier: 1, name: 'Events board', cost: 85, msrp: 0, finish: 5 },
  { id: 'light1', cat: 'decor', tier: 1, name: 'Green pendant light', cost: 150, msrp: 0, finish: 7 },
  { id: 'lounge1', cat: 'decor', tier: 1, name: 'Lounge set', cost: 420, msrp: 0, finish: 9 },
];

// valid placement anchors per decor sku, in shop-room yards (14×10, door at +z).
// mount tells the scene how to build/orient: floor pieces sit at y0, wall pieces
// hang at eye height flush to their wall, ceiling pieces drop from the roof.
export const DECOR_SPOTS = {
  rug1: [
    { x: 0, z: 2.3, ry: 0, mount: 'floor' },
    { x: -4.2, z: 2.4, ry: 0.35, mount: 'floor' },
  ],
  plant1: [
    { x: -6.4, z: 4.2, ry: 0, mount: 'floor' },
    { x: 6.4, z: 4.3, ry: 0, mount: 'floor' },
    { x: -6.4, z: -4.2, ry: 0, mount: 'floor' },
    { x: 0.05, z: -4.5, ry: 0, mount: 'floor' },
  ],
  poster1: [
    { x: -3.2, z: 4.97, ry: Math.PI, mount: 'wall' },
    { x: -6.97, z: 3.1, ry: Math.PI / 2, mount: 'wall' },
    { x: 6.97, z: -1.2, ry: -Math.PI / 2, mount: 'wall' },
  ],
  board1: [
    { x: -1.9, z: 4.97, ry: Math.PI, mount: 'wall' },
    { x: -6.97, z: -3.1, ry: Math.PI / 2, mount: 'wall' },
  ],
  light1: [
    { x: 0, z: -2.0, ry: 0, mount: 'ceiling' },
    { x: 0, z: 2.0, ry: 0, mount: 'ceiling' },
  ],
  lounge1: [
    { x: 3.7, z: 3.9, ry: Math.PI, mount: 'floor' },
    { x: -4.3, z: -3.5, ry: Math.PI / 2, mount: 'floor' },
  ],
};

const BY_ID = new Map(SHOP_CATALOG.map((s) => [s.id, s]));

export function skuById(id) {
  return BY_ID.get(id);
}

// supplier lead time in days by category (clubs ship slow)
export const LEAD_DAYS = { clubs: 4, balls: 2, apparel: 3, accessories: 2, supplies: 2, decor: 3 };

// shelf capacity per sku by category (one facing); shop equipment/decor never
// takes a retail facing — it lives in the back until used or placed
export const SHELF_CAP = { clubs: 6, balls: 24, apparel: 16, accessories: 24, supplies: 0, decor: 0 };

// the categories shoppers can actually buy off the shelves
export const RETAIL_CATS = new Set(['clubs', 'balls', 'apparel', 'accessories']);
