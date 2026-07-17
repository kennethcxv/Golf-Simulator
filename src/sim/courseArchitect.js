// GOLF EMPIRE — the course architect: designs a nine-hole parkland property
// as VECTORS (courseVec schema), then derives the sim grid, terrain program,
// cart-path network, and an intentional planting plan from the design.
//
// The routing is an authored template — two loops off the clubhouse like a
// real parkland nine — with seeded jitter so no two properties are identical:
//
//   H1 par 4  gentle dogleg-R, uphill, fairway bunker at the landing
//   H2 par 3  mid-length, elevated tee dropping to a defended green
//   H3 par 5  sweeping along the northern ridge, cross bunker
//   H4 par 4  strong dogleg-left elbow back to the clubhouse
//   H5 par 4  water risk/reward — pond guards the right approach
//   H6 par 3  short, ringed by pot bunkers
//   H7 par 5  long downhill roller with staggered fairway bunkers
//   H8 par 3  mid, through a forest glade
//   H9 par 4  finisher returning to the clubhouse lawn
//
// Everything is deterministic from the rng passed in.

import { ZONE, CELL_YD, HOLE_STATUS, GRID_W, GRID_H } from './constants.js';
import { makeCourse, addHole, idx, inBounds, getZone } from './course.js';
import {
  emptyVec, makeVecTee, makeVecGreen, makeVecBunker, makeVecPond,
  deriveZones, sampleOpen, polyLength, alongPoly, ensurePaint, invalidateGeom,
} from './courseVec.js';
import { clamp } from '../core/utils.js';

// ------------------------------------------------------------ the template ----

