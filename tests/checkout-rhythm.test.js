// THE TWO THINGS THAT BROKE THE RHYTHM AT THE TILL.
//
// Reported on the walk: "A completed transaction must clear away when it
// finishes. It currently lingers." and "Serving the next customer must be
// seamless. I should not have to exit the cashier station and re-enter to attend
// the next person."
//
// They were one bug. checkoutActions() offered exactly one control once a sale
// completed — "Return to Shop" — so the receipt stayed on screen until the
// player left the station, and leaving the station was therefore the only route
// to the next customer. The finished sale now clears itself after a hold long
// enough to read the total, and the primary control says what actually happens
// next in a shop.
//
// Source assertions, because the register is a 6,800-line closure that cannot be
// constructed in Node. The logic these guard is small and the failure they guard
// against is a regression to a single 'exit' action.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url), 'utf8',
);

test('a finished sale is no longer a dead end with one way out', () => {
  assert.doesNotMatch(
    source,
    /if \(postSaleDisplay && !tx\) return \[\{ id: 'exit'/,
    'the single-action post-sale screen is the defect; it must not come back',
  );
  assert.match(source, /id: 'clear-post-sale', label: 'Ready for the next customer', kind: 'primary'/);
  assert.match(source, /\{ id: 'exit', label: 'Return to Shop' \}/,
    'leaving is still offered — it is just no longer the only thing offered');
});

test('the finished sale clears itself on a timer, not only on a click', () => {
  // A control the player has to find is better than none, but the complaint was
  // that it LINGERS. It has to go away on its own.
  assert.match(source, /const POST_SALE_HOLD_S = 5\.0;/);
  assert.match(source, /postSaleHold -= dt;\s*\n\s*if \(postSaleHold <= 0\) clearPostSale\(\);/);
  assert.match(source, /postSaleHold = POST_SALE_HOLD_S;/,
    'the hold has to be armed when the sale completes or the timer never runs');
});

test('clearing returns the station to a working state, not just a blank one', () => {
  const fn = source.match(/function clearPostSale\(\)[\s\S]*?\n {2}\}/)[0];
  assert.match(fn, /postSaleDisplay = null/);
  assert.match(fn, /activeTab = 'checkout'/, 'ready for a sale, not parked on some other tab');
  assert.match(fn, /assignWorkspace\('monitor'\)/, 'and looking at the till');
  assert.match(fn, /drawScreen\(\)/);
});

test('the register does not claim to know how many people are waiting', () => {
  // It learns about a retail shopper when the clubhouse loop hands it one; it
  // cannot see the queue. A label that guessed a count would be wrong exactly
  // when the shop is busy, which is when the player would be reading it.
  assert.doesNotMatch(source, /countersideWaiting/);
  assert.doesNotMatch(source, /Serve \$\{waiting/);
});
