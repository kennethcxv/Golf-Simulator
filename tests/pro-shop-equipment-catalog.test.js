import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKOUT_EQUIPMENT_FAMILIES,
  EQUIPMENT_QUALITY_TIERS,
  PRO_SHOP_EQUIPMENT_CATALOG,
  PRO_SHOP_EQUIPMENT_FAMILIES,
  equipmentQualityTierForPrestige,
  proShopEquipmentById,
  proShopEquipmentTiers,
} from '../src/data/proShopEquipment.js';

const EXPECTED_FAMILIES = [
  'golf_cart', 'push_cart', 'utility_cart', 'maintenance_cart',
  'ball_washer', 'club_cleaner', 'bag_stand', 'range_basket',
  'scorecard_holder', 'practice_basket', 'water_cooler', 'trash_can',
  'bench', 'bag_drop_station', 'golf_club_storage', 'rental_club_storage',
  'display_tv', 'pos_terminal', 'card_reader', 'receipt_printer',
  'cash_drawer', 'computer', 'laptop', 'office_chair',
];

test('the equipment program covers every requested family at five reference-backed levels', () => {
  assert.deepEqual(PRO_SHOP_EQUIPMENT_FAMILIES.map((family) => family.id), EXPECTED_FAMILIES);
  assert.deepEqual(EQUIPMENT_QUALITY_TIERS.map((tier) => tier.referenceLabel), [
    'Basic', 'Standard', 'Premium', 'High-End', 'Luxury',
  ]);
  assert.equal(PRO_SHOP_EQUIPMENT_CATALOG.length, EXPECTED_FAMILIES.length * 5);
  assert.equal(new Set(PRO_SHOP_EQUIPMENT_CATALOG.map((entry) => entry.id)).size, 120);
});

test('every family progresses monotonically in cost, prestige and visible capacity', () => {
  for (const familyId of EXPECTED_FAMILIES) {
    const tiers = proShopEquipmentTiers(familyId);
    assert.equal(tiers.length, 5, `${familyId} tier count`);
    for (let index = 0; index < tiers.length; index += 1) {
      const entry = tiers[index];
      assert.equal(entry.qualityLevel, index + 1, `${entry.id} quality`);
      assert.match(entry.visualProgression, /\S/, `${entry.id} progression description`);
      assert.match(entry.glb, new RegExp(`${entry.id}\\.glb$`));
      assert.match(entry.source, new RegExp(`${familyId}\\.blend#${entry.id}$`));
      for (const axis of ['w', 'd', 'h']) {
        assert.ok(Number.isFinite(entry.dimensionsM[axis]) && entry.dimensionsM[axis] > 0,
          `${entry.id} has a real ${axis} dimension`);
      }
      if (index === 0) continue;
      assert.ok(entry.cost > tiers[index - 1].cost, `${entry.id} costs more than the prior quality`);
      assert.ok(entry.prestigeRequired > tiers[index - 1].prestigeRequired,
        `${entry.id} unlocks after the prior quality`);
      assert.ok(entry.dimensionsM.w >= tiers[index - 1].dimensionsM.w,
        `${entry.id} does not shrink in width`);
      assert.ok(entry.dimensionsM.h >= tiers[index - 1].dimensionsM.h,
        `${entry.id} does not shrink in height`);
    }
    assert.equal(proShopEquipmentById(`${familyId}_country_club`)?.qualityLevel, 5);
  }
});

test('checkout-critical equipment is represented by the same five-level catalog', () => {
  assert.deepEqual(CHECKOUT_EQUIPMENT_FAMILIES, [
    'pos_terminal', 'card_reader', 'receipt_printer', 'cash_drawer',
  ]);
  for (const familyId of CHECKOUT_EQUIPMENT_FAMILIES) {
    assert.equal(proShopEquipmentTiers(familyId).length, 5);
    assert.ok(proShopEquipmentTiers(familyId).every((entry) => entry.placement === 'checkout'));
  }
});

test('saved prestige resolves deterministically to the highest unlocked visual tier', () => {
  assert.equal(equipmentQualityTierForPrestige(-10).id, 'municipal');
  assert.equal(equipmentQualityTierForPrestige(7.99).id, 'municipal');
  assert.equal(equipmentQualityTierForPrestige(8).id, 'public');
  assert.equal(equipmentQualityTierForPrestige(22).id, 'premium');
  assert.equal(equipmentQualityTierForPrestige(42).id, 'high_end');
  assert.equal(equipmentQualityTierForPrestige(68).id, 'country_club');
  assert.equal(equipmentQualityTierForPrestige(100).id, 'country_club');
});
