import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');

test('restored tractor model has one deferred request boundary', () => {
  assert.equal(
    [...source.matchAll(/new GLTFLoader\(\)\.load\(tractorSpec\.model/g)].length,
    1,
  );
  assert.doesNotMatch(source, /vendor\/models\/tractor_red\.glb/);
  assert.doesNotMatch(source, /vendor\/models\/mower_deck\.glb/,
    'the production tractor GLB owns its separated mower assembly');
  assert.equal(
    [...source.matchAll(/ensureTractorModel\(\)/g)].length,
    3,
    'one declaration plus repaired-save and repair-interaction boundaries',
  );
});

test('unrepaired boot leaves the restored production tractor I/O idle', () => {
  const bootStart = source.indexOf('if (!cartHidden) {');
  const bootEnd = source.indexOf('// shared prop loader', bootStart);
  assert.ok(bootStart >= 0 && bootEnd > bootStart);
  const bootBoundary = source.slice(bootStart, bootEnd);
  assert.match(bootBoundary, /ensureTractorModel\(\)/);
  assert.match(bootBoundary, /attachMower\(\)/);

  const repairStart = source.indexOf("if (!repairTractor(state).ok) return;");
  const repairEnd = source.indexOf("play('chime');", repairStart);
  assert.ok(repairStart >= 0 && repairEnd > repairStart);
  assert.match(source.slice(repairStart, repairEnd), /ensureTractorModel\(\)/);
  assert.match(source.slice(repairStart, repairEnd), /attachMower\(\)/);
});
