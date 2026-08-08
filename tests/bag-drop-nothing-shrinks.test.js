// G3 — ITEMS MUST PHYSICALLY GO INTO THE BAG.
//
// "They shrink and vanish, which reads as fake. Let the item travel into the
// bag's mouth and go out of sight because the bag is around it. Occlude if you
// must, but nothing shrinks."
//
// Two separate claims, and only one of them had been dealt with.
//
// NOTHING SHRINKS was already true: Goal 16 F3 stopped the drop from scaling the
// mesh, and the motion carries a `baseScale` it restores rather than a scale it
// animates. That half is verified here so it cannot quietly come back.
//
// GOES OUT OF SIGHT BECAUSE THE BAG IS AROUND IT was not. The travel ended AT
// the mouth and then set `visible = false` - the item blinked out in full view,
// above the rim. That is a pop, and it reads as fake however carefully the size
// was preserved. The fix adds a second leg that carries the item DOWN inside the
// bag at full size before anything is hidden.
//
// This reads the source rather than driving the register, because the drop lives
// inside a closure over live 3D state. It is the weaker instrument and the
// report records the visual as UNCONFIRMED until it is seen at the player's
// camera.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

const updateBlock = (() => {
  const at = src.indexOf('function updateBagDropMotions(');
  if (at < 0) return null;
  const end = src.indexOf('\n  }', at);
  return end < 0 ? src.slice(at, at + 2000) : src.slice(at, end);
})();

test('the bag drop routine is still findable', () => {
  assert.ok(updateBlock, 'updateBagDropMotions is where the drop is animated');
  assert.ok(updateBlock.length > 200, 'and it has a real body');
});

test('nothing in the drop animates the scale', () => {
  // The defect the brief names by name. A `scale` that is LERPED, multiplied or
  // set from `t` is the item shrinking; copying a stored baseScale back is the
  // opposite and is allowed.
  const shrinking = [
    /scale\.lerp/,
    /scale\.multiplyScalar/,
    /scale\.setScalar\s*\(\s*[^)]*\bt\b/,
    /scale\.set\s*\([^)]*\bt\b/,
  ];
  for (const pattern of shrinking) {
    assert.doesNotMatch(updateBlock, pattern,
      `the drop must not animate scale (${pattern})`);
  }
  assert.match(updateBlock, /scale\.copy\(motion\.baseScale\)/,
    'it restores the size it was given');
});

test('the item sinks into the bag before it is hidden', () => {
  // Hiding must happen AFTER the sink leg, not at the mouth. If `visible = false`
  // can be reached while the item is still at the rim, the pop is back.
  // NOT /motion\.sink/ - that also matches `motion.sinkDuration`, so deleting the
  // whole sink leg left the assertion passing. The thing that matters is the
  // POSITION being carried to the sink point.
  assert.match(updateBlock, /lerpVectors\(motion\.to, motion\.sink\)|lerpVectors\(motion\.to, motion\.sink,/,
    'the second leg moves the item from the mouth down to the sink point');
  const hideAt = updateBlock.indexOf('visible = false');
  const sinkAt = updateBlock.search(/lerpVectors\(motion\.to, motion\.sink/);
  assert.ok(sinkAt > 0 && hideAt > sinkAt,
    'the item is hidden only after the sink leg has run');
});

test('the sink really is below the rim, not another point on it', () => {
  // BAG_SWALLOW_DEPTH is a fraction of the rim height. At 1.0 the "sink" would
  // land back at the mouth and the fix would be decorative.
  const m = /const BAG_SWALLOW_DEPTH = ([\d.]+)/.exec(src);
  assert.ok(m, 'the swallow depth is a named constant');
  const depth = Number(m[1]);
  assert.ok(depth > 0 && depth < 0.6,
    `the sink must be well below the rim, got ${depth} of the rim height`);
});

test('the drop is timed as two legs, and the second one takes real time', () => {
  const sinkDuration = /sinkDuration: ([\d.]+)/.exec(src);
  assert.ok(sinkDuration, 'the sink leg has its own duration');
  assert.ok(Number(sinkDuration[1]) >= 0.12,
    'and it is long enough to read as movement rather than a jump');
  assert.match(updateBlock, /motion\.duration \+ \(motion\.sinkDuration/,
    'the motion does not finish until both legs have run');
});
