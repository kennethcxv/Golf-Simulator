// Ref 41 delivery-van cargo planning.
//
// This module is deliberately independent of Three.js and the clubhouse renderer. A paid
// delivery's persisted `boxes[]` collection is the only inventory authority; this planner only
// assigns those identities to repeatable presentation poses. Nothing is sliced away when one van
// load is full: physically incompatible overflow becomes the next numbered trip.

import { BOX_KINDS, boxDims } from './boxes.js';

const EPSILON = 1e-7;
const HALF_SQRT = Math.SQRT1_2;

export const DELIVERY_VAN_CARGO_MARGIN_M = 0.020;
export const DELIVERY_VAN_CARGO_GAP_M = 0.020;
export const DELIVERY_VAN_MAX_BOXES_PER_LOAD = 9;
export const DELIVERY_VAN_MIN_SUPPORT_RATIO = 0.85;

// The shell values come from build_delivery_van.py: the front face of CARGO_BULKHEAD,
// rear face of the usable floor before CARGO_REAR_THRESHOLD, the 1.50 m inner-roof width,
// CARGO_FLOOR's nominal 0.50 m load surface, and CARGO_INNER_ROOF's lower face at 2.1875 m.
// The usable volume is inset by a real 20 mm on all six faces.
export const DELIVERY_VAN_CARGO_VOLUME = Object.freeze({
  coordinateFrame: 'delivery_van_local_runtime_x_longitudinal_y_up_z_lateral',
  physical: Object.freeze({
    min: Object.freeze({ x: -0.3575, y: 0.5000, z: -0.7500 }),
    max: Object.freeze({ x: 2.4975, y: 2.1875, z: 0.7500 }),
  }),
  usable: Object.freeze({
    min: Object.freeze({ x: -0.3375, y: 0.5200, z: -0.7300 }),
    max: Object.freeze({ x: 2.4775, y: 2.1675, z: 0.7300 }),
  }),
  margin: DELIVERY_VAN_CARGO_MARGIN_M,
});

export const DELIVERY_VAN_CARGO_MASS_RANK = Object.freeze({
  light: 1,
  medium: 2,
  heavy: 3,
  freight: 4,
});

function rounded(value) {
  return Math.round(value * 1e6) / 1e6;
}

function vector(x, y, z) {
  return { x: rounded(x), y: rounded(y), z: rounded(z) };
}

function quaternion(x, y, z, w) {
  return { x, y, z, w };
}

const IDENTITY_QUATERNION = Object.freeze(quaternion(0, 0, 0, 1));
const YAW_QUARTER_QUATERNION = Object.freeze(quaternion(0, HALF_SQRT, 0, HALF_SQRT));
const BAG_SIDE_QUATERNION = Object.freeze(quaternion(0, 0, -HALF_SQRT, HALF_SQRT));
const BAG_SIDE_CROSSWISE_QUATERNION = Object.freeze(quaternion(-0.5, 0.5, -0.5, 0.5));
const CRATE_SIDE_QUATERNION = Object.freeze(quaternion(HALF_SQRT, 0, 0, HALF_SQRT));
const CRATE_SIDE_CROSSWISE_QUATERNION = Object.freeze(quaternion(0.5, 0.5, -0.5, 0.5));

function euler(x, y, z) {
  return Object.freeze({ x, y, z, order: 'YXZ' });
}

