// COURSE-GENERATED ARCHITECTURAL IDENTITY.
//
// These are bounded, wall- and ceiling-attached compositions, not loose prop
// scatter. They give each generated family a recognizable arrival moment while
// leaving the accepted retail circulation and checkout workspace untouched.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COUNTER, INTERIOR, SHELL } from '../../data/shopLayout.js';
import { makeSignTexture } from './materials.js';

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.86,
    metalness: options.metalness ?? 0,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: options.side ?? THREE.FrontSide,
  });
}

function addBox(root, name, dimensions, position, surface, rotationY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), surface);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addNorthSign(root, lines, x, y, w, h, palette, name) {
  const texture = makeSignTexture(lines, {
    w: 512,
    h: 224,
    field: palette.field,
    ink: palette.ink,
    accent: palette.accent,
    sizes: [39, 22],
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.84, side: THREE.DoubleSide }),
  );
  sign.name = name;
  sign.position.set(x, y, -INTERIOR.d / 2 + 0.028);
  root.add(sign);
  return sign;
}

function batchRepeatedGeometry(root) {
  const buckets = new Map();
  for (const child of [...root.children]) {
    if (!child.isMesh || Array.isArray(child.material) || !child.geometry) continue;
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(child);
  }
  let batchIndex = 0;
  for (const [surface, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix);
      return geometry;
    });
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const batch = new THREE.Mesh(merged, surface);
    batch.name = `GeneratedShopIdentityBatch${batchIndex++}`;
    batch.castShadow = true;
    batch.receiveShadow = true;
    for (const mesh of meshes) {
      root.remove(mesh);
      mesh.geometry.dispose();
    }
    root.add(batch);
  }
  return batchIndex;
}

function buildMunicipal(root, palette) {
  const fadedGreen = material(palette.accent, { roughness: 0.98 });
  const oldCream = material(palette.trim, { roughness: 0.96 });
  const steel = material(0x777b74, { roughness: 0.72, metalness: 0.18 });
  const tube = material(0xfff0cf, { emissive: 0xffe3ad, emissiveIntensity: 0.7 });

  addBox(root, 'MunicipalNorthPaintBand', [7.0, 0.66, 0.045], [-5.9, 1.36, -INTERIOR.d / 2 + 0.025], fadedGreen);
  addBox(root, 'MunicipalPaintBandCap', [7.0, 0.055, 0.075], [-5.9, 1.70, -INTERIOR.d / 2 + 0.05], oldCream);
  addNorthSign(root, ['MUNICIPAL GOLF', 'PRO SHOP'], -4.8, 2.25, 2.25, 0.82, {
    field: '#d8d1bd', ink: '#344638', accent: '#8e8a72',
  }, 'MunicipalIdentitySign');

  for (const [index, x] of [-7.3, -3.9, -0.5].entries()) {
    addBox(root, `MunicipalTrofferFrame${index}`, [1.75, 0.055, 0.42], [x, SHELL.h - 0.035, -0.55], steel);
    addBox(root, `MunicipalTrofferTube${index}`, [1.52, 0.018, 0.22], [x, SHELL.h - 0.072, -0.55], tube);
  }
}

function buildPublicRetail(root, palette) {
  const oak = material(palette.wood, { roughness: 0.84 });
  const sage = material(palette.accent, { roughness: 0.94 });
  const cream = material(palette.trim, { roughness: 0.9 });
  const northZ = -INTERIOR.d / 2 + 0.035;

  addBox(root, 'PublicRetailNorthField', [10.8, 1.82, 0.045], [-4.45, 1.55, northZ], cream);
  for (const [index, x] of [-8.6, -5.85, -3.1, -0.35].entries()) {
    addBox(root, `PublicRetailBay${index}`, [2.36, 1.33, 0.055], [x, 1.48, northZ + 0.035], sage);
    addBox(root, `PublicRetailBayTop${index}`, [2.5, 0.10, 0.09], [x, 2.2, northZ + 0.07], oak);
    for (const side of [-1, 1]) {
      addBox(root, `PublicRetailBayStile${index}-${side}`, [0.09, 1.55, 0.09], [x + side * 1.22, 1.43, northZ + 0.07], oak);
    }
  }
  addNorthSign(root, ['PUBLIC COURSE', 'GOLF & GOODS'], 2.7, 2.22, 2.2, 0.78, {
    field: '#eee7d8', ink: '#31513d', accent: '#b18b5b',
  }, 'PublicRetailIdentitySign');
}

