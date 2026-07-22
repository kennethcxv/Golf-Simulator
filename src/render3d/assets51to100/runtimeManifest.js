// COMPLETE RUNTIME MANIFEST — Assets 51 through 100.
//
// The generated sheet manifests describe what each Blender export contains. This manifest adds
// the part an actual game needs: where the export lives, how it mounts, which save/cleaning state
// owns it, and when it is visible. The clubhouse prop loader consumes these records directly, so
// this is runtime authority rather than an audit-only inventory.

import {
  BACKDOOR_CLEARWAY, COUNTER, COUNTER_TOP, DOOR_CLEARWAY, DOOR_MAIN, INTERIOR, OFFICE,
  STOCKROOM,
} from '../../data/shopLayout.js';
import { ALL_ASSETS } from './assetsRegistry.js';
import { resolveSheet06Placement } from './sheet06ClubhouseAdapter.js';

const S_WALL = INTERIOR.d / 2;
const N_WALL = -INTERIOR.d / 2;
const E_WALL = INTERIOR.w / 2;
const W_WALL = -INTERIOR.w / 2;
const FACE_N = Math.PI;
const FACE_S = 0;
const FACE_W = -Math.PI / 2;
const FACE_E = Math.PI / 2;
const DESK_SURFACE_Y = 0.76 * 1.0936133;
const FILING_CABINET_TOP_Y = 1.32 * 1.0936133;

const freezeTransform = ({ x, y = 0, z, ry = 0, scale }) => Object.freeze({
  position: Object.freeze([x, y, z]),
  rotation: Object.freeze([0, ry, 0]),
  scale: Object.freeze([scale, scale, scale]),
});

/**
 * Runtime placements for the forty interior/world assets on Sheets 7–10.
 *
 * Coordinates are clubhouse-interior local yards. `fixtureIds` means the authored root is
 * reparented to the player's persisted movable fixture anchor; the listed world transform is the
 * default pose used by the manifest and tests. Every other placement lands SOCKET_PLACEMENT on
 * the target position.
 */
