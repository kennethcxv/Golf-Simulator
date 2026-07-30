// THE READER'S KEYS ARE THE MODELLED ONES, AND ITS DISPLAY NEVER SHOWS A DIGIT.
//
// Reported 2026-07-29: "The card reader: Numbers must NOT appear on the reader's display. The
// player presses the physical number keys modelled in Blender. The display shows the amount
// and prompts, not the digits being entered."
//
// What a headless test can hold: the GLB really carries the key meshes, presses raycast to
// them, the canvas keypad is gone, and the entry branch of the display draws dots — never
// cardEnteredAmount, never the digit string. Whether it LOOKS right is held by the card
// acceptance run (qa/.../acceptance/card/10-card-amount-entry*.png): amount and prompt on the
// glass, four dots after four presses, keys on the deck below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const source = readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

const sliceFn = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `no function ${name}`);
  const rest = source.slice(start);
  const end = rest.indexOf('\n  function ');
  return end > 0 ? rest.slice(0, end) : rest;
};

test('the terminal GLB models every key the flow needs', async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(
    new URL('../assets/checkout/glb/payment_terminal.glb', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''),
  );
  const names = new Set(doc.getRoot().listNodes().map((node) => node.getName()));
  for (let digit = 0; digit <= 9; digit += 1) {
    assert.ok(names.has(`Terminal_Key_${digit}`), `Terminal_Key_${digit} missing from the GLB`);
  }
  for (const button of ['Terminal_ConfirmButton', 'Terminal_CancelButton', 'Terminal_BackButton']) {
    assert.ok(names.has(button), `${button} missing from the GLB`);
  }
});

test('every modelled key name maps to the right action, and nothing else does', () => {
  const body = sliceFn('terminalKeyActionForName');
  // The map covers the key body AND its glyph face, so a press on the painted
  // number is the same press.
  assert.match(body, /Terminal_\|t_glyph_/);
  // Digits, confirm, backspace, clear all reachable.
  for (const fragment of ['digit:', "'confirm'", "'backspace'", "'clear'"]) {
    assert.ok(body.includes(fragment), `${fragment} unreachable from a key name`);
  }
});

test('a press is a raycast against the key meshes, not a screen-canvas lookup', () => {
  const body = sliceFn('terminalKeyAt');
  assert.match(body, /intersectObjects\(terminalKeyPickables/);
  assert.ok(!body.includes('terminalScreenUV'), 'the press must not route through the screen texture');
  assert.ok(!source.includes('TERM_KEYPAD'), 'the canvas keypad table is deleted, not orphaned');
});

test('the entry display shows the amount, a prompt, and dots — never the entered digits', () => {
  const start = source.indexOf("} else if (stage === 'card-entry') {");
  const end = source.indexOf("} else if (stage === 'card-busy') {", start);
  assert.ok(start >= 0 && end > start, 'could not slice the entry branch of drawTerm');
  const entry = source.slice(start, end);
  assert.match(entry, /ENTER AMOUNT/);
  assert.match(entry, /totalOf\(tx\)/, 'the amount due is the one number on the glass');
  assert.match(entry, /\\u2022/, 'progress is dots');
  // The two ways digits used to reach the glass, both banned.
  assert.ok(!entry.includes('cardEnteredAmount'), 'the running amount must not render');
  assert.ok(!/fillText\(`?\$\{tx\.cardEntryDigits/.test(entry), 'the digit string must not render');
  assert.ok(!entry.includes('fillRect(key'), 'no drawn keypad');
});

test('a successful press visibly gives, and the pulse restores the authored scale', () => {
  assert.match(sliceFn('handleTerminalKey'), /pulseTerminalKey\(action\)/);
  const pulses = sliceFn('updateTerminalKeyPulses');
  assert.match(pulses, /terminalKeyBaseScale/);
  assert.match(pulses, /scale\.copy\(mesh\.userData\.terminalKeyBaseScale\)\s*;?\s*\n/, 'the key returns to its base scale');
});

test('the QA projection points at the physical key and keeps the label aliases', () => {
  const body = sliceFn('cardKeyScreenPoint');
  assert.match(body, /terminalKeyByAction\.get\(action\)/);
  assert.match(body, /setFromObject\(mesh\)/, 'the point is the mesh box centre, not a canvas UV');
  // 'OK' is what two shipped driver families send; the old table lookup returned
  // null for it, which was a wrong answer dressed as an empty one.
  assert.match(body, /'OK' \? 'confirm'/);
});
