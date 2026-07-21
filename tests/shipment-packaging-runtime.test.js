import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOX_KINDS,
  SHIPMENT_PACKAGING_SCHEMA_VERSION,
  boxKindFor,
  planShipment,
} from '../src/data/boxes.js';
import {
  productPackagingFor,
} from '../src/data/productPackaging.js';
import { SHOP_CATALOG, skuById } from '../src/data/shopItems.js';
import {
  BOX_SCHEMA_VERSION,
  DELIVERIES_SCHEMA_VERSION,
  arriveOrder,
  boxesOf,
} from '../src/sim/deliveries.js';
import { newGame } from '../src/sim/state.js';

const METADATA_FIELDS = [
  'familyId',
  'layoutId',
  'shellId',
  'modelId',
  'packingState',
  'packingOrientation',
  'contentScale',
];

function expectedMetadata(skuId) {
  const contract = productPackagingFor(skuId);
  return {
    familyId: contract.familyId,
    layoutId: contract.layoutId,
    shellId: contract.box.shellId,
    modelId: contract.box.modelId,
    packingState: contract.packing.state,
    packingOrientation: contract.packing.orientation,
    contentScale: 1,
  };
}

test('every current catalog SKU plans exact authored capacities and explicit 1:1 metadata', () => {
  for (const sku of SHOP_CATALOG) {
    const contract = productPackagingFor(sku.id);
    const quantity = contract.unitsPerBox * 2 + 1;
    const manifest = planShipment(sku, quantity);
    const kind = boxKindFor(sku);

    assert.deepEqual(
      manifest.boxes.map((box) => box.qty),
      [contract.unitsPerBox, contract.unitsPerBox, 1],
      `${sku.id} uses its authored socket capacity`,
    );
    assert.equal(manifest.boxCount, 3, `${sku.id} has no representative-count fallback`);
    assert.equal(manifest.packagingSchemaVersion, SHIPMENT_PACKAGING_SCHEMA_VERSION);
    for (const box of manifest.boxes) {
      assert.equal(box.kind, kind.id, `${sku.id} uses its contracted runtime kind`);
      assert.deepEqual(
        { w: box.w, h: box.h, d: box.d },
        contract.box.dimensions,
        `${sku.id} uses exact authored shell bounds`,
      );
      assert.deepEqual(
        Object.fromEntries(METADATA_FIELDS.map((field) => [field, box[field]])),
        expectedMetadata(sku.id),
        `${sku.id} manifest persists its shell/layout contract`,
      );
      assert.equal(box.fragile, contract.fragile);
      assert.equal(box.longProduct, contract.longProduct);
    }
  }
});

test('strict manifest metadata is copied to landed boxes and survives JSON reload', () => {
  const state = newGame('relaxed', 810);
  const sku = skuById('irons1');
  const manifest = planShipment(sku, 2);
  const made = arriveOrder(state, { id: 810, skuId: sku.id, qty: 2, manifest });

  assert.equal(made.length, 2);
  for (const box of made) {
    assert.equal(box.box, 'ironset');
    assert.equal(box.schemaVersion, BOX_SCHEMA_VERSION);
    assert.deepEqual(
      Object.fromEntries(METADATA_FIELDS.map((field) => [field, box[field]])),
      expectedMetadata(sku.id),
    );
  }

  const loaded = JSON.parse(JSON.stringify(state));
  const reloaded = boxesOf(loaded);
  assert.deepEqual(
    reloaded.map((box) => Object.fromEntries(METADATA_FIELDS.map((field) => [field, box[field]]))),
    made.map((box) => Object.fromEntries(METADATA_FIELDS.map((field) => [field, box[field]]))),
  );
});

