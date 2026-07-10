// FAIRWAY STATE — "Willow Creek Municipal", the starting fixer-upper.
// A compact, slightly scruffy 9-hole muni: short total yardage, three par 3s,
// one real par 5, a pond, and a modest clubhouse. Painted deterministically from
// the game seed so saves and tests agree on every cell.
//
// Turf shabbiness (thin fairways, sick greens) is applied by the turf sim's
// initializer in Phase 2 — this module only shapes the land.

import { ZONE, HOLE_STATUS } from './constants.js';
import { makeCourse, setZone, getZone, addHole, inBounds, idx } from './course.js';
import { clamp } from '../core/utils.js';

// Routing: two loops off the clubhouse at (56..62, 66..70).
// wp = waypoints the fairway corridor bends through (tee → ... → pin).
const HOLES = [
  { tee: { x: 52, y: 60 }, pin: { x: 18, y: 54 }, wp: [{ x: 36, y: 56 }] }, // 1 par 4
  { tee: { x: 14, y: 50 }, pin: { x: 12, y: 34 }, wp: [] }, // 2 par 3
  { tee: { x: 10, y: 28 }, pin: { x: 38, y: 10 }, wp: [{ x: 20, y: 16 }] }, // 3 par 4
  { tee: { x: 44, y: 8 }, pin: { x: 104, y: 14 }, wp: [{ x: 66, y: 10 }, { x: 88, y: 8 }] }, // 4 par 5
  { tee: { x: 108, y: 20 }, pin: { x: 106, y: 36 }, wp: [] }, // 5 par 3, over the pond
  { tee: { x: 102, y: 42 }, pin: { x: 70, y: 54 }, wp: [{ x: 86, y: 48 }] }, // 6 par 4
  { tee: { x: 64, y: 60 }, pin: { x: 10, y: 66 }, wp: [{ x: 40, y: 64 }, { x: 24, y: 66 }] }, // 7 par 4 (long)
  { tee: { x: 8, y: 72 }, pin: { x: 22, y: 76 }, wp: [] }, // 8 par 3
  { tee: { x: 26, y: 77 }, pin: { x: 60, y: 72 }, wp: [{ x: 44, y: 75 }] }, // 9 par 4, home
];

const POND = { x: 107, y: 28, rx: 5, ry: 3.4 }; // guards hole 5
const CLUBHOUSE = { type: 'clubhouse', x: 56, y: 66, w: 6, h: 5 };

// Exported for reuse by the GOLF EMPIRE marketplace course generator — pure
// painting primitives, no Willow-specific behavior.
export function paintDisk(course, cx, cy, r, zone, { onlyOver = null } = {}) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!inBounds(course, x, y)) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      if (onlyOver && !onlyOver.has(getZone(course, x, y))) continue;
      setZone(course, x, y, zone);
    }
  }
}

function corridorPoints(hole) {
  return [hole.tee, ...(hole.wp || []), hole.pin];
}

export function paintCorridor(course, pts, radius, zone, rng, { onlyOver = null } = {}) {
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(len * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wobble = (rng.next() - 0.5) * 1.2;
      const px = a.x + (b.x - a.x) * t + wobble;
      const py = a.y + (b.y - a.y) * t + (rng.next() - 0.5) * 1.2;
      const r = radius + (rng.next() - 0.5) * 0.8;
      paintDisk(course, px, py, r, zone, { onlyOver });
    }
  }
}

export function shapeElevation(course, rng) {
  // Gentle rolling land from layered sinusoids with seeded phases — deterministic,
  // smooth, and cheap. Amplitude tuned for ±6–9 ft of movement.
  const p1 = rng.next() * Math.PI * 2;
  const p2 = rng.next() * Math.PI * 2;
  const p3 = rng.next() * Math.PI * 2;
  for (let y = 0; y < course.h; y++) {
    for (let x = 0; x < course.w; x++) {
      const e =
        4.0 * Math.sin(x / 16 + p1) * Math.cos(y / 12 + p2) +
        2.5 * Math.sin((x + y) / 21 + p3) +
        1.2 * Math.sin(x / 5.3 + p2) * Math.sin(y / 6.1 + p1);
      course.elevation[idx(course, x, y)] = e;
    }
  }
}

