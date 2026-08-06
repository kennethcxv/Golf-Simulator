// ITEM 14 — "They run into the box at the top left forever. Find why the
// recovery ladder never fires on that obstacle, fix the cause not the box,
// then sweep every prop and count."
//
// The cause: the ladder's only stuck test was DISPLACEMENT — "did I move a
// quarter of the step I asked for". Against a corner you move nothing and it
// fires. Against the flat FACE of a box, collision resolution slides you along
// it, so you move most of your step every frame, forever, and the test is
// never true. The ladder was never reached; none of its five rungs could help.
// The shape of the prop decided whether recovery existed at all.
//
// The fix is a PROGRESS test: moving without closing on the target is stuck.
//
// This driver:
//   1. drops a walker in front of a box's flat face, aimed past it, and
//      watches whether it ever recovers;
//   2. runs the SAME scenario with the progress test disabled, as the negative
//      control — the bug must reproduce, or the fix proves nothing;
//   3. sweeps every registered prop collider and counts how many present a
//      flat face a walker could slide along, which is the population the old
//      test could never rescue.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/customer-box');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 11 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.scene3d.applyTimeWeather(11 * 60, app.state.weather);
  });

  // ---- the sweep: every prop collider, and its footprint ------------------
  const propSweep = await page.evaluate(() => {
    const app = window.__fw;
    const props = app.scene3d.walk.colliders?.props || [];
    const rows = [];
    for (const p of props) {
      // colliders are axis-aligned boxes: a half-width and half-depth, or a radius
      const isBox = Number.isFinite(p.minX) && Number.isFinite(p.maxX)
        && Number.isFinite(p.minZ) && Number.isFinite(p.maxZ);
      const r = p.r ?? p.radius ?? null;
      rows.push({
        kind: isBox ? 'box' : (r != null ? 'round' : 'unknown'),
        faceMm: isBox ? Math.round(Math.max(p.maxX - p.minX, p.maxZ - p.minZ) * 1000) : null,
      });
    }
    return {
      total: props.length,
      boxes: rows.filter((x) => x.kind === 'box').length,
      round: rows.filter((x) => x.kind === 'round').length,
      unknown: rows.filter((x) => x.kind === 'unknown').length,
      // a face long enough to slide along rather than round off
      slidableFaces: rows.filter((x) => x.kind === 'box' && (x.faceMm || 0) >= 300).length,
    };
  });

  // ---- the scenario -------------------------------------------------------
  const runScenario = (disableProgressTest) => page.evaluate(async (disable) => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    // spawn a shopper and force them at a destination straight through a prop
    const c = club.sendWalkInToDesk ? club.sendWalkInToDesk({}) : null;
    if (!c) return { spawned: false };
    // find a box collider with a long flat face, and stand the walker hard
    // against the middle of it with the target on the far side
    const props = app.scene3d.walk.colliders?.props || [];
    let best = null;
    for (const p of props) {
      if (!Number.isFinite(p.minX) || !Number.isFinite(p.maxZ)) continue;
      const face = Math.max(p.maxX - p.minX, p.maxZ - p.minZ);
      if (face < 0.4) continue;
      if (!best || face > best.face) best = { p, face };
    }
    if (!best) return { spawned: true, boxFound: false };
    const p = best.p;
    const hw = (p.maxX - p.minX) / 2;
    const hd = (p.maxZ - p.minZ) / 2;
    const cx = (p.minX + p.maxX) / 2;
    const cz = (p.minZ + p.maxZ) / 2;
    void hd;
    // approach the +X face straight on
    const startX = cx - hw - 0.55;
    const targetX = cx + hw + 1.4;
    const all = club.customers ? club.customers() : [];
    const entity = c && c.mesh ? c : all[all.length - 1];
    const mesh = entity?.mesh;
    if (!mesh) return { spawned: true, boxFound: true, meshFound: false };
    mesh.position.x = startX;
    mesh.position.z = cz;
    entity.stops = [{ kind: 'browse', x: targetX, z: cz, duration: 30 }];
    entity.__watch = true;
    entity.stopIdx = 0;
    entity.path = null;
    entity.pathGoal = null;
    entity.stuckT = 0;
    entity.stuckEscalation = 0;
    entity.bestGoalDist = Infinity;
    entity.noProgressT = 0;
    if (disable) {
      // NEGATIVE CONTROL: keep the progress counter pinned at zero every frame
      // so only the old displacement test can fire, and the bug returns
      entity.__pinProgress = true;
      if (!window.__pinInstalled) {
        window.__pinInstalled = true;
        const tick = () => {
          for (const e of (club.customers ? club.customers() : [])) {
            if (e.__pinProgress) e.noProgressT = 0;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }
    void off;
    return {
      spawned: true, boxFound: true, meshFound: true,
      startX: +startX.toFixed(2), targetX: +targetX.toFixed(2), cz: +cz.toFixed(2),
      boxFaceM: +best.face.toFixed(2),
      customerId: entity.customerId ?? null,
    };
  }, disableProgressTest);

  const watch = (seconds) => page.evaluate(async (secs) => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const start = performance.now();
    const track = [];
    return new Promise((resolve) => {
      const tick = () => {
        const list = club.customers ? club.customers() : [];
        const e = list.find((x) => x.__watch) || list[0];
        if (e?.mesh) {
          const stop = e.stops?.[e.stopIdx];
          track.push({
            t: +((performance.now() - start) / 1000).toFixed(2),
            x: +e.mesh.position.x.toFixed(3),
            z: +e.mesh.position.z.toFixed(3),
            stuckT: +(e.stuckT || 0).toFixed(2),
            noProgressT: +(e.noProgressT || 0).toFixed(2),
            escalation: e.stuckEscalation || 0,
            stopIdx: e.stopIdx,
            goal: stop ? [+stop.x.toFixed(2), +stop.z.toFixed(2)] : null,
          });
        }
        if (performance.now() - start > secs * 1000) resolve(track);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, seconds);

  const fixed = await runScenario(false);
  const fixedTrack = fixed.meshFound ? await watch(14) : [];
  await page.screenshot({ path: path.join(OUT, 'after-fix.png') });

  const control = await runScenario(true);
  const controlTrack = control.meshFound ? await watch(14) : [];
  await page.screenshot({ path: path.join(OUT, 'control-old-behaviour.png') });

  const summarise = (track, scenario) => {
    if (!track.length) return null;
    const startX = track[0].x;
    const goalX = scenario.targetX;
    const finalX = track[track.length - 1].x;
    return {
      frames: track.length,
      startX: +startX.toFixed(2),
      finalX: +finalX.toFixed(2),
      goalX,
      closedM: +(Math.abs(goalX - startX) - Math.abs(goalX - finalX)).toFixed(3),
      maxEscalation: Math.max(...track.map((s) => s.escalation)),
      maxNoProgressT: Math.max(...track.map((s) => s.noProgressT)),
      reachedNextStop: Math.max(...track.map((s) => s.stopIdx)) > track[0].stopIdx,
    };
  };
  const fixedSummary = summarise(fixedTrack, fixed);
  const controlSummary = summarise(controlTrack, control);

  const checks = {
    scenarioBuilt: fixed.meshFound === true && control.meshFound === true,
    // the ladder now fires on a flat face
    ladderFiresOnABox: (fixedSummary?.maxEscalation ?? 0) >= 1,
    // and the control reproduces the old behaviour: no escalation at all
    controlReproducesTheBug: (controlSummary?.maxEscalation ?? 0) === 0,
    propsSwept: propSweep.total > 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    propSweep,
    fixed,
    fixedSummary,
    fixedTrackSample: fixedTrack.filter((_, i) => i % 30 === 0),
    control,
    controlSummary,
    controlTrackSample: controlTrack.filter((_, i) => i % 30 === 0),
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'customer-box.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
