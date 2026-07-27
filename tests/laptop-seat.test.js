// WHERE YOU SIT, AND WHAT YOU SEE FROM THERE.
//
// The brief asks for the screen to fill 70-85% of the viewport with some bezel and keyboard still
// showing. That is a claim about a camera, a lens and a panel — three numbers — so it can be
// checked here rather than measured off a screenshot once and then quietly rotting.
//
// The two that bit: the panel used to be a 23.8-inch television (see laptop-rig.test.js), and the
// seat was computed through walk mode's 66-degree lens, which put the eye 8 inches from the glass
// with the keyboard filling a third of the frame. A laptop is read from about 17 inches away.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fitDistance, coverage } from '../src/core/screenFit.js';
import { LAPTOP } from '../src/core/laptopRig.js';

// the seated lens, as main.js sets it before deriving the pose
const LAPTOP_FOV = 34;
const WALK_FOV = 66;
const NEAR = 0.03;
const SCREEN = { screenW: LAPTOP.screen.w, screenH: LAPTOP.screen.h };
const YD_TO_IN = 36;

const seatAt = (aspect, fov = LAPTOP_FOV) =>
  fitDistance({ ...SCREEN, fovDeg: fov, aspect, fracH: 0.80, fracW: 0.90 });

test('the screen fills 70-85% of a widescreen view, as the brief asks', () => {
  const opts = { ...SCREEN, fovDeg: LAPTOP_FOV, aspect: 16 / 9 };
  const c = coverage({ ...opts, dist: seatAt(16 / 9) });
  assert.ok(c.heightFrac >= 0.70, `fills the height (${(c.heightFrac * 100).toFixed(0)}%)`);
  assert.ok(c.heightFrac <= 0.85, 'and is not crammed against the top and bottom');
  assert.ok(c.widthFrac <= 0.95, 'and stays inside the frame');
});

test('...leaving real room for the bezel and a strip of keyboard', () => {
  const c = coverage({ ...SCREEN, fovDeg: LAPTOP_FOV, aspect: 16 / 9, dist: seatAt(16 / 9) });
  const spare = 1 - c.heightFrac;
  assert.ok(spare > 0.14, `${(spare * 100).toFixed(0)}% of the height is machine, not screen`);
});

test('you sit about arm’s length from the glass, not with your nose on it', () => {
  const inches = seatAt(16 / 9) * YD_TO_IN;
  assert.ok(inches > 12, `${inches.toFixed(1)}" — a reading distance, not a magnifying glass`);
  assert.ok(inches < 26, 'but close enough that the screen is the point');
});

test('THE LENS IS WHY. The wide walk-mode lens puts your face in the keyboard', () => {
  // Same panel, same 80% coverage, two lenses. This is the whole argument for changing the FOV
  // when you sit down, and it is why the first attempt looked wrong while being correct.
  const wide = seatAt(16 / 9, WALK_FOV) * YD_TO_IN;
  const long = seatAt(16 / 9, LAPTOP_FOV) * YD_TO_IN;
  assert.ok(wide < 10, `at ${WALK_FOV}° you must sit ${wide.toFixed(1)}" away — inside the keyboard`);
  assert.ok(long > wide * 1.8, `at ${LAPTOP_FOV}° you sit ${long.toFixed(1)}" back, and the perspective settles`);
});

test('the seat clears the near plane at every window shape', () => {
  // The camera gets its own near plane when seated (0.03 yd). If the seat were ever closer than
  // that, the screen would be clipped clean out of existence and the interface would vanish.
  for (const aspect of [21 / 9, 16 / 9, 16 / 10, 4 / 3, 1, 3 / 4]) {
    const d = seatAt(aspect);
    assert.ok(d > NEAR * 2, `aspect ${aspect.toFixed(2)}: seat ${d.toFixed(3)} yd clears near ${NEAR}`);
  }
});

test('a tall, narrow window seats you further back rather than cropping the screen', () => {
  const wide = seatAt(16 / 9);
  const square = seatAt(1);
  assert.ok(square > wide, 'squarer window => sit back');
  const c = coverage({ ...SCREEN, fovDeg: LAPTOP_FOV, aspect: 1, dist: square });
  assert.ok(c.widthFrac <= 0.95, 'and the screen never overflows the sides');
  assert.ok(c.heightFrac <= 0.85, 'nor the top');
});

test('the interface and the panel are the same shape, so no glyph is stretched', () => {
  // The DOM is 1024x640. If the panel were not exactly that aspect, the matrix3d that maps one
  // onto the other would scale x and y differently and every letter would be quietly squashed.
  const uiAspect = 1024 / 640;
  const panelAspect = LAPTOP.screen.w / LAPTOP.screen.h;
  assert.ok(Math.abs(uiAspect - panelAspect) < 0.005,
    `interface ${uiAspect.toFixed(3)} vs panel ${panelAspect.toFixed(3)} — must match`);
});
