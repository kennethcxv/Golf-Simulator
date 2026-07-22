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
import { designCourse } from './courseArchitect.js';
import {
  paintShapedCorridor, fairwayProfile, paintGreenComplex, paintTeeBox,
  paintBunkerBlob, shapeHoleElevation, finishCourse,
} from './courseShaping.js';
import { makeRng, clamp } from '../core/utils.js';

// --- the shared appraisal core ------------------------------------------------
// Dollars a golf property is worth given its headline stats. Used to price the
// hidden trueValue at listing time AND (via sim/valuation.js) to appraise a
// live, owned property — one formula, so the marketplace can't lie.
//   monthlyNet is the trailing per-season (24-day) net — the game's "month".

export function round500(v) {
  return Math.round(v / 500) * 500;
}

export function appraiseStatsBreakdown({ size, design, condition, members = 0, reputation = 25, monthlyNet = 0 }) {
  const sizeF = Math.max(size, 4) / 9; // 1 for a 9-holer, 2 for a full 18; even a razed property keeps its acreage
  const land = 12000 * sizeF; // dirt, irrigation mains, buildings — the floor
  const quality = clamp(0.45 * design + 0.55 * condition, 1, 100);
  const course = Math.pow(quality, 1.18) * 220 * Math.pow(sizeF, 0.85);
  const membership = members * 450;
  const reputationValue = Math.max(reputation - 20, 0) * 180;
  const earnings = clamp(monthlyNet, -12000 * sizeF, 30000 * sizeF) * 1.6;
  const business = membership + reputationValue + earnings;
  const value = Math.max(round500(land + course + business), round500(land * 0.5));
  return { sizeF, land, quality, course, membership, reputation: reputationValue, earnings, business, value };
}

export function appraiseStats(stats) {
  return appraiseStatsBreakdown(stats).value;
}

// --- property operating profile --------------------------------------------------
// Listings used to describe only the golf. These profiles make the land around
// it economically meaningful too: climate drives real weather, while demand,
// tourism, upkeep and expansion headroom let two similarly priced courses play
// like different acquisitions. Records stay plain JSON so old saves can be
// completed deterministically on load.

export const PROPERTY_REGIONS = Object.freeze({
  heartland: Object.freeze({
    label: 'Heartland', climate: 'temperate', climateLabel: 'Four-season temperate',
    courseClass: 'Public course', tourism: 38, maintenance: 1, utilities: 1,
    expansion: 72, weather: 'Warm summers, frost-prone winters, regular rain', unlockTier: 0,
  }),
  coast: Object.freeze({
    label: 'Coastal Belt', climate: 'maritime', climateLabel: 'Cool maritime',
    courseClass: 'Coastal public course', tourism: 78, maintenance: 1.08, utilities: 0.92,
    expansion: 48, weather: 'Mild temperatures, frequent showers, persistent wind', unlockTier: 0,
  }),
  highlands: Object.freeze({
    label: 'Highlands', climate: 'alpine', climateLabel: 'Mountain',
    courseClass: 'Mountain resort', tourism: 86, maintenance: 1.2, utilities: 1.12,
    expansion: 54, weather: 'Short season, cold nights, fast-changing mountain storms', unlockTier: 1,
  }),
  desert: Object.freeze({
    label: 'Red Mesa', climate: 'arid', climateLabel: 'Hot arid',
    courseClass: 'Desert course', tourism: 82, maintenance: 1.28, utilities: 1.42,
    expansion: 68, weather: 'Hot, dry and windy with rare heavy downpours', unlockTier: 1,
  }),
  heritage: Object.freeze({
    label: 'Heritage County', climate: 'temperate', climateLabel: 'Sheltered temperate',
    courseClass: 'Luxury country club', tourism: 66, maintenance: 1.48, utilities: 1.3,
    expansion: 36, weather: 'Long playing season with costly storm cleanup', unlockTier: 2,
  }),
});

