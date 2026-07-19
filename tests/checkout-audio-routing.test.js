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
  'cardSwipe', 'cardProcessing', 'cardApproved', 'cardDeclined',
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
  assert.equal(cueCalls(registerSource, 'cardInsert').length, 0,
    'the magnetic-stripe flow cannot route the obsolete chip-insert cue');
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

test('card swipe and processing cues have separate one-shot edges', () => {
  const startSwipe = extractFunction(registerSource, 'startSwipe');
  const feedSwipe = extractFunction(registerSource, 'feedSwipe');
  const endSwipe = extractFunction(registerSource, 'endSwipe');
  const updateCard = extractFunction(registerSource, 'updateCard');

  assert.equal(cueCalls(registerSource, 'cardSwipe').length, 1,
    'cardSwipe has one production call site');
  assert.equal(cueCalls(startSwipe, 'cardSwipe').length, 1,
    'cardSwipe fires once when the physical gesture starts');
  const transition = /flowTo\(\s*['"]CardSwiping['"]/.exec(startSwipe);
  const swipeCue = cueCalls(startSwipe, 'cardSwipe')[0];
  assert.ok(transition && swipeCue && swipeCue.start > transition.index,
    'the cardSwipe cue follows the CardSwiping transition edge');
  assert.equal(cueCalls(feedSwipe, 'cardSwipe').length, 0,
    'pointer movement samples cannot replay the swipe cue');
  assert.equal(cueCalls(endSwipe, 'cardSwipe').length, 0,
    'pointer release cannot replay the swipe-start cue');
  assert.equal(cueCalls(updateCard, 'cardProcessing').length, 0,
    'the authorization timer cannot replay the processing cue');
  assert.equal(cueCalls(endSwipe, 'cardProcessing').length, 1,
    'processing begins once only after a valid completed swipe');
  assert.equal(cueCalls(updateCard, 'cardApproved').length, 1);
  assert.equal(cueCalls(updateCard, 'cardDeclined').length, 1);
  assert.doesNotMatch(registerSource, /function\s+(?:startInsert|autoInsertCard)\s*\(|insertAt\s*:/,
    'the active renderer exposes no competing insertion interaction surface');
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

test('manual scanning, bagging, and receipt cues remain transition-local one-shots', () => {
  const startProductDrag = extractFunction(registerSource, 'startProductDrag');
  const tryDraggedProductScan = extractFunction(registerSource, 'tryDraggedProductScan');
  const settleDraggedScan = extractFunction(registerSource, 'settleDraggedScan');
  const settleBaggingProduct = extractFunction(registerSource, 'settleBaggingProduct');
  const beginAutomaticReceipt = extractFunction(registerSource, 'beginAutomaticReceipt');
  const finishAutomaticFulfillment = extractFunction(registerSource, 'finishAutomaticFulfillment');
  const updateDelivery = extractFunction(registerSource, 'updateDelivery');

  assert.equal(cueCalls(registerSource, 'scannerActivate').length, 1,
    'grabbing a fresh product owns the one reader-activation cue');
  assert.equal(cueCalls(startProductDrag, 'scannerActivate').length, 1);
  assert.equal(cueCalls(tryDraggedProductScan, 'posAdd').length, 1,
    'the POS add cue fires once per validated barcode read');
  assert.equal(cueCalls(tryDraggedProductScan, 'scanSuccess').length, 1);
  assert.equal(cueCalls(settleDraggedScan, 'scanInvalid').length, 1,
    'an unread release owns one failure cue');
  assert.equal(cueCalls(settleBaggingProduct, 'bagItem').length, 1,
    'a player-confirmed product drop owns one physical bag cue');
  assert.equal(cueCalls(beginAutomaticReceipt, 'receiptPrint').length, 1);
  assert.equal(cueCalls(finishAutomaticFulfillment, 'receiptTear').length, 2,
    'retail-manual and reservation-auto branches each own one exclusive tear edge');
  assert.equal(cueCalls(updateDelivery, 'bagHandoff').length, 1,
    'the authored bag-handle ownership transfer owns one handoff cue');
});
