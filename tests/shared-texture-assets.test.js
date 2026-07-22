import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  CLUBHOUSE_SHARED_TEXTURE_FAMILIES,
} from '../src/render3d/clubhouse/sharedTexturePool.js';

const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;

function filesBelow(root, suffix) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(file);
    }
  };
  visit(root);
  return files.sort();
}

function glbChunks(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${file}: glTF magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${file}: glTF version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${file}: byte length`);
  let json = null;
  let binary = null;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === GLB_JSON) json = JSON.parse(chunk.toString('utf8').trimEnd());
    if (type === GLB_BIN) binary = chunk;
    offset += 8 + length;
  }
  assert.ok(json, `${file}: JSON chunk`);
  return { json, binary };
}

function embeddedImageBytes(file, parsed, image) {
  if (Number.isInteger(image.bufferView)) {
    const view = parsed.json.bufferViews?.[image.bufferView];
    assert.ok(view, `${file}: image bufferView ${image.bufferView}`);
    assert.equal(view.buffer || 0, 0, `${file}: embedded image buffer`);
    assert.ok(parsed.binary, `${file}: binary chunk`);
    const start = view.byteOffset || 0;
    return parsed.binary.subarray(start, start + view.byteLength);
  }
  if (image.uri?.startsWith('data:')) {
    const comma = image.uri.indexOf(',');
    assert.ok(comma >= 0, `${file}: image data URI`);
    return Buffer.from(image.uri.slice(comma + 1), image.uri.includes(';base64,') ? 'base64' : 'utf8');
  }
  assert.ok(image.uri, `${file}: image source`);
  return fs.readFileSync(path.resolve(path.dirname(file), decodeURIComponent(image.uri)));
}

test('every mapped clubhouse texture family remains byte-identical across runtime GLBs', () => {
  const hashesByFamily = new Map();
  const roots = ['vendor/models/clubhouse', 'vendor/models/checkout'];
  for (const root of roots) {
    for (const file of filesBelow(root, '.glb')) {
      const parsed = glbChunks(file);
      for (const image of parsed.json.images || []) {
        const family = CLUBHOUSE_SHARED_TEXTURE_FAMILIES[image.name];
        if (!family) continue;
        const hash = crypto.createHash('sha256')
          .update(embeddedImageBytes(file, parsed, image))
          .digest('hex');
        if (!hashesByFamily.has(family)) hashesByFamily.set(family, new Set());
        hashesByFamily.get(family).add(hash);
      }
    }
  }

  const declaredFamilies = new Set(Object.values(CLUBHOUSE_SHARED_TEXTURE_FAMILIES));
  assert.deepEqual(new Set(hashesByFamily.keys()), declaredFamilies,
    'every declared shared family must be backed by a runtime image');
  for (const [family, hashes] of hashesByFamily) {
    assert.equal(hashes.size, 1, `${family} must contain one byte-identical image payload`);
  }
});
