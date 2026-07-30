// DELIVERY BOX VISUALS
//
// A delivery carton is a persistent prop, not a frame-by-frame mesh effect. The
// Blender source owns its walls, hinge pivots, tape strips, content sockets and
// collision helpers. This module clones that authored hierarchy once, attaches
// the real catalog product proxies once, then only changes visibility/transforms
// as the simulation advances.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOX_KINDS } from '../../data/boxes.js';
import { productPackagingFor } from '../../data/productPackaging.js';
import {
  buildCatalogProductProxy,
  explicitCatalogProductVisual,
} from './catalogProductVisual.js';
import {
  authoredCutterPathSegment,
  authoredTapeMeshVisible,
  createAuthoredCutterPathContract,
} from './authoredCutterPath.js';
import { createOwnedStockResources } from './stockResources.js';

const GENERIC_CARTON_MODEL = 'delivery_generic_merchandise_box';
const STARTER_CARTON_ORDINAL = Object.freeze({
  'balls-accessories': 1,
  'apparel-headwear': 2,
  'drinks-snacks': 3,
});

// Retained as an exported authoring fact for validation of the merchandise hero.
// Every other family now owns its own exact-dimension Blender shell as well.
export const GENERIC_CARTON_SOURCE_DIMENSIONS = Object.freeze([0.60, 0.40, 0.40]);

function tuple(values) {
  return Object.freeze(values.map((value) => Number(value)));
}

function dimensionsForKind(kind) {
  const box = BOX_KINDS[kind];
  return box ? tuple([box.w, box.h, box.d]) : null;
}

function authoredCartonVisual(kind, model, shippingClass, { rearLabel = true } = {}) {
  return Object.freeze({
    model,
    modelScale: tuple([1, 1, 1]),
    targetDimensions: dimensionsForKind(kind),
    productScale: 1,
    productRotation: tuple([0, 0, 0]),
    layout: 'authored-contract',
    shippingClass,
    alternateProductYaw: false,
    rearLabel,
  });
}

const DELIVERY_BOX_VISUALS = Object.freeze({
  carton: authoredCartonVisual('carton', 'delivery_accessory_carton', 'ACCESSORIES'),
  ballcase: authoredCartonVisual('ballcase', 'delivery_golf_ball_case', 'GOLF BALLS'),
  apparel: authoredCartonVisual('apparel', 'delivery_apparel_box', 'APPAREL', { rearLabel: false }),
  merchbox: authoredCartonVisual('merchbox', GENERIC_CARTON_MODEL, 'MERCHANDISE'),
  shoebox: authoredCartonVisual('shoebox', 'delivery_shoe_carton', 'FOOTWEAR'),
  clubbox: authoredCartonVisual('clubbox', 'delivery_golf_club_box', 'GOLF CLUBS', { rearLabel: false }),
  bagcarton: authoredCartonVisual('bagcarton', 'delivery_golf_bag_carton', 'GOLF BAGS'),
  fixture: authoredCartonVisual('fixture', 'delivery_fixture_package', 'SHOP FIXTURE'),
  crate: authoredCartonVisual('crate', 'delivery_furniture_crate', 'FURNITURE FREIGHT'),
  provisions: authoredCartonVisual('provisions', 'delivery_bulk_provisions_carton', 'PROVISIONS'),
  umbrella: authoredCartonVisual('umbrella', 'delivery_umbrella_carton', 'UMBRELLAS'),
  ironset: authoredCartonVisual('ironset', 'delivery_iron_set_carton', 'IRON SETS'),
});

const missingDeliveryVisuals = Object.keys(BOX_KINDS)
  .filter((kind) => !Object.prototype.hasOwnProperty.call(DELIVERY_BOX_VISUALS, kind));
if (missingDeliveryVisuals.length) {
  throw new Error(`Missing authored delivery-box visual config: ${missingDeliveryVisuals.join(', ')}`);
}

export function deliveryBoxVisualConfig(kind) {
  const id = typeof kind === 'string' ? kind : (kind?.box || kind?.id);
  return DELIVERY_BOX_VISUALS[id] || null;
}

export function deliveryBoxModelScale(kind) {
  const visual = deliveryBoxVisualConfig(kind);
  return visual ? [...visual.modelScale] : null;
}

// Exact authored shells use identity scale. Retain the compensation API because
// old QA/save callers query it, and because it guards future non-uniform imports.
export function deliveryLabelScaleCompensation(kind) {
  const modelScale = deliveryBoxModelScale(kind);
  if (!modelScale) return null;
  const horizontal = Number(modelScale[0]);
  const vertical = Number(modelScale[1]);
  if (!(horizontal > 0) || !(vertical > 0)) return [1, 1, 1];
  return [1, horizontal / vertical, 1];
}

// Library cartons and the generic merchandise hero mount labels on +Y.
// From that side, screen-right runs opposite authored +X, so the otherwise
// conventional 0..1 U direction mirrors canvas text. Hero labels are mounted
// on their -Y front faces and keep the default transform.
export function deliveryLabelTextureTransform(kind) {
  const visual = deliveryBoxVisualConfig(kind);
  if (!visual) return null;
  return visual.rearLabel
    ? Object.freeze({ repeatX: -1, offsetX: 1 })
    : Object.freeze({ repeatX: 1, offsetX: 0 });
}

// A product is a child of an authored content socket. Applying this inverse
// scale on a wrapper immediately below the socket cancels the case's outer
// non-uniform scale before product rotation, so bags, shoes and freight proxies
// retain their authored proportions in world space.
export function deliveryProductScaleCompensation(kind) {
  const modelScale = deliveryBoxModelScale(kind);
  return modelScale
    ? modelScale.map((value) => 1 / value)
    : null;
}

export const DELIVERY_MODEL_BY_BOX_KIND = Object.freeze(Object.fromEntries(
  Object.entries(DELIVERY_BOX_VISUALS).map(([kind, visual]) => [kind, visual.model]),
));

