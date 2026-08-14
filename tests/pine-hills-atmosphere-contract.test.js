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
  // ROUND 7 — THIS CLAUSE PINNED A VALUE THE RENDERER NEVER USED.
  //
  // It asserted PCFSoftShadowMap. Three deprecated that constant: the first
  // shadow bake warns and rewrites the field to PCFShadowMap
  // (vendor/three.module.js:9148), so the approved atmosphere has been drawn
  // with PCF for as long as this vendored three has been in the tree. The
  // clause was true of the SOURCE and false of the PICTURE.
  //
  // It is re-pinned to the value actually in force rather than relaxed, because
  // the reason the clause exists is unchanged: the shadow type is an approved
  // atmosphere decision and must not drift silently. What it now also protects
  // is the shader cache -- shadowMapType is part of every program's cache key,
  // so a type that CHANGES after the first compiles leaves every program built
  // before the change stale, and any object still hidden at that moment pays a
  // recompile when the player first reveals it. That was measured as the
  // ledger's first page turn (qa/electron/firstuse-cachekey/).
  assert.match(source, /renderer\.shadowMap\.type\s*=\s*THREE\.PCFShadowMap/);
  // and never again the deprecated constant, whose only effect is that runtime
  // rewrite: it cannot change how the scene looks, only when programs go stale.
  assert.doesNotMatch(source, /THREE\.PCFSoftShadowMap/);
  assert.match(source, /new THREE\.FogExp2\(0xd8d5cb,/);
  assert.match(source, /new THREE\.HemisphereLight\(0xfff4e0, 0xb9b4a5,/);
  assert.match(source, /new THREE\.AmbientLight\(0xfff2e0,/);
});
