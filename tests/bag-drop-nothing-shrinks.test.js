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

const rawBlock = (() => {
  const at = src.indexOf('function updateBagDropMotions(');
  if (at < 0) return null;
  const end = src.indexOf('\n  }', at);
  return end < 0 ? src.slice(at, at + 2000) : src.slice(at, end);
})();

// STRIP THE COMMENTS BEFORE SCANNING.
//
// A source-reading test matches its own prose otherwise. The comment in that
// function explaining why `visible = false` was REMOVED contains the string
// `visible = false`, so an assertion looking for it passed on a build where the
// line was gone — a check that could not fail, defeated by the comment written
// to explain the fix.
const updateBlock = rawBlock == null ? null : rawBlock.replace(/\/\/.*$/gm, '');

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
  // C1 (Goal 19): the size restore moved into the ONE packing rule; the drop
  // hands its stored baseScale to it. The helper's own full-size guarantee is
  // asserted in the every-path test below.
  assert.match(updateBlock, /packMeshIntoBag\(motion\.mesh, \{ scale: motion\.baseScale \}\)/,
    'it hands the size it was given to the one packing rule');
});

test('the item sinks into the bag and is left in it, not switched off', () => {
  // G3 and G4.2 land on the same requirement from opposite directions. G3 wants
  // it to go out of sight BECAUSE THE BAG IS AROUND IT; G4.2 wants scanned items
  // to STAY VISIBLE in the bag until the sale completes. Both are satisfied by
  // carrying it down inside and leaving it there, with the carrier's walls doing
  // the hiding.
  //
  // Matching on `motion.sink` alone is not enough - that also matches
  // `motion.sinkDuration`, so deleting the whole leg left the check green. What
  // matters is the POSITION being carried to the sink point.
  assert.match(updateBlock, /lerpVectors\(motion\.to, motion\.sink,/,
    'the second leg moves the item from the mouth down to the sink point');
  assert.doesNotMatch(updateBlock, /visible = false/,
    'nothing in the drop switches the item off - the bag is what hides it');
  // C1 (Goal 19): the explicit visible=true now lives inside packMeshIntoBag
  // (asserted in the every-path test); the drop must ROUTE there.
  assert.match(updateBlock, /packMeshIntoBag\(motion\.mesh/,
    'and it ends in the one packing rule, which leaves it visible');
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

// --- G4.1 / G4.4: THE COUNTER IS NEVER WITHOUT A BAG -----------------------
//
// "A bag is always present on the counter at the bagging position. The player
// never spawns one, never fetches one, and never waits for one." and "A fresh
// empty bag appears at the bagging position immediately."
//
// Three branches in clearPhysicalTransaction used to disagree: one dropped the
// reference when the customer carried the bag out and made no replacement, one
// reset it, and one simply hid it. A hidden bag is the player waiting for one.

// Brace-matched, not terminated on the first `\n  }` the way the block above is.
// That heuristic cut this function short - the branch this test is about sits
// past the first two-space closer, so the scan silently examined a fragment and
// reported the branch missing.
const clearBlock = (() => {
  const at = src.indexOf('function clearPhysicalTransaction(');
  if (at < 0) return null;
  // The BODY's brace, not the parameter's. This function takes a destructured
  // argument - `clearPhysicalTransaction({ ... })` - so the first `{` after the
  // name opens the PARAMETER, and matching from there captured the signature
  // and nothing else. The scan then reported the branch missing on a build
  // where it was present, which is a failing test that proves nothing.
  const paramsEnd = src.indexOf(') {', at);
  const open = paramsEnd < 0 ? src.indexOf('{', at) : paramsEnd + 2;
  if (open < 0) return null;
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(at, i + 1).replace(/\/\/.*$/gm, '');   // never match our own prose
})();

test('clearing a transaction never leaves the counter without a bag', () => {
  assert.ok(clearBlock, 'the clear-transaction routine is still findable');
  assert.doesNotMatch(clearBlock, /bagGroup\.visible = false/,
    'hiding the counter bag is the player waiting for one');
});

test('the customer taking the bag is followed by a fresh one', () => {
  // The branch that hands ownership to the customer must not simply null the
  // reference: that leaves the bagging position empty until something else
  // happens to reset it, which is exactly what G4.4 forbids.
  // Anchored on the BRANCH, not on `checkoutOwner === 'customer'` alone - that
  // string appears earlier in this same function for a different purpose, so the
  // slice started in the wrong place and read code that was never the subject.
  const owner = clearBlock.indexOf('preserveCustomerBag && bagGroup');
  assert.ok(owner > 0, 'the customer-owns-it branch is still there');
  // Bounded at the `} else`, not a fixed character count. A 420-char window ran
  // past the end of this branch and into the else, which ALSO calls buildBag() -
  // so deleting the replacement from this branch left the assertion green by
  // reading its neighbour's code.
  const elseAt = clearBlock.indexOf('} else', owner);
  const branch = clearBlock.slice(owner, elseAt > owner ? elseAt : owner + 420);
  assert.match(branch, /buildBag\(\)/, 'a replacement bag is built straight away');
  assert.match(branch, /resetBagAtCounter\(\)/, 'and put at the bagging position');
});

test('EVERY path that packs a good into the bag goes through the one rule, and it leaves goods visible', () => {
  // G4.2 was fixed in updateBagDropMotions - the DRAG path - and there are
  // THREE. The scan-motion path and the resume-restore path both still switched
  // the mesh off, and my original test only scanned the one function I had
  // changed. A live driver caught it: goods correctly inside the bag, correctly
  // at scale 1, and invisible.
  //
  // C1 (Goal 19) UNIFIED the three sites into packMeshIntoBag - the anchor-
  // volume placement - so the class check changes shape: there is exactly ONE
  // place that marks an item packed (the helper), it must keep the goods
  // visible at full size, and all three former sites must still route
  // through it. A fourth path added by hand would either call the helper
  // (fine) or mark 'packed-in-bag' itself (caught: the mark count grows).
  const src2 = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url), 'utf8',
  ).replace(/\/\/.*$/gm, '');
  const marks = [];
  let from = 0;
  for (;;) {
    const at = src2.indexOf("checkoutVisualState = 'packed-in-bag'", from);
    if (at < 0) break;
    marks.push(at);
    from = at + 1;
  }
  assert.equal(marks.length, 1,
    `exactly one authority may mark an item packed (packMeshIntoBag); found ${marks.length}`);
  const helperAt = src2.indexOf('function packMeshIntoBag');
  assert.ok(helperAt > 0 && marks[0] > helperAt,
    'the one mark lives inside packMeshIntoBag');
  const helper = src2.slice(helperAt, marks[0]);
  assert.match(helper, /visible = true/,
    'the packing rule must switch the good ON - the bag hides it, nothing else may');
  assert.doesNotMatch(helper, /visible = false/,
    'the packing rule must not switch the good off');
  assert.match(helper, /scale\.copy\(scale \|\| mesh\.userData\.originalScale/,
    'the packing rule keeps goods at FULL SIZE (F3: no miniature stack)');
  const calls = src2.match(/packMeshIntoBag\(/g) || [];
  assert.ok(calls.length >= 4,
    `the helper plus its three call sites (scan, drag, restore); found ${calls.length}`);
});
