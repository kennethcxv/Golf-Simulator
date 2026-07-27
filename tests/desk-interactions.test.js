import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  batchStaticFurnitureLodMeshes,
  collectFurnitureFunctionalNodes,
  createAuthoredFurnitureLod,
  createExternalFurnitureLod,
  createFurnitureComponentControllers,
} from '../src/render3d/clubhouse/propertyFurnitureVisuals.js';

function component(root, name, type, metadata = {}) {
  const node = new THREE.Group();
  node.name = name;
  node.userData = {
    interactionType: type,
    closedLocation: [0, 0, 0],
    ...metadata,
  };
  root.add(node);
  const interaction = new THREE.Group();
  interaction.name = `INTERACT_${name}`;
  interaction.userData = { interactionType: type, component: name };
  node.add(interaction);
  return node;
}

test('drawer controllers restore, toggle, and animate along the exported front axis', () => {
  const root = new THREE.Group();
  const drawer = component(root, 'Drawer_Left_Top', 'drawer', { openDistance: 0.35 });
  const changes = [];
  const [controller] = createFurnitureComponentControllers(root, {
    componentStates: { Drawer_Left_Top: true },
    onComponentStateChange: (change) => changes.push(change),
  });

  assert.equal(controller.isOpen(), true);
  assert.equal(drawer.position.z, 0.35);
  controller.toggle();
  assert.equal(controller.isOpen(), false);
  assert.deepEqual(changes.map(({ name, open }) => ({ name, open })), [
    { name: 'Drawer_Left_Top', open: false },
  ]);
  controller.update(1);
  assert.equal(drawer.position.z, 0);
});

test('cabinet controllers rotate around the authored glTF Y hinge and remain independent', () => {
  const root = new THREE.Group();
  component(root, 'CabinetDoor_Left', 'cabinet-door', { openAngle: -96 });
  component(root, 'CabinetDoor_Right', 'cabinet-door', { openAngle: 96 });
  const controllers = createFurnitureComponentControllers(root);
  assert.equal(controllers.length, 2);

  controllers[0].setOpen(true);
  controllers[0].update(1);
  assert.ok(controllers[0].node.quaternion.y < -0.7);
  assert.equal(controllers[1].node.rotation.y, 0);
});

test('authored furniture LOD roots become one distance-switched runtime hierarchy', () => {
  const root = new THREE.Group();
  const asset = new THREE.Group();
  asset.name = 'ClothingRack_Test';
  root.add(asset);
  for (const name of ['LOD0', 'LOD1', 'LOD2']) {
    const level = new THREE.Group();
    level.name = name;
    asset.add(level);
  }

  const lod = createAuthoredFurnitureLod(root, { distancesM: [0, 8, 18], modelScale: 1.1 });
  assert.ok(lod?.isLOD);
  assert.equal(lod.parent, asset);
  assert.deepEqual(lod.levels.map((level) => level.object.name), ['LOD0', 'LOD1', 'LOD2']);
  assert.deepEqual(lod.levels.map((level) => level.distance), [0, 8.8, 19.8]);
  assert.deepEqual(lod.levels.map((level) => level.object.visible), [true, false, false]);
});

test('separate desk GLBs become one distance-switched runtime hierarchy', () => {
  const levels = ['Desk_Test', 'Desk_Test_LOD1', 'Desk_Test_LOD2'].map((name) => {
    const level = new THREE.Group();
    level.name = name;
    return level;
  });
  const lod = createExternalFurnitureLod(levels, { distancesM: [0, 8, 18], modelScale: 1.1 });
  assert.ok(lod?.isLOD);
  assert.deepEqual(lod.levels.map((level) => level.object.name), [
    'Desk_Test', 'Desk_Test_LOD1', 'Desk_Test_LOD2',
  ]);
  assert.deepEqual(lod.levels.map((level) => level.distance), [0, 8.8, 19.8]);
  assert.deepEqual(lod.levels.map((level) => level.object.visible), [true, false, false]);
});

test('static authored LOD pieces batch per material without changing LOD levels', () => {
  const material = new THREE.MeshStandardMaterial({ color: 0x76502f });
  const lod = new THREE.LOD();
  for (let levelIndex = 0; levelIndex < 3; levelIndex += 1) {
    const level = new THREE.Group();
    level.name = `LOD${levelIndex}`;
    for (let meshIndex = 0; meshIndex < 3; meshIndex += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.position.x = meshIndex * 1.25;
      level.add(mesh);
    }
    lod.addLevel(level, levelIndex * 8);
  }

  const result = batchStaticFurnitureLodMeshes(lod, { name: 'RackTestBatch' });
  assert.equal(result.sourceMeshes, 9);
  assert.equal(result.batchedMeshes, 3);
  assert.equal(result.reducedBy, 6);
  assert.deepEqual(lod.levels.map(({ object }) => (
    object.children.filter((child) => child.isMesh).length
  )), [1, 1, 1]);
  assert.deepEqual(lod.levels.map(({ object }) => object.name), ['LOD0', 'LOD1', 'LOD2']);
});

