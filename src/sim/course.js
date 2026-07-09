// FAIRWAY STATE — course model: the cell grid (zones + elevation), holes, derived
// zone sections, and the design half of the course rating.
// Pure data + pure functions; rendering lives elsewhere.

import {
  GRID_W, GRID_H, CELL_YD, ZONE, SECTION_ZONES,
  PAR3_MAX_YD, PAR4_MAX_YD, HOLE_MIN_YD, HOLE_MAX_YD, HOLE_STATUS,
} from './constants.js';
import { dist, distToSegment, clamp } from '../core/utils.js';

export function makeCourse(w = GRID_W, h = GRID_H) {
  return {
    w,
    h,
    zones: new Uint8Array(w * h), // ZONE.OUT everywhere
    elevation: new Float32Array(w * h), // feet above course datum
    holes: [],
    nextHoleId: 1,
    structures: [], // e.g. { type: 'clubhouse', x, y, w, h }
  };
}

export function idx(course, x, y) {
  return y * course.w + x;
}

export function inBounds(course, x, y) {
  return x >= 0 && y >= 0 && x < course.w && y < course.h;
}

export function getZone(course, x, y) {
  return inBounds(course, x, y) ? course.zones[idx(course, x, y)] : ZONE.OUT;
}

export function setZone(course, x, y, zone) {
  if (inBounds(course, x, y)) course.zones[idx(course, x, y)] = zone;
}

export function getElev(course, x, y) {
  return inBounds(course, x, y) ? course.elevation[idx(course, x, y)] : 0;
}

export function setElev(course, x, y, feet) {
  if (inBounds(course, x, y)) course.elevation[idx(course, x, y)] = feet;
}

// --- holes ----------------------------------------------------------------

export function addHole(course) {
  const hole = {
    id: course.nextHoleId++,
    tee: null, // {x, y}
    pin: null, // {x, y} — must sit on green cells
    status: HOLE_STATUS.UNBUILT,
    daysLeft: 0, // renovation/construction countdown
    everOpen: false,
  };
  course.holes.push(hole);
  return hole;
}

export function holeNumber(course, holeId) {
  const i = course.holes.findIndex((h) => h.id === holeId);
  return i === -1 ? null : i + 1;
}

export function holeDistanceYd(hole) {
  if (!hole.tee || !hole.pin) return 0;
  return dist(hole.tee.x, hole.tee.y, hole.pin.x, hole.pin.y) * CELL_YD;
}

export function parForDistance(yd) {
  if (yd <= PAR3_MAX_YD) return 3;
  if (yd <= PAR4_MAX_YD) return 4;
  return 5;
}

export function holePar(hole) {
  return parForDistance(holeDistanceYd(hole));
}

export function validateHole(course, hole) {
  const reasons = [];
  if (!hole.tee) reasons.push('No tee placed.');
  else if (getZone(course, hole.tee.x, hole.tee.y) !== ZONE.TEE) reasons.push('Tee marker is not on a tee pad.');
  if (!hole.pin) reasons.push('No pin placed.');
  else if (getZone(course, hole.pin.x, hole.pin.y) !== ZONE.GREEN) reasons.push('Pin is not on a green.');
  if (hole.tee && hole.pin) {
    const yd = holeDistanceYd(hole);
    if (yd < HOLE_MIN_YD) reasons.push(`Hole is too short (${Math.round(yd)} yd, minimum ${HOLE_MIN_YD}).`);
    if (yd > HOLE_MAX_YD) reasons.push(`Hole is too long (${Math.round(yd)} yd, maximum ${HOLE_MAX_YD}).`);
  }
  return { valid: reasons.length === 0, reasons };
}

// --- sections ---------------------------------------------------------------
// A "section" is a contiguous blob of one zone type (4-connectivity): the unit the
// turf sim reports on and golfers form opinions about ("Green 3 rolls true").

const ASSOC_MAX_CELLS = 12; // how far a blob centroid can sit from a hole line and still belong to it

export function labelSections(course) {
  const { w, h, zones } = course;
  const seen = new Uint8Array(w * h);
  const sections = [];
  const stack = [];

  for (let start = 0; start < w * h; start++) {
    if (seen[start]) continue;
    const zone = zones[start];
    if (!SECTION_ZONES.has(zone)) {
      seen[start] = 1;
      continue;
    }
    // BFS/DFS flood fill
    const cells = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && !seen[i - 1] && zones[i - 1] === zone) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && zones[i + 1] === zone) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - w] && zones[i - w] === zone) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !seen[i + w] && zones[i + w] === zone) { seen[i + w] = 1; stack.push(i + w); }
    }
    let sx = 0, sy = 0;
    for (const i of cells) { sx += i % w; sy += (i / w) | 0; }
    sections.push({
      id: sections.length,
      zone,
      cells,
      size: cells.length,
      centroid: { x: sx / cells.length, y: sy / cells.length },
      holeId: null,
      name: '',
    });
  }

  associateAndName(course, sections);
  return sections;
}

function containsCell(section, course, pos) {
  if (!pos) return false;
  const i = idx(course, pos.x, pos.y);
  return section.cells.includes(i);
}

function nearestHole(course, pt) {
  let best = null;
  let bestD = Infinity;
  for (const hole of course.holes) {
    if (!hole.tee || !hole.pin) continue;
    const d = distToSegment(pt.x, pt.y, hole.tee.x, hole.tee.y, hole.pin.x, hole.pin.y);
    if (d < bestD) { bestD = d; best = hole; }
  }
  return bestD <= ASSOC_MAX_CELLS ? best : null;
}

