// WHAT IS ACTUALLY CALLING THE FRAME? -- the 1 Hz measurement floor, chased as
// an instrument fault.
//
// Every frame-time number in this project sits on a floor of ~1005 ms/frame:
// menu, scene and play alike, one window, visible, focused, with
// backgroundThrottling:false, setAlwaysOnTop('screen-saver') and both
// disable-renderer-backgrounding switches in force. 1005 ms is suspiciously
// exactly 1 Hz, which is not what a slow machine looks like -- a slow machine
// produces a ragged distribution, not a metronome.
//
// THE DISCRIMINATOR. Four clocks run CONCURRENTLY in the same page for the same
// window of wall time, so no reading can be blamed on the moment it was taken:
//
//   raf     requestAnimationFrame, the thing the game's loop is built on
//   timer   setTimeout(0), a task queue that does NOT wait on the compositor
//   port    MessageChannel, a microtask-adjacent queue that waits on nothing
//   slow    setTimeout(1000) -- a KNOWN 1 Hz series
//
// and that pair at the ends is the negative control. `port` must read well
// under a millisecond and `slow` must read ~1000 ms. If the histogram cannot
// tell those two apart it cannot be believed about `raf` either, and the run
// says so and stops.
//
// What the four together decide:
//
//   raf ~1000, timer fast, port fast  -> nothing is busy. The compositor is not
//                                        issuing BeginFrames. An instrument
//                                        fault, and no frame-time number taken
//                                        under it means anything.
//   raf ~1000, timer ~1000            -> the main thread is genuinely blocked
//                                        for a second at a time. A real fault.
//   raf fast                          -> the floor is not rAF, and whatever
//                                        reported 1005 ms was measuring
//                                        something else.
//
// Measured at TWO page states, because the existing ledger says the menu reads
// 14.6 ms and the scene reads 1009.9 in the SAME window -- so "the compositor
// gave up on this window" cannot be the whole story, and the difference between
// the two states is the evidence.
//
//   node tools/qa/run-electron.cjs tools/qa/frame-clock-forensics.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/frame-clock';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], states: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  // The four concurrent clocks. Returns gap statistics per clock over `ms` of
  // wall time. Median rather than mean throughout: one GC pause must not be
  // allowed to redefine a cadence.
  const clocks = (ms) => page.evaluate((windowMs) => new Promise((done) => {
    const series = { raf: [], timer: [], port: [], slow: [] };
    const rafStamps = [];
    let last = { raf: 0, timer: 0, port: 0, slow: 0 };
    const now = () => performance.now();
    const stop = now() + windowMs;
    let live = 4;
    const finish = () => { if (--live === 0) done(pack()); };

    const tick = (k) => {
      const t = now();
      if (last[k]) series[k].push(t - last[k]);
      last[k] = t;
      return t < stop;
    };

    const rafLoop = (stamp) => {
      rafStamps.push(stamp);
      if (tick('raf')) requestAnimationFrame(rafLoop); else finish();
    };
    requestAnimationFrame(rafLoop);

    const timerLoop = () => { if (tick('timer')) setTimeout(timerLoop, 0); else finish(); };
    setTimeout(timerLoop, 0);

    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (tick('port')) ch.port2.postMessage(0); else finish(); };
    ch.port2.postMessage(0);

    const slowLoop = () => { if (tick('slow')) setTimeout(slowLoop, 1000); else finish(); };
    setTimeout(slowLoop, 1000);

    function stat(v) {
      if (!v.length) return { n: 0 };
      const s = v.slice().sort((a, b) => a - b);
      return {
        n: s.length,
        min: +s[0].toFixed(3),
        median: +s[s.length >> 1].toFixed(3),
        p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(3),
        max: +s[s.length - 1].toFixed(3),
      };
    }
    function pack() {
      // The rAF TIMESTAMP argument, differenced, beside the performance.now()
      // deltas of the same callbacks. If those two disagree the clock is the
      // fault and not the cadence.
      const stampGaps = [];
      for (let i = 1; i < rafStamps.length; i += 1) stampGaps.push(rafStamps[i] - rafStamps[i - 1]);
      return {
        raf: stat(series.raf),
        rafStamp: stat(stampGaps),
        timer: stat(series.timer),
        port: stat(series.port),
        slow: stat(series.slow),
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      };
    }
  }), ms);

  const report = (label, c) => {
    out.states.push({ label, ...c });
    console.log(`\n-- ${label} --   visibility=${c.visibility} focused=${c.focused}`);
    for (const k of ['raf', 'rafStamp', 'timer', 'port', 'slow']) {
      const s = c[k];
      console.log(`   ${k.padEnd(9)} n=${String(s.n).padStart(5)}  median ${String(s.median).padStart(9)} ms`
        + `  min ${String(s.min).padStart(8)}  p95 ${String(s.p95).padStart(9)}  max ${String(s.max).padStart(9)}`);
    }
    // THE CONTROL, checked every time rather than once: the instrument must be
    // able to tell a known-fast queue from a known-1 Hz one.
    if (!(c.port.median < 5)) {
      fail(`${label}: the MessageChannel control read ${c.port.median} ms — this histogram cannot see a fast queue, so nothing else in this table is evidence`);
    }
    if (!(c.slow.median > 900 && c.slow.median < 1200)) {
      fail(`${label}: the setTimeout(1000) control read ${c.slow.median} ms — this histogram cannot see a 1 Hz series either`);
    }
  };

  // Facts the page cannot see: is there a real display, is the window really
  // visible, and did the GPU fall back to software.
  out.host = await page.electronApp.evaluate(({ screen, BrowserWindow, app }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const st = app.getGPUFeatureStatus ? app.getGPUFeatureStatus() : null;
    return {
      displays: screen.getAllDisplays().map((d) => ({
        id: d.id, bounds: d.bounds, scale: d.scaleFactor,
        refresh: d.displayFrequency ?? null, internal: d.internal, monochrome: d.monochrome,
      })),
      visible: win.isVisible(),
      minimized: win.isMinimized(),
      focused: win.isFocused(),
      alwaysOnTop: win.isAlwaysOnTop(),
      backgroundThrottling: win.webContents.backgroundThrottling ?? null,
      gpu: st,
      switches: {
        occluded: app.commandLine.hasSwitch('disable-backgrounding-occluded-windows'),
        backgrounding: app.commandLine.hasSwitch('disable-renderer-backgrounding'),
        frameRateLimit: app.commandLine.hasSwitch('disable-frame-rate-limit'),
        gpuVsync: app.commandLine.hasSwitch('disable-gpu-vsync'),
      },
    };
  });
  console.log('displays:', JSON.stringify(out.host.displays));
  console.log('window: visible=' + out.host.visible + ' minimized=' + out.host.minimized
    + ' focused=' + out.host.focused + ' alwaysOnTop=' + out.host.alwaysOnTop
    + ' backgroundThrottling=' + out.host.backgroundThrottling);
  console.log('switches:', JSON.stringify(out.host.switches));
  console.log('gl status:', out.host.gpu ? out.host.gpu.gpu_compositing + ' / webgl=' + out.host.gpu.webgl2 : 'n/a');

  // STATE 1: the menu. No 3D scene, no render loop of the game's — whatever
  // this reads is the window's own cadence with nothing asked of the GPU.
  report('MENU, before any 3D', await clocks(6000));

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // STATE 2: in play, the game's own loop running beside these four.
  report('IN PLAY, game loop live', await clocks(6000));

  // What the game's own loop thinks it did over the same kind of window — read
  // from its diagnostics rather than inferred, so the two accounts can disagree
  // out loud.
  out.gameLoop = await page.evaluate(() => new Promise((done) => {
    const app = window.__fw;
    const read = () => (app.frameLoopDiagnostics ? app.frameLoopDiagnostics.callbackCount : null);
    const a = read(); const t0 = performance.now();
    setTimeout(() => {
      const b = read(); const dt = performance.now() - t0;
      done({ frames: b - a, ms: +dt.toFixed(1), msPerFrame: b > a ? +(dt / (b - a)).toFixed(2) : null });
    }, 6000);
  }));
  console.log(`\ngame loop diagnostics: ${out.gameLoop.frames} frames in ${out.gameLoop.ms} ms`
    + ` = ${out.gameLoop.msPerFrame} ms/frame`);

  fs.writeFileSync(`${OUT}/forensics.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
