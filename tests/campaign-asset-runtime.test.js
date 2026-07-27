import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { newGame } from '../src/sim/state.js';
import { ensureCampaignFacilities } from '../src/sim/campaign.js';
import { FRONT_DESK_ASSETS, OFFICE } from '../src/data/shopLayout.js';
import {
  FACILITY_GATED_PROP_ASSETS,
  FIXTURE_GATED_PROP_ASSETS,
  buildProps,
  runtimeAssetNeedsLiveVisualHierarchy,
} from '../src/render3d/assets51to100/propPlacement.js';
import { PROP_PLACEMENT_BY_NUMBER } from '../src/render3d/assets51to100/runtimeManifest.js';
import {
  SHEET07_CAMPAIGN_PLACEMENTS,
  createSheet07CampaignRuntime,
} from '../src/render3d/assets51to100/sheet07CampaignRuntime.js';

function socketScene(name = 'Fixture') {
  const root = new THREE.Group();
  root.name = name;
  const socket = new THREE.Object3D();
  socket.name = 'SOCKET_PLACEMENT';
  socket.position.set(0.17, 0.08, -0.11);
  root.add(socket);
  return root;
}

function immediateLoader() {
  return {
    load(_url, onLoad) {
      onLoad({ scene: socketScene() });
    },
  };
}

function oneDrawMerchBake() {
  const material = new THREE.MeshStandardMaterial({ color: 0x6f6658, roughness: 0.8 });
  return {
    bake() {
      const visual = new THREE.Group();
      visual.userData.merchBaked = true;
      visual.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material));
      return visual;
    },
    disposeBaked() {},
  };
}

test('Sheet 7 campaign runtime leaves Asset 61 unified and lands the authored office desk datum', async () => {
  const state = newGame('relaxed', 9101, { campaign: true });
  ensureCampaignFacilities(state).officeDesk = false;
  const interior = new THREE.Group();
  const deskFallback = new THREE.Group();
  interior.add(deskFallback);
  const runtime = createSheet07CampaignRuntime({
    interior,
    loader: immediateLoader(),
    state,
    fallbacks: { 66: deskFallback },
  });
  await runtime.ready;

  assert.deepEqual(runtime.diagnostics().assetNumbers, [66]);
  assert.equal(runtime.getRoot(61), null, 'the unified 61-100 runtime is the sole Asset 61 owner');
  assert.equal(runtime.getRoot(66).visible, false, 'closed campaign does not show an uninstalled desk');
  assert.equal(deskFallback.visible, false);

  const facilities = ensureCampaignFacilities(state);
  facilities.officeDesk = true;
  runtime.refresh();
  assert.equal(runtime.getRoot(66).visible, true);

  const targets = new Map([
    [66, new THREE.Vector3(OFFICE.desk.x, 0, OFFICE.desk.z)],
  ]);
  for (const placement of SHEET07_CAMPAIGN_PLACEMENTS) {
    const root = runtime.getRoot(placement.binding.assetNumber);
    root.updateMatrixWorld(true);
    const actual = root.getObjectByName('SOCKET_PLACEMENT').getWorldPosition(new THREE.Vector3());
    assert.ok(actual.distanceTo(targets.get(placement.binding.assetNumber)) < 1e-6,
      `asset ${placement.binding.assetNumber} placement socket missed its layout datum`);
    assert.equal(root.scale.x, placement.binding.runtimeScale, 'metres-to-yards scale is applied exactly once');
  }
});

test('Assets 71-100 can refresh campaign visibility without reloading or duplicating roots', async () => {
  const interior = new THREE.Group();
  const visible = new Set([71, 100]);
  const props = buildProps({
    interior,
    loader: immediateLoader(),
    visibilityForAsset: (number) => visible.has(number),
  });
  await props.ready;
  assert.equal(props.diagnostics().placed, 40);
  assert.equal(props.getRoot(71).visible, true);
  assert.equal(props.getRoot(81).visible, false);
  assert.equal(props.getRoot(100).visible, true);

  visible.add(81);
  props.refreshVisibility();
  assert.equal(props.getRoot(81).visible, true);
  assert.equal(props.diagnostics().placed, 40, 'refreshing does not instantiate a second prop set');
});

test('the premium fitting booth stays out of the basic Pine Hills cooler sightline', async () => {
  const state = newGame('relaxed', 9103, { campaign: true });
  const interior = new THREE.Group();
  assert.deepEqual(FIXTURE_GATED_PROP_ASSETS, { 63: 'fittingroom' });
  const props = buildProps({ interior, loader: immediateLoader(), state });
  await props.ready;

  assert.equal(props.getRoot(63).visible, false,
    'a basic furnished start does not render its locked premium booth');
  assert.equal(props.diagnostics().placedStaticBatchAssetNumbers.includes(63), false,
    'the independently gated booth never leaks into the always-visible static batch');

  state.shop.progression.tier = 'premium';
  props.refreshVisibility();
  assert.equal(props.getRoot(63).visible, true,
    'the authored booth appears when the fitting-room fixture is actually installed');
});