const PROPERTY_REGION = Object.freeze({
  'willow-creek': 'heartland',
  'bent-pines': 'highlands',
  'flatiron-meadows': 'heartland',
  'saltgrass-point': 'coast',
  'red-mesa-dunes': 'desert',
  'thornbury-estate': 'heritage',
  'quarry-bluffs': 'highlands',
  'cypress-hollow': 'coast',
  'fairview-commons': 'heritage',
});

const TEMPLATE_REGION = Object.freeze({
  'neglected-gem': 'highlands',
  'tired-muni': 'heartland',
  'polished-bore': 'heartland',
  executive: 'coast',
  waterlogged: 'coast',
  'legacy-trap': 'heritage',
  'championship-wreck': 'heritage',
  'desert-reclamation': 'desert',
});

const DIFFICULTY = ['Beginner', 'Approachable', 'Challenging', 'Demanding', 'Championship'];

export function propertyDifficultyLabel(value) {
  return DIFFICULTY[clamp(Math.round(Number(value) || 1), 1, 5) - 1];
}

export function completePropertyProfile(property) {
  if (!property || typeof property !== 'object') return property;
  const region = property.region && PROPERTY_REGIONS[property.region]
    ? property.region
    : PROPERTY_REGION[property.id] || TEMPLATE_REGION[property.archetype] || 'heartland';
  const profile = PROPERTY_REGIONS[region];
  const sizeF = Math.max(1, (Number(property.size) || 9) / 9);
  const elevation = Number(property.layout?.elevAmp) || (region === 'highlands' ? 1.4 : 0.6);
  const hazards = (Number(property.layout?.bunkers) || 0) + (Number(property.layout?.ponds) || 0) * 2;
  const computedDifficulty = clamp(Math.round(
    1 + (Number(property.design) - 68) / 11 + elevation * 0.55 + (region === 'coast' ? 0.45 : 0),
  ), 1, 5);
  const tourism = clamp(Math.round(profile.tourism + (Number(property.design) - 72) * 0.32), 15, 98);
  const demand = clamp(Math.round(
    (Number(property.startingMembers) || 0) * 1.05
      + (Number(property.startingReputation) || 25) * 0.72
      + tourism * 0.3,
  ), 18, 98);
  const maintenance = Math.round((
    105 * sizeF * profile.maintenance
      + (Number(property.sickGreens) || 0) * 18
      + hazards * 3
  ) / 5) * 5;
  const operating = maintenance + Math.round((58 * sizeF * profile.utilities) / 5) * 5;
  const expansion = clamp(Math.round(
    profile.expansion + (property.size <= 9 ? 10 : -18) - elevation * 3,
  ), 12, 95);

  property.region = region;
  property.regionLabel = property.regionLabel || profile.label;
  property.climate = property.climate || profile.climate;
  property.climateLabel = property.climateLabel || profile.climateLabel;
  property.courseClass = property.courseClass || (property.id === 'willow-creek' ? 'Small municipal course' : profile.courseClass);
  property.difficulty = Number.isFinite(property.difficulty) ? property.difficulty : computedDifficulty;
  property.difficultyLabel = property.difficultyLabel || propertyDifficultyLabel(property.difficulty);
  property.customerDemand = Number.isFinite(property.customerDemand) ? property.customerDemand : demand;
  property.expansionPotential = Number.isFinite(property.expansionPotential) ? property.expansionPotential : expansion;
  property.maxHoles = Number.isFinite(property.maxHoles)
    ? property.maxHoles : property.size + (expansion >= 64 ? 9 : 0);
  property.maintenanceCostPerDay = Number.isFinite(property.maintenanceCostPerDay)
    ? property.maintenanceCostPerDay : maintenance;
  property.operatingCostPerDay = Number.isFinite(property.operatingCostPerDay)
    ? property.operatingCostPerDay : operating;
  property.tourismRating = Number.isFinite(property.tourismRating) ? property.tourismRating : tourism;
  property.weather = property.weather || profile.weather;
  property.unlockTier = Number.isFinite(property.unlockTier) ? property.unlockTier : profile.unlockTier;
  property.shopLevel = Number.isFinite(property.shopLevel)
    ? clamp(Math.round(property.shopLevel), 1, 5)
    : 1;
  property.saleType = property.saleType || 'listing';
  return property;
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
    shopLevel: 1,
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
    shopLevel: 3,
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
    shopLevel: 2,
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
    shopLevel: 4,
    listingBias: 0.88,
  },
  {
    id: 'red-mesa-dunes',
    name: 'Red Mesa Dunes',
    blurb: 'A desert daily-fee course built around red-rock washes. Spectacular winter demand, punishing water bills, and nine holes of wind-exposed target golf.',
    size: 9,
    layout: {
      kind: 'serpentine', margin: 8, bands: 5, roughR: 4.2, fairwayR: 2.0,
      greenR: 1.65, greenRJitter: 0.25, doglegChance: 0.42, bunkers: 8, ponds: 0, elevAmp: 1.35,
      parMix: [4, 3, 4, 5, 3, 4, 4, 3, 4], parRange: { 3: [14, 27], 4: [34, 46], 5: [58, 65] },
    },
    condition: 54,
    sickGreens: 1,
    diseaseKind: 'dollarSpot',
    startingMembers: 11,
    startingReputation: 34,
    listingBias: 0.94,
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
    shopLevel: 5,
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
    shopLevel: 3,
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
    shopLevel: 4,
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
    shopLevel: 2,
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
  shapeHoleElevation(course, specs, rng);

  // rough halo, then fairways carved through it (Willow's order) — both are
  // shaped splines now, so listings stop reading as parallel rectangles
  for (const s of specs) {
    paintShapedCorridor(course, [s.tee, ...s.wp, s.pin], (t) => L.roughR * (0.9 + 0.16 * Math.sin(t * 6.5)), ZONE.ROUGH, rng, { wobble: 0.9 });
    paintDisk(course, s.pin.x, s.pin.y, L.roughR * 0.95, ZONE.ROUGH);
    paintDisk(course, s.tee.x, s.tee.y, 3.2, ZONE.ROUGH);
  }
  for (const s of specs) {
    const yd = Math.hypot(s.pin.x - s.tee.x, s.pin.y - s.tee.y) * 8;
    if (yd <= 250) continue; // par 3s play tee → green, no fairway ribbon
    const prof = fairwayProfile(rng, yd > 470 ? 5 : 4);
    paintShapedCorridor(course, [s.tee, ...s.wp, s.pin], (t) => prof(t) * (L.fairwayR / 2.3), ZONE.FAIRWAY, rng, {
      onlyOver: new Set([ZONE.ROUGH]),
      wobble: 0.8,
    });
  }

  // pads last so nothing can bury them
  for (const s of specs) {
    const hole = addHole(course);
    const prev = s.wp.length ? s.wp[s.wp.length - 1] : s.tee;
    const aim = s.wp.length ? s.wp[0] : s.pin;
    paintGreenComplex(course, s.pin.x, s.pin.y, rng, {
      r: Math.max(1.2, L.greenR + (rng.next() - 0.5) * L.greenRJitter),
      elong: 1.1 + rng.next() * 0.25,
      angle: Math.atan2(s.pin.y - prev.y, s.pin.x - prev.x) + Math.PI / 2,
      raise: 1.5,
    });
    paintTeeBox(course, s.tee.x, s.tee.y, aim.x, aim.y);
    hole.tee = { ...s.tee };
    hole.pin = { ...s.pin };
    hole.wp = (s.wp || []).map((p) => ({ ...p })); // mow stripes bend through these
    hole.status = HOLE_STATUS.OPEN;
    hole.everOpen = true;
  }

  // greenside bunkers (only over grass, never over pads or water)
  const sandable = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.SEMI]);
  let placed = 0;
  let guard = 0;
  while (placed < L.bunkers && guard++ < 80) {
    const s = specs[rng.int(specs.length)];
    const bx = s.pin.x + (rng.chance(0.5) ? 1 : -1) * (2 + rng.int(2));
    const by = s.pin.y + (rng.chance(0.5) ? 1 : -1) * (2 + rng.int(2));
    if (!inBounds(course, bx, by) || !sandable.has(getZone(course, bx, by))) continue;
    paintBunkerBlob(course, bx, by, rng, { r: 1.2 + rng.next() * 0.5, onlyOver: sandable });
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

  // transition bands, cart paths, intentional planting — the finish coat
  finishCourse(course, specs, rng, { density: 1 });

  // tee pads sit level
  for (const s of specs) {
    flattenUnder(course, s.tee.x - 1, s.tee.y - 1, 3, 3);
  }

  return course;
}

