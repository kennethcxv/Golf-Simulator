import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

import { createSharedTexturePool } from '../src/render3d/clubhouse/sharedTexturePool.js';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';

function texturedRoot(name, image, configure = () => {}) {
  const texture = new THREE.Texture(image);
  texture.name = name;
  configure(texture);
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  return { root, texture, material, geometry };
}

test('shared texture pool interns byte-audited aliases and releases the superseded decode', () => {
  let canonicalCloses = 0;
  let duplicateCloses = 0;
  const canonicalImage = { width: 1024, height: 512, close: () => { canonicalCloses += 1; } };
  const duplicateImage = { width: 1024, height: 512, close: () => { duplicateCloses += 1; } };
  const first = texturedRoot('KitWalnut', canonicalImage);
  const second = texturedRoot('WalnutGrain', duplicateImage);
  let duplicateDisposals = 0;
  second.texture.addEventListener('dispose', () => { duplicateDisposals += 1; });

  const pool = createSharedTexturePool();
  assert.deepEqual(pool.intern(first.root), {
    replacements: 0, releasedTextures: 0, closedImages: 0, incompatible: 0,
  });
  assert.deepEqual(pool.intern(second.root), {
    replacements: 1, releasedTextures: 1, closedImages: 1, incompatible: 0,
  });
  assert.equal(second.material.map, first.texture);
  assert.equal(duplicateDisposals, 1);
  assert.equal(duplicateCloses, 1);
  assert.equal(canonicalCloses, 0);
  assert.deepEqual(pool.stats(), {
    families: 1, replacements: 1, releasedTextures: 1, closedImages: 1, incompatible: 0,
  });

  first.geometry.dispose();
  second.geometry.dispose();
  first.material.dispose();
  second.material.dispose();
  first.texture.dispose();
});

test('shared texture pool refuses an incompatible sampler or color-space descriptor', () => {
  const first = texturedRoot('CharcoalPlastic', { width: 512, height: 512 });
  const second = texturedRoot('CharcoalPlastic', { width: 512, height: 512 }, (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
  });
  let duplicateDisposals = 0;
  second.texture.addEventListener('dispose', () => { duplicateDisposals += 1; });

  const pool = createSharedTexturePool();
  pool.intern(first.root);
  assert.deepEqual(pool.intern(second.root), {
    replacements: 0, releasedTextures: 0, closedImages: 0, incompatible: 1,
  });
  assert.equal(second.material.map, second.texture);
  assert.equal(duplicateDisposals, 0);

  for (const entry of [first, second]) {
    entry.geometry.dispose();
    entry.material.dispose();
    entry.texture.dispose();
  }
});

test('shared texture pool never closes a backing image still used by the canonical texture', () => {
  let closes = 0;
  const sharedImage = { width: 256, height: 256, close: () => { closes += 1; } };
  const first = texturedRoot('RetailCrestBadge', sharedImage);
  const second = texturedRoot('RetailCrestBadge', sharedImage);
  let duplicateDisposals = 0;
  second.texture.addEventListener('dispose', () => { duplicateDisposals += 1; });

  const pool = createSharedTexturePool();
  pool.intern(first.root);
  const result = pool.intern(second.root);
  assert.equal(result.releasedTextures, 1);
  assert.equal(result.closedImages, 0);
  assert.equal(second.material.map, first.texture);
  assert.equal(duplicateDisposals, 1);
  assert.equal(closes, 0);

  first.geometry.dispose();
  second.geometry.dispose();
  first.material.dispose();
  second.material.dispose();
  first.texture.dispose();
});

test('vendored GLTF loader exposes one opt-in cache across parser instances', () => {
  const cache = new Map();
  const keyForSource = (source) => source?.name || null;
  const loader = new GLTFLoader();

  assert.equal(loader.setSharedImageCache(cache, keyForSource), loader);
  assert.equal(loader.sharedImageCache, cache);
  assert.equal(loader.sharedImageCacheKey, keyForSource);

  const source = fs.readFileSync('vendor/addons/loaders/GLTFLoader.js', 'utf8');
  assert.match(source, /sharedImageCache:\s*this\.sharedImageCache/);
  assert.match(source, /options\.sharedImageCache\?\.has\( sharedImageKey \)/);
  assert.match(source, /options\.sharedImageCache\.set\( sharedImageKey, promise \)/);
  assert.match(source, /URL\.revokeObjectURL\( sourceURI \)/);
});
