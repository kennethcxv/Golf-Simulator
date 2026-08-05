// Sitting down at the laptop must actually put you at the laptop.
//
// Measured before: the seated camera left the physical screen filling 9.7% of the viewport
// (39.6% wide x 24.7% tall). The interface is a 1024x640 DOM projected onto that quad, so at
// that size every glyph was squeezed into a third of its pixels and the whole management surface
// of the game was unreadable. The brief wants the screen to dominate the view — with a little
// bezel and a strip of keyboard still showing, so it reads as a laptop and not a fullscreen menu.
//
// The camera distance is therefore derived from the screen, the field of view and the window
// shape — never hardcoded, because a hardcoded seat is wrong the moment any of the three change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fitDistance, coverage } from '../src/core/screenFit.js';

const SCREEN = { screenW: 0.56, screenH: 0.35 }; // the laptop lid, in yards

test('the seat is close enough that the screen dominates a widescreen view', () => {
  const opts = { ...SCREEN, fovDeg: 60, aspect: 16 / 9 };
  const dist = fitDistance(opts);
  const c = coverage({ ...opts, dist });
  assert.ok(c.heightFrac >= 0.70, `screen fills the height (${(c.heightFrac * 100).toFixed(0)}%)`);
  assert.ok(c.heightFrac <= 0.86, 'but is not cropped off the top');
  assert.ok(c.widthFrac <= 0.95, 'and stays inside the frame horizontally');
});

test('a square window is width-bound, and the screen still fits inside it', () => {
  const opts = { ...SCREEN, fovDeg: 60, aspect: 1.0 };
  const dist = fitDistance(opts);
  const c = coverage({ ...opts, dist });
  assert.ok(c.widthFrac <= 0.95, `never overflows the sides (${(c.widthFrac * 100).toFixed(0)}%)`);
  assert.ok(c.heightFrac <= 0.95, 'nor the top');
  // a narrow window must push the camera *back*, not crop
  const wide = fitDistance({ ...SCREEN, fovDeg: 60, aspect: 16 / 9 });
  assert.ok(dist > wide, 'a squarer window seats you further back');
});

test('an ultrawide window is height-bound', () => {
  const opts = { ...SCREEN, fovDeg: 60, aspect: 21 / 9 };
  const c = coverage({ ...opts, dist: fitDistance(opts) });
  assert.ok(c.heightFrac >= 0.70, 'the height is what limits it');
  assert.ok(c.widthFrac < c.heightFrac, 'there is spare room at the sides');
});

test('a wider field of view seats you closer, for the same coverage', () => {
  const near = fitDistance({ ...SCREEN, fovDeg: 80, aspect: 16 / 9 });
  const far = fitDistance({ ...SCREEN, fovDeg: 50, aspect: 16 / 9 });
  assert.ok(near < far, 'wide angle => sit closer');
  // and both land on the same framing
  const cn = coverage({ ...SCREEN, fovDeg: 80, aspect: 16 / 9, dist: near });
  const cf = coverage({ ...SCREEN, fovDeg: 50, aspect: 16 / 9, dist: far });
  assert.ok(Math.abs(cn.heightFrac - cf.heightFrac) < 0.02, 'the framing is FOV-independent');
});

test('the framing is a huge improvement on what was measured', () => {
  const opts = { ...SCREEN, fovDeg: 60, aspect: 16 / 9 };
  const c = coverage({ ...opts, dist: fitDistance(opts) });
  assert.ok(c.areaFrac > 0.45, `screen area ${(c.areaFrac * 100).toFixed(0)}% - was 9.7%`);
});

test('coverage and fit are inverses', () => {
  const opts = { ...SCREEN, fovDeg: 60, aspect: 16 / 9, fracH: 0.75, fracW: 0.9 };
  const c = coverage({ ...opts, dist: fitDistance(opts) });
  // whichever constraint binds, it should sit exactly on its limit
  const onLimit = Math.abs(c.heightFrac - 0.75) < 1e-6 || Math.abs(c.widthFrac - 0.9) < 1e-6;
  assert.ok(onLimit, `one constraint is tight (h=${c.heightFrac}, w=${c.widthFrac})`);
});

test('sitting further back always shrinks the screen', () => {
  const opts = { ...SCREEN, fovDeg: 60, aspect: 16 / 9 };
  const near = coverage({ ...opts, dist: 0.4 });
  const far = coverage({ ...opts, dist: 0.8 });
  assert.ok(far.heightFrac < near.heightFrac);
  assert.ok(Math.abs(far.heightFrac - near.heightFrac / 2) < 1e-9, 'and does so linearly');
});