export function buildPropertyCourse(property) {
  const rng = makeRng(property.seed);
  // nine-hole properties are architect-designed vector courses now — one
  // builder, feature levers mapped from the archetype so a pristine parkland
  // and a modest muni come out genuinely different. The big 18-hole estates
  // still come from the serpentine painter (legacy render path).
  if (property.size <= 9) {
    const L = property.layout;
    const isWillow = L.kind === 'willow';
    return designCourse(rng, {
      jitter: isWillow ? 0.35 : 0.7,
      elevAmp: L.elevAmp ?? 1,
      bunkerBudget: isWillow ? Infinity : (L.bunkers ?? 6),
      water: isWillow ? true : (L.ponds ?? 1) > 0,
      greenSizeMul: isWillow ? 1 : clamp((L.greenR ?? 1.9) / 1.9, 0.72, 1.35),
      moundMul: isWillow ? 1 : clamp((L.elevAmp ?? 1) * 0.9, 0.2, 1.4),
    });
  }
  return buildSerpentineCourse(property, rng);
}

// --- listing generation ------------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;

// The current environment roster demonstrates the first two rungs only. The
// resort and private tiers are data-defined in propertyProgression.js, but are
// intentionally not presented as completed environments.
export function listingTierId(record) {
  if (record?.tierId) return record.tierId;
  return (record?.size || 9) >= 18 ? 'establishedLocal' : 'neglectedPublic';
}

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
      shopLevel: a.shopLevel,
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
    record.tierId = listingTierId(record);
    return completePropertyProfile(record);
  });
}