const ORIENTATION_FAMILIES = Object.freeze({
  standard: Object.freeze([
    Object.freeze({
      id: 'upright-longitudinal', profile: 'upright', axisOrder: 'x-y-z',
      euler: euler(0, 0, 0), quaternion: IDENTITY_QUATERNION,
    }),
    Object.freeze({
      id: 'upright-crosswise', profile: 'upright', axisOrder: 'z-y-x',
      euler: euler(0, Math.PI / 2, 0), quaternion: YAW_QUARTER_QUATERNION,
    }),
  ]),
  long: Object.freeze([
    Object.freeze({
      id: 'longitudinal-low', profile: 'longitudinal-low', axisOrder: 'x-y-z',
      euler: euler(0, 0, 0), quaternion: IDENTITY_QUATERNION,
    }),
    Object.freeze({
      id: 'crosswise-low', profile: 'longitudinal-low', axisOrder: 'z-y-x',
      euler: euler(0, Math.PI / 2, 0), quaternion: YAW_QUARTER_QUATERNION,
    }),
  ]),
  bag: Object.freeze([
    Object.freeze({
      id: 'side-rest-longitudinal', profile: 'side-rest-longitudinal', axisOrder: 'y-x-z',
      euler: euler(0, 0, -Math.PI / 2), quaternion: BAG_SIDE_QUATERNION,
    }),
    Object.freeze({
      id: 'side-rest-crosswise', profile: 'side-rest-longitudinal', axisOrder: 'z-x-y',
      euler: euler(0, Math.PI / 2, -Math.PI / 2),
      quaternion: BAG_SIDE_CROSSWISE_QUATERNION,
    }),
  ]),
  crate: Object.freeze([
    Object.freeze({
      id: 'broad-side-rest-longitudinal', profile: 'broad-side-rest', axisOrder: 'x-z-y',
      euler: euler(Math.PI / 2, 0, 0), quaternion: CRATE_SIDE_QUATERNION,
    }),
    Object.freeze({
      id: 'broad-side-rest-crosswise', profile: 'broad-side-rest', axisOrder: 'y-z-x',
      euler: euler(Math.PI / 2, Math.PI / 2, 0),
      quaternion: CRATE_SIDE_CROSSWISE_QUATERNION,
    }),
  ]),
});

function resolveKindId(kind) {
  const id = typeof kind === 'string' ? kind : kind?.id;
  if (!id || !BOX_KINDS[id]) {
    throw new RangeError(`Unknown delivery box kind: ${String(id ?? kind)}`);
  }
  return id;
}

function orientationFamilyFor(kindId) {
  if (kindId === 'clubbox') return ORIENTATION_FAMILIES.long;
  if (kindId === 'bagcarton') return ORIENTATION_FAMILIES.bag;
  if (kindId === 'crate') return ORIENTATION_FAMILIES.crate;
  return ORIENTATION_FAMILIES.standard;
}

function orientedDimensions(dimensions, axisOrder) {
  const source = { x: dimensions.w, y: dimensions.h, z: dimensions.d };
  return vector(source[axisOrder[0]], source[axisOrder[2]], source[axisOrder[4]]);
}

// Returns the only shipping-safe quarter-turn rests used in Ref 41. Tall bag cartons rest on
// their long side and furniture crates on their broad side; no arbitrary end-standing rotation
// is introduced merely to make an impossible load appear to fit.
export function deliveryVanCargoOrientations(kind) {
  const kindId = resolveKindId(kind);
  const dimensions = boxDims(kindId);
  return orientationFamilyFor(kindId).map((orientation, preference) => Object.freeze({
    id: orientation.id,
    profile: orientation.profile,
    preference,
    euler: orientation.euler,
    quaternion: orientation.quaternion,
    orientedDimensions: Object.freeze(orientedDimensions(dimensions, orientation.axisOrder)),
  }));
}

function canonicalIdentity(id) {
  if (typeof id === 'number' && Number.isFinite(id)) return `number:${id}`;
  if (typeof id === 'string') return `string:${id}`;
  throw new TypeError('Every delivery box needs a finite number or string id.');
}

function compareIdentity(a, b) {
  if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id;
  const ak = a.identityKey;
  const bk = b.identityKey;
  return ak < bk ? -1 : ak > bk ? 1 : 0;
}

function compareLoadPriority(a, b) {
  if (a.massRank !== b.massRank) return b.massRank - a.massRank;
  if (Math.abs(a.volume - b.volume) > EPSILON) return b.volume - a.volume;
  if (Math.abs(a.preferredFootprint - b.preferredFootprint) > EPSILON) {
    return b.preferredFootprint - a.preferredFootprint;
  }
  if (a.fragile !== b.fragile) return a.fragile ? 1 : -1;
  return compareIdentity(a, b);
}

