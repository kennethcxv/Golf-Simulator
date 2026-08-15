import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/laptop.js', import.meta.url), 'utf8');

test('the clubhouse upgrades page exposes the complete construction catalog and quality ladder', () => {
  assert.match(source, /CONSTRUCTION_FINISH_CATEGORIES/);
  assert.match(source, /CONSTRUCTION_QUALITY_LEVELS/);
  assert.match(source, /category\.finishes\.map\(finishRow\)/);
  assert.match(source, /Construction finishes - municipal to luxury country club/);
  assert.match(source, /purchaseConstructionFinish\(st, category\.id, family\.id, quality\.id\)/);
});

// BUYING IS NOT FITTING (2026-07-29). One button per act, and the buy button
// must not be able to reach the install call — a control labelled Buy that lays
// a floor is the coupling this replaced, expressed in the UI.
test('buying and fitting are two acts with two buttons and two calls', () => {
  assert.match(source, /const buttonLabel = owned \? 'Fit it' : `Buy - \$\{formatMoney\(variant\.cost\)\}`/);
  assert.ok(source.includes('const res = owned'), 'the two acts branch on ownership');
  assert.match(source, /\? installConstructionFinish\(st, category\.id, family\.id, quality\.id\)/);
  assert.match(source, /: purchaseConstructionFinish\(st, category\.id, family\.id, quality\.id\)/);
  assert.match(source, /goes into your materials - fit it when you are ready/);
  assert.doesNotMatch(source, /Purchase and install/,
    'no confirmation may still promise that buying installs');
  assert.match(source, /scene3d\?\.clubhouse\?\.\(\)\?\.rebuildReno\?\.\(\)/);
});