// --- the living market -------------------------------------------------------------------
// After launch day the market keeps producing distressed courses. New listings
// come from parametrized distress-profile templates (the 8 hand-authored
// archetypes generalized into ranges), built through the SAME serpentine
// builder and appraisal as the launch roster — one generation path, no
// second-class listings. All tuning knobs live here, reasoning in DEV_LOG.md.

export const MARKET = {
  maxListings: 10, // hard cap on unsold listings at once — the window, not a warehouse
  refreshEveryDays: 6, // a listing roll every 6 world-days…
  refreshChance: 0.75, // …lands a new property about every 8 days (1-2 in-game weeks)
  dryMarketFloor: 3, // at or below this many listings, the next roll always lands
  minDaysListed: 10, // grace window: no rival can take a listing younger than this
  rivalDailyChance: 0.055, // per-day rival-buy roll after grace (mean tenure ≈ 28 days)
  conditionMin: 0.85, // deepest buyer's market — new asks run 15% soft
  conditionMax: 1.15, // hottest seller's market — new asks run 15% rich
  conditionRetargetDays: 24, // the cycle picks a new destination about once a season
  conditionLerp: 0.08, // daily approach toward the target (~86% of the way per season)
  conditionNoise: 0.008, // per-day wobble so the line reads alive, not synthetic
};

