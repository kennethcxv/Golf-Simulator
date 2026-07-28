// THE CLUBHOUSE FLOOR PLAN — the documented coordinate plan for the real,
// walk-in pro shop. Everything that places something in the building reads
// THIS file: the scene builder, the customer routes, the grime grid, the
// clutter spots, and the layout tests.
//
// The legacy gameplay envelope remains available to old saves and optional
// presentations. The default modern municipal shell is deliberately smaller:
// 16.80 m × 10.50 m = 1,898.8 sq ft. Default wall fixtures below sit inside
// that compact envelope while checkout keeps its proven local desk frame.
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
  // Compact municipal starter: approximately 1,900 sq ft. Larger optional
  // clubhouse models own their dimensions inside their variant adapters.
  w: 18.4, d: 11.5, h: 3.2,
  wallT: 0.25,               // wall thickness — exterior and interior share it
  wallH: 4.4, peak: 3.4,
  porchD: 3.6,
  porchW: 18.4 * 0.70,
};

export const INTERIOR = { w: SHELL.w - 2 * SHELL.wallT, d: SHELL.d - 2 * SHELL.wallT }; // 17.9 × 11

// The default Pine Hills presentation retains the modern municipal shell's
// established footprint while the larger legacy/mountain variants continue to
// use SHELL. Wall-mounted starter decor targets this interior envelope.
export const MODERN_PUBLIC_INTERIOR = Object.freeze({
  w: 16.80 / 0.9144 - 2 * SHELL.wallT,
  d: 10.50 / 0.9144 - 2 * SHELL.wallT,
});

// --- doors (all real, hinged, E-operated; collide when closed) -------------------
// Angles/swing are the scene's job; the plan fixes position and clear width.
// Asset 53 is authored at exactly 1.80 m x 2.45 m. The floor plan is in yards,
// so retain the exact conversion here instead of the former rounded single-slab
// dimensions. `hingeX` is the authored left-leaf outer hinge for legacy readers.
export const DOOR_MAIN = {
  wall: 'S', x: -0.8,
  w: 1.8 / 0.9144,
  h: 2.45 / 0.9144,
  hingeX: -0.8 - (0.9 / 0.9144),
}; // porch entrance (glazed walnut double leaves)
// Keep the service-room opening centered in the compact east wing. The former
// x=8.9 datum was only 0.05 yd from the new exterior wall, leaving no
// player-width route through an otherwise open door.
export const DOOR_STOCK = { wall: 'partS', x: 7.55, z: 2.0, w: 1.3, h: 2.5, hingeX: 6.9 }; // office → stockroom
export const DOOR_BACK = { wall: 'E', z: -3.6, w: 1.5, h: 2.5, hingeZ: -4.35 };   // stockroom → receiving pad

// nothing solid may sit in front of the entrance (fixtures, clutter, queue)
export const DOOR_CLEARWAY = { minX: -2.1, maxX: 0.5, minZ: 3.35, maxZ: 5.65 };
// …or inside the receiving doorway (boxes come through here in your arms)
export const BACKDOOR_CLEARWAY = { minX: 6.9, maxX: 9.15, minZ: -4.6, maxZ: -2.6 };

// --- windows (mullioned, 2.4 × 1.9, sill 0.85 — real glazed openings) ------------
// The solid walls are deliberate: W carries the club wall, N-west carries the
// ball/accessory walls; daylight enters over the porch, the lounge, the office.
export const WINDOWS = [
  { wall: 'S', c: -7.6 }, { wall: 'S', c: -4.4 },
  { wall: 'N', c: 3.0 },                                   // lounge view up the course
  { wall: 'E', c: 4.25 },                                  // office daylight
];
export const WINDOW_DIM = { w: 2.4, h: 1.9, sill: 0.85 };

export const SHOP_LIGHTING_TIERS = Object.freeze({
  1: Object.freeze({ key: 'basic', practicalScale: 0.86, displayScale: 0.78, premiumAccent: 0 }),
  2: Object.freeze({ key: 'standard', practicalScale: 1, displayScale: 1, premiumAccent: 0 }),
  3: Object.freeze({ key: 'premium', practicalScale: 1.08, displayScale: 1.16, premiumAccent: 1 }),
});

export function shopLightingTier(tier = 1) {
  return SHOP_LIGHTING_TIERS[Math.max(1, Math.min(3, Math.floor(tier)))]
    || SHOP_LIGHTING_TIERS[1];
}

export function fixtureSockets(fixture, type = 'browse') {
  if (!fixture) return [];
  const sockets = type === 'stock' ? (fixture.stock || []) : (fixture.browse || []);
  const angle = fixture.ry || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return sockets.map((point, index) => ({
    x: fixture.x + point.x * cos + point.z * sin,
    z: fixture.z - point.x * sin + point.z * cos,
    ry: angle,
    index,
    key: `${fixture.id}:${type}:${index}`,
  }));
}

// --- interior partitions (the service wing: stockroom north, office south) -------
// partition A: x = 5.7 from the north wall down to z = 2.0 (solid)
// partition B: z = 2.0 from partition A to the east wall (holds the stock door)
// --- fixture footprints -----------------------------------------------------------
// The half-extents the scene builders actually give each kind of unit. This is THE definition:
// the collider, the layout tests and the placement validator all read it, so a fixture can never
// be one size to the physics and another to the rules.
export const FIXTURE_HALF = {
  shelf: [1.6, 0.35], pegboard: [1.6, 0.35], apparelwall: [1.6, 0.35],
  rack: [1.5, 0.45], table: [1.2, 0.72], hatstand: [0.4, 0.4],
  bagstand: [1.3, 0.65], shoerack: [1.3, 0.4], fittingroom: [1.1, 0.85],
  feature: [1.05, 0.65], fridge: [0.48, 0.48], snackrack: [0.75, 0.38],
  service: [0.48, 0.38], premiumcase: [1.2, 0.4], demo: [2.0, 0.62],
  backshelf: [1.4, 0.45], rail: [0.60, 0.225], backcounter: [1.6, 0.3],
  officeDesk: [1.0, 0.55], officeChair: [0.34, 0.34], officeFiling: [0.375, 0.30],
  packingbench: [0.95, 0.525],
};

