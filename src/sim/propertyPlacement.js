// Pure placement authority for durable property assets.
//
// The renderer asks this module where a selected item snaps and whether that
// exact pose is legal. Commit callers run the same validation again before
// mutating inventory, so a green ghost can never disagree with the save.

import {
  BACKDOOR_CLEARWAY,
  COUNTER,
  DOOR_CLEARWAY,
  INTERIOR,
  PARTITIONS,
  STAFF_CORRIDOR_MIN,
  fixtureRect,
} from '../data/shopLayout.js';
import {
  placeablePlacementProfile,
  placeableSpec,
} from '../data/placeableItems.js';
import { placedPropertyItems } from './propertyInventory.js';
import { placedFixtures, rectsOverlap, routesIntact, GRID } from './layout.js';

const WALL_INSET = 0.02;

const staffZone = () => ({
  minX: COUNTER.x - COUNTER.len / 2 - 0.3,
  maxX: COUNTER.x + COUNTER.len / 2 + 0.3,
  minZ: COUNTER.z + COUNTER.depth / 2,
  maxZ: COUNTER.z + COUNTER.depth / 2 + STAFF_CORRIDOR_MIN,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const snap = (value, step = GRID) => Math.round(value / step) * step;

function localBounds(profile) {
  return {
    minX: (profile.offsetX || 0) - profile.width / 2,
    maxX: (profile.offsetX || 0) + profile.width / 2,
    minZ: (profile.offsetZ || 0) - profile.depth / 2,
    maxZ: (profile.offsetZ || 0) + profile.depth / 2,
  };
}

export function placeableFootprint(idOrSpec, pose) {
  const profile = placeablePlacementProfile(
    typeof idOrSpec === 'object' ? (idOrSpec.assetId || idOrSpec.skuId) : idOrSpec,
  );
  if (!profile || !pose) return null;
  const local = localBounds(profile);
  const angle = Number.isFinite(pose.ry) ? pose.ry : 0;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const corners = [
    [local.minX, local.minZ], [local.minX, local.maxZ],
    [local.maxX, local.minZ], [local.maxX, local.maxZ],
  ].map(([x, z]) => ({
    x: pose.x + x * cosine + z * sine,
    z: pose.z - x * sine + z * cosine,
  }));
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    maxX: Math.max(...corners.map((point) => point.x)),
    minZ: Math.min(...corners.map((point) => point.z)),
    maxZ: Math.max(...corners.map((point) => point.z)),
  };
}

function crossesPartition(rect) {
  const HALF = 0.13;
  for (const partition of PARTITIONS) {
    if (partition.axis === 'x') {
      const lo = Math.min(partition.from, partition.to);
      const hi = Math.max(partition.from, partition.to);
      if (rect.maxX <= partition.at - HALF || rect.minX >= partition.at + HALF
          || rect.maxZ <= lo || rect.minZ >= hi) continue;
      if (partition.opening
          && rect.minZ >= partition.opening.c - partition.opening.w / 2
          && rect.maxZ <= partition.opening.c + partition.opening.w / 2) continue;
      return true;
    }
    const lo = Math.min(partition.from, partition.to);
    const hi = Math.max(partition.from, partition.to);
    if (rect.maxZ <= partition.at - HALF || rect.minZ >= partition.at + HALF
        || rect.maxX <= lo || rect.minX >= hi) continue;
    if (partition.opening
        && rect.minX >= partition.opening.c - partition.opening.w / 2
        && rect.maxX <= partition.opening.c + partition.opening.w / 2) continue;
    return true;
  }
  return false;
}

// Each segment is a continuous usable wall surface. Door and window apertures
// are removed up front, so wall snapping cannot hide a sign in glazing.
const WALL_SEGMENTS = Object.freeze([
  // north wall, split around the lounge window centred at x=3
  { id: 'wall:north:west', axis: 'x', fixed: -INTERIOR.d / 2 + WALL_INSET, min: -INTERIOR.w / 2, max: 1.8, ry: 0 },
  { id: 'wall:north:east', axis: 'x', fixed: -INTERIOR.d / 2 + WALL_INSET, min: 4.2, max: INTERIOR.w / 2, ry: 0 },
  // south wall: two windows and the main entrance are excluded
  { id: 'wall:south:west', axis: 'x', fixed: INTERIOR.d / 2 - WALL_INSET, min: -INTERIOR.w / 2, max: -9.5, ry: Math.PI },
  { id: 'wall:south:midwest', axis: 'x', fixed: INTERIOR.d / 2 - WALL_INSET, min: -7.1, max: -6.1, ry: Math.PI },
  { id: 'wall:south:mid', axis: 'x', fixed: INTERIOR.d / 2 - WALL_INSET, min: -3.7, max: -1.8, ry: Math.PI },
  { id: 'wall:south:east', axis: 'x', fixed: INTERIOR.d / 2 - WALL_INSET, min: 0.2, max: INTERIOR.w / 2, ry: Math.PI },
  { id: 'wall:west', axis: 'z', fixed: -INTERIOR.w / 2 + WALL_INSET, min: -INTERIOR.d / 2, max: INTERIOR.d / 2, ry: Math.PI / 2 },
  // east wall, split around receiving door and office window
  { id: 'wall:east:north', axis: 'z', fixed: INTERIOR.w / 2 - WALL_INSET, min: -INTERIOR.d / 2, max: -4.35, ry: -Math.PI / 2 },
  { id: 'wall:east:middle', axis: 'z', fixed: INTERIOR.w / 2 - WALL_INSET, min: -2.85, max: 3.4, ry: -Math.PI / 2 },
  { id: 'wall:east:south', axis: 'z', fixed: INTERIOR.w / 2 - WALL_INSET, min: 5.8, max: INTERIOR.d / 2, ry: -Math.PI / 2 },
  // both sides of the service-wing partitions
  { id: 'wall:partition-x:west', axis: 'z', fixed: 5.7 - WALL_INSET, min: -INTERIOR.d / 2, max: 2, ry: -Math.PI / 2 },
  { id: 'wall:partition-x:east', axis: 'z', fixed: 5.7 + WALL_INSET, min: -INTERIOR.d / 2, max: 2, ry: Math.PI / 2 },
  { id: 'wall:partition-z:north-west', axis: 'x', fixed: 2 - WALL_INSET, min: 5.7, max: 8.25, ry: Math.PI },
  { id: 'wall:partition-z:north-east', axis: 'x', fixed: 2 - WALL_INSET, min: 9.55, max: INTERIOR.w / 2, ry: Math.PI },
  { id: 'wall:partition-z:south-west', axis: 'x', fixed: 2 + WALL_INSET, min: 5.7, max: 8.25, ry: 0 },
  { id: 'wall:partition-z:south-east', axis: 'x', fixed: 2 + WALL_INSET, min: 9.55, max: INTERIOR.w / 2, ry: 0 },
]);

function segmentDistance(segment, x, z) {
  if (segment.axis === 'x') {
    return Math.hypot(x - clamp(x, segment.min, segment.max), z - segment.fixed);
  }
  return Math.hypot(x - segment.fixed, z - clamp(z, segment.min, segment.max));
}

export function snapPlaceablePose(idOrSpec, aim, rotation = 0) {
  const spec = typeof idOrSpec === 'object' ? idOrSpec : placeableSpec(idOrSpec);
  const profile = spec?.placementProfile;
  if (!spec || !profile) return null;
  const mount = profile.mount;
  if (mount === 'wall') {
    const segment = [...WALL_SEGMENTS]
      .sort((a, b) => segmentDistance(a, aim.x, aim.z) - segmentDistance(b, aim.x, aim.z))[0];
    const half = profile.width / 2;
    const along = segment.axis === 'x' ? aim.x : aim.z;
    const placedAlong = clamp(snap(along), segment.min + half, segment.max - half);
    return {
      area: 'clubhouse', mount, x: segment.axis === 'x' ? placedAlong : segment.fixed,
      y: 0, z: segment.axis === 'x' ? segment.fixed : placedAlong,
      ry: segment.ry, surfaceId: segment.id, authoredSpot: null,
    };
  }
  return {
    area: 'clubhouse', mount,
    x: snap(aim.x), y: 0, z: snap(aim.z),
    ry: rotation,
    surfaceId: mount === 'ceiling' ? 'clubhouse:ceiling' : 'clubhouse:floor',
    authoredSpot: null,
  };
}

function placementRects(state, exceptPlacementId = null, blockingOnly = false) {
  return placedPropertyItems(state).flatMap((placement) => {
    if (placement.id === exceptPlacementId) return [];
    const spec = placeableSpec(placement.assetId);
    if (!spec || (blockingOnly && !spec.placementProfile?.blocksMovement)) return [];
    const rect = placeableFootprint(spec, placement.pose);
    return rect ? [{ placement, spec, rect }] : [];
  });
}

function wallClearanceRect(rect, pose, depth = 0.55) {
  const inwardX = Math.sin(pose.ry || 0);
  const inwardZ = Math.cos(pose.ry || 0);
  const clearance = { ...rect };
  if (inwardX > 0.5) clearance.maxX += depth;
  else if (inwardX < -0.5) clearance.minX -= depth;
  if (inwardZ > 0.5) clearance.maxZ += depth;
  else if (inwardZ < -0.5) clearance.minZ -= depth;
  return clearance;
}

export function validatePlaceablePlacement(state, idOrSpec, pose, options = {}) {
  const spec = typeof idOrSpec === 'object' ? idOrSpec : placeableSpec(idOrSpec);
  const profile = spec?.placementProfile;
  const reasons = [];
  if (!spec || !profile || !pose) return { ok: false, reasons: ['No such property item.'] };
  if (pose.mount !== profile.mount) reasons.push(`The ${spec.displayName} needs a ${profile.mount} surface.`);
  const rect = placeableFootprint(spec, pose);
  if (!rect) return { ok: false, reasons: ['That item has no placement bounds.'] };

  if (pose.mount === 'wall') {
    const segment = WALL_SEGMENTS.find((entry) => entry.id === pose.surfaceId);
    if (!segment) reasons.push('Aim at a usable wall surface.');
    else {
      const half = profile.width / 2;
      const along = segment.axis === 'x' ? pose.x : pose.z;
      if (along < segment.min + half - 1e-6 || along > segment.max - half + 1e-6) {
        reasons.push('That would hang past the usable wall.');
      }
    }
    const clearance = wallClearanceRect(rect, pose);
    for (const fixture of placedFixtures(state)) {
      if (rectsOverlap(clearance, fixtureRect(fixture))) {
        reasons.push(`The ${fixture.title || fixture.kind} would hide that wall item.`);
        break;
      }
    }
  } else if (rect.minX < -INTERIOR.w / 2 || rect.maxX > INTERIOR.w / 2
      || rect.minZ < -INTERIOR.d / 2 || rect.maxZ > INTERIOR.d / 2) {
    reasons.push('That would go into a wall.');
  } else if (pose.mount === 'floor' && crossesPartition(rect)) {
    reasons.push('That would cross an interior wall.');
  }

  for (const other of placementRects(state, options.exceptPlacementId)) {
    if (other.placement.pose?.mount !== pose.mount || !rectsOverlap(rect, other.rect)) continue;
    if (pose.mount === 'floor'
        && profile.blocksMovement !== other.spec.placementProfile?.blocksMovement) continue;
    reasons.push(`That overlaps the ${other.spec.displayName}.`);
    break;
  }

  if (pose.mount === 'floor' && profile.blocksMovement) {
    for (const fixture of placedFixtures(state)) {
      if (rectsOverlap(rect, fixtureRect(fixture))) {
        reasons.push(`That overlaps the ${fixture.title || fixture.kind}.`);
        break;
      }
    }
    if (rectsOverlap(rect, DOOR_CLEARWAY)) reasons.push('That blocks the shop door.');
    if (rectsOverlap(rect, BACKDOOR_CLEARWAY)) reasons.push('That blocks the receiving door.');
    if (rectsOverlap(rect, staffZone())) reasons.push('You need to be able to stand at the checkout.');
    if (!reasons.length) {
      const obstacles = placementRects(state, options.exceptPlacementId, true).map((entry) => entry.rect);
      obstacles.push(rect);
      if (!routesIntact(state, { extraRects: obstacles })) {
        reasons.push('That would cut the shop off - customers could not get around it.');
      }
    }
  }

  return { ok: reasons.length === 0, reasons, rect, spec };
}

export function placedPlaceableAt(state, x, z, maxDistance = 1.8) {
  let best = null;
  let bestDistance = maxDistance;
  for (const entry of placementRects(state)) {
    const inside = x >= entry.rect.minX && x <= entry.rect.maxX
      && z >= entry.rect.minZ && z <= entry.rect.maxZ;
    const distance = inside ? 0 : Math.hypot(
      Math.max(entry.rect.minX - x, 0, x - entry.rect.maxX),
      Math.max(entry.rect.minZ - z, 0, z - entry.rect.maxZ),
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}
