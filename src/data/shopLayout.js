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

import { resolveClubhouseVariant } from './clubhouseVariant.js';

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

// …and the lane through the stock door, for a reason the two above did not
// anticipate. TILL-REACH-001: the hand truck and the mop corner both gained real
// hulls in the collision sweep, and between them they narrowed this lane to 0.45
// yd against a 0.68-yd body. That cut off the office, the staff corridor and the
// staff side of the till in one go — three rooms sealed by two pieces of
// furniture nobody thought of as walls.
//
// Aligned to the door's own opening (x 7.04–8.06) with a little either side, and
// run from the receiving floor through into the office so the approach on both
// sides stays clear too.
export const STOCK_LANE_CLEARWAY = { minX: 6.96, maxX: 8.06, minZ: -0.50, maxZ: 2.40 };

export const CLEARWAYS = Object.freeze([DOOR_CLEARWAY, BACKDOOR_CLEARWAY, STOCK_LANE_CLEARWAY]);

// Three systems already refuse to PLACE things in a clearway (layout.js,
// propertyPlacement.js, boxPlacement.js). None of them police the start-state
// seeder, which is how the entrance kept ending up blocked: shop.js jitters
// every authored clutter spot by ±0.4 x / ±0.3 z, and an authored spot chosen to
// sit just clear of the rect is a coin-flip away from sitting just inside it.
//
// So the rule gets a shared enforcer instead of a fourth hand-rolled check.
// Pushes a footprint out along its axis of least penetration, which keeps a pile
// against the wall it was authored against rather than flinging it into the room.
export function clampOutOfClearways(x, z, w, d, clearways = CLEARWAYS) {
  const EPS = 0.01;
  let cx = x;
  let cz = z;
  const hw = w / 2;
  const hd = d / 2;
  // Two passes: clearing one rect can push a footprint into the other.
  for (let pass = 0; pass < 2; pass += 1) {
    let moved = false;
    for (const r of clearways) {
      if (cx + hw <= r.minX || cx - hw >= r.maxX
        || cz + hd <= r.minZ || cz - hd >= r.maxZ) continue;
      const west = (cx + hw) - r.minX;
      const east = r.maxX - (cx - hw);
      const north = (cz + hd) - r.minZ;
      const south = r.maxZ - (cz - hd);
      const least = Math.min(west, east, north, south);
      if (least === west) cx -= west + EPS;
      else if (least === east) cx += east + EPS;
      else if (least === north) cz -= north + EPS;
      else cz += south + EPS;
      moved = true;
    }
    if (!moved) break;
  }
  return { x: cx, z: cz };
}

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
// Approved in Designs/ProShop/Greybox/FLOOR_PLAN.md. The v2 room exists ONLY when this
// session asked for it, and the variant resolves ONCE, at module load, so in Node and in
// any session that did not ask every exported value below is byte-identical to the v1
// numbers — the existing tests and the live game cannot notice the variant exists.
// clubhouse.js reads CLUBHOUSE_VARIANT_REQUEST below for its presentation choice rather
// than resolving again, so the room that draws and the datums that place things can never
// disagree.
//
// The request can arrive from a URL query, an Electron launch flag, or a persisted dev
// setting — see src/data/clubhouseVariant.js for why there are three and why they all
// have to be readable synchronously.
export const CLUBHOUSE_VARIANT_REQUEST = Object.freeze(resolveClubhouseVariant());

// Only pine-hills-v2 moves DATUMS. The other selectable variants are presentation-only,
// so they must resolve to null here or they would shift coordinates nobody authored
// against them.
export const CLUBHOUSE_LAYOUT_VARIANT = CLUBHOUSE_VARIANT_REQUEST.variant === 'pine-hills-v2'
  ? 'pine-hills-v2'
  : null;

