// THE PLAYER'S CLUBHOUSE LAYOUT.
//
// This is the single authority for floor, wall, counter, shelf and ceiling
// placement. Render code asks it for resolved objects and candidate validity;
// input code commits the exact validated candidate. Existing fixture callers keep
// their original exports, while saves gain a versioned, sparse object record.

import {
  BACKDOOR_CLEARWAY, COUNTER, DOOR_CLEARWAY, FIXTURES, INTERIOR, LOUNGE, OFFICE,
  PARTITIONS, PLAYER_DIAM, SHELL, STAFF_CORRIDOR_MIN, STOCKROOM, fixtureRect, queueSlot,
} from '../data/shopLayout.js';
import { boxDims } from '../data/boxes.js';
import {
  DEFAULT_ROOM_STYLE, DOOR_SWINGS, PLACEABLES, PLACEABLE_BY_ID, PROTECTED_ZONES,
  STATIC_PLACEMENT_SURFACES, STATIC_PLACEMENT_SURFACE_BY_ID, WALL_OPENINGS,
  WALL_SURFACE_BY_ID, placeableById,
} from '../data/placeableCatalog.js';

export const GRID = 0.25;
export const FINE_GRID = 0.05;
export const LAYOUT_VERSION = 2;
export const HISTORY_LIMIT = 40;
const R = PLAYER_DIAM / 2;
const EPS = 1e-5;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const snap = (value, step = GRID) => Math.round(value / step) * step;
const finite = (...values) => values.every(Number.isFinite);
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const rectsOverlap = (a, b, eps = EPS) =>
  a.maxX > b.minX + eps && a.minX < b.maxX - eps
  && a.maxZ > b.minZ + eps && a.minZ < b.maxZ - eps;

const circleRectOverlap = (cx, cz, radius, rect) => {
  const x = Math.max(rect.minX, Math.min(rect.maxX, cx));
  const z = Math.max(rect.minZ, Math.min(rect.maxZ, cz));
  return Math.hypot(cx - x, cz - z) < radius - EPS;
};

function defaultRecord(meta) {
  return {
    assetId: meta.assetId,
    state: meta.defaultState,
    transform: clone(meta.defaultTransform),
    variant: meta.defaultVariant,
    requiredRelationship: meta.requiredObject || null,
  };
}

function fixtureMeta(id) {
  return PLACEABLE_BY_ID[id] || null;
}

function extraMeta(state, id) {
  const extra = state.shop?.layout?.extra?.find((entry) => entry.id === id);
  if (!extra) return null;
  const rect = fixtureRect(extra);
  return {
    id,
    assetId: `legacy-extra:${extra.kind || 'fixture'}`,
    label: extra.title || extra.kind || id,
    placementCategory: 'retail-fixture',
    surfaceRules: { allowed: ['floor'] },
    rotation: { increment: Math.PI / 2, free: false, snapDefault: true },
    bounds: {
      width: rect.maxX - rect.minX, height: 2.2, depth: rect.maxZ - rect.minZ,
      volumes: [{ x: 0, z: 0, width: rect.maxX - rect.minX, depth: rect.maxZ - rect.minZ }],
    },
    collision: { blocksPlayer: true, blocksCustomers: true },
    requiredClearance: 0.04,
    navigationClearance: R,
    doorClearance: 0.16,
    interactionClearance: 0.4,
    sellValue: 0,
    storageBehavior: 'allowed',
    requiredObject: false,
    defaultState: 'placed',
    defaultVariant: 'original',
    defaultTransform: {
      x: extra.x, y: extra.y || 0, z: extra.z, ry: extra.ry || 0,
      surface: 'floor', attachment: null, room: extra.zone || 'sales',
    },
    fixture: extra,
  };
}

export function ensureLayout(state) {
  if (!state.shop) return null;
  if (!state.shop.layout) state.shop.layout = {};
  const layout = state.shop.layout;
  if (!layout.moved) layout.moved = {};
  if (!layout.stored) layout.stored = [];
  if (!layout.extra) layout.extra = [];
  if (!layout.objects) layout.objects = {};
  if (!layout.soldCredits) layout.soldCredits = {};
  if (!layout.history) layout.history = { undo: [], redo: [] };
  if (!Array.isArray(layout.history.undo)) layout.history.undo = [];
  if (!Array.isArray(layout.history.redo)) layout.history.redo = [];
  layout.roomStyle = { ...DEFAULT_ROOM_STYLE, ...(layout.roomStyle || {}) };
  if (!Number.isFinite(layout.revision)) layout.revision = 0;
  layout.version = LAYOUT_VERSION;

  // One-way compatibility bridge for v1 fixture saves. Keep moved/stored in sync
  // for old callers, but make the v2 record authoritative from here on.
  for (const fixture of FIXTURES) {
    if (layout.objects[fixture.id]) continue;
    const moved = layout.moved[fixture.id];
    const stored = layout.stored.includes(fixture.id);
    if (!moved && !stored) continue;
    const meta = fixtureMeta(fixture.id);
    const record = defaultRecord(meta);
    if (moved) record.transform = { ...record.transform, ...clone(moved), surface: 'floor' };
    if (stored) record.state = 'stored';
    layout.objects[fixture.id] = record;
  }
  return layout;
}

function rawRecord(state, id) {
  return ensureLayout(state).objects[id] || null;
}

export function objectRecord(state, id) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return null;
  return clone(rawRecord(state, id) || defaultRecord(meta));
}

function resolvedObject(meta, record) {
  const transform = record.transform || meta.defaultTransform;
  const common = {
    ...meta,
    state: record.state,
    variant: record.variant || meta.defaultVariant,
    requiredRelationship: record.requiredRelationship ?? meta.requiredObject ?? null,
    transform: clone(transform),
    x: transform.x,
    y: transform.y || 0,
    z: transform.z,
    ry: transform.ry || 0,
    surface: transform.surface || 'floor',
    attachment: clone(transform.attachment || null),
    room: transform.room || 'sales',
  };
  return meta.fixture ? { ...meta.fixture, ...common } : common;
}

