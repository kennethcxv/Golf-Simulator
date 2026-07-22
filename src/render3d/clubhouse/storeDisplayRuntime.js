import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  STORE_DISPLAY_FAMILIES, STORE_DISPLAY_TIERS, storeDisplayFamily,
} from '../../data/storeDisplayCatalog.js';
import {
  collectRenderableResources, disposeRenderableResources,
} from './resourceLifecycle.js';

function labelTexture(title, subtitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f3ead7';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#b08d42';
  context.lineWidth = 10;
  context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  context.fillStyle = '#183d2b';
  context.textAlign = 'center';
  let titleSize = 46;
  do {
    context.font = `700 ${titleSize}px Georgia`;
    titleSize -= 2;
  } while (titleSize > 24 && context.measureText(title).width > canvas.width - 54);
  context.fillText(title, canvas.width / 2, 68);
  context.fillStyle = '#554d40';
  context.font = '600 30px system-ui';
  context.fillText(subtitle, canvas.width / 2, 116);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addStudio(group, width, height, familyLabel) {
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: .86 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 5, 8), floorMaterial);
  floor.name = 'StoreDisplayShowroomFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -.012, .65);
  floor.receiveShadow = true;
  group.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x17452f, roughness: .9 });
  const wallHeight = height + 8;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(width + 5, wallHeight), wallMaterial);
  wall.name = 'StoreDisplayShowroomBackdrop';
  wall.position.set(0, wallHeight / 2 - .15, -1.15);
  group.add(wall);

  const titleTexture = labelTexture(familyLabel.toUpperCase(), 'FIVE-TIER DISPLAY SYSTEM');
  const title = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(8.2, Math.max(5.4, width * .52)), 1.05),
    new THREE.MeshBasicMaterial({ map: titleTexture, transparent: true, toneMapped: false }),
  );
  title.name = 'StoreDisplayShowroomTitle';
  title.position.set(0, height + (height < 1.25 ? 1.34 : .96), -1.08);
  group.add(title);

  const ambient = new THREE.HemisphereLight(0xffead1, 0x2f3832, 2.1);
  ambient.name = 'StoreDisplayShowroomAmbient';
  group.add(ambient);
  for (const x of [-width * .28, width * .28]) {
    const light = new THREE.PointLight(0xffd7a2, 16, 12, 1.5);
    light.name = 'StoreDisplayShowroomKey';
    light.position.set(x, height + 1.6, 2.5);
    group.add(light);
  }
}

function prepareAsset(root) {
  root.traverse((object) => {
    const authoringHelper = object.userData?.collision_proxy
      || object.name?.startsWith('COL_')
      || object.name?.startsWith('VOLUME_');
    if (authoringHelper) object.visible = false;
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = true;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material || !/PSDisplayGlass/u.test(material.name || '')) continue;
      material.color?.setHex(0x7fa4a8);
      material.transparent = true;
      material.opacity = .19;
      material.depthWrite = false;
      material.roughness = .12;
      material.emissive?.setHex(0x152c2f);
      material.emissiveIntensity = .22;
      material.needsUpdate = true;
    }
    if (object.name?.startsWith('LIGHT_PUCK_')) {
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      if (material) {
        material.emissiveIntensity = .72;
        material.needsUpdate = true;
      }
    }
  });
  return root;
}