// Cell coordinates (1 cell = 8 yd) on the 120×80 property. y grows south.
const TEMPLATE = [
  {
    name: 'Opening Drive', par: 4, hcp: 4, roughW: 26,
    line: [[18.75, 38.75], [36.25, 34.0], [53.75, 32.25], [71.25, 36.25]],
    width: [[0.05, 9], [0.18, 13], [0.55, 19], [0.72, 13.5], [0.88, 14], [1, 15]],
    green: { r: 12, elong: 1.3 },
    bunkers: [
      { at: [54.4, 36.9], r: 7.5, depth: 2.2 },          // right of the landing
      { at: [68.3, 33.6], r: 6.0, depth: 2.6 },          // greenside left
    ],
  },
  {
    name: 'The Overlook', par: 3, hcp: 7, roughW: 22,
    line: [[76.25, 33.75], [86.5, 31.5], [96.9, 30.0]],
    width: [[0, 5], [1, 7]],
    green: { r: 13.5, elong: 1.2 },
    bunkers: [
      { at: [94.2, 28.4], r: 6.0, depth: 2.8 },
      { at: [97.6, 32.2], r: 5.2, depth: 2.4 },
    ],
    teeKnoll: 7,
  },
  {
    name: 'Long Meadow', par: 5, hcp: 2, roughW: 28,
    line: [[101.25, 25.6], [96.25, 18.75], [77.5, 16.5], [58.75, 18.75], [41.25, 21.5]],
    width: [[0.04, 9], [0.16, 13], [0.42, 18.5], [0.58, 13], [0.74, 17], [0.9, 13.5], [1, 14.5]],
    green: { r: 11.5, elong: 1.35 },
    bunkers: [
      { at: [88.0, 15.6], r: 8.0, depth: 2.2 },          // first landing right
      { at: [56.2, 20.1], r: 9.0, depth: 2.0, stretch: 1.7 }, // cross bunker
      { at: [44.5, 23.1], r: 6.5, depth: 2.7 },          // greenside front-left
    ],
  },
  {
    name: 'The Elbow', par: 4, hcp: 5, roughW: 24,
    line: [[40.5, 17.4], [27.5, 20.9], [18.9, 27.5], [16.9, 34.4], [23.1, 38.75]],
    width: [[0.05, 8.5], [0.2, 12.5], [0.48, 17], [0.7, 12], [1, 14]],
    green: { r: 12, elong: 1.25 },
    bunkers: [
      { at: [24.9, 24.6], r: 7.5, depth: 2.3 },          // inside the elbow
      { at: [20.2, 36.6], r: 5.6, depth: 2.6 },
    ],
    strongDogleg: true,
  },
  {
    name: 'Millpond', par: 4, hcp: 1, roughW: 26,
    line: [[23.1, 49.4], [40.0, 53.75], [57.5, 56.0], [75.0, 58.75]],
    width: [[0.05, 9], [0.2, 13.5], [0.55, 19.5], [0.75, 13], [1, 14.5]],
    green: { r: 12, elong: 1.3 },
    bunkers: [
      { at: [40.6, 51.0], r: 8.0, depth: 2.2 },          // landing left — bail-out costs you
      { at: [77.6, 60.6], r: 6.0, depth: 2.5 },
    ],
    pond: { at: [64.4, 61.2], rx: 42, ry: 27 },          // guards the right approach
  },
  {
    name: 'Short Iron', par: 3, hcp: 9, roughW: 20,
    line: [[80.0, 62.5], [87.0, 64.2], [94.4, 66.25]],
    width: [[0, 4.5], [1, 6.5]],
    green: { r: 13, elong: 1.15 },
    bunkers: [
      { at: [91.7, 65.1], r: 4.6, depth: 3.0 },          // pot ring
      { at: [93.0, 67.8], r: 4.2, depth: 3.0 },
      { at: [96.1, 64.0], r: 4.4, depth: 3.0 },
    ],
  },
  {
    name: 'Cascades', par: 5, hcp: 3, roughW: 28,
    line: [[100.0, 68.1], [83.1, 71.9], [65.0, 71.0], [48.75, 68.1], [35.0, 65.0]],
    width: [[0.04, 9], [0.15, 13], [0.4, 18], [0.56, 13.5], [0.72, 17.5], [0.88, 13], [1, 14.5]],
    green: { r: 11.5, elong: 1.4 },
    bunkers: [
      { at: [82.4, 69.6], r: 8.0, depth: 2.2 },          // staggered pair —
      { at: [62.0, 73.3], r: 7.5, depth: 2.2 },          // pick a side to attack
      { at: [37.8, 66.6], r: 6.2, depth: 2.6 },
    ],
    rollers: true,
  },
  {
    name: 'The Glade', par: 3, hcp: 8, roughW: 21,
    line: [[33.1, 61.9], [41.5, 56.5], [50.5, 50.4]],
    width: [[0, 4.5], [1, 6.5]],
    green: { r: 13, elong: 1.2 },
    bunkers: [
      { at: [47.6, 52.6], r: 5.6, depth: 2.6 },
      { at: [52.9, 48.4], r: 5.0, depth: 2.4 },
    ],
  },
  {
    name: 'Homeward', par: 4, hcp: 6, roughW: 25,
    line: [[65.0, 48.75], [47.5, 43.8], [31.25, 42.75], [20.0, 45.0]],
    width: [[0.05, 9], [0.2, 13], [0.52, 18.5], [0.74, 12.5], [1, 14.5]],
    green: { r: 12.5, elong: 1.3 },
    bunkers: [
      { at: [23.4, 42.6], r: 6.2, depth: 2.5 },
      { at: [21.4, 47.5], r: 5.4, depth: 2.4 },
    ],
  },
];

const CLUBHOUSE = { type: 'clubhouse', x: 12, y: 38, w: 6, h: 5 };

// ---------------------------------------------------------------- helpers ----

