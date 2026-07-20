// Deterministic, performance-conscious golf shot planning.
//
// Nearby rendering samples these trajectories continuously. Mid/far simulation
// consumes the same launch/landing/stop result without rigid-body work.

import { ZONE, ZONE_NAMES } from './constants.js';
import { clamp, makeRng } from '../core/utils.js';
import { gridPoint, worldPoint, zoneAtWorld } from './golfRoutes.js';

export const SHOT_TYPE = Object.freeze({
  DRIVER: 'driver',
  FAIRWAY_WOOD: 'fairway-wood',
  IRON: 'iron',
  WEDGE: 'wedge',
  CHIP: 'chip',
  BUNKER: 'bunker',
  PUTT: 'putt',
});

const CARRY = {
  [SHOT_TYPE.DRIVER]: [185, 285],
  [SHOT_TYPE.FAIRWAY_WOOD]: [145, 225],
  [SHOT_TYPE.IRON]: [75, 185],
  [SHOT_TYPE.WEDGE]: [28, 105],
  [SHOT_TYPE.CHIP]: [8, 42],
  [SHOT_TYPE.BUNKER]: [6, 34],
  [SHOT_TYPE.PUTT]: [1.5, 34],
};

const FLIGHT_MINUTES = {
  [SHOT_TYPE.DRIVER]: 0.075,
  [SHOT_TYPE.FAIRWAY_WOOD]: 0.068,
  [SHOT_TYPE.IRON]: 0.058,
  [SHOT_TYPE.WEDGE]: 0.05,
  [SHOT_TYPE.CHIP]: 0.035,
  [SHOT_TYPE.BUNKER]: 0.04,
  [SHOT_TYPE.PUTT]: 0.045,
};

function hashSeed(...values) {
  let hash = 2166136261;
  for (const value of values) {
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0 || 1;
}

function courseHeightAt(course, point) {
  const cell = gridPoint(course, point);
  return (course.elevation[cell.y * course.w + cell.x] || 0) * 0.5;
}

function blockedByStructure(course, cell) {
  return (course.structures || []).some((structure) => (
    cell.x >= structure.x && cell.x < structure.x + structure.w
    && cell.y >= structure.y && cell.y < structure.y + structure.h
  ));
}

function acceptableLanding(course, point, shotType) {
  const cell = gridPoint(course, point);
  if (blockedByStructure(course, cell)) return false;
  const zone = course.zones[cell.y * course.w + cell.x];
  if (zone === ZONE.WATER || zone === ZONE.OUT) return false;
  if (shotType === SHOT_TYPE.PUTT && zone !== ZONE.GREEN) return false;
  return true;
}

function nearestSafeLanding(course, wanted, shotType, target) {
  if (acceptableLanding(course, wanted, shotType)) return wanted;
  const center = gridPoint(course, wanted);
  const targetCell = gridPoint(course, target);
  const candidates = [];
  for (let radius = 1; radius <= 10; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        if (x < 0 || y < 0 || x >= course.w || y >= course.h) continue;
        const point = worldPoint(course, { x, y });
        if (!acceptableLanding(course, point, shotType)) continue;
        const zone = course.zones[y * course.w + x];
        const zonePenalty = zone === ZONE.GREEN ? -4
          : zone === ZONE.FAIRWAY ? -2
            : zone === ZONE.BUNKER ? 5 : 0;
        const targetDistance = Math.hypot(targetCell.x - x, targetCell.y - y);
        candidates.push({ point, score: radius + targetDistance * 0.08 + zonePenalty });
      }
    }
    if (candidates.length) break;
  }
  candidates.sort((a, b) => a.score - b.score || a.point.z - b.point.z || a.point.x - b.point.x);
  return candidates[0]?.point || target;
}

export function lieAtWorld(course, point) {
  const zone = zoneAtWorld(course, point);
  return {
    zone,
    name: ZONE_NAMES[zone] || 'Unknown',
    kind: zone === ZONE.GREEN ? 'green'
      : zone === ZONE.TEE ? 'tee'
        : zone === ZONE.FAIRWAY ? 'fairway'
          : zone === ZONE.ROUGH ? 'rough'
            : zone === ZONE.BUNKER ? 'bunker'
              : zone === ZONE.WATER ? 'water' : 'out',
  };
}

export function chooseShotType(remainingYd, lie, shotNumber = 1) {
  if (lie?.kind === 'bunker') return SHOT_TYPE.BUNKER;
  if (lie?.kind === 'green' || remainingYd <= 9) return SHOT_TYPE.PUTT;
  if (remainingYd <= 34) return SHOT_TYPE.CHIP;
  if (remainingYd <= 105) return SHOT_TYPE.WEDGE;
  if (remainingYd <= 185) return SHOT_TYPE.IRON;
  if (remainingYd <= 225 || shotNumber > 1) return SHOT_TYPE.FAIRWAY_WOOD;
  return SHOT_TYPE.DRIVER;
}