export const PROP_PLACEMENTS = Object.freeze([
  // Sheet 7 — production furniture and service-room anchors.
  { n: 61, x: COUNTER.x, z: COUNTER.z, mount: 'floor', ry: Math.PI,
    category: 'checkout', collision: 'existing-checkout-island',
    note: 'canonical checkout shell; yaw aligns its staging, scanner, bagging and POS sockets west-to-east' },
  { n: 62, x: 3.2, z: 6.15, mount: 'movable-fixture', ry: Math.PI,
    fixtureIds: ['backcounter'], category: 'checkout-storage', collision: 'fixture-anchor',
    interaction: { kind: 'toggle', label: 'Back-counter cabinet', state: 'open', socket: 'SOCKET_CounterProp_01',
      open: ['CabinetDoor_Open', 'CabinetDrawer_Open'], close: ['CabinetDoor_Close', 'CabinetDrawer_Close'] },
    note: 'bound to the persisted backcounter anchor; fronts face the staff corridor' },
  { n: 63, x: -9.30, z: 4.40, mount: 'floor', ry: Math.PI / 2,
    category: 'retail-fitting', collision: 'fitting-room-hull',
    interaction: { kind: 'toggle', label: 'Fitting-room curtain', state: 'open', socket: 'SOCKET_Bench',
      open: ['FittingCurtain_Open'], close: ['FittingCurtain_Close'] },
    note: 'backed against the solid west wall; curtain faces east and clears both south windows and the putter run' },
  { n: 64, x: 8.05, z: -6.10, mount: 'movable-fixture', ry: 0,
    fixtureIds: ['backshelf_n', 'backshelf_e2'], category: 'stockroom-storage', collision: 'fixture-anchor',
    note: 'instanced on both persisted long stockroom shelving anchors; the short door-side rack remains compact' },
  { n: 65, x: STOCKROOM.packing.x, z: STOCKROOM.packing.z, mount: 'floor', ry: STOCKROOM.packing.ry,
    category: 'stockroom-work', collision: 'existing-packing-bench',
    note: 'canonical packing worktable on the existing carton-placement and collider datum' },
  { n: 66, x: OFFICE.desk.x, z: OFFICE.desk.z, mount: 'floor', ry: -Math.PI / 2,
    category: 'office', collision: 'existing-office-desk',
    note: 'pedestal desk faces west; its chair and laptop sockets align with the live office interaction rig' },
  { n: 67, x: 3.45, z: -5.75, mount: 'floor', ry: 0,
    category: 'lounge', collision: 'lounge-sofa',
    note: 'three-seat sofa backs onto the north lounge wall without intersecting the trophy cabinet' },
  { n: 68, x: 4.80, z: -3.80, mount: 'floor', ry: -2.10,
    category: 'lounge', collision: 'lounge-armchair',
    note: 'armchair faces the authored coffee table while leaving the lounge-to-sales aisle open' },
  { n: 69, x: 3.45, z: -4.55, mount: 'floor', ry: 0,
    category: 'lounge', collision: 'lounge-table',
    note: 'table is centred on the sofa lounge-table socket with clear space around both seats' },
  { n: 70, x: 5.42, z: -5.58, mount: 'floor', ry: -Math.PI / 2,
    category: 'lounge-display', collision: 'lounge-cabinet',
    interaction: { kind: 'toggle', label: 'Trophy cabinet', state: 'open', socket: 'SOCKET_Trophy_01',
      open: ['DisplayDoorLeft_Open', 'DisplayDoorRight_Open'],
      close: ['DisplayDoorLeft_Close', 'DisplayDoorRight_Close'] },
    note: 'glazed cabinet sits against the service partition with its doors opening into the lounge' },

  // Sheet 8 — cleaning bay and usable tool pickups.
  { n: 71, x: 8.15, z: 1.24, mount: 'floor', ry: -0.5, category: 'cleaning-tool', collision: 'none',
    tool: 'vacuum', note: 'cleaning bay east end, hose end toward the room and clear of the door' },
  { n: 72, x: 5.92, z: 1.82, mount: 'floor', ry: 0.35, category: 'cleaning-tool', collision: 'none',
    tool: 'mop', note: 'stood against the partition beside the bucket' },
  { n: 73, x: 6.38, z: 1.58, mount: 'floor', ry: -0.3, category: 'cleaning-support', collision: 'none',
    interaction: { kind: 'toggle', label: 'Mop-bucket wringer', state: 'open', socket: 'SOCKET_Wringer',
      open: ['Bucket_WringerOpen', 'Bucket_LeverUp'], close: ['Bucket_LeverDown', 'Bucket_WringerClose'] },
    note: 'wringer bucket occupies the bay named by the floor plan' },
  { n: 74, x: 6.82, z: 1.84, mount: 'floor', ry: -0.25, category: 'cleaning-tool', collision: 'none',
    tool: 'broom', note: 'leant beside the mop without extending into the stock-door route' },
  { n: 75, x: 7.18, z: 1.70, mount: 'floor', ry: 0.4, category: 'cleaning-tool', collision: 'none',
    tool: 'dustpan', note: 'paired with the broom in the cleaning bay' },
  { n: 76, x: 7.655, z: -0.692, y: 1.006, mount: 'socket', ry: 0.15,
    parentAsset: 65, parentSocket: 'SOCKET_Tool_02', category: 'cleaning-tool', collision: 'none',
    tool: 'spray', interaction: { kind: 'oneshot', label: 'Cleaning spray', clips: ['SprayBottle_Trigger'] },
    note: 'mounted to the authored worktable tool socket, above the floor and outside box staging' },
  { n: 77, x: 7.655, z: -1.108, y: 1.006, mount: 'socket', ry: -0.1,
    parentAsset: 65, parentSocket: 'SOCKET_Tool_01', category: 'cleaning-tool', collision: 'none',
    tools: [{ tool: 'cloth', socket: 'SOCKET_ClothGrip' }, { tool: 'sponge', socket: 'SOCKET_SpongeGrip' }],
    note: 'mounted to the second authored worktable socket; cloth and sponge remain separate pickups' },
  { n: 78, x: 6.30, z: -5.70, mount: 'floor', ry: 0.15, category: 'cleaning-machine', collision: 'none',
    interaction: { kind: 'toggle', label: 'Pressure-washer motor', state: 'running', socket: 'SOCKET_Audio',
      open: ['PressureWasher_Start'], loop: ['PressureWasher_Running'], close: ['PressureWasher_Stop'] },
    note: 'equipment storage at the partition end of receiving, outside the door and shelf access lanes' },
  { n: 79, x: 6.72, z: -5.58, mount: 'floor', ry: 0.45, category: 'cleaning-tool', collision: 'none',
    tool: 'washer', note: 'coiled hose and wand sit beside their pressure-washer machine' },
  { n: 80, x: 5.82, z: 0.78, mount: 'floor', ry: -0.15, category: 'cleaning-tool', collision: 'none',
    tool: 'trashbag', note: 'trash bag marks the disposal end of the cleaning bay' },

  // Sheet 9 — office and service-desk props.
  { n: 81, x: 8.70, z: OFFICE.chair.z, mount: 'floor', ry: Math.PI / 2,
    category: 'office', collision: 'none',
    interaction: { kind: 'oneshot', label: 'Office chair', socket: 'SOCKET_Seat', clips: ['OfficeChair_Swivel'] },
    note: 'chair lands on asset 66 chair-placement socket and faces the desk' },
  { n: 82, x: 9.88, z: 2.75, mount: 'floor', ry: FACE_W,
    category: 'office-storage', collision: 'existing-filing-cabinet',
    interaction: { kind: 'toggle', label: 'Filing cabinet', state: 'open', socket: 'SOCKET_Drawer_02',
      open: ['FilingDrawer_01_Open'], close: ['FilingDrawer_01_Close'] },
    note: 'east office wall north of both the desk and window opening' },
  { n: 83, x: 9.71, z: 3.93, y: DESK_SURFACE_Y, mount: 'surface', ry: -Math.PI / 2,
    category: 'office-prop', collision: 'none', light: { color: 0xffd99a, intensity: 0.55, distance: 2.6 },
    interaction: { kind: 'toggle', label: 'Desk lamp', state: 'on', socket: 'SOCKET_Desk',
      open: ['DeskLamp_SwitchOn'], close: ['DeskLamp_SwitchOff'] },
    note: 'lands on asset 66 SOCKET_Lamp at the authored desk top height' },
  { n: 84, x: 9.86, z: 2.75, y: FILING_CABINET_TOP_Y, mount: 'surface', ry: FACE_W,
    category: 'office-prop', collision: 'none',
    interaction: { kind: 'oneshot', label: 'Office printer', socket: 'SOCKET_PaperOutput', clips: ['OfficePrinter_Print'] },
    note: 'rests on top of asset 82 instead of sinking halfway through the cabinet' },
  { n: 85, x: 9.67, z: 5.02, y: DESK_SURFACE_Y, mount: 'surface', ry: -Math.PI / 2,
    category: 'office-prop', collision: 'none',
    interaction: { kind: 'oneshot', label: 'Office telephone', socket: 'SOCKET_Handset', clips: ['Telephone_HandsetLift', 'Telephone_HandsetReplace'] },
    note: 'lands on asset 66 office-prop socket within seated reach' },
  { n: 86, x: 6.55, z: 2.12, y: 1.62, mount: 'wall', ry: FACE_S,
    category: 'office-wall', collision: 'none',
    note: 'office face of partition B, clear of the stock door and existing calendar' },
  { n: 87, x: E_WALL - 0.06, z: 3.05, y: 2.25, mount: 'wall', ry: FACE_W,
    category: 'office-wall', collision: 'none',
    note: 'east wall above the filing run and north of the office window span' },
  { n: 88, x: E_WALL - 0.06, z: -1.35, y: 1.52, mount: 'wall', ry: FACE_W,
    category: 'stockroom-wall', collision: 'none',
    note: 'stockroom east wall, clear of receiving and stock-door swings' },
  { n: 89, x: COUNTER.x + 1.05, z: COUNTER.z, y: COUNTER_TOP, mount: 'surface', ry: 0.25,
    category: 'checkout-prop', collision: 'none',
    note: 'reservation clipboard occupies the staff-side service end of asset 61' },
  { n: 90, x: COUNTER.x - 1.05, z: COUNTER.z, y: COUNTER_TOP, mount: 'surface', ry: -0.15,
    category: 'checkout-prop', collision: 'none',
    note: 'scorecard holder occupies the customer-service end of asset 61' },

  // Sheet 10 — safety, signage and utilities.
  { n: 91, x: 5.52, z: -0.85, y: 1.02, mount: 'wall', ry: FACE_E,
    category: 'safety', collision: 'none', note: 'partition west face, code-visible from the sales floor' },
  { n: 92, x: 9.15, z: N_WALL + 0.06, y: 1.42, mount: 'wall', ry: FACE_S,
    category: 'safety', collision: 'none',
    interaction: { kind: 'toggle', label: 'First-aid cabinet', state: 'open', socket: 'SOCKET_Handle',
      open: ['FirstAidDoor_Open'], close: ['FirstAidDoor_Close'] },
    note: 'reachable stockroom north wall, clear of shelving uprights' },
  { n: 93, x: 1.25, z: 6.28, y: 2.92, mount: 'ceiling', ry: FACE_N,
    category: 'security', collision: 'none', note: 'high entrance mount covers the door and checkout island' },
  { n: 94, x: DOOR_MAIN.x, z: S_WALL - 0.05, y: 2.96, mount: 'wall', ry: FACE_N,
    category: 'safety-light', collision: 'none', light: { color: 0xa8ffd0, intensity: 0.38, distance: 2.2 },
    note: 'exit sign clears the authored main-door head without touching the ceiling' },
  { n: 95, x: W_WALL + 0.06, z: -1.40, y: 2.78, mount: 'wall', ry: FACE_E,
    category: 'safety-light', collision: 'none', light: { color: 0xffefd2, intensity: 0.45, distance: 3.0 },
    note: 'high west-wall emergency light washes the central shop floor' },
  { n: 96, x: -4.10, z: N_WALL + 0.06, y: 1.58, mount: 'wall', ry: FACE_S,
    category: 'retail-wall', collision: 'none', note: 'public north wall, clear of the lounge window' },
  { n: 97, x: E_WALL - 0.06, z: 0.70, y: 1.48, mount: 'wall', ry: FACE_W,
    category: 'security', collision: 'none',
    interaction: { kind: 'toggle', label: 'Key cabinet', state: 'open', socket: 'SOCKET_Lock',
      open: ['KeyCabinetDoor_Open'], close: ['KeyCabinetDoor_Close'] },
    note: 'secure service wall above the key-rack run' },
  { n: 98, x: 0.98, z: S_WALL - 0.06, y: 1.22, mount: 'wall', ry: FACE_N,
    category: 'cleaning-utility', collision: 'none',
    interaction: { kind: 'oneshot', label: 'Hand sanitiser', socket: 'SOCKET_Hand', clips: ['Sanitizer_Dispense'] },
    note: 'entrance wall at hand height, east of the protected door clearway' },
  { n: 99, x: 1.42, z: 5.72, mount: 'floor', ry: 0.3,
    category: 'entrance', collision: 'none', note: 'entrance corner outside the door swing and customer route' },
  { n: 100, x: DOOR_MAIN.x, z: 5.48, y: 0.004, mount: 'floor', ry: 0,
    category: 'entrance', collision: 'none', note: 'flat welcome mat sits just inside the threshold without z-fighting' },
]);

