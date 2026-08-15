// H (Goal 23) — different customers carry different cards, and none of them
// borrows a real network's name.
//
// The build had ONE card face: the club's own green-and-gold "FAIRWAY MEMBER"
// panel, with its colours written into the body of the painter. Every customer
// in the shop paid with a membership card from the shop they were standing in,
// which is what "still all Pine Hills cards" means.
//
// The refusal list below is the part that matters most. Payment-network branding
// is aggressively defended and the resemblance does not have to be deliberate to
// be a problem, so a real name reaching this table fails the build rather than
// reaching a screenshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAYMENT_CARDS, DEFAULT_PAYMENT_CARD, paymentCardFor } from '../src/data/paymentCards.js';

// Real networks, issuers and schemes. Substring match, case-insensitive.
const REFUSED = [
  'visa', 'mastercard', 'master card', 'maestro', 'amex', 'american express',
  'discover', 'diners', 'jcb', 'unionpay', 'union pay', 'cirrus', 'plus',
  'chase', 'citi', 'barclays', 'hsbc', 'natwest', 'lloyds', 'santander',
  'wells fargo', 'capital one', 'bank of america', 'amazon', 'apple', 'paypal',
  'stripe', 'revolut', 'monzo', 'starling', 'nationwide', 'halifax',
];

test('there are at least four cards, and they are genuinely different', () => {
  assert.ok(PAYMENT_CARDS.length >= 4, `four variants were asked for, got ${PAYMENT_CARDS.length}`);
  const networks = new Set(PAYMENT_CARDS.map((c) => c.network));
  const issuers = new Set(PAYMENT_CARDS.map((c) => c.issuer || 'CLUB'));
  const palettes = new Set(PAYMENT_CARDS.map((c) => `${c.base}|${c.accent}`));
  assert.ok(networks.size >= 4, `different NETWORKS were asked for, got ${networks.size}`);
  assert.ok(issuers.size >= 4, `different BANKS were asked for, got ${issuers.size}`);
  // The old fault was one face repeated. Distinct names on an identical
  // background would be the same fault wearing a hat.
  assert.equal(palettes.size, PAYMENT_CARDS.length, 'no two cards may share a palette');
});

test('NOTHING TRADEMARKED: no real network or bank name appears anywhere in the table', () => {
  const haystack = JSON.stringify(PAYMENT_CARDS).toLowerCase();
  for (const name of REFUSED) {
    // word-ish boundary, so 'plus' does not match 'surplus' and 'citi' does not
    // match 'municipal'
    const pattern = new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
    assert.doesNotMatch(haystack, pattern, `"${name}" is a real mark and cannot ship on a card`);
  }
});

test('every row carries everything the painter needs', () => {
  const MARKS = ['chevrons', 'ring-bar', 'lattice', 'wave', 'keystone'];
  const ids = new Set();
  for (const c of PAYMENT_CARDS) {
    assert.ok(c.id, 'every card has an id');
    assert.ok(!ids.has(c.id), `duplicate card id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.network, `${c.id}: a network name`);
    assert.ok(MARKS.includes(c.mark), `${c.id}: mark "${c.mark}" is not one the painter can draw`);
    for (const key of ['base', 'baseEnd', 'ink', 'accent', 'chip']) {
      assert.match(c[key], /^#[0-9a-f]{6}$/i, `${c.id}: ${key} must be a hex colour`);
    }
    assert.ok(c.numberMask, `${c.id}: a number line`);
  }
});

test('a customer keeps the same card between visits, and different people differ', () => {
  // Deterministic on identity: a person who pays twice must not change bank,
  // and a screenshot of four customers must be reproducible.
  assert.equal(paymentCardFor('cust-17').id, paymentCardFor('cust-17').id);
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(paymentCardFor(`cust-${i}`).id);
  assert.ok(seen.size >= 4,
    `200 customers should spread across the deck, only ${seen.size} card(s) appeared`);
  // CONTROL: the old behaviour was every customer on ONE card. If the hash
  // collapsed, this is what would catch it.
  assert.notEqual(seen.size, 1, 'every customer carrying one card is the bug being fixed');
});

test('a missing identity falls back to the club card rather than throwing', () => {
  // A sale must never break because a customer record is thin.
  assert.equal(paymentCardFor(null).id, DEFAULT_PAYMENT_CARD.id);
  assert.equal(paymentCardFor(undefined).id, DEFAULT_PAYMENT_CARD.id);
  assert.ok(paymentCardFor(0).id, 'a falsy but present key still resolves');
});

test('the runtime card-sheet verifier compares painted bytes, not unique filenames', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/electron-h-card-variants.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /createHash\('sha256'\)\.update\(bytes\)\.digest\('hex'\)/);
  assert.match(source, /new Set\(painted\.map\(\(c\) => c\.sha256\)\)/);
  assert.doesNotMatch(source, /new Set\(painted\.map\(\(c\) => c\.file\)\)/,
    'different output names are not evidence of different artwork');
});