export function objectById(state, id) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return null;
  return resolvedObject(meta, objectRecord(state, id));
}

export function placedObjects(state) {
  ensureLayout(state);
  const result = [];
  for (const meta of PLACEABLES) {
    const object = resolvedObject(meta, objectRecord(state, meta.id));
    if (object.state === 'placed') result.push(object);
  }
  return result;
}

export function storedObjects(state) {
  ensureLayout(state);
  return PLACEABLES.map((meta) => resolvedObject(meta, objectRecord(state, meta.id)))
    .filter((object) => object.state === 'stored');
}

export function soldObjects(state) {
  ensureLayout(state);
  return PLACEABLES.map((meta) => resolvedObject(meta, objectRecord(state, meta.id)))
    .filter((object) => object.state === 'sold');
}

// Backwards-compatible fixture view used by stock, fixture builders and older QA.
export function placedFixtures(state) {
  const layout = ensureLayout(state);
  const result = [];
  for (const fixture of FIXTURES) {
    const object = objectById(state, fixture.id);
    if (object && object.state === 'placed') result.push(object);
  }
  for (const extra of layout.extra) result.push(extra);
  return result;
}

export const fixtureById = (state, id) => placedFixtures(state).find((fixture) => fixture.id === id);
export const storedFixtures = (state) => storedObjects(state).filter((object) => !!object.fixture).map((object) => object.id);

function rotateOffset(x, z, ry) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return { x: x * c + z * s, z: -x * s + z * c };
}

function volumesFor(meta, transformValue) {
  const transformNow = transformValue.transform || transformValue;
  const volumes = meta.bounds?.volumes?.length
    ? meta.bounds.volumes
    : [{ x: 0, z: 0, width: meta.bounds.width, depth: meta.bounds.depth }];
  return volumes.map((volume) => {
    const offset = rotateOffset(volume.x || 0, volume.z || 0, transformNow.ry || 0);
    return {
      cx: transformNow.x + offset.x,
      cz: transformNow.z + offset.z,
      halfW: volume.width / 2,
      halfD: volume.depth / 2,
      ry: (transformNow.ry || 0) + (volume.ry || 0),
    };
  });
}

function obbOverlap(a, b, eps = EPS) {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const axes = [a.ry, a.ry + Math.PI / 2, b.ry, b.ry + Math.PI / 2];
  for (const angle of axes) {
    const ax = Math.cos(angle);
    const az = Math.sin(angle);
    const distance = Math.abs(dx * ax + dz * az);
    const ar = a.halfW * Math.abs(Math.cos(angle - a.ry)) + a.halfD * Math.abs(Math.sin(angle - a.ry));
    const br = b.halfW * Math.abs(Math.cos(angle - b.ry)) + b.halfD * Math.abs(Math.sin(angle - b.ry));
    if (distance >= ar + br - eps) return false;
  }
  return true;
}

function obbAabb(obb) {
  const c = Math.abs(Math.cos(obb.ry));
  const s = Math.abs(Math.sin(obb.ry));
  const hx = obb.halfW * c + obb.halfD * s;
  const hz = obb.halfW * s + obb.halfD * c;
  return { minX: obb.cx - hx, maxX: obb.cx + hx, minZ: obb.cz - hz, maxZ: obb.cz + hz };
}

