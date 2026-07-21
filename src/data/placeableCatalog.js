// UNIFIED CLUBHOUSE PLACEABLE CATALOG.
//
// A placeable is data first. The simulation, preview renderer, final renderer, save
// migration, storage drawer, and QA all read these records. Asset-specific offsets
// stay here beside the authored pivot/socket contract instead of leaking into input
// handlers or scene code.

import {
  BACKDOOR_CLEARWAY, COUNTER, COUNTER_TOP, DOOR_BACK, DOOR_MAIN, DOOR_STOCK,
  FIXTURES, FIXTURE_HALF, INTERIOR, OFFICE, REGISTER, SHELL, STOCKROOM, WINDOW_DIM, WINDOWS,
} from './shopLayout.js';
import { FURNITURE_CATEGORIES, furnitureById } from './furnitureCatalog.js';

export const METERS_TO_YARDS = 1.0936133;

const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const surfaceRules = (allowed, extra = {}) => ({
  allowed: Object.freeze([...allowed]),
  floor: { maxSlopeDeg: 6, ...extra.floor },
  wall: {
    minHeight: 0.35, maxHeight: SHELL.h - 0.12, interior: true, exterior: false,
    allowGlass: false, allowDoors: false, gap: 0.018, ...extra.wall,
  },
  counter: { authoredSocketsPreferred: true, ...extra.counter },
  shelf: { authoredSlotsOnly: true, ...extra.shelf },
  ceiling: { minHeight: SHELL.h - 0.45, maxHeight: SHELL.h, ...extra.ceiling },
});

const rotation = (incrementDeg = 15, free = true, snapDefault = true) => ({
  increment: incrementDeg * Math.PI / 180,
  free,
  snapDefault,
});

const bounds = (width, height, depth, volumes = null) => ({
  type: volumes ? 'compound' : 'box', width, height, depth,
  volumes: volumes || [{ x: 0, z: 0, width, depth }],
});

const transform = (x, y, z, ry = 0, surface = 'floor', attachment = null, room = 'sales') => ({
  x, y, z, ry, surface, attachment, room,
});

const fixtureProfile = {
  shelf: { height: 2.35, value: 420, category: 'retail-fixture', rotation: rotation(90, false) },
  rack: { height: 2.2, value: 460, category: 'retail-fixture', rotation: rotation(90, false) },
  table: { height: 1.0, value: 315, category: 'display-furniture', rotation: rotation(15, true) },
  hatstand: { height: 1.85, value: 155, category: 'display-furniture', rotation: rotation(15, true) },
  bagstand: { height: 0.75, value: 230, category: 'retail-fixture', rotation: rotation(15, true) },
  shoerack: { height: 2.0, value: 380, category: 'retail-fixture', rotation: rotation(90, false) },
  feature: { height: 0.95, value: 260, category: 'display-furniture', rotation: rotation(15, true) },
  backshelf: { height: 2.2, value: 340, category: 'stockroom-fixture', rotation: rotation(90, false) },
  rail: { height: 1.8, value: 225, category: 'display-furniture', rotation: rotation(15, true) },
  backcounter: { height: 0.95, value: 550, category: 'counter', rotation: rotation(90, false) },
};

const fixtureRecords = FIXTURES.map((fixture) => {
  const profile = fixtureProfile[fixture.kind] || fixtureProfile.table;
  const half = FIXTURE_HALF[fixture.kind] || [1, 1];
  const authoredFootprint = fixture.footprint || null;
  const width = authoredFootprint
    ? authoredFootprint.maxX - authoredFootprint.minX
    : (fixture.short ? 0.85 : half[0]) * 2;
  const depth = authoredFootprint
    ? authoredFootprint.maxZ - authoredFootprint.minZ
    : half[1] * 2;
  const volumes = authoredFootprint ? [{
    x: (authoredFootprint.minX + authoredFootprint.maxX) / 2,
    z: (authoredFootprint.minZ + authoredFootprint.maxZ) / 2,
    width,
    depth,
  }] : null;
  return {
    id: fixture.id,
    assetId: `fixture:${fixture.kind}`,
    assetNumber: null,
    label: fixture.title || fixture.kind,
    placementCategory: profile.category,
    source: 'existing-procedural-fixture',
    render: { kind: 'fixture-anchor', fixtureId: fixture.id },
    surfaceRules: surfaceRules(['floor']),
    rotation: profile.rotation,
    snapPoints: ['SOCKET_PLACEMENT'],
    // Some authored fixtures have asymmetric or refined collision footprints
    // (notably the shoe wall and tightly joined club racks). Reusing that exact
    // local-space contract keeps placement validation identical to runtime.
    bounds: bounds(width, profile.height, depth, volumes),
    collision: { mode: 'analytic', blocksPlayer: true, blocksCustomers: true },
    requiredClearance: 0.04,
    navigationClearance: 0.34,
    doorClearance: 0.16,
    interactionClearance: fixture.skus?.length ? 0.48 : 0.25,
    sellValue: profile.value,
    storageBehavior: 'allowed',
    requiredObject: false,
    placementRestrictions: [],
    variants: ['walnut'],
    defaultVariant: 'walnut',
    defaultState: 'placed',
    defaultTransform: transform(fixture.x, 0, fixture.z, fixture.ry || 0, 'floor', null,
      fixture.zone === 'stockroom' ? 'stockroom' : 'sales'),
    fixture,
  };
});