export function deliveryContentContract(box) {
  if (!box || typeof box.skuId !== 'string') throw new TypeError('A delivery box with skuId is required');
  const contract = productPackagingFor(box.skuId);
  const expected = Object.freeze({
    familyId: contract.familyId,
    layoutId: contract.layoutId,
    shellId: contract.box.shellId,
    modelId: contract.box.modelId,
    packingState: contract.packing.state,
    packingOrientation: contract.packing.orientation,
    contentScale: 1,
    capacity: contract.unitsPerBox,
  });
  for (const key of ['familyId', 'layoutId', 'shellId', 'modelId', 'packingState', 'packingOrientation']) {
    if (box[key] != null && box[key] !== expected[key]) {
      throw new Error(`Delivery box ${box.id ?? '?'} has ${key}=${box[key]}; expected ${expected[key]}`);
    }
  }
  if (box.contentScale != null && Number(box.contentScale) !== 1) {
    throw new Error(`Delivery box ${box.id ?? '?'} contentScale must remain 1`);
  }
  const visual = deliveryBoxVisualConfig(box);
  if (!visual || visual.model !== expected.modelId) {
    throw new Error(`Delivery box ${box.id ?? '?'} kind/model contract does not match ${box.skuId}`);
  }
  return expected;
}

const FLAP_NAMES = Object.freeze([
  'BOX_FLAP_FRONT',
  'BOX_FLAP_BACK',
  'BOX_FLAP_LEFT',
  'BOX_FLAP_RIGHT',
]);

const WALL_NAMES = Object.freeze([
  'BOX_WALL_FRONT',
  'BOX_WALL_BACK',
  'BOX_WALL_LEFT',
  'BOX_WALL_RIGHT',
]);

const OPEN_ANGLE = Math.PI * 0.68;
const FLAT_ANGLE = Math.PI * 0.5;

export function smoothDeliveryProgress(value) {
  const t = Math.max(0, Math.min(1, Number(value) || 0));
  return t * t * (3 - 2 * t);
}

export function normalizedFourFlaps(flaps) {
  const source = Array.isArray(flaps) ? flaps : [];
  if (source.length >= 4) return source.slice(0, 4).map((value) => Math.max(0, Math.min(1, Number(value) || 0)));
  // Legacy cartons had two values, one per opening PHASE. FLAP_PHASES in
  // src/sim/deliveries.js is [[2, 3], [0, 1]], so the first value is LEFT+RIGHT (the wide
  // pair that meets in the middle) and the second is FRONT+BACK. Expanding in phase order
  // keeps an old save from visually resealing itself or reopening from the wrong pair;
  // interleaving as [a, b, a, b] was correct only while the phases paired adjacent flaps.
  const firstPhase = Math.max(0, Math.min(1, Number(source[0]) || 0));
  const secondPhase = Math.max(0, Math.min(1, Number(source[1]) || 0));
  return [secondPhase, secondPhase, firstPhase, firstPhase];
}

export function visibleContentsForBox(box, socketCount) {
  const count = Math.max(0, Math.floor(Number(socketCount) || 0));
  if (!count || !box || !(box.qty > 0)) return 0;
  const packed = Math.max(
    Number(box.initialQty) || 0,
    Number(box.packedQty) || 0,
    Number(box.originalQty) || 0,
    Number(box.cap) || 0,
    Number(box.qty) || 0,
    1,
  );
  const fullVisualCount = Math.min(count, Math.max(1, Math.ceil(packed)));
  return Math.max(1, Math.min(fullVisualCount, Math.ceil((Number(box.qty) / packed) * fullVisualCount)));
}

export function remainingTapeSegments(progress, count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const cut = Math.max(0, Math.min(1, Number(progress) || 0));
  return Math.max(0, total - Math.floor(cut * total + 1e-7));
}

export function deliveryPackingComponentRole(name, userData = null) {
  const normalized = String(name || '').toUpperCase();
  const metadata = userData && typeof userData === 'object' ? userData : {};
  if (metadata.persists_when_empty === true || metadata.permanent === true) return 'permanent';
  if (metadata.persists_when_empty === false || String(metadata.packing_role || '').trim()) return 'disposable';
  if (normalized.includes('INSERT') && normalized.includes('BOTTOM')) return 'permanent';
  if (normalized.includes('TISSUE') || normalized.includes('DIVIDER') || normalized.includes('INSERT')
    || normalized.includes('FOAM') || normalized.includes('SUPPORT')
    || normalized.includes('CORNER_BLOCK') || normalized.includes('CELL')
    || normalized.includes('TRAY') || normalized.includes('CORNER_PAD')
    || normalized.includes('END_PADDING') || normalized.includes('BASE_LINER')
    || normalized.includes('BASE_REINFORCEMENT')) {
    return 'disposable';
  }
  return null;
}

export function deliveryPackingComponentVisible(
  role,
  interiorRevealed,
  quantity,
  flattenProgress,
) {
  if (!interiorRevealed || Number(flattenProgress) >= 0.46) return false;
  if (role === 'permanent') return true;
  return role === 'disposable' && Number(quantity) > 0;
}

