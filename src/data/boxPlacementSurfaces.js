// Stable, simulation-owned delivery-box supports.
//
// This is deliberately an allowlist rather than a scan of upward-facing meshes.
// A GLB may load late, be replaced by a fallback, or contain decorative ledges;
// none of those renderer details is allowed to change where a saved box may live.
// Coordinates and dimensions are clubhouse-local yards. A surface target stores
// x/z/yaw relative to the surface plane; the simulation composes that plane with
// its fixture/equipment parent.

import { INTERIOR, SHELL, STOCKROOM } from './shopLayout.js';
import {
  DELIVERY_PALLET_STAGING,
  deliveryPalletCentres,
} from './deliveryStaging.js';
import {
  HAND_TRUCK_BOX_SOCKET,
  HAND_TRUCK_BOX_SOCKET_ID,
  HAND_TRUCK_EQUIPMENT_ID,
  STOCKING_CART_EQUIPMENT_ID,
  STOCKING_CART_PLACEMENT_SOCKETS,
} from './deliveryEquipment.js';

export const BOX_PLACEMENT_SURFACE_VERSION = 1;
export const FLOOR_BOX_SURFACE_ID = 'floor:clubhouse';
export const APPAREL_TABLE_BOX_SURFACE_ID = 'fixture:table_polos:top';
export const PACKING_STATION_BOX_SURFACE_ID = 'station:packing:top';
export const BACKCOUNTER_EAST_BOX_SURFACE_ID = 'fixture:backcounter:worktop:east';

export const deliveryEquipmentSurfaceId = (equipmentId, socketId) => (
  `equipment:${equipmentId}:${socketId}`
);

export const HAND_TRUCK_BOX_SURFACE_ID = deliveryEquipmentSurfaceId(
  HAND_TRUCK_EQUIPMENT_ID,
  HAND_TRUCK_BOX_SOCKET_ID,
);

export const deliveryShelfSurfaceId = (moduleIndex, levelIndex) => (
  `fixture:backshelf_e2:m${String(moduleIndex).padStart(2, '0')}:l${String(levelIndex).padStart(2, '0')}`
);

export const deliveryPalletSurfaceId = (palletIndex) => `pallet:receiving:${palletIndex}`;

export const stockingCartSurfaceId = (socketId) => (
  deliveryEquipmentSurfaceId(STOCKING_CART_EQUIPMENT_ID, socketId)
);

const freezePose = (x, y, z, ry = 0) => Object.freeze({ x, y, z, ry });
const freezeBounds = (minX, maxX, minZ, maxZ) => Object.freeze({ minX, maxX, minZ, maxZ });
const capabilities = (overrides = {}) => Object.freeze({
  placeBox: true,
  pickUpBox: true,
  canUnpack: false,
  ...overrides,
});

const WORLD_PARENT = Object.freeze({ kind: 'world', id: 'clubhouse' });

const fixtureParent = (fixtureId) => Object.freeze({
  kind: 'fixture',
  id: fixtureId,
});

const equipmentParent = (equipmentId, defaultPose) => Object.freeze({
  kind: 'equipment',
  id: equipmentId,
  defaultPose: Object.freeze({ ...defaultPose }),
});

const surface = (spec) => Object.freeze({
  snap: 0.25,
  rotationStep: Math.PI / 2,
  reservedRects: Object.freeze([]),
  capabilities: capabilities(),
  ...spec,
});

const floor = surface({
  id: FLOOR_BOX_SURFACE_ID,
  kind: 'floor',
  label: 'Clubhouse floor',
  parent: WORLD_PARENT,
  localPose: freezePose(0, 0, 0, 0),
  bounds: freezeBounds(-INTERIOR.w / 2, INTERIOR.w / 2, -INTERIOR.d / 2, INTERIOR.d / 2),
  maxHeight: SHELL.h,
  capacity: null,
  unpackPolicy: 'stockroom-bounds',
});