export function fixtureRect(f) {
  if (f.footprint) {
    const { minX, maxX, minZ, maxZ } = f.footprint;
    const c = Math.cos(f.ry || 0);
    const s = Math.sin(f.ry || 0);
    const points = [
      [minX, minZ], [minX, maxZ], [maxX, minZ], [maxX, maxZ],
    ].map(([x, z]) => ({
      x: f.x + x * c + z * s,
      z: f.z - x * s + z * c,
    }));
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minZ: Math.min(...points.map((p) => p.z)),
      maxZ: Math.max(...points.map((p) => p.z)),
    };
  }
  let [a, b] = FIXTURE_HALF[f.kind] || [1, 1];
  if (f.short) a = 0.85; // the doorway-adjacent short units (the builders honour this too)
  const swap = Math.abs(Math.sin(f.ry || 0)) > 0.5; // rotated a quarter turn
  const hx = swap ? b : a;
  const hz = swap ? a : b;
  return { minX: f.x - hx, maxX: f.x + hx, minZ: f.z - hz, maxZ: f.z + hz };
}

// Experience fixtures reserve a presentation footprint but keep their actual
// walk-in area open. Navigation and runtime collision use these same proxies.
export function fixtureCollisionRects(f) {
  const proxies = f.kind === 'fittingroom'
    ? [
      { x: 0, z: -0.72, w: 2.2, d: 0.12 },
      { x: -1.02, z: 0, w: 0.12, d: 1.56 },
      { x: 1.02, z: 0, w: 0.12, d: 1.56 },
    ]
    : f.kind === 'demo'
      ? [{ x: -1.87, z: 0, w: 0.18, d: 1.12 }]
      : null;
  if (!proxies) return [fixtureRect(f)];
  const c = Math.cos(f.ry || 0);
  const s = Math.sin(f.ry || 0);
  return proxies.map((proxy) => {
    const x = f.x + proxy.x * c + proxy.z * s;
    const z = f.z - proxy.x * s + proxy.z * c;
    const swap = Math.abs(s) > 0.5;
    const w = swap ? proxy.d : proxy.w;
    const d = swap ? proxy.w : proxy.d;
    return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
  });
}

// Customer fixture stops are authored in fixture-local space. `+z` is the
// presentation/front side of every movable display, including asymmetric
// footprints such as the shoe wall. Keeping the transform here means the
// runtime path target and build-mode placement validator cannot disagree about
// which side of a rotated fixture a shopper must be able to reach.
export function fixtureBrowsePoint(f, localX = 0, localZ = null) {
  const fallbackHalfDepth = (FIXTURE_HALF[f.kind] || [1, 1])[1];
  const front = Number.isFinite(f.footprint?.maxZ)
    ? f.footprint.maxZ
    : fallbackHalfDepth;
  const browseZ = Number.isFinite(localZ) ? localZ : front + 0.72;
  const angle = f.ry || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: f.x + localX * cos + browseZ * sin,
    z: f.z - localX * sin + browseZ * cos,
  };
}

export const PARTITIONS = [
  { axis: 'x', at: 5.7, from: -INTERIOR.d / 2, to: 2.0 },
  { axis: 'z', at: 2.0, from: 5.7, to: INTERIOR.w / 2, opening: { c: DOOR_STOCK.x, w: DOOR_STOCK.w } },
];

// --- pine-hills-v2 layout variant (the Phase 3 greybox seam) --------------------------
// Approved in Designs/ProShop/Greybox/FLOOR_PLAN.md. The v2 room exists ONLY when the
// page was entered with ?clubhouse=pine-hills-v2: the variant resolves ONCE, at module
// load, so in Node and in any browser session without the query every exported value
// below is byte-identical to the v1 numbers — the existing tests and the live game
// cannot notice the variant exists. clubhouse.js trusts this same constant for its
// presentation choice, so the room that draws and the datums that place things can
// never disagree.
export const CLUBHOUSE_LAYOUT_VARIANT = (() => {
  try {
    return new URLSearchParams(location.search).get('clubhouse') === 'pine-hills-v2'
      ? 'pine-hills-v2'
      : null;
  } catch {
    return null; // Node / tests: no location, no variant
  }
})();

