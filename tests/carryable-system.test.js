import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// D4 (Goal 17) — STANDING INVARIANT 6, WHICH HAD NO CHECK AT ALL.
//
// "Nothing the player carries is ever left floating, ever unputdownable, and
// never allows a tool swap." The Phase 5 gate reported this as NO CHECK EXISTS,
// because carrying was never one system: cartons live in boxPlacementMode, the
// ledger has its own setCarried/isCarried, and loose GOODS live in
// `state.shop.carry` - a third notion that appears as
// `carriedBox(state) || carriedGoods(state)` three times in clubhouse.js and
// had never been given one name.
//
// The behaviour is proven in the game. This is the contract that stops the
// three drifting apart again: every carry notion must be reachable from ONE
// predicate, and the belt and the station boundary must both ask it.

const mainJs = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('one predicate knows about every way the player can carry something', () => {
  const fn = /function carriedThing\(\) \{[\s\S]*?\n\}/.exec(mainJs);
  assert.ok(fn, 'carriedThing() is the single predicate and it exists');
  const body = fn[0];
  // the three carry systems, by the thing that identifies each
  assert.match(body, /hasCarriedCarton\(\)/, 'cartons (boxPlacementMode + delivery state)');
  assert.match(body, /ledgerBook[\s\S]*?isCarried/, 'the ledger book');
  assert.match(body, /shop\?\.carry/, 'loose goods (state.shop.carry)');
});

test('the tool belt refuses while something is carried, on BOTH its paths', () => {
  // tap-to-cycle and hold-to-open-the-wheel are separate entry points. Guarding
  // one leaves a player able to SEE the wheel with full hands, which tells them
  // the belt is available and is worse than the original defect.
  const cycle = /function cycleWalkTool\([\s\S]*?\n\}/.exec(mainJs);
  assert.ok(cycle, 'cycleWalkTool is findable');
  assert.match(cycle[0], /carriedThing\(\)/, 'tap-to-cycle asks');
  const wheel = /function showToolWheel\(\) \{[\s\S]*?\n\}/.exec(mainJs);
  assert.ok(wheel, 'showToolWheel is findable');
  assert.match(wheel[0], /carriedThing\(\)/, 'hold-to-open asks too');
});

test('a station boundary puts carried things down rather than stranding them', () => {
  assert.match(mainJs, /function putDownCarried\(\)/, 'the put-down exists');
  // Every station that takes the camera has to call it, or that station becomes
  // a place a carried thing can be left hanging in mid-air.
  for (const station of ['function enterLaptop', 'function enterFrontDesk']) {
    const at = mainJs.indexOf(station);
    assert.ok(at > 0, `${station} is findable`);
    const window = mainJs.slice(at, at + 400);
    assert.match(window, /putDownCarried\(\)/, `${station} puts carried things down`);
  }
});

test('the book answers the same set-down key as every other carryable', () => {
  const setDown = /case 'setDown': \{[\s\S]*?\n      \}/.exec(mainJs);
  assert.ok(setDown, "the 'setDown' action is findable");
  assert.match(setDown[0], /carriedThing\(\) === 'ledger'/, 'the ledger has a branch');
  // ...and it must come BEFORE the carton branch, or the carton system's early
  // return swallows the key first.
  const bookAt = setDown[0].indexOf("carriedThing() === 'ledger'");
  const cartonAt = setDown[0].indexOf('setDownCarried');
  assert.ok(bookAt < cartonAt, 'the book branch precedes the carton branch');
});