function nameSort(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function namedDescendants(root, predicate) {
  const result = [];
  root.traverse((object) => {
    if (predicate(String(object.name || '').toUpperCase(), object)) result.push(object);
  });
  return result.sort(nameSort);
}

export function selectDeliveryDynamicLabelMesh(root) {
  if (!root || typeof root.traverse !== 'function') return null;
  const exactDynamic = namedDescendants(
    root,
    (name, object) => object.isMesh && name === 'LABEL_DYNAMIC',
  )[0];
  if (exactDynamic) return exactDynamic;
  return namedDescendants(
    root,
    (name, object) => object.isMesh && name === 'LABEL_SHIPPING',
  )[0] || null;
}

export function applyDeliveryDynamicLabelMaterial(root, material) {
  const selected = selectDeliveryDynamicLabelMesh(root);
  if (!selected || !material) return selected;
  selected.material = material;
  if (String(selected.name || '').toUpperCase() === 'LABEL_DYNAMIC') {
    namedDescendants(
      root,
      (name, object) => object.isMesh && name === 'LABEL_SHIPPING',
    ).forEach((legacy) => { legacy.visible = false; });
  }
  return selected;
}

function rememberPose(object) {
  if (!object || object.userData.deliveryBasePose) return;
  object.userData.deliveryBasePose = {
    position: object.position.clone(),
    rotation: object.rotation.clone(),
    scale: object.scale.clone(),
  };
}

function restorePose(object) {
  const pose = object && object.userData.deliveryBasePose;
  if (!pose) return;
  object.position.copy(pose.position);
  object.rotation.copy(pose.rotation);
  object.scale.copy(pose.scale);
}

function findNamed(root, name) {
  return root.getObjectByName(name)
    || namedDescendants(root, (candidate) => candidate === name)[0]
    || null;
}

export function deliveryLabelCanvasCompensation(surfaceAspect) {
  const aspect = Number(surfaceAspect);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  return Object.freeze({
    surfaceAspect: safeAspect,
    logicalWidth: 320 * safeAspect,
    canvasScaleX: 1.6 / safeAspect,
  });
}

export function deliveryLabelSurfaceAspect(labelMesh) {
  if (!labelMesh?.isMesh || !labelMesh.geometry) return 1.6;
  const position = labelMesh.geometry.getAttribute('position');
  const uv = labelMesh.geometry.getAttribute('uv');
  if (!position || !uv || position.count < 3 || uv.count !== position.count) return 1.6;
  labelMesh.updateWorldMatrix(true, false);
  const entries = [];
  for (let index = 0; index < position.count; index += 1) {
    entries.push({
      u: uv.getX(index),
      v: uv.getY(index),
      point: new THREE.Vector3(
        position.getX(index), position.getY(index), position.getZ(index),
      ).applyMatrix4(labelMesh.matrixWorld),
    });
  }
  const corner = (u, v) => entries.reduce((best, entry) => {
    const score = Math.abs(entry.u - u) + Math.abs(entry.v - v);
    return !best || score < best.score ? { entry, score } : best;
  }, null)?.entry;
  const p00 = corner(0, 0)?.point;
  const p10 = corner(1, 0)?.point;
  const p01 = corner(0, 1)?.point;
  if (!p00 || !p10 || !p01) return 1.6;
  const width = p10.distanceTo(p00);
  const height = p01.distanceTo(p00);
  return width > 0 && height > 0 ? width / height : 1.6;
}

function drawShippingLabel(ctx, box, sku, shippingClass, surfaceAspect = 1.6) {
  const starterOrdinal = Math.max(0, Math.floor(
    Number(box.starterCartonOrdinal) || STARTER_CARTON_ORDINAL[box.starterCartonId] || 0,
  ));
  const starterCount = Math.max(starterOrdinal, Math.floor(Number(box.starterCartonCount) || 3));
  const starterCarton = starterOrdinal > 0;
  const supplier = String(starterCarton ? 'PINE HILLS CONVEYANCE' : (box.supplier || 'FAIRWAY SUPPLY')).toUpperCase();
  const order = String(box.orderId || 0).padStart(4, '0');
  const product = String(
    (starterCarton && box.assortmentLabel)
      || (sku && sku.name)
      || box.skuId
      || shippingClass
      || 'STOCK',
  ).toUpperCase();
  const weight = box.lb == null ? '' : `${box.lb} LB`;
  const layout = deliveryLabelCanvasCompensation(surfaceAspect);
  const width = layout.logicalWidth;
  const charScale = Math.max(1, width / 512);

  ctx.clearRect(0, 0, 512, 320);
  ctx.save();
  // The physical label quads intentionally vary from compact accessory labels
  // to the long club-care strip. Pre-compress the canvas X axis by the inverse
  // surface ratio so the mesh mapping restores square text pixels instead of
  // stretching one 1.60:1 design across every authored silhouette.
  ctx.setTransform(layout.canvasScaleX, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#f1ead8';
  ctx.fillRect(0, 0, width, 320);
  ctx.fillStyle = '#244b36';
  ctx.fillRect(0, 0, width, 54);
  ctx.strokeStyle = '#9c8054';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, width - 20, 300);
  ctx.fillStyle = '#f7f0dd';
  ctx.font = '700 31px Georgia, serif';
  const header = starterCarton
    ? `STARTER CARTON  ${starterOrdinal} / ${starterCount}`
    : `PRO SHOP  /  ${shippingClass || 'STOCK'}`;
  ctx.fillText(header.slice(0, Math.floor(30 * charScale)), 24, 38);
  ctx.fillStyle = '#29322d';
  ctx.font = '700 30px Arial, sans-serif';
  ctx.fillText(supplier.slice(0, Math.floor(28 * charScale)), 24, 93);
  ctx.font = '600 25px Arial, sans-serif';
  ctx.fillText(starterCarton ? 'CONVEYED OPENING STOCK' : `ORDER  ${order}`, 24, 132);
  ctx.fillText(product.slice(0, Math.floor(30 * charScale)), 24, 171);
  const shippedQty = box.initialQty ?? box.cap ?? box.qty ?? 0;
  ctx.fillText(`QTY  ${Math.max(0, shippedQty)}     ${weight}`, 24, 210);
  ctx.fillStyle = '#244b36';
  ctx.fillRect(24, 238, width - 48, 48);
  ctx.fillStyle = '#f7f0dd';
  ctx.font = '700 24px Arial, sans-serif';
  ctx.fillText(
    starterCarton
      ? `PINE HILLS  ·  ${starterOrdinal} OF ${starterCount}`
      : (box.fragile ? 'HANDLE WITH CARE' : 'PRO SHOP STOCK'),
    40,
    271,
  );
  ctx.restore();
}

function makeDynamicLabel(box, sku, resources, shippingClass, textureTransform, surfaceAspect) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawShippingLabel(ctx, box, sku, shippingClass, surfaceAspect);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Imported glTF UVs already use the texture orientation GLTFLoader expects.
  // CanvasTexture defaults to the opposite convention, which inverts labels.
  texture.flipY = false;
  texture.repeat.x = Number(textureTransform?.repeatX) || 1;
  texture.offset.x = Number(textureTransform?.offsetX) || 0;
  texture.anisotropy = 4;
  texture.userData.deliveryLabelSurfaceAspect = deliveryLabelCanvasCompensation(surfaceAspect).surfaceAspect;
  texture.userData.deliveryLabelCanvasScaleX = deliveryLabelCanvasCompensation(surfaceAspect).canvasScaleX;
  const material = resources.material(new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.88,
    metalness: 0,
  }));
  return {
    material,
    texture,
    signature: '',
    update(nextBox) {
      const shippedQty = nextBox.initialQty ?? nextBox.cap ?? nextBox.qty ?? 0;
      const next = [
        nextBox.supplier || '',
        nextBox.orderId || 0,
        shippedQty,
        nextBox.lb || '',
        nextBox.fragile ? 1 : 0,
        nextBox.starterCartonId || '',
        nextBox.starterCartonOrdinal || '',
        nextBox.starterCartonCount || '',
        nextBox.assortmentLabel || '',
      ].join('|');
      if (next === this.signature) return;
      this.signature = next;
      drawShippingLabel(ctx, nextBox, sku, shippingClass, surfaceAspect);
      texture.needsUpdate = true;
    },
    dispose() { texture.dispose(); },
  };
}