export function createStoreDisplayRuntime({ scene, camera, center, heightAt }) {
  const loader = new GLTFLoader();
  const familyIds = new Set(STORE_DISPLAY_FAMILIES.map((family) => family.id));
  const showroomCenter = Object.freeze({ x: center.x + 42, z: center.z });
  const showroomY = heightAt(showroomCenter.x, showroomCenter.z) + .03;
  let generation = 0;
  let activeRoot = null;
  let priorCameraLayerMask = null;
  const deferredReleases = new Set();
  let status = Object.freeze({
    state: 'idle', family: null, loaded: 0, expected: 0, failures: [], assetIds: [],
  });

  function releaseRoot(root, { defer = false } = {}) {
    if (!root) return null;
    root.removeFromParent();
    if (!defer) return disposeRenderableResources(collectRenderableResources([root]));
    const pending = { root, timer: null };
    pending.timer = setTimeout(() => {
      deferredReleases.delete(pending);
      disposeRenderableResources(collectRenderableResources([root]));
    }, 1800);
    deferredReleases.add(pending);
    return null;
  }

  function flushDeferredReleases() {
    let released = null;
    for (const pending of deferredReleases) {
      clearTimeout(pending.timer);
      released = disposeRenderableResources(collectRenderableResources([pending.root]));
    }
    deferredReleases.clear();
    return released;
  }

  function clear() {
    generation += 1;
    const released = releaseRoot(activeRoot);
    flushDeferredReleases();
    activeRoot = null;
    if (priorCameraLayerMask != null) {
      camera.layers.mask = priorCameraLayerMask;
      priorCameraLayerMask = null;
    }
    document.body.classList.remove('store-display-showroom-active');
    status = Object.freeze({
      state: 'idle', family: null, loaded: 0, expected: 0, failures: [], assetIds: [],
    });
    return released;
  }

  async function showFamily(family) {
    if (!familyIds.has(family)) throw new Error(`Unknown store-display family: ${family}`);
    const token = ++generation;
    if (priorCameraLayerMask == null) priorCameraLayerMask = camera.layers.mask;
    camera.layers.set(30);
    releaseRoot(activeRoot, { defer: true });
    activeRoot = null;
    const assets = storeDisplayFamily(family);
    status = Object.freeze({
      state: 'loading', family, loaded: 0, expected: assets.length, failures: [], assetIds: [],
    });

    const settled = await Promise.allSettled(assets.map(async (asset) => {
      const gltf = await loader.loadAsync(`/${asset.glb}`);
      return { asset, root: prepareAsset(gltf.scene) };
    }));
    if (token !== generation) {
      for (const result of settled) if (result.status === 'fulfilled') releaseRoot(result.value.root);
      return null;
    }

    const loaded = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    const failures = settled.flatMap((result, index) => (
      result.status === 'rejected'
        ? [{ id: assets[index].id, message: String(result.reason?.message || result.reason) }]
        : []
    ));
    const familySpec = STORE_DISPLAY_FAMILIES.find((item) => item.id === family);
    const width = assets.reduce((sum, asset) => sum + asset.dimensions[0], 0) + 2.4;
    const height = Math.max(...assets.map((asset) => asset.dimensions[2]));
    const root = new THREE.Group();
    root.name = `StoreDisplayShowroom_${family}`;
    root.position.set(showroomCenter.x, showroomY, showroomCenter.z);
    root.userData.storeDisplayShowroom = true;
    root.userData.family = family;
    root.userData.showroomCameraDistance = Math.max(4.6, width * .58);
    addStudio(root, width, height, familySpec.label);

    let cursor = -width / 2;
    for (const { asset, root: model } of loaded) {
      const x = cursor + asset.dimensions[0] / 2;
      model.name = `${asset.id}_Runtime`;
      model.position.x = x;
      model.userData.storeDisplayAssetId = asset.id;
      root.add(model);

      const tier = STORE_DISPLAY_TIERS[asset.tier - 1];
      const texture = labelTexture(`T${asset.tier}`, tier.quality.toUpperCase());
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(.95, asset.dimensions[0] * .64), .38),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
      );
      plaque.name = `${asset.id}_Plaque`;
      plaque.position.set(x, asset.dimensions[2] + .23, .08);
      root.add(plaque);
      cursor += asset.dimensions[0] + .6;
    }
    root.traverse((object) => object.layers.set(30));
    scene.add(root);
    document.body.classList.add('store-display-showroom-active');
    activeRoot = root;
    status = Object.freeze({
      state: failures.length ? 'degraded' : 'ready',
      family,
      loaded: loaded.length,
      expected: assets.length,
      failures: Object.freeze(failures),
      assetIds: Object.freeze(loaded.map((entry) => entry.asset.id)),
    });
    return diagnostics();
  }

  function diagnostics() {
    return Object.freeze({
      ...status,
      availableFamilies: STORE_DISPLAY_FAMILIES.map((family) => family.id),
      showroomCenter: { ...showroomCenter, y: showroomY },
      cameraPose: {
        x: showroomCenter.x,
        z: showroomCenter.z + (activeRoot?.userData.showroomCameraDistance || 9),
        yaw: 0,
        pitch: .015,
      },
      rootName: activeRoot?.name || null,
    });
  }

  function dispose() {
    generation += 1;
    const released = releaseRoot(activeRoot);
    flushDeferredReleases();
    activeRoot = null;
    if (priorCameraLayerMask != null) {
      camera.layers.mask = priorCameraLayerMask;
      priorCameraLayerMask = null;
    }
    document.body.classList.remove('store-display-showroom-active');
    status = Object.freeze({
      state: 'disposed', family: null, loaded: 0, expected: 0, failures: [], assetIds: [],
    });
    return released;
  }

  return Object.freeze({
    showFamily,
    clear,
    diagnostics,
    dispose,
  });
}
