// Delivery-equipment placement contracts.
//
// A delivery box remains the only authority for the quantity inside it. Equipment
// merely owns a saved location for that same box; it never mirrors or transfers qty.
// Keep the six item sockets aligned with delivery_stocking_cart.glb. The
// centered top-deck box socket is a logical placement spanning both authored
// top positions; its explicit conflicts prevent overlapping saved cartons.

import { BOX_KINDS, boxDims } from './boxes.js';

export const STOCKING_CART_EQUIPMENT_ID = 'delivery_stocking_cart';
export const HAND_TRUCK_EQUIPMENT_ID = 'delivery_hand_truck';

const EQUIPMENT_ID_ALIASES = new Map([
  [STOCKING_CART_EQUIPMENT_ID, STOCKING_CART_EQUIPMENT_ID],
  ['stocking_cart', STOCKING_CART_EQUIPMENT_ID],
  ['stockingCart', STOCKING_CART_EQUIPMENT_ID],
  [HAND_TRUCK_EQUIPMENT_ID, HAND_TRUCK_EQUIPMENT_ID],
  ['hand_truck', HAND_TRUCK_EQUIPMENT_ID],
  ['handTruck', HAND_TRUCK_EQUIPMENT_ID],
]);

export const STOCKING_CART_BOX_SOCKET_ID = 'STOCK_BOX_SOCKET_TOP';
export const HAND_TRUCK_BOX_SOCKET_ID = 'LOAD_ORIGIN';

const stockingCartSocket = (index, shelf, maxH, conflicts = []) => Object.freeze({
  equipmentId: STOCKING_CART_EQUIPMENT_ID,
  socketId: `STOCK_SOCKET_${String(index).padStart(2, '0')}`,
  shelf,
  column: index % 2 === 1 ? 1 : 2,
  maxW: 0.420,
  maxD: 0.360,
  maxH,
  conflicts: Object.freeze([...conflicts]),
});

export const STOCKING_CART_SOCKETS = Object.freeze([
  stockingCartSocket(1, 1, 0.220),
  stockingCartSocket(2, 1, 0.220),
  stockingCartSocket(3, 2, 0.220),
  stockingCartSocket(4, 2, 0.220),
  stockingCartSocket(5, 3, 0.500, [STOCKING_CART_BOX_SOCKET_ID]),
  stockingCartSocket(6, 3, 0.500, [STOCKING_CART_BOX_SOCKET_ID]),
]);

export const STOCKING_CART_SOCKET_IDS = Object.freeze(
  STOCKING_CART_SOCKETS.map((socket) => socket.socketId),
);

export const STOCKING_CART_BOX_SOCKET = Object.freeze({
  equipmentId: STOCKING_CART_EQUIPMENT_ID,
  socketId: STOCKING_CART_BOX_SOCKET_ID,
  shelf: 3,
  column: 0,
  maxW: 0.620,
  maxD: 0.420,
  maxH: 0.500,
  preferredForSealedBoxes: true,
  conflicts: Object.freeze(['STOCK_SOCKET_05', 'STOCK_SOCKET_06']),
});

export const STOCKING_CART_PLACEMENT_SOCKETS = Object.freeze([
  ...STOCKING_CART_SOCKETS,
  STOCKING_CART_BOX_SOCKET,
]);

// Ref 42 authors a 0.50 x 0.40 m toe plate, a centred 0.60 x 0.40 m
// shipping-carton allowance, and 0.05 m side overhangs. Persist the authored
// LOAD_ORIGIN itself so the carton follows the true operational axle tilt.
export const HAND_TRUCK_BOX_SOCKET = Object.freeze({
  equipmentId: HAND_TRUCK_EQUIPMENT_ID,
  socketId: HAND_TRUCK_BOX_SOCKET_ID,
  shelf: 1,
  column: 0,
  maxW: 0.600,
  maxD: 0.400,
  maxH: 0.650,
  plateW: 0.500,
  plateD: 0.400,
  maximumSideOverhangEach: 0.050,
  preferredForSealedBoxes: true,
  conflicts: Object.freeze([]),
});

const STOCKING_CART_SOCKET_BY_ID = new Map(
  STOCKING_CART_PLACEMENT_SOCKETS.map((socket) => [socket.socketId, socket]),
);

const DELIVERY_EQUIPMENT_SOCKETS = new Map([
  [STOCKING_CART_EQUIPMENT_ID, STOCKING_CART_SOCKET_BY_ID],
  [HAND_TRUCK_EQUIPMENT_ID, new Map([
    [HAND_TRUCK_BOX_SOCKET.socketId, HAND_TRUCK_BOX_SOCKET],
  ])],
]);