function fbm(x, y) {
  const h = (xx, yy) => {
    const s = Math.sin(xx * 127.1 + yy * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const vn = (xx, yy) => {
    const ix = Math.floor(xx);
    const iy = Math.floor(yy);
    const fx = xx - ix;
    const fy = yy - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return (h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * ux) * (1 - uy)
      + (h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * ux) * uy;
  };
  return vn(x, y) * 0.62 + vn(x * 2.07 + 13.1, y * 2.07 - 7.7) * 0.26 + vn(x * 4.3 - 3.3, y * 4.3 + 9.9) * 0.12;
}

// ------------------------------------------------------------- the designer ----

export function designCourse(rng, opts = {}) {
  const jitterAmp = opts.jitter ?? 0.35;
  // feature levers let one builder span a quality range: a pristine parkland
  // nine (all features) down to a modest muni (few bunkers, no water, flat).
  const bunkerBudget = opts.bunkerBudget ?? Infinity; // cap total bunkers placed
  const includeWater = opts.water ?? true;
  const greenSizeMul = opts.greenSizeMul ?? 1;
  const moundMul = opts.moundMul ?? 1; // land movement scale
  let bunkersPlaced = 0;
  const course = makeCourse(GRID_W, GRID_H);
  const vec = emptyVec(1 + Math.floor(rng.next() * 100000));
  course.vec = vec;
  ensurePaint(course);

  const J = (amp = jitterAmp) => (rng.next() - 0.5) * 2 * amp;

  // ---- 1. authored holes → vectors
  const designed = [];
  for (let i = 0; i < TEMPLATE.length; i++) {
    const t = TEMPLATE[i];
    // jitter interior waypoints only — tees and greens anchor the routing
    const line = t.line.map(([x, y], k) => (
      k === 0 || k === t.line.length - 1
        ? { x: x + J(0.15), y: y + J(0.15) }
        : { x: x + J(0.8), y: y + J(0.8) }
    ));
    const first = line[0];
    const second = line[1];
    const last = line[line.length - 1];
    const prev = line[line.length - 2];
    const aimA = Math.atan2(second.y - first.y, second.x - first.x);
    const appA = Math.atan2(last.y - prev.y, last.x - prev.x);

    const vh = {
      id: vec.nextId++,
      name: t.name,
      par: t.par,
      hcp: t.hcp,
      roughW: t.roughW + J(2),
      line,
      width: t.par === 3 ? null : t.width.map(([tt, w]) => ({ t: tt, w: w + J(0.8) })),
      apron: t.par === 3 ? t.width.map(([tt, w]) => ({ t: tt, w })) : null,
      tees: [],
      green: null,
      bunkers: [],
      mowPhase: rng.next() * Math.PI * 2,
    };

    // par-3 walk apron still renders as a slim fairway ribbon
    if (vh.apron) vh.width = vh.apron.map((s) => ({ t: s.t, w: s.w }));

    // tee complex: back / middle / forward marching down the line of play
    const lineSampled = sampleOpen(line, 0.4);
    const lenC = polyLength(lineSampled);
    const teeAt = (distC, tier, w, d, raise) => {
      const p = alongPoly(lineSampled, clamp(distC / lenC, 0, 0.3));
      const rot = Math.atan2(p.ty, p.tx);
      const tee = makeVecTee(p.x, p.y, rot, tier, w, d);
      tee.raise = raise;
      vh.tees.push(tee);
    };
    teeAt(0, 'back', 7.5 + J(0.5), 9.5 + J(0.5), 1.6);
    teeAt(2.2 + J(0.3), 'middle', 8, 10, 1.2);
    teeAt(4.6 + J(0.4), 'forward', 8, 9, 0.9);

    // green complex, oriented across the approach
    const gr = t.green.r * greenSizeMul + J(1.0);
    const gAngle = appA + Math.PI / 2 + J(0.3);
    const green = makeVecGreen(last.x, last.y, gr, t.green.elong + J(0.08), gAngle, vec.seed + i * 13);
    green.raise = 1.5 + rng.next() * 0.7;
    green.tiltA = appA + Math.PI + J(0.5); // greens tilt back toward the approach
    green.tilt = 0.2 + rng.next() * 0.15;
    // pins A/B/C spread across the surface
    const gca = Math.cos(gAngle);
    const gsa = Math.sin(gAngle);
    const rc = (gr / CELL_YD);
    green.pins = [
      { x: last.x, y: last.y },
      { x: last.x + gca * rc * 0.5, y: last.y + gsa * rc * 0.5 },
      { x: last.x - gca * rc * 0.45 - gsa * rc * 0.3, y: last.y - gsa * rc * 0.45 + gca * rc * 0.3 },
    ];
    vh.green = green;

    for (let b = 0; b < t.bunkers.length; b++) {
      if (bunkersPlaced >= bunkerBudget) break; // low-quality courses carry fewer traps
      const spec = t.bunkers[b];
      const bunk = makeVecBunker(
        spec.at[0] + J(0.4), spec.at[1] + J(0.4), spec.r + J(0.8),
        vec.seed * 7 + i * 31 + b * 11,
        { depth: spec.depth, lobes: 2 + Math.floor(rng.next() * 3), stretch: spec.stretch || 1 },
      );
      vh.bunkers.push(bunk);
      bunkersPlaced++;
    }

    if (t.pond && includeWater) {
      vec.waters.push({
        id: vec.nextId++,
        ...makeVecPond(t.pond.at[0] + J(0.5), t.pond.at[1] + J(0.3), t.pond.rx, t.pond.ry, vec.seed + 91 + i),
      });
    }
    if (t.teeKnoll) {
      vec.mounds.push({ id: vec.nextId++, x: first.x, y: first.y, r: 3.4, h: t.teeKnoll });
    }
    if (t.rollers && moundMul > 0.5) {
      for (let k = 0; k < 3; k++) {
        const p = alongPoly(lineSampled, 0.25 + k * 0.22);
        vec.mounds.push({
          id: vec.nextId++,
          x: p.x - p.ty * (2.6 + J(1)), y: p.y + p.tx * (2.6 + J(1)),
          r: 2.6 + rng.next() * 1.4, h: (1.6 + rng.next() * 1.2) * moundMul,
        });
      }
    }
    // backstop mounds framing every green complex
    if (moundMul > 0.35) {
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? 1 : -1;
        vec.mounds.push({
          id: vec.nextId++,
          x: last.x + Math.cos(appA) * 2.4 + Math.cos(appA + Math.PI / 2) * side * 1.7 + J(0.5),
          y: last.y + Math.sin(appA) * 2.4 + Math.sin(appA + Math.PI / 2) * side * 1.7 + J(0.5),
          r: 1.9 + rng.next() * 0.9, h: (1.4 + rng.next() * 1.1) * moundMul,
        });
      }
    }

    vec.holes.push(vh);
    designed.push({ t, vh, lineSampled, lenC, aimA, appA });
  }

  // a scenic pond in the north-east elbow between H2's green and H3's tee
  if (includeWater) {
    vec.waters.push({
      id: vec.nextId++,
      ...makeVecPond(106.5 + J(0.8), 21.8 + J(0.6), 16, 12, vec.seed + 777),
    });
  }

  // clubhouse landscaping beds + the practice putting lawn
  vec.beds.push({
    id: vec.nextId++,
    pts: [
      { x: CLUBHOUSE.x - 1.2, y: CLUBHOUSE.y - 1.4 }, { x: CLUBHOUSE.x + 3, y: CLUBHOUSE.y - 2.0 },
      { x: CLUBHOUSE.x + 6.5, y: CLUBHOUSE.y - 1.5 }, { x: CLUBHOUSE.x + 4, y: CLUBHOUSE.y - 0.6 },
      { x: CLUBHOUSE.x + 1, y: CLUBHOUSE.y - 0.5 },
    ],
  });
  vec.lawns = [{ x: CLUBHOUSE.x - 2.6, y: CLUBHOUSE.y + 3.4, rot: 0.3, w: 18, d: 14, tier: 'lawn' }];

  // ---- 2. base terrain: regional tilt + rolling fBm, graded under corridors
  const { w, h } = course;
  const elev = course.elevation;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tilt = ((x / w) * 0.62 + (1 - y / h) * 0.38 - 0.42) * (opts.elevAmp ?? 1) * 17;
      const roll = (fbm(x * 0.052 + vec.seed * 0.13, y * 0.052) - 0.5) * 9
        + (fbm(x * 0.16 + 31, y * 0.16 - 17) - 0.5) * 2.6;
      elev[y * w + x] = tilt + roll;
    }
  }
  // corridor grading: pull land toward the smoothed centerline height so
  // fairways roll along the line of play instead of leaning across it
  const target = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  for (const d of designed) {
    const n = Math.ceil(d.lenC / 0.5);
    const lineH = [];
    for (let i = 0; i <= n; i++) {
      const p = alongPoly(d.lineSampled, i / n);
      const cx = clamp(Math.round(p.x), 0, w - 1);
      const cy = clamp(Math.round(p.y), 0, h - 1);
      lineH.push(elev[cy * w + cx]);
    }
    // moving average → the long-profile the hole plays over
    const sm = lineH.map((_, i) => {
      let s = 0, c = 0;
      for (let k = -6; k <= 6; k++) {
        const j = i + k;
        if (j < 0 || j >= lineH.length) continue;
        s += lineH[j];
        c++;
      }
      return s / c;
    });
    for (let i = 0; i <= n; i++) {
      const p = alongPoly(d.lineSampled, i / n);
      const R = 4.2;
      for (let yy = Math.floor(p.y - R); yy <= Math.ceil(p.y + R); yy++) {
        for (let xx = Math.floor(p.x - R); xx <= Math.ceil(p.x + R); xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const dd = Math.hypot(xx + 0.5 - p.x, yy + 0.5 - p.y);
          if (dd > R) continue;
          const k = (1 - dd / R);
          const o = yy * w + xx;
          target[o] += sm[i] * k;
          weight[o] += k;
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (weight[i] > 0) {
      const t = target[i] / weight[i];
      elev[i] += (t - elev[i]) * 0.6;
    }
  }
  // clubhouse pad sits dead level
  {
    const cx = CLUBHOUSE.x + CLUBHOUSE.w / 2;
    const cy = CLUBHOUSE.y + CLUBHOUSE.h / 2;
    const padH = elev[Math.round(cy) * w + Math.round(cx)];
    for (let y = CLUBHOUSE.y - 2; y < CLUBHOUSE.y + CLUBHOUSE.h + 3; y++) {
      for (let x = CLUBHOUSE.x - 2; x < CLUBHOUSE.x + CLUBHOUSE.w + 3; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const dd = Math.max(Math.abs(x + 0.5 - cx) - CLUBHOUSE.w / 2, Math.abs(y + 0.5 - cy) - CLUBHOUSE.h / 2);
        const k = clamp(1 - dd / 3, 0, 1);
        const o = y * w + x;
        elev[o] += (padH - elev[o]) * k;
      }
    }
  }

  // ---- 3. structures + cart-path network
  course.structures.push({ ...CLUBHOUSE });

  const pathPts = [];
  const push = (x, y) => {
    const p = { x, y };
    if (!pathPts.length || Math.hypot(p.x - pathPts[pathPts.length - 1].x, p.y - pathPts[pathPts.length - 1].y) > 2.4) {
      pathPts.push(p);
    }
  };
  // start at the clubhouse cart staging
  push(CLUBHOUSE.x + CLUBHOUSE.w + 0.8, CLUBHOUSE.y + CLUBHOUSE.h - 0.6);
  const courseCx = 60;
  const courseCy = 40;
  for (let i = 0; i < designed.length; i++) {
    const d = designed[i];
    const n = 12;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = alongPoly(d.lineSampled, t);
      // the path ALWAYS rides the OUTWARD side of the hole (away from the course
      // interior, toward the boundary forest) so it never crosses another
      // fairway. Pick the corridor-perpendicular sign that points away from the
      // course centre.
      const nx = -p.ty; // corridor normal (one side)
      const ny = p.tx;
      const outward = (p.x - courseCx) * nx + (p.y - courseCy) * ny >= 0 ? 1 : -1;
      const fwHalf = d.vh.width ? d.vh.width.reduce((mx, s) => Math.max(mx, s.w), 0) / CELL_YD : 3;
      const off = outward * (fwHalf + (d.vh.roughW / CELL_YD) * 0.5 + 0.8 + Math.sin(t * 3.6 + i) * 0.3);
      // pull in tight at the tee and the green so carts actually arrive
      const pull = t < 0.06 || t > 0.94 ? 0.4 : 1;
      push(p.x + nx * off * pull, p.y + ny * off * pull);
    }
  }
  // home leg back to the clubhouse
  push(CLUBHOUSE.x + CLUBHOUSE.w + 2.4, CLUBHOUSE.y + CLUBHOUSE.h + 1.8);
  const loop = {
    id: course.nextPathId++,
    pts: pathPts.map((p) => ({ x: clamp(p.x, 2, w - 3), y: clamp(p.y, 2, h - 3) })),
    width: 3.4,
    material: 'asphalt',
  };
  course.paths.push(loop);

  // ---- 4. back-compat hole records (golfers, sections, saves, editor) —
  // BEFORE deriveZones so the tee/pin anchors get stamped into the grid
  for (let i = 0; i < designed.length; i++) {
    const d = designed[i];
    const hole = addHole(course);
    const back = d.vh.tees[0];
    hole.tee = { x: Math.round(back.x), y: Math.round(back.y) };
    hole.pin = { x: Math.round(d.vh.green.pins[0].x), y: Math.round(d.vh.green.pins[0].y) };
    hole.wp = d.vh.line.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
    hole.status = HOLE_STATUS.OPEN;
    hole.everOpen = true;
    hole.name = d.vh.name;
    hole.handicap = d.vh.hcp;
    hole.parOverride = d.vh.par;
    hole.vecId = d.vh.id;
    hole.tees = {
      back: { x: Math.round(d.vh.tees[0].x), y: Math.round(d.vh.tees[0].y) },
      middle: { x: Math.round(d.vh.tees[1].x), y: Math.round(d.vh.tees[1].y) },
      forward: { x: Math.round(d.vh.tees[2].x), y: Math.round(d.vh.tees[2].y) },
    };
    hole.activeTee = 'back';
    hole.pins = {
      A: { x: Math.round(d.vh.green.pins[0].x), y: Math.round(d.vh.green.pins[0].y) },
      B: { x: Math.round(d.vh.green.pins[1].x), y: Math.round(d.vh.green.pins[1].y) },
      C: { x: Math.round(d.vh.green.pins[2].x), y: Math.round(d.vh.green.pins[2].y) },
    };
    hole.activePin = 'A';
  }

  // ---- 5. zones from the vectors
  invalidateGeom(course);
  deriveZones(course);

  // ---- 6. planting + props
  plantProperty(course, designed, rng);

  return course;
}

// ------------------------------------------------------------- vegetation ----

const IN_PLAY = new Set([
  ZONE.ROUGH, ZONE.FAIRWAY, ZONE.GREEN, ZONE.TEE, ZONE.BUNKER,
  ZONE.WATER, ZONE.PATH, ZONE.FRINGE, ZONE.SEMI, ZONE.BED,
]);

function playDistance(course, cap = 8) {
  const { w, h, zones } = course;
  const dist = new Int8Array(w * h).fill(cap);
  const queue = [];
  for (let i = 0; i < w * h; i++) {
    if (IN_PLAY.has(zones[i])) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const d = dist[i];
    if (d >= cap) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

const FOREST_MIX = [
  ['fill_a', 0.26], ['fill_b', 0.22], ['oak_b', 0.14], ['oak_a', 0.08],
  ['maple_a', 0.08], ['pine_a', 0.08], ['pine_b', 0.06], ['spruce_a', 0.04],
  ['birch_a', 0.03], ['shade_a', 0.01],
];

function pickSpecies(rng, mix) {
  let r = rng.next();
  for (const [id, p] of mix) {
    r -= p;
    if (r <= 0) return id;
  }
  return mix[0][0];
}

function structureClear(course, x, y, pad = 2.5) {
  for (const s of course.structures) {
    if (x >= s.x - pad && x <= s.x + s.w + pad && y >= s.y - pad && y <= s.y + s.h + pad + 1.5) return false;
  }
  return true;
}

function addObj(course, type, x, y, rot, scale) {
  if (!inBounds(course, Math.round(x), Math.round(y))) return null;
  const o = { id: course.nextObjectId++, type, x, y, rot, scale };
  course.objects.push(o);
  return o;
}

function plantable(course, x, y, waterClear = null) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const z = getZone(course, cx, cy);
  if (z !== ZONE.OUT && z !== ZONE.HEAVY && z !== ZONE.ROUGH) return false;
  if (!structureClear(course, x, y)) return false;
  // keep tall canopy off the shoreline so ponds reflect sky, not dark trees
  if (waterClear && waterClear[cy * course.w + cx]) return false;
  return true;
}

// cells within `r` of any water cell — trees stay out so shorelines stay open
function waterClearField(course, r = 2) {
  const { w, h, zones } = course;
  const field = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (zones[y * w + x] !== ZONE.WATER) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) field[ny * w + nx] = 1;
        }
      }
    }
  }
  return field;
}

