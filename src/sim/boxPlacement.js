// Pure delivery-box placement queries.
//
// The save's deliveries.boxes array remains the only authority for both carton
// quantity and placement occupancy. This module never reserves a slot, moves a
// box, repairs a save, or imports Three.js. Preview and eventual commit callers
// are expected to use the same result from previewBoxPlacement().

import { BOX_KINDS, boxDims } from '../data/boxes.js';
import { DECOR_SPOTS } from '../data/shopItems.js';
import { placeableSpecBySkuId } from '../data/placeableItems.js';
import { placedPropertyItems } from './propertyInventory.js';
import { placeableFootprint } from './propertyPlacement.js';
import {
  BACKDOOR_CLEARWAY,
  COUNTER,
  DOOR_CLEARWAY,
  FIXTURES,
  INTERIOR,
  LOUNGE,
  PARTITIONS,
  PLAYER_DIAM,
  STAFF_CORRIDOR_MIN,
  STOCKROOM,
  fixtureRect,
  queueSlot,
  resolvedOfficeLayout,
} from '../data/shopLayout.js';
import { slotsFor } from '../data/fixtureSlots.js';
import {
  DELIVERY_PALLET_STAGING,
  deliveryBoxFitsPallet,
  planPalletizedPadBoxes,
  sealedDeliveryBoxHeight,
} from '../data/deliveryStaging.js';
import {
  HAND_TRUCK_EQUIPMENT_ID,
  STOCKING_CART_EQUIPMENT_ID,
  deliveryEquipmentFit,
  deliveryEquipmentSocketsConflict,
  normalizeDeliveryEquipmentId,
} from '../data/deliveryEquipment.js';
import {
  APPAREL_TABLE_BOX_SURFACE_ID,
  BOX_PLACEMENT_SURFACE_TEMPLATES,
  FLOOR_BOX_SURFACE_ID,
  boxPlacementSurfaceTemplate,
  deliveryEquipmentSurfaceId,
  deliveryPalletSurfaceId,
} from '../data/boxPlacementSurfaces.js';
import { fixtureIsInstalled } from './shopProgression.js';

const EPSILON = 1e-6;
const BODY_RADIUS = PLAYER_DIAM / 2;
const ROUTE_GRID = 0.25;

// Every BOX_KINDS family maps to an authored four-flap hierarchy. Apparel and
// club cases own hero geometry; the other families non-uniformly scale Ref 46's
// exact 0.60 x 0.40 x 0.40 construction to the dimensions in data/boxes.js.
// These values live beside the pure envelope rather than importing Three.js.
const AUTHORED_FOUR_FLAP_KINDS = new Set(Object.keys(BOX_KINDS));
const HERO_FLAT_HEIGHTS = Object.freeze({
  apparel: 0.040,
  clubbox: 0.030,
});
// Ref 46's layered bundle reaches just under 4.4 cm against its 40 cm source
// height (including the label/bevel). Non-uniform outer scaling applies that
// same ratio to carton, ballcase, merchandise, shoe, bag, fixture, and crate.
const GENERIC_FLAT_HEIGHT_RATIO = 0.11;
const AUTHORED_OPEN_ANGLE = Math.PI * 0.68;
const PROCEDURAL_OPEN_ANGLE = Math.PI * 0.62;
const PROCEDURAL_FLAT_DEPTH_SCALE = 1.60;

export const BOX_PLACEMENT_CODES = Object.freeze({
  OK: 'ok',
  UNKNOWN_BOX: 'unknown-box',
  INVALID_TARGET: 'invalid-target',
  UNKNOWN_SURFACE: 'unknown-surface',
  SURFACE_UNAVAILABLE: 'surface-unavailable',
  SURFACE_NOT_PLACEABLE: 'surface-not-placeable',
  INVALID_POSITION: 'invalid-position',
  WALL: 'wall',
  OUTSIDE_SUPPORT: 'outside-support',
  TOO_TALL: 'too-tall',
  SURFACE_FULL: 'surface-full',
  RESERVED_SPACE: 'reserved-space',
  BOX_OVERLAP: 'box-overlap',
  FIXTURE_OVERLAP: 'fixture-overlap',
  DOORWAY_BLOCKED: 'doorway-blocked',
  STAFF_WORKSPACE: 'staff-workspace',
  ROUTE_BLOCKED: 'route-blocked',
  UNKNOWN_PALLET: 'unknown-pallet',
  UNSUPPORTED_STACK: 'unsupported-stack',
  UNKNOWN_EQUIPMENT: 'unknown-equipment',
  UNKNOWN_SOCKET: 'unknown-socket',
  OVERSIZE_FOOTPRINT: 'oversize-footprint',
  SOCKET_OCCUPIED: 'socket-occupied',
  SOCKET_CONFLICT: 'socket-conflict',
});

const fail = (code, reason, details = {}) => ({
  ok: false,
  code,
  reason,
  reasons: [reason],
  ...details,
});

const success = (details = {}) => ({
  ok: true,
  code: BOX_PLACEMENT_CODES.OK,
  reason: 'That placement is clear.',
  reasons: [],
  ...details,
});

const deliveryBoxes = (state) => (
  Array.isArray(state?.shop?.deliveries?.boxes) ? state.shop.deliveries.boxes : []
);

const finitePose = (pose) => pose
  && Number.isFinite(pose.x)
  && Number.isFinite(pose.y)
  && Number.isFinite(pose.z)
  && Number.isFinite(pose.ry);

const rotateXZ = (x, z, ry) => {
  const cosine = Math.cos(ry);
  const sine = Math.sin(ry);
  return {
    x: cosine * x + sine * z,
    z: -sine * x + cosine * z,
  };
};

const composePose = (parent, local) => {
  const offset = rotateXZ(local.x, local.z, parent.ry);
  return {
    x: parent.x + offset.x,
    y: parent.y + local.y,
    z: parent.z + offset.z,
    ry: parent.ry + local.ry,
  };
};

const rectsOverlap = (first, second, epsilon = EPSILON) => (
  first.maxX > second.minX + epsilon
  && first.minX < second.maxX - epsilon
  && first.maxZ > second.minZ + epsilon
  && first.minZ < second.maxZ - epsilon
);

const volumesOverlap = (first, second, epsilon = EPSILON) => (
  rectsOverlap(first, second, epsilon)
  && first.maxY > second.minY + epsilon
  && first.minY < second.maxY - epsilon
);

const containsEnvelope = (bounds, envelope) => (
  envelope.minX >= bounds.minX - EPSILON
  && envelope.maxX <= bounds.maxX + EPSILON
  && envelope.minZ >= bounds.minZ - EPSILON
  && envelope.maxZ <= bounds.maxZ + EPSILON
);

function fourFlapProgress(box) {
  const source = Array.isArray(box?.flapProgress)
    ? box.flapProgress
    : (Array.isArray(box?.flaps) ? box.flaps : []);
  if (source.length >= 4) return [0, 1, 2, 3].map((index) => Number(source[index]) || 0);
  const front = Number(source[0]) || 0;
  const back = Number(source[1]) || 0;
  return [front, back, front, back];
}

function lifecycleImpliesOpenFlaps(box) {
  return ['OPEN', 'PARTIALLY_EMPTIED', 'EMPTY', 'FLATTENING'].includes(box?.lifecycle);
}

