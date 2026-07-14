// THE CLUBHOUSE FLOOR PLAN — the documented coordinate plan for the real,
// walk-in pro shop. Everything that places something in the building reads
// THIS file: the scene builder, the customer routes, the grime grid, the
// clutter spots, and the layout tests.
//
// v2 (production pass, 2026-07-13): resized to reference proportions —
// the 26×16 hall read wide and empty against Designs/RefrenceImages; the
// plan is now a 21×13.5 shell (≈16×13 sales floor after the service wing),
// densified to the reference zones: club wall the length of the west wall,
// ball/accessory walls north, apparel mid-floor, bag & shoe fitting against
// the partition, a real checkout with a back-counter, a furnished lounge,
// and a stockroom with a packing bench and receiving flow.
//
// Coordinate system: building-local yards, origin at the building's center.
// +z = SOUTH = the porch/entrance side (the course-facing front).
// +x = EAST  = the stockroom/office end.  Interior floor sits at local y 0.
//
//                    NORTH (z = -6.5)
//   ┌──────────────────────────────────────────────┬──────────────┐
//   │ [ball wall][accessories][gloves]   LOUNGE    │  STOCKROOM   │
// W │ club wall:                    chairs·trophy  │ backshelves  │ E
// E │  drivers      [hat tree]      events board   │ packing bench│
// S │  irons&wedges     [apparel tables · rail]    │ receiving ─ back door
// T │  putters                                     ├─stock door──┤
//   │        [bags]  [shoe wall→]                  │   OFFICE     │
//   │  [feature] [logo rug]  COUNTER ⇐ queue       │  desk+LAPTOP │
//   │            [backcounter + wordmark]          │  wall map    │
//   └────────────────┤ MAIN DOOR ├─────────────────┴──────────────┘
//                    SOUTH (z = +6.5) — porch, welcome mat, hours sign

export const SHELL = {
  w: 21, d: 13.5, h: 3.2,    // footprint (yd) + interior ceiling height
  wallT: 0.25,               // wall thickness — exterior and interior share it
  wallH: 4.4, peak: 3.4,     // exterior eave height + gable rise above it
  porchD: 3.6,               // south porch depth
};

export const INTERIOR = { w: SHELL.w - 2 * SHELL.wallT, d: SHELL.d - 2 * SHELL.wallT }; // 20.5 × 13

// --- doors (all real, hinged, E-operated; collide when closed) -------------------
// Angles/swing are the scene's job; the plan fixes position and clear width.
export const DOOR_MAIN = { wall: 'S', x: -0.8, w: 1.8, h: 2.6, hingeX: -1.7 };    // porch entrance (glazed, deep green)
export const DOOR_STOCK = { wall: 'partS', x: 8.9, z: 2.0, w: 1.3, h: 2.5, hingeX: 8.25 }; // office → stockroom
export const DOOR_BACK = { wall: 'E', z: -3.6, w: 1.5, h: 2.5, hingeZ: -4.35 };   // stockroom → receiving pad

// nothing solid may sit in front of the entrance (fixtures, clutter, queue)
export const DOOR_CLEARWAY = { minX: -2.1, maxX: 0.5, minZ: 3.9, maxZ: 6.5 };
// …or inside the receiving doorway (boxes come through here in your arms)
export const BACKDOOR_CLEARWAY = { minX: 7.7, maxX: 10.25, minZ: -4.6, maxZ: -2.6 };

// --- windows (mullioned, 2.4 × 1.9, sill 0.85 — real glazed openings) ------------
// The solid walls are deliberate: W carries the club wall, N-west carries the
// ball/accessory walls; daylight enters over the porch, the lounge, the office.
export const WINDOWS = [
  { wall: 'S', c: -8.3 }, { wall: 'S', c: -4.9 },
  { wall: 'N', c: 3.0 },                                   // lounge view up the course
  { wall: 'E', c: 4.6 },                                   // office daylight
];
export const WINDOW_DIM = { w: 2.4, h: 1.9, sill: 0.85 };

// --- interior partitions (the service wing: stockroom north, office south) -------
// partition A: x = 5.7 from the north wall down to z = 2.0 (solid)
// partition B: z = 2.0 from partition A to the east wall (holds the stock door)
// --- fixture footprints -----------------------------------------------------------
// The half-extents the scene builders actually give each kind of unit. This is THE definition:
// the collider, the layout tests and the placement validator all read it, so a fixture can never
// be one size to the physics and another to the rules.
export const FIXTURE_HALF = {
  shelf: [1.6, 0.35], rack: [1.5, 0.45], table: [1.2, 0.8], hatstand: [0.4, 0.4],
  bagstand: [1.3, 0.75], shoerack: [1.3, 0.4], feature: [0.9, 0.9], backshelf: [1.4, 0.45],
  rail: [1.1, 0.45], backcounter: [1.6, 0.3],
};

