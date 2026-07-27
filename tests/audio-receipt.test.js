import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKOUT_CUE_APIS,
  CLUBHOUSE_RESTORATION_CUE_APIS,
  makeAudio,
} from '../src/core/audio.js';

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
  constructor(kind, events, context) {
    this.kind = kind;
    this.events = events;
    this.context = context;
    this.gain = new FakeParam();
    this.frequency = new FakeParam();
    this.Q = new FakeParam();
    this.connections = [];
    if (context) context.nodes.push(this);
  }
  connect(target) {
    this.connections.push(target.kind);
    return target;
  }
  start(when = 0) {
    this.startedAt = when;
    this.events.push({ kind: this.kind, when });
  }
  stop(when = 0) { this.stoppedAt = when; }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 10;
    this.sampleRate = 48_000;
    this.state = 'running';
    this.nodes = [];
    this.destination = new FakeNode('destination', FakeAudioContext.events, this);
    FakeAudioContext.latest = this;
  }
  createGain() { return new FakeNode('gain', FakeAudioContext.events, this); }
  createOscillator() { return new FakeNode('oscillator', FakeAudioContext.events, this); }
  createBufferSource() { return new FakeNode('buffer', FakeAudioContext.events, this); }
  createBiquadFilter() { return new FakeNode('filter', FakeAudioContext.events, this); }
  createBuffer(_channels, length) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  resume() { return Promise.resolve(); }
}
FakeAudioContext.events = [];
FakeAudioContext.latest = null;

const EXPECTED_CHECKOUT_CUES = [
  'productPlace', 'productPickup', 'productRotate',
  'scannerActivate', 'scanSuccess', 'scanInvalid', 'posAdd',
  'cardMove', 'cardSwipe', 'cardInsert', 'cardProcessing', 'cardApproved', 'cardDeclined',
  'cashPresent', 'billHandle', 'coinHandle',
  'drawerUnlock', 'drawerOpen', 'drawerClose',
  'changeSelect', 'changeHandoff',
  'receiptPrint', 'receiptTear',
  'bagOpen', 'bagRustle', 'bagItem', 'bagHandoff',
  'checkoutComplete',
];

function setupAudio() {
  const previousWindow = globalThis.window;
  FakeAudioContext.events.length = 0;
  FakeAudioContext.latest = null;
  globalThis.window = { AudioContext: FakeAudioContext };
  const audio = makeAudio();
  audio.init();
  const context = FakeAudioContext.latest;
  FakeAudioContext.events.length = 0;
  context.nodes.length = 0; // discard the persistent ambient graph from inspection
  return {
    audio,
    context,
    restore() { globalThis.window = previousWindow; },
  };
}

function rounded(value) {
  return Number(Number(value).toFixed(5));
}

function cueSignature(nodes, cueTime) {
  return JSON.stringify(nodes.map((node) => ({
    kind: node.kind,
    type: node.type || '',
    start: node.startedAt == null ? null : rounded(node.startedAt - cueTime),
    stop: node.stoppedAt == null ? null : rounded(node.stoppedAt - cueTime),
    bufferLength: node.buffer ? node.buffer.length : 0,
    frequency: rounded(node.frequency.value),
    frequencyAutomation: node.frequency.automation.map((event) => [
      event.method, rounded(event.value), rounded(event.time - cueTime),
    ]),
    gainAutomation: node.gain.automation.map((event) => [
      event.method, rounded(event.value), rounded(event.time - cueTime),
    ]),
    q: rounded(node.Q.value),
  })));
}

test('receipt feed and physical tear are separate audio events', () => {
  const fixture = setupAudio();
  try {
    fixture.audio.receiptPrint();
    const feedEvents = FakeAudioContext.events.slice();
    assert.equal(feedEvents.filter((event) => event.kind === 'oscillator').length, 9);
    assert.equal(feedEvents.some((event) => event.kind === 'buffer'), false,
      'starting the printer must not schedule a tear noise');

    fixture.audio.receiptTear();
    const tearEvents = FakeAudioContext.events.slice(feedEvents.length);
    assert.deepEqual(tearEvents.map((event) => event.kind), ['buffer']);
    assert.equal(tearEvents[0].when, 10,
      'the tear begins at the physical pickup, not on a printer-start delay');
  } finally {
    fixture.restore();
  }
});

test('the Pinehollow API covers every required checkout action', () => {
  const fixture = setupAudio();
  try {
    assert.deepEqual(CHECKOUT_CUE_APIS, EXPECTED_CHECKOUT_CUES);
    for (const name of EXPECTED_CHECKOUT_CUES) {
      assert.equal(typeof fixture.audio[name], 'function', `${name} has a callable cue API`);
    }
    for (const [semantic, legacy] of [
      ['scanSuccess', 'scanBeep'], ['cardApproved', 'approve'], ['cardDeclined', 'decline'],
      ['coinHandle', 'coin'], ['drawerOpen', 'drawer'], ['receiptPrint', 'receipt'],
    ]) {
      assert.equal(fixture.audio[semantic], fixture.audio[legacy],
        `${legacy} remains a compatibility alias for ${semantic}`);
    }
  } finally {
    fixture.restore();
  }
});

