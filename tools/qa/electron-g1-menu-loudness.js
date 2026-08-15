// G1 (Goal 23) — HOW LOUD ARE THE MENU SOUNDS, ACTUALLY?
//
// "They exist now and I can barely hear them. Raise them. MEASURE THE ACTUAL
// OUTPUT LEVEL rather than guessing at a gain, and match them to the in-game UI
// clicks."
//
// Goal 22's audio check counted graph EVENTS — oscillators created, gains
// scheduled, start() called. That proved the menu was no longer silent, which
// was the question then. It says nothing about loudness: a node that runs at
// 0.0001 and a node that runs at 0.5 produce identical event counts.
//
// So this taps the real output with an AnalyserNode inserted before the
// destination and reports PEAK AMPLITUDE, 0..1, for each cue — the menu press,
// the menu hover, and the in-game UI click the owner wants them matched to.
//
// The control that matters: SILENCE. A tap that reads the same number whether a
// sound is playing or not is measuring its own noise floor, so a quiet window
// is sampled first and every cue is reported against it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-g1-menu-loudness.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g1-menu-loudness');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1200);

  // The tap has to be installed on the LIVE context, and the context only
  // exists after a gesture. So: one click to wake the audio, then the tap, then
  // the measurements.
  const first = await page.$('.menu-screen button:not([disabled])');
  if (first) await first.click();
  await page.waitForTimeout(900);

  // qaMasterTap ALREADY EXISTS in src/core/audio.js and returns {rms, peak,
  // state} off an AnalyserNode on the master bus. Building a second tap beside
  // it would be a second opinion about the same signal, and this repository has
  // paid for two-of-anything more than once.
  out.installed = await page.evaluate(() => {
    const app = window.__fw;
    if (!app?.audio?.qaMasterTap) return { ok: false, why: 'qaMasterTap not on the audio surface' };
    try {
      window.__g1tap = app.audio.qaMasterTap();
      const r = window.__g1tap.read();
      return { ok: true, state: r.state };
    } catch (e) { return { ok: false, why: String(e.message || e) }; }
  });
  if (!out.installed.ok) {
    fs.writeFileSync(path.join(OUT, 'loudness.json'), `${JSON.stringify(out, null, 2)}
`);
    console.log('G1', JSON.stringify(out, null, 2));
    return out;
  }

  // Peak over a window, sampled every animation frame.
  const peakOver = (ms) => page.evaluate((d) => new Promise((resolve) => {
    let peak = 0;
    const t0 = performance.now();
    const tick = () => {
      const r = window.__g1tap.read();
      if (r.peak > peak) peak = r.peak;
      if (performance.now() - t0 < d) requestAnimationFrame(tick);
      else resolve(+peak.toFixed(5));
    };
    requestAnimationFrame(tick);
  }), ms);

  const peak = peakOver;
  // FIRE IT REPEATEDLY. A single shot measured -33.7 dBFS on one run and -29.4
  // on the next with no code change between them: the cue decays over 50 ms and
  // the tap polls on animation frames, so a single reading is sampling luck,
  // not a level. Eight shots inside the window and the max of them is stable
  // to a few tenths of a dB, which is the difference between a measurement and
  // a number.
  const fire = async (fn, shots = 8) => {
    const p = peak(120 * shots + 260);
    for (let i = 0; i < shots; i += 1) {
      await page.evaluate((f) => { try { window.__fw.audio[f](); } catch { /* the peak reports it */ } }, fn);
      await page.waitForTimeout(120);
    }
    return p;
  };

  // CONTROL FIRST: what does the tap read when nothing is playing?
  out.silence = await peak(500);
  await page.waitForTimeout(300);

  out.cues = {};
  for (const cue of ['uiTick', 'uiConfirm']) {
    out.cues[cue] = await fire(cue);
    await page.waitForTimeout(400);
  }

  // ...and a real menu button press, through the DOM, the way a player does it.
  const btns = await page.$$('.menu-screen button:not([disabled])');
  out.buttonPresses = [];
  for (const btn of btns.slice(0, 3)) {
    const p = peak(450);
    await btn.hover().catch(() => {});
    await page.waitForTimeout(60);
    await btn.click({ trial: true }).catch(() => {});
    await page.mouse.down();
    await page.mouse.up();
    out.buttonPresses.push(await p);
    await page.waitForTimeout(350);
  }

  const above = (v) => +(v - out.silence).toFixed(5);
  out.measured = {
    silenceFloor: out.silence,
    uiTickPeak: out.cues.uiTick,
    uiConfirmPeak: out.cues.uiConfirm,
    uiTickAboveFloor: above(out.cues.uiTick),
    uiConfirmAboveFloor: above(out.cues.uiConfirm),
    buttonPressPeaks: out.buttonPresses,
    // dBFS is the unit a person tuning audio actually thinks in
    uiTickDbfs: out.cues.uiTick > 0 ? +(20 * Math.log10(out.cues.uiTick)).toFixed(1) : null,
    uiConfirmDbfs: out.cues.uiConfirm > 0 ? +(20 * Math.log10(out.cues.uiConfirm)).toFixed(1) : null,
  };
  out.checks = {
    // the tap is not measuring its own noise: a cue must clear the floor
    tapHearsSomething: above(out.cues.uiTick) > 0.002,
    silenceIsQuiet: out.silence < 0.01,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'loudness.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G1', JSON.stringify({ measured: out.measured, checks: out.checks }, null, 2));
  return out;
}