export function placementBounds(state, id, transformValue = null) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return null;
  const value = transformValue || objectById(state, id)?.transform || meta.defaultTransform;
  const boxes = volumesFor(meta, value).map(obbAabb);
  return boxes.reduce((result, box) => ({
    minX: Math.min(result.minX, box.minX), maxX: Math.max(result.maxX, box.maxX),
    minZ: Math.min(result.minZ, box.minZ), maxZ: Math.max(result.maxZ, box.maxZ),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function verticalRange(meta, transformNow) {
  const height = meta.bounds?.height || 0;
  if (transformNow.surface === 'wall') return { minY: transformNow.y - height / 2, maxY: transformNow.y + height / 2 };
  if (transformNow.surface === 'ceiling') return { minY: transformNow.y - height, maxY: transformNow.y };
  return { minY: transformNow.y || 0, maxY: (transformNow.y || 0) + height };
}

const rangesOverlap = (a, b) => a.maxY > b.minY + EPS && a.minY < b.maxY - EPS;

const STATIC_OBSTACLES = [
  { id: 'office-desk-legacy', label: 'office desk', x: OFFICE.desk.x, z: OFFICE.desk.z, width: 0.95, depth: 1.9, height: 1.0, ry: 0 },
  { id: 'office-chair-legacy', label: 'office chair', x: OFFICE.chair.x, z: OFFICE.chair.z, width: 0.70, depth: 0.70, height: 1.1, ry: 0 },
  { id: 'lounge-chair-a-legacy', label: 'lounge chair', x: LOUNGE.chairA.x, z: LOUNGE.chairA.z, width: 0.92, depth: 0.92, height: 0.9, ry: LOUNGE.chairA.ry },
  { id: 'lounge-chair-b-legacy', label: 'lounge chair', x: LOUNGE.chairB.x, z: LOUNGE.chairB.z, width: 0.92, depth: 0.92, height: 0.9, ry: LOUNGE.chairB.ry },
  { id: 'lounge-table-legacy', label: 'lounge coffee table', x: LOUNGE.coffee.x, z: LOUNGE.coffee.z, width: 1.05, depth: 0.72, height: 0.48, ry: 0 },
  { id: 'packing-table-legacy', label: 'packing table', x: STOCKROOM.packing.x, z: STOCKROOM.packing.z, width: 1.8, depth: 0.75, height: 0.95, ry: STOCKROOM.packing.ry },
];

function collisionEntries(state, excludeId = null) {
  const entries = [];
  for (const object of placedObjects(state)) {
    if (object.id === excludeId || !object.collision?.blocksPlayer) continue;
    const range = verticalRange(object, object.transform);
    entries.push({
      id: object.id, label: object.label, range,
      volumes: volumesFor(object, object.transform),
    });
  }
  for (const extra of ensureLayout(state).extra) {
    if (extra.id === excludeId) continue;
    const meta = extraMeta(state, extra.id);
    entries.push({
      id: extra.id, label: extra.title || extra.kind || extra.id,
      range: { minY: 0, maxY: meta.bounds.height },
      volumes: volumesFor(meta, meta.defaultTransform),
    });
  }
  for (const obstacle of STATIC_OBSTACLES) {
    entries.push({
      id: obstacle.id, label: obstacle.label,
      range: { minY: 0, maxY: obstacle.height },
      volumes: [{ cx: obstacle.x, cz: obstacle.z, halfW: obstacle.width / 2, halfD: obstacle.depth / 2, ry: obstacle.ry || 0 }],
    });
  }
  // Renovation clutter has a real 0.9 x 0.9 player/customer collider in the
  // clubhouse scene. Placement must see that same obstacle or a sofa can be
  // accepted through the abandoned cartons and loose packing material. Once the
  // player hauls a pile out, `cleared` removes it from both systems immediately.
  for (const [index, pile] of (state.shop?.reno?.clutter || []).entries()) {
    if (pile.cleared) continue;
    entries.push({
      id: `reno-clutter-${index}`,
      label: 'old clutter',
      range: { minY: 0, maxY: 0.9 },
      volumes: [{ cx: pile.x, cz: pile.z, halfW: 0.45, halfD: 0.45, ry: 0 }],
    });
  }
  return entries;
}

function crossesPartition(rect) {
  const half = 0.13;
  for (const partition of PARTITIONS) {
    if (partition.axis === 'x') {
      const lo = Math.min(partition.from, partition.to);
      const hi = Math.max(partition.from, partition.to);
      if (rect.maxX > partition.at - half && rect.minX < partition.at + half && rect.maxZ > lo && rect.minZ < hi) {
        if (partition.opening && rect.minZ >= partition.opening.c - partition.opening.w / 2
          && rect.maxZ <= partition.opening.c + partition.opening.w / 2) continue;
        return true;
      }
    } else {
      const lo = Math.min(partition.from, partition.to);
      const hi = Math.max(partition.from, partition.to);
      if (rect.maxZ > partition.at - half && rect.minZ < partition.at + half && rect.maxX > lo && rect.minX < hi) {
        if (partition.opening && rect.minX >= partition.opening.c - partition.opening.w / 2
          && rect.maxX <= partition.opening.c + partition.opening.w / 2) continue;
        return true;
      }
    }
  }
  return false;
}

function pointInDoorSwing(x, z, swing, padding = 0) {
  const dx = x - swing.pivot[0];
  const dz = z - swing.pivot[1];
  const distance = Math.hypot(dx, dz);
  if (distance > swing.radius + padding || distance < 0.02) return false;
  let angle = Math.atan2(dz, dx);
  let min = swing.minAngle;
  let max = swing.maxAngle;
  while (angle < min) angle += Math.PI * 2;
  while (max < min) max += Math.PI * 2;
  return angle <= max + 0.001;
}

function volumeTouchesDoorSwing(volume, swing, padding) {
  const rect = obbAabb(volume);
  const samples = [
    [volume.cx, volume.cz], [rect.minX, rect.minZ], [rect.minX, rect.maxZ],
    [rect.maxX, rect.minZ], [rect.maxX, rect.maxZ],
  ];
  return samples.some(([x, z]) => pointInDoorSwing(x, z, swing, padding));
}

// --- Dynamic placement surfaces ---------------------------------------------------------

function topSurfaceForObject(object) {
  if (!['table', 'desk', 'counter', 'cabinet', 'shelf', 'stockroom-fixture'].includes(object.placementCategory)) return null;
  return {
    id: `surface:object:${object.id}:top`,
    kind: object.placementCategory === 'shelf' || object.placementCategory === 'stockroom-fixture' ? 'shelf' : 'counter',
    ownerId: object.id,
    room: object.room,
    x: object.x,
    z: object.z,
    y: object.y + object.bounds.height,
    ry: object.ry,
    // The catalog footprint already describes the usable top silhouette and the
    // child contributes its own requiredClearance. Shrinking both here used to
    // double-charge the edge margin and rejected the verified office printer on
    // the filing cabinet by a few centimetres.
    width: Math.max(0.08, object.bounds.width - 0.01),
    depth: Math.max(0.08, object.bounds.depth - 0.01),
    sockets: [],
    protectedZones: [],
  };
}

function fixtureSurfaces(state) {
  const surfaces = [];
  for (const fixture of placedFixtures(state)) {
    const rect = fixtureRect(fixture);
    const width = rect.maxX - rect.minX;
    const depth = rect.maxZ - rect.minZ;
    if (fixture.kind === 'backcounter' || fixture.kind === 'table' || fixture.kind === 'feature') {
      surfaces.push({
        id: `surface:fixture:${fixture.id}:top`, kind: 'counter', ownerId: fixture.id,
        room: fixture.zone || 'sales', x: fixture.x, z: fixture.z,
        y: fixture.kind === 'backcounter' ? 0.92 : 0.96, ry: fixture.ry || 0,
        width: Math.max(0.08, width - 0.10), depth: Math.max(0.08, depth - 0.10),
        sockets: [], protectedZones: [],
      });
    }
    if (['shelf', 'shoerack', 'backshelf'].includes(fixture.kind)) {
      const levels = fixture.kind === 'backshelf' ? [0.4, 1.05, 1.7]
        : fixture.kind === 'shoerack' ? [0.35, 0.85, 1.35] : [0.5, 1.05, 1.6];
      levels.forEach((y, index) => surfaces.push({
        id: `surface:fixture:${fixture.id}:shelf-${index + 1}`, kind: 'shelf', ownerId: fixture.id,
        room: fixture.zone || 'sales', x: fixture.x, z: fixture.z, y, ry: fixture.ry || 0,
        width: Math.max(0.08, width - 0.16), depth: Math.min(0.52, Math.max(0.16, depth - 0.05)),
        sockets: [], protectedZones: [],
      }));
    }
  }
  return surfaces;
}

export function placementSurfaces(state) {
  const result = STATIC_PLACEMENT_SURFACES.map((surface) => ({ ...surface }));
  result.push(...fixtureSurfaces(state));
  for (const object of placedObjects(state)) {
    if (object.id === 'core-checkout-counter') continue;
    const surface = topSurfaceForObject(object);
    if (surface) result.push(surface);
  }
  return result;
}

export function placementSurfaceById(state, id) {
  return STATIC_PLACEMENT_SURFACE_BY_ID[id] || placementSurfaces(state).find((surface) => surface.id === id) || null;
}

function surfaceLocal(surface, x, z) {
  const dx = x - surface.x;
  const dz = z - surface.z;
  const c = Math.cos(surface.ry || 0);
  const s = Math.sin(surface.ry || 0);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

// --- Navigation ------------------------------------------------------------------------

function navigationRects(state, override = null) {
  const result = [];
  for (const object of placedObjects(state)) {
    // The route proof only layers player-controlled furniture over the authored
    // floor plan. Existing checkout/office geometry and the legacy lounge/desk
    // dressing are already part of that plan (and have live scene colliders); if
    // they are inserted here as new obstacles, required stand points such as the
    // office chair become solid and a pristine migrated save fails immediately.
    if (!object.collision?.blocksCustomers || object.render?.kind === 'existing'
      || object.id === override?.id) continue;
    for (const volume of volumesFor(object, object.transform)) result.push(obbAabb(volume));
  }
  for (const extra of ensureLayout(state).extra) {
    if (extra.id !== override?.id) result.push(fixtureRect(extra));
  }
  if (override?.place) {
    const meta = placeableById(override.id) || extraMeta(state, override.id);
    if (meta?.collision?.blocksCustomers !== false) {
      for (const volume of volumesFor(meta, override.place.transform || override.place)) result.push(obbAabb(volume));
    }
  }
  return result;
}

function solidAt(x, z, rects) {
  if (Math.abs(x) > INTERIOR.w / 2 - R || Math.abs(z) > INTERIOR.d / 2 - R) return true;
  for (const partition of PARTITIONS) {
    if (partition.axis === 'x') {
      if (Math.abs(x - partition.at) < R + 0.13 && z >= Math.min(partition.from, partition.to) && z <= Math.max(partition.from, partition.to)) {
        if (!partition.opening) return true;
        if (Math.abs(z - partition.opening.c) > partition.opening.w / 2 - R) return true;
      }
    } else if (Math.abs(z - partition.at) < R + 0.13 && x >= Math.min(partition.from, partition.to) && x <= Math.max(partition.from, partition.to)) {
      if (!partition.opening) return true;
      if (Math.abs(x - partition.opening.c) > partition.opening.w / 2 - R) return true;
    }
  }
  const body = { minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R };
  return rects.some((rect) => rectsOverlap(body, rect));
}

export function routesIntact(state, override = null) {
  const rects = navigationRects(state, override);
  const start = { x: (DOOR_CLEARWAY.minX + DOOR_CLEARWAY.maxX) / 2, z: INTERIOR.d / 2 - 1.0 };
  const width = Math.ceil(INTERIOR.w / GRID);
  const height = Math.ceil(INTERIOR.d / GRID);
  const key = (i, j) => j * width + i;
  const toI = (x) => Math.round((x + INTERIOR.w / 2) / GRID);
  const toJ = (z) => Math.round((z + INTERIOR.d / 2) / GRID);
  const atX = (i) => -INTERIOR.w / 2 + i * GRID;
  const atZ = (j) => -INTERIOR.d / 2 + j * GRID;
  const seen = new Uint8Array(width * height);
  const si = toI(start.x);
  const sj = toJ(start.z);
  if (si < 0 || sj < 0 || si >= width || sj >= height || solidAt(atX(si), atZ(sj), rects)) return false;
  const stack = [[si, sj]];
  seen[key(si, sj)] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= width || nj >= height || seen[key(ni, nj)]) continue;
      if (solidAt(atX(ni), atZ(nj), rects)) continue;
      seen[key(ni, nj)] = 1;
      stack.push([ni, nj]);
    }
  }
  const reached = (point) => {
    const i = toI(point.x);
    const j = toJ(point.z);
    if (i < 0 || j < 0 || i >= width || j >= height) return false;
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < width && b < height && seen[key(a, b)]) return true;
      }
    }
    return false;
  };
  if (!reached(queueSlot(0)) || !reached(COUNTER.staffStand)
    || !reached(OFFICE.chair) || !reached(STOCKROOM.receivingInside)) return false;
  for (const fixture of placedFixtures(state)) {
    if (!fixture.skus?.length || fixture.id === override?.id) continue;
    const rect = fixtureRect(fixture);
    const points = [
      { x: (rect.minX + rect.maxX) / 2, z: rect.maxZ + R + 0.1 },
      { x: (rect.minX + rect.maxX) / 2, z: rect.minZ - R - 0.1 },
      { x: rect.maxX + R + 0.1, z: (rect.minZ + rect.maxZ) / 2 },
      { x: rect.minX - R - 0.1, z: (rect.minZ + rect.maxZ) / 2 },
    ];
    if (!points.some(reached)) return false;
  }
  return true;
}