function skillQuality(golfer) {
  // Existing golfer skill is handicap-like: lower is better.
  return clamp(1 - ((Number(golfer.skill ?? 18) - 2) / 30), 0.08, 0.98);
}

function conditionQuality(context, lie) {
  const condition = Number(context.courseCondition ?? 65) / 100;
  if (lie.kind === 'rough') return clamp(condition - Number(context.roughPenalty || 0.08), 0.25, 1);
  if (lie.kind === 'bunker') return clamp(Number(context.bunkerQuality ?? condition), 0.2, 1);
  if (lie.kind === 'green') return clamp(Number(context.greenQuality ?? condition), 0.25, 1);
  return clamp(condition, 0.25, 1);
}

function tendenciesFor(golfer) {
  const supplied = golfer.shotTendencies || {};
  const seed = hashSeed(golfer.id, golfer.name);
  const rng = makeRng(seed);
  return {
    shape: supplied.shape || (rng.next() < 0.45 ? 'fade' : rng.next() < 0.82 ? 'draw' : 'straight'),
    aggression: Number(supplied.aggression ?? (0.35 + rng.next() * 0.5)),
    missBias: Number(supplied.missBias ?? ((rng.next() - 0.5) * 0.7)),
  };
}

export function planGolfShot({
  course,
  partyId,
  golfer,
  holeIndex,
  shotNumber,
  start,
  target,
  startMinute,
  context = {},
}) {
  const remaining = Math.hypot(target.x - start.x, target.z - start.z);
  const lie = lieAtWorld(course, start);
  const shotType = chooseShotType(remaining, lie, shotNumber);
  const rng = makeRng(hashSeed(context.seed, partyId, golfer.id, holeIndex, shotNumber, shotType));
  const quality = skillQuality(golfer);
  const surface = conditionQuality(context, lie);
  const tendencies = tendenciesFor(golfer);
  const [minCarry, maxCarry] = CARRY[shotType];

  const abilityFraction = shotType === SHOT_TYPE.DRIVER ? 0.15 + quality * 0.55
    : shotType === SHOT_TYPE.FAIRWAY_WOOD ? 0.25 + quality * 0.6
      : shotType === SHOT_TYPE.IRON ? 0.55 + quality * 0.42
        : shotType === SHOT_TYPE.WEDGE ? 0.72 + quality * 0.25
          : 0.9 + quality * 0.1;
  const abilityCarry = minCarry + (maxCarry - minCarry) * abilityFraction;
  let carry = shotType === SHOT_TYPE.PUTT
    ? Math.min(remaining, maxCarry)
    : Math.min(remaining, abilityCarry * (0.96 + tendencies.aggression * 0.08));
  if (shotType !== SHOT_TYPE.PUTT && remaining < minCarry) carry = remaining;
  // Even a well-struck shot has distance dispersion. Most importantly, never
  // cap an over-hit at the pin: that old shortcut made every approach stop at
  // the cup and turned an ordinary nine-hole score into an implausible 18.
  const strikeSpread = shotType === SHOT_TYPE.PUTT
    ? (1 - quality) * 0.3 + 0.055
    : (1 - quality) * 0.22 + 0.025;
  const strikeVariance = (rng.next() - 0.5) * 2 * strikeSpread;
  carry *= clamp(1 + strikeVariance, 0.66, 1.28);
  if (lie.kind === 'rough') carry *= 0.82 + surface * 0.1;
  if (lie.kind === 'bunker') carry *= 0.68 + surface * 0.2;

  const dirX = (target.x - start.x) / (remaining || 1);
  const dirZ = (target.z - start.z) / (remaining || 1);
  const lateralScale = shotType === SHOT_TYPE.PUTT ? 0.25 : Math.max(1.1, carry * 0.055);
  const shapeSign = tendencies.shape === 'fade' ? 1 : tendencies.shape === 'draw' ? -1 : 0;
  const lateral = ((rng.next() - 0.5) * 2 * (1 - quality) + tendencies.missBias * 0.35 + shapeSign * 0.12)
    * lateralScale;
  const rawLanding = {
    x: start.x + dirX * carry - dirZ * lateral,
    z: start.z + dirZ * carry + dirX * lateral,
  };
  const landing = nearestSafeLanding(course, rawLanding, shotType, target);
  const landingLie = lieAtWorld(course, landing);

  const closeEnough = Math.hypot(target.x - landing.x, target.z - landing.z);
  const baseRoll = shotType === SHOT_TYPE.DRIVER ? 14
    : shotType === SHOT_TYPE.FAIRWAY_WOOD ? 10
      : shotType === SHOT_TYPE.IRON ? 5
        : shotType === SHOT_TYPE.WEDGE ? 2.2
          : shotType === SHOT_TYPE.CHIP ? 4.5
            : shotType === SHOT_TYPE.PUTT ? 0 : 1.2;
  const rollScale = landingLie.kind === 'green' ? Number(context.greenSpeed ?? 9) / 9
    : landingLie.kind === 'fairway' ? 0.85
      : landingLie.kind === 'rough' ? 0.28
        : landingLie.kind === 'bunker' ? 0.05 : 0;
  const roll = Math.min(closeEnough, Math.max(0, baseRoll * rollScale * (0.85 + rng.next() * 0.3)));
  const stopWanted = {
    x: landing.x + dirX * roll,
    z: landing.z + dirZ * roll,
  };
  let stop = nearestSafeLanding(course, stopWanted, shotType === SHOT_TYPE.PUTT ? SHOT_TYPE.PUTT : shotType, target);
  // The visible ball is measured in yards; a cup is only a few inches wide.
  // Keep a small gameplay allowance without treating every three-foot miss as
  // holed (the former 1.2-yard radius erased putting from the scorecard).
  if (Math.hypot(target.x - stop.x, target.z - stop.z) <= (shotType === SHOT_TYPE.PUTT ? 0.14 : 0.045)) {
    stop = { ...target };
  }

  const distance = Math.hypot(landing.x - start.x, landing.z - start.z);
  const launchY = courseHeightAt(course, start) + 0.08;
  const landingY = courseHeightAt(course, landing) + 0.06;
  const stopY = courseHeightAt(course, stop) + 0.045;
  const apex = shotType === SHOT_TYPE.PUTT ? 0.08
    : shotType === SHOT_TYPE.CHIP || shotType === SHOT_TYPE.BUNKER ? Math.max(3, distance * 0.17)
      : Math.max(8, Math.min(34, distance * 0.16));
  const flightMinutes = FLIGHT_MINUTES[shotType] * clamp(distance / Math.max(1, carry), 0.65, 1.35);
  const bounceMinutes = shotType === SHOT_TYPE.PUTT ? 0 : 0.018;
  const rollMinutes = Math.max(0.018, Math.min(0.09, roll / 150));
  const endMinute = startMinute + flightMinutes + bounceMinutes + rollMinutes;

  return {
    seed: hashSeed(context.seed, partyId, golfer.id, holeIndex, shotNumber, shotType),
    type: shotType,
    club: shotType,
    lie,
    landingLie,
    start: { x: start.x, y: launchY, z: start.z },
    target: { x: target.x, y: courseHeightAt(course, target) + 0.045, z: target.z },
    landing: { x: landing.x, y: landingY, z: landing.z },
    stop: { x: stop.x, y: stopY, z: stop.z },
    distanceYd: +distance.toFixed(2),
    remainingBeforeYd: +remaining.toFixed(2),
    remainingAfterYd: +Math.hypot(target.x - stop.x, target.z - stop.z).toFixed(2),
    apexYd: +apex.toFixed(2),
    startMinute,
    flightEndMinute: startMinute + flightMinutes,
    bounceEndMinute: startMinute + flightMinutes + bounceMinutes,
    endMinute,
    holed: stop.x === target.x && stop.z === target.z,
    penaltyStrokes: 0,
    safetyAdjusted: rawLanding.x !== landing.x || rawLanding.z !== landing.z,
  };
}