const apparelTable = surface({
  id: APPAREL_TABLE_BOX_SURFACE_ID,
  kind: 'fixture-surface',
  label: 'Apparel table top',
  parent: fixtureParent('table_polos'),
  // Authored apparel_table is 1.60 x 0.90 with its top at y 0.801.
  // The 0.04 edge inset keeps a carton off the rounded lip.
  localPose: freezePose(0, 0.801, 0, 0),
  bounds: freezeBounds(-0.76, 0.76, -0.41, 0.41),
  maxHeight: 2.39,
  capacity: 1,
  capabilities: capabilities({ canUnpack: true }),
  reservationId: 'apparel-product-stacks',
});

// Asset 64 is one 1.83 m rack with four authored support sockets. Two logical bays keep the
// existing eight stable save IDs while fitting completely inside its 2.00 yd runtime width.
const STOCK_SHELF_LEVELS = Object.freeze([0.3336, 0.8585, 1.3834, 1.9084]);
const STOCK_SHELF_MODULE_X = Object.freeze([-0.44, 0.44]);
const stockShelves = [];
for (let moduleIndex = 1; moduleIndex <= STOCK_SHELF_MODULE_X.length; moduleIndex += 1) {
  for (let levelIndex = 1; levelIndex <= STOCK_SHELF_LEVELS.length; levelIndex += 1) {
    stockShelves.push(surface({
      id: deliveryShelfSurfaceId(moduleIndex, levelIndex),
      kind: 'storage-shelf',
      label: `East stock shelf ${moduleIndex}-${levelIndex}`,
      parent: fixtureParent('backshelf_e2'),
      localPose: freezePose(
        STOCK_SHELF_MODULE_X[moduleIndex - 1],
        STOCK_SHELF_LEVELS[levelIndex - 1],
        0,
        0,
      ),
      // Logical half-bay inside Asset 64, inset around its posts and board edges.
      bounds: freezeBounds(-0.38, 0.38, -0.20, 0.20),
      maxHeight: levelIndex < 4 ? 0.44 : 0.33,
      capacity: 1,
      capabilities: capabilities({ canUnpack: true }),
      shelfModule: moduleIndex,
      shelfLevel: levelIndex,
    }));
  }
}

const packingStation = surface({
  id: PACKING_STATION_BOX_SURFACE_ID,
  kind: 'unpacking-station',
  label: 'Packing bench',
  parent: WORLD_PARENT,
  localPose: freezePose(STOCKROOM.packing.x, 1.0061, STOCKROOM.packing.z, STOCKROOM.packing.ry),
  bounds: freezeBounds(-0.80, 0.80, -0.375, 0.375),
  maxHeight: 2.20,
  capacity: 1,
  capabilities: capabilities({ canUnpack: true }),
  // Dressing tools live on the lower supply shelf; the whole authored worktop
  // is therefore honest, usable support for one delivery carton.
});

const backcounterEast = surface({
  id: BACKCOUNTER_EAST_BOX_SURFACE_ID,
  kind: 'approved-counter',
  label: 'Back-counter east worktop',
  parent: fixtureParent('backcounter'),
  // Parent-local safe bay x [-0.35, 1.55], centred here at x 0.60.
  localPose: freezePose(0.60, 1.01, 0, 0),
  bounds: freezeBounds(-0.95, 0.95, -0.23, 0.23),
  maxHeight: 0.44,
  capacity: 1,
  capabilities: capabilities({ canUnpack: true }),
});

const pallets = deliveryPalletCentres().map((centre) => surface({
  id: deliveryPalletSurfaceId(centre.palletIndex),
  kind: 'pallet',
  label: `Receiving pallet ${centre.palletIndex + 1}`,
  parent: WORLD_PARENT,
  localPose: freezePose(centre.x, DELIVERY_PALLET_STAGING.height, centre.z, centre.ry),
  bounds: freezeBounds(
    -DELIVERY_PALLET_STAGING.length / 2 - DELIVERY_PALLET_STAGING.maxFootprintOverhang,
    DELIVERY_PALLET_STAGING.length / 2 + DELIVERY_PALLET_STAGING.maxFootprintOverhang,
    -DELIVERY_PALLET_STAGING.width / 2 - DELIVERY_PALLET_STAGING.maxFootprintOverhang,
    DELIVERY_PALLET_STAGING.width / 2 + DELIVERY_PALLET_STAGING.maxFootprintOverhang,
  ),
  maxHeight: DELIVERY_PALLET_STAGING.maxStackTop - DELIVERY_PALLET_STAGING.height,
  capacity: DELIVERY_PALLET_STAGING.maxBoxesPerPallet,
  palletIndex: centre.palletIndex,
}));