// --- Validation ------------------------------------------------------------------------

function normalizedCandidate(meta, candidate, options = {}) {
  const source = candidate?.transform || candidate || meta.defaultTransform;
  const base = meta.defaultTransform;
  const grid = options.grid === false ? (options.fine ? FINE_GRID : 0) : (options.gridSize || GRID);
  const surface = source.surface || base.surface || 'floor';
  let x = Number.isFinite(source.x) ? source.x : base.x;
  let y = Number.isFinite(source.y) ? source.y : base.y || 0;
  let z = Number.isFinite(source.z) ? source.z : base.z;
  let ry = Number.isFinite(source.ry) ? source.ry : base.ry || 0;
  if (grid > 0) {
    x = snap(x, grid);
    z = snap(z, grid);
    if (surface === 'wall') y = snap(y, grid);
  }
  if (options.rotationSnap !== false && meta.rotation?.increment > 0) ry = snap(ry, meta.rotation.increment);
  // Explicit `attachment: null` means detach. Falling back with `||` silently
  // resurrected the default wall/socket relationship and could make a malformed
  // placement look valid after normalization.
  const attachment = Object.hasOwn(source, 'attachment')
    ? clone(source.attachment)
    : clone(base.attachment || null);
  if (surface === 'wall' && attachment?.wallId) {
    const wall = WALL_SURFACE_BY_ID[attachment.wallId];
    if (wall) {
      ry = wall.yaw;
      if (wall.axis === 'x') x = wall.at; else z = wall.at;
      attachment.normal = [...wall.normal];
    }
  }
  return { x, y, z, ry, surface, attachment, room: source.room || base.room || 'sales' };
}

