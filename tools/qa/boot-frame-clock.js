// IS THE BOOT'S 1005 ms/FRAME A THROTTLED COMPOSITOR, OR A BLOCKED MAIN THREAD?
//
// The boot ledger reports msPerFrame per warm stage and it has read a
// metronomic ~1005 ms across belt, laptop, editor and overview. That number is
// computed as stage-wall-time / rAF-callbacks-during-the-stage, and TWO very
// different faults produce the same figure:
//
//   throttling  Chromium is only issuing BeginFrames at 1 Hz. Then rAF is slow
//               and the TIMER QUEUE is not, because setTimeout does not wait on
//               the compositor. The frames are free and the boot is a lie.
//   blocking    each yield is followed by ~1 second of SYNCHRONOUS work, so no
//               callback of any kind can run in between. Then rAF and the timer
//               queue are starved by the same amount, and the boot really does
//               cost that.
//
// So this records both queues ACROSS THE WHOLE BOOT, in one recorder started
// before the menu click and read after the veil lifts, alongside the ledger's
// own msPerFrame for the same stages.
//
// THE CONTROL is the same pair used by frame-clock-forensics: a MessageChannel
// loop that must read fast when nothing is blocking, and a setTimeout(1000)
// series that must read ~1000 ms. Both are recorded over the same window; if
// the recorder cannot separate those two it cannot testify about the boot.
//
//   QA_ELECTRON_USER_DATA_DIR=<dir> node tools/qa/run-electron.cjs tools/qa/boot-frame-clock.js --clubhouse=pine-hills-v2
//
// First run of a fresh dir is COLD; every run after is the STAMPED case, which
// is the one the owner is reporting.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/frame-clock';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  out.stampedBefore = await page.evaluate(() => {
    try { return !!localStorage.getItem('golfEmpire.shaderCompileStamp.v2'); } catch { return null; }
  });
  console.log(`boot: ${out.stampedBefore ? 'WARM (stamped before this run)' : 'COLD'}`);

  // The recorder. Started and NOT awaited: it keeps writing into a global while
  // the boot happens around it.
  await page.evaluate(() => {
    const rec = { raf: [], timer: [], port: [], slow: [], t0: performance.now() };
    window.__fwClock = rec;
    const now = () => performance.now();
    let lr = 0; let lt = 0; let lp = 0; let ls = 0;
    const push = (a, v) => { if (a.length < 200000) a.push(v); };
    const rafLoop = () => {
      const t = now(); if (lr) push(rec.raf, t - lr); lr = t;
      if (!rec.stop) requestAnimationFrame(rafLoop);
    };
    requestAnimationFrame(rafLoop);
    const timerLoop = () => {
      const t = now(); if (lt) push(rec.timer, t - lt); lt = t;
      if (!rec.stop) setTimeout(timerLoop, 0);
    };
    setTimeout(timerLoop, 0);
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      const t = now(); if (lp) push(rec.port, t - lp); lp = t;
      if (!rec.stop) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
    const slowLoop = () => {
      const t = now(); if (ls) push(rec.slow, t - ls); ls = t;
      if (!rec.stop) setTimeout(slowLoop, 1000);
    };
    setTimeout(slowLoop, 1000);
  });

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const t0 = Date.now();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d, null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  out.veilGoneMs = Date.now() - t0;

  const r = await page.evaluate(() => {
    const rec = window.__fwClock;
    rec.stop = true;
    const stat = (v) => {
      if (!v.length) return { n: 0 };
      const s = v.slice().sort((a, b) => a - b);
      const sum = v.reduce((a, b) => a + b, 0);
      // How much of the whole window this queue spent inside gaps longer than a
      // quarter second -- the honest way to say "it was blocked", because a
      // median hides a handful of multi-second stalls.
      const overQuarter = v.filter((x) => x > 250).reduce((a, b) => a + b, 0);
      return {
        n: s.length,
        median: +s[s.length >> 1].toFixed(2),
        p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(1),
        max: +s[s.length - 1].toFixed(1),
        totalMs: +sum.toFixed(0),
        blockedMs: +overQuarter.toFixed(0),
        gapsOver250ms: v.filter((x) => x > 250).length,
        gapsOver900ms: v.filter((x) => x > 900).length,
      };
    };
    const b = window.__fwBoot;
    return {
      raf: stat(rec.raf), timer: stat(rec.timer), port: stat(rec.port), slow: stat(rec.slow),
      windowMs: +(performance.now() - rec.t0).toFixed(0),
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      stamped: b ? b.stamped : null,
      stages: b ? b.stages.map((s) => ({
        label: s.label, ms: s.ms, frames: s.frames, msPerFrame: s.msPerFrame, minted: s.minted,
      })) : null,
    };
  });
  out.clocks = r;

  console.log(`\nwindow ${r.windowMs} ms   visibility=${r.visibility} focused=${r.focused}`
    + `   veil gone at ${out.veilGoneMs} ms   ledger stamped=${r.stamped}`);
  console.log('\nqueue      n      median      p95        max     time in gaps>250ms   gaps>900ms');
  for (const k of ['raf', 'timer', 'port', 'slow']) {
    const s = r[k];
    console.log(`  ${k.padEnd(7)} ${String(s.n).padStart(6)} ${String(s.median).padStart(9)} `
      + `${String(s.p95).padStart(9)} ${String(s.max).padStart(10)}   `
      + `${String(s.blockedMs).padStart(8)} ms (${s.gapsOver250ms})   ${String(s.gapsOver900ms).padStart(6)}`);
  }

  if (r.stages) {
    console.log('\nthe ledger, for the same boot:');
    for (const s of r.stages) {
      console.log(`  ${String(s.label).padEnd(22)} ${String(s.ms).padStart(9)} ms  frames ${String(s.frames).padStart(5)}`
        + `  msPerFrame ${String(s.msPerFrame).padStart(8)}  minted ${s.minted}`);
    }
  }

  // THE CONTROLS, TAKEN IN A QUIET WINDOW AFTER THE VEIL.
  //
  // They cannot be taken DURING the boot. The first run of this driver checked
  // the setTimeout(1000) series across the whole boot and it read 1992.9 ms --
  // and that is the control behaving correctly, not failing: a thread blocked
  // for 27 seconds at a stretch cannot deliver a 1 Hz timer either. Asserting
  // it there would have marked the run void at exactly the moment it found the
  // answer. So the recorder proves it can separate fast from 1 Hz on a settled
  // page, and the boot window is then read with that instrument.
  const control = await page.evaluate(() => new Promise((done) => {
    const s = { port: [], slow: [] };
    let lp = 0; let ls = 0; let live = 2;
    const now = () => performance.now();
    const stop = now() + 5000;
    const fin = () => { if (--live === 0) done(s); };
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      const t = now(); if (lp) s.port.push(t - lp); lp = t;
      if (t < stop) ch.port2.postMessage(0); else fin();
    };
    ch.port2.postMessage(0);
    const slow = () => {
      const t = now(); if (ls) s.slow.push(t - ls); ls = t;
      if (t < stop) setTimeout(slow, 1000); else fin();
    };
    setTimeout(slow, 1000);
  }));
  const med = (v) => (v.length ? +v.slice().sort((a, b) => a - b)[v.length >> 1].toFixed(2) : null);
  out.control = { portMedian: med(control.port), slowMedian: med(control.slow) };
  console.log(`
control, on the settled page: MessageChannel ${out.control.portMedian} ms, setTimeout(1000) ${out.control.slowMedian} ms`);
  if (!(out.control.slowMedian > 900 && out.control.slowMedian < 1400)) {
    fail(`the setTimeout(1000) control read ${out.control.slowMedian} ms on a settled page — the recorder cannot see a 1 Hz series, so nothing above is evidence`);
  }
  if (!(out.control.portMedian < 60)) {
    fail(`the MessageChannel control read ${out.control.portMedian} ms on a settled page — that is not a fast queue, so the recorder cannot separate blocked from throttled`);
  }

  // THE VERDICT, stated by the instrument rather than by the person reading it.
  const rafBlocked = r.raf.blockedMs;
  const timerBlocked = r.timer.blockedMs;
  const ratio = rafBlocked > 0 ? +(timerBlocked / rafBlocked).toFixed(2) : null;
  out.verdict = ratio == null ? 'no long rAF gaps at all — there is no 1 Hz floor on this boot'
    : ratio > 0.5 ? 'BLOCKED MAIN THREAD — the timer queue is starved by the same work, so the boot really costs this'
      : 'THROTTLED COMPOSITOR — rAF is starved while the timer queue runs, so the frames are free and the ledger msPerFrame is an artifact';
  console.log(`\ntime lost to gaps > 250 ms:  rAF ${rafBlocked} ms   timer ${timerBlocked} ms   ratio ${ratio}`);
  console.log(`VERDICT: ${out.verdict}`);

  fs.writeFileSync(`${OUT}/boot-clock.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
