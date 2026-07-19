import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SAVE_VERSION,
  deserialize,
  newGame,
  serialize,
  snapshot,
  update,
} from '../src/sim/state.js';
import {
  DISEASE,
  MAINTENANCE_RESOLUTION_YD,
  SURFACE,
  applyDivotMix,
  applyFungicideCourseMaintenancePath,
  calculateHoleCondition,
  clearCourseMaintenanceDebris,
  courseMaintenanceHourlyTick,
  fertilizeCourseMaintenancePath,
  finalizeCourseMaintenanceAction,
  inspectCourseMaintenanceAt,
  irrigateCourseMaintenancePath,
  levelDivot,
  maintenanceCellReport,
  maintenanceCellSaveId,
  markCourseMaintenanceRouteStep,
  mowCourseMaintenancePath,
  rakeCourseMaintenancePath,
  repairBallMark,
  selectCourseMaintenanceEquipment,
  selectHeroHole,
  toggleCourseInspection,
  worldPointForMaintenanceCell,
} from '../src/sim/courseMaintenance.js';

const FIELD_NAMES = [
  'heightQ',
  'moisture',
  'health',
  'wear',
  'diseasePressure',
  'fertilizer',
  'fertilizerPending',
  'compaction',
  'visual',
  'mowAngle',
  'mowQuality',
  'mowPasses',
  'diseaseType',
  'diseaseSeverity',
  'treatedDays',
  'bunkerSmooth',
  'rakeAngle',
  'lastMowDay',
  'lastIrrigationDay',
  'lastFertilizerDay',
  'lastRakeDay',
];

function stateOf() {
  return newGame('relaxed', 20260719);
}

function indicesOf(model, surface) {
  const result = [];
  for (let index = 0; index < model.surface.length; index++) {
    if (model.surface[index] === surface) result.push(index);
  }
  return result;
}

function interiorIndex(model, surface, predicate = () => true) {
  for (const index of indicesOf(model, surface)) {
    const x = index % model.width;
    const y = Math.floor(index / model.width);
    if (x < 2 || y < 2 || x >= model.width - 2 || y >= model.height - 2) continue;
    const around = [index - 1, index + 1, index - model.width, index + model.width];
    if (around.every((other) => model.surface[other] === surface) && predicate(index)) return index;
  }
  throw new Error('No interior maintenance cell found for surface ' + surface);
}

function coarseIndexAtPoint(state, point) {
  const courseX = point.x + (state.course.w * 8) / 2;
  const courseY = point.z + (state.course.h * 8) / 2;
  return Math.floor(courseY / 8) * state.course.w + Math.floor(courseX / 8);
}

test('hero selection is data-driven and the one-yard region represents every required surface', () => {
  const state = stateOf();
  const model = state.courseMaintenance;
  const selection = selectHeroHole(state);

  assert.equal(selection.hole.id, model.heroHoleId);
  assert.equal(model.heroHoleNumber, 4);
  assert.equal(model.resolutionYd, MAINTENANCE_RESOLUTION_YD);
  assert.equal(model.resolutionYd, 1);
  for (const surface of [
    SURFACE.GREEN,
    SURFACE.FRINGE,
    SURFACE.TEE,
    SURFACE.FAIRWAY,
    SURFACE.ROUGH,
    SURFACE.NATIVE,
    SURFACE.BUNKER,
  ]) assert.ok(indicesOf(model, surface).length > 0, 'missing surface ' + surface);

  const ids = new Set();
  let active = 0;
  for (let index = 0; index < model.surface.length; index++) {
    if (model.surface[index] === SURFACE.NONE) continue;
    ids.add(maintenanceCellSaveId(model, index));
    active++;
  }
  assert.equal(ids.size, active);
  assert.ok(active < model.surface.length, 'mask should skip land outside the selected region');
});

test('inspection reports real state and can be toggled without permanently coloring the course', () => {
  const state = stateOf();
  const model = state.courseMaintenance;
  const diseaseIndex = indicesOf(model, SURFACE.GREEN)
    .reduce((best, index) => (
      model.diseaseSeverity[index] > model.diseaseSeverity[best] ? index : best
    ));
  const point = worldPointForMaintenanceCell(model, diseaseIndex);

  assert.equal(toggleCourseInspection(state, true), true);
  const report = inspectCourseMaintenanceAt(state, point.x, point.z);
  assert.equal(report.saveId, maintenanceCellSaveId(model, diseaseIndex));
  assert.equal(report.targetHeightMm, 4);
  assert.equal(report.disease.type, DISEASE.DOLLAR_SPOT);
  assert.ok(report.problems.some((problem) => problem.includes('Dollar spot')));
  assert.deepEqual(maintenanceCellReport(model, diseaseIndex), report);
  assert.equal(toggleCourseInspection(state, false), false);
});

