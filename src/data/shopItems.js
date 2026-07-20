// FAIRWAY STATE — pro shop catalog.
// tier 1 = value, 2 = standard, 3 = premium (premium lines unlock via progression).
// cost = what the supplier charges you; msrp = the book price a 1.0 markup sells at.
//
// `lb` is what ONE of the thing weighs. It is not decoration: a shipping label quotes a real
// number, the manifest sums it (data/boxes.js), and a heavy box slows you down when you carry it.
// `fragile` earns the box a FRAGILE mark — glass and optics only, because a mark on everything is
// a mark on nothing.

export const SHOP_CATALOG = [
  // clubs — the big-ticket, assisted-sale items
  { id: 'driver1', cat: 'clubs', tier: 1, name: 'Fairline driver', cost: 95, msrp: 179, lb: 0.8 },
  { id: 'driver2', cat: 'clubs', tier: 2, name: 'Apex TD driver', cost: 210, msrp: 399, lb: 0.8 },
  { id: 'driver3', cat: 'clubs', tier: 3, name: 'Apex TD Pro driver', cost: 320, msrp: 599, lb: 0.8 },
  { id: 'irons1', cat: 'clubs', tier: 1, name: 'Fairline iron set', cost: 240, msrp: 449, lb: 8.5 },
  { id: 'irons2', cat: 'clubs', tier: 2, name: 'Apex forged irons', cost: 480, msrp: 899, lb: 8.5 },
  { id: 'putter1', cat: 'clubs', tier: 1, name: 'Roll-true putter', cost: 55, msrp: 109, lb: 1.2 },
  { id: 'putter2', cat: 'clubs', tier: 2, name: 'Milled blade putter', cost: 130, msrp: 249, lb: 1.2 },
  { id: 'wedge1', cat: 'clubs', tier: 1, name: 'Scoop 56° wedge', cost: 48, msrp: 89, lb: 0.95 },
  { id: 'wedge2', cat: 'clubs', tier: 2, name: 'Spin-mill wedge', cost: 78, msrp: 149, lb: 0.95 },

  // balls — the bread and butter
  { id: 'balls1', cat: 'balls', tier: 1, name: 'Range-rock dozen', cost: 7, msrp: 15, lb: 1.4 },
  { id: 'balls2', cat: 'balls', tier: 2, name: 'Tour-soft dozen', cost: 14, msrp: 28, lb: 1.4 },
  { id: 'balls3', cat: 'balls', tier: 3, name: 'Pro-V dozen', cost: 24, msrp: 47, lb: 1.4 },

  // apparel — seasonal swing
  { id: 'glove1', cat: 'apparel', tier: 1, name: 'Cabretta glove', cost: 9, msrp: 19, lb: 0.1 },
  { id: 'polo1', cat: 'apparel', tier: 1, name: 'Club polo', cost: 16, msrp: 34, lb: 0.5 },
  { id: 'polo2', cat: 'apparel', tier: 2, name: 'Tour polo', cost: 26, msrp: 55, lb: 0.5 },
  { id: 'cap1', cat: 'apparel', tier: 1, name: 'Willow Creek cap', cost: 8, msrp: 22, lb: 0.25 },
  { id: 'jacket2', cat: 'apparel', tier: 2, name: 'Storm shell', cost: 45, msrp: 95, lb: 1.3, coldSeason: true },

  // accessories — impulse rack
  { id: 'tees1', cat: 'accessories', tier: 1, name: 'Tee bag (50)', cost: 2.5, msrp: 6, lb: 0.35 },
  { id: 'towel1', cat: 'accessories', tier: 1, name: 'Bag towel', cost: 6, msrp: 14, lb: 0.4 },
  { id: 'marker1', cat: 'accessories', tier: 1, name: 'Ball marker set', cost: 3, msrp: 8, lb: 0.2 },
  { id: 'range2', cat: 'accessories', tier: 3, name: 'Laser rangefinder', cost: 140, msrp: 279, lb: 0.75, fragile: true },
  { id: 'umb1', cat: 'accessories', tier: 1, name: 'Fairway Supply umbrella', cost: 12, msrp: 26, lb: 1.2 },

  // bags & shoes — the floor-plan zones the 2026-07-13 overhaul added
  { id: 'bag1', cat: 'accessories', tier: 2, name: 'Ironwood stand bag', cost: 90, msrp: 189, lb: 5.5 },
  { id: 'shoe1', cat: 'apparel', tier: 2, name: 'North Ridge spikes', cost: 48, msrp: 99, lb: 2.4 },
  { id: 'sock1', cat: 'apparel', tier: 1, name: 'Sunday Round crew socks', cost: 4, msrp: 11, lb: 0.15 },

  // provisions — quick-turn impulse goods beside the entrance
  { id: 'water1', cat: 'provisions', tier: 1, brand: 'FAIRWAY SPRING', name: 'Fairway Spring Water', cost: 0.85, msrp: 2.50, lb: 1.1 },
  { id: 'snack1', cat: 'provisions', tier: 1, brand: 'BUNKER BITES', name: 'Bunker Bites Potato Chips', cost: 0.90, msrp: 2.75, lb: 0.12 },

  // supplies — the shop's own equipment, never sold to shoppers (restoration arc)
  { id: 'vac1', cat: 'supplies', tier: 1, name: 'Shop vacuum', cost: 140, msrp: 0, lb: 17 },
  // Reopening supplies are ordinary physical supplier SKUs. Their cartons,
  // carrying, back-stock, and installation all use inventory conservation.
  { id: 'repairkit1', cat: 'supplies', tier: 1, name: 'Clubhouse repair components', cost: 38, msrp: 0, lb: 18, campaign: true },
  { id: 'desk1', cat: 'supplies', tier: 1, name: 'Office desk flat-pack', cost: 260, msrp: 0, lb: 74, campaign: true },
  { id: 'chair1', cat: 'supplies', tier: 1, name: 'Office task chair', cost: 85, msrp: 0, lb: 24, campaign: true },
  { id: 'laptop1', cat: 'supplies', tier: 1, name: 'Club office laptop', cost: 480, msrp: 0, lb: 8, fragile: true, campaign: true },
  { id: 'counter1', cat: 'supplies', tier: 1, name: 'Front desk counter kit', cost: 620, msrp: 0, lb: 150, campaign: true },
  { id: 'shelfkit1', cat: 'supplies', tier: 1, name: 'Commercial shelving kit', cost: 240, msrp: 0, lb: 72, campaign: true },
  { id: 'safetykit1', cat: 'supplies', tier: 1, name: 'Clubhouse safety station', cost: 95, msrp: 0, lb: 14, campaign: true },

  // decor — furnishing the shop up to the ClubHouseInterior reference; finish
  // feeds shopCondition (capped), placement via DECOR_SPOTS below
  { id: 'rug1', cat: 'decor', tier: 1, name: 'Pine lounge rug', cost: 120, msrp: 0, finish: 8, lb: 24 },
  { id: 'plant1', cat: 'decor', tier: 1, name: 'Potted plant', cost: 45, msrp: 0, finish: 4, lb: 9 },
  { id: 'poster1', cat: 'decor', tier: 1, name: 'Course poster', cost: 35, msrp: 0, finish: 4, lb: 2.5, fragile: true },
  { id: 'board1', cat: 'decor', tier: 1, name: 'Events board', cost: 85, msrp: 0, finish: 5, lb: 15 },
  { id: 'light1', cat: 'decor', tier: 1, name: 'Green pendant light', cost: 150, msrp: 0, finish: 7, lb: 5.5, fragile: true },
  { id: 'lounge1', cat: 'decor', tier: 1, name: 'Lounge set', cost: 420, msrp: 0, finish: 9, lb: 110 },
];

