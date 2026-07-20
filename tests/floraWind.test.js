import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLORA_WIND_BASE_BY_KIND,
  floraWindEligible,
  floraWindStrength,
} from '../src/render3d/floraWind.js';

test('flora wind stays subtle, species-aware, and weather-responsive', () => {
  assert.equal(floraWindStrength('rock', 20), 0);
  assert.ok(floraWindStrength('palm', 6) > floraWindStrength('evergreen', 6));
  assert.ok(floraWindStrength('reed', 6) > floraWindStrength('deciduous', 6));
  assert.equal(floraWindStrength('deciduous', 12), FLORA_WIND_BASE_BY_KIND.deciduous * 2);
  assert.equal(floraWindStrength('deciduous', 0), FLORA_WIND_BASE_BY_KIND.deciduous * 0.2);
  assert.equal(floraWindStrength('unknown', Number.NaN), 0.008);
  assert.equal(floraWindEligible('oak_a', 'deciduous'), true);
  assert.equal(floraWindEligible('palm_a', 'palm'), true);
  assert.equal(floraWindEligible('deciduous_far', 'deciduous'), false);
  assert.equal(floraWindEligible('pine_far', 'evergreen'), false);
  assert.equal(floraWindEligible('rock_m', 'rock'), false);
});
