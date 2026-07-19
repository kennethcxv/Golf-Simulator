// RUNTIME PLACEMENT + INTERACTION ADAPTER — Assets 61 through 100.
//
// Sheet 6 owns the structural runtime. This module consumes the complete runtime manifest for the
// remaining forty assets, aligns every SOCKET_PLACEMENT, follows persisted fixture anchors, adapts
// authored clips to ordinary walk interactions, and exposes cleaning-tool pickups without changing
// the cleaning simulation itself.

import * as THREE from 'three';
import { CLEANING_TOOLS } from '../../data/cleaningTools.js';
import {
  PLACED_ASSET_NUMBERS, PROP_PLACEMENTS, RUNTIME_ASSET_MANIFEST_BY_NUMBER,
} from './runtimeManifest.js';

export { PLACED_ASSET_NUMBERS, PROP_PLACEMENTS };

/** Authored replacements for temporary or older clubhouse visuals. */
export const SUPERSEDES = Object.freeze([
  { legacy: 'LegacyCheckoutCounter', replacedBy: [61] },
  { legacy: 'LegacyCheckoutProductionCounter', replacedBy: [61] },
  { legacy: 'LegacyPackingBench', replacedBy: [65] },
  { legacy: 'LegacyOfficeDesk', replacedBy: [66] },
  { legacy: 'LegacyOfficeDeskAuthored', replacedBy: [66] },
  { legacy: 'LegacyLoungeChairA', replacedBy: [67] },
  { legacy: 'LegacyLoungeChairB', replacedBy: [68] },
  { legacy: 'LegacyLoungeCoffeeTable', replacedBy: [69] },
  { legacy: 'LegacyLoungeTrophyDisplay', replacedBy: [70] },
  { legacy: 'LegacyCleaningCornerScenery', replacedBy: [71, 72, 73, 74, 75] },
  { legacy: 'LegacyOfficeChair', replacedBy: [81] },
  { legacy: 'LegacyOfficeFilingCabinet', replacedBy: [82] },
  { legacy: 'LegacyWelcomeMat', replacedBy: [100] },
]);

const vectorFromTransform = (record) => new THREE.Vector3(...record.defaultTransform.position);

const COLLISION_PROXY_NAME = /^(?:COL_|COLLISION_|VOLUME_)/i;

function isAuthoredCollisionProxy(object, root) {
  let current = object;
  while (current) {
    if (COLLISION_PROXY_NAME.test(current.name || '')
      || current.userData?.collision_proxy === true) return true;
    if (current === root) break;
    current = current.parent;
  }
  return false;
}

function ensureAssetState(state, assetNumber) {
  if (!state || typeof state !== 'object') return {};
  if (!state.shop || typeof state.shop !== 'object') state.shop = {};
  if (!state.shop.assetRuntime || typeof state.shop.assetRuntime !== 'object') {
    state.shop.assetRuntime = {};
  }
  const key = `asset_${String(assetNumber).padStart(3, '0')}`;
  if (!state.shop.assetRuntime[key] || typeof state.shop.assetRuntime[key] !== 'object') {
    state.shop.assetRuntime[key] = {};
  }
  return state.shop.assetRuntime[key];
}

function placeSocketAt(root, target, socketName = 'SOCKET_PLACEMENT') {
  const socket = root.getObjectByName(socketName);
  if (!socket) {
    root.position.copy(target);
    return false;
  }
  root.updateMatrixWorld(true);
  socket.updateWorldMatrix(true, false);
  const at = new THREE.Vector3().setFromMatrixPosition(socket.matrixWorld);
  // Targets are expressed in the mount parent's coordinate system (interior-local yards or a
  // fixture anchor). Convert the socket out of world space before calculating the correction.
  root.parent?.worldToLocal(at);
  root.position.add(target.clone().sub(at));
  root.updateMatrixWorld(true);
  return true;
}

