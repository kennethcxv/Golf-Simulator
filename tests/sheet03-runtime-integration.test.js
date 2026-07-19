import test from 'node:test';
import assert from 'node:assert/strict';

import { FIXTURES, FIXTURE_HALF, fixtureRect } from '../src/data/shopLayout.js';
import { capacityOf, homeFixture, slotsFor } from '../src/data/fixtureSlots.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';
import { productPackagingFor } from '../src/data/productPackaging.js';
import { catalogProductVisual } from '../src/render3d/clubhouse/catalogProductVisual.js';

const fixtureById = (id) => FIXTURES.find((fixture) => fixture.id === id);

test('Sheet 3 products have one deliberate retail home', () => {
  const apparel = homeFixture('polo2');
  assert.equal(apparel?.id, 'apparel_display');
  assert.equal(apparel?.kind, 'apparelwall');
  assert.deepEqual(apparel?.skus, ['polo2']);

  const optics = homeFixture('range2');
  assert.equal(optics?.id, 'feature');
  assert.equal(optics?.kind, 'feature');
  assert.deepEqual(optics?.skus, ['range2']);

  for (const skuId of ['polo2', 'range2']) {
    assert.deepEqual(
      FIXTURES.filter((fixture) => fixture.skus.includes(skuId)).map((fixture) => fixture.id),
      [homeFixture(skuId).id],
      `${skuId} must not be duplicated on another fixture`,
    );
  }
  assert.ok(!fixtureById('shelf_acc').skus.includes('range2'), 'rangefinders left the accessory wall');
  assert.ok(!fixtureById('table_polos').skus.includes('polo2'), 'polo2 left the apparel table');
});

test('Sheet 3 display capacity is the number of physical stock poses', () => {
  const expected = {
    driver1: 6, driver2: 6, driver3: 6,
    irons1: 5, irons2: 5, wedge1: 5, wedge2: 5,
    putter1: 10, putter2: 10,
    balls1: 15, balls2: 15, balls3: 15,
    tees1: 12, marker1: 12, towel1: 12,
    range2: 6,
    polo2: 12, cap1: 16, glove1: 12, sock1: 12,
    shoe1: 12, bag1: 5,
    water1: 14, snack1: 10,
  };
  for (const [skuId, count] of Object.entries(expected)) {
    assert.equal(slotsFor(skuId).length, count, `${skuId} pose count`);
    assert.equal(capacityOf(skuId), count, `${skuId} capacity`);
  }
});

test('Sheet 3 authored fixtures resolve unique named sockets', () => {
  const authoredGroups = [
    ['driver1', 'driver2', 'driver3'],
    ['irons1', 'irons2', 'wedge1', 'wedge2'],
    ['putter1', 'putter2'],
    ['balls1', 'balls2', 'balls3'],
    ['tees1', 'marker1', 'towel1'],
    ['polo2'], ['cap1'], ['glove1', 'sock1'], ['shoe1'], ['bag1'],
    ['range2'], ['water1', 'snack1'],
  ];

  for (const skuIds of authoredGroups) {
    const names = skuIds.flatMap((skuId) => slotsFor(skuId).map((slot, index) => {
      assert.ok(slot.socketName, `${skuId} slot ${index + 1} has no authored socket`);
      return slot.socketName;
    }));
    assert.equal(new Set(names).size, names.length, `${skuIds.join('/')} reuses an authored socket`);
  }

  assert.deepEqual(
    slotsFor('polo2').map((slot) => slot.socketName),
    [
      ...Array.from({ length: 8 }, (_, i) => `DISPLAY_ARM_SLOT_${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 4 }, (_, i) => `DISPLAY_BASE_SLOT_${String(i + 1).padStart(2, '0')}`),
    ],
  );
  assert.equal(slotsFor('polo2').filter((slot) => slot.folded).length, 4);
  assert.equal(slotsFor('cap1').at(-1).socketName, 'HAT_PEG_SLOT_16');
  assert.equal(slotsFor('bag1').at(-1).socketName, 'BAG_SLOT_05');
  assert.equal(slotsFor('range2').at(-1).socketName, 'RF_SLOT_06');

  const shoes = slotsFor('shoe1');
  assert.equal(shoes.filter((slot) => slot.boxed).length, 6, 'six boxed shoe units');
  assert.equal(shoes.filter((slot) => !slot.boxed).length, 6, 'six displayed shoe pairs');
  assert.ok(shoes.every((slot) => /^shoerack_[LR]_SHOE(?:BOX)?_SLOT_/.test(slot.socketName)));

  for (const skuId of ['water1', 'snack1']) {
    for (const slot of slotsFor(skuId)) {
      assert.equal(slot.socket, slot.socketName, `${skuId} exposes the same authored socket to both consumers`);
    }
  }
});

test('Sheet 3 placement footprints include the repaired fixture envelopes', () => {
  assert.deepEqual(FIXTURE_HALF.apparelwall, [0.63, 0.25]);
  assert.deepEqual(FIXTURE_HALF.feature, [0.85, 0.55]);

  const apparelRect = fixtureRect(fixtureById('apparel_display'));
  assert.ok(Math.abs((apparelRect.maxX - apparelRect.minX) - 0.50) < 1e-9);
  assert.ok(Math.abs((apparelRect.maxZ - apparelRect.minZ) - 1.26) < 1e-9);

  const featureRect = fixtureRect(fixtureById('feature'));
  assert.ok(Math.abs((featureRect.maxX - featureRect.minX) - 1.70) < 1e-9);
  assert.ok(Math.abs((featureRect.maxZ - featureRect.minZ) - 1.10) < 1e-9);

  const shoeRect = fixtureRect(fixtureById('shoerack'));
  assert.ok(Math.abs((shoeRect.maxX - shoeRect.minX) - 1.36) < 1e-9, 'shoe wall depth includes its bench');
  assert.ok(Math.abs((shoeRect.maxZ - shoeRect.minZ) - 2.46) < 1e-9, 'shoe wall width covers both modules');
});

test('shoe samples stay loose on display while the sellable checkout unit remains boxed', () => {
  const shoe = SHOP_CATALOG.find((sku) => sku.id === 'shoe1');
  const visual = catalogProductVisual(shoe);
  const packaging = productPackagingFor('shoe1');
  assert.equal(visual.kind, 'shoe-box');
  assert.equal(visual.model, 'checkout_product_shoe_box');
  assert.equal(visual.barcodeSurface, 'package-side');
  assert.deepEqual(visual.size, [
    packaging.physicalDimensions.w,
    packaging.physicalDimensions.h,
    packaging.physicalDimensions.d,
  ]);
  assert.equal(slotsFor('shoe1').filter((slot) => !slot.boxed).length, 6,
    'six loose pairs remain deliberate display samples');
});