test('runtime batching leaves cabinet-door meshes attached to their authored hinges', () => {
  const material = new THREE.MeshStandardMaterial({ color: 0x76502f });
  const lod = new THREE.LOD();
  for (let levelIndex = 0; levelIndex < 3; levelIndex += 1) {
    const level = new THREE.Group();
    level.name = `LOD${levelIndex}`;
    level.add(
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material),
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material),
    );
    const hinge = new THREE.Group();
    hinge.name = `CabinetDoor_${levelIndex}`;
    hinge.userData.interactionType = 'cabinet-door';
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.05), material);
    hinge.add(leaf);
    level.add(hinge);
    lod.addLevel(level, levelIndex * 8);
  }

  const result = batchStaticFurnitureLodMeshes(lod, {
    name: 'ShelfTestBatch',
    excludeMesh: (mesh) => {
      let cursor = mesh;
      while (cursor && cursor !== lod) {
        if (cursor.userData?.interactionType === 'cabinet-door') return true;
        cursor = cursor.parent;
      }
      return false;
    },
  });

  assert.equal(result.sourceMeshes, 6);
  assert.equal(result.reducedBy, 3);
  for (const { object } of lod.levels) {
    const hinge = object.children.find((child) => child.name.startsWith('CabinetDoor_'));
    assert.ok(hinge?.children[0]?.isMesh);
  }
});

test('runtime batching never turns hidden collision proxies into visible furniture', () => {
  const material = new THREE.MeshStandardMaterial({ name: 'GF_Shelf_Walnut' });
  const collisionMaterial = new THREE.MeshBasicMaterial({ name: 'GF_Shelf_CollisionHidden' });
  const level = new THREE.Group();
  level.name = 'LOD0';
  for (let index = 0; index < 2; index += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.4), material);
    mesh.position.y = index * 0.5;
    level.add(mesh);
  }
  for (let index = 0; index < 2; index += 1) {
    const collision = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), collisionMaterial);
    collision.name = `COLLISION_Test_${index}`;
    collision.visible = false;
    collision.userData.collision_proxy = true;
    level.add(collision);
  }
  const lod = new THREE.LOD();
  lod.addLevel(level, 0);

  const summary = batchStaticFurnitureLodMeshes(lod, { name: 'ShelfBatch' });
  assert.equal(summary.sourceMeshes, 2);
  assert.equal(summary.batchedMeshes, 1);
  assert.equal(level.children.some((child) => /CollisionHidden/.test(child.material?.name || '')), true);
  assert.equal(level.children.some((child) => child.visible && /CollisionHidden/.test(child.material?.name || '')), false);
});

test('functional clothing nodes remain addressable for stocking and interaction', () => {
  const root = new THREE.Group();
  for (const name of [
    'HANG_ZONE_01_START', 'HANG_ZONE_01_END', 'HANG_ZONE_01_CENTER',
    'SHELF_ZONE_01', 'SHELF_ZONE_01_MIN', 'SHELF_ZONE_01_MAX',
    'LIGHT_PUCK_01', 'INTERACTION_POINT', 'PLACEMENT_FOOTPRINT', 'DecorativeTrim',
  ]) {
    const node = new THREE.Group();
    node.name = name;
    root.add(node);
  }
  const nodes = collectFurnitureFunctionalNodes(root);
  assert.equal(nodes.names.includes('DecorativeTrim'), false);
  assert.equal(nodes.hangNodes.length, 3);
  assert.equal(nodes.shelfNodes.length, 3);
  assert.deepEqual(nodes.lightNodes, ['LIGHT_PUCK_01']);
  assert.equal(nodes.interactionPoint.name, 'INTERACTION_POINT');
  assert.equal(nodes.placementFootprint.name, 'PLACEMENT_FOOTPRINT');
});

test('chair seating anchors and prepared mechanism pivots remain addressable at runtime', () => {
  const root = new THREE.Group();
  for (const name of [
    'SEAT_ANCHOR', 'SIT_INTERACTION_POINT',
    'FOOT_ANCHOR_LEFT', 'FOOT_ANCHOR_RIGHT',
    'HAND_ANCHOR_LEFT', 'HAND_ANCHOR_RIGHT',
    'ENTRY_POINT_LEFT', 'ENTRY_POINT_RIGHT',
    'EXIT_POINT_LEFT', 'EXIT_POINT_RIGHT',
    'CHAIR_ANCHOR', 'DESK_ALIGNMENT_ANCHOR', 'DESK_WORK_POSITION',
    'SWIVEL_CENTER', 'SOCKET_PLACEMENT',
    'HeightAdjustmentPivot', 'SwivelPivot', 'BackrestTiltPivot',
    'Caster_01', 'Caster_02', 'Caster_03', 'Caster_04', 'Caster_05',
  ]) {
    const node = new THREE.Group();
    node.name = name;
    root.add(node);
  }

  const nodes = collectFurnitureFunctionalNodes(root);
  assert.equal(nodes.seatAnchor.name, 'SEAT_ANCHOR');
  assert.equal(nodes.sitInteractionPoint.name, 'SIT_INTERACTION_POINT');
  assert.equal(nodes.footAnchors.length, 2);
  assert.equal(nodes.handAnchors.length, 2);
  assert.equal(nodes.entryPoints.length, 2);
  assert.equal(nodes.exitPoints.length, 2);
  assert.equal(nodes.chairAnchor.name, 'CHAIR_ANCHOR');
  assert.equal(nodes.deskAlignmentAnchor.name, 'DESK_ALIGNMENT_ANCHOR');
  assert.equal(nodes.deskWorkPosition.name, 'DESK_WORK_POSITION');
  assert.equal(nodes.swivelCenter.name, 'SWIVEL_CENTER');
  assert.equal(nodes.heightAdjustmentPivot.name, 'HeightAdjustmentPivot');
  assert.equal(nodes.swivelPivot.name, 'SwivelPivot');
  assert.equal(nodes.backrestTiltPivot.name, 'BackrestTiltPivot');
  assert.equal(nodes.casterPivots.length, 5);
});
