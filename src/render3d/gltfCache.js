import { DefaultLoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
  }

  load(url, onLoad, onProgress, onError) {
    let promise = parsed.get(url);
    const cached = Boolean(promise);
    if (!promise) {
      promise = new Promise((resolve, reject) => {
        super.load(url, resolve, onProgress, reject);
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
}
