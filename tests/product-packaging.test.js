import test from 'node:test';
import assert from 'node:assert/strict';

import { SHOP_CATALOG, RETAIL_CATS } from '../src/data/shopItems.js';
import {
  PACKAGING_LAYOUTS,
  PACKAGING_SHELLS,
  PLANNED_PACKAGING_SKU_IDS,
  PRODUCT_PACKAGING,
  PRODUCT_PACKAGING_SKU_IDS,
  dimensionsFitUnderRotation,
  hasProductPackaging,
  planProductPackaging,
  productPackagingFor,
  validateProductPackagingCatalog,
  validateProductPackagingContract,
} from '../src/data/productPackaging.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const dims = (w, h, d) => ({ w, h, d });

function assertDeepFrozen(value, path = 'value') {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), `${path} is frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${path}.${key}`);
}

test('the contract covers every current catalog SKU with no planned-only provisions SKUs', () => {
  const current = SHOP_CATALOG.map((sku) => sku.id).sort();
  const expected = [...current, ...PLANNED_PACKAGING_SKU_IDS].sort();

  assert.equal(SHOP_CATALOG.length, 57, 'catalog audit count did not silently change');
  assert.deepEqual(PLANNED_PACKAGING_SKU_IDS, []);
  assert.deepEqual(PRODUCT_PACKAGING_SKU_IDS, expected);
  assert.equal(new Set(PRODUCT_PACKAGING_SKU_IDS).size, PRODUCT_PACKAGING_SKU_IDS.length);
  assert.equal(validateProductPackagingCatalog(PRODUCT_PACKAGING, expected), true);
  for (const sku of SHOP_CATALOG) {
    assert.ok(hasProductPackaging(sku.id), `${sku.id} has an explicit physical contract`);
    const contract = productPackagingFor(sku.id);
    assert.equal(contract.catalogCategory, sku.cat, `${sku.id} preserves its catalog category`);
    assert.equal(contract.unitWeightLb, sku.lb, `${sku.id} preserves its unit weight`);
    assert.equal(contract.fragile, !!sku.fragile, `${sku.id} preserves its fragility`);
    assert.equal(contract.retail, RETAIL_CATS.has(sku.cat), `${sku.id} explicitly declares retail status`);
  }
});

test('all exported packaging data is recursively frozen and validates without mutation', () => {
  assertDeepFrozen(PACKAGING_SHELLS, 'PACKAGING_SHELLS');
  assertDeepFrozen(PACKAGING_LAYOUTS, 'PACKAGING_LAYOUTS');
  assertDeepFrozen(PRODUCT_PACKAGING, 'PRODUCT_PACKAGING');
  assertDeepFrozen(PRODUCT_PACKAGING_SKU_IDS, 'PRODUCT_PACKAGING_SKU_IDS');
  assertDeepFrozen(PLANNED_PACKAGING_SKU_IDS, 'PLANNED_PACKAGING_SKU_IDS');

  for (const contract of Object.values(PRODUCT_PACKAGING)) {
    assert.equal(validateProductPackagingContract(contract), true, contract.skuId);
  }
  assert.throws(() => {
    PRODUCT_PACKAGING.driver1.unitsPerBox = 99;
  }, TypeError);
});

test('every packed product and authored socket fits at 1:1 scale under an allowed rotation', () => {
  for (const contract of Object.values(PRODUCT_PACKAGING)) {
    const layout = PACKAGING_LAYOUTS[contract.layoutId];
    const shell = PACKAGING_SHELLS[layout.shellId];
    assert.equal(
      dimensionsFitUnderRotation(contract.packing.dimensions, layout.slotMaxDimensions),
      true,
      `${contract.skuId} fits ${layout.id}`,
    );
    assert.equal(
      dimensionsFitUnderRotation(layout.slotMaxDimensions, shell.innerDimensions),
      true,
      `${layout.id} fits inside ${shell.id}`,
    );
    assert.equal(contract.packing.allowScale, false, `${contract.skuId} forbids shrink fallback`);
    assert.equal(contract.packing.contentScale, 1, `${contract.skuId} stays at authored scale`);
    assert.deepEqual(contract.box.dimensions, shell.dimensions, `${contract.skuId} uses exact shell bounds`);
    assert.deepEqual(contract.box.innerDimensions, shell.innerDimensions, `${contract.skuId} uses exact inner bounds`);
  }

  const range = productPackagingFor('range2');
  const rangeSlot = PACKAGING_LAYOUTS[range.layoutId].slotMaxDimensions;
  assert.ok(range.packing.dimensions.w <= rangeSlot.w, 'rangefinder width fits its padded cell');
  assert.ok(range.packing.dimensions.h <= rangeSlot.h, 'rangefinder height fits its padded cell');
  assert.ok(range.packing.dimensions.d <= rangeSlot.d, 'rangefinder depth fits its padded cell');
});

