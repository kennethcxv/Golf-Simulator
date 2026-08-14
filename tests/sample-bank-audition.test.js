// PLAYTEST 3, ITEM 1 — THE AUDITION SWITCHER, AT THE LAYER THAT PICKS THE FILE.
//
// The picker is only worth building if pinning an option actually changes which
// recording reaches the speakers. That is a claim about SELECTION, and selection
// is testable here without a browser: give the bank two competing options in one
// family, pin one, and check that every draw comes from it.
//
// The control that matters is the third test. A picker whose selection silently
// does nothing looks identical to a working one from the UI side — you click,
// the label changes, and a sound plays. So the test that would FAIL on a broken
// pin is the one asserting the OTHER option never plays, not the one asserting
// the pinned option does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleBank } from '../src/core/sampleBank.js';

// A fake decode that returns a distinguishable object per file. The real one
// returns AudioBuffers; nothing here touches Web Audio.
function bankWith(manifest) {
  const bank = createSampleBank({
    decode: async (data) => ({ tag: String(data) }),
    fetchFn: async (url) => url,
    now: () => 0,
  });
  return bank.loadAll(manifest).then(() => bank);
}

const MANIFEST = [
  { cue: 'uiTick', file: 'wood-a.ogg', family: 'menuButton', option: 'wooden', optionLabel: 'Wooden button', licence: 'CC0-1.0' },
  { cue: 'uiTick', file: 'wood-b.ogg', family: 'menuButton', option: 'wooden', optionLabel: 'Wooden button', licence: 'CC0-1.0' },
  { cue: 'uiTick', file: 'felt-a.ogg', family: 'menuButton', option: 'felt', optionLabel: 'Felt tap', licence: 'CC0-1.0' },
  { cue: 'uiConfirm', file: 'felt-c.ogg', family: 'menuButton', option: 'felt', optionLabel: 'Felt tap', licence: 'CC0-1.0' },
];

test('the picker lists every family and every option that actually decoded', async () => {
  const bank = await bankWith(MANIFEST);
  const fams = bank.families();
  assert.equal(fams.length, 1);
  assert.equal(fams[0].family, 'menuButton');
  assert.deepEqual(fams[0].options.map((o) => o.id).sort(), ['felt', 'wooden']);
  assert.equal(fams[0].current, null, 'nothing is pinned before the owner picks');
  const felt = fams[0].options.find((o) => o.id === 'felt');
  assert.equal(felt.label, 'Felt tap', 'the label is what the owner names the winner by');
  assert.deepEqual(felt.cues, ['uiConfirm', 'uiTick']);
});

test('pinning an option confines the draw to that option', async () => {
  const bank = await bankWith(MANIFEST);
  assert.equal(bank.setFamilyOption('menuButton', 'felt'), true);
  assert.equal(bank.familyOption('menuButton'), 'felt');
  // draw many times with a sweeping random so every index is reachable
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) {
    const b = bank.buffer('uiTick', () => (i % 60) / 60);
    seen.add(b.tag);
  }
  assert.deepEqual([...seen], ['felt-a.ogg'],
    'a pinned family must never draw the option the owner rejected');
});

test('the OTHER option is genuinely unreachable while a pin is held', async () => {
  // THE CONTROL. Without this the suite passes on a bank whose pin does nothing:
  // "the pinned file played" is also true of a bank that plays everything.
  const bank = await bankWith(MANIFEST);
  bank.setFamilyOption('menuButton', 'wooden');
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    seen.add(bank.buffer('uiTick', () => i / 200).tag);
  }
  assert.equal(seen.has('felt-a.ogg'), false, 'the rejected option still reached the draw');
  assert.equal(seen.size, 2, 'both of the pinned option\'s recordings should still vary');
});

test('an option that covers nothing for a cue leaves that cue audible', async () => {
  // 'wooden' has no uiConfirm recording. Pinning it must not mute the button --
  // a silent confirm would be blamed on the sound, not on the picker.
  const bank = await bankWith(MANIFEST);
  bank.setFamilyOption('menuButton', 'wooden');
  const b = bank.buffer('uiConfirm', () => 0);
  assert.ok(b, 'uiConfirm went silent under a pin that does not cover it');
  assert.equal(b.tag, 'felt-c.ogg');
});

test('an option name the bank never decoded is refused, not silently accepted', async () => {
  // A picker showing a selection that changes no sound is the exact failure this
  // feature exists to remove, so the setter reports rather than shrugs.
  const bank = await bankWith(MANIFEST);
  assert.equal(bank.setFamilyOption('menuButton', 'no-such-option'), false);
  assert.equal(bank.familyOption('menuButton'), null);
  assert.equal(bank.setFamilyOption('noSuchFamily', 'felt'), false);
});

test('clearing the pin returns the family to drawing from everything', async () => {
  const bank = await bankWith(MANIFEST);
  bank.setFamilyOption('menuButton', 'felt');
  assert.equal(bank.setFamilyOption('menuButton', null), true);
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(bank.buffer('uiTick', () => i / 200).tag);
  assert.equal(seen.size, 3);
});