// Everything the v2 layout changes, in one place, frame-independent, so the layout
// tests can audit the variant from Node without module-state games.
export const PINE_HILLS_V2_LAYOUT = Object.freeze({
  // Decision D1 (unchanged by the resize): the desk is a south-wall counter east
  // of the entrance. At ry 0 the staff side (+local z) faces the south wall.
  frame: Object.freeze({ x: 3.30, z: 3.35, ry: 0 }),

  // THE RESIZE (OVERNIGHT_REPORT.md §3, approved): the public retail floor
  // shrinks to a municipal 70.0 m² — 8.30 × 10.09 yd — by pulling the west wall
  // to x −2.60 and the north wall to z −4.60. East (service partition) and south
  // (door/porch) anchor, so the desk frame, queue, backdrop, campaign anchors and
  // the entire service wing keep their proven datums. The space behind the new
  // walls is sealed dead cavity until the exterior shell is re-authored (Phase 4+).
  publicBounds: Object.freeze({
    minX: -2.60,
    maxX: 5.70,
    minZ: -4.60,
    maxZ: MODERN_PUBLIC_INTERIOR.d / 2,
  }),
  wallT: 0.25,
  // Item 10: cramped is vertical too. 2.80 yd = 2.56 m under the 2.93 m original,
  // with four exposed grey beams (2.40 m clear beneath). Beam stations stay
  // ≥1.3 yd off the door wall so the 2.68-yd door head keeps a clean frame.
  ceilingY: 2.80,
  beams: Object.freeze({
    width: 0.22,
    depth: 0.18,
    zStations: Object.freeze([-3.35, -0.85, 1.65, 4.15]),
  }),

  // Cut rather than crammed (report §3's table): a failing muni starter keeps
  // consumables, one fitting booth, the demo strip, and the mandated lounge.
  // Clubs, apparel depth, bags, shoes and refreshments are the upgrade path.
  cutFixtures: Object.freeze([
    'rack_drivers', 'rack_irons', 'rack_putters',
    'table_polos', 'shoerack', 'bagstand', 'rail_outer',
    'hatstand', 'snackrack', 'cold_drinks', 'shelf_small',
  ]),
  // The gloves display folds into the essentials pegboard rather than keeping a
  // third wall unit the shortened west wall cannot hold.
  skuOverrides: Object.freeze({
    shelf_acc: Object.freeze([
      'tees1', 'towel1', 'marker1', 'divot1', 'sunglasses2', 'bottle1', 'umb1',
      'glove1', 'glove2', 'sock1',
    ]),
  }),

  fixturePoses: Object.freeze({
    // NW corner, ry 0: the booth's authored analytic hull is axis-aligned with
    // its curtain on +x, so at ry 0 the visible shell and the collision walls
    // agree — the rotation desync the punch list flagged cannot exist here.
    fittingroom: Object.freeze({ x: -0.35, z: -3.70, ry: 0 }),
    // The west wall carries the whole tier-0 retail run: balls south, the
    // (gloves-folded) essentials pegboard north, both ending short of the door
    // clearway's x band.
    shelf_balls: Object.freeze({ x: -2.25, z: -1.55, ry: Math.PI / 2 }),
    shelf_acc: Object.freeze({ x: -2.25, z: 1.75, ry: Math.PI / 2 }),
    // Centre-south, ry 0: the power display faces the entrance with its browse
    // stand on the door side, clear of the queue's westward line.
    feature: Object.freeze({ x: 0.55, z: -0.55, ry: 0 }),
    // The 0.4-yd putting strip mid-room; the relocated lounge watches the green
    // over it and the door→lounge fan sees across it at every tier.
    putting_demo: Object.freeze({ x: 1.70, z: -2.20, ry: 0 }),
    // z 2.15 (not 2.05): at 2.05 the station's rect grazes the relocated safety
    // keep-clear by 0.03 yd.
    member_station: Object.freeze({ x: 5.15, z: 2.15, ry: -Math.PI / 2 }),
  }),
  // The wordmark hutch stays on the staff side of the corridor, against the S wall.
  backcounterLocal: Object.freeze({ x: 0.70, z: 1.84, ry: 0 }),
  // The safety campaign facility keeps its partition-run site (FLOOR_PLAN.md §8).
  safetySite: Object.freeze({ x: 5.30, z: 1.35 }),

  // THE QUEUE RULING (2026-07-28, closes OVERNIGHT_REPORT §12's flag): the v1
  // frame-local pitch steps WEST into the room, which in the 70 m² envelope
  // lays the waiting line across the leavers' path to the door and runs slots
  // ≥5 through the west shelves and out of the room — the resized day run's
  // entire residual jam class. v2 re-pitches the line EAST along the desk
  // face: head unchanged at local (-0.48, -1.05) so the proven checkout reach
  // circles and camera poses hold; the tail now grows AWAY from the exit, and
  // the two flows can never cross. The face runs out at member_station, so the
  // line holds three; deeper indices (a no-cashier full house) wait in the
  // overflow pocket on the open floor south-east of centre.
  queue: Object.freeze({
    headLocal: Object.freeze({ x: -0.48, z: -1.05 }),
    pitchLocal: Object.freeze({ x: 0.80, z: 0.10 }),
    lineSlots: 3,
    // Room-absolute sunflower packing: r = min(r0 + rGrow*sqrt(k), rMax) at
    // angle k*goldenAngle. The nine points a full house uses (k 0-8) are all
    // ≥0.30 from every fixture rect, wall and the desk slab, and every one is
    // clear of the exit lane — tests/pine-hills-v2-layout.test.js holds this.
    // Anchor sits SW with z capped at 1.80 (first requeue day run): the first
    // anchor's crowd reached z 2.30 and pressed browsing customers into the
    // member_station stand band (z ≈ 2.15) and toward the corridor mouth.
    overflow: Object.freeze({
      x: 3.15, z: 0.95, r0: 0.45, rGrow: 0.26, rMax: 0.85,
      goldenAngle: 2.399963229728653,
    }),
  }),

  // THE CORRIDOR SEAL (first requeue day run, 2026-07-28): FLOOR_PLAN §7
  // promises "customers cannot enter the corridor — the return closes its west
  // end, the desk its north flank", and the §6 drawing runs the partition line
  // continuously into the desk. The build never did: PARTITIONS ends the x 5.70
  // wall at z 2.00 while the desk face starts at z 2.94, and the measured day
  // run shows customers body-shoved through that 0.94-yd hole and pinned in
  // the staff corridor for game-hours. This stub is the drawn wall segment,
  // v2-only (PARTITIONS itself is shared with v1 and untouchable).
  // zTo runs to the desk's STAFF edge (3.76), not just the customer face: the
  // exclusive 1× curve leg caught one body in the wing pocket east of the desk
  // — the last sub-capsule seams are the stub-to-desk T and the hutch-east
  // sliver (filled below). The staff mouth (z 3.86–4.89) stays open.
  corridorSeal: Object.freeze({ x: 5.70, t: 0.20, zFrom: 2.00, zTo: 3.76 }),

  // THE WEST SEAL (sealed-room day run, same day): with the east hole closed,
  // walkers still surfaced inside the corridor. The route decodes to a Z-shaped
  // sub-capsule channel the §6 drawing shows sealed ("hutch-to-return wall gap
  // … sealed by the return end panel") and the greybox shipped visual-only on
  // the assumption sub-capsule means impassable — body-separation shoves
  // tunnel it. Two cabinetry fillets close it airtight: the return's back
  // filled to the south wall, and the return-to-hutch gap filled over the
  // south band. Both flush on every seam — the layout test re-derives each
  // edge from the live frame and hutch and pins flushness.
  corridorWestSeal: Object.freeze({
    returnBackFill: Object.freeze({ minX: 1.00, maxX: 1.88, minZ: 5.15, maxZ: 5.49 }),
    hutchGapFill: Object.freeze({ minX: 1.88, maxX: 2.40, minZ: 4.89, maxZ: 5.49 }),
    // The hutch-east sliver (hutch ends 5.60, partition band 5.60–5.80): a
    // 0.10-yd corridor↔wing seam over the south band. Sub-capsule, and the 1×
    // curve leg proved once more that sub-capsule is not sealed.
    hutchEastFill: Object.freeze({ minX: 5.60, maxX: 5.80, minZ: 4.89, maxZ: 5.49 }),
  }),

  // The lounge keeps its mandate (cleaning surface, entrance-visible) inside the
  // new envelope: NE corner, chairs facing the putting strip, boards on the
  // partition's west face, course photography on the new north wall.
  loungeSet: Object.freeze({
    bounds: Object.freeze({ minX: 2.40, maxX: 5.70, minZ: -4.60, maxZ: -2.40 }),
    chairA: Object.freeze({ x: 3.55, z: -4.05, ry: 0 }),
    chairB: Object.freeze({ x: 4.45, z: -3.30, ry: -2.10 }),
    coffee: Object.freeze({ x: 3.55, z: -3.35 }),
    rug: Object.freeze({ x: 3.95, z: -3.65, ry: 0 }),
    trophy: Object.freeze({ x: 5.42, z: -4.05, ry: -Math.PI / 2 }),
    events: Object.freeze({ x: 5.55, z: -2.95, ry: -Math.PI / 2 }),
    photo: Object.freeze({ x: 4.60, z: -4.50, ry: 0 }),
  }),

  // Eight authored neglect spots — corners and dead zones of the NEW envelope,
  // each ≥0.8 yd off every traffic leg (the layout test holds this).
  clutterSpots: Object.freeze([
    Object.freeze({ x: 1.55, z: -4.25 }),  // unshelved sleeve boxes under the north wall
    Object.freeze({ x: -2.05, z: -4.05 }), // dead pocket between the booth and the west wall
    Object.freeze({ x: -2.35, z: 4.85 }),  // SW sliver west of the door clearway
    Object.freeze({ x: 0.95, z: 4.90 }),   // south-wall pocket east of the door
    Object.freeze({ x: 2.45, z: -3.95 }),  // carry-out boxes beside the lounge
    Object.freeze({ x: 6.70, z: 2.60 }),   // office paperwork pile (kept)
    Object.freeze({ x: 5.25, z: 0.10 }),   // returns pile against the partition (kept)
    Object.freeze({ x: 6.55, z: 5.20 }),   // office corner pile (kept)
  ]),
  // Pure over the queue-slot function so layout tests can audit the shipped
  // polylines from Node. One customer loop (door → west retail aisle → the
  // feature/demo gap → lounge), the queue spur, and the two staff legs.
  trafficPaths(slotAt) {
    return [
      [{ x: -0.8, z: 4.90 }, { x: -1.30, z: 2.40 }, { x: -1.30, z: -0.20 }, { x: -0.80, z: -2.40 }],
      [{ x: -0.60, z: 2.60 }, slotAt(0), slotAt(2)],
      [{ x: -0.80, z: -2.40 }, { x: -0.55, z: -1.38 }, { x: 3.95, z: -1.38 }, { x: 4.30, z: -2.35 }],
      [{ x: 6.4, z: 4.3 }, { x: 4.3, z: 4.3 }],
      [{ x: 8.1, z: 4.1 }, { x: 8.1, z: 0.6 }, { x: 8.45, z: -3.4 }],
    ];
  },
});

