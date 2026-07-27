import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gradeModernPublicClubhouseTerrain,
  modernPublicClubhouseTerrainGradeAlpha,
} from '../src/render3d/modernPublicClubhouseTerrainGrade.js';

test('modern public clubhouse grading owns each authored hardscape footprint', () => {
  const origin = { centerX: 100, centerZ: 200 };
  assert.equal(modernPublicClubhouseTerrainGradeAlpha({ worldX: 100, worldZ: 200, ...origin }), 1);
  assert.equal(modernPublicClubhouseTerrainGradeAlpha({ worldX: 100, worldZ: 233, ...origin }), 1);
  assert.equal(modernPublicClubhouseTerrainGradeAlpha({ worldX: 130.3, worldZ: 247.2, ...origin }), 1);
  assert.equal(modernPublicClubhouseTerrainGradeAlpha({ worldX: 126.8, worldZ: 195.1, ...origin }), 1);
});

test('modern public clubhouse grading feathers to untouched course terrain', () => {
  const origin = { centerX: 0, centerZ: 0 };
  assert.equal(modernPublicClubhouseTerrainGradeAlpha({ worldX: 90, worldZ: 90, ...origin }), 0);
  const feather = modernPublicClubhouseTerrainGradeAlpha({
    worldX: 25.0,
    worldZ: 33.0,
    ...origin,
  });
  assert.ok(feather > 0 && feather < 1);
  assert.equal(gradeModernPublicClubhouseTerrain(7, 3, 1), 3);
  assert.equal(gradeModernPublicClubhouseTerrain(7, 3, 0), 7);
  assert.ok(gradeModernPublicClubhouseTerrain(7, 3, feather) < 7);
});

