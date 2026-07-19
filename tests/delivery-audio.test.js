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
  'cutterExtend', 'bladeContact', 'tapeCut', 'tapeRelease',
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
  const expected = [
    'truck', 'boxup', 'boxdown',
    'cutterExtend', 'bladeContact', 'tapeCut', 'tapeRelease',
    'flap', 'product', 'itemRemoval',
    'stock', 'fullShelf', 'boxFlatten', 'disposal',
  ];
  assert.deepEqual(DELIVERY_CUE_APIS, expected);
  const fixture = setupAudio();
  try {
    for (const cue of expected) assert.equal(typeof fixture.audio[cue], 'function', cue);
    assert.equal(fixture.audio.tape, fixture.audio.tapeCut, 'legacy tape alias remains exact');
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

test('physical pitch variation is bounded and actually changes repeated cut colour', () => {
  const fixture = setupAudio();
  const previousRandom = Math.random;
  try {
    const cutBandAt = (randomValue) => {
      Math.random = () => randomValue;
      fixture.context.nodes.length = 0;
      fixture.audio.tapeCut();
      return fixture.context.nodes.find((node) => node.kind === 'filter').frequency.value;
    };
    const low = cutBandAt(0);
    const high = cutBandAt(1);
    assert.ok(low < high, `cut colour varies (${low} < ${high})`);
    assert.ok(low >= 3600 * 0.94 - 1e-9, 'lower cut pitch stays inside -6%');
    assert.ok(high <= 3600 * 1.06 + 1e-9, 'upper cut pitch stays inside +6%');
  } finally {
    Math.random = previousRandom;
    fixture.restore();
  }
});

test('box cutter and unknown tools cannot create a continuous fallback loop', () => {
  const fixture = setupAudio();
  try {
    fixture.audio.setToolLoop('boxcutter');
    assert.equal(sources(fixture.context).length, 0, 'stationary box-cutter LMB is silent');
    fixture.audio.setToolLoop('future-unknown-tool');
    assert.equal(sources(fixture.context).length, 0, 'unknown tools also remain silent');
  } finally {
    fixture.restore();
  }
});

test('course cutter routing is transition-local and contact uses hysteresis', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/courseScene.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /previousTool\s*=\s*walkTool/);
  assert.match(source,
    /tool\s*===\s*['"]boxcutter['"]\s*&&\s*previousTool\s*!==\s*['"]boxcutter['"][\s\S]{0,180}sfx\(['"]cutterExtend['"]\)/);
  assert.match(source, /let\s+cutterContactCueArmed\s*=\s*true/);
  assert.match(source,
    /wantsContact\s*&&\s*cutterContactBlend\s*>=\s*0\.82\s*&&\s*cutterContactCueArmed[\s\S]{0,180}sfx\(['"]bladeContact['"]\)/);
  assert.match(source, /cutterContactBlend\s*<=\s*0\.15[\s\S]{0,100}cutterContactCueArmed\s*=\s*true/);
});

test('carton lifecycle routes semantic cues at the physical transition edges', () => {
  const source = fs.readFileSync(
    new URL('../src/render3d/clubhouse.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /cutBeat\s*!==\s*lastCutBeat\s*\|\|\s*r\.done[\s\S]{0,160}sfx\(['"]tapeCut['"]\)/);
  assert.match(source, /if\s*\(r\.done\)\s*\{[\s\S]{0,100}sfx\(['"]tapeRelease['"]\)/);
  assert.match(source, /boxFlattenAnimations\.add\(b\.id\)[\s\S]{0,100}sfx\(['"]boxFlatten['"]\)/);
  assert.match(source, /takeFromBox\(state,\s*b\.id\)[\s\S]{0,180}sfx\(['"]itemRemoval['"]\)/);
  assert.doesNotMatch(
    source.match(/function startRecyclingDrop[\s\S]*?\n\s*\}/)?.[0] || '',
    /sfx\(['"](?:recycle|disposal)['"]\)/,
    'lowering a carton into recycling must not fire the sink cue early',
  );
  assert.match(source,
    /recycleCarriedBox\(state,\s*box\.id\)\.ok\)\s*\{[\s\S]{0,100}sfx\(['"]disposal['"]\)/);
});
