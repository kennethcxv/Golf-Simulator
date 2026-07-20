import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CHECKOUT_CUE_APIS } from '../src/core/audio.js';

const registerSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);
const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);

const ACTIVE_SIMPLIFIED_CUES = Object.freeze([
  'productPlace', 'productPickup',
  'scannerActivate', 'scanSuccess', 'scanInvalid', 'posAdd',
  'cardInsert', 'cardProcessing', 'cardApproved', 'cardDeclined',
  'cashPresent', 'billHandle', 'coinHandle', 'drawerUnlock', 'drawerOpen', 'drawerClose',
  'changeSelect', 'changeHandoff', 'receiptPrint', 'receiptTear',
  'bagItem', 'bagHandoff',
  'checkoutComplete',
]);

function balancedEnd(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth++;
    else if (char === close && --depth === 0) return i + 1;
  }
  throw new Error(`Unbalanced ${open}${close} sequence after source offset ${start}.`);
}

function extractFunction(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`).exec(source);
  assert.ok(match, `function ${name} exists`);
  const open = source.indexOf('{', match.index + match[0].length);
  assert.notEqual(open, -1, `function ${name} has a body`);
  return source.slice(match.index, balancedEnd(source, open, '{', '}'));
}

function extractBlockAfter(source, pattern, label) {
  const match = pattern.exec(source);
  assert.ok(match, `${label} block exists`);
  const open = source.indexOf('{', match.index + match[0].length);
  assert.notEqual(open, -1, `${label} has a braced body`);
  return source.slice(match.index, balancedEnd(source, open, '{', '}'));
}

function sfxCalls(source) {
  const calls = [];
  const matcher = /\b(?:hooks\.)?sfx\s*\(/g;
  for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
    const open = source.indexOf('(', match.index);
    const end = balancedEnd(source, open, '(', ')');
    calls.push({ start: match.index, source: source.slice(match.index, end) });
    matcher.lastIndex = end;
  }
  return calls;
}

function callRoutes(call, cue) {
  return call.source.includes(`'${cue}'`)
    || call.source.includes(`"${cue}"`)
    || call.source.includes(`\`${cue}\``);
}

function cueCalls(source, cue) {
  return sfxCalls(source).filter((call) => callRoutes(call, cue));
}

test('every active simplified checkout cue is routed from normal-play production code', () => {
  const production = `${registerSource}\n${clubhouseSource}`;
  const missing = ACTIVE_SIMPLIFIED_CUES.filter((cue) => cueCalls(production, cue).length === 0);
  assert.deepEqual(missing, [], `missing normal-play routes: ${missing.join(', ')}`);
  for (const cue of ACTIVE_SIMPLIFIED_CUES) {
    assert.ok(CHECKOUT_CUE_APIS.includes(cue), `${cue} is part of the checkout audio API`);
  }
  assert.equal(cueCalls(registerSource, 'cardSwipe').length, 0,
    'the active insert-card renderer cannot route the obsolete swipe cue');
});

test('customer placement owns the final landing cue and register begin cannot duplicate it', () => {
  const placement = extractFunction(clubhouseSource, 'updateCustomerPlacement');
  const placedEdge = extractBlockAfter(
    placement,
    /if\s*\(\s*event\.placed\s*\)/,
    'sequential customer placement completion',
  );
  assert.equal(cueCalls(placedEdge, 'productPlace').length, 1,
    'each emitted placed event, including the final item, owns one productPlace cue');
  assert.doesNotMatch(placedEdge, /!\s*event\.complete/,
    'the final placed event cannot be excluded from its landing cue');

  const begin = extractFunction(registerSource, 'begin');
  assert.equal(cueCalls(begin, 'productPlace').length, 0,
    'register ownership transfer does not replay the final placement cue');
  assert.equal(cueCalls(begin, 'thunk').length, 0,
    'the legacy begin thunk cannot duplicate the final customer landing');
});

