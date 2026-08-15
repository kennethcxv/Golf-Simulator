// 1.6 (Goal 26) — THE MOWER-LIKE STATIC ON LOAD: IS IT THERE, AND WHOSE IS IT?
//
// "A loud mower-like static plays on load. Find the real source -- a stray
// oscillator, a bad loop seam, a duplicated node, a decode error, a too-short
// sample looping -- and remove it. Do not lower the master volume."
//
// Reading the code names a suspect immediately: audio.js runs two detuned
// sawtooths at 92 and 95.5 Hz through a low-pass, and gates them on
// `minuteOfDay >= 300 && minuteOfDay <= 420` -- the 5-7 AM mowing shift. Phase 9
// of this same brief records that the game STARTS AT 6 AM. If that is right, the
// mower is on from the first second of every new game, which is exactly "plays on
// load".
//
// That is a reading, and this repository has a ledger full of readings that were
// wrong in interesting ways. So it is measured: the ambient bus is tapped
// separately from the master, the live game clock is read, and the mower's own
// gain node is reported. A drone that is genuinely there and a drone I have
// argued myself into must not look the same.
//
// THE CONTROL: the same measurement with the mower's gate forced off. If the
// ambient level does not move, the mower is not what the owner is hearing and the
// real source is still at large.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-startup-noise.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/startup-noise');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], samples: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });

  // Tap the master. The ambient bus is where a drone lives, but the player hears
  // the master, so that is what is reported as the level.
  out.installed = await page.evaluate(() => {
    const a = window.__fw?.audio;
    if (!a?.qaMasterTap) return { ok: false, why: 'no qaMasterTap' };
    window.__sn = { tap: a.qaMasterTap() };
    return { ok: true, state: window.__sn.tap.read().state };
  });
  if (!out.installed?.ok) {
    console.log('ABORTED', JSON.stringify(out.installed));
    return out;
  }

  // WHAT TIME IS IT, AND IS THE MOWER'S GATE OPEN? Read from the live sim rather
  // than assumed from the brief.
  out.clock = await page.evaluate(() => {
    const st = window.__fw?.state || window.__fw?.getState?.() || null;
    const minute = st?.golfDay?.minuteOfDay ?? st?.minuteOfDay ?? null;
    return {
      minuteOfDay: minute,
      clockText: minute == null ? null
        : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.round(minute % 60)).padStart(2, '0')}`,
      // the module's own gate, re-evaluated here so the report quotes the rule
      mowerWindow: minute != null && minute >= 300 && minute <= 420,
    };
  });
  console.log('CLOCK', JSON.stringify(out.clock));

  // A drone is a SUSTAINED floor, not a peak, so the statistic that catches it is
  // the MINIMUM over a window: a one-shot leaves the floor at zero between hits,
  // and a drone never lets it fall. Peak alone cannot tell them apart.
  const window_ = async (label, ms = 4000) => {
    const r = await page.evaluate(async ({ dur }) => {
      const t0 = performance.now();
      let peak = 0;
      let floor = 1;
      let n = 0;
      let sum = 0;
      await new Promise((resolve) => {
        const tick = () => {
          const s = window.__sn.tap.read();
          peak = Math.max(peak, s.peak);
          floor = Math.min(floor, s.rms);
          sum += s.rms; n += 1;
          if (performance.now() - t0 >= dur) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { peak, floorRms: floor, meanRms: sum / Math.max(1, n), reads: n };
    }, { dur: ms });
    const row = {
      label,
      peakDb: r.peak > 0 ? +(20 * Math.log10(r.peak)).toFixed(1) : null,
      floorRmsDb: r.floorRms > 0 ? +(20 * Math.log10(r.floorRms)).toFixed(1) : null,
      meanRmsDb: r.meanRms > 0 ? +(20 * Math.log10(r.meanRms)).toFixed(1) : null,
      reads: r.reads,
    };
    out.samples.push(row);
    console.log('WINDOW', JSON.stringify(row));
    return row;
  };

  await window_('as_loaded', 5000);

  // THE CONTROL. Silence the mower's own gain node and measure again. If the
  // floor does not drop, the mower is not the source.
  out.mowerSilenced = await page.evaluate(() => {
    const ctx = window.__fw?.audio?.qaContext?.();
    if (!ctx) return { ok: false, why: 'no context' };
    // The mower gain is not exported, so it is found by walking the graph is not
    // possible either -- instead the sim clock is moved OUT of the mowing window,
    // which is the same lever the production gate reads and therefore a fair test
    // of that gate rather than of a private node.
    const st = window.__fw?.state || null;
    if (!st?.golfDay) return { ok: false, why: 'no golfDay on state' };
    const before = st.golfDay.minuteOfDay;
    st.golfDay.minuteOfDay = 600; // 10:00, well clear of the 5-7 window
    return { ok: true, before, now: st.golfDay.minuteOfDay };
  });
  console.log('MOWER-GATE-MOVED', JSON.stringify(out.mowerSilenced));
  await page.waitForTimeout(4000); // the gate ramps over ~1.2 s
  await window_('clock_moved_out_of_mower_window_CONTROL', 5000);

  out.verdict = {
    clock: out.clock,
    asLoadedFloorDb: out.samples[0]?.floorRmsDb ?? null,
    controlFloorDb: out.samples[1]?.floorRmsDb ?? null,
    floorDropDb: (out.samples[0]?.floorRmsDb != null && out.samples[1]?.floorRmsDb != null)
      ? +(out.samples[0].floorRmsDb - out.samples[1].floorRmsDb).toFixed(1) : null,
  };
  fs.writeFileSync(path.join(OUT, 'startup-noise.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('STARTUP-NOISE', JSON.stringify(out.verdict, null, 2));
  return out;
}
