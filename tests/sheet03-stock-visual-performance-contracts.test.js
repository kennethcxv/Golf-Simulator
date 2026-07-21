import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { slotsFor } from '../src/data/fixtureSlots.js';
import { skuById } from '../src/data/shopItems.js';
import { catalogProductVisual } from '../src/render3d/clubhouse/catalogProductVisual.js';

const clubhouseSource = readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);
const materialSource = readFileSync(
  new URL('../src/render3d/clubhouse/materials.js', import.meta.url),
  'utf8',
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('Sheet 3 catalog products retain their shared authored model families', () => {
  const ballModels = ['balls1', 'balls2', 'balls3']
    .map((id) => catalogProductVisual(skuById(id)).model);
  assert.deepEqual(
    [...new Set(ballModels)],
    ['checkout_product_ball_carton'],
    'all ball tiers share the authored carton family',
  );

  for (const id of ['polo1', 'polo2']) {
    const visual = catalogProductVisual(skuById(id));
    assert.equal(visual.kind, 'folded-polo');
    assert.equal(visual.model, 'checkout_product_folded_polo');
  }

  const umbrella = catalogProductVisual(skuById('umb1'));
  assert.equal(umbrella.kind, 'umbrella');
  assert.equal(umbrella.model, 'checkout_product_umbrella');
});

test('Sheet 3 club-rack slots use finite, small three-step lean variation', () => {
  const rackSkuIds = [
    'driver1', 'driver2', 'driver3',
    'irons1', 'irons2', 'wedge1', 'wedge2',
  ];

  for (const id of rackSkuIds) {
    const slots = slotsFor(id);
    assert.ok(slots.length > 0, `${id} has rack slots`);
    assert.ok(slots.every((slot) => slot.headUp), `${id} uses the club-rack pose`);

    const leans = slots.map((slot) => slot.lean);
    assert.ok(leans.every(Number.isFinite), `${id} leans are finite`);
    assert.ok(
      leans.every((lean) => Math.abs(lean) <= 0.025),
      `${id} leans stay within the small rack variation envelope`,
    );
    assert.deepEqual(
      [...new Set(leans)].sort((a, b) => a - b),
      [-0.025, 0, 0.025],
      `${id} uses the same three deliberate lean steps`,
    );
  }
});

test('Sheet 3 ball stock uses cached bodies plus label planes, not material arrays', () => {
  assert.match(clubhouseSource, /const BALL_BOX_GEO = new THREE\.BoxGeometry\(/);
  assert.match(clubhouseSource, /const BALL_LABEL_GEO = new THREE\.PlaneGeometry\(/);

  const ballMaterialFactory = sourceBetween(
    clubhouseSource,
    'function ballBoxMat(sku)',
    'function cartonMat(sku)',
  );
  assert.match(ballMaterialFactory, /ballBoxMats\.set\(sku\.id, new THREE\.MeshStandardMaterial/);
  assert.doesNotMatch(ballMaterialFactory, /\[[^\]]*MeshStandardMaterial/,
    'ball cartons use one cached body material rather than a six-face array');
  assert.equal(
    (ballMaterialFactory.match(/ballBoxMats\.set/g) || []).length,
    1,
    'the cached ball body material is never replaced by a six-face array',
  );

  const ballStockBranch = sourceBetween(
    clubhouseSource,
    "if (sku.cat === 'balls')",
    'if (POLO_TINTS[id])',
  );
  assert.match(ballStockBranch, /new THREE\.Mesh\(BALL_BOX_GEO, ballBoxMat\(sku\)\)/);
  assert.match(ballStockBranch, /new THREE\.Mesh\(BALL_LABEL_GEO, ballLabelMat\(sku\)\)/);
  assert.match(ballStockBranch, /carton\.add\(box, label\)/);
});

test('Sheet 3 stock builders use authored apparel and umbrella assets without squeezing', () => {
  const apparelStockBranch = sourceBetween(
    clubhouseSource,
    'if (POLO_TINTS[id])',
    "if (id === 'cap1')",
  );
  assert.match(apparelStockBranch, /'checkout_product_folded_polo'/);
  assert.doesNotMatch(
    apparelStockBranch,
    /\bfold\.scale\b|\bscale\s*:/,
    'folded apparel keeps the authored proportions',
  );

  const umbrellaStockBranch = sourceBetween(
    clubhouseSource,
    "if (id === 'umb1')",
    "if (id === 'range2')",
  );
  assert.match(
    umbrellaStockBranch,
    /merch\.instantiate\('checkout_product_umbrella',\s*\{\s*tint:/,
  );
});

test('rack and bag shafts reference one shared merchShaft runtime material', () => {
  const merchShaftDefinition = sourceBetween(
    materialSource,
    'merchShaft:',
    'merchDark:',
  );
  assert.match(merchShaftDefinition, /new THREE\.MeshStandardMaterial\(/);

  const rackStockBranch = sourceBetween(
    clubhouseSource,
    "if (sku.cat === 'clubs')",
    "if (sku.cat === 'balls')",
  );
  const bagStockBranch = sourceBetween(
    clubhouseSource,
    "if (id === 'bag1')",
    "if (id === 'tees1' || id === 'marker1')",
  );
  assert.equal((rackStockBranch.match(/mats\.merchShaft/g) || []).length, 1);
  assert.equal((bagStockBranch.match(/mats\.merchShaft/g) || []).length, 1);
  assert.doesNotMatch(`${rackStockBranch}\n${bagStockBranch}`, /merchShaft\.clone\(/);
});
