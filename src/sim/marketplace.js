// GOLF EMPIRE — the property marketplace: the roster of acquirable courses.
//
// A property record is plain serializable data. Its layout params + seed are
// enough to deterministically re-build the actual course grid at purchase time,
// so the listed design rating is REAL (computed by building the course and
// scoring it with the same courseDesignRating the live game uses), never a
// stored fiction. Condition is a seeding target the buy transaction realizes
// through the turf arrays. The hidden trueValue uses the same appraiseStats
// formula the live valuation (sim/valuation.js) uses, so "bought under true
// value" genuinely survives into resale — that is the good-judgment reward.

import { ZONE, HOLE_STATUS, GRID_H, GRID_W, CELL_YD } from './constants.js';
import {
  makeCourse, addHole, setZone, getZone, inBounds, idx,
  courseDesignRating, holePar, holeDistanceYd,
} from './course.js';
import {
  buildStartingCourse, paintDisk, paintCorridor, shapeElevation, flattenUnder,
} from './startingCourse.js';
import { makeRng, clamp } from '../core/utils.js';

// --- the shared appraisal core ------------------------------------------------
// Dollars a golf property is worth given its headline stats. Used to price the
// hidden trueValue at listing time AND (via sim/valuation.js) to appraise a
// live, owned property — one formula, so the marketplace can't lie.
//   monthlyNet is the trailing per-season (24-day) net — the game's "month".

export function round500(v) {
  return Math.round(v / 500) * 500;
}

export function appraiseStats({ size, design, condition, members = 0, reputation = 25, monthlyNet = 0 }) {
  const sizeF = Math.max(size, 4) / 9; // 1 for a 9-holer, 2 for a full 18; even a razed property keeps its acreage
  const land = 12000 * sizeF; // dirt, irrigation mains, buildings — the floor
  const quality = clamp(0.45 * design + 0.55 * condition, 1, 100);
  const course = Math.pow(quality, 1.18) * 220 * Math.pow(sizeF, 0.85);
  const business =
    members * 450 +
    Math.max(reputation - 20, 0) * 180 +
    clamp(monthlyNet, -12000 * sizeF, 30000 * sizeF) * 1.6;
  return Math.max(round500(land + course + business), round500(land * 0.5));
}

// --- the archetype roster ---------------------------------------------------------
// Hand-authored so each property has a DIFFERENT weak point — never one template
// scaled up and down. listingBias is how the seller prices against true value
// (the market contains both bargains and traps, on purpose).

