import { closeTextureImages } from './resourceLifecycle.js';

// The asset audit proves that these embedded images are byte-identical across
// GLBs. GLTFLoader otherwise creates and retains one Texture/ImageBitmap per
// file, multiplying both decoded CPU memory and GPU texture residency.
export const CLUBHOUSE_SHARED_TEXTURE_FAMILIES = Object.freeze({
  KitWalnut: 'walnut-grain',
  AsWalnut: 'walnut-grain',
  RkWalnut: 'walnut-grain',
  WalnutGrain: 'walnut-grain',
  CTWalnut: 'walnut-grain',
  MhWalnut: 'walnut-grain',
  CharcoalPlastic: 'charcoal-plastic',
  MatteBlackMetal: 'matte-black-metal',
  CounterBlack: 'counter-black',
  OakSlat: 'oak-slat',
  MidPlastic: 'mid-plastic',
  Gunmetal: 'gunmetal',
  RetailCrestHeader: 'retail-crest-header',
  RetailCrestBadge: 'retail-crest-badge',
  BrushedAlu: 'brushed-aluminium',
  GreenLeather: 'green-leather',
  ReceiptPaper: 'receipt-paper',
  Slatwall: 'slatwall',
  BagBrownR: 'bag-roughness',
  BagBlackR: 'bag-roughness',
  BagGreenR: 'bag-roughness',
  BagCreamR: 'bag-roughness',
});

function vectorSignature(value) {
  return value ? [value.x, value.y] : null;
}

// Matching the embedded image is not enough: a shared Texture must also have
// the same sampler, color-space, channel, and UV transform semantics.
export function sharedTextureSignature(texture) {
  const image = texture?.source?.data || texture?.image;
  return JSON.stringify({
    width: image?.width ?? null,
    height: image?.height ?? null,
    mapping: texture?.mapping ?? null,
    channel: texture?.channel ?? null,
    wrapS: texture?.wrapS ?? null,
    wrapT: texture?.wrapT ?? null,
    magFilter: texture?.magFilter ?? null,
    minFilter: texture?.minFilter ?? null,
    anisotropy: texture?.anisotropy ?? null,
    format: texture?.format ?? null,
    internalFormat: texture?.internalFormat ?? null,
    type: texture?.type ?? null,
    colorSpace: texture?.colorSpace ?? null,
    flipY: texture?.flipY ?? null,
    premultiplyAlpha: texture?.premultiplyAlpha ?? null,
    unpackAlignment: texture?.unpackAlignment ?? null,
    generateMipmaps: texture?.generateMipmaps ?? null,
    matrixAutoUpdate: texture?.matrixAutoUpdate ?? null,
    offset: vectorSignature(texture?.offset),
    repeat: vectorSignature(texture?.repeat),
    center: vectorSignature(texture?.center),
    rotation: texture?.rotation ?? null,
  });
}

function imageValues(texture) {
  return new Set([texture?.source?.data, texture?.image].filter(Boolean));
}

export function createSharedTexturePool({
  familyByName = CLUBHOUSE_SHARED_TEXTURE_FAMILIES,
  closeImages = closeTextureImages,
} = {}) {
  const canonicalByFamily = new Map();
  let replacements = 0;
  let releasedTextures = 0;
  let closedImages = 0;
  let incompatible = 0;

  function intern(root) {
    if (!root || typeof root.traverse !== 'function') {
      return { replacements: 0, releasedTextures: 0, closedImages: 0, incompatible: 0 };
    }
    const retired = new Set();
    const before = { replacements, releasedTextures, closedImages, incompatible };

    root.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const [property, texture] of Object.entries(material)) {
          if (!texture?.isTexture) continue;
          const family = familyByName[texture.name];
          if (!family) continue;
          const canonical = canonicalByFamily.get(family);
          if (!canonical) {
            canonicalByFamily.set(family, texture);
            continue;
          }
          if (canonical === texture) continue;
          if (sharedTextureSignature(canonical) !== sharedTextureSignature(texture)) {
            incompatible += 1;
            continue;
          }
          material[property] = canonical;
          retired.add(texture);
          replacements += 1;
        }
      }
    });

    const protectedImages = new Set();
    for (const texture of canonicalByFamily.values()) {
      for (const image of imageValues(texture)) protectedImages.add(image);
    }
    for (const texture of retired) {
      const sharesCanonicalImage = [...imageValues(texture)].some((image) => protectedImages.has(image));
      if (!sharesCanonicalImage) closedImages += closeImages(texture);
      texture.dispose();
      releasedTextures += 1;
    }

    return {
      replacements: replacements - before.replacements,
      releasedTextures: releasedTextures - before.releasedTextures,
      closedImages: closedImages - before.closedImages,
      incompatible: incompatible - before.incompatible,
    };
  }

  return Object.freeze({
    intern,
    clear: () => canonicalByFamily.clear(),
    stats: () => Object.freeze({
      families: canonicalByFamily.size,
      replacements,
      releasedTextures,
      closedImages,
      incompatible,
    }),
  });
}
