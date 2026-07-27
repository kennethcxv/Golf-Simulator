import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSTRUCTION_FINISH_CATEGORIES,
  CONSTRUCTION_FINISH_FAMILY_COUNT,
  CONSTRUCTION_FINISH_VARIANT_COUNT,
  CONSTRUCTION_QUALITY_LEVELS,
  allConstructionFinishVariants,
  constructionFinishVariant,
} from '../src/data/constructionFinishes.js';
import {
  DEFAULT_CONSTRUCTION_INSTALLATIONS,
  ensureConstructionFinishes,
  installConstructionFinish,
  installedConstructionFinish,
  ownsConstructionFinish,
  purchaseConstructionFinish,
} from '../src/sim/constructionFinishes.js';

function state(cash = 1_000_000) {
  return {
    cash,
    clock: { minutes: 321 },
    ledger: {
      today: { revenue: {}, expense: { works: 0 } },
      txLog: [],
    },
    shop: { reno: {} },
  };
}

test('the construction catalog covers every requested family at all five quality levels', () => {
  assert.deepEqual(CONSTRUCTION_FINISH_CATEGORIES.map(({ id }) => id), [
    'flooring', 'ceilings', 'walls', 'windows', 'doors', 'garage-doors', 'lighting',
  ]);
  assert.equal(CONSTRUCTION_QUALITY_LEVELS.length, 5);
  assert.equal(CONSTRUCTION_FINISH_FAMILY_COUNT, 35);
  assert.equal(CONSTRUCTION_FINISH_VARIANT_COUNT, 175);
  const variants = allConstructionFinishVariants();
  assert.equal(variants.length, 175);
  assert.equal(new Set(variants.map(({ id }) => id)).size, variants.length);
  for (const category of CONSTRUCTION_FINISH_CATEGORIES) {
    for (const family of category.finishes) {
      const familyVariants = variants.filter((entry) => (
        entry.categoryId === category.id && entry.finishId === family.id
      ));
      assert.deepEqual(familyVariants.map(({ qualityLevel }) => qualityLevel), [1, 2, 3, 4, 5]);
      for (let index = 1; index < familyVariants.length; index += 1) {
        assert.ok(familyVariants[index].cost > familyVariants[index - 1].cost, family.label);
        assert.ok(familyVariants[index].warrantyYears > familyVariants[index - 1].warrantyYears, family.label);
      }
    }
  }
});

test('reference-requested finish names are all represented', () => {
  const ids = new Set(CONSTRUCTION_FINISH_CATEGORIES.flatMap(({ finishes }) => finishes.map(({ id }) => id)));
  for (const required of [
    'concrete', 'vinyl', 'laminate', 'hardwood', 'luxury-hardwood', 'stone-tile', 'marble', 'herringbone',
    'drop-ceiling', 'commercial', 'wood-beams', 'vaulted', 'luxury-coffered',
    'drywall', 'paint', 'wood-panels', 'stone', 'luxury-trim', 'luxury-moulding',
    'cheap-aluminum', 'premium-black', 'luxury-country-club',
    'hollow-core', 'solid', 'glass', 'luxury-wood', 'double-entry', 'garage-door',
    'led-panels', 'track-lighting', 'pendant-lighting', 'luxury-chandeliers', 'wall-sconces', 'landscape-lighting',
  ]) assert.ok(ids.has(required), required);
});

test('construction state starts municipal, owns installed packages and remains identity-stable', () => {
  const st = state();
  const first = ensureConstructionFinishes(st);
  const second = ensureConstructionFinishes(st);
  assert.equal(first, second);
  for (const [categoryId, selection] of Object.entries(DEFAULT_CONSTRUCTION_INSTALLATIONS)) {
    assert.deepEqual(first.installed[categoryId], selection);
    assert.equal(ownsConstructionFinish(st, categoryId, selection.finishId, selection.qualityId), true);
  }
});

test('purchase bills once, installs immediately and a later owned install is free', () => {
  const st = state();
  const marble = constructionFinishVariant('flooring', 'marble', 'premium');
  const before = st.cash;
  const bought = purchaseConstructionFinish(st, 'flooring', 'marble', 'premium');
  assert.equal(bought.ok, true);
  assert.equal(bought.cost, marble.cost);
  assert.equal(st.cash, before - marble.cost);
  assert.equal(st.ledger.today.expense.works, marble.cost);
  assert.equal(installedConstructionFinish(st, 'flooring').id, marble.id);
  assert.equal(ownsConstructionFinish(st, 'flooring', 'marble', 'premium'), true);

  const concrete = installConstructionFinish(st, 'flooring', 'concrete', 'municipal');
  assert.equal(concrete.ok, true);
  assert.equal(concrete.cost, 0);
  const reinstall = purchaseConstructionFinish(st, 'flooring', 'marble', 'premium');
  assert.equal(reinstall.ok, true);
  assert.equal(reinstall.cost, 0);
  assert.equal(st.cash, before - marble.cost);
  assert.equal(st.shop.reno.constructionFinishes.purchaseHistory.length, 3);
});

test('invalid, unowned and unaffordable changes are rejected without mutation', () => {
  const st = state(10);
  const initial = ensureConstructionFinishes(st);
  const snapshot = JSON.stringify(initial);
  assert.equal(purchaseConstructionFinish(st, 'flooring', 'marble', 'luxury').ok, false);
  assert.equal(installConstructionFinish(st, 'flooring', 'hardwood', 'premium').ok, false);
  assert.equal(purchaseConstructionFinish(st, 'roof', 'thatch', 'luxury').ok, false);
  assert.equal(st.cash, 10);
  assert.equal(JSON.stringify(st.shop.reno.constructionFinishes), snapshot);
});

test('old and malformed finish state is normalized without losing valid ownership', () => {
  const st = state();
  st.shop.reno.constructionFinishes = {
    version: 0,
    installed: {
      flooring: { finishId: 'herringbone', qualityId: 'high-end' },
      windows: { finishId: 'paper', qualityId: 'impossible' },
    },
    owned: ['flooring:herringbone:high-end', 'bogus:value:data'],
    purchaseHistory: [{ selectionId: 'flooring:herringbone:high-end', cost: 42 }],
  };
  const normalized = ensureConstructionFinishes(st);
  assert.deepEqual(normalized.installed.flooring, { finishId: 'herringbone', qualityId: 'high-end' });
  assert.deepEqual(normalized.installed.windows, DEFAULT_CONSTRUCTION_INSTALLATIONS.windows);
  assert.equal(normalized.owned.includes('flooring:herringbone:high-end'), true);
  assert.equal(normalized.owned.includes('bogus:value:data'), false);
  assert.equal(normalized.purchaseHistory.length, 1);
});
