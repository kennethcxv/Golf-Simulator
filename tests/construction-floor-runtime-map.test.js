import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHEET06_CONSTRUCTION_CEILING_VARIANTS,
  SHEET06_CONSTRUCTION_DOOR_VARIANTS,
  SHEET06_CONSTRUCTION_FLOOR_VARIANTS,
  SHEET06_CONSTRUCTION_GARAGE_VARIANTS,
  SHEET06_CONSTRUCTION_LIGHTING_VARIANTS,
  SHEET06_CONSTRUCTION_WALL_VARIANTS,
  SHEET06_CONSTRUCTION_WINDOW_VARIANTS,
  sheet06ConstructionCeilingVariantId,
  sheet06ConstructionDoorVariantId,
  sheet06ConstructionFloorDamageVariant,
  sheet06ConstructionFloorVariantId,
  sheet06ConstructionGarageVariantId,
  sheet06ConstructionLightingVariantId,
  sheet06ConstructionWallVariantId,
  sheet06ConstructionWindowVariantId,
} from '../src/render3d/assets51to100/sheet06ProductionAssembly.js';

test('all five authored construction garage-door variants have deterministic runtime ids', () => {
  assert.equal(SHEET06_CONSTRUCTION_GARAGE_VARIANTS.length, 5);
  assert.equal(new Set(SHEET06_CONSTRUCTION_GARAGE_VARIANTS).size, 5);
  assert.equal(sheet06ConstructionGarageVariantId('garage-door', 'municipal'), 'construction_garage_door_municipal');
  assert.equal(sheet06ConstructionGarageVariantId('garage-door', 'high-end'), 'construction_garage_door_high_end');
  assert.equal(sheet06ConstructionGarageVariantId('garage-door', 'luxury'), 'construction_garage_door_luxury');
  assert.equal(sheet06ConstructionGarageVariantId('unknown', 'luxury'), null);
});

test('all thirty authored construction lighting variants have deterministic runtime ids', () => {
  assert.equal(SHEET06_CONSTRUCTION_LIGHTING_VARIANTS.length, 30);
  assert.equal(new Set(SHEET06_CONSTRUCTION_LIGHTING_VARIANTS).size, 30);
  assert.equal(sheet06ConstructionLightingVariantId('led-panels', 'municipal'), 'construction_led_panels_municipal');
  assert.equal(sheet06ConstructionLightingVariantId('wall-sconces', 'high-end'), 'construction_wall_sconces_high_end');
  assert.equal(sheet06ConstructionLightingVariantId('landscape-lighting', 'luxury'), 'construction_landscape_lighting_luxury');
  assert.equal(sheet06ConstructionLightingVariantId('unknown', 'luxury'), null);
});

test('all twenty-five authored construction ceiling variants have deterministic runtime ids', () => {
  assert.equal(SHEET06_CONSTRUCTION_CEILING_VARIANTS.length, 25);
  assert.equal(new Set(SHEET06_CONSTRUCTION_CEILING_VARIANTS).size, 25);
  assert.equal(sheet06ConstructionCeilingVariantId('drop-ceiling', 'municipal'), 'construction_drop_ceiling_municipal');
  assert.equal(sheet06ConstructionCeilingVariantId('luxury-coffered', 'luxury'), 'construction_luxury_coffered_luxury');
  assert.equal(sheet06ConstructionCeilingVariantId('unknown', 'luxury'), null);
});

test('all twenty-five authored construction door variants have deterministic runtime ids', () => {
  assert.equal(SHEET06_CONSTRUCTION_DOOR_VARIANTS.length, 25);
  assert.equal(new Set(SHEET06_CONSTRUCTION_DOOR_VARIANTS).size, 25);
  assert.equal(sheet06ConstructionDoorVariantId('hollow-core', 'municipal'), 'construction_hollow_core_municipal');
  assert.equal(sheet06ConstructionDoorVariantId('luxury-wood', 'high-end'), 'construction_luxury_wood_high_end');
  assert.equal(sheet06ConstructionDoorVariantId('double-entry', 'luxury'), 'construction_double_entry_luxury');
  assert.equal(sheet06ConstructionDoorVariantId('unknown', 'luxury'), null);
});

test('all forty authored construction floor variants have deterministic runtime ids', () => {
  assert.equal(SHEET06_CONSTRUCTION_FLOOR_VARIANTS.length, 40);
  assert.equal(new Set(SHEET06_CONSTRUCTION_FLOOR_VARIANTS).size, 40);
  assert.equal(sheet06ConstructionFloorVariantId('luxury-hardwood', 'high-end'), 'construction_luxury_hardwood_high_end');
  assert.equal(sheet06ConstructionFloorVariantId('marble', 'luxury'), 'construction_marble_luxury');
  assert.equal(sheet06ConstructionFloorVariantId('unknown', 'luxury'), null);
});

test('all thirty authored construction wall variants have deterministic runtime ids', () => {
  assert.equal(SHEET06_CONSTRUCTION_WALL_VARIANTS.length, 30);
  assert.equal(new Set(SHEET06_CONSTRUCTION_WALL_VARIANTS).size, 30);
  assert.equal(sheet06ConstructionWallVariantId('drywall', 'municipal'), 'construction_drywall_municipal');
  assert.equal(sheet06ConstructionWallVariantId('wood-panels', 'high-end'), 'construction_wood_panels_high_end');
  assert.equal(sheet06ConstructionWallVariantId('luxury-moulding', 'luxury'), 'construction_luxury_moulding_luxury');
  assert.equal(sheet06ConstructionWallVariantId('unknown', 'luxury'), null);
});

test('all twenty authored construction window variants have deterministic runtime ids', () => {
  assert.equal(SHEET06_CONSTRUCTION_WINDOW_VARIANTS.length, 20);
  assert.equal(new Set(SHEET06_CONSTRUCTION_WINDOW_VARIANTS).size, 20);
  assert.equal(sheet06ConstructionWindowVariantId('cheap-aluminum', 'municipal'), 'construction_cheap_aluminum_municipal');
  assert.equal(sheet06ConstructionWindowVariantId('premium-black', 'premium'), 'construction_premium_black_premium');
  assert.equal(sheet06ConstructionWindowVariantId('luxury-country-club', 'luxury'), 'construction_luxury_country_club_luxury');
  assert.equal(sheet06ConstructionWindowVariantId('unknown', 'luxury'), null);
});

test('construction floor families select a believable additive damage family', () => {
  assert.equal(sheet06ConstructionFloorDamageVariant('concrete'), 'damaged_tile');
  assert.equal(sheet06ConstructionFloorDamageVariant('marble'), 'damaged_tile');
  assert.equal(sheet06ConstructionFloorDamageVariant('vinyl'), 'damaged_carpet');
  assert.equal(sheet06ConstructionFloorDamageVariant('hardwood'), 'damaged_wood');
  assert.equal(sheet06ConstructionFloorDamageVariant('herringbone'), 'damaged_wood');
  assert.equal(sheet06ConstructionFloorDamageVariant('unknown'), null);
});
