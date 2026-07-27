import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gradePremiumClubhouseTerrain,
  premiumClubhouseTerrainGradeAlpha,
} from '../src/render3d/premiumClubhouseTerrainGrade.js';

const origin = { authoredOriginX: 10, authoredOriginZ: 20 };
const M_TO_YD = 1.0936133;

test('premium clubhouse grade fully owns the authored site and clears beyond its shoulder', () => {
  assert.equal(premiumClubhouseTerrainGradeAlpha({ worldX: 10, worldZ: 20, ...origin }), 1);
  assert.equal(premiumClubhouseTerrainGradeAlpha({
    worldX: 10 + 50 * M_TO_YD,
    worldZ: 20 + 86 * M_TO_YD,
    ...origin,
  }), 1);
  assert.equal(premiumClubhouseTerrainGradeAlpha({
    worldX: 10 + 59 * M_TO_YD,
    worldZ: 20,
    ...origin,
  }), 0);
});

test('premium clubhouse grade uses a smooth earthwork shoulder and stable target height', () => {
  const alpha = premiumClubhouseTerrainGradeAlpha({
    worldX: 10 + 54 * M_TO_YD,
    worldZ: 20,
    ...origin,
  });
  assert.ok(Math.abs(alpha - 0.5) < 1e-9);
  assert.equal(gradePremiumClubhouseTerrain(7, 3, alpha), 5);
  assert.equal(gradePremiumClubhouseTerrain(7, 3, 1), 3);
  assert.equal(gradePremiumClubhouseTerrain(7, 3, 0), 7);
});