function addReason(result, code, message) {
  if (result.codes.includes(code)) return;
  result.codes.push(code);
  result.reasons.push(message);
}

function validateWall(meta, candidate, result) {
  const wall = WALL_SURFACE_BY_ID[candidate.attachment?.wallId];
  if (!wall) {
    addReason(result, 'wall-target-missing', 'Aim at a solid wall surface.');
    return;
  }
  const along = wall.coordinate === 'x' ? candidate.x : candidate.z;
  const halfAlong = meta.bounds.width / 2 + meta.requiredClearance;
  const range = verticalRange(meta, candidate);
  const rules = meta.surfaceRules.wall || {};
  if (along - halfAlong < wall.from || along + halfAlong > wall.to
    || range.minY < (rules.minHeight ?? 0) || range.maxY > (rules.maxHeight ?? SHELL.h)) {
    addReason(result, 'wall-bounds', 'That object does not fit on this wall at that height.');
  }
  const plane = wall.axis === 'x' ? candidate.x : candidate.z;
  if (Math.abs(plane - wall.at) > 0.08) addReason(result, 'wall-gap', 'The wall mount must sit flush against the wall.');
  if (Math.abs(angleDelta(candidate.ry, wall.yaw)) > 0.015) addReason(result, 'wall-facing', 'Wall objects must face into the room.');
  for (const opening of WALL_OPENINGS.filter((entry) => entry.wallId === wall.id)) {
    if (along + halfAlong <= opening.from || along - halfAlong >= opening.to
      || range.maxY <= opening.bottom || range.minY >= opening.top) continue;
    addReason(result, opening.kind === 'glass' ? 'wall-glass' : 'wall-door',
      opening.kind === 'glass' ? 'That is glass, not a placeable wall.' : `That would cover the ${opening.label}.`);
  }
}

function validateHorizontalSurface(state, meta, candidate, result) {
  const surface = placementSurfaceById(state, candidate.attachment?.parentId);
  if (!surface || surface.kind !== candidate.surface) {
    addReason(result, 'surface-missing', `Aim at a ${candidate.surface} placement surface.`);
    return;
  }
  // Checkout hardware is calibrated to authored sockets on an irregular working
  // counter. Its conservative interaction zones intentionally overlap one another;
  // those zones protect the workflow from decorations, they are not replacement
  // footprints for the hardware itself. The protected-socket rule above still
  // rejects even a tiny player-authored offset.
  const authoredCheckoutHardware = meta.requiredObject === 'checkout-critical'
    && meta.placementRestrictions?.includes('authored-socket-only');
  if (authoredCheckoutHardware) {
    if (Math.abs(candidate.y - surface.y) > 0.045) addReason(result, 'surface-height', 'The object must rest exactly on the surface.');
    return;
  }
  const local = surfaceLocal(surface, candidate.x, candidate.z);
  const relative = candidate.ry - (surface.ry || 0);
  const c = Math.abs(Math.cos(relative));
  const s = Math.abs(Math.sin(relative));
  const halfW = (meta.bounds.width * c + meta.bounds.depth * s) / 2 + meta.requiredClearance;
  const halfD = (meta.bounds.width * s + meta.bounds.depth * c) / 2 + meta.requiredClearance;
  if (Math.abs(local.x) + halfW > surface.width / 2 || Math.abs(local.z) + halfD > surface.depth / 2) {
    addReason(result, 'surface-bounds', `Keep the whole object on the ${candidate.surface}.`);
  }
  if (Math.abs(candidate.y - surface.y) > 0.045) addReason(result, 'surface-height', 'The object must rest exactly on the surface.');
  for (const zone of surface.protectedZones || []) {
    if (meta.protectedZoneId && zone.id === meta.protectedZoneId) continue;
    const candidateRect = placementBounds(state, meta.id, candidate);
    const zoneRect = {
      minX: zone.x - zone.width / 2, maxX: zone.x + zone.width / 2,
      minZ: zone.z - zone.depth / 2, maxZ: zone.z + zone.depth / 2,
    };
    if (rectsOverlap(candidateRect, zoneRect)) {
      addReason(result, 'protected-equipment', `That blocks the ${zone.label}. Use an open authored socket.`);
      break;
    }
  }
}

function validateObjectOverlap(state, meta, candidate, result) {
  const candidateRange = verticalRange(meta, candidate);
  const candidateVolumes = volumesFor(meta, candidate);
  const parentSurface = candidate.attachment?.parentId ? placementSurfaceById(state, candidate.attachment.parentId) : null;
  for (const other of collisionEntries(state, meta.id)) {
    // The authored shop/checkout plan predates and intentionally owns the room;
    // only player-movable GLB furnishings need to avoid the renovation piles.
    if (other.id.startsWith('reno-clutter-') && meta.render?.kind !== 'glb') continue;
    if (parentSurface?.ownerId && other.id === parentSurface.ownerId) continue;
    if (!rangesOverlap(candidateRange, other.range)) continue;
    if (candidateVolumes.some((a) => other.volumes.some((b) => obbOverlap(a, b)))) {
      addReason(result, 'object-overlap', `That overlaps the ${other.label}.`);
      return;
    }
  }
  // Thin wall/surface objects do not block bodies, but still must not stack into
  // another object attached to the same wall or parent surface.
  for (const other of placedObjects(state)) {
    if (other.id === meta.id || other.state !== 'placed') continue;
    if (meta.render?.kind === 'existing' && other.render?.kind === 'existing') continue;
    const sameWall = candidate.surface === 'wall' && other.surface === 'wall'
      && candidate.attachment?.wallId === other.attachment?.wallId;
    const sameSurface = ['counter', 'shelf'].includes(candidate.surface)
      && other.surface === candidate.surface
      && candidate.attachment?.parentId === other.attachment?.parentId;
    if (!sameWall && !sameSurface) continue;
    if (!rangesOverlap(candidateRange, verticalRange(other, other.transform))) continue;
    if (candidateVolumes.some((a) => volumesFor(other, other.transform).some((b) => obbOverlap(a, b)))) {
      addReason(result, 'object-overlap', `That overlaps the ${other.label}.`);
      return;
    }
  }
}