const ARCHETYPES = [
  {
    id: 'willow-creek',
    name: 'Willow Creek Municipal',
    blurb: 'The classic muni fixer-upper: honest routing, three sick greens, and a crew of one. Good bones under the neglect.',
    size: 9,
    layout: { kind: 'willow' },
    condition: 46,
    sickGreens: 3,
    diseaseKind: 'dollarSpot',
    startingMembers: 22,
    startingReputation: 30,
    listingBias: 0.82,
  },
  {
    id: 'bent-pines',
    name: 'Bent Pines Golf Club',
    blurb: 'A genuinely superb routing left to rot — doglegs, real land movement, ten bunkers full of weeds. The agronomy is a crime scene; the architecture is not.',
    size: 9,
    layout: {
      kind: 'serpentine', margin: 8, bands: 6, roughR: 4.6, fairwayR: 2.3,
      greenR: 1.9, greenRJitter: 0.4, doglegChance: 0.55, bunkers: 10, ponds: 1, elevAmp: 1.2,
      parMix: [4, 3, 5, 4, 4, 3, 4, 5, 4],
    },
    condition: 30,
    sickGreens: 2,
    diseaseKind: 'dollarSpot',
    startingMembers: 7,
    startingReputation: 20,
    listingBias: 0.72,
  },
  {
    id: 'flatiron-meadows',
    name: 'Flatiron Meadows',
    blurb: 'Immaculately kept and dull as ditchwater: nine near-identical par 4s on a pool-table pancake, greens the size of parking lots. The mowing is the best thing about it.',
    size: 9,
    layout: {
      kind: 'serpentine', margin: 8, bands: 6, roughR: 4.4, fairwayR: 2.4,
      greenR: 2.7, greenRJitter: 0.2, doglegChance: 0.15, bunkers: 1, ponds: 0, elevAmp: 0.3,
      parMix: [4, 4, 4, 4, 4, 4, 4, 4, 4], parRange: { 4: [33, 46] },
    },
    condition: 74,
    sickGreens: 0,
    diseaseKind: 'dollarSpot',
    startingMembers: 26,
    startingReputation: 44,
    listingBias: 1.05,
  },
  {
    id: 'saltgrass-point',
    name: 'Saltgrass Point',
    blurb: 'A tight little executive nine in the coastal scrub — small fierce greens, wind, five proper pot bunkers. Cheap to run, loved by the people who know it.',
    size: 9,
    layout: {
      kind: 'serpentine', margin: 8, bands: 4, roughR: 4.2, fairwayR: 2.1,
      greenR: 1.35, greenRJitter: 0.25, doglegChance: 0.2, bunkers: 5, ponds: 0, elevAmp: 0.8,
      parMix: [3, 3, 4, 3, 3, 4, 3, 3, 4], parRange: { 3: [13, 25], 4: [33, 40] },
    },
    condition: 66,
    sickGreens: 0,
    diseaseKind: 'dollarSpot',
    startingMembers: 14,
    startingReputation: 36,
    listingBias: 0.88,
  },
  {
    id: 'thornbury-estate',
    name: 'Thornbury Estate G&CC',
    blurb: 'A sprawling championship eighteen gone to seed — the full tour: water twice, doglegs, real length. Every yard of it needs money, and there are a lot of yards.',
    size: 18,
    layout: {
      kind: 'serpentine', margin: 6, bands: 10, roughR: 3.6, fairwayR: 2.2,
      greenR: 1.8, greenRJitter: 0.3, doglegChance: 0.45, bunkers: 8, ponds: 2, elevAmp: 1.1,
      parMix: [4, 3, 4, 5, 4, 4, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4], parRange: { 4: [33, 48] },
    },
    condition: 38,
    sickGreens: 4,
    diseaseKind: 'dollarSpot',
    startingMembers: 12,
    startingReputation: 26,
    listingBias: 1.0,
  },
  {
    id: 'quarry-bluffs',
    name: 'Quarry Bluffs',
    blurb: 'Dramatic land, cramped golf: the most elevation change in the county squeezed into short par 3s and 4s. Spectacular, breathless, and half-maintained.',
    size: 9,
    layout: {
      kind: 'serpentine', margin: 8, bands: 4, roughR: 4.4, fairwayR: 2.2,
      greenR: 1.8, greenRJitter: 0.3, doglegChance: 0.35, bunkers: 4, ponds: 1, elevAmp: 2.0,
      parMix: [3, 4, 3, 4, 4, 3, 4, 3, 4], parRange: { 3: [13, 26], 4: [33, 44] },
    },
    condition: 52,
    sickGreens: 1,
    diseaseKind: 'dollarSpot',
    startingMembers: 16,
    startingReputation: 33,
    listingBias: 0.95,
  },
  {
    id: 'cypress-hollow',
    name: 'Cypress Hollow',
    blurb: 'Water everywhere and most of it in the turf — three ponds, saturated fairways, brown patch chewing the low greens. Fix the drainage story and the golf is honest.',
    size: 9,
    layout: {
      kind: 'serpentine', margin: 8, bands: 6, roughR: 4.5, fairwayR: 2.3,
      greenR: 2.0, greenRJitter: 0.3, doglegChance: 0.5, bunkers: 2, ponds: 3, elevAmp: 0.6,
      parMix: [4, 3, 4, 4, 5, 3, 4, 4, 4],
    },
    condition: 44,
    sickGreens: 3,
    diseaseKind: 'brownPatch',
    startingMembers: 9,
    startingReputation: 24,
    listingBias: 0.9,
  },
  {
    id: 'fairview-commons',
    name: 'Fairview Commons',
    blurb: 'A perfectly adequate nine priced on sentiment — the family wants a legacy number for grandpa\'s course. Decent shape, ordinary golf, ambitious ask.',
    size: 9,
    layout: {
      kind: 'serpentine', margin: 8, bands: 6, roughR: 4.5, fairwayR: 2.3,
      greenR: 2.45, greenRJitter: 0.2, doglegChance: 0.3, bunkers: 3, ponds: 1, elevAmp: 0.5,
      parMix: [4, 4, 3, 4, 4, 4, 3, 4, 4],
    },
    condition: 60,
    sickGreens: 0,
    diseaseKind: 'dollarSpot',
    startingMembers: 20,
    startingReputation: 38,
    listingBias: 1.24,
  },
];

// --- the serpentine course builder ---------------------------------------------------
// Routes N holes boustrophedon across horizontal bands (how real courses route
// rectangular land), then paints with the same primitives Willow Creek uses.
// Deterministic from the property seed. Zone paint ORDER is the safety net:
// all rough corridors → all fairways → all tee pads and greens (last, so no
// corridor can ever bury a pad the hole validation depends on).

const DEFAULT_PAR_RANGE = { 3: [13, 29], 4: [33, 54], 5: [60, 70] }; // corridor cells (×8 yd)

