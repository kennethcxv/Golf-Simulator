// A3 — WHERE THE FRAME GOES, ON HIS RESOLUTION, WHILE WALKING.
//
// A1 measured the shape: at cap 60 / 144 / uncapped the game presents 55-62 fps
// with a median near 14-16 ms and a p95 near 28-35 ms, and the cap is INERT
// (skippedTicks 0 in every leg). So the roughness is frame COST and its tail,
// not the cap. This driver attributes the cost by removing one thing at a time
// and re-measuring the same walk.
//
// The ladder, each leg identical input (W held, mouse sweeping), same spot:
//   baseline          everything on, his settings
//   renderScale 0.6   fewer pixels, same everything else -> GPU-bound share
//   ao off            GTAO is a half-res pass but it is not free
//   shadows off       the 10 Hz fitted bake AND the per-frame shadow draws
//   post off          the whole composer chain
//
// A leg that does not move the median is not the cost. A leg that halves it is.
//
// CONTROL: the baseline is measured TWICE, first and last, so drift across the
// run (thermals, time of day in the sim, a customer walking in) is visible as
// the gap between two legs that should agree. Without that, any single leg's
// improvement could be the shop being emptier.
//
//   node tools/qa/run-electron.cjs tools/qa/goal33-a3-attribution.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'a3-attribution', errs: [], failures: [], legs: {} };
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
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(600);

  out.settingsBefore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fw.preferences.values.display)));
  console.log('SETTINGS', JSON.stringify(out.settingsBefore));

  await page.evaluate(() => {
    window.__pace = {
      start() {
        const s = { on: true, t: [], rendered: [] };
        window.__paceRun = s;
        const tick = () => {
          if (!s.on) return;
          s.t.push(performance.now());
          s.rendered.push(window.__fw.frameCapDiagnostics().renderedFrames ?? 0);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      stop() {
        const s = window.__paceRun;
        if (!s) return null;
        s.on = false;
        return { t: s.t, rendered: s.rendered };
      },
    };
  });

  const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
  const analyse = (t, rendered) => {
    const times = t.slice(2);
    const rd = rendered.slice(2);
    const presentedTimes = [];
    for (let i = 1; i < rd.length; i += 1) if (rd[i] > rd[i - 1]) presentedTimes.push(times[i]);
    const xs = [];
    for (let i = 1; i < presentedTimes.length; i += 1) xs.push(presentedTimes[i] - presentedTimes[i - 1]);
    if (xs.length < 50) return null;
    const sorted = xs.slice().sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    let jitter = 0;
    for (let i = 1; i < xs.length; i += 1) jitter += Math.abs(xs[i] - xs[i - 1]);
    return {
      n: xs.length,
      fps: +(1000 / mean).toFixed(1),
      median: +quant(sorted, 0.5).toFixed(2),
      p95: +quant(sorted, 0.95).toFixed(2),
      p99: +quant(sorted, 0.99).toFixed(2),
      worst: +sorted[sorted.length - 1].toFixed(2),
      jitterMs: +(jitter / Math.max(1, xs.length - 1)).toFixed(3),
    };
  };

  const leg = async (label, apply, ms = 16000) => {
    if (apply) await page.evaluate(apply);
    await page.waitForTimeout(2500);
    const buffer = await page.evaluate(() => {
      const gl = window.__fw.scene3d.renderer.getContext();
      return { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight };
    });
    await page.evaluate(() => window.__pace.start());
    await page.keyboard.down('w');
    const cx = Math.round(vp.w / 2);
    const cy = Math.round(vp.h / 2);
    const t0 = Date.now();
    let dir = 1;
    while (Date.now() - t0 < ms) {
      await page.mouse.move(cx + dir * 320, cy, { steps: 24 });
      await page.waitForTimeout(30);
      await page.mouse.move(cx, cy, { steps: 24 });
      await page.waitForTimeout(30);
      dir *= -1;
    }
    await page.keyboard.up('w');
    const raw = await page.evaluate(() => window.__pace.stop());
    const stats = analyse(raw.t, raw.rendered);
    const shot = path.join(OUT, `a3-${label}.png`);
    await page.screenshot({ path: shot });
    if (!stats) fail(`leg ${label}: too few presented frames`);
    out.legs[label] = { ...stats, buffer, screenshot: shot };
    console.log(`A3 ${label}`, JSON.stringify({ ...stats, buffer }));
    return stats;
  };

  await leg('baseline-1', null);
  await leg('renderscale-0.6', () => window.__fw.preferences.set('display.renderScale', 0.6));
  await leg('renderscale-back', () => window.__fw.preferences.set('display.renderScale', 1));
  await leg('ao-off', () => window.__fw.preferences.set('display.ambientOcclusion', false));
  await leg('shadows-off', () => window.__fw.preferences.set('display.shadows', false));
  await leg('post-off', () => window.__fw.preferences.set('display.postProcessing', false));
  // put everything back, then re-measure the baseline: the two must agree or the
  // ladder measured drift rather than the settings.
  await page.evaluate((before) => {
    const p = window.__fw.preferences;
    p.set('display.renderScale', before.renderScale);
    p.set('display.ambientOcclusion', before.ambientOcclusion);
    p.set('display.shadows', before.shadows);
    p.set('display.postProcessing', before.postProcessing);
  }, out.settingsBefore);
  await leg('baseline-2', null);

  out.settingsAfter = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fw.preferences.values.display)));
  const b1 = out.legs['baseline-1'];
  const b2 = out.legs['baseline-2'];
  if (b1 && b2 && Math.abs(b1.median - b2.median) > 3) {
    fail(`baseline drifted ${b1.median} -> ${b2.median} ms across the run; the ladder is not comparable`);
  }
  out.attribution = {
    baselineMedian: b1?.median ?? null,
    baselineRepeatMedian: b2?.median ?? null,
    savedByHalfPixels: b1 && out.legs['renderscale-0.6']
      ? +(b1.median - out.legs['renderscale-0.6'].median).toFixed(2) : null,
    savedByAoOff: b1 && out.legs['ao-off'] ? +(b1.median - out.legs['ao-off'].median).toFixed(2) : null,
    savedByShadowsOff: b1 && out.legs['shadows-off'] ? +(b1.median - out.legs['shadows-off'].median).toFixed(2) : null,
    savedByPostOff: b1 && out.legs['post-off'] ? +(b1.median - out.legs['post-off'].median).toFixed(2) : null,
  };
  fs.writeFileSync(path.join(OUT, 'a3-attribution.json'), JSON.stringify(out, null, 2));
  console.log('A3 ATTRIBUTION', JSON.stringify(out.attribution, null, 2));
  if (out.failures.length) process.exitCode = 1;
  return out;
}
