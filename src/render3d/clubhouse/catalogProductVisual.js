// CHECKOUT PRODUCT VISUALS
//
// A transaction item is a physical SKU, not a category-coloured cube.  This module
// keeps the checkout representation, barcode/tag mount, POS silhouette and size-aware
// staging classification on one descriptor so they cannot silently drift apart.
// Production shapes use the project's original, repeatably generated Blender family
// library. The procedural pieces below are loading-failure recovery only.

import * as THREE from 'three';
import { PRODUCT_PACKAGING } from '../../data/productPackaging.js';
import { frontDeskLocalPoint, frontDeskPose } from '../../data/shopLayout.js';

const VISUALS = {
  driver1: visual('driver', { model: 'checkout_product_driver', tint: 0x78957e, tier: 1, length: 1.14, size: [1.14, 0.0704, 0.0792], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  driver2: visual('driver', { model: 'checkout_product_driver', tint: 0xb08c4f, tier: 2, length: 1.16, size: [1.16, 0.0716, 0.0806], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  driver3: visual('driver', { model: 'checkout_product_driver', tint: 0x315c43, tier: 3, length: 1.18, size: [1.18, 0.0729, 0.0820], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  irons1: visual('iron-set', { model: 'checkout_product_iron_set', tint: 0x78957e, tier: 1, length: 1.02, size: [1.02, 0.0792, 0.1554], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  irons2: visual('iron-set', { model: 'checkout_product_iron_set', tint: 0xb08c4f, tier: 2, length: 1.04, size: [1.04, 0.0807, 0.1584], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  putter1: visual('putter', { model: 'checkout_product_putter', tint: 0x78957e, tier: 1, length: 0.94, size: [0.94, 0.0517, 0.0542], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  putter2: visual('putter', { model: 'checkout_product_putter', tint: 0xb08c4f, tier: 2, length: 0.96, size: [0.96, 0.0528, 0.0554], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  putter3: visual('putter', { model: 'checkout_product_putter', tint: 0x315c43, tier: 3, length: 0.98, size: [0.98, 0.0540, 0.0570], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  wedge1: visual('wedge', { model: 'checkout_product_wedge', tint: 0x78957e, tier: 1, length: 0.96, size: [0.96, 0.0779, 0.0710], barcode: 'club-tag', grip: 'two-hand', oversize: true }),
  wedge2: visual('wedge', { model: 'checkout_product_wedge', tint: 0xb08c4f, tier: 2, length: 0.98, size: [0.98, 0.0795, 0.0725], barcode: 'club-tag', grip: 'two-hand', oversize: true }),

  balls1: visual('ball-box', { model: 'checkout_product_ball_carton', tint: 0x78957e, tier: 1, barcode: 'package-side', size: [0.155, 0.0740, 0.1288] }),
  balls2: visual('ball-box', { model: 'checkout_product_ball_carton', tint: 0xb08c4f, tier: 2, barcode: 'package-side', size: [0.155, 0.0740, 0.1288] }),
  balls3: visual('ball-box', { model: 'checkout_product_ball_carton', tint: 0x315c43, tier: 3, barcode: 'package-side', size: [0.155, 0.0740, 0.1288] }),

  glove1: visual('glove', { model: 'checkout_product_glove', tier: 1, barcode: 'hang-tag', size: [0.1723, 0.0293, 0.2200], rotation: [Math.PI / 2, 0, 0] }),
  glove2: visual('glove', { model: 'checkout_product_glove', tint: 0x33455e, tier: 3, barcode: 'hang-tag', size: [0.1723, 0.0293, 0.2200], rotation: [Math.PI / 2, 0, 0] }),
  polo1: visual('folded-polo', { model: 'checkout_product_folded_polo', tint: 0x4e7a52, tier: 1, barcode: 'apparel-tag', size: [0.2000, 0.0925, 0.1650] }),
  polo2: visual('folded-polo', { model: 'checkout_product_folded_polo', tint: 0x5b7f9e, tier: 2, barcode: 'apparel-tag', size: [0.2000, 0.0925, 0.1650] }),
  pants2: visual('folded-bottom', { model: 'checkout_product_folded_bottom', tint: 0x555b52, tier: 2, barcode: 'apparel-tag', size: [0.2400, 0.1000, 0.2000] }),
  shorts1: visual('folded-bottom', { model: 'checkout_product_folded_bottom', tint: 0x78957e, tier: 1, barcode: 'apparel-tag', size: [0.2200, 0.0900, 0.1900] }),
  cap1: visual('cap', { model: 'checkout_product_cap', tint: 0x315c43, tier: 1, barcode: 'apparel-tag', size: [0.2081, 0.1235, 0.2100] }),
  cap2: visual('cap', { model: 'checkout_product_cap', tint: 0xb08c4f, tier: 2, barcode: 'apparel-tag', size: [0.2081, 0.1235, 0.2100] }),
  visor1: visual('visor', { model: 'checkout_product_visor', tint: 0x315c43, tier: 1, barcode: 'apparel-tag', size: [0.2080, 0.0700, 0.2100] }),
  jacket2: visual('folded-jacket', { model: 'checkout_product_folded_jacket', tint: 0x33455e, tier: 2, barcode: 'apparel-tag', size: [0.2150, 0.0947, 0.1822] }),
  // The loose pair on the shoe-wall boards is a try-on sample. The inventory
  // unit a shopper carries and scans is the authored Fairhollow retail carton,
  // so its package identity cannot disappear between shelf and checkout.
  shoe1: visual('shoe-box', { model: 'checkout_product_shoe_box', tint: 0xf0ead8, tier: 2, barcode: 'package-side', size: [0.3100, 0.1150, 0.1900], grip: 'medium' }),
  shoe3: visual('shoe-box', { model: 'checkout_product_shoe_box', tint: 0x315c43, tier: 3, barcode: 'package-side', size: [0.3100, 0.1150, 0.1900], grip: 'medium' }),
  sock1: visual('sock-pair', { model: 'checkout_product_sock_pair', tint: 0xe8e0cf, tier: 1, barcode: 'apparel-tag', size: [0.1500, 0.0731, 0.1269] }),

  tees1: visual('tee-pouch', { model: 'checkout_product_tee_pouch', tier: 1, barcode: 'package-back', size: [0.1300, 0.1200, 0.0460] }),
  towel1: visual('towel-roll', { model: 'checkout_product_towel_roll', tint: 0x78957e, tier: 1, barcode: 'hang-tag', size: [0.2000, 0.1034, 0.0751] }),
  marker1: visual('marker-card', { model: 'checkout_product_marker_blister', tier: 1, barcode: 'package-back', size: [0.1400, 0.1050, 0.0195] }),
  divot1: visual('divot-card', { model: 'checkout_product_divot_tool_card', tint: 0xb08c4f, tier: 1, barcode: 'package-back', size: [0.1300, 0.1000, 0.0200] }),
  range2: visual('rangefinder', { model: 'checkout_product_rangefinder', tier: 3, barcode: 'hang-tag', size: [0.1900, 0.1023, 0.1435] }),
  sunglasses2: visual('eyewear-case', { model: 'checkout_product_eyewear_case', tint: 0x34383a, tier: 2, barcode: 'package-back', size: [0.1600, 0.0600, 0.0700] }),
  bottle1: visual('bottle', { model: 'checkout_product_bottle', tint: 0x78957e, tier: 2, barcode: 'package-back', size: [0.0720, 0.2200, 0.0720] }),
  scorecard1: visual('scorecard', { model: 'checkout_product_scorecard', tier: 1, barcode: 'package-back', size: [0.1500, 0.0050, 0.1050] }),
  sportdrink2: visual('bottle', { model: 'checkout_product_bottle', tint: 0x7e9b4e, tier: 2, barcode: 'package-back', size: [0.0720, 0.2200, 0.0720] }),
  soda1: visual('beverage-can', { model: 'checkout_product_beverage_can', tint: 0x6b3f36, tier: 1, barcode: 'package-back', size: [0.0660, 0.1220, 0.0660] }),
  chips1: visual('snack-pouch', { model: 'checkout_product_snack_pouch', tint: 0xb08c4f, tier: 1, barcode: 'package-back', size: [0.1600, 0.1950, 0.0715] }),
  bar2: visual('snack-bar', { model: 'checkout_product_snack_bar', tint: 0x315c43, tier: 2, barcode: 'package-back', size: [0.1500, 0.0550, 0.0250] }),
  crackers1: visual('snack-pouch', { model: 'checkout_product_snack_pouch', tint: 0xc89b55, tier: 1, barcode: 'package-back', size: [0.1600, 0.1950, 0.0715] }),
  umb1: visual('umbrella', { model: 'checkout_product_umbrella', tint: 0x315c43, tier: 1, barcode: 'hang-tag', size: [0.8400, 0.1116, 0.1077], grip: 'two-hand', oversize: true }),
  bag1: visual('stand-bag', { model: 'checkout_product_stand_bag', tint: 0x315c43, tier: 2, barcode: 'hang-tag', size: [0.72, 0.25, 0.30], grip: 'two-hand', oversize: true }),
  bag3: visual('stand-bag', { model: 'checkout_product_stand_bag', tint: 0xb08c4f, tier: 3, barcode: 'hang-tag', size: [0.74, 0.265, 0.32], grip: 'two-hand', oversize: true }),

  water1: visual('water-bottle', { model: 'provisions_fairway_spring_water', raw: true, barcode: 'package-back', size: [0.068, 0.218, 0.068] }),
  snack1: visual('snack-pouch', { model: 'provisions_bunker_bites_chips', raw: true, barcode: 'package-back', size: [0.160, 0.195, 0.0715] }),

  // Equipment and decor are physical deliveries even though they never enter a
  // customer basket. Their descriptors make the opened freight truthful instead
  // of falling through to the old category-coloured cube.
  vac1: visual('packed-fixture', { model: 'delivery_fixture_product_vacuum', raw: true, barcode: 'package-back', size: [0.58, 0.36, 0.37], grip: 'two-hand', oversize: true }),
  repairkit1: visual('packed-fixture', { raw: true, barcode: 'package-back', size: [0.55, 0.30, 0.35], grip: 'two-hand', oversize: true }),
  desk1: visual('packed-furniture', { raw: true, barcode: 'package-back', size: [1.18, 0.78, 0.76], grip: 'two-hand', oversize: true }),
  chair1: visual('packed-fixture', { raw: true, barcode: 'package-back', size: [0.58, 0.40, 0.36], grip: 'two-hand', oversize: true }),
  laptop1: visual('packed-fixture', { raw: true, barcode: 'package-back', size: [0.40, 0.08, 0.30], grip: 'medium' }),
  counter1: visual('packed-furniture', { raw: true, barcode: 'package-back', size: [1.18, 0.80, 0.78], grip: 'two-hand', oversize: true }),
  shelfkit1: visual('packed-furniture', { raw: true, barcode: 'package-back', size: [1.18, 0.72, 0.52], grip: 'two-hand', oversize: true }),
  safetykit1: visual('packed-fixture', { raw: true, barcode: 'package-back', size: [0.55, 0.45, 0.25], grip: 'two-hand', oversize: true }),
  plant1: visual('packed-fixture', { model: 'delivery_fixture_product_plant', raw: true, barcode: 'package-back', size: [0.34, 0.28, 0.34], grip: 'medium' }),
  poster1: visual('packed-fixture', { model: 'delivery_fixture_product_poster', raw: true, barcode: 'package-back', size: [0.56, 0.07, 0.37], grip: 'medium' }),
  board1: visual('packed-fixture', { model: 'delivery_fixture_product_events_board', raw: true, barcode: 'package-back', size: [0.58, 0.10, 0.36], grip: 'two-hand', oversize: true }),
  light1: visual('packed-fixture', { model: 'delivery_fixture_product_pendant', raw: true, barcode: 'package-back', size: [0.36, 0.32, 0.36], grip: 'medium' }),
  rug1: visual('packed-furniture', { model: 'packed_product_rug1', raw: true, barcode: 'package-back', size: [1.18, 0.24, 0.24], grip: 'two-hand', oversize: true }),
  lounge1: visual('packed-furniture', { model: 'packed_product_lounge1', raw: true, barcode: 'package-back', size: [1.18, 0.80, 0.78], grip: 'two-hand', oversize: true }),
};

function visual(kind, options = {}) {
  return Object.freeze({
    kind,
    tier: options.tier || 1,
    model: options.model || null,
    raw: !!options.raw,
    tint: options.tint == null ? null : options.tint,
    size: options.size || null,
    length: options.length || null,
    barcodeSurface: options.barcode || 'package-back',
    gripMode: options.grip || 'small',
    separateHandoff: !!options.oversize,
    authoredRotation: options.rotation || null,
  });
}

// Furniture and facility stock uses the exact packed dimensions already owned
// by the delivery contract.  Keeping these descriptors generated from that
// authority avoids a second 140-entry list while still making every catalog ID
// explicit. Sellable products are intentionally excluded: a future retail SKU
// must name a real checkout GLB above instead of silently becoming freight.
for (const [skuId, packaging] of Object.entries(PRODUCT_PACKAGING)) {
  if (VISUALS[skuId] || packaging.retail) continue;
  const packed = packaging.packing.dimensions;
  const furniture = packaging.layoutId === 'FURNITURE1';
  const twoHand = furniture || Math.max(packed.w, packed.h, packed.d) >= 0.45;
  VISUALS[skuId] = visual(furniture ? 'packed-furniture' : 'packed-fixture', {
    raw: true,
    barcode: 'package-back',
    size: [packed.w, packed.h, packed.d],
    grip: twoHand ? 'two-hand' : 'medium',
    oversize: twoHand,
  });
}
Object.freeze(VISUALS);

// Headcovers are not currently a sellable SHOP_CATALOG line.  Classifying the name
// here makes a future catalog addition fail into a proper tagged silhouette instead
// of a box, while RETAIL coverage tests still require every actual SKU to be explicit.
const HEAD_COVER = visual('headcover', {
  model: 'checkout_product_headcover', barcode: 'apparel-tag', size: [0.14, 0.20, 0.12], grip: 'medium',
});

const UNKNOWN = visual('unknown-product', { barcode: 'package-back', size: [0.16, 0.09, 0.12] });

export function catalogProductVisual(sku) {
  if (!sku) return UNKNOWN;
  const explicit = explicitCatalogProductVisual(sku);
  if (explicit) return explicit;
  if (/head\s*cover/i.test(`${sku.id || ''} ${sku.name || ''}`)) return HEAD_COVER;
  return UNKNOWN;
}

export function explicitCatalogProductVisual(sku) {
  const id = typeof sku === 'string' ? sku : sku?.id;
  return id && Object.prototype.hasOwnProperty.call(VISUALS, id)
    ? VISUALS[id]
    : null;
}

export function explicitCatalogVisualIds() {
  return Object.keys(VISUALS);
}

function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const out = new THREE.Box3();
  let found = false;
  root.traverse((object) => {
    if (!object.isMesh || object.visible === false || !object.geometry) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    out.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    found = true;
  });
  return found ? out : new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(0.01, 0.01, 0.01));
}

function fitAuthored(object, target, rotation = null) {
  const fitted = new THREE.Group();
  fitted.add(object);
  if (rotation) object.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  let bounds = visibleBounds(fitted);
  const size = bounds.getSize(new THREE.Vector3());
  const ratios = [target[0] / Math.max(size.x, 0.0001), target[1] / Math.max(size.y, 0.0001), target[2] / Math.max(size.z, 0.0001)];
  object.scale.multiplyScalar(Math.min(...ratios));
  bounds = visibleBounds(fitted);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= bounds.min.y;
  object.position.z -= center.z;
  return fitted;
}

function authoredDimensionsMatch(object, target) {
  if (!object || !Array.isArray(target) || target.length !== 3) return false;
  const size = visibleBounds(object).getSize(new THREE.Vector3());
  return ['x', 'y', 'z'].every((axis, index) => {
    const expected = Number(target[index]);
    const actual = Number(size[axis]);
    const tolerance = Math.max(0.0015, expected * 0.01);
    return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  });
}

function authored(merch, descriptor, { rotation = null, size = descriptor.size } = {}) {
  if (!merch || !descriptor.model || typeof merch.has !== 'function' || !merch.has(descriptor.model)) return null;
  const object = descriptor.raw
    ? merch.instantiateRaw(descriptor.model)
    : merch.instantiate(descriptor.model, { tint: descriptor.tint });
  if (!object) return null;
  const metadataRoot = object.getObjectByName(descriptor.model) || object;
  if (descriptor.raw && metadataRoot.userData?.allow_runtime_scale === false) {
    if (rotation || (size && !authoredDimensionsMatch(object, size))) return null;
    object.userData.catalogRuntimeScalePolicy = 'authored-1:1';
    return object;
  }
  const authoredRotation = rotation || (descriptor.authoredRotation
    ? { x: descriptor.authoredRotation[0], y: descriptor.authoredRotation[1], z: descriptor.authoredRotation[2] }
    : null);
  return size ? fitAuthored(object, size, authoredRotation) : object;
}

function palette(mats, resources) {
  const local = new Map();
  const get = (key, color, options = {}) => {
    if (mats && mats[key]) return mats[key];
    if (!local.has(key)) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.68, ...options });
      local.set(key, resources && resources.material ? resources.material(material) : material);
    }
    return local.get(key);
  };
  return {
    cream: get('merchWhite', 0xf1ead9),
    green: get('greenPaint', 0x234b35),
    sage: get('sagePaint', 0x78957e),
    charcoal: get('charcoal', 0x34383a),
    rubber: get('merchRubber', 0x292d2c),
    steel: get('merchSteel', 0xb9bdc0, { metalness: 0.82, roughness: 0.28 }),
    brass: get('brass', 0xb89755, { metalness: 0.72, roughness: 0.34 }),
    kraft: get('kraft', 0xcbb18a),
    fabric: get('sageFabric', 0x78957e),
    white: get('merchWhite', 0xf5f1e7),
    plastic: get('merchPlastic', 0x58635d),
  };
}

function factory(root, resources, materials) {
  const geometry = (value) => resources && resources.geometry ? resources.geometry(value) : value;
  const add = (geo, material, name, parent = root) => {
    const mesh = new THREE.Mesh(geometry(geo), material);
    mesh.name = name;
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  return { add, materials };
}

function buildClub(root, descriptor, merch, F) {
  const count = descriptor.kind === 'iron-set' ? 3 : 1;
  const length = descriptor.length;
  const headX = length / 2 - 0.035;
  for (let i = 0; i < count; i++) {
    const z = (i - (count - 1) / 2) * 0.042;
    const shaft = F.add(new THREE.CylinderGeometry(0.007, 0.009, length - 0.07, 10), descriptor.kind === 'driver' ? F.materials.charcoal : F.materials.steel, `ClubShaft_${i}`);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(-0.015, 0.042 + i * 0.004, z);
    const grip = F.add(new THREE.CylinderGeometry(0.014, 0.012, 0.22, 10), F.materials.rubber, `ClubGrip_${i}`);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(-length / 2 + 0.11, 0.042 + i * 0.004, z);

    const headDescriptor = { ...descriptor, size: descriptor.kind === 'driver' ? [0.12, 0.075, 0.10] : [0.10, 0.075, 0.06] };
    const head = authored(merch, headDescriptor, { size: headDescriptor.size });
    if (head) {
      head.position.set(headX, 0.002, z);
      root.add(head);
    } else if (descriptor.kind === 'driver') {
      const fallback = F.add(new THREE.SphereGeometry(0.055, 14, 10), F.materials.charcoal, `DriverHead_${i}`);
      fallback.scale.set(1.25, 0.72, 1.0);
      fallback.position.set(headX, 0.052, z);
    } else if (descriptor.kind === 'putter') {
      const fallback = F.add(new THREE.BoxGeometry(0.13, 0.035, 0.055), F.materials.steel, `PutterHead_${i}`);
      fallback.position.set(headX, 0.022, z);
    } else {
      const fallback = F.add(new THREE.BoxGeometry(0.095, 0.072, 0.026), F.materials.steel, `IronHead_${i}`);
      fallback.rotation.y = 0.28;
      fallback.position.set(headX, 0.040, z);
    }
  }
  if (count > 1) {
    const band = F.add(new THREE.BoxGeometry(0.11, 0.055, 0.15), F.materials.green, 'IronSetBand');
    band.position.set(-0.18, 0.044, 0);
  }
}

function buildBallBox(root, descriptor, F) {
  const [w, h, d] = descriptor.size;
  const body = F.add(new THREE.BoxGeometry(w, h, d), descriptor.tier === 3 ? F.materials.green : descriptor.tier === 2 ? F.materials.charcoal : F.materials.cream, 'DozenCarton');
  body.position.y = h / 2;
  const band = F.add(new THREE.BoxGeometry(w + 0.002, h * 0.30, d + 0.002), descriptor.tier === 1 ? F.materials.green : F.materials.brass, 'DozenBand');
  band.position.y = h * 0.55;
  for (let i = 0; i < 3; i++) {
    const ball = F.add(new THREE.SphereGeometry(0.018, 10, 8), F.materials.white, `BallWindow_${i}`);
    ball.position.set((i - 1) * 0.038, h + 0.006, 0);
  }
}

function buildSimpleProduct(root, descriptor, merch, F) {
  const [w, h, d] = descriptor.size || [0.16, 0.09, 0.12];
  let model = authored(merch, descriptor);
  if (model) root.add(model);

  switch (descriptor.kind) {
    case 'glove':
      if (!model) {
        const palm = F.add(new THREE.SphereGeometry(0.052, 12, 8), F.materials.white, 'GlovePalm');
        palm.scale.set(1.05, 0.24, 1.25); palm.position.set(0.01, 0.018, 0);
        for (let i = 0; i < 4; i++) {
          const finger = F.add(new THREE.CapsuleGeometry(0.010, 0.055 + i * 0.008, 3, 6), F.materials.white, `GloveFinger_${i}`);
          finger.rotation.z = Math.PI / 2; finger.position.set(0.060 + i * 0.008, 0.018, (i - 1.5) * 0.019);
        }
      }
      break;
    case 'folded-polo':
    case 'folded-jacket':
      if (!model) {
        const cloth = descriptor.kind === 'folded-jacket' ? F.materials.charcoal : F.materials.sage;
        // A folded garment is TWO soft fabric layers with a rounded front crease, not one hard
        // brick: a lower stack, a slightly smaller upper fold set back, and a rolled front edge.
        const lower = F.add(new THREE.BoxGeometry(w, h * 0.52, d), cloth, 'FoldedGarment');
        lower.position.y = h * 0.26;
        const upper = F.add(new THREE.BoxGeometry(w * 0.96, h * 0.5, d * 0.92), cloth, 'FoldedGarmentTop');
        upper.position.set(0, h * 0.73, -d * 0.02);
        const crease = F.add(new THREE.CylinderGeometry(h * 0.24, h * 0.24, w * 0.99, 12), cloth, 'FoldCrease');
        crease.rotation.z = Math.PI / 2;
        crease.position.set(0, h * 0.42, d * 0.46);
        // a shallow seam across the top hints at the sleeve fold
        const seam = F.add(new THREE.BoxGeometry(w * 0.84, 0.003, d * 0.4), F.materials.charcoal, 'FoldSeam');
        seam.position.set(0, h * 0.985, d * 0.05);
      }
      {
        const collar = F.add(new THREE.BoxGeometry(0.078, 0.014, 0.052), F.materials.cream, 'FoldedCollar');
        collar.position.set(0, h + 0.006, -d * 0.22);
        if (descriptor.kind === 'folded-jacket') {
          const zip = F.add(new THREE.BoxGeometry(0.008, 0.012, d * 0.72), F.materials.brass, 'JacketZip');
          zip.position.set(0, h + 0.008, 0);
        }
      }
      break;
    case 'folded-bottom':
      if (!model) {
        const lower = F.add(new THREE.BoxGeometry(w, h * 0.58, d), F.materials.fabric, 'FoldedBottomFallback');
        lower.position.y = h * 0.29;
        const upper = F.add(new THREE.BoxGeometry(w * 0.95, h * 0.46, d * 0.92), F.materials.fabric, 'FoldedBottomTopFallback');
        upper.position.set(0, h * 0.76, -d * 0.02);
        const waist = F.add(new THREE.BoxGeometry(w * 0.92, h * 0.12, d * 1.01), F.materials.green, 'FoldedBottomWaistFallback');
        waist.position.y = h * 0.88;
      }
      break;
    case 'cap':
      if (!model) {
        const crown = F.add(new THREE.SphereGeometry(w * 0.36, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), F.materials.green, 'CapCrown');
        crown.scale.z = 0.86; crown.position.y = 0.025;
        const brim = F.add(new THREE.BoxGeometry(w * 0.75, 0.016, d * 0.48), F.materials.green, 'CapBrim');
        brim.position.set(0, 0.025, d * 0.34);
      }
      break;
    case 'visor':
      if (!model) {
        const band = F.add(new THREE.TorusGeometry(w * 0.39, w * 0.055, 8, 20), F.materials.green, 'VisorBandFallback');
        band.rotation.x = Math.PI / 2;
        band.position.y = h * 0.68;
        const brim = F.add(new THREE.BoxGeometry(w, h * 0.18, d * 0.52), F.materials.green, 'VisorBrimFallback');
        brim.position.set(0, h * 0.10, d * 0.12);
      }
      break;
    case 'shoe-pair':
      if (!model) {
        for (const z of [-0.055, 0.055]) {
          const upper = F.add(new THREE.CapsuleGeometry(0.045, 0.15, 4, 8), F.materials.white, `ShoeUpper_${z}`);
          upper.rotation.z = Math.PI / 2; upper.scale.y = 0.75; upper.position.set(0, 0.062, z);
          const sole = F.add(new THREE.BoxGeometry(0.23, 0.022, 0.085), F.materials.rubber, `ShoeSole_${z}`);
          sole.position.set(0, 0.012, z);
        }
      }
      break;
    case 'shoe-box':
      if (!model) {
        const box = F.add(new THREE.BoxGeometry(w, h, d), F.materials.charcoal, 'RetailShoeBox');
        box.position.y = h / 2;
        const lid = F.add(new THREE.BoxGeometry(w + 0.004, h * 0.22, d + 0.004), F.materials.green, 'RetailShoeBoxLid');
        lid.position.y = h * 0.91;
        const label = F.add(new THREE.BoxGeometry(w * 0.46, h * 0.42, 0.003), F.materials.cream, 'RetailShoeBoxLabel');
        label.position.set(0, h * 0.48, d / 2 + 0.002);
      }
      break;
    case 'sock-pair':
      for (const z of [-0.028, 0.028]) {
        const roll = F.add(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 10), F.materials.cream, `SockRoll_${z}`);
        roll.rotation.z = Math.PI / 2; roll.position.set(0, 0.038, z);
      }
      {
        const band = F.add(new THREE.BoxGeometry(0.055, 0.078, d + 0.008), F.materials.green, 'SockBand');
        band.position.y = 0.039;
      }
      break;
    case 'tee-pouch':
      {
        const pouch = F.add(new THREE.BoxGeometry(w, h, d), F.materials.kraft, 'TeePouch');
        pouch.position.y = h / 2;
        for (let i = 0; i < 5; i++) {
          const tee = F.add(new THREE.CylinderGeometry(0.003, 0.005, h * 0.62, 6), F.materials.cream, `VisibleTee_${i}`);
          tee.position.set((i - 2) * 0.018, h * 0.52, -d * 0.53);
          tee.rotation.z = (i - 2) * 0.035;
        }
        const seal = F.add(new THREE.BoxGeometry(w * 0.72, 0.018, d + 0.004), F.materials.green, 'TeePouchSeal');
        seal.position.y = h * 0.77;
      }
      break;
    case 'towel-roll':
      {
        const towel = F.add(new THREE.CylinderGeometry(h / 2, h / 2, w, 14), F.materials.sage, 'TowelRoll');
        towel.rotation.z = Math.PI / 2; towel.position.y = h / 2;
        const strap = F.add(new THREE.CylinderGeometry(h * 0.52, h * 0.52, 0.032, 14, 1, true), F.materials.green, 'TowelStrap');
        strap.rotation.z = Math.PI / 2; strap.position.y = h / 2;
      }
      break;
    case 'marker-card':
      {
        const card = F.add(new THREE.BoxGeometry(w, h, d), F.materials.cream, 'MarkerBackingCard');
        card.position.y = h / 2;
        for (const x of [-0.032, 0.032]) {
          const marker = F.add(new THREE.CylinderGeometry(0.025, 0.025, d + 0.006, 20), x < 0 ? F.materials.brass : F.materials.green, `BallMarker_${x}`);
          marker.rotation.x = Math.PI / 2; marker.position.set(x, h * 0.48, -d * 0.58);
        }
      }
      break;
    case 'divot-card':
      if (!model) {
        const card = F.add(new THREE.BoxGeometry(w, h, d), F.materials.cream, 'DivotBackingFallback');
        card.position.y = h / 2;
        for (const x of [-0.018, 0.018]) {
          const tine = F.add(new THREE.BoxGeometry(0.010, h * 0.48, d + 0.004), F.materials.steel, `DivotTine_${x}`);
          tine.position.set(x, h * 0.37, -d * 0.54);
        }
      }
      break;
    case 'rangefinder':
      if (!model) {
        const body = F.add(new THREE.CapsuleGeometry(0.048, 0.09, 4, 10), F.materials.charcoal, 'RangefinderBody');
        body.rotation.z = Math.PI / 2; body.position.y = h * 0.55;
        for (const x of [-0.065, 0.065]) {
          const lens = F.add(new THREE.CylinderGeometry(0.032, 0.032, 0.018, 16), F.materials.brass, `RangefinderLens_${x}`);
          lens.rotation.z = Math.PI / 2; lens.position.set(x, h * 0.55, 0);
        }
      }
      break;
    case 'eyewear-case':
      if (!model) {
        const eyewearCase = F.add(new THREE.BoxGeometry(w, h, d), F.materials.charcoal, 'EyewearCaseFallback');
        eyewearCase.position.y = h / 2;
        const hinge = F.add(new THREE.BoxGeometry(w * 0.62, h * 0.06, d * 1.01), F.materials.brass, 'EyewearCaseHingeFallback');
        hinge.position.y = h * 0.55;
      }
      break;
    case 'umbrella':
      {
        const shaft = F.add(new THREE.CylinderGeometry(0.009, 0.009, w * 0.84, 8), F.materials.steel, 'UmbrellaShaft');
        shaft.rotation.z = Math.PI / 2; shaft.position.set(-w * 0.03, 0.045, 0);
        const canopy = F.add(new THREE.ConeGeometry(0.052, w * 0.66, 12), F.materials.green, 'FoldedCanopy');
        canopy.rotation.z = -Math.PI / 2; canopy.position.set(0.02, 0.045, 0);
        const handle = F.add(new THREE.TorusGeometry(0.035, 0.008, 8, 16, Math.PI * 1.35), F.materials.charcoal, 'UmbrellaHandle');
        handle.rotation.y = Math.PI / 2; handle.position.set(-w * 0.48, 0.055, 0);
      }
      break;
    case 'stand-bag':
      if (!model) {
        const body = F.add(new THREE.CylinderGeometry(h * 0.36, h * 0.46, w * 0.78, 14), F.materials.green, 'StandBagBody');
        body.rotation.z = Math.PI / 2; body.position.set(0, h * 0.48, 0);
        for (const z of [-0.075, 0.075]) {
          const leg = F.add(new THREE.CylinderGeometry(0.008, 0.008, w * 0.60, 8), F.materials.steel, `StandBagLeg_${z}`);
          leg.rotation.z = Math.PI / 2 - 0.20; leg.position.set(-0.03, 0.07, z);
        }
      }
      break;
    case 'water-bottle':
      if (!model) {
        const bottle = F.add(new THREE.CylinderGeometry(w * 0.42, w * 0.50, h * 0.84, 12), F.materials.white, 'WaterBottleFallback');
        bottle.position.y = h * 0.44;
        const cap = F.add(new THREE.CylinderGeometry(w * 0.28, w * 0.28, h * 0.14, 12), F.materials.green, 'WaterCapFallback');
        cap.position.y = h * 0.93;
      }
      break;
    case 'bottle':
      if (!model) {
        const bottle = F.add(new THREE.CylinderGeometry(w * 0.50, w * 0.50, h * 0.84, 16), F.materials.plastic, 'BottleFallback');
        bottle.position.y = h * 0.42;
        const label = F.add(new THREE.CylinderGeometry(w * 0.505, w * 0.505, h * 0.32, 16), F.materials.green, 'BottleLabelFallback');
        label.position.y = h * 0.46;
        const cap = F.add(new THREE.CylinderGeometry(w * 0.30, w * 0.30, h * 0.16, 12), F.materials.charcoal, 'BottleCapFallback');
        cap.position.y = h * 0.92;
      }
      break;
    case 'beverage-can':
      if (!model) {
        const can = F.add(new THREE.CylinderGeometry(w * 0.50, w * 0.50, h, 18), F.materials.green, 'BeverageCanFallback');
        can.position.y = h / 2;
      }
      break;
    case 'scorecard':
      if (!model) {
        const scorecard = F.add(new THREE.BoxGeometry(w, h, d), F.materials.cream, 'ScorecardFallback');
        scorecard.position.y = h / 2;
        const fold = F.add(new THREE.BoxGeometry(0.002, h + 0.001, d + 0.002), F.materials.brass, 'ScorecardFoldFallback');
        fold.position.y = h / 2;
      }
      break;
    case 'snack-pouch':
      if (!model) {
        const pouch = F.add(new THREE.BoxGeometry(w, h, d), F.materials.green, 'SnackPouchFallback');
        pouch.position.y = h / 2;
      }
      break;
    case 'snack-bar':
      if (!model) {
        const bar = F.add(new THREE.BoxGeometry(w, h, d), F.materials.green, 'SnackBarFallback');
        bar.position.y = h / 2;
        for (const x of [-w * 0.44, w * 0.44]) {
          const crimp = F.add(new THREE.BoxGeometry(w * 0.12, h * 1.02, d * 1.02), F.materials.cream, `SnackBarCrimp_${x}`);
          crimp.position.set(x, h / 2, 0);
        }
      }
      break;
    case 'packed-fixture':
    case 'packed-furniture':
      if (!model) {
        const pack = F.add(new THREE.BoxGeometry(w, h, d), F.materials.kraft, 'PackedFreightFallback');
        pack.position.y = h / 2;
        const strap = F.add(new THREE.BoxGeometry(w * 1.01, Math.min(0.035, h * 0.12), d * 1.01), F.materials.green, 'PackedFreightStrap');
        strap.position.y = h * 0.55;
      }
      break;
    case 'headcover':
      {
        const hood = F.add(new THREE.CapsuleGeometry(w * 0.34, h * 0.34, 5, 10), F.materials.green, 'HeadcoverHood');
        hood.position.y = h * 0.48;
        const sock = F.add(new THREE.CylinderGeometry(w * 0.28, w * 0.25, h * 0.48, 12), F.materials.charcoal, 'HeadcoverSock');
        sock.position.y = h * 0.24;
      }
      break;
    case 'unknown-product':
      {
        const pack = F.add(new THREE.BoxGeometry(w, h, d), F.materials.kraft, 'UnknownRetailPack');
        pack.position.y = h / 2;
      }
      break;
    default:
      break;
  }
}

function makeAnchor(
  root,
  descriptor,
  resources,
  materials,
  authoredAnchor = null,
  { includeCheckoutSwingTag = true } = {},
) {
  const bounds = visibleBounds(root);
  const size = bounds.getSize(new THREE.Vector3());
  const anchor = new THREE.Object3D();
  anchor.name = 'RuntimeProductBarcodeAnchor';
  const tagSurface = ['club-tag', 'hang-tag', 'apparel-tag'].includes(descriptor.barcodeSurface);
  if (authoredAnchor) {
    root.updateMatrixWorld(true);
    authoredAnchor.getWorldPosition(anchor.position);
    root.worldToLocal(anchor.position);
  } else if (descriptor.barcodeSurface === 'package-side') {
    anchor.position.set(0, bounds.min.y + size.y * 0.48, bounds.min.z - 0.0025);
  } else if (descriptor.barcodeSurface === 'package-back') {
    anchor.position.set(0, bounds.min.y + size.y * 0.52, bounds.max.z + 0.0025);
  } else {
    const x = descriptor.kind === 'stand-bag' ? bounds.max.x - size.x * 0.22 : bounds.min.x + size.x * 0.28;
    const y = descriptor.kind.includes('club') || ['driver', 'putter', 'wedge', 'iron-set', 'umbrella'].includes(descriptor.kind)
      ? bounds.min.y + Math.min(0.095, size.y * 0.72)
      : bounds.min.y + size.y * 0.48;
    anchor.position.set(x, y, bounds.min.z - 0.007);
  }
  // The authored anchor owns label position. Orientation is deliberately a logical
  // surface contract: Blender anchors are neutral transforms, while PlaneGeometry's
  // +Z is the scan normal. Package backs face +Z; every cashier-side swing tag and
  // carton side faces -Z until the player physically rotates it.
  if (descriptor.barcodeSurface !== 'package-back') anchor.rotation.y = Math.PI;
  root.add(anchor);

  if (tagSurface && includeCheckoutSwingTag) {
    const F = factory(anchor, resources, materials);
    const backing = F.add(new THREE.PlaneGeometry(0.078, 0.046), materials.kraft, 'ProductSwingTag', anchor);
    backing.position.z = -0.0015;
  }
  return anchor;
}

function makeGripAnchors(root, descriptor) {
  const authoredPrimary = root.getObjectByName('ANCHOR_ProductGripPrimary')
    || root.getObjectByName('PICKUP_TARGET');
  const authoredSecondary = root.getObjectByName('ANCHOR_ProductGripSecondary');
  if (authoredPrimary && (descriptor.gripMode !== 'two-hand' || authoredSecondary)) {
    return { primary: authoredPrimary, secondary: authoredSecondary || null };
  }
  const bounds = visibleBounds(root);
  const size = bounds.getSize(new THREE.Vector3());
  const primary = authoredPrimary || new THREE.Object3D();
  if (!authoredPrimary) {
    primary.name = 'ANCHOR_ProductGripPrimary';
    primary.position.set(0, bounds.min.y + Math.min(size.y * 0.55, 0.11), 0);
    root.add(primary);
  }
  let secondary = null;
  if (descriptor.gripMode === 'two-hand') {
    secondary = new THREE.Object3D();
    secondary.name = 'ANCHOR_ProductGripSecondary';
    if (authoredPrimary) {
      // Packed fixture and furniture GLBs own an exact PICKUP_TARGET but only one
      // hand socket. Preserve that authored primary pivot. The support hand follows
      // its orientation along the product's widest horizontal axis, expressed back
      // in root-local metres so fitting/parent transforms cannot distort spacing.
      root.updateMatrixWorld(true);
      const primaryWorld = authoredPrimary.getWorldPosition(new THREE.Vector3());
      const primaryLocal = root.worldToLocal(primaryWorld.clone());
      const targetWorldRotation = authoredPrimary.getWorldQuaternion(new THREE.Quaternion());
      const rootWorldRotation = root.getWorldQuaternion(new THREE.Quaternion());
      const majorAxis = size.x >= size.z
        ? new THREE.Vector3(-1, 0, 0)
        : new THREE.Vector3(0, 0, -1);
      const rootDirection = majorAxis
        .applyQuaternion(targetWorldRotation)
        .applyQuaternion(rootWorldRotation.invert())
        .normalize();
      const horizontalExtent = Math.max(size.x, size.z);
      secondary.position.copy(primaryLocal).addScaledVector(
        rootDirection,
        Math.min(0.24, horizontalExtent * 0.24),
      );
    } else {
      secondary.position.copy(primary.position);
      secondary.position.x -= Math.min(0.24, size.x * 0.24);
    }
    root.add(secondary);
  }
  return { primary, secondary };
}

export function buildCatalogProductProxy({
  sku,
  merch = null,
  mats = null,
  resources = null,
  context = 'checkout',
} = {}) {
  const descriptor = catalogProductVisual(sku);
  const packedDeliveryContext = context === 'delivery-packed'
    || context === 'delivery'
    || context === 'packed';
  const root = new THREE.Group();
  root.name = `CheckoutProduct_${sku && sku.id ? sku.id : 'unknown'}`;
  const materials = palette(mats, resources);
  const F = factory(root, resources, materials);

  // Production always prefers the repeatable Blender family GLB. Procedural forms
  // are retained only as a defensive loading/missing-file fallback so a checkout can
  // recover instead of deleting the shopper's product.
  const production = authored(merch, descriptor);
  if (production) root.add(production);
  else if (['driver', 'iron-set', 'putter', 'wedge'].includes(descriptor.kind)) buildClub(root, descriptor, null, F);
  else if (descriptor.kind === 'ball-box') buildBallBox(root, descriptor, F);
  else buildSimpleProduct(root, descriptor, null, F);

  const barcodeAnchor = makeAnchor(
    root,
    descriptor,
    resources,
    materials,
    root.getObjectByName('ANCHOR_ProductBarcode') || root.getObjectByName('BARCODE_AREA'),
    { includeCheckoutSwingTag: !packedDeliveryContext },
  );
  const gripAnchors = makeGripAnchors(root, descriptor);
  root.userData.catalogVisual = descriptor;
  root.userData.gripMode = descriptor.gripMode;
  root.userData.separateHandoff = descriptor.separateHandoff;
  root.userData.gripPrimary = gripAnchors.primary;
  root.userData.gripSecondary = gripAnchors.secondary;
  root.userData.catalogProductContext = context;
  root.traverse((object) => { if (object.isMesh) object.castShadow = true; });
  return { root, descriptor, barcodeAnchor, gripAnchors };
}

// One deterministic layout is used by the customer's placement proxy and the
// register-owned replacement, preventing a pop when ownership changes. Long goods
// lie across the staging tray; compact goods occupy the remaining customer-side row.
export function catalogCheckoutLayout(items, staging, restY) {
  const source = items || [];
  const descriptors = source.map((item) => catalogProductVisual(item && (item.sku || item)));
  const large = [];
  const compact = [];
  descriptors.forEach((descriptor, index) => (descriptor.separateHandoff ? large : compact).push(index));
  const poses = new Array(source.length);
  const localCorners = [
    frontDeskLocalPoint(staging.minX, staging.minZ),
    frontDeskLocalPoint(staging.minX, staging.maxZ),
    frontDeskLocalPoint(staging.maxX, staging.minZ),
    frontDeskLocalPoint(staging.maxX, staging.maxZ),
  ];
  const localStaging = {
    minX: Math.min(...localCorners.map((point) => point.x)),
    maxX: Math.max(...localCorners.map((point) => point.x)),
    minZ: Math.min(...localCorners.map((point) => point.z)),
    maxZ: Math.max(...localCorners.map((point) => point.z)),
  };
  const centerX = (localStaging.minX + localStaging.maxX) / 2;
  const poseAt = (x, z, localRy, sizeClass) => {
    const pose = frontDeskPose(x, z, localRy);
    return { x: pose.x, y: restY, z: pose.z, ry: pose.ry, sizeClass };
  };

  large.forEach((index, order) => {
    const z = Math.min(
      localStaging.maxZ - 0.055,
      localStaging.minZ + 0.055 + order * 0.075,
    );
    poses[index] = poseAt(centerX, z, order % 2 ? 0.06 : -0.05, 'oversize');
  });

  if (large.length) {
    compact.forEach((index, order) => {
      const count = compact.length;
      const span = Math.max(0, localStaging.maxX - localStaging.minX - 0.28);
      const x = count <= 1
        ? centerX
        : localStaging.minX + 0.14 + order * (span / Math.max(1, count - 1));
      poses[index] = poseAt(
        x,
        localStaging.maxZ - 0.06,
        (order - (count - 1) / 2) * 0.12,
        'compact',
      );
    });
    return poses;
  }

  const cols = Math.min(3, Math.max(1, compact.length));
  compact.forEach((index, order) => {
    const cx = order % cols;
    const cz = Math.floor(order / cols);
    const span = localStaging.maxX - localStaging.minX - 0.28;
    const x = localStaging.minX + 0.14 + cx * ((span / Math.max(1, cols - 1)) || 0);
    const z = Math.min(localStaging.minZ + 0.09 + cz * 0.14, localStaging.maxZ - 0.06);
    poses[index] = poseAt(x, z, (order * 0.7) % 1.2 - 0.6, 'compact');
  });
  return poses;
}

function path(ctx, points, close = false) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  if (close) ctx.closePath();
}

// Reusable physical-POS thumbnail. It intentionally draws a product silhouette,
// never category initials; tier dots distinguish value/standard/premium siblings.
export function drawProductThumbnail(ctx, sku, x, y, active = true, size = 16) {
  const descriptor = catalogProductVisual(sku);
  const fg = active ? '#fff8e8' : '#777e78';
  const bg = active
    ? ({ 1: '#607c68', 2: '#385d4a', 3: '#9a7430' }[descriptor.tier] || '#607c68')
    : '#b8b9af';
  const s = size;
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.lineWidth = Math.max(1, s * 0.085);
  const k = s / 16;

  if (['driver', 'iron-set', 'putter', 'wedge'].includes(descriptor.kind)) {
    ctx.beginPath(); ctx.moveTo(x + 4 * k, y + 2 * k); ctx.lineTo(x + 10.5 * k, y + 12.5 * k); ctx.stroke();
    if (descriptor.kind === 'driver') { ctx.beginPath(); ctx.ellipse(x + 11.8 * k, y + 12.7 * k, 3.0 * k, 1.8 * k, 0.28, 0, Math.PI * 2); ctx.fill(); }
    else if (descriptor.kind === 'putter') ctx.fillRect(x + 9.5 * k, y + 12.1 * k, 5 * k, 1.8 * k);
    else { path(ctx, [[x + 9.7 * k, y + 10.8 * k], [x + 14 * k, y + 12.2 * k], [x + 12.2 * k, y + 15 * k]], true); ctx.fill(); }
    if (descriptor.kind === 'iron-set') {
      ctx.beginPath(); ctx.moveTo(x + 6 * k, y + 2 * k); ctx.lineTo(x + 12.5 * k, y + 11.8 * k); ctx.stroke();
    }
  } else if (descriptor.kind === 'ball-box') {
    ctx.strokeRect(x + 2.5 * k, y + 4 * k, 11 * k, 8 * k);
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + (5 + i * 3) * k, y + 8 * k, 1.25 * k, 0, Math.PI * 2); ctx.fill(); }
  } else if (descriptor.kind === 'glove') {
    path(ctx, [[x + 5 * k, y + 14 * k], [x + 4 * k, y + 7 * k], [x + 5 * k, y + 2 * k], [x + 6.2 * k, y + 7 * k], [x + 7.2 * k, y + 1.5 * k], [x + 8.3 * k, y + 7 * k], [x + 9.5 * k, y + 2.2 * k], [x + 10.3 * k, y + 8 * k], [x + 13 * k, y + 6 * k], [x + 12.3 * k, y + 12 * k], [x + 9 * k, y + 15 * k]], true); ctx.fill();
  } else if (descriptor.kind === 'folded-polo' || descriptor.kind === 'folded-jacket' || descriptor.kind === 'folded-bottom') {
    path(ctx, [[x + 5 * k, y + 3 * k], [x + 2 * k, y + 6 * k], [x + 4 * k, y + 8 * k], [x + 5 * k, y + 7 * k], [x + 5 * k, y + 14 * k], [x + 11 * k, y + 14 * k], [x + 11 * k, y + 7 * k], [x + 12 * k, y + 8 * k], [x + 14 * k, y + 6 * k], [x + 11 * k, y + 3 * k]], true); ctx.fill();
    if (descriptor.kind === 'folded-jacket') { ctx.strokeStyle = bg; ctx.beginPath(); ctx.moveTo(cx, y + 5 * k); ctx.lineTo(cx, y + 14 * k); ctx.stroke(); }
    if (descriptor.kind === 'folded-bottom') { ctx.strokeStyle = bg; ctx.beginPath(); ctx.moveTo(cx, y + 8 * k); ctx.lineTo(cx, y + 14 * k); ctx.stroke(); }
  } else if (descriptor.kind === 'cap') {
    ctx.beginPath(); ctx.arc(cx, y + 9 * k, 4.5 * k, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 11 * k, y + 10 * k, 4 * k, 1.5 * k, 0.15, 0, Math.PI * 2); ctx.fill();
  } else if (descriptor.kind === 'visor') {
    ctx.beginPath(); ctx.arc(cx, y + 8 * k, 4.5 * k, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.fillRect(x + 4 * k, y + 7 * k, 8 * k, 2.5 * k);
    ctx.beginPath(); ctx.ellipse(x + 10.5 * k, y + 10 * k, 4.2 * k, 1.5 * k, 0.12, 0, Math.PI * 2); ctx.fill();
  } else if (descriptor.kind === 'shoe-pair') {
    path(ctx, [[x + 2 * k, y + 10 * k], [x + 6 * k, y + 9 * k], [x + 9 * k, y + 5 * k], [x + 11 * k, y + 7 * k], [x + 14 * k, y + 10 * k], [x + 13 * k, y + 13 * k], [x + 3 * k, y + 13 * k]], true); ctx.fill();
  } else if (descriptor.kind === 'shoe-box') {
    ctx.strokeRect(x + 2 * k, y + 5 * k, 12 * k, 8 * k);
    ctx.fillRect(x + 2 * k, y + 4 * k, 12 * k, 2 * k);
    ctx.strokeRect(x + 8.5 * k, y + 7 * k, 4 * k, 3 * k);
  } else if (descriptor.kind === 'sock-pair') {
    path(ctx, [[x + 4 * k, y + 2 * k], [x + 9 * k, y + 2 * k], [x + 9 * k, y + 9 * k], [x + 13 * k, y + 11 * k], [x + 12 * k, y + 14 * k], [x + 7 * k, y + 12 * k], [x + 4 * k, y + 9 * k]], true); ctx.fill();
  } else if (descriptor.kind === 'tee-pouch') {
    ctx.strokeRect(x + 3 * k, y + 2 * k, 10 * k, 12 * k);
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + (6 + i * 2) * k, y + 5 * k); ctx.lineTo(x + (6 + i * 2) * k, y + 11 * k); ctx.stroke(); }
  } else if (descriptor.kind === 'towel-roll') {
    ctx.beginPath(); ctx.ellipse(x + 5 * k, cy, 3 * k, 5 * k, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillRect(x + 5 * k, y + 3 * k, 7 * k, 10 * k);
  } else if (descriptor.kind === 'marker-card') {
    ctx.strokeRect(x + 2.5 * k, y + 2 * k, 11 * k, 12 * k);
    for (const dx of [-2.2, 2.2]) { ctx.beginPath(); ctx.arc(cx + dx * k, cy, 2.1 * k, 0, Math.PI * 2); ctx.fill(); }
  } else if (descriptor.kind === 'divot-card') {
    ctx.strokeRect(x + 3 * k, y + 2 * k, 10 * k, 12 * k);
    ctx.fillRect(x + 6 * k, y + 6 * k, 4 * k, 3 * k);
    ctx.beginPath(); ctx.moveTo(x + 6.5 * k, y + 8 * k); ctx.lineTo(x + 6.5 * k, y + 13 * k); ctx.moveTo(x + 9.5 * k, y + 8 * k); ctx.lineTo(x + 9.5 * k, y + 13 * k); ctx.stroke();
  } else if (descriptor.kind === 'rangefinder') {
    path(ctx, [[x + 3 * k, y + 5 * k], [x + 11 * k, y + 4 * k], [x + 14 * k, y + 7 * k], [x + 12 * k, y + 12 * k], [x + 4 * k, y + 12 * k], [x + 2 * k, y + 9 * k]], true); ctx.fill();
    ctx.strokeStyle = bg; ctx.beginPath(); ctx.arc(x + 11.5 * k, y + 7.5 * k, 1.8 * k, 0, Math.PI * 2); ctx.stroke();
  } else if (descriptor.kind === 'eyewear-case') {
    ctx.beginPath(); ctx.ellipse(cx, cy, 6 * k, 3.5 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = bg; ctx.beginPath(); ctx.moveTo(x + 4 * k, cy); ctx.lineTo(x + 12 * k, cy); ctx.stroke();
  } else if (descriptor.kind === 'umbrella') {
    ctx.beginPath(); ctx.arc(cx, y + 8 * k, 6 * k, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, y + 8 * k); ctx.lineTo(cx, y + 13 * k); ctx.arc(cx + 1.5 * k, y + 13 * k, 1.5 * k, Math.PI, 0); ctx.stroke();
  } else if (descriptor.kind === 'stand-bag') {
    path(ctx, [[x + 6 * k, y + 2 * k], [x + 11 * k, y + 2 * k], [x + 13 * k, y + 13 * k], [x + 4 * k, y + 13 * k]], true); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 5 * k, y + 13 * k); ctx.lineTo(x + 2 * k, y + 15 * k); ctx.moveTo(x + 12 * k, y + 13 * k); ctx.lineTo(x + 15 * k, y + 15 * k); ctx.stroke();
  } else if (descriptor.kind === 'headcover') {
    ctx.beginPath(); ctx.ellipse(cx, y + 6 * k, 4.5 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x + 6 * k, y + 7 * k, 4 * k, 7 * k);
  } else if (descriptor.kind === 'water-bottle' || descriptor.kind === 'bottle') {
    ctx.fillRect(x + 5 * k, y + 4 * k, 6 * k, 10 * k);
    ctx.fillRect(x + 6.5 * k, y + 2 * k, 3 * k, 3 * k);
    ctx.strokeStyle = bg; ctx.strokeRect(x + 5 * k, y + 7 * k, 6 * k, 4 * k);
  } else if (descriptor.kind === 'beverage-can') {
    ctx.fillRect(x + 5 * k, y + 3 * k, 6 * k, 11 * k);
    ctx.strokeStyle = bg; ctx.beginPath(); ctx.ellipse(cx, y + 3 * k, 3 * k, 1.2 * k, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (descriptor.kind === 'scorecard') {
    ctx.strokeRect(x + 2 * k, y + 4 * k, 12 * k, 8 * k);
    ctx.beginPath(); ctx.moveTo(cx, y + 4 * k); ctx.lineTo(cx, y + 12 * k); ctx.moveTo(x + 3 * k, y + 8 * k); ctx.lineTo(x + 13 * k, y + 8 * k); ctx.stroke();
  } else if (descriptor.kind === 'snack-pouch') {
    path(ctx, [[x + 4 * k, y + 2 * k], [x + 12 * k, y + 2 * k], [x + 13 * k, y + 14 * k], [x + 3 * k, y + 14 * k]], true); ctx.fill();
    ctx.strokeStyle = bg; ctx.beginPath(); ctx.moveTo(x + 4 * k, y + 5 * k); ctx.lineTo(x + 12 * k, y + 5 * k); ctx.stroke();
  } else if (descriptor.kind === 'snack-bar') {
    ctx.fillRect(x + 2 * k, y + 5 * k, 12 * k, 6 * k);
    ctx.strokeStyle = bg; ctx.beginPath(); ctx.moveTo(x + 4 * k, y + 5 * k); ctx.lineTo(x + 4 * k, y + 11 * k); ctx.moveTo(x + 12 * k, y + 5 * k); ctx.lineTo(x + 12 * k, y + 11 * k); ctx.stroke();
  } else {
    ctx.strokeRect(x + 3 * k, y + 3 * k, 10 * k, 10 * k);
  }

  ctx.fillStyle = active ? '#d8bd7c' : '#949891';
  for (let i = 0; i < descriptor.tier; i++) {
    ctx.beginPath(); ctx.arc(x + (2.1 + i * 2.1) * k, y + 14.2 * k, 0.65 * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  return descriptor.kind;
}
