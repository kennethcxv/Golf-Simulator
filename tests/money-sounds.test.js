// H2 (Goal 20) — cash on the desk, the card coming out, and the drawer.
//
// The failure mode this guards is not "the sound is wrong", it is "the sound
// does not exist". Three separate lists have to agree for a register noise to
// happen at all: the sfx ALLOWLIST, the audio module's EXPORTS, and the call
// site. A name present in one and missing from another is a silent no-op with
// no error anywhere, which is indistinguishable from a sound you did not like.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const audio = fs.readFileSync(new URL('../src/core/audio.js', import.meta.url), 'utf8');
const register = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url), 'utf8',
);

const NEW_VOICES = ['notesDown', 'coinsDown', 'cardOut'];

test('every new voice is defined, exported, and allowlisted', () => {
  for (const name of NEW_VOICES) {
    assert.match(audio, new RegExp(`function ${name}\\(`), `${name} has no implementation`);
    assert.match(audio, new RegExp(`^    ${name},$`, 'm'), `${name} is not exported`);
    assert.match(audio, new RegExp(`'${name}'`), `${name} is not in the sfx allowlist`);
  }
});

test('the register actually plays them', () => {
  // the zero-call-sites trap: a voice nothing triggers is the same as no voice
  assert.match(register, /sfx\('notesDown'\)/);
  assert.match(register, /sfx\('coinsDown'\)/);
  assert.match(register, /sfx\('cardOut'\)/);
});

test('notes and coins are chosen by what was actually put down', () => {
  // The defect: cashPresent played for every tender whatever it was made of, so
  // a handful of quarters landed with the same soft paper brush as a twenty.
  assert.match(register, /const laidNotes = laid\.some\(\(denom\) => BILLS\.includes\(denom\)\)/);
  assert.match(register, /const laidCoins = laid\.some\(\(denom\) => !BILLS\.includes\(denom\)\)/);
  // a mixed tender must fire BOTH, because that is what you hear
  const block = register.slice(register.indexOf('const laidNotes'), register.indexOf('const laidNotes') + 400);
  assert.ok(block.includes("if (laidNotes) sfx('notesDown');"));
  assert.ok(block.includes("if (laidCoins) sfx('coinsDown');"));
  assert.ok(!/else/.test(block.slice(0, block.indexOf("sfx('coinsDown')"))),
    'the two must not be exclusive: a mixed tender makes both sounds');
});

test('coins do not land all at once, and never twice the same', () => {
  // A single impact reads as one object. Real change arrives over about 90 ms,
  // and a fixed pattern grates on the second sale.
  const body = audio.slice(audio.indexOf('function coinsDown('), audio.indexOf('function cardOut('));
  assert.match(body, /Math\.random\(\)/, 'the handful must vary between payments');
  assert.match(body, /for \(let i = 0; i < pieces; i \+= 1\)/, 'more than one impact');
  assert.match(body, /checkoutTone\(\{ at: 0\.01, freq: 13[0-9]/, 'the counter under them');
});

test('the card coming out is not the terminal chirp', () => {
  // cardTap is the reader accepting the card. Reusing it for the plastic
  // leaving the wallet would tell the player the payment had gone through.
  const body = audio.slice(audio.indexOf('function cardOut('));
  const head = body.slice(0, body.indexOf('\n  }'));
  assert.ok(!head.includes('cardTap'), 'cardOut must not delegate to the terminal chirp');
});
