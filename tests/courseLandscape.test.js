import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAuthoredTerrainProfiles,
  authoredProfileFeet,
  compileVegetationExclusions,
  tallVegetationAllowed,
  vegetationExclusionAt,
} from '../src/sim/courseLandscape.js';

function terrainFixture({ metadata = true, flat = false, shoulderSide = 'right' } = {}) {
  const w = 20;
  const h = 13;
  const elevation = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) elevation[y * w + x] = flat ? 10 : (y - 6) * 5 + x * 0.1;
  }
  const hole = {
    id: 1,
    line: [{ x: 2.5, y: 6.5 }, { x: 17.5, y: 6.5 }],
    width: [{ t: 0, w: 16 }, { t: 1, w: 16 }],
    roughW: 8,
    tees: [{ x: 2.5, y: 6.5 }],
  };
  if (metadata) {
    hole.terrainProfile = {
      relativeFeet: [[0, 0], [0.5, 4], [1, 8]],
      landingPlateau: { t0: 0.3, t1: 0.7, maxCrossSlope: 0.025 },
      approachShoulder: { t0: 0.75, t1: 0.95, side: shoulderSide, heightFt: 2 },
    };
  }
  return { w, h, elevation, vec: { holes: [hole] }, paths: [] };
}

test('authoredProfileFeet linearly evaluates exact stops, clamps, and accepts unsorted input', () => {
  const profile = { relativeFeet: [[1, 10], [0, 0], [0.5, 4]] };
  assert.equal(authoredProfileFeet(profile, -1), 0);
  assert.equal(authoredProfileFeet(profile, 0.25), 2);
  assert.equal(authoredProfileFeet(profile, 0.5), 4);
  assert.equal(authoredProfileFeet(profile, 0.75), 7);
  assert.equal(authoredProfileFeet(profile, 2), 10);
  assert.equal(authoredProfileFeet(null, 0.5), 0);
});

test('terrain profiles are deterministic and metadata-free courses are exact no-ops', () => {
  const a = terrainFixture();
  const b = terrainFixture();
  const da = applyAuthoredTerrainProfiles(a);
  const db = applyAuthoredTerrainProfiles(b);
  assert.deepEqual(a.elevation, b.elevation);
  assert.deepEqual(da, db);
  assert.equal(da.appliedHoles, 1);
  assert.ok(da.changedCells > 0);

  const noOp = terrainFixture({ metadata: false });
  const before = Float32Array.from(noOp.elevation);
  const diagnostic = applyAuthoredTerrainProfiles(noOp);
  assert.deepEqual(noOp.elevation, before);
  assert.deepEqual(diagnostic, {
    appliedHoles: 0, changedCells: 0, maxAbsDeltaFt: 0, holes: [],
  });
});

test('terrain profile anchors at the tee, reaches its uphill endpoint, and caps landing cross-slope', () => {
  const course = terrainFixture();
  const teeBefore = course.elevation[6 * course.w + 2];
  const diagnostic = applyAuthoredTerrainProfiles(course);

  assert.ok(Math.abs(course.elevation[6 * course.w + 2] - teeBefore) < 1e-5, 'tee remains the vertical anchor');
  assert.ok(Math.abs(course.elevation[6 * course.w + 17] - (teeBefore + 8)) < 1e-5, 'endpoint is eight feet uphill');

  const left = course.elevation[5 * course.w + 10];
  const right = course.elevation[7 * course.w + 10];
  const crossSlope = Math.abs(right - left) / (2 * 8 * 3);
  assert.ok(crossSlope <= 0.025001, `landing cross-slope was ${crossSlope}`);
  assert.equal(diagnostic.holes[0].endpointRelativeFt, 8);
});

test('approach shoulder raises only the authored side of play', () => {
  const rightCourse = terrainFixture({ flat: true });
  applyAuthoredTerrainProfiles(rightCourse);
  const left = rightCourse.elevation[5 * rightCourse.w + 15];
  const center = rightCourse.elevation[6 * rightCourse.w + 15];
  const right = rightCourse.elevation[7 * rightCourse.w + 15];
  assert.ok(Math.abs(left - center) < 1e-6, 'left side has no right-shoulder lift');
  assert.ok(Math.abs((right - center) - 1) < 1e-5, 'halfway to the fairway edge receives half of the 2ft shoulder');

  const leftCourse = terrainFixture({ flat: true, shoulderSide: 'left' });
  applyAuthoredTerrainProfiles(leftCourse);
  const mirroredLeft = leftCourse.elevation[5 * leftCourse.w + 15];
  const mirroredCenter = leftCourse.elevation[6 * leftCourse.w + 15];
  const mirroredRight = leftCourse.elevation[7 * leftCourse.w + 15];
  assert.ok(Math.abs((mirroredLeft - mirroredCenter) - 1) < 1e-5, 'left metadata mirrors the shoulder lift');
  assert.ok(Math.abs(mirroredRight - mirroredCenter) < 1e-6, 'right side has no left-shoulder lift');
});