const ASSET_DEFS = [
  [61, 'front_desk_counter_shell', 'Front desk counter shell', [2.93, 0.965, 0.91], ['floor'], 'counter', 1450],
  [62, 'back_counter_storage_cabinets', 'Back-counter storage cabinets', [3.20, 2.15, 0.62], ['floor'], 'counter', 1200],
  [63, 'pro_shop_fitting_room', 'Pro-shop fitting room', [1.55, 2.45, 1.55], ['floor'], 'fixture', 1300],
  [64, 'stockroom_shelving_system', 'Stockroom shelving system', [1.83, 2.13, 0.61], ['floor'], 'shelf', 720],
  [65, 'stockroom_worktable', 'Stockroom worktable', [1.80, 0.92, 0.75], ['floor'], 'table', 490],
  [66, 'office_laptop_desk', 'Office laptop desk', [1.60, 0.76, 0.80], ['floor'], 'desk', 780],
  [67, 'clubhouse_lounge_sofa', 'Clubhouse lounge sofa', [2.15, 0.90, 0.95], ['floor'], 'seating', 980],
  [68, 'lounge_armchair_sheet07', 'Lounge armchair', [0.85, 0.90, 0.90], ['floor'], 'seating', 440],
  [69, 'lounge_coffee_table_sheet07', 'Lounge coffee table', [1.10, 0.45, 0.65], ['floor'], 'table', 295],
  [70, 'trophy_display_cabinet', 'Trophy display cabinet', [1.50, 2.10, 0.45], ['floor'], 'cabinet', 950],
  [71, 'vacuum_cleaner', 'Vacuum cleaner', [0.48, 0.67, 0.58], ['floor'], 'utility', 180],
  [72, 'mop', 'Mop', [0.32, 1.45, 0.16], ['floor', 'wall'], 'utility', 28],
  [73, 'mop_bucket_and_wringer', 'Mop bucket and wringer', [0.55, 0.92, 0.42], ['floor'], 'utility', 95],
  [74, 'broom', 'Broom', [0.48, 1.50, 0.12], ['floor', 'wall'], 'utility', 24],
  [75, 'dustpan', 'Dustpan', [0.32, 0.85, 0.30], ['floor', 'wall'], 'utility', 22],
  [76, 'cleaning_spray_bottle', 'Cleaning spray bottle', [0.10, 0.28, 0.07], ['counter', 'shelf'], 'small-prop', 12],
  [77, 'cleaning_cloth_and_sponge_set', 'Cleaning cloth and sponge set', [0.35, 0.05, 0.35], ['counter', 'shelf'], 'small-prop', 10],
  [78, 'pressure_washer', 'Pressure washer', [0.62, 0.95, 0.72], ['floor'], 'utility', 260],
  [79, 'pressure_washer_hose_and_wand', 'Pressure washer hose and wand', [0.52, 0.18, 0.52], ['floor', 'wall'], 'utility', 85],
  [80, 'trash_bag', 'Trash bag', [0.55, 0.75, 0.42], ['floor'], 'utility', 8],
  [81, 'office_chair_sheet09', 'Office chair', [0.65, 1.10, 0.65], ['floor'], 'seating', 250],
  [82, 'filing_cabinet_sheet09', 'Filing cabinet', [0.48, 1.32, 0.62], ['floor'], 'cabinet', 210],
  [83, 'desk_lamp', 'Desk lamp', [0.40, 0.55, 0.40], ['counter', 'shelf'], 'small-prop', 78],
  [84, 'office_printer', 'Office printer', [0.43, 0.25, 0.38], ['counter', 'shelf'], 'small-prop', 165],
  [85, 'office_telephone', 'Telephone', [0.22, 0.12, 0.24], ['counter', 'shelf'], 'small-prop', 58],
  [86, 'corkboard_noticeboard', 'Corkboard noticeboard', [0.90, 0.65, 0.05], ['wall'], 'wall-decor', 88],
  [87, 'wall_clock', 'Wall clock', [0.34, 0.34, 0.065], ['wall'], 'wall-decor', 64],
  [88, 'key_rack', 'Key rack', [0.75, 0.25, 0.08], ['wall'], 'wall-utility', 72],
  [89, 'reservation_clipboard', 'Reservation clipboard', [0.23, 0.33, 0.018], ['counter', 'shelf'], 'small-prop', 24],
  [90, 'scorecard_holder', 'Scorecard holder', [0.38, 0.28, 0.25], ['counter', 'shelf'], 'small-prop', 54],
  [91, 'fire_extinguisher', 'Fire extinguisher', [0.34, 0.55, 0.18], ['wall'], 'safety', 85],
  [92, 'first_aid_kit_cabinet', 'First-aid kit cabinet', [0.42, 0.55, 0.16], ['wall'], 'safety', 120],
  [93, 'security_camera', 'Security camera', [0.18, 0.13, 0.18], ['wall', 'ceiling'], 'security', 145],
  [94, 'exit_sign', 'Exit sign', [0.48, 0.22, 0.085], ['wall'], 'safety', 96],
  [95, 'emergency_light', 'Emergency light', [0.42, 0.24, 0.13], ['wall'], 'safety', 112],
  [96, 'bulletin_board', 'Bulletin board', [0.95, 0.70, 0.055], ['wall'], 'wall-decor', 110],
  [97, 'key_cabinet', 'Key cabinet', [0.48, 0.65, 0.16], ['wall'], 'wall-utility', 135],
  [98, 'hand_sanitizer_station', 'Hand sanitizer station', [0.13, 0.31, 0.12], ['wall'], 'wall-utility', 48],
  [99, 'umbrella_stand', 'Umbrella stand', [0.34, 0.62, 0.34], ['floor'], 'decor', 95],
  [100, 'floor_mat_welcome_mat', 'Welcome mat', [1.20, 0.012, 0.75], ['floor'], 'decor', 65],
];