// The public room's wall envelope, variant-resolved. Consumers that seed along
// or mount onto the public walls (dirt banks, wall-hung runtime assets, the
// greybox wall volumes) read THIS and never learn about variants.
export const PUBLIC_ROOM_BOUNDS = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
  ? PINE_HILLS_V2_LAYOUT.publicBounds
  : Object.freeze({
    minX: -MODERN_PUBLIC_INTERIOR.w / 2,
    maxX: MODERN_PUBLIC_INTERIOR.w / 2,
    minZ: -MODERN_PUBLIC_INTERIOR.d / 2,
    maxZ: MODERN_PUBLIC_INTERIOR.d / 2,
  });

// Pure over the frozen v2 spec — the layout test audits the shipped queue from
// Node with this exact function, and the browser build routes queueSlot()
// through it under the variant, so the audited numbers and the lived ones
// cannot drift. Line slots transform frame-local head/pitch through the v2
// frame; overflow points are room-absolute sunflower packing: deterministic,
// unique, bounded — a full house bunches on open floor instead of extending a
// line into a wall.
export function pineHillsV2QueueSlot(i) {
  const q = PINE_HILLS_V2_LAYOUT.queue;
  if (i >= q.lineSlots) {
    const o = q.overflow;
    const k = i - q.lineSlots;
    const r = Math.min(o.r0 + o.rGrow * Math.sqrt(k), o.rMax);
    const a = k * o.goldenAngle;
    return { x: o.x + Math.cos(a) * r, z: o.z + Math.sin(a) * r };
  }
  const f = PINE_HILLS_V2_LAYOUT.frame;
  const cos = Math.cos(f.ry);
  const sin = Math.sin(f.ry);
  const lx = q.headLocal.x + q.pitchLocal.x * i;
  const lz = q.headLocal.z + q.pitchLocal.z * i;
  return { x: f.x + lx * cos + lz * sin, z: f.z - lx * sin + lz * cos };
}

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

