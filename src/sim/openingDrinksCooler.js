import { capacityOf, visibleSlotsFor } from '../data/fixtureSlots.js';

// The cooler is a view onto the existing cold_drinks fixture. Stock still moves
// only through stocking.js/inventoryLifecycle.js; this module never writes an
// inventory count or creates a lot. Its only durable state is the door pose.

export const OPENING_DRINKS_COOLER_STATE_VERSION = 1;
export const OPENING_DRINKS_COOLER_FIXTURE_ID = 'cold_drinks';
export const OPENING_DRINKS_COOLER_STATE_PATH = 'shop.reno.openingDrinksCooler';
export const OPENING_DRINKS_COOLER_ASSET_PATH = 'vendor/models/clubhouse/pine_hills_opening_drinks_cooler_v1.glb';
export const OPENING_DRINKS_COOLER_ROOT_NODE = 'A_PINE_HILLS_OPENING_DRINKS_COOLER_V1_ROOT';
export const OPENING_DRINKS_COOLER_SKU_IDS = Object.freeze([
  'water1',
  'sportdrink2',
  'soda1',
]);
export const OPENING_DRINKS_COOLER_DOOR_STATES = Object.freeze(['closed', 'open']);
export const OPENING_DRINKS_COOLER_DOOR_ACTIONS = Object.freeze(['open', 'close', 'toggle']);

const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const SOCKET_X_METERS = Object.freeze([-0.30, -0.18, -0.06, 0.06, 0.18, 0.30]);
const SHELF_Z_METERS = Object.freeze([0.34, 0.68, 1.02, 1.36]);
const roundMeters = (value) => Math.round(value * 1000) / 1000;

const authoredBottleSockets = () => {
  const sockets = [];
  for (let shelf = 0; shelf < SHELF_Z_METERS.length; shelf += 1) {
    for (let column = 0; column < SOCKET_X_METERS.length; column += 1) {
      const socketIndex = shelf * SOCKET_X_METERS.length + column + 1;
      const skuLane = Math.floor(column / 2);
      sockets.push({
        name: `SOCKET_Bottle_${String(socketIndex).padStart(2, '0')}`,
        socketIndex,
        shelfIndex: shelf + 1,
        columnIndex: column + 1,
        skuId: OPENING_DRINKS_COOLER_SKU_IDS[skuLane],
        skuSlotIndex: shelf * 2 + (column % 2) + 1,
        // Blender source coordinates, in metres. Runtime placement should
        // resolve the named GLB node so exporter axis conversion stays owned
        // by GLTFLoader; these values are validation/fallback metadata.
        sourcePositionMeters: {
          x: SOCKET_X_METERS[column],
          y: -0.075,
          z: roundMeters(SHELF_Z_METERS[shelf] + 0.020),
        },
        gltfPositionMeters: {
          x: SOCKET_X_METERS[column],
          y: roundMeters(SHELF_Z_METERS[shelf] + 0.020),
          z: 0.075,
        },
      });
    }
  }
  return sockets;
};

export const OPENING_DRINKS_COOLER_SOCKETS = deepFreeze(authoredBottleSockets());

const socketCapacityBySku = Object.fromEntries(OPENING_DRINKS_COOLER_SKU_IDS.map((skuId) => [
  skuId,
  OPENING_DRINKS_COOLER_SOCKETS.filter((socket) => socket.skuId === skuId).length,
]));

export const OPENING_DRINKS_COOLER_CAPACITY = deepFreeze({
  total: OPENING_DRINKS_COOLER_SOCKETS.length,
  bySku: socketCapacityBySku,
});

export const OPENING_DRINKS_COOLER_DOOR = deepFreeze({
  node: 'COOLER_Door',
  pivotNode: 'PIVOT_COOLER_Door',
  hingeAxis: '+Z',
  hingePositionMeters: [-0.420, -0.280, 0],
  gltfHingeAxis: '+Y',
  gltfHingePositionMeters: [-0.420, 0, 0.280],
  closedAngleDegrees: 0,
  openAngleDegrees: -108,
  clips: {
    open: 'COOLER_Door_Open',
    close: 'COOLER_Door_Close',
  },
});