test('the unified front-counter, office-desk, and reception-chair roots obey immediate facility gates', async () => {
  const state = newGame('relaxed', 9102, { campaign: true });
  const facilities = ensureCampaignFacilities(state);
  facilities.frontCounter = false;
  facilities.officeDesk = false;
  facilities.officeChair = false;
  assert.deepEqual(FACILITY_GATED_PROP_ASSETS, {
    61: 'frontCounter', 66: 'officeDesk', 81: 'officeChair',
  });
  const interior = new THREE.Group();
  for (const name of ['LegacyCheckoutCounter', 'LegacyCheckoutProductionCounter']) {
    const fallback = new THREE.Group();
    fallback.name = name;
    interior.add(fallback);
  }
  const material = new THREE.MeshStandardMaterial({ color: 0x315b43 });
  const loader = {
    load(_url, onLoad) {
      const scene = socketScene();
      scene.add(
        new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material),
        new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), material),
      );
      onLoad({ scene, animations: [] });
    },
  };
  const merch = {
    bake() {
      const visual = new THREE.Group();
      visual.userData.merchBaked = true;
      visual.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), material));
      return visual;
    },
    disposeBaked() {},
  };
  const registeredProps = [];
  const props = buildProps({
    interior,
    loader,
    state,
    merch,
    addProp: (prop) => registeredProps.push(prop),
  });
  assert.equal(interior.getObjectByName('LegacyCheckoutCounter'), undefined,
    'the first loaded Asset 61 retires its fallback without waiting for all forty GLBs');
  assert.equal(interior.getObjectByName('LegacyCheckoutProductionCounter'), undefined);
  await props.ready;

  const root = props.getRoot(61);
  assert.equal(root.visible, false, 'an uninstalled front counter is hidden on its first mounted frame');
  for (const number of [61, 66, 81]) {
    assert.equal(props.getRoot(number).visible, false, `uninstalled facility asset ${number} starts hidden`);
    assert.equal(props.diagnostics().placedStaticBatchAssetNumbers.includes(number), false,
      `facility-gated asset ${number} remains outside the always-visible global batch`);
  }
  let renderable = 0;
  root.traverseVisible((object) => { if (object.isMesh && object.layers.mask !== 0) renderable += 1; });
  assert.equal(renderable, 0, 'no Asset 61 layer is camera-renderable while its root is gated');

  facilities.frontCounter = true;
  facilities.officeDesk = true;
  facilities.officeChair = true;
  props.refreshVisibility();
  for (const number of [61, 66, 81]) {
    assert.equal(props.getRoot(number).visible, true, `installed facility asset ${number} becomes visible`);
  }
  const receptionChairProp = registeredProps.find((prop) => prop.userData?.assetNumber === 81);
  assert.ok(receptionChairProp, 'the authored reception-chair swivel remains interactable');
  assert.equal(receptionChairProp.r, 0.75, 'the chair uses its close-range authored focus radius');
  assert.equal(receptionChairProp.focusBias, -0.45,
    'the chair yields deliberate tee-board aim while remaining usable up close');
  root.updateMatrixWorld(true);
  const socket = root.getObjectByName('SOCKET_PLACEMENT').getWorldPosition(new THREE.Vector3());
  assert.ok(socket.distanceTo(new THREE.Vector3(
    FRONT_DESK_ASSETS.asset61.x,
    0,
    FRONT_DESK_ASSETS.asset61.z,
  )) < 1e-6, 'the unified counter lands on the canonical Asset 61 join pose');
});

test('desk and safety practicals keep emissive feedback without adding physical scene lights', async () => {
  const state = newGame('relaxed', 9104, { campaign: true });
  const interior = new THREE.Group();
  const registeredProps = [];
  const loader = {
    load(url, onLoad) {
      const scene = socketScene();
      if (/asset_083_/i.test(url)) {
        const socket = new THREE.Object3D();
        socket.name = 'SOCKET_Bulb';
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 6, 4),
          new THREE.MeshStandardMaterial({
            color: 0xffe9bd,
            emissive: 0xffdf9d,
            emissiveIntensity: 2.2,
          }),
        );
        bulb.name = 'MESH_LampBulb';
        scene.add(socket, bulb);
      }
      onLoad({ scene, animations: [] });
    },
  };
  const props = buildProps({
    interior,
    loader,
    state,
    addProp: (prop) => registeredProps.push(prop),
  });
  await props.ready;

  const lights = [];
  interior.traverse((object) => {
    if (/^AssetRuntimeLight_/.test(object.name || '')) lights.push(object);
  });
  assert.equal(lights.length, 3);
  assert.equal(lights.every((light) => light.isPointLight), true,
    'compatibility handles retain their established object type');
  assert.equal(lights.every((light) => light.layers.mask === 0), true,
    'authored emissive meshes, not fragment PointLights, render these practicals');
  assert.equal(props.diagnostics().physicalRuntimeLights, 0);
  assert.equal(props.diagnostics().emissiveOnlyRuntimeLights, 3);

  const deskLight = lights.find((light) => light.name === 'AssetRuntimeLight_83');
  const bulb = props.getRoot(83).getObjectByName('MESH_LampBulb');
  const deskProp = registeredProps.find((prop) => prop.userData?.assetNumber === 83);
  assert.ok(deskLight?.visible);
  assert.match(deskProp.label(), /switch off/i, 'an undefined legacy state defaults to the lit pose');
  assert.equal(bulb.material.emissiveIntensity, 2.2);
  deskProp.action();
  assert.equal(deskLight.visible, false);
  assert.equal(bulb.material.emissiveIntensity, 0.025);
  deskProp.action();
  assert.equal(deskLight.visible, true);
  assert.equal(bulb.material.emissiveIntensity, 2.2);
});