// Everything the v2 layout changes, in one place, frame-independent, so the layout
// tests can audit the variant from Node without module-state games.
export const PINE_HILLS_V2_LAYOUT = Object.freeze({
  // Decision D1: the desk becomes a south-wall counter east of the entrance. At ry 0
  // the staff side (+local z) faces the south wall, giving the corridor its wall run.
  frame: Object.freeze({ x: 3.30, z: 3.35, ry: 0 }),
  // FLOOR_PLAN.md §5 — the five absolute fixture moves (backcounter is frame-local).
  fixturePoses: Object.freeze({
    rail_outer: Object.freeze({ x: -4.00, z: 5.20, ry: Math.PI }),
    fittingroom: Object.freeze({ x: -3.55, z: -2.85, ry: Math.PI / 2 }),
    // ry PI: the power display faces the entrance, and its browse stand lands on
    // the aisle side instead of inside the protected door clearway.
    feature: Object.freeze({ x: -1.35, z: 2.60, ry: Math.PI }),
    // z 2.15, not 2.05: at 2.05 the station's rect grazes the relocated safety
    // keep-clear by 0.03 yd; 2.15 clears it by 0.07 and still leaves 0.31 to the desk.
    member_station: Object.freeze({ x: 5.15, z: 2.15, ry: -Math.PI / 2 }),
    // The measured F5 swap: the furnished starter conveys the bag stand on day one,
    // and at (2.05,-2.65) x 1.25 tall it owned the door→lounge fan (chairA 0%,
    // chairB 85.7% measured). The 0.15-yd putting strip takes that floor — the
    // lounge chairs watch the green, and the fan sees over it at every tier —
    // while the bags move west between the apparel table and the club wall.
    putting_demo: Object.freeze({ x: 1.35, z: -2.65, ry: 0 }),
    bagstand: Object.freeze({ x: -5.00, z: 2.90, ry: 0 }),
  }),
  // The wordmark hutch moves to the staff side of the corridor, against the S wall:
  // local (0.70, 1.84) at the v2 frame lands it at (4.00, 5.19), z 4.89..5.49.
  backcounterLocal: Object.freeze({ x: 0.70, z: 1.84, ry: 0 }),
  // The safety campaign facility leaves tour_vault's wall run (FLOOR_PLAN.md §8).
  safetySite: Object.freeze({ x: 5.30, z: 1.35 }),
  // FLOOR_PLAN.md §7 — eight authored neglect spots, corners and dead zones only.
  clutterSpots: Object.freeze([
    Object.freeze({ x: 1.20, z: -5.05 }),  // unhung apparel stock, gloves/hat-tree nook
    Object.freeze({ x: -6.30, z: -3.90 }), // shoe boxes mid-unpack beside the shoe wall
    // x -3.30, not the drafted -1.20: the draft spot sat 0.75 yd off the door→north
    // leg (F4 needs 0.8) and under the wrong wall besides.
    Object.freeze({ x: -3.30, z: -4.60 }), // fallen pegboard stock under the accessory wall
    Object.freeze({ x: 6.70, z: 2.60 }),   // office paperwork pile (kept)
    Object.freeze({ x: 5.25, z: 0.10 }),   // returns pile against the partition
    // Deeper into the corner than v1's spot: the new office→till corridor leg passes
    // the old pose 0.65 yd away.
    Object.freeze({ x: 6.55, z: 5.20 }),   // office corner pile, beside the filing cabinet
    Object.freeze({ x: -7.90, z: 4.60 }),  // delivery never shelved, beside the fridge
    Object.freeze({ x: -8.10, z: -4.80 }), // unopened range-ball delivery, NW corner (kept)
  ]),
  // Pure over the queue-slot function so layout tests can audit the shipped polylines
  // against the v2 frame from Node. FLOOR_PLAN.md §7: one counterclockwise loop; the
  // office→till corridor leg is new — v2's register is worked from behind the desk.
  trafficPaths(slotAt) {
    return [
      [{ x: -0.8, z: 5.45 }, { x: -0.3, z: 2.9 }, { x: -0.9, z: -1.4 }, { x: -2.2, z: -4.7 }], // door → aisle → north walls
      [{ x: -0.3, z: 2.9 }, slotAt(1), slotAt(0)],                                             // aisle → queue → service
      [{ x: -0.9, z: -1.4 }, { x: -7.6, z: -0.6 }],                                            // aisle → club wall
      [{ x: -0.9, z: -1.4 }, { x: 4.2, z: -1.55 }, { x: 3.9, z: -3.3 }],                       // aisle → vault corner → lounge (east of the putting strip)
      [{ x: 8.1, z: 4.1 }, { x: 8.1, z: 0.6 }, { x: 8.45, z: -3.4 }],                          // office → stock door → receiving
      [{ x: 6.4, z: 4.3 }, { x: 4.3, z: 4.3 }],                                                // office → till corridor
    ];
  },
});

// --- Pine Hills front desk ----------------------------------------------------------
// All reception and checkout geometry is authored in this one local frame. At
// rotation zero, +z is the staff side and -z is the customer side. Pine Hills
// turns the proven checkout choreography 180 degrees so the customer faces the
// entrance while the employee works from the north side of the desk.
export const METERS_PER_YARD = 0.9144;
export const FRONT_DESK_DOOR_SETBACK_METERS = 3.3856;
// Pure over its input — layout tests audit the v2 frame from Node by calling this
// directly; the module-level constant resolves once from the active variant.
export function deriveFrontDeskFrame(variant = null) {
  const frame = {
    version: 1,
    x: DOOR_MAIN.x,
    // The compact shell moved the south wall inward by exactly one yard. Reduce
    // the wall setback by the same amount so the proven checkout station datum,
    // camera composition, customer queue, and save-safe interactions do not move.
    z: INTERIOR.d / 2 - (FRONT_DESK_DOOR_SETBACK_METERS / METERS_PER_YARD),
    ry: Math.PI,
    frontLength: 4.2 / METERS_PER_YARD,
    frontDepth: 0.75 / METERS_PER_YARD,
    returnLength: 2.1 / METERS_PER_YARD,
    returnCollisionWidth: 0.798 / METERS_PER_YARD,
    returnStaffExtent: 1.645 / METERS_PER_YARD,
    counterTop: 1.055,
  };
  if (variant === 'pine-hills-v2') Object.assign(frame, PINE_HILLS_V2_LAYOUT.frame);
  return Object.freeze(frame);
}
export const FRONT_DESK_FRAME = deriveFrontDeskFrame(CLUBHOUSE_LAYOUT_VARIANT);

function normalizeAngle(angle) {
  const wrapped = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Math.abs(wrapped + Math.PI) < 1e-12 ? Math.PI : wrapped;
}

export function frontDeskPoint(localX = 0, localZ = 0) {
  const cos = Math.cos(FRONT_DESK_FRAME.ry);
  const sin = Math.sin(FRONT_DESK_FRAME.ry);
  return {
    x: FRONT_DESK_FRAME.x + localX * cos + localZ * sin,
    z: FRONT_DESK_FRAME.z - localX * sin + localZ * cos,
  };
}

export function frontDeskVector(localX = 0, localZ = 0) {
  const cos = Math.cos(FRONT_DESK_FRAME.ry);
  const sin = Math.sin(FRONT_DESK_FRAME.ry);
  return {
    x: localX * cos + localZ * sin,
    z: -localX * sin + localZ * cos,
  };
}

export function frontDeskLocalPoint(x = 0, z = 0) {
  const dx = x - FRONT_DESK_FRAME.x;
  const dz = z - FRONT_DESK_FRAME.z;
  const cos = Math.cos(FRONT_DESK_FRAME.ry);
  const sin = Math.sin(FRONT_DESK_FRAME.ry);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

export function frontDeskPose(localX = 0, localZ = 0, localRy = 0) {
  return {
    ...frontDeskPoint(localX, localZ),
    ry: normalizeAngle(FRONT_DESK_FRAME.ry + localRy),
  };
}

export function frontDeskRect(rect) {
  const points = [
    frontDeskPoint(rect.minX, rect.minZ),
    frontDeskPoint(rect.minX, rect.maxZ),
    frontDeskPoint(rect.maxX, rect.minZ),
    frontDeskPoint(rect.maxX, rect.maxZ),
  ];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
  };
}

