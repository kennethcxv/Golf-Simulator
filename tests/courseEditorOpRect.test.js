import test from 'node:test';
import assert from 'node:assert/strict';
import { opCellRect } from '../src/sim/courseEditor.js';

// Undo/redo used to rebuild the whole course for a single reverted stroke
// (measured 848 ms). opCellRect turns an op's touched cells into the refresh
// window. A rect that is too SMALL leaves stale terrain behind, so the bounds
// must be inclusive of every cell the op recorded.
const state = { course: { w: 120, h: 80 } };
const at = (x, y) => ({ i: y * 120 + x });

test('rect spans every touched cell, inclusively', () => {
  const op = { cells: [at(10, 5), at(14, 9), at(12, 7)] };
  assert.deepEqual(opCellRect(state, op), { x0: 10, y0: 5, x1: 14, y1: 9 });
});

test('a single cell yields a degenerate but valid rect', () => {
  assert.deepEqual(opCellRect(state, { cells: [at(63, 41)] }), {
    x0: 63, y0: 41, x1: 63, y1: 41,
  });
});

test('cells on the grid edges keep their real coordinates', () => {
  const op = { cells: [at(0, 0), at(119, 79)] };
  assert.deepEqual(opCellRect(state, op), { x0: 0, y0: 0, x1: 119, y1: 79 });
});

test('index maths does not transpose x and y', () => {
  // i = y*w + x, so cell (3, 1) is index 123 with w=120 — not 361.
  assert.deepEqual(opCellRect(state, { cells: [{ i: 123 }] }), {
    x0: 3, y0: 1, x1: 3, y1: 1,
  });
});

test('ops with no cells return null so the caller falls back to a full refresh', () => {
  // object placement, hole settings, pin/tee selection all carry cells: null
  for (const op of [null, undefined, {}, { cells: null }, { cells: [] }]) {
    assert.equal(opCellRect(state, op), null);
  }
});

test('non-integer cell indices are ignored rather than poisoning the rect', () => {
  const op = { cells: [at(20, 10), { i: undefined }, { i: 1.5 }, at(24, 12)] };
  assert.deepEqual(opCellRect(state, op), { x0: 20, y0: 10, x1: 24, y1: 12 });
});

test('an op whose cells are all invalid returns null, not an infinite rect', () => {
  const rect = opCellRect(state, { cells: [{ i: undefined }, { i: null }] });
  assert.equal(rect, null, 'Infinity bounds would scope the refresh to nothing');
});
