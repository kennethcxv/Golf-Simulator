// THE HAND MATERIALS ARE DEFINED ONCE AND SHARED, NOT REBUILT PER RIG.
//
// `broomViewmodel.js` used to construct its own `skin`, `cuff` and `cuffDark`
// from the same SKIN / CUFF / CUFF_DARK constants and the same roughness values
// that `fpHands.js` already uses — identical materials, built twice, and once
// PER RIG because `createBroomViewmodel` runs for every stick tool.
//
// Measured on the live build before the fix: the first tool equip brought 9
// distinct MeshStandardMaterials into the scene; after it, 7. Two fewer per rig,
// with no visual change at all, because the colours were always the same
// constants.
//
// That did NOT fix the equip stall — a field-by-field diff of the nine shader
// cache keys showed five are `depth` (shadow-map) programs, which
// `renderer.compile()` cannot warm and which no material change touches. The
// deduplication is kept on its own merits, and this test exists so it cannot
// quietly come back.
//
// WATCHED FAILING: with the `fpHands.mats` reuse removed from broomViewmodel.js
// (restoring its own three `new THREE.MeshStandardMaterial` lines), the second
// assertion fails on the un-deduplicated build.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hands = fs.readFileSync(new URL('../src/render3d/fpHands.js', import.meta.url), 'utf8');
const rig = fs.readFileSync(new URL('../src/render3d/broomViewmodel.js', import.meta.url), 'utf8');

// Comments describe the fix and quote the old code, so a source scan that does
// not strip them matches its own explanation and can never fail.
const stripComments = (text) => text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const handsCode = stripComments(hands);
const rigCode = stripComments(rig);

test('fpHands exposes its material set so others can share it', () => {
  assert.match(handsCode, /return\s*\{[\s\S]{0,400}\bmats\b/,
    'makeFpHands() must return `mats`; without it a rig has nothing to reuse');
});

test('the rig reuses the hands’ materials rather than building a second set', () => {
  assert.match(rigCode, /fpHands\s*&&\s*fpHands\.mats|fpHands\?\.\s*mats/,
    'broomViewmodel must take its arm materials from fpHands when they are available');
});

test('the fallback still exists, so the module stands alone', () => {
  // Reuse must not make this module require a caller that passes hands. The
  // fallback is the difference between sharing and coupling.
  assert.match(rigCode, /new THREE\.MeshStandardMaterial\(\{ color: SKIN/,
    'a standalone fallback set must remain for callers that pass no hands');
});

test('the shared set is the one the hands actually use', () => {
  // Both files still declare the same colour constants; if they ever diverge,
  // sharing would silently change the arms’ appearance. Pin that they match.
  for (const name of ['SKIN', 'CUFF', 'CUFF_DARK']) {
    const inHands = new RegExp(`const ${name} = (0x[0-9a-f]+)`).exec(handsCode);
    const inRig = new RegExp(`const ${name} = (0x[0-9a-f]+)`).exec(rigCode);
    if (!inHands || !inRig) continue;   // one of them stopped declaring it: not this test's business
    assert.equal(inRig[1], inHands[1],
      `${name} differs between fpHands and broomViewmodel; sharing would change how the arms look`);
  }
});