function validateFloor(state, meta, candidate, result, options) {
  const rect = placementBounds(state, meta.id, candidate);
  const tuck = 0.15;
  if (rect.minX < -INTERIOR.w / 2 - tuck || rect.maxX > INTERIOR.w / 2 + tuck
    || rect.minZ < -INTERIOR.d / 2 - tuck || rect.maxZ > INTERIOR.d / 2 + tuck
    || crossesPartition(rect)) {
    addReason(result, 'wall-collision', 'That would go into a wall.');
  }
  if (Math.abs(candidate.y) > 0.055) addReason(result, 'floating', 'Floor objects must sit with their feet on the floor.');
  if ((candidate.y || 0) + meta.bounds.height > SHELL.h + 0.01) addReason(result, 'ceiling', 'That object is too tall for this room.');
  if (meta.collision?.blocksPlayer || meta.collision?.blocksCustomers) {
    for (const zone of PROTECTED_ZONES) {
      if (meta.id === 'core-checkout-counter' && zone.id.startsWith('checkout-')) continue;
      if (rectsOverlap(rect, zone)) {
        addReason(result, `protected-${zone.id}`, `That blocks the ${zone.label}.`);
        break;
      }
    }
    for (const swing of DOOR_SWINGS) {
      if (volumesFor(meta, candidate).some((volume) => volumeTouchesDoorSwing(volume, swing, meta.doorClearance || 0))) {
        addReason(result, `door-swing-${swing.id}`, `That blocks the ${swing.label}.`);
        break;
      }
    }
  }
  const actor = options.actorPosition;
  if (actor && meta.collision?.blocksPlayer && volumesFor(meta, candidate).some((volume) => circleRectOverlap(actor.x, actor.z, R + (meta.interactionClearance || 0), obbAabb(volume)))) {
    addReason(result, 'player-clearance', 'Step back so the furniture does not settle through you.');
  }
}

export function validateObjectPlacement(state, id, candidateValue, options = {}) {
  const meta = placeableById(id) || extraMeta(state, id);
  const result = { ok: false, reasons: [], codes: [], candidate: null };
  if (!meta) {
    addReason(result, 'missing-object', 'No such placeable object.');
    return result;
  }
  const candidate = normalizedCandidate(meta, candidateValue, options);
  result.candidate = candidate;
  if (!finite(candidate.x, candidate.y, candidate.z, candidate.ry)) {
    addReason(result, 'non-finite', 'That placement transform is invalid.');
    return result;
  }
  if (!meta.surfaceRules.allowed.includes(candidate.surface)) {
    addReason(result, 'surface-not-allowed', `${meta.label} cannot be placed on a ${candidate.surface}.`);
    return result;
  }
  if (meta.placementRestrictions?.includes('authored-socket-only')) {
    const base = meta.defaultTransform;
    const moved = Math.hypot(candidate.x - base.x, candidate.z - base.z) > 0.03
      || Math.abs(candidate.y - base.y) > 0.03 || Math.abs(angleDelta(candidate.ry, base.ry)) > 0.03;
    if (moved) addReason(result, 'protected-socket', `${meta.label} must stay on its protected authored socket so the interaction remains usable.`);
  }
  if (candidate.surface === 'floor') validateFloor(state, meta, candidate, result, options);
  else if (candidate.surface === 'wall') validateWall(meta, candidate, result);
  else if (candidate.surface === 'counter' || candidate.surface === 'shelf') validateHorizontalSurface(state, meta, candidate, result);
  else if (candidate.surface === 'ceiling') {
    if (Math.abs(candidate.y - SHELL.h) > 0.08) addReason(result, 'ceiling-gap', 'Ceiling objects must mount flush to the ceiling.');
    const rect = placementBounds(state, meta.id, candidate);
    if (rect.minX < -INTERIOR.w / 2 || rect.maxX > INTERIOR.w / 2
      || rect.minZ < -INTERIOR.d / 2 || rect.maxZ > INTERIOR.d / 2) addReason(result, 'ceiling-bounds', 'That does not fit on the ceiling.');
  }
  validateObjectOverlap(state, meta, candidate, result);
  if (!result.reasons.length && candidate.surface === 'floor' && meta.collision?.blocksCustomers
    && meta.render?.kind !== 'existing'
    && !routesIntact(state, { id: meta.id, place: candidate })) {
    addReason(result, 'navigation-blocked', 'That would cut the shop off — customers could not reach a required area.');
  }
  result.ok = result.reasons.length === 0;
  return result;
}

// Legacy signature: validatePlacement(state, fixtureId, x, z, ry).
export function validatePlacement(state, id, x, z, ry = 0) {
  return validateObjectPlacement(state, id, { x, y: 0, z, ry, surface: 'floor', attachment: null }, { grid: false, rotationSnap: false });
}

// --- Commands/history/save -------------------------------------------------------------

function syncLegacyFixture(layout, id, record) {
  const meta = fixtureMeta(id);
  if (!meta?.fixture) return;
  if (record.state === 'stored' || record.state === 'sold') {
    if (!layout.stored.includes(id)) layout.stored.push(id);
  } else {
    layout.stored = layout.stored.filter((storedId) => storedId !== id);
  }
  const base = meta.defaultTransform;
  const value = record.transform;
  if (Math.abs(value.x - base.x) > EPS || Math.abs(value.z - base.z) > EPS || Math.abs(angleDelta(value.ry, base.ry)) > EPS) {
    layout.moved[id] = { x: value.x, z: value.z, ry: value.ry };
  } else delete layout.moved[id];
}

