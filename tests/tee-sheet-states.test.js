import test from 'node:test';
import assert from 'node:assert/strict';
import { TEE_SHEET_STATE_COLOURS } from '../src/sim/reservations.js';

// G12 (Goal 17) — FREE, RESERVED-AND-EXPECTED, AND CHECKED-IN MUST BE
// DISTINGUISHABLE AT A GLANCE.
//
// "A slot already reserved online appears on the sheet in a distinct muted
// colour - light grey... The sheet distinguishes three states clearly."
//
// The classifier itself needs a populated schedule to exercise, which belongs
// in an Electron run against a real save. What can be pinned here without one
// is the part that silently rots: the palette. Three states that are supposed
// to be told apart at a glance must not share a colour, and the reserved one
// must actually be grey rather than a tint of the paper.

const hex = (c) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

test('every state has a colour', () => {
  for (const key of ['free', 'reserved', 'checked-in', 'closed']) {
    assert.ok(hex(TEE_SHEET_STATE_COLOURS[key]), `${key} has a hex colour`);
  }
});

test('no two states share a colour', () => {
  const values = Object.values(TEE_SHEET_STATE_COLOURS);
  assert.equal(new Set(values).size, values.length, 'a shared colour is two states that look identical');
});

test('reserved is actually grey, not a tint', () => {
  // "a distinct muted colour - light grey". Grey means the channels agree.
  const c = hex(TEE_SHEET_STATE_COLOURS.reserved);
  const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  assert.ok(spread <= 12, `reserved has a channel spread of ${spread}; grey should be near zero`);
  // ...and LIGHT grey, not charcoal
  assert.ok(c.r > 150 && c.r < 230, `reserved lightness ${c.r} should read as light grey`);
});

test('reserved and free are far enough apart to tell at a glance', () => {
  const a = hex(TEE_SHEET_STATE_COLOURS.free);
  const b = hex(TEE_SHEET_STATE_COLOURS.reserved);
  const distance = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  assert.ok(distance > 30,
    `free and reserved are ${distance.toFixed(0)} apart in RGB; too close to distinguish across a sheet`);
});
