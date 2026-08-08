import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// H2 (Goal 17) — FACIAL FEATURES MUST BE BURIED IN THE SKIN THAT IS DRAWN,
// NOT THE SKIN THAT IS SPECIFIED.
//
// The brow was already inside the skull's NOMINAL 0.155 radius - on paper it
// was seated. But a UV SphereGeometry is a polygon in both axes, and between
// its vertices the drawn surface pulls in by cos(pi/w) * cos(pi/h). At 20 x 14
// the skin that actually renders sat at 0.1521 while the brow's inner face was
// at 0.1523: proud by 0.2 mm, on the facets, which is exactly "from the side
// they sit off the skin with a visible gap".
//
// This is the same class as H3's belt: geometry seated against a nominal radius
// that the renderer never draws. So the check measures the DRAWN surface.

const src = fs.readFileSync(new URL('../src/render3d/characterAsset.js', import.meta.url), 'utf8');

const skull = (() => {
  const m = /new THREE\.SphereGeometry\(([\d.]+), (\d+), (\d+)\), mSkin\)/.exec(src);
  return m ? { r: Number(m[1]), w: Number(m[2]), h: Number(m[3]) } : null;
})();

const brow = (() => {
  // box(w, h, d, mat, y, z) then position.x = x * 1.02, with x = 0.057
  const m = /const brow = box\([\d.]+, [\d.]+, ([\d.]+), mBrow, ([\d.]+), ([\d.]+)\);/.exec(src);
  return m ? { depth: Number(m[1]), y: Number(m[2]), z: Number(m[3]), x: 0.057 * 1.02 } : null;
})();

const SKULL_CENTRE_Y = 0.06; // skull.position.y

test('the skull and the brow are both findable', () => {
  assert.ok(skull, 'skull sphere found');
  assert.ok(brow, 'brow box found');
});

test('the brow is buried in the DRAWN skin, not just the nominal sphere', () => {
  // the nearest point of the brow to the skull centre
  const inner = Math.hypot(brow.x, brow.y - SKULL_CENTRE_Y, brow.z - brow.depth / 2);
  // what a UV sphere actually draws between its vertices
  const drawn = skull.r * Math.cos(Math.PI / skull.w) * Math.cos(Math.PI / (skull.h * 1.4));
  assert.ok(
    drawn > inner,
    `drawn skin ${drawn.toFixed(4)} must be outside the brow's inner face ${inner.toFixed(4)} `
    + `- otherwise the brow floats on the facets`,
  );
});

test('the skull is round enough that nominal and drawn barely differ', () => {
  // the guard against "fix it by burying the feature deeper", which would sink
  // the brow into the face at the vertices instead of floating at the facets
  const shortfall = skull.r - skull.r * Math.cos(Math.PI / skull.w);
  assert.ok(shortfall < 0.0015,
    `the skull's facets pull in by ${(shortfall * 1000).toFixed(2)} mm, which must stay under 1.5 mm`);
});
