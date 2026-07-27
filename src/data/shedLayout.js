// THE DIRTY MAINTENANCE SHED — floor plan for the stage-1 test scene.
// Local coordinate convention matches shopLayout.js: origin at the room
// center, +z = SOUTH = the door side, +x = EAST. Interior floor sits at
// local y 0. Pure data (+ small pure geometry helpers) — no THREE, no sim
// imports, so every other shed module can depend on this one without risk
// of a cycle.

export const SHED_SHELL = { w: 8.5, d: 6.5, h: 2.9, wallT: 0.22 };
export const SHED_ROOM = { w: 8.06, d: 6.06 }; // interior clear span, yards

// True on the interior AND its wall boundary — wall-mounted items (doors,
// windows, flush-mounted furniture) are meant to sit exactly at the edge.
export function insideShedRoom(x, z, eps = 1e-6) {
  return Math.abs(x) <= SHED_ROOM.w / 2 + eps && Math.abs(z) <= SHED_ROOM.d / 2 + eps;
}

// --- openings ----------------------------------------------------------------------

// Open doorway on the south wall — no leaf, always passable.
export const DOOR = Object.freeze({ wall: 'S', x: 1.2, z: SHED_ROOM.d / 2, w: 1.35 });

const SHED_WINDOW_DIM = Object.freeze({ w: 1.6, h: 1.2, sill: 1.0 });

// Order matters: index 0 = south, 1 = east — maps onto reno.windows[0..1].
export const WINDOWS = Object.freeze([
  Object.freeze({ id: 'south', wall: 'S', x: -2.0, z: SHED_ROOM.d / 2, ...SHED_WINDOW_DIM }),
  Object.freeze({ id: 'east', wall: 'E', x: SHED_ROOM.w / 2, z: -0.5, ...SHED_WINDOW_DIM }),
]);

// --- furniture (pose + AABB half-extents for colliders) ----------------------------
// w/d are the authored full footprint; hw/hd are the derived collider half-extents.
// Wall-flush pieces (workbench, shelving) are allowed to touch the wall boundary.

function withHalfExtents(entry) {
  return Object.freeze({ ...entry, hw: entry.w / 2, hd: entry.d / 2 });
}

export const FURNITURE = Object.freeze({
  workbench: withHalfExtents({ x: -0.4, z: -2.55, w: 4.6, d: 1.1 }),
  shelving: withHalfExtents({ x: -3.65, z: -0.2, w: 0.7, d: 2.8 }),
  crateStack: withHalfExtents({ x: -3.1, z: 2.1, w: 1.1, d: 1.1 }),
  sawhorse: Object.freeze({ x: 1.9, z: -0.9 }), // small — no collider
});

// --- stations (circular colliders) --------------------------------------------------

export const STATIONS = Object.freeze({
  mopBucket: Object.freeze({ x: 3.35, z: 2.25, radius: 1.4 }),
  disposalBin: Object.freeze({ x: 3.45, z: 0.9, radius: 1.5 }),
});

// --- cleaning target contact poses ---------------------------------------------------
// Keys are shed target ids, shared verbatim with SHED_TARGET_IDS in
// src/sim/shedCleaning.js (that module derives its own list independently;
// tests hold the two in sync).

export const TARGET_POSES = Object.freeze({
  'web:corner-nw': Object.freeze({ x: -3.6, z: -2.6, radius: 0.9 }),
  'web:corner-ne': Object.freeze({ x: 3.6, z: -2.6, radius: 0.9 }),
  'bench:grease': Object.freeze({ x: -0.4, z: -2.35, radius: 1.0 }),
  'wall:scuff-door': Object.freeze({ x: 2.35, z: 2.9, radius: 0.9 }),
  'floor:oil-patch': Object.freeze({ x: 0.6, z: 0.2, radius: 0.9 }),
  'shelf:dust': Object.freeze({ x: -3.35, z: -0.2, radius: 0.9 }),
  'entry:leaf-drift': Object.freeze({ x: 1.2, z: 2.3, radius: 1.0 }),
  'trash:cans': Object.freeze({ x: -2.2, z: 0.6, radius: 0.9 }),
  'trash:pizza-box': Object.freeze({ x: -3.1, z: 2.1, radius: 0.9 }), // on the crate stack
  'window:south': Object.freeze({ x: -2.0, z: 2.85, radius: 1.1 }),
  'window:east': Object.freeze({ x: 3.8, z: -0.5, radius: 1.1 }),
});

