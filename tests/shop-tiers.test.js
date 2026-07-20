import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { SHOP_CATALOG, RETAIL_CATS } from '../src/data/shopItems.js';
import { shopLightingTier } from '../src/data/shopLayout.js';
import { activeFixtures, ensureLayout, routesIntact } from '../src/sim/layout.js';

const atTier = (tier) => {
  const state = newGame('relaxed', 44);
  ensureLayout(state);
  state.shop.unlockedTier = tier;
  return state;
};

test('basic, standard and premium tiers are distinct physical shop presentations', () => {
  const basic = activeFixtures(atTier(1));
  const standard = activeFixtures(atTier(2));
  const premium = activeFixtures(atTier(3));

  assert.ok(basic.length < standard.length, 'standard adds fixtures to the basic floor');
  assert.ok(standard.length < premium.length, 'premium adds fitting, demo and display fixtures');
  assert.equal(basic.some((f) => f.id === 'shoerack'), false);
  assert.equal(standard.some((f) => f.id === 'shoerack'), true);
  assert.equal(standard.some((f) => f.id === 'fittingroom'), false);
  assert.equal(premium.some((f) => f.id === 'fittingroom'), true);
  assert.equal(premium.some((f) => f.id === 'putting_demo'), true);
});

test('every orderable retail line has an active home fixture at its supplier tier', () => {
  for (const tier of [1, 2, 3]) {
    const homes = new Set(activeFixtures(atTier(tier)).flatMap((f) => f.skus || []));
    for (const sku of SHOP_CATALOG.filter((s) => RETAIL_CATS.has(s.cat) && s.tier <= tier)) {
      assert.ok(homes.has(sku.id), `tier ${tier} can physically present ${sku.id}`);
    }
  }
});

test('lighting quality rises by tier while basic remains fully lit', () => {
  const basic = shopLightingTier(1);
  const standard = shopLightingTier(2);
  const premium = shopLightingTier(3);
  assert.equal(basic.key, 'basic');
  assert.ok(basic.practicalScale >= 0.8, 'basic lighting is modest, not broken');
  assert.ok(basic.practicalScale < standard.practicalScale);
  assert.ok(standard.practicalScale < premium.practicalScale);
  assert.ok(basic.displayScale < standard.displayScale);
  assert.ok(standard.displayScale < premium.displayScale);
  assert.equal(premium.premiumAccent, 1);
});

test('every supported tier retains door, checkout, stockroom and experience routes', () => {
  for (const tier of [1, 2, 3]) {
    assert.equal(routesIntact(atTier(tier)), true, `tier ${tier} floor is routable`);
  }
});