export const PLACED_ASSET_NUMBERS = Object.freeze(PROP_PLACEMENTS.map((placement) => placement.n));
export const PROP_PLACEMENT_BY_NUMBER = Object.freeze(Object.fromEntries(
  PROP_PLACEMENTS.map((placement) => [placement.n, placement]),
));

const SHEET06_SAVE_KEYS = Object.freeze({
  51: 'shop.reno.architecture.components.shell',
  52: 'shop.reno.architecture.components.shell',
  53: 'shop.reno.architecture.doors.main',
  54: 'shop.reno.architecture.components.porch',
  55: 'shop.reno.architecture.components.windows',
  56: 'shop.reno.architecture.components.panels',
  57: 'shop.reno.architecture.components.trim',
  58: 'shop.reno.architecture.components.ceiling',
  59: 'shop.reno.architecture.components.floor',
  60: 'shop.reno.architecture.components.floor',
});

function categoryFor(number, placement) {
  if (number <= 60) return number <= 54 ? 'clubhouse-architecture' : 'clubhouse-architecture-kit';
  return placement.category;
}

function performanceTier(number) {
  if (number <= 60) return 'hero-architecture';
  if (number <= 70 || [71, 73, 78, 81, 82].includes(number)) return 'standard-interior';
  return 'lightweight-dressing';
}

