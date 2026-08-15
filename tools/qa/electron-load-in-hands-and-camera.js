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
    // SAMPLED AT rAF, NOT ON A TIMER. The held tool changes on frame
    // boundaries and the deferred warm holds its dustpan for exactly three
    // frames -- 12 ms at 240 Hz. A 50 ms setInterval is three to twelve times
    // too coarse to see that, and the first version of this probe reported "no
    // unasked-for span" about a warm that had drawn one and put it back between
    // two of its own samples.
    const s = { samples: [], t0: performance.now(), running: true };
    window.__loadProbe = s;
    const tick = () => {
      const fw = window.__fw;
      const veil = document.querySelector('.load-veil');
      const walk = fw?.scene3d?.walk;
      // getTool, NOT tool. `walk.tool` does not exist on the facade; reading it
      // returned undefined for every sample and the first version of this probe
      // reported "no tool was ever held" through its own planted dustpan.
      // src/main.js's deferred warm reads the same non-existent accessor.
      let tool = null;
      try { tool = typeof walk?.getTool === 'function' ? walk.getTool() : 'NO-ACCESSOR'; } catch { tool = 'ERR'; }
      let active = null;
      try { active = typeof walk?.isActive === 'function' ? walk.isActive() : null; } catch { active = 'ERR'; }
      const cam = fw?.scene3d?.camera?.position;
      // walk.active is TRUE from early in startGameNow, long before the walk
      // camera owns the frame -- enterWalk() runs before prewarm, and prewarm
      // then swings the camera up over the course. So the question "is the map
      // on screen" has to be asked of the CAMERA's distance from the player,
      // not of a flag that is already true.
      const ws = fw?.scene3d?.walk?.state;
      const camFromPlayer = (cam && ws && Number.isFinite(ws.x))
        ? +Math.hypot(cam.x - ws.x, cam.z - ws.z).toFixed(2) : null;
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
        camFromPlayer,
      });
      if (s.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    s.stop = () => { s.running = false; return s.samples; };
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
  out.warm = await page.evaluate(() => (window.__fwWarm ? { ...window.__fwWarm } : null));
  console.log(`DEFERRED WARM reported: ${JSON.stringify(out.warm)}`);

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
  // The walk camera is AT the player. Anything 20+ yd away is the course view.
  const AWAY_YD = 20;
  const visible = samples.filter((s) => s.screen === 'game'
    && (s.veilDisplay === 'none' || (s.veil !== null && s.veil < 0.98)));
  const seenAsMap = visible.filter((s) => s.camFromPlayer === null || s.camFromPlayer > AWAY_YD);
  const lastAway = samples.filter((s) => s.camFromPlayer !== null && s.camFromPlayer > AWAY_YD).pop();
  out.mapFlash = {
    visibleSamples: visible.length,
    visibleSamplesShowingTheMap: seenAsMap.length,
    firstVisibleT: visible[0]?.t ?? null,
    lastSampleWithCameraAwayT: lastAway?.t ?? null,
    lastSampleWithCameraAwayCamY: lastAway?.camY ?? null,
    firstVisibleCamFromPlayer: visible[0]?.camFromPlayer ?? null,
    // How much slack there was: camera home BEFORE the veil started lifting is
    // positive, camera still out over the course when it lifted is negative.
    marginMs: (visible[0]?.t != null && lastAway?.t != null) ? visible[0].t - lastAway.t : null,
    worst: seenAsMap.slice(0, 6),
  };
  console.log('\nMAP BEFORE THE WALK CAMERA (camera-to-player distance, not the walk.active flag)');
  console.log(`  last sample with the camera out over the course: t=${out.mapFlash.lastSampleWithCameraAwayT} ms (camY ${out.mapFlash.lastSampleWithCameraAwayCamY})`);
  console.log(`  first sample with the veil not opaque          : t=${out.mapFlash.firstVisibleT} ms (camera ${out.mapFlash.firstVisibleCamFromPlayer} yd from the player)`);
  console.log(`  visible samples still showing the course view  : ${out.mapFlash.visibleSamplesShowingTheMap}`);
  console.log(`  margin (camera home before the veil lifted)    : ${out.mapFlash.marginMs} ms`);
  for (const s of out.mapFlash.worst) console.log(`    t=${s.t} veil=${s.veil} camY=${s.camY} camFromPlayer=${s.camFromPlayer}`);

  fs.writeFileSync(path.join(OUT, 'samples.json'), `${JSON.stringify(samples, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${path.join(OUT, 'result.json')} (${samples.length} samples)`);
  return out;
}