// --- debris seed (deterministic, authored — not RNG-rolled) ------------------------
// 14 clusters, |x|<=3.4, |z|<=2.5, a in [0.5,1.0], 9 grit / 5 litter, denser
// near the door (south) and the workbench (north wall), clear of both
// station circles (mopBucket/disposalBin sit east, near x~3.4).

export const SHED_DEBRIS_SEED = Object.freeze([
  Object.freeze({ x: -0.6, z: -2.30, a: 0.62, kind: 'grit' }),   // by the bench
  Object.freeze({ x: 0.2, z: -2.35, a: 0.71, kind: 'litter' }),  // by the bench
  Object.freeze({ x: -1.1, z: -2.05, a: 0.55, kind: 'grit' }),   // by the bench
  Object.freeze({ x: 0.9, z: 2.35, a: 0.68, kind: 'grit' }),     // by the door
  Object.freeze({ x: 1.7, z: 2.15, a: 0.74, kind: 'litter' }),   // by the door
  Object.freeze({ x: 0.3, z: 2.45, a: 0.59, kind: 'grit' }),     // by the door
  Object.freeze({ x: 1.9, z: 1.75, a: 0.65, kind: 'litter' }),   // by the door
  Object.freeze({ x: -2.6, z: 0.35, a: 0.52, kind: 'grit' }),    // west-mid
  Object.freeze({ x: -1.7, z: -0.65, a: 0.83, kind: 'litter' }), // center-west
  Object.freeze({ x: -3.1, z: 1.05, a: 0.57, kind: 'grit' }),    // west
  Object.freeze({ x: -2.0, z: 1.85, a: 0.66, kind: 'grit' }),    // west-south
  Object.freeze({ x: -3.0, z: -1.15, a: 0.94, kind: 'litter' }), // west, by the shelving
  Object.freeze({ x: -0.5, z: 0.55, a: 0.61, kind: 'grit' }),    // center
  Object.freeze({ x: 2.1, z: -1.55, a: 0.78, kind: 'grit' }),    // east-center, clear of the stations
]);

// --- prop placements (name -> pose, for later GLB mounting) ------------------------
// ry follows shopLayout.js's convention: 0 faces +z (south), PI/2 faces +x
// (east), PI faces -z (north), -PI/2 faces -x (west). Freestanding props
// (crate stack, sawhorse, stations) omit ry — any facing reads fine.

export const SHED_PROP_PLACEMENTS = Object.freeze({
  SHED_Workbench: Object.freeze({ x: FURNITURE.workbench.x, z: FURNITURE.workbench.z, ry: 0 }),
  SHED_Shelving: Object.freeze({ x: FURNITURE.shelving.x, z: FURNITURE.shelving.z, ry: Math.PI / 2 }),
  SHED_CrateStack: Object.freeze({ x: FURNITURE.crateStack.x, z: FURNITURE.crateStack.z }),
  SHED_Sawhorse: Object.freeze({ x: FURNITURE.sawhorse.x, z: FURNITURE.sawhorse.z }),
  SHED_Bucket: Object.freeze({ x: STATIONS.mopBucket.x, z: STATIONS.mopBucket.z }),
  SHED_DisposalBin: Object.freeze({ x: STATIONS.disposalBin.x, z: STATIONS.disposalBin.z }),
  SHED_ToolRack: Object.freeze({ x: -3.9, z: -1.6, ry: Math.PI / 2 }), // west wall, facing east
  SHED_WindowSouth: Object.freeze({ x: WINDOWS[0].x, z: WINDOWS[0].z, ry: Math.PI }),
  SHED_WindowEast: Object.freeze({ x: WINDOWS[1].x, z: WINDOWS[1].z, ry: -Math.PI / 2 }),
});

// --- authored kit scatter (Phase-4 GLB mount points, data-only) ---------------------
// The floor parks sit just off the west wall near the tool rack (where the drum + washer
// would live); the clutter cluster scatters through the open floor. All decorative — no
// colliders, no interactions (the GLB collision proxies are hidden at mount time).

export const SHED_FLOOR_PARK = Object.freeze({ x: -2.35, z: -1.45, ry: Math.PI / 2 });

export const SHED_CLUTTER_SPOTS = Object.freeze([
  Object.freeze({ x: 2.55, z: -1.95, ry: Math.PI / 2 }),  // SE floor, by the sawhorse
  Object.freeze({ x: -1.75, z: 1.70, ry: 0.0 }),          // open west-centre
  Object.freeze({ x: -0.65, z: 2.55, ry: 0.5 }),          // near the doorway
]);