function associateAndName(course, sections) {
  // marker containment first (a green owns its pin, a tee pad its marker)
  for (const section of sections) {
    if (section.zone === ZONE.GREEN) {
      const owner = course.holes.find((h) => containsCell(section, course, h.pin));
      if (owner) { section.holeId = owner.id; continue; }
    }
    if (section.zone === ZONE.TEE) {
      const owner = course.holes.find((h) => containsCell(section, course, h.tee));
      if (owner) { section.holeId = owner.id; continue; }
    }
    const near = nearestHole(course, section.centroid);
    section.holeId = near ? near.id : null;
  }

  // names — count fairway sections per hole for lettering
  const fairwayCount = new Map();
  for (const s of sections) {
    if (s.zone === ZONE.FAIRWAY && s.holeId != null) {
      fairwayCount.set(s.holeId, (fairwayCount.get(s.holeId) || 0) + 1);
    }
  }
  const fairwaySeen = new Map();
  for (const s of sections) {
    const n = s.holeId != null ? holeNumber(course, s.holeId) : null;
    switch (s.zone) {
      case ZONE.GREEN: {
        const ownsPin = course.holes.some((h) => h.id === s.holeId && containsCell(s, course, h.pin));
        s.name = ownsPin ? `Green ${n}` : n ? `Green (Hole ${n})` : 'Unattached green';
        break;
      }
      case ZONE.TEE: {
        const ownsTee = course.holes.some((h) => h.id === s.holeId && containsCell(s, course, h.tee));
        s.name = ownsTee ? `Tee ${n}` : n ? `Tee (Hole ${n})` : 'Unattached tee';
        break;
      }
      case ZONE.FAIRWAY: {
        if (n == null) { s.name = 'Unattached fairway'; break; }
        const total = fairwayCount.get(s.holeId) || 1;
        if (total === 1) { s.name = `Fairway ${n}`; break; }
        const k = (fairwaySeen.get(s.holeId) || 0);
        fairwaySeen.set(s.holeId, k + 1);
        s.name = `Fairway ${n} · ${String.fromCharCode(97 + k)}`;
        break;
      }
      case ZONE.BUNKER: {
        if (n == null) { s.name = 'Bunker'; break; }
        const hole = course.holes.find((h) => h.id === s.holeId);
        const nearPin = hole && hole.pin && dist(s.centroid.x, s.centroid.y, hole.pin.x, hole.pin.y) <= 6;
        s.name = nearPin ? `Greenside bunker · H${n}` : `Fairway bunker · H${n}`;
        break;
      }
      case ZONE.WATER:
        s.name = 'Pond';
        break;
      case ZONE.ROUGH:
        s.name = n ? `Rough (Hole ${n})` : 'Rough';
        break;
      default:
        s.name = 'Section';
    }
  }
}

// --- design rating -----------------------------------------------------------
// The architecture half of the course's quality score (turf condition joins in
// Phase 2). 0..100. Components chosen so a competent 9-hole layout with hazards
// and some land movement sits around 55-70 before conditioning.

export function courseDesignRating(course, sections = null) {
  const holes = course.holes.filter((h) => validateHole(course, h).valid);
  if (holes.length === 0) return 0;
  const secs = sections || labelSections(course);

  // 45 pts: playable holes (renovation/construction count partially — the bones
  // exist but nobody can play them today)
  let openEquiv = 0;
  for (const h of holes) {
    if (h.status === HOLE_STATUS.OPEN) openEquiv += 1;
    else if (h.status === HOLE_STATUS.RENOVATION) openEquiv += 0.4;
    else if (h.status === HOLE_STATUS.CONSTRUCTION) openEquiv += 0.2;
  }
  const holesPts = Math.min(openEquiv / 9, 1) * 45;

  // 10 pts: par variety
  const pars = new Set(holes.map((h) => holePar(h)));
  const varietyPts = (pars.size / 3) * 10;

  // 10 pts: total length vs a full-size 9
  const totalYd = holes.reduce((a, h) => a + holeDistanceYd(h), 0);
  const lengthPts = Math.min(totalYd / 3200, 1) * 10;

  // 8 pts: bunkering, 6 pts: water in play
  const bunkers = secs.filter((s) => s.zone === ZONE.BUNKER).length;
  const waters = secs.filter((s) => s.zone === ZONE.WATER).length;
  const bunkerPts = Math.min(bunkers / 10, 1) * 8;
  const waterPts = Math.min(waters / 2, 1) * 6;

  // 8 pts: green sizing in a healthy band (5–14 cells ≈ 300–900 sq yd)
  const greens = secs.filter((s) => s.zone === ZONE.GREEN && s.holeId != null);
  let greenPts = 0;
  if (greens.length) {
    const good = greens.filter((g) => g.size >= 5 && g.size <= 14).length;
    greenPts = (good / greens.length) * 8;
  }

  // 8 pts: land movement (std-dev of elevation across in-play cells)
  let n = 0, mean = 0, m2 = 0;
  for (let i = 0; i < course.zones.length; i++) {
    if (course.zones[i] === ZONE.OUT) continue;
    n++;
    const v = course.elevation[i];
    const d = v - mean;
    mean += d / n;
    m2 += d * (v - mean);
  }
  const sd = n > 1 ? Math.sqrt(m2 / n) : 0;
  const elevPts = Math.min(sd / 6, 1) * 8;

  // 5 pts: enough fairway to actually play on
  const fairwayCells = secs.filter((s) => s.zone === ZONE.FAIRWAY).reduce((a, s) => a + s.size, 0);
  const fairwayPts = Math.min(fairwayCells / (holes.length * 50), 1) * 5;

  return clamp(
    holesPts + varietyPts + lengthPts + bunkerPts + waterPts + greenPts + elevPts + fairwayPts,
    0, 100,
  );
}
