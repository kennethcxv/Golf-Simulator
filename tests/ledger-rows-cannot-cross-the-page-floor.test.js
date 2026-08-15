// C2 / C3 — A ROW LIST MUST NOT DRAW PAST THE PAGE.
//
// Photographed at the default camera on Complaints and Fixes at real content:
// the last row landed on the footer's "◀ A previous page" (C3, words over
// words) and its note clipped on the page edge (C2, overflow).
//
// One mechanism. `ruledRows` solves a step so that `rows.length` rows fit the
// run, then `Math.max(24, ...)` overrides that answer whenever it comes out
// below the legible minimum — WITHOUT dropping a row to pay for it. Past that
// point the run no longer fits the space it was solved for.
//
// Two earlier fixes live in the same function's comments, both correct and both
// incomplete the same way: note rows got their own extra height, then wrapped
// labels got theirs, and neither added "and if it still does not fit, fewer rows
// go on this page."
//
// WHY A LITERAL WAS THE OTHER HALF OF IT. The capacity was written twice — once
// as `rows.slice(0, 7)` in the painter and once as `length - 7` in the page
// builder, which decides how many overflow pages follow. Lower one and the rows
// between the new cap and 7 fall silently between the two pages, which is the
// truncation C2 explicitly forbids: "Overflow is a layout decision, not a
// truncation."
//
// WATCHED FAILING: with the floor guard removed from ruledRows, assertion 1
// fails; with COMPLAINT_ROWS replaced by the literal 7 in any one of its three
// sites, assertion 3 fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/render3d/clubhouse/ledgerBook.js', import.meta.url), 'utf8');
// The comments quote the old code and explain the fix, so a scan that does not
// strip them matches its own explanation and can never fail.
const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const ruledRows = (() => {
  const start = code.indexOf('function ruledRows');
  assert.ok(start >= 0, 'ledgerBook no longer defines ruledRows');
  const rest = code.slice(start);
  const end = rest.indexOf('\n  function ', 1);
  return end > 0 ? rest.slice(0, end) : rest;
})();

test('ruledRows refuses to draw a row past the content floor', () => {
  assert.match(ruledRows, /contentBottom\(\)/,
    'ruledRows must know where the page floor is');
  assert.match(ruledRows, /\bbreak\b/,
    'ruledRows must stop placing rows once they would cross the floor; without a '
    + 'stop, the step clamp lets the run overrun the space it was solved for and '
    + 'the last rows land on the footer');
});

test('and it reports how many it placed, so the remainder can be paginated', () => {
  assert.match(code, /lastRowsPlaced/,
    'the count of rows actually placed must be readable, or a caller cannot tell '
    + 'a full page from an overflowing one');
});

test('the complaints capacity is one constant, not a literal in three places', () => {
  assert.match(code, /const COMPLAINT_ROWS\s*=\s*\d+/,
    'the complaints page capacity must be a named constant');
  // The painter's slice, the house-notes filler, and the overflow page count all
  // have to agree; a literal in any one of them is a row lost between pages.
  const uses = (code.match(/COMPLAINT_ROWS/g) || []).length;
  assert.ok(uses >= 4,
    `COMPLAINT_ROWS is used ${uses} times; the declaration plus its three call `
    + 'sites is the minimum, or the capacity has been duplicated again');
  assert.doesNotMatch(code, /rows\.slice\(0,\s*7\)/,
    'the complaints painter still slices to a literal 7');
  assert.doesNotMatch(code, /outstanding\)\.length - 7\b/,
    'the overflow page count still subtracts a literal 7');
});

test('the overlap recorder that caught this is still wired', () => {
  // It found the collision the moment the page was put at real content. It is
  // the reason this is a fixed defect rather than an open one, and it must not
  // be removed as "no longer needed" now that the page is quiet.
  assert.match(code, /function scanOverlaps/, 'the overlap recorder must remain');
  assert.match(code, /LEDGER_OVERLAPS/, 'the overlap ledger must remain');
});
