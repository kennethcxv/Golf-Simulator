import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/ui/laptop.js', import.meta.url), 'utf8');
test('the clubhouse upgrades page exposes the complete construction catalog and quality ladder', () => {
  assert.match(source, /CONSTRUCTION_FINISH_CATEGORIES/); assert.match(source, /CONSTRUCTION_QUALITY_LEVELS/); assert.match(source, /category\.finishes\.map\(finishRow\)/); assert.match(source, /Construction finishes — municipal to luxury country club/); assert.match(source, /purchaseConstructionFinish\(st, category\.id, family\.id, quality\.id\)/);
});
test('owned finish packages install without being presented as another purchase', () => {
  assert.match(source, /text: owned \? 'Install' : `Buy — \$\{formatMoney\(variant\.cost\)\}`/); assert.match(source, /The owned package can be refitted at no charge/); assert.match(source, /scene3d\?\.clubhouse\?\.\(\)\?\.rebuildReno\?\.\(\)/);
});
