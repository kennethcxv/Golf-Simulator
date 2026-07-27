import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  createTx,
  scanItem,
  requestPayment,
  presentCard,
  insertCard,
  cardEnteredAmount,
  enterCardDigit,
  backspaceCardAmount,
  clearCardAmount,
  submitCardAmount,
  totalOf,
  runCard,
  retryCard,
} from '../src/sim/register.js';

// The reader opens at 0.00 and the operator keys the figure. Asserting the
// empty start here (rather than a prefill) keeps every card path in this file
// honest about who types the amount.
const assertOpensEmpty = (tx) => {
  assert.equal(tx.cardEntryCents, 0, 'the reader opens at zero cents');
  assert.equal(tx.cardEntryDigits, '', 'no digits are prefilled for editing');
  assert.equal(cardEnteredAmount(tx), 0, 'the display reads 0.00 on insertion');
};

const keyExactAmountAndSubmit = (tx) => {
  assertOpensEmpty(tx);
  const digits = String(Math.round(totalOf(tx) * 100));
  for (const digit of digits) assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  assert.equal(cardEnteredAmount(tx), totalOf(tx));
  assert.equal(submitCardAmount(tx).ok, true);
};

const typeExactAmount = (tx) => {
  assert.equal(clearCardAmount(tx).ok, true);
  const digits = String(Math.round(totalOf(tx) * 100));
  for (const digit of digits) assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  assert.equal(submitCardAmount(tx).ok, true);
};

const cardTx = (auth = 0.99) => {
  const sequence = [0.1, auth];
  let index = 0;
  const tx = createTx({
    items: [{ uid: 'card-item', skuId: 'balls1', name: 'Golf balls', price: 24 }],
    rng: () => sequence[index++ % sequence.length],
  });
  scanItem(tx, 'card-item');
  requestPayment(tx);
  return tx;
};

test('authorization is gated by a distinct physical card insertion', () => {
  const tx = cardTx();
  assert.equal(runCard(tx).ok, false, 'presentation cannot be skipped');
  assert.equal(presentCard(tx).ok, true);
  assert.equal(runCard(tx).ok, false, 'insertion cannot be skipped');
  assert.equal(insertCard(tx).ok, true);
  assert.equal(tx.stage, 'card-entry');
  assert.equal(tx.cardEntryCents, 0, 'the reader opens at zero, not at the total');
  assert.equal(tx.cardEntryDigits, '', 'the operator keys the amount themselves');
  assert.equal(cardEnteredAmount(tx), 0);
  assert.equal(submitCardAmount(tx).ok, false, 'an empty amount cannot be submitted');
  assert.equal(tx.cardEntryError, 'ENTER AMOUNT');
  assert.equal(runCard(tx).ok, false, 'confirmation cannot be skipped');
  assert.equal(tx.cardAttempts, 0, 'a rejected empty entry never consumes an attempt');
  keyExactAmountAndSubmit(tx);
  assert.equal(tx.stage, 'card-busy');
  assert.equal(insertCard(tx).ok, false, 'one card cannot be inserted twice');
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(tx.stage, 'receipt');
});

test('an explicitly declined inserted card must eject before a replacement is inserted', () => {
  const tx = createTx({
    items: [{ uid: 'card-item', skuId: 'balls1', name: 'Golf balls', price: 24 }],
    prefer: 'card',
  });
  scanItem(tx, 'card-item');
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  keyExactAmountAndSubmit(tx);
  assert.equal(runCard(tx, { force: 'declined' }).result, 'declined');
  assert.equal(insertCard(tx).ok, false);
  assert.equal(retryCard(tx).ok, true);
  assert.equal(tx.cardEntryDigits, '');
  assert.equal(tx.cardEntryCents, 0);
  assert.equal(tx.cardEntryError, null);
  assert.equal(insertCard(tx).ok, true);
  assert.equal(tx.cardEntryCents, 0, 'the replacement card also opens at zero');
  keyExactAmountAndSubmit(tx);
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(tx.cardAttempts, 2);
});

test('wrong card amounts stay in entry and never consume an authorization attempt', () => {
  const tx = cardTx();
  presentCard(tx);
  insertCard(tx);
  clearCardAmount(tx);
  enterCardDigit(tx, 1);
  assert.equal(submitCardAmount(tx).ok, false);
  assert.equal(tx.stage, 'card-entry');
  assert.equal(tx.cardAttempts, 0);
  assert.equal(tx.cardEntryError, 'AMOUNT MUST MATCH TOTAL');
  typeExactAmount(tx);
  assert.equal(tx.stage, 'card-busy');
});

test('keypad editing preserves trailing-zero totals and enforces its input bounds', () => {
  const tx = createTx({
    items: [{ uid: 'terminal-item', skuId: 'balls1', name: 'Golf balls', price: 99.40 }],
    prefer: 'card',
  });
  scanItem(tx, 'terminal-item');
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  assert.equal(cardEnteredAmount(tx), 0, 'the reader opens at 0.00, not at the total');
  for (const digit of '9940') assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  assert.equal(cardEnteredAmount(tx), 99.40, 'a keyed trailing zero survives as cents');
  assert.equal(backspaceCardAmount(tx).amount, 9.94);
  assert.equal(enterCardDigit(tx, 1).amount, 99.41);
  assert.equal(cardEnteredAmount(tx), 99.41);
  assert.equal(backspaceCardAmount(tx).amount, 9.94);
  assert.equal(enterCardDigit(tx, 0).amount, 99.40);
  assert.equal(submitCardAmount(tx).ok, true);

  const overflow = cardTx();
  presentCard(overflow);
  insertCard(overflow);
  clearCardAmount(overflow);
  assert.equal(enterCardDigit(overflow, -1).ok, false);
  assert.equal(enterCardDigit(overflow, 10).ok, false);
  for (let index = 0; index < 8; index += 1) assert.equal(enterCardDigit(overflow, 9).ok, true);
  assert.equal(enterCardDigit(overflow, 9).ok, false);
  assert.equal(clearCardAmount(overflow).ok, true);
  assert.equal(overflow.cardEntryDigits, '');
});

test('the active simplified renderer exposes automatic insertion and a physical amount keypad', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /function beginAutomaticCardInsert\(/);
  assert.match(source, /function finishAutomaticCardInsert\(/);
  assert.match(source, /function handleTerminalKey\(/);
  assert.match(source, /cardKeyScreenPoint,/);
  assert.match(source, /insertAt,/);
  assert.doesNotMatch(source, /import \{ judgeSwipe, SWIPE_MSG \}/);
  assert.doesNotMatch(source, /function (?:startSwipe|feedSwipe|endSwipe)\(|swipeAt,/);
});

test('the live card flow inserts automatically, requires the exact total, and authorizes normally', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /function finishAutomaticCardInsert\(\)[\s\S]*?const inserted = insertCard\(tx\)/,
    'the visible automatic animation crosses the insertion domain checkpoint');
  assert.match(source, /function handleTerminalKey\(action\)[\s\S]*?submitCardAmount\(tx\)/,
    'the player must submit the amount from the physical terminal keypad');
  assert.match(source, /const result = runCard\(tx\);/, 'gameplay uses normal authorization');
  assert.doesNotMatch(
    source,
    /runCard\(tx,\s*\{\s*force:\s*['"]approved['"]\s*\}\)/,
    'gameplay must not bypass the normal authorization function',
  );
  assert.match(
    source,
    /function retryDeclinedCard\(\)[\s\S]*?cardResultTimer = 0;[\s\S]*?cardInsertTimer = 0;/,
    'the declined result timer cannot steal the replacement-card workspace mid-insertion',
  );
});