test('mowing follows a local path, leaves a stripe, syncs coarse turf, and rejects the wrong reel', () => {
  const state = stateOf();
  const model = state.courseMaintenance;
  const fairway = interiorIndex(
    model,
    SURFACE.FAIRWAY,
    (index) => model.heightQ[index] > model.targetHeightQ[index],
  );
  const far = indicesOf(model, SURFACE.FAIRWAY)
    .find((index) => Math.abs(index - fairway) > model.width * 20);
  const point = worldPointForMaintenanceCell(model, fairway);
  const coarse = coarseIndexAtPoint(state, point);
  const beforeFine = model.heightQ[fairway];
  const beforeFar = model.heightQ[far];
  const beforeCoarse = state.turf.heightMm[coarse];

  const cut = mowCourseMaintenancePath(state, {
    ...point,
    radiusYd: 2.1,
    directionRad: Math.PI / 2,
    speedYdPerSec: 8,
    mowerType: 'fairway-reel',
    bladesEngaged: true,
  });
  assert.equal(cut.ok, true);
  assert.ok(cut.changed > 0 && cut.changed < 30);
  assert.ok(model.heightQ[fairway] < beforeFine);
  assert.equal(model.heightQ[fairway], model.targetHeightQ[fairway]);
  assert.ok(model.mowPasses[fairway] > 0);
  assert.ok(model.mowAngle[fairway] >= 63 && model.mowAngle[fairway] <= 65);
  assert.equal(model.heightQ[far], beforeFar);
  assert.ok(state.turf.heightMm[coarse] < beforeCoarse);

  const green = interiorIndex(model, SURFACE.GREEN);
  const greenPoint = worldPointForMaintenanceCell(model, green);
  const wrong = mowCourseMaintenancePath(state, {
    ...greenPoint,
    radiusYd: 1.5,
    speedYdPerSec: 6,
    mowerType: 'fairway-reel',
    bladesEngaged: true,
  });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.wrongSurface > 0);
  assert.match(wrong.reason, /not suitable/i);
});

test('irrigation and fertilizer use local coverage, wetness, inventory, and delayed release', () => {
  const state = stateOf();
  const model = state.courseMaintenance;
  const fairways = indicesOf(model, SURFACE.FAIRWAY);
  const dry = fairways.reduce((best, index) => (
    model.moisture[index] < model.moisture[best] ? index : best
  ));
  const weak = fairways.reduce((best, index) => (
    model.fertilizer[index] < model.fertilizer[best] ? index : best
  ));
  const dryPoint = worldPointForMaintenanceCell(model, dry);
  const far = fairways.find((index) => {
    const point = worldPointForMaintenanceCell(model, index);
    return Math.hypot(point.x - dryPoint.x, point.z - dryPoint.z) > 30;
  });
  const farMoisture = model.moisture[far];
  const dryBefore = model.moisture[dry];

  const water = irrigateCourseMaintenancePath(state, {
    ...dryPoint,
    radiusYd: 2,
    dtSec: 1,
    pointsPerSecond: 18,
  });
  assert.equal(water.ok, true);
  assert.ok(model.moisture[dry] > dryBefore);
  assert.equal(model.moisture[far], farMoisture);
  irrigateCourseMaintenancePath(state, {
    ...dryPoint,
    radiusYd: 1.2,
    dtSec: 5,
    pointsPerSecond: 18,
  });
  assert.ok(model.moisture[dry] > 68, 'repeated watering should expose overwatering');
  assert.ok((model.visual[dry] & 2) !== 0, 'wetness visual bit should be active');

  const weakPoint = worldPointForMaintenanceCell(model, weak);
  const fertilizerBefore = model.fertilizer[weak];
  const inventoryBefore = model.inventory.fertilizerKg;
  const feed = fertilizeCourseMaintenancePath(state, {
    ...weakPoint,
    radiusYd: 2,
    dtSec: 1,
  });
  assert.equal(feed.ok, true);
  assert.ok(model.fertilizerPending[weak] > 0);
  assert.ok(model.inventory.fertilizerKg < inventoryBefore);
  assert.equal(model.fertilizer[weak], fertilizerBefore, 'fertilizer response is delayed');
  state.clock.minutes += 60;
  courseMaintenanceHourlyTick(state);
  assert.ok(model.fertilizer[weak] > fertilizerBefore);
});

