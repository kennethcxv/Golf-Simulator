// Delivery-equipment placement contracts.
//
// A delivery box remains the only authority for the quantity inside it. Equipment
// merely owns a saved location for that same box; it never mirrors or transfers qty.
// Keep the six item sockets aligned with delivery_stocking_cart.glb. The
// centered top-deck box socket is a logical placement spanning both authored
// top positions; its explicit conflicts prevent overlapping saved cartons.

import { BOX_KINDS, boxDims } from './boxes.js';

export const STOCKING_CART_EQUIPMENT_ID = 'delivery_stocking_cart';

const LEGACY_EQUIPMENT_IDS = new Set([
  STOCKING_CART_EQUIPMENT_ID,
  'stocking_cart',
  'stockingCart',
]);

export const STOCKING_CART_BOX_SOCKET_ID = 'STOCK_BOX_SOCKET_TOP';

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

const STOCKING_CART_SOCKET_BY_ID = new Map(
  STOCKING_CART_PLACEMENT_SOCKETS.map((socket) => [socket.socketId, socket]),
);

export function normalizeDeliveryEquipmentId(equipmentId) {
  return LEGACY_EQUIPMENT_IDS.has(equipmentId) ? STOCKING_CART_EQUIPMENT_ID : null;
}

export function deliveryEquipmentSocket(equipmentId, socketId) {
  const canonicalId = normalizeDeliveryEquipmentId(equipmentId);
  if (!canonicalId || typeof socketId !== 'string') return null;
  return STOCKING_CART_SOCKET_BY_ID.get(socketId) || null;
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
      reason: 'That stocking-cart position does not exist.',
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
      reason: `That carton is too tall for ${socket.socketId}'s ${socket.maxH.toFixed(2)} m clearance; use ${STOCKING_CART_BOX_SOCKET_ID} or flatten it when empty.`,
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
  const fits = STOCKING_CART_PLACEMENT_SOCKETS.filter(
    (socket) => deliveryEquipmentFit(box, equipmentId, socket.socketId).ok,
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
      return STOCKING_CART_PLACEMENT_SOCKETS.indexOf(a)
        - STOCKING_CART_PLACEMENT_SOCKETS.indexOf(b);
    })
    .map((socket) => socket.socketId);
}