function animationController(root, clips) {
  if (!clips?.length) return null;
  const mixer = new THREE.AnimationMixer(root);
  const byName = new Map(clips.map((clip) => [clip.name, clip]));
  const active = new Set();

  function play(names, { settle = false, loop = false } = {}) {
    let played = 0;
    for (const name of names || []) {
      const clip = byName.get(name);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.stop();
      action.reset();
      action.enabled = true;
      action.clampWhenFinished = !loop;
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.play();
      if (settle) {
        action.time = Math.max(0, clip.duration);
        action.paused = true;
      }
      active.add(action);
      played += 1;
    }
    mixer.update(0);
    return played;
  }

  return {
    play,
    stop(names) {
      for (const name of names || []) {
        const clip = byName.get(name);
        if (clip) mixer.existingAction(clip)?.stop();
      }
    },
    update(dt) { mixer.update(dt); },
    dispose() {
      for (const action of active) action.stop();
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      active.clear();
    },
  };
}

function localSocketWorld(root, name) {
  const socket = root.getObjectByName(name) || root;
  root.updateWorldMatrix(true, true);
  return socket.getWorldPosition(new THREE.Vector3());
}

function runtimeLight(root, placement, stateRecord) {
  if (!placement.light) return null;
  const spec = placement.light;
  const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2);
  light.name = `AssetRuntimeLight_${placement.n}`;
  light.castShadow = false;
  const socketName = placement.n === 83 ? 'SOCKET_Bulb'
    : placement.n === 94 ? 'SOCKET_LightLeft'
      : placement.n === 95 ? 'SOCKET_Indicator' : null;
  (socketName ? root.getObjectByName(socketName) : root)?.add(light);
  if (placement.interaction?.state === 'on') light.visible = stateRecord.on !== false;
  return light;
}

function interactionLabel(placement, stateRecord) {
  const spec = placement.interaction;
  if (!spec) return null;
  if (spec.kind === 'toggle') {
    const on = !!stateRecord[spec.state];
    const verb = on ? (spec.state === 'on' ? 'switch off' : 'close')
      : (spec.state === 'on' ? 'switch on' : 'open');
    return `${spec.label} — [E] ${verb}`;
  }
  return `${spec.label} — [E] use`;
}

/**
 * Load and integrate the forty Sheet 7–10 world assets.
 *
 * `getFixtureAnchor` is deliberately a callback because build mode destroys and recreates anchors.
 * The returned detach/sync pair brackets that rebuild so GLB resources never get disposed with a
 * retired anchor and the authored fixture follows the persisted pose on the next frame.
 */
