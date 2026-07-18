import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLORA_LOD_PROXY_BY_ID,
  FLORA_LOD_DEFAULTS,
  floraLodChoice,
  floraLodNeedsRefresh,
} from '../src/render3d/floraLod.js';

test('every expensive or conifer filler tree has a lightweight far proxy', () => {
  assert.deepEqual(FLORA_LOD_PROXY_BY_ID, {
    oak_a: 'fill_a',
    oak_b: 'fill_b',
    maple_a: 'birch_a',
    shade_a: 'fill_b',
    pine_a: 'pine_far',
    spruce_a: 'pine_far',
    pine_b: 'pine_far',
    cedar_a: 'pine_far',
  });
});

test('intentional hero trees retain full geometry throughout the near-player band', () => {
  for (const sourceId of Object.keys(FLORA_LOD_PROXY_BY_ID)) {
    const choice = floraLodChoice(sourceId, FLORA_LOD_DEFAULTS.heroEnterYd - 1, false);
    assert.equal(choice.renderId, sourceId);
    assert.equal(choice.tier, 'hero');
    assert.equal(choice.hero, true);
    assert.equal(choice.castShadow, true);
  }
});

test('hysteresis prevents hero/proxy popping while the camera hovers at the threshold', () => {
  const entering = floraLodChoice('oak_a', 124, false);
  const retained = floraLodChoice('oak_a', 140, entering.hero);
  const exited = floraLodChoice('oak_a', 151, retained.hero);
  const remainsProxy = floraLodChoice('oak_a', 140, exited.hero);

  assert.equal(entering.tier, 'hero');
  assert.equal(retained.tier, 'hero');
  assert.equal(exited.tier, 'proxy');
  assert.equal(remainsProxy.tier, 'proxy');
});

test('boundary heroes always use non-shadowing proxies while native light flora is preserved', () => {
  const boundaryHero = floraLodChoice('spruce_a', 2, null, { boundary: true });
  const boundaryLight = floraLodChoice('birch_a', 2, null, { boundary: true });
  const authoredLightTree = floraLodChoice('birch_a', 2, null, { tree: true });
  const authoredSupport = floraLodChoice('shrub_round', 900, null);

  assert.deepEqual(boundaryHero, {
    sourceId: 'spruce_a', renderId: 'pine_far', tier: 'boundary-proxy', hero: false, castShadow: false,
  });
  assert.equal(boundaryLight.renderId, 'birch_a');
  assert.equal(boundaryLight.tier, 'boundary-native');
  assert.equal(boundaryLight.castShadow, false);
  assert.equal(authoredLightTree.tier, 'native-light');
  assert.equal(authoredLightTree.castShadow, false);
  assert.equal(authoredSupport.renderId, 'shrub_round');
  assert.equal(authoredSupport.tier, 'native');
  assert.equal(authoredSupport.castShadow, true);
});

test('LOD buckets refresh only after meaningful camera travel', () => {
  const origin = { x: 10, z: -20 };
  assert.equal(floraLodNeedsRefresh(null, origin), true);
  assert.equal(floraLodNeedsRefresh(origin, { x: 27, z: -20 }), false);
  assert.equal(floraLodNeedsRefresh(origin, { x: 28, z: -20 }), true);
  assert.equal(floraLodNeedsRefresh(origin, { x: 22, z: -7 }), false);
});