const frontHalf = FRONT_DESK_FRAME.frontLength / 2;
const depthHalf = FRONT_DESK_FRAME.frontDepth / 2;
export const FRONT_DESK_COLLIDERS = Object.freeze({
  frontRun: Object.freeze(frontDeskRect({
    minX: -frontHalf, maxX: frontHalf,
    minZ: -depthHalf, maxZ: depthHalf,
  })),
  // The staff-side return closes the east/reception end of the work area.
  returnRun: Object.freeze(frontDeskRect({
    minX: -frontHalf, maxX: -frontHalf + FRONT_DESK_FRAME.returnCollisionWidth,
    minZ: depthHalf, maxZ: FRONT_DESK_FRAME.returnStaffExtent,
  })),
});

// The procedural Pine Hills backdrop is 4.85 yd wide. Its two board renderers
// currently add +0.20 on world Z after consuming these poses; because the desk
// frame faces PI radians, that moves a board 0.20 yd toward local -Z. Keeping
// the compensation explicit here aligns both board faces with the key rack and
// prevents layout edits from silently pulling them back into the desk hardware.
// Under pine-hills-v2 the free-standing backdrop panel does not exist: the board
// surface IS the real south wall (interior face minus the shared 0.075 framed-
// board mount offset), so the key rack and boards land on the wall plane. The
// +0.20 world-Z compensation is ry-PI-specific and must NOT be applied at ry 0 —
// the v2 renderer mounts boards at surfaceLocalZ directly.
export const FRONT_DESK_BACKDROP = Object.freeze({
  width: 4.85,
  surfaceLocalZ: CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
    ? MODERN_PUBLIC_INTERIOR.d / 2 - 0.075 - PINE_HILLS_V2_LAYOUT.frame.z
    : 1.88,
  boardWorldZOffset: 0.20,
  edgeInset: 0.06,
  minimumElementGap: 0.07,
});

export const FRONT_DESK = Object.freeze({
  laptop: Object.freeze(frontDeskPose(-1.72, 0.08, 0)),
  phone: Object.freeze(frontDeskPose(-2.08, -0.16, 0.12)),
  deskLamp: Object.freeze(frontDeskPose(-1.12, -0.12, 0)),
  clipboard: Object.freeze(frontDeskPose(-1.56, -0.17, 0.18)),
  scorecards: Object.freeze(frontDeskPose(1.55, -0.16, -0.12)),
  staffChair: Object.freeze(frontDeskPose(-1.00, 1.05, Math.PI)),
  // One readable backdrop row: keys at reception-left, the live tee sheet near
  // the staff chair, and the club mark on the checkout half. The board poses
  // compensate the renderer's world-Z offset so all three elements share the
  // same wall plane instead of floating over the counter hardware.
  keyRack: Object.freeze({
    ...frontDeskPose(-1.93, FRONT_DESK_BACKDROP.surfaceLocalZ, Math.PI),
    w: 0.75 / METERS_PER_YARD,
  }),
  teeTimeBoard: Object.freeze({
    ...frontDeskPose(-0.75, FRONT_DESK_BACKDROP.surfaceLocalZ
      + FRONT_DESK_BACKDROP.boardWorldZOffset, Math.PI),
    w: 1.38,
    h: 0.96,
  }),
  logoBackdrop: Object.freeze({
    ...frontDeskPose(0.95, FRONT_DESK_BACKDROP.surfaceLocalZ
      + FRONT_DESK_BACKDROP.boardWorldZOffset, Math.PI),
    w: 1.20,
    h: 0.90,
  }),
});

// Eight serviceable rectangular panels, authored in two public-room banks.
// Their IDs are shared verbatim with clubhouseRestoration; renderers consume
// the persisted panel snapshot and never invent a second fault state.
export const CLUBHOUSE_CEILING_PANELS = Object.freeze([
  Object.freeze({ id: 'panel-01', x: -7.5, z: -2.55, w: 2.45, d: 0.68 }),
  Object.freeze({ id: 'panel-02', x: -4.1, z: -2.55, w: 2.45, d: 0.68 }),
  Object.freeze({ id: 'panel-03', x: -0.2, z: -2.55, w: 2.45, d: 0.68 }),
  Object.freeze({ id: 'panel-04', x: 3.7, z: -2.55, w: 2.45, d: 0.68 }),
  Object.freeze({ id: 'panel-05', x: -7.5, z: 2.65, w: 2.45, d: 0.68 }),
  Object.freeze({ id: 'panel-06', x: -4.1, z: 2.65, w: 2.45, d: 0.68 }),
  Object.freeze({ id: 'panel-07', x: -0.2, z: 2.65, w: 2.45, d: 0.68 }),
  Object.freeze({ id: 'panel-08', x: 3.7, z: 2.65, w: 2.45, d: 0.68 }),
]);

// Exact Blender-to-layout datums for the two-piece 4.20 m reception shell.
// Asset 61 contributes 2.93 m; the supplemental module contributes 1.27 m
// plus the staff return. Both remain at authored scale and meet at one seam.
export const FRONT_DESK_ASSETS = Object.freeze({
  asset61: Object.freeze(frontDeskPose(0.635 / METERS_PER_YARD, 0, Math.PI)),
  returnModule: Object.freeze(frontDeskPose(
    -1.465 / METERS_PER_YARD,
    0.595 / METERS_PER_YARD,
    Math.PI,
  )),
  scale: 1 / METERS_PER_YARD,
});

