// CHECKOUT PHYSICALITY, PLAYTEST ROUND 4 (2026-07-30) — the three reported
// items, held as contracts rather than screenshots. Whether they LOOK right is
// held by tools/qa/checkout-round4-renders.js against
// Designs/CashRegister/Final; these are the invariants that must not drift
// back:
//   1 the working frame is SOLVED from the counter's subjects, not typed
//   2 the reader's coloured keys say what they do, and a press is forgiving
//   3 the drawer's fourth coin well is a QUARTER, and no two denominations
//     share a tint
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BILLS, COINS, DENOMS, makeChange, newDrawer, stackTotal } from '../src/sim/register.js';
import {
  CHECKOUT_CASH_GLANCE_SCALE, CHECKOUT_TERMINAL_KEY_ROLES,
  checkoutDrawerSlotLabels, checkoutLookScale, checkoutMoneyAssetStem,
  checkoutTerminalKeyAction,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

const source = readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  // Skip the parameter list — a destructured signature contains braces of its
  // own, and counting from the first one slices the parameters, not the body.
  let cursor = source.indexOf('(', start);
  let parens = 0;
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    if (source[cursor] === ')' && --parens === 0) break;
  }
  const open = source.indexOf('{', cursor);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

// --- ITEM 3: the drawer reads, and its coins are real money -----------------

test('the drawer wells are labelled with coins this currency actually mints', () => {
  const { bills, coins } = checkoutDrawerSlotLabels();
  assert.deepEqual(bills, ['$1', '$5', '$10', '$20', '$50']);
  // Reference 154525 / 154641. The fourth well used to read "20¢" — there is no
  // such coin, and a till that offers one cannot be counted against real change.
  assert.deepEqual(coins, ['1¢', '5¢', '10¢', '25¢', '50¢']);
  assert.ok(!coins.includes('20¢'), 'the 20-unit coin is retired from the tray');
});

test('the quarter is a first-class denomination everywhere the till touches money', () => {
  assert.ok(COINS.includes(0.25), 'the quarter is in the coin set');
  assert.ok(!COINS.includes(0.2), 'the 20-unit coin is gone from the coin set');
  assert.ok(DENOMS.includes(0.25) && !DENOMS.includes(0.2));
  assert.ok(newDrawer()[0.25] > 0, 'the opening float carries quarters');
  assert.equal(newDrawer()[0.2], undefined, 'the opening float mints no 20-unit coins');
  // $4.28 is the reference frame's own change (154641): four singles, a
  // quarter and three pennies — which only balances with a real quarter.
  assert.deepEqual(makeChange(4.28), { 1: 4, 0.25: 1, 0.01: 3 });
  assert.equal(stackTotal(makeChange(4.28)), 4.28);
  assert.equal(checkoutMoneyAssetStem(0.25, 'drawer'), 'cash_coin_25');
});

test('every denomination in the tray carries its own ink', () => {
  const table = source.slice(
    source.indexOf('const MONEY_TINT = {'),
    source.indexOf('const MONEY_EMISSIVE'),
  );
  assert.ok(table, 'the denomination tint table exists');
  const tints = new Map();
  for (const [, denom, hex] of table.matchAll(/^\s*([\d.]+):\s*(0x[0-9a-f]{6})/gmi)) {
    tints.set(Number(denom), hex.toLowerCase());
  }
  for (const denom of DENOMS) {
    assert.ok(tints.has(denom), `${denom} has no tint — it would draw as kit-default stock`);
  }
  assert.equal(new Set(tints.values()).size, tints.size,
    'two denominations share a tint, which is the "five identical rectangles" read');
  // The penny is the one colour cue the reference relies on.
  const penny = Number.parseInt(tints.get(0.01).slice(2), 16);
  const [r, g, b] = [(penny >> 16) & 255, (penny >> 8) & 255, penny & 255];
  assert.ok(r > g && g > b, `the 1¢ tint must be copper, got #${tints.get(0.01).slice(2)}`);
  for (const silver of [0.05, 0.1, 0.25, 0.5]) {
    const value = Number.parseInt(tints.get(silver).slice(2), 16);
    const blue = value & 255;
    const red = (value >> 16) & 255;
    assert.ok(blue >= red, `${silver} must read as silver, not another copper coin`);
  }
});

