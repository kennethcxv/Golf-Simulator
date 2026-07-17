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
import {
  paintShapedCorridor, fairwayProfile, paintGreenComplex, paintTeeBox,
  paintBunkerBlob, splinePoints, pointAlong, shapeHoleElevation, finishCourse,
} from './courseShaping.js';

// Routing: two loops off the clubhouse at (56..62, 66..70). Real golf holes now:
// doglegs both ways, varied lengths and directions, never a row of parallels.
// wp = waypoints the fairway spline bends through (tee → ... → pin).
const HOLES = [
  // 1 · par 4 · gentle dogleg left away from the clubhouse
  { tee: { x: 53, y: 61 }, pin: { x: 20, y: 52 }, wp: [{ x: 42, y: 60 }, { x: 30, y: 57 }] },
  // 2 · par 3 · short drop down the west side
  { tee: { x: 16, y: 47 }, pin: { x: 11, y: 33 }, wp: [] },
  // 3 · par 4 · strong dogleg right climbing to the north plateau
  { tee: { x: 8, y: 27 }, pin: { x: 40, y: 12 }, wp: [{ x: 15, y: 19 }, { x: 27, y: 13 }] },
  // 4 · par 5 · the long S that dips through the upper middle of the property
  { tee: { x: 45, y: 6 }, pin: { x: 105, y: 17 }, wp: [{ x: 60, y: 16 }, { x: 78, y: 21 }, { x: 94, y: 13 }] },
  // 5 · par 3 · all carry over the pond
  { tee: { x: 108, y: 22 }, pin: { x: 105, y: 37 }, wp: [] },
  // 6 · par 4 · driving deep into the heart of the course
  { tee: { x: 101, y: 43 }, pin: { x: 63, y: 41 }, wp: [{ x: 88, y: 47 }, { x: 74, y: 46 }] },
  // 7 · par 4 · the long two-bend run home along the south valley
  { tee: { x: 60, y: 57 }, pin: { x: 10, y: 64 }, wp: [{ x: 44, y: 61 }, { x: 28, y: 67 }, { x: 17, y: 66 }] },
  // 8 · par 3 · the corner flick
  { tee: { x: 7, y: 70 }, pin: { x: 21, y: 75 }, wp: [] },
  // 9 · par 4 · rising finish to the clubhouse lawn
  { tee: { x: 26, y: 78 }, pin: { x: 58, y: 71 }, wp: [{ x: 38, y: 77 }, { x: 49, y: 74 }] },
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
  shapeHoleElevation(course, HOLES, rng);

  // rough halo first: a shaped, wobbling band each hole sits inside
  for (const spec of HOLES) {
    const pts = corridorPoints(spec);
    paintShapedCorridor(course, pts, (t) => 4.0 + Math.sin(t * 7) * 0.7, ZONE.ROUGH, rng, { wobble: 0.9 });
    paintDisk(course, spec.pin.x, spec.pin.y, 4.6, ZONE.ROUGH);
    paintDisk(course, spec.tee.x, spec.tee.y, 3.4, ZONE.ROUGH);
  }
  // fairways: spline centerlines with landing-zone swells and pinches
  for (const spec of HOLES) {
    const pts = corridorPoints(spec);
    const par = holeParOfSpec(spec);
    if (par === 3) {
      // par 3s carry no fairway — tee, rough, and the green complex
      continue;
    }
    paintShapedCorridor(course, pts, fairwayProfile(rng, par), ZONE.FAIRWAY, rng, {
      onlyOver: new Set([ZONE.ROUGH]),
      wobble: 0.8,
    });
  }

  // holes: shaped green complexes and squared tee boxes
  const holes = [];
  for (const spec of HOLES) {
    const hole = addHole(course);
    const prev = spec.wp && spec.wp.length ? spec.wp[spec.wp.length - 1] : spec.tee;
    const aimNext = spec.wp && spec.wp.length ? spec.wp[0] : spec.pin;
    paintGreenComplex(course, spec.pin.x, spec.pin.y, rng, {
      r: 1.55 + rng.next() * 0.35, // 10–14 cells: the design-rating sweet spot
      elong: 1.15 + rng.next() * 0.25,
      angle: Math.atan2(spec.pin.y - prev.y, spec.pin.x - prev.x) + Math.PI / 2,
      raise: 1.6,
    });
    paintTeeBox(course, spec.tee.x, spec.tee.y, aimNext.x, aimNext.y);
    hole.tee = { ...spec.tee };
    hole.pin = { ...spec.pin };
    hole.wp = (spec.wp || []).map((p) => ({ ...p })); // mow stripes bend through these
    hole.status = HOLE_STATUS.OPEN;
    hole.everOpen = true;
    holes.push(hole);
  }

  // bunkers: greenside sand plus fairway traps at the landing zones
  const sandable = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.SEMI]);
  const greenside = [
    { hole: 0, dx: -2.5, dy: -2.6 }, { hole: 2, dx: 3, dy: 2.2 }, { hole: 3, dx: -3, dy: -2.4 },
    { hole: 4, dx: -3.2, dy: 1.6 }, { hole: 5, dx: -2.2, dy: 3 }, { hole: 6, dx: 3, dy: -2.2 },
    { hole: 7, dx: 2.6, dy: -2.4 }, { hole: 8, dx: -3, dy: 2.2 },
  ];
  for (const b of greenside) {
    const pin = HOLES[b.hole].pin;
    paintBunkerBlob(course, pin.x + b.dx, pin.y + b.dy, rng, { r: 1.25 + rng.next() * 0.4, onlyOver: sandable });
  }
  for (const hIdx of [0, 3, 6]) {
    // a trap pinching the driving line
    const spec = HOLES[hIdx];
    const line = splinePoints(corridorPoints(spec), 1.5);
    const p = pointAlong(line, 0.55);
    const side = rng.chance(0.5) ? 1 : -1;
    paintBunkerBlob(course, p.x - p.ty * side * 2.6, p.y + p.tx * side * 2.6, rng, {
      r: 1.15 + rng.next() * 0.35, onlyOver: sandable,
    });
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

  // transition bands, cart paths, and intentional planting
  finishCourse(course, HOLES, rng, { density: 1 });

  // flatten tee pads last so they sit level
  for (const spec of HOLES) {
    flattenUnder(course, spec.tee.x - 1, spec.tee.y - 1, 3, 3);
  }

  return course;
}

// par by straight tee→pin distance — same bands course.js uses
function holeParOfSpec(spec) {
  const yd = Math.hypot(spec.pin.x - spec.tee.x, spec.pin.y - spec.tee.y) * 8;
  return yd <= 250 ? 3 : yd <= 470 ? 4 : 5;
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
