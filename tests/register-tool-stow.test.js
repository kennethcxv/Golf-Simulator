// C10 — "entering the register station clears whatever is held, whichever pass
// draws it, and restores it on exit… Add a test that fails if a new tool can be
// held at the register."
//
// A test that lists the tools cannot do that: a tool added tomorrow is not in
// the list. So this asserts the PROPERTY that makes the stow total — it goes
// through walkSetTool(), the single setter that every held tool already passes
// through on its way into the hands, and it names no tool at all.
//
// The behavioural half is tools/qa/register-tool-stow.js, which equips all nine
// live tools in turn, opens the till and reads what is still drawn from every
// pass. Its negative control (the stow commented out) reports all nine still in
// frame, which is what the previous "fix" — broomVm.setActive(false) inside a
// walkExit() that only runs on scene dispose — actually shipped.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CLEANING_TOOLS } from '../src/data/cleaningTools.js';

const source = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  let depth = 0;
  let i = source.indexOf('{', start);
  const from = i;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(from, i + 1); }
  }
  throw new Error(`${name} is unbalanced`);
}

test('the station stow puts the tool DOWN rather than hiding one pass', () => {
  const body = functionBody('syncStationToolStow');
  assert.match(body, /walkSetTool\(null\)/,
    'stowing goes through the shared setter, so it covers whatever that setter covers');
  assert.match(body, /walkSetTool\(tool\)/, 'and the same setter puts it back');
  assert.match(body, /register\?\.isActive\?\.\(\)/, 'driven by whether the station is open');
});

test('the stow names no tool, so a tool added later is covered the day it is added', () => {
  const body = functionBody('syncStationToolStow');
  for (const id of Object.keys(CLEANING_TOOLS)) {
    assert.doesNotMatch(body, new RegExp(`['"\`]${id}['"\`]`),
      `the stow special-cases '${id}'; a per-tool branch is exactly what let eight tools ship unstowed`);
  }
  // …and it does not reach into one tool's private render pass either, which is
  // what the previous attempt did.
  assert.doesNotMatch(body, /broomVm/,
    'no tool-specific viewmodel is touched here — walkSetTool owns every pass');
});

test('the stow is ticked every frame, not only when something remembers to call it', () => {
  assert.match(source, /if \(clubhouseApi\) clubhouseApi\.update\(dtMs\);[\s\S]{0,220}?\n {4}syncStationToolStow\(\);/,
    'it runs in the frame update right after the clubhouse settles the station state');
});

test('walkExit no longer claims to be the till path', () => {
  // walkExit() runs on scene dispose only. The comment that used to live there
  // — "…and NEITHER DOES THE TILL" — described a path that never executed for
  // the register, which is why the broom fix appeared to work and did not.
  const body = functionBody('walkExit');
  assert.doesNotMatch(body, /NEITHER DOES THE TILL/,
    'the till is handled by syncStationToolStow, and walkExit must not claim it');
});
