import test from 'node:test';
import assert from 'node:assert/strict';

import {
  auditGlbBuffer,
  mipmappedRgba8Bytes,
  parseGlb,
  reportCsv,
  stableStringify,
} from '../tools/qa/asset-footprint-audit.mjs';

function floats(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function unsignedShorts(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function fakePng(width, height) {
  const buffer = Buffer.alloc(26);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer.writeUInt8(8, 24);
  buffer.writeUInt8(6, 25);
  return buffer;
}

function fixtureGlb() {
  const parts = [];
  let byteLength = 0;
  function add(bytes) {
    const padding = (4 - (byteLength % 4)) % 4;
    if (padding) {
      parts.push(Buffer.alloc(padding));
      byteLength += padding;
    }
    const byteOffset = byteLength;
    parts.push(bytes);
    byteLength += bytes.length;
    return { byteOffset, byteLength: bytes.length };
  }

  const positionView = add(floats([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const indexView = add(unsignedShorts([0, 1, 2]));
  const imageView = add(fakePng(2, 4));
  const timeView = add(floats([0, 2]));
  const outputView = add(floats([10, 2, 0, 11, 2, 0]));
  const binary = Buffer.concat(parts);

  const gltf = {
    asset: { version: '2.0', generator: 'asset-footprint-audit-test' },
    extensionsUsed: ['KHR_texture_transform'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Root', mesh: 0, translation: [10, 2, 0], scale: [2, 3, 1] },
      { name: 'Unreachable' },
    ],
    meshes: [{
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
    }],
    materials: [
      { pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0, 0] } } } } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 1, extensions: { KHR_texture_transform: { offset: [0, 0] } } } } },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [
      { bufferView: 2, mimeType: 'image/png' },
      { bufferView: 2, mimeType: 'image/png' },
    ],
    animations: [{
      name: 'Move',
      samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    bufferViews: [positionView, indexView, imageView, timeView, outputView].map((view) => ({ buffer: 0, ...view })),
    buffers: [{ byteLength: binary.length }],
  };

  const jsonSource = Buffer.from(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonSource.length % 4)) % 4;
  const json = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (binary.length % 4)) % 4;
  const bin = Buffer.concat([binary, Buffer.alloc(binPadding)]);
  const totalLength = 12 + 8 + json.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, bin]);
}

test('consolidated audit reports geometry, transformed bounds, images, animation, and reachability', () => {
  const buffer = fixtureGlb();
  const asset = auditGlbBuffer(buffer, { displayPath: 'vendor/models/test.glb' });

  assert.equal(asset.classification, 'runtime');
  assert.equal(asset.bytes, buffer.length);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(asset.geometry.triangles, 1);
  assert.equal(asset.geometry.sceneTriangles, 1);
  assert.equal(asset.geometry.renderVertices, 3);
  assert.equal(asset.geometry.uploadVertices, 3);
  assert.deepEqual(asset.resources.meshes[0].localBounds?.min, [0, 0, 0]);
  assert.deepEqual(asset.resources.meshes[0].localBounds?.max, [1, 1, 0]);
  assert.ok(asset.scene.transformedBounds, stableStringify(asset.scene, 2));
  assert.deepEqual(asset.scene.transformedBounds.min, [10, 2, 0]);
  assert.deepEqual(asset.scene.transformedBounds.max, [12, 5, 0]);

  assert.equal(asset.resources.images[0].width, 2);
  assert.equal(asset.resources.images[0].height, 4);
  assert.equal(asset.resources.images[0].estimatedDecodedRgba8Bytes, 32);
  assert.equal(asset.resources.images[0].estimatedMipmappedRgba8Bytes, 44);
  assert.equal(asset.imageTotals.estimatedMipmappedRgba8Bytes, 88);

  assert.equal(asset.animations[0].durationSeconds, 2);
  assert.equal(asset.animations[0].keyframes, 2);
  assert.deepEqual(asset.reachability.unreachableFromScenes.nodes, [1]);
  assert.deepEqual(asset.reachability.unreachableFromScenes.materials, [1]);
  assert.deepEqual(asset.reachability.unreachableFromScenes.textures, [1]);
  assert.deepEqual(asset.reachability.unreachableFromScenes.images, [1]);
  assert.equal(asset.duplicates.materials.length, 1);
  assert.equal(asset.duplicates.textures.length, 1);
  assert.equal(asset.duplicates.images.length, 1);
  assert.deepEqual(asset.extensions.used, ['KHR_texture_transform']);
});

test('audit output is deterministic for the same bytes and display path', () => {
  const buffer = fixtureGlb();
  const first = auditGlbBuffer(buffer, { displayPath: 'Assets/test.glb' });
  const second = auditGlbBuffer(buffer, { displayPath: 'Assets/test.glb' });
  assert.equal(stableStringify(first), stableStringify(second));
});

test('CSV export contains the deterministic per-asset summary fields', () => {
  const asset = auditGlbBuffer(fixtureGlb(), { displayPath: 'vendor/models/test.glb' });
  const csv = reportCsv({ assets: [asset] });
  assert.match(csv, /^file,classification,scope,bytes,sha256,triangles,/u);
  assert.match(csv, /vendor\/models\/test\.glb,runtime,runtime:root,/u);
  assert.match(csv, /KHR_texture_transform/u);
  assert.equal(csv.split('\n').filter(Boolean).length, 2);
});

test('mip estimate reaches 1x1 and malformed declared lengths are rejected', () => {
  assert.equal(mipmappedRgba8Bytes(2, 4), 44);
  const malformed = fixtureGlb();
  malformed.writeUInt32LE(malformed.length - 4, 8);
  assert.throws(() => parseGlb(malformed), /declared length/u);
});