// This is intentionally phase-conservative rather than frame-exact. As soon
// as a physical flap starts moving, placement reserves its complete authored
// opening arc. That both covers every partially-open pose and means the load
// healer only needs to invalidate once per newly-active flap, not every frame.
export function boxPlacementEnvelopePhase(box) {
  if (box?.flat) return 'flat';
  if ((Number(box?.flattenProgress) || 0) > 0) return 'flattening';
  const flaps = fourFlapProgress(box);
  const mask = flaps.reduce((value, progress, index) => (
    progress > 0 ? value | (1 << index) : value
  ), 0);
  if (mask) return `open:${mask}`;
  return lifecycleImpliesOpenFlaps(box) ? 'open:15' : 'sealed';
}

export function boxPlacementDimensions(box) {
  const dimensions = boxDims(box?.box);
  const kind = typeof box?.box === 'string' ? box.box : box?.box?.id;
  const authored = AUTHORED_FOUR_FLAP_KINDS.has(kind);
  const phase = boxPlacementEnvelopePhase(box);

  if (phase === 'flat') {
    if (!authored) {
      return {
        w: dimensions.w,
        d: dimensions.d * PROCEDURAL_FLAT_DEPTH_SCALE,
        h: Math.min(dimensions.h, 0.030),
      };
    }
    return {
      w: dimensions.w,
      d: dimensions.d,
      h: HERO_FLAT_HEIGHTS[kind]
        ?? Math.max(0.030, dimensions.h * GENERIC_FLAT_HEIGHT_RATIO),
    };
  }

  if (phase === 'sealed') {
    return {
      w: dimensions.w,
      d: dimensions.d,
      h: sealedDeliveryBoxHeight(box?.box),
    };
  }

  const rawMask = phase === 'flattening'
    ? 15
    : Number.parseInt(phase.slice('open:'.length), 10) || 15;
  const angle = authored ? AUTHORED_OPEN_ANGLE : PROCEDURAL_OPEN_ANGLE;
  const outwardFactor = Math.max(0, -Math.cos(angle));
  const verticalFactor = Math.max(0, Math.sin(angle));
  const frontBackSpan = dimensions.d / 2;
  // The long club case has narrow end flaps; the two medium authored cases use
  // true half-width side flaps. Procedural cartons render only front/back.
  const sideSpan = !authored ? 0 : kind === 'clubbox' ? dimensions.w * 0.075 : dimensions.w / 2;
  const frontBackActive = !!(rawMask & 0b0011);
  const sideActive = !!(rawMask & 0b1100);
  const openDepth = frontBackActive
    ? dimensions.d + 2 * frontBackSpan * outwardFactor
    : dimensions.d;
  const openWidth = sideActive
    ? dimensions.w + 2 * sideSpan * outwardFactor
    : dimensions.w;
  const openHeight = sealedDeliveryBoxHeight(box?.box) + Math.max(
    frontBackActive ? frontBackSpan * verticalFactor : 0,
    sideActive ? sideSpan * verticalFactor : 0,
  ) + 0.012;

  return {
    w: openWidth,
    d: phase === 'flattening' && !authored
      ? Math.max(openDepth, dimensions.d * PROCEDURAL_FLAT_DEPTH_SCALE)
      : openDepth,
    h: openHeight,
  };
}

// Preferred signature: boxPlacementEnvelope(box, { x, z, ry, baseY }).
// A lone numeric second argument is also accepted as yaw, and the legacy
// positional (box, x, z, ry, baseY) shape is supported for integration ease.
export function boxPlacementEnvelope(box, placement = {}, zArg = 0, ryArg = 0, baseYArg = 0) {
  let x = 0;
  let z = 0;
  let ry = 0;
  let baseY = 0;
  if (placement && typeof placement === 'object') {
    x = Number.isFinite(placement.x) ? placement.x : 0;
    z = Number.isFinite(placement.z) ? placement.z : 0;
    ry = Number.isFinite(placement.ry) ? placement.ry : 0;
    baseY = Number.isFinite(placement.baseY) ? placement.baseY : 0;
  } else if (typeof placement === 'number') {
    if (arguments.length >= 3) {
      x = placement;
      z = Number.isFinite(zArg) ? zArg : 0;
      ry = Number.isFinite(ryArg) ? ryArg : 0;
      baseY = Number.isFinite(baseYArg) ? baseYArg : 0;
    } else {
      ry = placement;
    }
  }
  const dimensions = boxPlacementDimensions(box);
  const cosine = Math.abs(Math.cos(ry));
  const sine = Math.abs(Math.sin(ry));
  const halfX = (cosine * dimensions.w + sine * dimensions.d) / 2;
  const halfZ = (sine * dimensions.w + cosine * dimensions.d) / 2;
  return {
    x, z, ry, baseY,
    minX: x - halfX,
    maxX: x + halfX,
    minZ: z - halfZ,
    maxZ: z + halfZ,
    minY: baseY,
    maxY: baseY + dimensions.h,
    halfX,
    halfZ,
    dimensions,
  };
}

function layoutFixture(state, fixtureId) {
  const base = FIXTURES.find((entry) => entry.id === fixtureId);
  if (!base || (base.generatedOnly && !state?.shop?.generation)) return null;
  if (state?.shop?.generation && !fixtureIsInstalled(state, fixtureId)) return null;
  const layout = state?.shop?.layout;
  const stored = Array.isArray(layout?.stored) && layout.stored.includes(fixtureId);
  const sold = Array.isArray(layout?.sold) && layout.sold.includes(fixtureId);
  const moved = layout?.moved?.[fixtureId];
  const generated = state?.shop?.generation?.fixturePoses?.[fixtureId];
  const movedIsValid = !moved || (
    Number.isFinite(moved.x) && Number.isFinite(moved.z) && Number.isFinite(moved.ry)
  );
  return {
    fixture: movedIsValid && moved
      ? { ...base, x: moved.x, z: moved.z, ry: moved.ry }
      : generated && Number.isFinite(generated.x) && Number.isFinite(generated.z)
        ? { ...base, x: generated.x, z: generated.z, ry: Number.isFinite(generated.ry) ? generated.ry : base.ry }
        : base,
    stored: stored || sold,
    valid: movedIsValid,
  };
}

function placedFixturesReadOnly(state) {
  const layout = state?.shop?.layout;
  const stored = new Set(Array.isArray(layout?.stored) ? layout.stored : []);
  const sold = new Set(Array.isArray(layout?.sold) ? layout.sold : []);
  const generated = state?.shop?.generation?.fixturePoses || {};
  const out = [];
  for (const base of FIXTURES) {
    if (base.generatedOnly && !state?.shop?.generation) continue;
    if (state?.shop?.generation && !fixtureIsInstalled(state, base.id)) continue;
    if (stored.has(base.id) || sold.has(base.id)) continue;
    const moved = layout?.moved?.[base.id];
    const conveyed = generated[base.id];
    const fixture = conveyed && Number.isFinite(conveyed.x) && Number.isFinite(conveyed.z)
      ? { ...base, x: conveyed.x, z: conveyed.z, ry: Number.isFinite(conveyed.ry) ? conveyed.ry : base.ry }
      : base;
    out.push(moved && Number.isFinite(moved.x) && Number.isFinite(moved.z) && Number.isFinite(moved.ry)
      ? { ...fixture, x: moved.x, z: moved.z, ry: moved.ry }
      : fixture);
  }
  for (const extra of Array.isArray(layout?.extra) ? layout.extra : []) {
    if (extra && Number.isFinite(extra.x) && Number.isFinite(extra.z)) out.push(extra);
  }
  return out;
}