export function buildProps({
  interior,
  loader,
  state = null,
  addProp = null,
  removeProp = null,
  L2W = (x, z) => ({ x, z }),
  getFixtureAnchor = null,
  legacyReady = Promise.resolve(),
  merch = null,
  hooks = {},
} = {}) {
  const group = new THREE.Group();
  group.name = 'Assets61to100Runtime';
  interior.add(group);

  const placedByNumber = new Map();
  const failed = [];
  const mixers = [];
  const interactionProps = [];
  const lights = [];
  const superseded = [];
  let disposed = false;

  function anchorFor(fixtureId) {
    return typeof getFixtureAnchor === 'function' ? getFixtureAnchor(fixtureId) : null;
  }

  function uniqueRootName(number, fixtureId = null) {
    const binding = RUNTIME_ASSET_MANIFEST_BY_NUMBER[number].binding;
    return `AssetRuntime_${number}_${binding.stem}${fixtureId ? `_${fixtureId}` : ''}`;
  }

  function hideFixtureFallbacks(entry) {
    if (!entry.fixtureId || !entry.root.parent || entry.root.parent === group) return;
    for (const sibling of entry.root.parent.children) {
      if (sibling !== entry.root) sibling.visible = false;
    }
  }

  function mountFixtureEntry(entry) {
    const anchor = anchorFor(entry.fixtureId);
    if (!anchor) {
      if (entry.root.parent !== group) group.attach(entry.root);
      entry.root.visible = false;
      entry.root.position.set(0, -256, 0);
      return false;
    }
    if (entry.root.parent !== anchor) anchor.add(entry.root);
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[entry.n];
    entry.root.scale.setScalar(manifest.binding.runtimeScale);
    entry.root.rotation.set(0, entry.placement.ry || 0, 0);
    entry.root.position.set(0, 0, 0);
    placeSocketAt(entry.root, new THREE.Vector3(0, 0, 0));
    entry.root.visible = true;
    hideFixtureFallbacks(entry);
    return true;
  }

  function mountNestedEntry(entry) {
    const parentNumber = Number(entry.placement.parentAsset);
    if (!parentNumber) return false;
    const parentEntry = placedByNumber.get(parentNumber)?.[0];
    const socket = parentEntry?.root.getObjectByName(entry.placement.parentSocket);
    if (!socket) {
      failed.push({
        n: entry.n,
        reason: `parent asset ${parentNumber} socket ${entry.placement.parentSocket} unavailable`,
      });
      return false;
    }
    socket.add(entry.root);
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[entry.n];
    entry.root.scale.setScalar(manifest.binding.runtimeScale);
    entry.root.rotation.set(0, entry.placement.ry || 0, 0);
    entry.root.position.set(0, 0, 0);
    placeSocketAt(entry.root, new THREE.Vector3(0, 0, 0));
    entry.root.visible = true;
    return true;
  }

  function registerWalkProp(entry, { tool = null, socket = 'SOCKET_PLACEMENT', suffix = '' } = {}) {
    if (typeof addProp !== 'function') return null;
    const placement = entry.placement;
    const stateRecord = entry.stateRecord;
    const initial = localSocketWorld(entry.root, socket);
    const prop = {
      x: initial.x,
      z: initial.z,
      r: tool ? 2.0 : 2.25,
      aimY: initial.y,
      tool,
      label: () => {
        if (tool) return `${CLEANING_TOOLS[tool]?.label || tool} — [E] equip`;
        return interactionLabel(placement, stateRecord);
      },
      focusPoint: () => localSocketWorld(entry.root, socket),
    };
    if (placement.interaction) {
      prop.action = () => {
        const spec = placement.interaction;
        if (spec.kind === 'toggle') {
          const next = !stateRecord[spec.state];
          stateRecord[spec.state] = next;
          stateRecord.updatedAt = Date.now();
          entry.controller?.stop(spec.loop);
          entry.controller?.play(next ? spec.open : spec.close);
          if (next) entry.controller?.play(spec.loop, { loop: true });
          if (entry.light && spec.state === 'on') entry.light.visible = next;
          hooks.assetStateChanged?.({
            assetNumber: entry.n,
            state: spec.state,
            value: next,
            stateRecord,
          });
          hooks.sfx?.(next ? 'open' : 'close');
        } else {
          stateRecord.uses = (Number(stateRecord.uses) || 0) + 1;
          stateRecord.updatedAt = Date.now();
          entry.controller?.play(spec.clips || []);
          hooks.sfx?.('click');
        }
      };
    }
    prop.userData = { assetNumber: entry.n, suffix };
    addProp(prop);
    interactionProps.push(prop);
    entry.walkProps.push(prop);
    return prop;
  }

  function prepareEntry(root, gltf, placement, fixtureId = null, instanceIndex = 0) {
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n];
    root.name = uniqueRootName(placement.n, fixtureId);
    root.userData.assetRuntime = Object.freeze({
      assetNumber: placement.n,
      saveStateKey: manifest.saveStateKey,
      performanceTier: manifest.performanceTier,
      placementCategory: manifest.placementCategory,
      instanceIndex,
      fixtureId,
    });
    let hiddenCollisionMeshes = 0;
    root.traverse((object) => {
      if (!object.isMesh) return;
      // The exports retain simplified COL_ meshes as auditable authoring evidence. Navigation is
      // owned by clubhouse analytic colliders, so rendering these proxies would double silhouettes
      // and make several tools look like black blocks.
      if (isAuthoredCollisionProxy(object, root)) {
        object.visible = false;
        object.userData.runtimeCollisionProxyExcluded = true;
        hiddenCollisionMeshes += 1;
      }
      object.castShadow = false;
      object.receiveShadow = false;
    });

    const stateRecord = ensureAssetState(state, placement.n);
    const entry = {
      n: placement.n,
      root,
      placement,
      fixtureId,
      stateRecord,
      walkProps: [],
      controller: animationController(root, gltf.animations || []),
      light: null,
      hiddenCollisionMeshes,
    };
    if (entry.controller) mixers.push(entry.controller);
    entry.light = runtimeLight(root, placement, stateRecord);
    if (entry.light) lights.push(entry.light);

    if (fixtureId) {
      mountFixtureEntry(entry);
    } else {
      group.add(root);
      root.scale.setScalar(manifest.binding.runtimeScale);
      root.rotation.set(0, placement.ry || 0, 0);
      root.position.set(0, 0, 0);
      const socketAligned = placeSocketAt(root, vectorFromTransform(manifest));
      if (!socketAligned) failed.push({ n: placement.n, reason: 'no SOCKET_PLACEMENT; positioned by origin' });
    }

    const spec = placement.interaction;
    if (spec?.kind === 'toggle' && stateRecord[spec.state]) {
      entry.controller?.play(spec.open, { settle: true });
      entry.controller?.play(spec.loop, { loop: true });
    }
    if (entry.light && spec?.state === 'on') entry.light.visible = stateRecord.on !== false;

    if (placement.tools) {
      for (const toolSpec of placement.tools) {
        registerWalkProp(entry, { ...toolSpec, suffix: toolSpec.tool });
      }
    } else if (placement.tool || placement.interaction) {
      const focusSocket = placement.interaction?.socket || (placement.tool
        ? (manifest.interactionSockets.find((name) => /Grip|Carry/i.test(name)) || 'SOCKET_PLACEMENT')
        : (manifest.interactionSockets.find((name) => /Handle|Trigger|Switch|Grip/i.test(name)) || 'SOCKET_PLACEMENT'));
      registerWalkProp(entry, { tool: placement.tool || null, socket: focusSocket });
    }

    const entries = placedByNumber.get(placement.n) || [];
    entries.push(entry);
    placedByNumber.set(placement.n, entries);
    return entry;
  }

  const jobs = PROP_PLACEMENTS.map((placement) => new Promise((resolve) => {
    const manifest = RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n];
    loader.load(manifest.glbPath, (gltf) => {
      try {
        const fixtureIds = placement.fixtureIds?.length ? placement.fixtureIds : [null];
        fixtureIds.forEach((fixtureId, index) => {
          const root = index === 0 ? gltf.scene : gltf.scene.clone(true);
          prepareEntry(root, gltf, placement, fixtureId, index);
        });
        resolve(true);
      } catch (error) {
        failed.push({ n: placement.n, reason: error.message });
        resolve(false);
      }
    }, undefined, (error) => {
      failed.push({ n: placement.n, reason: error?.message || 'load failed' });
      resolve(false);
    });
  }));

  function retireNamedFallbacks() {
    const placedNumbers = new Set(placedByNumber.keys());
    for (const rule of SUPERSEDES) {
      if (!rule.replacedBy.every((number) => placedNumbers.has(number))) continue;
      let legacy = interior.getObjectByName(rule.legacy);
      while (legacy) {
        legacy.removeFromParent();
        superseded.push(rule.legacy);
        legacy = interior.getObjectByName(rule.legacy);
      }
    }
  }

  function populateTrophyCabinet() {
    if (!merch) return 0;
    const entry = placedByNumber.get(70)?.[0];
    if (!entry) return 0;
    let populated = 0;
    for (const [index, socketName] of ['SOCKET_Trophy_01', 'SOCKET_Trophy_02', 'SOCKET_Collectible_01'].entries()) {
      const socket = entry.root.getObjectByName(socketName);
      const trophy = merch.instantiate?.('trophy');
      if (!socket || !trophy) continue;
      trophy.name = `Asset70SocketTrophy_${index + 1}`;
      trophy.scale.setScalar(index === 2 ? 0.68 : 0.78 + index * 0.08);
      trophy.position.set(0, 0, 0);
      socket.add(trophy);
      populated += 1;
    }
    entry.root.userData.populatedTrophySockets = populated;
    return populated;
  }

  const ready = Promise.all(jobs).then(async () => {
    await legacyReady.catch?.(() => {});
    if (disposed) return { placed: 0, instances: 0, superseded: [] };
    for (const entries of placedByNumber.values()) {
      for (const entry of entries) if (entry.placement.parentAsset) mountNestedEntry(entry);
    }
    retireNamedFallbacks();
    for (const entries of placedByNumber.values()) {
      for (const entry of entries) hideFixtureFallbacks(entry);
    }
    const trophySockets = populateTrophyCabinet();
    return {
      placed: placedByNumber.size,
      instances: [...placedByNumber.values()].reduce((sum, entries) => sum + entries.length, 0),
      superseded: [...superseded],
      trophySockets,
    };
  });

  function updateInteractionOrigins() {
    for (const entries of placedByNumber.values()) {
      for (const entry of entries) {
        for (const prop of entry.walkProps) {
          const point = prop.focusPoint?.();
          if (!point) continue;
          prop.x = point.x;
          prop.z = point.z;
          prop.aimY = point.y;
        }
      }
    }
  }

  return {
    group,
    ready,
    update(dt) {
      for (const controller of mixers) controller.update(dt);
      updateInteractionOrigins();
    },
    detachFixturePlacements() {
      for (const entries of placedByNumber.values()) {
        for (const entry of entries) {
          if (!entry.fixtureId || entry.root.parent === group) continue;
          group.attach(entry.root);
          entry.root.visible = false;
        }
      }
    },
    syncFixturePlacements() {
      let mounted = 0;
      for (const entries of placedByNumber.values()) {
        for (const entry of entries) if (entry.fixtureId && mountFixtureEntry(entry)) mounted += 1;
      }
      updateInteractionOrigins();
      return mounted;
    },
    roots: () => [...placedByNumber.values()].flat().map((entry) => entry.root),
    interactionTargets: () => {
      updateInteractionOrigins();
      return interactionProps.map((prop) => ({
        assetNumber: prop.userData?.assetNumber || null,
        suffix: prop.userData?.suffix || '',
        x: prop.x,
        z: prop.z,
        aimY: prop.aimY,
        radius: prop.r,
        tool: prop.tool || null,
        label: typeof prop.label === 'function' ? prop.label() : prop.label,
      }));
    },
    getRoot: (number, fixtureId = null) => {
      const entries = placedByNumber.get(Number(number)) || [];
      return (fixtureId ? entries.find((entry) => entry.fixtureId === fixtureId) : entries[0])?.root || null;
    },
    diagnostics: () => ({
      expected: PROP_PLACEMENTS.length,
      placed: placedByNumber.size,
      instances: [...placedByNumber.values()].reduce((sum, entries) => sum + entries.length, 0),
      failed: failed.length,
      failures: [...failed],
      assetNumbers: [...placedByNumber.keys()].sort((a, b) => a - b),
      superseded: [...superseded],
      interactions: interactionProps.length,
      animated: mixers.length,
      emittedLights: lights.length,
      hiddenCollisionMeshes: [...placedByNumber.values()].flat()
        .reduce((sum, entry) => sum + entry.hiddenCollisionMeshes, 0),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const prop of interactionProps) removeProp?.(prop);
      for (const controller of mixers) controller.dispose();
      const resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
      for (const root of [...placedByNumber.values()].flat().map((entry) => entry.root)) {
        root.traverse((object) => {
          if (!object.isMesh) return;
          if (object.geometry) resources.geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!material) continue;
            resources.materials.add(material);
            for (const value of Object.values(material)) if (value?.isTexture) resources.textures.add(value);
          }
        });
        root.removeFromParent();
      }
      for (const texture of resources.textures) texture.dispose();
      for (const material of resources.materials) material.dispose();
      for (const geometry of resources.geometries) geometry.dispose();
      group.removeFromParent();
      placedByNumber.clear();
    },
  };
}