export const STOCKROOM = {
  bounds: { minX: 5.7, maxX: MODERN_PUBLIC_INTERIOR.w / 2, minZ: -MODERN_PUBLIC_INTERIOR.d / 2, maxZ: 2.0 },
  receivingInside: { x: 7.65, z: -4.50 },  // set-down stack, clear of the restroom pod and freight lane
  // Diagonal to the receiving door: close to the carry route, but clear of its
  // exterior aperture and the raised service road beside the east wall.
  padOutside: { x: 11.7, z: 0.0 },
  // Deep enough inside the service room to leave the storage-door capsule
  // route clear, while retaining a full approach lane on the east side.
  packing: { x: 6.30, z: -1.7, ry: 0 },    // the packing bench (tape gun, clipboard)
  // Ref 42 parks in the rear service bay between the restroom enclosure and
  // receiving stack. It remains reachable without narrowing the door lane.
  handTruck: { x: 7.15, z: 0.45 },
  bin: { x: 8.35, z: 1.3 },                // recycling by the stock door, east of the swing
  cleaning: { x: 6.1, z: 1.45 },           // mop bucket / brooms corner
};

// The rear service-spine door opens into a real compact single-user restroom,
// not receiving stock with a misleading sign. These values mirror the
// project-owned Blender shell's metre datums after conversion to gameplay yards.
const MODERN_RESTROOM_SCALE = 1 / 0.9144;
export const MODERN_PUBLIC_RESTROOM = Object.freeze({
  wallThickness: 0.23 * MODERN_RESTROOM_SCALE,
  eastWallX: 6.90 * MODERN_RESTROOM_SCALE,
  southWallZ: -3.25 * MODERN_RESTROOM_SCALE,
  northWallZ: -5.00 * MODERN_RESTROOM_SCALE,
  crossWallCenterX: ((5.35 + 0.23 / 2 + 6.90 + 0.23 / 2) / 2) * MODERN_RESTROOM_SCALE,
  crossWallWidth: (6.90 + 0.23 / 2 - (5.35 + 0.23 / 2)) * MODERN_RESTROOM_SCALE,
  toilet: Object.freeze({ x: 6.42 * MODERN_RESTROOM_SCALE, z: -4.70 * MODERN_RESTROOM_SCALE, w: 0.72 * MODERN_RESTROOM_SCALE, d: 0.36 * MODERN_RESTROOM_SCALE }),
  sink: Object.freeze({ x: 5.84 * MODERN_RESTROOM_SCALE, z: -4.70 * MODERN_RESTROOM_SCALE, w: 0.52 * MODERN_RESTROOM_SCALE, d: 0.30 * MODERN_RESTROOM_SCALE }),
});

export const OFFICE = {
  bounds: { minX: 5.7, maxX: MODERN_PUBLIC_INTERIOR.w / 2, minZ: 2.0, maxZ: MODERN_PUBLIC_INTERIOR.d / 2 },
  desk: { x: 8.35, z: 4.2, ry: Math.PI / 2 },    // against the east wall, faces west
  chair: { x: 7.46, z: 4.80 },
  filing: { x: 5.99, z: 5.10, ry: 0 },
  // Compatibility alias: laptop interactions now live on the shared front desk.
  laptop: FRONT_DESK.laptop,
  map: { x: 8.15, z: 5.42, ry: Math.PI },        // framed course map on the office's south wall
  calendar: { x: 7.1, z: 2.15, ry: Math.PI },    // on partition B's office face
};

// The lounge is furnished from day one (dirty) — refs 1/2/8. The set below is
// base dressing; the lounge1 decor upgrade replaces it with the premium suite.
export const LOUNGE = {
  bounds: { minX: 2.4, maxX: 5.7, minZ: -MODERN_PUBLIC_INTERIOR.d / 2, maxZ: -3.2 },
  chairA: { x: 3.45, z: -4.85, ry: 0 },
  chairB: { x: 4.80, z: -3.80, ry: -2.10 },
  coffee: { x: 3.45, z: -4.15 },
  rug: { x: 3.85, z: -4.45, ry: 0 },
  trophy: { x: 5.42, z: -4.85, ry: -Math.PI / 2 },   // on the partition's west face
  events: { x: 5.55, z: -3.75, ry: -Math.PI / 2 },   // club events board beside it
  photo: { x: 4.95, z: -5.38, ry: 0 },               // course photography, clear of the window
};

// --- checkout ---------------------------------------------------------------------
// A person is 0.68 yd across, and a till is a workspace, not a gap: you stand at it, turn, pull
// the drawer, and bag. The counter used to sit 0.55 yd off the back counter — narrower than the
// player — so there was no staff side at all and the register had to be worked by reaching over
// from the customer's aisle. The counter moved north and the back counter to the wall to open a
// real corridor behind it. `tests/checkout-space.test.js` holds that open.
export const PLAYER_DIAM = 0.68;
export const STAFF_CORRIDOR_MIN = 1.1;

const counterCentre = frontDeskPoint(0, 0);
const registerDatum = frontDeskPoint(-1.2, 0);
const queueHead = frontDeskPoint(-0.48, -1.05);
// A live customer has a 0.32 yd body radius.  The slightly wider lateral
// pitch keeps the second person in line physically clear of the protected
// entrance rectangle, not merely clear at their centre point.
const queuePitch = frontDeskVector(-1.18, -0.45);
const staffDatum = frontDeskPoint(-0.10, 0.90);

export const COUNTER = {
  x: counterCentre.x,
  z: counterCentre.z,
  len: FRONT_DESK_FRAME.frontLength,
  depth: FRONT_DESK_FRAME.frontDepth,
  ry: FRONT_DESK_FRAME.ry,
  registerX: registerDatum.x,
  registerZ: registerDatum.z,
  // The paying customer faces the entrance; the line turns east before it
  // reaches the protected main-door corridor.
  queueBase: queueHead,
  queueStep: queuePitch,
  staffStand: staffDatum,
};
export function queueSlot(i) {
  return { x: COUNTER.queueBase.x + COUNTER.queueStep.x * i, z: COUNTER.queueBase.z + COUNTER.queueStep.z * i };
}

// --- the register workspace ---------------------------------------------------------
// A till is a production line, and the geometry has to make the line obvious. Goods
// land in front of the CUSTOMER (west, at the queue head, where they can reach).
// They get dragged across the scanner in the MIDDLE. They end up bagged on the STAFF
// side, downstream to the east. West → east, customer side → staff side.
//
// The scan volume sits deliberately between the staging tray and the bagging mat, so
// the natural motion — pick it up there, put it down here — sweeps the barcode over
// the glass on the way. That is the whole design: scanning is not a button, it is
// what happens when you move an item the way you would move it anyway. Drop one into
// the bag around the side without crossing, and it stays unscanned, and an unscanned
// item is one you cannot take money for.
//
// Everything here is INTERIOR-LOCAL. y is absolute (FLOOR_TOP is 0.3, the counter
// top is 1.055) because the scan volume has to be a real height off a real surface.

