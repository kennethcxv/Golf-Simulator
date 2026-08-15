// PLAYTEST 4, ITEM 2 — THE REGISTER'S CASH TIMING, PINNED WHERE IT CAN BE PINNED.
//
// The timing itself was measured in Electron on a real sale
// (tools/qa/electron-register-timing.js, qa/electron/register-timing/), because a
// headless test cannot hear a graph. What a headless test CAN hold still is the
// two things the measured numbers depend on, and both were free to drift back:
//
//   1. THE LANDING CUES ARE SHORT. "The cash sound runs past the animation. It
//      must stop the moment the last piece lands." The run was already tight
//      (measured 0.000 s of overhang); the overhang was the per-landing one-shot,
//      0.509 s of paper still sounding after a 0.44 s fly had ended, and a full
//      second for the auditioned cashLand winner. Re-cutting any of these longer
//      brings the complaint straight back with no code change to blame.
//
//   2. THE LIFT HAS A VOICE AT ALL. "Taking change out of the drawer to hand over
//      is silent." Measured before: clicking a drawer slot started ZERO buffer
//      sources. It needs recordings of its OWN — sharing billDeposit's or
//      cashPickup's would put one sound on three different gestures, which is the
//      reason none of the three read as itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'Assets', 'audio', 'manifest.json'), 'utf8'));
const forCue = (cue) => manifest.samples.filter((s) => s.cue === cue);

// The cash fly is 0.44 s and pieces stagger 0.045 s apart. A landing whose sound
// outlasts the fly is heard after the money has stopped moving.
const LANDING_CEILING = 0.5;

test('every cash landing cue ends inside the gesture it belongs to', () => {
  const landings = ['billDeposit', 'coinDeposit', 'billDepositEmpty', 'coinDepositEmpty'];
  for (const cue of landings) {
    const samples = forCue(cue);
    assert.ok(samples.length, `${cue} has no recordings at all`);
    for (const s of samples) {
      assert.ok(s.seconds <= LANDING_CEILING,
        `${s.file} is ${s.seconds}s — a landing must end within ${LANDING_CEILING}s or it outlives the animation`);
    }
  }
});

test('the auditioned cash-landing option is a landing, not a riffle', () => {
  // The owner's cashLand winner plays on EVERY piece landing, so its length is
  // the one most likely to be heard as the sound running on.
  const winner = manifest.samples.filter((s) => s.family === 'cashLand');
  assert.ok(winner.length, 'the cashLand family has no options');
  for (const s of winner) {
    assert.ok(s.seconds <= LANDING_CEILING, `${s.file} is ${s.seconds}s`);
  }
});

test('lifting change out of the drawer has recordings of its own', () => {
  const lift = forCue('changeSelect');
  assert.ok(lift.length >= 2, `changeSelect has ${lift.length} recordings; it was silent before`);
  const liftFiles = new Set(lift.map((s) => s.file));
  // Distinct from money going IN and from money coming back off the counter.
  for (const other of ['billDeposit', 'coinDeposit', 'cashPickup']) {
    for (const s of forCue(other)) {
      assert.equal(liftFiles.has(s.file), false,
        `${s.file} serves both changeSelect and ${other} — one sound on two gestures`);
    }
  }
});

test('changeSelect asks the sample bank before falling back to a tone', () => {
  // The recordings existing is not the same as them being reachable: uiError sat
  // in the manifest for a whole round while the code played oscillators.
  const src = fs.readFileSync(path.join(REPO, 'src', 'core', 'audio.js'), 'utf8');
  const body = src.slice(src.indexOf('function changeSelect()'));
  const end = body.indexOf('\n  }');
  assert.match(body.slice(0, end), /sampled\('changeSelect'/,
    'changeSelect must ask the bank first, or its recordings never play');
});

test('the drawer sequence hands back a cash-entry point, not the whole drawer', () => {
  // The register holds the cash for whatever drawerOpenSequence returns. It used
  // to return openAt + the FULL slide length, which measured 1.72 s from the
  // slide to the first note and read as a pause. The constant is asserted here
  // because it is the number the owner is judging.
  const src = fs.readFileSync(path.join(REPO, 'src', 'core', 'audio.js'), 'utf8');
  const match = src.match(/const CASH_FOLLOWS_SLIDE_BY = ([\d.]+);/);
  assert.ok(match, 'CASH_FOLLOWS_SLIDE_BY is gone — the sequence contract changed without this test noticing');
  const beat = Number(match[1]);
  assert.ok(beat > 0.05 && beat < 0.5, `${beat}s is outside "close behind the drawer"`);
  const fn = src.slice(src.indexOf('function drawerOpenSequence()'));
  assert.match(fn.slice(0, fn.indexOf('\n  }')), /return openAt \+ CASH_FOLLOWS_SLIDE_BY;/,
    'the sequence must return the cash entry point');
});