function normalizeBoxes(boxes) {
  if (!Array.isArray(boxes)) throw new TypeError('Delivery van cargo input must be an array.');
  const identities = new Set();
  const normalized = boxes.map((box) => {
    if (!box || typeof box !== 'object') throw new TypeError('Every cargo entry must be a box.');
    const identityKey = canonicalIdentity(box.id);
    if (identities.has(identityKey)) throw new RangeError(`Duplicate delivery box id: ${box.id}`);
    identities.add(identityKey);
    const kindId = resolveKindId(box.box ?? box.kind);
    const kind = BOX_KINDS[kindId];
    const dimensions = boxDims(kindId);
    const volume = rounded(dimensions.w * dimensions.h * dimensions.d);
    const orientations = deliveryVanCargoOrientations(kindId);
    const preferred = orientations[0].orientedDimensions;
    return {
      id: box.id,
      identityKey,
      kindId,
      fragile: box.fragile === true,
      massClass: kind.mass,
      massRank: DELIVERY_VAN_CARGO_MASS_RANK[kind.mass] ?? 0,
      volume,
      preferredFootprint: rounded(preferred.x * preferred.z),
      orientations,
    };
  });
  return normalized.sort(compareLoadPriority);
}

function boundsAt(start, dimensions) {
  const min = vector(start.x, start.y, start.z);
  const max = vector(start.x + dimensions.x, start.y + dimensions.y, start.z + dimensions.z);
  return { min, max };
}

function placementBounds(value) {
  return value?.bounds ?? value;
}

export function deliveryVanCargoBoxesOverlap(first, second) {
  const a = placementBounds(first);
  const b = placementBounds(second);
  if (!a?.min || !a?.max || !b?.min || !b?.max) {
    throw new TypeError('Cargo overlap checks require two placements or bounds.');
  }
  return a.min.x < b.max.x - EPSILON && a.max.x > b.min.x + EPSILON
    && a.min.y < b.max.y - EPSILON && a.max.y > b.min.y + EPSILON
    && a.min.z < b.max.z - EPSILON && a.max.z > b.min.z + EPSILON;
}

function separatedWithGap(first, second, gap) {
  const a = placementBounds(first);
  const b = placementBounds(second);
  return a.max.x + gap <= b.min.x + EPSILON || b.max.x + gap <= a.min.x + EPSILON
    || a.max.y + gap <= b.min.y + EPSILON || b.max.y + gap <= a.min.y + EPSILON
    || a.max.z + gap <= b.min.z + EPSILON || b.max.z + gap <= a.min.z + EPSILON;
}

function withinUsableBounds(bounds, usable) {
  return bounds.min.x >= usable.min.x - EPSILON && bounds.max.x <= usable.max.x + EPSILON
    && bounds.min.y >= usable.min.y - EPSILON && bounds.max.y <= usable.max.y + EPSILON
    && bounds.min.z >= usable.min.z - EPSILON && bounds.max.z <= usable.max.z + EPSILON;
}

function footprintIntersection(first, second) {
  const a = placementBounds(first);
  const b = placementBounds(second);
  const x = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const z = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
  return rounded(x * z);
}

function supportForFloor() {
  return {
    type: 'floor',
    boxId: null,
    overlapArea: null,
    footprintRatio: 1,
    requiredFootprintRatio: DELIVERY_VAN_MIN_SUPPORT_RATIO,
    massCompatible: true,
    sizeCompatible: true,
    nonFragile: true,
    valid: true,
  };
}

