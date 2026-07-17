// DELIVERY BOX VISUALS
//
// A delivery carton is a persistent prop, not a frame-by-frame mesh effect. The
// Blender source owns its walls, hinge pivots, tape strips, content sockets and
// collision helpers. This module clones that authored hierarchy once, attaches
// the real catalog product proxies once, then only changes visibility/transforms
// as the simulation advances.

import * as THREE from 'three';
import { buildCatalogProductProxy } from './catalogProductVisual.js';
import { createOwnedStockResources } from './stockResources.js';

const DELIVERY_BOX_VISUALS = Object.freeze({
  apparel: Object.freeze({
    model: 'delivery_apparel_box',
    productScale: 0.60,
    layout: 'apparel-pairs',
    shippingClass: 'APPAREL',
  }),
  merchbox: Object.freeze({
    model: 'delivery_generic_merchandise_box',
    productScale: 0.85,
    layout: 'authored',
    shippingClass: 'MERCHANDISE',
  }),
});

export const DELIVERY_MODEL_BY_BOX_KIND = Object.freeze(Object.fromEntries(
  Object.entries(DELIVERY_BOX_VISUALS).map(([kind, visual]) => [kind, visual.model]),
));

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
  // Legacy cartons had two long flaps. Treat each open legacy flap as its
  // adjacent long/short pair so an old save never visually reseals itself.
  const front = Math.max(0, Math.min(1, Number(source[0]) || 0));
  const back = Math.max(0, Math.min(1, Number(source[1]) || 0));
  return [front, back, front, back];
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

function drawShippingLabel(ctx, box, sku, shippingClass) {
  const supplier = String(box.supplier || 'PINEHOLLOW SUPPLY').toUpperCase();
  const order = String(box.orderId || 0).padStart(4, '0');
  const product = String((sku && sku.name) || box.skuId || shippingClass || 'STOCK').toUpperCase();
  const weight = box.lb == null ? '' : `${box.lb} LB`;

  ctx.clearRect(0, 0, 512, 320);
  ctx.fillStyle = '#f1ead8';
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = '#244b36';
  ctx.fillRect(0, 0, 512, 54);
  ctx.strokeStyle = '#9c8054';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 492, 300);
  ctx.fillStyle = '#f7f0dd';
  ctx.font = '700 31px Georgia, serif';
  ctx.fillText(`PINEHOLLOW  /  ${shippingClass || 'STOCK'}`.slice(0, 30), 24, 38);
  ctx.fillStyle = '#29322d';
  ctx.font = '700 30px Arial, sans-serif';
  ctx.fillText(supplier.slice(0, 28), 24, 93);
  ctx.font = '600 25px Arial, sans-serif';
  ctx.fillText(`ORDER  ${order}`, 24, 132);
  ctx.fillText(product.slice(0, 30), 24, 171);
  const shippedQty = box.initialQty ?? box.cap ?? box.qty ?? 0;
  ctx.fillText(`QTY  ${Math.max(0, shippedQty)}     ${weight}`, 24, 210);
  ctx.fillStyle = '#244b36';
  ctx.fillRect(24, 238, 464, 48);
  ctx.fillStyle = '#f7f0dd';
  ctx.font = '700 24px Arial, sans-serif';
  ctx.fillText(box.fragile ? 'HANDLE WITH CARE' : 'PRO SHOP STOCK', 40, 271);
}

function makeDynamicLabel(box, sku, resources, shippingClass) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawShippingLabel(ctx, box, sku, shippingClass);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Imported glTF UVs already use the texture orientation GLTFLoader expects.
  // CanvasTexture defaults to the opposite convention, which inverts labels.
  texture.flipY = false;
  texture.anisotropy = 4;
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
      const next = `${nextBox.supplier || ''}|${nextBox.orderId || 0}|${shippedQty}|${nextBox.lb || ''}|${nextBox.fragile ? 1 : 0}`;
      if (next === this.signature) return;
      this.signature = next;
      drawShippingLabel(ctx, nextBox, sku, shippingClass);
      texture.needsUpdate = true;
    },
    dispose() { texture.dispose(); },
  };
}

function fallbackSockets(root) {
  const slots = [];
  const poses = [
    [-0.16, 0.045, -0.095], [0.08, 0.045, -0.095],
    [-0.16, 0.045, 0.095], [0.08, 0.045, 0.095],
    [-0.16, 0.145, -0.095], [0.08, 0.145, -0.095],
    [-0.16, 0.145, 0.095], [0.08, 0.145, 0.095],
  ];
  for (let index = 0; index < poses.length; index++) {
    const slot = new THREE.Object3D();
    slot.name = `CONTENT_SLOT_FALLBACK_${String(index + 1).padStart(2, '0')}`;
    slot.position.set(...poses[index]);
    root.add(slot);
    slots.push(slot);
  }
  return slots;
}

function putProductsInSockets({ root, sockets, sku, merch, mats, resources, productScale }) {
  return sockets.map((socket, index) => {
    const built = buildCatalogProductProxy({ sku, merch, mats, resources });
    const product = built.root;
    product.name = `BOX_CONTENT_${String(index + 1).padStart(2, '0')}_${sku ? sku.id : 'unknown'}`;
    product.position.set(0, 0, 0);
    product.rotation.y = index % 2 ? Math.PI : 0;
    product.scale.multiplyScalar(productScale || 1);
    socket.add(product);
    return product;
  });
}