export function flattenUnder(course, x0, y0, w, h) {
  // average the pad, then set it flat — buildings and tee pads don't tilt
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!inBounds(course, x, y)) continue;
      sum += course.elevation[idx(course, x, y)];
      n++;
    }
  }
  const avg = n ? sum / n : 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (inBounds(course, x, y)) course.elevation[idx(course, x, y)] = avg;
    }
  }
}

export function buildStartingCourse(rng) {
  const course = makeCourse();
  shapeElevation(course, rng);

  // rough halo first, then fairways carve through it
  for (const spec of HOLES) {
    paintCorridor(course, corridorPoints(spec), 4.6, ZONE.ROUGH, rng);
    paintDisk(course, spec.pin.x, spec.pin.y, 4.5, ZONE.ROUGH);
    paintDisk(course, spec.tee.x, spec.tee.y, 3.5, ZONE.ROUGH);
  }
  for (const spec of HOLES) {
    paintCorridor(course, corridorPoints(spec), 2.3, ZONE.FAIRWAY, rng);
  }

  // holes: tee pads, greens, pins
  const holes = [];
  for (const spec of HOLES) {
    const hole = addHole(course);
    paintDisk(course, spec.tee.x, spec.tee.y, 1.4, ZONE.TEE);
    paintDisk(course, spec.pin.x, spec.pin.y, 1.9, ZONE.GREEN);
    // slight green-complex mounding
    for (let y = spec.pin.y - 3; y <= spec.pin.y + 3; y++) {
      for (let x = spec.pin.x - 3; x <= spec.pin.x + 3; x++) {
        if (!inBounds(course, x, y)) continue;
        const d = Math.hypot(x - spec.pin.x, y - spec.pin.y);
        course.elevation[idx(course, x, y)] += clamp(1.5 - d * 0.4, 0, 1.5);
      }
    }
    hole.tee = { ...spec.tee };
    hole.pin = { ...spec.pin };
    hole.status = HOLE_STATUS.OPEN;
    hole.everOpen = true;
    holes.push(hole);
  }

  // bunkers: greenside sand at a handful of holes (a muni, not Oakmont)
  const bunkerAt = [
    { hole: 0, dx: -2, dy: -3 },
    { hole: 2, dx: 3, dy: 2 },
    { hole: 3, dx: -3, dy: -2 },
    { hole: 5, dx: -2, dy: 3 },
    { hole: 6, dx: 3, dy: -2 },
    { hole: 8, dx: -3, dy: 2 },
  ];
  const sandable = new Set([ZONE.ROUGH, ZONE.FAIRWAY]);
  for (const b of bunkerAt) {
    const pin = HOLES[b.hole].pin;
    paintDisk(course, pin.x + b.dx, pin.y + b.dy, 1.3, ZONE.BUNKER, { onlyOver: sandable });
  }

  // the pond hole 5 carries over
  paintEllipse(course, POND, ZONE.WATER);

  // clubhouse pad: flat, out of play, structure on top
  flattenUnder(course, CLUBHOUSE.x - 1, CLUBHOUSE.y - 1, CLUBHOUSE.w + 2, CLUBHOUSE.h + 2);
  for (let y = CLUBHOUSE.y; y < CLUBHOUSE.y + CLUBHOUSE.h; y++) {
    for (let x = CLUBHOUSE.x; x < CLUBHOUSE.x + CLUBHOUSE.w; x++) {
      setZone(course, x, y, ZONE.OUT);
    }
  }
  course.structures.push({ ...CLUBHOUSE });

  // flatten tee pads last so they sit level
  for (const spec of HOLES) {
    flattenUnder(course, spec.tee.x - 1, spec.tee.y - 1, 3, 3);
  }

  return course;
}

function paintEllipse(course, { x: cx, y: cy, rx, ry }, zone) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (!inBounds(course, x, y)) continue;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) setZone(course, x, y, zone);
    }
  }
}