const NAME_A = [
  'Alder', 'Stonecrop', 'Foxglove', 'Harrow', 'Blue Heron', 'Larkspur', 'Copperleaf',
  'Gorsefield', 'Badger', 'Kestrel', 'Gritstone', 'Persimmon', 'Tamarack', 'Wren Hill',
  'Juniper', 'Redwing', 'Millstone', 'Candlewood', 'Sycamore', 'Hollyhock', 'Drumlin',
  'Saddleback',
];
const NAME_B = [
  'Creek', 'Hollow', 'Ridge', 'Downs', 'Pines', 'Meadows', 'Point', 'Bluffs', 'Glen',
  'Moor', 'Heath', 'Links', 'Knolls', 'Landing', 'Crossing', 'Bend', 'Flats', 'Run',
];
const NAME_C = ['', ' Golf Club', ' G.C.', ' Country Club', ' Municipal', ' Golf Links'];

// Each template is one honest way a course ends up on the block: a distinct
// weak point, layout ranges that push the COMPUTED design rating the right
// direction (never a stored fiction), and a seller bias band so the market
// keeps producing both bargains and traps.
const LISTING_TEMPLATES = [
  {
    key: 'neglected-gem', weight: 3, size: 9,
    shopLevel: 1,
    condition: [26, 42], sick: [2, 4], disease: 'dollarSpot',
    members: [5, 14], rep: [18, 30], bias: [0.72, 0.9],
    layout: {
      margin: 8, bands: [5, 6], roughR: [4.4, 4.8], fairwayR: [2.2, 2.4],
      greenR: [1.7, 2.0], greenRJitter: 0.35, dogleg: [0.45, 0.6],
      bunkers: [7, 11], ponds: [1, 2], elevAmp: [1.0, 1.6],
      parWeights: { 3: 2, 4: 5, 5: 2 },
    },
    blurbs: [
      'The routing is the real thing — doglegs, movement, angles. Everything growing on top of it is a disgrace. A competent crew could save this.',
      'Under the knee-high fescue and the dead greens there is a course people used to drive an hour for. The bones never stopped being good; everyone just stopped paying the water bill.',
      'Foreclosure special: superb land, criminal upkeep. The bank wants it gone before another irrigation main lets go.',
    ],
  },
  {
    key: 'tired-muni', weight: 3, size: 9,
    shopLevel: 1,
    condition: [42, 56], sick: [1, 3], disease: 'dollarSpot',
    members: [14, 26], rep: [26, 36], bias: [0.8, 0.96],
    layout: {
      margin: 8, bands: [5, 6], roughR: [4.4, 4.7], fairwayR: [2.2, 2.4],
      greenR: [1.9, 2.3], greenRJitter: 0.3, dogleg: [0.3, 0.45],
      bunkers: [2, 5], ponds: [0, 1], elevAmp: [0.5, 1.0],
      parWeights: { 3: 2, 4: 6, 5: 1 },
    },
    blurbs: [
      'An honest muni that has been running on fumes and goodwill for a decade. Nothing here is broken beyond fixing; nothing is impressive either.',
      'The kind of nine every town used to have: playable, unglamorous, quietly falling behind on everything. Solid daily-fee trade if someone minds the store.',
      'Deferred maintenance from the first tee to the last green, but the regulars keep showing up. That loyalty is worth more than the mowers.',
    ],
  },
  {
    key: 'polished-bore', weight: 2, size: 9,
    shopLevel: 2,
    condition: [66, 80], sick: [0, 0], disease: 'dollarSpot',
    members: [20, 30], rep: [38, 48], bias: [0.98, 1.12],
    layout: {
      margin: 8, bands: [5, 6], roughR: [4.3, 4.6], fairwayR: [2.3, 2.5],
      greenR: [2.4, 2.8], greenRJitter: 0.2, dogleg: [0.1, 0.25],
      bunkers: [0, 2], ponds: [0, 1], elevAmp: [0.25, 0.5],
      parWeights: { 3: 1, 4: 8 },
    },
    blurbs: [
      'Not a blade out of place and not a single hole you will remember tomorrow. The superintendent is a wizard; the architect was a paving contractor.',
      'Immaculate turf on a routing with all the drama of a car park. Members love the conditioning and quietly play their golf elsewhere.',
      'The best-kept boring golf course in the county. Buy the maintenance culture; fix the golf later.',
    ],
  },
  {
    key: 'executive', weight: 2, size: 9,
    shopLevel: 2,
    condition: [56, 70], sick: [0, 1], disease: 'dollarSpot',
    members: [10, 18], rep: [30, 40], bias: [0.82, 0.96],
    layout: {
      margin: 8, bands: [4, 4], roughR: [4.1, 4.4], fairwayR: [2.0, 2.2],
      greenR: [1.3, 1.6], greenRJitter: 0.25, dogleg: [0.15, 0.3],
      bunkers: [4, 6], ponds: [0, 1], elevAmp: [0.6, 1.2],
      parWeights: { 3: 6, 4: 3 }, parRange: { 3: [16, 26], 4: [34, 42] },
    },
    blurbs: [
      'A tight executive nine that punches far above its yardage — small vicious greens and bunkers that mean it. Cheap to water, cheap to mow, easy to love.',
      'Short, sharp, and beloved by the lunch-hour crowd. No length, no pretension, surprisingly defensible economics.',
      'Par is a rumor here: knee-knocker par 3s and two honest short 4s. Runs on a shoestring and knows it.',
    ],
  },
  {
    key: 'waterlogged', weight: 2, size: 9,
    shopLevel: 1,
    condition: [34, 50], sick: [2, 4], disease: 'brownPatch',
    members: [8, 16], rep: [22, 32], bias: [0.84, 0.98],
    layout: {
      margin: 8, bands: [5, 6], roughR: [4.4, 4.7], fairwayR: [2.2, 2.4],
      greenR: [1.9, 2.2], greenRJitter: 0.3, dogleg: [0.4, 0.55],
      bunkers: [1, 3], ponds: [2, 3], elevAmp: [0.4, 0.8],
      parWeights: { 3: 2, 4: 6, 5: 1 },
    },
    blurbs: [
      'The low holes hold water like a saucer and the brown patch knows it. Solve the drainage story and an honest course walks out of the swamp.',
      'Three ponds by design, five more by accident every spring. The turf disease chart reads like a medical drama; the routing underneath is blameless.',
      'Saturated fairways, fungus on the low greens, and a pump house held together with tape. Water made this mess and water management can unmake it.',
    ],
  },
  {
    key: 'desert-reclamation', weight: 2, size: 9,
    condition: [38, 58], sick: [0, 1], disease: 'dollarSpot',
    members: [8, 18], rep: [27, 40], bias: [0.82, 1.02],
    layout: {
      margin: 8, bands: [4, 5], roughR: [4.0, 4.35], fairwayR: [1.9, 2.15],
      greenR: [1.45, 1.8], greenRJitter: 0.3, dogleg: [0.34, 0.52],
      bunkers: [6, 10], ponds: [0, 0], elevAmp: [0.9, 1.55],
      parWeights: { 3: 3, 4: 5, 5: 1 },
    },
    blurbs: [
      'Red-rock target golf with winter-tourism upside and an irrigation system that invoices like a second mortgage. The views sell rounds; the water bill takes them back.',
      'Nine desert holes threaded through dry washes and exposed mesas. Strong seasonal demand, no shade, and every green depends on aging pumps.',
      'A resort-course idea left half-finished: dramatic land, lean turf corridors, and enough visitor traffic to justify finishing it properly.',
    ],
  },
  {
    key: 'legacy-trap', weight: 2, size: 9,
    shopLevel: 3,
    condition: [55, 68], sick: [0, 1], disease: 'dollarSpot',
    members: [16, 26], rep: [32, 42], bias: [1.12, 1.3],
    layout: {
      margin: 8, bands: [5, 6], roughR: [4.4, 4.7], fairwayR: [2.2, 2.4],
      greenR: [2.3, 2.6], greenRJitter: 0.25, dogleg: [0.25, 0.4],
      bunkers: [2, 4], ponds: [0, 1], elevAmp: [0.4, 0.8],
      parWeights: { 3: 2, 4: 7 },
    },
    blurbs: [
      'Grandpa built it, the family priced it. The course is fine — the ask includes forty years of sentiment at compound interest.',
      'A perfectly adequate nine wearing a championship price tag. The listing agent talks about heritage a lot.',
      'Decent shape, ordinary golf, and a number arrived at by seance. Somebody will overpay; it does not have to be you.',
    ],
  },
  {
    key: 'championship-wreck', weight: 1, size: 18,
    shopLevel: 4,
    condition: [32, 46], sick: [3, 5], disease: 'dollarSpot',
    members: [10, 18], rep: [24, 32], bias: [0.92, 1.1],
    layout: {
      margin: 6, bands: [9, 11], roughR: [3.5, 3.8], fairwayR: [2.1, 2.3],
      greenR: [1.7, 2.0], greenRJitter: 0.3, dogleg: [0.4, 0.55],
      bunkers: [7, 10], ponds: [1, 2], elevAmp: [0.9, 1.3],
      parWeights: { 3: 2, 4: 7, 5: 2 }, parRange: { 3: [13, 27], 4: [33, 46], 5: [58, 66] },
    },
    blurbs: [
      'A full eighteen with tournament pedigree and a decade of neglect on every yard of it. The scale that made it famous makes it expensive to save.',
      'Championship length, championship decay. Everything works at half strength across twice the acreage — bring money and a plan.',
      'The county\'s grand old eighteen, seized and shuttered. Water on the front, real length everywhere, ruin all over.',
    ],
  },
];

