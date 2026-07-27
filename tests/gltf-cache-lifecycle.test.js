import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { disposeSceneResources } from '../src/render3d/disposeSceneResources.js';
import { CachedGLTFLoader, clearGltfCache } from '../src/render3d/gltfCache.js';

const load = (loader, url) => new Promise((resolve, reject) => {
  loader.load(url, resolve, undefined, reject);
});

test('full-scene cache invalidation replaces a disposed GLTF ImageBitmap source', async () => {
  const originalLoad = GLTFLoader.prototype.load;
  const sources = [];
  let underlyingLoads = 0;
  clearGltfCache();
  GLTFLoader.prototype.load = function stubLoad(_url, onLoad) {
    underlyingLoads += 1;
    const image = {
      width: 4,
      height: 4,
      closes: 0,
      close() {
        this.closes += 1;
        this.width = 0;
        this.height = 0;
      },
    };
    const texture = new THREE.Texture(image);
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry, material));
    sources.push({ scene, geometry, material, texture, image });
    onLoad({ scene, scenes: [scene], animations: [] });
    return this;
  };

  try {
    const loader = new CachedGLTFLoader();
    const first = await load(loader, '/fixture.glb');
    const cached = await load(loader, '/fixture.glb');
    const firstMesh = first.scene.children[0];
    const cachedMesh = cached.scene.children[0];
    assert.equal(underlyingLoads, 1);
    assert.equal(cachedMesh.geometry, firstMesh.geometry,
      'same-scene clones intentionally share immutable parsed geometry');
    assert.equal(cachedMesh.material, firstMesh.material,
      'same-scene clones intentionally share immutable parsed materials');
    assert.equal(cachedMesh.material.map.image, firstMesh.material.map.image,
      'same-scene clones intentionally share the decoded image source');

    disposeSceneResources(first.scene);
    assert.equal(sources[0].image.closes, 1);
    assert.equal(sources[0].image.width, 0);
    clearGltfCache();

    const nextScene = await load(loader, '/fixture.glb');
    const nextImage = nextScene.scene.children[0].material.map.image;
    assert.equal(underlyingLoads, 2, 'a new scene reparses after the teardown boundary');
    assert.notEqual(nextImage, sources[0].image);
    assert.equal(nextImage.closes, 0);
    assert.equal(nextImage.width, 4);
    assert.equal(nextImage.height, 4);
    disposeSceneResources(nextScene.scene);
  } finally {
    GLTFLoader.prototype.load = originalLoad;
    clearGltfCache();
  }
});