test('SKU quantities equal exact socket capacities rather than a representative visual count', () => {
  const expectedCapacity = {
    driver1: 2, driver2: 2, driver3: 2,
    irons1: 1, irons2: 1,
    putter1: 2, putter2: 2, putter3: 2, wedge1: 2, wedge2: 2,
    balls1: 12, balls2: 12, balls3: 12,
    glove1: 8, glove2: 8, polo1: 8, polo2: 8, pants2: 8, shorts1: 8,
    cap1: 8, cap2: 8, jacket2: 8, shoe1: 4, shoe3: 4, sock1: 8,
    tees1: 12, towel1: 12, marker1: 12, divot1: 12, range2: 4,
    sunglasses2: 4, bottle1: 8, umb1: 6, bag1: 1, bag3: 1, scorecard1: 12,
    vac1: 1, rug1: 1, plant1: 1, poster1: 1, board1: 1, light1: 1, lounge1: 1,
    repairkit1: 1, desk1: 1, chair1: 1, laptop1: 1, counter1: 1, shelfkit1: 1, safetykit1: 1,
    water1: 12, sportdrink2: 12, soda1: 12,
    chips1: 12, bar2: 12, crackers1: 12, snack1: 12,
  };
  assert.deepEqual(Object.keys(expectedCapacity).sort(), PRODUCT_PACKAGING_SKU_IDS);

  for (const [skuId, capacity] of Object.entries(expectedCapacity)) {
    const contract = productPackagingFor(skuId);
    const layout = PACKAGING_LAYOUTS[contract.layoutId];
    assert.equal(contract.unitsPerBox, capacity, `${skuId} has the audited carton quantity`);
    assert.equal(layout.capacity, capacity, `${skuId} has one authored socket per unit`);

    const plan = planProductPackaging(skuId, capacity * 2 + 1);
    assert.equal(plan.boxCount, 3, `${skuId} quantity is split deterministically`);
    assert.deepEqual(plan.boxes.map((box) => box.units), [capacity, capacity, 1]);
    assert.equal(plan.boxes.reduce((sum, box) => sum + box.units, 0), capacity * 2 + 1);
  }
});

test('umbrella and iron sets use honest exception shells and no other SKU claims an exception', () => {
  for (const id of ['irons1', 'irons2']) {
    const contract = productPackagingFor(id);
    assert.equal(contract.exceptionProfile, 'IRON_SET1');
    assert.equal(contract.layoutId, 'IRONSET1');
    assert.equal(contract.unitsPerBox, 1, 'a set is one product, not two clubs');
    assert.equal(contract.box.modelId, 'delivery_iron_set_carton');
    assert.deepEqual(contract.box.dimensions, dims(1.12, 0.24, 0.24));
  }

  const umbrella = productPackagingFor('umb1');
  assert.equal(umbrella.exceptionProfile, 'UMBRELLA_LONG6');
  assert.equal(umbrella.layoutId, 'UMBRELLA6');
  assert.equal(umbrella.unitsPerBox, 6);
  assert.equal(umbrella.box.modelId, 'delivery_umbrella_carton');
  assert.deepEqual(umbrella.box.dimensions, dims(0.92, 0.28, 0.38));
  assert.ok(umbrella.box.innerDimensions.w > umbrella.physicalDimensions.w, 'the real 84 cm umbrella fits lengthwise');

  for (const contract of Object.values(PRODUCT_PACKAGING)) {
    if (['umb1', 'irons1', 'irons2'].includes(contract.skuId)) continue;
    assert.equal(contract.exceptionProfile, null, `${contract.skuId} does not hide a special case`);
  }
});

test('shop equipment, campaign fixtures, and decor are explicit nonretail physical deliveries', () => {
  const expected = [
    'board1', 'chair1', 'counter1', 'desk1', 'laptop1', 'light1', 'lounge1',
    'plant1', 'poster1', 'repairkit1', 'rug1', 'safetykit1', 'shelfkit1', 'vac1',
  ];
  const actual = Object.values(PRODUCT_PACKAGING)
    .filter((contract) => contract.status === 'nonretail')
    .map((contract) => contract.skuId)
    .sort();
  assert.deepEqual(actual, expected);

  for (const id of expected) {
    const contract = productPackagingFor(id);
    assert.equal(contract.retail, false);
    assert.ok(contract.packing.state.length > 8, `${id} has an honest packed state`);
    assert.ok(contract.packing.orientation.length > 5, `${id} has an authored orientation`);
    assert.ok(contract.allowedStocking.fixtureIds.length > 0, `${id} has a real placement target`);
    assert.notEqual(contract.layoutId, 'DRINK12');
    assert.notEqual(contract.layoutId, 'SNACK12');
  }
});

