import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { DELIVERY_CUE_APIS, makeAudio } from '../src/core/audio.js';

class FakeParam {
  constructor() {
    this.value = 0;
    this.automation = [];
  }
  record(method, value, time) {
    this.value = value;
    this.automation.push({ method, value, time });
  }
  setValueAtTime(value, time) { this.record('set', value, time); }
  linearRampToValueAtTime(value, time) { this.record('linear', value, time); }
  exponentialRampToValueAtTime(value, time) { this.record('exponential', value, time); }
  setTargetAtTime(value, time) { this.record('target', value, time); }
}

class FakeNode {
  constructor(kind, context) {
    this.kind = kind;
    this.context = context;
    this.gain = new FakeParam();
    this.frequency = new FakeParam();
    this.Q = new FakeParam();
    this.connections = [];
    context.nodes.push(this);
  }
  connect(target) {
    this.connections.push(target?.kind || 'param');
    return target;
  }
  start(when = 0) { this.startedAt = when; }
  stop(when = 0) { this.stoppedAt = when; }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 10;
    this.sampleRate = 48_000;
    this.state = 'running';
    this.nodes = [];
    this.destination = new FakeNode('destination', this);
    FakeAudioContext.latest = this;
  }
  createGain() { return new FakeNode('gain', this); }
  createOscillator() { return new FakeNode('oscillator', this); }
  createBufferSource() { return new FakeNode('buffer', this); }
  createBiquadFilter() { return new FakeNode('filter', this); }
  createBuffer(_channels, length) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  resume() { return Promise.resolve(); }
}
FakeAudioContext.latest = null;

const NEW_PHYSICAL_CUES = Object.freeze([
  'itemRemoval', 'boxFlatten', 'disposal',
]);

function setupAudio() {
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  const audio = makeAudio();
  audio.init();
  const context = FakeAudioContext.latest;
  context.nodes.length = 0; // discard the persistent ambient graph
  return {
    audio,
    context,
    restore() { globalThis.window = previousWindow; },
  };
}

function sources(context) {
  return context.nodes.filter((node) => node.kind === 'oscillator' || node.kind === 'buffer');
}

function graphShape(context, cueTime) {
  return JSON.stringify(context.nodes.map((node) => ({
    kind: node.kind,
    type: node.type || '',
    start: node.startedAt == null ? null : Number((node.startedAt - cueTime).toFixed(4)),
    stop: node.stoppedAt == null ? null : Number((node.stoppedAt - cueTime).toFixed(4)),
    frequencyAutomation: node.frequency.automation.map((entry) => entry.method),
    gainAutomation: node.gain.automation.map((entry) => entry.method),
  })));
}

test('delivery audio exposes every semantic cue and preserves shipped aliases', () => {
  // The four blade cues (cutterExtend/bladeContact/tapeCut/tapeRelease) and the
  // `tape` alias left with the box cutter, 2026-07-30 — cartons tear on a press
  // and the presses own their own material-distinct cues below.
  const expected = [
    'truck', 'boxup', 'boxdown',
    'flap', 'product', 'itemRemoval',
    // the three carton presses, added 2026-07-29 — tests/box-open-sound.test.js holds their contents
    'boxTapeTear', 'boxFlapFold', 'boxContentsShift',
    'stock', 'fullShelf', 'boxFlatten', 'disposal',
  ];
  assert.deepEqual(DELIVERY_CUE_APIS, expected);
  const fixture = setupAudio();
  try {
    for (const cue of expected) assert.equal(typeof fixture.audio[cue], 'function', cue);
    assert.equal(fixture.audio.tape, undefined, 'the blade-era tape alias is gone');
    assert.equal(fixture.audio.recycle, fixture.audio.disposal, 'legacy recycle alias remains exact');
  } finally {
    fixture.restore();
  }
});

test('new physical cues are distinct restrained one-shot graphs', () => {
  const fixture = setupAudio();
  try {
    const shapes = new Map();
    for (const cue of NEW_PHYSICAL_CUES) {
      fixture.context.currentTime += 1;
      fixture.context.nodes.length = 0;
      const cueTime = fixture.context.currentTime;
      fixture.audio[cue]();
      const activeSources = sources(fixture.context);
      assert.ok(activeSources.length > 0, `${cue} schedules an audible source`);
      for (const source of activeSources) {
        assert.notEqual(source.loop, true, `${cue} is not a retained loop`);
        assert.ok(Number.isFinite(source.startedAt), `${cue} starts intentionally`);
        assert.ok(Number.isFinite(source.stoppedAt), `${cue} stops intentionally`);
        assert.ok(source.stoppedAt > source.startedAt, `${cue} has positive duration`);
        assert.ok(source.stoppedAt - cueTime <= 0.8, `${cue} remains below 800 ms`);
      }
      const shape = graphShape(fixture.context, cueTime);
      assert.equal(shapes.has(shape), false,
        `${cue} differs structurally from ${shapes.get(shape) || 'prior cues'}`);
      shapes.set(shape, cue);
    }
  } finally {
    fixture.restore();
  }
});

// The tapeCut pitch-bounds test and the course cutter-routing shape test retired
// 2026-07-30 with the box cutter itself: the blade cues no longer exist, and
// pitch-variation discipline for the live carton cues is owned by
// tests/box-open-sound.test.js ("Pitch-vary so repeats do not grate").

test('unknown tools cannot create a continuous fallback loop', () => {
  const fixture = setupAudio();
  try {
    fixture.audio.setToolLoop('future-unknown-tool');
    assert.equal(sources(fixture.context).length, 0, 'unknown tools remain silent');
  } finally {
    fixture.restore();
  }
});

test('carton lifecycle routes semantic cues at the physical transition edges', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse.js', import.meta.url),
    'utf8',
  );
  // The tape used to have a cue PER TENTH of a drag, plus a release at the end,
  // because it was cut by degrees. It is torn in one press now, so there is one
  // cue on the press that tears it — boxTapeTear since 2026-07-29, when the three
  // carton presses got dedicated material-distinct cues. Each press gets exactly
  // one sound, which is what makes each press read as its own mechanical event.
  assert.match(source, /sfx\(step\.tore \? ['"]boxTapeTear['"] : ['"]boxFlapFold['"]\)/);
  assert.doesNotMatch(source, /sfx\(['"]tapeCut['"]\)/,
    'the per-tenth drag cue belongs to a gesture that no longer exists');
  assert.match(source, /boxFlattenAnimations\.add\(b\.id\)[\s\S]{0,100}sfx\(['"]boxFlatten['"]\)/);
  // 420 not 180: the routing comment explaining why this is not itemRemoval sits between the
  // call and the cue, and the window has to span it while still binding the two together.
  assert.match(source, /takeFromBox\(state,\s*b\.id\)[\s\S]{0,420}sfx\(['"]boxContentsShift['"]\)/);
  assert.doesNotMatch(
    source.match(/function startRecyclingDrop[\s\S]*?\n\s*\}/)?.[0] || '',
    /sfx\(['"](?:recycle|disposal)['"]\)/,
    'lowering a carton into recycling must not fire the sink cue early',
  );
  assert.match(source,
    /recycleCarriedBox\(state,\s*box\.id\)\.ok\)\s*\{[\s\S]{0,100}sfx\(['"]disposal['"]\)/);
});