function supportForBox(item, bounds, lower) {
  const overlapArea = footprintIntersection(bounds, lower.bounds);
  const upperArea = rounded((bounds.max.x - bounds.min.x) * (bounds.max.z - bounds.min.z));
  const lowerArea = rounded(
    (lower.bounds.max.x - lower.bounds.min.x) * (lower.bounds.max.z - lower.bounds.min.z),
  );
  const footprintRatio = upperArea > 0 ? rounded(overlapArea / upperArea) : 0;
  const massCompatible = lower.massRank >= item.massRank;
  const sizeCompatible = lower.volume + EPSILON >= item.volume
    && lowerArea + EPSILON >= upperArea * DELIVERY_VAN_MIN_SUPPORT_RATIO;
  const nonFragile = !lower.fragile;
  return {
    type: 'box',
    boxId: lower.boxId,
    overlapArea,
    footprintRatio,
    requiredFootprintRatio: DELIVERY_VAN_MIN_SUPPORT_RATIO,
    massCompatible,
    sizeCompatible,
    nonFragile,
    valid: massCompatible && sizeCompatible && nonFragile
      && footprintRatio + EPSILON >= DELIVERY_VAN_MIN_SUPPORT_RATIO,
  };
}

function candidateFits(bounds, placed, usable, gap) {
  return withinUsableBounds(bounds, usable)
    && placed.every((existing) => separatedWithGap(bounds, existing.bounds, gap));
}

function axisStarts(placed, axis, size, usable, gap) {
  const values = new Set();
  const add = (value) => {
    const n = rounded(value);
    if (n >= usable.min[axis] - EPSILON && n + size <= usable.max[axis] + EPSILON) values.add(n);
  };
  add(usable.min[axis]);
  add(usable.max[axis] - size);
  for (const placement of placed) {
    add(placement.bounds.max[axis] + gap);
    add(placement.bounds.min[axis] - gap - size);
  }
  return [...values].sort((a, b) => a - b);
}

function floorCandidates(item, orientation, placed, usable, gap) {
  const dimensions = orientation.orientedDimensions;
  const xs = axisStarts(placed, 'x', dimensions.x, usable, gap);
  const zs = axisStarts(placed, 'z', dimensions.z, usable, gap);
  const candidates = [];
  for (const z of zs) {
    for (const x of xs) {
      const bounds = boundsAt({ x, y: usable.min.y, z }, dimensions);
      if (!candidateFits(bounds, placed, usable, gap)) continue;
      candidates.push({
        item,
        orientation,
        start: bounds.min,
        bounds,
        support: supportForFloor(),
      });
    }
  }
  return candidates;
}

function stackedCandidates(item, orientation, placed, usable, gap) {
  const dimensions = orientation.orientedDimensions;
  const candidates = [];
  for (const lower of placed) {
    if (lower.fragile || lower.massRank < item.massRank || lower.volume + EPSILON < item.volume) {
      continue;
    }
    const lowerCenterX = (lower.bounds.min.x + lower.bounds.max.x) / 2;
    const lowerCenterZ = (lower.bounds.min.z + lower.bounds.max.z) / 2;
    const x = Math.min(
      usable.max.x - dimensions.x,
      Math.max(usable.min.x, lowerCenterX - dimensions.x / 2),
    );
    const z = Math.min(
      usable.max.z - dimensions.z,
      Math.max(usable.min.z, lowerCenterZ - dimensions.z / 2),
    );
    const bounds = boundsAt({ x, y: lower.bounds.max.y + gap, z }, dimensions);
    if (!candidateFits(bounds, placed, usable, gap)) continue;
    const support = supportForBox(item, bounds, lower);
    if (!support.valid) continue;
    candidates.push({ item, orientation, start: bounds.min, bounds, support });
  }
  return candidates;
}

