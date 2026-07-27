import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';

import { CEILING_LIGHT_SKUS } from '../src/data/ceilingLights.js';
import { placeableSpecBySkuId } from '../src/data/placeableItems.js';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  importLegacyStoredPlaceables,
  placedPropertyItems,
  setPlacementLightPower,
  setPlacementSpotlightAim,
} from '../src/sim/propertyInventory.js';
import { placeDecorFree } from '../src/sim/shop.js';
import { snapPlaceablePose, validatePlaceablePlacement } from '../src/sim/propertyPlacement.js';
import { createCeilingLightController } from '../src/render3d/clubhouse/ceilingLightVisuals.js';

test('ceiling-light progression has six purchasable variants, five primary tiers, and all runtime files', () => {
  assert.equal(CEILING_LIGHT_SKUS.length, 6);
  assert.equal(CEILING_LIGHT_SKUS.filter((sku) => sku.progressionPrimary).length, 5);
  assert.deepEqual(
    [...new Set(CEILING_LIGHT_SKUS.map((sku) => sku.furnitureTier))],
    [1, 2, 3, 4, 5],
  );
  for (const sku of CEILING_LIGHT_SKUS) {
    assert.equal(sku.placeableProfile.mount, 'ceiling');
    assert.equal(sku.modelLodPaths.length, 3);
    assert.ok(sku.cost >= 150);
    assert.ok(sku.lightingProfile.powerDrawWatts > 0);
    assert.equal(placeableSpecBySkuId(sku.id).lightingProfile.assetName, sku.lightingProfile.assetName);
    if (sku.id.startsWith('ceiling-light-premium')) {
      assert.ok(sku.dimensionsM[1] <= 0.020, `${sku.id} leaves only a flush optic below the ceiling`);
      assert.ok(sku.recessDepthM >= 0.12, `${sku.id} declares a real above-ceiling rough-in depth`);
      assert.ok(sku.placeableProfile.recessDepth > 0.13, `${sku.id} carries converted recess metadata`);
    }
    for (const path of sku.modelLodPaths) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
  }
  const report = JSON.parse(readFileSync(new URL('../qa/ceiling-lights/blender/validation.json', import.meta.url)));
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.passed, 6);
  let lod0MeshReduction = 0;
  for (const record of report.assets) {
    for (const level of ['LOD0', 'LOD1', 'LOD2']) {
      const optimized = record.exportOptimization[level];
      assert.ok(optimized.exportMeshes <= optimized.sourceMeshes, `${record.asset} ${level} mesh batching`);
      assert.equal(record.reimportValidations[level].meshes, optimized.exportMeshes);
    }
    assert.ok(
      record.exportOptimization.LOD0.exportMeshes < record.exportOptimization.LOD0.sourceMeshes,
      `${record.asset} LOD0 reduces runtime draw submissions`,
    );
    lod0MeshReduction += record.exportOptimization.LOD0.mergedMeshes;
  }
  assert.ok(lod0MeshReduction >= 280, 'the detailed LOD0 set retains source detail while batching runtime meshes');
  const highEnd = report.assets.find((asset) => asset.key === 'high_end');
  assert.equal(highEnd.exportOptimization.LOD0.preservedMovingPivots.length, 6);
  for (const key of ['premium_single', 'premium']) {
    const record = report.assets.find((asset) => asset.key === key);
    const expected = key === 'premium' ? 3 : 1;
    assert.equal(record.sourceValidation.ceilingCutouts.length, expected);
    assert.ok(record.sourceValidation.aboveCeilingComponents.length >= expected);
    assert.ok(record.sourceValidation.renderBoundsM.min[2] >= -0.026);
    assert.ok(record.sourceValidation.renderBoundsM.max[2] >= 0.115);
    for (const validation of Object.values(record.reimportValidations)) {
      assert.equal(validation.ceilingCutouts.length, expected);
      assert.ok(validation.aboveCeilingComponents.length >= expected);
    }
  }
});

test('light power and articulated spotlight aim are safe, persistent placement state', () => {
  const state = newGame('relaxed', 2701);
  const skuId = 'ceiling-light-high-end';
  state.shop.inventory[skuId].back = 1;
  importLegacyStoredPlaceables(state, skuId, 1);
  const pose = snapPlaceablePose(skuId, { x: -8, z: -5 }, 0.25);
  assert.equal(validatePlaceablePlacement(state, skuId, pose).ok, true);
  const placed = placeDecorFree(state, skuId, pose);
  assert.equal(placed.ok, true);
  assert.equal(placed.placement.lightState.isOn, true);
  assert.equal(placed.placement.lightState.spotlights.length, 3);

  assert.equal(setPlacementLightPower(state, placed.placement.id, false).ok, true);
  assert.equal(setPlacementSpotlightAim(state, placed.placement.id, 1, 0.62, -0.34).ok, true);
  assert.equal(setPlacementSpotlightAim(state, placed.placement.id, 9, 0, 0).ok, false);
  assert.equal(setPlacementSpotlightAim(state, placed.placement.id, 0, Infinity, 0).ok, false);

  const loaded = deserialize(serialize(state));
  const restored = placedPropertyItems(loaded)[0];
  assert.equal(restored.lightState.isOn, false);
  assert.deepEqual(restored.lightState.spotlights[1], { yaw: 0.62, tilt: -0.34 });
});

