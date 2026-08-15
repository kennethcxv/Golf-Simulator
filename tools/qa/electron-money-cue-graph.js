// PLAYTEST 5, ITEM 5 — THE AUDIO, READ OFF THE GRAPH.
//
//   "The old synth is still playing underneath the book."
//   "Coin and cash cues are firing on the wrong clicks."
//   "Add a transaction-complete sound. There is nothing marking the end of a sale."
//   "The cash drawer opening and closing is too loud. Bring it down."
//
// Method notes are all the same one: ASK THE GRAPH. `audio.js` builds every cue
// out of AudioContext nodes, so the only honest question is what nodes each cue
// creates and at what gain. This taps `createOscillator`, `createBufferSource`
// and `createGain` on the live AudioContext prototype, then fires each cue
// through the SHIPPED api on `window.__fw` and reports, per cue:
//
//   * oscillators started  -- a synth voice. For the three ledger cues this must
//     be ZERO after the fix; it is the "static blip" in the owner's words.
//   * buffer sources started -- a recording, or a synthesised noise buffer.
//   * peak gain            -- the loudest gain node the cue set. This is the
//     number behind "too loud" and behind "there is nothing marking the sale":
//     the drawer asks for 0.55 while checkoutComplete's three tones peak at
//     0.026-0.032, roughly 25 dB below it.
//
// NEGATIVE CONTROL: a cue that is KNOWN to be a synth (`uiTick`) is fired
// through the same tap and must report oscillators > 0 with a non-zero peak. A
// tap that reports zero for everything would show the ledger as fixed no matter
// what the code did.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-money-cue-graph.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/money-cue-graph');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  out.install = await page.evaluate(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return 'no AudioContext';
    const tap = { osc: 0, buf: 0, peak: 0, gains: [], on: false };
    window.__cueTap = tap;
    const P = AC.prototype;
    const realOsc = P.createOscillator;
    const realBuf = P.createBufferSource;
    const realGain = P.createGain;
    P.createOscillator = function patched(...a) {
      const node = realOsc.apply(this, a);
      if (tap.on) {
        const start = node.start.bind(node);
        node.start = (...s) => { tap.osc += 1; return start(...s); };
      }
      return node;
    };
    P.createBufferSource = function patched(...a) {
      const node = realBuf.apply(this, a);
      if (tap.on) {
        const start = node.start.bind(node);
        node.start = (...s) => { tap.buf += 1; return start(...s); };
      }
      return node;
    };
    P.createGain = function patched(...a) {
      const node = realGain.apply(this, a);
      if (tap.on) {
        // Every way audio.js sets a level: .value, setValueAtTime, the ramps.
        const g = node.gain;
        const note = (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > tap.peak) { tap.peak = n; tap.gains.push(+n.toFixed(5)); }
        };
        try {
          const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g), 'value');
          if (desc?.set) {
            Object.defineProperty(g, 'value', {
              configurable: true,
              get: () => desc.get.call(g),
              set: (v) => { note(v); desc.set.call(g, v); },
            });
          }
        } catch { /* leave .value alone if it will not wrap */ }
        for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) {
          const real = g[m].bind(g);
          g[m] = (v, t) => { note(v); return real(v, t); };
        }
      }
      return node;
    };
    return 'installed';
  });
  console.log(`graph tap: ${out.install}`);

  // Cues are fired BY NAME off the shipped api on `app.audio`. An earlier draft
  // passed a source string and eval'd it; a name lookup is both safer and a
  // better instrument, because a cue whose name is not on the shipped object
  // reports `missing` instead of quietly evaluating to undefined.
  const fire = async (label, cue, arg) => {
    const res = await page.evaluate(async ({ name, a }) => {
      const api = window.__fw?.audio;
      const tap = window.__cueTap;
      tap.osc = 0; tap.buf = 0; tap.peak = 0; tap.gains = [];
      if (!api) return { error: 'no app.audio' };
      if (typeof api[name] !== 'function') {
        return { error: `missing cue: audio.${name} is ${typeof api[name]}` };
      }
      tap.on = true;
      let error = null;
      try { await api[name](a); } catch (err) { error = String(err?.message || err); }
      await new Promise((r) => setTimeout(r, 260));
      tap.on = false;
      return {
        oscillators: tap.osc, bufferSources: tap.buf, peakGain: +tap.peak.toFixed(5), error,
      };
    }, { name: cue, a: arg });
    out[label] = res;
    console.log(`  ${label.padEnd(22)} osc ${String(res.oscillators).padStart(2)}  `
      + `buffers ${String(res.bufferSources).padStart(2)}  peak gain ${String(res.peakGain).padStart(8)}`
      + `${res.error ? `   ERROR ${res.error}` : ''}`);
    return res;
  };

  // Audio needs a user gesture before it will run in a real browser build.
  await page.mouse.click(400, 400);
  await page.waitForTimeout(600);
  out.audioReady = await page.evaluate(() => !!window.__fw?.audioApi?.ready
    || !!document.querySelector('canvas'));

  console.log('\nCUE BY CUE, off the live audio graph:');
  // CONTROL: a cue that is DEFINITELY a synth, so the tap must see oscillators.
  //
  // The first version used `uiTick` and the control FAILED at 0 oscillators —
  // not because the tap was broken but because uiTick asks the bank first and
  // now plays a recording. A control has to be something that cannot have been
  // fixed out from under it. `keypadTap` never calls `sampled()`: its whole body
  // is `if (!ctx) return;` and two oscillators. If THIS reports zero, every zero
  // in the ledger rows below is meaningless.
  await fire('CONTROL keypadTap (synth-only)', 'keypadTap');
  await fire('checkoutComplete', 'checkoutComplete');

  console.log('\n  -- the ledger: the synth fallback must be GONE (oscillators 0) --');
  await fire('ledgerOpen', 'ledgerOpen');
  await fire('ledgerTurn', 'ledgerTurn');
  await fire('ledgerClose', 'ledgerClose');
  // Fire the page turn twice in quick succession: the second is inside
  // sampleBank's 20 ms minGapSec, which is the refusal that USED to fall through
  // to the blip. After the fix the second turn must be silent, not synthesised.
  await fire('ledgerTurn (2nd inside 20ms)', 'ledgerTurn');

  console.log('\n  -- the money cues: which is coin, which is paper --');
  await fire('coinHandle', 'coinHandle');
  await fire('billHandle', 'billHandle');
  await fire('coinDeposit', 'coinDeposit');
  await fire('billDeposit', 'billDeposit');
  // ITEM 5's crossover, both ways: a quarter and a twenty through the same cue.
  await fire('changeSelect (25c coin)', 'changeSelect', 0.25);
  await fire('changeSelect (20 note)', 'changeSelect', 20);
  await fire('cashPickup (25c coin)', 'cashPickup', 0.25);
  await fire('cashPickup (20 note)', 'cashPickup', 20);

  console.log('\n  -- the drawer, against the sound that marks the sale --');
  await fire('drawerOpen', 'drawerOpen');
  await fire('drawerClose', 'drawerClose');

  const peak = (k) => out[k]?.peakGain ?? null;
  out.verdict = {
    controlSawSynth: (out['CONTROL keypadTap (synth-only)']?.oscillators || 0) > 0,
    ledgerOscillators: {
      open: out.ledgerOpen?.oscillators, turn: out.ledgerTurn?.oscillators,
      close: out.ledgerClose?.oscillators, secondTurn: out['ledgerTurn (2nd inside 20ms)']?.oscillators,
    },
    ledgerSilentOfSynth: [out.ledgerOpen, out.ledgerTurn, out.ledgerClose,
      out['ledgerTurn (2nd inside 20ms)']].every((r) => (r?.oscillators || 0) === 0),
    drawerVsSaleEnd: {
      drawerOpenPeak: peak('drawerOpen'),
      drawerClosePeak: peak('drawerClose'),
      checkoutCompletePeak: peak('checkoutComplete'),
      ratio: (peak('drawerOpen') && peak('checkoutComplete'))
        ? +(peak('drawerOpen') / peak('checkoutComplete')).toFixed(1) : null,
    },
  };
  console.log(`\nVERDICT ${JSON.stringify(out.verdict, null, 2)}`);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${path.join(OUT, `${tag}-result.json`)}`);
  return out;
}