export function fixtureRect(f) {
  let [a, b] = FIXTURE_HALF[f.kind] || [1, 1];
  if (f.short) a = 0.85; // the doorway-adjacent short units (the builders honour this too)
  const swap = Math.abs(Math.sin(f.ry || 0)) > 0.5; // rotated a quarter turn
  const hx = swap ? b : a;
  const hz = swap ? a : b;
  return { minX: f.x - hx, maxX: f.x + hx, minZ: f.z - hz, maxZ: f.z + hz };
}

export const PARTITIONS = [
  { axis: 'x', at: 5.7, from: -INTERIOR.d / 2, to: 2.0 },
  { axis: 'z', at: 2.0, from: 5.7, to: INTERIOR.w / 2, opening: { c: DOOR_STOCK.x, w: DOOR_STOCK.w } },
];

export const STOCKROOM = {
  bounds: { minX: 5.7, maxX: INTERIOR.w / 2, minZ: -INTERIOR.d / 2, maxZ: 2.0 },
  receivingInside: { x: 7.2, z: -5.3 },    // set-down stack, out of the doorway clearway
  padOutside: { x: 12.4, z: -3.6 },        // gravel pad past the back door — deliveries land here
  packing: { x: 6.9, z: -0.9, ry: 0 },     // the packing bench (tape gun, clipboard)
  handTruck: { x: 6.1, z: -5.9 },
  bin: { x: 9.85, z: 1.3 },                // recycling by the stock door, east of the swing
  cleaning: { x: 6.1, z: 1.45 },           // mop bucket / brooms corner
};

export const OFFICE = {
  bounds: { minX: 5.7, maxX: INTERIOR.w / 2, minZ: 2.0, maxZ: INTERIOR.d / 2 },
  desk: { x: 9.55, z: 4.5, ry: Math.PI / 2 },    // against the east wall, faces west
  chair: { x: 8.65, z: 4.5 },
  laptop: { x: 9.55, z: 4.5, ry: Math.PI / 2 },  // screen faces west, into the room
  map: { x: 8.9, z: 6.44, ry: Math.PI },         // framed course map on the office's south wall
  calendar: { x: 7.1, z: 2.15, ry: Math.PI },    // on partition B's office face
};

// The lounge is furnished from day one (dirty) — refs 1/2/8. The set below is
// base dressing; the lounge1 decor upgrade replaces it with the premium suite.
export const LOUNGE = {
  bounds: { minX: 2.4, maxX: 5.7, minZ: -INTERIOR.d / 2, maxZ: -3.2 },
  chairA: { x: 3.2, z: -5.35, ry: 0.55 },
  chairB: { x: 4.6, z: -4.35, ry: -0.75 },
  coffee: { x: 3.85, z: -4.95 },
  rug: { x: 3.85, z: -4.9, ry: 0 },
  trophy: { x: 5.55, z: -5.1, ry: -Math.PI / 2 },    // on the partition's west face
  events: { x: 5.55, z: -3.75, ry: -Math.PI / 2 },   // club events board beside it
  photo: { x: 4.95, z: -6.38, ry: 0 },               // course photography, clear of the window
};

// --- checkout ---------------------------------------------------------------------
// A person is 0.68 yd across, and a till is a workspace, not a gap: you stand at it, turn, pull
// the drawer, and bag. The counter used to sit 0.55 yd off the back counter — narrower than the
// player — so there was no staff side at all and the register had to be worked by reaching over
// from the customer's aisle. The counter moved north and the back counter to the wall to open a
// real corridor behind it. `tests/checkout-space.test.js` holds that open.
export const PLAYER_DIAM = 0.68;
export const STAFF_CORRIDOR_MIN = 1.1;

export const COUNTER = {
  x: 2.9, z: 4.2, len: 3.2, depth: 1.0, ry: 0,   // island parallel to the south wall
  registerX: 1.7,                                 // register at the west (aisle) end
  queueBase: { x: 1.6, z: 3.05 },                 // slot 0: at the register, clear of the counter
  queueStep: { x: -0.8, z: -0.45 },               // line falls back SW, clear of the door
  staffStand: { x: 1.9, z: 5.35 },                // where you stand to work it: behind the counter
};
export function queueSlot(i) {
  return { x: COUNTER.queueBase.x + COUNTER.queueStep.x * i, z: COUNTER.queueBase.z + COUNTER.queueStep.z * i };
}

// permanent entrance dressing
export const MAT = { x: -0.8, z: 5.55 };               // welcome mat inside the door
export const LOGO_RUG = { x: -0.8, z: 3.1, w: 3.6, d: 2.4 }; // club logo rug on the entry axis
export const HOURS_SIGN = { x: 1.1, z: 6.77 };         // beside the door, on the porch face

