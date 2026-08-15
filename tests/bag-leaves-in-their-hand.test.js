// G4.3 — THE CUSTOMER TAKES THE BAG AND CARRIES IT OUT.
//
// "When payment completes, the customer takes the bag and carries it out with
//  them. It leaves the shop in their hand. It does not vanish, and the player
//  does not hand it over as a separate step."
//
// VERIFIED RATHER THAN REBUILT. The chain exists and it works:
//
//   1. the goods are bagged, and `beginBagDeliveryOrRelease()` runs on its own -
//      the player's click-drag on the bag is an ALTERNATIVE, not a prerequisite,
//      so there is no separate hand-over step
//   2. `transferBagOwnershipToCustomer()` marks the carrier and its contents
//      `checkoutOwner: 'customer'` and parks it on `cust.checkoutHandoffBag`
//   3. clubhouse.js picks that up and calls `attachPaidBagToCustomer` against
//      the character's LEFT carry grip, so it rides their hand out of the shop
//
// WHAT THIS FILE IS REALLY FOR: step 3 has a FALLBACK. If `checkoutHandoffBag`
// is ever missing, the departure code instantiates a FRESH kit bag instead. So a
// broken handoff does not look like a missing bag - the customer still walks out
// carrying something, and the real carrier is silently orphaned on the counter.
// That is a failure nobody would notice by playing, and nothing else in the
// suite watches for it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const strip = (text) => text.replace(/\/\/.*$/gm, '');

const register = strip(fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url), 'utf8',
));
const clubhouse = strip(fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8',
));

// UNVERIFIED AS AN INSTRUMENT - read the caveat before trusting this one.
//
// I could not construct a break that turns it red. Deleting BOTH automatic call
// sites left it green, which means it is matching something I have not isolated.
// Two faults were found and fixed on the way there (the anchor took the first of
// several `autoFulfilled = true;` sites; the pattern matched the function's own
// DEFINITION as well as a call) and it still does not fail, so a third remains.
//
// A check I have never watched fail is not evidence, and it is recorded as such
// in the report rather than counted. The claim it makes is true - the automatic
// path is there, at simplifiedRegisterMode.js:6176 and :6575, and I read both -
// but THIS TEST is not what establishes it.
test('the release runs on its own, not only from the player dragging the bag', () => {
  // The auto-fulfil path must reach the delivery itself. If the only caller of
  // beginBagDeliveryOrRelease were the drag handler, handing the bag over would
  // be the separate step the brief forbids.
  // EVERY occurrence, not the first. `autoFulfilled = true;` appears several
  // times in this file and indexOf finds the earliest, which is not the one
  // that starts the delivery - the fourth time an imprecise anchor in this
  // session made a check read code that was never its subject.
  const sites = [];
  let from = 0;
  for (;;) {
    const at = register.indexOf('autoFulfilled = true;', from);
    if (at < 0) break;
    sites.push(at);
    from = at + 1;
  }
  assert.ok(sites.length > 0, 'the auto-fulfil path is still there');
  // A CALL, not the DEFINITION. `function beginBagDeliveryOrRelease()` matches
  // the bare name-plus-parens too, so with both call sites deleted this still
  // passed by finding the function's own declaration - the fifth pattern in
  // this session that matched something other than its subject.
  const CALL = /(?<!function\s)beginBagDeliveryOrRelease\(\)/;
  const startsDelivery = sites.some(
    (at) => CALL.test(register.slice(at, at + 400)),
  );
  assert.ok(startsDelivery,
    'finishing the sale starts the bag delivery without a further player action');
});

test('ownership moves to the customer rather than the bag being destroyed', () => {
  const at = register.indexOf('function transferBagOwnershipToCustomer()');
  assert.ok(at > 0, 'the ownership transfer is still there');
  const fn = register.slice(at, at + 900);
  assert.match(fn, /checkoutOwner: 'customer'/, 'the carrier is marked as theirs');
  assert.match(fn, /cust\.checkoutHandoffBag = bagGroup/,
    'and the actual carrier is handed on, not a copy of it');
  assert.doesNotMatch(fn, /removeFromParent\(\)|\.visible = false/,
    'nothing here destroys or hides the bag - it does not vanish');
});

test('the departure attaches THE HANDED BAG, not a replacement', () => {
  // The fallback is the danger. `handedBag || kitBag || legacyBag` means a
  // broken handoff produces a DIFFERENT bag in the customer's hand and leaves
  // the real one on the counter - a failure that looks correct while playing.
  const at = clubhouse.indexOf('const handedBag = c.checkoutHandoffBag');
  assert.ok(at > 0, 'the departure still reads the handed bag');
  const block = clubhouse.slice(at, at + 2200);
  assert.match(block, /const bag = handedBag \|\|/,
    'the handed bag is preferred over any freshly built one');
  assert.match(block, /attachPaidBagToCustomer\(c, bag/,
    'and that bag is the one attached to the customer');
});

test('it is attached to a carry grip, so it travels with them', () => {
  // Positioning alone is not carrying: holdBagAtCustomer() places the bag in the
  // REGISTER's space, and a bag that is merely positioned stays behind when the
  // customer walks away. The attach is what makes it leave the shop.
  const at = clubhouse.indexOf('const handedBag = c.checkoutHandoffBag');
  const block = clubhouse.slice(at, at + 2200);
  assert.match(block, /carryGrip\('L'\)/, 'the carry point comes from the rig');
  assert.match(block, /carryTarget = authoredGrip \|\| hand/,
    'falling back to the hand itself if the authored grip is absent');
  assert.match(block, /carryTarget/, 'and the attach is given that target');
});

test('the handoff slot is cleared once it has been taken', () => {
  // Left set, the next departure would re-attach a bag that is already in
  // somebody else's hand.
  const at = clubhouse.indexOf('attachPaidBagToCustomer(c, bag');
  assert.ok(at > 0, 'the attach is still there');
  assert.match(clubhouse.slice(at, at + 300), /c\.checkoutHandoffBag = null/,
    'the slot is emptied after the bag is taken');
});