test('card insertion and processing cues have separate one-shot edges', () => {
  const autoInsertCard = extractFunction(registerSource, 'autoInsertCard');
  const feedInsert = extractFunction(registerSource, 'feedInsert');
  const endInsert = extractFunction(registerSource, 'endInsert');
  const beginCardProcessing = extractFunction(registerSource, 'beginCardProcessing');
  const updateCard = extractFunction(registerSource, 'updateCard');

  assert.equal(cueCalls(registerSource, 'cardInsert').length, 1,
    'cardInsert has one production call site');
  // Insertion is automatic now: the cue lives on autoInsertCard, not the
  // superseded manual startInsert path.
  assert.equal(cueCalls(autoInsertCard, 'cardInsert').length, 1,
    'cardInsert fires from the automatic insertion, once');
  const transition = /flowTo\(\s*['"]CardInserting['"]/.exec(autoInsertCard);
  const insertCue = cueCalls(autoInsertCard, 'cardInsert')[0];
  assert.ok(transition && insertCue && insertCue.start > transition.index,
    'the cardInsert cue follows the CardInserting transition edge');
  assert.equal(cueCalls(feedInsert, 'cardInsert').length, 0,
    'pointer movement samples cannot replay the complete insertion cue');
  assert.equal(cueCalls(endInsert, 'cardInsert').length, 0,
    'pointer release cannot replay the complete insertion cue');
  assert.equal(cueCalls(updateCard, 'cardProcessing').length, 0,
    'physical insertion alone cannot start card processing');
  assert.equal(cueCalls(beginCardProcessing, 'cardProcessing').length, 1,
    'processing begins once only after the matching amount is confirmed');
  assert.equal(cueCalls(updateCard, 'cardApproved').length, 1);
  assert.equal(cueCalls(updateCard, 'cardDeclined').length, 1);
  assert.doesNotMatch(registerSource, /function\s+startSwipe\s*\(|swipeAt\s*:/,
    'the active renderer exposes no swipe interaction surface');
});

test('drawer close is emitted once only, when the counted change is handed over', () => {
  // The till slides shut with its close sound the instant the change leaves for
  // the customer (confirmChange) — one call site, no double-close, and cash-only
  // by construction (confirmChange only runs on the cash-drawer stage).
  const confirmChange = extractFunction(registerSource, 'confirmChange');
  assert.equal(cueCalls(registerSource, 'drawerClose').length, 1,
    'the active cash flow has exactly one drawer-close call site');
  assert.equal(cueCalls(confirmChange, 'drawerClose').length, 1,
    'the drawer closes in confirmChange, as the change is given');
  assert.match(confirmChange, /drawerWant\s*=\s*0/,
    'confirmChange also slides the drawer visually shut');
  // and finalizeTransaction no longer re-closes an already-closed till
  const finalizeTransaction = extractFunction(registerSource, 'finalizeTransaction');
  assert.equal(cueCalls(finalizeTransaction, 'drawerClose').length, 0);
});

test('cash change reaches and clears the customer palm before receipt printing', () => {
  const finishChangeHandoff = extractFunction(registerSource, 'finishChangeHandoff');
  const updateCashHandoffHold = extractFunction(registerSource, 'updateCashHandoffHold');
  const updateReceipt = extractFunction(registerSource, 'updateReceipt');

  assert.match(finishChangeHandoff, /cashHandoffPhase\s*=\s*['"]customer-hold['"]/,
    'change enters a customer-owned hold at physical contact');
  assert.match(finishChangeHandoff, /cashHandoffHoldTimer\s*=\s*0\.85/,
    'the customer holds the received change long enough to read');
  assert.equal((finishChangeHandoff.match(/beginAutomaticReceipt\(\)/g) || []).length, 1,
    'finishChangeHandoff contains only the no-change receipt edge');
  assert.match(finishChangeHandoff, /if\s*\(!bundle\)\s*beginAutomaticReceipt\(\)/,
    'a real change bundle cannot start the receipt at contact');
  assert.match(updateCashHandoffHold, /cashHandoffBundle\.removeFromParent\(\)[\s\S]*beginAutomaticReceipt\(\)/,
    'receipt startup follows stowing the customer-held bundle');
  assert.match(updateReceipt, /\['travel', 'customer-hold'\]\.includes\(cashHandoffPhase\)\) return/,
    'the generic receipt updater cannot overlap either cash handoff phase');
});

test('bagging and automatic receipt cues remain transition-local one-shots', () => {
  const bagProduct = extractFunction(registerSource, 'bagProduct');
  const commitScanMotion = extractFunction(registerSource, 'commitScanMotion');
  const updateScanMotion = extractFunction(registerSource, 'updateScanMotion');
  const beginAutomaticReceipt = extractFunction(registerSource, 'beginAutomaticReceipt');
  const finishAutomaticFulfillment = extractFunction(registerSource, 'finishAutomaticFulfillment');
  const updateDelivery = extractFunction(registerSource, 'updateDelivery');

  // One click starts the reader once. The success beep and POS add belong to the
  // validated barcode-contact edge, never pickup or an unverified flight frame.
  assert.equal(cueCalls(registerSource, 'scannerActivate').length, 1,
    'the single bagging edge owns the one register-activation cue');
  assert.equal(cueCalls(bagProduct, 'scannerActivate').length, 1);
  assert.equal(cueCalls(commitScanMotion, 'posAdd').length, 1,
    'the POS add cue fires once per validated barcode read');
  assert.equal(cueCalls(commitScanMotion, 'scanSuccess').length, 1);
  assert.equal(cueCalls(updateScanMotion, 'bagItem').length, 1,
    'a compact product landing in the bag owns one physical bag impact/rustle cue');
  assert.equal(cueCalls(beginAutomaticReceipt, 'receiptPrint').length, 1);
  assert.equal(cueCalls(finishAutomaticFulfillment, 'receiptTear').length, 1);
  assert.equal(cueCalls(updateDelivery, 'bagHandoff').length, 1,
    'the authored bag-handle ownership transfer owns one handoff cue');
});