test('the physical repair loop fixes divots, ball marks, footprints, debris, and disease', () => {
  const state = stateOf();
  const model = state.courseMaintenance;
  const initialScore = calculateHoleCondition(state).total;
  const initialIssueScore = model.score.categories.divotsAndBallMarks;

  assert.equal(markCourseMaintenanceRouteStep(state, 'review').ok, false);
  assert.equal(markCourseMaintenanceRouteStep(state, 'arrive').ok, true);
  assert.equal(markCourseMaintenanceRouteStep(state, 'review').ok, true);
  const inspected = model.issues.divots[0];
  toggleCourseInspection(state, true);
  assert.ok(inspectCourseMaintenanceAt(state, inspected.x, inspected.z));
  assert.equal(selectCourseMaintenanceEquipment(state, 'divotKit').ok, true);

  for (const divot of model.issues.divots) {
    assert.equal(applyDivotMix(state, divot.id, 1).complete, true);
    assert.equal(levelDivot(state, divot.id, 1).complete, true);
  }
  for (const mark of model.issues.ballMarks) {
    assert.equal(repairBallMark(state, mark.id, 1).complete, true);
  }
  for (const footprint of model.issues.bunkerFootprints) {
    const result = rakeCourseMaintenancePath(state, {
      x: footprint.x,
      z: footprint.z,
      radiusYd: 1.8,
      directionRad: Math.PI / 4,
      dtSec: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(footprint.repaired, true);
  }
  for (const debris of model.issues.debris) {
    assert.equal(clearCourseMaintenanceDebris(state, debris.id, 1).complete, true);
  }

  const diseased = model.runtime.activeIndices.reduce((best, index) => (
    model.diseaseSeverity[index] > model.diseaseSeverity[best] ? index : best
  ));
  const diseasePoint = worldPointForMaintenanceCell(model, diseased);
  const severityBefore = model.diseaseSeverity[diseased];
  const chemicalBefore = model.inventory.fungicideLiters;
  const treatment = applyFungicideCourseMaintenancePath(state, {
    ...diseasePoint,
    radiusYd: 2,
    dtSec: 1,
  });
  assert.equal(treatment.ok, true);
  assert.ok(model.diseaseSeverity[diseased] < severityBefore);
  assert.ok(model.treatedDays[diseased] > 0);
  assert.ok(model.inventory.fungicideLiters < chemicalBefore);

  const finalScore = finalizeCourseMaintenanceAction(state);
  assert.equal(finalScore.categories.divotsAndBallMarks, 100);
  assert.equal(finalScore.categories.debris, 100);
  assert.ok(finalScore.categories.bunkerCondition > 0);
  assert.ok(finalScore.total > initialScore);
  assert.ok(finalScore.categories.divotsAndBallMarks > initialIssueScore);
});

test('compressed save/load preserves every maintenance field, issue, route, score, and equipment state', () => {
  const state = stateOf();
  const model = state.courseMaintenance;
  markCourseMaintenanceRouteStep(state, 'arrive');
  markCourseMaintenanceRouteStep(state, 'review');
  selectCourseMaintenanceEquipment(state, 'hose');
  model.equipment.hose.connected = true;
  const mark = model.issues.ballMarks[0];
  repairBallMark(state, mark.id, 1);
  finalizeCourseMaintenanceAction(state);

  const fullSnapshot = snapshot(state);
  const legacySized = structuredClone(fullSnapshot);
  delete legacySized.courseMaintenance;
  legacySized.version = 3;
  const json = serialize(state);
  assert.ok(
    json.length <= JSON.stringify(legacySized).length * 1.2,
    'high-resolution state should add no more than 20% to save size',
  );
  const loaded = deserialize(json);
  assert.equal(loaded.version, SAVE_VERSION);
  assert.equal(loaded.courseMaintenance.persistence.reloadCount, 1);
  assert.deepEqual(loaded.courseMaintenance.route, model.route);
  assert.deepEqual(loaded.courseMaintenance.issues, model.issues);
  assert.deepEqual(loaded.courseMaintenance.equipment, model.equipment);
  assert.equal(loaded.courseMaintenance.score.total, model.score.total);
  for (const name of FIELD_NAMES) {
    assert.deepEqual(loaded.courseMaintenance[name], model[name], 'field mismatch: ' + name);
  }
});

test('pre-maintenance saves migrate safely and a long absence cannot destroy the hero turf', () => {
  const state = stateOf();
  const old = snapshot(state);
  delete old.courseMaintenance;
  old.version = 3;
  const migrated = deserialize(old);
  assert.equal(migrated.version, SAVE_VERSION);
  assert.ok(migrated.courseMaintenance);
  assert.match(migrated.courseMaintenance.saveIdPrefix, /^course-maintenance:hole-/);

  update(migrated, 14 * 24 * 60);
  const activeHealth = migrated.courseMaintenance.runtime.activeIndices
    .filter((index) => migrated.courseMaintenance.surface[index] !== SURFACE.BUNKER)
    .map((index) => migrated.courseMaintenance.health[index]);
  assert.ok(Math.min(...activeHealth) >= 25);
  assert.ok(Math.max(...activeHealth) <= 100);
  const reloaded = deserialize(serialize(migrated));
  assert.equal(reloaded.clock.minutes, migrated.clock.minutes);
  assert.ok(reloaded.courseMaintenance.score.total >= 0);
});
