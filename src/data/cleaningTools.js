// THE CLEANING TOOLS, as data.
//
// Adding a tool used to mean editing five unrelated places: the `heldGroups` literal in
// courseScene, the `GRIPS` table in fpHands, the belt array in main, the toast strings beside it,
// and the audio kind switch. Miss one and you got a tool you could equip but not hold, or hold but
// not hear. This file is the single source of truth for all five.
//
// Every tool declares its own geometry, its sockets, where the hands go, what it can clean, how
// hard, what it sounds like, and what comes out of it. The renderer builds whatever it finds here.
//
// Geometry is authored against the reference sheets (Sheet 8 — cleaning equipment, and the two
// first-person sheets). Colours are the club's: Pineview green, brass, cream.

export const TOOL_CLASS = {
  JET: 'jet',         // pressurised water — erodes grime along the stream
  SUCTION: 'suction', // draws loose debris into an intake
  STROKE: 'stroke',   // contact tool worked across a surface (mop, cloth, sponge)
  SWEEP: 'sweep',     // pushes loose debris along the floor
  SCOOP: 'scoop',     // collects a debris pile
  SPRAY: 'spray',     // lays solution on a surface
  CARRY: 'carry',     // held, fills, gets emptied
};

// What a surface is dirtied WITH decides what shifts it.
export const DIRT = {
  FILM: 'film',       // light exterior weathering — water alone
  BONDED: 'bonded',   // algae, mould, bird residue — needs solution + dwell
  DUST: 'dust',       // indoor dust on hard floor and carpet — suction
  DEBRIS: 'debris',   // leaves, grit, wrappers — swept and scooped
  SMEAR: 'smear',     // fingerprints, spills on glass and counters — wiped
  GRIME: 'grime',     // baked-on kitchen/equipment grime — scrubbed
};

const P = {
  steel: { color: 0x9aa3aa, roughness: 0.42, metalness: 0.70 },
  chrome: { color: 0xc3ccd4, roughness: 0.24, metalness: 0.85 },
  brass: { color: 0xb08d3f, roughness: 0.34, metalness: 0.80 },
  darkPoly: { color: 0x23262a, roughness: 0.88 },
  bodyPoly: { color: 0x1e2b22, roughness: 0.85 },
  clubGreen: { color: 0x2f4a35, roughness: 0.72 },
  deepGreen: { color: 0x24582f, roughness: 0.62 },
  hazardYellow: { color: 0xd8b23a, roughness: 0.60 },
  bucketYellow: { color: 0xe0a81c, roughness: 0.66 },
  ash: { color: 0xc2a273, roughness: 0.80 },       // broom / mop handle timber
  cotton: { color: 0xe4dcc6, roughness: 0.95 },    // mop yarn
  bristle: { color: 0x2b2622, roughness: 0.95 },
  white: { color: 0xeef1ee, roughness: 0.55 },
  sponge: { color: 0xe8c649, roughness: 0.98 },
  scourer: { color: 0x2f5c37, roughness: 0.99 },
  microfibre: { color: 0x4a7a52, roughness: 0.96 },
  bagPoly: { color: 0x191c1e, roughness: 0.52 },
  label: { color: 0xf4f2e8, roughness: 0.70 },
};

// A tiny parts vocabulary. The builder in render3d/toolViewmodel.js is the only thing that reads
// it, so a new primitive means one switch case there rather than a bespoke build function per tool.
const cyl = (r0, r1, h, pos, rot, mat, seg = 10) =>
  ({ kind: 'cyl', r0, r1, h, pos, rot, mat, seg });
const box = (size, pos, rot, mat) => ({ kind: 'box', size, pos, rot, mat });
const sph = (r, pos, mat, seg = 10) => ({ kind: 'sph', r, pos, mat, seg });
const tube = (path, r, mat) => ({ kind: 'tube', path, r, mat });
const cone = (r, h, pos, rot, mat, seg = 10) => ({ kind: 'cone', r, h, pos, rot, mat, seg });

