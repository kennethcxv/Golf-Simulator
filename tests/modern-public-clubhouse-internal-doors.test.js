import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GLB_URL = new URL(
  '../vendor/models/clubhouse/modern_public_clubhouse_v1.glb',
  import.meta.url,
);

function loader() {
  const result = new GLTFLoader();
  result.register(() => ({
    name: 'modern-clubhouse-door-test-texture-stub',
    loadTexture: async () => new THREE.Texture(),
  }));
  return result;
}

async function loadClubhouse() {
  const bytes = await readFile(GLB_URL);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader().parse(data, '', resolve, reject));
}

function close(actual, expected, tolerance = 0.006) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);
}

test('the shipped GLB keeps room doors broadside, hinged, and interactable in Three.js coordinates', async () => {
  const root = (await loadClubhouse()).scene;
  const specs = [
    ['Interior_EmployeeRoom', -3.70, 0.92, 2.12],
    ['Interior_Storage', 0.20, 0.92, 2.12],
    ['Interior_Irrigation', 4.18, 0.92, 2.12],
    ['RearServiceDoor', 3.29184, 1.28, 2.52],
  ];
  for (const [slug, blenderY, width, height] of specs) {
    const pivot = root.getObjectByName(`PIVOT_${slug}`);
    const leaf = root.getObjectByName(`MESH_${slug}_Leaf`);
    const lever = root.getObjectByName(`MESH_${slug}_Lever`);
    const socket = root.getObjectByName(`SOCKET_${slug}_Interaction`);
    assert.ok(pivot && leaf?.isMesh && lever?.isMesh && socket, slug);
    assert.equal(leaf.parent, pivot);
    assert.equal(lever.parent, pivot);
    assert.equal(socket.parent, pivot);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(leaf);
    const size = bounds.getSize(new THREE.Vector3());
    close(size.x, 0.055);
    close(size.y, height);
    close(size.z, width);
    const hinge = pivot.getWorldPosition(new THREE.Vector3());
    close(hinge.x, slug === 'RearServiceDoor' ? 8.43 : 5.35);
    close(hinge.y, 0.27432);
    close(hinge.z, -blenderY + width / 2);
    const interaction = socket.getWorldPosition(new THREE.Vector3());
    close(interaction.x, slug === 'RearServiceDoor' ? 8.43 : 5.35);
    close(interaction.y, 1.29432);
    close(interaction.z, -blenderY);
  }
});

test('the shipped service cross-wall leaves the inherited office doorway visibly open', async () => {
  const root = (await loadClubhouse()).scene;
  root.updateMatrixWorld(true);
  const west = new THREE.Box3().setFromObject(root.getObjectByName('MESH_Partition_ServiceCross_0_West'));
  const east = new THREE.Box3().setFromObject(root.getObjectByName('MESH_Partition_ServiceCross_0_East'));
  const header = new THREE.Box3().setFromObject(root.getObjectByName('MESH_Partition_ServiceCross_0_Header'));
  const center = 7.55;
  const width = 1.3 * 0.9144;
  close(west.max.x, center - width / 2);
  close(east.min.x, center + width / 2);
  // Blender Z becomes Three.js Y.
  close(header.min.y, 0.27432 + 2.5 * 0.9144);
});

test('the shipped service spine has true apertures behind all three animated room leaves', async () => {
  const root = (await loadClubhouse()).scene;
  root.updateMatrixWorld(true);
  assert.equal(root.getObjectByName('MESH_Partition_ServiceSpine'), undefined);
  const structural = [];
  root.traverse((node) => {
    if (node.isMesh && /^MESH_Partition_ServiceSpine_(?:Segment|Header)/.test(node.name)) {
      structural.push({ node, bounds: new THREE.Box3().setFromObject(node) });
    }
  });
  assert.equal(structural.length, 7);
  for (const centerZ of [3.70, -0.20, -4.18]) {
    const blocksOpening = structural.some(({ bounds }) => (
      bounds.min.z < centerZ && bounds.max.z > centerZ
      && bounds.min.y < 0.27432 + 2.12
    ));
    assert.equal(blocksOpening, false, `service aperture at runtime z=${centerZ}`);
  }
});

test('the shipped restroom door opens into an enclosed permanent sanitary fitout', async () => {
  const root = (await loadClubhouse()).scene;
  root.updateMatrixWorld(true);
  for (const name of [
    'MESH_Restroom_EastWall',
    'MESH_Restroom_SouthWall',
    'MESH_Restroom_NorthWall',
    'MESH_Restroom_TileFloor',
    'MESH_Restroom_ToiletBowl',
    'MESH_Restroom_ToiletTank',
    'MESH_Restroom_BasinTop',
    'MESH_Restroom_Mirror',
    'COL_RestroomEastWall',
    'COL_RestroomSouthWall',
    'COL_RestroomNorthWall',
    'COL_RestroomToilet',
    'COL_RestroomSink',
  ]) {
    assert.ok(root.getObjectByName(name), name);
  }
  const east = new THREE.Box3().setFromObject(root.getObjectByName('MESH_Restroom_EastWall'));
  const south = new THREE.Box3().setFromObject(root.getObjectByName('MESH_Restroom_SouthWall'));
  const north = new THREE.Box3().setFromObject(root.getObjectByName('MESH_Restroom_NorthWall'));
  const toilet = new THREE.Box3().setFromObject(root.getObjectByName('COL_RestroomToilet'));
  const sink = new THREE.Box3().setFromObject(root.getObjectByName('COL_RestroomSink'));
  close((east.min.x + east.max.x) / 2, 6.90);
  // Blender +Y exports to runtime -Z.
  close((south.min.z + south.max.z) / 2, -3.25);
  close((north.min.z + north.max.z) / 2, -5.00);
  close((toilet.min.z + toilet.max.z) / 2, -4.70);
  close((sink.min.z + sink.max.z) / 2, -4.70);
});
