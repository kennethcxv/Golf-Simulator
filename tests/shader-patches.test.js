import test from 'node:test';
import assert from 'node:assert/strict';
import { patchPoissonDenoiseMaterial } from '../src/render3d/shaderPatches.js';

test('Poisson denoise uses the fixed noise channel without changing its result', () => {
  const material = {
    fragmentShader: 'vec4 noiseTexel; float a = noiseTexel[index % 4];',
    needsUpdate: false,
  };
  assert.equal(patchPoissonDenoiseMaterial(material), true);
  assert.equal(material.fragmentShader, 'vec4 noiseTexel; float a = noiseTexel.x;');
  assert.equal(material.needsUpdate, true);
});

test('Poisson patch is explicit and idempotent', () => {
  const material = { fragmentShader: 'float a = noiseTexel.x;', needsUpdate: false };
  assert.equal(patchPoissonDenoiseMaterial(material), false);
  assert.equal(material.fragmentShader, 'float a = noiseTexel.x;');
  assert.equal(material.needsUpdate, false);
});