export const OPENING_DRINKS_COOLER_COLLIDERS = deepFreeze([
  {
    node: 'COL_COOLER_Carcass',
    parentNode: OPENING_DRINKS_COOLER_ROOT_NODE,
    shape: 'box',
    purpose: 'blocking-carcass',
    dimensionsMeters: [0.90, 0.62, 1.90],
    centerMetersFromRoot: [0, 0.030, 0.950],
    gltfDimensionsMeters: [0.90, 1.90, 0.62],
    gltfCenterMetersFromRoot: [0, 0.950, -0.030],
    followsDoor: false,
  },
  {
    node: 'COL_COOLER_Door',
    parentNode: OPENING_DRINKS_COOLER_DOOR.node,
    shape: 'box',
    purpose: 'state-aware-opening-door',
    dimensionsMeters: [0.84, 0.035, 1.58],
    closedCenterMetersFromRoot: [0, -0.2975, 0.910],
    centerMetersFromParent: [0.420, -0.0175, 0.910],
    gltfDimensionsMeters: [0.84, 1.58, 0.035],
    gltfClosedCenterMetersFromRoot: [0, 0.910, 0.2975],
    gltfCenterMetersFromParent: [0.420, 0.910, 0.0175],
    followsDoor: true,
  },
]);

export const OPENING_DRINKS_COOLER_CONTRACT = deepFreeze({
  version: 1,
  fixtureId: OPENING_DRINKS_COOLER_FIXTURE_ID,
  assetPath: OPENING_DRINKS_COOLER_ASSET_PATH,
  rootNode: OPENING_DRINKS_COOLER_ROOT_NODE,
  dimensionsMeters: [0.90, 0.68, 1.90],
  dimensionOrder: ['width', 'depth', 'height'],
  sourceAxes: 'Blender +X right, +Y back, +Z up',
  gltfAxes: 'Three.js +X right, +Y up, +Z front',
  capacity: OPENING_DRINKS_COOLER_CAPACITY,
  skuIds: OPENING_DRINKS_COOLER_SKU_IDS,
  sockets: OPENING_DRINKS_COOLER_SOCKETS,
  door: OPENING_DRINKS_COOLER_DOOR,
  colliders: OPENING_DRINKS_COOLER_COLLIDERS,
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validDoorState = (value) => OPENING_DRINKS_COOLER_DOOR_STATES.includes(value);

export function createOpeningDrinksCoolerState() {
  return {
    version: OPENING_DRINKS_COOLER_STATE_VERSION,
    doorState: 'closed',
  };
}

function canonicalState(value) {
  return isRecord(value)
    && value.version === OPENING_DRINKS_COOLER_STATE_VERSION
    && validDoorState(value.doorState);
}

function normalizeState(value) {
  const normalized = createOpeningDrinksCoolerState();
  if (!isRecord(value)) return normalized;
  const legacyDoor = value.doorState ?? value.door?.state ?? value.door;
  if (validDoorState(legacyDoor)) normalized.doorState = legacyDoor;
  else if (legacyDoor === true) normalized.doorState = 'open';
  return normalized;
}

export function ensureOpeningDrinksCoolerState(state) {
  const reno = state?.shop?.reno;
  if (!isRecord(reno)) return null;
  const current = reno.openingDrinksCooler;
  if (canonicalState(current)) return current;
  const normalized = normalizeState(current);
  try {
    reno.openingDrinksCooler = normalized;
    return normalized;
  } catch {
    return null;
  }
}

const invalid = (action, reason) => ({
  ok: false,
  changed: false,
  fixtureId: OPENING_DRINKS_COOLER_FIXTURE_ID,
  action,
  reason,
});

function setDoorState(state, doorState, action) {
  if (!validDoorState(doorState)) return invalid(action, 'Cooler door state must be open or closed.');
  const cooler = ensureOpeningDrinksCoolerState(state);
  if (!cooler) return invalid(action, 'Opening drinks cooler state is unavailable.');
  const previousDoorState = cooler.doorState;
  if (previousDoorState === doorState) {
    return {
      ok: true,
      changed: false,
      fixtureId: OPENING_DRINKS_COOLER_FIXTURE_ID,
      action,
      previousDoorState,
      doorState,
    };
  }
  try {
    cooler.doorState = doorState;
  } catch {
    return invalid(action, 'Opening drinks cooler state is read-only.');
  }
  return {
    ok: true,
    changed: true,
    fixtureId: OPENING_DRINKS_COOLER_FIXTURE_ID,
    action,
    previousDoorState,
    doorState,
  };
}

export function openingDrinksCoolerDoorAction(state, action) {
  const type = typeof action === 'string' ? action : action?.type;
  if (!OPENING_DRINKS_COOLER_DOOR_ACTIONS.includes(type)) {
    return invalid(type ?? null, 'Cooler door action must be open, close, or toggle.');
  }
  const cooler = ensureOpeningDrinksCoolerState(state);
  if (!cooler) return invalid(type, 'Opening drinks cooler state is unavailable.');
  const next = type === 'toggle'
    ? (cooler.doorState === 'open' ? 'closed' : 'open')
    : (type === 'open' ? 'open' : 'closed');
  return setDoorState(state, next, type);
}

export const openOpeningDrinksCoolerDoor = (state) => openingDrinksCoolerDoorAction(state, 'open');
export const closeOpeningDrinksCoolerDoor = (state) => openingDrinksCoolerDoorAction(state, 'close');
export const toggleOpeningDrinksCoolerDoor = (state) => openingDrinksCoolerDoorAction(state, 'toggle');

const whole = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
};

function stockLineSnapshot(state, skuId) {
  const inventory = state?.shop?.inventory?.[skuId];
  const shelf = whole(inventory?.shelf);
  const back = whole(inventory?.back);
  const socketCapacity = OPENING_DRINKS_COOLER_CAPACITY.bySku[skuId];
  const stockingCapacity = capacityOf(skuId);
  const visible = Math.min(socketCapacity, visibleSlotsFor(skuId, shelf).length);
  return {
    skuId,
    shelf,
    back,
    visible,
    capacity: socketCapacity,
    stockingCapacity,
    capacityAligned: stockingCapacity === socketCapacity,
  };
}

// Read-only renderer snapshot. Shelf/back quantities and lifecycle lots are not
// normalized here because doing so would make a visual query an inventory verb.
export function openingDrinksCoolerSnapshot(state) {
  const cooler = ensureOpeningDrinksCoolerState(state);
  if (!cooler) return null;
  const stock = Object.fromEntries(OPENING_DRINKS_COOLER_SKU_IDS.map((skuId) => [
    skuId,
    stockLineSnapshot(state, skuId),
  ]));
  const sockets = OPENING_DRINKS_COOLER_SOCKETS.map((socket) => ({
    name: socket.name,
    socketIndex: socket.socketIndex,
    shelfIndex: socket.shelfIndex,
    columnIndex: socket.columnIndex,
    skuId: socket.skuId,
    skuSlotIndex: socket.skuSlotIndex,
    occupied: socket.skuSlotIndex <= stock[socket.skuId].visible,
  }));
  const visibleTotal = Object.values(stock).reduce((sum, line) => sum + line.visible, 0);
  return {
    version: cooler.version,
    fixtureId: OPENING_DRINKS_COOLER_FIXTURE_ID,
    statePath: OPENING_DRINKS_COOLER_STATE_PATH,
    assetPath: OPENING_DRINKS_COOLER_ASSET_PATH,
    rootNode: OPENING_DRINKS_COOLER_ROOT_NODE,
    door: {
      state: cooler.doorState,
      node: OPENING_DRINKS_COOLER_DOOR.node,
      pivotNode: OPENING_DRINKS_COOLER_DOOR.pivotNode,
      targetClip: OPENING_DRINKS_COOLER_DOOR.clips[
        cooler.doorState === 'open' ? 'open' : 'close'
      ],
    },
    capacity: {
      total: OPENING_DRINKS_COOLER_CAPACITY.total,
      bySku: { ...OPENING_DRINKS_COOLER_CAPACITY.bySku },
    },
    visibleTotal,
    stock,
    sockets,
    colliders: OPENING_DRINKS_COOLER_COLLIDERS.map((collider) => ({ ...collider })),
  };
}
