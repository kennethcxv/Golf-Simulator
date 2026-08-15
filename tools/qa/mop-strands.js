// ITEM 8 — "Mop fibres are rigid. Strands must trail, splay on the floor, and
// swing behind."
//
// Three claims, three measurements, all on the strand TIPS in world space
// because that is the only place the effect exists:
//
//   they exist     the head carries separate strand meshes, not one cone
//   they move      tip positions change across a stroke
//   they TRAIL     the tips reach their extreme LATER than the head does
//
// The third is the one that separates yarn from a rigid brush. A rigid head's
// tips peak on the same frame as the head; trailing yarn peaks after it.
//
// Negative control: sampled at rest, the same tips must be still. If they drift
// while nothing is happening, "they move while sweeping" measures noise.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-strands');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.46;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.mouse.click(W / 2, H / 2);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('mop'));
  // NOT broomDiagnostics().vmActive: that accessor addresses the BROOM's rig
  // instance, and with the mop equipped the broom rig is inactive, so the wait
  // could only ever time out. Wait for the mop's own strand rig to exist.
  await page.waitForFunction(() => {
    const app = window.__fw;
    let scan = app.scene3d.scene || app.scene3d.camera;
    while (scan && scan.parent) scan = scan.parent;
    return !!scan?.getObjectByName?.('MopStrandRig');
  }, null, { timeout: 60000 });
  await page.waitForTimeout(2800);

  // per-frame recorder: the head's swing, and the world X of two tips
  await page.evaluate(() => {
    const app = window.__fw;
    const V = app.scene3d.camera.position.constructor;
    window.__mopTrack = [];
    window.__mopRec = false;
    window.__mopProbe = () => {
      const scene = app.scene3d.scene || app.scene3d.camera;
      let scan = scene;
      while (scan && scan.parent) scan = scan.parent;
      const rig = scan?.getObjectByName?.('MopStrandRig') || null;
      const tips = [];
      const roots = [];
      if (rig) {
        rig.traverse((o) => {
          if (!o.isMesh) return;
          if (/^MopStrand_\d+_2$/.test(o.name || '')) tips.push(o);
          if (/^MopStrand_\d+_0$/.test(o.name || '')) roots.push(o);
        });
      }
      // TRAIL is measured INSIDE one strand: segment 0 hangs from the collar,
      // segment 2 is the tip. On a rigid head both move together; on yarn the
      // tip reaches its extreme later. That needs no rig diagnostics at all,
      // which matters because the mop's rig is not the one broomDiagnostics
      // reports on.
      const worldX = (o) => +o.getWorldPosition(new V()).x.toFixed(5);
      // MEASURE THE STRAND, NOT THE TOOL. World-space tip motion is dominated
      // by the whole mop swinging, and by the rig's idle bob and breathe: at
      // rest the tips still travelled 8 mm in world X purely because the tool
      // does. The strand's own bend is the tip's offset from its OWN root, so
      // that is what everything below reads.
      // ...and in the RIG's OWN frame, on all three axes. An X-only reading
      // sees whatever share of the swing happens to line up with world X and
      // reported 13.6 mm of a bend that is mostly elsewhere.
      const rel = [];
      const local = [];
      for (let i = 0; i < Math.min(tips.length, roots.length, 3); i += 1) {
        rel.push(+(worldX(tips[i]) - worldX(roots[i])).toFixed(5));
        const p = tips[i].getWorldPosition(new V());
        rig.worldToLocal(p);
        local.push([+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5)]);
      }
      return {
        rigFound: !!rig,
        strandMeshes: (() => { let n = 0; rig?.traverse((o) => { if (o.isMesh) n += 1; }); return n; })(),
        tipCount: tips.length,
        rootX: roots.length ? worldX(roots[0]) : null,
        tipX: tips.slice(0, 3).map(worldX),
        rel,
        local,
      };
    };
    const tick = () => {
      if (window.__mopRec && window.__mopTrack.length < 900) {
        const p = window.__mopProbe();
        p.t = performance.now();
        window.__mopTrack.push(p);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const record = async (seconds) => {
    await page.evaluate(() => { window.__mopTrack = []; window.__mopRec = true; });
    await page.waitForTimeout(seconds * 1000);
    await page.evaluate(() => { window.__mopRec = false; });
    return page.evaluate(() => window.__mopTrack);
  };

  const shape = await page.evaluate(() => window.__mopProbe());

  // CONTROL: at rest
  const atRest = await record(2.5);
  await page.screenshot({ path: path.join(OUT, '01-mop-at-rest.png') });

  // and mopping
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
  await page.waitForTimeout(900);
  const sweeping = await record(4.0);
  await page.screenshot({ path: path.join(OUT, '02-mop-mid-stroke.png') });
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));

  const span = (track, pick) => {
    const v = track.map(pick).filter(Number.isFinite);
    return v.length ? +(Math.max(...v) - Math.min(...v)).toFixed(5) : 0;
  };
  // when did the head peak, and when did the tip peak?
  const peakIndex = (track, pick) => {
    let best = -Infinity; let at = -1;
    track.forEach((s, i) => { const v = pick(s); if (Number.isFinite(v) && v > best) { best = v; at = i; } });
    return at;
  };
  const use = sweeping.slice(Math.floor(sweeping.length * 0.25));
  // the tool's own motion, and the strand's bend, kept apart
  const toolPeak = peakIndex(use, (s) => s.rootX);
  const bendPeak = peakIndex(use, (s) => s.rel?.[0]);
  // the widest distance between any two sampled tip positions, in the rig's
  // own frame: the true amplitude of the strand's travel
  const travel = (track) => {
    const pts = track.map((s) => s.local?.[0]).filter(Boolean);
    let worst = 0;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
        if (d > worst) worst = d;
      }
    }
    return +worst.toFixed(5);
  };
  const restBendSpan = travel(atRest);
  const sweepBendSpan = travel(use);
  const restTipSpan = span(atRest, (s) => s.tipX[0]);
  const sweepTipSpan = span(use, (s) => s.tipX[0]);

  const checks = {
    strandsExist: shape.rigFound === true && shape.tipCount >= 10,
    manyStrandMeshes: shape.strandMeshes >= 30,
    // the control: the strand barely bends at rest
    strandsRelaxedAtRest: restBendSpan < 0.010,
    // and bends a great deal more under a stroke
    strandsBendWhileMopping: sweepBendSpan > restBendSpan * 3 && sweepBendSpan > 0.02,
    // and they TRAIL: the bend's extreme lands after the tool's own
    strandsTrailTheTool: toolPeak >= 0 && bendPeak >= 0 && bendPeak > toolPeak,
    recordedEnough: use.length > 60,
    noPageErrors: errs.length === 0,
  };
  const out = {
    shape,
    restTipSpan,
    sweepTipSpan,
    restBendSpan,
    sweepBendSpan,
    toolPeakFrame: toolPeak,
    bendPeakFrame: bendPeak,
    framesRest: atRest.length,
    framesSweep: sweeping.length,
    sample: use.filter((_, i) => i % 12 === 0).map((s) => ({ rootX: s.rootX, bend: s.rel?.[0] })),
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'mop-strands.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
