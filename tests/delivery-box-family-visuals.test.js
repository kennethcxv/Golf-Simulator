import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { BOX_KINDS } from '../src/data/boxes.js';
import { PACKAGING_SHELLS } from '../src/data/productPackaging.js';
import {
  DELIVERY_MODEL_BY_BOX_KIND,
  GENERIC_CARTON_SOURCE_DIMENSIONS,
  applyDeliveryDynamicLabelMaterial,
  canBuildDeliveryBoxVisual,
  createDeliveryBoxVisual,
  deliveryContentContract,
  deliveryBoxModelScale,
  deliveryBoxVisualConfig,
  deliveryProductScaleCompensation,
  selectDeliveryDynamicLabelMesh,
  selectDeliveryContentLayout,
} from '../src/render3d/clubhouse/deliveryBoxVisual.js';

const EXPECTED_MODELS = Object.freeze({
  carton: 'delivery_accessory_carton',
  ballcase: 'delivery_golf_ball_case',
  merchbox: 'delivery_generic_merchandise_box',
  apparel: 'delivery_apparel_box',
  shoebox: 'delivery_shoe_carton',
  clubbox: 'delivery_golf_club_box',
  bagcarton: 'delivery_golf_bag_carton',
  fixture: 'delivery_fixture_package',
  crate: 'delivery_furniture_crate',
  provisions: 'delivery_bulk_provisions_carton',
  umbrella: 'delivery_umbrella_carton',
  ironset: 'delivery_iron_set_carton',
});

const EXAMPLE_SKU_BY_KIND = Object.freeze({
  carton: ['tees1', 'checkout_product_tee_pouch'],
  ballcase: ['balls1', 'checkout_product_ball_carton'],
  merchbox: ['cap1', 'checkout_product_cap'],
  apparel: ['polo1', 'checkout_product_folded_polo'],
  shoebox: ['shoe1', 'checkout_product_shoe_box'],
  clubbox: ['driver1', 'checkout_product_driver'],
  bagcarton: ['bag1', 'checkout_product_stand_bag'],
  fixture: ['vac1', 'delivery_fixture_product_vacuum'],
  crate: ['rug1', 'packed_product_rug1'],
  provisions: ['water1', 'provisions_fairway_spring_water'],
  umbrella: ['umb1', 'checkout_product_umbrella'],
  ironset: ['irons1', 'checkout_product_iron_set'],
});

function authoredCartonStub(model, layoutId, capacity, {
  skuId = 'stub-sku',
  shellId = 'STUB_SHELL',
  packingState = 'stub-packed-state',
} = {}) {
  const scene = new THREE.Group();
  const carton = new THREE.Group();
  carton.name = model;
  scene.add(carton);
  for (const side of ['FRONT', 'BACK', 'LEFT', 'RIGHT']) {
    const wall = new THREE.Group();
    wall.name = `BOX_WALL_${side}`;
    if (layoutId === 'BAG1' && side === 'FRONT') {
      wall.userData.reveal_contents = true;
      wall.userData.open_reveal_angle_deg = 82;
      wall.userData.hinge_axis = 'X';
    }
    carton.add(wall);
    const flap = new THREE.Group();
    flap.name = `BOX_FLAP_${side}`;
    carton.add(flap);
  }
  const tape = new THREE.Group();
  tape.name = 'TAPE_CENTER';
  carton.add(tape);
  for (let index = 1; index <= 2; index += 1) {
    const segment = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.002, 0.12));
    segment.name = `TAPE_CENTER_SEG_${String(index).padStart(2, '0')}`;
    segment.userData.cut_order = index;
    tape.add(segment);
  }
  const cutPath = new THREE.Object3D();
  cutPath.name = 'CUT_PATH';
  cutPath.userData.points = JSON.stringify([[0, -0.12, 0.42], [0, 0.12, 0.42]]);
  cutPath.userData.segment_nodes = JSON.stringify([
    'TAPE_CENTER_SEG_01',
    'TAPE_CENTER_SEG_02',
  ]);
  carton.add(cutPath);
  const layout = new THREE.Group();
  layout.name = `CONTENT_LAYOUT_${layoutId}`;
  layout.userData = {
    layout_id: layoutId,
    capacity,
    allowed_skus: JSON.stringify([skuId]),
    packaging_state: packingState,
    physical_shell_id: model,
    packaging_shell_id: shellId,
    socket_prefix: `CONTENT_SLOT_${layoutId}_`,
    selection_rule: 'exact_sku_category_quantity_dimensions_packaging_state',
    content_scale: 1,
    allow_scale: false,
  };
  carton.add(layout);
  for (let index = 1; index <= capacity; index += 1) {
    const socket = new THREE.Object3D();
    socket.name = `CONTENT_SLOT_${layoutId}_${String(index).padStart(2, '0')}`;
    socket.position.set(index % 2 ? -0.14 : 0.14, index > 4 ? 0.14 : 0.05, index % 4 > 1 ? -0.10 : 0.10);
    socket.userData = {
      anchor_kind: 'box_content',
      layout_id: layoutId,
      slot_index: index,
      allowed_skus: JSON.stringify([skuId]),
      packaging_state: packingState,
      packaging_shell_id: shellId,
      content_scale: 1,
      allow_scale: false,
      visible_when_remaining_at_least: capacity - index + 1,
    };
    if (layoutId === 'BAG1') socket.rotation.z = Math.PI / 2;
    layout.add(socket);
  }
  const flat = new THREE.Group();
  flat.name = 'BOX_FLAT_BUNDLE';
  carton.add(flat);
  return scene;
}

