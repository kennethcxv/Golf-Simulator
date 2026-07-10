// FAIRWAY STATE — procedural placeholder audio. Everything synthesized in
// WebAudio: birdsong, rain, mowers at dawn, ball strikes, the shop doorbell.
// Honest placeholders — real recorded SFX are a pre-ship requirement (logged in
// KNOWN_ISSUES). Master volume persists in localStorage, separate from saves.

const SETTINGS_KEY = 'fairwaystate:settings';

export function makeAudio() {
  let ctx = null;
  let master = null;
  let ambientBus = null;
  let sfxBus = null;

  let rainGain = null;
  let mowerGain = null;
  let birdTimer = 0;
  let strikeTimer = 0;

  const settings = (() => {
    try {
      return { volume: 0.8, muted: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { volume: 0.8, muted: false };
    }
  })();

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* private mode etc. */ }
  }

  function applyVolume() {
    if (master) master.gain.value = settings.muted ? 0 : settings.volume * 0.5;
  }

  // must be called from a user gesture
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.connect(ctx.destination);
    ambientBus = ctx.createGain();
    ambientBus.gain.value = 0.6;
    ambientBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
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

  function ballStrike() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const click = ctx.createOscillator();
    click.type = 'sine';
    click.frequency.setValueAtTime(1250, t0);
    click.frequency.exponentialRampToValueAtTime(420, t0 + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    click.connect(g).connect(sfxBus);
    click.start(t0);
    click.stop(t0 + 0.09);
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
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + 0.06);
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

  // continuous in-use loops, one per tool, crossfaded by setToolLoop(kind|null)
  const toolLoops = {}; // kind -> gain node
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
      // divot / rake: pulsed granular scrape (noise gated by an LFO)
      filter.type = 'bandpass';
      filter.frequency.value = kind === 'rake' ? 950 : 520;
      filter.Q.value = 1.1;
      const pulse = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = kind === 'rake' ? 2.3 : 3.1;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.5;
      lfo.connect(lfoDepth).connect(pulse.gain);
      pulse.gain.value = 0.5;
      src.connect(filter).connect(pulse).connect(gain);
      lfo.start();
    }
    gain.connect(sfxBus);
    src.start();
    toolLoops[kind] = gain;
    return gain;
  }

  const TOOL_LOOP_LEVEL = { hose: 0.045, vacuum: 0.06, divot: 0.05, rake: 0.05, mower: 0.055 };
  function setToolLoop(kind) {
    if (!ctx) return;
    if (kind) ensureToolLoop(kind);
    for (const [k, g] of Object.entries(toolLoops)) {
      g.gain.setTargetAtTime(k === kind ? TOOL_LOOP_LEVEL[k] : 0, ctx.currentTime, 0.06);
    }
  }

  // called ~once per second with live game context
  function update(dt, { minuteOfDay = 720, rainIn = 0, golfersVisible = 0, inShop = false, tempHiF = 70 } = {}) {
    if (!ctx) return;
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

    strikeTimer -= dt;
    if (strikeTimer <= 0) {
      strikeTimer = 5 + Math.random() * 9;
      if (day && !inShop && golfersVisible > 0 && rainIn < 0.6) ballStrike();
    }
  }

  return {
    init,
    update,
    doorbell,
    uiTick,
    equipTick,
    chime,
    thunk,
    setToolLoop,
    get ready() {
      return !!ctx;
    },
    getVolume: () => settings.volume,
    isMuted: () => settings.muted,
    setVolume(v) {
      settings.volume = v;
      applyVolume();
      saveSettings();
    },
    setMuted(m) {
      settings.muted = m;
      applyVolume();
      saveSettings();
    },
  };
}
