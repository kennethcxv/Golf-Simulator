// Physical guarantees for the till's money placement: every generated piece
// stays inside its authored compartment, rests on the floor or the layer
// below, never reshuffles between calls, and the retaining clip always rides
// the top of the stack. These pins are what "the drawer looks right" means.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billFit, billLayout, clipFillRatio, coinLayout, fillState, scramble,
} from '../src/render3d/clubhouse/drawerMoneyLayout.js';

// the shipped drawer contract, in world units (the Sheet-01 drawer is 1:1 scale)
const BILL_META = {
  well_w: 0.0572, well_d: 0.176, wall_h: 0.044,
  max_pieces: 12, spacing: 0.0016, hinge_drop: 0.039,
};
const COIN_META = {
  well_w: 0.0572, well_d: 0.136, wall_h: 0.028,
  max_pieces: 30, pile_h: 0.0032,
};
const COIN_R = (0.024 * 1.3) / 2;
const COIN_T = COIN_META.pile_h;

test('bill stacks stay inside their slot and step up one note at a time', () => {
  for (const denom of [1, 5, 10, 20, 50]) {
    const stack = billLayout(BILL_META, 12, denom);
    assert.equal(stack.length, 12);
    stack.forEach((p, i) => {
      assert.ok(Math.abs(p.dx) < BILL_META.well_w / 2, `bill ${denom}#${i} dx ${p.dx}`);
      assert.ok(Math.abs(p.dz) < BILL_META.well_d / 2, `bill ${denom}#${i} dz ${p.dz}`);
      assert.ok(p.dy > 0, `bill ${denom}#${i} rests above the floor`);
      if (i > 0) assert.ok(p.dy > stack[i - 1].dy, `bill ${denom}#${i} stacks upward`);
    });
    // the full stack still fits under the clip hinge
    const top = stack[stack.length - 1].dy;
    assert.ok(top < BILL_META.hinge_drop, `stack top ${top} under hinge ${BILL_META.hinge_drop}`);
  }
});

test('bill fit fills the slot without escaping it', () => {
  for (const [len, wid] of [[0.122, 0.054], [0.156, 0.066]]) {
    const fit = billFit(BILL_META, len * 1.3, wid * 1.3);
    const finalLen = len * 1.3 * fit.scaleLen;
    const finalWid = wid * 1.3 * fit.scaleWid;
    assert.ok(finalLen > BILL_META.well_d * 0.9 && finalLen < BILL_META.well_d, `len ${finalLen}`);
    assert.ok(finalWid > BILL_META.well_w * 0.85 && finalWid < BILL_META.well_w, `wid ${finalWid}`);
  }
});

test('the piece count is capped by the authored contract', () => {
  assert.equal(billLayout(BILL_META, 500, 20).length, BILL_META.max_pieces);
  assert.equal(coinLayout(COIN_META, 500, COIN_R, COIN_T, 0.2).pieces.length, COIN_META.max_pieces);
  assert.equal(billLayout(BILL_META, 0, 20).length, 0);
  assert.equal(coinLayout(COIN_META, 0, COIN_R, COIN_T, 0.2).pieces.length, 0);
});

test('every coin lands inside its well, resting, never re-rolled', () => {
  for (const denom of [0.01, 0.05, 0.1, 0.2, 0.5]) {
    const a = coinLayout(COIN_META, 30, COIN_R, COIN_T, denom).pieces;
    const b = coinLayout(COIN_META, 30, COIN_R, COIN_T, denom).pieces;
    assert.deepEqual(a, b, `coin ${denom} layout is deterministic`);
    a.forEach((p, i) => {
      assert.ok(Math.abs(p.dx) + COIN_R <= COIN_META.well_w / 2 + 1e-9, `coin ${denom}#${i} x-bound`);
      assert.ok(Math.abs(p.dz) + COIN_R <= COIN_META.well_d / 2 + 1e-9, `coin ${denom}#${i} z-bound`);
      assert.ok(p.dy >= COIN_T / 2 - 1e-9, `coin ${denom}#${i} rests on the floor`);
      assert.ok(p.dy < COIN_META.wall_h * 2.2, `coin ${denom}#${i} no levitating column`);
      assert.ok(Math.abs(p.rx) < 0.8 && Math.abs(p.rz) < 0.8, `coin ${denom}#${i} believable tilt`);
    });
  }
});

test('coin mounds read denser as the count grows (empty -> full)', () => {
  const at = (n) => coinLayout(COIN_META, n, COIN_R, COIN_T, 0.1).pieces.length;
  assert.equal(at(0), 0);
  assert.ok(at(4) < at(12));
  assert.ok(at(12) < at(30));
});

test('the retaining clip rides the stack: floor when empty, lifting as notes land', () => {
  assert.equal(clipFillRatio(BILL_META, 0), 0);
  const partial = clipFillRatio(BILL_META, 6);
  const full = clipFillRatio(BILL_META, 12);
  assert.ok(partial > 0 && partial < full, `clip lifts monotonically ${partial} ${full}`);
  assert.ok(full <= 1, 'clip never lifts past level');
  assert.equal(clipFillRatio({ ...BILL_META, hinge_drop: 0 }, 6), 0, 'degenerate hinge is safe');
});

test('fill state bands follow the authored cap', () => {
  assert.equal(fillState(0, 12), 'empty');
  assert.equal(fillState(2, 12), 'low');
  assert.equal(fillState(7, 12), 'moderate');
  assert.equal(fillState(12, 12), 'full');
  assert.equal(fillState(0, 30), 'empty');
  assert.equal(fillState(29, 30), 'full');
});

test('the scramble hash is stable across calls (no visual re-rolls on reload)', () => {
  for (let i = 0; i < 20; i += 1) {
    assert.equal(scramble(0.2, i, 3), scramble(0.2, i, 3));
  }
});