function compareCandidate(a, b) {
  if (Math.abs(a.start.y - b.start.y) > EPSILON) return a.start.y - b.start.y;
  if (a.orientation.preference !== b.orientation.preference) {
    return a.orientation.preference - b.orientation.preference;
  }
  // Load from the rear aperture toward the bulkhead. Keeping the original
  // side-to-side edge packing preserves full-load density and legal stacking,
  // while even a partial shipment remains directly retrievable at the doors.
  if (Math.abs(a.start.x - b.start.x) > EPSILON) return b.start.x - a.start.x;
  if (Math.abs(a.start.z - b.start.z) > EPSILON) return a.start.z - b.start.z;
  const as = a.support.boxId == null ? '' : canonicalIdentity(a.support.boxId);
  const bs = b.support.boxId == null ? '' : canonicalIdentity(b.support.boxId);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function findPlacement(item, placed, usable, gap, { preferRearCentre = false } = {}) {
  if (preferRearCentre && placed.length === 0) {
    for (const orientation of item.orientations) {
      const dimensions = orientation.orientedDimensions;
      const bounds = boundsAt({
        x: usable.max.x - dimensions.x,
        y: usable.min.y,
        z: (usable.min.z + usable.max.z - dimensions.z) / 2,
      }, dimensions);
      if (candidateFits(bounds, placed, usable, gap)) {
        return {
          item,
          orientation,
          start: bounds.min,
          bounds,
          support: supportForFloor(),
        };
      }
    }
  }
  const candidates = [];
  for (const orientation of item.orientations) {
    candidates.push(...floorCandidates(item, orientation, placed, usable, gap));
    candidates.push(...stackedCandidates(item, orientation, placed, usable, gap));
  }
  candidates.sort(compareCandidate);
  return candidates[0] ?? null;
}

function shellClearance(bounds, physical) {
  const faces = {
    bulkhead: rounded(bounds.min.x - physical.min.x),
    rearThreshold: rounded(physical.max.x - bounds.max.x),
    floor: rounded(bounds.min.y - physical.min.y),
    roof: rounded(physical.max.y - bounds.max.y),
    rightWall: rounded(bounds.min.z - physical.min.z),
    leftWall: rounded(physical.max.z - bounds.max.z),
  };
  const minimum = rounded(Math.min(...Object.values(faces)));
  return {
    faces,
    minimum,
    required: DELIVERY_VAN_CARGO_MARGIN_M,
    withinBounds: minimum + EPSILON >= DELIVERY_VAN_CARGO_MARGIN_M,
    roofSafe: faces.roof + EPSILON >= DELIVERY_VAN_CARGO_MARGIN_M,
  };
}

function createPlacement(candidate, loadId, loadIndex, placementIndex, physical) {
  const { item, orientation, bounds, support } = candidate;
  const dimensions = orientation.orientedDimensions;
  const localPosition = vector(
    bounds.min.x + dimensions.x / 2,
    bounds.min.y + dimensions.y / 2,
    bounds.min.z + dimensions.z / 2,
  );
  const clearance = shellClearance(bounds, physical);
  return {
    boxId: item.id,
    kind: item.kindId,
    fragile: item.fragile,
    massClass: item.massClass,
    massRank: item.massRank,
    volume: item.volume,
    loadId,
    loadIndex,
    loadSequence: loadIndex + 1,
    placementIndex,
    orientationId: orientation.id,
    restProfile: orientation.profile,
    localPosition,
    localEuler: { ...orientation.euler },
    localQuaternion: { ...orientation.quaternion },
    orientedDimensions: { ...dimensions },
    bounds,
    support,
    withinBounds: clearance.withinBounds,
    clearance,
  };
}

function loadDiagnostics(placements) {
  const overlapPairs = [];
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (deliveryVanCargoBoxesOverlap(placements[i], placements[j])) {
        overlapPairs.push([placements[i].boxId, placements[j].boxId]);
      }
    }
  }
  const boundaryViolations = placements.filter((entry) => !entry.withinBounds).map((entry) => entry.boxId);
  const supportViolations = placements.filter((entry) => !entry.support.valid).map((entry) => entry.boxId);
  return {
    boxCount: placements.length,
    allWithinBounds: boundaryViolations.length === 0,
    noPairwiseOverlap: overlapPairs.length === 0,
    supportRulesSatisfied: supportViolations.length === 0,
    minimumShellClearance: placements.length
      ? rounded(Math.min(...placements.map((entry) => entry.clearance.minimum))) : null,
    boundaryViolations,
    overlapPairs,
    supportViolations,
  };
}