test('the open till is lit, and only while it is open', () => {
  const body = functionBody('updateDrawer');
  assert.match(body, /drawerLight/, 'the tray owns lamps');
  assert.match(body, /drawerLight\.visible = /, 'the lamps are switched, not always burning');
  assert.match(body, /lamp\.intensity = lit \* DRAWER_LIGHT_INTENSITY/,
    'the lamps fade in with the slide rather than popping on under the slab');
  assert.match(source, /const DRAWER_LIGHT_INTENSITY = /);
});

test('counting change cannot swing the cash summary off the top of the frame', () => {
  // Measured 2026-07-30: at full lean, the cursor travelling the width of the
  // till pushed the orange Received/Total/Change block — which the reference
  // keeps directly ABOVE the drawer — out of shot mid-count.
  assert.equal(checkoutLookScale('cash', false), CHECKOUT_CASH_GLANCE_SCALE);
  assert.ok(CHECKOUT_CASH_GLANCE_SCALE > 0, 'the drawer view still glances');
  assert.ok(CHECKOUT_CASH_GLANCE_SCALE <= 0.4, 'but nowhere near enough to lose the panel');
});

// --- ITEM 2: the reader's keys ---------------------------------------------

test('red X cancels, yellow backspaces, green enters — and the caps say so', () => {
  assert.deepEqual(CHECKOUT_TERMINAL_KEY_ROLES.clear, { colour: 'red', label: 'X', role: 'cancel' });
  assert.deepEqual(CHECKOUT_TERMINAL_KEY_ROLES.backspace, { colour: 'yellow', label: '⌫', role: 'backspace' });
  assert.deepEqual(CHECKOUT_TERMINAL_KEY_ROLES.confirm, { colour: 'green', label: 'OK', role: 'enter' });
  // The kit authored the green cap as a seven-segment "O" (a second zero on the
  // pad) and the yellow one as a bare "-". Those faces are hidden and redrawn.
  const decal = functionBody('decalTerminalKey');
  assert.match(decal, /glyph\.visible = false/, 'the misleading authored glyph is hidden');
  assert.match(decal, /key\.add\(decal\)/, 'the replacement rides the key, so it dips on a press');
  const collect = functionBody('collectTerminalKeys');
  assert.match(collect, /decalTerminalKey\(action, cap, glyph\)/);
  assert.match(collect, /if \(!terminalKeyPickables\[index\]\.visible\) terminalKeyPickables\.splice/,
    'a hidden glyph must not swallow the click meant for its cap');
});

test('a click anywhere on or beside a key presses that key', () => {
  const body = functionBody('terminalKeyAt');
  assert.match(body, /intersectObjects\(terminalKeyPickables/, 'a press is a mesh raycast');
  // The gutters between 2 cm caps are wide enough on screen that ordinary aim
  // landed between keys and nothing happened — the "keys do nothing" report.
  assert.match(body, /if \(!action\) \{/, 'an exact miss falls through to a search');
  assert.match(body, /accessibilityPrefs\.largeTextAndTargets \? \d+ : \d+/,
    'the near-miss ring is always on; accessibility widens it rather than enabling it');
  assert.doesNotMatch(
    body,
    /if \(!action && accessibilityPrefs\.largeTextAndTargets\)/,
    'forgiveness must not be gated behind an accessibility preference',
  );
});

test('every key on the pad reaches its handler from click and from keyboard', () => {
  for (let digit = 0; digit <= 9; digit += 1) {
    assert.equal(checkoutTerminalKeyAction(`Terminal_Key_${digit}`), `digit:${digit}`);
  }
  const down = functionBody('onDown');
  assert.match(down, /const terminalKey = terminalKeyAt\(event\);\s*\n\s*if \(terminalKey\) return handleTerminalKey\(terminalKey\.id\)/,
    'a click on a key dispatches that key');
  assert.match(source, /if \(tx\?\.stage === 'card-entry' && \/\^\\d\$\/\.test\(key\)\) \{\s*\n\s*handleTerminalKey\(`digit:\$\{key\}`\)/,
    'typing a number keys the pad');
  assert.match(source, /key === 'Backspace'\) \{\s*\n\s*handleTerminalKey\('backspace'\)/);
  assert.match(source, /key === 'Enter'\) \{\s*\n\s*handleTerminalKey\('confirm'\)/);
});

test('the floated reader is placed on the view axis and hangs its card clear of the case', () => {
  const float = functionBody('updateTerminalFloat');
  // The working frame looks DOWN. A world-down offset from the eye put the
  // reader's glass entirely above the viewport.
  assert.match(float, /camera\.matrixWorld, 0\)/, 'the lateral step uses the camera right axis');
  assert.match(float, /camera\.matrixWorld, 1\)/, 'the drop uses the camera up axis');
  assert.match(float, /addScaledVector\(forward, TERMINAL_FLOAT_DISTANCE\)/,
    'the standoff runs along the true view direction, not its flattened shadow');
  assert.doesNotMatch(float, /termObject\.attach\(cardMesh\)/,
    'the card stays rooted; its animation is authored in root-local vectors');
  const path = functionBody('refreshCardInsertPath');
  assert.match(path, /termObject\.matrixWorld, 1\)/,
    'the inserted card travels down the READER body, not down the authored slot vector '
    + '(which points along the view axis and hid the card inside the case)');
});

