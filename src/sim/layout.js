// THE PLAYER'S FLOOR PLAN.
//
// `FIXTURES` in shopLayout.js is the shop as designed. This is the shop as the player rebuilt it:
// a sparse set of overrides, so a save only carries what they actually changed and a later tweak
// to the default plan still reaches anyone who left that unit where it was.
//
// The interesting part is what the game REFUSES. A shop is not just furniture that fits — it has
// to be walkable. You can put a shelf almost anywhere, but not across the door, not in the till
// workspace, not on top of another shelf, and not anywhere that leaves a customer unable to reach
// the counter they were queuing for. Those rules are pure arithmetic over the plan, checked here,
// so build mode can never commit a layout the 3D scene then has to apologise for.

import {
  FIXTURES, INTERIOR, PARTITIONS, COUNTER, DOOR_CLEARWAY, BACKDOOR_CLEARWAY,
  STOCKROOM, OFFICE, PLAYER_DIAM, STAFF_CORRIDOR_MIN, fixtureRect, queueSlot,
} from '../data/shopLayout.js';
import { boxDims } from '../data/boxes.js';

export const GRID = 0.25; // placement snaps to this, in yards
const R = PLAYER_DIAM / 2; // the body that has to get through the gaps

// the till workspace, which nothing may be parked in
const staffZone = () => ({
  minX: COUNTER.x - COUNTER.len / 2 - 0.3,
  maxX: COUNTER.x + COUNTER.len / 2 + 0.3,
  minZ: COUNTER.z + COUNTER.depth / 2,
  maxZ: COUNTER.z + COUNTER.depth / 2 + STAFF_CORRIDOR_MIN,
});

const rectsOverlap = (a, b, eps = 1e-6) =>
  a.maxX > b.minX + eps && a.minX < b.maxX - eps && a.maxZ > b.minZ + eps && a.minZ < b.maxZ - eps;

export function ensureLayout(state) {
  if (!state.shop) return null;
  if (!state.shop.layout) state.shop.layout = {};
  const L = state.shop.layout;
  if (!L.moved) L.moved = {}; // id -> {x, z, ry}
  if (!L.stored) L.stored = []; // ids taken off the floor
  if (!L.extra) L.extra = []; // whole fixtures added (tests + future purchases)
  return L;
}

// the shop as it actually stands
export function placedFixtures(state) {
  const L = ensureLayout(state);
  const out = [];
  for (const f of FIXTURES) {
    if (L.stored.includes(f.id)) continue;
    const mv = L.moved[f.id];
    out.push(mv ? { ...f, x: mv.x, z: mv.z, ry: mv.ry } : f);
  }
  for (const e of L.extra) out.push(e);
  return out;
}

export const fixtureById = (state, id) => placedFixtures(state).find((f) => f.id === id);
export const storedFixtures = (state) => [...ensureLayout(state).stored];

// --- walkability -------------------------------------------------------------------------
// A coarse grid over the sales floor. Walls, partitions and every fixture are solid; the doors
// are the holes. This is the same question the customers ask, asked cheaply.

function solidAt(x, z, rects) {
  if (Math.abs(x) > INTERIOR.w / 2 - R || Math.abs(z) > INTERIOR.d / 2 - R) return true;
  for (const p of PARTITIONS) {
    if (p.axis === 'x') {
      // a wall running along z at x = p.at
      if (Math.abs(x - p.at) < R + 0.13 && z >= Math.min(p.from, p.to) && z <= Math.max(p.from, p.to)) {
        if (!p.opening) return true;
        if (Math.abs(z - p.opening.c) > p.opening.w / 2 - R) return true;
      }
    } else {
      // a wall running along x at z = p.at
      if (Math.abs(z - p.at) < R + 0.13 && x >= Math.min(p.from, p.to) && x <= Math.max(p.from, p.to)) {
        if (!p.opening) return true;
        if (Math.abs(x - p.opening.c) > p.opening.w / 2 - R) return true;
      }
    }
  }
  const body = { minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R };
  for (const r of rects) if (rectsOverlap(body, r)) return true;
  return false;
}

