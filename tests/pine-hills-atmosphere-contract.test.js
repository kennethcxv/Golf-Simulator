import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);

test('the production renderer preserves the approved Pine Hills atmosphere contract', () => {
  assert.match(source, /renderer\.outputColorSpace\s*=\s*THREE\.SRGBColorSpace/);
  assert.match(source, /renderer\.toneMapping\s*=\s*THREE\.ACESFilmicToneMapping/);
  assert.match(source, /renderer\.toneMappingExposure\s*=\s*1\.12/);
  assert.match(source, /renderer\.shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/);
  assert.match(source, /new THREE\.FogExp2\(0xd8d5cb,/);
  assert.match(source, /new THREE\.HemisphereLight\(0xfff4e0, 0xb9b4a5,/);
  assert.match(source, /new THREE\.AmbientLight\(0xfff2e0,/);
});
