// PLAYTEST 5, P0 — TWO THINGS WRONG WITH LOADING IN.
//
//   "I start every game with a cleaning dustpan already in my hand. I never
//    equipped it. Nothing should be equipped on load."
//   "I see the map before I load in. The course/overview view is drawn for a
//    moment before the walk camera takes over."
//
// Both are TRANSIENTS, so both need a TIME SERIES. A single read of walk.tool()
// five seconds after boot answers "no tool" and would be a lie of the ordinary
// kind: the deferred GPU warm equips a dustpan 1600 ms after the scene is ready
// (src/main.js scheduleDeferredGpuWarm) and tries to put it back. Sampling once,
// after, cannot see that at all.
//
// So: poll the LIVE app every 50 ms from before the warm until well after it,
// recording the held tool, whether walk is active, the veil's opacity and the
// camera position. Then report the SPANS -- when a tool was held and for how
// long, and whether any frame was presented (veil transparent) while the walk
// camera was not yet driving.
//
// NEGATIVE CONTROL: mid-run the probe equips a tool itself for ~300 ms through
// the same walk.setTool the game uses, and the series must show a span of that
// tool at that time. A sampler that reports "never held anything" through a
// deliberately held tool cannot see the dustpan either.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-load-in-hands-and-camera.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/load-in');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // Start the sampler BEFORE the menu is dismissed: the map flash and the warm
  // both happen during and just after the load, so the recorder has to be older
  // than the thing it records.
  await page.evaluate(() => {
    const s = { samples: [], t0: performance.now(), timer: 0 };
    window.__loadProbe = s;
    s.timer = setInterval(() => {
      const fw = window.__fw;
      const veil = document.querySelector('.load-veil');
      const walk = fw?.scene3d?.walk;
      let tool = null;
      try { tool = typeof walk?.tool === 'function' ? walk.tool() : null; } catch { tool = 'ERR'; }
      let active = null;
      try { active = typeof walk?.isActive === 'function' ? walk.isActive() : null; } catch { active = 'ERR'; }
      const cam = fw?.scene3d?.camera?.position;
      s.samples.push({
        t: +(performance.now() - s.t0).toFixed(0),
        screen: fw?.screen ?? null,
        courseMode: fw?.courseMode ?? null,
        prewarming: fw?.prewarming ?? null,
        veil: veil ? +getComputedStyle(veil).opacity : null,
        veilDisplay: veil ? getComputedStyle(veil).display : 'absent',
        walkActive: active,
        tool,
        camY: cam ? +cam.y.toFixed(2) : null,
      });
    }, 50);
    s.stop = () => { clearInterval(s.timer); return s.samples; };
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });

  // Sit still well past the 1600 ms deferred warm and its 120 ms debounce.
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(OUT, '01-nine-seconds-after-load.png') });

  // --------------------------------------------------------- NEGATIVE CONTROL
  const controlAt = await page.evaluate(() => {
    const s = window.__loadProbe;
    const mark = +(performance.now() - s.t0).toFixed(0);
    window.__fw.scene3d.walk.setTool('dustpan');
    setTimeout(() => window.__fw.scene3d.walk.setTool(null), 300);
    return mark;
  });
  await page.waitForTimeout(1600);

  const samples = await page.evaluate(() => window.__loadProbe.stop());
  out.sampleCount = samples.length;

  // ------------------------------------------------------------------- spans
  const spans = [];
  let cur = null;
  for (const s of samples) {
    if (s.tool && s.tool !== 'ERR') {
      if (!cur || cur.tool !== s.tool) {
        if (cur) spans.push(cur);
        cur = { tool: s.tool, from: s.t, to: s.t };
      } else cur.to = s.t;
    } else if (cur) { spans.push(cur); cur = null; }
  }
  if (cur) spans.push(cur);
  out.toolSpans = spans.map((s) => ({ ...s, ms: s.to - s.from }));

  out.control = {
    markedAtMs: controlAt,
    spanSeenAfterMark: out.toolSpans.find((s) => s.from >= controlAt - 200) || null,
  };
  out.controlDetected = !!out.control.spanSeenAfterMark;
  console.log(`CONTROL held a dustpan at t=${controlAt} ms -> `
    + `${out.controlDetected ? `DETECTED as ${JSON.stringify(out.control.spanSeenAfterMark)} — sampler works`
      : 'MISSED — SAMPLER IS BLIND'}`);

  console.log('\nHELD-TOOL SPANS across the whole boot:');
  if (!out.toolSpans.length) console.log('  (none)');
  for (const s of out.toolSpans) console.log(`  ${String(s.tool).padEnd(10)} t=${s.from}..${s.to} ms  (${s.ms} ms held)`);
  out.unexplainedSpans = out.toolSpans.filter((s) => s.from < controlAt - 200);
  console.log(`\nSPANS THE PLAYER DID NOT ASK FOR (before the control mark): ${out.unexplainedSpans.length}`);
  for (const s of out.unexplainedSpans) console.log(`  >>> ${s.tool} held ${s.ms} ms at t=${s.from}`);

  // -------------------------------------------- the map before the walk camera
  // A frame the player SEES is one where the veil is not opaque. If any such
  // sample has the walk camera not yet driving, the overview was on screen.
  const visible = samples.filter((s) => s.screen === 'game'
    && (s.veilDisplay === 'none' || (s.veil !== null && s.veil < 0.98)));
  const seenBeforeWalk = visible.filter((s) => s.walkActive !== true);
  out.mapFlash = {
    visibleFrames: visible.length,
    framesVisibleBeforeWalkCamera: seenBeforeWalk.length,
    firstVisibleT: visible[0]?.t ?? null,
    firstWalkActiveT: samples.find((s) => s.walkActive === true)?.t ?? null,
    worst: seenBeforeWalk.slice(0, 6),
  };
  out.mapFlash.exposureMs = (out.mapFlash.firstWalkActiveT !== null && out.mapFlash.firstVisibleT !== null)
    ? out.mapFlash.firstWalkActiveT - out.mapFlash.firstVisibleT
    : null;
  console.log('\nMAP BEFORE THE WALK CAMERA');
  console.log(`  first sample with the veil not opaque: t=${out.mapFlash.firstVisibleT} ms`);
  console.log(`  first sample with the walk camera on : t=${out.mapFlash.firstWalkActiveT} ms`);
  console.log(`  samples visible-but-not-walking      : ${out.mapFlash.framesVisibleBeforeWalkCamera}`);
  if (out.mapFlash.exposureMs !== null) console.log(`  exposure                             : ${out.mapFlash.exposureMs} ms`);
  for (const s of out.mapFlash.worst) console.log(`    t=${s.t} veil=${s.veil} mode=${s.courseMode} walk=${s.walkActive} camY=${s.camY}`);

  fs.writeFileSync(path.join(OUT, 'samples.json'), `${JSON.stringify(samples, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${path.join(OUT, 'result.json')} (${samples.length} samples)`);
  return out;
}