function plantProperty(course, designed, rng) {
  const { w, h } = course;
  const dist = playDistance(course, 8);
  const waterClear = waterClearField(course, 2);

  // regional species character: pine belts vs broadleaf, from low-freq noise
  const beltNoise = (x, y) => fbm(x * 0.045 + 71.3, y * 0.045 - 23.7);

  // 1. deep forest — the property IS a forest with golf carved out of it
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const d = dist[y * w + x];
      if (d < 3) continue;
      const clearing = fbm(x * 0.075 + 7.7, y * 0.075 + 3.3);
      if (clearing < 0.34 && d < 6) continue;         // meadows near play, never deep voids
      const dens = d >= 5 ? 0.62 : d >= 4 ? 0.5 : 0.34;
      if (rng.next() > dens) continue;
      const px = x + (rng.next() - 0.5) * 0.9;
      const py = y + (rng.next() - 0.5) * 0.9;
      if (!plantable(course, px, py, waterClear)) continue;
      const belt = beltNoise(x, y);
      let type;
      if (belt > 0.62) type = pickSpecies(rng, [['pine_a', 0.42], ['pine_b', 0.28], ['spruce_a', 0.2], ['fill_a', 0.1]]);
      else if (belt < 0.3 && fbm(x * 0.2, y * 0.2) > 0.55) type = pickSpecies(rng, [['birch_a', 0.6], ['fill_b', 0.4]]);
      else type = pickSpecies(rng, FOREST_MIX);
      addObj(course, type, px, py, rng.next() * Math.PI * 2, 0.85 + rng.next() * 0.5);
    }
  }

  // 2. corridor walls — tree lines separating holes, with runs and gaps
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const d = dist[y * w + x];
      if (d < 1 || d > 2) continue;
      const gate = Math.sin(x * 0.52 + y * 0.29) + Math.sin(x * 0.16 - y * 0.41);
      if (gate < 0.35 || rng.next() > 0.55) continue;
      const px = x + (rng.next() - 0.5) * 0.8;
      const py = y + (rng.next() - 0.5) * 0.8;
      if (!plantable(course, px, py, waterClear)) continue;
      const belt = beltNoise(x, y);
      const type = belt > 0.62
        ? pickSpecies(rng, [['pine_a', 0.5], ['pine_b', 0.3], ['spruce_a', 0.2]])
        : pickSpecies(rng, [['oak_b', 0.3], ['fill_a', 0.3], ['maple_a', 0.2], ['oak_a', 0.2]]);
      addObj(course, type, px, py, rng.next() * Math.PI * 2, 0.9 + rng.next() * 0.45);
    }
  }

  // 3. specimen trees defending dogleg corners
  for (const d of designed) {
    const wps = d.vh.line.slice(1, -1);
    for (const wp of wps) {
      if (rng.next() > 0.75) continue;
      const a = rng.next() * Math.PI * 2;
      const r = 3.2 + rng.next() * 1.2;
      const px = wp.x + Math.cos(a) * r;
      const py = wp.y + Math.sin(a) * r;
      if (!plantable(course, px, py, waterClear)) continue;
      addObj(course, rng.next() < 0.6 ? 'oak_a' : 'shade_a', px, py, rng.next() * Math.PI * 2, 1.25 + rng.next() * 0.3);
    }
  }

  // 4. green-complex framing: a stand behind every green
  for (const d of designed) {
    const g = d.vh.green;
    const back = d.appA;
    for (let k = 0; k < 3; k++) {
      const a = back + (rng.next() - 0.5) * 1.5;
      const r = 3.0 + rng.next() * 1.8;
      const px = g.cx + Math.cos(a) * r;
      const py = g.cy + Math.sin(a) * r;
      if (!plantable(course, px, py, waterClear)) continue;
      addObj(course, pickSpecies(rng, [['oak_a', 0.3], ['maple_a', 0.3], ['pine_a', 0.2], ['oak_b', 0.2]]),
        px, py, rng.next() * Math.PI * 2, 1.05 + rng.next() * 0.35);
    }
  }

  // 5. clubhouse landscaping: ornamentals + shrubs + the arrival garden
  const ch = course.structures[0];
  for (let k = 0; k < 6; k++) {
    const px = ch.x - 1.5 + rng.next() * (ch.w + 3);
    const py = ch.y - 2.2 + rng.next() * 1.2;
    addObj(course, k % 2 ? 'flower_a' : 'shrub_flower', px, py, rng.next() * Math.PI * 2, 0.9 + rng.next() * 0.3);
  }
  for (let k = 0; k < 8; k++) {
    const a = rng.next() * Math.PI * 2;
    addObj(course, 'shrub_round', ch.x + ch.w / 2 + Math.cos(a) * (4.2 + rng.next() * 1.5),
      ch.y + ch.h / 2 + Math.sin(a) * (3.6 + rng.next() * 1.2), rng.next() * Math.PI * 2, 0.85 + rng.next() * 0.35);
  }

  // 6. water dressing: reeds, shoreline rocks, native bushes
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (getZone(course, x, y) === ZONE.WATER) continue;
      let shore = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (getZone(course, x + dx, y + dy) === ZONE.WATER) { shore = true; break; }
      }
      if (!shore) continue;
      if (rng.next() < 0.5) {
        addObj(course, 'reed_clump', x + (rng.next() - 0.5) * 0.7, y + (rng.next() - 0.5) * 0.7,
          rng.next() * Math.PI * 2, 0.9 + rng.next() * 0.5);
      }
      if (rng.next() < 0.2) {
        addObj(course, 'shore_rock', x + (rng.next() - 0.5) * 0.8, y + (rng.next() - 0.5) * 0.8,
          rng.next() * Math.PI * 2, 0.8 + rng.next() * 0.7);
      }
      if (rng.next() < 0.12 && plantable(course, x, y)) {
        addObj(course, 'bush_native', x, y, rng.next() * Math.PI * 2, 0.9 + rng.next() * 0.4);
      }
    }
  }

  // 7. native texture in the heavy band: bushes, grass clumps, the odd boulder
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (getZone(course, x, y) !== ZONE.HEAVY) continue;
      const r = rng.next();
      if (r < 0.05) addObj(course, 'bush_native', x + J2(rng), y + J2(rng), rng.next() * 6.28, 0.85 + rng.next() * 0.5);
      else if (r < 0.16) addObj(course, 'grass_clump', x + J2(rng), y + J2(rng), rng.next() * 6.28, 0.9 + rng.next() * 0.6);
      else if (r < 0.168) addObj(course, 'boulder_a', x + J2(rng), y + J2(rng), rng.next() * 6.28, 0.7 + rng.next() * 0.6);
    }
  }

  // 8. golf furniture: tee signs, markers, benches, washers, yardage plates
  for (let i = 0; i < designed.length; i++) {
    const d = designed[i];
    const tees = d.vh.tees;
    const back = tees[0];
    const ca = Math.cos(back.rot);
    const sa = Math.sin(back.rot);
    // tee sign beside the back tee, facing the walk-on
    addObj(course, 'tee_sign', back.x - sa * 1.5 - ca * 0.6, back.y + ca * 1.5 - sa * 0.6, back.rot + Math.PI / 2, 1);
    const markerFor = { back: 'tee_marker_blue', middle: 'tee_marker_gold', forward: 'tee_marker_red' };
    for (const tee of tees) {
      const mw = (tee.w / CELL_YD) * 0.36;
      const mca = Math.cos(tee.rot);
      const msa = Math.sin(tee.rot);
      addObj(course, markerFor[tee.tier] || 'tee_marker_gold', tee.x - msa * mw, tee.y + mca * mw, tee.rot, 1);
      addObj(course, markerFor[tee.tier] || 'tee_marker_gold', tee.x + msa * mw, tee.y - mca * mw, tee.rot, 1);
    }
    if (rng.next() < 0.6) addObj(course, 'bench_course', back.x - sa * 2.1 + ca * 1.2, back.y + ca * 2.1 + sa * 1.2, back.rot + Math.PI, 1);
    if (rng.next() < 0.5) addObj(course, 'ball_washer', back.x - sa * 1.9 + ca * 2.0, back.y + ca * 1.9 + sa * 2.0, 0, 1);
    if (rng.next() < 0.4) addObj(course, 'trash_course', back.x - sa * 2.3 + ca * 2.6, back.y + ca * 2.3 + sa * 2.6, 0, 1);
    // 150-yd plate up the fairway
    if (d.vh.par >= 4) {
      const remain = 150 / CELL_YD;
      const t150 = clamp(1 - remain / d.lenC, 0.1, 0.95);
      const p = alongPoly(d.lineSampled, t150);
      addObj(course, 'yardage_marker', p.x - p.ty * 2.0, p.y + p.tx * 2.0, 0, 1);
    }
    // a rake resting beside some bunkers
    for (const b of d.vh.bunkers) {
      if (rng.next() > 0.45) continue;
      const p0 = b.pts[0];
      addObj(course, 'rake_prop', p0.x, p0.y, rng.next() * Math.PI * 2, 1);
    }
  }
}

function J2(rng) {
  return (rng.next() - 0.5) * 0.8;
}