function optionPose(options, parentId) {
  const source = options?.equipmentPoses;
  if (!source) return null;
  const value = source instanceof Map ? source.get(parentId) : source[parentId];
  if (!value) return null;
  const pose = {
    x: value.x,
    y: Number.isFinite(value.y) ? value.y : 0,
    z: value.z,
    ry: Number.isFinite(value.ry) ? value.ry : 0,
  };
  return finitePose(pose) ? pose : null;
}

function resolveParentPose(state, parent, options) {
  if (!parent || parent.kind === 'world') {
    return { ok: true, pose: { x: 0, y: 0, z: 0, ry: 0 } };
  }
  if (parent.kind === 'fixture') {
    const resolved = layoutFixture(state, parent.id);
    if (!resolved) {
      return fail(
        BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
        `The ${parent.id} fixture no longer exists.`,
      );
    }
    if (!resolved.valid) {
      return fail(
        BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
        `The ${parent.id} fixture has an invalid saved transform.`,
      );
    }
    if (resolved.stored) {
      return fail(
        BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
        `The ${resolved.fixture.title || parent.id} is in storage.`,
      );
    }
    return {
      ok: true,
      pose: {
        x: resolved.fixture.x,
        y: 0,
        z: resolved.fixture.z,
        ry: resolved.fixture.ry || 0,
      },
    };
  }
  if (parent.kind === 'generated-fixture') {
    if (!state?.shop?.generation) {
      return { ok: true, pose: { ...parent.defaultPose, y: parent.defaultPose?.y || 0 } };
    }
    return resolveParentPose(state, { kind: 'fixture', id: parent.id }, options);
  }
  if (parent.kind === 'equipment') {
    const override = optionPose(options, parent.id);
    const pose = override || parent.defaultPose;
    if (!finitePose(pose)) {
      return fail(
        BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
        `The ${parent.id} equipment transform is unavailable.`,
      );
    }
    return { ok: true, pose: { ...pose } };
  }
  return fail(
    BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
    'That surface has an unsupported parent.',
  );
}

function resolveSurfaceDescriptor(state, template, options = {}) {
  const parent = resolveParentPose(state, template.parent, options);
  const templateUnavailable = template.unavailableReason || null;
  const localPose = state?.shop?.generation && Number.isFinite(template.generatedLocalY)
    ? { ...template.localPose, y: template.generatedLocalY }
    : template.localPose;
  if (!parent.ok) {
    return {
      ...template,
      available: false,
      unavailableReason: parent.reason,
      parentPose: null,
      worldPose: null,
    };
  }
  return {
    ...template,
    available: !templateUnavailable,
    unavailableReason: templateUnavailable,
    parentPose: parent.pose,
    localPose,
    worldPose: composePose(parent.pose, localPose),
  };
}

export function boxPlacementSurfaces(state, options = {}) {
  const includeUnavailable = options.includeUnavailable !== false;
  const surfaces = BOX_PLACEMENT_SURFACE_TEMPLATES
    .map((template) => resolveSurfaceDescriptor(state, template, options));
  return includeUnavailable ? surfaces : surfaces.filter((entry) => entry.available);
}

export function surfaceById(state, surfaceId, options = {}) {
  const template = boxPlacementSurfaceTemplate(surfaceId);
  return template ? resolveSurfaceDescriptor(state, template, options) : null;
}

function targetYaw(target) {
  if (Number.isFinite(target?.ry)) return target.ry;
  if (Number.isFinite(target?.quarterTurns)) return Math.trunc(target.quarterTurns) * Math.PI / 2;
  return 0;
}

function normalizeTarget(target) {
  if (typeof target === 'string') {
    return { kind: 'surface', surfaceId: target, x: 0, z: 0, ry: 0 };
  }
  if (!target || typeof target !== 'object') return null;
  if (target.loc === 'world') {
    return {
      kind: 'surface',
      surfaceId: target.surfaceId || FLOOR_BOX_SURFACE_ID,
      x: target.x,
      z: target.z,
      ry: targetYaw(target),
    };
  }
  if (target.loc === 'equipment') {
    return {
      kind: 'equipment',
      equipmentId: target.equipmentId,
      socketId: target.socketId,
    };
  }
  if (target.loc === 'pad') {
    return { kind: 'pallet', palletIndex: target.padPalletIndex };
  }
  if (target.kind === 'surface') {
    return {
      kind: 'surface',
      surfaceId: target.surfaceId,
      x: target.x,
      z: target.z,
      ry: targetYaw(target),
    };
  }
  if (target.kind === 'equipment') {
    return {
      kind: 'equipment',
      equipmentId: target.equipmentId,
      socketId: target.socketId,
    };
  }
  if (target.kind === 'pallet') {
    return { kind: 'pallet', palletIndex: target.palletIndex };
  }
  return null;
}

export function boxPlacementTargetFor(box) {
  if (!box || typeof box !== 'object') return null;
  if (box.loc === 'world') {
    return {
      kind: 'surface',
      surfaceId: box.surfaceId || FLOOR_BOX_SURFACE_ID,
      x: box.x,
      z: box.z,
      ry: Number.isFinite(box.ry) ? box.ry : 0,
    };
  }
  if (box.loc === 'equipment') {
    return {
      kind: 'equipment',
      equipmentId: normalizeDeliveryEquipmentId(box.equipmentId) || box.equipmentId,
      socketId: box.socketId,
    };
  }
  if (box.loc === 'pad') {
    return { kind: 'pallet', palletIndex: box.padPalletIndex };
  }
  if (box.loc === 'stock' || box.loc === 'carried') return { kind: box.loc };
  return null;
}

function surfaceIdForTarget(target) {
  if (!target) return null;
  if (target.kind === 'surface') return target.surfaceId;
  if (target.kind === 'pallet') return deliveryPalletSurfaceId(target.palletIndex);
  if (target.kind === 'equipment') {
    const equipmentId = normalizeDeliveryEquipmentId(target.equipmentId) || target.equipmentId;
    return deliveryEquipmentSurfaceId(equipmentId, target.socketId);
  }
  return null;
}

export function snapBoxPlacementTarget(state, target, options = {}) {
  const normalized = normalizeTarget(target);
  if (!normalized || normalized.kind !== 'surface') return normalized;
  const surface = surfaceById(state, normalized.surfaceId, options);
  if (!surface) return normalized;
  const snap = Number.isFinite(surface.snap) && surface.snap > 0 ? surface.snap : 0;
  const rotationStep = Number.isFinite(surface.rotationStep) && surface.rotationStep > 0
    ? surface.rotationStep : 0;
  return {
    ...normalized,
    x: snap && Number.isFinite(normalized.x)
      ? Math.round(normalized.x / snap) * snap : normalized.x,
    z: snap && Number.isFinite(normalized.z)
      ? Math.round(normalized.z / snap) * snap : normalized.z,
    ry: rotationStep
      ? Math.round(normalized.ry / rotationStep) * rotationStep : normalized.ry,
  };
}