function setRawRecord(state, id, record) {
  const layout = ensureLayout(state);
  if (record == null) delete layout.objects[id];
  else layout.objects[id] = clone(record);
  const resolved = record || defaultRecord(placeableById(id) || extraMeta(state, id));
  syncLegacyFixture(layout, id, resolved);
}

function pushHistory(layout, entry) {
  layout.history.undo.push(clone(entry));
  if (layout.history.undo.length > HISTORY_LIMIT) layout.history.undo.splice(0, layout.history.undo.length - HISTORY_LIMIT);
  layout.history.redo.length = 0;
}

function commitRecord(state, id, nextRecord, { history = true, kind = 'placement' } = {}) {
  const layout = ensureLayout(state);
  const before = rawRecord(state, id) ? clone(rawRecord(state, id)) : null;
  setRawRecord(state, id, nextRecord);
  layout.revision += 1;
  if (history) pushHistory(layout, { type: 'object', kind, id, before, after: clone(nextRecord) });
  return objectById(state, id);
}

export function commitObjectPlacement(state, id, candidateValue, options = {}) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return { ok: false, reason: 'No such placeable object.' };
  const validation = options.skipValidation
    ? { ok: true, candidate: normalizedCandidate(meta, candidateValue, options) }
    : validateObjectPlacement(state, id, candidateValue, options);
  if (!validation.ok) return { ok: false, reason: validation.reasons[0], ...validation };
  const current = objectRecord(state, id);
  const record = {
    ...current,
    assetId: meta.assetId,
    state: 'placed',
    transform: clone(validation.candidate),
    variant: options.variant || current.variant || meta.defaultVariant,
    requiredRelationship: meta.requiredObject || null,
  };
  const object = commitRecord(state, id, record, { history: options.history !== false, kind: options.kind || 'placement' });
  return { ok: true, object, candidate: clone(validation.candidate), revision: ensureLayout(state).revision };
}

export function commitPlacement(state, id, x, z, ry = 0) {
  const result = commitObjectPlacement(state, id, {
    x: snap(x), y: 0, z: snap(z), ry, surface: 'floor', attachment: null,
  }, { skipValidation: true, grid: false, rotationSnap: false });
  return result.ok ? fixtureById(state, id) : null;
}

export function storeObject(state, id, options = {}) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return { ok: false, reason: 'No such placeable object.' };
  if (meta.storageBehavior === 'recovery-only' && !options.recovery) {
    return { ok: false, required: true, reason: `${meta.label} is required. Use recovery to return it to its safe position.` };
  }
  const current = objectRecord(state, id);
  if (current.state === 'sold') return { ok: false, reason: `${meta.label} has already been sold.` };
  if (current.state === 'stored') return { ok: true, object: objectById(state, id), unchanged: true };
  const object = commitRecord(state, id, { ...current, state: 'stored' }, { history: options.history !== false, kind: 'store' });
  return { ok: true, object, revision: ensureLayout(state).revision };
}

export function storeFixture(state, id) {
  return storeObject(state, id).ok;
}

function nearestLegalFloor(state, id, origin) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta?.surfaceRules.allowed.includes('floor')) return null;
  for (let ring = 0; ring <= 36; ring++) {
    const radius = ring * GRID;
    const count = ring === 0 ? 1 : Math.max(16, ring * 8);
    for (let index = 0; index < count; index++) {
      const angle = count === 1 ? 0 : index / count * Math.PI * 2;
      const candidate = {
        ...origin,
        x: snap(origin.x + Math.cos(angle) * radius),
        y: 0,
        z: snap(origin.z + Math.sin(angle) * radius),
        surface: 'floor',
        attachment: null,
      };
      const result = validateObjectPlacement(state, id, candidate, { grid: false, rotationSnap: false });
      if (result.ok) return result.candidate;
    }
  }
  return null;
}

export function recoverObject(state, id, options = {}) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return { ok: false, reason: 'No such placeable object.' };
  let candidate = clone(meta.defaultTransform);
  let validation = validateObjectPlacement(state, id, candidate, { grid: false, rotationSnap: false });
  if (!validation.ok) {
    candidate = nearestLegalFloor(state, id, objectRecord(state, id)?.transform || candidate);
    if (!candidate) return { ok: false, reason: `No safe recovery position is available for ${meta.label}.`, reasons: validation.reasons };
  } else candidate = validation.candidate;
  const current = objectRecord(state, id);
  const object = commitRecord(state, id, {
    ...current, state: 'placed', transform: candidate,
    variant: current.variant || meta.defaultVariant,
  }, { history: options.history !== false, kind: 'recover' });
  return { ok: true, object, recovered: true, revision: ensureLayout(state).revision };
}

export function restoreObject(state, id, candidateValue = null, options = {}) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return { ok: false, reason: 'No such placeable object.' };
  const current = objectRecord(state, id);
  if (current.state === 'sold') return { ok: false, reason: `${meta.label} was sold and is no longer in storage.` };
  const candidate = candidateValue || current.transform || meta.defaultTransform;
  const result = commitObjectPlacement(state, id, candidate, { ...options, kind: 'restore' });
  return result.ok ? result : recoverObject(state, id, options);
}

export function restoreFixture(state, id) {
  const result = restoreObject(state, id, null, { skipValidation: true });
  return result.ok ? fixtureById(state, id) : null;
}

