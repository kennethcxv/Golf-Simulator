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
  assert.equal(apparel?.id, 'table_polos');
  assert.equal(apparel?.kind, 'table');
  assert.deepEqual(apparel?.skus, ['polo1', 'polo2', 'pants2', 'shorts1']);

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
  assert.ok(fixtureById('table_polos').skus.includes('polo2'), 'polo2 shares the authored apparel table');
});

test('Sheet 3 display capacity is the number of physical stock poses', () => {
  const expected = {
    driver1: 6, driver2: 6, driver3: 6,
    irons1: 5, irons2: 5, wedge1: 5, wedge2: 5,
    putter1: 6, putter2: 6, putter3: 6,
    balls1: 15, balls2: 15, balls3: 15,
    tees1: 6, marker1: 6, towel1: 6,
    range2: 6,
    polo1: 6, polo2: 6, pants2: 6, shorts1: 6,
    cap1: 4, glove1: 6, sock1: 6,
    shoe1: 6, bag1: 4,
    water1: 8, snack1: 8,
  };
  for (const [skuId, count] of Object.entries(expected)) {
    assert.equal(slotsFor(skuId).length, count, `${skuId} pose count`);
    assert.equal(capacityOf(skuId), count, `${skuId} capacity`);
  }
});

test('Sheet 3 fixtures expose deterministic poses and preserve authored socket names where present', () => {
  const authoredGroups = [
    ['driver1', 'driver2', 'driver3'],
    ['irons1', 'irons2', 'wedge1', 'wedge2'],
    ['putter1', 'putter2', 'putter3'],
    ['balls1', 'balls2', 'balls3'],
    ['jacket2'], ['water1', 'sportdrink2', 'soda1'],
  ];

  for (const skuIds of authoredGroups) {
    const names = skuIds.flatMap((skuId) => slotsFor(skuId).map((slot, index) => {
      assert.ok(slot.socketName, `${skuId} slot ${index + 1} has no authored socket`);
      return slot.socketName;
    }));
    assert.equal(new Set(names).size, names.length, `${skuIds.join('/')} reuses an authored socket`);
  }

  for (const skuId of ['tees1', 'marker1', 'towel1', 'range2', 'polo2', 'cap1', 'glove1', 'sock1', 'shoe1', 'bag1', 'snack1']) {
    const poses = slotsFor(skuId);
    assert.ok(poses.length > 0, `${skuId} has physical fallback poses`);
    for (const pose of poses) {
      assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.z));
    }
  }
  assert.deepEqual(
    slotsFor('water1').map((slot) => slot.socketName),
    ['SOCKET_Bottle_01', 'SOCKET_Bottle_02', 'SOCKET_Bottle_07', 'SOCKET_Bottle_08',
      'SOCKET_Bottle_13', 'SOCKET_Bottle_14', 'SOCKET_Bottle_19', 'SOCKET_Bottle_20'],
  );
});

test('Sheet 3 placement footprints include the repaired fixture envelopes', () => {
  assert.deepEqual(FIXTURE_HALF.apparelwall, [1.6, 0.35]);
  assert.deepEqual(FIXTURE_HALF.feature, [1.05, 0.65]);

  const apparelRect = fixtureRect(fixtureById('shelf_small'));
  assert.ok(Math.abs((apparelRect.maxX - apparelRect.minX) - 3.20) < 1e-9);
  assert.ok(Math.abs((apparelRect.maxZ - apparelRect.minZ) - 0.70) < 1e-9);

  const featureRect = fixtureRect(fixtureById('feature'));
  assert.ok(Math.abs((featureRect.maxX - featureRect.minX) - 2.10) < 1e-9);
  assert.ok(Math.abs((featureRect.maxZ - featureRect.minZ) - 1.30) < 1e-9);

  const shoeRect = fixtureRect(fixtureById('shoerack'));
  assert.ok(Math.abs((shoeRect.maxX - shoeRect.minX) - 2.46) < 1e-9, 'shoe wall width covers both modules');
  assert.ok(Math.abs((shoeRect.maxZ - shoeRect.minZ) - 1.36) < 1e-9, 'shoe wall depth includes its bench');
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