function layoutVisibleProducts(sockets, visible, total, layout) {
  const clampedVisible = Math.max(0, Math.min(total, visible));
  if (layout !== 'apparel-pairs' || total !== 8 || sockets.length !== 8) {
    return new Set(Array.from({ length: clampedVisible }, (_, index) => index));
  }

  // The hero apparel case carries four pairs. Recenter whole pair-stacks as
  // each two-unit armful leaves so 8 / 6 / 4 / 2 remain visually unambiguous
  // and the last pair never disappears behind the front carton wall.
  const pairXs = {
    4: [-0.198, -0.066, 0.066, 0.198],
    3: [-0.132, 0, 0.132],
    2: [-0.070, 0.070],
    1: [0],
    0: [],
  };
  const pairCount = Math.ceil(clampedVisible / 2);
  const xs = pairXs[pairCount] || pairXs[4];
  sockets.forEach((socket, index) => {
    const pair = Math.floor(index / 2);
    const layer = index % 2;
    const x = xs[Math.min(pair, Math.max(0, xs.length - 1))] ?? 0;
    socket.position.set(x, layer ? 0.178 : 0.142, layer ? -0.014 : 0.014);
  });
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

export function canBuildDeliveryBoxVisual(box, merch) {
  const model = DELIVERY_BOX_VISUALS[box && box.box]?.model;
  return !!(model && merch && typeof merch.has === 'function' && merch.has(model));
}

export function createDeliveryBoxVisual({ box, sku, merch, mats }) {
  const visual = DELIVERY_BOX_VISUALS[box && box.box];
  const model = visual?.model;
  if (!model || !merch || typeof merch.instantiate !== 'function') return null;
  const authored = merch.instantiate(model);
  if (!authored) return null;

  const resources = createOwnedStockResources();
  const root = new THREE.Group();
  root.name = `DeliveryBox_${box.id}`;
  root.add(authored);

  const flaps = FLAP_NAMES.map((name) => findNamed(authored, name));
  const walls = WALL_NAMES.map((name) => findNamed(authored, name));
  [...flaps, ...walls].filter(Boolean).forEach(rememberPose);

  const tapeSegments = namedDescendants(
    authored,
    (name, object) => object.isMesh && name.startsWith('TAPE_') && !name.includes('PEELED'),
  );
  const tapePathOrder = ['TAPE_SEG_RIGHT', 'TAPE_SEG_LEFT', 'TAPE_SIDE_LEFT', 'TAPE_SIDE_RIGHT'];
  tapeSegments.sort((a, b) => {
    const authoredA = Number(a.userData.cut_order);
    const authoredB = Number(b.userData.cut_order);
    if (Number.isFinite(authoredA) && Number.isFinite(authoredB)) return authoredA - authoredB;
    return tapePathOrder.indexOf(a.name) - tapePathOrder.indexOf(b.name);
  });
  const peeledTape = namedDescendants(authored, (name) => name.includes('TAPE_PEELED'));
  peeledTape.forEach(rememberPose);
  const tissue = namedDescendants(authored, (name) => name.includes('TISSUE') || name.includes('DIVIDER') || name.includes('INSERT'));
  let sockets = namedDescendants(authored, (name) => name.startsWith('CONTENT_SLOT_'));
  if (!sockets.length) sockets = fallbackSockets(authored);
  const products = putProductsInSockets({
    root: authored,
    sockets,
    sku,
    merch,
    mats,
    resources,
    productScale: visual.productScale,
  });
  const flatBundle = findNamed(authored, 'BOX_FLAT_BUNDLE');
  if (flatBundle) {
    rememberPose(flatBundle);
    flatBundle.visible = false;
  }

  const label = makeDynamicLabel(box, sku, resources, visual.shippingClass);
  const labelMeshes = namedDescendants(authored, (name, object) => object.isMesh && (name.includes('LABEL_DYNAMIC') || name.includes('LABEL_SHIPPING')));
  if (label) labelMeshes.forEach((mesh) => { mesh.material = label.material; });

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

  function update(nextBox) {
    const tape = Math.max(0, Math.min(1, Number(nextBox.tape) || 0));
    const flapValues = normalizedFourFlaps(nextBox.flapProgress || nextBox.flaps);
    const opening = flapValues.some((value) => value > 0.01);
    const remaining = remainingTapeSegments(tape, tapeSegments.length);
    tapeSegments.forEach((segment, index) => { segment.visible = index >= tapeSegments.length - remaining; });
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
    const visibleIndices = layoutVisibleProducts(sockets, visible, products.length, visual.layout);
    products.forEach((product, index) => {
      product.visible = interiorRevealed && visibleIndices.has(index) && flatten < 0.46;
    });
    tissue.forEach((object) => {
      object.visible = interiorRevealed && nextBox.qty > 0 && flatten < 0.5;
    });
    if (label) label.update(nextBox);
    root.userData.deliveryState = nextBox.lifecycle || nextBox.state || null;
    root.userData.deliveryBoxId = nextBox.id;
  }

  update(box);
  return {
    root,
    model,
    authored: true,
    update,
    dispose() {
      if (label) label.dispose();
      resources.dispose(root);
      root.removeFromParent();
    },
  };
}