// can a shopper get from the door to everywhere a shopper needs to be?
export function routesIntact(state, override) {
  const rects = placedFixtures(state)
    .filter((f) => !override || f.id !== override.id)
    .map(fixtureRect);
  if (override && override.place) rects.push(fixtureRect(override.place));

  // flood from just inside the main door
  const start = { x: DOOR_CLEARWAY.minX / 2 + DOOR_CLEARWAY.maxX / 2, z: INTERIOR.d / 2 - 1.0 };
  const W = Math.ceil(INTERIOR.w / GRID);
  const H = Math.ceil(INTERIOR.d / GRID);
  const key = (i, j) => j * W + i;
  const toI = (x) => Math.round((x + INTERIOR.w / 2) / GRID);
  const toJ = (z) => Math.round((z + INTERIOR.d / 2) / GRID);
  const atX = (i) => -INTERIOR.w / 2 + i * GRID;
  const atZ = (j) => -INTERIOR.d / 2 + j * GRID;

  const seen = new Uint8Array(W * H);
  const si = toI(start.x);
  const sj = toJ(start.z);
  if (si < 0 || sj < 0 || si >= W || sj >= H) return false;
  if (solidAt(atX(si), atZ(sj), rects)) return false; // the doorway itself is blocked

  const stack = [[si, sj]];
  seen[key(si, sj)] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      if (seen[key(ni, nj)]) continue;
      if (solidAt(atX(ni), atZ(nj), rects)) continue;
      seen[key(ni, nj)] = 1;
      stack.push([ni, nj]);
    }
  }

  const reached = (p) => {
    const i = toI(p.x);
    const j = toJ(p.z);
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    if (seen[key(i, j)]) return true;
    // be forgiving by one cell: standing "at" a shelf means standing beside it
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < W && b < H && seen[key(a, b)]) return true;
      }
    }
    return false;
  };

  // the places a shop only works if you can get to
  if (!reached(queueSlot(0))) return false;
  if (!reached(COUNTER.staffStand)) return false;
  if (!reached(OFFICE.chair)) return false;
  if (!reached(STOCKROOM.receivingInside)) return false;
  // ...and every unit the customer is meant to browse
  for (const f of placedFixtures(state)) {
    if (!f.skus || !f.skus.length) continue;
    if (override && f.id === override.id) continue;
    const r = fixtureRect(f);
    const front = { x: (r.minX + r.maxX) / 2, z: r.maxZ + R + 0.1 };
    const back = { x: (r.minX + r.maxX) / 2, z: r.minZ - R - 0.1 };
    const east = { x: r.maxX + R + 0.1, z: (r.minZ + r.maxZ) / 2 };
    const west = { x: r.minX - R - 0.1, z: (r.minZ + r.maxZ) / 2 };
    if (!reached(front) && !reached(back) && !reached(east) && !reached(west)) return false;
  }
  return true;
}

// --- the rules ---------------------------------------------------------------------------

export function validatePlacement(state, id, x, z, ry = 0) {
  const L = ensureLayout(state);
  const base = FIXTURES.find((f) => f.id === id) || L.extra.find((f) => f.id === id);
  const reasons = [];
  if (!base) return { ok: false, reasons: ['No such fixture.'] };

  const place = { ...base, x, z, ry };
  const rect = fixtureRect(place);

  // 1. inside the building. Wall units are *meant* to sit flush — the designed plan tucks the club
  // wall 0.1 yd into a 0.25 yd wall so it reads as built-in — so allow a recess of up to half a
  // wall, and reject anything genuinely poking out of the building.
  const TUCK = 0.15;
  if (rect.minX < -INTERIOR.w / 2 - TUCK || rect.maxX > INTERIOR.w / 2 + TUCK
      || rect.minZ < -INTERIOR.d / 2 - TUCK || rect.maxZ > INTERIOR.d / 2 + TUCK) {
    reasons.push('That is inside a wall.');
  }

  // 2. not on top of anything else
  for (const other of placedFixtures(state)) {
    if (other.id === id) continue;
    if (rectsOverlap(rect, fixtureRect(other))) {
      reasons.push(`That overlaps the ${other.title || other.kind}.`);
      break;
    }
  }

  // 3. doorways stay walkable — both of them
  if (rectsOverlap(rect, DOOR_CLEARWAY)) reasons.push('That blocks the shop door.');
  if (rectsOverlap(rect, BACKDOOR_CLEARWAY)) reasons.push('That blocks the receiving door.');

  // 4. the till workspace is not a storage shelf
  if (rectsOverlap(rect, staffZone())) reasons.push('You need to be able to stand at the checkout.');

  // 5. and, last (it is the expensive one), the shop must still be walkable
  if (!reasons.length && !routesIntact(state, { id, place })) {
    reasons.push('That would cut the shop off — customers could not get around it.');
  }

  return { ok: reasons.length === 0, reasons };
}

