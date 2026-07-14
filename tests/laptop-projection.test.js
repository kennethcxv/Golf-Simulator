// THE INTERFACE IS WELDED TO THE GLASS, OR IT IS A POPUP.
//
// The Fairway Office is a 1024x640 DOM mapped onto the four projected corners of the physical
// display by a CSS matrix3d. Get that map wrong by a frame and the whole thing reads as a
// floating panel that happens to be near a laptop — which is exactly what the brief rejected.
//
// It WAS wrong. The alignment ran twice on a wall-clock timer while the camera was still easing
// and the lid still swinging, so the transform always described where the screen USED to be.
// Measured in the browser: after forcing one extra re-align, the DOM's box was exactly the
// live quad from the PREVIOUS probe. One alignment behind, permanently.
//
// The map itself was never the bug — so pin it, and pin the inverse too, because the inverse is
// what turns a mouse position into a point on the glass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { homography, quadTransform, uvAt, applyH } from '../src/core/laptopProjection.js';

const W = 1024;
const H = 640;
// a plausible foreshortened laptop screen: leaning back, seen slightly from the left
const QUAD = [
  { x: 220, y: 90 },   // tl
  { x: 1380, y: 130 }, // tr
  { x: 1330, y: 780 }, // br
  { x: 260, y: 810 },  // bl
];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the four corners of the interface land exactly on the four corners of the glass', () => {
  const h = homography(W, H, QUAD);
  const src = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  src.forEach((s, i) => {
    const p = applyH(h, s.x, s.y);
    assert.ok(near(p.x, QUAD[i].x, 1e-6), `corner ${i} x: ${p.x} vs ${QUAD[i].x}`);
    assert.ok(near(p.y, QUAD[i].y, 1e-6), `corner ${i} y: ${p.y} vs ${QUAD[i].y}`);
  });
});

test('a mouse on the glass maps back to the pixel under it — the UV hit', () => {
  // this is what makes the screen CLICKABLE as a physical object rather than as a DOM overlay
  // that happens to sit there. Forward, then back, must be the identity.
  const h = homography(W, H, QUAD);
  for (const [u, v] of [[0.5, 0.5], [0.1, 0.9], [0.87, 0.23], [0, 0], [1, 1]]) {
    const p = applyH(h, u * W, v * H);
    const back = uvAt(W, H, QUAD, p.x, p.y);
    assert.ok(near(back.u, u, 1e-9), `u round-trips (${back.u} vs ${u})`);
    assert.ok(near(back.v, v, 1e-9), `v round-trips (${back.v} vs ${v})`);
  }
});

test('a point outside the glass reports outside — the cursor knows when it has left the screen', () => {
  const off = uvAt(W, H, QUAD, 40, 40); // well up and left of the display
  assert.ok(off.u < 0 || off.v < 0, 'reads as off-screen');
  const on = uvAt(W, H, QUAD, 800, 450);
  assert.ok(on.u >= 0 && on.u <= 1 && on.v >= 0 && on.v <= 1, 'and a point on the glass reads as on it');
});

test('a screen seen square-on needs no warping at all', () => {
  const flat = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const h = homography(W, H, flat);
  const p = applyH(h, 300, 200);
  assert.ok(near(p.x, 300) && near(p.y, 200), 'the identity quad is the identity map');
  const uv = uvAt(W, H, flat, 512, 320);
  assert.ok(near(uv.u, 0.5) && near(uv.v, 0.5), 'and the centre is the centre');
});

test('the CSS matrix is the homography, in the order CSS actually reads it', () => {
  // matrix3d is COLUMN-major: (m11,m12,m13,m14, m21,...). Transpose it by accident and the
  // interface shears off the side of the laptop — which looks exactly like a bad camera angle.
  const h = homography(W, H, QUAD);
  const css = quadTransform(W, H, QUAD);
  const n = css.replace('matrix3d(', '').replace(')', '').split(',').map(Number);
  assert.equal(n.length, 16);
  assert.ok(near(n[0], h[0]), 'm11 = a');
  assert.ok(near(n[1], h[3]), 'm12 = d');
  assert.ok(near(n[3], h[6]), 'm14 = g (the perspective term)');
  assert.ok(near(n[4], h[1]), 'm21 = b');
  assert.ok(near(n[5], h[4]), 'm22 = e');
  assert.ok(near(n[7], h[7]), 'm24 = h');
  assert.ok(near(n[12], h[2]), 'm41 = c (translation x)');
  assert.ok(near(n[13], h[5]), 'm42 = f (translation y)');
  assert.ok(near(n[10], 1) && near(n[15], 1), 'z untouched, w normalised');
});

test('a quad that has collapsed to nothing does not produce NaN', () => {
  // the lid is CLOSED when the player presses E. If anything asks for the transform on frame
  // zero, the screen is edge-on and its projected area is ~0. Returning NaN there would poison
  // the DOM's transform for the rest of the session.
  const degenerate = [{ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }];
  const css = quadTransform(W, H, degenerate);
  assert.ok(css === null || !/NaN/.test(css), 'either refuses, or refuses to emit NaN');
});