function metadataStringArray(value, label) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') throw new Error(`${label} must be a JSON string array`);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a JSON string array`);
  }
  return parsed;
}

function validateIdentityScale(object, label) {
  if (!object || [object.scale.x, object.scale.y, object.scale.z]
    .some((value) => Math.abs(Number(value) - 1) > 1e-6)) {
    throw new Error(`${label} must retain identity scale`);
  }
  if (Object.prototype.hasOwnProperty.call(object.userData || {}, 'allow_scale')
    && object.userData.allow_scale !== false) {
    throw new Error(`${label} must set allow_scale=false`);
  }
  if (Object.prototype.hasOwnProperty.call(object.userData || {}, 'content_scale')
    && Number(object.userData.content_scale) !== 1) {
    throw new Error(`${label} must set content_scale=1`);
  }
}

// The first exact box library predates the data contract's customer-facing
// packed-state wording. Keep its authored metadata explicit here so runtime
// validation can reject drift without rewriting or weakening those shipped GLBs.
const AUTHORED_PACKING_STATE_BY_LAYOUT = Object.freeze({
  ACCESSORY_CARD12: 'retail_card_or_small_carton',
  GLOVE8: 'flat_retail_sleeve',
  RANGE4: 'protective_retail_case',
  BALL12: 'retail_dozen_carton',
  CAP_NEST8: 'nested-crowns-with-tissue-form',
  APPAREL8: 'folded-with-tissue-and-size-tag',
  FLAT8: 'banded-folded-pair',
  SHOE4: 'retail_shoe_box',
  CLUB2: 'head-and-shaft-guarded',
  BAG1: 'protective_bag_with_foam_blocks',
  FIXTURE1: 'foam_blocked_fixture',
  FURNITURE1: 'flat_pack_timber_reinforced',
  DRINK12: 'sealed_bottle_case',
  SNACK12: 'sealed_snack_multipack',
  UMBRELLA6: 'sleeved_long_product',
  IRONSET1: 'bundled_set_with_head_and_shaft_supports',
});

// The carton GLBs predate these later catalog additions. Existing authored SKUs
// must remain in the embedded allowlist (so metadata damage still fails closed),
// while only this migration set may use the packaging-table compatibility path.
const MIGRATED_CATALOG_SKUS = new Set([
  'putter3', 'glove2', 'pants2', 'shorts1', 'cap2', 'visor1',
  'divot1', 'sunglasses2', 'bottle1', 'scorecard1', 'sportdrink2',
  'soda1', 'chips1', 'bar2', 'crackers1', 'bag3', 'shoe3',
  'repairkit1', 'chair1', 'laptop1', 'safetykit1',
  'desk1', 'counter1', 'shelfkit1',
]);

function isMigratedCatalogSku(skuId) {
  return MIGRATED_CATALOG_SKUS.has(skuId)
    || String(skuId || '').startsWith('furn-')
    || String(skuId || '').startsWith('ceiling-light-');
}

// A caller cannot opt an arbitrary ID in: every layout, capacity, shell, model,
// packed state, and no-scaling field must agree with productPackagingFor().
function layoutAllowsCatalogSku(layoutId, capacity, contract) {
  try {
    if (!isMigratedCatalogSku(contract?.skuId)) return false;
    const packaging = productPackagingFor(contract?.skuId);
    return packaging.layoutId === layoutId
      && packaging.unitsPerBox === capacity
      && packaging.box.shellId === contract.shellId
      && packaging.box.modelId === contract.modelId
      && packaging.packing.state === contract.packingState
      && packaging.packing.allowScale === false
      && contract.allowScale === false;
  } catch {
    return false;
  }
}

