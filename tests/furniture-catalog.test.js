import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FURNITURE_BY_ID, FURNITURE_CATALOG, FURNITURE_CATEGORIES,
  FURNITURE_FAMILIES, FURNITURE_TIERS, furnitureCatalogForCategory,
  validateFurnitureCatalog,
} from '../src/data/furnitureCatalog.js';

const requiredFields = [
  'price', 'quality', 'brandTier', 'description', 'thumbnail', 'category',
  'unlockLevel', 'requiredReputation', 'maintenanceValue', 'comfortValue', 'prestigeValue',
];

test('the complete catalog contains hundreds of valid purchasable objects', () => {
  assert.ok(FURNITURE_CATALOG.length >= 300, `catalog has ${FURNITURE_CATALOG.length} objects`);
  assert.ok(FURNITURE_FAMILIES.length >= 60, `catalog has ${FURNITURE_FAMILIES.length} progression families`);
  assert.deepEqual(validateFurnitureCatalog(), { ok: true, errors: [] });
  assert.equal(new Set(FURNITURE_CATALOG.map((item) => item.id)).size, FURNITURE_CATALOG.length);
  for (const item of FURNITURE_CATALOG) {
    assert.equal(item.isPurchasable, true, item.id);
    for (const field of requiredFields) assert.ok(Object.hasOwn(item, field), `${item.id}.${field}`);
    assert.ok(item.price > 0, `${item.id}.price`);
    assert.ok(item.quality >= 0 && item.quality <= 100, `${item.id}.quality`);
    assert.ok(item.description.length >= 80, `${item.id}.description is useful copy`);
    assert.match(item.thumbnail, /^data:image\/svg\+xml/, `${item.id}.thumbnail is a real renderable asset`);
    assert.ok(Number.isInteger(item.maintenanceValue) && item.maintenanceValue >= 0, `${item.id}.maintenanceValue`);
    assert.ok(Number.isInteger(item.comfortValue) && item.comfortValue >= 0, `${item.id}.comfortValue`);
    assert.ok(Number.isInteger(item.prestigeValue) && item.prestigeValue >= 0, `${item.id}.prestigeValue`);
  }
});

test('every furniture family has one linked object at each of the five progression tiers', () => {
  assert.deepEqual(FURNITURE_TIERS.map((tier) => tier.id), ['basic', 'commercial', 'retail', 'boutique', 'luxury']);
  for (const family of FURNITURE_FAMILIES) {
    const rows = family.itemIds.map((id) => FURNITURE_BY_ID[id]);
    assert.equal(rows.length, 5, family.id);
    assert.deepEqual(rows.map((row) => row.progressionTier), FURNITURE_TIERS.map((tier) => tier.id), family.id);
    assert.deepEqual(rows.map((row) => row.progression), Array(5).fill(family.itemIds), family.id);
    for (let index = 1; index < rows.length; index += 1) {
      const before = rows[index - 1];
      const after = rows[index];
      assert.equal(before.nextId, after.id, `${family.id} forward link ${index}`);
      assert.equal(after.previousId, before.id, `${family.id} backward link ${index}`);
      assert.ok(after.price > before.price, `${family.id} price progression ${index}`);
      assert.ok(after.quality > before.quality, `${family.id} quality progression ${index}`);
      assert.ok(after.unlockLevel > before.unlockLevel, `${family.id} level progression ${index}`);
      assert.ok(after.requiredReputation > before.requiredReputation, `${family.id} reputation progression ${index}`);
    }
  }
});

test('the ClubHouse reference-sheet domains are represented at every quality stage', () => {
  const referenceFamilies = [
    'apparel-rack', 'checkout-counter', 'golf-cart', 'stock-shelving', 'mannequin',
    'lounge-armchair', 'flooring', 'ceiling-flush', 'pendant-light', 'wall-sconce',
    'ceiling-treatment', 'interior-door',
  ];
  for (const familyId of referenceFamilies) {
    const rows = FURNITURE_CATALOG.filter((item) => item.familyId === familyId);
    assert.equal(rows.length, 5, `${familyId} follows the full reference progression`);
    assert.equal(rows[0].progressionTier, 'basic');
    assert.equal(rows.at(-1).progressionTier, 'luxury');
  }
  for (const category of Object.keys(FURNITURE_CATEGORIES)) {
    const rows = furnitureCatalogForCategory(category);
    assert.ok(rows.length >= 5, category);
    assert.deepEqual(new Set(rows.map((row) => row.progressionTier)), new Set(FURNITURE_TIERS.map((tier) => tier.id)));
  }
});

test('unlock gates stage the municipal-to-country-club transformation slowly', () => {
  const byTier = Object.fromEntries(FURNITURE_TIERS.map((tier) => [
    tier.id, FURNITURE_CATALOG.filter((item) => item.progressionTier === tier.id),
  ]));
  assert.ok(byTier.basic.every((item) => item.unlockLevel === 1 && item.requiredReputation === 0));
  assert.ok(byTier.commercial.every((item) => item.unlockLevel >= 5 && item.requiredReputation >= 12));
  assert.ok(byTier.retail.every((item) => item.unlockLevel >= 12 && item.requiredReputation >= 28));
  assert.ok(byTier.boutique.every((item) => item.unlockLevel >= 22 && item.requiredReputation >= 52));
  assert.ok(byTier.luxury.every((item) => item.unlockLevel >= 35 && item.requiredReputation >= 78));
  assert.ok(byTier.luxury.every((item) => item.quality >= 90));
});

