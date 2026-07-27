import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  CLUBHOUSE_GTAO_EXCLUSION_CLEARANCE_YD,
  clubhouseInteriorGtaoExcludedAt,
} from '../src/render3d/clubhouse.js';
import { INTERIOR, SHELL } from '../src/data/shopLayout.js';

const excludedAtLocal = (x, z, clearance) => clubhouseInteriorGtaoExcludedAt(
  x,
  z,
  0,
  0,
  clearance,
);

test('clubhouse GTAO exclusion starts at exact 15-yard footprint clearance', () => {
  assert.equal(CLUBHOUSE_GTAO_EXCLUSION_CLEARANCE_YD, 15);
  assert.equal(excludedAtLocal(0, 0), false);
  assert.equal(excludedAtLocal(INTERIOR.w / 2, 0), false);

  // Representative player positions that must retain interior contact AO.
  assert.equal(excludedAtLocal(3.42, 5.78), false, 'checkout camera remains included');
  assert.equal(
    excludedAtLocal(0, SHELL.d / 2 + SHELL.porchD),
    false,
    'outer porch edge remains included',
  );
  assert.equal(excludedAtLocal(0, 13.7), false, 'default walk spawn remains included');

  assert.equal(excludedAtLocal(INTERIOR.w / 2 + 14.999999, 0), false);
  assert.equal(excludedAtLocal(INTERIOR.w / 2 + 15, 0), true);
  assert.equal(
    excludedAtLocal(INTERIOR.w / 2 + 9, INTERIOR.d / 2 + 12),
    true,
    'diagonal 9/12 clearance reaches the 15-yard boundary',
  );
});

test('clubhouse GTAO exclusion fails open for invalid coordinates and thresholds', () => {
  for (const invalid of [NaN, Infinity, '20', null]) {
    assert.equal(clubhouseInteriorGtaoExcludedAt(invalid, 0, 0, 0), false);
    assert.equal(clubhouseInteriorGtaoExcludedAt(0, invalid, 0, 0), false);
    assert.equal(clubhouseInteriorGtaoExcludedAt(0, 0, invalid, 0), false);
    assert.equal(clubhouseInteriorGtaoExcludedAt(0, 0, 0, invalid), false);
    assert.equal(clubhouseInteriorGtaoExcludedAt(100, 100, 0, 0, invalid), false);
  }
  assert.equal(clubhouseInteriorGtaoExcludedAt(100, 100, 0, 0, -1), false);
});

test('course scene masks only the public GTAO render and restores it before teardown', () => {
  const source = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
  const wrapperStart = source.indexOf('gtao.render = function renderWithoutDistantClubhouseInterior');
  const restore = source.indexOf('gtao.render = gtaoRender;', wrapperStart + 1);
  const clubhouseDispose = source.indexOf('clubhouseApi?.dispose', restore);

  assert.ok(wrapperStart >= 0, 'public GTAO render wrapper is installed');
  assert.match(source.slice(wrapperStart, restore), /try\s*\{/);
  assert.match(source.slice(wrapperStart, restore), /finally\s*\{/);
  assert.match(source.slice(wrapperStart, restore), /gtaoRender\.apply\(this, args\)/);
  assert.doesNotMatch(source, /gtao\._renderOverride/);
  assert.ok(restore > wrapperStart, 'original GTAO render is restored');
  assert.ok(clubhouseDispose > restore, 'GTAO render is restored before clubhouse disposal');
});
