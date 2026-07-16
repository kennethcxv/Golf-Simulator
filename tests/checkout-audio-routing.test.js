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
  'cashPresent', 'drawerUnlock', 'drawerOpen', 'drawerClose',
  'changeSelect', 'changeHandoff', 'receiptPrint', 'receiptTear',
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

test('drawer close is emitted once only after an exact-once cash finalization', () => {
  const finalizeTransaction = extractFunction(registerSource, 'finalizeTransaction');
  assert.equal(cueCalls(registerSource, 'drawerClose').length, 1,
    'the active cash flow has one drawer-close call site');
  assert.equal(cueCalls(finalizeTransaction, 'drawerClose').length, 1);
  assert.match(finalizeTransaction,
    /if\s*\(\s*finishedTx\.method\s*===\s*['"]cash['"]\s*\)\s*sfx\s*\(\s*['"]drawerClose['"]\s*\)/,
    'only a successfully finalized cash transaction closes the drawer');
});

test('scanner and automatic receipt cues remain transition-local one-shots', () => {
  const startScanDrag = extractFunction(registerSource, 'beginScanDrag');
  const updateScanMotion = extractFunction(registerSource, 'updateScanMotion');
  const beginAutomaticReceipt = extractFunction(registerSource, 'beginAutomaticReceipt');
  const finishAutomaticFulfillment = extractFunction(registerSource, 'finishAutomaticFulfillment');

  assert.equal(cueCalls(registerSource, 'scannerActivate').length, 2,
    'centering and drag-start edges each own one scanner activation site');
  assert.equal(cueCalls(startScanDrag, 'scannerActivate').length, 1);
  assert.equal(cueCalls(updateScanMotion, 'scannerActivate').length, 1);
  assert.equal(cueCalls(beginAutomaticReceipt, 'receiptPrint').length, 1);
  assert.equal(cueCalls(finishAutomaticFulfillment, 'receiptTear').length, 1);
  assert.equal(cueCalls(registerSource, 'bagHandoff').length, 0,
    'the user-requested simplified path does not fake a manual bag handoff');
});
