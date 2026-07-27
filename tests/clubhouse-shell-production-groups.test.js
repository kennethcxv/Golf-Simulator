import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { INTERIOR, STOCKROOM, WINDOWS } from '../src/data/shopLayout.js';
import {
  buildShell,
  clubhouseCeilingLightBackend,
  PINE_HILLS_CEILING_PANEL_LIGHTING,
  PINE_HILLS_RENDERED_PANEL_BUDGET,
} from '../src/render3d/clubhouse/shell.js';

const FLOOR_TOP = 0.3;
const EXPECTED_KEYS = Object.freeze([
  'exteriorShellStructure',
  'apertureTrim',
  'porchVisuals',
  'windowVisuals',
  'renovatedFloor',
  'ceilingVisuals',
  'wainscotPanels',
  'interiorTrim',
  'servicePartitions',
]);

function fakeCanvas() {
  const canvas = { width: 1, height: 1, style: {} };
  const gradient = { addColorStop() {} };
  const known = {
    canvas,
    measureText: (value) => ({ width: String(value ?? '').length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: (_x, _y, width = canvas.width, height = canvas.height) => ({
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)), width, height,
    }),
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(Math.max(0, width * height * 4)), width, height,
    }),
  };
  const context = new Proxy(known, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  canvas.getContext = () => context;
  return canvas;
}

function fakeDocument() {
  const image = () => ({
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, crossOrigin: null, src: '',
  });
  return {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
    createElementNS: () => image(),
  };
}

function materials() {
  const material = () => new THREE.MeshStandardMaterial();
  return {
    ceiling: material(),
    charcoal: material(),
    glass: material(),
    iron: material(),
    plaster: material(),
    oakFloor: material(),
    trimPaint: material(),
    walnut: material(),
    walnutDark: material(),
  };
}

function boxDimensions(node) {
  const parameters = node?.geometry?.parameters;
  return parameters && {
    w: parameters.width,
    h: parameters.height,
    d: parameters.depth,
  };
}

function near(value, expected) {
  return Math.abs(value - expected) < 1e-8;
}

test('Pine Hills keeps its authored area-light backend on every supported renderer', () => {
  assert.equal(clubhouseCeilingLightBackend(8), 'rect-area');
  assert.equal(clubhouseCeilingLightBackend(16), 'rect-area');
  assert.equal(clubhouseCeilingLightBackend(32), 'rect-area');
  assert.equal(clubhouseCeilingLightBackend(undefined), 'rect-area');
  assert.equal(PINE_HILLS_CEILING_PANEL_LIGHTING.backend, 'rect-area');
  assert.ok(PINE_HILLS_CEILING_PANEL_LIGHTING.baseIntensity > 0);
  assert.ok(PINE_HILLS_CEILING_PANEL_LIGHTING.baseIntensity <= 6);
  assert.ok(Object.isFrozen(PINE_HILLS_CEILING_PANEL_LIGHTING));
  assert.equal(PINE_HILLS_RENDERED_PANEL_BUDGET, 4);
});