function buildLodge(root, palette) {
  const timber = material(palette.wood, { roughness: 0.88 });
  const timberDark = material(palette.wood, { roughness: 0.95 });
  timberDark.color.offsetHSL(0, 0, -0.14);
  const stoneA = material(0x807565, { roughness: 1 });
  const stoneB = material(0x9c8c75, { roughness: 1 });
  const fire = material(0x30180f, { emissive: 0xff8d35, emissiveIntensity: 0.42 });
  const northZ = -INTERIOR.d / 2 + 0.05;

  // A repeated timber frame makes the full retail hall read as one lodge room.
  for (const [index, x] of [-8.4, -4.2, 0.0].entries()) {
    addBox(root, `LodgeWallPost${index}`, [0.24, 2.85, 0.22], [x, 1.43, northZ + 0.08], timberDark);
    addBox(root, `LodgeCeilingTie${index}`, [0.24, 0.20, 3.4], [x, SHELL.h - 0.13, -4.82], timberDark);
  }
  addBox(root, 'LodgeNorthLintel', [9.0, 0.24, 0.22], [-4.2, 2.83, northZ + 0.08], timberDark);

  // The lounge hearth is wall-attached and shallow, preserving its seating route.
  addBox(root, 'LodgeHearthBacking', [3.0, 2.45, 0.12], [3.85, 1.25, northZ + 0.04], stoneA);
  addBox(root, 'LodgeFirebox', [1.28, 0.92, 0.075], [3.85, 0.72, northZ + 0.12], fire);
  for (const [index, spec] of [
    [-1.02, 0.42, 0.78], [1.02, 0.42, 0.78], [-1.03, 1.22, 0.76], [1.03, 1.22, 0.76],
    [-0.68, 1.82, 0.61], [0.0, 1.86, 0.69], [0.7, 1.82, 0.62],
  ].entries()) {
    const [dx, y, h] = spec;
    addBox(root, `LodgeHearthStone${index}`, [0.58, h, 0.16], [3.85 + dx, y, northZ + 0.12], index % 2 ? stoneA : stoneB);
  }
  addBox(root, 'LodgeMantel', [3.28, 0.18, 0.34], [3.85, 2.18, northZ + 0.20], timber);

  // A second, shallower stone focal face turns toward the entry camera. The
  // accepted north-wall hearth still anchors the member lounge, while this
  // chimney breast makes the lodge identity legible from normal arrival.
  const westX = -INTERIOR.w / 2 + 0.055;
  addBox(root, 'LodgeEntryStoneField', [2.35, 2.15, 0.08], [westX, 1.28, 2.0], stoneA, Math.PI / 2);
  addBox(root, 'LodgeEntryFirebox', [0.92, 0.72, 0.07], [westX + 0.055, 0.73, 2.0], fire, Math.PI / 2);
  addBox(root, 'LodgeEntryMantel', [2.65, 0.16, 0.28], [westX + 0.15, 1.82, 2.0], timber, Math.PI / 2);
  addNorthSign(root, ['WOODLAND LODGE', 'PRO SHOP'], -4.2, 2.24, 2.6, 0.78, {
    field: '#d9cdb6', ink: '#294535', accent: '#745037',
  }, 'LodgeIdentitySign');
}

function buildResort(root, palette) {
  const field = material(palette.accent, { roughness: 0.9 });
  const limestone = material(palette.trim, { roughness: 0.82 });
  const brass = material(0xb18a49, { roughness: 0.38, metalness: 0.42 });
  const northZ = -INTERIOR.d / 2 + 0.045;

  for (const [index, x] of [-8.3, -5.35, -2.4, 0.55, 3.5].entries()) {
    addBox(root, `ResortGalleryField${index}`, [2.5, 1.78, 0.055], [x, 1.42, northZ], field);
    for (const side of [-1, 1]) {
      addBox(root, `ResortGalleryPier${index}-${side}`, [0.12, 2.2, 0.13], [x + side * 1.25, 1.34, northZ + 0.06], limestone);
    }
    addBox(root, `ResortGalleryHeader${index}`, [2.62, 0.14, 0.13], [x, 2.46, northZ + 0.06], limestone);
    addBox(root, `ResortGalleryCanopy${index}`, [2.45, 0.09, 0.36], [x, 2.40, northZ + 0.20], limestone);
    addBox(root, `ResortGalleryReveal${index}`, [1.35, 0.035, 0.09], [x, 2.17, northZ + 0.09], brass);
  }
  addBox(root, 'ResortGalleryCornice', [15.0, 0.12, 0.16], [-2.45, 2.78, northZ + 0.07], limestone);
  addNorthSign(root, ['DESTINATION GOLF', 'RESORT PRO SHOP'], 3.5, 1.43, 2.05, 0.72, {
    field: '#efe6d6', ink: '#395442', accent: '#b18a49',
  }, 'ResortIdentitySign');
}

