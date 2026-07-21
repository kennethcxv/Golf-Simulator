import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { newGame } from '../src/sim/state.js';
import { ensureCampaignFacilities } from '../src/sim/campaign.js';
import { COUNTER, OFFICE } from '../src/data/shopLayout.js';
import {
  buildProps, PLACED_ASSET_NUMBERS,
} from '../src/render3d/assets51to100/propPlacement.js';
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

test('Sheet 7 campaign runtime lands the authored counter and desk sockets on established layout datums', async () => {
  const state = newGame('relaxed', 9101, { campaign: true });
  const interior = new THREE.Group();
  const counterFallback = new THREE.Group();
  const deskFallback = new THREE.Group();
  interior.add(counterFallback, deskFallback);
  const runtime = createSheet07CampaignRuntime({
    interior,
    loader: immediateLoader(),
    state,
    fallbacks: { 61: counterFallback, 66: deskFallback },
  });
  await runtime.ready;

  assert.deepEqual(runtime.diagnostics().assetNumbers, [61, 66]);
  assert.equal(runtime.getRoot(61).visible, false, 'closed campaign does not show an uninstalled counter');
  assert.equal(runtime.getRoot(66).visible, false, 'closed campaign does not show an uninstalled desk');
  assert.equal(counterFallback.visible, false);
  assert.equal(deskFallback.visible, false);

  const facilities = ensureCampaignFacilities(state);
  facilities.frontCounter = true;
  facilities.officeDesk = true;
  runtime.refresh();
  assert.equal(runtime.getRoot(61).visible, true);
  assert.equal(runtime.getRoot(66).visible, true);

  const targets = new Map([
    [61, new THREE.Vector3(COUNTER.x, 0, COUNTER.z)],
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

test('Assets 61-100 can refresh campaign visibility without reloading or duplicating roots', async () => {
  const interior = new THREE.Group();
  const visible = new Set([71, 100]);
  const props = buildProps({
    interior,
    loader: immediateLoader(),
    visibilityForAsset: (number) => visible.has(number),
  });
  await props.ready;
  assert.equal(props.diagnostics().placed, PLACED_ASSET_NUMBERS.length);
  assert.equal(props.getRoot(71).visible, true);
  assert.equal(props.getRoot(81).visible, false);
  assert.equal(props.getRoot(100).visible, true);

  visible.add(81);
  props.refreshVisibility();
  assert.equal(props.getRoot(81).visible, true);
  assert.equal(props.diagnostics().placed, PLACED_ASSET_NUMBERS.length,
    'refreshing does not instantiate a second prop set');
});
