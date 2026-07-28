import { DefaultLoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getKTX2Loader } from './ktx2Support.js';
import { internTextures, clearSharedTexturePool } from './sharedTexturePool.js';

// Parsed GLBs are immutable prototypes shared by every property-scene rebuild.
// A load receives a fresh Object3D hierarchy while geometry, materials and
// decoded textures remain stable. This avoids reparsing dozens of identical
// embedded textures—and creating short-lived blob URLs—on every save/load.
const parsed = new Map();

function cloneGltf(source) {
  const scene = source.scene.clone(true);
  const scenes = (source.scenes || [source.scene]).map((entry) => (
    entry === source.scene ? scene : entry.clone(true)
  ));
  return { ...source, scene, scenes, animations: [...(source.animations || [])] };
}

export class CachedGLTFLoader extends GLTFLoader {
  constructor(manager = DefaultLoadingManager) {
    super(manager);
    // Normally null — KTX2 is rejected (TEXTURE_MEMORY_POLICY.md §3) and no shipped
    // GLB carries KHR_texture_basisu. Leaving it detached is deliberate: GLTFLoader
    // then throws a legible error at parse time if a compressed asset ever appears,
    // rather than failing inside a transcoder worker.
    const ktx2 = getKTX2Loader();
    if (ktx2) this.setKTX2Loader(ktx2);
  }

  load(url, onLoad, onProgress, onError) {
    let promise = parsed.get(url);
    const cached = Boolean(promise);
    if (!promise) {
      promise = new Promise((resolve, reject) => {
        super.load(url, (gltf) => {
          // Cross-file texture sharing, on the prototype rather than per clone.
          // Clones share material references, so interning once here reaches every
          // instance — and it runs before the scene is rendered, so a displaced
          // duplicate is never uploaded to the GPU in the first place.
          try {
            internTextures(gltf.scene);
          } catch (err) {
            // Sharing is an optimisation. A failure here must not cost the asset.
            console.warn('[gltfCache] texture interning failed for', url, err);
          }
          resolve(gltf);
        }, onProgress, reject);
      });
      parsed.set(url, promise);
      promise.catch(() => parsed.delete(url));
    }

    const virtualUrl = `gltf-cache:${url}`;
    if (cached) this.manager.itemStart(virtualUrl);
    promise.then(
      (gltf) => {
        try {
          onLoad?.(cloneGltf(gltf));
        } finally {
          if (cached) this.manager.itemEnd(virtualUrl);
        }
      },
      (error) => {
        if (cached) {
          this.manager.itemError(virtualUrl);
          this.manager.itemEnd(virtualUrl);
        }
        onError?.(error);
      },
    );
    return this;
  }
}

export function clearGltfCache() {
  parsed.clear();
  // The pool holds references into these parsed prototypes; dropping one without
  // the other would keep every pooled image alive with nothing using it.
  clearSharedTexturePool();
}