test('buildShell exposes isolated production fallback facades without changing the procedural scene', () => {
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument();

  try {
    const group = new THREE.Group();
    const interior = new THREE.Group();
    const mats = materials();
    const colliders = [];
    const shell = buildShell({
      group,
      interior,
      mats,
      merch: null,
      addCol(collider) { colliders.push(collider); return collider; },
      colBoxAt(x, z, w, d) {
        return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
      },
      FLOOR_TOP,
      state: { clubName: 'Registry Test' },
      renderer: { capabilities: { maxTextures: 16 } },
    });

    assert.ok(shell.windowDefs);
    assert.ok(shell.lighting);
    assert.ok(shell.sidingMat?.isMaterial);
    assert.ok(shell.roofMat?.isMaterial);
    assert.deepEqual(shell.productionVisualFallbackKeys, EXPECTED_KEYS);
    assert.deepEqual(Object.keys(shell.productionVisualFallbacks), EXPECTED_KEYS);
    assert.deepEqual(
      shell.productionVisualFallbackCounts,
      Object.fromEntries(EXPECTED_KEYS.map((key) => [key, shell.productionVisualFallbacks[key].nodeCount])),
    );
    assert.ok(Object.isFrozen(shell.productionVisualFallbacks));
    assert.ok(Object.isFrozen(shell.productionVisualFallbackKeys));
    assert.ok(Object.isFrozen(shell.productionVisualFallbackCounts));

    const handles = EXPECTED_KEYS.map((key) => shell.productionVisualFallbacks[key]);
    for (const handle of handles) {
      assert.ok(Object.isFrozen(handle));
      assert.ok(Object.isFrozen(handle.nodes));
      assert.ok(handle.nodeCount > 0, `${handle.name} must own at least one fallback visual`);
      assert.equal(handle.visible, true);
      assert.equal(handle.nodes.every((node) => node.visible), true);
    }

    const allNodes = handles.flatMap((handle) => handle.nodes);
    const nodeSet = new Set(allNodes);
    assert.equal(nodeSet.size, allNodes.length, 'fallback categories remain disjoint');
    assert.equal(allNodes.every((node) => node.isMesh), true);

    const lights = [];
    group.traverse((node) => { if (node.isPointLight) lights.push(node); });
    interior.traverse((node) => { if (node.isPointLight) lights.push(node); });
    assert.ok(lights.length > 0, 'fixture contains the live lighting rig');
    assert.equal(lights.some((light) => nodeSet.has(light)), false, 'PointLights are not fallback visuals');
    assert.ok(colliders.length > 0, 'fixture contains shell and porch colliders');
    assert.equal(colliders.some((collider) => nodeSet.has(collider)), false);

    for (const { holder } of shell.windowDefs) assert.equal(nodeSet.has(holder), false);
    const dirt = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), mats.charcoal);
    shell.windowDefs[0].holder.add(dirt);
    assert.equal(nodeSet.has(dirt), false, 'post-build window dirt is outside the frozen visual sets');
    shell.productionVisualFallbacks.windowVisuals.visible = false;
    assert.equal(shell.productionVisualFallbacks.windowVisuals.nodes.every((node) => !node.visible), true);
    assert.equal(shell.windowDefs[0].holder.visible, true);
    assert.equal(dirt.visible, true);
    shell.productionVisualFallbacks.windowVisuals.visible = true;

    const partitionMeshes = group.children.filter((node) => (
      node.isMesh
      && node.material === mats.plaster
      && (near(node.position.x, 5.7) || near(node.position.z, 2.0))
    ));
    assert.ok(partitionMeshes.length > 0);
    assert.equal(
      partitionMeshes.every((node) => shell.productionVisualFallbacks.servicePartitions.nodes.includes(node)),
      true,
      'the authored presentation can atomically replace every legacy service partition',
    );
    const landscape = group.children.filter((node) => node.geometry?.type === 'IcosahedronGeometry');
    assert.ok(landscape.length > 0);
    assert.equal(landscape.some((node) => nodeSet.has(node)), false, 'landscaping stays independent');
    const path = group.children.filter((node) => {
      const dims = boxDimensions(node);
      return dims && near(dims.w, 1.6) && near(dims.h, 0.05) && near(dims.d, 1.18);
    });
    assert.equal(path.length, 4);
    assert.equal(path.some((node) => nodeSet.has(node)), false, 'walk slabs stay independent');

    const floor = shell.productionVisualFallbacks.renovatedFloor.nodes;
    assert.equal(floor.length, 1);
    assert.deepEqual(boxDimensions(floor[0]), { w: INTERIOR.w, h: FLOOR_TOP, d: INTERIOR.d });
    const stockroomConcrete = group.children.find((node) => {
      const dims = boxDimensions(node);
      return dims
        && near(dims.w, STOCKROOM.bounds.maxX - STOCKROOM.bounds.minX)
        && near(dims.h, FLOOR_TOP + 0.008)
        && near(dims.d, STOCKROOM.bounds.maxZ - STOCKROOM.bounds.minZ);
    });
    assert.ok(stockroomConcrete);
    assert.equal(nodeSet.has(stockroomConcrete), false);
    assert.equal(shell.productionVisualFallbacks.apertureTrim.nodeCount, WINDOWS.length * 4);
    assert.equal(shell.productionVisualFallbacks.windowVisuals.nodeCount, WINDOWS.length * 7);

    const ceiling = shell.productionVisualFallbacks.ceilingVisuals;
    assert.ok(ceiling.nodes.some((node) => node.geometry?.type === 'BoxGeometry'));
    assert.equal(ceiling.nodes.some((node) => node.isLight), false);
    const panelLights = [];
    interior.traverse((node) => { if (node.isRectAreaLight) panelLights.push(node); });
    assert.equal(panelLights.length, 8, 'the Pine Hills ceiling has two banks of four area lights');
    assert.equal(panelLights.every((light) => light.castShadow === false), true);
    assert.equal(panelLights.every((light) => light.userData.lightingBackend === 'rect-area'), true);
    assert.equal(panelLights.every((light) => light.userData.resourceOwner === 'clubhouse-interior'), true);
    const panelPointFallbacks = [];
    interior.traverse((node) => {
      if (node.isPointLight && node.name.startsWith('CeilingPanelLight_')) panelPointFallbacks.push(node);
    });
    assert.equal(panelPointFallbacks.length, 0);
    const panelRig = interior.getObjectByName('PineHillsCeilingPanelRig');
    assert.ok(panelRig?.isGroup);
    assert.equal(panelRig.userData.resourceOwner, 'clubhouse-interior');
    assert.equal(panelRig.userData.sharedUniformOwner, 'RectAreaLightUniformsLib');
    assert.equal(panelLights.every((light) => light.parent === panelRig), true);
    assert.equal(panelLights.filter((light) => light.layers.mask !== 0).length,
      PINE_HILLS_RENDERED_PANEL_BUDGET,
      'only the nearest authored area sources enter the fragment-light loop');
    const westBudget = shell.lighting.setCameraLocalPosition(-9, -5);
    const eastBudget = shell.lighting.setCameraLocalPosition(9, 5);
    assert.equal(westBudget.rendered, PINE_HILLS_RENDERED_PANEL_BUDGET);
    assert.equal(eastBudget.rendered, PINE_HILLS_RENDERED_PANEL_BUDGET);
    assert.notDeepEqual(eastBudget.renderedPanelIds, westBudget.renderedPanelIds,
      'the four physical sources follow the occupied room zone');
    assert.equal(panelLights.filter((light) => light.layers.mask !== 0).length,
      PINE_HILLS_RENDERED_PANEL_BUDGET);
    for (const light of panelLights) {
      const emittedDirection = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(light.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(emittedDirection.y < -0.999, `${light.name} must emit toward the room`);
    }

    // The facade snapshots current, potentially mixed state and restores it
    // exactly; loader teardown must not turn intentionally hidden nodes on.
    const [mixedHidden, mixedVisible] = ceiling.nodes;
    mixedHidden.visible = false;
    mixedVisible.visible = true;
    ceiling.setVisible(false);
    assert.equal(mixedHidden.visible, false);
    assert.equal(mixedVisible.visible, false);
    ceiling.setVisible(true);
    assert.equal(mixedHidden.visible, false);
    assert.equal(mixedVisible.visible, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('starting panel faults, repair refresh, and circuit control operate on RectAreaLights', () => {
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument();

  try {
    const state = {
      seed: 4107,
      property: { id: 'pine-hills-light-test' },
      club: { reputation: 30 },
      shop: { unlockedTier: 1, reno: {} },
    };
    const group = new THREE.Group();
    const interior = new THREE.Group();
    const shell = buildShell({
      group,
      interior,
      mats: materials(),
      merch: null,
      addCol(collider) { return collider; },
      colBoxAt(x, z, w, d) {
        return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
      },
      FLOOR_TOP,
      state,
      renderer: { capabilities: { maxTextures: 16 } },
    });
    const panelLights = [];
    interior.traverse((node) => {
      if (node.name.startsWith('CeilingPanelLight_')) panelLights.push(node);
    });
    const panel02 = interior.getObjectByName('CeilingPanelLight_panel-02');
    const panel07 = interior.getObjectByName('CeilingPanelLight_panel-07');
    const panel07Face = interior.getObjectByName('CeilingPanelFace_panel-07');

    assert.equal(panelLights.length, 8);
    assert.equal(panelLights.every((light) => light.isRectAreaLight), true);
    assert.equal(panel02.visible, true, 'panel-02 starts powered but flickering');
    assert.ok(panel02.intensity > 0);
    assert.equal(panel07.visible, false, 'panel-07 starts dead');
    assert.equal(panel07.intensity, 0);
    assert.equal(panel07Face.material.color.getHex(), 0xc9c1b3,
      'a dead diffuser remains a warm neutral surface instead of a black ceiling hole');
    assert.equal(panel07Face.material.emissiveIntensity, 0);

    const beforeFlicker = panel02.intensity;
    shell.lighting.updateFlicker(0.173);
    assert.notEqual(panel02.intensity, beforeFlicker);

    state.shop.reno.lightPanels['panel-02'] = 'working';
    state.shop.reno.lightPanels['panel-07'] = 'working';
    shell.lighting.refreshRestoration();
    assert.equal(panel07.visible, true);
    assert.ok(panel07.intensity > 0);
    const repairedIntensity = panel02.intensity;
    shell.lighting.updateFlicker(0.173);
    assert.equal(panel02.intensity, repairedIntensity, 'repair permanently stops panel-02 flicker');

    assert.equal(shell.lighting.setCeilingCircuitPowered(false), true);
    assert.equal(panelLights.every((light) => !light.visible && light.intensity === 0), true);
    assert.equal(shell.lighting.setCeilingCircuitPowered(true), true);
    assert.equal(panelLights.every((light) => light.visible && light.intensity > 0), true);
    assert.equal(panelLights.filter((light) => light.layers.mask !== 0).length,
      PINE_HILLS_RENDERED_PANEL_BUDGET,
      'repair restores authored state without exceeding the physical-light budget');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