export const COUNTER_TOP = FRONT_DESK_FRAME.counterTop;

// Everything below was DERIVED against two reach circles, not eyeballed. The player
// stands at (2.80, 5.10) and can reach 1.55 yd; the customer stands at the head of
// the queue, (1.60, 3.05), and can lean 1.6 yd over the counter. Anything a hand has
// to touch lives inside the right circle, and checkout-space.test.js proves it —
// the first cut put the staging tray a 1.68 yd stretch away and the test caught it.

const registerRect = (minX, maxX, minZ, maxZ) => frontDeskRect({ minX, maxX, minZ, maxZ });
const drawerTravel = frontDeskVector(0, 0.44);

export const REGISTER = {
  // the kit, on the counter top — TCG reference arrangement: from the cashier's
  // view (standing at +z looking toward the queue) the BAG sits far LEFT (-x),
  // the merchandise lands centre-left, and the POS + drawer + terminal + printer
  // form the register block on the RIGHT (+x), over the counter's closed cabinet.
  // ry 0: the kit devices author their screen face toward -Y, which the exporter
  // turns to face +z — the staff side — at rotation zero.
  monitor: frontDeskPose(0.52, 0.22, 0),
  cardterm: frontDeskPose(0.10, -0.16, 0),
  scanner: frontDeskPose(-0.20, 0.02, Math.PI + 0.22),
  printer: frontDeskPose(1.08, 0.28, Math.PI - 0.18),
  custdisplay: frontDeskPose(0.94, -0.10, Math.PI),
  bag: frontDeskPose(-0.50, 0.24, 0),
  bagstand: frontDeskPose(1.30, 0.30, 0),
  divider: frontDeskPose(1.52, -0.15, 0),
  impulse: frontDeskPose(1.28, -0.34, 0),

  // The drawer lives UNDER the counter, directly below the POS, and slides out
  // toward the staff side. Travel 0.44 pulls the BILL row (the tray's rear
  // rank) fully past the counter slab — at 0.34 the notes sat half-hidden
  // under the top and reads/clicks went to the coin row in front. The staff
  // corridor keeps 0.71 yd with it open (player is 0.68).
  drawer: {
    ...frontDeskPoint(0.52, depthHalf - 0.06),
    y: 0.86,
    w: 0.46,
    d: 0.40,
    travel: 0.44,
    travelX: drawerTravel.x,
    travelZ: drawerTravel.z,
  },

  // surfaces
  staging: registerRect(-0.85, -0.10, -0.39, -0.10),
  // Scanned goods stay visible and loose until payment is complete. This strip
  // is downstream of the reader but clear of both the open bag and POS hardware.
  scannedStaging: registerRect(-1.28, -0.62, -0.12, 0.04),
  // counted change rests in this shallow authored tray before handoff. Keeping
  // the footprint in the shared layout makes the prop, money, reach tests and
  // camera composition use one source of truth.
  changeHandoff: { ...frontDeskPoint(0.20, 0.30), w: 0.38, d: 0.20 },
  // the bag handoff zone: items leave the reader and arc INTO THE BAG at
  // counter-left — there is no separate bagging mat any more
  bagging: registerRect(-0.72, -0.30, 0.10, 0.38),

  // THE SCAN VOLUME. An item counts as scanned when its barcode passes THROUGH this
  // box — not when it comes to rest in it. Both surfaces sit clear of it, so nothing
  // ever auto-scans by being put down; and the crossing is a swept segment test, so a
  // fast drag cannot tunnel straight through and come out the far side unscanned.
  scan: { ...registerRect(-0.48, 0.08, -0.18, 0.24), minY: 1.06, maxY: 1.34 },

  stand: staffDatum,
};

// the AABB of a workspace rect, for tests and for clamping a carried item
export const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

// permanent entrance dressing
export const MAT = { x: -0.8, z: 4.95 };               // welcome mat inside the door
// Reusable hand baskets live just west of the entrance mat. The pickup slot is
// offset into the aisle so neither customer routing nor the door swing touches it.
export const BASKET_STATION = {
  x: -2.35, z: 5.05,
  pickup: { x: -2.05, z: 4.55 },
  w: 0.72, d: 0.52,
};
export const LOGO_RUG = { x: -0.8, z: 3.1, w: 3.6, d: 2.4 }; // club logo rug on the entry axis
export const HOURS_SIGN = { x: 0.58, z: 6.02 };        // readable between the door trim and porch column

// --- retail fixtures ----------------------------------------------------------------
// kind: shelf | rack | table | rail | hatstand | bagstand | shoerack | apparelwall | feature
//     | snackrack | backcounter | backshelf
// The municipal clubhouse conveys this working set independently of the shop
// expansion tier. Keeping the IDs with the fixture datum prevents campaign,
// renderer, navigation, and migration code from maintaining rival lists.
export const FURNISHED_CLUBHOUSE_FIXTURE_IDS = Object.freeze([
  'rack_drivers', 'rack_irons', 'rack_putters',
  'shelf_balls', 'shelf_acc', 'shelf_small',
  'table_polos', 'rail_outer', 'hatstand', 'bagstand', 'shoerack',
  'cold_drinks', 'snackrack', 'member_station', 'feature',
  'backcounter', 'backshelf_n', 'backshelf_e', 'backshelf_e2',
  'office_desk', 'office_chair', 'office_filing', 'packing_bench',
]);

