import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { SHOP_CATALOG } from '../src/data/shopItems.js';
import { armfulOf } from '../src/sim/stocking.js';
import { makeGoodsMesh } from '../src/render3d/clubhouse.js';
import { catalogProductVisual } from '../src/render3d/clubhouse/catalogProductVisual.js';

function authoredMerch() {
  const requested = [];
  const instantiate = (model) => {
    requested.push(model);
    const authored = new THREE.Group();
    authored.name = `AUTHORED_CARRY_${model}`;
    const silhouette = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x78957e }),
    );
    silhouette.name = `AUTHORED_SILHOUETTE_${model}`;
    authored.add(silhouette);
    return authored;
  };
  return {
    requested,
    has: () => true,
    instantiate,
    instantiateRaw: instantiate,
  };
}

function catalogProducts(root) {
  return root.children.filter((child) => child.userData.carryVisualRole === 'catalog-product-proxy');
}

function genericCarryCubes(root) {
  const found = [];
  root.traverse((object) => {
    if (object.userData.genericCarryCube) found.push(object);
  });
  return found;
}

function disposeTestVisual(root) {
  root.userData.deliveryOwnedResources?.dispose(root);
  root.traverse((object) => {
    if (!object.name.startsWith('AUTHORED_SILHOUETTE_')) return;
    object.geometry.dispose();
    object.material.dispose();
  });
}

test('every known SKU carry builds named authored catalog proxies and never a generic carry cube', () => {
  assert.ok(SHOP_CATALOG.length > 0);
  for (const sku of SHOP_CATALOG) {
    const merch = authoredMerch();
    const visual = catalogProductVisual(sku);
    const root = makeGoodsMesh({ skuId: sku.id, qty: armfulOf(sku) }, { merch });
    const products = catalogProducts(root);

    assert.equal(root.name, `CarriedGoods_${sku.id}`);
    assert.equal(root.userData.catalogSkuKnown, true, `${sku.id} is a known catalog carry`);
    assert.notEqual(root.userData.deliveryCarryProfile, 'generic-unknown', `${sku.id} has a real carry profile`);
    assert.notEqual(visual.kind, 'unknown-product', `${sku.id} has a recognizable product kind`);
    assert.equal(root.userData.catalogKind, visual.kind);
    assert.ok(products.length >= 1 && products.length <= 6, `${sku.id} keeps the bounded visible proxy count`);
    assert.equal(genericCarryCubes(root).length, 0, `${sku.id} never falls through to the old cube armful`);

    for (const [index, product] of products.entries()) {
      assert.equal(product.name, `CheckoutProduct_${sku.id}`);
      assert.equal(product.userData.carryInstanceName,
        `CarriedCatalogProduct_${sku.id}_${String(index + 1).padStart(2, '0')}`);
      assert.equal(product.userData.carriedGoodsSkuId, sku.id);
      assert.equal(product.userData.carriedGoodsKind, visual.kind);
      assert.equal(product.userData.catalogProductContext, 'stock-carry');
      assert.ok(product.getObjectByName(`AUTHORED_CARRY_${visual.model}`),
        `${sku.id} carries its ${visual.model} authored content`);
    }
    assert.equal(merch.requested.length, products.length, `${sku.id} builds one SKU proxy per visible unit`);
    assert.ok(merch.requested.every((model) => model === visual.model), `${sku.id} requests only its exact model`);
    disposeTestVisual(root);
  }
});