export function selectDeliveryContentLayout(root, layoutId, capacity, contract = null) {
  const id = String(layoutId || '').toUpperCase();
  const layoutRoots = namedDescendants(root, (name) => name.startsWith('CONTENT_LAYOUT_'));
  const selected = layoutRoots.find((object) => String(object.name || '').toUpperCase() === `CONTENT_LAYOUT_${id}`);
  if (!selected) throw new Error(`Authored delivery model is missing CONTENT_LAYOUT_${id}`);
  layoutRoots.forEach((object) => { object.visible = object === selected; });
  const prefix = `CONTENT_SLOT_${id}_`;
  const descendantSockets = namedDescendants(selected, (name) => name.startsWith(prefix));
  const sockets = selected.children
    .filter((object) => String(object.name || '').toUpperCase().startsWith(prefix))
    .sort(nameSort);
  if (descendantSockets.length !== sockets.length) {
    throw new Error(`CONTENT_LAYOUT_${id} sockets must be direct children of the layout root`);
  }
  if (sockets.length !== capacity) {
    throw new Error(`CONTENT_LAYOUT_${id} exposes ${sockets.length} sockets; expected ${capacity}`);
  }
  if (contract) {
    if (contract.allowScale !== false) throw new Error(`CONTENT_LAYOUT_${id} runtime contract must forbid scaling`);
    const layoutData = selected.userData || {};
    if (layoutData.layout_id !== id) throw new Error(`CONTENT_LAYOUT_${id} layout_id metadata does not match`);
    if (Number(layoutData.capacity) !== capacity) throw new Error(`CONTENT_LAYOUT_${id} capacity metadata does not match`);
    if (layoutData.socket_prefix !== prefix) throw new Error(`CONTENT_LAYOUT_${id} socket_prefix metadata does not match`);
    if (layoutData.selection_rule !== 'exact_sku_category_quantity_dimensions_packaging_state') {
      throw new Error(`CONTENT_LAYOUT_${id} selection_rule is not strict`);
    }
    const allowedSkus = metadataStringArray(layoutData.allowed_skus, `CONTENT_LAYOUT_${id}.allowed_skus`);
    if (!allowedSkus.includes(contract.skuId)
        && !layoutAllowsCatalogSku(id, capacity, contract)) {
      throw new Error(`CONTENT_LAYOUT_${id} does not allow SKU ${contract.skuId}`);
    }
    const authoredState = String(layoutData.packaging_state || '').trim();
    if (!authoredState) throw new Error(`CONTENT_LAYOUT_${id} is missing packaging_state metadata`);
    const acceptedState = AUTHORED_PACKING_STATE_BY_LAYOUT[id] || contract.packingState;
    if (authoredState !== contract.packingState && authoredState !== acceptedState) {
      throw new Error(`CONTENT_LAYOUT_${id} packaging_state ${authoredState} does not match ${contract.packingState}`);
    }
    const authoredShell = layoutData.packaging_shell_id;
    const physicalShell = layoutData.physical_shell_id;
    if (authoredShell == null && physicalShell == null) {
      throw new Error(`CONTENT_LAYOUT_${id} is missing shell identity metadata`);
    }
    if (authoredShell != null && authoredShell !== contract.shellId) {
      throw new Error(`CONTENT_LAYOUT_${id} belongs to shell ${authoredShell}; expected ${contract.shellId}`);
    }
    if (physicalShell != null && physicalShell !== contract.modelId) {
      throw new Error(`CONTENT_LAYOUT_${id} belongs to model ${physicalShell}; expected ${contract.modelId}`);
    }
    validateIdentityScale(selected, `CONTENT_LAYOUT_${id}`);

    sockets.forEach((socket, index) => {
      const ordinal = index + 1;
      const expectedName = `${prefix}${String(ordinal).padStart(2, '0')}`;
      const data = socket.userData || {};
      if (socket.name !== expectedName || socket.parent !== selected) {
        throw new Error(`${expectedName} socket identity does not match its authored hierarchy`);
      }
      if (data.layout_id !== id || Number(data.slot_index) !== ordinal) {
        throw new Error(`${expectedName} layout/index metadata does not match`);
      }
      if (data.anchor_kind !== 'box_content') {
        throw new Error(`${expectedName} must be an authored box_content socket`);
      }
      const socketSkus = metadataStringArray(data.allowed_skus, `${expectedName}.allowed_skus`);
      if (!socketSkus.includes(contract.skuId)
          && !layoutAllowsCatalogSku(id, capacity, contract)) {
        throw new Error(`${expectedName} does not allow SKU ${contract.skuId}`);
      }
      if (String(data.packaging_state || '').trim() !== authoredState) {
        throw new Error(`${expectedName} packaging_state does not match CONTENT_LAYOUT_${id}`);
      }
      if (data.packaging_shell_id != null && data.packaging_shell_id !== contract.shellId) {
        throw new Error(`${expectedName} shell identity does not match ${contract.shellId}`);
      }
      validateIdentityScale(socket, expectedName);
    });
  }
  return { layoutRoot: selected, sockets };
}

function visibleProductBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  let found = false;
  root.traverse((object) => {
    if (!object.isMesh || object.visible === false || !object.geometry) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    found = true;
  });
  return found ? bounds : null;
}

function geometryMergeSignature(geometry) {
  const attributes = Object.entries(geometry?.attributes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, attribute]) => [
      name,
      attribute.itemSize,
      attribute.normalized ? 1 : 0,
      attribute.array?.constructor?.name || 'unknown',
      attribute.gpuType ?? '',
    ].join(':'))
    .join('|');
  const morphs = Object.entries(geometry?.morphAttributes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, values]) => `${name}:${values.length}`)
    .join('|');
  return `${geometry?.index ? 'indexed' : 'plain'};${attributes};${morphs};${geometry?.morphTargetsRelative ? 1 : 0}`;
}

function deliveryContentSourceMeshes(product) {
  const meshes = [];
  product.updateMatrixWorld(true);
  product.traverseVisible((object) => {
    if (!object.isMesh || !object.geometry || !object.material) return;
    if (object.isSkinnedMesh || object.skeleton || object.morphTargetInfluences?.length) {
      throw new Error(`Packed delivery product ${product.name} must use static authored geometry`);
    }
    if (object.userData?.helper || object.userData?.collision_proxy
      || /^(?:COL_|COLLISION_|VOLUME_)/i.test(String(object.name || ''))) return;
    meshes.push(object);
  });
  return meshes;
}

// Bake one exact catalog product into product-local geometry, then merge all
// compatible primitives sharing a material. The result keeps the authored PBR
// materials and triangles but turns twelve water-bottle hierarchies into six
// draw submissions. Multi-material primitives remain one instanced batch rather
// than being duplicated or lossy-split.
function buildDeliveryContentBatchEntries(product, resources) {
  const sourceMeshes = deliveryContentSourceMeshes(product);
  if (!sourceMeshes.length) throw new Error(`Packed delivery product ${product.name} has no visible authored geometry`);
  product.updateMatrixWorld(true);
  const productInverse = product.matrixWorld.clone().invert();
  const materialBuckets = new Map();
  const directEntries = [];

  for (const source of sourceMeshes) {
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(productInverse, source.matrixWorld));
    geometry.boundingBox = null;
    geometry.boundingSphere = null;
    if (Array.isArray(source.material)) {
      directEntries.push({
        geometry,
        material: source.material,
        sourceMeshCount: 1,
        castShadow: source.castShadow,
        receiveShadow: source.receiveShadow,
      });
      continue;
    }
    let signatures = materialBuckets.get(source.material);
    if (!signatures) {
      signatures = new Map();
      materialBuckets.set(source.material, signatures);
    }
    const signature = geometryMergeSignature(geometry);
    let bucket = signatures.get(signature);
    if (!bucket) {
      bucket = {
        geometries: [],
        material: source.material,
        castShadow: false,
        receiveShadow: false,
      };
      signatures.set(signature, bucket);
    }
    bucket.geometries.push(geometry);
    bucket.castShadow ||= source.castShadow;
    bucket.receiveShadow ||= source.receiveShadow;
  }

  const entries = [...directEntries];
  for (const signatures of materialBuckets.values()) {
    for (const bucket of signatures.values()) {
      const { geometries } = bucket;
      let merged = geometries[0];
      if (geometries.length > 1) {
        try {
          merged = mergeGeometries(geometries, false);
        } catch {
          merged = null;
        }
      }
      if (!merged) {
        for (const geometry of geometries) {
          entries.push({
            geometry,
            material: bucket.material,
            sourceMeshCount: 1,
            castShadow: bucket.castShadow,
            receiveShadow: bucket.receiveShadow,
          });
        }
        continue;
      }
      for (const geometry of geometries) if (geometry !== merged) geometry.dispose();
      entries.push({
        geometry: merged,
        material: bucket.material,
        sourceMeshCount: geometries.length,
        castShadow: bucket.castShadow,
        receiveShadow: bucket.receiveShadow,
      });
    }
  }
  for (const entry of entries) resources.geometry(entry.geometry);
  return entries;
}