export function sampleBallPosition(shot, minute) {
  if (!shot) return null;
  if (minute <= shot.startMinute) return { ...shot.start, phase: 'launch' };
  if (minute < shot.flightEndMinute) {
    const t = clamp((minute - shot.startMinute) / Math.max(1e-6, shot.flightEndMinute - shot.startMinute), 0, 1);
    return {
      x: shot.start.x + (shot.landing.x - shot.start.x) * t,
      y: shot.start.y + (shot.landing.y - shot.start.y) * t + Math.sin(Math.PI * t) * shot.apexYd,
      z: shot.start.z + (shot.landing.z - shot.start.z) * t,
      phase: 'flight',
    };
  }
  if (minute < shot.bounceEndMinute) {
    const t = clamp((minute - shot.flightEndMinute) / Math.max(1e-6, shot.bounceEndMinute - shot.flightEndMinute), 0, 1);
    return {
      x: shot.landing.x + (shot.stop.x - shot.landing.x) * t * 0.18,
      y: shot.landing.y + Math.sin(Math.PI * t) * Math.min(0.7, shot.apexYd * 0.04),
      z: shot.landing.z + (shot.stop.z - shot.landing.z) * t * 0.18,
      phase: 'bounce',
    };
  }
  if (minute < shot.endMinute) {
    const t = clamp((minute - shot.bounceEndMinute) / Math.max(1e-6, shot.endMinute - shot.bounceEndMinute), 0, 1);
    const eased = 1 - (1 - t) * (1 - t);
    return {
      x: shot.landing.x + (shot.stop.x - shot.landing.x) * eased,
      y: shot.landing.y + (shot.stop.y - shot.landing.y) * eased,
      z: shot.landing.z + (shot.stop.z - shot.landing.z) * eased,
      phase: 'roll',
    };
  }
  return { ...shot.stop, phase: 'stopped' };
}