test('semantic clubhouse restoration cues resolve through the dynamic first-person SFX boundary', () => {
  const fixture = setupAudio();
  try {
    assert.deepEqual(CLUBHOUSE_RESTORATION_CUE_APIS, [
      'clubhouse-cleanup-complete',
      'clubhouse-light-repaired',
      'clubhouse-component-repaired',
      'clubhouse-paint-applied',
      'clubhouse-restoration-complete',
    ]);
    for (const name of CLUBHOUSE_RESTORATION_CUE_APIS) {
      fixture.context.currentTime += 2;
      fixture.context.nodes.length = 0;
      FakeAudioContext.events.length = 0;
      assert.equal(typeof fixture.audio[name], 'function', `${name} has a callable cue API`);
      fixture.audio[name]();
      const sources = fixture.context.nodes.filter((node) => (
        node.kind === 'oscillator' || node.kind === 'buffer'
      ));
      assert.ok(sources.length > 0, `${name} schedules an audible source`);
      assert.ok(sources.every((source) => Number.isFinite(source.stoppedAt)),
        `${name} remains a bounded one-shot`);
    }
    assert.equal(fixture.audio['clubhouse-cleanup-complete'], fixture.audio.chime);
    assert.equal(fixture.audio['clubhouse-light-repaired'], fixture.audio.lightSwitch);
    assert.equal(fixture.audio['clubhouse-component-repaired'], fixture.audio.fixtureAdjust);
    assert.equal(fixture.audio['clubhouse-paint-applied'], fixture.audio.chime);
    // The whole-shed completion beat is no longer the bare checkout fanfare: it layers the clean
    // sparkle + the fanfare + a short decaying tail, so it is its own bounded completion composite.
    assert.notEqual(fixture.audio['clubhouse-restoration-complete'], fixture.audio.checkoutComplete,
      'restoration-complete is a distinct completion composite, not the bare checkout fanfare');
    fixture.context.currentTime += 2;
    fixture.context.nodes.length = 0;
    fixture.audio['clubhouse-restoration-complete']();
    const fanfareOnly = (() => {
      fixture.context.nodes.length = 0;
      fixture.audio.checkoutComplete();
      return fixture.context.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'buffer').length;
    })();
    fixture.context.nodes.length = 0;
    fixture.audio['clubhouse-restoration-complete']();
    const composite = fixture.context.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'buffer').length;
    assert.ok(composite > fanfareOnly, 'completion beat layers more voices than the fanfare alone');
  } finally {
    fixture.restore();
  }
});

test('every checkout cue is a distinct bounded one-shot graph', () => {
  const fixture = setupAudio();
  try {
    const signatures = new Map();
    for (const name of EXPECTED_CHECKOUT_CUES) {
      fixture.context.currentTime += 2;
      fixture.context.nodes.length = 0;
      FakeAudioContext.events.length = 0;
      const cueTime = fixture.context.currentTime;

      fixture.audio[name]();

      const sources = fixture.context.nodes.filter((node) => node.kind === 'oscillator' || node.kind === 'buffer');
      assert.ok(sources.length > 0, `${name} schedules an audible source`);
      for (const source of sources) {
        assert.equal(source.loop, undefined, `${name} does not create a persistent loop`);
        assert.ok(Number.isFinite(source.startedAt), `${name} starts every source intentionally`);
        assert.ok(Number.isFinite(source.stoppedAt), `${name} stops every source explicitly`);
        assert.ok(source.stoppedAt > source.startedAt, `${name} has positive source duration`);
        assert.ok(source.stoppedAt - cueTime <= 0.85, `${name} remains a restrained sub-second cue`);
      }

      const signature = cueSignature(fixture.context.nodes, cueTime);
      assert.equal(signatures.has(signature), false,
        `${name} has a synthesis signature distinct from ${signatures.get(signature) || 'every prior cue'}`);
      signatures.set(signature, name);
    }
    assert.equal(signatures.size, EXPECTED_CHECKOUT_CUES.length);
  } finally {
    fixture.restore();
  }
});

test('continuous checkout motion cues are rate-limited without retaining source nodes', () => {
  const fixture = setupAudio();
  try {
    for (const [name, gap] of [['productRotate', 0.055], ['cardMove', 0.04], ['bagRustle', 0.07]]) {
      fixture.context.nodes.length = 0;
      fixture.audio[name]();
      const firstCount = fixture.context.nodes.length;
      assert.ok(firstCount > 0);

      fixture.audio[name]();
      assert.equal(fixture.context.nodes.length, firstCount, `${name} suppresses same-frame node buildup`);

      fixture.context.currentTime += gap + 0.001;
      fixture.audio[name]();
      assert.ok(fixture.context.nodes.length > firstCount, `${name} remains responsive after its short gate`);
    }
  } finally {
    fixture.restore();
  }
});
