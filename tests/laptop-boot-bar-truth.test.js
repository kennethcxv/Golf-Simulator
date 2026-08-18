// THE BOOT BAR COMPLETES ON READINESS — the wiring guard.
//
// Source assertions, certifying nothing about behaviour. The check that does is
// tools/qa/goal36-laptop-open-cost.js, which opens the laptop for real on a
// resumed save inside the clubhouse and fails when the bar reads full more than
// 40 ms before the interface is on the glass. It was watched failing on the
// build before this fix at 101.3 ms and 105.3 ms (qa/goal36/before.json), and
// the clip at qa/clips/goal36-laptop shows the bar half filled at 50.25 s with
// the interface arriving at 50.50 s.
//
// What these guard are the three single call sites that whole result rests on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const clubhouseSource = readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');
const laptopSource = readFileSync(new URL('../src/ui/laptop.js', import.meta.url), 'utf8');

test('nothing but readiness completes the boot bar', () => {
  assert.match(clubhouseSource, /const bootProgress = \(\) => \{/);
  assert.doesNotMatch(clubhouseSource, /performance\.now\(\) - bootT0\) \/ 850/,
    'the fixed 850 ms clock is what let the bar finish before the interface existed');
  assert.match(clubhouseSource, /office\.finishBoot = \(\) => \{\s*[\r\n]+\s*bootDone = true;/,
    'exactly one thing sets the bar to complete');
  assert.match(mainSource, /ch\.laptopBootFinish\(\)/,
    'and main.js calls it at the moment the interface is up');

  // Read outside the boot window it reports the PREVIOUS open's finished state,
  // which scored a clean second open as 923 ms early.
  assert.match(clubhouseSource, /office\.bootProgress = \(\) => \(screenMode === 'boot' \? /);
});

test('the interface is built during the lid swing and revealed after the bar', () => {
  const enter = mainSource.slice(
    mainSource.indexOf('function enterLaptop('),
    mainSource.indexOf('function exitLaptop('),
  );
  assert.ok(enter.length > 200, 'found enterLaptop');
  const buildAt = enter.indexOf('LAPTOP_BUILD_MS');
  const revealAt = enter.indexOf('LAPTOP_REVEAL_MS');
  assert.ok(buildAt > 0 && revealAt > buildAt, 'the build timer is scheduled before the reveal timer');
  assert.match(enter, /laptopUi\.root\.style\.visibility = 'hidden';\s*[\r\n]+\s*laptopUi\.open\(startPage\)/,
    'the early build must not be visible: it happens over the boot screen');
  assert.match(mainSource, /laptopUi\.root\.style\.visibility = '';/,
    'and the reveal — and exitLaptop — must put it back');

  // The three beats are named constants so the feel decision is one edit, not a
  // magic number buried in a setTimeout.
  for (const name of ['LAPTOP_BOOT_MS', 'LAPTOP_BUILD_MS', 'LAPTOP_REVEAL_MS']) {
    assert.match(mainSource, new RegExp(`const ${name} = \\d+;`), `${name} is a named constant`);
  }
});

test('the boot warm paints every desk, and reports which ones', () => {
  assert.match(laptopSource, /\n    warmPages\(ids\) \{/);
  assert.match(laptopSource, /const list = Array\.isArray\(ids\) && ids\.length \? ids : NAV\.map/,
    'defaults to every desk in the nav rather than a hand-kept list that drifts');
  assert.doesNotMatch(
    laptopSource.slice(laptopSource.indexOf('warmPages(ids) {'), laptopSource.indexOf('setTransform(matrix3d)')),
    /\bgo\(/,
    'go() plays the UI tick and pushes the Back stack; a warm must do neither',
  );
  assert.match(mainSource, /laptopUi\?\.warmPages\?\.\(\)/, 'and the boot warm calls it');
  assert.match(mainSource, /__fwWarm\.laptopPages = /,
    'a warm reports WHAT it warmed — `drawn:90` was ninety frames on a page with no product cards');
});