// Generated 9-holers use a slightly tightened default par range so even an
// extreme roll of the par mix stays inside honest 9/18-hole yardage bounds.
const GEN_PAR_RANGE = { 3: [15, 27], 4: [33, 48], 5: [58, 66] };

const intIn = (rng, [lo, hi]) => lo + rng.int(hi - lo + 1);
const floatIn = (rng, [lo, hi]) => lo + rng.next() * (hi - lo);
const round2 = (v) => Math.round(v * 100) / 100;

function pickTemplate(rng) {
  const total = LISTING_TEMPLATES.reduce((a, t) => a + t.weight, 0);
  let roll = rng.next() * total;
  for (const t of LISTING_TEMPLATES) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return LISTING_TEMPLATES[LISTING_TEMPLATES.length - 1];
}

// Weighted par draw with hard sanity rails (par-5 and par-3 counts capped) so
// total yardage always lands inside the bounds a real 9/18-holer must satisfy.
function rollParMix(rng, holes, weights) {
  const pool = [];
  for (const par of [3, 4, 5]) {
    for (let i = 0; i < (weights[par] || 0); i++) pool.push(par);
  }
  const mix = [];
  for (let i = 0; i < holes; i++) mix.push(pool[rng.int(pool.length)]);
  const maxFives = holes === 18 ? 4 : 2;
  const maxThrees = 6;
  let fives = 0;
  let threes = 0;
  for (let i = 0; i < mix.length; i++) {
    if (mix[i] === 5) {
      fives++;
      if (fives > maxFives) mix[i] = 4;
    } else if (mix[i] === 3) {
      threes++;
      if (threes > maxThrees) mix[i] = 4;
    }
  }
  return mix;
}