test('legacy landed boxes heal deterministically without changing identity, state, or quantity', () => {
  const state = newGame('relaxed', 811);
  const legacy = {
    id: 91,
    orderId: 17,
    skuId: 'glove1',
    qty: 12,
    cap: 12,
    initialQty: 12,
    box: 'apparel',
    loc: 'stock',
    cut: true,
    opened: true,
    fragile: true,
    schemaVersion: 2,
  };
  state.shop.deliveries = {
    schemaVersion: 2,
    boxes: [legacy],
    nextBoxId: 92,
    trash: 0,
    recycled: 0,
    shipments: [],
  };

  const [healed] = boxesOf(state);
  assert.strictEqual(healed, legacy, 'migration preserves the authoritative box object');
  assert.equal(healed.id, 91);
  assert.equal(healed.orderId, 17);
  assert.equal(healed.qty, 12, 'no incoming inventory is discarded');
  assert.equal(healed.cap, 12, 'legacy partial-content accounting remains stable');
  assert.equal(healed.box, 'carton', 'the old category carton heals to the SKU contract');
  assert.equal(healed.schemaVersion, BOX_SCHEMA_VERSION);
  assert.equal(state.shop.deliveries.schemaVersion, DELIVERIES_SCHEMA_VERSION);
  assert.deepEqual(
    Object.fromEntries(METADATA_FIELDS.map((field) => [field, healed[field]])),
    expectedMetadata('glove1'),
  );
  assert.equal(healed.fragile, false, 'malformed legacy flags heal from the contract');
  assert.equal(healed.tape, 1, 'already-open legacy boxes do not reseal');
  assert.equal(healed.qty, 12, 'healing never changes remaining contents');

  healed.layoutId = 'WRONG_LAYOUT';
  healed.modelId = 'wrong_model';
  healed.contentScale = 0.5;
  const [rehealed] = boxesOf(state);
  assert.strictEqual(rehealed, healed);
  assert.deepEqual(
    Object.fromEntries(METADATA_FIELDS.map((field) => [field, rehealed[field]])),
    expectedMetadata('glove1'),
    'current-schema metadata corruption is detected and healed too',
  );
  assert.equal(rehealed.qty, 12);
});

test('removed legacy SKUs remain loadable with explicit deterministic legacy packaging', () => {
  const state = newGame('relaxed', 812);
  state.shop.deliveries = {
    schemaVersion: 1,
    boxes: [{
      id: 44,
      orderId: 12,
      skuId: 'retired-sku',
      qty: 3,
      box: 'ballcase',
      loc: 'stock',
    }],
    nextBoxId: 45,
    trash: 0,
    recycled: 0,
    shipments: [],
  };

  const [healed] = boxesOf(state);
  assert.equal(healed.qty, 3);
  assert.equal(healed.box, 'ballcase');
  assert.equal(healed.layoutId, 'LEGACY_UNSPECIFIED');
  assert.equal(healed.shellId, BOX_KINDS.ballcase.shellId);
  assert.equal(healed.modelId, BOX_KINDS.ballcase.modelId);
  assert.equal(healed.contentScale, 1);
  assert.ok(healed.lb > 0, 'a missing legacy label weight heals deterministically');
});

test('new manifests reject missing, mismatched, scaled, or non-minimal packing metadata', () => {
  const corruptions = [
    ['missing layout', (manifest) => { delete manifest.boxes[0].layoutId; }],
    ['wrong model', (manifest) => { manifest.boxes[0].modelId = 'delivery_generic_merchandise_box'; }],
    ['scaled content', (manifest) => { manifest.boxes[0].contentScale = 0.75; }],
    ['missing all metadata', (manifest) => {
      for (const box of manifest.boxes) {
        for (const field of METADATA_FIELDS) delete box[field];
      }
    }],
    ['future packaging schema', (manifest) => { manifest.packagingSchemaVersion += 1; }],
    ['non-minimal split', (manifest) => {
      manifest.boxes[0].qty = 6;
      manifest.boxes[1].qty = 18;
    }],
  ];

  for (const [label, corrupt] of corruptions) {
    const state = newGame('relaxed', 813);
    const before = structuredClone(state);
    const manifest = structuredClone(planShipment(skuById('balls2'), 24));
    corrupt(manifest);
    assert.deepEqual(arriveOrder(state, {
      id: `corrupt-${label}`,
      skuId: 'balls2',
      qty: 24,
      manifest,
    }), [], label);
    assert.deepEqual(state, before, `${label} cannot mutate delivery state`);
  }

  assert.throws(
    () => planShipment({ id: 'unknown-new-sku', cat: 'balls', lb: 1 }, 1),
    /Unknown product packaging SKU/,
  );
  assert.throws(() => planShipment(skuById('balls2'), 1.5), /positive integer/);
});
