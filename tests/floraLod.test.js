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

test('distant boundary planting stays on the cheap proxy silhouette', () => {
  const boundaryFar = floraLodChoice('spruce_a', 400, null, { boundary: true });
  const boundaryLight = floraLodChoice('birch_a', 400, null, { boundary: true });
  const authoredLightTree = floraLodChoice('birch_a', 2, null, { tree: true });
  const authoredSupport = floraLodChoice('shrub_round', 900, null);

  assert.deepEqual(boundaryFar, {
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

// The boundary belt is ~3,000 instances and used to return a proxy with no
// distance test at all, so the treeline you stand next to rendered as the
// 158-triangle flat-shaded `pine_far` cone stack. That belt is the horizon in
// every ground-level shot, so it capped the look of the whole course.
test('boundary planting graduates to hero geometry once the camera is close', () => {
  const near = floraLodChoice('spruce_a', 20, null, { boundary: true });
  assert.equal(near.renderId, 'spruce_a', 'a treeline tree 20 yd away must use real geometry');
  assert.equal(near.tier, 'boundary-hero');
  assert.equal(near.hero, true);

  const atEdge = floraLodChoice('pine_a', FLORA_LOD_DEFAULTS.boundaryHeroEnterYd + 1, null, { boundary: true });
  assert.equal(atEdge.renderId, 'pine_far', 'just outside the band stays cheap');
  assert.equal(atEdge.tier, 'boundary-proxy');
});

test('boundary hero band is much tighter than the authored band and hysteretic', () => {
  const { boundaryHeroEnterYd, boundaryHeroExitYd, heroEnterYd } = FLORA_LOD_DEFAULTS;
  assert.ok(boundaryHeroEnterYd < heroEnterYd,
    'thousands of belt instances must not promote at the authored-tree radius');
  assert.ok(boundaryHeroExitYd > boundaryHeroEnterYd, 'needs hysteresis to avoid popping');

  const entering = floraLodChoice('pine_a', boundaryHeroEnterYd - 1, false, { boundary: true });
  const retained = floraLodChoice('pine_a', boundaryHeroExitYd - 1, entering.hero, { boundary: true });
  const exited = floraLodChoice('pine_a', boundaryHeroExitYd + 1, retained.hero, { boundary: true });

  assert.equal(entering.tier, 'boundary-hero');
  assert.equal(retained.tier, 'boundary-hero', 'must not pop back while hovering the threshold');
  assert.equal(exited.tier, 'boundary-proxy');
});

test('boundary flora never joins the shadow map, hero or not', () => {
  // The belt is dense and rings the property; adding it to the fitted sun
  // shadow map would cost far more than the silhouette gain is worth.
  for (const distance of [5, 20, 60, 400]) {
    assert.equal(floraLodChoice('spruce_a', distance, null, { boundary: true }).castShadow, false);
    assert.equal(floraLodChoice('birch_a', distance, null, { boundary: true }).castShadow, false);
  }
});

test('LOD buckets refresh only after meaningful camera travel', () => {
  const origin = { x: 10, z: -20 };
  assert.equal(floraLodNeedsRefresh(null, origin), true);
  assert.equal(floraLodNeedsRefresh(origin, { x: 27, z: -20 }), false);
  assert.equal(floraLodNeedsRefresh(origin, { x: 28, z: -20 }), true);
  assert.equal(floraLodNeedsRefresh(origin, { x: 22, z: -7 }), false);
});