function uniqueName(rng, taken) {
  let name = '';
  for (let tries = 0; tries < 60; tries++) {
    const b = NAME_B[rng.int(NAME_B.length)];
    const c = NAME_C[rng.int(NAME_C.length)];
    if (c.includes(b)) continue; // no 'Links Golf Links'
    name = `${NAME_A[rng.int(NAME_A.length)]} ${b}${c}`;
    if (!taken.includes(name)) return name;
  }
  return `${name} II`; // 2,376 combos vs a ~30-name world — this line is theory
}

function uniqueId(rng, taken) {
  for (;;) {
    const id = `lst-${(1 + rng.int(2147483646)).toString(36)}`;
    if (!taken.includes(id)) return id;
  }
}

// One new listing, deterministic from its seed: a distress profile rolled into
// a concrete layout, built into a REAL course (design rating computed, never
// invented), appraised with the same shared formula, then priced by the seller.
export function generateListing(seed, opts = {}) {
  const { marketCondition = 1, takenNames = [], takenIds = [] } = opts;
  const rng = makeRng((seed >>> 0) || 1);
  const t = pickTemplate(rng);
  const L = t.layout;
  const record = {
    id: uniqueId(rng, takenIds),
    name: uniqueName(rng, takenNames),
    blurb: t.blurbs[rng.int(t.blurbs.length)],
    size: t.size,
    seed: 1 + rng.int(2147483646),
    layout: {
      kind: 'serpentine',
      margin: L.margin,
      bands: intIn(rng, L.bands),
      roughR: round2(floatIn(rng, L.roughR)),
      fairwayR: round2(floatIn(rng, L.fairwayR)),
      greenR: round2(floatIn(rng, L.greenR)),
      greenRJitter: L.greenRJitter,
      doglegChance: round2(floatIn(rng, L.dogleg)),
      bunkers: intIn(rng, L.bunkers),
      ponds: intIn(rng, L.ponds),
      elevAmp: round2(floatIn(rng, L.elevAmp)),
      parMix: rollParMix(rng, t.size, L.parWeights),
      parRange: L.parRange || GEN_PAR_RANGE,
    },
    condition: Math.round(floatIn(rng, t.condition)),
    sickGreens: intIn(rng, t.sick),
    diseaseKind: t.disease,
    startingMembers: intIn(rng, t.members),
    startingReputation: Math.round(floatIn(rng, t.rep)),
    shopLevel: t.shopLevel,
    archetype: t.key,
  };
  const course = buildPropertyCourse(record);
  record.design = round1(courseDesignRating(course));
  record.par = course.holes.reduce((sum, h) => sum + holePar(h), 0);
  record.yards = Math.round(course.holes.reduce((sum, h) => sum + holeDistanceYd(h), 0));
  record.estMonthlyNet = Math.round((0.45 * record.design + 0.55 * record.condition - 52) * 110 * (t.size / 9));
  record.trueValue = appraiseStats({
    size: t.size,
    design: record.design,
    condition: record.condition,
    members: record.startingMembers,
    reputation: record.startingReputation,
    monthlyNet: record.estMonthlyNet,
  });
  const bias = floatIn(rng, t.bias);
  const jitter = 1 + (rng.next() - 0.5) * 0.06;
  record.askingPrice = Math.max(round500(record.trueValue * bias * jitter * marketCondition), 5500);
  record.tierId = listingTierId(record);
  return completePropertyProfile(record);
}

// --- what the screens say ----------------------------------------------------------------
// One-status-first copy for the market UI. Deliberately imprecise: the player
// should learn the cycle and feel the clock, not min-max a number.

export function marketConditionLabel(condition) {
  if (condition <= 0.96) {
    return { key: 'buyers', label: 'Buyer’s market', hint: 'Asking prices are running soft — a good time to acquire.' };
  }
  if (condition >= 1.04) {
    return { key: 'sellers', label: 'Seller’s market', hint: 'Asking prices are running rich — patience pays.' };
  }
  return { key: 'balanced', label: 'Balanced market', hint: 'Asking prices sit near true form.' };
}

export function listingAgeLabel(daysOnMarket) {
  if (daysOnMarket <= 2) return 'Just listed';
  if (daysOnMarket < MARKET.minDaysListed) return 'A week or two on the market';
  return 'Been sitting — rival buyers circling';
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