const DEFAULTS = {
  83: transform(9.71, 0.96, 3.93, -Math.PI / 2, 'counter', { parentId: 'surface:office-desk', socket: 'SOCKET_Lamp' }, 'office'),
  85: transform(9.67, 0.96, 5.02, -Math.PI / 2, 'counter', { parentId: 'surface:office-desk', socket: 'SOCKET_OfficeProp_01' }, 'office'),
  86: transform(6.55, 1.62, 2.06, 0, 'wall', { wallId: 'partition-office', normal: [0, 0, 1], socket: 'SOCKET_WallMount' }, 'office'),
  87: transform(INTERIOR.w / 2 - 0.06, 2.25, 3.05, -Math.PI / 2, 'wall', { wallId: 'east-office', normal: [-1, 0, 0], socket: 'SOCKET_WallMount' }, 'office'),
  88: transform(5.76, 1.52, -2.40, Math.PI / 2, 'wall', { wallId: 'partition-service', normal: [1, 0, 0], socket: 'SOCKET_WallMount' }, 'stockroom'),
  91: transform(5.64, 1.02, -0.85, Math.PI / 2, 'wall', { wallId: 'partition-sales', normal: [-1, 0, 0], socket: 'SOCKET_WallMount' }, 'sales'),
  92: transform(9.15, 2.60, -INTERIOR.d / 2 + 0.06, 0, 'wall', { wallId: 'north-stockroom', normal: [0, 0, 1], socket: 'SOCKET_WallMount' }, 'stockroom'),
  93: transform(1.25, 2.92, INTERIOR.d / 2 - 0.06, Math.PI, 'wall', { wallId: 'south-sales', normal: [0, 0, -1], socket: 'SOCKET_CeilingMount' }, 'sales'),
  94: transform(DOOR_MAIN.x, 2.96, INTERIOR.d / 2 - 0.05, Math.PI, 'wall', { wallId: 'south-sales', normal: [0, 0, -1], socket: 'SOCKET_WallMount' }, 'sales'),
  95: transform(-INTERIOR.w / 2 + 0.06, 2.78, -1.40, Math.PI / 2, 'wall', { wallId: 'west-sales', normal: [1, 0, 0], socket: 'SOCKET_WallMount' }, 'sales'),
  96: transform(-4.10, 2.75, -INTERIOR.d / 2 + 0.06, 0, 'wall', { wallId: 'north-sales', normal: [0, 0, 1], socket: 'SOCKET_WallMount' }, 'sales'),
  97: transform(5.76, 1.48, 0.30, Math.PI / 2, 'wall', { wallId: 'partition-service', normal: [1, 0, 0], socket: 'SOCKET_WallMount' }, 'stockroom'),
  98: transform(0.98, 1.22, INTERIOR.d / 2 - 0.06, Math.PI, 'wall', { wallId: 'south-sales', normal: [0, 0, -1], socket: 'SOCKET_WallMount' }, 'sales'),
  99: transform(0.75, 0, 5.72, 0.30, 'floor', null, 'sales'),
  100: transform(DOOR_MAIN.x, 0.004, 5.48, 0, 'floor', null, 'sales'),
};

const mountSocketFor = (number, allowed) => {
  if (allowed.includes('wall')) return number === 93 ? 'SOCKET_CeilingMount' : 'SOCKET_WallMount';
  if (allowed.includes('counter') || allowed.includes('shelf')) return 'SOCKET_PLACEMENT';
  return number === 99 || number === 100 ? 'SOCKET_FloorPlacement' : 'SOCKET_PLACEMENT';
};