export function resolveSurfacePose(state, targetOrSurfaceId, options = {}) {
  const target = normalizeTarget(targetOrSurfaceId);
  if (!target) {
    return fail(BOX_PLACEMENT_CODES.INVALID_TARGET, 'No box-placement target was supplied.');
  }
  const surfaceId = surfaceIdForTarget(target);
  const surface = surfaceById(state, surfaceId, options);
  if (!surface) {
    return fail(
      BOX_PLACEMENT_CODES.UNKNOWN_SURFACE,
      `The box surface "${String(surfaceId)}" is not registered.`,
      { surfaceId },
    );
  }
  if (!surface.available) {
    return fail(
      BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
      surface.unavailableReason || 'That surface is unavailable.',
      { surfaceId, surface },
    );
  }
  const x = target.kind === 'surface' ? target.x : 0;
  const z = target.kind === 'surface' ? target.z : 0;
  const relativeYaw = target.kind === 'surface' ? target.ry : 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(relativeYaw)) {
    return fail(
      BOX_PLACEMENT_CODES.INVALID_POSITION,
      'Box placement needs finite x, z, and rotation values.',
      { surfaceId, surface },
    );
  }
  const offset = rotateXZ(x, z, surface.worldPose.ry);
  const pose = {
    x: surface.worldPose.x + offset.x,
    y: surface.worldPose.y,
    baseY: surface.worldPose.y,
    z: surface.worldPose.z + offset.z,
    ry: surface.worldPose.ry + relativeYaw,
    localX: x,
    localZ: z,
    localRy: relativeYaw,
  };
  return success({ surfaceId, surface, target, pose });
}

function equipmentQuarterTurn(box, surface) {
  const dimensions = boxPlacementDimensions(box);
  const maxW = surface.bounds.maxX - surface.bounds.minX;
  const maxD = surface.bounds.maxZ - surface.bounds.minZ;
  const direct = dimensions.w <= maxW + EPSILON && dimensions.d <= maxD + EPSILON;
  return direct ? 0 : Math.PI / 2;
}

function poseResult(box, surface, pose, target, extra = {}) {
  const dimensions = boxPlacementDimensions(box);
  const envelope = boxPlacementEnvelope(box, {
    x: pose.x,
    z: pose.z,
    ry: pose.ry,
    baseY: pose.baseY,
  });
  return success({
    surfaceId: surface.id,
    surface,
    target,
    pose: {
      ...pose,
      y: pose.baseY,
      centerY: pose.baseY + dimensions.h / 2,
    },
    dimensions,
    envelope,
    ...extra,
  });
}

function planForPadBox(state, box) {
  const padBoxes = deliveryBoxes(state).filter((entry) => entry?.loc === 'pad');
  const included = padBoxes.some((entry) => entry === box || entry.id === box?.id);
  const source = included ? padBoxes : [...padBoxes, { ...box, loc: 'pad' }];
  return planPalletizedPadBoxes(source).find((plan) => plan.boxId === box?.id) || null;
}

export function resolveBoxPose(state, box, options = {}) {
  const target = boxPlacementTargetFor(box);
  if (!target) {
    return fail(BOX_PLACEMENT_CODES.INVALID_TARGET, 'That box has no resolvable placement.');
  }
  if (target.kind === 'stock' || target.kind === 'carried') {
    return fail(
      BOX_PLACEMENT_CODES.INVALID_TARGET,
      `${target.kind === 'stock' ? 'Receiving-stack' : 'Carried'} boxes do not own a saved surface pose.`,
      { target },
    );
  }
  if (target.kind === 'pallet') {
    const plan = planForPadBox(state, box);
    if (!plan) {
      return fail(BOX_PLACEMENT_CODES.UNKNOWN_PALLET, 'That pallet placement cannot be resolved.');
    }
    const surface = surfaceById(state, deliveryPalletSurfaceId(plan.palletIndex), options);
    if (!surface || !surface.available) {
      return fail(BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE, 'That receiving pallet is unavailable.');
    }
    return poseResult(box, surface, {
      x: plan.x,
      z: plan.z,
      ry: plan.ry,
      baseY: plan.baseY,
      localX: 0,
      localZ: 0,
      localRy: plan.ry - surface.worldPose.ry,
    }, { loc: 'pad', padPalletIndex: plan.palletIndex }, { palletPlan: plan });
  }
  if (target.kind === 'equipment') {
    const equipmentId = normalizeDeliveryEquipmentId(target.equipmentId) || target.equipmentId;
    const fit = deliveryEquipmentFit(box, equipmentId, target.socketId);
    if (!fit.ok) return { ...fit, reasons: [fit.reason] };
    const surfaceId = deliveryEquipmentSurfaceId(equipmentId, target.socketId);
    const surface = surfaceById(state, surfaceId, options);
    if (!surface || !surface.available) {
      return fail(BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE, 'That equipment socket is unavailable.');
    }
    const relativeYaw = equipmentQuarterTurn(box, surface);
    const pose = {
      x: surface.worldPose.x,
      z: surface.worldPose.z,
      ry: surface.worldPose.ry + relativeYaw,
      baseY: surface.worldPose.y,
      localX: 0,
      localZ: 0,
      localRy: relativeYaw,
    };
    return poseResult(box, surface, pose, {
      loc: 'equipment', equipmentId, socketId: target.socketId,
    }, { equipmentFit: fit });
  }
  const resolved = resolveSurfacePose(state, target, options);
  if (!resolved.ok) return resolved;
  return poseResult(
    box,
    resolved.surface,
    resolved.pose,
    normalPlacementTarget(resolved.surface, target),
  );
}

function palletPlansForState(state) {
  return planPalletizedPadBoxes(deliveryBoxes(state).filter((box) => box?.loc === 'pad'));
}

export function boxesOnSurface(state, surfaceId, { exceptId } = {}) {
  const template = boxPlacementSurfaceTemplate(surfaceId);
  if (!template) return [];
  const boxes = deliveryBoxes(state);
  const include = (box) => exceptId == null || box?.id !== exceptId;
  if (template.kind === 'pallet') {
    const ids = new Set(
      palletPlansForState(state)
        .filter((plan) => plan.palletIndex === template.palletIndex)
        .map((plan) => plan.boxId),
    );
    return boxes.filter((box) => include(box) && box?.loc === 'pad' && ids.has(box.id));
  }
  if (template.kind === 'equipment-socket') {
    return boxes.filter((box) => include(box)
      && box?.loc === 'equipment'
      && (normalizeDeliveryEquipmentId(box.equipmentId) || box.equipmentId) === template.equipmentId
      && box.socketId === template.socketId);
  }
  if (surfaceId === FLOOR_BOX_SURFACE_ID) {
    return boxes.filter((box) => include(box)
      && box?.loc === 'world'
      && (!box.surfaceId || box.surfaceId === FLOOR_BOX_SURFACE_ID));
  }
  return boxes.filter((box) => include(box)
    && box?.loc === 'world'
    && box.surfaceId === surfaceId);
}

