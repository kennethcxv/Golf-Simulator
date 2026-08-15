// G1 — EVERY WORK STATION OUTRANKS THE TOOL IN YOUR HANDS.
//
// The brief: "With the mop out and Q held, entering the register must go
// straight to the cashier. I should not have to release Q and swap to empty
// hands first."
//
// The RULE for that already existed. `walkFindFocus` gives a station prop in
// reach priority over the equipped tool's prompt, because a deliberately
// equipped tool otherwise owns the prompt and returns early — leaving [E] dead
// at the counter. That was written for the till.
//
// What did not exist was the rule applying to every station. `station: true` is
// a flag somebody has to remember, and the laptop — which opens a full-screen
// station exactly like the till and the reading desk — never got it. So with a
// tool in hand the prompt read the mop and the player could not open their own
// back office without swapping to empty hands. Same defect, different prop:
// the fix had been applied to the instances, not to the class.
//
// This is the class check. Any prop whose action opens a station must be
// tagged as one, so the next station cannot be added without the rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');

// Every addProp({...}) literal in the file, with its body text.
function addPropBlocks() {
  const blocks = [];
  const needle = 'addProp({';
  let at = src.indexOf(needle);
  while (at >= 0) {
    // walk braces from the opening { of the object literal
    let depth = 0;
    let i = at + needle.length - 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({ start: at, body: src.slice(at, i + 1) });
    at = src.indexOf(needle, i + 1);
  }
  return blocks;
}

// What counts as opening a station: a full-screen panel that takes the camera
// and the input away from walking.
const OPENS_A_STATION = /hooks\.open(Laptop|Ledger)\b|register\.enter\(\)/;

const blocks = addPropBlocks();

test('the prop scanner finds the props at all', () => {
  assert.ok(blocks.length > 10, `expected many props, found ${blocks.length}`);
  // NEGATIVE CONTROL: it must not match everything. Most props are not stations.
  const stationish = blocks.filter((b) => OPENS_A_STATION.test(b.body));
  assert.ok(stationish.length >= 3, 'the station-opening props are found');
  assert.ok(stationish.length < blocks.length / 2,
    'and the detector is not simply calling every prop a station');
});

test('every prop that opens a station is tagged as a station', () => {
  const missing = [];
  for (const block of blocks) {
    if (!OPENS_A_STATION.test(block.body)) continue;
    if (!/\bstation:\s*true\b/.test(block.body)) {
      const label = (block.body.match(/label:[\s\S]{0,160}?'([^']{4,60})'/) || [])[1]
        || block.body.slice(0, 80).replace(/\s+/g, ' ');
      missing.push(label);
    }
  }
  assert.deepEqual(missing, [],
    `these open a station but do not outrank a held tool: ${missing.join(' | ')}`);
});

test('a station in reach still beats the equipped tool in the focus order', () => {
  // The tag is only worth anything because of this ordering. If the tool block
  // ever moves above the station block, every station goes dead with a tool out
  // and the tags above stop meaning anything.
  const scene = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
  // GOAL 26 9.2 gave this call an argument -- walkStationPropInReach({ requireAim:
  // true }) -- because the owner overruled the prompt half of it: a station in
  // reach may no longer NAME itself unless the crosshair is on it, though it may
  // still answer E. The ORDERING this test guards is untouched and still matters,
  // so the pattern moves to match the call rather than the assertion being cut.
  const station = scene.indexOf('const stationProp = walkStationPropInReach(');
  const toolOwns = scene.indexOf('if (walkTool && walkTool !== autoTool) {');
  assert.ok(station > 0 && toolOwns > 0, 'both blocks are still in walkFindFocus');
  assert.ok(station < toolOwns,
    'the station check must run BEFORE the equipped tool claims the prompt');
});

test('the tool is stowed for every station, not for a hard-coded two', () => {
  // syncStationToolStow generalised over every TOOL and then hard-coded two
  // STATIONS, so the laptop was missed and the player sat down at the back
  // office with a mop still in their hands. It must defer to the host predicate
  // that owns the real list.
  const scene = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
  const at = scene.indexOf('function syncStationToolStow()');
  assert.ok(at > 0, 'the stow-on-station rule is still here');
  const block = scene.slice(at, at + 900);
  assert.match(block, /walkHooks\.stationOpen\?\.\(\)/,
    'it asks the one predicate that knows every station');
});

test('the host predicate covers all four stations', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const at = main.indexOf('walk.hooks.stationOpen = ');
  assert.ok(at > 0, 'the host predicate is still here');
  const block = main.slice(at, at + 220);
  for (const station of ['laptopOpen', 'ledgerOpen', 'frontDeskOpen', 'regActive']) {
    assert.ok(block.includes(station), `${station} is part of "a station is open"`);
  }
});
