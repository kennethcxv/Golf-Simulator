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
  // finishBoot learns this machine's real open duration before it completes the
  // bar, so setting the flag is no longer its first statement. What has to stay
  // true is that it is the ONLY statement anywhere that completes it.
  const completions = clubhouseSource.match(/bootDone = true;/g) || [];
  assert.equal(completions.length, 1, 'exactly one thing sets the bar to complete');
  const finish = clubhouseSource.slice(
    clubhouseSource.indexOf('office.finishBoot = () => {'),
    clubhouseSource.indexOf('office.bootBarNominalMs'),
  );
  assert.ok(finish.length > 40, 'found finishBoot');
  assert.match(finish, /bootDone = true;/, 'and it is inside finishBoot');
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
  // The TIMERS, not the first mention of each name: LAPTOP_REVEAL_MS is also
  // read inside the boot timer now, to hand the bar its expected duration.
  const buildAt = enter.indexOf('}, LAPTOP_BUILD_MS)');
  const revealAt = enter.indexOf('}, LAPTOP_REVEAL_MS)');
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

// "IT GOES REALLY FAST TO 75% THEN TAKES 5 SECONDS TO FINISH THAT."
//
// Truthful and even are different properties, and the goal-36 work only bought
// the first. These pin the shape; the check that MEASURES it is
// tools/qa/laptop-bar-evenness.js, which samples a real open per animation
// frame and reports how long each tenth of the bar took.
test('the bar paces against one straight ramp, not a sprint and a crawl', () => {
  const fn = clubhouseSource.slice(
    clubhouseSource.indexOf('const bootProgress = () => {'),
    clubhouseSource.indexOf('const clock12 = ()'),
  );
  assert.ok(fn.length > 100, 'found bootProgress');
  assert.doesNotMatch(fn, /0\.9 \* \(t \/ BOOT_BAR_NOMINAL_MS\)/,
    'nine tenths of the bar in a fixed beat is the sprint half of the fault');
  assert.doesNotMatch(fn, /\/ 900\)/,
    'a 900 ms asymptote through the last tenth is the crawl half');
  assert.match(fn, /f <= 1\) return Math\.max\(0, f\) \* 0\.97/,
    'one straight ramp covering 97% of the bar');
  // ...and the pace is a MEASUREMENT of this machine, not a constant it may miss
  assert.match(clubhouseSource, /let bootBarNominalMs/);
  assert.match(clubhouseSource, /bootBarNominalMs \* 0\.6 \+ actual \* 0\.4/,
    'the estimate is an EWMA, so one slow open cannot permanently slow the bar');
  assert.match(clubhouseSource, /BOOT_BAR_STORE_KEY/,
    'and it is remembered across sessions - the open he notices is the first one');
  assert.match(mainSource, /ch\.laptopBoot\(LAPTOP_REVEAL_MS - LAPTOP_BOOT_MS\)/,
    'the choreography owns the beat; clubhouse.js is handed it rather than repeating it');
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