function placeholderForProduct(product, socket, sku, index, alternateProductYaw) {
  const placeholder = new THREE.Object3D();
  placeholder.name = `BOX_CONTENT_${String(index + 1).padStart(2, '0')}_${sku ? sku.id : 'unknown'}`;
  placeholder.position.copy(product.position);
  placeholder.rotation.copy(product.rotation);
  if (alternateProductYaw && index % 2) placeholder.rotation.y += Math.PI;
  placeholder.scale.copy(product.scale);
  placeholder.userData.catalogVisual = product.userData.catalogVisual;
  placeholder.userData.catalogProductContext = product.userData.catalogProductContext;
  placeholder.userData.deliveryContentPlaceholder = true;
  placeholder.userData.deliveryContentIndex = index;
  socket.add(placeholder);
  return placeholder;
}

function putProductsInSockets({
  layoutRoot, sockets, sku, merch, mats, resources, productScale,
  productRotation = [0, 0, 0], alternateProductYaw = false,
}) {
  if (Number(productScale) !== 1) throw new Error(`Delivery contents for ${sku?.id || 'unknown'} must render at scale 1`);

  // Supplying every palette slot prevents the checkout proxy's defensive
  // procedural palette from allocating unused materials for an authored model.
  // Exact delivery construction fails closed if that model cannot instantiate.
  const unusedFallbackMaterial = new THREE.MeshStandardMaterial();
  const completeMaterialKit = new Proxy(mats || {}, {
    get(target, key) {
      return target[key] || unusedFallbackMaterial;
    },
  });
  let built;
  try {
    built = buildCatalogProductProxy({
      sku,
      merch,
      mats: completeMaterialKit,
      resources,
      context: 'delivery-packed',
    });
  } finally {
    unusedFallbackMaterial.dispose();
  }
  const product = built.root;
  if (!product.getObjectByName(built.descriptor.model)) {
    resources.dispose(product);
    throw new Error(`Delivery contents for ${sku?.id || 'unknown'} could not instantiate ${built.descriptor.model}`);
  }
  product.position.set(0, 0, 0);
  product.rotation.set(
    Number(productRotation[0]) || 0,
    Number(productRotation[1]) || 0,
    Number(productRotation[2]) || 0,
  );
  const bounds = visibleProductBounds(product);
  if (bounds) product.position.sub(bounds.getCenter(new THREE.Vector3()));

  const batchRoot = new THREE.Group();
  batchRoot.name = `BOX_CONTENT_BATCH_${sku ? sku.id : 'unknown'}`;
  batchRoot.userData.deliveryContentBatchRoot = true;
  batchRoot.userData.deliveryContentCapacity = sockets.length;
  layoutRoot.add(batchRoot);

  const products = sockets.map((socket, index) => (
    placeholderForProduct(product, socket, sku, index, alternateProductYaw)
  ));
  let entries;
  const batches = [];
  try {
    entries = buildDeliveryContentBatchEntries(product, resources);
    entries.forEach((entry, index) => {
      const batch = new THREE.InstancedMesh(entry.geometry, entry.material, sockets.length);
      const materialName = (Array.isArray(entry.material)
        ? 'multi_material'
        : entry.material?.name || `material_${index + 1}`)
        .replace(/[^a-z0-9]+/gi, '_');
      batch.name = `BOX_CONTENT_INSTANCES_${sku ? sku.id : 'unknown'}_${String(index + 1).padStart(2, '0')}_${materialName}`;
      batch.castShadow = entry.castShadow;
      batch.receiveShadow = entry.receiveShadow;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.userData.deliveryContentInstances = true;
      batch.userData.deliveryContentSkuId = sku?.id || null;
      batch.userData.deliveryContentCapacity = sockets.length;
      batch.userData.deliveryContentSourceMeshCount = entry.sourceMeshCount;
      batchRoot.add(batch);
      batches.push(batch);
    });
  } catch (error) {
    resources.dispose(batchRoot);
    for (const batch of batches) batch.dispose();
    batchRoot.removeFromParent();
    for (const placeholder of products) placeholder.removeFromParent();
    throw error;
  }

  // Instance transforms live in layout-local space. Moving/carrying the carton
  // therefore moves one batch root without rewriting hundreds of matrices.
  layoutRoot.updateWorldMatrix(true, true);
  const batchInverse = batchRoot.matrixWorld.clone().invert();
  const placementMatrices = products.map((placeholder) => {
    placeholder.updateWorldMatrix(true, false);
    return new THREE.Matrix4().multiplyMatrices(batchInverse, placeholder.matrixWorld);
  });
  for (const batch of batches) {
    placementMatrices.forEach((matrix, index) => batch.setMatrixAt(index, matrix));
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
  }

  let activeSignature = null;
  let disposed = false;
  function update(visibleIndices, renderVisible) {
    const indices = renderVisible
      ? [...visibleIndices].sort((a, b) => a - b)
      : [];
    const signature = indices.join(',');
    products.forEach((placeholder, index) => {
      placeholder.visible = renderVisible && visibleIndices.has(index);
    });
    batchRoot.visible = renderVisible && indices.length > 0;
    batchRoot.userData.deliveryContentVisibleUnits = indices.length;
    if (signature === activeSignature) return;
    activeSignature = signature;
    for (const batch of batches) {
      indices.forEach((productIndex, instanceIndex) => {
        batch.setMatrixAt(instanceIndex, placementMatrices[productIndex]);
      });
      batch.count = indices.length;
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    products,
    batchRoot,
    batches,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const batch of batches) batch.dispose();
      batchRoot.removeFromParent();
    },
  };
}

