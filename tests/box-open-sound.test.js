// THREE PRESSES, THREE SOUNDS, BUILT FROM THREE DIFFERENT MATERIALS.
//
// Reported 2026-07-29: "The gesture is good. The sound is thin. Tape tearing, cardboard
// flexing, flaps folding over, contents shifting when you reach in. Each of the three presses
// should sound different and mechanical. Pitch-vary so repeats do not grate."
//
// What a headless test can hold: that the three cues exist on the production contract, that the
// three presses each route to their OWN one, and that each generator actually contains the
// physical ingredients the brief named. What it cannot hold is whether they sound right — that
// is measured by rendering them, in tools/qa/box-open-sound-shape.js, whose numbers are in
// Designs/ProShop/Greybox/data/box-open-sound-shape.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DELIVERY_CUE_APIS } from '../src/core/audio.js';

const audioSource = readFileSync(new URL('../src/core/audio.js', import.meta.url), 'utf8');
const clubhouse = readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');

const cueBody = (name) => {
  // `(` and not `() {` — the shared helpers (stickSlip, airSwing, boardKnock) take
  // parameters, and the first version of this matched only the zero-arg cues.
  const start = audioSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `no generator called ${name}`);
  // Up to the next top-level `  function ` at the same indent.
  const rest = audioSource.slice(start + 10);
  const end = rest.indexOf('\n  function ');
  return end > 0 ? rest.slice(0, end) : rest;
};

test('the three carton cues are on the production contract', () => {
  for (const cue of ['boxTapeTear', 'boxFlapFold', 'boxContentsShift']) {
    assert.ok(DELIVERY_CUE_APIS.includes(cue), `${cue} is not in DELIVERY_CUE_APIS`);
  }
  // …and reachable on the returned audio surface, which is how main.js routes SFX by name.
  assert.match(audioSource, /boxTapeTear, boxFlapFold, boxContentsShift,/);
});

test('each of the three presses routes to its own cue', () => {
  // Press 1 tears; press 2 folds; press 3 reaches in. One cue shared between two of them is
  // the defect that was reported — the tape and the second flap sounded like one noise.
  assert.match(clubhouse, /sfx\(step\.tore \? 'boxTapeTear' : 'boxFlapFold'\)/);
  assert.match(clubhouse, /sfx\('boxContentsShift'\)/);
  // The generic cues they replaced must not still be firing on a carton press.
  const pressBlock = clubhouse.slice(
    clubhouse.indexOf('if (!flapsOpen(b)) {'),
    clubhouse.indexOf("tutorialFlag(state, 'boxCarried')"),
  );
  assert.ok(pressBlock.length > 200, 'could not slice the carton press block');
  for (const gone of ["sfx('flap')", "sfx('tapeRelease')", "sfx('itemRemoval')"]) {
    assert.ok(!pressBlock.includes(gone), `${gone} still fires on a carton press`);
  }
});

test('press one is adhesive: stick-slip, a swept band, and the flaps swinging over', () => {
  const body = cueBody('boxTapeTear');
  assert.match(body, /stickSlip\(/, 'tape tears in grabs, not as a smooth hiss');
  assert.match(body, /exponentialRampToValueAtTime\(varied\(880/, 'the band sweeps down as the seam runs');
  assert.match(body, /airSwing\(/, 'the flaps move air');
  assert.match(body, /boardKnock\(/, 'and the board is struck');
  // Two wide flaps, so two swings.
  assert.equal((body.match(/airSwing\(/g) || []).length, 2);
});

test('press two is board, not adhesive - flex, creases, and the flap landing', () => {
  const body = cueBody('boxFlapFold');
  assert.ok(!body.includes('stickSlip'), 'there is no tape left to tear on the second press');
  // The flex RISES before it falls: a panel bending, not something being hit.
  assert.match(body, /linearRampToValueAtTime\(168 \* flexPitch/);
  assert.match(body, /for \(let i = 0; i < 3; i\+\+\)/, 'three creases letting go');
  assert.match(body, /boardKnock\(\{ delay: 0\.257/, 'and the flap arriving on the side');
});

test('press three is objects - rustle, several knocks, and one unit lifting clear', () => {
  const body = cueBody('boxContentsShift');
  assert.ok(!body.includes('stickSlip'), 'reaching in is not a tear');
  assert.match(body, /const knocks = 3 \+/, 'the stack settles in several knocks, and not always the same number');
  assert.match(body, /lift\.frequency/, 'something comes out');
});

test('every scattered event is jittered, so two presses are never the same waveform', () => {
  // "Pitch-vary so repeats do not grate." Each cue must vary BOTH its pitches (varied) and its
  // event times (Math.random in a delay), or a repeat is the identical waveform at a new pitch.
  for (const name of ['boxTapeTear', 'boxFlapFold', 'boxContentsShift']) {
    const body = cueBody(name);
    assert.ok(/varied\(/.test(body) || /pitchVariation/.test(body), `${name} does not vary its pitch`);
    assert.match(body, /Math\.random\(\)/, `${name} has no timing jitter`);
  }
  // The shared helpers vary too, or a cue built only out of them would be static.
  assert.match(cueBody('airSwing'), /varied\(from, 0\.06\)/);
  assert.match(cueBody('boardKnock'), /varied\(1, 0\.05\)/);
});

test('stickSlip is irregular by construction, not a fixed sawtooth', () => {
  // A stick-slip envelope whose grabs were all the same height would be a tremolo, which is a
  // different (and worse) sound than tape. The level is randomised per grab AND decays.
  const body = cueBody('stickSlip');
  assert.match(body, /0\.45 \+ Math\.random\(\) \* 0\.75/, 'each grab has its own height');
  assert.match(body, /1 - \(i \/ steps\) \* 0\.55/, 'and the tear runs out of energy as it goes');
});
