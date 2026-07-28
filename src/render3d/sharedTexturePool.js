// One texture instance per (image, sampler state) across every GLB in the build.
//
// The problem. `CachedGLTFLoader` interns whole GLBs by URL, so loading the same
// file twice costs one parse. It does nothing across DIFFERENT files: twelve
// pro-shop assets sharing one walnut material family embed and upload twelve
// separate copies of that family's albedo, roughness and normal. The GPU sees
// twelve textures where there is one image.
//
// The fix. glTF preserves image names — Blender writes the datablock name into
// `images[i].name` and GLTFLoader copies it onto `texture.name` — so a texture's
// source identity survives the round trip and can be used as a pool key.
//
// The sampler state is part of the key, not an afterthought. In three.js the UV
// transform lives on the Texture, not the Material: `repeat`, `offset`,
// `rotation`, the wrap modes and `flipY` are all per-instance. Two assets that
// tile the same walnut at different scales genuinely need two instances, and
// collapsing them would silently retile one of the assets. Keying on the full
// sampler state means sharing happens exactly when it is safe, and the pass
// therefore standardises tile size per material family (see ART_BIBLE §7.3) —
// which is what makes the sharing pay off rather than merely being possible.
//
// Interning runs on the parsed prototype BEFORE the scene is ever rendered, so a
// displaced duplicate never reaches the GPU at all. Nothing has to be freed; the
// duplicate is simply never uploaded.
//
// What this is worth TODAY is small: 6.6 MB, 1.2 % of resident texture memory,
// measured by `tools/qa/proshop-texture-sharing-ab.js`. That is not a
// disappointment, it is the expected result — sheet_07 and sheet_08 currently
// embed no textures at all, so there is nothing yet for them to share. The lever
// exists because the twelve-file Tier 1 pass is about to give them three to seven
// shared material families each, and retrofitting sharing after those files ship
// means rebuilding all twelve.

const pool = new Map();

const stats = {
  interned: 0, // textures replaced by a pooled instance
  pooled: 0, // distinct instances the pool holds
  skippedUnnamed: 0, // textures with no usable identity — cannot be pooled safely
  // Size of the textures this module displaced. This is an UPPER BOUND on the
  // GPU saving, not the saving: a displaced texture that would never have been
  // uploaded — because its GLB was parsed but never instantiated, or because
  // CachedGLTFLoader had already deduped that URL — frees nothing. Measured on
  // the current build the counter over-reports by roughly 25x (166 MB displaced,
  // 6.6 MB actually saved). `tools/qa/proshop-texture-sharing-ab.js` loads the
  // same seed twice with interning off and on and compares what the renderer
  // ends up holding; that number is the authority, this one is diagnostics.
  displacedBytes: 0,
};

// Every material slot three.js can sample. `map` and `emissiveMap` are colour;
// the rest are data. Slot name is part of the key so a map used as both albedo
// and roughness somewhere never gets collapsed across colour spaces.
const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
  'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap', 'specularColorMap',
  'iridescenceMap', 'iridescenceThicknessMap', 'transmissionMap', 'thicknessMap',
  'anisotropyMap',
];

function samplerKey(texture, slot) {
  const image = texture.image;
  const w = image?.width || 0;
  const h = image?.height || 0;
  return [
    texture.name,
    slot,
    texture.colorSpace,
    `${w}x${h}`,
    texture.wrapS, texture.wrapT,
    texture.magFilter, texture.minFilter,
    texture.flipY ? 1 : 0,
    texture.generateMipmaps ? 1 : 0,
    texture.premultiplyAlpha ? 1 : 0,
    // Sampler state that three.js keeps on the Texture, not the Material.
    texture.repeat ? `${texture.repeat.x},${texture.repeat.y}` : '1,1',
    texture.offset ? `${texture.offset.x},${texture.offset.y}` : '0,0',
    texture.rotation || 0,
    texture.center ? `${texture.center.x},${texture.center.y}` : '0,0',
    texture.channel ?? 0,
    // A compressed texture and an uncompressed one with the same name are not
    // interchangeable — the internal format differs.
    texture.isCompressedTexture ? `c${texture.format}` : 'u',
  ].join('|');
}

function estimateBytes(texture) {
  const w = texture.image?.width || 0;
  const h = texture.image?.height || 0;
  if (!w || !h) return 0;
  const perTexel = texture.isCompressedTexture ? 1 : 4;
  return w * h * perTexel * (4 / 3); // + mip chain
}

/**
 * Replace every texture in `root` with the pool's canonical instance.
 *
 * Call once per newly parsed GLB, before the scene is added to anything. Returns
 * what it did so a caller — or a QA probe — can assert the sharing actually
 * happened rather than assuming it.
 */
export function internTextures(root) {
  if (!root) return { interned: 0, pooled: 0, skippedUnnamed: 0 };
  // Test seam. The saving this module claims is only credible if the same build
  // can be measured with it off, so `tools/qa/proshop-texture-sharing-ab.js` sets
  // this before the scene loads and compares the two runs.
  if (globalThis.__FW_DISABLE_TEXTURE_INTERNING) {
    return { interned: 0, pooled: 0, skippedUnnamed: 0, displacedBytes: 0, disabled: true };
  }
  const before = { ...stats };
  const seenMaterials = new Set();

  root.traverse((node) => {
    if (!node.isMesh && !node.isPoints && !node.isLine && !node.isSprite) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      // A cloned scene shares material references; interning one twice is wasted work.
      if (!material || seenMaterials.has(material.uuid)) continue;
      seenMaterials.add(material.uuid);

      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (!texture || !texture.isTexture) continue;

        // No name means no stable cross-file identity. Procedural and
        // canvas-generated textures land here, and pooling them on dimensions
        // alone would collapse genuinely different images.
        if (!texture.name) { stats.skippedUnnamed += 1; continue; }

        const key = samplerKey(texture, slot);
        const existing = pool.get(key);
        if (!existing) {
          pool.set(key, texture);
          stats.pooled += 1;
          continue;
        }
        if (existing === texture) continue;

        material[slot] = existing;
        material.needsUpdate = true;
        stats.interned += 1;
        stats.displacedBytes += estimateBytes(texture);
      }
    }
  });

  return {
    interned: stats.interned - before.interned,
    pooled: stats.pooled - before.pooled,
    skippedUnnamed: stats.skippedUnnamed - before.skippedUnnamed,
    displacedBytes: stats.displacedBytes - before.displacedBytes,
  };
}

export function sharedTextureDiagnostics() {
  const sizes = {};
  for (const texture of pool.values()) {
    const key = `${texture.image?.width || 0}x${texture.image?.height || 0}`;
    sizes[key] = (sizes[key] || 0) + 1;
  }
  return {
    ...stats,
    estMBDisplaced: +(stats.displacedBytes / 1048576).toFixed(2),
    poolSizeHistogram: sizes,
  };
}

/**
 * Drop the pool. Paired with `clearGltfCache()` — the pool holds references into
 * parsed GLBs, so releasing one without the other keeps those images alive.
 */
export function clearSharedTexturePool() {
  pool.clear();
  stats.interned = 0;
  stats.pooled = 0;
  stats.skippedUnnamed = 0;
  stats.displacedBytes = 0;
}
