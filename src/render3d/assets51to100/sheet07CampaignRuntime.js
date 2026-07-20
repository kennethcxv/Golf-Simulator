// SHEET 7 CAMPAIGN RUNTIME
//
// Assets 61 and 66 are the authored production objects the reopening campaign
// physically installs. Their GLBs already ship with the game; this adapter only
// lands each SOCKET_PLACEMENT on the established layout datum and leases the
// older visual as a zero-network fallback while the GLB loads.

import * as THREE from 'three';
import { COUNTER, OFFICE } from '../../data/shopLayout.js';
import { facilityInstalled } from '../../sim/campaign.js';
import { ASSET_061, ASSET_066 } from './sheet07Manifest.js';

export const SHEET07_CAMPAIGN_PLACEMENTS = Object.freeze([
  Object.freeze({ binding: ASSET_061, facility: 'frontCounter', x: COUNTER.x, y: 0, z: COUNTER.z, ry: 0 }),
  Object.freeze({ binding: ASSET_066, facility: 'officeDesk', x: OFFICE.desk.x, y: 0, z: OFFICE.desk.z, ry: OFFICE.desk.ry }),
]);

function landPlacementSocket(root, placement) {
  root.scale.setScalar(placement.binding.runtimeScale);
  root.rotation.y = placement.ry || 0;
  root.updateMatrixWorld(true);
  const target = new THREE.Vector3(placement.x, placement.y || 0, placement.z);
  const socket = root.getObjectByName('SOCKET_PLACEMENT');
  if (!socket) {
    root.position.copy(target);
    return false;
  }
  socket.updateWorldMatrix(true, false);
  const at = new THREE.Vector3().setFromMatrixPosition(socket.matrixWorld);
  root.position.set(target.x - at.x, target.y - at.y, target.z - at.z);
  return true;
}

export function createSheet07CampaignRuntime({ interior, loader, state, fallbacks = {} }) {
  const group = new THREE.Group();
  group.name = 'Sheet07CampaignProduction';
  interior.add(group);
  const roots = new Map();
  const failures = [];

  const refresh = () => {
    for (const placement of SHEET07_CAMPAIGN_PLACEMENTS) {
      const number = placement.binding.assetNumber;
      const root = roots.get(number);
      const installed = facilityInstalled(state, placement.facility);
      if (root) root.visible = installed;
      const fallback = fallbacks[number];
      if (fallback) fallback.visible = installed && !root;
    }
  };

  const jobs = SHEET07_CAMPAIGN_PLACEMENTS.map((placement) => new Promise((resolve) => {
    const binding = placement.binding;
    loader.load(binding.paths.runtimeGlb, (gltf) => {
      try {
        const root = gltf.scene;
        root.name = `CampaignAsset_${binding.assetNumber}_${binding.stem}`;
        const alignedBySocket = landPlacementSocket(root, placement);
        root.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = false;
          object.receiveShadow = false;
        });
        group.add(root);
        roots.set(binding.assetNumber, root);
        const fallback = fallbacks[binding.assetNumber];
        if (fallback) fallback.visible = false;
        refresh();
        if (!alignedBySocket) failures.push({ number: binding.assetNumber, reason: 'missing SOCKET_PLACEMENT' });
        resolve(true);
      } catch (error) {
        failures.push({ number: binding.assetNumber, reason: error?.message || 'placement failed' });
        refresh();
        resolve(false);
      }
    }, undefined, (error) => {
      failures.push({ number: binding.assetNumber, reason: error?.message || 'load failed' });
      refresh();
      resolve(false);
    });
  }));

  const ready = Promise.all(jobs).then(() => {
    refresh();
    return { loaded: roots.size, failed: failures.length };
  });

  // Hide unavailable fallbacks immediately; do not expose a fully furnished
  // counter or office for a frame while the GLBs are still in flight.
  refresh();

  return {
    group,
    ready,
    refresh,
    getRoot: (number) => roots.get(number) || null,
    diagnostics: () => ({
      expected: SHEET07_CAMPAIGN_PLACEMENTS.length,
      loaded: roots.size,
      failed: failures.length,
      failures: [...failures],
      assetNumbers: [...roots.keys()].sort((a, b) => a - b),
    }),
    dispose() {
      group.removeFromParent();
      roots.clear();
    },
  };
}