export const CLEANING_TOOLS = {
  // ---------------------------------------------------------------- 78/79 pressure washer -----
  washer: {
    id: 'washer',
    label: 'Pressure washer',
    toolClass: TOOL_CLASS.JET,
    belt: true,
    equipToast: 'hold LEFT to blast, RIGHT to lay soap on the heavy stains.',
    reach: 7.0,
    radius: 0.30,     // yards — overridden per machine tier by sim/washing.js
    strength: 1.0,
    dirt: [DIRT.FILM, DIRT.BONDED],
    // Authored in courseScene today; kept here so the contract is discoverable in one place.
    external: true,
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_079_pressure_washer_hose_and_wand_fp.glb',
      sockets: { nozzle: 'SOCKET_SprayEmission' },
      grips: { right: 'SOCKET_GripPrimary', left: 'SOCKET_GripSupport' },
    },
    sockets: { nozzle: { pos: [0, 0.0678, -0.7444], rot: [-0.16, 0, 0] } },
    grip: { pos: [0.0, -0.13, 0.20], rot: [-0.35, 0, 0.12] },
    support: { pos: [0.0, 0.015, -0.30], rot: [-0.30, 0, 0.9] },
    recoil: 0.055,
    audio: { loop: 'washerLoop', start: 'washerStart', stop: 'washerStop' },
  },

  // ------------------------------------------------------------------------- 71 vacuum --------
  vacuum: {
    id: 'vacuum',
    label: 'Shop vacuum',
    toolClass: TOOL_CLASS.SUCTION,
    floorAnchored: true, // worked against the floor: the head stays down when you look about
    belt: true,
    equipToast: 'hold the mouse button and work the dirty patches.',
    reach: 1.9,
    radius: 0.34,
    strength: 1.0,
    dirt: [DIRT.DUST, DIRT.DEBRIS],
    indoorOnly: true,
    place: [0.20, -0.27, -0.38],
    orient: [0, -0.09, 0],
    worldPitch: -0.60,
    parts: [
      // chrome wand, lying along -Z in its own frame; the group's world pitch tips it to the floor
      cyl(0.021, 0.024, 1.52, [0, 0.0, -0.72], [Math.PI / 2, 0, 0], 'chrome', 10),
      // the grip collar, up at the hands
      cyl(0.030, 0.030, 0.11, [0, 0.0, 0.02], [Math.PI / 2, 0, 0], 'darkPoly', 10),
      // the neck joining wand to head
      cyl(0.024, 0.036, 0.11, [0, -0.02, -1.50], [Math.PI / 2, 0, 0], 'darkPoly', 8),
      // the floor head: a wide flat nozzle with a bristle strip along its leading lip
      box([0.32, 0.055, 0.135], [0, -0.075, -1.63], [0, 0, 0], 'darkPoly'),
      box([0.30, 0.018, 0.024], [0, -0.104, -1.69], [0, 0, 0], 'bristle'),
      // corrugated hose curling away out of shot
      tube([[0, 0.02, 0.12], [0.12, -0.06, 0.44], [-0.04, -0.30, 0.78], [-0.30, -0.56, 1.04]],
        0.026, 'darkPoly'),
    ],
    // the intake is the mouth of the floor head, just above the boards
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_071_vacuum_cleaner_fp.glb',
      sockets: { nozzle: 'SOCKET_DirtIntake' },
      grips: { right: 'SOCKET_GripPrimary', left: 'SOCKET_GripSupport' },
    },
    sockets: { nozzle: { pos: [0, -0.112, -1.66], rot: [-Math.PI / 2, 0, 0] } },
    grip: { pos: [0.0, 0.005, 0.10], rot: [-0.10, 0, 0.05] },
    support: null,
    recoil: 0.012,
    audio: { loop: 'vacuumLoop', start: 'vacuumStart', stop: 'vacuumStop', pickup: 'vacuumPickup' },
  },

  // --------------------------------------------------------------------------- 72 mop ---------
  mop: {
    id: 'mop',
    label: 'Mop',
    toolClass: TOOL_CLASS.STROKE,
    floorAnchored: true, // worked against the floor: the head stays down when you look about
    belt: true,
    equipToast: 'press and move to mop. Hard floors only — carpet just soaks.',
    reach: 2.2,
    radius: 0.40,
    strength: 0.85,
    dirt: [DIRT.SMEAR, DIRT.GRIME, DIRT.FILM],
    indoorOnly: true,
    wets: true,           // leaves a wet sheen that dries off
    rejects: ['carpet'],
    place: [0.18, -0.27, -0.38],
    orient: [0, -0.14, 0],
    worldPitch: -0.62,
    parts: [
      // ash handle, lying along -Z; the world pitch is what takes it down to the boards
      cyl(0.019, 0.021, 1.86, [0, 0.0, -0.86], [Math.PI / 2, 0, 0], 'ash', 8),
      // black collar where the yarn is clamped
      cyl(0.038, 0.046, 0.11, [0, 0.0, -1.74], [Math.PI / 2, 0, 0], 'darkPoly', 10),
      // the cotton head: a squat cone of yarn splayed where it meets the floor
      cone(0.145, 0.17, [0, -0.055, -1.84], [Math.PI / 2, 0, 0], 'cotton', 14),
      sph(0.132, [0, -0.075, -1.90], 'cotton', 12),
    ],
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_072_mop_fp.glb',
      sockets: { contact: 'SOCKET_FloorContact' },
      grips: { right: 'SOCKET_GripPrimary', left: 'SOCKET_GripSupport' },
    },
    sockets: { contact: { pos: [0, -0.115, -1.90], rot: [-Math.PI / 2, 0, 0] } },
    grip: { pos: [0.0, 0.005, 0.08], rot: [-0.08, 0, 0.10] },
    support: { pos: [-0.015, 0.0, -0.46], rot: [-0.10, 0, -0.20] },
    recoil: 0.018,
    audio: { loop: 'mopSwish', start: 'mopStart', stop: 'mopStop' },
  },

  // ------------------------------------------------------------------------- 74 broom ---------
  broom: {
    id: 'broom',
    label: 'Push broom',
    toolClass: TOOL_CLASS.SWEEP,
    floorAnchored: true, // worked against the floor: the head stays down when you look about
    belt: true,
    equipToast: 'sweep dirt and leaves into a pile, then collect it with the dustpan.',
    reach: 2.4,
    radius: 0.46,
    strength: 1.0,
    dirt: [DIRT.DEBRIS],
    place: [0.18, -0.27, -0.38],
    orient: [0, -0.12, 0],
    worldPitch: -0.62,
    parts: [
      cyl(0.019, 0.021, 1.90, [0, 0.0, -0.88], [Math.PI / 2, 0, 0], 'ash', 8),
      // the ferrule joining handle to block
      cyl(0.024, 0.031, 0.12, [0, 0.0, -1.74], [Math.PI / 2, 0, 0], 'steel', 8),
      // the timber block head, wide across the sweep
      box([0.46, 0.085, 0.11], [0, -0.045, -1.85], [0, 0, 0], 'ash'),
      // bristles hanging under it
      box([0.44, 0.125, 0.092], [0, -0.150, -1.85], [0, 0, 0], 'bristle'),
    ],
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_074_broom_fp.glb',
      sockets: { contact: 'SOCKET_FloorContact' },
      grips: { right: 'SOCKET_GripPrimary', left: 'SOCKET_GripSupport' },
    },
    sockets: { contact: { pos: [0, -0.215, -1.85], rot: [-Math.PI / 2, 0, 0] } },
    grip: { pos: [0.0, 0.005, 0.08], rot: [-0.08, 0, 0.10] },
    support: { pos: [-0.015, 0.0, -0.48], rot: [-0.10, 0, -0.18] },
    recoil: 0.020,
    audio: { loop: 'broomSweep', start: 'broomStart', stop: 'broomStop' },
  },

  // ----------------------------------------------------------------------- 75 dustpan ---------
  dustpan: {
    id: 'dustpan',
    label: 'Dustpan',
    toolClass: TOOL_CLASS.SCOOP,
    floorAnchored: true, // worked against the floor: the head stays down when you look about
    belt: true,
    equipToast: 'hold the button over a pile to collect it.',
    reach: 1.6,
    // Deliberately the most generous radius in the kit, and wider than the trash bag's. You have
    // just spent ten seconds sweeping a pile together; being made to hunt for it by the yard with
    // the pan is the least satisfying thing this loop could possibly do. At 0.42 the pan missed a
    // pile the broom had pushed one stroke downrange, which is exactly that failure.
    radius: 0.62,
    strength: 1.0,
    dirt: [DIRT.DEBRIS],
    place: [0.18, -0.27, -0.38],
    orient: [0, -0.10, 0],
    worldPitch: -0.66,
    parts: [
      // long upright handle
      cyl(0.017, 0.019, 1.46, [0, 0.0, -0.66], [Math.PI / 2, 0, 0], 'darkPoly', 8),
      // the pan: a shallow tray whose lip meets the floor
      box([0.29, 0.020, 0.235], [0, -0.055, -1.50], [0, 0, 0], 'darkPoly'),
      box([0.29, 0.085, 0.018], [0, -0.020, -1.61], [0, 0, 0], 'darkPoly'),
      box([0.018, 0.080, 0.225], [-0.143, -0.022, -1.50], [0, 0, 0], 'darkPoly'),
      box([0.018, 0.080, 0.225], [0.143, -0.022, -1.50], [0, 0, 0], 'darkPoly'),
    ],
    // the collection mouth is the leading lip
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_075_dustpan_fp.glb',
      sockets: { contact: 'SOCKET_PanIntake' },
      grips: { right: 'SOCKET_Grip', left: null },
    },
    sockets: { contact: { pos: [0, -0.066, -1.60], rot: [-Math.PI / 2, 0, 0] } },
    grip: { pos: [0.0, 0.005, 0.08], rot: [-0.10, 0, 0.08] },
    support: null,
    recoil: 0.014,
    audio: { loop: 'dustpanCollect', start: 'dustpanStart', stop: 'dustpanStop' },
  },

  // ------------------------------------------------------------------- 76 spray bottle --------
  spray: {
    id: 'spray',
    label: 'All-purpose cleaner',
    toolClass: TOOL_CLASS.SPRAY,
    belt: true,
    equipToast: 'spray it on, then wipe it off with the cloth.',
    reach: 1.5,
    radius: 0.26,
    strength: 1.0,
    dirt: [DIRT.SMEAR, DIRT.GRIME, DIRT.BONDED],
    loosens: true,     // does not clean by itself — it makes the wipe work
    place: [0.12, -0.14, -0.86],
    orient: [0.08, -0.20, 0],
    parts: [
      // the bottle: a squared-off white cylinder, Pineview label on the face
      cyl(0.041, 0.044, 0.215, [0, -0.055, 0], [0, 0, 0], 'white', 12),
      box([0.062, 0.085, 0.004], [0, -0.062, -0.043], [0, 0, 0], 'label'),
      // shoulder and neck
      cone(0.041, 0.045, [0, 0.070, 0], [0, 0, 0], 'white', 12),
      cyl(0.020, 0.020, 0.030, [0, 0.104, 0], [0, 0, 0], 'deepGreen', 10),
      // the trigger head, reaching forward
      box([0.038, 0.052, 0.085], [0, 0.128, -0.048], [0.10, 0, 0], 'deepGreen'),
      box([0.020, 0.048, 0.018], [0, 0.098, -0.030], [0.42, 0, 0], 'deepGreen'),
      // the jet orifice
      cyl(0.008, 0.010, 0.024, [0, 0.140, -0.094], [Math.PI / 2, 0, 0], 'white', 8),
    ],
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_076_cleaning_spray_bottle_fp.glb',
      sockets: { nozzle: 'SOCKET_SprayEmission' },
      grips: { right: 'SOCKET_Grip', left: null },
    },
    sockets: { nozzle: { pos: [0, 0.140, -0.108], rot: [0, 0, 0] } },
    grip: { pos: [0.0, 0.05, 0.055], rot: [-0.16, 0, 0.10] },
    support: null,
    recoil: 0.030,
    audio: { loop: 'sprayLoop', start: 'sprayTrigger', stop: 'sprayStop' },
  },

  // -------------------------------------------------------------------------- 77 cloth --------
  cloth: {
    id: 'cloth',
    label: 'Microfibre cloth',
    toolClass: TOOL_CLASS.STROKE,
    belt: true,
    equipToast: 'wipe surfaces clean after spraying.',
    reach: 1.2,
    radius: 0.22,
    strength: 1.2,     // strong, but only on what the spray has already loosened
    dirt: [DIRT.SMEAR, DIRT.FILM],
    needsSolution: true,
    place: [0.18, -0.22, -0.88],
    orient: [0.16, -0.22, 0],
    parts: [
      // a folded cloth: three offset slabs so it reads as fabric, not a brick
      box([0.175, 0.030, 0.150], [0, 0, 0], [0.06, 0.10, 0.03], 'microfibre'),
      box([0.168, 0.022, 0.142], [0.004, -0.024, 0.006], [-0.04, 0.05, -0.05], 'microfibre'),
      box([0.150, 0.018, 0.128], [-0.006, -0.042, -0.004], [0.03, -0.06, 0.06], 'microfibre'),
    ],
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_077_cleaning_cloth_and_sponge_set_fp.glb',
      sockets: { contact: 'SOCKET_ClothContact' },
      grips: { right: 'SOCKET_ClothGrip', left: null },
      only: 'Cloth', // cloth and sponge share one authored set
    },
    sockets: { contact: { pos: [0, -0.056, -0.010], rot: [-Math.PI / 2, 0, 0] } },
    grip: { pos: [0.0, 0.062, 0.028], rot: [-1.32, 0, 0.10] }, // palm down, flat on the surface
    support: null,
    recoil: 0.016,
    audio: { loop: 'clothWipe', start: 'clothStart', stop: 'clothStop' },
  },

  // ------------------------------------------------------------------------- 77 sponge --------
  sponge: {
    id: 'sponge',
    label: 'Scouring sponge',
    toolClass: TOOL_CLASS.STROKE,
    belt: true,
    equipToast: 'scrub the stubborn grime — it takes a few passes.',
    reach: 1.2,
    radius: 0.16,
    strength: 0.75,    // slower than the cloth, but it shifts what the cloth cannot
    dirt: [DIRT.GRIME, DIRT.BONDED, DIRT.SMEAR],
    foams: true,
    place: [0.18, -0.22, -0.88],
    orient: [0.16, -0.22, 0],
    parts: [
      box([0.135, 0.055, 0.092], [0, 0, 0], [0.05, 0.08, 0.02], 'sponge'),
      box([0.137, 0.020, 0.094], [0, -0.036, 0], [0.05, 0.08, 0.02], 'scourer'),
    ],
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_077_cleaning_cloth_and_sponge_set_fp.glb',
      sockets: { contact: 'SOCKET_SpongeContact' },
      grips: { right: 'SOCKET_SpongeGrip', left: null },
      only: 'Sponge', // cloth and sponge share one authored set
    },
    sockets: { contact: { pos: [0, -0.050, 0], rot: [-Math.PI / 2, 0, 0] } },
    grip: { pos: [0.0, 0.060, 0.020], rot: [-1.30, 0, 0.10] },
    support: null,
    recoil: 0.022,
    audio: { loop: 'spongeScrub', start: 'spongeStart', stop: 'spongeStop' },
  },

  // ---------------------------------------------------------------------- 80 trash bag --------
  trashbag: {
    id: 'trashbag',
    label: 'Trash bag',
    toolClass: TOOL_CLASS.CARRY,
    belt: true,
    equipToast: 'collect the litter, then take it to the dumpster.',
    reach: 1.8,
    radius: 0.55,
    strength: 1.0,
    dirt: [DIRT.DEBRIS],
    fills: true,
    place: [0.18, -0.40, -1.26],
    orient: [0.05, -0.10, 0],
    // Staged, not simulated: the fill states swap scale on these, which is far cheaper than cloth
    // and reads perfectly well at arm's length.
    parts: [
      sph(0.145, [0, -0.155, 0], 'bagPoly', 12),
      sph(0.115, [0.030, -0.055, -0.020], 'bagPoly', 10),
      sph(0.092, [-0.036, -0.020, 0.026], 'bagPoly', 10),
      // the gathered neck the hand closes around
      cyl(0.030, 0.048, 0.105, [0, 0.060, 0], [0, 0, 0], 'bagPoly', 10),
    ],
    // Authored first-person viewmodel, built by the asset pipeline. The procedural parts
    // above stay as the instant fallback so equipping never waits on I/O; the authored
    // geometry swaps in when it arrives, and its own sockets take over.
    fp: {
      glb: 'vendor/models/assets_51_100/firstperson/asset_080_trash_bag_fp.glb',
      sockets: { contact: 'SOCKET_TrashFill' },
      grips: { right: 'SOCKET_Grip', left: null },
    },
    sockets: { contact: { pos: [0, -0.30, -0.03], rot: [-Math.PI / 2, 0, 0] } },
    grip: { pos: [0.0, 0.098, 0.010], rot: [-1.05, 0, 0.16] },
    support: null,
    recoil: 0.010,
    audio: { loop: 'bagRustle', start: 'bagPickup', stop: 'bagStop' },
  },
};

export const TOOL_IDS = Object.freeze(Object.keys(CLEANING_TOOLS));

/** Tools that appear on the belt, in cycle order. */
export const BELT_ORDER = Object.freeze(
  [null, 'washer', 'vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag'],
);

export const toolDef = (id) => CLEANING_TOOLS[id] || null;

/** Can this tool do anything to this class of dirt? */
export function toolHandles(id, dirtClass) {
  const t = CLEANING_TOOLS[id];
  return !!t && t.dirt.includes(dirtClass);
}

export const PALETTE = P;
