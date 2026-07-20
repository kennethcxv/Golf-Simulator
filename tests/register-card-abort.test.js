// The reader's X — pull a card run before it settles — and the modal lock that
// keeps Escape from doing the same thing. The domain verb is the safety spine:
// it may only fire before authorization, it never banks money, and it drops the
// sale back to a re-payable state. The flow contract pins which states the X is
// (and is NOT) reachable from, which is exactly when the X is shown vs disabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTx, scanItem, requestPayment, presentCard, insertCard,
  submitCardAmount, runCard,
  abandonCardBeforeSubmit,
} from '../src/sim/register.js';
import { canTransitionCheckout, validateCheckoutTransition } from '../src/sim/registerFlow.js';

const twoItems = () => ([
  { uid: 'a', skuId: 'glove1', name: 'Cabretta glove', price: 19 },
  { uid: 'b', skuId: 'tees1', name: 'Tee bag', price: 6 },
]);

function scannedCardTx(stage) {
  const tx = createTx({ items: twoItems() });
  scanItem(tx, 'a');
  scanItem(tx, 'b');
  tx.prefer = 'card';
  requestPayment(tx);         // -> card-present
  if (stage === 'card-present') return tx;
  presentCard(tx);            // -> card-ready
  if (stage === 'card-ready') return tx;
  insertCard(tx);             // -> card-entry
  if (stage === 'card-entry') return tx;
  submitCardAmount(tx);       // confirm the prefilled total -> card-busy
  return tx;
}

test('X pulls the card at every pre-submit stage and returns to the choice point', () => {
  for (const stage of ['card-present', 'card-ready', 'card-entry']) {
    const tx = scannedCardTx(stage);
    assert.equal(tx.stage, stage, `set up at ${stage}`);
    const result = abandonCardBeforeSubmit(tx);
    assert.ok(result.ok, `abort allowed at ${stage}`);
    assert.equal(tx.stage, 'scanning', 'returns to the post-scan choice point');
    assert.equal(tx.method, null, 'no payment method is left selected');
    // the basket is intact — every item still scanned, nothing lost or duplicated
    assert.equal(tx.items.length, 2, 'both items still on the ticket');
    assert.ok(tx.items.every((i) => i.scanned), 'items remain scanned');
    // and the sale can be driven forward again from here
    assert.ok(requestPayment(tx).ok, 'payment can be re-requested after the pull');
  }
});

test('X is refused once processing has begun — no pulling a settling payment', () => {
  const tx = scannedCardTx('card-busy');
  assert.equal(tx.stage, 'card-busy');
  const result = abandonCardBeforeSubmit(tx);
  assert.equal(result.ok, false, 'the card cannot be pulled while it authorizes');
  assert.equal(tx.stage, 'card-busy', 'the processing state is untouched');
});

test('X is refused after the card has settled — no undoing a completed sale', () => {
  const tx = scannedCardTx('card-busy');
  runCard(tx, { force: 'approved' }); // -> receipt
  assert.equal(tx.stage, 'receipt');
  const result = abandonCardBeforeSubmit(tx);
  assert.equal(result.ok, false, 'a settled sale cannot be pulled');
  assert.equal(tx.stage, 'receipt', 'the approved sale stands');
});

test('the abort never itself banks or moves money', () => {
  const tx = scannedCardTx('card-entry');
  const before = JSON.stringify({ tendered: tx.tendered, cardResult: tx.cardResult });
  abandonCardBeforeSubmit(tx);
  assert.equal(tx.cardResult, null, 'no authorization result is invented');
  assert.equal(JSON.stringify({ tendered: tx.tendered, cardResult: null }), before.replace('null', 'null'));
});

test('the flow contract makes the X reachable pre-submit and forbidden while processing', () => {
  // every pre-submit card state can drop back to the post-scan choice point...
  assert.equal(canTransitionCheckout('CardPresented', 'AllProductsScanned'), true);
  assert.equal(canTransitionCheckout('CardSwipeReady', 'AllProductsScanned'), true);
  assert.equal(canTransitionCheckout('CardSwiping', 'AllProductsScanned'), true);
  // ...but once the authorization is running (or done) it cannot
  assert.equal(canTransitionCheckout('CardProcessing', 'AllProductsScanned'), false);
  assert.equal(canTransitionCheckout('CardApproved', 'AllProductsScanned'), false);
  const blocked = validateCheckoutTransition('CardProcessing', 'AllProductsScanned');
  assert.equal(blocked.ok, false, 'the processing state has no abort edge');
});
