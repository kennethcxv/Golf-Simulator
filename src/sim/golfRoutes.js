// Canonical course routing for live golf parties.
//
// The renderer never invents a second path. Walking groups, carts, the starter,
// practice facilities, save/load, and remote simulation all consume this one
// cached network built from the actual course grid.

import { CELL_YD, ZONE } from './constants.js';

const CARDINAL_AND_DIAGONAL = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

const WALK_COST = {
  [ZONE.OUT]: 2.1,
  [ZONE.ROUGH]: 1.35,
  [ZONE.FAIRWAY]: 1,
  [ZONE.GREEN]: 4.8,
  [ZONE.TEE]: 2.2,
  [ZONE.BUNKER]: 8.5,
  [ZONE.WATER]: Infinity,
  [ZONE.PATH]: 0.72,
};

const CART_COST = {
  [ZONE.OUT]: 1.55,
  [ZONE.ROUGH]: 1.8,
  [ZONE.FAIRWAY]: 3.8,
  [ZONE.GREEN]: Infinity,
  [ZONE.TEE]: 7.5,
  [ZONE.BUNKER]: Infinity,
  [ZONE.WATER]: Infinity,
  [ZONE.PATH]: 0.52,
};

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(node, score) {
    const item = { node, score };
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const tail = this.items.pop();
    if (this.items.length && tail) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let child = left;
        if (right < this.items.length && this.items[right].score < this.items[left].score) child = right;
        if (this.items[child].score >= tail.score) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = tail;
    }
    return root;
  }

  get length() {
    return this.items.length;
  }
}

const keyOf = (course, x, y) => y * course.w + x;
const cellOf = (course, index) => ({ x: index % course.w, y: Math.floor(index / course.w) });
const inside = (course, x, y) => x >= 0 && y >= 0 && x < course.w && y < course.h;

function structureMask(course) {
  const mask = new Uint8Array(course.w * course.h);
  for (const structure of course.structures || []) {
    const x0 = Math.max(0, Math.floor(structure.x));
    const y0 = Math.max(0, Math.floor(structure.y));
    const x1 = Math.min(course.w, Math.ceil(structure.x + structure.w));
    const y1 = Math.min(course.h, Math.ceil(structure.y + structure.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) mask[keyOf(course, x, y)] = 1;
    }
  }
  return mask;
}

export function worldPoint(course, point) {
  return {
    x: (point.x + 0.5) * CELL_YD - (course.w * CELL_YD) / 2,
    z: (point.y + 0.5) * CELL_YD - (course.h * CELL_YD) / 2,
  };
}

export function gridPoint(course, point) {
  return {
    x: Math.max(0, Math.min(course.w - 1, Math.floor((point.x + (course.w * CELL_YD) / 2) / CELL_YD))),
    y: Math.max(0, Math.min(course.h - 1, Math.floor((point.z + (course.h * CELL_YD) / 2) / CELL_YD))),
  };
}

export function zoneAtWorld(course, point) {
  const cell = gridPoint(course, point);
  return course.zones[keyOf(course, cell.x, cell.y)];
}

function passable(course, mask, x, y, mode, goalKey = -1) {
  if (!inside(course, x, y)) return false;
  const key = keyOf(course, x, y);
  if (key === goalKey) return !mask[key] && course.zones[key] !== ZONE.WATER;
  if (mask[key]) return false;
  const costs = mode === 'cart' ? CART_COST : WALK_COST;
  return Number.isFinite(costs[course.zones[key]]);
}

function nearestPassable(course, mask, point, mode, { avoidGoalSurface = false, avoid = null } = {}) {
  const base = {
    x: Math.max(0, Math.min(course.w - 1, Math.round(point.x))),
    y: Math.max(0, Math.min(course.h - 1, Math.round(point.y))),
  };
  for (let radius = 0; radius <= 14; radius++) {
    const candidates = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = base.x + dx;
        const y = base.y + dy;
        if (!inside(course, x, y)) continue;
        if (avoid?.has(keyOf(course, x, y))) continue;
        const zone = course.zones[keyOf(course, x, y)];
        if (avoidGoalSurface && (zone === ZONE.GREEN || zone === ZONE.TEE)) continue;
        if (passable(course, mask, x, y, mode)) candidates.push({ x, y, d: dx * dx + dy * dy });
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
      return { x: candidates[0].x, y: candidates[0].y };
    }
  }
  return base;
}

function reconstruct(course, cameFrom, goalIndex) {
  const path = [];
  let current = goalIndex;
  let guard = 0;
  while (current >= 0 && guard++ < cameFrom.length + 1) {
    path.push(cellOf(course, current));
    current = cameFrom[current];
  }
  path.reverse();
  return path;
}