const assetRecords = ASSET_DEFS.map(([number, stem, label, dimsM, allowed, category, value]) => {
  const [widthM, heightM, depthM] = dimsM;
  const width = widthM * METERS_TO_YARDS;
  const height = heightM * METERS_TO_YARDS;
  const depth = depthM * METERS_TO_YARDS;
  const sheet = String(Math.ceil(number / 10)).padStart(2, '0');
  const id = `asset-${String(number).padStart(3, '0')}`;
  const wallOnly = allowed.length === 1 && allowed[0] === 'wall';
  const small = ['small-prop', 'wall-decor', 'wall-utility', 'safety', 'security'].includes(category);
  const noNav = wallOnly || small || number === 99 || number === 100;
  const defaultTransform = DEFAULTS[number] || transform(0, 0, 0, 0, allowed[0], null, 'storage');
  const requiredObject = number === 94 ? 'safety-critical' : false;
  return {
    id,
    assetId: `A_${String(number).padStart(3, '0')}_${stem.toUpperCase()}`,
    assetNumber: number,
    label,
    placementCategory: category,
    source: 'assets-51-100-project-owned',
    render: {
      kind: 'glb',
      path: `vendor/models/assets_51_100/sheet_${sheet}/asset_${String(number).padStart(3, '0')}_${stem}.glb`,
      scale: METERS_TO_YARDS,
      mountSocket: mountSocketFor(number, allowed),
    },
    surfaceRules: surfaceRules(allowed, wallOnly ? { wall: { minHeight: Math.min(0.75, height), maxHeight: SHELL.h - 0.06 } } : {}),
    rotation: wallOnly ? rotation(0, false, true) : rotation(small ? 15 : 15, true, true),
    snapPoints: [mountSocketFor(number, allowed)],
    bounds: bounds(width, height, depth),
    collision: { mode: 'analytic', blocksPlayer: !noNav, blocksCustomers: !noNav },
    requiredClearance: small ? 0.018 : 0.05,
    navigationClearance: noNav ? 0 : 0.34,
    doorClearance: number === 100 ? 0 : 0.16,
    interactionClearance: small ? 0.22 : 0.42,
    sellValue: value,
    storageBehavior: requiredObject ? 'recovery-only' : 'allowed',
    requiredObject,
    placementRestrictions: requiredObject ? ['must-remain-placed', 'door-safety'] : [],
    variants: category === 'seating' ? ['golf-green', 'muted-sage', 'warm-charcoal']
      : ['original'],
    defaultVariant: category === 'seating' ? 'golf-green' : 'original',
    defaultState: DEFAULTS[number] ? 'placed' : 'stored',
    defaultTransform,
  };
});

// Existing critical equipment participates in placement metadata even where its
// current renderer remains authoritative. Protected sockets let the player inspect
// and recover these objects without quietly breaking checkout or laptop access.
const protectedRecords = [
  {
    id: 'core-checkout-counter', assetId: 'CORE_CHECKOUT_COUNTER', label: 'Checkout counter',
    placementCategory: 'required-counter', source: 'existing-checkout',
    render: { kind: 'existing', anchorKey: 'checkout-counter' },
    surfaceRules: surfaceRules(['floor']), rotation: rotation(90, false), snapPoints: ['SOCKET_CHECKOUT_ANCHOR'],
    bounds: bounds(COUNTER.len, 0.96, COUNTER.depth),
    collision: { mode: 'analytic', blocksPlayer: true, blocksCustomers: true },
    requiredClearance: 0.08, navigationClearance: 0.42, doorClearance: 0.25, interactionClearance: 1.1,
    sellValue: 0, storageBehavior: 'recovery-only', requiredObject: 'checkout-critical',
    placementRestrictions: ['authored-socket-only', 'checkout-critical'], variants: ['walnut'], defaultVariant: 'walnut',
    defaultState: 'placed', defaultTransform: transform(COUNTER.x, 0, COUNTER.z, 0, 'floor', { socket: 'SOCKET_CHECKOUT_ANCHOR' }, 'sales'),
  },
  {
    id: 'core-laptop', assetId: 'CORE_OFFICE_LAPTOP', label: 'Fairway Office laptop',
    placementCategory: 'required-hardware', source: 'existing-office',
    render: { kind: 'existing', anchorKey: 'office-laptop' },
    surfaceRules: surfaceRules(['counter'], { counter: { authoredSocketsOnly: true } }), rotation: rotation(15, true),
    snapPoints: ['SOCKET_Laptop'], bounds: bounds(0.43, 0.04, 0.29),
    collision: { mode: 'analytic', blocksPlayer: false, blocksCustomers: false },
    protectedZoneId: 'laptop',
    requiredClearance: 0.025, navigationClearance: 0, doorClearance: 0.1, interactionClearance: 0.55,
    sellValue: 0, storageBehavior: 'recovery-only', requiredObject: 'laptop-critical',
    placementRestrictions: ['authored-socket-only', 'laptop-critical'], variants: ['aluminium'], defaultVariant: 'aluminium',
    defaultState: 'placed', defaultTransform: transform(OFFICE.laptop.x - 0.10, 0.96, OFFICE.laptop.z, OFFICE.laptop.ry, 'counter', { parentId: 'surface:office-desk', socket: 'SOCKET_Laptop' }, 'office'),
  },
];

const counterHardwareRecords = [
  ['core-register', 'CORE_CHECKOUT_REGISTER', 'Register', REGISTER.monitor, [0.54, 0.34, 0.36], 'register', 'SOCKET_Register'],
  ['core-card-reader', 'CORE_CHECKOUT_CARD_READER', 'Card reader', REGISTER.cardterm, [0.32, 0.22, 0.26], 'card-reader', 'SOCKET_CardReader'],
  ['core-scanner', 'CORE_CHECKOUT_SCANNER', 'Barcode scanner', REGISTER.scanner, [0.46, 0.12, 0.36], 'scanner', 'SOCKET_Scanner'],
  ['core-receipt-printer', 'CORE_CHECKOUT_RECEIPT_PRINTER', 'Receipt printer', REGISTER.printer, [0.34, 0.25, 0.30], 'receipt-printer', 'SOCKET_Printer'],
].map(([id, assetId, label, pose, dimensions, protectedZoneId, socket]) => ({
  id, assetId, label,
  placementCategory: 'required-hardware', source: 'existing-checkout',
  render: { kind: 'existing', anchorKey: protectedZoneId },
  surfaceRules: surfaceRules(['counter'], { counter: { authoredSocketsOnly: true } }),
  rotation: rotation(0, false), snapPoints: [socket], bounds: bounds(...dimensions),
  collision: { mode: 'analytic', blocksPlayer: false, blocksCustomers: false },
  protectedZoneId,
  requiredClearance: 0.018, navigationClearance: 0, doorClearance: 0.1, interactionClearance: 0.42,
  sellValue: 0, storageBehavior: 'recovery-only', requiredObject: 'checkout-critical',
  placementRestrictions: ['authored-socket-only', 'checkout-critical'], variants: ['original'], defaultVariant: 'original',
  defaultState: 'placed',
  defaultTransform: transform(pose.x, COUNTER_TOP, pose.z, pose.ry || 0, 'counter', {
    parentId: 'surface:checkout-counter', socket,
  }, 'sales'),
}));