function layoutVisibleProducts(sockets, visible, total) {
  const clampedVisible = Math.max(0, Math.min(total, visible));
  const thresholds = sockets.map((socket) => Number(socket.userData?.visible_when_remaining_at_least));
  if (thresholds.every((value) => Number.isInteger(value) && value >= 1 && value <= total)) {
    return new Set(thresholds
      .map((threshold, index) => (clampedVisible >= threshold ? index : -1))
      .filter((index) => index >= 0));
  }
  return new Set(Array.from({ length: clampedVisible }, (_, index) => index));
}

function applyFlaps(flaps, progress) {
  const eased = normalizedFourFlaps(progress).map(smoothDeliveryProgress);
  // The authored left/right hinges sit at -X/+X. In glTF's Y-up space they
  // must rotate away from the opening (+Z/-Z respectively); the inverse signs
  // fold both side flaps down through the contents instead of opening them.
  const signs = [1, -1, 1, -1];
  flaps.forEach((flap, index) => {
    if (!flap) return;
    restorePose(flap);
    if (index < 2) flap.rotation.x += signs[index] * OPEN_ANGLE * eased[index];
    else flap.rotation.z += signs[index] * OPEN_ANGLE * eased[index];
  });
}

function applyFlatten(walls, flaps, amount) {
  const p = smoothDeliveryProgress(amount);
  // Collapse all four walls inward over the base. With flaps parented to their
  // walls this produces a compact layered carton instead of a metre-wide cross.
  const wallSigns = [-1, 1, -1, 1];
  walls.forEach((wall, index) => {
    if (!wall) return;
    restorePose(wall);
    if (index < 2) wall.rotation.x += wallSigns[index] * FLAT_ANGLE * p;
    else wall.rotation.z += wallSigns[index] * FLAT_ANGLE * p;
    // Stagger the thick stylized cardboard layers by millimetres so coplanar
    // faces do not shimmer in the final flattened state.
    wall.position.y += (index + 1) * 0.002 * p;
  });
  if (p > 0.001) {
    applyFlaps(flaps, [1, 1, 1, 1]);
  }
}

function applyAuthoredContentReveal(walls, flapProgress, flattenProgress) {
  const front = walls[0];
  if (!front || front.userData?.reveal_contents !== true) return;
  const degrees = Number(front.userData?.open_reveal_angle_deg);
  if (!Number.isFinite(degrees) || degrees <= 0) return;
  const hingeAxis = String(front.userData?.hinge_axis || 'X').toUpperCase();
  if (hingeAxis !== 'X') return;
  const allFlapsOpen = Math.min(...normalizedFourFlaps(flapProgress));
  const reveal = smoothDeliveryProgress(allFlapsOpen)
    * (1 - smoothDeliveryProgress(flattenProgress));
  front.rotation.x += THREE.MathUtils.degToRad(degrees) * reveal;
}

export function canBuildDeliveryBoxVisual(box, merch) {
  const visual = deliveryBoxVisualConfig(box);
  const productVisual = explicitCatalogProductVisual(box?.skuId);
  if (!visual || !productVisual?.model) return false;
  if (box?.modelId && visual?.model !== box.modelId) return false;
  const model = box?.modelId || visual?.model;
  return !!(
    model
    && merch
    && typeof merch.has === 'function'
    && merch.has(model)
    && merch.has(productVisual.model)
  );
}

