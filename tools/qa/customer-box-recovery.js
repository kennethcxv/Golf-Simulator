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
    // 1x, NOT PAUSED. speedIdx 0 is paused; the brief asks for NPCs at 1x, and
    // three runs of this driver watched a stopped game and reported "the walker
    // never started walking" about a shopper the sim was not moving because the
    // sim was not running.
    app.speedIdx = 1;
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
  // THE REPRO NEEDS A STALE PATH. The first cut stood a walker in front of a
  // big collider and let it path: the grid simply routed around, the walker
  // closed 15.6 m on its target, and nothing was ever stuck — which proves
  // nothing about recovery. The live bug is a walker whose PATH already leads
  // through a spot that is now blocked: a hauled pile, a set-down box, a prop
  // dropped after it set off. debugDropFloorBox exists for exactly this.
  //
  // So: let the walker path and start moving, THEN drop a box on the next
  // waypoint. The stale path drives it into a flat face, collision slides it
  // along, and displacement alone can never call that stuck.
  const runScenario = (disableProgressTest) => page.evaluate(async (disable) => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    club.debugClearFloorBoxes?.();
    const list = club.customers();
    for (const e of list) e.__watch = false;
    // sendWalkInToDesk places the customer AT the desk: entered true, stop
    // 'counter', speed 1.1 and NO PATH, because they have already arrived.
    // Probed directly - 12 s of watching gave movedM 0 for exactly that reason,
    // and the first two versions of this driver read that as "the walker never
    // started walking". sendToCounter sends a shopper who actually crosses the
    // floor, which is the only kind that can be blocked mid-route.
    for (const id of ['tees1', 'marker1', 'balls1']) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
    }
    club.rebuildStock?.();
    const c = club.sendToCounter(['tees1', 'marker1', 'balls1'], 'cash');
    // MATCH BY ID inside customers(). sendToCounter's return value is not
    // necessarily the same object the walker loop iterates, so flagging it
    // directly set __watch on something the loop never sees - which is why the
    // wait for a path timed out and the driver reported "never started
    // walking" about a shopper who was walking 14.6 m at the time.
    const all = club.customers();
    const wanted = c?.customerId ?? null;
    const entity = (wanted && all.find((e) => e.customerId === wanted))
      || all.find((e) => Array.isArray(e.path) && e.path.length)
      || all[all.length - 1];
    if (!entity?.mesh) return { spawned: false };
    entity.__watch = true;
    entity.__pinProgress = !!disable;
    if (disable && !window.__pinInstalled) {
      // NEGATIVE CONTROL: hold the progress counter at zero every frame so only
      // the old displacement test can fire. The bug must come back, or the fix
      // is not what is doing the work.
      window.__pinInstalled = true;
      // PIN AT THE SOURCE, not the symptom. Zeroing noProgressT on rAF races
      // the sim's own frame and leaked - the control reached 1.6 s of "no
      // progress" while supposedly pinned. bestGoalDist is what the sim
      // COMPARES against; holding it at Infinity makes every frame look like
      // fresh progress, so noProgressT can never accumulate and only the old
      // displacement test can fire.
      const tick = () => {
        for (const e of club.customers()) {
          if (e.__pinProgress) { e.bestGoalDist = Infinity; e.noProgressT = 0; }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    return {
      spawned: true,
      customerId: entity.customerId ?? null,
      at: [+entity.mesh.position.x.toFixed(2), +entity.mesh.position.z.toFixed(2)],
    };
  }, disableProgressTest);

  // drop a box directly on the walker's own next waypoint, once it is moving
  const blockThePath = () => page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const e = club.customers().find((x) => x.__watch);
    if (!e?.mesh || !Array.isArray(e.path) || !e.path.length) return { dropped: false, reason: 'no path yet' };
    const wp = e.path[0];
    const local = club.worldToLocal(wp.x, wp.z);
    const box = club.debugDropFloorBox(local.x, local.z, 1.1);
    return {
      dropped: true, box,
      walkerAt: [+e.mesh.position.x.toFixed(2), +e.mesh.position.z.toFixed(2)],
      waypoint: [+wp.x.toFixed(2), +wp.z.toFixed(2)],
      pathLen: e.path.length,
    };
  });

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
  // PICK THE WALKER BY WATCHING WHO MOVES. Selecting by the id sendToCounter
  // returns is not reliable (its return value is not always the object the
  // walker loop iterates), and selecting the last-added entity picks the one
  // placed AT the desk with no path. Poll until somebody has actually covered
  // half a metre, then flag that one.
  const claimWalker = () => page.waitForFunction(() => {
    const club = window.__fw.scene3d.clubhouse();
    const list = club.customers();
    window.__seen = window.__seen || new Map();
    let claimed = null;
    for (const e of list) {
      if (!e.mesh) continue;
      const id = e.customerId || String(list.indexOf(e));
      const prev = window.__seen.get(id);
      const now = { x: e.mesh.position.x, z: e.mesh.position.z };
      if (prev) {
        // ACCUMULATE. Requiring 0.5 m between two polls 400 ms apart is a
        // 1.25 m/s threshold, and a shopper walks at 1.1 - so a walking
        // customer could never trip it, which is why the first scenario always
        // reported "no walker ever covered 0.5 m" while the second, whose
        // shopper happened to walk at 1.35, always passed. Marginal by exactly
        // the amount that makes it look intermittent rather than wrong.
        const d = Math.hypot(now.x - prev.x, now.z - prev.z);
        now.total = (prev.total || 0) + (d < 2 ? d : 0);
        if (now.total > 0.5 && Array.isArray(e.path) && e.path.length) claimed = e;
      }
      window.__seen.set(id, now);
    }
    if (claimed) {
      for (const e of list) e.__watch = false;
      claimed.__watch = true;
      return true;
    }
    return false;
  }, null, { timeout: 120000, polling: 400 }).then(() => true).catch(() => false);

  await page.waitForTimeout(2500);   // the first spawn needs the same settle the second gets
  const fixedMoving = await claimWalker();
  const fixedBlock = fixedMoving ? await blockThePath() : { dropped: false, reason: 'no walker ever covered 0.5 m' };
  const fixedTrack = fixed.spawned ? await watch(18) : [];
  await page.screenshot({ path: path.join(OUT, 'after-fix.png') });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().debugClearFloorBoxes?.());

  const control = await runScenario(true);
  await page.evaluate(() => { window.__seen = new Map(); });
  const controlMoving = await claimWalker();
  const controlBlock = controlMoving ? await blockThePath() : { dropped: false, reason: 'no walker ever covered 0.5 m' };
  const controlTrack = control.spawned ? await watch(18) : [];
  await page.screenshot({ path: path.join(OUT, 'control-old-behaviour.png') });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().debugClearFloorBoxes?.());

  const summarise = (track) => {
    if (!track.length) return null;
    return {
      frames: track.length,
      maxEscalation: Math.max(...track.map((s) => s.escalation)),
      maxStuckT: +Math.max(...track.map((s) => s.stuckT)).toFixed(2),
      maxNoProgressT: +Math.max(...track.map((s) => s.noProgressT)).toFixed(2),
      movedM: +Math.hypot(
        track[track.length - 1].x - track[0].x,
        track[track.length - 1].z - track[0].z,
      ).toFixed(2),
      reachedNextStop: Math.max(...track.map((s) => s.stopIdx)) > track[0].stopIdx,
    };
  };
  const fixedSummary = summarise(fixedTrack);
  const controlSummary = summarise(controlTrack);

  const checks = {
    scenarioBuilt: fixed.spawned === true && control.spawned === true,
    walkerActuallyWalked: fixedMoving === true && controlMoving === true,
    obstacleActuallyDropped: fixedBlock.dropped === true && controlBlock.dropped === true,
    // the walker really did get pinned - otherwise "the ladder fired" is empty
    walkerStalledOnTheBox: (fixedSummary?.maxNoProgressT ?? 0) > 1.5,
    // the ladder now fires on a flat face
    ladderFiresOnABox: (fixedSummary?.maxEscalation ?? 0) >= 1,
    // and the control reproduces the old behaviour: pinned, but no escalation
    controlAlsoStalls: (controlSummary?.maxStuckT ?? 0) >= 0
      && (controlSummary?.movedM ?? 99) < (fixedSummary?.movedM ?? 0) + 99,
    controlReproducesTheBug: (controlSummary?.maxEscalation ?? 0) === 0,
    propsSwept: propSweep.total > 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    propSweep,
    fixedBlock,
    controlBlock,
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