export const PLACEABLES = deepFreeze([
  ...fixtureRecords, ...assetRecords, ...protectedRecords, ...counterHardwareRecords,
]);
export const PLACEABLE_BY_ID = Object.freeze(Object.fromEntries(PLACEABLES.map((entry) => [entry.id, entry])));

const FURNITURE_INSTANCE_PATTERN = /^furniture::(.+)::(\d+)$/;
const furniturePlaceableCache = new Map();

// Authored model envelopes in metres. Families not listed here inherit their
// category envelope; the Blender catalog generator uses the same proportions.
const FURNITURE_CATEGORY_DIMS_M = Object.freeze({
  'retail-displays': [1.35, 1.85, 0.58],
  'counters-desks': [1.80, 0.98, 0.78],
  seating: [0.82, 0.92, 0.84],
  tables: [1.20, 0.76, 0.72],
  storage: [1.05, 1.85, 0.52],
  lighting: [0.55, 0.48, 0.55],
  architectural: [1.00, 0.08, 1.00],
  decor: [0.72, 1.05, 0.20],
  'guest-facilities': [1.05, 1.20, 0.62],
  operations: [1.55, 1.25, 1.10],
});

const FURNITURE_MODEL_DIMS_M = Object.freeze({
  'display-table': [1.45, 0.88, 0.82],
  'wall-display': [2.10, 2.25, 0.48],
  mannequin: [0.62, 1.88, 0.56],
  'checkout-counter': [2.45, 1.02, 0.88],
  'reception-desk': [2.20, 1.10, 0.82],
  'office-desk': [1.65, 0.78, 0.78],
  'back-counter': [2.10, 1.05, 0.62],
  'office-chair': [0.68, 1.08, 0.68],
  'lounge-armchair': [0.88, 0.94, 0.88],
  'lounge-sofa': [2.05, 0.92, 0.92],
  bench: [1.55, 0.82, 0.52],
  'dining-chair': [0.52, 0.94, 0.55],
  'bar-stool': [0.48, 1.05, 0.48],
  'coffee-table': [1.10, 0.46, 0.65],
  'side-table': [0.52, 0.62, 0.52],
  'dining-table': [1.65, 0.78, 0.92],
  'conference-table': [2.35, 0.78, 1.05],
  'member-locker': [1.20, 2.05, 0.55],
  'ceiling-flush': [0.48, 0.18, 0.48],
  'recessed-light': [0.18, 0.10, 0.18],
  'track-light': [1.20, 0.30, 0.25],
  'pendant-light': [0.45, 0.78, 0.45],
  chandelier: [1.15, 1.25, 1.15],
  'picture-light': [0.60, 0.18, 0.22],
  'wall-sconce': [0.28, 0.42, 0.22],
  'floor-lamp': [0.48, 1.58, 0.48],
  'desk-lamp': [0.34, 0.48, 0.34],
  flooring: [2.40, 0.04, 2.40],
  'ceiling-treatment': [2.40, 0.10, 2.40],
  'interior-door': [1.00, 2.10, 0.14],
  'exterior-door': [1.05, 2.15, 0.18],
  'window-treatment': [1.80, 2.10, 0.16],
  'wall-paneling': [2.40, 2.40, 0.12],
  'area-rug': [2.20, 0.025, 1.55],
  'wall-art': [0.92, 0.70, 0.055],
  'trophy-case': [1.25, 2.05, 0.42],
  plant: [0.68, 1.35, 0.68],
  mirror: [0.78, 1.35, 0.055],
  clock: [0.42, 0.42, 0.075],
  signage: [0.72, 0.38, 0.06],
  'golf-cart': [1.25, 1.85, 2.45],
  'cart-storage': [3.20, 2.35, 3.40],
  'patio-set': [2.10, 1.00, 1.55],
  'porch-bench': [1.65, 0.92, 0.62],
});

function furnitureMount(item) {
  if (item.placementMode === 'wall') return { allowed: ['wall'], socket: 'SOCKET_WallMount' };
  if (item.placementMode === 'ceiling') return { allowed: ['ceiling'], socket: 'SOCKET_CeilingMount' };
  if (item.placementMode === 'surface') return { allowed: ['counter', 'shelf'], socket: 'SOCKET_PLACEMENT' };
  return { allowed: ['floor'], socket: item.modelFamily === 'area-rug' ? 'SOCKET_FloorPlacement' : 'SOCKET_PLACEMENT' };
}