export function createDeliveryBoxVisual({ box, sku, merch, mats }) {
  const visual = deliveryBoxVisualConfig(box);
  if (!visual || !explicitCatalogProductVisual(box?.skuId)) return null;
  if (!sku || sku.id !== box.skuId) throw new Error(`Delivery box ${box.id ?? '?'} is missing its exact catalog SKU`);
  if (!canBuildDeliveryBoxVisual(box, merch)) return null;
  const contentContract = deliveryContentContract(box);
  const model = contentContract.modelId;
  if (!model || !merch || typeof merch.instantiate !== 'function') return null;
  const authored = merch.instantiate(model);
  if (!authored) return null;

  authored.scale.multiply(new THREE.Vector3(...visual.modelScale));

  const resources = createOwnedStockResources();
  const root = new THREE.Group();
  root.name = `DeliveryBox_${box.id}`;
  root.add(authored);

  const flaps = FLAP_NAMES.map((name) => findNamed(authored, name));
  const walls = WALL_NAMES.map((name) => findNamed(authored, name));
  [...flaps, ...walls].filter(Boolean).forEach(rememberPose);

  const allTapeMeshes = namedDescendants(
    authored,
    (name, object) => object.isMesh && name.startsWith('TAPE_') && !name.includes('PEELED'),
  );
  const orderedTapeMeshes = allTapeMeshes
    .filter((object) => Number.isFinite(Number(object.userData?.cut_order)))
    .sort((a, b) => Number(a.userData.cut_order) - Number(b.userData.cut_order));
  const cutPathNode = findNamed(authored, 'CUT_PATH');
  if (!cutPathNode) throw new Error(`${model} is missing its authored CUT_PATH`);
  const cutterPath = createAuthoredCutterPathContract({
    points: cutPathNode.userData?.points,
    segmentNodes: cutPathNode.userData?.segment_nodes,
    orderedTapeNames: orderedTapeMeshes.map((object) => object.name),
    durationSec: cutPathNode.userData?.duration_sec,
    completionThreshold: cutPathNode.userData?.completion_threshold,
  });
  const tapeByName = new Map(allTapeMeshes.map((object) => [object.name, object]));
  const tapeSegments = cutterPath.segmentNodes.map((name) => {
    const segment = tapeByName.get(name);
    if (!segment) throw new Error(`${model} CUT_PATH names missing tape mesh ${name}`);
    return segment;
  });
  const cuttableTapeNames = new Set(cutterPath.segmentNodes);
  const auxiliaryTape = allTapeMeshes.filter((object) => !cuttableTapeNames.has(object.name));
  const peeledTape = namedDescendants(authored, (name) => name.includes('TAPE_PEELED'));
  peeledTape.forEach(rememberPose);
  const packingComponents = namedDescendants(
    authored,
    (name, object) => deliveryPackingComponentRole(name, object.userData) !== null,
  ).map((object) => Object.freeze({
    object,
    role: deliveryPackingComponentRole(object.name, object.userData),
  }));
  const { layoutRoot, sockets } = selectDeliveryContentLayout(
    authored,
    contentContract.layoutId,
    contentContract.capacity,
    {
      skuId: box.skuId,
      shellId: contentContract.shellId,
      modelId: contentContract.modelId,
      packingState: contentContract.packingState,
      allowScale: false,
    },
  );
  const content = putProductsInSockets({
    layoutRoot,
    sockets,
    sku,
    merch,
    mats,
    resources,
    productScale: contentContract.contentScale,
    productRotation: visual.productRotation,
    alternateProductYaw: visual.alternateProductYaw,
  });
  const { products } = content;
  const flatBundle = findNamed(authored, 'BOX_FLAT_BUNDLE');
  if (flatBundle) {
    rememberPose(flatBundle);
    flatBundle.visible = false;
  }

  const labelMesh = selectDeliveryDynamicLabelMesh(authored);
  const labelScaleCompensation = deliveryLabelScaleCompensation(box);
  if (labelScaleCompensation) {
    namedDescendants(authored, (name, object) => object.isMesh
      && (name === 'LABEL_DYNAMIC' || name === 'SHIPPING_LABEL_BACKING'))
      .forEach((mesh) => mesh.scale.multiply(new THREE.Vector3(...labelScaleCompensation)));
  }
  authored.updateMatrixWorld(true);
  const labelSurfaceAspect = deliveryLabelSurfaceAspect(labelMesh);
  const label = makeDynamicLabel(
    box,
    sku,
    resources,
    visual.shippingClass,
    deliveryLabelTextureTransform(box),
    labelSurfaceAspect,
  );
  if (label && labelMesh) applyDeliveryDynamicLabelMaterial(authored, label.material);

  const collisionHelpers = namedDescendants(
    authored,
    (name) => name.startsWith('COL_') || name.startsWith('COLLISION_') || name.startsWith('VOLUME_'),
  );
  collisionHelpers.forEach((object) => { object.visible = false; });
  const assetRoot = findNamed(authored, model) || authored;
  const liveRoots = flatBundle
    ? assetRoot.children.filter((child) => child !== flatBundle)
    : [];
  const liveRootVisibility = new Map(liveRoots.map((object) => [object, object.visible]));

  function toolPathAtProgress(progress) {
    const local = authoredCutterPathSegment(cutterPath, progress);
    if (!local) return null;
    assetRoot.updateWorldMatrix(true, false);
    const start = assetRoot.localToWorld(new THREE.Vector3(
      local.start.x,
      local.start.y,
      local.start.z,
    ));
    const end = assetRoot.localToWorld(new THREE.Vector3(
      local.end.x,
      local.end.y,
      local.end.z,
    ));
    return Object.freeze({
      start: Object.freeze({ x: start.x, y: start.y, z: start.z }),
      end: Object.freeze({ x: end.x, y: end.y, z: end.z }),
      progress: local.progress,
      span: local.span,
    });
  }

  function update(nextBox) {
    const tape = Math.max(0, Math.min(1, Number(nextBox.tape) || 0));
    const flapValues = normalizedFourFlaps(nextBox.flapProgress || nextBox.flaps);
    const opening = flapValues.some((value) => value > 0.01);
    tapeSegments.forEach((segment) => {
      segment.visible = authoredTapeMeshVisible(cutterPath, segment.name, tape, opening);
    });
    auxiliaryTape.forEach((segment) => {
      segment.visible = authoredTapeMeshVisible(cutterPath, segment.name, tape, opening);
    });
    peeledTape.forEach((strip, index) => {
      strip.visible = tape > 0.02 && !opening;
      restorePose(strip);
      strip.rotation.z += (index % 2 ? -1 : 1) * smoothDeliveryProgress(tape) * 0.22;
      strip.position.y += smoothDeliveryProgress(tape) * 0.012;
    });

    const flapProgress = nextBox.flapProgress || nextBox.flaps;
    applyFlaps(flaps, flapProgress);
    const flatten = Number(nextBox.flattenProgress) || (nextBox.flat ? 1 : 0);
    applyFlatten(walls, flaps, flatten);
    applyAuthoredContentReveal(walls, flapProgress, flatten);

    // Once the hinges have visibly started their fold, hand off to the compact
    // authored bundle. This removes coplanar wall intersections and gives both
    // the world and carry states a truthful ~3.4 cm cardboard silhouette.
    const useFlatBundle = !!flatBundle && flatten >= 0.46;
    for (const object of liveRoots) object.visible = useFlatBundle
      ? false
      : liveRootVisibility.get(object);
    if (flatBundle) {
      flatBundle.visible = useFlatBundle;
      restorePose(flatBundle);
      if (useFlatBundle) {
        const settle = smoothDeliveryProgress((flatten - 0.46) / 0.54);
        flatBundle.scale.multiply(new THREE.Vector3(
          0.90 + settle * 0.10,
          2.15 - settle * 1.15,
          0.90 + settle * 0.10,
        ));
        flatBundle.rotation.y += (1 - settle) * 0.055;
        flatBundle.position.y += Math.sin(settle * Math.PI) * 0.012;
      }
    }

    const interiorRevealed = flapValues.some((value) => value > 0.01)
      || ['OPEN', 'PARTIALLY_EMPTIED', 'EMPTY', 'FLATTENING'].includes(nextBox.lifecycle);
    const visible = visibleContentsForBox(nextBox, products.length);
    const visibleIndices = layoutVisibleProducts(sockets, visible, products.length);
    content.update(visibleIndices, interiorRevealed && flatten < 0.46);
    packingComponents.forEach(({ object, role }) => {
      object.visible = deliveryPackingComponentVisible(
        role,
        interiorRevealed,
        nextBox.qty,
        flatten,
      );
    });
    if (label) label.update(nextBox);
    root.userData.deliveryState = nextBox.lifecycle || nextBox.state || null;
    root.userData.deliveryBoxId = nextBox.id;
    root.userData.deliveryLayoutId = contentContract.layoutId;
    root.userData.deliveryModelId = contentContract.modelId;
    root.userData.deliveryContentRenderBatches = content.batches.length;
    root.userData.deliveryContentVisibleUnits = content.batchRoot.userData.deliveryContentVisibleUnits;
  }

  update(box);
  let disposed = false;
  return {
    root,
    model,
    layoutId: contentContract.layoutId,
    layoutRoot,
    contentBatchRoot: content.batchRoot,
    contentBatches: content.batches,
    cutterPath,
    toolPathAtProgress,
    authored: true,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (label) label.dispose();
      resources.dispose(root);
      content.dispose();
      root.removeFromParent();
    },
  };
}
