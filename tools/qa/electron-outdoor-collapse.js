// GOAL 27, PHASE 4 — THE OUTDOOR COLLAPSE, MEASURED ON THE MERGED TREE.
//
// The brief: 6.7 fps walking away from the clubhouse on an earlier build —
// 148 ms median, one 559 ms frame, 2745 draw calls, 8.6M triangles. Nobody
// has ever been asked to look at it. This looks at it: stations along the
// ray from the clubhouse toward the course centre, facing the open course,
// then a 30-second walking leg outward, sampling every rAF and reading the
// renderer's own draw/triangle counters mid-station.
//
// CONTROLS:
//   1. the INSIDE station is the known-good baseline — if the shop floor
//      reads like the fairway, the instrument (or the build) is broken and
//      nothing here is a vegetation finding;
//   2. a planted 150 ms busy-block must appear in its own tagged window.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-outdoor-collapse.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/outdoor-collapse');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fwWarm && window.__fwWarm.sweep !== 'pending', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  out.res = await boot.ownerResolution(page, page.electronApp);
  out.windowCaption = out.res.caption;

  // sampler: rAF deltas + per-second renderer.info reads inside a tagged window
  await page.evaluate(() => {
    const S = { window: null, results: {} };
    window.__oc = S;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (S.window) {
        const w = S.results[S.window];
        w.deltas.push(+dt.toFixed(1));
        if (now - w.lastInfoAt > 900) {
          const info = window.__fw.scene3d.renderer.info;
          w.infoSamples.push({ calls: info.render.calls, tris: info.render.triangles });
          w.lastInfoAt = now;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    S.begin = (name) => { S.results[name] = { deltas: [], infoSamples: [], lastInfoAt: 0 }; last = performance.now(); S.window = name; };
    S.end = () => { S.window = null; };
  });

  const stationStats = (r) => {
    const ds = [...r.deltas].sort((a, b) => a - b);
    const at = (q) => ds[Math.min(ds.length - 1, Math.floor(ds.length * q))] ?? null;
    const calls = r.infoSamples.map((s) => s.calls);
    const tris = r.infoSamples.map((s) => s.tris);
    return {
      frames: ds.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      maxMs: ds[ds.length - 1] ?? null,
      fpsMedian: ds.length ? +(1000 / at(0.5)).toFixed(1) : null,
      drawCalls: calls.length ? Math.round(calls.reduce((a, b) => a + b, 0) / calls.length) : null,
      triangles: tris.length ? Math.round(tris.reduce((a, b) => a + b, 0) / tris.length) : null,
    };
  };

  // geometry of the walk-out: from the interior origin toward the world origin
  // (fitSunShadow's full mode centres the course there)
  const geo = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const o = ch.interior.position;
    const h = Math.hypot(-o.x, -o.z) || 1;
    return { ox: o.x, oz: o.z, dirX: -o.x / h, dirZ: -o.z / h };
  });
  out.geo = geo;

  const putAt = (dist, faceOut) => page.evaluate(([g, d, face]) => {
    const w = window.__fw.scene3d.walk.state;
    w.x = g.ox + g.dirX * d;
    w.z = g.oz + g.dirZ * d;
    w.vx = 0; w.vz = 0;
    w.yaw = Math.atan2(-(face ? g.dirX : -g.dirX), -(face ? g.dirZ : -g.dirZ));
    w.pitch = -0.03;
  }, [geo, dist, faceOut]);

  const sampleStation = async (name, seconds) => {
    await page.waitForTimeout(1200); // let culling/shadow settle at the new pose
    await page.evaluate((n) => window.__oc.begin(n), name);
    await page.waitForTimeout(seconds * 1000);
    const r = await page.evaluate((n) => { window.__oc.end(); return window.__oc.results[n]; }, name);
    const s = stationStats(r);
    out[name] = s;
    console.log(`${name.padEnd(24)} median ${String(s.medianMs).padStart(6)} ms (${String(s.fpsMedian).padStart(5)} fps)  p95 ${String(s.p95Ms).padStart(6)}  max ${String(s.maxMs).padStart(7)}  ${String(s.drawCalls).padStart(5)} calls  ${String(s.triangles).padStart(9)} tris`);
    return s;
  };

  console.log(`window: ${out.windowCaption}`);
  // CONTROL 1: inside baseline
  await sampleStation('inside-shop', 6);
  await putAt(6, true);
  await sampleStation('door-6yd-facing-course', 6);
  await putAt(20, true);
  await sampleStation('out-20yd', 6);
  await putAt(45, true);
  await sampleStation('out-45yd', 6);
  await putAt(85, true);
  await sampleStation('out-85yd', 6);
  // ...and the same distant spot looking BACK at the clubhouse, so "the course
  // is expensive" and "being far away is expensive" can be told apart
  await putAt(85, false);
  await sampleStation('out-85yd-facing-shop', 6);

  // the walking leg: drive positions outward at ~walk pace for 30 s
  await putAt(4, true);
  await page.evaluate((g) => {
    window.__ocWalk = { on: true };
    const w = window.__fw.scene3d.walk.state;
    const step = () => {
      if (!window.__ocWalk.on) return;
      w.x += g.dirX * 0.045; // ~2.7 yd/s at 60 fps
      w.z += g.dirZ * 0.045;
      w.vx = g.dirX * 2.7; w.vz = g.dirZ * 2.7;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, geo);
  await page.evaluate(() => window.__oc.begin('walking-out-30s'));
  await page.waitForTimeout(30000);
  const walkR = await page.evaluate(() => {
    window.__ocWalk.on = false;
    window.__oc.end();
    const w = window.__fw.scene3d.walk.state;
    return { r: window.__oc.results['walking-out-30s'], endX: +w.x.toFixed(1), endZ: +w.z.toFixed(1) };
  });
  out['walking-out-30s'] = stationStats(walkR.r);
  out.walkEnd = { x: walkR.endX, z: walkR.endZ };
  const ws = out['walking-out-30s'];
  console.log(`${'walking-out-30s'.padEnd(24)} median ${String(ws.medianMs).padStart(6)} ms (${String(ws.fpsMedian).padStart(5)} fps)  p95 ${String(ws.p95Ms).padStart(6)}  max ${String(ws.maxMs).padStart(7)}  ${String(ws.drawCalls).padStart(5)} calls  ${String(ws.triangles).padStart(9)} tris`);
  await page.screenshot({ path: path.join(OUT, `${tag}-walk-end.png`) });

  // CONTROL 2: planted stall
  await page.evaluate(() => window.__oc.begin('control-stall'));
  await page.evaluate(() => { const t0 = performance.now(); while (performance.now() - t0 < 150) { /* planted */ } });
  await page.waitForTimeout(600);
  const ctl = await page.evaluate(() => { window.__oc.end(); return window.__oc.results['control-stall']; });
  const ctlMax = Math.max(...ctl.deltas);
  out.control_stall = ctlMax >= 140 ? `caught (${ctlMax.toFixed(1)} ms)` : `MISSED (${ctlMax.toFixed(1)}) — SAMPLER VOID`;
  const inside = out['inside-shop'];
  out.control_insideBaseline = inside.medianMs != null && inside.medianMs < 33
    ? `healthy (${inside.medianMs} ms median)` : `INSIDE IS ALSO SLOW (${inside.medianMs} ms) — not a vegetation finding`;
  console.log(`CONTROL planted stall: ${out.control_stall}`);
  console.log(`CONTROL inside baseline: ${out.control_insideBaseline}`);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