export function normalizeDeliveryEquipmentId(equipmentId) {
  return EQUIPMENT_ID_ALIASES.get(equipmentId) || null;
}

export function deliveryEquipmentSocket(equipmentId, socketId) {
  const canonicalId = normalizeDeliveryEquipmentId(equipmentId);
  if (!canonicalId || typeof socketId !== 'string') return null;
  return DELIVERY_EQUIPMENT_SOCKETS.get(canonicalId)?.get(socketId) || null;
}

export function deliveryEquipmentPlacementForBox(box) {
  if (!box || box.loc !== 'equipment') return null;
  const equipmentId = normalizeDeliveryEquipmentId(box.equipmentId);
  const socket = deliveryEquipmentSocket(equipmentId, box.socketId);
  return equipmentId && socket
    ? { equipmentId, socketId: socket.socketId, socket }
    : null;
}

export function deliveryEquipmentSocketsConflict(equipmentId, firstSocketId, secondSocketId) {
  const first = deliveryEquipmentSocket(equipmentId, firstSocketId);
  const second = deliveryEquipmentSocket(equipmentId, secondSocketId);
  if (!first || !second) return false;
  return first.socketId === second.socketId
    || first.conflicts.includes(second.socketId)
    || second.conflicts.includes(first.socketId);
}

// Flattened cardboard is still the same saved delivery box, but its vertical
// clearance is the folded corrugate rather than the original sealed height.
export function deliveryEquipmentBoxDimensions(box) {
  const dimensions = boxDims(box?.box);
  return {
    w: dimensions.w,
    d: dimensions.d,
    h: box?.flat && (box?.qty || 0) <= 0 ? Math.min(dimensions.h, 0.040) : dimensions.h,
  };
}

export function deliveryEquipmentFit(box, equipmentId, socketId) {
  const canonicalId = normalizeDeliveryEquipmentId(equipmentId);
  if (!canonicalId) {
    return {
      ok: false,
      code: 'unknown-equipment',
      reason: 'That delivery equipment is not available.',
    };
  }
  const socket = deliveryEquipmentSocket(canonicalId, socketId);
  if (!socket) {
    return {
      ok: false,
      code: 'unknown-socket',
      reason: 'That delivery-equipment position does not exist.',
    };
  }

  const dimensions = deliveryEquipmentBoxDimensions(box);
  const footprintFits = (
    dimensions.w <= socket.maxW + 1e-6 && dimensions.d <= socket.maxD + 1e-6
  ) || (
    dimensions.d <= socket.maxW + 1e-6 && dimensions.w <= socket.maxD + 1e-6
  );
  if (!footprintFits) {
    const label = BOX_KINDS[box?.box]?.label || 'carton';
    return {
      ok: false,
      code: 'oversize-footprint',
      reason: `The ${label.toLowerCase()} is too long or wide for ${socket.socketId} (${socket.maxW.toFixed(2)} × ${socket.maxD.toFixed(2)} m).`,
      socket,
      dimensions,
    };
  }
  if (dimensions.h > socket.maxH + 1e-6) {
    return {
      ok: false,
      code: 'too-tall',
      reason: `That carton is too tall for ${socket.socketId}'s ${socket.maxH.toFixed(2)} m clearance.`,
      socket,
      dimensions,
    };
  }
  return { ok: true, equipmentId: canonicalId, socketId: socket.socketId, socket, dimensions };
}

// The centered deck socket is the honest first choice for a sealed shipping
// carton. Flattened cardboard prefers the six smaller authored item positions,
// leaving the top deck available for an incoming full case.
export function preferredDeliveryEquipmentSocketIds(
  box,
  equipmentId = STOCKING_CART_EQUIPMENT_ID,
) {
  const canonicalId = normalizeDeliveryEquipmentId(equipmentId);
  const sockets = canonicalId
    ? [...(DELIVERY_EQUIPMENT_SOCKETS.get(canonicalId)?.values() || [])]
    : [];
  const fits = sockets.filter(
    (socket) => deliveryEquipmentFit(box, canonicalId, socket.socketId).ok,
  );
  const flattenedEmpty = box?.flat && (box?.qty || 0) <= 0;
  return fits
    .sort((a, b) => {
      if (!flattenedEmpty) {
        if (a.socketId === STOCKING_CART_BOX_SOCKET_ID) return -1;
        if (b.socketId === STOCKING_CART_BOX_SOCKET_ID) return 1;
      } else {
        if (a.socketId === STOCKING_CART_BOX_SOCKET_ID) return 1;
        if (b.socketId === STOCKING_CART_BOX_SOCKET_ID) return -1;
      }
      return sockets.indexOf(a) - sockets.indexOf(b);
    })
    .map((socket) => socket.socketId);
}
