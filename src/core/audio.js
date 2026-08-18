// FAIRWAY STATE — original procedural WebAudio sound design. Pinehollow checkout
// uses dry walnut taps, restrained paper/metal textures, and a warm D/A tonal motif
// so physical actions remain legible without arcade volume. Shared player
// preferences own volume, accessibility, and lifecycle policy.

import { BROOM_FEEL } from '../data/broomFeel.js';
import { CLEANING_TOOLS } from '../data/cleaningTools.js';
import { createSampleBank } from './sampleBank.js';
// PLAYTEST 5, ITEM 5: which denominations are PAPER, from the module that owns
// the answer, so the register and the audio cannot disagree about whether a 5 is
// a note. Imported rather than restated — a second copy of this list is exactly
// how a coin comes to sound like paper.
import { BILLS } from '../sim/register.js';

const BILL_DENOMINATIONS = new Set(BILLS);

// PLAYTEST 5, ITEM 5 — pick the variant whose RECORDING matches the denomination
// in the player's hand. Two cues hold recordings of both materials and the bank
// chooses among a cue's variants at random, which is why coin and paper "cross
// over" rather than being consistently wrong:
//
//   changeSelect  2 x paper, 1 x "Coins.wav"
//   cashPickup    2 x coins, 1 x "Cash Money sounds"
//
// The title is the ground truth and travels from the manifest through
// sampleBank's meta, so no file is renamed and nothing is re-encoded. Returns an
// empty object for a caller that does not know the denomination — every existing
// call site keeps its old behaviour rather than silently getting a filter.
function materialPick(denomination) {
  const denom = Number(denomination);
  if (!Number.isFinite(denom)) return {};
  const wantsPaper = BILL_DENOMINATIONS.has(denom);
  return { pick: (entry) => /coin/i.test(entry?.title || '') !== wantsPaper };
}

export const CHECKOUT_CUE_APIS = Object.freeze([
  'productPlace', 'productPickup', 'productRotate',
  'scannerActivate', 'scanSuccess', 'scanInvalid', 'posAdd',
  'cardMove', 'cardSwipe', 'cardInsert', 'cardProcessing', 'cardApproved', 'cardDeclined',
  'cashPresent', 'billHandle', 'coinHandle',
  // PLAYTEST 3 item 2: picking cash back up, which had no voice of its own
  'cashPickup',
  // H2 (Goal 20): notes and coins landing are two different events
  'notesDown', 'coinsDown', 'cardOut',
  // G2 (Goal 23): money landing IN THE DRAWER, on top of what is already there
  'billDeposit', 'coinDeposit',
  'drawerUnlock', 'drawerOpen', 'drawerClose',
  'changeSelect', 'changeHandoff',
  'receiptPrint', 'receiptTear',
  'bagOpen', 'bagRustle', 'bagItem', 'bagHandoff',
  'checkoutComplete',
]);

// Delivery/unboxing uses semantic one-shots for every physical transition. The
// short legacy names remain on the returned audio object for shipped callers,
// while this list gives routing/tests one authoritative production contract.
export const DELIVERY_CUE_APIS = Object.freeze([
  'truck', 'boxup', 'boxdown',
  'flap', 'product', 'itemRemoval',
  'boxTapeTear', 'boxFlapFold', 'boxContentsShift',
  'stock', 'fullShelf', 'boxFlatten', 'disposal',
]);

// Clubhouse restoration actions emit these persisted semantic cue names. Keep
// the aliases on the audio surface because main.js intentionally routes all
// first-person SFX through `audio[name]` without knowing domain-specific names.
export const CLUBHOUSE_RESTORATION_CUE_APIS = Object.freeze([
  'clubhouse-cleanup-complete',
  'clubhouse-light-repaired',
  'clubhouse-component-repaired',
  'clubhouse-paint-applied',
  'clubhouse-restoration-complete',
]);