function buildBoutique(root, palette) {
  const walnut = material(palette.wood, { roughness: 0.78 });
  const cream = material(palette.trim, { roughness: 0.88 });
  const green = material(palette.accent, { roughness: 0.86 });
  const brass = material(0xba9554, { roughness: 0.3, metalness: 0.5 });
  const glow = material(0xffedcb, { emissive: 0xffd49a, emissiveIntensity: 0.8 });
  const northZ = -INTERIOR.d / 2 + 0.045;

  addBox(root, 'BoutiqueNorthSalonField', [15.0, 2.35, 0.045], [-2.45, 1.48, northZ], cream);
  for (const [index, x] of [-8.3, -5.35, -2.4, 0.55, 3.5].entries()) {
    addBox(root, `BoutiquePanelInset${index}`, [1.78, 1.08, 0.045], [x, 1.46, northZ + 0.035], green);
    for (const side of [-1, 1]) {
      addBox(root, `BoutiquePanelStile${index}-${side}`, [0.065, 1.75, 0.075], [x + side * 1.18, 1.46, northZ + 0.07], walnut);
    }
    for (const y of [0.58, 2.34]) {
      addBox(root, `BoutiquePanelRail${index}-${y}`, [2.42, 0.065, 0.075], [x, y, northZ + 0.07], walnut);
    }
    addBox(root, `BoutiquePictureArm${index}`, [0.48, 0.045, 0.07], [x, 2.62, northZ + 0.19], brass);
    addBox(root, `BoutiquePictureGlow${index}`, [0.42, 0.028, 0.09], [x, 2.59, northZ + 0.22], glow);
  }
  addBox(root, 'BoutiqueBrassCornice', [15.1, 0.055, 0.11], [-2.45, 2.72, northZ + 0.09], brass);
  addNorthSign(root, ['PRIVATE CLUB', 'GOLF BOUTIQUE'], 0.55, 1.46, 1.92, 0.68, {
    field: '#f0e7d8', ink: '#203f31', accent: '#ba9554',
  }, 'BoutiqueIdentitySign');

  // Tailored panels continue around the west wall so the entry camera sees a
  // salon envelope rather than a decorated version of the public shop.
  for (const [index, z] of [-4.4, -1.65, 1.1].entries()) {
    const panel = addBox(root, `BoutiqueWestPanel${index}`, [1.72, 1.08, 0.045], [-INTERIOR.w / 2 + 0.055, 1.48, z], green, Math.PI / 2);
    panel.castShadow = false;
  }
}

