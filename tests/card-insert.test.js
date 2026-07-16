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

const enterExactAmount = (tx) => {
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
  assert.equal(runCard(tx).ok, false, 'amount entry cannot be skipped');
  assert.equal(submitCardAmount(tx).ok, false, 'empty amount cannot authorize');
  assert.equal(tx.stage, 'card-entry');
  assert.equal(tx.cardAttempts, 0);
  assert.equal(tx.cardEntryDigits, '');
  assert.equal(tx.cardEntryError, 'ENTER AMOUNT');
  enterExactAmount(tx);
  assert.equal(tx.stage, 'card-busy');
  assert.equal(insertCard(tx).ok, false, 'one card cannot be inserted twice');
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(tx.stage, 'receipt');
});

test('a declined inserted card must eject before a replacement is inserted', () => {
  const sequence = [0.1, 0.01, 0.99];
  let index = 0;
  const tx = createTx({
    items: [{ uid: 'card-item', skuId: 'balls1', name: 'Golf balls', price: 24 }],
    rng: () => sequence[index++ % sequence.length],
  });
  scanItem(tx, 'card-item');
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  enterExactAmount(tx);
  assert.equal(runCard(tx).result, 'declined');
  assert.equal(insertCard(tx).ok, false);
  assert.equal(retryCard(tx).ok, true);
  assert.equal(tx.cardEntryDigits, '');
  assert.equal(tx.cardEntryCents, 0);
  assert.equal(tx.cardEntryError, null);
  assert.equal(insertCard(tx).ok, true);
  enterExactAmount(tx);
  assert.equal(runCard(tx).result, 'approved');
  assert.equal(tx.cardAttempts, 2);
});

test('wrong card amounts stay in entry and never consume an authorization attempt', () => {
  const tx = cardTx();
  presentCard(tx);
  insertCard(tx);
  enterCardDigit(tx, 1);
  assert.equal(submitCardAmount(tx).ok, false);
  assert.equal(tx.stage, 'card-entry');
  assert.equal(tx.cardAttempts, 0);
  assert.equal(tx.cardEntryError, 'AMOUNT MUST MATCH TOTAL');
  clearCardAmount(tx);
  enterExactAmount(tx);
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
  for (const digit of [9, 9, 4, 1]) enterCardDigit(tx, digit);
  assert.equal(cardEnteredAmount(tx), 99.41);
  assert.equal(backspaceCardAmount(tx).amount, 9.94);
  assert.equal(enterCardDigit(tx, 0).amount, 99.40);
  assert.equal(submitCardAmount(tx).ok, true);

  const overflow = cardTx();
  presentCard(overflow);
  insertCard(overflow);
  assert.equal(enterCardDigit(overflow, -1).ok, false);
  assert.equal(enterCardDigit(overflow, 10).ok, false);
  for (let index = 0; index < 8; index += 1) assert.equal(enterCardDigit(overflow, 9).ok, true);
  assert.equal(enterCardDigit(overflow, 9).ok, false);
  assert.equal(clearCardAmount(overflow).ok, true);
  assert.equal(overflow.cardEntryDigits, '');
});

test('the active simplified renderer exposes insertion and contains no swipe judge', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /insertAt:\s*\(\)/);
  assert.match(source, /function startInsert\(/);
  assert.match(source, /function endInsert\(/);
  assert.doesNotMatch(source, /judgeSwipe|SWIPE_TOP|SWIPE_BOT|function startSwipe\(|swipeAt:/);
});

test('the live card flow auto-inserts and always approves in gameplay', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  // Insertion needs no player gesture...
  assert.match(source, /function autoInsertCard\(/, 'card insertion is automatic');
  // ...and authorization never declines once the total is keyed.
  assert.match(source, /runCard\(tx,\s*\{\s*force:\s*'approved'\s*\}\)/, 'gameplay forces card approval');
});