function cloneVolume(volume) {
  return {
    coordinateFrame: volume.coordinateFrame,
    physical: { min: { ...volume.physical.min }, max: { ...volume.physical.max } },
    usable: { min: { ...volume.usable.min }, max: { ...volume.usable.max } },
    margin: volume.margin,
  };
}

export function planDeliveryVanCargo(boxes, options = {}) {
  const normalized = normalizeBoxes(boxes);
  const maxBoxesPerLoad = Number.isSafeInteger(options.maxBoxesPerLoad)
    && options.maxBoxesPerLoad > 0
    ? options.maxBoxesPerLoad : DELIVERY_VAN_MAX_BOXES_PER_LOAD;
  const gap = DELIVERY_VAN_CARGO_GAP_M;
  const volume = DELIVERY_VAN_CARGO_VOLUME;
  const unassigned = [...normalized];
  const loads = [];
  const placements = [];

  // A known BOX_KIND must have at least one legal rest within an empty bay. Failing loudly here
  // protects box identity better than returning an apparently successful plan with hidden cargo.
  for (const item of unassigned) {
    if (!findPlacement(item, [], volume.usable, gap)) {
      throw new RangeError(`The ${item.kindId} box cannot fit inside Ref 41 in a legal rest.`);
    }
  }

  while (unassigned.length) {
    const loadIndex = loads.length;
    const loadId = `ref41-load-${String(loadIndex + 1).padStart(2, '0')}`;
    const loadPlacements = [];
    let madeProgress = true;

    while (madeProgress && loadPlacements.length < maxBoxesPerLoad && unassigned.length) {
      madeProgress = false;
      for (let index = 0; index < unassigned.length; index += 1) {
        const item = unassigned[index];
        const candidate = findPlacement(item, loadPlacements, volume.usable, gap, {
          preferRearCentre: loadPlacements.length === 0 && unassigned.length === 1,
        });
        if (!candidate) continue;
        const placement = createPlacement(
          candidate, loadId, loadIndex, loadPlacements.length, volume.physical,
        );
        loadPlacements.push(placement);
        placements.push(placement);
        unassigned.splice(index, 1);
        madeProgress = true;
        break;
      }
    }

    if (!loadPlacements.length) {
      throw new Error(`Ref 41 cargo planning stalled with ${unassigned.length} boxes unassigned.`);
    }
    const diagnostics = loadDiagnostics(loadPlacements);
    loads.push({
      loadId,
      loadIndex,
      loadSequence: loadIndex + 1,
      boxIds: loadPlacements.map((entry) => entry.boxId),
      placements: loadPlacements,
      diagnostics,
    });
  }

  const boundaryViolations = loads.flatMap((load) => load.diagnostics.boundaryViolations);
  const overlapPairs = loads.flatMap((load) => load.diagnostics.overlapPairs.map((pair) => ({
    loadId: load.loadId,
    boxIds: pair,
  })));
  const supportViolations = loads.flatMap((load) => load.diagnostics.supportViolations);

  return {
    version: 1,
    cargoVolume: cloneVolume(volume),
    interBoxGap: gap,
    maxBoxesPerLoad,
    inputCount: boxes.length,
    placedCount: placements.length,
    loadCount: loads.length,
    requiresSequentialLoads: loads.length > 1,
    allBoxIds: placements.map((entry) => entry.boxId),
    loads,
    placements,
    diagnostics: {
      identityCountPreserved: placements.length === boxes.length,
      allWithinBounds: boundaryViolations.length === 0,
      noPairwiseOverlap: overlapPairs.length === 0,
      supportRulesSatisfied: supportViolations.length === 0,
      boundaryViolations,
      overlapPairs,
      supportViolations,
    },
  };
}
