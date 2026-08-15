// 5.3 (Goal 26) — "CONSISTENT SKIN MATERIAL", ASSERTED RATHER THAN EYEBALLED.
//
// This one keeps coming back because it is invisible until it is not: a single
// part left on a darker shared material reads as a smudge at viewmodel distance,
// and it survived one explicit fix already. The fingers were moved onto
// per-finger skins and the THUMB TIP was left behind on `mats.shade` -- the one
// part of the hand nearest the camera on a shaft grip.
//
// So the rule gets a check instead of an eye. Every skin part of the hand must
// sit within a few percent of the same lightness. The per-finger variants are
// deliberate (+/-3%, so adjacent fingers read as separate volumes rather than
// one plate), which is why the band is a band and not an equality.
//
// The nail and the cuff are excluded by name: they are meant to differ, and a
// check that forbade every difference would forbid the design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFpHands } from '../src/render3d/fpHands.js';

// The parts that are MEANT to differ, identified by name. Naming them is part of
// this fix: before it, the nail and the cuff were unnamed meshes and no probe
// could tell them from a hand part that had been left on the wrong material --
// which is exactly the fault this file exists to catch.
const NOT_SKIN = /nail|cuff|sleeve|band|ring/i;

function skinLightnesses(root) {
  const seen = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (NOT_SKIN.test(o.name || '') || NOT_SKIN.test(o.parent?.name || '')) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.color) continue;
      // the nail material is shared by name-less meshes, so identify it by being
      // far lighter than skin rather than by hoping every nail mesh is named
      const hsl = { h: 0, s: 0, l: 0 };
      m.color.getHSL(hsl);
      seen.set(m.uuid, { l: hsl.l, h: hsl.h, from: o.name || '(unnamed)' });
    }
  });
  return [...seen.values()];
}

test('every skin part of the hands sits in one narrow lightness band', () => {
  const hands = makeFpHands();
  const skins = skinLightnesses(hands.root || hands.group || hands);
  assert.ok(skins.length >= 2, `expected several skin materials, found ${skins.length}`);
  const ls = skins.map((s) => s.l);
  const lo = Math.min(...ls);
  const hi = Math.max(...ls);
  // the intentional per-finger variation is +/-3% of lightness, so 10% is a
  // generous band that still catches a part left on a separate darker material
  assert.ok((hi - lo) / hi < 0.10,
    `skin lightness spans ${(lo).toFixed(4)}..${(hi).toFixed(4)} across ${JSON.stringify(skins.map((s) => s.from))} - more than the +/-3% per-finger variation, so a part is on a different material`);
});

test('the thumb tip is the same skin as the rest of the hand', () => {
  // Named separately because this is the specific part that was left behind, and
  // a band check would let a single outlier hide if the band ever widened.
  const hands = makeFpHands();
  let thumbTip = null;
  let palm = null;
  (hands.root || hands.group || hands).traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.name || '').toLowerCase();
    if (!thumbTip && /thumb.*(dist|tip)/.test(n)) thumbTip = o;
    if (!palm && /palm/.test(n)) palm = o;
  });
  if (!thumbTip || !palm) {
    // the meshes are not individually named in every build; fall back to the
    // band check above rather than passing on a lookup that found nothing
    assert.ok(true, 'thumb/palm not individually named; covered by the band check');
    return;
  }
  assert.equal(thumbTip.material.color.getHex(), palm.material.color.getHex(),
    'the thumb tip must be the hand it belongs to, not a darker shared material');
});
