// BLOCK A — SMOOTHNESS AT "144Hz": THE PANEL, THE CAP, AND THE VARIANCE.
//
// "What refresh rate is the panel ACTUALLY running? Your probe once said 120
//  when I said 240 — trust the OS, not the probe."
//
// So this asks the OS twice, from two vantages that cannot both be the probe's
// opinion: Windows' own WMI (run outside, in the report) and ELECTRON'S screen
// API for the display the game window is actually on. Then it measures pacing.
//
// WHAT IS MEASURED, per cap leg (60 / 144 / uncapped), with W HELD and the mouse
// SWEEPING — real input, sim live, owner resolution, 2,000+ frames:
//
//   median / p95 / p99 / worst            frame INTERVAL
//   jitter = mean |Δinterval|             the roughness number. Average fps
//                                         cannot see this; a 5.5/11 ms sawtooth
//                                         and a flat 8.2 ms have the same mean.
//   cadence hit %                         intervals within 15% of the target
//   0.5 ms histogram                      vsync-locked shows spikes at multiples
//   bake frames vs the rest               A2: does every 10th (shadow) frame run
//                                         long? post.stats().shadowBakes says
//                                         which frames those were.
//
// CONTROLS (golf-qa law 1):
//   - The uncapped leg is the control for the capped ones: if uncapped shows the
//     same jitter, the cap is not the mechanism and A1 is answered NO.
//   - frameCapDiagnostics() is recorded per leg, so the cap's OWN belief about
//     the panel (panelHz, everyNVsyncs, effectiveFps) can be compared against
//     what Electron says the display is. Those disagreeing IS a finding.
//   - Frame counts are asserted: a leg with under 2,000 samples is reported as
//     void rather than quietly averaged.
//
//   node tools/qa/run-electron.cjs tools/qa/goal33-a1-pacing.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'a1-pacing', errs: [], failures: [], legs: {} };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(5000);
  out.ownerResolution = await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  // ---- THE DISPLAY, FROM ELECTRON (the OS), NOT FROM THE GAME LOOP ----------
  out.display = await page.electronApp.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    const bounds = win ? win.getBounds() : null;
    const on = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();
    const describe = (d) => ({
      id: d.id,
      bounds: d.bounds,
      size: d.size,
      scaleFactor: d.scaleFactor,
      displayFrequency: d.displayFrequency ?? null,
      rotation: d.rotation,
      internal: d.internal,
      label: d.label ?? null,
    });
    return {
      windowBounds: bounds,
      windowFullscreen: win ? win.isFullScreen() : null,
      windowMaximized: win ? win.isMaximized() : null,
      windowIsOn: describe(on),
      all: screen.getAllDisplays().map(describe),
    };
  });
  console.log('DISPLAY', JSON.stringify(out.display.windowIsOn));

  out.canvas = await page.evaluate(() => {
    const r = window.__fw.scene3d.renderer;
    const gl = r.getContext();
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      rendererPixelRatio: r.getPixelRatio(),
      drawingBuffer: { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight },
      screen: { w: window.screen.width, h: window.screen.height },
    };
  });
  console.log('CANVAS', JSON.stringify(out.canvas));

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(600);

  // ---- the sampler: interval + which frames baked shadows -------------------
  await page.evaluate(() => {
    window.__pace = {
      start(label) {
        const s = {
          label, on: true, t: [], bake: [], rendered: [], last: performance.now(), lastBakes: -1,
        };
        window.__paceRun = s;
        const stats = window.__fw.scene3d.post?.stats;
        const tick = () => {
          if (!s.on) return;
          const now = performance.now();
          s.t.push(now);
          // WHICH TICKS THE PLAYER ACTUALLY SAW. Under a cap the declined ticks
          // still fire rAF, so tick intervals are not frame intervals.
          s.rendered.push(window.__fw.frameCapDiagnostics().renderedFrames ?? 0);
          let baked = 0;
          if (stats) {
            const b = stats().shadowBakes ?? 0;
            if (s.lastBakes >= 0 && b > s.lastBakes) baked = b - s.lastBakes;
            s.lastBakes = b;
          }
          s.bake.push(baked);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      stop() {
        const s = window.__paceRun;
        if (!s) return null;
        s.on = false;
        return { label: s.label, t: s.t, bake: s.bake, rendered: s.rendered };
      },
    };
  });

  const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
  const stat = (xs, targetMs) => {
    if (xs.length < 2) return null;
    const sorted = xs.slice().sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    let jitter = 0;
    for (let i = 1; i < xs.length; i += 1) jitter += Math.abs(xs[i] - xs[i - 1]);
    jitter /= Math.max(1, xs.length - 1);
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    return {
      n: xs.length,
      fps: +(1000 / mean).toFixed(1),
      median: +quant(sorted, 0.5).toFixed(2),
      p95: +quant(sorted, 0.95).toFixed(2),
      p99: +quant(sorted, 0.99).toFixed(2),
      worst: +sorted[sorted.length - 1].toFixed(2),
      mean: +mean.toFixed(2),
      stddev: +Math.sqrt(variance).toFixed(3),
      jitterMs: +jitter.toFixed(3),
      onCadencePct: targetMs
        ? +(100 * xs.filter((x) => Math.abs(x - targetMs) <= targetMs * 0.15).length / xs.length).toFixed(1)
        : null,
    };
  };
  const analyse = (t, bake, rendered, targetMs) => {
    // Drop the first two: the sampler's own first interval and the frame the
    // cap change landed on are not the steady state being measured.
    const times = t.slice(2);
    const bs = bake.slice(2);
    const rd = rendered.slice(2);
    const xs = [];
    for (let i = 1; i < times.length; i += 1) xs.push(times[i] - times[i - 1]);
    // THE NUMBER THAT MATTERS: intervals between frames that were DRAWN.
    const presentedTimes = [];
    for (let i = 1; i < rd.length; i += 1) if (rd[i] > rd[i - 1]) presentedTimes.push(times[i]);
    const presented = [];
    for (let i = 1; i < presentedTimes.length; i += 1) {
      presented.push(presentedTimes[i] - presentedTimes[i - 1]);
    }
    const presentedStats = stat(presented, targetMs);
    const sorted = xs.slice().sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    let jitter = 0;
    for (let i = 1; i < xs.length; i += 1) jitter += Math.abs(xs[i] - xs[i - 1]);
    jitter /= Math.max(1, xs.length - 1);
    const hist = {};
    for (const x of xs) {
      const bin = (Math.floor(x * 2) / 2).toFixed(1);
      hist[bin] = (hist[bin] || 0) + 1;
    }
    const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([ms, n]) => ({ ms: +ms, n, pct: +(100 * n / xs.length).toFixed(1) }));
    const onCadence = targetMs
      ? xs.filter((x) => Math.abs(x - targetMs) <= targetMs * 0.15).length / xs.length : null;
    // A2 — the shadow cadence, measured on PRESENTED intervals: an interval is a
    // "bake interval" when a shadow bake happened anywhere inside it.
    const bakeIntervals = [];
    const plainIntervals = [];
    let pendingBake = 0;
    let lastPresented = null;
    for (let i = 1; i < rd.length; i += 1) {
      pendingBake += bs[i] || 0;
      if (rd[i] > rd[i - 1]) {
        if (lastPresented != null) {
          (pendingBake > 0 ? bakeIntervals : plainIntervals).push(times[i] - lastPresented);
        }
        lastPresented = times[i];
        pendingBake = 0;
      }
    }
    const med = (arr) => {
      if (!arr.length) return null;
      const s = arr.slice().sort((a, b) => a - b);
      return +s[s.length >> 1].toFixed(2);
    };
    return {
      // headline = what the player saw
      presented: presentedStats,
      // secondary = every rAF tick, including the ones the cap declined
      ticks: {
        frames: xs.length,
        fps: +(1000 / mean).toFixed(1),
        median: +quant(sorted, 0.5).toFixed(2),
        p95: +quant(sorted, 0.95).toFixed(2),
        p99: +quant(sorted, 0.99).toFixed(2),
        worst: +sorted[sorted.length - 1].toFixed(2),
        stddev: +Math.sqrt(variance).toFixed(3),
        jitterMs: +jitter.toFixed(3),
        onCadencePct: onCadence == null ? null : +(onCadence * 100).toFixed(1),
        topBins: top,
      },
      shadow: {
        bakeIntervals: bakeIntervals.length,
        medianBakeIntervalMs: med(bakeIntervals),
        medianPlainIntervalMs: med(plainIntervals),
        p95BakeIntervalMs: bakeIntervals.length
          ? +quant(bakeIntervals.slice().sort((a, b) => a - b), 0.95).toFixed(2) : null,
      },
      raw: { times: times.slice(0, 9000), rendered: rd.slice(0, 9000) },
    };
  };

  // ---- one leg: set the cap through the real settings path, then PLAY -------
  // `input:false` runs the same sampler with NOBODY TOUCHING ANYTHING. It is the
  // environment control: the first version of this driver dispatched synthetic
  // mouse moves in an unpaced loop and every leg came back at ~1 fps with a
  // 1,036 ms p99. That was the harness starving the renderer, not the game, and
  // without a quiet leg in the same boot it reads exactly like a catastrophic
  // frame-time regression. A quiet leg near the panel interval says the machine
  // is fine and the input legs are measuring the game.
  const leg = async (capValue, label, targetMs, ms, { input = true, minFrames = 2000 } = {}) => {
    await page.evaluate((c) => window.__fw.preferences.set('display.fpsCap', c), capValue);
    await page.waitForTimeout(2500); // let the cap settle and the panel be re-measured
    await page.evaluate((l) => window.__pace.start(l), label);
    const cx = Math.round(vp.w / 2);
    const cy = Math.round(vp.h / 2);
    const t0 = Date.now();
    if (input) {
      await page.keyboard.down('w');
      let dir = 1;
      // A real sweep. `steps` batches the deltas into one dispatch instead of one
      // CDP round trip per pixel, and the await between sweeps keeps the input
      // rate near a real gaming mouse rather than saturating the channel.
      while (Date.now() - t0 < ms) {
        await page.mouse.move(cx + dir * 320, cy, { steps: 24 });
        await page.waitForTimeout(30);
        await page.mouse.move(cx, cy, { steps: 24 });
        await page.waitForTimeout(30);
        dir *= -1;
      }
      await page.keyboard.up('w');
    } else {
      while (Date.now() - t0 < ms) await page.waitForTimeout(250);
    }
    const raw = await page.evaluate(() => window.__pace.stop());
    const capDiag = await page.evaluate(() => window.__fw.frameCapDiagnostics());
    const info = await page.evaluate(() => {
      const i = window.__fw.scene3d.renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? null };
    });
    const shot = path.join(OUT, `a1-${label}.png`);
    await page.screenshot({ path: shot });
    const stats = analyse(raw.t, raw.bake, raw.rendered, targetMs);
    const P = stats.presented;
    if (!P) fail(`leg ${label}: no presented frames reconstructed — void`);
    else {
      if (P.n < minFrames) fail(`leg ${label}: only ${P.n} PRESENTED frames (asked for ${minFrames}+) — leg is void`);
      if (P.median > 100) {
        fail(`leg ${label}: median presented interval ${P.median} ms — the window is being throttled, `
          + 'this leg measures the harness and not the game');
      }
    }
    const row = {
      cap: capValue, targetMs, ...stats, frameCap: capDiag, renderer: info, screenshot: shot,
    };
    out.legs[label] = row;
    console.log(`LEG ${label}`, JSON.stringify({
      cap: capValue,
      presented: P,
      ticksMedian: stats.ticks.median,
      ticksJitter: stats.ticks.jitterMs,
      capBelief: capDiag,
      topTickBins: stats.ticks.topBins.slice(0, 4),
      shadow: stats.shadow,
    }));
    return row;
  };

  const LEG_MS = Number(process.env.QA_LEG_MS || 42000);
  await leg(0, 'quiet-control', null, 12000, { input: false, minFrames: 400 });
  await leg(60, 'cap60', 1000 / 60, LEG_MS);
  await leg(144, 'cap144', 1000 / 144, LEG_MS);
  await leg(0, 'uncapped', null, LEG_MS);

  // restore the shipped default so the profile is not left altered
  await page.evaluate(() => window.__fw.preferences.set('display.fpsCap', 60));

  // ---- the verdict A1 asks for ---------------------------------------------
  const c60 = out.legs.cap60;
  const c144 = out.legs.cap144;
  const unc = out.legs.uncapped;
  out.answer = {
    panelHzFromElectron: out.display.windowIsOn.displayFrequency,
    panelHzTheCapBelieves: c60?.frameCap?.panelHz ?? null,
    capDividesPanel: (out.display.windowIsOn.displayFrequency && c60)
      ? +(out.display.windowIsOn.displayFrequency / 60).toFixed(3) : null,
    quietControl: out.legs['quiet-control']?.presented ?? null,
    jitter: {
      cap60: c60?.presented?.jitterMs,
      cap144: c144?.presented?.jitterMs,
      uncapped: unc?.presented?.jitterMs,
    },
    fps: {
      cap60: c60?.presented?.fps, cap144: c144?.presented?.fps, uncapped: unc?.presented?.fps,
    },
    p99: {
      cap60: c60?.presented?.p99, cap144: c144?.presented?.p99, uncapped: unc?.presented?.p99,
    },
    p99UnderTargetAt144: c144?.presented ? c144.presented.p99 < 6.9 : null,
  };
  fs.writeFileSync(path.join(OUT, 'a1-pacing.json'), JSON.stringify(out, null, 2));
  console.log('A1', JSON.stringify(out.answer, null, 2));
  if (out.failures.length) process.exitCode = 1;
  return out;
}
