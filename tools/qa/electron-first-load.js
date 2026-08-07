// A1 — THE FIRST-LOAD INSTRUMENT. The goal's complaint is "worst on first
// load", and the fixed-pose profiler cannot see a boot transition by
// construction (Phase 2, R-D). This measures the load the player actually
// sits through, in segments, plus the first ten seconds of play — where
// first-encounter shader compiles and bakes land.
//
//   segments:
//     pageStart→menuReady     (boot manifest, menu enabled)
//     menuClick→walkActive    (scene build)
//     walkActive→veilGone     (the load veil's own fade gate)
//   then, for 10 s after the veil:
//     worst rAF delta, count of frames ≥ 33 ms (visibly dropped under vsync),
//     count ≥ 100 ms (a hitch anyone can feel), programs/triangles/drawCalls
//     at start vs end (compile churn attribution).
//
// Content assertion (R-D): a screenshot plus renderer.info triangles must
// show a real scene — an empty page profiles beautifully and lies.
// Negative control for the hitch counter: a deliberate 120 ms main-thread
// stall injected AFTER the clean window must be counted by the same
// instrument that graded the window (proves it can see what it claims to).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/first-load');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);

  // menu readiness = the moment clickThroughMenu can act
  const tMenuStart = await page.evaluate(() => performance.now());
  await boot.clickThroughMenu(page);
  const tClicked = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  const tWalk = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  const tVeil = await page.evaluate(() => performance.now());

  // the first ten seconds of PLAY, sampled from inside the page
  const firstTen = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const info = s3.renderer.info;
    const start = {
      programs: info.programs ? info.programs.length : null,
      triangles: info.render.triangles,
      calls: info.render.calls,
    };
    const deltas = [];
    let last = performance.now();
    const t0 = last;
    const loop = (t) => {
      deltas.push(t - last);
      last = t;
      if (t - t0 < 10000) requestAnimationFrame(loop);
      else {
        const sorted = deltas.slice(1).sort((a, b) => a - b);
        resolve({
          frames: deltas.length,
          worstMs: +Math.max(...deltas.slice(1)).toFixed(1),
          over33: deltas.filter((d) => d >= 33).length,
          over100: deltas.filter((d) => d >= 100).length,
          medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
          start,
          end: {
            programs: info.programs ? info.programs.length : null,
            triangles: info.render.triangles,
            calls: info.render.calls,
          },
        });
      }
    };
    requestAnimationFrame(loop);
  }));

  // content assertion: the scene is real
  const shotPath = path.join(OUT, 'first-load-scene.png');
  await page.screenshot({ path: shotPath });
  const { createRequire } = process.getBuiltinModule('node:module');
  const sharp = createRequire(`${process.cwd()}/`)('sharp');
  const { data, info } = await sharp(shotPath).raw().toBuffer({ resolveWithObject: true });
  let nonBg = 0;
  const total = Math.floor(data.length / info.channels / 9);
  for (let i = 0; i < data.length; i += info.channels * 9) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    if (r + g + b > 45 && !(r > 245 && g > 245 && b > 245)) nonBg += 1;
  }
  const contentFraction = +(nonBg / total).toFixed(3);

  // negative control: a deliberate 120 ms stall must be counted
  const control = await page.evaluate(() => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    let n = 0;
    const loop = (t) => {
      deltas.push(t - last);
      last = t;
      n += 1;
      if (n === 30) { const spin = performance.now(); while (performance.now() - spin < 120) { /* stall */ } }
      if (n < 90) requestAnimationFrame(loop);
      else resolve({ over100: deltas.filter((d) => d >= 100).length });
    };
    requestAnimationFrame(loop);
  }));

  const out = {
    segmentsMs: {
      menuReadyAt: +tMenuStart.toFixed(0),
      menuToWalkActive: +(tWalk - tClicked).toFixed(0),
      walkActiveToVeilGone: +(tVeil - tWalk).toFixed(0),
      pageStartToPlayable: +tVeil.toFixed(0),
    },
    firstTen,
    contentFraction,
    control,
    checks: {
      sceneReal: contentFraction > 0.25 && firstTen.end.triangles > 500000,
      controlSeesStall: control.over100 >= 1,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'first-load.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