test('Fairway Spring water and Bunker Bites use exact twelve-unit provisions layouts', () => {
  const water = productPackagingFor('water1');
  const snack = productPackagingFor('snack1');

  assert.equal(water.status, 'retail');
  assert.equal(snack.status, 'retail');
  assert.equal(water.catalogCategory, 'provisions');
  assert.equal(snack.catalogCategory, 'provisions');
  assert.equal(water.layoutId, 'DRINK12');
  assert.equal(snack.layoutId, 'SNACK12');
  assert.equal(water.unitsPerBox, 12);
  assert.equal(snack.unitsPerBox, 12);
  assert.equal(water.box.modelId, 'delivery_bulk_provisions_carton');
  assert.equal(snack.box.modelId, 'delivery_bulk_provisions_carton');
  assert.deepEqual(water.box.dimensions, dims(0.50, 0.30, 0.38));
  assert.deepEqual(snack.box.dimensions, dims(0.50, 0.30, 0.38));
  assert.deepEqual(water.allowedStocking.fixtureIds, ['cold_drinks']);
  assert.deepEqual(snack.allowedStocking.fixtureIds, ['snack_rack']);
});

test('lookups and validators reject unknown or malformed contracts', () => {
  assert.equal(hasProductPackaging('not-a-sku'), false);
  assert.throws(() => productPackagingFor('not-a-sku'), /Unknown product packaging SKU/);
  assert.throws(() => planProductPackaging('not-a-sku', 1), /Unknown product packaging SKU/);

  const unknown = clone(productPackagingFor('driver1'));
  unknown.skuId = 'future-mystery-product';
  assert.throws(() => validateProductPackagingContract(unknown), /Unknown product packaging SKU/);

  const status = clone(productPackagingFor('driver1'));
  status.retail = false;
  assert.throws(() => validateProductPackagingContract(status), /retail\/nonretail status/);

  const orientation = clone(productPackagingFor('driver1'));
  orientation.packing.orientation = '';
  assert.throws(() => validateProductPackagingContract(orientation), /state and orientation/);

  const scaled = clone(productPackagingFor('driver1'));
  scaled.packing.allowScale = true;
  scaled.packing.contentScale = 0.5;
  assert.throws(() => validateProductPackagingContract(scaled), /no shrink fallback/);

  const wrongQuantity = clone(productPackagingFor('driver1'));
  wrongQuantity.unitsPerBox = 12;
  assert.throws(() => validateProductPackagingContract(wrongQuantity), /does not match CLUB2 capacity/);

  const badBounds = clone(productPackagingFor('driver1'));
  badBounds.packing.dimensions.w = Number.NaN;
  assert.throws(() => validateProductPackagingContract(badBounds), /finite positive number/);

  const noFixture = clone(productPackagingFor('driver1'));
  noFixture.allowedStocking.fixtureIds = [];
  assert.throws(() => validateProductPackagingContract(noFixture), /allowed stocking category and fixture/);

  const missing = { ...PRODUCT_PACKAGING };
  delete missing.driver1;
  assert.throws(() => validateProductPackagingCatalog(missing), /coverage mismatch/);
  const extra = { ...PRODUCT_PACKAGING, mystery1: clone(productPackagingFor('driver1')) };
  extra.mystery1.skuId = 'mystery1';
  assert.throws(() => validateProductPackagingCatalog(extra), /coverage mismatch/);
});

test('quantity/dimension selection is deterministic and refuses shrink-to-fit', () => {
  const contract = productPackagingFor('balls2');
  const criteria = {
    category: 'balls',
    fragile: false,
    longProduct: false,
    unitWeightLb: 1.4,
    packedDimensions: contract.packing.dimensions,
  };
  const first = planProductPackaging('balls2', 25, criteria);
  const replay = planProductPackaging('balls2', 25, criteria);
  assert.deepEqual(first, replay);
  assert.deepEqual(first.boxes.map((box) => box.units), [12, 12, 1]);
  assert.ok(first.boxes.every((box) => box.contentScale === 1));
  assertDeepFrozen(first, 'plan');

  assert.throws(
    () => planProductPackaging('balls2', 12, { packedDimensions: dims(0.8, 0.8, 0.8) }),
    /do not fit BALL12; shrink fallback is forbidden/,
  );
  assert.throws(() => planProductPackaging('balls2', 0), /positive integer/);
  assert.throws(() => planProductPackaging('balls2', 1.5), /positive integer/);
  assert.throws(() => planProductPackaging('balls2', 12, { category: 'clubs' }), /category does not match/);
  assert.throws(() => planProductPackaging('range2', 4, { fragile: false }), /fragility does not match/);
  assert.throws(() => planProductPackaging('driver1', 2, { longProduct: false }), /long-product flag does not match/);
});