// THE V2 CEILING RIG (Phase 4). Only four of the eight authored panel stations
// fall inside the v2 public envelope — 01/02/05/06 sit at x −7.5 / −4.1,
// west of the resized wall, in sealed cavity — and the v1 rig hangs at the
// 3.2-yd shell ceiling, ABOVE the v2 lid at 2.80. The greybox room was
// receiving all of its light through an opaque ceiling from fixtures the
// player can never see. The v2 rig hangs the four in-envelope stations from
// the v2 lid instead.
//
// `id` is the POSITION key (mesh names, render budget, diagnostics); `simId`
// is the SAVE/SIM key (fault state, flicker, repair target). They differ in
// exactly one row: the sim's flickering panel is panel-02, whose authored
// station is cavity-side in v2, so its state drives the in-envelope panel-03
// station — the campaign's flicker beat stays visible and repairable without
// touching the sim's target table or the save shape (both are pinned by
// hasExactKeys in clubhouseRestoration.js).
export const PINE_HILLS_V2_CEILING_RIG = Object.freeze({
  y: PINE_HILLS_V2_LAYOUT.ceilingY,
  // TWO FAULTED RUNS, NOT TWO FAULTED FITTINGS.
  //
  // The sim owns exactly two light faults (ceiling:panel-02 flicker,
  // ceiling:panel-07 dead) and the save validator pins that shape, so the room
  // cannot invent a third. But nothing says one fault may only drive one
  // fitting. Wiring the four v2 panels onto those two targets in PAIRS gives
  // the powered-but-neglected room two flickering fittings and two dead ones
  // instead of one of each beside two healthy lights — which is the difference
  // between "a couple of bulbs need doing" and a room nobody has maintained.
  // Each pair reads as a circuit run: service the run and both fittings come
  // back. Repairing is still exactly two beats, and the save is untouched.
  panels: Object.freeze([
    Object.freeze({ id: 'panel-03', simId: 'panel-02', x: -0.2, z: -2.55, w: 2.45, d: 0.68 }),
    Object.freeze({ id: 'panel-04', simId: 'panel-07', x: 3.7, z: -2.55, w: 2.45, d: 0.68 }),
    Object.freeze({ id: 'panel-07', simId: 'panel-07', x: -0.2, z: 2.65, w: 2.45, d: 0.68 }),
    Object.freeze({ id: 'panel-08', simId: 'panel-02', x: 3.7, z: 2.65, w: 2.45, d: 0.68 }),
  ]),
  // The interior key light (ART_BIBLE §3) was RESOLVED in Phase 4 as: none.
  // A panel-motivated steep directional was prototyped, gated to power ×
  // panel health, and measured at contact/face crops
  // (tools/qa/proshop-phase4-keylight-probe.js, Phase4/data/
  // phase4-keylight-probe.json): it added +4–8 luma globally with the gain
  // biased to FLOORS (p11 wide: +4.1 on every crop; p13: floor +7.4 vs wall
  // face +2.7) — a form-flattening wash, §3's Arm-2 failure, not form. The
  // one raking alternative this windowless room can motivate is the glazed
  // door, and a daylight key cannot gate to ceilingPowered without being
  // physically wrong — the directive's leave-it-out branch. The rig's four
  // panels + GTAO are the room's light.
});