function dynamicFurniturePlaceable(id) {
  if (furniturePlaceableCache.has(id)) return furniturePlaceableCache.get(id);
  const match = FURNITURE_INSTANCE_PATTERN.exec(String(id || ''));
  const item = match ? furnitureById(match[1]) : null;
  if (!item) return null;
  const dimsM = FURNITURE_MODEL_DIMS_M[item.modelFamily]
    || FURNITURE_CATEGORY_DIMS_M[item.category]
    || [1, 1, 1];
  const [width, height, depth] = dimsM.map((value) => value * METERS_TO_YARDS);
  const mount = furnitureMount(item);
  const wallOrCeiling = ['wall', 'ceiling'].includes(item.placementMode);
  const installation = item.placementMode === 'installation';
  const vehicle = item.placementMode === 'vehicle';
  const meta = deepFreeze({
    id,
    assetId: `furniture:${item.id}`,
    catalogSku: item.id,
    label: item.name,
    placementCategory: item.category,
    source: 'project-owned-furniture-catalog',
    render: {
      kind: 'glb',
      path: `vendor/models/furniture/catalog/${item.modelFamily}_${item.progressionTier}.glb`,
      scale: METERS_TO_YARDS,
      mountSocket: mount.socket,
    },
    surfaceRules: surfaceRules(mount.allowed, item.placementMode === 'wall'
      ? { wall: { minHeight: Math.min(0.45, height), maxHeight: SHELL.h - 0.06 } }
      : {}),
    rotation: wallOrCeiling ? rotation(0, false, true) : rotation(15, true, true),
    snapPoints: [mount.socket],
    bounds: bounds(width, height, depth),
    collision: {
      mode: 'analytic',
      blocksPlayer: !wallOrCeiling && !installation,
      blocksCustomers: !wallOrCeiling && !installation,
    },
    requiredClearance: wallOrCeiling ? 0.018 : 0.05,
    navigationClearance: wallOrCeiling || installation ? 0 : (vehicle ? 0.48 : 0.34),
    doorClearance: wallOrCeiling ? 0.06 : 0.16,
    interactionClearance: installation ? 0 : 0.42,
    sellValue: Math.max(1, Math.round(item.purchaseCost * 0.45)),
    storageBehavior: 'allowed',
    requiredObject: false,
    placementRestrictions: installation ? ['catalog-installation-only'] : [],
    variants: [item.progressionTier],
    defaultVariant: item.progressionTier,
    defaultState: 'stored',
    defaultTransform: transform(0, 0, 0, 0, mount.allowed[0], null, 'storage'),
    price: item.price,
    priceUnit: item.priceUnit,
    packageQuantity: item.packageQuantity,
    purchaseCost: item.purchaseCost,
    quality: item.quality,
    brandTier: item.brandTier,
    description: item.description,
    thumbnail: item.thumbnail,
    category: item.category,
    categoryLabel: FURNITURE_CATEGORIES[item.category]?.label || item.category,
    unlockLevel: item.unlockLevel,
    requiredReputation: item.requiredReputation,
    maintenanceValue: item.maintenanceValue,
    comfortValue: item.comfortValue,
    prestigeValue: item.prestigeValue,
    progressionTier: item.progressionTier,
    progression: item.progression,
    placementMode: item.placementMode,
  });
  furniturePlaceableCache.set(id, meta);
  return meta;
}

export function placeableById(id) {
  return PLACEABLE_BY_ID[id] || dynamicFurniturePlaceable(id);
}

export const FURNITURE_ASSET_NUMBERS = Object.freeze(assetRecords.map((entry) => entry.assetNumber));

// Wall records describe finite usable faces. `coordinate` is the along-wall axis.
// The targeter uses these exact normals/yaws, so backward-facing wall props cannot
// be authored by camera angle or arbitrary player rotation.
export const WALL_SURFACES = deepFreeze([
  { id: 'north-sales', axis: 'z', at: -INTERIOR.d / 2 + 0.06, from: -INTERIOR.w / 2, to: 5.7, coordinate: 'x', normal: [0, 0, 1], yaw: 0, room: 'sales', exterior: false },
  { id: 'north-stockroom', axis: 'z', at: -INTERIOR.d / 2 + 0.06, from: 5.7, to: INTERIOR.w / 2, coordinate: 'x', normal: [0, 0, 1], yaw: 0, room: 'stockroom', exterior: false },
  { id: 'south-sales', axis: 'z', at: INTERIOR.d / 2 - 0.06, from: -INTERIOR.w / 2, to: 5.7, coordinate: 'x', normal: [0, 0, -1], yaw: Math.PI, room: 'sales', exterior: false },
  { id: 'south-office', axis: 'z', at: INTERIOR.d / 2 - 0.06, from: 5.7, to: INTERIOR.w / 2, coordinate: 'x', normal: [0, 0, -1], yaw: Math.PI, room: 'office', exterior: false },
  { id: 'west-sales', axis: 'x', at: -INTERIOR.w / 2 + 0.06, from: -INTERIOR.d / 2, to: INTERIOR.d / 2, coordinate: 'z', normal: [1, 0, 0], yaw: Math.PI / 2, room: 'sales', exterior: false },
  { id: 'east-stockroom', axis: 'x', at: INTERIOR.w / 2 - 0.06, from: -INTERIOR.d / 2, to: 2.0, coordinate: 'z', normal: [-1, 0, 0], yaw: -Math.PI / 2, room: 'stockroom', exterior: false },
  { id: 'east-office', axis: 'x', at: INTERIOR.w / 2 - 0.06, from: 2.0, to: INTERIOR.d / 2, coordinate: 'z', normal: [-1, 0, 0], yaw: -Math.PI / 2, room: 'office', exterior: false },
  { id: 'partition-sales', axis: 'x', at: 5.7 - 0.06, from: -INTERIOR.d / 2, to: 2.0, coordinate: 'z', normal: [-1, 0, 0], yaw: -Math.PI / 2, room: 'sales', exterior: false },
  { id: 'partition-service', axis: 'x', at: 5.7 + 0.06, from: -INTERIOR.d / 2, to: 2.0, coordinate: 'z', normal: [1, 0, 0], yaw: Math.PI / 2, room: 'stockroom', exterior: false },
  { id: 'partition-office', axis: 'z', at: 2.0 + 0.06, from: 5.7, to: INTERIOR.w / 2, coordinate: 'x', normal: [0, 0, 1], yaw: 0, room: 'office', exterior: false },
  { id: 'partition-stockroom', axis: 'z', at: 2.0 - 0.06, from: 5.7, to: INTERIOR.w / 2, coordinate: 'x', normal: [0, 0, -1], yaw: Math.PI, room: 'stockroom', exterior: false },
]);
export const WALL_SURFACE_BY_ID = Object.freeze(Object.fromEntries(WALL_SURFACES.map((entry) => [entry.id, entry])));