test('hero carry kinds use distinct believable bundle profiles and transforms', () => {
  const cases = [
    { id: 'balls1', qty: 6, profile: 'ball-carton-stack', count: 6, model: 'checkout_product_ball_carton' },
    { id: 'tees1', qty: 8, profile: 'small-merch-fan', count: 6, model: 'checkout_product_tee_pouch' },
    { id: 'shoe1', qty: 3, profile: 'shoe-box-stack', count: 3, model: 'checkout_product_shoe_box' },
    { id: 'bag1', qty: 1, profile: 'bulky-stand-bag', count: 1, model: 'checkout_product_stand_bag' },
    { id: 'water1', qty: 6, profile: 'bottle-bundle', count: 6, model: 'provisions_fairway_spring_water' },
  ];

  for (const expected of cases) {
    const merch = authoredMerch();
    const root = makeGoodsMesh({ skuId: expected.id, qty: expected.qty }, { merch });
    const products = catalogProducts(root);
    assert.equal(root.userData.deliveryCarryProfile, expected.profile);
    assert.equal(products.length, expected.count);
    assert.ok(products.every((product) => product.getObjectByName(`AUTHORED_CARRY_${expected.model}`)));
    assert.equal(genericCarryCubes(root).length, 0);

    const poses = products.map((product) => ({
      x: product.position.x,
      y: product.position.y,
      z: product.position.z,
      rz: product.rotation.z,
    }));
    assert.ok(new Set(poses.map((pose) => `${pose.x}|${pose.y}|${pose.z}|${pose.rz}`)).size > 1
      || products.length === 1, `${expected.id} units do not occupy one generic pile pose`);

    if (expected.id === 'bag1') {
      assert.ok(Math.abs(products[0].rotation.z + Math.PI / 2) < 1e-9, 'stand bag is carried upright');
      assert.ok(products[0].position.y >= 0.3, 'stand bag is lifted around its bulky midpoint');
    }
    if (expected.id === 'water1') {
      assert.equal(new Set(products.map((product) => product.position.x)).size, 3, 'bottles form three columns');
      assert.equal(new Set(products.map((product) => product.position.z)).size, 2, 'bottles form two supported rows');
    }
    disposeTestVisual(root);
  }
});

test('hero carry kinds remain named physical proxies while authored assets are still loading', () => {
  const recoveryNodes = {
    balls1: 'DozenCarton',
    tees1: 'TeePouch',
    shoe1: 'RetailShoeBox',
    bag1: 'StandBagBody',
    water1: 'WaterBottleFallback',
  };

  for (const [skuId, recoveryNode] of Object.entries(recoveryNodes)) {
    const root = makeGoodsMesh({ skuId, qty: 1 });
    const [product] = catalogProducts(root);
    assert.equal(product.name, `CheckoutProduct_${skuId}`);
    assert.ok(product.getObjectByName(recoveryNode),
      `${skuId} has recognizable ${recoveryNode} proxy content before its GLB is resident`);
    assert.equal(product.getObjectByName('UnknownRetailPack'), undefined,
      `${skuId} never masquerades as the unknown-product recovery pack`);
    assert.equal(genericCarryCubes(root).length, 0);
    disposeTestVisual(root);
  }
});

test('existing apparel and club bundles retain their established authored layouts', () => {
  const merch = authoredMerch();
  const apparel = makeGoodsMesh({ skuId: 'polo1', qty: 2 }, { merch });
  const clubs = makeGoodsMesh({ skuId: 'driver1', qty: 2 }, { merch });
  const apparelProducts = catalogProducts(apparel);
  const clubProducts = catalogProducts(clubs);

  assert.equal(apparel.userData.deliveryCarryProfile, 'apparel-stack');
  assert.deepEqual(apparelProducts.map((item) => item.position.toArray()), [
    [-0.11, 0, 0],
    [0.11, 0, 0],
  ]);
  assert.ok(apparelProducts.every((item) => Math.abs(item.scale.x - 0.92) < 1e-9));

  assert.equal(clubs.userData.deliveryCarryProfile, 'long-clubs');
  assert.deepEqual(clubProducts.map((item) => item.position.toArray()), [
    [0, 0, -0.018],
    [0, 0.072, 0.018],
  ]);
  assert.ok(clubProducts.every((item) => Math.abs(item.scale.x - 0.92) < 1e-9));
  assert.equal(genericCarryCubes(apparel).length, 0);
  assert.equal(genericCarryCubes(clubs).length, 0);
  disposeTestVisual(apparel);
  disposeTestVisual(clubs);
});

test('only a truly unknown SKU uses the explicitly marked safe cube fallback', () => {
  const root = makeGoodsMesh({ skuId: 'future-mod-sku', qty: 2 });
  const cubes = genericCarryCubes(root);

  assert.equal(root.userData.catalogSkuKnown, false);
  assert.equal(root.userData.deliveryCarryProfile, 'generic-unknown');
  assert.equal(catalogProducts(root).length, 0);
  assert.equal(cubes.length, 2);
  assert.ok(cubes.every((cube) => cube.name.startsWith('GenericCarryCube_future-mod-sku_')));
  assert.ok(cubes.every((cube) => cube.geometry.type === 'BoxGeometry'));
  disposeTestVisual(root);
});