export const FIXTURES = [
  // the club wall — one architectural run down the west wall (refs 1/5)
  { id: 'rack_drivers', kind: 'rack', x: -8.55, z: -3.2, ry: Math.PI / 2, skus: ['driver1', 'driver2', 'driver3'], title: 'Drivers & woods', zone: 'clubwall', browse: [{ x: -0.65, z: 1.05 }, { x: 0.65, z: 1.05 }], stock: [{ x: 0, z: 0.95 }], experienceAfter: ['tour_vault'] },
  { id: 'rack_irons', kind: 'rack', x: -8.55, z: -0.2, ry: Math.PI / 2, skus: ['irons1', 'irons2', 'wedge1', 'wedge2'], title: 'Irons & wedges', zone: 'clubwall', browse: [{ x: -0.65, z: 1.05 }, { x: 0.65, z: 1.05 }], stock: [{ x: 0, z: 0.95 }] },
  { id: 'rack_putters', kind: 'rack', x: -8.55, z: 2.8, ry: Math.PI / 2, skus: ['putter1', 'putter2', 'putter3'], title: 'Putter studio', zone: 'clubwall', browse: [{ x: -0.65, z: 1.05 }, { x: 0.65, z: 1.05 }], stock: [{ x: 0, z: 0.95 }], experienceAfter: ['putting_demo'] },
  // north wall retail walls
  { id: 'shelf_balls', kind: 'shelf', x: -7.2, z: -5.05, ry: 0, skus: ['balls1', 'balls2', 'balls3'], title: 'Golf balls', zone: 'balls', browse: [{ x: -0.8, z: 1.0 }, { x: 0.8, z: 1.0 }], stock: [{ x: 0, z: 0.92 }] },
  { id: 'shelf_acc', kind: 'pegboard', x: -4.0, z: -5.05, ry: 0, skus: ['tees1', 'towel1', 'marker1', 'divot1', 'sunglasses2', 'bottle1', 'umb1'], title: 'Golf essentials', zone: 'accessories', browse: [{ x: -0.8, z: 1.0 }, { x: 0.8, z: 1.0 }], stock: [{ x: 0, z: 0.92 }] },
  { id: 'shelf_small', kind: 'apparelwall', x: -0.8, z: -5.05, ry: 0, skus: ['glove1', 'glove2', 'sock1'], title: 'Apparel & gloves', zone: 'apparel', browse: [{ x: -0.8, z: 1.0 }, { x: 0.8, z: 1.0 }], stock: [{ x: 0, z: 0.92 }], experienceAfter: ['fittingroom'] },
  // apparel block, center floor
  { id: 'table_polos', kind: 'table', x: -6.0, z: 0.65, ry: 0, skus: ['polo1', 'polo2', 'pants2', 'shorts1'], title: 'Course apparel', zone: 'apparel', browse: [{ x: -0.72, z: 1.18 }, { x: 0.72, z: 1.18 }, { x: 0, z: -1.18 }], stock: [{ x: 0, z: 1.12 }], experienceAfter: ['fittingroom'] },
  { id: 'rail_outer', kind: 'rail', x: -0.5, z: -3.2, ry: Math.PI / 2, skus: ['jacket2'], title: 'Outerwear', zone: 'apparel', browse: [{ x: -0.38, z: 0.82 }, { x: 0.38, z: 0.82 }], stock: [{ x: 0, z: 0.76 }] },
  { id: 'hatstand', kind: 'hatstand', x: 2.0, z: -4.95, ry: 0, skus: ['cap1', 'cap2', 'visor1'], title: 'Hat tree', sign: 'Pine Hills headwear', zone: 'apparel', browse: [{ x: 0, z: 0.9 }], stock: [{ x: 0, z: 0.82 }] },
  // bag & shoe fitting, against the service partition (ref 7)
  { id: 'bagstand', kind: 'bagstand', x: 2.05, z: -2.65, ry: 0, skus: ['bag1', 'bag3'], title: 'Golf bags', zone: 'bags', browse: [{ x: -0.65, z: 1.12 }, { x: 0.65, z: 1.12 }], stock: [{ x: 0, z: 1.05 }], minTier: 2 },
  { id: 'fittingroom', kind: 'fittingroom', x: -3.0, z: -2.85, ry: Math.PI / 2, skus: [], title: 'Fitting room', zone: 'shoes', minTier: 3, experience: 'fitting', browse: [{ x: 0, z: 0.16 }], experienceTarget: { x: 0, z: -0.58 } },
  { id: 'shoerack', kind: 'shoerack', x: -5.9, z: -3.5, ry: 0, skus: ['shoe1', 'shoe3'], title: 'Golf shoes', zone: 'shoes', browse: [{ x: -0.62, z: 1.48 }, { x: 0.62, z: 1.48 }], stock: [{ x: 0, z: 1.40 }], minTier: 2, experienceAfter: ['fittingroom'], footprint: { minX: -1.23, maxX: 1.23, minZ: -0.18, maxZ: 1.18 } },
  // existing authored Sheet-03 grab-and-go shelf between the south windows
  { id: 'cold_drinks', kind: 'fridge', x: -8.55, z: 4.78, ry: Math.PI / 2, skus: ['water1', 'sportdrink2', 'soda1'], title: 'Cold drinks', zone: 'refreshments', browse: [{ x: 0, z: 0.98 }], stock: [{ x: 0, z: 0.9 }] },
  { id: 'snackrack', kind: 'snackrack', x: -6.0, z: 5.05, ry: Math.PI, skus: ['chips1', 'bar2', 'crackers1', 'snack1'], title: 'Turn snacks', zone: 'refreshments', browse: [{ x: 0, z: 0.88 }], stock: [{ x: 0, z: 0.82 }] },
  { id: 'member_station', kind: 'service', x: 2.65, z: 2.20, ry: 0, skus: ['scorecard1'], title: 'Scorecards', zone: 'membership', browse: [{ x: 0, z: 0.82 }], stock: [{ x: 0, z: 0.78 }] },
  // entrance feature display (shows whatever category is featured)
  { id: 'feature', kind: 'feature', x: -4.75, z: 3.25, ry: 0, skus: ['range2'], title: 'Rangefinder display', zone: 'entrance', browse: [{ x: 0, z: 0.96 }], stock: [{ x: 0, z: 0.88 }], minTier: 2 },
  { id: 'tour_vault', kind: 'premiumcase', x: 4.95, z: -1.65, ry: -Math.PI / 2, skus: [], title: 'Tour Vault', zone: 'premium', minTier: 3, experience: 'premium', browse: [{ x: 0, z: 0.82 }], experienceTarget: { x: 0, z: 0 } },
  { id: 'putting_demo', kind: 'demo', x: 2.75, z: 4.25, ry: 0, skus: [], title: 'Putting studio', zone: 'premium', minTier: 3, experience: 'putting', browse: [{ x: 1.22, z: 0 }], experienceTarget: { x: -1.48, z: 0 } },
  // checkout back-counter: wordmark wall, cabinets, bag stack (ref 4)
  // Bias the full-width hutch toward the closed return end.  This preserves a
  // true 1.20 m staff entrance at the opposite end of the L instead of leaving
  // two decorative slivers that the player capsule cannot use.
  { id: 'backcounter', kind: 'backcounter', ...frontDeskPose(-0.62, 2.14, 0), skus: [], title: 'Back counter', zone: 'checkout' },
  // stockroom (non-retail; visualizes backroom stock + receives boxes)
  // A short north rack fits beside, rather than through, the permanent
  // restroom pod and meets the east rack as a clean L-shaped storage run.
  { id: 'backshelf_n', kind: 'backshelf', x: 8.35, z: -5.05, ry: 0, skus: [], title: 'Backroom shelving', zone: 'stockroom', footprint: { minX: -0.5, maxX: 0.5, minZ: -0.45, maxZ: 0.45 } },
  { id: 'backshelf_e', kind: 'backshelf', x: 8.45, z: -1.75, ry: -Math.PI / 2, skus: [], title: 'Backroom shelving', zone: 'stockroom', short: true },
  { id: 'backshelf_e2', kind: 'backshelf', x: 8.45, z: -0.05, ry: -Math.PI / 2, skus: [], title: 'Backroom shelving', zone: 'stockroom', footprint: { minX: -0.85, maxX: 0.85, minZ: -0.45, maxZ: 0.45 } },
  { id: 'office_desk', kind: 'officeDesk', x: 8.35, z: 4.20, ry: Math.PI / 2, skus: [], title: 'Office desk', zone: 'office', generatedOnly: true },
  { id: 'office_chair', kind: 'officeChair', x: 7.46, z: 4.80, ry: Math.PI / 2, skus: [], title: 'Office chair', zone: 'office', generatedOnly: true },
  { id: 'office_filing', kind: 'officeFiling', ...OFFICE.filing, skus: [], title: 'Filing cabinet', zone: 'office', generatedOnly: true },
  { id: 'packing_bench', kind: 'packingbench', x: 6.30, z: -1.7, ry: 0, skus: [], title: 'Packing bench', zone: 'stockroom', generatedOnly: true },
];