function buildCheckoutAndServiceIdentity(root, generation, palette) {
  const level = generation.courseLevel;
  const frontZ = COUNTER.z - COUNTER.depth / 2 - 0.082;
  const wood = material(palette.wood, { roughness: level >= 4 ? 0.72 : 0.9 });
  const woodDark = material(palette.wood, { roughness: 0.9 });
  woodDark.color.offsetHSL(0, 0, -0.14);
  const accent = material(palette.accent, { roughness: 0.86 });
  const cream = material(palette.trim, { roughness: 0.9 });
  const brass = material(0xb38d4f, { roughness: 0.32, metalness: 0.45 });
  const steel = material(0x747b79, { roughness: 0.58, metalness: 0.2 });

  if (level === 1) {
    const oldLaminate = material(0x8a897e, { roughness: 0.97 });
    const fadedSage = material(0x6f786e, { roughness: 0.98 });
    const agedCream = material(0xaaa493, { roughness: 0.98 });
    const scuffedSteel = material(0x666c69, { roughness: 0.78, metalness: 0.14 });
    addBox(root, 'MunicipalCheckoutLaminate', [COUNTER.len - 0.18, 0.62, 0.035], [COUNTER.x, 0.52, frontZ], oldLaminate);
    for (const [index, x] of [COUNTER.x - 1.02, COUNTER.x, COUNTER.x + 1.02].entries()) {
      addBox(
        root,
        `MunicipalCheckoutPanel${index}`,
        [0.88, 0.42, 0.025],
        [x, 0.50, frontZ - 0.025],
        index === 1 ? agedCream : fadedSage,
      );
    }
    addBox(root, 'MunicipalCheckoutSteelEdge', [COUNTER.len - 0.08, 0.055, 0.06], [COUNTER.x, 0.84, frontZ - 0.025], scuffedSteel);
    addBox(root, 'MunicipalCheckoutWearStrip', [COUNTER.len - 0.34, 0.035, 0.025], [COUNTER.x, 0.245, frontZ - 0.055], scuffedSteel);
  } else if (level === 2) {
    addBox(root, 'PublicCheckoutOakFace', [COUNTER.len - 0.18, 0.62, 0.035], [COUNTER.x, 0.52, frontZ], wood);
    for (const x of [COUNTER.x - 0.98, COUNTER.x, COUNTER.x + 0.98]) {
      addBox(root, `PublicCheckoutPanel${x}`, [0.82, 0.42, 0.028], [x, 0.52, frontZ - 0.025], cream);
    }
  } else if (level === 3) {
    addBox(root, 'LodgeCheckoutTimberFace', [COUNTER.len - 0.12, 0.66, 0.055], [COUNTER.x, 0.52, frontZ], woodDark);
    for (const x of [COUNTER.x - 1.20, COUNTER.x + 1.20]) {
      addBox(root, `LodgeCheckoutPost${x}`, [0.17, 0.72, 0.09], [x, 0.52, frontZ - 0.035], wood);
    }
    addBox(root, 'LodgeCheckoutInset', [1.58, 0.34, 0.035], [COUNTER.x, 0.52, frontZ - 0.05], accent);
  } else if (level === 4) {
    addBox(root, 'ResortCheckoutStoneFace', [COUNTER.len - 0.10, 0.66, 0.055], [COUNTER.x, 0.52, frontZ], cream);
    for (const x of [COUNTER.x - 1.02, COUNTER.x, COUNTER.x + 1.02]) {
      addBox(root, `ResortCheckoutPanel${x}`, [0.84, 0.42, 0.035], [x, 0.51, frontZ - 0.05], accent);
    }
    addBox(root, 'ResortCheckoutBrassRail', [COUNTER.len - 0.04, 0.045, 0.07], [COUNTER.x, 0.84, frontZ - 0.045], brass);
  } else {
    addBox(root, 'BoutiqueCheckoutWalnutFace', [COUNTER.len - 0.08, 0.68, 0.06], [COUNTER.x, 0.52, frontZ], woodDark);
    for (let index = 0; index < 17; index++) {
      const x = COUNTER.x - 1.42 + index * 0.1775;
      addBox(root, `BoutiqueCheckoutFlute${index}`, [0.042, 0.58, 0.035], [x, 0.52, frontZ - 0.055], wood);
    }
    addBox(root, 'BoutiqueCheckoutBrassRail', [COUNTER.len, 0.045, 0.075], [COUNTER.x, 0.86, frontZ - 0.05], brass);
  }

  // Keep the accepted scanner, drawer, card terminal, cash handoff and player
  // stand fixed, but make the generated checkout plan physically legible. The
  // selected service side gets its own inset/bag return and each queue family
  // receives a different floor path and set of compact brass wayfinding posts.
  const serviceSign = generation.checkout.serviceSide === 'left-bagging' ? -1 : 1;
  const serviceX = COUNTER.x + serviceSign * (COUNTER.len / 2 - 0.43);
  addBox(
    root,
    `GeneratedCheckoutServiceReturn-${generation.checkout.serviceSide}`,
    [0.68, 0.54, 0.055],
    [serviceX, 0.54, frontZ - 0.065],
    level >= 4 ? brass : accent,
  );
  addBox(
    root,
    'GeneratedCheckoutServiceMarker',
    [0.44, 0.05, 0.075],
    [serviceX, 0.87, frontZ - 0.08],
    level === 1 ? steel : brass,
  );

  const queuePaths = {
    straight: [
      { x: COUNTER.queueBase.x, z: COUNTER.queueBase.z },
      { x: 1.35, z: 2.55 },
      { x: 0.30, z: 1.95 },
    ],
    'soft-angle': [
      { x: COUNTER.queueBase.x, z: COUNTER.queueBase.z },
      { x: 1.55, z: 2.45 },
      { x: 1.10, z: 1.35 },
      { x: 0.15, z: 0.75 },
    ],
    'short-serpentine': [
      { x: COUNTER.queueBase.x, z: COUNTER.queueBase.z },
      { x: 1.30, z: 2.65 },
      { x: 0.75, z: 1.75 },
      { x: 1.55, z: 1.05 },
      { x: 0.45, z: 0.35 },
    ],
  };
  const queue = queuePaths[generation.checkout.queueShape] || queuePaths.straight;
  for (let index = 0; index < queue.length - 1; index++) {
    const from = queue[index];
    const to = queue[index + 1];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    addBox(
      root,
      `GeneratedQueueInlay-${generation.checkout.queueShape}-${index}`,
      [0.055, 0.012, length],
      [(from.x + to.x) / 2, 0.018, (from.z + to.z) / 2],
      level === 1 ? steel : brass,
      Math.atan2(dx, dz),
    );
  }
  for (const [index, point] of queue.slice(1).entries()) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.025, 14), level === 1 ? steel : brass);
    base.name = `GeneratedQueueMarker-${generation.checkout.queueShape}-${index}`;
    base.position.set(point.x, 0.026, point.z);
    root.add(base);
  }

  const checkoutLabel = generation.checkout.variant.replaceAll('-', ' ').toUpperCase();
  const checkoutTexture = makeSignTexture([checkoutLabel], {
    w: 640, h: 128, frame: false,
    field: level === 1 ? '#b8b1a0' : '#eee6d7',
    ink: '#274332', sizes: [30],
  });
  const checkoutPlaque = new THREE.Mesh(
    new THREE.PlaneGeometry(1.62, 0.26),
    new THREE.MeshStandardMaterial({ map: checkoutTexture, roughness: 0.86 }),
  );
  checkoutPlaque.name = 'GeneratedCheckoutVariantPlaque';
  checkoutPlaque.position.set(COUNTER.x, 0.54, frontZ - 0.085);
  checkoutPlaque.rotation.y = Math.PI;
  root.add(checkoutPlaque);

  // The opaque service partition stays physically unchanged. Its west face is
  // dressed per generated office family while the owned desk, chair, and their
  // attached laptop move independently inside the room.
  const officeServiceX = 5.56;
  const serviceZ = 4.12;
  // The office is open to the sales floor. Frame that real opening; never add
  // an uncollided wall where the player and laptop route already pass.
  const frameSurface = level >= 4 ? brass : level === 1 ? steel : wood;
  for (const z of [2.62, 5.62]) {
    addBox(root, `GeneratedOfficePartitionEdge${z}`, [0.09, 2.12, 0.08], [officeServiceX - 0.03, 1.48, z], frameSurface, Math.PI / 2);
  }
  addBox(root, 'GeneratedOfficePartitionHeader', [3.08, 0.13, 0.10], [officeServiceX - 0.03, 2.49, serviceZ], frameSurface, Math.PI / 2);

  const officeLabel = generation.rooms.office.variant.replaceAll('-', ' ').toUpperCase();
  const texture = makeSignTexture([officeLabel, 'OFFICE'], {
    w: 512,
    h: 192,
    field: level === 1 ? '#d6d0c0' : '#eee6d7',
    ink: '#274332',
    accent: level >= 4 ? '#b38d4f' : '#7b664e',
    sizes: [28, 22],
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.65, 0.42),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.84, side: THREE.DoubleSide }),
  );
  sign.name = 'GeneratedOfficeVariantSign';
  sign.position.set(officeServiceX - 0.085, 2.43, serviceZ);
  sign.rotation.y = -Math.PI / 2;
  root.add(sign);
}

export function buildShopGenerationVisuals(B) {
  const generation = B.state?.shop?.generation;
  const root = new THREE.Group();
  root.name = 'GeneratedShopIdentity';
  B.interior.add(root);
  if (!generation) return { root, diagnostics: () => ({ active: false }) };

  const palette = generation.palette;
  if (generation.courseLevel === 1) buildMunicipal(root, palette);
  else if (generation.courseLevel === 2) buildPublicRetail(root, palette);
  else if (generation.courseLevel === 3) buildLodge(root, palette);
  else if (generation.courseLevel === 4) buildResort(root, palette);
  else buildBoutique(root, palette);
  buildCheckoutAndServiceIdentity(root, generation, palette);
  root.userData.batchCount = batchRepeatedGeometry(root);

  root.userData.courseLevel = generation.courseLevel;
  root.userData.profileId = generation.profileId;
  root.userData.layoutFamily = generation.layoutFamily;
  return {
    root,
    diagnostics: () => ({
      active: true,
      courseLevel: root.userData.courseLevel,
      profileId: root.userData.profileId,
      layoutFamily: root.userData.layoutFamily,
      nodeCount: root.children.length,
      batchCount: root.userData.batchCount,
    }),
  };
}
