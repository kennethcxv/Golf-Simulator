// THE CLUBHOUSE FLOOR PLAN — the documented coordinate plan for the real,
// walk-in pro shop. Everything that places something in the building reads
// THIS file: the scene builder, the customer routes, the grime grid, the
// clutter spots, and the layout tests.
//
// Coordinate system: building-local yards, origin at the building's center.
// +z = SOUTH = the porch/entrance side (the course-facing front).
// +x = EAST  = the stockroom/office end.  Interior floor sits at local y 0.
//
//                    NORTH (z = -7.75) — windows onto the course
//   ┌────────────────────────────────────────────────┬───────────────┐
//   │ [ball wall]  [accessories] [gloves]   LOUNGE   │  STOCKROOM    │
// W │ racks:                       sofa·table·trophy │  backshelves  │ E
// E │  drivers                                       │  receiving ─ back door
// S │  irons&wedges   [apparel tables · hat tree]    ├─stock door──┤ S
// T │  putters                                       │   OFFICE      │ T
//   │        [bags] [shoes→]                         │  desk+LAPTOP  │
//   │  [feature]   COUNTER+register  ⇐ queue         │  wall map     │
//   └──────────────────┤ MAIN DOOR ├─────────────────┴───────────────┘
//                    SOUTH (z = +7.75) — porch, welcome mat, hours sign

export const SHELL = {
  w: 26, d: 16, h: 3.4,      // footprint (yd) + interior ceiling height
  wallT: 0.25,               // wall thickness — exterior and interior share it
  wallH: 5.2, peak: 4.2,     // exterior wall top + gable rise (roof volume above the ceiling)
  porchD: 4,                 // south porch depth (existing silhouette, kept)
};

export const INTERIOR = { w: SHELL.w - 2 * SHELL.wallT, d: SHELL.d - 2 * SHELL.wallT }; // 25.5 × 15.5

// --- doors (all real, hinged, E-operated; collide when closed) -------------------
// Angles/swing are the scene's job; the plan fixes position and clear width.
export const DOOR_MAIN = { wall: 'S', x: -0.8, w: 1.8, h: 2.6, hingeX: -1.7 };   // porch entrance
export const DOOR_STOCK = { wall: 'partS', x: 10.0, z: 2.0, w: 1.4, h: 2.5, hingeX: 9.3 }; // office → stockroom
export const DOOR_BACK = { wall: 'E', z: -3.6, w: 1.6, h: 2.5, hingeZ: -4.4 };   // stockroom → receiving pad

// nothing solid may sit in front of the entrance (fixtures, clutter, queue)
export const DOOR_CLEARWAY = { minX: -2.3, maxX: 0.7, minZ: 4.4, maxZ: 7.75 };

// --- windows (2.6 × 1.3, sill 1.25 — both faces trimmed, see-through) ------------
export const WINDOWS = [
  { wall: 'S', c: -8.5 }, { wall: 'S', c: -5.0 },
  { wall: 'N', c: -8.5 }, { wall: 'N', c: -1.5 }, { wall: 'N', c: 5.0 },
  { wall: 'E', c: 4.8 },                                   // office daylight
];
export const WINDOW_DIM = { w: 2.6, h: 1.3, sill: 1.25 };

// --- interior partitions (the stockroom box, open office nook) -------------------
// partition A: x = 8.4 from the north wall down to z = 2.0 (solid)
// partition B: z = 2.0 from partition A to the east wall (holds the stock door)
export const PARTITIONS = [
  { axis: 'x', at: 8.4, from: -INTERIOR.d / 2, to: 2.0 },
  { axis: 'z', at: 2.0, from: 8.4, to: INTERIOR.w / 2, opening: { c: DOOR_STOCK.x, w: DOOR_STOCK.w } },
];

export const STOCKROOM = {
  bounds: { minX: 8.4, maxX: INTERIOR.w / 2, minZ: -INTERIOR.d / 2, maxZ: 2.0 },
  receivingInside: { x: 11.4, z: -3.2 },   // where carried boxes get set down
  padOutside: { x: 14.6, z: -3.6 },        // gravel pad past the back door — deliveries land here
  handTruck: { x: 9.3, z: -6.9 },
  bin: { x: 12.2, z: 1.3 },
};

export const OFFICE = {
  bounds: { minX: 8.4, maxX: INTERIOR.w / 2, minZ: 2.0, maxZ: INTERIOR.d / 2 },
  desk: { x: 11.55, z: 4.8, ry: Math.PI / 2 },   // against the east wall, faces west
  chair: { x: 10.6, z: 4.8 },
  laptop: { x: 11.55, z: 4.8, ry: Math.PI / 2 }, // screen faces west, into the room
  map: { x: 12.6, z: 3.0, ry: -Math.PI / 2 },    // wall course map above the filing
  calendar: { x: 10.4, z: 7.6, ry: Math.PI },
};