// --- retail fixtures ----------------------------------------------------------------
// kind: shelf | rack | table | rail | hatstand | bagstand | shoerack | feature
//     | backcounter | backshelf
export const FIXTURES = [
  // the club wall — one architectural run down the west wall (refs 1/5)
  { id: 'rack_drivers', kind: 'rack', x: -9.9, z: -3.2, ry: Math.PI / 2, skus: ['driver1', 'driver2', 'driver3'], title: 'Drivers & woods', zone: 'clubwall' },
  { id: 'rack_irons', kind: 'rack', x: -9.9, z: -0.2, ry: Math.PI / 2, skus: ['irons1', 'irons2', 'wedge1', 'wedge2'], title: 'Irons & wedges', zone: 'clubwall' },
  { id: 'rack_putters', kind: 'rack', x: -9.9, z: 2.8, ry: Math.PI / 2, skus: ['putter1', 'putter2'], title: 'Putter studio', zone: 'clubwall' },
  // north wall retail walls
  { id: 'shelf_balls', kind: 'shelf', x: -6.9, z: -6.15, ry: 0, skus: ['balls1', 'balls2', 'balls3'], title: 'Ball wall', zone: 'balls' },
  { id: 'shelf_acc', kind: 'shelf', x: -3.7, z: -6.15, ry: 0, skus: ['tees1', 'towel1', 'marker1', 'range2', 'umb1'], title: 'Accessories', zone: 'accessories' },
  { id: 'shelf_small', kind: 'shelf', x: -0.5, z: -6.15, ry: 0, skus: ['glove1', 'sock1'], title: 'Gloves & socks', zone: 'accessories' },
  // apparel block, center floor
  { id: 'table_polos', kind: 'table', x: -5.9, z: 0.6, ry: 0, skus: ['polo1', 'polo2'], title: 'Apparel tables', zone: 'apparel' },
  { id: 'rail_outer', kind: 'rail', x: -2.4, z: 0.9, ry: Math.PI / 2, skus: ['jacket2'], title: 'Outerwear rail', zone: 'apparel' },
  { id: 'hatstand', kind: 'hatstand', x: -3.4, z: -1.6, ry: 0, skus: ['cap1'], title: 'Hat tree', zone: 'apparel' },
  // bag & shoe fitting, against the service partition (ref 7)
  { id: 'bagstand', kind: 'bagstand', x: 2.2, z: -2.6, ry: 0, skus: ['bag1'], title: 'Bag platforms', zone: 'bags' },
  { id: 'shoerack', kind: 'shoerack', x: 5.1, z: -0.6, ry: -Math.PI / 2, skus: ['shoe1'], title: 'Shoe wall', zone: 'shoes' },
  // entrance feature display (shows whatever category is featured)
  { id: 'feature', kind: 'feature', x: -3.2, z: 3.8, ry: 0, skus: [], title: 'Feature display', zone: 'entrance' },
  // checkout back-counter: wordmark wall, cabinets, bag stack (ref 4)
  { id: 'backcounter', kind: 'backcounter', x: 3.2, z: 6.15, ry: 0, skus: [], title: 'Back counter', zone: 'checkout' },
  // stockroom (non-retail; visualizes backroom stock + receives boxes)
  { id: 'backshelf_n', kind: 'backshelf', x: 8.05, z: -6.1, ry: 0, skus: [], title: 'Backroom shelving', zone: 'stockroom' },
  { id: 'backshelf_e', kind: 'backshelf', x: 9.9, z: -5.6, ry: -Math.PI / 2, skus: [], title: 'Backroom shelving', zone: 'stockroom', short: true },
  { id: 'backshelf_e2', kind: 'backshelf', x: 9.9, z: -0.6, ry: -Math.PI / 2, skus: [], title: 'Backroom shelving', zone: 'stockroom' },
];

// --- start-state clutter (the "dirty, not nonsensical" rule: piles sit off the
// aisles in believable neglect spots — corners, dead zones, the stockroom) --------
export const CLUTTER_SPOTS = [
  { x: -8.9, z: 5.3 }, { x: -6.3, z: -3.9 }, { x: 1.4, z: 0.5 }, { x: 4.7, z: 3.1 },
  { x: -1.2, z: -4.2 }, { x: -9.2, z: -5.6 }, { x: 6.4, z: -4.6 }, { x: 7.6, z: 1.3 },
];

// --- traffic paths (the dirt system paints mud/footprint trails along these) -----
// Each entry is a polyline in building-local yards: the routes real feet take.
export const TRAFFIC_PATHS = [
  [{ x: -0.8, z: 6.4 }, { x: -0.8, z: 2.6 }, { x: -0.9, z: -1.4 }, { x: -2.2, z: -5.2 }],  // door → aisle → ball wall
  [{ x: -0.8, z: 2.6 }, { x: 1.6, z: 3.7 }, { x: 2.9, z: 3.9 }],                            // aisle → register front
  [{ x: -0.9, z: -1.4 }, { x: -7.6, z: -0.6 }],                                             // aisle → club wall
  [{ x: -0.9, z: -1.4 }, { x: 3.6, z: -3.4 }],                                              // aisle → bags/lounge
  [{ x: 8.9, z: 4.4 }, { x: 8.9, z: 0.6 }, { x: 9.4, z: -3.4 }],                            // office → stock door → receiving
];