export const CEILING_PANEL_RIG = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
  ? PINE_HILLS_V2_CEILING_RIG
  : Object.freeze({
    y: SHELL.h,
    panels: Object.freeze(CLUBHOUSE_CEILING_PANELS.map(
      (panel) => Object.freeze({ ...panel, simId: panel.id }),
    )),
  });

// Variant-resolved shell light placements (Phase 4). v2 drops the two
// placements the resize orphaned — the west daylight fill sits in sealed
// cavity and the (3.0, −4.0) fill fakes the north window that is now walled
// off — keeps the office fill (the service wing keeps its real east window),
// adds a door-glazing fill at the one aperture the public room still has, and
// moves the retail accent from the cavity onto the west retail run.
export const PINE_HILLS_V2_SHELL_LIGHTS = Object.freeze({
  daylightFills: Object.freeze([
    Object.freeze([-0.8, 4.35]),
    Object.freeze([8.3, 4.2]),
  ]),
  retailAccent: Object.freeze({ x: -2.0, z: -0.55 }),
});

export const SHELL_LIGHT_PLACEMENTS = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
  ? PINE_HILLS_V2_SHELL_LIGHTS
  : Object.freeze({
    daylightFills: Object.freeze([
      Object.freeze([-6.6, 3.4]),
      Object.freeze([3.0, -4.0]),
      Object.freeze([8.3, 4.2]),
    ]),
    retailAccent: Object.freeze({ x: -7.8, z: -1.25 }),
  });

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

