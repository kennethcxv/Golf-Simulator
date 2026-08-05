// THE MACHINE MUST FACE THE CHAIR.
//
// The brief says the laptop's orientation "may be wrong" and asks for debug helpers to prove
// it either way. Helpers you look at once and delete prove nothing tomorrow. The laptop's
// physical frame is pure geometry — a lid angle, a hinge axis, a deck — so it can be asserted
// here, forever, without standing up a WebGL context.
//
// The convention, fixed once and depended on everywhere: the seat is at LOCAL -Z. The hinge
// runs along local X at the far edge (+z). So the machine opens AWAY from the player and the
// display leans back toward them. Every claim below is a claim about that.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAPTOP, screenNormalLocal, screenCornersLocal, hingeAxisLocal, forwardLocal, lidTipLocal,
} from '../src/core/laptopRig.js';

const OPEN = LAPTOP.lidOpen;
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

test('the hinge is at the far edge, so the lid opens away from the player', () => {
  // seat is at -z, so a positive hinge z is the edge furthest from them
  assert.ok(LAPTOP.hingeZ > 0, 'hinge sits on the far edge');
  const closed = lidTipLocal(0);
  const open = lidTipLocal(OPEN);
  // relative to the lid's own depth, so this keeps meaning something if the machine is resized
  const rise = (open.y - LAPTOP.hingeY) / LAPTOP.lid.d;
  assert.ok(closed.y <= LAPTOP.hingeY + 1e-9, 'closed: the lid lies flat on the deck');
  assert.ok(rise > 0.85, `open: the lid stands up (tip is ${(rise * 100).toFixed(0)}% of its depth above the barrel)`);
  assert.ok(open.z > closed.z, 'and it swings AWAY from the seat, not into the player');
});

test('the keyboard is nearest the player and the display is beyond it', () => {
  // the brief's exact requirement. -z is the seat, so "nearer" means "more negative z".
  assert.ok(LAPTOP.trackpad.z < LAPTOP.keyboard.z, 'trackpad sits closest to the seat (palm rest)');
  assert.ok(LAPTOP.keyboard.z < LAPTOP.hingeZ, 'the keyboard is nearer the player than the display');
  const screen = screenCornersLocal(OPEN);
  const screenZ = screen.reduce((a, c) => a + c.z, 0) / 4;
  assert.ok(screenZ > LAPTOP.keyboard.z, 'the display is beyond the keyboard, not in front of it');
});

test('the open screen faces the seat', () => {
  const n = screenNormalLocal(OPEN);
  // the player sits at -z and looks toward +z. The screen must look back at them.
  assert.ok(n.z < 0, `the screen normal points at the seat (z=${n.z.toFixed(3)})`);
  assert.ok(dot(n, forwardLocal()) > 0.9, 'and it is very nearly square-on to them');
  assert.ok(n.y > 0, 'tilted slightly up, the way a reclined lid actually sits');
});

test('a closed lid faces DOWN, not at the player', () => {
  const n = screenNormalLocal(0);
  assert.ok(n.y < -0.9, 'shut, the display is face-down on the deck');
});

test('the lid reclines past vertical, like a real machine', () => {
  assert.ok(OPEN > Math.PI / 2, 'past 90 degrees');
  assert.ok(OPEN < Math.PI * 0.62, 'but nowhere near folded flat backwards');
});

test('the hinge axis is horizontal and square to the seat', () => {
  const h = hingeAxisLocal();
  assert.equal(h.y, 0, 'the hinge is level');
  assert.equal(h.z, 0, 'and runs across the machine, not along it');
  assert.equal(Math.abs(h.x), 1, 'i.e. along local X');
  assert.ok(Math.abs(dot(h, forwardLocal())) < 1e-9, 'so the lid swings in the player’s sagittal plane');
});

test('the screen corners come back in a defined order - no sorting heuristic', () => {
  // main.js used to sort the projected corners by y to guess which were "top". That guess is
  // only ever as good as the camera angle. The lid's own frame knows the answer exactly, so
  // the order is [top-left, top-right, bottom-right, bottom-left] as the SEATED PLAYER reads it.
  const [tl, tr, br, bl] = screenCornersLocal(OPEN);
  assert.ok(tl.y > bl.y, 'top-left is above bottom-left');
  assert.ok(tr.y > br.y, 'top-right is above bottom-right');
  // the player looks along +z, so their right hand is at local -x
  assert.ok(tr.x < tl.x, 'top-right is to the player’s right (local -x)');
  assert.ok(br.x < bl.x, 'bottom-right likewise');
  const w = Math.hypot(tr.x - tl.x, tr.y - tl.y, tr.z - tl.z);
  const h = Math.hypot(bl.x - tl.x, bl.y - tl.y, bl.z - tl.z);
  assert.ok(Math.abs(w - LAPTOP.screen.w) < 1e-6, 'the top edge is one screen wide');
  assert.ok(Math.abs(h - LAPTOP.screen.h) < 1e-6, 'the side edge is one screen tall');
});

test('the screen sits inside the lid - there is a real bezel', () => {
  assert.ok(LAPTOP.bezel > 0.005, 'a visible bezel, not a hairline');
  assert.ok(LAPTOP.screen.w + 2 * LAPTOP.bezel <= LAPTOP.lid.w + 1e-9, 'the display fits across the lid');
  assert.ok(LAPTOP.screen.h + 2 * LAPTOP.bezel <= LAPTOP.lid.d + 1e-9, 'and down it');
});

test('the machine is a believable size', () => {
  // a 15" laptop is about 0.36 x 0.25 m. A yard is 0.9144 m.
  const wIn = (LAPTOP.deck.w * 0.9144 * 39.37);
  const diagIn = Math.hypot(LAPTOP.screen.w, LAPTOP.screen.h) * 0.9144 * 39.37;
  assert.ok(wIn > 11 && wIn < 17, `deck is ${wIn.toFixed(1)}" across - a real laptop`);
  assert.ok(diagIn > 12 && diagIn < 18, `the display is a ${diagIn.toFixed(1)}" panel`);
});