function restorationState(number) {
  if (number <= 60) return Object.freeze({
    authority: SHEET06_SAVE_KEYS[number],
    modes: Object.freeze(number === 52 || number === 60 ? ['damaged', 'hidden'] : ['damaged', 'restored']),
  });
  return Object.freeze({ authority: 'shop.reno.architecture', modes: Object.freeze(['visible']) });
}

function cleaningState(number, placement) {
  if ([55].includes(number)) return Object.freeze({ authority: 'shop.reno.windows', role: 'cleanable-window-surface' });
  if ([59, 60].includes(number)) return Object.freeze({ authority: 'shop.reno.grime', role: 'cleanable-floor-state' });
  if (number >= 71 && number <= 80) return Object.freeze({
    authority: 'shop.reno', role: placement.tool || placement.tools ? 'cleaning-tool-adapter' : 'cleaning-support',
  });
  if (number === 98) return Object.freeze({ authority: 'shop.assetRuntime.asset_098', role: 'utility-use-state' });
  return Object.freeze({ authority: null, role: 'not-cleaning-stateful' });
}

function visibilityRules(number, placement) {
  if (number === 52) return Object.freeze({ scope: 'exterior', when: 'shell-or-trim-damaged' });
  if (number === 60) return Object.freeze({ scope: 'interior', when: 'floor-damaged' });
  if (number <= 54) return Object.freeze({ scope: 'exterior', when: 'clubhouse-loaded' });
  if (number <= 60) return Object.freeze({ scope: 'interior', when: 'assembled-instance-or-parked-template' });
  return Object.freeze({
    scope: 'interior',
    when: placement.fixtureIds ? 'fixture-placed-and-interior-visible' : 'interior-visible',
    hiddenWhenFixtureStored: !!placement.fixtureIds,
  });
}