const counterSurface = {
  id: 'surface:checkout-counter', kind: 'counter', room: 'sales', y: COUNTER_TOP,
  ownerId: 'core-checkout-counter',
  x: COUNTER.x, z: COUNTER.z, ry: 0, width: COUNTER.len - 0.12, depth: COUNTER.depth - 0.10,
  sockets: [
    { id: 'scorecard', x: COUNTER.x - 1.12, z: COUNTER.z - 0.08, ry: -0.15 },
    { id: 'service', x: COUNTER.x + 1.18, z: COUNTER.z - 0.04, ry: 0.20 },
  ],
  protectedZones: [
    { id: 'register', label: 'register controls', x: 2.25, z: 4.52, width: 0.58, depth: 0.38 },
    { id: 'scanner', label: 'scanner path', x: 2.70, z: 4.22, width: 0.64, depth: 0.52 },
    { id: 'card-reader', label: 'card reader', x: 2.05, z: 3.88, width: 0.38, depth: 0.30 },
    { id: 'receipt-printer', label: 'receipt printer', x: 3.20, z: 4.56, width: 0.44, depth: 0.32 },
    { id: 'bagging', label: 'bagging area', x: 3.68, z: 4.44, width: 0.82, depth: 0.42 },
  ],
};

const officeDeskSurface = {
  id: 'surface:office-desk', kind: 'counter', room: 'office', y: 0.96,
  ownerId: 'office-desk-legacy',
  x: OFFICE.desk.x, z: OFFICE.desk.z, ry: OFFICE.desk.ry, width: 1.84, depth: 0.88,
  sockets: [
    { id: 'SOCKET_Laptop', x: OFFICE.laptop.x - 0.10, z: OFFICE.laptop.z, ry: OFFICE.laptop.ry },
    { id: 'SOCKET_Lamp', x: 9.71, z: 3.93, ry: -Math.PI / 2 },
    { id: 'SOCKET_OfficeProp_01', x: 9.67, z: 5.02, ry: -Math.PI / 2 },
  ],
  protectedZones: [
    { id: 'laptop', label: 'laptop and seated interaction', x: OFFICE.laptop.x - 0.10, z: OFFICE.laptop.z, width: 0.62, depth: 0.48 },
  ],
};

export const STATIC_PLACEMENT_SURFACES = deepFreeze([counterSurface, officeDeskSurface]);
export const STATIC_PLACEMENT_SURFACE_BY_ID = Object.freeze(Object.fromEntries(
  STATIC_PLACEMENT_SURFACES.map((entry) => [entry.id, entry]),
));

export const PROTECTED_ZONES = deepFreeze([
  { id: 'main-door', label: 'main entrance', ...{ minX: -2.1, maxX: 0.5, minZ: 3.9, maxZ: 6.5 }, critical: true },
  { id: 'receiving-door', label: 'receiving entrance', ...BACKDOOR_CLEARWAY, critical: true },
  { id: 'checkout-staff', label: 'checkout employee area', minX: COUNTER.x - COUNTER.len / 2 - 0.30, maxX: COUNTER.x + COUNTER.len / 2 + 0.30, minZ: COUNTER.z + COUNTER.depth / 2, maxZ: COUNTER.z + COUNTER.depth / 2 + 1.1, critical: true },
  { id: 'checkout-customer', label: 'checkout customer area', minX: COUNTER.x - COUNTER.len / 2 - 0.45, maxX: COUNTER.x + COUNTER.len / 2 + 0.45, minZ: COUNTER.z - COUNTER.depth / 2 - 1.0, maxZ: COUNTER.z - COUNTER.depth / 2, critical: true },
  { id: 'laptop-seat', label: 'laptop interaction position', minX: OFFICE.chair.x - 0.55, maxX: OFFICE.chair.x + 0.55, minZ: OFFICE.chair.z - 0.55, maxZ: OFFICE.chair.z + 0.55, critical: true },
  { id: 'stockroom-access', label: 'stockroom access', minX: DOOR_STOCK.x - DOOR_STOCK.w / 2 - 0.45, maxX: DOOR_STOCK.x + DOOR_STOCK.w / 2 + 0.45, minZ: DOOR_STOCK.z - 0.8, maxZ: DOOR_STOCK.z + 0.8, critical: true },
]);