test('the low Luxury chandelier requires a protected furniture footprint', () => {
  const state = newGame('relaxed', 2702);
  state.shop.progression.tier = 'premium';
  state.shop.unlockedTier = 3;
  const exposed = snapPlaceablePose('ceiling-light-luxury', { x: 0, z: 0 }, 0);
  assert.match(validatePlaceablePlacement(state, 'ceiling-light-luxury', exposed).reasons.join(' '), /walking clearance/i);

  const overTable = snapPlaceablePose('ceiling-light-luxury', { x: -5.9, z: 0.6 }, 0);
  assert.equal(validatePlaceablePlacement(state, 'ceiling-light-luxury', overTable).ok, true);
});

function syntheticLodRoot(prefix = '') {
  const root = new THREE.Group();
  const control = new THREE.Object3D();
  control.name = prefix ? `${prefix}LIGHT_CONTROL_INTERACTION` : 'LIGHT_CONTROL_INTERACTION';
  root.add(control);
  const yaw = new THREE.Group();
  yaw.name = `${prefix}Spotlight_01_YawPivot`;
  const tilt = new THREE.Group();
  tilt.name = `${prefix}Spotlight_01_TiltPivot`;
  const interaction = new THREE.Object3D();
  interaction.name = `${prefix}INTERACT_Spotlight_01`;
  const light = new THREE.SpotLight(0xffd8a0, 1);
  light.name = `${prefix}LIGHT_SPOT_01`;
  light.userData.runtime_intensity = 9.8;
  light.userData.runtime_range_yards = 8.4;
  light.userData.runtime_angle_radians = 0.75;
  light.userData.runtime_penumbra = 0.46;
  const material = new THREE.MeshStandardMaterial({
    name: `${prefix}Emitter_Track`,
    emissive: 0xffb060,
    emissiveIntensity: 2.5,
  });
  const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.1), material);
  emitter.name = `${prefix}Spotlight_01_Emitter`;
  tilt.add(interaction, light, emitter);
  yaw.add(tilt);
  root.add(yaw);
  return { root, yaw, tilt, light, material };
}

test('runtime controller keeps all LOD lights, emitters, circuit state, and aim in sync', () => {
  const levels = [syntheticLodRoot(), syntheticLodRoot('LOD1_'), syntheticLodRoot('LOD2_')];
  let circuit = true;
  let savedPower = null;
  let savedAim = null;
  const controller = createCeilingLightController(
    levels.map((level) => level.root),
    {
      lightingProfile: {
        defaultOn: true,
        emissiveScale: 0.5,
        runtimeLights: 1,
        adjustableHeads: 1,
        defaultAim: [{ yaw: 0, tilt: 0 }],
        aimPresets: [
          { label: 'straight', yaw: 0, tilt: 0 },
          { label: 'left display', yaw: -0.62, tilt: 0.34 },
        ],
      },
    },
    {
      lightState: { isOn: true, spotlights: [{ yaw: 0, tilt: 0 }] },
      circuitPowered: () => circuit,
      onPowerStateChange: (on) => { savedPower = on; },
      onAimStateChange: (aim) => { savedAim = aim; },
    },
  );

  assert.equal(controller.runtimeLights.length, 3);
  assert.ok(levels.every((level) => level.light.intensity === 9.8 && level.light.visible));
  assert.ok(levels.every((level) => level.material.emissiveIntensity === 1.25));
  assert.equal(controller.maxPhysicalLights(), 1);
  assert.equal(controller.setPhysicalLightBudget(0), true);
  assert.ok(levels.every((level) => level.light.intensity === 0 && !level.light.visible));
  assert.ok(levels.every((level) => level.material.emissiveIntensity === 1.25));
  assert.equal(controller.setPhysicalLightBudget(1), true);
  controller.setOn(false);
  assert.equal(savedPower, false);
  assert.ok(levels.every((level) => level.light.intensity === 0 && !level.light.visible));
  controller.setOn(true);
  circuit = false;
  assert.equal(controller.update(), true);
  assert.equal(controller.isEffectivelyOn(), false);
  circuit = true;
  controller.update();
  assert.equal(controller.isEffectivelyOn(), true);

  controller.headControllers[0].cycle();
  assert.equal(savedAim.presetLabel, 'left display');
  assert.ok(levels.every((level) => Math.abs(level.yaw.rotation.y) < 1e-6));
  controller.update(1);
  assert.ok(levels.every((level) => Math.abs(level.yaw.rotation.y + 0.62) < 1e-5));
  assert.ok(levels.every((level) => Math.abs(level.tilt.rotation.x - 0.34) < 1e-5));
});