function sheet06Transform(binding) {
  const placement = resolveSheet06Placement(binding);
  return Object.freeze({
    position: placement.position,
    rotation: Object.freeze([0, 0, 0]),
    scale: Object.freeze([binding.runtimeScale, binding.runtimeScale, binding.runtimeScale]),
  });
}

function runtimeRecord(binding) {
  const number = binding.assetNumber;
  const placement = PROP_PLACEMENT_BY_NUMBER[number] || null;
  const defaultTransform = number <= 60
    ? sheet06Transform(binding)
    : freezeTransform({ ...placement, scale: binding.runtimeScale });
  const instances = placement?.fixtureIds?.map((fixtureId, index) => Object.freeze({
    id: `${number}-${fixtureId}`,
    fixtureId,
    defaultTransform: index === 0 ? defaultTransform : null,
  })) || null;
  return Object.freeze({
    assetNumber: number,
    glbPath: binding.paths.runtimeGlb,
    blenderSource: binding.paths.source,
    placementCategory: categoryFor(number, placement),
    defaultTransform,
    collisionMode: number <= 60 ? 'analytic-architecture' : placement.collision,
    mountType: number <= 60 ? binding.mount.root : placement.mount,
    interactionSockets: Object.freeze([...binding.requiredSockets]),
    animationClips: Object.freeze({
      world: Object.freeze([...binding.requiredAnimations]),
      firstPerson: Object.freeze([...(binding.firstPerson?.requiredAnimations || [])]),
    }),
    saveStateKey: SHEET06_SAVE_KEYS[number] || `shop.assetRuntime.asset_${String(number).padStart(3, '0')}`,
    restorationState: restorationState(number),
    cleaningState: cleaningState(number, placement),
    visibilityRules: visibilityRules(number, placement),
    performanceTier: performanceTier(number),
    binding,
    placement,
    instances: instances ? Object.freeze(instances) : null,
  });
}

export const RUNTIME_ASSET_MANIFEST = Object.freeze(ALL_ASSETS.map(runtimeRecord));
export const RUNTIME_ASSET_MANIFEST_BY_NUMBER = Object.freeze(Object.fromEntries(
  RUNTIME_ASSET_MANIFEST.map((record) => [record.assetNumber, record]),
));

if (RUNTIME_ASSET_MANIFEST.length !== 50) {
  throw new Error(`Runtime Assets 51–100 manifest must contain 50 records, found ${RUNTIME_ASSET_MANIFEST.length}.`);
}
for (let number = 51; number <= 100; number += 1) {
  if (!RUNTIME_ASSET_MANIFEST_BY_NUMBER[number]) throw new Error(`Runtime manifest is missing asset ${number}.`);
}

// Exported for placement tests: these are deliberately named constraints, not duplicated magic
// numbers in the loader.
export const RUNTIME_CLEARWAYS = Object.freeze({ entrance: DOOR_CLEARWAY, receiving: BACKDOOR_CLEARWAY });

export default RUNTIME_ASSET_MANIFEST;
