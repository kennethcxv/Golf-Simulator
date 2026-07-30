async (page) => {
  // LISTEN TO THE THREE PRESSES — by rendering them and measuring the waveform.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/box-open-sound-shape.js
  //
  // Reported 2026-07-29: "The gesture is good. The sound is thin. Tape tearing, cardboard
  // flexing, flaps folding over, contents shifting when you reach in. Each of the three presses
  // should sound different and mechanical. Pitch-vary so repeats do not grate."
  //
  // A sound is presentation, so asserting that sfx('boxTapeTear') was called proves nothing.
  // This points makeAudio() at an OfflineAudioContext, renders each cue to samples, and reports
  // measured numbers: length, peak, RMS, how many separate transients there are, where the
  // spectral energy sits, and how much two renders of the SAME cue differ.
  //
  // Three claims, three measurements:
  //   thin -> not thin      : duration, transient count and band spread against the old cues
  //   different from each   : the pairwise distance between the three cues' feature vectors must
  //   other                   exceed the distance between two takes of one cue
  //   pitch-varied          : two takes of one cue must NOT be sample-identical
  //
  // NEGATIVE CONTROL at the end: Math.random is pinned to a constant and the two takes must
  // become identical. Without it, "the takes differ" could be measuring float noise.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  // No game needed — the audio module is standalone. Load the page only for a module context.
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const measured = await page.evaluate(async () => {
    const { makeAudio } = await import('/src/core/audio.js');
    const SR = 44100;
    const SECONDS = 1.0;

    // Render one cue into its own OfflineAudioContext. makeAudio reads
    // window.AudioContext, so it is swapped for the duration of the render; an offline
    // context's currentTime is 0 until rendering starts, so every t0 lands at zero.
    async function render(cueName, { pinRandom = false } = {}) {
      const offline = new OfflineAudioContext(1, Math.ceil(SR * SECONDS), SR);
      const realAudioContext = window.AudioContext;
      const realWebkit = window.webkitAudioContext;
      const realRandom = Math.random;
      if (pinRandom) Math.random = () => 0.42;
      window.AudioContext = function () { return offline; };
      window.webkitAudioContext = undefined;
      let buffer = null;
      try {
        const audio = makeAudio(null);
        audio.init();                   // builds the graph on the offline context
        if (typeof audio[cueName] !== 'function') throw new Error(`no cue ${cueName}`);
        audio[cueName]();
        buffer = await offline.startRendering();
      } finally {
        window.AudioContext = realAudioContext;
        window.webkitAudioContext = realWebkit;
        Math.random = realRandom;
      }
      return Array.from(buffer.getChannelData(0));
    }

    const WINDOW = 512;

    function features(samples) {
      // Where does the sound actually end? Last sample above a real noise floor.
      let last = 0;
      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < samples.length; i++) {
        const a = Math.abs(samples[i]);
        if (a > peak) peak = a;
        sumSq += samples[i] * samples[i];
        if (a > 1e-4) last = i;
      }
      const durationMs = Math.round((last / 44100) * 1000);
      const rms = Math.sqrt(sumSq / samples.length);

      // Envelope in 512-sample frames, and the count of separate ATTACKS in it — a "thin"
      // sound is one attack, a mechanical one is several.
      const env = [];
      for (let i = 0; i + WINDOW <= samples.length; i += WINDOW) {
        let s = 0;
        for (let k = 0; k < WINDOW; k++) s += samples[i + k] * samples[i + k];
        env.push(Math.sqrt(s / WINDOW));
      }
      const envPeak = Math.max(...env, 1e-9);
      let transients = 0;
      for (let i = 2; i < env.length - 1; i++) {
        const rise = env[i] - env[i - 2];
        if (rise > envPeak * 0.16 && env[i] > envPeak * 0.2 && env[i] >= env[i + 1]) {
          transients += 1;
          i += 3; // one attack, not its shoulder
        }
      }

      // Coarse spectrum by zero-crossing rate per frame — enough to say "this one is bright
      // and that one is low" without shipping an FFT into a QA probe.
      const zcr = [];
      for (let i = 0; i + WINDOW <= samples.length; i += WINDOW) {
        let crossings = 0;
        for (let k = 1; k < WINDOW; k++) {
          if ((samples[i + k - 1] >= 0) !== (samples[i + k] >= 0)) crossings += 1;
        }
        zcr.push(crossings / WINDOW);
      }
      const loudFrames = zcr.filter((_, i) => env[i] > envPeak * 0.12);
      const meanZcr = loudFrames.length
        ? loudFrames.reduce((a, b) => a + b, 0) / loudFrames.length : 0;
      // Does the colour MOVE across the sound? A swept tear does; a fixed-band burst does not.
      const firstHalf = loudFrames.slice(0, Math.max(1, Math.floor(loudFrames.length / 2)));
      const lastHalf = loudFrames.slice(Math.floor(loudFrames.length / 2));
      const zcrDrift = (lastHalf.reduce((a, b) => a + b, 0) / Math.max(1, lastHalf.length))
        - (firstHalf.reduce((a, b) => a + b, 0) / Math.max(1, firstHalf.length));

      return {
        durationMs,
        peak: Number(peak.toFixed(5)),
        rms: Number(rms.toFixed(6)),
        transients,
        meanZcr: Number(meanZcr.toFixed(4)),
        zcrDrift: Number(zcrDrift.toFixed(4)),
        env,
      };
    }

    // Distance between two cues in feature space, normalised so no one axis dominates.
    function distance(a, b) {
      const axes = [
        [a.durationMs / 400, b.durationMs / 400],
        [a.rms / 0.01, b.rms / 0.01],
        [a.transients / 6, b.transients / 6],
        [a.meanZcr / 0.3, b.meanZcr / 0.3],
        [a.zcrDrift / 0.3, b.zcrDrift / 0.3],
      ];
      return Number(Math.sqrt(axes.reduce((sum, [x, y]) => sum + (x - y) * (x - y), 0)).toFixed(4));
    }

    const identical = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    const CUES = ['boxTapeTear', 'boxFlapFold', 'boxContentsShift'];
    const OLD = ['tapeRelease', 'flap', 'itemRemoval'];

    const takes = {};
    for (const cue of [...CUES, ...OLD]) {
      const a = await render(cue);
      const b = await render(cue);
      takes[cue] = {
        a: features(a),
        b: features(b),
        sampleIdentical: identical(a, b),
        selfDistance: distance(features(a), features(b)),
      };
    }

    // The negative control: pin Math.random and two takes must collapse onto each other.
    // Reported measurement 2026-07-29: this first came back false, so the divergence is
    // measured rather than assumed — a bit-exact comparison of two float renders is a
    // strong claim and the answer might be denormal noise rather than real randomness.
    const pinnedA = await render('boxTapeTear', { pinRandom: true });
    const pinnedB = await render('boxTapeTear', { pinRandom: true });
    let pinnedMaxDiff = 0;
    let pinnedFirstDiff = -1;
    for (let i = 0; i < pinnedA.length; i++) {
      const d = Math.abs(pinnedA[i] - pinnedB[i]);
      if (d > pinnedMaxDiff) pinnedMaxDiff = d;
      if (pinnedFirstDiff < 0 && d > 0) pinnedFirstDiff = i;
    }
    const freeA = await render('boxTapeTear');
    const freeB = await render('boxTapeTear');
    let freeMaxDiff = 0;
    for (let i = 0; i < freeA.length; i++) {
      const d = Math.abs(freeA[i] - freeB[i]);
      if (d > freeMaxDiff) freeMaxDiff = d;
    }

    const pairs = {};
    for (let i = 0; i < CUES.length; i++) {
      for (let j = i + 1; j < CUES.length; j++) {
        pairs[`${CUES[i]} vs ${CUES[j]}`] = distance(takes[CUES[i]].a, takes[CUES[j]].a);
      }
    }

    const strip = (t) => ({ ...t, a: { ...t.a, env: undefined }, b: { ...t.b, env: undefined } });
    return {
      cues: Object.fromEntries(CUES.map((c) => [c, strip(takes[c])])),
      previous: Object.fromEntries(OLD.map((c) => [c, strip(takes[c])])),
      pairs,
      worstSelfDistance: Math.max(...CUES.map((c) => takes[c].selfDistance)),
      closestPair: Math.min(...Object.values(pairs)),
      pinnedIdentical: identical(pinnedA, pinnedB),
      pinnedMaxDiff: Number(pinnedMaxDiff.toExponential(3)),
      pinnedFirstDiff,
      freeMaxDiff: Number(freeMaxDiff.toExponential(3)),
      envelopes: Object.fromEntries(CUES.map((c) => [
        c, takes[c].a.env.slice(0, 40).map((v) => Number(v.toFixed(5))),
      ])),
    };
  });

  const c = measured.cues;
  const p = measured.previous;
  const findings = {
    // NOT THIN. Each cue has to be longer AND have more separate mechanical events than the
    // single-burst cue it replaces.
    tearLongerThanBefore: c.boxTapeTear.a.durationMs > p.tapeRelease.a.durationMs,
    tearHasMoreEvents: c.boxTapeTear.a.transients > p.tapeRelease.a.transients,
    foldLongerThanBefore: c.boxFlapFold.a.durationMs > p.flap.a.durationMs,
    foldHasMoreEvents: c.boxFlapFold.a.transients > p.flap.a.transients,
    shiftHasMoreEvents: c.boxContentsShift.a.transients > p.itemRemoval.a.transients,
    // MECHANICAL: more than one attack in every cue. One attack is a blip.
    everyCueHasMultipleAttacks: [c.boxTapeTear, c.boxFlapFold, c.boxContentsShift]
      .every((t) => t.a.transients >= 2),
    // DIFFERENT FROM EACH OTHER: the closest two cues must be further apart than the two takes
    // of a single cue. This is the claim "each press sounds different", stated so it can fail.
    threeCuesAreDistinct: measured.closestPair > measured.worstSelfDistance,
    // PITCH-VARIED: two presses are never the same waveform.
    repeatsDiffer: [c.boxTapeTear, c.boxFlapFold, c.boxContentsShift]
      .every((t) => t.sampleIdentical === false),
    // …and the control that makes the line above mean something.
    // PINNING RANDOM COLLAPSES THE TAKES. Bit-exactness is not the right bar for two float
    // renders, so the claim is that pinning shrinks the divergence to nothing AUDIBLE while
    // leaving it real when random runs free. Both halves are needed: the first alone would
    // pass on a silent renderer, the second alone on a broken control.
    pinnedRandomCollapsesTakes: measured.pinnedMaxDiff < 1e-6,
    freeRandomKeepsTakesApart: measured.freeMaxDiff > 1e-4,
  };

  const result = {
    what: 'the three carton presses, rendered offline and measured: length, attacks, colour, and how far apart they are',
    findings,
    closestPair: measured.closestPair,
    worstSelfDistance: measured.worstSelfDistance,
    pinnedMaxDiff: measured.pinnedMaxDiff,
    pinnedFirstDiff: measured.pinnedFirstDiff,
    freeMaxDiff: measured.freeMaxDiff,
    pairs: measured.pairs,
    cues: measured.cues,
    previous: measured.previous,
    envelopes: measured.envelopes,
    errs: errs.slice(0, 12),
    ok: Object.values(findings).every((v) => v === true) && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'box-open-sound-shape.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