test('the reader glass carries the reference bands, not a centred calculator column', () => {
  const face = functionBody('paintTermBandedFace');
  assert.match(face, /Payment/, 'the dark status strip');
  assert.match(face, /ctx\.textAlign = 'left'/, 'the reference face is left-aligned');
  assert.match(face, /const inner = H - TERM_PAD \* 2/, 'the bands are sized off the glass');
  assert.ok(!source.includes('paintTermLightFace'), 'the flat pale face is deleted, not orphaned');
  const start = source.indexOf("} else if (stage === 'card-entry') {");
  const end = source.indexOf("} else if (stage === 'card-busy') {", start);
  const entry = source.slice(start, end);
  assert.match(entry, /caption: 'Total'/, 'the reference caption band reads Total (154606/154618)');
  assert.match(entry, /cardEnteredAmount\(tx\)/, 'the navy band carries the running entry');
});

// --- ITEM 1: the working frame ---------------------------------------------

test('the working frame is solved from the counter, not typed', () => {
  const solved = functionBody('derivedWorkingPose');
  for (const subject of ['bagGroup', 'REGISTER.staging', 'screenPlane', 'CARD_STATION', 'customerLocalPosition']) {
    assert.ok(solved.includes(subject), `the solve ignores ${subject}`);
  }
  assert.match(solved, /solveFramingPose\(\{/, 'it goes through the shared framing solver');
  assert.match(solved, /workPoseCache/, 'the solve is cached — a frame that chases the customer is a ride');
  const dynamic = functionBody('dynamicPose');
  assert.match(dynamic, /key === 'overview' \|\| key === 'scan'\) return derivedWorkingPose/,
    'browsing and scanning both use the derived frame');
});

test('the framing solver bisects for the tightest fit and pans onto its anchor', () => {
  const solver = functionBody('solveFramingPose');
  assert.match(solver, /for \(let step = 0; step < 16; step \+= 1\)/, 'bisection, not a multiplicative walk');
  assert.match(solver, /box\.hx <= marginX && box\.hy <= marginY/);
  assert.match(solver, /\(box\.cx - anchorX\)/, 'the aim pans so the subject box lands on the anchor');
  // The drawer view uses the same solver, so both frames stay honest together.
  const cash = functionBody('derivedCashDrawerPose');
  assert.match(cash, /solveFramingPose\(\{/);
  assert.match(cash, /anchorX: 0\.13/, 'reference 154525 puts the till right of centre');
});

test('the POS faces the player square on: its own yaw is zero and the eye is on the counter normal', async () => {
  const { REGISTER, FRONT_DESK_FRAME } = await import('../src/data/shopLayout.js');
  // The kit devices author their screen face toward the staff side at local
  // rotation zero, so the monitor carries only the desk's own frame yaw. A
  // camera on the counter normal therefore sees the glass flat — which is what
  // "the monitor is rotated 25° and clipped by the frame edge" was really about.
  assert.equal(REGISTER.monitor.ry, FRONT_DESK_FRAME.ry, 'the monitor carries no yaw of its own');
  const standoff = functionBody('staffStandoffDirection');
  assert.match(standoff, /frontDeskOffsetVector3\(0, 0, 1\)/,
    'the eye stands back along the counter normal, which is what un-rotates the POS');
  const solved = functionBody('derivedWorkingPose');
  assert.match(solved, /staffStandoffDirection\(0\.\d+\)/, 'pitched down into a working stance');
});

test('bills and coins survive the tray with real money still in them', () => {
  // A regression guard for the migration: no denomination may vanish, and the
  // opening float must still be able to break every note it carries.
  const drawer = newDrawer();
  for (const denom of DENOMS) {
    assert.ok(drawer[denom] > 0, `the opening float is missing ${denom}`);
  }
  assert.ok(BILLS.every((bill) => drawer[bill] > 0));
  assert.ok(stackTotal(drawer) > 100, 'the float is a real bank, not a token');
});