export const DOOR_SWINGS = deepFreeze([
  { id: 'main', label: 'main door swing', pivot: [DOOR_MAIN.hingeX, INTERIOR.d / 2], radius: DOOR_MAIN.w, minAngle: -Math.PI / 2, maxAngle: 0, wall: 'south' },
  { id: 'stock', label: 'stockroom door swing', pivot: [DOOR_STOCK.hingeX, DOOR_STOCK.z], radius: DOOR_STOCK.w, minAngle: 0, maxAngle: Math.PI / 2, wall: 'partition' },
  { id: 'back', label: 'receiving door swing', pivot: [INTERIOR.w / 2, DOOR_BACK.hingeZ], radius: DOOR_BACK.w, minAngle: Math.PI / 2, maxAngle: Math.PI, wall: 'east' },
]);

export const WALL_OPENINGS = deepFreeze([
  { wallId: 'south-sales', kind: 'door', label: 'main door', from: DOOR_MAIN.x - DOOR_MAIN.w / 2, to: DOOR_MAIN.x + DOOR_MAIN.w / 2, bottom: 0, top: DOOR_MAIN.h },
  ...WINDOWS.filter((window) => window.wall === 'S').map((window) => ({ wallId: 'south-sales', kind: 'glass', label: 'window', from: window.c - WINDOW_DIM.w / 2, to: window.c + WINDOW_DIM.w / 2, bottom: WINDOW_DIM.sill, top: WINDOW_DIM.sill + WINDOW_DIM.h })),
  ...WINDOWS.filter((window) => window.wall === 'N').flatMap((window) => [
    { wallId: 'north-sales', kind: 'glass', label: 'window', from: window.c - WINDOW_DIM.w / 2, to: window.c + WINDOW_DIM.w / 2, bottom: WINDOW_DIM.sill, top: WINDOW_DIM.sill + WINDOW_DIM.h },
    { wallId: 'north-stockroom', kind: 'glass', label: 'window', from: window.c - WINDOW_DIM.w / 2, to: window.c + WINDOW_DIM.w / 2, bottom: WINDOW_DIM.sill, top: WINDOW_DIM.sill + WINDOW_DIM.h },
  ]),
  ...WINDOWS.filter((window) => window.wall === 'E').map((window) => ({ wallId: 'east-office', kind: 'glass', label: 'window', from: window.c - WINDOW_DIM.w / 2, to: window.c + WINDOW_DIM.w / 2, bottom: WINDOW_DIM.sill, top: WINDOW_DIM.sill + WINDOW_DIM.h })),
  { wallId: 'east-stockroom', kind: 'door', label: 'receiving door', from: DOOR_BACK.z - DOOR_BACK.w / 2, to: DOOR_BACK.z + DOOR_BACK.w / 2, bottom: 0, top: DOOR_BACK.h },
  { wallId: 'partition-office', kind: 'door', label: 'stockroom door', from: DOOR_STOCK.x - DOOR_STOCK.w / 2, to: DOOR_STOCK.x + DOOR_STOCK.w / 2, bottom: 0, top: DOOR_STOCK.h },
  { wallId: 'partition-stockroom', kind: 'door', label: 'stockroom door', from: DOOR_STOCK.x - DOOR_STOCK.w / 2, to: DOOR_STOCK.x + DOOR_STOCK.w / 2, bottom: 0, top: DOOR_STOCK.h },
]);

export const ROOM_STYLE_OPTIONS = deepFreeze({
  floor: [
    { id: 'natural-oak', label: 'Natural oak', color: 0xffffff, roughness: 0.50, sourceAsset: 59 },
    { id: 'medium-walnut', label: 'Medium walnut', color: 0x9b7958, roughness: 0.58, sourceAsset: 59 },
    { id: 'warm-charcoal', label: 'Warm charcoal', color: 0x5e5952, roughness: 0.66, sourceAsset: 59 },
  ],
  walls: [
    { id: 'warm-cream', label: 'Warm cream', color: 0xffffff, sourceAsset: 56 },
    { id: 'muted-sage', label: 'Muted sage', color: 0xb7c0a7, sourceAsset: 56 },
    { id: 'deep-golf-green', label: 'Deep golf green', color: 0x31553c, sourceAsset: 56 },
  ],
  trim: [
    { id: 'warm-cream', label: 'Warm cream', color: 0xffffff, sourceAsset: 57 },
    { id: 'medium-walnut', label: 'Medium walnut', color: 0x5d351d, sourceAsset: 57 },
    { id: 'natural-oak', label: 'Natural oak', color: 0xa77445, sourceAsset: 57 },
    { id: 'warm-charcoal', label: 'Warm charcoal', color: 0x36332f, sourceAsset: 57 },
  ],
});

export const DEFAULT_ROOM_STYLE = deepFreeze({
  floor: 'natural-oak', walls: 'warm-cream', trim: 'warm-cream',
});

// Existing product stocking is intentionally slot/group based. The furniture
// system consumes this policy rather than turning stock into free rigid bodies.
export const PRODUCT_PLACEMENT_POLICY = deepFreeze({
  mode: 'authored-facing-slots',
  faceOutward: true,
  preserveVariants: true,
  partialQuantities: true,
  groupedRendering: true,
  freePhysicsObjects: false,
});