export function reservedRectsForSurface(state, surfaceOrId, options = {}) {
  const surface = typeof surfaceOrId === 'string'
    ? surfaceById(state, surfaceOrId, options) : surfaceOrId;
  if (!surface) return [];
  const reserved = [...(surface.reservedRects || [])];
  if (surface.id !== APPAREL_TABLE_BOX_SURFACE_ID) return reserved;

  // A folded polo is 0.20 x 0.165. Add a restrained handling margin and
  // collapse the three vertical units of each stack into one top-plane rect.
  const seen = new Set();
  for (const skuId of ['polo1', 'polo2']) {
    const count = Math.max(0, Math.floor(Number(state?.shop?.inventory?.[skuId]?.shelf) || 0));
    for (const slot of slotsFor(skuId).slice(0, count)) {
      const key = `${slot.x.toFixed(4)}:${slot.z.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reserved.push({
        id: `retail:${skuId}:${key}`,
        label: `${skuId} display stack`,
        minX: slot.x - 0.12,
        maxX: slot.x + 0.12,
        minZ: slot.z - 0.1025,
        maxZ: slot.z + 0.1025,
      });
    }
  }
  return reserved;
}

function crossesPartition(rect) {
  const wallHalf = 0.13;
  for (const partition of PARTITIONS) {
    if (partition.axis === 'x') {
      const lo = Math.min(partition.from, partition.to);
      const hi = Math.max(partition.from, partition.to);
      const crosses = rect.maxX > partition.at - wallHalf
        && rect.minX < partition.at + wallHalf
        && rect.maxZ > lo
        && rect.minZ < hi;
      if (!crosses) continue;
      if (partition.opening
        && rect.minZ >= partition.opening.c - partition.opening.w / 2
        && rect.maxZ <= partition.opening.c + partition.opening.w / 2) continue;
      return true;
    } else {
      const lo = Math.min(partition.from, partition.to);
      const hi = Math.max(partition.from, partition.to);
      const crosses = rect.maxZ > partition.at - wallHalf
        && rect.minZ < partition.at + wallHalf
        && rect.maxX > lo
        && rect.minX < hi;
      if (!crosses) continue;
      if (partition.opening
        && rect.minX >= partition.opening.c - partition.opening.w / 2
        && rect.maxX <= partition.opening.c + partition.opening.w / 2) continue;
      return true;
    }
  }
  return false;
}

const staffZone = () => ({
  minX: COUNTER.x - COUNTER.len / 2 - 0.3,
  maxX: COUNTER.x + COUNTER.len / 2 + 0.3,
  minZ: COUNTER.z + COUNTER.depth / 2,
  maxZ: COUNTER.z + COUNTER.depth / 2 + STAFF_CORRIDOR_MIN,
});

function orientedRect(x, z, width, depth, ry = 0) {
  const cosine = Math.abs(Math.cos(ry));
  const sine = Math.abs(Math.sin(ry));
  const halfX = (cosine * width + sine * depth) / 2;
  const halfZ = (sine * width + cosine * depth) / 2;
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

function fixedBlocker(id, label, x, z, width, depth, ry = 0) {
  return { id, label, rect: orientedRect(x, z, width, depth, ry) };
}

function activeRenovationBlockers(state) {
  const blockers = [];
  const reno = state?.shop?.reno;
  for (const [index, pile] of (Array.isArray(reno?.clutter) ? reno.clutter : []).entries()) {
    if (!pile || pile.cleared || !Number.isFinite(pile.x) || !Number.isFinite(pile.z)) continue;
    blockers.push(fixedBlocker(
      `clutter:${index}`,
      'old clutter pile',
      pile.x,
      pile.z,
      0.90,
      0.90,
      // buildClutterPile registers colBoxAt(.9, .9); its decorative rotation
      // does not rotate or enlarge the authoritative player collider.
      0,
    ));
  }

  const placements = new Map(placedPropertyItems(state).map((entry) => [entry.id, entry]));
  for (const entry of Array.isArray(reno?.decor) ? reno.decor : []) {
    const placement = placements.get(entry?.placementId);
    const pose = placement?.pose || DECOR_SPOTS[entry?.skuId]?.[entry?.spot];
    const spec = placeableSpecBySkuId(entry?.skuId);
    if (!pose || pose.mount !== 'floor' || !spec?.placementProfile?.blocksMovement) continue;
    const rect = placeableFootprint(spec, pose);
    if (!rect) continue;
    blockers.push({
      id: `decor:${entry.skuId}:${entry.placementId || entry.spot}`,
      label: `placed ${spec.displayName.toLowerCase()}`,
      rect,
    });
  }
  return blockers;
}

function fixedFloorBlockers(state, options) {
  const office = resolvedOfficeLayout(state);
  const generatedFurnishings = !!state?.shop?.generation;
  const blockers = [
    // Exact baseline collider footprints from the clubhouse builders. These
    // objects are not movable FIXTURES, so placedFixturesReadOnly cannot see
    // them and the placement authority must name them explicitly.
    fixedBlocker(
      'checkout-counter', 'checkout counter',
      COUNTER.x, COUNTER.z, COUNTER.len + 0.30, COUNTER.depth + 0.20, COUNTER.ry,
    ),
    fixedBlocker(
      'recycling-station', 'cardboard recycling station',
      STOCKROOM.bin.x, STOCKROOM.bin.z, 0.78, 0.62, -Math.PI / 2,
    ),
    fixedBlocker(
      'cleaning-corner', 'cleaning equipment',
      STOCKROOM.cleaning.x, STOCKROOM.cleaning.z, 0.70, 0.50,
    ),
    fixedBlocker(
      'lounge-chair-a', 'lounge chair',
      LOUNGE.chairA.x, LOUNGE.chairA.z, 0.95, 0.95,
    ),
    fixedBlocker(
      'lounge-chair-b', 'lounge chair',
      LOUNGE.chairB.x, LOUNGE.chairB.z, 0.95, 0.95,
    ),
    fixedBlocker(
      'lounge-coffee-table', 'lounge coffee table',
      LOUNGE.coffee.x, LOUNGE.coffee.z, 1.10, 1.10,
    ),
    fixedBlocker('lounge-side-table', 'lounge side table', 2.75, -6.05, 0.65, 0.65),
    fixedBlocker('south-wall-display', 'south wall display', -6.60, 6.02, 1.06, 0.50),
    fixedBlocker('partition-display', 'partition display', 5.44, 1.35, 0.50, 1.26),
    fixedBlocker('retail-gondola', 'retail gondola', 0.40, -0.90, 1.30, 0.70),
  ];
  if (!generatedFurnishings) {
    blockers.push(
      fixedBlocker(
        'packing-bench', 'packing bench',
        STOCKROOM.packing.x, STOCKROOM.packing.z, 1.90, 1.05, STOCKROOM.packing.ry,
      ),
      fixedBlocker(
        'office-desk', 'office desk',
        office.desk.x, office.desk.z, 2.00, 1.10, office.desk.ry,
      ),
      fixedBlocker(
        'office-chair', 'office chair',
        office.chair.x, office.chair.z, 0.85, 0.85, office.chair.ry,
      ),
      fixedBlocker(
        'office-filing-cabinet', 'office filing cabinet',
        office.filing.x, office.filing.z, 0.75, 0.60, office.filing.ry,
      ),
    );
  }
  for (const [id, dimensions, fallback] of [
    [STOCKING_CART_EQUIPMENT_ID, [1.00, 0.50], { x: 6.35, y: 0, z: -3.4, ry: 0 }],
    ['delivery_hand_truck', [0.50, 0.45], { x: 6.1, y: 0, z: -5.9, ry: 0.6 }],
  ]) {
    const pose = optionPose(options, id) || fallback;
    blockers.push({
      id,
      label: id === STOCKING_CART_EQUIPMENT_ID ? 'stocking cart' : 'hand truck',
      rect: orientedRect(pose.x, pose.z, dimensions[0], dimensions[1], pose.ry),
    });
  }
  blockers.push(...activeRenovationBlockers(state));
  return blockers;
}

function floorBoxRect(box) {
  return boxPlacementEnvelope(box, {
    x: box.x,
    z: box.z,
    ry: Number.isFinite(box.ry) ? box.ry : 0,
  });
}

function floorRouteIntact(state, candidateRect, selfId, options) {
  // A migrated or newly generated authored layout can contain core furniture
  // that predates this conservative grid proof. Never let such a pre-existing
  // mismatch brick every floor set-down: overlap, wall, partition, clearway,
  // and support checks still apply, while route rejection is enforced whenever
  // the same scene is valid before adding the candidate carton.
  if (candidateRect && !floorRouteIntact(state, null, selfId, options)) return true;
  const fixtures = placedFixturesReadOnly(state);
  const rects = fixtures.map(fixtureRect);
  rects.push(...fixedFloorBlockers(state, options).map((entry) => entry.rect));
  for (const box of boxesOnSurface(state, FLOOR_BOX_SURFACE_ID, { exceptId: selfId })) {
    if (Number.isFinite(box.x) && Number.isFinite(box.z)) rects.push(floorBoxRect(box));
  }
  if (candidateRect) rects.push(candidateRect);

  const solidAt = (x, z) => {
    if (Math.abs(x) > INTERIOR.w / 2 - BODY_RADIUS
      || Math.abs(z) > INTERIOR.d / 2 - BODY_RADIUS) return true;
    for (const partition of PARTITIONS) {
      if (partition.axis === 'x') {
        if (Math.abs(x - partition.at) < BODY_RADIUS + 0.13
          && z >= Math.min(partition.from, partition.to)
          && z <= Math.max(partition.from, partition.to)) {
          if (!partition.opening) return true;
          if (Math.abs(z - partition.opening.c) > partition.opening.w / 2 - BODY_RADIUS) return true;
        }
      } else if (Math.abs(z - partition.at) < BODY_RADIUS + 0.13
        && x >= Math.min(partition.from, partition.to)
        && x <= Math.max(partition.from, partition.to)) {
        if (!partition.opening) return true;
        if (Math.abs(x - partition.opening.c) > partition.opening.w / 2 - BODY_RADIUS) return true;
      }
    }
    const body = {
      minX: x - BODY_RADIUS, maxX: x + BODY_RADIUS,
      minZ: z - BODY_RADIUS, maxZ: z + BODY_RADIUS,
    };
    return rects.some((rect) => rectsOverlap(body, rect));
  };

  const start = {
    x: (DOOR_CLEARWAY.minX + DOOR_CLEARWAY.maxX) / 2,
    z: INTERIOR.d / 2 - 1.0,
  };
  const width = Math.ceil(INTERIOR.w / ROUTE_GRID);
  const height = Math.ceil(INTERIOR.d / ROUTE_GRID);
  const key = (i, j) => j * width + i;
  const toI = (x) => Math.round((x + INTERIOR.w / 2) / ROUTE_GRID);
  const toJ = (z) => Math.round((z + INTERIOR.d / 2) / ROUTE_GRID);
  const atX = (i) => -INTERIOR.w / 2 + i * ROUTE_GRID;
  const atZ = (j) => -INTERIOR.d / 2 + j * ROUTE_GRID;
  const seen = new Uint8Array(width * height);
  const startI = toI(start.x);
  const startJ = toJ(start.z);
  if (startI < 0 || startJ < 0 || startI >= width || startJ >= height
    || solidAt(atX(startI), atZ(startJ))) return false;
  const stack = [[startI, startJ]];
  seen[key(startI, startJ)] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextI = i + di;
      const nextJ = j + dj;
      if (nextI < 0 || nextJ < 0 || nextI >= width || nextJ >= height) continue;
      if (seen[key(nextI, nextJ)] || solidAt(atX(nextI), atZ(nextJ))) continue;
      seen[key(nextI, nextJ)] = 1;
      stack.push([nextI, nextJ]);
    }
  }
  const reached = (point, searchRadius = 2) => {
    const i = toI(point.x);
    const j = toJ(point.z);
    for (let di = -searchRadius; di <= searchRadius; di += 1) {
      for (let dj = -searchRadius; dj <= searchRadius; dj += 1) {
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < width && b < height && seen[key(a, b)]) return true;
      }
    }
    return false;
  };
  for (const [target, searchRadius] of [
    [queueSlot(0), 2],
    [COUNTER.staffStand, 2],
    // The saved chair coordinate is its physical centre. Reachability means a
    // person can stand beside it, not inside its newly-authoritative footprint.
    [resolvedOfficeLayout(state).chair, 4],
    // receivingInside is explicitly the authored set-down stack coordinate;
    // the route must reach a lifting stance beside its carton, not its centre.
    [STOCKROOM.receivingInside, 4],
  ]) {
    if (!reached(target, searchRadius)) return false;
  }
  for (const fixture of fixtures) {
    if (!fixture.skus?.length) continue;
    const rect = fixtureRect(fixture);
    const candidates = [
      { x: (rect.minX + rect.maxX) / 2, z: rect.maxZ + BODY_RADIUS + 0.1 },
      { x: (rect.minX + rect.maxX) / 2, z: rect.minZ - BODY_RADIUS - 0.1 },
      { x: rect.maxX + BODY_RADIUS + 0.1, z: (rect.minZ + rect.maxZ) / 2 },
      { x: rect.minX - BODY_RADIUS - 0.1, z: (rect.minZ + rect.maxZ) / 2 },
    ];
    if (!candidates.some(reached)) return false;
  }
  return true;
}

function normalPlacementTarget(surface, target) {
  return {
    loc: 'world',
    surfaceId: surface.id,
    x: target.x,
    z: target.z,
    ry: target.ry,
  };
}

function worldOverlap(state, box, candidateEnvelope, options) {
  for (const other of deliveryBoxes(state)) {
    if (!other || other.id === box?.id || other.loc !== 'world') continue;
    const resolved = resolveBoxPose(state, other, options);
    if (!resolved.ok) continue;
    if (volumesOverlap(candidateEnvelope, resolved.envelope)) {
      return { box: other, envelope: resolved.envelope, surfaceId: resolved.surfaceId };
    }
  }
  return null;
}

function previewEquipmentPlacement(state, box, target, options) {
  const equipmentId = normalizeDeliveryEquipmentId(target.equipmentId) || target.equipmentId;
  const fit = deliveryEquipmentFit(box, equipmentId, target.socketId);
  if (!fit.ok) return { ...fit, reasons: [fit.reason] };
  const surfaceId = deliveryEquipmentSurfaceId(equipmentId, target.socketId);
  const surface = surfaceById(state, surfaceId, options);
  if (!surface) {
    return fail(BOX_PLACEMENT_CODES.UNKNOWN_SURFACE, 'That equipment socket is not registered.');
  }
  if (!surface.available || !surface.capabilities.placeBox) {
    return fail(
      BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
      surface.unavailableReason || 'That equipment socket is unavailable.',
      { surfaceId, surface },
    );
  }
  const relativeYaw = equipmentQuarterTurn(box, surface);
  const localEnvelope = boxPlacementEnvelope(box, {
    x: 0,
    z: 0,
    ry: relativeYaw,
    baseY: 0,
  });
  if (!containsEnvelope(surface.bounds, localEnvelope)) {
    return fail(
      BOX_PLACEMENT_CODES.OVERSIZE_FOOTPRINT,
      `The visible packaging would hang beyond ${surface.label.toLowerCase()}.`,
      { surfaceId, surface, envelope: localEnvelope },
    );
  }
  if (localEnvelope.dimensions.h > surface.maxHeight + EPSILON) {
    return fail(
      BOX_PLACEMENT_CODES.TOO_TALL,
      `The visible packaging needs ${localEnvelope.dimensions.h.toFixed(3)} m of clearance; ${surface.label.toLowerCase()} allows ${surface.maxHeight.toFixed(3)} m.`,
      { surfaceId, surface, dimensions: localEnvelope.dimensions },
    );
  }
  const occupied = boxesOnSurface(state, surfaceId, { exceptId: box?.id });
  if (occupied.length) {
    const equipmentName = equipmentId === HAND_TRUCK_EQUIPMENT_ID
      ? 'hand truck' : 'stocking cart';
    return fail(
      BOX_PLACEMENT_CODES.SOCKET_OCCUPIED,
      `${target.socketId} on the ${equipmentName} is already occupied by another delivery box.`,
      {
        surfaceId,
        surface,
        occupiedByBoxId: occupied[0].id,
        conflictingSocketId: target.socketId,
      },
    );
  }
  for (const other of deliveryBoxes(state)) {
    if (!other || other.id === box?.id || other.loc !== 'equipment') continue;
    if ((normalizeDeliveryEquipmentId(other.equipmentId) || other.equipmentId) !== equipmentId) continue;
    if (!deliveryEquipmentSocketsConflict(equipmentId, target.socketId, other.socketId)) continue;
    return fail(
      BOX_PLACEMENT_CODES.SOCKET_CONFLICT,
      `${target.socketId} overlaps the occupied ${other.socketId} top-shelf position.`,
      {
        surfaceId,
        surface,
        occupiedByBoxId: other.id,
        conflictingSocketId: other.socketId,
      },
    );
  }
  const pose = {
    x: surface.worldPose.x,
    z: surface.worldPose.z,
    ry: surface.worldPose.ry + relativeYaw,
    baseY: surface.worldPose.y,
    localX: 0,
    localZ: 0,
    localRy: relativeYaw,
  };
  return poseResult(box, surface, pose, {
    loc: 'equipment',
    equipmentId,
    socketId: target.socketId,
  }, { equipmentFit: fit });
}

function previewPalletPlacement(state, box, target, options) {
  if (!Number.isInteger(target.palletIndex)
    || target.palletIndex < 0
    || target.palletIndex >= DELIVERY_PALLET_STAGING.count) {
    return fail(BOX_PLACEMENT_CODES.UNKNOWN_PALLET, 'That receiving pallet does not exist.');
  }
  const surfaceId = deliveryPalletSurfaceId(target.palletIndex);
  const surface = surfaceById(state, surfaceId, options);
  if (!surface || !surface.available) {
    return fail(BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE, 'That receiving pallet is unavailable.');
  }
  if (!deliveryBoxFitsPallet(box?.box)) {
    return fail(
      BOX_PLACEMENT_CODES.OUTSIDE_SUPPORT,
      'That carton is too long or wide for the receiving pallet.',
      { surfaceId, surface },
    );
  }
  const occupied = boxesOnSurface(state, surfaceId, { exceptId: box?.id });
  if (occupied.length >= surface.capacity) {
    return fail(
      BOX_PLACEMENT_CODES.SURFACE_FULL,
      `Receiving pallet ${target.palletIndex + 1} already has its safe two-box load.`,
      { surfaceId, surface, occupiedByBoxIds: occupied.map((entry) => entry.id) },
    );
  }
  if (occupied.length && (
    boxPlacementEnvelopePhase(box) !== 'sealed'
    || occupied.some((entry) => boxPlacementEnvelopePhase(entry) !== 'sealed')
  )) {
    return fail(
      BOX_PLACEMENT_CODES.UNSUPPORTED_STACK,
      'Opened or flattened packaging cannot form a safe pallet stack.',
      { surfaceId, surface, occupiedByBoxIds: occupied.map((entry) => entry.id) },
    );
  }

  const previewId = box?.id ?? '__box_placement_preview__';
  const staging = deliveryBoxes(state)
    .filter((entry) => entry?.loc === 'pad' && entry.id !== box?.id)
    .map((entry) => ({ ...entry }));
  staging.push({ ...box, id: previewId, loc: 'pad', padPalletIndex: target.palletIndex });
  const plan = planPalletizedPadBoxes(staging).find((entry) => entry.boxId === previewId);
  if (!plan || plan.palletIndex !== target.palletIndex || !plan.footprintSupported) {
    return fail(
      BOX_PLACEMENT_CODES.UNSUPPORTED_STACK,
      occupied.length
        ? 'That carton cannot form a stable sealed stack on this pallet.'
        : 'That carton cannot be supported safely by this pallet.',
      { surfaceId, surface, occupiedByBoxIds: occupied.map((entry) => entry.id) },
    );
  }
  const localYaw = plan.ry - surface.worldPose.ry;
  const localEnvelope = boxPlacementEnvelope(box, {
    x: 0, z: 0, ry: localYaw, baseY: 0,
  });
  if (!containsEnvelope(surface.bounds, localEnvelope)) {
    return fail(
      BOX_PLACEMENT_CODES.OUTSIDE_SUPPORT,
      'The visible packaging would hang beyond the receiving pallet.',
      { surfaceId, surface, envelope: localEnvelope },
    );
  }
  if (plan.baseY + localEnvelope.dimensions.h
    > DELIVERY_PALLET_STAGING.maxStackTop + EPSILON) {
    return fail(
      BOX_PLACEMENT_CODES.TOO_TALL,
      'That stack would exceed the receiving pallet height limit.',
      { surfaceId, surface },
    );
  }
  return poseResult(box, surface, {
    x: plan.x,
    z: plan.z,
    ry: plan.ry,
    baseY: plan.baseY,
    localX: 0,
    localZ: 0,
    localRy: plan.ry - surface.worldPose.ry,
  }, {
    loc: 'pad',
    padPalletIndex: target.palletIndex,
  }, { palletPlan: plan });
}

function previewOrdinarySurface(state, box, target, options) {
  const surface = surfaceById(state, target.surfaceId, options);
  if (!surface) {
    return fail(
      BOX_PLACEMENT_CODES.UNKNOWN_SURFACE,
      `The box surface "${String(target.surfaceId)}" is not registered.`,
      { surfaceId: target.surfaceId },
    );
  }
  if (!surface.available) {
    return fail(
      BOX_PLACEMENT_CODES.SURFACE_UNAVAILABLE,
      surface.unavailableReason || 'That surface is unavailable.',
      { surfaceId: surface.id, surface },
    );
  }
  if (!surface.capabilities.placeBox) {
    return fail(
      BOX_PLACEMENT_CODES.SURFACE_NOT_PLACEABLE,
      'That surface is registered for a future interaction but cannot hold a box yet.',
      { surfaceId: surface.id, surface },
    );
  }
  if (!Number.isFinite(target.x) || !Number.isFinite(target.z) || !Number.isFinite(target.ry)) {
    return fail(
      BOX_PLACEMENT_CODES.INVALID_POSITION,
      'Box placement needs finite x, z, and rotation values.',
      { surfaceId: surface.id, surface },
    );
  }
  const localEnvelope = boxPlacementEnvelope(box, {
    x: target.x, z: target.z, ry: target.ry, baseY: 0,
  });
  if (!containsEnvelope(surface.bounds, localEnvelope)) {
    const floor = surface.id === FLOOR_BOX_SURFACE_ID;
    return fail(
      floor ? BOX_PLACEMENT_CODES.WALL : BOX_PLACEMENT_CODES.OUTSIDE_SUPPORT,
      floor
        ? 'That carton would go through the clubhouse wall.'
        : `The carton would hang beyond the ${surface.label.toLowerCase()}.`,
      { surfaceId: surface.id, surface, envelope: localEnvelope },
    );
  }
  if (localEnvelope.dimensions.h > surface.maxHeight + EPSILON) {
    return fail(
      BOX_PLACEMENT_CODES.TOO_TALL,
      `That carton needs ${localEnvelope.dimensions.h.toFixed(3)} m of height; ${surface.label.toLowerCase()} allows ${surface.maxHeight.toFixed(3)} m.`,
      { surfaceId: surface.id, surface, dimensions: localEnvelope.dimensions },
    );
  }
  const occupied = boxesOnSurface(state, surface.id, { exceptId: box?.id });
  if (Number.isFinite(surface.capacity) && occupied.length >= surface.capacity) {
    return fail(
      BOX_PLACEMENT_CODES.SURFACE_FULL,
      `${surface.label} already has its safe box load.`,
      { surfaceId: surface.id, surface, occupiedByBoxIds: occupied.map((entry) => entry.id) },
    );
  }
  const reserved = reservedRectsForSurface(state, surface, options)
    .find((rect) => rectsOverlap(localEnvelope, rect));
  if (reserved) {
    return fail(
      BOX_PLACEMENT_CODES.RESERVED_SPACE,
      `That spot is reserved for the ${reserved.label}.`,
      { surfaceId: surface.id, surface, reserved, envelope: localEnvelope },
    );
  }

  if (surface.id === FLOOR_BOX_SURFACE_ID) {
    if (crossesPartition(localEnvelope)) {
      return fail(
        BOX_PLACEMENT_CODES.WALL,
        'That carton would cross a service-wing wall.',
        { surfaceId: surface.id, surface, envelope: localEnvelope },
      );
    }
    for (const fixture of placedFixturesReadOnly(state)) {
      if (!rectsOverlap(localEnvelope, fixtureRect(fixture))) continue;
      return fail(
        BOX_PLACEMENT_CODES.FIXTURE_OVERLAP,
        `That spot is occupied by the ${fixture.title || fixture.kind}.`,
        { surfaceId: surface.id, surface, fixtureId: fixture.id, envelope: localEnvelope },
      );
    }
    if (rectsOverlap(localEnvelope, DOOR_CLEARWAY)) {
      return fail(
        BOX_PLACEMENT_CODES.DOORWAY_BLOCKED,
        'That carton would block the shop doorway.',
        { surfaceId: surface.id, surface, doorway: 'main', envelope: localEnvelope },
      );
    }
    if (rectsOverlap(localEnvelope, BACKDOOR_CLEARWAY)) {
      return fail(
        BOX_PLACEMENT_CODES.DOORWAY_BLOCKED,
        'That carton would block the receiving doorway.',
        { surfaceId: surface.id, surface, doorway: 'receiving', envelope: localEnvelope },
      );
    }
    for (const blocker of fixedFloorBlockers(state, options)) {
      if (!rectsOverlap(localEnvelope, blocker.rect)) continue;
      return fail(
        BOX_PLACEMENT_CODES.FIXTURE_OVERLAP,
        `That spot is occupied by the ${blocker.label}.`,
        { surfaceId: surface.id, surface, blockerId: blocker.id, envelope: localEnvelope },
      );
    }
    if (rectsOverlap(localEnvelope, staffZone())) {
      return fail(
        BOX_PLACEMENT_CODES.STAFF_WORKSPACE,
        'That carton would block the checkout staff workspace.',
        { surfaceId: surface.id, surface, envelope: localEnvelope },
      );
    }
  }

  const resolved = resolveSurfacePose(state, target, options);
  if (!resolved.ok) return resolved;
  const worldEnvelope = boxPlacementEnvelope(box, {
    x: resolved.pose.x,
    z: resolved.pose.z,
    ry: resolved.pose.ry,
    baseY: resolved.pose.baseY,
  });
  const overlap = worldOverlap(state, box, worldEnvelope, options);
  if (overlap) {
    return fail(
      BOX_PLACEMENT_CODES.BOX_OVERLAP,
      'That carton would overlap another delivery box.',
      {
        surfaceId: surface.id,
        surface,
        occupiedByBoxId: overlap.box.id,
        occupiedSurfaceId: overlap.surfaceId,
        envelope: worldEnvelope,
      },
    );
  }
  if (surface.id === FLOOR_BOX_SURFACE_ID
    && !floorRouteIntact(state, localEnvelope, box?.id, options)) {
    return fail(
      BOX_PLACEMENT_CODES.ROUTE_BLOCKED,
      'That carton would cut off a required customer or receiving route.',
      { surfaceId: surface.id, surface, envelope: localEnvelope },
    );
  }
  return poseResult(
    box,
    surface,
    resolved.pose,
    normalPlacementTarget(surface, target),
    { localEnvelope },
  );
}

export function previewBoxPlacement(state, boxOrId, requestedTarget, options = {}) {
  const box = boxOrId && typeof boxOrId === 'object'
    ? boxOrId
    : deliveryBoxes(state).find((entry) => entry?.id === boxOrId);
  if (!box) {
    return fail(BOX_PLACEMENT_CODES.UNKNOWN_BOX, 'That delivery box does not exist.');
  }
  const target = normalizeTarget(requestedTarget);
  if (!target) {
    return fail(BOX_PLACEMENT_CODES.INVALID_TARGET, 'No valid box-placement target was supplied.');
  }
  if (target.kind === 'equipment') return previewEquipmentPlacement(state, box, target, options);
  if (target.kind === 'pallet') return previewPalletPlacement(state, box, target, options);
  if (target.kind !== 'surface') {
    return fail(BOX_PLACEMENT_CODES.INVALID_TARGET, 'That target is not a placeable surface.');
  }
  const template = boxPlacementSurfaceTemplate(target.surfaceId);
  if (template?.kind === 'equipment-socket') {
    return previewEquipmentPlacement(state, box, {
      kind: 'equipment', equipmentId: template.equipmentId, socketId: template.socketId,
    }, options);
  }
  if (template?.kind === 'pallet') {
    return previewPalletPlacement(state, box, {
      kind: 'pallet', palletIndex: template.palletIndex,
    }, options);
  }
  return previewOrdinarySurface(state, box, target, options);
}

export function validateBoxPlacement(state, box, target, options = {}) {
  return previewBoxPlacement(state, box, target, options);
}

export function boxPlacementCapabilities(state, box, options = {}) {
  const target = boxPlacementTargetFor(box);
  if (!target) return { surfaceId: null, placeBox: false, pickUpBox: false, canUnpack: false };
  if (target.kind === 'stock') {
    return { surfaceId: null, placeBox: false, pickUpBox: true, canUnpack: true };
  }
  if (target.kind === 'carried') {
    return { surfaceId: null, placeBox: true, pickUpBox: false, canUnpack: false };
  }
  const surfaceId = surfaceIdForTarget(target);
  const surface = surfaceById(state, surfaceId, options);
  if (!surface) return { surfaceId, placeBox: false, pickUpBox: false, canUnpack: false };
  let canUnpack = !!surface.capabilities.canUnpack;
  if (surface.unpackPolicy === 'stockroom-bounds' && target.kind === 'surface') {
    const pose = resolveSurfacePose(state, target, options);
    canUnpack = !!pose.ok
      && pose.pose.x >= STOCKROOM.bounds.minX
      && pose.pose.x <= STOCKROOM.bounds.maxX
      && pose.pose.z >= STOCKROOM.bounds.minZ
      && pose.pose.z <= STOCKROOM.bounds.maxZ;
  }
  return {
    surfaceId,
    placeBox: !!surface.capabilities.placeBox && surface.available,
    pickUpBox: !!surface.capabilities.pickUpBox,
    canUnpack,
  };
}
