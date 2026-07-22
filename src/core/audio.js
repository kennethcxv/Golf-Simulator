// FAIRWAY STATE — original procedural WebAudio sound design. Pinehollow checkout
// uses dry walnut taps, restrained paper/metal textures, and a warm D/A tonal motif
// so physical actions remain legible without arcade volume. Shared player
// preferences own volume, accessibility, and lifecycle policy.

export const CHECKOUT_CUE_APIS = Object.freeze([
  'productPlace', 'productPickup', 'productRotate',
  'scannerActivate', 'scanSuccess', 'scanInvalid', 'posAdd',
  'cardMove', 'cardSwipe', 'cardInsert', 'cardProcessing', 'cardApproved', 'cardDeclined',
  'cashPresent', 'billHandle', 'coinHandle',
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
  'cutterExtend', 'bladeContact', 'tapeCut', 'tapeRelease',
  'flap', 'product', 'itemRemoval',
  'stock', 'fullShelf', 'boxFlatten', 'disposal',
]);

export function makeAudio(preferences = null) {
  let ctx = null;
  let master = null;
  let ambientBus = null;
  let sfxBus = null;
  let capture = null;
  let uiBus = null;
  let paused = false;
  let lifecycleActive = true;

  let rainGain = null;
  let mowerGain = null;
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
    master = ctx.createGain();
    master.connect(ctx.destination);
    ambientBus = ctx.createGain();
    ambientBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    uiBus = ctx.createGain();
    uiBus.connect(master);
    applyVolume();

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

  function uiTick() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    osc.connect(g).connect(uiBus);
    osc.start(t0);
    osc.stop(t0 + 0.06);
  }

  function uiConfirm() {
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

  function uiError() {
    if (!ctx) return;
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
    g.gain.setValueAtTime(0.06, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.1);
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

  // the cash drawer: rolling slide, hard stop, and the till bell
  function drawer() {
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

  function billHandle() {
    checkoutNoise({ dur: 0.135, band: 1150, toBand: 2150, q: 0.6, peak: 0.031, attack: 0.01 });
    checkoutTone({ at: 0.025, freq: 220, to: 196, type: 'triangle', dur: 0.075, peak: 0.009, filter: 650 });
  }

  function drawerUnlock() {
    checkoutTone({ freq: 980, to: 620, type: 'square', dur: 0.045, peak: 0.017, filter: 1800 });
    checkoutTone({ at: 0.024, freq: 142, to: 88, type: 'triangle', dur: 0.085, peak: 0.026, filter: 650 });
  }

  function drawerClose() {
    checkoutNoise({ dur: 0.18, band: 720, toBand: 390, q: 0.55, peak: 0.027, attack: 0.008 });
    checkoutTone({ at: 0.045, freq: 120, to: 64, type: 'triangle', dur: 0.14, peak: 0.035, filter: 520 });
    checkoutTone({ at: 0.15, freq: 920, to: 610, type: 'square', dur: 0.042, peak: 0.015, filter: 1500 });
  }

  function changeSelect() {
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

  function checkoutComplete() {
    for (const [at, freq, peak] of [[0, 587.33, 0.026], [0.095, 739.99, 0.028], [0.19, 880, 0.032]]) {
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

  // Slider/stop detent as the authored blade visibly extends from its channel.
  function cutterExtend() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitch = varied(1, 0.035);
    burst({
      dur: 0.11, band: 2250, q: 1.1, peak: 0.016, attack: 0.008,
      hp: 850, pitchVariation: 0.04,
    });
    const detent = ctx.createOscillator();
    detent.type = 'triangle';
    detent.frequency.setValueAtTime(980 * pitch, t0 + 0.045);
    detent.frequency.exponentialRampToValueAtTime(620 * pitch, t0 + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.04);
    g.gain.linearRampToValueAtTime(0.022, t0 + 0.052);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.105);
    detent.connect(g).connect(sfxBus);
    detent.start(t0 + 0.04);
    detent.stop(t0 + 0.11);
  }

  // The first restrained metal/tape tick occurs only when the animated blade
  // actually reaches the authored cut path; courseScene supplies the edge.
  function bladeContact() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitch = varied(1, 0.05);
    burst({
      dur: 0.052, band: 4700, q: 1.3, peak: 0.016, attack: 0.002,
      hp: 2400, pitchVariation: 0.055,
    });
    const tick = ctx.createOscillator();
    tick.type = 'sine';
    tick.frequency.setValueAtTime(2200 * pitch, t0);
    tick.frequency.exponentialRampToValueAtTime(1550 * pitch, t0 + 0.035);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.011, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.042);
    tick.connect(g).connect(sfxBus);
    tick.start(t0);
    tick.stop(t0 + 0.045);
  }

  // The blade down the seam: a short bright zip. The carton interaction emits
  // it only on real progress beats, so stationary LMB produces no fake scrape.
  function tapeCut() {
    const b = burst({
      dur: 0.09, band: 3600, q: 1.2, peak: 0.028, attack: 0.004,
      hp: 1500, pitchVariation: 0.06,
    });
    if (b) b.g.gain.exponentialRampToValueAtTime(0.0001, b.t0 + 0.09);
  }

  // Completion is a peel/release, not one more cutting zip. A descending noise
  // colour and delayed soft snap make it readable without an arcade flourish.
  function tapeRelease() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 0.24;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const peel = ctx.createBufferSource();
    peel.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.85;
    f.frequency.setValueAtTime(varied(3100, 0.045), t0);
    f.frequency.exponentialRampToValueAtTime(varied(1150, 0.045), t0 + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.032, t0 + 0.018);
    g.gain.linearRampToValueAtTime(0.018, t0 + 0.11);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    peel.connect(f).connect(g).connect(sfxBus);
    peel.start(t0);
    peel.stop(t0 + dur);
    burst({
      dur: 0.075, delay: 0.07, band: 760, q: 0.8, peak: 0.018,
      attack: 0.003, pitchVariation: 0.045,
    });
  }

  // a cardboard flap folding open: a low crinkle with a soft pop
  function flap() {
    burst({
      dur: 0.18, band: 1200, q: 0.9, peak: 0.04, attack: 0.02,
      hp: 400, pitchVariation: 0.05,
    });
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

  // continuous in-use loops, one per tool, crossfaded by setToolLoop(kind|null)
  const toolLoops = {}; // kind -> gain node
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
    } else if (kind === 'electricCart') {
      // Quiet electric transaxle: restrained gear/tyre noise, distinct from
      // the petrol tractor and soft enough for repeated course traversal.
      filter.type = 'lowpass';
      filter.frequency.value = 760;
      const tyre = ctx.createGain();
      tyre.gain.value = 0.30;
      src.connect(filter).connect(tyre).connect(gain);
      for (const [frequency, level] of [[132, 0.13], [264, 0.035]]) {
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
    } else {
      // Everything worked BY HAND is the same synthesis — noise through a bandpass, gated by an
      // LFO so it pulses at the rhythm of the stroke — and differs only in where it sits and how
      // fast it moves. A mop is low, wet and slow; a broom is bright, dry and quick; a spray is a
      // thin atomised hiss; a bag is loose crackle. One table beats eight near-identical branches.
      const HAND_VOICES = {
        divot: { hz: 520, q: 1.1, rate: 3.1, depth: 0.50 },
        rake: { hz: 950, q: 1.1, rate: 2.3, depth: 0.50 },
        mop: { hz: 700, q: 0.75, rate: 1.5, depth: 0.55 }, // wet swish, long strokes
        broom: { hz: 1500, q: 1.3, rate: 2.6, depth: 0.60 }, // dry bristle on board
        dustpan: { hz: 1150, q: 1.5, rate: 4.2, depth: 0.45 }, // short scrapes and rattle
        spray: { hz: 4300, q: 0.5, rate: 0.0, depth: 0.00 }, // steady atomised hiss
        cloth: { hz: 620, q: 0.7, rate: 2.0, depth: 0.50 }, // muffled, soft
        sponge: { hz: 1850, q: 1.2, rate: 3.4, depth: 0.55 }, // squeak of a scourer
        trashbag: { hz: 2600, q: 0.9, rate: 5.5, depth: 0.65 }, // loose polythene crackle
      };
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
      }
    }
    gain.connect(sfxBus);
    src.start();
    toolLoops[kind] = gain;
    return gain;
  }

  const TOOL_LOOP_LEVEL = {
    hose: 0.045, vacuum: 0.06, divot: 0.05, rake: 0.05, mower: 0.055, electricCart: 0.036,
    washer: 0.075, soap: 0.03, // the washer is loud; foam is not
    // The hand tools are quiet work. A broom you are pushing yourself should not be as loud as a
    // petrol pump, and a cloth should be barely there — this is the difference between a kit that
    // sounds busy and one that sounds shrill after ten minutes.
    mop: 0.034, broom: 0.040, dustpan: 0.030,
    spray: 0.026, cloth: 0.018, sponge: 0.028, trashbag: 0.030,
  };
  function setToolLoop(kind) {
    if (!ctx) return;
    // Box cutting is progress-driven one-shot audio. Treat it (and every
    // unknown future tool) as silence here rather than manufacturing the
    // divot/rake fallback loop while LMB is merely held stationary.
    const activeKind = kind && Object.hasOwn(TOOL_LOOP_LEVEL, kind) ? kind : null;
    activeToolLoop = activeKind;
    if (activeKind) ensureToolLoop(activeKind);
    for (const [k, g] of Object.entries(toolLoops)) {
      const level = k === activeKind ? TOOL_LOOP_LEVEL[k] : 0;
      g.gain.setTargetAtTime(level, ctx.currentTime, 0.06);
    }
  }

  // called ~once per second with live game context
  function update(dt, { minuteOfDay = 720, rainIn = 0, golfersVisible = 0, inShop = false, tempHiF = 70 } = {}) {
    if (!ctx || paused || !lifecycleActive) return;
    const day = minuteOfDay >= 350 && minuteOfDay <= 1220;

    if (rainGain) rainGain.gain.setTargetAtTime(Math.min(0.35, rainIn * 0.4) * (inShop ? 0.35 : 1), ctx.currentTime, 0.6);

    const mowerOn = !inShop && minuteOfDay >= 300 && minuteOfDay <= 420; // the 5–7 AM shift
    if (mowerGain) mowerGain.gain.setTargetAtTime(mowerOn ? 0.05 : 0, ctx.currentTime, 1.2);

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
    billHandle,
    coinHandle: coin,
    drawerUnlock,
    drawerOpen: drawer,
    drawerClose,
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
    uiTick,
    uiConfirm,
    uiError,
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
    chime,
    thunk,
    ballStrike,
    ballLanding,
    starterCall,
    setToolLoop,
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
    // the delivery-to-shelf loop. `tape` and `recycle` are compatibility
    // aliases while production call sites move to the semantic names.
    truck, boxup, boxdown,
    cutterExtend, bladeContact, tapeCut, tapeRelease,
    tape: tapeCut,
    flap, product, itemRemoval, stock, fullShelf, boxFlatten, disposal,
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