// FLOOR THE V2 RESIZE SEALED BEHIND A WALL.
//
// The v2 room pulls the west wall to x −2.60 and the north wall to z −4.60. The v1 shell is
// unchanged, so the strip between the two is dead cavity — real floor coordinates, inside
// the building, that no player can stand on and no route can cross.
//
// Anything that validates a floor position has to know. Measured 2026-07-29
// (starter-carton-reach.json): two of the three starter cartons were placed at their
// authored v1 coordinates (−7.30, −4.40) and (−7.00, 5.00), the floor surface accepted both
// because its bounds are ±INTERIOR/2 — the V1 shell — and both were filed with
// `validated: true` while sitting behind the west wall. The player reported it as a box
// they could not reach.
//
// Derived from the same publicBounds the walls are built from, and from the service
// partition, so a floor point is dead exactly when it is (a) west of the public room or
// (b) north of it on the public side of the partition. The service wing keeps its proven
// datums and is unaffected. In v1 there is no cavity and this is always false.
export function inSealedDeadCavity(localX, localZ) {
  if (CLUBHOUSE_LAYOUT_VARIANT !== 'pine-hills-v2') return false;
  const b = PINE_HILLS_V2_LAYOUT.publicBounds;
  if (localX < b.minX) return true;
  if (localZ < b.minZ && localX < 5.7) return true; // 5.7 = the service partition, STOCKROOM.bounds.minX
  return false;
}

// The same question for a footprint rather than a point: any corner in the cavity means the
// carton is partly inside a wall, which is not a placement.
export function envelopeEntersSealedDeadCavity(envelope) {
  if (!envelope || CLUBHOUSE_LAYOUT_VARIANT !== 'pine-hills-v2') return false;
  for (const x of [envelope.minX, envelope.maxX]) {
    for (const z of [envelope.minZ, envelope.maxZ]) {
      if (inSealedDeadCavity(x, z)) return true;
    }
  }
  return false;
}