function authoredProductStub(model, size = [0.2, 0.1, 0.15]) {
  const root = new THREE.Group();
  root.name = model;
  const product = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
  product.name = `${model}_VisibleProduct`;
  product.position.y = size[1] / 2;
  root.add(product);
  const barcode = new THREE.Object3D();
  barcode.name = 'ANCHOR_ProductBarcode';
  root.add(barcode);
  const grip = new THREE.Object3D();
  grip.name = 'ANCHOR_ProductGripPrimary';
  root.add(grip);
  return root;
}

function nearlyEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} !== ${expected}`);
}

test('every production BOX_KINDS family has an explicit authored visual mapping', () => {
  assert.deepEqual(
    new Set(Object.keys(DELIVERY_MODEL_BY_BOX_KIND)),
    new Set(Object.keys(BOX_KINDS)),
    'adding a shipping family without a visual config must be an explicit failure',
  );

  for (const [kind, box] of Object.entries(BOX_KINDS)) {
    const visual = deliveryBoxVisualConfig(kind);
    assert.ok(visual, `${kind} has a visual config`);
    assert.equal(visual.model, DELIVERY_MODEL_BY_BOX_KIND[kind], `${kind} model map agrees`);
    assert.deepEqual(visual.targetDimensions, [box.w, box.h, box.d], `${kind} data-owned dimensions`);
    assert.ok(String(visual.shippingClass).trim(), `${kind} has an honest shipping class label`);
    assert.ok(Number.isFinite(visual.productScale) && visual.productScale > 0,
      `${kind} has a finite positive SKU scale`);
    assert.ok(String(visual.layout).trim(), `${kind} has an explicit content layout`);
  }
});

test('all twelve families route to their exact authored shell instead of a scaled generic substitute', () => {
  assert.deepEqual(DELIVERY_MODEL_BY_BOX_KIND, EXPECTED_MODELS);
  assert.equal(new Set(Object.values(EXPECTED_MODELS)).size, 12, 'every physical family owns one model');
  assert.equal(DELIVERY_MODEL_BY_BOX_KIND.merchbox, 'delivery_generic_merchandise_box',
    'reference 46 remains the exact 60 x 40 x 40 merchandise shell');
});

test('exact shell hierarchies never use renderer-side envelope scaling', () => {
  assert.deepEqual(GENERIC_CARTON_SOURCE_DIMENSIONS, [0.60, 0.40, 0.40]);
  for (const kind of Object.keys(BOX_KINDS)) assert.deepEqual(deliveryBoxModelScale(kind), [1, 1, 1]);
  for (const shell of Object.values(PACKAGING_SHELLS)) {
    assert.deepEqual(shell.dimensions, {
      w: BOX_KINDS[Object.keys(BOX_KINDS).find((kind) => BOX_KINDS[kind].shellId === shell.id)].w,
      h: BOX_KINDS[Object.keys(BOX_KINDS).find((kind) => BOX_KINDS[kind].shellId === shell.id)].h,
      d: BOX_KINDS[Object.keys(BOX_KINDS).find((kind) => BOX_KINDS[kind].shellId === shell.id)].d,
    });
  }
});

test('identity socket transforms keep actual SKU geometry finite, positive and unwarped', () => {
  for (const kind of Object.keys(BOX_KINDS)) {
    const outer = deliveryBoxModelScale(kind);
    const compensation = deliveryProductScaleCompensation(kind);
    assert.equal(compensation.length, 3, `${kind} compensation axes`);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Number.isFinite(compensation[axis]) && compensation[axis] > 0,
        `${kind} compensation axis ${axis} is finite and positive`);
      nearlyEqual(outer[axis] * compensation[axis], 1, `${kind} axis ${axis} cancels outer scale`);
    }
  }

  for (const kind of Object.keys(BOX_KINDS)) {
    const visual = deliveryBoxVisualConfig(kind);
    assert.equal(visual.layout, 'authored-contract');
    assert.equal(visual.productScale, 1);
    assert.deepEqual(visual.productRotation, [0, 0, 0]);
    assert.equal(visual.alternateProductYaw, false);
  }
});

test('unknown kinds do not masquerade as the generic authored family', () => {
  assert.equal(deliveryBoxVisualConfig('future-unmapped-box'), null);
  assert.equal(deliveryBoxModelScale('future-unmapped-box'), null);
  assert.equal(deliveryProductScaleCompensation('future-unmapped-box'), null);
  assert.equal(canBuildDeliveryBoxVisual(
    { box: 'future-unmapped-box', skuId: 'future-unmapped-sku' },
    { has: () => true },
  ), false);
});

test('authored readiness requires both the exact carton and explicit SKU product model', () => {
  const requested = [];
  const merch = {
    has(model) {
      requested.push(model);
      return Object.values(EXPECTED_MODELS).includes(model)
        || Object.values(EXAMPLE_SKU_BY_KIND).some(([, productModel]) => productModel === model);
    },
  };
  for (const kind of Object.keys(BOX_KINDS)) {
    const [skuId] = EXAMPLE_SKU_BY_KIND[kind];
    assert.equal(canBuildDeliveryBoxVisual({ box: kind, skuId }, merch), true,
      `${kind} is authored-buildable only with its product ready`);
  }
  assert.equal(requested.length, Object.keys(BOX_KINDS).length * 2,
    'each readiness query checks the carton and its explicit SKU model');

  const [skuId, productModel] = EXAMPLE_SKU_BY_KIND.clubbox;
  assert.equal(canBuildDeliveryBoxVisual(
    { box: 'clubbox', skuId },
    { has: (model) => model === EXPECTED_MODELS.clubbox },
  ), false, 'a loaded carton cannot render with a procedural product fallback');
  assert.equal(canBuildDeliveryBoxVisual(
    { box: 'clubbox', skuId },
    { has: (model) => model === productModel },
  ), false, 'a loaded product still waits for its exact carton');

  let unknownLookups = 0;
  assert.equal(canBuildDeliveryBoxVisual(
    { box: 'clubbox', skuId: 'legacy-unknown-sku' },
    { has: () => { unknownLookups += 1; return true; } },
  ), false, 'unknown legacy SKUs fail closed before strict delivery construction');
  assert.equal(canBuildDeliveryBoxVisual(
    { box: 'clubbox' },
    { has: () => { unknownLookups += 1; return true; } },
  ), false, 'legacy boxes without a SKU fail closed');
  assert.equal(unknownLookups, 0, 'unknown SKU readiness never probes or instantiates authored assets');
  assert.equal(createDeliveryBoxVisual({
    box: { id: 404, box: 'clubbox', skuId: 'legacy-unknown-sku' },
    sku: { id: 'legacy-unknown-sku' },
    merch: { has: () => true, instantiate: () => { throw new Error('must not instantiate'); } },
    mats: null,
  }), null, 'unknown legacy construction exits before strict packaging lookup or instantiation');
});

test('dynamic delivery labels select one exact authored quad without club-label overlap', () => {
  const root = new THREE.Group();
  const dynamic = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  dynamic.name = 'LABEL_DYNAMIC';
  root.add(dynamic);
  const legacy = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  legacy.name = 'LABEL_SHIPPING';
  root.add(legacy);
  const similarlyNamed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  similarlyNamed.name = 'LABEL_DYNAMIC_BACKING';
  root.add(similarlyNamed);

  assert.equal(selectDeliveryDynamicLabelMesh(root), dynamic,
    'the exact dynamic quad wins when both club-label planes exist');
  const dynamicMaterial = new THREE.MeshBasicMaterial({ color: 0x315c43 });
  assert.equal(applyDeliveryDynamicLabelMaterial(root, dynamicMaterial), dynamic);
  assert.equal(dynamic.material, dynamicMaterial, 'only the exact dynamic plane receives the runtime material');
  assert.equal(legacy.visible, false, 'the duplicate coplanar legacy plane is hidden');
  assert.notEqual(similarlyNamed.material, dynamicMaterial, 'similar label names retain their authored material');
  dynamic.removeFromParent();
  legacy.visible = true;
  const legacyMaterial = new THREE.MeshBasicMaterial({ color: 0xcbb18a });
  assert.equal(applyDeliveryDynamicLabelMaterial(root, legacyMaterial), legacy);
  assert.equal(legacy.material, legacyMaterial, 'the exact legacy plane receives material only without a dynamic plane');
  assert.equal(selectDeliveryDynamicLabelMesh(root), legacy,
    'the exact legacy shipping quad is the only fallback');
  legacy.removeFromParent();
  assert.equal(selectDeliveryDynamicLabelMesh(root), null,
    'similar names never receive a second coplanar dynamic material');
});

test('runtime selects the exact BAG1 layout and leaves scale/orientation to its authored socket', () => {
  const productModel = EXAMPLE_SKU_BY_KIND.bagcarton[1];
  const merch = {
    has: (model) => model === EXPECTED_MODELS.bagcarton || model === productModel,
    instantiate: (model) => (model === EXPECTED_MODELS.bagcarton
      ? authoredCartonStub(model, 'BAG1', 1, {
        skuId: 'bag1',
        shellId: 'GOLF_BAG_CARTON',
        packingState: 'protective-sleeve-with-straps-compressed',
      })
      : authoredProductStub(model, [0.72, 0.25, 0.30])),
  };
  const result = createDeliveryBoxVisual({
    box: {
      id: 77,
      box: 'bagcarton',
      skuId: 'bag1',
      qty: 1,
      initialQty: 1,
      lifecycle: 'OPEN',
      tape: 1,
      flapProgress: [1, 1, 1, 1],
    },
    sku: { id: 'bag1', name: 'Ironwood stand bag', cat: 'accessories' },
    merch,
    mats: null,
  });

  assert.ok(result?.authored);
  const authored = result.root.getObjectByName(EXPECTED_MODELS.bagcarton)?.parent;
  assert.ok(authored, 'runtime retains the instantiated scene hierarchy');
  assert.deepEqual(authored.scale.toArray(), deliveryBoxModelScale('bagcarton'));
  const product = result.root.getObjectByName('BOX_CONTENT_01_bag1');
  assert.ok(product?.visible, 'the single open-carton product is visible');
  assert.equal(product.parent.name, 'CONTENT_SLOT_BAG1_01');
  assert.deepEqual(product.scale.toArray(), [1, 1, 1], 'runtime does not shrink packed product');
  assert.deepEqual(product.rotation.toArray().slice(0, 3), [0, 0, 0], 'product adds no renderer rotation');
  nearlyEqual(product.parent.rotation.z, Math.PI / 2, 'authored socket owns the packed orientation');
  nearlyEqual(
    result.root.getObjectByName('BOX_WALL_FRONT').rotation.x,
    THREE.MathUtils.degToRad(82),
    'the authored drop-front reveal exposes the fitted bag after all four flaps open',
  );
  assert.equal(result.layoutId, 'BAG1');

  const flapRotations = ['FRONT', 'BACK', 'LEFT', 'RIGHT']
    .map((side) => result.root.getObjectByName(`BOX_FLAP_${side}`).rotation)
    .map((rotation) => Math.abs(rotation.x) + Math.abs(rotation.z));
  assert.ok(flapRotations.every((amount) => amount > 0), 'all four authored flaps remain animated');

  const parent = new THREE.Group();
  parent.add(result.root);
  result.dispose();
  assert.equal(result.root.parent, null, 'runtime disposal detaches the full authored hierarchy');
});

test('authored depletion metadata removes physical products in exact socket order', () => {
  const productModel = EXAMPLE_SKU_BY_KIND.apparel[1];
  const merch = {
    has: (model) => model === EXPECTED_MODELS.apparel || model === productModel,
    instantiate: (model) => (model === EXPECTED_MODELS.apparel
      ? authoredCartonStub(model, 'APPAREL8', 8, {
        skuId: 'polo1',
        shellId: 'APPAREL_CARTON',
        packingState: 'folded-with-tissue-and-size-tag',
      })
      : authoredProductStub(model, [0.20, 0.0925, 0.165])),
  };
  const box = {
    id: 78,
    box: 'apparel',
    skuId: 'polo1',
    qty: 8,
    initialQty: 8,
    lifecycle: 'OPEN',
    tape: 1,
    flapProgress: [1, 1, 1, 1],
  };
  const result = createDeliveryBoxVisual({
    box,
    sku: { id: 'polo1', name: 'Pinehollow polo', cat: 'apparel' },
    merch,
    mats: null,
  });
  const products = Array.from({ length: 8 }, (_, index) => (
    result.root.getObjectByName(`BOX_CONTENT_${String(index + 1).padStart(2, '0')}_polo1`)
  ));
  assert.ok(products.every((product) => product?.visible), 'all eight exact products start visible');
  result.update({ ...box, qty: 4, lifecycle: 'PARTIALLY_EMPTIED' });
  assert.deepEqual(products.map((product) => product.visible), [false, false, false, false, true, true, true, true]);
  result.update({ ...box, qty: 1, lifecycle: 'PARTIALLY_EMPTIED' });
  assert.deepEqual(products.map((product) => product.visible), [false, false, false, false, false, false, false, true]);
  result.dispose();
});

test('runtime layout selection rejects authored metadata drift beyond root and socket count', () => {
  const modelId = EXPECTED_MODELS.apparel;
  const contract = {
    skuId: 'polo1',
    shellId: 'APPAREL_CARTON',
    modelId,
    packingState: 'folded-with-tissue-and-size-tag',
    allowScale: false,
  };
  const fresh = () => authoredCartonStub(modelId, 'APPAREL8', 8, {
    skuId: contract.skuId,
    shellId: contract.shellId,
    packingState: contract.packingState,
  });
  const selected = selectDeliveryContentLayout(fresh(), 'APPAREL8', 8, contract);
  assert.equal(selected.sockets.length, 8, 'the complete strict contract accepts the authored layout');

  const corrupt = (mutate, pattern) => {
    const root = fresh();
    const layout = root.getObjectByName('CONTENT_LAYOUT_APPAREL8');
    const socket = root.getObjectByName('CONTENT_SLOT_APPAREL8_01');
    mutate({ root, layout, socket });
    assert.throws(() => selectDeliveryContentLayout(root, 'APPAREL8', 8, contract), pattern);
  };
  corrupt(({ layout }) => { layout.userData.layout_id = 'FLAT8'; }, /layout_id metadata/);
  corrupt(({ layout }) => { layout.userData.packaging_shell_id = 'WRONG_SHELL'; }, /belongs to shell/);
  corrupt(({ layout }) => { layout.userData.allowed_skus = '["jacket2"]'; }, /does not allow SKU polo1/);
  corrupt(({ layout }) => { layout.userData.packaging_state = 'uncontracted-state'; }, /packaging_state/);
  corrupt(({ socket }) => { socket.userData.packaging_state = 'uncontracted-state'; }, /packaging_state does not match/);
  corrupt(({ socket }) => { socket.userData.slot_index = 2; }, /layout\/index metadata/);
  corrupt(({ socket }) => { socket.userData.allow_scale = true; }, /allow_scale=false/);
  corrupt(({ socket }) => { socket.scale.x = 0.9; }, /identity scale/);
  corrupt(({ layout, socket }) => {
    const nested = new THREE.Group();
    layout.add(nested);
    nested.add(socket);
  }, /direct children/);
});

test('visual construction rejects scaled manifests and absent authored layouts', () => {
  assert.throws(
    () => deliveryContentContract({ id: 90, box: 'ballcase', skuId: 'balls1', contentScale: 0.9 }),
    /contentScale must remain 1/,
  );
  assert.throws(
    () => selectDeliveryContentLayout(new THREE.Group(), 'BALL12', 12),
    /missing CONTENT_LAYOUT_BALL12/,
  );
});