function routeSerpentine(L, rng) {
  const margin = L.margin;
  const bandH = (GRID_H - margin * 2) / L.bands;
  const xMin = margin;
  const xMax = GRID_W - margin;
  const bandY = (b) => margin + bandH * (b + 0.5);
  const specs = [];
  let band = 0;
  let dir = 1;
  let x = xMin + 2;
  for (let i = 0; i < L.holes; i++) {
    const par = L.parMix[i % L.parMix.length];
    const [lo, hi] = (L.parRange && L.parRange[par]) || DEFAULT_PAR_RANGE[par];
    const need = lo + 4;
    let remaining = dir > 0 ? xMax - x : x - xMin;
    if (remaining < need) {
      band = Math.min(band + 1, L.bands - 1);
      dir = -dir;
      x = dir > 0 ? xMin + 2 : xMax - 2;
      remaining = dir > 0 ? xMax - x : x - xMin;
    }
    const len = Math.min(Math.round(rng.range(lo, hi)), Math.max(lo, remaining - 2));
    const tee = {
      x: Math.round(x),
      y: Math.round(clamp(bandY(band) + (rng.next() - 0.5) * 2, 3, GRID_H - 4)),
    };
    const pin = {
      x: Math.round(clamp(x + dir * len, 2, GRID_W - 3)),
      y: Math.round(clamp(bandY(band) + (rng.next() - 0.5) * 2, 3, GRID_H - 4)),
    };
    const wp = [];
    if (par >= 4 && rng.chance(L.doglegChance)) {
      const bendMax = Math.max(2, Math.min(bandH * 0.45, 6));
      wp.push({
        x: Math.round(x + dir * len * rng.range(0.45, 0.65)),
        y: Math.round(clamp(bandY(band) + (rng.chance(0.5) ? 1 : -1) * rng.range(2, bendMax), 3, GRID_H - 4)),
      });
    }
    specs.push({ tee, pin, wp });
    x = pin.x + dir * (3 + rng.int(3));
  }
  return specs;
}

// Ponds must never eat the pads the holes validate against.
function paintPondEllipse(course, cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (!inBounds(course, x, y)) continue;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const z = getZone(course, x, y);
      if (z === ZONE.GREEN || z === ZONE.TEE) continue;
      setZone(course, x, y, ZONE.WATER);
    }
  }
}

function buildSerpentineCourse(property, rng) {
  const L = { ...property.layout, holes: property.size };
  const course = makeCourse();
  shapeElevation(course, rng);
  if (L.elevAmp !== 1) {
    for (let i = 0; i < course.elevation.length; i++) course.elevation[i] *= L.elevAmp;
  }

  const specs = routeSerpentine(L, rng);

  // rough halo, then fairways carved through it (Willow's order)
  for (const s of specs) {
    paintCorridor(course, [s.tee, ...s.wp, s.pin], L.roughR, ZONE.ROUGH, rng);
    paintDisk(course, s.pin.x, s.pin.y, L.roughR * 0.95, ZONE.ROUGH);
    paintDisk(course, s.tee.x, s.tee.y, 3.2, ZONE.ROUGH);
  }
  for (const s of specs) {
    paintCorridor(course, [s.tee, ...s.wp, s.pin], L.fairwayR, ZONE.FAIRWAY, rng);
  }

  // pads last so nothing can bury them
  for (const s of specs) {
    const hole = addHole(course);
    paintDisk(course, s.tee.x, s.tee.y, 1.4, ZONE.TEE);
    paintDisk(course, s.pin.x, s.pin.y, Math.max(1.2, L.greenR + (rng.next() - 0.5) * L.greenRJitter), ZONE.GREEN);
    for (let y = s.pin.y - 3; y <= s.pin.y + 3; y++) {
      for (let x = s.pin.x - 3; x <= s.pin.x + 3; x++) {
        if (!inBounds(course, x, y)) continue;
        const d = Math.hypot(x - s.pin.x, y - s.pin.y);
        course.elevation[idx(course, x, y)] += clamp(1.5 - d * 0.4, 0, 1.5);
      }
    }
    hole.tee = { ...s.tee };
    hole.pin = { ...s.pin };
    hole.status = HOLE_STATUS.OPEN;
    hole.everOpen = true;
  }

  // greenside bunkers (only over grass, never over pads or water)
  const sandable = new Set([ZONE.ROUGH, ZONE.FAIRWAY]);
  let placed = 0;
  let guard = 0;
  while (placed < L.bunkers && guard++ < 80) {
    const s = specs[rng.int(specs.length)];
    const bx = s.pin.x + (rng.chance(0.5) ? 1 : -1) * (2 + rng.int(2));
    const by = s.pin.y + (rng.chance(0.5) ? 1 : -1) * (2 + rng.int(2));
    if (!inBounds(course, bx, by) || !sandable.has(getZone(course, bx, by))) continue;
    paintDisk(course, bx, by, 1.2 + rng.next() * 0.5, ZONE.BUNKER, { onlyOver: sandable });
    placed++;
  }

  // ponds hang off mid-corridor, pushed to the side of the playing line
  const pondHosts = specs.filter((s) => Math.abs(s.pin.x - s.tee.x) >= 25);
  for (let k = 0; k < L.ponds && pondHosts.length > 0; k++) {
    const s = pondHosts[rng.int(pondHosts.length)];
    const mx = (s.tee.x + s.pin.x) / 2 + (rng.next() - 0.5) * 6;
    const my = (s.tee.y + s.pin.y) / 2;
    const side = rng.chance(0.5) ? 1 : -1;
    const off = L.fairwayR + 2.5 + rng.next() * 2;
    paintPondEllipse(
      course,
      clamp(mx, 4, GRID_W - 5),
      clamp(my + side * off, 3, GRID_H - 4),
      3.5 + rng.next() * 2,
      2.2 + rng.next() * 1.2,
    );
  }

  // clubhouse on the quiet strip above the first band
  const ch = {
    type: 'clubhouse',
    x: Math.round(clamp(specs[0].tee.x - 3, 2, GRID_W - 8)),
    y: Math.max(1, L.margin - 7),
    w: 6,
    h: 5,
  };
  flattenUnder(course, ch.x - 1, ch.y - 1, ch.w + 2, ch.h + 2);
  for (let y = ch.y; y < ch.y + ch.h; y++) {
    for (let x = ch.x; x < ch.x + ch.w; x++) {
      setZone(course, x, y, ZONE.OUT);
    }
  }
  course.structures.push(ch);

  // tee pads sit level
  for (const s of specs) {
    flattenUnder(course, s.tee.x - 1, s.tee.y - 1, 3, 3);
  }

  return course;
}