export function sellObject(state, id, options = {}) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return { ok: false, reason: 'No such placeable object.' };
  const layout = ensureLayout(state);
  const current = objectRecord(state, id);
  if (current.state === 'sold' || layout.soldCredits[id]) {
    return { ok: false, repeated: true, reason: `${meta.label} has already been sold.` };
  }
  if (meta.requiredObject) {
    return {
      ok: false, required: true,
      reason: `${meta.label} is required (${meta.requiredObject}). It cannot be sold; recover it instead.`,
    };
  }
  if (!Number.isFinite(meta.sellValue) || meta.sellValue <= 0) return { ok: false, reason: `${meta.label} has no resale value.` };
  const value = Math.round(meta.sellValue * 100) / 100;
  state.cash = Math.round((state.cash + value) * 100) / 100;
  layout.revision += 1;
  layout.soldCredits[id] = { value, revision: layout.revision };
  setRawRecord(state, id, { ...current, state: 'sold', soldAtRevision: layout.revision });
  // Sales deliberately do not enter placement undo history: otherwise undo/redo
  // becomes a money printer. A sold object can only return through a future buy flow.
  layout.history.redo.length = 0;
  return { ok: true, id, value, cash: state.cash, revision: layout.revision };
}

function applyHistoryEntry(state, entry, direction) {
  const layout = ensureLayout(state);
  if (entry.type === 'object') {
    setRawRecord(state, entry.id, direction === 'undo' ? entry.before : entry.after);
  } else if (entry.type === 'style') {
    layout.roomStyle = clone(direction === 'undo' ? entry.before : entry.after);
  }
  layout.revision += 1;
}

export function undoPlacement(state) {
  const layout = ensureLayout(state);
  const entry = layout.history.undo.pop();
  if (!entry) return { ok: false, reason: 'Nothing to undo.' };
  applyHistoryEntry(state, entry, 'undo');
  layout.history.redo.push(clone(entry));
  return { ok: true, entry: clone(entry), revision: layout.revision };
}

export function redoPlacement(state) {
  const layout = ensureLayout(state);
  const entry = layout.history.redo.pop();
  if (!entry) return { ok: false, reason: 'Nothing to redo.' };
  applyHistoryEntry(state, entry, 'redo');
  layout.history.undo.push(clone(entry));
  if (layout.history.undo.length > HISTORY_LIMIT) layout.history.undo.shift();
  return { ok: true, entry: clone(entry), revision: layout.revision };
}

export function setRoomStyle(state, patch, options = {}) {
  const layout = ensureLayout(state);
  const before = clone(layout.roomStyle);
  const after = { ...before, ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return { ok: true, unchanged: true, style: after };
  layout.roomStyle = after;
  layout.revision += 1;
  if (options.history !== false) pushHistory(layout, { type: 'style', kind: 'style', before, after: clone(after) });
  return { ok: true, style: clone(after), revision: layout.revision };
}

export function setObjectVariant(state, id, variant, options = {}) {
  const meta = placeableById(id) || extraMeta(state, id);
  if (!meta) return { ok: false, reason: 'No such placeable object.' };
  if (!meta.variants?.includes(variant)) return { ok: false, reason: `${meta.label} does not support that finish.` };
  const current = objectRecord(state, id);
  if (current.variant === variant) return { ok: true, unchanged: true, object: objectById(state, id) };
  const object = commitRecord(state, id, { ...current, variant }, {
    history: options.history !== false,
    kind: 'variant',
  });
  return { ok: true, object, revision: ensureLayout(state).revision };
}

export function roomStyle(state) {
  return clone(ensureLayout(state).roomStyle);
}

export function recoverInvalidObjects(state) {
  const recovered = [];
  const failed = [];
  for (const object of [...placedObjects(state)]) {
    const validation = validateObjectPlacement(state, object.id, object.transform, { grid: false, rotationSnap: false });
    if (validation.ok) continue;
    const result = recoverObject(state, object.id, { history: false });
    if (result.ok) recovered.push({ id: object.id, reasons: validation.reasons });
    else failed.push({ id: object.id, reasons: validation.reasons, recovery: result.reason });
  }
  return { ok: failed.length === 0, recovered, failed };
}

export function layoutSnapshot(state) {
  const layout = ensureLayout(state);
  return clone({
    version: layout.version,
    revision: layout.revision,
    objects: layout.objects,
    soldCredits: layout.soldCredits,
    roomStyle: layout.roomStyle,
  });
}

// --- Boxes remain real floor objects ----------------------------------------------------

export function boxFootprint(box, x, z, ry = 0) {
  const dim = boxDims(box && box.box);
  const swap = Math.abs(Math.sin(ry || 0)) > 0.5;
  const hx = (swap ? dim.d : dim.w) / 2;
  const hz = (swap ? dim.w : dim.d) / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

function worldBoxRects(state, selfId) {
  const boxes = state.shop?.deliveries?.boxes || [];
  return boxes.filter((box) => box.loc === 'world' && (selfId == null || box.id !== selfId))
    .map((box) => boxFootprint(box, box.x, box.z, box.ry || 0));
}

export function boxDropLegal(state, box, x, z, ry = 0) {
  const rect = boxFootprint(box, x, z, ry);
  const reasons = [];
  if (rect.minX < -INTERIOR.w / 2 || rect.maxX > INTERIOR.w / 2
    || rect.minZ < -INTERIOR.d / 2 || rect.maxZ > INTERIOR.d / 2 || crossesPartition(rect)) {
    reasons.push('That would go into a wall.');
  }
  for (const fixture of placedFixtures(state)) {
    if (rectsOverlap(rect, fixtureRect(fixture))) {
      reasons.push(`That is on top of the ${fixture.title || fixture.kind}.`);
      break;
    }
  }
  if (rectsOverlap(rect, DOOR_CLEARWAY)) reasons.push('That blocks the shop doorway.');
  if (rectsOverlap(rect, BACKDOOR_CLEARWAY)) reasons.push('That blocks the receiving doorway.');
  for (const other of worldBoxRects(state, box && box.id)) {
    if (rectsOverlap(rect, other)) {
      reasons.push('That is on top of another box.');
      break;
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function legalBoxDrop(state, box, x, z, ry = 0) {
  if (boxDropLegal(state, box, x, z, ry).ok) return { x, z, ry };
  for (let ring = 1; ring <= 24; ring++) {
    const radius = ring * GRID;
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2;
      const cx = x + Math.cos(angle) * radius;
      const cz = z + Math.sin(angle) * radius;
      if (boxDropLegal(state, box, cx, cz, ry).ok) return { x: cx, z: cz, ry };
    }
  }
  return null;
}
