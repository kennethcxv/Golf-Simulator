// The construction audit reports that no pro-shop asset has a bare hard corner. That is
// a negative claim about the whole population, and a detector that simply never fires
// would produce the same output, so the detector is checked against geometry whose answer
// is known by construction.
//
// It also has to tell a CHAMFER apart from a TESSELLATED CURVE, because a 16-segment
// cylinder turns ~22 degrees at every segment boundary and a naive dihedral test calls
// each one a bevel. Both cases are pinned below.

import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseGeometry } from '../tools/qa/proshop-construction-audit.mjs';

const WELD = 1e-5;
const DIAGONAL = 1;

// Two 1x1 quads meeting at a right angle along y. Big face against big face, no strip.
function hardCorner() {
  const positions = [
    // horizontal quad, z = 0
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    // vertical quad rising from the shared edge x = 1
    1, 0, 1, 1, 1, 1,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    1, 4, 5, 1, 5, 2,
  ];
  return { positions, indices };
}

// The same corner with a 6 mm chamfer: the two big faces are pulled back and joined by
// one narrow strip at 45 degrees. 6 mm on a 1 m object is representative of what the
// population actually carries (median chamfers run 1-16 mm on metre-scale props).
function chamferedCorner() {
  const w = 0.006;
  const positions = [
    // horizontal quad, z = 0, stopping short at x = 1 - w
    0, 0, 0, 1 - w, 0, 0, 1 - w, 1, 0, 0, 1, 0,
    // chamfer strip: from (1-w, *, 0) up to (1, *, w)
    1, 0, w, 1, 1, w,
    // vertical quad continuing up from z = w
    1, 0, 1, 1, 1, 1,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,        // horizontal
    1, 4, 5, 1, 5, 2,        // chamfer strip
    4, 6, 7, 4, 7, 5,        // vertical
  ];
  return { positions, indices };
}

// A closed 16-segment cylinder wall. Every segment boundary turns 22.5 degrees, and none
// of them is a bevel.
function cylinderWall(segments = 16) {
  const positions = [];
  const indices = [];
  const r = 0.25;
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
    positions.push(Math.cos(a) * r, Math.sin(a) * r, 1);
  }
  for (let i = 0; i < segments; i += 1) {
    const b0 = i * 2;
    const b1 = ((i + 1) % segments) * 2;
    indices.push(b0, b1, b1 + 1, b0, b1 + 1, b0 + 1);
  }
  return { positions, indices };
}

test('a bare right-angle corner is reported as hard, not bevelled', () => {
  const { positions, indices } = hardCorner();
  const g = analyseGeometry(positions, indices, WELD, DIAGONAL);
  assert.equal(g.hardCorners, 1, 'the single 90 degree join should be one hard corner');
  assert.equal(g.bevelCorners, 0, 'nothing here is a chamfer');
});

test('a chamfered corner is reported as bevelled, with the authored width', () => {
  const { positions, indices } = chamferedCorner();
  const g = analyseGeometry(positions, indices, WELD, DIAGONAL);
  assert.equal(g.hardCorners, 0, 'the chamfer removes the hard corner');
  assert.equal(g.bevelCorners, 1, 'the strip between the two faces is one chamfer');
  // Hydraulic width 2A/P recovers the strip's true width. The strip is a 45 degree
  // ramp, so its slant is w * sqrt(2) = 8.5 mm for a 6 mm setback; the measure reports
  // the slant, which is the width actually visible on the surface.
  const mm = g.bevelWidths[0] * 1000;
  assert.ok(mm > 6 && mm < 12, `chamfer width should read near 8.5 mm, got ${mm.toFixed(1)}`);
});

test('a tessellated cylinder is not mistaken for a bevelled edge', () => {
  const { positions, indices } = cylinderWall();
  const g = analyseGeometry(positions, indices, WELD, DIAGONAL);
  assert.equal(g.bevelCorners, 0, 'segment boundaries on a curve are not chamfers');
  assert.equal(g.hardCorners, 0, 'nor are they hard corners');
});

test('welding across a hard-edge split still finds the shell', () => {
  // Blender splits vertices at hard edges, so the same corner arrives with the shared
  // edge duplicated. Position welding has to put it back together or every face reads as
  // its own shell.
  const positions = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1,   // duplicated shared edge, then the riser
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 7, 4, 7, 5,
  ];
  const g = analyseGeometry(positions, indices, WELD, DIAGONAL);
  assert.equal(g.shells, 1, 'the duplicated seam must weld back into a single shell');
  assert.equal(g.hardCorners, 1, 'and the corner across the seam must still be seen');
});