// pine-hills-v2 repositions six fixtures (FLOOR_PLAN.md §5) before any consumer reads
// the array: the builders, colliders, browse sockets, placeable catalog, runtime-asset
// manifest and campaign anchors all see one consistent layout. Saved player moves in
// state.shop.layout still win over these defaults, exactly as they do over the v1 poses.
if (CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2') {
  for (const fixture of FIXTURES) {
    const pose = PINE_HILLS_V2_LAYOUT.fixturePoses[fixture.id];
    if (pose) Object.assign(fixture, pose);
    if (fixture.id === 'backcounter') {
      Object.assign(fixture, frontDeskPose(
        PINE_HILLS_V2_LAYOUT.backcounterLocal.x,
        PINE_HILLS_V2_LAYOUT.backcounterLocal.z,
        PINE_HILLS_V2_LAYOUT.backcounterLocal.ry,
      ));
    }
  }
}

// The safety campaign facility is the one absolute campaign anchor the v2 layout moves
// (FLOOR_PLAN.md §8): its v1 spot sits under tour_vault's wall run. The frame-derived
// anchors (frontCounter, registerHardware, laptop, officeChair) follow the desk on
// their own; campaignWorld.js reads this datum instead of a baked coordinate.
export const SAFETY_FACILITY_SITE = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
  ? { ...PINE_HILLS_V2_LAYOUT.safetySite }
  : { x: 5.15, z: -0.85 };

// --- start-state clutter (the "dirty, not nonsensical" rule: piles sit off the
// aisles in believable neglect spots — corners, dead zones, the stockroom) --------
export const CLUTTER_SPOTS = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
  ? PINE_HILLS_V2_LAYOUT.clutterSpots.map((spot) => ({ ...spot }))
  : [
    { x: -8.0, z: 4.7 }, { x: -6.3, z: -3.9 }, { x: 4.2, z: 0.6 }, { x: 4.7, z: 3.1 },
    // The final two piles live against the office partition. The stockroom is an
    // operational delivery workspace now; legacy piles there blocked receiving
    // and stole focus through the recycling station.
    // These employee-room piles still read as neglect, but stay off the only
    // normal-controls route through the door.
    { x: -1.2, z: -4.2 }, { x: -8.1, z: -4.8 }, { x: 6.7, z: 2.6 }, { x: 6.3, z: 4.95 },
  ];

// --- traffic paths (the dirt system paints mud/footprint trails along these) -----
// Each entry is a polyline in building-local yards: the routes real feet take.
// The v2 room routes one counterclockwise loop (FLOOR_PLAN.md §7): the queue leg
// derives from the live queueSlot() so it follows the desk frame automatically,
// and the staff corridor leg is new — v2's till is worked from behind the desk.
export const TRAFFIC_PATHS = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
  ? PINE_HILLS_V2_LAYOUT.trafficPaths(queueSlot)
  : [
    [{ x: -0.8, z: 5.45 }, { x: -0.8, z: 2.6 }, { x: -0.9, z: -1.4 }, { x: -2.2, z: -4.7 }],  // door → aisle → ball wall
    [{ x: -0.8, z: 2.6 }, queueSlot(1), queueSlot(0)],                                        // aisle → front-desk queue → service
    [{ x: -0.9, z: -1.4 }, { x: -7.6, z: -0.6 }],                                             // aisle → club wall
    [{ x: -0.9, z: -1.4 }, { x: 3.6, z: -3.4 }],                                              // aisle → bags/lounge
    [{ x: 8.1, z: 4.1 }, { x: 8.1, z: 0.6 }, { x: 8.45, z: -3.4 }],                           // office → stock door → receiving
  ];