const CART_SHELF_Y = Object.freeze({ 1: 0.243, 2: 0.523, 3: 0.803 });
const cartParent = equipmentParent(
  STOCKING_CART_EQUIPMENT_ID,
  freezePose(6.35, 0, -3.4, 0),
);
const cartSockets = STOCKING_CART_PLACEMENT_SOCKETS.map((socketSpec) => {
  const x = socketSpec.column === 1 ? -0.225 : socketSpec.column === 2 ? 0.225 : 0;
  return surface({
    id: stockingCartSurfaceId(socketSpec.socketId),
    kind: 'equipment-socket',
    label: `Stocking cart ${socketSpec.socketId}`,
    parent: cartParent,
    localPose: freezePose(x, CART_SHELF_Y[socketSpec.shelf], 0, 0),
    bounds: freezeBounds(
      -socketSpec.maxW / 2, socketSpec.maxW / 2,
      -socketSpec.maxD / 2, socketSpec.maxD / 2,
    ),
    maxHeight: socketSpec.maxH,
    capacity: 1,
    capabilities: capabilities({ canUnpack: true }),
    equipmentId: STOCKING_CART_EQUIPMENT_ID,
    socketId: socketSpec.socketId,
    conflicts: socketSpec.conflicts,
  });
});

const handTruckSurface = surface({
  id: HAND_TRUCK_BOX_SURFACE_ID,
  kind: 'equipment-socket',
  label: 'Hand-truck load plate',
  parent: equipmentParent(
    HAND_TRUCK_EQUIPMENT_ID,
    freezePose(STOCKROOM.handTruck.x, 0, STOCKROOM.handTruck.z, 0.6),
  ),
  // This began as the reserved Ref-42 placeholder ID. The parallel equipment
  // contract now authors LOAD_ORIGIN at (0, .026, .12) and owns exact fit/save
  // behavior, so the allowlist can activate the same stable surface directly.
  localPose: freezePose(0, 0.026, 0.12, 0),
  bounds: freezeBounds(
    -HAND_TRUCK_BOX_SOCKET.maxW / 2, HAND_TRUCK_BOX_SOCKET.maxW / 2,
    -HAND_TRUCK_BOX_SOCKET.maxD / 2, HAND_TRUCK_BOX_SOCKET.maxD / 2,
  ),
  maxHeight: HAND_TRUCK_BOX_SOCKET.maxH,
  capacity: 1,
  // LOAD_ORIGIN is a transport socket, not a work surface. Move the carton
  // onto an approved table, counter, shelf or station before opening it.
  capabilities: capabilities({ canUnpack: false }),
  equipmentId: HAND_TRUCK_EQUIPMENT_ID,
  socketId: HAND_TRUCK_BOX_SOCKET_ID,
  conflicts: HAND_TRUCK_BOX_SOCKET.conflicts,
});

export const BOX_PLACEMENT_SURFACE_TEMPLATES = Object.freeze([
  floor,
  apparelTable,
  ...stockShelves,
  packingStation,
  backcounterEast,
  ...pallets,
  ...cartSockets,
  handTruckSurface,
]);

const SURFACE_BY_ID = new Map(
  BOX_PLACEMENT_SURFACE_TEMPLATES.map((entry) => [entry.id, entry]),
);

export function boxPlacementSurfaceTemplate(surfaceId) {
  return typeof surfaceId === 'string' ? SURFACE_BY_ID.get(surfaceId) || null : null;
}