test('stateful asset metadata keeps bucket water and the desk lamp on their live hierarchies', async () => {
  assert.equal(runtimeAssetNeedsLiveVisualHierarchy(PROP_PLACEMENT_BY_NUMBER[73]), true);
  assert.equal(runtimeAssetNeedsLiveVisualHierarchy(PROP_PLACEMENT_BY_NUMBER[83]), true);
  assert.equal(runtimeAssetNeedsLiveVisualHierarchy(PROP_PLACEMENT_BY_NUMBER[71]), true,
    'single-tool pickup metadata also fails safe');
  assert.equal(runtimeAssetNeedsLiveVisualHierarchy(PROP_PLACEMENT_BY_NUMBER[77]), true,
    'multi-tool pickup metadata also fails safe');
  assert.equal(runtimeAssetNeedsLiveVisualHierarchy(PROP_PLACEMENT_BY_NUMBER[94]), true,
    'runtime practical-light metadata also fails safe');
  assert.equal(runtimeAssetNeedsLiveVisualHierarchy(PROP_PLACEMENT_BY_NUMBER[86]), false,
    'inert authored dressing remains batchable');

  const state = newGame('relaxed', 9105, { campaign: true });
  const interior = new THREE.Group();
  const registeredProps = [];
  const loader = {
    load(url, onLoad) {
      const scene = socketScene();
      const material = new THREE.MeshStandardMaterial({ color: 0x665b4c, roughness: 0.78 });
      scene.add(
        new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material),
        new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), material),
      );
      if (/asset_073_/i.test(url)) {
        const water = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.03, 0.12),
          new THREE.MeshStandardMaterial({ color: 0x76aeb1, roughness: 0.4 }),
        );
        water.name = 'MESH_BucketWater';
        scene.add(water);
      }
      if (/asset_083_/i.test(url)) {
        const socket = new THREE.Object3D();
        socket.name = 'SOCKET_Bulb';
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 6, 4),
          new THREE.MeshStandardMaterial({
            color: 0xffe9bd,
            emissive: 0xffdf9d,
            emissiveIntensity: 2.2,
          }),
        );
        bulb.name = 'MESH_LampBulb';
        scene.add(socket, bulb);
      }
      onLoad({ scene, animations: [] });
    },
  };
  const props = buildProps({
    interior,
    loader,
    state,
    merch: oneDrawMerchBake(),
    addProp: (prop) => registeredProps.push(prop),
  });
  await props.ready;

  const water = props.getRoot(73).getObjectByName('MESH_BucketWater');
  const bulb = props.getRoot(83).getObjectByName('MESH_LampBulb');
  const diagnostics = props.diagnostics();
  for (const [number, mesh] of [[73, water], [83, bulb]]) {
    assert.notEqual(mesh.layers.mask, 0, `Asset ${number} live mesh remains camera-visible`);
    assert.notEqual(mesh.userData.assetRuntimeStaticRenderSuppressed, true,
      `Asset ${number} is not replaced by a stale per-root snapshot`);
    assert.equal(diagnostics.placedStaticBatchAssetNumbers.includes(number), false,
      `Asset ${number} is not admitted to the cross-asset snapshot`);
  }
  assert.equal(diagnostics.placedStaticBatchAssetNumbers.includes(86), true,
    'the inert office-wall dressing still benefits from cross-asset batching');

  props.setBucketWater({ water: 'empty', level: 0 });
  assert.equal(water.visible, false, 'emptying the bucket hides the live water surface');
  props.setBucketWater({ water: 'dirty', level: 1 });
  assert.equal(water.visible, true, 'refilling the bucket restores the live water surface');

  const deskProp = registeredProps.find((prop) => prop.userData?.assetNumber === 83);
  assert.equal(bulb.material.emissiveIntensity, 2.2);
  deskProp.action();
  assert.equal(bulb.material.emissiveIntensity, 0.025,
    'switching off mutates the same lamp material the camera renders');
  deskProp.action();
  assert.equal(bulb.material.emissiveIntensity, 2.2);
  props.dispose();
});