export function buildPropertyCourse(property) {
  const rng = makeRng(property.seed);
  if (property.layout.kind === 'willow') return buildStartingCourse(rng);
  return buildSerpentineCourse(property, rng);
}

// --- listing generation ------------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;

export function generateMarketplace(seed = 1) {
  const master = makeRng((seed >>> 0) || 1);
  return ARCHETYPES.map((a) => {
    const record = {
      id: a.id,
      name: a.name,
      blurb: a.blurb,
      size: a.size,
      seed: 1 + master.int(2147483646),
      layout: a.layout,
      condition: a.condition,
      sickGreens: a.sickGreens,
      diseaseKind: a.diseaseKind,
      startingMembers: a.startingMembers,
      startingReputation: a.startingReputation,
    };
    const course = buildPropertyCourse(record);
    record.design = round1(courseDesignRating(course));
    record.par = course.holes.reduce((sum, h) => sum + holePar(h), 0);
    record.yards = Math.round(course.holes.reduce((sum, h) => sum + holeDistanceYd(h), 0));
    // what the place would net per season (24 days) roughly as it stands today —
    // the listing-time stand-in for a trailing income history it doesn't have yet
    record.estMonthlyNet = Math.round((0.45 * record.design + 0.55 * record.condition - 52) * 110 * (a.size / 9));
    record.trueValue = appraiseStats({
      size: a.size,
      design: record.design,
      condition: a.condition,
      members: a.startingMembers,
      reputation: a.startingReputation,
      monthlyNet: record.estMonthlyNet,
    });
    const jitter = 1 + (master.next() - 0.5) * 0.06;
    record.askingPrice = Math.max(round500(record.trueValue * a.listingBias * jitter), 5500);
    return record;
  });
}

// --- debug dump -------------------------------------------------------------------------
// Readable roster table for QA (node -e or the browser console via window.__fw).

export function dumpMarketplace(properties) {
  const money = (v) => '$' + v.toLocaleString('en-US');
  const lines = ['GOLF EMPIRE — property marketplace', ''];
  for (const p of properties) {
    const ratio = p.askingPrice / p.trueValue;
    const note = ratio < 0.92 ? 'underpriced' : ratio > 1.08 ? 'OVERPRICED' : 'fair-ish';
    lines.push(
      `${p.name.padEnd(24)} ${String(p.size).padStart(2)}h  par ${String(p.par).padStart(2)}  ` +
      `${String(p.yards).padStart(5)}yd  D${String(Math.round(p.design)).padStart(3)}  C${String(Math.round(p.condition)).padStart(3)}  ` +
      `ask ${money(p.askingPrice).padStart(9)}  [true ${money(p.trueValue).padStart(9)} → ${note}]`,
    );
    lines.push(`  ${p.blurb}`);
  }
  return lines.join('\n');
}