export function commitPlacement(state, id, x, z, ry = 0) {
  const L = ensureLayout(state);
  const snap = (v) => Math.round(v / GRID) * GRID;
  L.moved[id] = { x: snap(x), z: snap(z), ry };
  L.stored = L.stored.filter((s) => s !== id); // placing it puts it back on the floor
  return fixtureById(state, id);
}

export function storeFixture(state, id) {
  const L = ensureLayout(state);
  if (!L.stored.includes(id)) L.stored.push(id);
  return true;
}

export function restoreFixture(state, id) {
  const L = ensureLayout(state);
  L.stored = L.stored.filter((s) => s !== id);
  return fixtureById(state, id);
}

// --- boxes as real objects ---------------------------------------------------------------
// A carried carton, once set down, occupies floor like anything else — the same walls,
// fixtures and doorways a shelf answers to, plus the boxes already on the floor. The size
// comes from data/boxes.js (boxDims), so the collider the scene draws, the rules here and
// the mesh all read one number.

export function boxFootprint(box, x, z, ry = 0) {
  const dim = boxDims(box && box.box);
  const swap = Math.abs(Math.sin(ry || 0)) > 0.5;   // turned a quarter-turn
  const hx = (swap ? dim.d : dim.w) / 2;
  const hz = (swap ? dim.w : dim.d) / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

// does a rect cross a service-wing partition, honouring the stock-door gap? (mirrors the
// partition arithmetic in solidAt, rect-wise — LANDMINE: two encodings of the same wall.)
function crossesPartition(rect) {
  const HALF = 0.13;
  for (const p of PARTITIONS) {
    if (p.axis === 'x') {
      const lo = Math.min(p.from, p.to);
      const hi = Math.max(p.from, p.to);
      if (rect.maxX > p.at - HALF && rect.minX < p.at + HALF && rect.maxZ > lo && rect.minZ < hi) {
        if (p.opening && rect.minZ >= p.opening.c - p.opening.w / 2 && rect.maxZ <= p.opening.c + p.opening.w / 2) continue;
        return true;
      }
    } else {
      const lo = Math.min(p.from, p.to);
      const hi = Math.max(p.from, p.to);
      if (rect.maxZ > p.at - HALF && rect.minZ < p.at + HALF && rect.maxX > lo && rect.minX < hi) {
        if (p.opening && rect.minX >= p.opening.c - p.opening.w / 2 && rect.maxX <= p.opening.c + p.opening.w / 2) continue;
        return true;
      }
    }
  }
  return false;
}

// the footprints of every OTHER world box currently on the floor
function worldBoxRects(state, selfId) {
  const boxes = (state.shop && state.shop.deliveries && state.shop.deliveries.boxes) || [];
  const out = [];
  for (const b of boxes) {
    if (b.loc !== 'world') continue;
    if (selfId != null && b.id === selfId) continue;
    out.push(boxFootprint(b, b.x, b.z, b.ry || 0));
  }
  return out;
}

// may this box be set down here? Same shape as validatePlacement, for a carton.
export function boxDropLegal(state, box, x, z, ry = 0) {
  const rect = boxFootprint(box, x, z, ry);
  const reasons = [];
  if (rect.minX < -INTERIOR.w / 2 || rect.maxX > INTERIOR.w / 2
      || rect.minZ < -INTERIOR.d / 2 || rect.maxZ > INTERIOR.d / 2 || crossesPartition(rect)) {
    reasons.push('That would go into a wall.');
  }
  for (const f of placedFixtures(state)) {
    if (rectsOverlap(rect, fixtureRect(f))) { reasons.push(`That is on top of the ${f.title || f.kind}.`); break; }
  }
  if (rectsOverlap(rect, DOOR_CLEARWAY)) reasons.push('That blocks the shop doorway.');
  if (rectsOverlap(rect, BACKDOOR_CLEARWAY)) reasons.push('That blocks the receiving doorway.');
  for (const other of worldBoxRects(state, box && box.id)) {
    if (rectsOverlap(rect, other)) { reasons.push('That is on top of another box.'); break; }
  }
  return { ok: reasons.length === 0, reasons };
}

// the requested spot if it is legal; else the nearest legal spot, spiralling out; else null.
export function legalBoxDrop(state, box, x, z, ry = 0) {
  if (boxDropLegal(state, box, x, z, ry).ok) return { x, z, ry };
  for (let ring = 1; ring <= 24; ring++) {
    const rad = ring * GRID;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const cx = x + Math.cos(ang) * rad;
      const cz = z + Math.sin(ang) * rad;
      if (boxDropLegal(state, box, cx, cz, ry).ok) return { x: cx, z: cz, ry };
    }
  }
  return null;
}