test('landing crown preserves the centerline profile and eases both fairway shoulders down', () => {
  const course = terrainFixture({ flat: true });
  const noCrown = terrainFixture({ flat: true });
  course.vec.holes[0].terrainProfile.landingCrown = {
    t0: 0.2, t1: 0.8, edgeDropFt: 1.2,
  };
  applyAuthoredTerrainProfiles(course);
  applyAuthoredTerrainProfiles(noCrown);
  const center = course.elevation[6 * course.w + 10];
  const left = course.elevation[5 * course.w + 10];
  const right = course.elevation[7 * course.w + 10];
  assert.ok(Math.abs(center - noCrown.elevation[6 * noCrown.w + 10]) < 1e-6,
    'centerline remains on the exact authored profile');
  assert.ok(left < center && right < center, 'both landing shoulders fall away from the crown');
  assert.ok(Math.abs(left - right) < 1e-6, 'crown is symmetric on flat source terrain');
});

function vegetationFixture({ metadata = true } = {}) {
  const exclusions = metadata ? [
    { kind: 'route', t0: 0, t1: 0.4, clearHalfYd: 16 },
    { kind: 'route', t0: 0.4, t1: 0.8, beyondFairwayYd: 8 },
    { kind: 'green', bufferYd: 8 },
    { kind: 'bunker', bufferYd: 8 },
    { kind: 'path', bufferYd: 6 },
  ] : [];
  return {
    vec: {
      holes: [{
        id: 7,
        line: [{ x: 2, y: 5 }, { x: 12, y: 5 }],
        width: [{ t: 0, w: 8 }, { t: 1, w: 8 }],
        green: { pts: [{ x: 17, y: 4 }, { x: 19, y: 4 }, { x: 19, y: 6 }, { x: 17, y: 6 }] },
        bunkers: [{ id: 71, pts: [{ x: 7, y: 13 }, { x: 9, y: 13 }, { x: 9, y: 15 }, { x: 7, y: 15 }] }],
        vegetation: { exclusions },
      }],
    },
    paths: [{ id: 3, pts: [{ x: 2, y: 12 }, { x: 2, y: 18 }], width: 4 }],
  };
}

test('compiled route exclusions honor t boundaries, absolute clearance, and fairway-edge clearance', () => {
  const compiled = compileVegetationExclusions(vegetationFixture());
  assert.equal(compiled.counts.route, 2);
  assert.equal(tallVegetationAllowed(compiled, 4, 7), false, 'absolute 16yd boundary is inclusive');
  assert.equal(tallVegetationAllowed(compiled, 4, 7.001), true, 'outside absolute boundary is allowed');
  assert.equal(tallVegetationAllowed(compiled, 6, 7), false, 'shared t=.4 boundary is covered');
  assert.equal(tallVegetationAllowed(compiled, 8, 7), false, '8yd fairway half-width + 8yd buffer is inclusive');
  assert.equal(tallVegetationAllowed(compiled, 11, 7), true, 'route point beyond authored t range is allowed');
  const hit = vegetationExclusionAt(compiled, 8, 7);
  assert.equal(hit.kind, 'route');
  assert.equal(hit.clearanceYd, 16);
});

test('green, bunker, and path exclusions include their feature boundaries and buffers', () => {
  const compiled = compileVegetationExclusions(vegetationFixture());
  assert.deepEqual(compiled.counts, { route: 2, green: 1, bunker: 1, path: 1 });

  assert.equal(vegetationExclusionAt(compiled, 17, 4).kind, 'green', 'green boundary excluded');
  assert.equal(vegetationExclusionAt(compiled, 7, 13).kind, 'bunker', 'bunker boundary excluded');
  assert.equal(vegetationExclusionAt(compiled, 3, 17).kind, 'path', 'path edge plus buffer boundary excluded');
  assert.equal(tallVegetationAllowed(compiled, 3.001, 17), true, 'point beyond the path buffer is allowed');
  assert.equal(tallVegetationAllowed(compiled, 19, 15), true, 'unrelated open ground remains plantable');
});

test('courses without vegetation metadata compile to an allow-all no-op', () => {
  const compiled = compileVegetationExclusions(vegetationFixture({ metadata: false }));
  assert.deepEqual(compiled, { entries: [], counts: { route: 0, green: 0, bunker: 0, path: 0 } });
  assert.equal(tallVegetationAllowed(compiled, 2, 5), true);
  assert.equal(vegetationExclusionAt(compiled, 2, 5), null);
});