export const STOCKROOM = {
  bounds: { minX: 5.7, maxX: MODERN_PUBLIC_INTERIOR.w / 2, minZ: -MODERN_PUBLIC_INTERIOR.d / 2, maxZ: 2.0 },
  receivingInside: { x: 7.65, z: -4.50 },  // set-down stack, clear of the restroom pod and freight lane
  // Diagonal to the receiving door: close to the carry route, but clear of its
  // exterior aperture and the raised service road beside the east wall.
  padOutside: { x: 11.7, z: 0.0 },
  // Deep enough inside the service room to leave the storage-door capsule
  // route clear, while retaining a full approach lane on the east side.
  packing: { x: 6.30, z: -1.7, ry: 0 },    // the packing bench (tape gun, clipboard)
  // Ref 42 parks against the west partition, OUT of the service lane.
  //
  // It used to sit at (7.15, 0.45) with the note "remains reachable without
  // narrowing the door lane", which was true while it had no collider and false
  // the moment it got one. Measured with a 0.68-yd body: the truck's hull
  // (6.90–7.54) and the mop corner's (5.75–6.45) left 0.45 yd between them, and
  // the truck and the east rack (8.14–8.76) left 0.60. Both under a player. The
  // lane closed, and with it the office, the staff corridor and the staff side
  // of the till — which is what TILL-REACH-001 was really reporting.
  //
  // Against the partition its hull spans 5.98–6.62, merging with the mop
  // corner's shadow and leaving one clean 0.84-yd lane at x 6.96–7.80, lined up
  // with the stock door's own opening (7.04–8.06).
  handTruck: { x: 6.30, z: 0.45 },
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
// The resized v2 room's north wall lands INSIDE the v1 lounge; the mandate keeps
// the lounge (cleaning surface, entrance-visible), so v2 re-seats the whole set
// in the new NE corner. Same one-switch rule as the fixtures: every consumer —
// builder colliders, the greybox volumes, traffic, F5, cleanup targets — reads
// the switched datums and never learns about variants.
if (CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2') {
  Object.assign(LOUNGE, PINE_HILLS_V2_LAYOUT.loungeSet);
}

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
// v1: head west of the register, line stepping west into the room; the wider
// lateral pitch keeps the second person physically clear of the protected
// entrance rectangle, not merely clear at their centre point. v2 re-pitches
// the line east along the desk face (the 2026-07-28 ruling — see the layout's
// queue block): the head does not move, so every checkout reach circle,
// camera pose and save datum keeps.
const V2_QUEUE = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2' ? PINE_HILLS_V2_LAYOUT.queue : null;
const queueHead = V2_QUEUE
  ? frontDeskPoint(V2_QUEUE.headLocal.x, V2_QUEUE.headLocal.z)
  : frontDeskPoint(-0.48, -1.05);
const queuePitch = V2_QUEUE
  ? frontDeskVector(V2_QUEUE.pitchLocal.x, V2_QUEUE.pitchLocal.z)
  : frontDeskVector(-1.18, -0.45);
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
  // v2: indices past the line hold in the overflow pocket instead of extending
  // a line that would pierce the west wall (the resized day run's jam class).
  if (V2_QUEUE && i >= V2_QUEUE.lineSlots) return pineHillsV2QueueSlot(i);
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
  // Playtest round 7 (2026-07-31): "make the screen a little bigger and more to
  // the left hand side so it's more visible" — at 0.52 the enlarged glass ran
  // against the right frame edge of the working pose. 0.34 pulls the whole
  // monitor inside the frame; it stays right of the goods (the space contract)
  // and near enough over the drawer for the cash pose to read both together.
  monitor: frontDeskPose(0.34, 0.24, 0),
  cardterm: frontDeskPose(0.10, -0.16, 0),
  scanner: frontDeskPose(-0.20, 0.02, Math.PI + 0.22),
  // The receipt was cut from the flow entirely in round 7 ("please completely
  // remove the receipt"): the sim still files its paperwork, but no paper and
  // no device exist on the counter — fixtures.js no longer places a printer.
  // The pose stays as DATA because the placeable catalog's socket map and the
  // frame tests key off it.
  printer: frontDeskPose(0.14, 0.36, Math.PI - 0.06),
  custdisplay: frontDeskPose(0.94, -0.10, Math.PI),
  // THE CARRIER LIES FLAT at the counter's LEFT end (playtest round 5,
  // 2026-07-30, vs Designs/CashRegister/Final and the 2026-07-30 counter shot):
  // "the bag is laid flat and it's long, opened, and small height." This point
  // is its CLOSED BASE — the model's own origin — and the bag runs from here
  // down-counter to the right, ~0.31 long once laid and scaled, so its mouth
  // stops clear of REGISTER.staging's left edge and leaves the bare stretch the
  // reference keeps between the bag and the register block. A rung-up item
  // still slides SIDEWAYS along the counter straight into that mouth.
  //
  // Round 7: the bag's strip moves onto the counter's CENTRE SEAM (z 0.06,
  // just on the staff half) so the goods staged across the seam share its
  // line — the click-slide into the mouth is then one lateral run down the
  // counter with no cross-counter drift.
  bag: frontDeskPose(-1.16, 0.06, 0),
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
  // Round 7: "the items in the middle of the counter … it literally just goes
  // in by sliding to the left." The strip hugs the centre seam from the
  // customer half (the side contract: shoppers set goods down on their half),
  // one bag-mouth line away, so the ring-up slide is left-along-the-counter
  // instead of a diagonal across it.
  staging: registerRect(-0.85, -0.10, -0.16, -0.01),
  // Scanned goods stay visible and loose until payment is complete. This strip
  // is downstream of the reader but clear of both the open bag and POS hardware.
  scannedStaging: registerRect(-1.28, -0.62, -0.12, 0.04),
  // Counted change accumulates as a FLAT PILE on the BARE counter here — left
  // of the drawer, reference-style (the authored handoff tray prop was deleted
  // in the 2026-07-30 checkout-physicality round). The footprint bounds the
  // pile so money, reach tests and camera composition use one source of truth.
  changeHandoff: { ...frontDeskPoint(0.20, 0.30), w: 0.38, d: 0.20 },
  // the bag handoff zone: the laid carrier's own footprint at counter-left;
  // rung-up items slide sideways into the mouth here
  bagging: registerRect(-1.22, -0.82, 0.02, 0.26),

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
// The v1 datum put the 0.72-wide station at x −2.35, so its west edge reached
// −2.71 and its east edge −1.99 — 0.11 yd inside DOOR_CLEARWAY. "Clear of the
// door swing" was true; the clearway is wider than the swing, and that is the
// whole point of it being a separate rect.
//
// v2 cannot simply take the v1 fix. Its west wall is at publicBounds.minX
// −2.60, leaving a 0.50 yd sliver between wall and clearway — narrower than the
// station in either orientation. So v2 moves it north out of the clearway's z
// band instead, still against the west wall and still the first thing a
// customer passes on the way in.
// Both exported so a Node test can check the room it is not running as: the
// module resolves the variant once at load from the query string, so without
// these the v2 datum is unreachable from the suite.
export const PINE_HILLS_BASKET_STATION = Object.freeze({
  x: -2.55, z: 5.05,
  pickup: Object.freeze({ x: -2.55, z: 4.55 }),
  w: 0.72, d: 0.52,
});
export const PINE_HILLS_V2_BASKET_STATION = Object.freeze({
  x: -2.20, z: 3.02,
  pickup: Object.freeze({ x: -1.70, z: 3.02 }),
  w: 0.72, d: 0.52,
});
export const BASKET_STATION = CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2'
  ? { ...PINE_HILLS_V2_BASKET_STATION, pickup: { ...PINE_HILLS_V2_BASKET_STATION.pickup } }
  : { ...PINE_HILLS_BASKET_STATION, pickup: { ...PINE_HILLS_BASKET_STATION.pickup } };
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

// pine-hills-v2 reshapes the fixture set BEFORE any consumer reads the array: the
// builders, colliders, browse sockets, placeable catalog, runtime-asset manifest and
// campaign anchors all see one consistent layout. The resize CUTS eleven fixtures
// outright (the 70 m² room holds consumables, one booth, the demo strip and the
// lounge — everything else is the upgrade path), folds the gloves SKUs into the
// essentials pegboard, and repositions the keepers. Saved player moves in
// state.shop.layout still win over these defaults; moves saved for cut fixtures
// become inert orphan entries.
if (CLUBHOUSE_LAYOUT_VARIANT === 'pine-hills-v2') {
  const cut = new Set(PINE_HILLS_V2_LAYOUT.cutFixtures);
  for (let i = FIXTURES.length - 1; i >= 0; i--) {
    if (cut.has(FIXTURES[i].id)) FIXTURES.splice(i, 1);
  }
  for (const fixture of FIXTURES) {
    const pose = PINE_HILLS_V2_LAYOUT.fixturePoses[fixture.id];
    if (pose) Object.assign(fixture, pose);
    const skus = PINE_HILLS_V2_LAYOUT.skuOverrides[fixture.id];
    if (skus) fixture.skus = [...skus];
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