function simplifyCells(cells) {
  if (cells.length <= 2) return cells;
  const out = [cells[0]];
  let lastDx = Math.sign(cells[1].x - cells[0].x);
  let lastDy = Math.sign(cells[1].y - cells[0].y);
  for (let i = 2; i < cells.length; i++) {
    const dx = Math.sign(cells[i].x - cells[i - 1].x);
    const dy = Math.sign(cells[i].y - cells[i - 1].y);
    if (dx !== lastDx || dy !== lastDy || i - out.length * 5 >= 7) out.push(cells[i - 1]);
    lastDx = dx;
    lastDy = dy;
  }
  out.push(cells[cells.length - 1]);
  return out;
}

export function findCourseRoute(course, from, to, mode = 'walk', options = {}) {
  const mask = options.structureMask || structureMask(course);
  const start = nearestPassable(course, mask, from, mode);
  const goal = nearestPassable(course, mask, to, mode, {
    avoidGoalSurface: mode === 'cart' && options.parkNearGoal !== false,
  });
  const startIndex = keyOf(course, start.x, start.y);
  const goalIndex = keyOf(course, goal.x, goal.y);
  if (startIndex === goalIndex) return [worldPoint(course, start), worldPoint(course, goal)];

  const size = course.w * course.h;
  const g = new Float64Array(size);
  g.fill(Infinity);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();
  g[startIndex] = 0;
  open.push(startIndex, 0);
  const costs = mode === 'cart' ? CART_COST : WALK_COST;

  while (open.length) {
    const item = open.pop();
    if (!item) break;
    const current = item.node;
    if (closed[current]) continue;
    if (current === goalIndex) {
      return simplifyCells(reconstruct(course, cameFrom, current)).map((point) => worldPoint(course, point));
    }
    closed[current] = 1;
    const cell = cellOf(course, current);
    for (const [dx, dy, multiplier] of CARDINAL_AND_DIAGONAL) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (!passable(course, mask, x, y, mode, goalIndex)) continue;
      // Do not cut a diagonal corner through two blocked cardinal cells.
      if (dx && dy && (!passable(course, mask, cell.x + dx, cell.y, mode, goalIndex)
        || !passable(course, mask, cell.x, cell.y + dy, mode, goalIndex))) continue;
      const next = keyOf(course, x, y);
      if (closed[next]) continue;
      const zone = course.zones[next];
      const step = (next === goalIndex ? 1 : costs[zone]) * multiplier;
      const tentative = g[current] + step;
      if (tentative >= g[next]) continue;
      g[next] = tentative;
      cameFrom[next] = current;
      const heuristic = Math.hypot(goal.x - x, goal.y - y);
      open.push(next, tentative + heuristic * 0.52);
    }
  }

  // A disconnected edited course still yields an honest direct fallback for
  // recovery, rather than a caller manufacturing a second routing system.
  return [worldPoint(course, start), worldPoint(course, goal)];
}

export function routeDistance(route) {
  let distance = 0;
  for (let i = 1; i < (route || []).length; i++) {
    distance += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  }
  return distance;
}

export function positionAlongRoute(route, progress) {
  if (!route?.length) return { x: 0, z: 0 };
  if (route.length === 1) return { ...route[0] };
  const total = routeDistance(route) || 1;
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= segment || i === route.length - 1) {
      const t = segment ? Math.max(0, Math.min(1, remaining / segment)) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= segment;
  }
  return { ...route[route.length - 1] };
}

function courseRevision(course) {
  const holes = course.holes.map((hole) => [
    hole.id,
    hole.status,
    hole.tee?.x,
    hole.tee?.y,
    hole.pin?.x,
    hole.pin?.y,
  ].join(':')).join('|');
  let zoneHash = 2166136261;
  for (let i = 0; i < course.zones.length; i++) {
    zoneHash ^= course.zones[i];
    zoneHash = Math.imul(zoneHash, 16777619);
  }
  return `${course.w}x${course.h}:${zoneHash >>> 0}:${holes}`;
}

function safeFacilityCell(course, mask, preferred, mode = 'walk') {
  return nearestPassable(course, mask, preferred, mode, { avoidGoalSurface: true });
}

function distinctFacilityCells(course, mask, preferredPoints, mode = 'walk') {
  const used = new Set();
  return preferredPoints.map((point) => {
    const cell = nearestPassable(course, mask, point, mode, { avoidGoalSurface: true, avoid: used });
    used.add(keyOf(course, cell.x, cell.y));
    return cell;
  });
}

