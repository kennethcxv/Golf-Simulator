// THE STOCK BAKER MUST NOT DELETE THE BAKE.
//
// merch.bake() merges a fixture's goods per material, and to make the merge
// legal it strips attributes it does not expect. `color` was on that list. The
// v5 hero garments carry COLOR_0 on every primitive and arrive from the loader
// with material.vertexColors = true, so stripping it left the material asking
// for a colour stream that no longer existed — measured on the towel as
// vertexColors:true with geometry.color absent (qa/goal37/wired.json).
//
// Behaviour is proved by tools/qa/goal37-hero-apparel-ingame.js, which reads
// the live scene and reports COLOR_0 per hero material; it was watched failing
// on this exact defect and passing after. This guards the two lines that fix
// permanently, because both look like tidy-up and neither has an obvious owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/render3d/clubhouse/merch.js', import.meta.url), 'utf8');

test('the per-material bake keeps COLOR_0 rather than stripping it', () => {
  assert.match(source, /\['position', 'normal', 'uv', 'color'\]\.includes\(attr\)/,
    'color is part of the bake, not an exotic attribute to drop');
  assert.doesNotMatch(source, /\['position', 'normal', 'uv'\]\.includes\(attr\)/,
    'the three-attribute allow-list is what deleted the vertex colours');
});

test('a bucket with mixed colour is filled rather than left to throw', () => {
  // mergeGeometries requires identical attribute sets. A bucket is keyed by
  // material so its members normally agree, but a mismatch must not collapse a
  // whole display into loose meshes — white multiplies to a no-op.
  assert.match(source, /const withColor = geos\.find\(\(g\) => g\.attributes\.color\)/);
  assert.match(source, /new THREE\.BufferAttribute\(new Float32Array\(n \* size\)\.fill\(1\), size\)/,
    'the fill is WHITE: any other value would tint goods that never asked for it');
});

test('the hero apparel loads RAW, so its authored materials survive', () => {
  // instantiate() remaps every material to a palette slot, and none of the v5
  // material names are in SLOT or TINTABLE — they would all resolve to
  // charcoal, discarding the maps, the sheen and the vertex colour together.
  const raw = source.slice(source.indexOf('const RAW = ['), source.indexOf('const SLOT = {'));
  for (const name of ['hero_polo_hung', 'hero_polo_folded', 'hero_hoodie_hung',
    'hero_trousers_folded', 'hero_cap', 'hero_cap_peg', 'hero_towel']) {
    assert.ok(raw.includes(`'${name}'`), `${name} is in the RAW family`);
  }
  const files = source.slice(source.indexOf('const FILES = ['), source.indexOf('const RAW = ['));
  assert.doesNotMatch(files, /hero_polo|hero_cap|hero_towel|hero_hoodie|hero_trousers|hero_tee/,
    'a hero garment in FILES would be palette-remapped and lose its bake');
});
