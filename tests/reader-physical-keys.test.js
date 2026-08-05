// THE READER'S KEYS ARE THE MODELLED ONES, AND THE GLASS SHOWS THE TYPED AMOUNT.
//
// 2026-07-29: "the player presses the physical number keys modelled in Blender" — presses
// raycast the Terminal_Key_* meshes; the canvas draws no keypad. 2026-07-30 playtest reversed
// the no-digits half: the running amount renders live as it is typed, because with the reader
// floating at the player's face, hiding the entry made keying the total feel like guesswork.
// Whether it LOOKS right is held by the card acceptance run (qa/.../acceptance/card).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  CHECKOUT_TERMINAL_KEY_ROLES, checkoutTerminalKeyAction,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

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
  // The map covers the key body AND its glyph face, so a press on the painted
  // number is the same press.
  for (let digit = 0; digit <= 9; digit += 1) {
    assert.equal(checkoutTerminalKeyAction(`Terminal_Key_${digit}`), `digit:${digit}`);
    assert.equal(checkoutTerminalKeyAction(`t_glyph_Key_${digit}`), `digit:${digit}`);
  }
  assert.equal(checkoutTerminalKeyAction('Terminal_ConfirmButton'), 'confirm');
  assert.equal(checkoutTerminalKeyAction('t_glyph_ConfirmButton'), 'confirm');
  assert.equal(checkoutTerminalKeyAction('Terminal_BackButton'), 'backspace');
  assert.equal(checkoutTerminalKeyAction('Terminal_CancelButton'), 'clear');
  // …and nothing else does
  for (const stranger of ['Terminal_Shell', 'Terminal_Screen', 't_deck', '', null, undefined]) {
    assert.equal(checkoutTerminalKeyAction(stranger), null, `${stranger} is not a key`);
  }
});

test('a press is a raycast against the key meshes, not a screen-canvas lookup', () => {
  const body = sliceFn('terminalKeyAt');
  assert.match(body, /intersectObjects\(terminalKeyPickables/);
  assert.ok(!body.includes('terminalScreenUV'), 'the press must not route through the screen texture');
  assert.ok(!source.includes('TERM_KEYPAD'), 'the canvas keypad table is deleted, not orphaned');
});

test('the entry display shows the total AND the typed amount; the keypad stays physical', () => {
  // Playtest 2026-07-30 reversed the dots-like-a-PIN-pad take: with the reader
  // floating at the face, hiding the entry made keying the total feel like
  // guesswork. The digits render live; the keys remain the modelled ones.
  const start = source.indexOf("} else if (stage === 'card-entry') {");
  const end = source.indexOf("} else if (stage === 'card-busy') {", start);
  assert.ok(start >= 0 && end > start, 'could not slice the entry branch of drawTerm');
  const entry = source.slice(start, end);
  assert.match(entry, /totalOf\(tx\)/, 'the amount due stays on the glass');
  assert.match(entry, /cardEnteredAmount\(tx\)/, 'the running amount renders as typed');
  assert.ok(!entry.includes('fillRect(key'), 'still no drawn keypad - presses are mesh raycasts');
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
