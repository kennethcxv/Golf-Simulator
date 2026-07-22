import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('every cached clubhouse stock material used by a renderer has its live definition', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /const snackLabelMats = new Map\(\)/);
  assert.match(source, /function snackLabelMat\(sku\)/);
  assert.match(source, /const drinkMats = new Map\(\)/);
  assert.match(source, /function drinkMat\(sku\)/);
  assert.match(source, /frontLabel\(snackLabelMat\(sku\)/);
});
