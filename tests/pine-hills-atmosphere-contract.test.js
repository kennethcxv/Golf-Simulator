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
  // ROUND 7 — THIS CLAUSE WAS CHANGED TO PCFShadowMap AND CHANGED BACK, and the
  // reason belongs here so the next person does not repeat the round trip.
  //
  // Three deprecated PCFSoftShadowMap and rewrites it to PCFShadowMap at the
  // first shadow bake (vendor/three.module.js:9148), so this clause reads like
  // it pins a value the renderer never uses. Declaring PCFShadowMap directly
  // looks strictly better -- and measured, on that single line with everything
  // else identical, it produced 256 `Mismatch between texture format and
  // sampler type (signed/unsigned/float/shadow)` GL errors against 0
  // (tools/qa/electron-gl-error-count.js). The deprecation rewrite is load-
  // bearing: it invalidates every program compiled before the shadow maps
  // existed and forces them to rebuild once they do.
  //
  // So the clause stands as approved, and the shadow-type value is NOT the lever
  // for first-reveal shader compiles. The gesture warm at the end of prewarm is.
  assert.match(source, /renderer\.shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/);
  assert.match(source, /new THREE\.FogExp2\(0xd8d5cb,/);
  assert.match(source, /new THREE\.HemisphereLight\(0xfff4e0, 0xb9b4a5,/);
  assert.match(source, /new THREE\.AmbientLight\(0xfff2e0,/);
});