function buildFacilities(course, mask) {
  const structure = (course.structures || []).find((entry) => entry.type === 'clubhouse')
    || course.structures?.[0]
    || { x: course.w / 2, y: course.h / 2, w: 1, h: 1 };
  const club = { x: structure.x + structure.w / 2, y: structure.y + structure.h / 2 };
  const firstTee = course.holes.find((hole) => hole.tee)?.tee || { x: club.x - 8, y: club.y - 8 };
  const vx = firstTee.x - club.x;
  const vy = firstTee.y - club.y;
  const length = Math.hypot(vx, vy) || 1;
  const ux = vx / length;
  const uy = vy / length;
  const px = -uy;
  const py = ux;
  const at = (forward, side = 0) => safeFacilityCell(course, mask, {
    x: club.x + ux * forward + px * side,
    y: club.y + uy * forward + py * side,
  });

  const starter = safeFacilityCell(course, mask, {
    x: firstTee.x - ux * 2.2 + px * 1.4,
    y: firstTee.y - uy * 2.2 + py * 1.4,
  });
  const rangeCenter = at(5.5, 7);
  const puttingCenter = at(3.5, -6);
  const chippingCenter = at(7.5, -2);
  const cartBarn = safeFacilityCell(course, mask, { x: club.x + 7, y: club.y + 2 }, 'cart');
  const returnPoint = safeFacilityCell(course, mask, { x: club.x, y: club.y + 5 });
  const staging = distinctFacilityCells(course, mask, [0, 1, 2].map((index) => ({
    x: starter.x - ux * (1.8 + index * 1.6) + px * (index - 1) * 0.8,
    y: starter.y - uy * (1.8 + index * 1.6) + py * (index - 1) * 0.8,
  })));
  const rangeBays = distinctFacilityCells(course, mask, Array.from({ length: 6 }, (_, index) => ({
    x: rangeCenter.x + px * (index - 2.5) * 0.8,
    y: rangeCenter.y + py * (index - 2.5) * 0.8,
  })));
  const puttingPositions = distinctFacilityCells(course, mask, Array.from({ length: 6 }, (_, index) => {
    const angle = (index / 6) * Math.PI * 2;
    return {
      x: puttingCenter.x + Math.cos(angle) * 1.6,
      y: puttingCenter.y + Math.sin(angle) * 1.6,
    };
  }));
  const chippingPositions = distinctFacilityCells(course, mask, Array.from({ length: 4 }, (_, index) => ({
    x: chippingCenter.x + px * (index - 1.5),
    y: chippingCenter.y + py * (index - 1.5),
  })));

  return {
    clubhouse: worldPoint(course, returnPoint),
    cartBarn: worldPoint(course, cartBarn),
    starterStand: worldPoint(course, starter),
    staging: staging.map((cell) => worldPoint(course, cell)),
    range: {
      center: worldPoint(course, rangeCenter),
      bays: rangeBays.map((cell) => worldPoint(course, cell)),
      target: worldPoint(course, at(13, 7)),
    },
    putting: {
      center: worldPoint(course, puttingCenter),
      positions: puttingPositions.map((cell) => worldPoint(course, cell)),
    },
    chipping: {
      center: worldPoint(course, chippingCenter),
      positions: chippingPositions.map((cell) => worldPoint(course, cell)),
    },
  };
}

export function buildCourseRouteNetwork(course) {
  const mask = structureMask(course);
  const facilities = buildFacilities(course, mask);
  const holes = [];
  const openHoles = course.holes.filter((hole) => hole.tee && hole.pin);
  for (let index = 0; index < openHoles.length; index++) {
    const hole = openHoles[index];
    const next = openHoles[index + 1] || null;
    const tee = worldPoint(course, hole.tee);
    const pin = worldPoint(course, hole.pin);
    holes.push({
      id: hole.id,
      index,
      tee,
      pin,
      play: {
        walk: findCourseRoute(course, hole.tee, hole.pin, 'walk', { structureMask: mask }),
        cart: findCourseRoute(course, hole.tee, hole.pin, 'cart', { structureMask: mask, parkNearGoal: true }),
      },
      transition: next ? {
        walk: findCourseRoute(course, hole.pin, next.tee, 'walk', { structureMask: mask }),
        cart: findCourseRoute(course, hole.pin, next.tee, 'cart', { structureMask: mask, parkNearGoal: true }),
      } : {
        walk: findCourseRoute(course, hole.pin, gridPoint(course, facilities.clubhouse), 'walk', { structureMask: mask }),
        cart: findCourseRoute(course, hole.pin, gridPoint(course, facilities.cartBarn), 'cart', { structureMask: mask, parkNearGoal: true }),
      },
    });
  }
  return {
    version: 1,
    revision: courseRevision(course),
    builtAtMinute: null,
    facilities,
    holes,
  };
}

export function ensureCourseRouteNetwork(course, existing = null) {
  const revision = courseRevision(course);
  if (existing?.version === 1 && existing.revision === revision) return existing;
  return buildCourseRouteNetwork(course);
}