// valid placement anchors per decor sku, in BUILDING-local yards (the 21×13.5
// clubhouse plan in src/data/shopLayout.js — interior 20.5×13, door at +z).
// mount tells the scene how to build/orient: floor pieces sit at y0, wall pieces
// hang at eye height flush to their wall, ceiling pieces drop from the roof.
// SPOT COUNTS ARE SAVE FORMAT — saves store {skuId, spot index}; counts must
// never shrink (coordinates are free to move).
export const DECOR_SPOTS = {
  rug1: [
    { x: -5.9, z: 1.7, ry: 0, mount: 'floor' },      // under the apparel tables
    { x: 3.85, z: -4.9, ry: 0, mount: 'floor' },     // upgrades the lounge rug
  ],
  plant1: [
    { x: -2.35, z: 5.85, ry: 0, mount: 'floor' },    // inside the door, west
    { x: -9.7, z: 5.5, ry: 0, mount: 'floor' },      // past the putter corner
    { x: 2.65, z: -6.0, ry: 0, mount: 'floor' },     // lounge edge
    { x: 9.7, z: 2.6, ry: 0, mount: 'floor' },       // office corner
  ],
  poster1: [
    { x: -6.6, z: 6.4, ry: Math.PI, mount: 'wall' },       // south wall pier between windows
    { x: -2.0, z: -6.4, ry: 0, mount: 'wall' },            // north wall, above the small shelf
    { x: 5.78, z: 0.5, ry: -Math.PI / 2, mount: 'wall' },  // partition, by the shoe wall
  ],
  board1: [
    { x: 0.95, z: 6.4, ry: Math.PI, mount: 'wall' },       // beside the door, inside
    { x: 10.13, z: -2.0, ry: -Math.PI / 2, mount: 'wall' },// stockroom receiving wall
  ],
  light1: [
    { x: -3.2, z: 1.2, ry: 0, mount: 'ceiling' },    // over the apparel block
    { x: 1.9, z: 2.6, ry: 0, mount: 'ceiling' },     // over the checkout approach
  ],
  lounge1: [
    { x: 4.1, z: -5.2, ry: 0, mount: 'floor' },            // the lounge proper
    { x: 3.1, z: -4.1, ry: Math.PI / 2, mount: 'floor' },  // second seat of the suite
  ],
};

const BY_ID = new Map(SHOP_CATALOG.map((s) => [s.id, s]));

export function skuById(id) {
  return BY_ID.get(id);
}

// supplier lead time in days by category (clubs ship slow)
export const LEAD_DAYS = { clubs: 4, balls: 2, apparel: 3, accessories: 2, provisions: 1, supplies: 2, decor: 3 };

// shelf capacity per sku by category (one facing); shop equipment/decor never
// takes a retail facing — it lives in the back until used or placed
export const SHELF_CAP = { clubs: 6, balls: 24, apparel: 16, accessories: 24, provisions: 14, supplies: 0, decor: 0 };

// the categories shoppers can actually buy off the shelves
export const RETAIL_CATS = new Set(['clubs', 'balls', 'apparel', 'accessories', 'provisions']);