export function makeAudio(preferences = null) {
  let ctx = null;
  let master = null;
  let ambientBus = null;
  let sfxBus = null;
  let capture = null;
  let uiBus = null;
  let musicBus = null;
  let sampleBank = null;

  // ---- THE MIX TRIM, SET FROM A MEASUREMENT AND NOT BY EAR -----------------
  //
  // "Balance every cue against the mix floor, not against silence. Anything
  // under ~2x the floor is inaudible in play."
  //
  // Measured at the master bus on his save, ambience running, so the floor is
  // the MIX and not silence (qa/goal33/before.json, RMS floor 0.00666):
  //
  //     ledger open      0.08160    12.25x floor     far too loud
  //     ledger page      0.04692     7.05x
  //     ui click         0.02539     3.81x           about right
  //     escape menu      0.02257     3.39x           about right
  //     tool use (held)  0.01408     2.11x           marginal
  //     footsteps        0.01021     1.53x           INAUDIBLE
  //     tool equip       0.00722     1.08x           INAUDIBLE
  //
  // An eight-to-one spread between the loudest cue and the quietest. The target
  // is a band of roughly 3-5x for anything the player is meant to notice, and
  // the trims below are the ratios that put each measured cue there. They are
  // in ONE table on purpose: the previous levels were magic numbers scattered
  // across two thousand lines, which is why the spread went unnoticed.
  //
  // A trim is a MULTIPLIER on the cue's existing level, so the shape of every
  // sound is untouched — only how loud it sits in the mix.
  // SECOND PASS, from the re-measurement: the first trim collapsed the spread
  // from 204:1 to 5.8:1 but overshot the ledger (12.25x -> 2.39x, which is a
  // hero interaction sitting at the same level as a footstep) and left equip
  // under the 2x audibility line. A hero cue belongs at 3-4x, ambient texture
  // at 2-3x, and nothing below 2.
  const CUE_TRIM = {
    // up: these were below the floor's own noise
    footstep: 2.6,
    equipTick: 4.5,
    // down, but not flat: the ledger was eight times the footsteps it plays
    // over, and it is still meant to be the loudest thing in the room when you
    // open it
    ledgerOpen: 0.62,
    ledgerTurn: 0.72,
    ledgerClose: 0.72,
    ledgerPickup: 0.75,
  };
  const trimFor = (cue) => (Object.prototype.hasOwnProperty.call(CUE_TRIM, cue) ? CUE_TRIM[cue] : 1);

  // Ask the bank first. `true` means a recording played and the caller must
  // return; `false` means synthesise, which is the normal path today.
  function sampled(cue, bus, options = {}) {
    if (!sampleBank || !ctx) return false;
    const trim = trimFor(cue);
    const gain = (Number.isFinite(options.gain) ? options.gain : 1) * trim;
    return sampleBank.play(cue, { ctx, destination: bus || sfxBus, ...options, gain });
  }
  let paused = false;
  let lifecycleActive = true;

  let rainGain = null;
  let mowerGain = null;
  // The mower passes rather than drones (see update). A settle delay means no
  // sustained ambience can start on the load frame, which is the specific
  // complaint 1.6 is about.
  const MOWER_SETTLE_SECONDS = 25;
  let mowerPassTimer = 0;
  let mowerPassUntil = 0;
  let mowerSettleIn = MOWER_SETTLE_SECONDS;
  let birdTimer = 0;
  let strikeTimer = 0;
  const checkoutCueLastAt = new Map();

  const fallback = { master: 0.8, effects: 0.9, ambience: 0.65, ui: 0.8, muted: false };
  const settings = () => preferences?.values?.audio || fallback;

  function applyVolume() {
    if (!master) return;
    const value = settings();
    master.gain.value = value.muted ? 0 : value.master * 0.5;
    if (ambientBus) ambientBus.gain.value = value.ambience * (paused ? 0.18 : 1);
    if (sfxBus) sfxBus.gain.value = value.effects * (paused ? 0.35 : 1);
    if (uiBus) uiBus.gain.value = value.ui;
    // 1.5 — "sitting below UI and customer sounds, respecting volume and mute".
    // Music rides the ambience slider (there is no separate music preference to
    // read, and inventing one would strand every existing save with it unset) at
    // a fixed 0.34 of it, which is what puts it UNDER the effects and UI buses
    // rather than merely quiet in absolute terms. Because it hangs off the same
    // master as everything else, mute is already handled one level up.
    if (musicBus) musicBus.gain.value = value.ambience * 0.34 * (paused ? 0.5 : 1);
  }

  // must be called from a user gesture
  function init() {
    // A context can be created while the page is backgrounded and then suspended by
    // the browser. The next real pointer/key gesture must wake that same graph rather
    // than returning early and leaving the whole game silent.
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    // F2 (Goal 17) — PITCH VARIATION FOR EVERY VOICE, FROM ONE PLACE.
    //
    // Audited: of 92 voices, only 20 varied their pitch. The other 72 played
    // the identical note every time - footsteps, box handling, product sounds,
    // shelf stocking, all of which repeat constantly. That is exactly the
    // condition F2 names: "pitch-varied so repeats do not grate."
    //
    // The obvious fix is seventy-two edits. This is one: every voice in the
    // module builds its sound from ctx.createOscillator(), so wrapping that
    // once gives all of them a small random detune. Fix the class, not the
    // instance.
    //
    // +/-14 cents is deliberately below the threshold where a listener hears a
    // note as WRONG (roughly a quarter-tone, 50 cents) and well above the
    // threshold where repeats stop sounding machine-stamped. Chimes and musical
    // cues stay in tune; a boot on a board stops being the same boot.
    //
    // Detune is used rather than frequency so a voice that RAMPS its frequency
    // keeps its whole ramp intact - the offset rides on top instead of
    // replacing the first value.
    if (typeof ctx.createOscillator === 'function' && !ctx.__fwDetuned) {
      const makeOsc = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => {
        const osc = makeOsc();
        try { osc.detune.value = (Math.random() * 2 - 1) * 14; } catch { /* no detune param */ }
        return osc;
      };
      ctx.__fwDetuned = true;
    }
    master = ctx.createGain();
    master.connect(ctx.destination);
    ambientBus = ctx.createGain();
    ambientBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    uiBus = ctx.createGain();
    uiBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    applyVolume();

    // G3 (Goal 23) — THE SAMPLE PLAYER, BESIDE THE SYNTH.
    //
    // Every cue below is oscillators and filtered noise, which is why the game
    // sounds electric. The bank serves a cue from a real recording when one has
    // been vendored for it, and REFUSES otherwise, so each cue keeps its synth
    // voice until a sample earns its place. Nothing goes silent because a file
    // failed to decode.
    //
    // Assets/audio/manifest.json is currently EMPTY and this therefore changes
    // nothing you can hear today. It is the plumbing and the licence gate; the
    // recordings need a source with a credential (see Assets/audio/CREDITS.md).
    //
    // Guarded on `document` and `fetch`: audio.js is constructed head-less by
    // the test fixtures, and reaching for document.baseURI there took five
    // audio tests down with "document is not defined". A player that only
    // exists in a browser has no business being built anywhere else.
    const hasDom = typeof document !== 'undefined' && typeof fetch === 'function';
    if (hasDom) {
      sampleBank = createSampleBank({
        decode: (data) => ctx.decodeAudioData(data),
        fetchFn: async (url) => {
          const res = await fetch(new URL(url, document.baseURI).href);
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return res.arrayBuffer();
        },
        now: () => ctx.currentTime,
      });
      fetch(new URL('Assets/audio/manifest.json', document.baseURI).href)
        .then((r) => (r.ok ? r.json() : { samples: [] }))
        .then((m) => sampleBank.loadAll(m.samples || []))
        .then(() => {
          // PLAYTEST 3, ITEM 1 — RE-APPLY THE OWNER'S AUDITION PICKS.
          //
          // The pins live in preferences and the bank is rebuilt on every boot,
          // so without this the picker works beautifully for one session and
          // forgets the winner overnight. Applied here, at the one moment the
          // options exist, rather than from the settings panel -- the panel may
          // never be opened, and the pick has to hold anyway.
          try {
            const pins = settings()?.sfx || {};
            for (const [family, option] of Object.entries(pins)) {
              if (option) sampleBank.setFamilyOption(family, option);
            }
            const track = settings()?.musicTrack;
            if (track && track !== 'off') sampleBank.setFamilyOption('music', track);
          } catch { /* a bad pin must never stop the bank from finishing */ }
          // 1.5 — THE MUSIC'S ONE AND ONLY CALL SITE.
          //
          // Started here, from the moment the bank finishes decoding, for the
          // reason 1.5 asks for: "not restarting on scene transitions". Anything
          // that starts music from a SCREEN restarts it every time the screen
          // changes, and this codebase has already shipped one audio fix that
          // was attached to setVisible(true) on a menu that is born visible, so
          // the listener was never installed at all (FOUND_FALSE, main menu
          // sound, appearance 2). One call, at the one moment the buffer is
          // first available, outside every screen's lifecycle.
          //
          // It is also the moment that keeps "not decoded on a gameplay-critical
          // frame" true: this runs at menu time, off the back of the first user
          // gesture, before any gameplay frame exists.
          musicStart();
        })
        .catch(() => { /* the synth covers every cue the bank cannot serve */ });
    }

    // rain: looped noise through a low-pass, gain driven by weather
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuf;
    rainSrc.loop = true;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 850;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainLp).connect(rainGain).connect(ambientBus);
    rainSrc.start();

    // mower: detuned saws + noise, low-passed; gain gated by the morning shift
    const mowOsc = ctx.createOscillator();
    mowOsc.type = 'sawtooth';
    mowOsc.frequency.value = 92;
    const mowOsc2 = ctx.createOscillator();
    mowOsc2.type = 'sawtooth';
    mowOsc2.frequency.value = 95.5;
    const mowLp = ctx.createBiquadFilter();
    mowLp.type = 'lowpass';
    mowLp.frequency.value = 420;
    mowerGain = ctx.createGain();
    mowerGain.gain.value = 0;
    mowOsc.connect(mowLp);
    mowOsc2.connect(mowLp);
    mowLp.connect(mowerGain).connect(ambientBus);
    mowOsc.start();
    mowOsc2.start();
  }

  // Acceptance recordings need the exact mix the player hears, not a second set of
  // synthetic cues added by the test runner. This recorder is deliberately opt-in:
  // normal play creates no MediaStream nodes, tracks, blobs, or MediaRecorder.
  async function startCapture(canvas, options = {}) {
    if (capture) throw new Error('An audio/video capture is already running.');
    if (!canvas || typeof canvas.captureStream !== 'function') {
      throw new Error('This browser cannot capture the game canvas.');
    }
    if (typeof window.MediaRecorder !== 'function') {
      throw new Error('This browser does not provide MediaRecorder.');
    }

    init();
    if (!ctx || !master) throw new Error('WebAudio could not be initialized for capture.');
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

    const fps = Math.max(1, Math.min(60, Number(options.fps) || 30));
    const canvasStream = canvas.captureStream(fps);
    const videoTracks = canvasStream.getVideoTracks();
    if (!videoTracks.length) throw new Error('Canvas capture did not produce a video track.');

    const audioDestination = ctx.createMediaStreamDestination();
    master.connect(audioDestination);
    const audioTracks = audioDestination.stream.getAudioTracks();
    if (!audioTracks.length) {
      master.disconnect(audioDestination);
      for (const track of videoTracks) track.stop();
      throw new Error('WebAudio capture did not produce an audio track.');
    }
    // Sample the same post-volume master signal while recording. Track presence alone
    // cannot distinguish real SFX from a silent audio track, so acceptance evidence
    // reports both peak amplitude and the number of non-silent sample windows.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    master.connect(analyser);
    const sampleData = new Float32Array(analyser.fftSize);
    const levels = { windows: 0, nonSilentWindows: 0, peak: 0 };
    const levelTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(sampleData);
      let peak = 0;
      for (let i = 0; i < sampleData.length; i++) peak = Math.max(peak, Math.abs(sampleData[i]));
      levels.windows++;
      if (peak > 0.0001) levels.nonSilentWindows++;
      levels.peak = Math.max(levels.peak, peak);
    }, 50);

    const stream = new MediaStream([...videoTracks, ...audioTracks]);
    const candidates = [
      options.mimeType,
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].filter(Boolean);
    const mimeType = candidates.find((candidate) => (
      typeof window.MediaRecorder.isTypeSupported !== 'function'
        || window.MediaRecorder.isTypeSupported(candidate)
    ));
    if (!mimeType) {
      master.disconnect(audioDestination);
      master.disconnect(analyser);
      clearInterval(levelTimer);
      for (const track of stream.getTracks()) track.stop();
      throw new Error('No supported WebM/Opus MediaRecorder format is available.');
    }

    const chunks = [];
    let recorder;
    try {
      recorder = new window.MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: Number(options.videoBitsPerSecond) || 8_000_000,
        audioBitsPerSecond: Number(options.audioBitsPerSecond) || 128_000,
      });
    } catch (error) {
      master.disconnect(audioDestination);
      master.disconnect(analyser);
      clearInterval(levelTimer);
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });

    const started = new Promise((resolve, reject) => {
      recorder.addEventListener('start', resolve, { once: true });
      recorder.addEventListener('error', (event) => {
        reject(event.error || new Error('MediaRecorder failed to start.'));
      }, { once: true });
    });
    capture = {
      recorder, stream, canvasStream, audioDestination, analyser, levelTimer, levels,
      chunks, mimeType, startedAt: performance.now(),
    };
    try {
      recorder.start(1000);
      await started;
    } catch (error) {
      capture = null;
      try { master.disconnect(audioDestination); } catch { /* already disconnected */ }
      try { master.disconnect(analyser); } catch { /* already disconnected */ }
      clearInterval(levelTimer);
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
    return {
      mimeType: recorder.mimeType || mimeType,
      audioTracks: audioTracks.length,
      videoTracks: videoTracks.length,
      audioContextState: ctx.state,
    };
  }

  async function stopCapture(options = {}) {
    if (!capture) throw new Error('No audio/video capture is running.');
    const active = capture;
    capture = null;
    const stopped = active.recorder.state === 'inactive'
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
        active.recorder.addEventListener('stop', resolve, { once: true });
        active.recorder.addEventListener('error', (event) => {
          reject(event.error || new Error('MediaRecorder failed while stopping.'));
        }, { once: true });
        active.recorder.stop();
      });

    try {
      await stopped;
      const blob = new Blob(active.chunks, { type: active.recorder.mimeType || active.mimeType });
      if (!blob.size) throw new Error('The audio/video capture produced an empty file.');
      const downloadName = String(options.downloadName || '').trim();
      if (downloadName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = downloadName.replace(/[\\/:*?\"<>|]/g, '-');
        link.style.display = 'none';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      return {
        mimeType: blob.type,
        bytes: blob.size,
        durationMs: Math.round(performance.now() - active.startedAt),
        audioPeak: Number(active.levels.peak.toFixed(6)),
        audioSampleWindows: active.levels.windows,
        nonSilentAudioWindows: active.levels.nonSilentWindows,
        downloaded: !!downloadName,
      };
    } finally {
      try { master.disconnect(active.audioDestination); } catch { /* graph may be tearing down */ }
      try { master.disconnect(active.analyser); } catch { /* graph may be tearing down */ }
      clearInterval(active.levelTimer);
      for (const track of active.stream.getTracks()) track.stop();
      for (const track of active.canvasStream.getTracks()) track.stop();
    }
  }

  function chirp() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const start = t0 + i * (0.09 + Math.random() * 0.05);
      const f = 2300 + Math.random() * 1900;
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.2), start + 0.05);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
      osc.connect(g).connect(ambientBus);
      osc.start(start);
      osc.stop(start + 0.1);
    }
  }

  function ballStrike(kind = 'iron') {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const click = ctx.createOscillator();
    click.type = 'sine';
    const startFrequency = kind === 'putt' ? 720 : kind === 'driver' ? 1580 : kind === 'bunker' ? 480 : 1250;
    click.frequency.setValueAtTime(startFrequency, t0);
    click.frequency.exponentialRampToValueAtTime(kind === 'putt' ? 360 : 420, t0 + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    click.connect(g).connect(sfxBus);
    click.start(t0);
    click.stop(t0 + 0.09);
  }

  function ballLanding(surface = 'fairway') {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = surface === 'green' ? 'sine' : 'triangle';
    const start = surface === 'bunker' ? 115 : surface === 'rough' ? 145 : surface === 'green' ? 240 : 190;
    osc.frequency.setValueAtTime(start, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(52, start * 0.45), t0 + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(surface === 'green' ? 0.025 : 0.045, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    osc.connect(gain).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  }

  function starterCall() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [frequency, offset] of [[523, 0], [659, 0.1]]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.035, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.24);
      osc.connect(gain).connect(sfxBus);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.26);
    }
  }

  function doorbell() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [freq, at] of [[880, 0], [659, 0.16]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.09, t0 + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.4);
      osc.connect(g).connect(sfxBus);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.45);
    }
  }

  // A1 (Goal 19) — the pocket phone's ringtone: a bright double trill,
  // unmistakably a phone against the doorbell's two-note chime. One call
  // plays one trill; the ring loop retriggers it while the caller waits.
  function phoneRing() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [freq, at] of [[1046.5, 0], [1318.5, 0.085], [1046.5, 0.26], [1318.5, 0.345]]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.075, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22);
      osc.connect(g).connect(sfxBus);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.24);
    }
  }

  let lastUiTickAt = -1;
  function uiTick() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // E1: one click per press. The button factory speaks on pointerdown and
    // several surfaces still fire their own tick on click a few ms later;
    // within one press-window only the first speaks.
    //
    // THE GUARD RUNS BEFORE THE BANK, and that ordering is the whole point. When
    // the sample lookup came first it RETURNED first, so the recorded click
    // skipped this window entirely and fell back on the bank's own 20 ms gap --
    // which is short enough for one press to speak twice. Adopting a sample
    // silently weakened the double-fire protection E1 exists to provide, and
    // 1.4 asks for exactly one event per control.
    if (t0 - lastUiTickAt < 0.12) return;
    lastUiTickAt = t0;
    if (sampled('uiTick', uiBus)) return;
    const osc = ctx.createOscillator();
    osc.frequency.value = 520;
    const g = ctx.createGain();
    // G1 (Goal 23) — MEASURED, NOT GUESSED.
    //
    // At 0.05 this cue peaked at 0.0509 on the master bus against a clean zero
    // floor: −25.9 dBFS. That is why "I can barely hear them". The transfer is
    // linear, so 0.16 lands it near −16 dBFS, which is where a UI click belongs
    // — audible over a menu with nothing else playing, and not a slap.
    // tools/qa/electron-g1-menu-loudness.js re-measures it.
    //
    // THE MENU AND THE IN-GAME CLICKS ARE THE SAME CALL. window.__fwUiClick
    // routes every button in the game to uiTick, so "match them to the in-game
    // UI clicks" was already true and both were too quiet together. Raising
    // this raises both, which is the only way they stay matched.
    //
    // The first measurement of this was NOT trustworthy and the fix was to the
    // instrument, not the gain: one shot read −33.7 dBFS on one run and −29.4
    // on the next with no code change between them, because the cue decays over
    // 50 ms and the tap polls on animation frames. The driver fires eight shots
    // per window now and takes the max.
    g.gain.setValueAtTime(0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    osc.connect(g).connect(uiBus);
    osc.start(t0);
    osc.stop(t0 + 0.06);
  }

  function uiConfirm() {
    if (sampled('uiConfirm', uiBus)) return;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [frequency, offset] of [[520, 0], [700, 0.065]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.035, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.12);
      osc.connect(gain).connect(uiBus);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.14);
    }
  }

  // 1.4's cancel/destructive variant. Shares uiTick's press window, because a
  // cancel button is still a button and "exactly one event per press" does not
  // stop applying because the sound is different.
  function uiCancel() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    if (t0 - lastUiTickAt < 0.12) return;
    lastUiTickAt = t0;
    if (sampled('uiCancel', uiBus)) return;
    // synth fallback: uiTick's click, dropped a fourth, so it reads as a step back
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(390, t0);
    osc.frequency.exponentialRampToValueAtTime(300, t0 + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    osc.connect(g).connect(uiBus);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  function uiError() {
    if (!ctx) return;
    // PLAYTEST 4, ITEM 1 — this was the last synth beep left in the menu.
    //
    // uiTick, uiConfirm and uiCancel all ask the bank first; uiError never did,
    // so `ui-error-warm-1.ogg` was fetched, decoded and shipped while the player
    // heard two triangle oscillators at 260 and 220 Hz. Measured in Electron:
    // firing uiError started ZERO buffer sources. A pair of detuned triangles is
    // the exact character the P0 asked to be replaced rather than tuned.
    if (sampled('uiError', uiBus)) return;
    const t0 = ctx.currentTime;
    for (const [frequency, offset] of [[260, 0], [220, 0.08]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.035, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.15);
      osc.connect(gain).connect(uiBus);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.17);
    }
  }


  // A QA-pollable tap on the same post-volume master node the capture
  // analyser reads: instantaneous RMS/peak plus the context state, so a
  // driver can put a floor under "this click made sound within 50 ms"
  // instead of trusting dispatch counters. Costs nothing until called.
  function qaMasterTap() {
    if (!ctx || !master) return null;
    const analyser = ctx.createAnalyser();
    // 2048 bins ≈ 42 ms of history per read: a poll ANY time within 40 ms of
    // a short burst still carries its energy — at 512 a 25 ms tick lived or
    // died by 4 ms polling luck
    analyser.fftSize = 2048;
    master.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    return {
      read() {
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = data[i];
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
        }
        return { rms: Math.sqrt(sum / data.length), peak, state: ctx.state };
      },
      stop() {
        try { master.disconnect(analyser); } catch { /* already gone */ }
      },
    };
  }

  // --- the walking body and the rooms it works in (E, Full_Goal_16) --------------------

  // A footfall is a pitched heel thud plus a surface voice: boards knock in a
  // tight woody band, turf presses low with a faint grass hiss on top. One
  // shared shape, two voices, narrow variation so a walk reads as a gait and
  // never as a metronome.
  function footstep(surface = 'turf', intensity = 1) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // trimmed against the measured mix floor; see CUE_TRIM
    const level = Math.max(0.25, Math.min(1.35, Number(intensity) || 1)) * trimFor('footstep');
    const boards = surface === 'boards';
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = varied(boards ? 132 : 88, 0.06);
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f0 * 0.55), t0 + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime((boards ? 0.065 : 0.05) * level, t0);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + (boards ? 0.09 : 0.12));
    osc.connect(og).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.14);
    const dur = boards ? 0.06 : 0.11;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, boards ? 3.5 : 2.0);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    if (boards) {
      f.type = 'bandpass';
      f.frequency.value = varied(760, 0.08);
      f.Q.value = 2.2;
    } else {
      f.type = 'lowpass';
      f.frequency.value = varied(420, 0.08);
    }
    const g = ctx.createGain();
    g.gain.value = (boards ? 0.05 : 0.045) * level;
    src.connect(f).connect(g).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur);
    if (!boards) {
      const hbuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.09), ctx.sampleRate);
      const hd = hbuf.getChannelData(0);
      for (let i = 0; i < hd.length; i += 1) {
        const t = i / hd.length;
        hd[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.6);
      }
      const hsrc = ctx.createBufferSource();
      hsrc.buffer = hbuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200;
      const hg = ctx.createGain();
      hg.gain.value = 0.011 * level;
      hsrc.connect(hp).connect(hg).connect(sfxBus);
      hsrc.start(t0 + 0.012);
      hsrc.stop(t0 + 0.11);
    }
  }

  // a short band of cloth movement; the shared body of stepping in and away
  function clothSwish(t0, centre, peak, dur) {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = varied(centre, 0.08);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = peak;
    src.connect(f).connect(g).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // stepping in behind the till: cloth settles, then one knuckle on the counter
  function stationEnter() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    clothSwish(t0, 1300, 0.055, 0.16);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(varied(185, 0.05), t0 + 0.09);
    osc.frequency.exponentialRampToValueAtTime(118, t0 + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t0 + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(g).connect(sfxBus);
    osc.start(t0 + 0.09);
    osc.stop(t0 + 0.22);
  }

  // stepping away: the same cloth, lower and longer, and no knock
  function stationLeave() {
    if (!ctx) return;
    clothSwish(ctx.currentTime, 950, 0.09, 0.2);
  }

  // a cardboard card on a string turned over: two quick flaps and a small swing
  function signFlip() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const offset of [0, 0.07]) {
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) {
        const t = i / d.length;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = varied(1800, 0.07);
      f.Q.value = 1.6;
      const g = ctx.createGain();
      g.gain.value = offset === 0 ? 0.14 : 0.10;
      src.connect(f).connect(g).connect(sfxBus);
      src.start(t0 + offset);
      src.stop(t0 + offset + 0.05);
    }
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(96, t0 + 0.05);
    osc.frequency.linearRampToValueAtTime(64, t0 + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.022, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    osc.connect(g).connect(sfxBus);
    osc.start(t0 + 0.05);
    osc.stop(t0 + 0.34);
  }

  // PLAYTEST 5, ITEM 5: `ledgerLeaf` — the synthesised paper hiss — used to sit
  // here as the shared body of all three ledger cues' fallbacks. With the
  // fallbacks removed on the owner's ruling it had no callers left, so it is
  // deleted rather than kept warm: a synth voice nothing plays is exactly how
  // one comes back.

  // PLAYTEST 5, ITEM 5 — THE OLD SYNTH IS STILL PLAYING UNDERNEATH THE BOOK.
  //
  //   "When I turn a page I hear the static blip AND the new page turn. Remove
  //    the synth fallback from EVERY ledger cue, not just page turns. If the
  //    recording is missing, silence is better than the beep."
  //
  // Ruling applied to all three ledger cues below. And the mechanism is worth
  // recording, because "AND" was the surprising word: `sampled()` returns FALSE
  // when the bank refuses to play, and the caller then fell through to the
  // synth. The bank refuses for a reason that has nothing to do with a missing
  // recording — `minGapSec` is 0.02, so a second turn inside 20 ms is declined.
  // The recording plays for the first turn, the rate limiter declines the
  // second, and the second becomes a BLIP. The guard against double-triggering
  // was converting the double trigger into the synth.
  //
  // Six ledger-turn recordings, two open and two close are on disk, so this is
  // not a trade against silence in practice — but silence is the instruction if
  // it ever becomes one.
  function ledgerTurn() {
    sampled('ledgerTurn');
  }

  // the clasp frees, the cover thuds open, the first leaf settles — recorded.
  // Synth fallback removed: see the ruling on ledgerTurn.
  function ledgerOpen() {
    sampled('ledgerOpen');
  }

  // the leaves settle, then the cover shuts on them — recorded.
  // Synth fallback removed: see the ruling on ledgerTurn.
  function ledgerClose() {
    sampled('ledgerClose');
  }

  // a terminal key: plastic under a finger — a tiny high tick over a short
  // body tap, quieter and duller than the interface tick
  function keypadTap() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const tick = ctx.createOscillator();
    tick.type = 'square';
    tick.frequency.value = varied(1850, 0.06);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.02, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
    tick.connect(tg).connect(sfxBus);
    tick.start(t0);
    tick.stop(t0 + 0.03);
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.value = varied(210, 0.05);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.045, t0);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    body.connect(bg).connect(sfxBus);
    body.start(t0);
    body.stop(t0 + 0.06);
  }

  // --- hand-tool audio (same procedural language as everything above) ------------

  // equip/stow: a soft short "click-whup"
  function equipTick() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, t0);
    osc.frequency.exponentialRampToValueAtTime(210, t0 + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06 * trimFor('equipTick'), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }

  // A restrained wall-switch snap: a dry contact click with a tiny low body.
  function lightSwitch() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [type, frequency, peak, duration] of [
      ['square', 920, 0.027, 0.038],
      ['sine', 145, 0.032, 0.075],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * 0.55), t0 + duration);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peak, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(sfxBus);
      osc.start(t0);
      osc.stop(t0 + duration + 0.01);
    }
  }

  // Track-head adjustment shares the established soft hardware click.
  function fixtureAdjust() {
    equipTick();
  }

  // a job finished: gentle two-note completion chime
  function chime() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [freq, at] of [[660, 0], [880, 0.11]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.06, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.3);
      osc.connect(g).connect(sfxBus);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.35);
    }
  }

  // something heavy set down / hauled off: low noise thump
  function thunk() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(58, t0 + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }

  // a hinge easing open: a soft rising creak (filtered saw sweep)
  function doorSwing() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(74, t0);
    osc.frequency.linearRampToValueAtTime(118, t0 + 0.28);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 340;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    osc.connect(f).connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.36);
  }

  // the latch catching: a short wooden clack over a low body
  function doorShut() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(120, t0);
    body.frequency.exponentialRampToValueAtTime(64, t0 + 0.09);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.1, t0);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    body.connect(bg).connect(sfxBus);
    body.start(t0);
    body.stop(t0 + 0.14);
    const clack = ctx.createOscillator();
    clack.type = 'square';
    clack.frequency.value = 1150;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.025, t0 + 0.03);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    clack.connect(cg).connect(sfxBus);
    clack.start(t0 + 0.03);
    clack.stop(t0 + 0.08);
  }

  // Pinehollow scan success: a dry A6 square pip with a quieter fifth above it.
  // The glass wake-up sweep and invalid double-buzz have separate APIs below.
  function scanBeep() {
    checkoutTone({ freq: 1760, to: 1680, type: 'square', dur: 0.075, peak: 0.028, filter: 4200 });
    checkoutTone({ at: 0.012, freq: 2637, to: 2489, dur: 0.085, peak: 0.012 });
  }

  // PLAYTEST 5, ITEM 5 — "The cash drawer opening and closing is too loud."
  //
  // It was 0.55 on both, and the number that makes the case is not the drawer's
  // own level but what it sits next to. Read off the live audio graph
  // (tools/qa/electron-money-cue-graph.js): drawerOpen peaked at 0.592 and
  // drawerClose at 0.591, while `checkoutComplete` -- the sound that marks the
  // END OF A SALE -- peaked at 0.032. A ratio of 18.5, about 25 dB. The loudest
  // thing in the checkout was the furniture and the quietest was the outcome,
  // which is why the same round asks for the drawer to come down AND for
  // something to mark the sale: they are one mix problem seen from both ends.
  //
  // Down 4.7 dB. Deliberately a modest cut rather than a guess at the "right"
  // level, because the till slide is a real recording chosen for its swell and
  // burying it would be the opposite mistake.
  const DRAWER_GAIN = 0.32;

  // the cash drawer: rolling slide, hard stop, and the till bell
  function drawer() {
    // The recording IS the slide and the stop at the end of travel -- it was
    // chosen for that (a ~500 ms swell into a hard transient). The bell is a
    // separate cue because a real till rings on the sale, not on every drawer
    // movement, and firing both together is what made this sound like a toy.
    if (sampled('drawerOpen', sfxBus, { gain: DRAWER_GAIN })) return;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.16, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (i / data.length);
    const slide = ctx.createBufferSource();
    slide.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    const sg = ctx.createGain();
    sg.gain.value = 0.05;
    slide.connect(bp).connect(sg).connect(sfxBus);
    slide.start(t0);
    slide.stop(t0 + 0.17);
    // the bell: two quick partials, unmistakably a till
    for (const [f, dt] of [[1244, 0.17], [1867, 0.175]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      osc.connect(g).connect(sfxBus);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.55);
    }
  }


  // --- the register's own voice -------------------------------------------------
  // The brief asks for a card tap, an approval, a decline, notes, coins and a bag.
  // They all have to be TELLABLE APART with your eyes shut, because at the till the
  // sound IS the feedback: you hear whether the card cleared before you look up.

  // card tap: the terminal's contact chirp — short, dry, high
  function cardTap() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2100, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.07);
  }

  // APPROVED: Pinehollow's open D-to-A fifth, warm and affirmative without
  // borrowing a generic terminal jingle.
  function approve() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [[587.33, 0], [880, 0.09]].forEach(([f, dt]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + dt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.26);
      osc.connect(g).connect(sfxBus);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.3);
    });
  }

  // DECLINED: the same shape, inverted and soured — a low buzz that falls. You do
  // not need to read the screen to know it went wrong.
  function decline() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [[330, 0], [247, 0.13]].forEach(([f, dt]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.042, t0 + dt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.3);
      osc.connect(lp).connect(g).connect(sfxBus);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.34);
    });
  }

  // paper: notes riffled, a bag opened. Filtered noise with a fast decay — there is
  // no pitch in paper, only texture.
  function paper() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.22, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * (0.6 + 0.4 * Math.sin(t * 90));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.value = 0.07;
    src.connect(hp).connect(g).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + 0.22);
  }

  // a coin dropped into a cup: a metallic ping with a couple of inharmonic partials,
  // which is what stops it sounding like a bell
  function coin() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [f, a] of [[3140, 0.030], [4710, 0.016], [5890, 0.009]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.96, t0 + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(a, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2 + Math.random() * 0.1);
      osc.connect(g).connect(sfxBus);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    }
  }

  // Thermal receipt printer feed: a fast ratchet of tiny clicks. Paper removal is
  // a separate physical interaction and therefore has its own explicitly timed cue.
  function receipt() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 9; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 2200 + (i % 3) * 300;
      const g = ctx.createGain();
      const t = t0 + i * 0.035;
      g.gain.setValueAtTime(0.012, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      osc.connect(g).connect(sfxBus);
      osc.start(t);
      osc.stop(t + 0.03);
    }
  }

  function receiptTear() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bg = ctx.createGain();
    bg.gain.value = 0.05;
    src.connect(bg).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + 0.085);
  }

  // --- Pinehollow checkout palette -------------------------------------------
  // Every cue below is a bounded one-shot. Movement textures are rate-limited so
  // mousemove cannot build an accidental wall of WebAudio nodes. The two helpers
  // always schedule a stop and retain no source, filter, or gain after returning.
  function checkoutTone({
    at = 0, dur = 0.1, freq = 440, to = freq, type = 'sine', peak = 0.03,
    attack = 0.006, filter = 0,
  } = {}) {
    if (!ctx) return null;
    const start = ctx.currentTime + Math.max(0, Number(at) || 0);
    const seconds = Math.max(0.02, Math.min(0.8, Number(dur) || 0.1));
    const end = start + seconds;
    const startFrequency = Math.max(20, Number(freq) || 440);
    const endFrequency = Math.max(20, Number(to) || startFrequency);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startFrequency, start);
    if (endFrequency !== startFrequency) {
      osc.frequency.exponentialRampToValueAtTime(endFrequency, end);
    }
    let output = osc;
    if (filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(80, Number(filter) || 1200);
      output = output.connect(lp);
    }
    const gain = ctx.createGain();
    const level = Math.max(0.001, Math.min(0.075, Number(peak) || 0.03));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(level, start + Math.min(seconds * 0.45, Math.max(0.002, attack)));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    output.connect(gain).connect(sfxBus);
    osc.start(start);
    osc.stop(end + 0.01);
    return { start, end };
  }

  function checkoutNoise({
    at = 0, dur = 0.12, band = 1600, toBand = band, type = 'bandpass',
    q = 0.8, peak = 0.025, attack = 0.008,
  } = {}) {
    if (!ctx) return null;
    const start = ctx.currentTime + Math.max(0, Number(at) || 0);
    const seconds = Math.max(0.025, Math.min(0.8, Number(dur) || 0.12));
    const end = start + seconds;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    const startBand = Math.max(80, Number(band) || 1600);
    const endBand = Math.max(80, Number(toBand) || startBand);
    filter.frequency.setValueAtTime(startBand, start);
    if (endBand !== startBand) filter.frequency.exponentialRampToValueAtTime(endBand, end);
    filter.Q.value = Math.max(0.1, Number(q) || 0.8);
    const gain = ctx.createGain();
    const level = Math.max(0.001, Math.min(0.065, Number(peak) || 0.025));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(level, start + Math.min(seconds * 0.45, Math.max(0.002, attack)));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(gain).connect(sfxBus);
    source.start(start);
    source.stop(end + 0.005);
    return { start, end };
  }

  function checkoutCueAllowed(name, minGap) {
    if (!ctx) return false;
    const last = checkoutCueLastAt.get(name);
    if (last != null && ctx.currentTime - last < minGap) return false;
    checkoutCueLastAt.set(name, ctx.currentTime);
    return true;
  }

  function productPlace() {
    checkoutNoise({ dur: 0.09, band: 780, toBand: 520, q: 0.65, peak: 0.018, attack: 0.003 });
    checkoutTone({ freq: 196, to: 147, type: 'triangle', dur: 0.12, peak: 0.03, filter: 850 });
  }

  function productPickup() {
    checkoutNoise({ dur: 0.08, band: 1250, toBand: 2400, q: 0.75, peak: 0.016 });
    checkoutTone({ at: 0.012, freq: 220, to: 330, type: 'triangle', dur: 0.075, peak: 0.021, filter: 1200 });
  }

  function productRotate() {
    if (!checkoutCueAllowed('productRotate', 0.055)) return;
    checkoutTone({ freq: 520, to: 455, type: 'square', dur: 0.034, peak: 0.011, filter: 1700 });
    checkoutNoise({ at: 0.008, dur: 0.035, band: 2500, toBand: 1800, q: 1.2, peak: 0.008 });
  }

  function scannerActivate() {
    checkoutTone({ freq: 740, to: 1480, type: 'sine', dur: 0.115, peak: 0.019 });
    checkoutTone({ at: 0.045, freq: 1480, to: 1760, type: 'triangle', dur: 0.075, peak: 0.009 });
  }

  function scanInvalid() {
    checkoutTone({ freq: 349.23, to: 311.13, type: 'sawtooth', dur: 0.095, peak: 0.024, filter: 950 });
    checkoutTone({ at: 0.105, freq: 293.66, to: 246.94, type: 'sawtooth', dur: 0.115, peak: 0.022, filter: 850 });
  }

  function posAdd() {
    checkoutTone({ freq: 440, to: 466.16, type: 'triangle', dur: 0.085, peak: 0.018 });
    checkoutTone({ at: 0.052, freq: 587.33, to: 622.25, type: 'triangle', dur: 0.105, peak: 0.019 });
  }

  function cardMove() {
    if (!checkoutCueAllowed('cardMove', 0.04)) return;
    checkoutNoise({ dur: 0.042, band: 3400, toBand: 2300, q: 1.25, peak: 0.009, attack: 0.002 });
  }

  function cardSwipe() {
    checkoutNoise({ dur: 0.27, band: 3900, toBand: 1050, q: 0.85, peak: 0.035, attack: 0.006 });
    checkoutTone({ at: 0.018, freq: 128, to: 94, type: 'square', dur: 0.23, peak: 0.012, filter: 520 });
  }

  function cardInsert() {
    checkoutNoise({ dur: 0.105, band: 3150, toBand: 1450, q: 1.1, peak: 0.025, attack: 0.004 });
    checkoutTone({ at: 0.045, freq: 172, to: 118, type: 'square', dur: 0.09, peak: 0.018, filter: 720 });
    checkoutTone({ at: 0.105, freq: 760, to: 920, type: 'triangle', dur: 0.055, peak: 0.012, filter: 1900 });
  }

  function cardProcessing() {
    for (const [at, freq] of [[0, 440], [0.11, 440], [0.22, 587.33]]) {
      checkoutTone({ at, freq, to: freq * 0.985, type: 'triangle', dur: 0.07, peak: 0.017 });
    }
  }

  function cashPresent() {
    checkoutNoise({ dur: 0.14, band: 1050, toBand: 1750, q: 0.55, peak: 0.027, attack: 0.012 });
    checkoutNoise({ at: 0.075, dur: 0.11, band: 1850, toBand: 1250, q: 0.7, peak: 0.018 });
    checkoutTone({ at: 0.025, freq: 196, to: 164.81, type: 'triangle', dur: 0.12, peak: 0.015, filter: 700 });
  }

  // ITEM 2 — PICKING CASH BACK UP. Its own recording, because the cue that used
  // to serve this was the same one that plays when cash goes DOWN: the two
  // gestures were acoustically identical, which is why the owner heard nothing
  // for one of them. Deliberately quiet -- it is a correction, not an event.
  // PLAYTEST 5, ITEM 5: the SAME crossover as changeSelect, in the opposite
  // direction. cashPickup's three recordings are "Coins.wav", "coins being
  // handled, shaken, rattled" and "Cash Money sounds_fieldtapes" — two coin, one
  // paper — and the bank chose among them at random, so taking a note back off
  // the counter rattled two times in three. Same material filter; same source of
  // truth, which is what the recording is of.
  function cashPickup(denomination) {
    if (sampled('cashPickup', sfxBus, { gain: 0.55, ...materialPick(denomination) })) return;
    // No recording: the handle voice is a closer relative than silence. NOTE the
    // local name -- `coinHandle` is the EXPORTED key for this function and does
    // not exist as an identifier inside the module.
    coin();
  }

  function billHandle() {
    checkoutNoise({ dur: 0.135, band: 1150, toBand: 2150, q: 0.6, peak: 0.031, attack: 0.01 });
    checkoutTone({ at: 0.025, freq: 220, to: 196, type: 'triangle', dur: 0.075, peak: 0.009, filter: 650 });
  }

  // H2 (Goal 20) — CASH GOING DOWN ON THE DESK, AND NOTES ARE NOT COINS.
  //
  // `cashPresent` played for every tender whatever it was made of, so a handful
  // of quarters landed with the same soft paper sound as a twenty. These are two
  // different events and the ear knows it immediately: paper is a broadband
  // brush with a low wooden thud under it and nothing metallic; coins are
  // several bright partials that arrive slightly apart, because they never land
  // all at once.

  // G2 (Goal 23) — THE MONEY GOING INTO THE DRAWER. ITS OWN VOICE.
  //
  // "Still cannot hear it. What I want is each note or coin LANDING ON THE ONE
  // BEFORE IT — that stacking, satisfying sound. Not the handling rustle, which
  // is what billHandle/coinHandle currently play."
  //
  // He is exactly right about the mechanism: settleTenderDrag, the one place a
  // piece is actually deposited, fired `billHandle`/`coinHandle` — the sound of
  // money being MOVED IN THE HAND. There was never a deposit sound at all, so
  // the most satisfying moment in the whole checkout was scored with a rustle.
  //
  // What separates a landing from a handling is a TRANSIENT: a rustle is a
  // sustained brush with no attack, a landing is an impact with a decay. And
  // what makes it stack is the pile it lands on — the first note hits a wooden
  // well and thuds; the tenth hits nine notes and barely does. `depth` (0..1,
  // how full the compartment already is) shortens the thud and lifts the
  // partials, which is the whole "on the one before it" effect.
  function billDeposit(depth = 0) {
    // Same two-recording split as coinDeposit: `billDepositEmpty` is a note laid
    // onto a bare wooden surface, `billDeposit` is a note onto a stack of notes.
    // The first note into an empty well genuinely thuds; the tenth does not.
    const dd = Math.max(0, Math.min(1, Number(depth) || 0));
    const empty = dd < 0.34 && sampleBank?.has?.('billDepositEmpty');
    if (sampled(empty ? 'billDepositEmpty' : 'billDeposit', sfxBus, {
      rate: 1 + 0.05 * dd, gain: 0.95 - 0.2 * dd,
    })) return;
    const d = dd;
    // the slap of the note going flat onto the pile — short, broad, with attack
    checkoutNoise({ dur: 0.055, band: 1750 + 500 * d, toBand: 850, q: 1.1, peak: 0.040, attack: 0.0015 });
    // the well underneath, which is what a full drawer takes away
    checkoutTone({
      at: 0.004, freq: 128 - 22 * d, to: 82 - 14 * d, type: 'triangle',
      dur: 0.085 - 0.03 * d, peak: 0.030 * (1 - 0.45 * d), filter: 480,
    });
    // and a short paper settle after it, so it reads as coming to rest
    checkoutNoise({ at: 0.045, dur: 0.07, band: 2400, toBand: 1500, q: 0.7, peak: 0.014 });
  }

  function coinDeposit(depth = 0) {
    // "The pile it lands on changes the sound: the first note hits a wooden well
    // and thuds, the tenth hits nine notes and barely does."
    //
    // Those are two DIFFERENT RECORDINGS, not one recording pitched up. A coin
    // striking bare wood and a coin striking a heap of coins differ in decay and
    // in the whole upper spectrum, and a playbackRate tweak cannot manufacture
    // that -- it moves the pitch and takes the duration with it. `coinDepositEmpty`
    // is a coin onto an empty wooden well; `coinDeposit` is a coin onto coins.
    // Depth chooses between them, and the rate jitter on top only stops the chosen
    // file repeating identically.
    const dd = Math.max(0, Math.min(1, Number(depth) || 0));
    const empty = dd < 0.34 && sampleBank?.has?.('coinDepositEmpty');
    if (sampled(empty ? 'coinDepositEmpty' : 'coinDeposit', sfxBus, {
      rate: 1 + 0.05 * dd, gain: 0.9 - 0.2 * dd,
    })) return;
    const d = dd;
    // metal on metal: two close partials, the second a beat later, because a
    // coin never lands flat first time
    checkoutTone({ freq: 2450 + 380 * d, to: 2180 + 380 * d, type: 'triangle', dur: 0.055, peak: 0.030, attack: 0.001 });
    checkoutTone({ at: 0.013, freq: 3320 + 460 * d, to: 2960 + 460 * d, type: 'sine', dur: 0.075, peak: 0.020, attack: 0.001 });
    // the ring it leaves behind — this is the part that says "on the one before"
    checkoutTone({ at: 0.02, freq: 1560 + 240 * d, to: 1500 + 240 * d, type: 'sine', dur: 0.20, peak: 0.013, attack: 0.002 });
    // the tray under it, fading out as the compartment fills
    checkoutTone({ at: 0.002, freq: 190, to: 120, type: 'triangle', dur: 0.06, peak: 0.022 * (1 - 0.55 * d), filter: 620 });
    // the little rattle of it settling against its neighbours
    checkoutNoise({ at: 0.03, dur: 0.06, band: 4200, toBand: 3000, q: 1.6, peak: 0.010 * (0.4 + 0.6 * d) });
  }

  function notesDown() {
    // the brush of the notes...
    checkoutNoise({ dur: 0.16, band: 980, toBand: 1900, q: 0.5, peak: 0.030, attack: 0.008 });
    checkoutNoise({ at: 0.055, dur: 0.13, band: 1700, toBand: 1050, q: 0.65, peak: 0.020 });
    // ...and the counter under them. This is the half that says "on the desk".
    checkoutTone({ at: 0.02, freq: 150, to: 96, type: 'triangle', dur: 0.13, peak: 0.024, filter: 520 });
  }

  function coinsDown() {
    if (!ctx) return;
    // A handful of coins is several impacts within about 90 ms, never one. The
    // spread and the pitches are drawn from the shared varier so two payments
    // are never the same handful, which is the whole reason a repeated sound
    // grates.
    const pieces = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pieces; i += 1) {
      const at = i * (0.018 + Math.random() * 0.026);
      const f = 2100 + Math.random() * 1500;
      checkoutTone({ at, freq: f, to: f * 0.72, type: 'triangle', dur: 0.075, peak: 0.013 });
      checkoutTone({ at: at + 0.004, freq: f * 1.51, to: f * 1.1, type: 'sine', dur: 0.05, peak: 0.007 });
    }
    // the wood they land on, once, under the lot
    checkoutTone({ at: 0.01, freq: 138, to: 88, type: 'triangle', dur: 0.11, peak: 0.019, filter: 500 });
    checkoutNoise({ dur: 0.07, band: 2600, toBand: 3400, q: 1.2, peak: 0.010, attack: 0.004 });
  }

  // H2: the card COMING OUT — plastic sliding out of a wallet and being turned
  // over, which is the gesture the player watches. Dry, short, no chirp: the
  // terminal's own chirp is cardTap and the two must not be confused.
  function cardOut() {
    checkoutNoise({ dur: 0.11, band: 2400, toBand: 3600, q: 1.4, peak: 0.016, attack: 0.006 });
    checkoutTone({ at: 0.05, freq: 640, to: 880, type: 'triangle', dur: 0.055, peak: 0.010, filter: 2200 });
  }

  function drawerUnlock() {
    if (sampled('drawerUnlock', sfxBus, { gain: 0.5 })) return;
    checkoutTone({ freq: 980, to: 620, type: 'square', dur: 0.045, peak: 0.017, filter: 1800 });
    checkoutTone({ at: 0.024, freq: 142, to: 88, type: 'triangle', dur: 0.085, peak: 0.026, filter: 650 });
  }

  function drawerClose() {
    if (sampled('drawerClose', sfxBus, { gain: DRAWER_GAIN })) return;
    checkoutNoise({ dur: 0.18, band: 720, toBand: 390, q: 0.55, peak: 0.027, attack: 0.008 });
    checkoutTone({ at: 0.045, freq: 120, to: 64, type: 'triangle', dur: 0.14, peak: 0.035, filter: 520 });
    checkoutTone({ at: 0.15, freq: 920, to: 610, type: 'square', dur: 0.042, peak: 0.015, filter: 1500 });
  }

  // --- 1.2 THE CASH RUN ---------------------------------------------------------
  //
  // "Cash going in: a continuous run, 'tchhhhh', for as long as money is going in,
  // stopping when the last piece lands. Not one impact."
  //
  // Every other cue in this file is a one-shot, which is precisely why the money
  // has never sounded like anything: eight notes going into a drawer fired eight
  // separate impacts with silence between them. A run is a SUSTAINED voice whose
  // lifetime the caller owns -- it starts when the first piece leaves the hand,
  // holds while pieces are in the air, and stops when the last one lands.
  //
  // It must also cancel cleanly. A transaction can be interrupted mid-deposit (the
  // drawer force-closed, register mode left, the till reset), and a looping node
  // that outlives its transaction is a stuck sound the player cannot stop. So
  // there is exactly one voice, `stop` is idempotent, and every exit path calls it.
  let cashRunVoice = null;

  function cashRunStart({ intensity = 1 } = {}) {
    if (!ctx) return false;
    // Already running: lift the level toward the new intensity rather than
    // stacking a second loop on top of the first.
    if (cashRunVoice) {
      cashRunVoice.gain.gain.cancelScheduledValues(ctx.currentTime);
      cashRunVoice.gain.gain.setTargetAtTime(
        cashRunVoice.peak * Math.max(0.4, Math.min(1.6, intensity)), ctx.currentTime, 0.05,
      );
      return true;
    }
    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    // MEASURED, not guessed. At 0.30 the run read -26.3 dBFS on the master bus
    // against impacts landing at -12 to -16 — audible, but sitting under the
    // thing it is supposed to be the body of. 0.78 puts it near -18 dBFS: below
    // the individual landings, which still have to punch through it, and clearly
    // present as the continuous run 1.2 asks for.
    // tools/qa/electron-phase1-audio-gate.js re-measures it.
    // ITEM 2: "Lower the overall level. It is fighting everything else." 0.78 put
    // the run near -18 dBFS, which was solved against the OLD landings; the
    // deposit cues are quieter now and the run has to sit under them, not over.
    const peak = 0.46;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak * Math.max(0.4, Math.min(1.6, intensity)), t0 + 0.045);
    gain.connect(sfxBus);

    const buffer = sampleBank?.buffer?.('cashRun') || null;
    let source;
    if (buffer) {
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      // Loop INSIDE the recording rather than over the whole file: the head and
      // tail of a riffle are the hand arriving and leaving, and looping those
      // gives an audible bump every cycle. Trimming a tenth off each end puts the
      // seam in continuous material.
      const edge = Math.min(0.12, buffer.duration * 0.1);
      source.loopStart = edge;
      source.loopEnd = Math.max(edge + 0.05, buffer.duration - edge);
      source.playbackRate.value = 0.94 + Math.random() * 0.12;
      source.connect(gain);
      source.start(t0);
    } else {
      // No recording: a filtered noise run, so the cue is never silent. Same
      // shape, same lifetime, so the caller cannot tell the difference.
      const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * (0.55 + 0.45 * Math.sin(i * 0.011));
      source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2100;
      bp.Q.value = 0.7;
      source.connect(bp).connect(gain);
      source.start(t0);
    }
    cashRunVoice = { source, gain, peak, startedAt: t0, sampled: !!buffer };
    return true;
  }

  // PLAYTEST 3, ITEM 2 — HOW LONG IS THIS CUE?
  //
  // "The drawer opens. Its sound FINISHES. Then the cash starts going in." That
  // is a timing the CALLER has to honour, because the cash also has to move on
  // screen -- and the caller cannot honour it without knowing how long the
  // drawer takes. Read from the buffer the bank would actually pick, so a
  // different audition option with a different length re-times the sequence
  // instead of desynchronising it.
  function cueSeconds(cue) {
    const buffer = sampleBank?.buffer?.(cue);
    return buffer ? buffer.duration : null;
  }

  // ITEM 2 — THE DRAWER, IN ORDER: the latch, then the slide, then the money.
  //
  // All three used to fire in the same millisecond -- `drawerUnlock`,
  // `drawerOpen` and `billHandle` on three consecutive lines -- and three
  // impacts at one instant is not a drawer opening, it is a bang. Each waits for
  // the one before it.
  //
  // PLAYTEST 4 — WHAT IT RETURNS CHANGED, DELIBERATELY.
  //
  // It used to return `openAt + openSec`: the moment the drawer had finished
  // SPEAKING, which the register used to hold the cash back. Measured on a real
  // sale that put the first note in the air 1.72 s after the slide began, and
  // the owner's verdict was "the sequence is now too generous... the cash should
  // start close behind the drawer, not after a pause."
  //
  // So it returns the CASH ENTRY POINT instead: the slide's attack plus a short
  // beat. A real till does not wait for the drawer to stop rattling before the
  // hand moves — the hand is already moving while it travels. 0.20 s is enough
  // that the two attacks are separate events rather than one bang, which was the
  // Playtest 3 complaint, and short enough that the money reads as following the
  // drawer rather than answering it.
  const CASH_FOLLOWS_SLIDE_BY = 0.2;
  function drawerOpenSequence() {
    if (!ctx) return 0;
    const unlockSec = cueSeconds('drawerUnlock') ?? 0.42;
    drawerUnlock();
    // 0.82 rather than 1.0: a latch's tail is decay, and the slide beginning as
    // the click dies is what a real till does. Nothing OVERLAPS the attack,
    // which is the part that was reading as a bang.
    const openAt = Math.max(0.05, unlockSec * 0.82);
    // `drawer` is the local function; `drawerOpen` is only its exported name.
    setTimeout(() => { drawer(); }, Math.round(openAt * 1000));
    return openAt + CASH_FOLLOWS_SLIDE_BY;
  }

  /** Stop the run. Safe to call when nothing is running, and safe to call twice. */
  function cashRunStop({ fade = 0.06 } = {}) {
    // ITEM 2: "it starts late and runs past". 0.13 s of tail after the final
    // piece has landed is heard as the run outliving the money.
    const voice = cashRunVoice;
    if (!voice || !ctx) return false;
    cashRunVoice = null;
    const t0 = ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(t0);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t0);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + fade);
      voice.source.stop(t0 + fade + 0.02);
    } catch { /* a node that already stopped is the state we wanted */ }
    return true;
  }

  const cashRunActive = () => !!cashRunVoice;

  // --- 1.5 BACKGROUND MUSIC -----------------------------------------------------
  //
  // "Quiet, loopable, unobtrusive... Seamless loop with no click at the boundary,
  // sitting below UI and customer sounds, respecting volume and mute, not
  // restarting on scene transitions, not decoded on a gameplay-critical frame."
  //
  // Every clause there is a lifetime requirement rather than a sound-design one,
  // so this is deliberately ONE voice created ONCE. "Not restarting on scene
  // transitions" is the clause that decides the shape: if music were started by
  // whatever screen is showing, every transition would restart it, so nothing
  // outside these three functions may touch it, and start() on an already-running
  // voice is a no-op rather than a restart.
  //
  // The buffer is decoded with the rest of the bank at context creation -- menu
  // time, before any gameplay frame exists -- which is what keeps 1.5's last
  // clause and 1.7 true without a special case.
  let musicVoice = null;

  function musicStart() {
    if (!ctx || !musicBus) return false;
    if (musicVoice) return true; // already playing: NOT a restart
    const buffer = sampleBank?.buffer?.('music');
    if (!buffer) return false; // no synth fallback: silence beats a synthetic drone
    const t0 = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // The recording is already an authored loop, so the seam is the file's own
    // start and end and looping the WHOLE buffer is what keeps it seamless.
    // Trimming edges here — right for the cash run, where the seam is arbitrary —
    // would cut the musical phrase and put a click where there is none.
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + 2.5); // fade in, never a hard entry
    source.connect(gain).connect(musicBus);
    source.start(t0);
    musicVoice = { source, gain, startedAt: t0 };
    return true;
  }

  function musicStop({ fade = 1.2 } = {}) {
    const voice = musicVoice;
    if (!voice || !ctx) return false;
    musicVoice = null;
    const t0 = ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(t0);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t0);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + fade);
      voice.source.stop(t0 + fade + 0.05);
    } catch { /* already gone */ }
    return true;
  }

  const musicActive = () => !!musicVoice;
  const musicElapsed = () => (musicVoice && ctx ? +(ctx.currentTime - musicVoice.startedAt).toFixed(2) : null);

  // 1.2's "settling — the little rattle of a coin against its neighbours". A real
  // recording of coins moving against each other; the synth fallback is the
  // rattle tail that coinDeposit already builds.
  function coinSettle() {
    if (sampled('coinSettle', sfxBus, { gain: 0.8 })) return;
    checkoutNoise({ dur: 0.09, band: 4000, toBand: 2800, q: 1.5, peak: 0.012 });
    checkoutTone({ at: 0.02, freq: 2600, to: 2400, type: 'sine', dur: 0.09, peak: 0.008 });
  }

  // PLAYTEST 5, ITEM 5 — "Coin and cash cues are firing on the wrong clicks.
  // The coin sound should play only when I press a coin; the cash sound only
  // when I click a note. They are crossing over."
  //
  // They were, and the manifest says so in plain English. `changeSelect` holds
  // three recordings:
  //
  //   change-lift-1.ogg  "dollar bills flipping counting.wav"   paper
  //   change-lift-2.ogg  "counting_paper_money"                 paper
  //   change-lift-3.ogg  "Coins.wav by pinchos"                 COINS
  //
  // ...and sampleBank.play picks among a cue's variants AT RANDOM. So pressing a
  // quarter played paper two times in three, and clicking a twenty played the
  // coin recording one time in three. Random is exactly why it reads as
  // "crossing over" rather than as consistently wrong.
  //
  // The gesture keeps its own voice — Playtest 4 was right that lifting change
  // out of a drawer is neither depositing nor picking up off the counter — but
  // the variant is now chosen by what the recording IS. The title travels from
  // the manifest through the bank for this; no file is renamed and nothing is
  // re-encoded.
  function changeSelect(denomination) {
    if (sampled('changeSelect', sfxBus, materialPick(denomination))) return;
    checkoutTone({ freq: 1320, to: 1110, type: 'triangle', dur: 0.052, peak: 0.016 });
    checkoutTone({ at: 0.026, freq: 660, to: 622.25, type: 'sine', dur: 0.07, peak: 0.009 });
  }

  function changeHandoff() {
    checkoutNoise({ dur: 0.12, band: 1550, toBand: 2450, q: 0.7, peak: 0.021, attack: 0.012 });
    checkoutTone({ at: 0.045, freq: 293.66, to: 440, type: 'triangle', dur: 0.15, peak: 0.022 });
  }

  function bagOpen() {
    checkoutNoise({ dur: 0.19, band: 900, toBand: 2700, q: 0.55, peak: 0.031, attack: 0.018 });
    checkoutNoise({ at: 0.09, dur: 0.22, band: 2300, toBand: 1150, q: 0.7, peak: 0.021, attack: 0.025 });
  }

  function bagRustle() {
    if (!checkoutCueAllowed('bagRustle', 0.07)) return;
    checkoutNoise({ dur: 0.115, band: 2100, toBand: 1250, q: 0.65, peak: 0.018, attack: 0.012 });
  }

  function bagItem() {
    checkoutNoise({ dur: 0.16, band: 1050, toBand: 1850, q: 0.6, peak: 0.026, attack: 0.014 });
    checkoutTone({ at: 0.025, freq: 154, to: 103, type: 'triangle', dur: 0.105, peak: 0.024, filter: 620 });
  }

  function bagHandoff() {
    checkoutNoise({ dur: 0.18, band: 820, toBand: 1650, q: 0.55, peak: 0.023, attack: 0.018 });
    checkoutTone({ at: 0.055, freq: 293.66, to: 440, type: 'sine', dur: 0.18, peak: 0.019 });
  }

  // PLAYTEST 5, ITEM 5 — "Add a transaction-complete sound. There is nothing
  // marking the end of a sale."
  //
  // There IS one, and it has been firing: simplifiedRegisterMode calls
  // `sfx('checkoutComplete')` at the end of finalizeTransaction. It was simply
  // inaudible. Measured on the graph, its three tones peaked at 0.032 against
  // the cash drawer's 0.592 in the same checkout -- 18.5x, about 25 dB. A
  // three-note figure that quiet under a till slide that loud is not a cue, it
  // is a rumour.
  //
  // So this is not a new sound; it is the existing one raised to where a person
  // can hear it, at roughly a third of the (now reduced) drawer rather than a
  // eighteenth of the old one. It asks the bank first, like every other cue, so
  // a recording can replace the arpeggio later without touching a call site.
  function checkoutComplete() {
    if (sampled('checkoutComplete', sfxBus)) return;
    for (const [at, freq, peak] of [[0, 587.33, 0.10], [0.095, 739.99, 0.11], [0.19, 880, 0.125]]) {
      checkoutTone({ at, freq, to: freq * 1.006, type: 'sine', dur: 0.29, peak, attack: 0.012 });
    }
  }

  // cloth on glass: two quick filtered-noise strokes falling away
  function wipe() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2400, t0);
    f.frequency.exponentialRampToValueAtTime(900, t0 + 0.32);
    f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.05);
    g.gain.linearRampToValueAtTime(0.012, t0 + 0.16);
    g.gain.linearRampToValueAtTime(0.045, t0 + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    src.connect(f).connect(g).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + 0.4);
  }

  // --- delivery + stocking (the physical retail loop) ------------------------------------------
  // A tiny shared noise-burst helper: a band of filtered noise with an amplitude envelope. Cardboard,
  // tape and paper are all noise at heart — what tells them apart is the band and the shape.
  // Physical repetitions should feel related without becoming identical. Keep
  // variation deliberately narrow so pitch never changes cue identity or level.
  function varied(value, spread = 0.04) {
    const boundedSpread = Math.max(0, Math.min(0.12, Number(spread) || 0));
    if (boundedSpread <= 0) return value;
    return value * (1 + (Math.random() * 2 - 1) * boundedSpread);
  }

  function burst({
    dur = 0.2, delay = 0, band = 1500, q = 1, type = 'bandpass',
    peak = 0.05, attack = 0.02, hp = 0, pitchVariation = 0,
  }) {
    if (!ctx) return null;
    const t0 = ctx.currentTime + Math.max(0, Number(delay) || 0);
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = varied(band, pitchVariation);
    f.Q.value = q;
    let node = src.connect(f);
    if (hp) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; node = node.connect(h); }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur);
    return { t0, g };
  }

  // --- cleaning feedback: stroke accents, spray pulse, completion sparkle -----------------------
  // A stroke reversal (the tool turning around at the end of a pass) gets a short enveloped chirp
  // routed through the EXACT bandpass of that tool's HAND_VOICES loop, so the accent reads as the
  // same tool, not a generic click. Velocity-scaled by the swing speed at the turn; rate-limited so
  // a fast scrub cannot machine-gun. 60–90 ms.
  let lastStrokeAccentAt = -1;
  function strokeAccent(kind, intensity = 0.5) {
    if (!ctx) return;
    if (ctx.currentTime - lastStrokeAccentAt < 0.08) return; // >=80 ms between accents
    lastStrokeAccentAt = ctx.currentTime;
    const v = HAND_VOICES[kind] || HAND_VOICES.divot;
    const vel = Math.min(1.1, Math.max(0.25, Number(intensity) || 0.5)); // spans cluster ~0.7–0.8
    burst({
      dur: 0.06 + Math.random() * 0.03,
      band: v.hz,
      q: Math.max(0.6, v.q),
      peak: 0.03 * vel,
      attack: 0.008,
    });
  }

  // The spray trigger squeeze: one short atomised puff on each pump of the cadence — distinct from
  // the continuous sprayLoop hiss, which stays. Airy (high-passed) so it reads as mist, not a tick.
  function sprayPulse() {
    if (!ctx) return;
    burst({
      dur: 0.12, band: 4200, q: 0.6, peak: 0.03, attack: 0.006, hp: 2200, pitchVariation: 0.05,
    });
  }

  // A cleaning target finished: three rising pentatonic plinks, each a sine with a bright 2.7x
  // partial, fast decay — small and glad, never a fanfare. ~1.2 s with the final note ringing out.
  function cleanSparkle() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const notes = [783.99, 987.77, 1174.66]; // G5 B5 D6 — a rising open triad
    const decays = [0.45, 0.55, 0.9];
    notes.forEach((freq, i) => {
      const at = t0 + i * 0.14;
      const tail = decays[i];
      for (const [mult, peak] of [[1, 0.03], [2.7, 0.011]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(peak, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + tail);
        osc.connect(g).connect(sfxBus);
        osc.start(at);
        osc.stop(at + tail + 0.04);
      }
    });
  }

  // A chunk drawn into the vacuum intake: a short low suck-thup. Consumed (rate-limited) by the
  // vacuum chunk-pop particles. Named for the dormant cleaningTools cue; this is its first synthesis.
  function vacuumPickup() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    burst({ dur: 0.08, band: 520, q: 0.9, peak: 0.02, attack: 0.004 });
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t0);
    osc.frequency.exponentialRampToValueAtTime(84, t0 + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.12);
  }

  // The whole shed finished: the sparkle layered over the fuller completion fanfare, plus a short
  // feedback-delay tail so the top note blooms and settles (~0.8 s). Implemented as discrete
  // decaying echo taps at a fixed 0.15 s delay rather than a live DelayNode+feedback loop, so the
  // cue stays a bounded, self-terminating one-shot (no lingering silent node). Polite (spec 29).
  function restorationComplete() {
    if (!ctx) return;
    cleanSparkle();
    checkoutComplete();
    const t0 = ctx.currentTime;
    for (let n = 1; n <= 5; n++) {
      const peak = 0.018 * (0.62 ** n); // 0.0112, 0.0069, ... -> settles by ~0.8 s
      if (peak < 0.0006) break;
      const at = t0 + n * 0.15;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 1174.66; // D6, the sparkle's top note echoing away
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
      osc.connect(g).connect(sfxBus);
      osc.start(at);
      osc.stop(at + 0.15);
    }
  }

  // The delivery van: one authored approach-length cue. The former 1.7 second
  // burst was fired only after the van had parked, and its "delayed" brake hiss
  // actually started immediately because the noise source was already running.
  // This four-second envelope now follows the visible approach and lands its
  // restrained air-brake release just before the parked beat.
  function truck() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(48, t0);
    osc.frequency.linearRampToValueAtTime(40, t0 + 3.55);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.06, t0 + 0.5);
    g.gain.linearRampToValueAtTime(0.045, t0 + 3.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.15);
    osc.connect(lp).connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 4.2);
    // air brake at the stop
    burst({ dur: 0.4, delay: 3.55, band: 3200, q: 0.7, peak: 0.04, attack: 0.01 });
  }

  // hoisting a carton: a short cardboard scuff
  function boxup() {
    burst({
      dur: 0.16, band: 900, q: 0.8, peak: 0.045, attack: 0.015,
      hp: 300, pitchVariation: 0.045,
    });
  }

  // setting a carton down: a soft, heavier cardboard thud (cardboard, not the register's coin thunk)
  function boxdown() {
    if (!ctx) return;
    const pitch = varied(1, 0.035);
    burst({
      dur: 0.14, band: 700 * pitch, q: 0.7, peak: 0.05, attack: 0.004,
      pitchVariation: 0.02,
    });
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(70 * pitch, t0 + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.14);
  }

  // a cardboard flap folding open: a low crinkle with a soft pop
  function flap() {
    burst({
      dur: 0.18, band: 1200, q: 0.9, peak: 0.04, attack: 0.02,
      hp: 400, pitchVariation: 0.05,
    });
  }

  // === THE THREE PRESSES THAT OPEN A CARTON ===============================================
  //
  // Reported 2026-07-29: "The gesture is good. The sound is thin. Tape tearing, cardboard
  // flexing, flaps folding over, contents shifting when you reach in. Each of the three
  // presses should sound different and mechanical. Pitch-vary so repeats do not grate."
  //
  // Three presses, three sounds, and they are built from different MATERIALS on purpose:
  //
  //   press 1  adhesive stick-slip + the wide flaps swinging up and slapping
  //   press 2  board resonance bending + creases crackling + the flap hitting the wall
  //   press 3  packaging rustle + goods knocking each other + one thing lifting clear
  //
  // Nothing here shares a generator with the press either side of it, so they cannot come out
  // sounding like three volumes of the same noise. Every frequency goes through varied() and
  // every scattered event gets a jittered offset, so two presses of the same button are never
  // the same waveform.

  // Amplitude stick-slip: the reason tape reads as TEARING rather than as a swept hiss. Real
  // adhesive releases in dozens of tiny grabs, and a smooth envelope over noise cannot say
  // that. `steps` ramps across the span at jittered levels.
  function stickSlip(gain, t0, span, level, steps = 9) {
    let t = t0;
    const dt = span / steps;
    for (let i = 0; i < steps; i++) {
      const decay = 1 - (i / steps) * 0.55;                 // the tear runs out of energy
      const grab = level * decay * (0.45 + Math.random() * 0.75);
      gain.gain.linearRampToValueAtTime(Math.max(0.0002, grab), t + dt * 0.4);
      gain.gain.linearRampToValueAtTime(Math.max(0.0002, grab * 0.3), t + dt);
      t += dt;
    }
    return t;
  }

  // A short filtered-noise sweep - the air moving as a panel swings. Distinct from burst()'s
  // fixed band because a flap in motion changes colour as it goes over.
  function airSwing({ delay = 0, dur = 0.14, from = 900, to = 320, peak = 0.02 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(varied(from, 0.06), t0);
    f.frequency.exponentialRampToValueAtTime(varied(to, 0.06), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // A struck cardboard panel: a damped low tone that drops. Cardboard has a real note in it,
  // and leaving it out is most of why the old flap() sounded like paper instead of a box.
  function boardKnock({ delay = 0, from = 150, to = 92, peak = 0.04, dur = 0.16, type = 'triangle' }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const pitch = varied(1, 0.05);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(to * pitch, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  // PRESS ONE - the tape gives, then the two wide flaps come up and slap the sides.
  function boxTapeTear() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 0.34;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const tear = ctx.createBufferSource();
    tear.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    // Bright at the start where the adhesive is fighting, darker as the seam runs.
    f.frequency.setValueAtTime(varied(3600, 0.05), t0);
    f.frequency.exponentialRampToValueAtTime(varied(880, 0.05), t0 + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.034, t0 + 0.012);
    const tearEnd = stickSlip(g, t0 + 0.012, 0.25, 0.034, 10);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(tearEnd + 0.02, t0 + dur));
    tear.connect(f).connect(g).connect(sfxBus);
    tear.start(t0);
    tear.stop(t0 + dur);
    // the carton rocking as the seam parts
    boardKnock({ delay: 0.02, from: 128, to: 74, peak: 0.03, dur: 0.13 });
    // both wide flaps swinging up, a beat apart, then the board slap as they go over
    airSwing({ delay: 0.16 + Math.random() * 0.02, dur: 0.15, from: 1150, to: 380, peak: 0.021 });
    airSwing({ delay: 0.235 + Math.random() * 0.025, dur: 0.14, from: 980, to: 330, peak: 0.017 });
    burst({
      dur: 0.11, delay: 0.30, band: 620, q: 0.6, peak: 0.03, attack: 0.004,
      pitchVariation: 0.055,
    });
    boardKnock({ delay: 0.305, from: 172, to: 104, peak: 0.026, dur: 0.14 });
  }

  // PRESS TWO - no adhesive left. This is the board itself bending, the creases letting go,
  // and the narrow pair folding down against the outside wall.
  function boxFlapFold() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const flexPitch = varied(1, 0.055);
    // the panel FLEXING: a bend, not an impact - slow attack, and it rises before it falls
    const flex = ctx.createOscillator();
    flex.type = 'triangle';
    flex.frequency.setValueAtTime(126 * flexPitch, t0);
    flex.frequency.linearRampToValueAtTime(168 * flexPitch, t0 + 0.09);
    flex.frequency.exponentialRampToValueAtTime(88 * flexPitch, t0 + 0.28);
    // THE FLEX HAS TO GET OUT OF THE WAY. Measured 2026-07-29 (box-open-sound-shape.json):
    // at peak 0.036 running to 0.30 s this oscillator carried the whole cue - 1 attack, RMS
    // more than double either sibling - and the creases and the slap were inaudible under it.
    // It is quieter now and it ENDS at 0.20 s, before the flap lands, so the cue reads as
    // three events rather than one hum with decoration.
    const flexGain = ctx.createGain();
    flexGain.gain.setValueAtTime(0.0001, t0);
    flexGain.gain.linearRampToValueAtTime(0.021, t0 + 0.05);
    flexGain.gain.linearRampToValueAtTime(0.012, t0 + 0.13);
    flexGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    flex.connect(flexGain).connect(sfxBus);
    flex.start(t0);
    flex.stop(t0 + 0.22);
    // creases letting go - three small irregular crackles, never on a grid
    for (let i = 0; i < 3; i++) {
      burst({
        dur: 0.045 + Math.random() * 0.03,
        delay: 0.035 + i * 0.05 + Math.random() * 0.03,
        band: 2300 + i * 700,
        q: 1.5,
        peak: 0.021 + Math.random() * 0.010,
        attack: 0.003,
        hp: 1200,
        pitchVariation: 0.08,
      });
    }
    // and the flap arriving on the side of the box - the loudest thing in the cue, because it
    // is the moment the player is watching
    airSwing({ delay: 0.135, dur: 0.12, from: 860, to: 300, peak: 0.020 });
    burst({
      dur: 0.14, delay: 0.255, band: 500, q: 0.55, peak: 0.046, attack: 0.004,
      pitchVariation: 0.05,
    });
    boardKnock({ delay: 0.257, from: 158, to: 96, peak: 0.042, dur: 0.18 });
  }

  // PRESS THREE - a hand goes in. Packaging slides, the goods knock each other as the stack
  // is disturbed, and one of them comes clear.
  function boxContentsShift() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // the reach: polybag and tissue against a hand, two bands so it is not one hiss
    burst({
      dur: 0.19, band: 3300, q: 0.7, peak: 0.024, attack: 0.03, hp: 1500,
      pitchVariation: 0.06,
    });
    burst({
      dur: 0.22, delay: 0.05, band: 1900, q: 0.85, peak: 0.019, attack: 0.035, hp: 800,
      pitchVariation: 0.06,
    });
    // the stack settling: small knocks at scattered times, levels and pitches - this is the
    // part that says "there are OBJECTS in there"
    const knocks = 3 + (Math.random() < 0.5 ? 0 : 1);
    for (let i = 0; i < knocks; i++) {
      const delay = 0.06 + i * 0.052 + Math.random() * 0.045;
      boardKnock({
        delay,
        from: 210 + Math.random() * 160,
        to: 118 + Math.random() * 60,
        peak: 0.014 + Math.random() * 0.013,
        dur: 0.06 + Math.random() * 0.04,
      });
      burst({
        dur: 0.05, delay: delay + 0.004, band: 1400 + Math.random() * 1300, q: 1.2,
        peak: 0.009 + Math.random() * 0.007, attack: 0.003, hp: 700, pitchVariation: 0.07,
      });
    }
    // ...and the unit lifting clear of the others
    const lift = ctx.createOscillator();
    const liftPitch = varied(1, 0.05);
    lift.type = 'triangle';
    lift.frequency.setValueAtTime(255 * liftPitch, t0 + 0.24);
    lift.frequency.exponentialRampToValueAtTime(152 * liftPitch, t0 + 0.35);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0.0001, t0 + 0.24);
    lg.gain.linearRampToValueAtTime(0.024, t0 + 0.262);
    lg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.37);
    lift.connect(lg).connect(sfxBus);
    lift.start(t0 + 0.24);
    lift.stop(t0 + 0.39);
  }

  // taking or handling product: a light paper rustle
  function product() {
    burst({
      dur: 0.13, band: 2600, q: 0.8, peak: 0.03, attack: 0.02,
      hp: 900, pitchVariation: 0.045,
    });
  }

  // Removing a unit/armful has packaging rustle plus a small supported-body
  // release. Callers need not stack the generic product cue on top of it.
  function itemRemoval() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitch = varied(1, 0.045);
    burst({
      dur: 0.16, band: 2350, q: 0.75, peak: 0.027, attack: 0.016,
      hp: 780, pitchVariation: 0.05,
    });
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(230 * pitch, t0 + 0.025);
    body.frequency.exponentialRampToValueAtTime(145 * pitch, t0 + 0.105);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.02);
    g.gain.linearRampToValueAtTime(0.026, t0 + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    body.connect(g).connect(sfxBus);
    body.start(t0 + 0.02);
    body.stop(t0 + 0.13);
  }

  // placing an item on a fixture: a soft, clean tap
  function stock() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitch = varied(1, 0.04);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(200 * pitch, t0 + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }

  // the shelf is full: a small, satisfied two-note confirm (distinct from the order chime)
  function fullShelf() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [i, freq] of [[0, 587], [1, 880]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const at = t0 + i * 0.08;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.05, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      osc.connect(g).connect(sfxBus);
      osc.start(at);
      osc.stop(at + 0.16);
    }
  }

  // Folding spans the visible animation: three restrained crease beats move
  // from broad cardboard body to the tighter final fold.
  function boxFlatten() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    burst({
      dur: 0.24, band: 760, q: 0.62, peak: 0.042, attack: 0.018,
      pitchVariation: 0.055,
    });
    burst({
      dur: 0.23, delay: 0.18, band: 1120, q: 0.7, peak: 0.036, attack: 0.014,
      hp: 320, pitchVariation: 0.055,
    });
    burst({
      dur: 0.21, delay: 0.40, band: 1680, q: 0.78, peak: 0.027, attack: 0.012,
      hp: 520, pitchVariation: 0.06,
    });
    const body = ctx.createOscillator();
    const pitch = varied(1, 0.035);
    body.type = 'sine';
    body.frequency.setValueAtTime(105 * pitch, t0);
    body.frequency.exponentialRampToValueAtTime(58 * pitch, t0 + 0.58);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.035, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.62);
    body.connect(g).connect(sfxBus);
    body.start(t0);
    body.stop(t0 + 0.64);
  }

  // The actual sink/drop owns disposal: short bin/body impact followed by a
  // separate cardboard settle. It is deliberately unlike the longer fold.
  function disposal() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitch = varied(1, 0.04);
    burst({
      dur: 0.18, band: 610, q: 0.65, peak: 0.046, attack: 0.004,
      pitchVariation: 0.045,
    });
    burst({
      dur: 0.22, delay: 0.065, band: 1850, q: 0.72, peak: 0.024, attack: 0.025,
      hp: 520, pitchVariation: 0.055,
    });
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(118 * pitch, t0);
    body.frequency.exponentialRampToValueAtTime(62 * pitch, t0 + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.055, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    body.connect(g).connect(sfxBus);
    body.start(t0);
    body.stop(t0 + 0.22);
  }

  // the laptop lid easing open: soft felt-hinge rise + a settle tick
  function laptopOpen() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t0);
    osc.frequency.linearRampToValueAtTime(340, t0 + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.028, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.36);
    const tick = ctx.createOscillator();
    tick.type = 'square';
    tick.frequency.value = 900;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.02, t0 + 0.3);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.345);
    tick.connect(tg).connect(sfxBus);
    tick.start(t0 + 0.3);
    tick.stop(t0 + 0.36);
  }

  // the machine waking: a small two-note rise, quiet and clean
  function laptopBoot() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [i, freq] of [[0, 523], [1, 784]].values()) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const at = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.03, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(g).connect(sfxBus);
      osc.start(at);
      osc.stop(at + 0.32);
    }
  }

  // Everything worked BY HAND is the same synthesis — noise through a bandpass, gated by an LFO so
  // it pulses at the rhythm of the stroke — and differs only in where it sits and how fast it moves.
  // A mop is low, wet and slow; a broom is bright, dry and quick; a spray is a thin atomised hiss; a
  // bag is loose crackle. Hoisted to makeAudio scope (was local to ensureToolLoop) so strokeAccent()
  // can route its chirp through the EXACT same per-tool bandpass and the accent belongs to the tool.
  const HAND_VOICES = {
    divot: { hz: 520, q: 1.1, rate: 3.1, depth: 0.50 },
    rake: { hz: 950, q: 1.1, rate: 2.3, depth: 0.50 },
    mop: { hz: 700, q: 0.75, rate: 1.5, depth: 0.55 }, // wet swish, long strokes
    broom: { hz: 1500, q: 1.3, rate: 2.6, depth: 0.60 }, // dry bristle on board
    dustpan: { hz: 1150, q: 1.2, rate: 2.6, depth: 0.45 }, // short scrapes, calmer rattle (was q1.5/rate4.2)
    spray: { hz: 4300, q: 0.5, rate: 0.0, depth: 0.00 }, // steady atomised hiss
    cloth: { hz: 620, q: 0.7, rate: 2.0, depth: 0.60 }, // muffled, soft — a slow ~2 Hz wipe rhythm
    sponge: { hz: 1850, q: 1.2, rate: 3.4, depth: 0.55 }, // squeak of a scourer
    trashbag: { hz: 2600, q: 0.9, rate: 5.5, depth: 0.65 }, // loose polythene crackle
  };

  // continuous in-use loops, one per tool, crossfaded by setToolLoop(kind|null)
  const toolLoops = {}; // kind -> gain node
  const toolLoopOsc = {}; // kind -> a driven oscillator (vacuum motor hum) setToolLoop can swell
  const toolLoopVoice = {}; // kind -> { lfo, baseRate } for intensity-ridden hand loops
  let activeToolLoop = null;
  function ensureToolLoop(kind) {
    if (!ctx || toolLoops[kind]) return toolLoops[kind];
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    if (kind === 'hose') {
      filter.type = 'bandpass';
      filter.frequency.value = 1500;
      filter.Q.value = 0.8;
      src.connect(filter).connect(gain);
    } else if (kind === 'mower') {
      // the player's own machine, up close: detuned saws + engine-bay noise
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      src.connect(filter).connect(gain);
      for (const f of [88, 91.5]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 380;
        osc.connect(lp).connect(gain);
        osc.start();
      }
    } else if (kind === 'cart') {
      // Electric golf-cart motor: a restrained harmonic whirr with a little
      // filtered tyre/gear noise. It must never borrow the petrol mower voice.
      filter.type = 'bandpass';
      filter.frequency.value = 980;
      filter.Q.value = 0.72;
      const road = ctx.createGain();
      road.gain.value = 0.22;
      src.connect(filter).connect(road).connect(gain);
      for (const [frequency, level] of [[186, 0.22], [372, 0.10]]) {
        const motor = ctx.createOscillator();
        motor.type = 'sine';
        motor.frequency.value = frequency;
        const motorGain = ctx.createGain();
        motorGain.gain.value = level;
        motor.connect(motorGain).connect(gain);
        motor.start();
      }
    } else if (kind === 'washer') {
      // a hard, narrow jet hissing off a wall, over the throb of the pump
      filter.type = 'bandpass';
      filter.frequency.value = 3200;
      filter.Q.value = 0.55;
      src.connect(filter).connect(gain);
      const pump = ctx.createOscillator();
      pump.type = 'square';
      pump.frequency.value = 46;
      const pg = ctx.createGain();
      pg.gain.value = 0.12;
      const plp = ctx.createBiquadFilter();
      plp.type = 'lowpass';
      plp.frequency.value = 220;
      pump.connect(plp).connect(pg).connect(gain);
      pump.start();
    } else if (kind === 'soap') {
      // foam, not water: soft, breathy, low pressure
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.4;
      const soft = ctx.createGain();
      soft.gain.value = 0.45;
      src.connect(filter).connect(soft).connect(gain);
    } else if (kind === 'vacuum') {
      filter.type = 'lowpass';
      filter.frequency.value = 340;
      src.connect(filter).connect(gain);
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth';
      hum.frequency.value = 72;
      const humLp = ctx.createBiquadFilter();
      humLp.type = 'lowpass';
      humLp.frequency.value = 240;
      hum.connect(humLp).connect(gain);
      hum.start();
      toolLoopOsc.vacuum = hum; // setToolLoop swells this ~9% on activation, coasts down on release
    } else {
      // Everything worked BY HAND shares the hoisted HAND_VOICES table (see makeAudio scope):
      // noise through a per-tool bandpass, gated by an LFO so it pulses at the rhythm of the stroke.
      const v = HAND_VOICES[kind] || HAND_VOICES.divot;
      filter.type = 'bandpass';
      filter.frequency.value = v.hz;
      filter.Q.value = v.q;
      if (v.rate <= 0) {
        // no pulse: a trigger held down is a continuous sound, not a rhythm
        src.connect(filter).connect(gain);
      } else {
        const pulse = ctx.createGain();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = v.rate;
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = v.depth;
        lfo.connect(lfoDepth).connect(pulse.gain);
        pulse.gain.value = 1 - v.depth * 0.5;
        src.connect(filter).connect(pulse).connect(gain);
        lfo.start();
        // Phase 6: keep handles on the pulse LFO and the bandpass so stroke
        // intensity can ride the loop's rhythm and the SURFACE can shift its
        // brightness (bright bristle on boards, a dull drag on carpet).
        toolLoopVoice[kind] = { lfo, baseRate: v.rate, filter, baseHz: v.hz };
      }
      if (kind === 'mop') {
        // A second, low-passed tap of the same noise gives the wet mop its weight — the heavy
        // slop under the bright swish. Parallel path into the same loop gain, ~400 Hz.
        const wet = ctx.createBiquadFilter();
        wet.type = 'lowpass';
        wet.frequency.value = 400;
        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.5;
        src.connect(wet).connect(wetGain).connect(gain);
      }
    }
    gain.connect(sfxBus);
    src.start();
    toolLoops[kind] = gain;
    return gain;
  }

  const TOOL_LOOP_LEVEL = {
    hose: 0.045, vacuum: 0.06, divot: 0.05, rake: 0.05, mower: 0.055, cart: 0.032,
    washer: 0.075, soap: 0.03, // the washer is loud; foam is not
    // The hand tools are quiet work. A broom you are pushing yourself should not be as loud as a
    // petrol pump, and a cloth should be barely there — this is the difference between a kit that
    // sounds busy and one that sounds shrill after ten minutes.
    mop: 0.034, broom: 0.040, dustpan: 0.030,
    spray: 0.026, cloth: 0.026, sponge: 0.028, trashbag: 0.030, // cloth 0.018->0.026: the wipe was too faint
  };
  const VACUUM_HUM_HZ = 72;
  function setToolLoop(kind) {
    if (!ctx) return;
    // Box cutting is progress-driven one-shot audio. Treat it (and every
    // unknown future tool) as silence here rather than manufacturing the
    // divot/rake fallback loop while LMB is merely held stationary.
    const activeKind = kind && Object.hasOwn(TOOL_LOOP_LEVEL, kind) ? kind : null;
    const previousKind = activeToolLoop;
    activeToolLoop = activeKind;
    if (activeKind) ensureToolLoop(activeKind);
    for (const [k, g] of Object.entries(toolLoops)) {
      const level = k === activeKind ? TOOL_LOOP_LEVEL[k] : 0;
      g.gain.setTargetAtTime(level, ctx.currentTime, 0.06);
    }
    // The vacuum motor spins UP ~9% as it engages and coasts back down on release.
    // Edge-triggered off activeToolLoop, so a per-frame setToolLoop('vacuum') never re-triggers it.
    if (activeKind !== previousKind && toolLoopOsc.vacuum) {
      if (activeKind === 'vacuum') {
        toolLoopOsc.vacuum.frequency.setTargetAtTime(VACUUM_HUM_HZ * 1.09, ctx.currentTime, 0.08);
      } else if (previousKind === 'vacuum') {
        toolLoopOsc.vacuum.frequency.setTargetAtTime(VACUUM_HUM_HZ, ctx.currentTime, 0.25);
      }
    }
  }

  // Phase 6 — the broom's three audio layers. The loop (HAND_VOICES.broom via
  // setToolLoop) is the middle layer; these add the start transient as the
  // bristles first bite, per-frame intensity riding the loop's gain and pulse
  // rate, and a soft release tail as they lift. All numbers from
  // BROOM_FEEL.audio — the one tuning file.
  function setToolLoopIntensity(kind, intensity, surface = null) {
    if (!ctx || activeToolLoop !== kind || !toolLoops[kind]) return;
    const a = BROOM_FEEL.audio;
    const surf = (surface && a.surface && a.surface[surface]) || null;
    const level = (TOOL_LOOP_LEVEL[kind] || 0.04) * (surf ? surf.gainScale : 1);
    const i = Math.max(0, Math.min(1, Number(intensity) || 0));
    toolLoops[kind].gain.setTargetAtTime(level * (1 + a.loopGainSlope * i), ctx.currentTime, 0.08);
    const voice = toolLoopVoice[kind];
    if (voice) {
      voice.lfo.frequency.setTargetAtTime(
        a.loopRateBase + a.loopRateSlope * i, ctx.currentTime, 0.10,
      );
      voice.filter.frequency.setTargetAtTime(
        surf ? surf.hz : voice.baseHz, ctx.currentTime, 0.12,
      );
    }
  }

  // E3 — THE OTHER EIGHT TOOLS GET A CONTACT LAYER.
  //
  // Every tool declares audio.start and audio.stop; 26 of the 27 declared names
  // did not exist, so only the broom made a sound when it bit and when it lifted.
  // The rest played one flat loop from button-down to button-up, which is why
  // the kit sounded like one machine with the pitch changed.
  //
  // One renderer, driven by the SHAPE each tool declares (cleaningTools.js
  // `tone`), rather than eight hand-written functions — the same reason
  // `useMotion` is data. The broom is untouched: it has its own authored pair
  // below and it is the standard the rest are being brought up to.
  function shapedBurst(hz, q, gain, seconds) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hz;
    band.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(band).connect(g).connect(sfxBus);
    src.start(t);
    src.stop(t + seconds + 0.01);
  }

  function toolContactStart(kind) {
    const tone = CLEANING_TOOLS[kind]?.tone;
    if (!ctx || !tone) return;
    shapedBurst(tone.startHz, tone.q, tone.startGain, 0.10);
  }

  function toolContactStop(kind) {
    const tone = CLEANING_TOOLS[kind]?.tone;
    if (!ctx || !tone) return;
    shapedBurst(tone.stopHz, tone.q * 0.8, tone.startGain * 0.55, tone.stopTail);
  }

  function broomStart() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // the first bite: a short, bright scratch of noise through the broom band
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.10), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let s = 0; s < data.length; s++) data[s] = (Math.random() * 2 - 1) * (1 - s / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1700;
    band.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(BROOM_FEEL.audio.startGain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(band).connect(gain).connect(sfxBus);
    src.start(t);
    src.stop(t + 0.10);
  }

  function broomStop() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // the lift: a softer, darker brush fading over the configured tail
    const tail = BROOM_FEEL.audio.stopTail;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * tail), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let s = 0; s < data.length; s++) data[s] = (Math.random() * 2 - 1) * (1 - s / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1100;
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(BROOM_FEEL.audio.startGain * 0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tail);
    src.connect(band).connect(gain).connect(sfxBus);
    src.start(t);
    src.stop(t + tail + 0.02);
  }

  // The last context `update` was driven with, and the ambient gains that came
  // out of it. 1.6 asks for the SOURCE of a drone, and a probe that reasons from
  // the clock to the gate to the gain is three inferences away from the node the
  // player actually hears -- this reports the node.
  let lastAmbient = null;

  // called ~once per second with live game context
  function update(dt, { minuteOfDay = 720, rainIn = 0, golfersVisible = 0, inShop = false, tempHiF = 70 } = {}) {
    if (!ctx || paused || !lifecycleActive) return;
    const day = minuteOfDay >= 350 && minuteOfDay <= 1220;

    if (rainGain) rainGain.gain.setTargetAtTime(Math.min(0.35, rainIn * 0.4) * (inShop ? 0.35 : 1), ctx.currentTime, 0.6);

    // 1.6 — THE MOWER-LIKE STATIC ON LOAD.
    //
    // This was two detuned sawtooths at 92 and 95.5 Hz held open for the whole
    // 5-7 AM window. The game starts at 6 AM (Phase 9.3 of this brief says so
    // about the lighting), so on every new game outdoors the first thing the
    // player heard was a two-hour unbroken drone at mower pitch -- which is
    // exactly the report, and 1.5 names "mower timbre" as the thing background
    // audio must never be.
    //
    // A real mower is not a drone; it is a machine that passes. So the gate now
    // opens for SHORT PASSES separated by long gaps, and the first pass cannot
    // begin until the player has been outdoors a while -- nothing sustained
    // starts on the load frame. The window itself is unchanged: mowing still
    // happens on the early shift, and it is still not audible indoors.
    const inMowWindow = !inShop && minuteOfDay >= 300 && minuteOfDay <= 420;
    if (!inMowWindow) {
      mowerPassTimer = 0;
      mowerPassUntil = 0;
      mowerSettleIn = MOWER_SETTLE_SECONDS;
    } else if (mowerSettleIn > 0) {
      mowerSettleIn = Math.max(0, mowerSettleIn - dt);
    } else {
      mowerPassTimer -= dt;
      if (mowerPassTimer <= 0) {
        // a pass every 40-90 s, lasting 7-13 s: audible as a machine working
        // somewhere on the course rather than as a tone sitting on the mix
        mowerPassTimer = 40 + Math.random() * 50;
        mowerPassUntil = ctx.currentTime + 7 + Math.random() * 6;
      }
    }
    const mowerOn = inMowWindow && mowerPassUntil > ctx.currentTime;
    if (mowerGain) mowerGain.gain.setTargetAtTime(mowerOn ? 0.05 : 0, ctx.currentTime, 1.2);
    lastAmbient = {
      minuteOfDay, inShop, rainIn, inMowWindow, mowerOn,
      mowerGain: mowerGain ? +mowerGain.gain.value.toFixed(5) : null,
      rainGain: rainGain ? +rainGain.gain.value.toFixed(5) : null,
      mowerSettleIn: +mowerSettleIn.toFixed(2),
    };

    birdTimer -= dt;
    if (birdTimer <= 0) {
      birdTimer = 2.5 + Math.random() * 7;
      const springy = tempHiF > 45 && rainIn < 0.4;
      if (day && springy && !inShop) chirp();
    }

  }

  return {
    init,
    update,
    // Pinehollow checkout's semantic one-shot API. Legacy aliases below remain
    // available to existing callers until phase-B integration is complete.
    productPlace,
    productPickup,
    productRotate,
    scannerActivate,
    scanSuccess: scanBeep,
    scanInvalid,
    posAdd,
    cardMove,
    cardSwipe,
    cardInsert,
    cardProcessing,
    cardApproved: approve,
    cardDeclined: decline,
    cashPresent,
    notesDown,
    coinsDown,
    cardOut,
    billHandle,
    coinHandle: coin,
    billDeposit,
    coinDeposit,
    drawerUnlock,
    drawerOpen: drawer,
    drawerClose,
    // 1.2's continuous run. Three verbs rather than one cue name because the
    // caller owns the lifetime: the register starts it when the first piece
    // leaves the hand, stops it when the last one lands, and every interruption
    // path calls stop. `cashRunActive` exists so a probe can ask whether the
    // voice is up rather than inferring it from a node count.
    cashRunStart,
    // ITEM 2: the drawer's ordered voice, and the length query it needs
    drawerOpenSequence,
    cueSeconds,
    cashPickup,
    cashRunStop,
    cashRunActive,
    coinSettle,
    musicStart,
    musicStop,
    musicActive,
    musicElapsed,
    // QA handles. A gate that cannot reach the live context has to build a second
    // one, and two contexts measure two different signals — which is how an audio
    // check ends up certifying a graph the player never hears.
    qaContext: () => ctx,
    qaSampleBankDiagnostics: () => (sampleBank?.diagnostics ? sampleBank.diagnostics() : null),

    // PLAYTEST 3, ITEM 1 — THE AUDITION SWITCHER, from the settings panel's side.
    //
    // The panel must not reach into the bank directly: the bank is created lazily
    // when the context unlocks, so a panel holding a reference from construction
    // would be holding null on every fresh boot. These three go through the live
    // binding each call.
    sfxFamilies: () => (sampleBank?.families ? sampleBank.families() : []),
    sfxSetFamilyOption: (family, optionId) => (
      sampleBank?.setFamilyOption ? sampleBank.setFamilyOption(family, optionId) : false
    ),
    /**
     * Play one option ONCE so the owner can hear it, without pinning it.
     *
     * Auditioning has to be audible on the spot -- a picker you have to close,
     * go and click a button, and come back to is one nobody uses past the third
     * comparison. So the pin is applied, the cue fired, and the pin put back,
     * all inside the call. It routes through the ordinary sfx bus, which means
     * what is heard here is what will be heard in the game, at the same level.
     */
    sfxPreview: (family, optionId, cue) => {
      if (!sampleBank || !ctx) return false;
      const was = sampleBank.familyOption(family);
      if (!sampleBank.setFamilyOption(family, optionId)) return false;
      try {
        // minGapSec 0: an audition is deliberate repetition, and the retrigger
        // guard exists to stop a handful of coins machine-gunning one file --
        // applying it here would silently swallow the second press of Preview.
        return sampleBank.play(cue, { ctx, destination: sfxBus, minGapSec: 0 });
      } finally {
        // Restored even when play throws: an audition that leaves the family
        // pinned to whatever was last hovered would silently change the game.
        sampleBank.setFamilyOption(family, was);
      }
    },
    // The ambient gains as they actually stand, plus the inputs that set them.
    // Reading the node closes the gap between "the gate should be shut" and "the
    // player hears nothing".
    qaAmbient: () => (lastAmbient ? { ...lastAmbient } : null),
    changeSelect,
    changeHandoff,
    receiptPrint: receipt,
    receiptTear,
    bagOpen,
    bagRustle,
    bagItem,
    bagHandoff,
    checkoutComplete,
    doorbell,
    phoneRing,
    uiTick,
    uiConfirm,
    uiCancel,
    uiError,
    // E (Full_Goal_16): the walking body and the rooms it works in
    qaMasterTap,
    footstep,
    stationEnter,
    stationLeave,
    signFlip,
    ledgerOpen,
    ledgerTurn,
    ledgerClose,
    keypadTap,
    doorSwing,
    doorShut,
    scanBeep,
    cardTap,
    approve,
    decline,
    paper,
    coin,
    receipt,
    drawer,
    wipe,
    laptopOpen,
    laptopBoot,
    equipTick,
    lightSwitch,
    fixtureAdjust,
    chime,
    thunk,
    // Cleaning feedback one-shots. strokeAccent/sprayPulse are driven from the
    // Task-4 stroke/spray hooks (main.js routes them via the generic audio[name]
    // pattern); cleanSparkle/vacuumPickup are fired by cue mappings and particles.
    strokeAccent,
    toolContactStart,
    toolContactStop,
    sprayPulse,
    cleanSparkle,
    vacuumPickup,
    // Semantic restoration events reuse restrained, already-authored sounds:
    // a positive task chime, the physical wall-switch snap, and the fuller
    // completion motif. Quoted keys are required by the dynamic hook boundary.
    'clubhouse-cleanup-complete': chime,
    'clubhouse-light-repaired': lightSwitch,
    'clubhouse-component-repaired': fixtureAdjust,
    'clubhouse-paint-applied': chime,
    // Each finished shed target sparkles; the whole-shed finish lands the fuller
    // completion beat (sparkle + fanfare + a short feedback-delay tail).
    'shed-target-complete': cleanSparkle,
    'clubhouse-restoration-complete': restorationComplete,
    ballStrike,
    ballLanding,
    starterCall,
    setToolLoop,
    setToolLoopIntensity,
    broomStart,
    broomStop,
    toolLoopDiagnostics: () => ({
      active: activeToolLoop,
      created: Object.keys(toolLoops).sort(),
      levels: Object.fromEntries(Object.entries(toolLoops).map(([kind, gain]) => [kind, gain.gain.value])),
    }),
    startCapture,
    stopCapture,
    get captureActive() {
      return !!capture;
    },
    applyPreferences: applyVolume,
    setPaused(value) {
      paused = !!value;
      if (paused) setToolLoop(null);
      applyVolume();
    },
    async setLifecycleActive(value) {
      lifecycleActive = !!value;
      if (!ctx) return;
      if (!lifecycleActive) {
        setToolLoop(null);
        if (ctx.state === 'running') await ctx.suspend().catch(() => {});
      } else if (!paused && ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
    },
    // the delivery-to-shelf loop. `recycle` is a compatibility alias while
    // production call sites move to the semantic name.
    truck, boxup, boxdown,
    flap, product, itemRemoval, stock, fullShelf, boxFlatten, disposal,
    // the three presses that open a carton - one sound each, built from different materials
    boxTapeTear, boxFlapFold, boxContentsShift,
    recycle: disposal,
    get ready() {
      return !!ctx;
    },
    getVolume: () => settings().master,
    isMuted: () => settings().muted,
    setVolume(v) {
      if (preferences) preferences.set('audio.master', v);
      else fallback.master = v;
      applyVolume();
    },
    setMuted(m) {
      if (preferences) preferences.set('audio.muted', m);
      else fallback.muted = m;
      applyVolume();
    },
    debugStats: () => ({
      initialized: !!ctx,
      contextState: ctx?.state || 'uninitialized',
      paused,
      lifecycleActive,
      activeToolLoop,
      createdToolLoops: Object.keys(toolLoops),
      createdToolLoopCount: Object.keys(toolLoops).length,
    }),
  };
}