export const LOUNGE = {
  bounds: { minX: 2.5, maxX: 8.0, minZ: -INTERIOR.d / 2, maxZ: -3.6 },
  trophy: { x: 8.26, z: -5.4, ry: -Math.PI / 2 },    // on the partition's west face
  photo: { x: 5.4, z: -7.62, ry: 0 },                // course photography, north wall
};

// --- checkout ---------------------------------------------------------------------
export const COUNTER = {
  x: 3.6, z: 5.7, len: 3.2, depth: 1.0, ry: 0,   // island parallel to the south wall
  registerX: 2.4,                                 // register at the west (aisle) end
  queueBase: { x: 2.4, z: 4.85 },                 // slot 0: at the register
  queueStep: { x: -0.78, z: -0.28 },              // line falls back west, clear of the door
};
export function queueSlot(i) {
  return { x: COUNTER.queueBase.x + COUNTER.queueStep.x * i, z: COUNTER.queueBase.z + COUNTER.queueStep.z * i };
}

// --- retail fixtures ----------------------------------------------------------------
// kind: shelf | rack | table | hatstand | bagstand | shoerack | feature | backshelf
export const FIXTURES = [
  // the club wall — separated presentation down the west wall
  { id: 'rack_drivers', kind: 'rack', x: -12.1, z: -5.2, ry: Math.PI / 2, skus: ['driver1', 'driver2', 'driver3'], title: 'Driver wall', zone: 'clubwall' },
  { id: 'rack_irons', kind: 'rack', x: -12.1, z: -1.6, ry: Math.PI / 2, skus: ['irons1', 'irons2', 'wedge1', 'wedge2'], title: 'Irons & wedges', zone: 'clubwall' },
  { id: 'rack_putters', kind: 'rack', x: -12.1, z: 1.9, ry: Math.PI / 2, skus: ['putter1', 'putter2'], title: 'Putter corner', zone: 'clubwall' },
  // north wall shelving
  { id: 'shelf_balls', kind: 'shelf', x: -8.2, z: -7.2, ry: 0, skus: ['balls1', 'balls2', 'balls3'], title: 'Ball wall', zone: 'balls' },
  { id: 'shelf_acc', kind: 'shelf', x: -4.3, z: -7.2, ry: 0, skus: ['tees1', 'towel1', 'marker1', 'range2', 'umb1'], title: 'Accessories', zone: 'accessories' },
  { id: 'shelf_small', kind: 'shelf', x: -0.5, z: -7.2, ry: 0, skus: ['glove1', 'sock1'], title: 'Gloves & socks', zone: 'accessories' },
  // apparel block, center floor
  { id: 'table_polos', kind: 'table', x: -5.8, z: 0.8, ry: 0, skus: ['polo1', 'polo2'], title: 'Apparel table', zone: 'apparel' },
  { id: 'table_outer', kind: 'table', x: -2.2, z: 2.9, ry: 0, skus: ['jacket2'], title: 'Outerwear', zone: 'apparel' },
  { id: 'hatstand', kind: 'hatstand', x: -3.9, z: -1.7, ry: 0, skus: ['cap1'], title: 'Hat tree', zone: 'apparel' },
  // bags & shoes, east-center
  { id: 'bagstand', kind: 'bagstand', x: 5.2, z: -0.9, ry: 0, skus: ['bag1'], title: 'Bag stand', zone: 'bags' },
  { id: 'shoerack', kind: 'shoerack', x: 8.0, z: -0.9, ry: -Math.PI / 2, skus: ['shoe1'], title: 'Shoe wall', zone: 'shoes' },
  // entrance feature display (shows whatever category is featured)
  { id: 'feature', kind: 'feature', x: -3.5, z: 5.0, ry: 0, skus: [], title: 'Feature display', zone: 'entrance' },
  // stockroom (non-retail; visualizes backroom stock + receives boxes)
  { id: 'backshelf_n', kind: 'backshelf', x: 10.7, z: -7.1, ry: 0, skus: [], title: 'Backroom shelving', zone: 'stockroom' },
  { id: 'backshelf_e', kind: 'backshelf', x: 12.25, z: -5.0, ry: -Math.PI / 2, skus: [], title: 'Backroom shelving', zone: 'stockroom' },
];

// --- start-state clutter (the "dirty, not nonsensical" rule: piles sit off the
// aisles in believable neglect spots — corners, dead zones, the stockroom) --------
export const CLUTTER_SPOTS = [
  { x: -6.8, z: 4.6 }, { x: 2.0, z: 1.8 }, { x: -4.2, z: -3.2 }, { x: 6.6, z: 3.2 },
  { x: 10.6, z: -2.6 }, { x: 11.8, z: -6.4 }, { x: -10.8, z: -5.8 }, { x: 0.6, z: -4.6 },
];

// --- flat dressing -----------------------------------------------------------------
export const MAT = { x: -0.8, z: 6.8 };            // welcome mat inside the door
export const HOURS_SIGN = { x: 1.1, z: 8.02 };     // beside the door, on the porch face
