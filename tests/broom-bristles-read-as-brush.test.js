// B2 — "THE BRISTLES READ AS SEPARATED TINES RATHER THAN A BRUSH."
//
// The broom head has now been dense twice. The first time it was reverted on a
// single-sample perf comparison that was later retracted as noise, and the
// codebase sat at 200 fat bristles for a while afterwards carrying a comment
// that cited the withdrawn measurement as fact. This test exists so the third
// time is not needed.
//
// WHAT IT PINS, AND WHY IT IS NOT THE OBVIOUS THING.
//
// The obvious test is "neighbouring bristles overlap": tip diameter >= column
// spacing, so no daylight gets through. That test PASSES ON THE OLD SPARSE HEAD.
// 200 bristles in 5 rows is 40 columns across 0.50 m, 12.5 mm apart, with a
// 17.6 mm tip — a ratio of 1.41, comfortably overlapping — and it still read as
// a rake in the player-camera capture. The source comments record the same
// surprise in their own words: "the picture still disagreed with the arithmetic".
//
// What actually separates a brush from a comb is SLENDERNESS. A 17.6 mm-thick
// fibre 115 mm long is 6.5:1 — a slat, and the eye reads a row of slats as
// tines however much they overlap. At 5.6 mm the same fibre is 20:1 and reads as
// bristle. So the invariant is a shape ratio, and density is what keeps the
// field continuous once the fibres are thin enough to need it.
//
// WATCHED FAILING: with `count: 200` / `strandRadiusTop: 0.010` restored (the
// exact configuration that produced the comb in b2-broom-head.png), the
// slenderness assertion fails at 5.8:1 against a floor of 12:1.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/render3d/toolViewmodel.js', import.meta.url), 'utf8');

// The broom's rig is the `createMopStrands({...})` call inside the `def.id ===
// 'broom'` branch. Anchor on that branch so the mop's own call — same function,
// different and deliberately fatter yarn — can never be measured by mistake.
const broomBranch = src.slice(src.indexOf("def.id === 'broom'"));
assert.ok(broomBranch.length > 0, "could not find the broom branch in toolViewmodel.js");
const call = broomBranch.slice(broomBranch.indexOf('createMopStrands('));

// Comments in this file quote old values and explain rejected ones, so a naive
// scan matches its own explanation. Strip them before reading any number.
const code = call.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const num = (name) => {
  const m = new RegExp(`\\b${name}:\\s*([0-9.]+)`).exec(code);
  assert.ok(m, `the broom's strand config no longer sets ${name}`);
  return Number(m[1]);
};

const count = num('count');
const barRows = num('barRows');
const barWidth = num('barWidth');
const length = num('length');
const radiusTop = num('strandRadiusTop');
const radiusBottom = num('strandRadiusBottom');

test('a bristle is slender enough to read as bristle rather than as a tine', () => {
  // Measured at the THICK end, because that is the widest the fibre ever looks.
  const slenderness = length / (2 * radiusTop);
  assert.ok(slenderness >= 12,
    `a bristle ${(2 * radiusTop * 1000).toFixed(1)} mm thick and ${(length * 1000).toFixed(0)} mm `
    + `long is ${slenderness.toFixed(1)}:1, which reads as a slat. Needs >= 12:1. `
    + 'This is the assertion that fails on the 200 x 20 mm head that shipped as a comb.');
});

test('the field is continuous — neighbours overlap at the tip', () => {
  // Necessary but NOT sufficient (the sparse head passed this too); it is here
  // so that thinning the fibres without adding density cannot pass the slender-
  // ness test while opening daylight the other way.
  const columns = Math.max(2, Math.round(count / barRows));
  const spacing = barWidth / columns;
  const tipDiameter = 2 * radiusBottom;
  assert.ok(tipDiameter >= spacing,
    `tips are ${(tipDiameter * 1000).toFixed(2)} mm across at ${(spacing * 1000).toFixed(2)} mm `
    + 'spacing, so the floor shows between neighbours');
});

test('density is not paid for with per-fibre geometry', () => {
  // A strand costs radialSegments x 2 triangles per segment, so sides are a
  // straight multiplier on strand count. 720 fibres at 5 sides cost 19,376
  // triangles; at 3 sides, 13,616 — measured, tools/qa/electron-b2-broom-cost.js.
  // A few pixels of dark, overlapping fibre does not need five.
  const m = /\bradialSegments:\s*([0-9]+)/.exec(code);
  assert.ok(m, 'the broom no longer sets radialSegments; it would silently take the default 5');
  assert.ok(Number(m[1]) <= 3,
    `radialSegments ${m[1]} on ${count} fibres spends geometry the silhouette does not show`);
});

test('the mop is not dragged along by the broom’s settings', () => {
  // radialSegments defaults to 5 in mopStrands.js precisely so that the mop —
  // whose strand whip is confirmed at the player camera — is untouched by this
  // parameter existing. If the default ever moves, the mop changes silently.
  const strands = fs.readFileSync(new URL('../src/render3d/mopStrands.js', import.meta.url), 'utf8');
  const clean = strands.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(clean, /radialSegments\s*=\s*5/,
    'mopStrands must default radialSegments to 5 so callers that do not set it are unchanged');
});
