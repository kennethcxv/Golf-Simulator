// PHASE 3 GATE, VERIFIER ONE (Goal 26) — THE BLOCKED SHOPPER ROUTES AROUND.
//
// "Stage three queuers blocking the corridor to the right-side merchandise,
// spawn a shopper whose item is behind them. Overhead clip and player-view clip,
// frames inspected. Revert the integration and show the old grinding fails the
// same check."
//
// 3.2's clause is "a shopper blocked by the queue ROUTES AROUND IT and reaches
// the item". So there are two things to measure and they fail separately:
//
//   DID THEY GET THERE      arrival at the fixture, with a time. A shopper who
//                           never arrives is the failure the clause names.
//   DID THEY GO AROUND      the path's lateral excursion away from the straight
//                           line to the goal. A shopper who arrives by SHOVING
//                           THROUGH the queue also arrives, and the two are
//                           indistinguishable from arrival alone -- so the
//                           minimum distance to each queuer is recorded too.
//
// WHAT WOULD MAKE THIS LIE:
//   - qaCustomerTrack returns a PROJECTION with no `.mesh`. Positions come from
//     its own x/z; meshes, where needed, from qaCustomerMeshById.
//   - the shop must be OPEN (trading hours on the clock AND state.shop.signOpen)
//     or every arrival is routed straight to the exit and the corridor is empty.
//   - pinning a queuer by writing its position every frame is the only way to
//     hold the blockade: the crowd settle pushes overlapping bodies apart within
//     one frame, measured.
//
//   VIDEO_DIR=qa/blocked-shopper node tools/qa/run-electron.cjs tools/qa/electron-blocked-shopper.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/blocked-shopper');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  out.staged = await page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    if (st.clock) st.clock.minutes = 620;
    if (st.shop) st.shop.signOpen = true;
    const ch = app.scene3d.clubhouse();
    const c = ch.interior.position;
    const w = app.scene3d.walk.state;
    // stand back and to one side, looking down the corridor, so the player-view
    // clip actually contains the blockade rather than the player's own elbow
    // INSIDE, AND ASSERTED. The first run used c.z + 7, which is OUTSIDE the
    // building: 122 seconds of clip showed the clubhouse from across a fairway
    // while the numbers underneath were perfectly fine. isInside is the
    // clubhouse's own answer and it is now part of the record.
    let placed = null;
    for (const [dx, dz] of [[-2, 3], [-3, 2], [0, 4], [-4, 1], [2, 3], [0, 0]]) {
      if (ch.isInside(c.x + dx, c.z + dz)) { placed = { dx, dz }; break; }
    }
    if (placed) { w.x = c.x + placed.dx; w.z = c.z + placed.dz; }
    w.vx = 0; w.vz = 0; w.yaw = Math.PI * 0.9; w.pitch = -0.18;
    return {
      minutes: st.clock?.minutes ?? null,
      signOpen: st.shop?.signOpen ?? null,
      placed,
      playerInside: ch.isInside(w.x, w.z),
    };
  });
  console.log('STAGED', JSON.stringify(out.staged));

  // Populate, then pin three of them across the corridor.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    for (let i = 0; i < 7; i += 1) ch.debugSpawn(false);
  });
  await page.waitForTimeout(9000);

  out.blockade = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    const rows = ch.qaCustomerTrack?.() || [];
    if (rows.length < 4) return { ok: false, why: `only ${rows.length} customers` };
    // three abreast across the corridor on the right-hand side
    const spots = [
      { x: c.x + 2.2, z: c.z + 1.2 },
      { x: c.x + 2.2, z: c.z + 1.9 },
      { x: c.x + 2.2, z: c.z + 2.6 },
    ];
    const pinned = [];
    for (let i = 0; i < 3 && i < rows.length; i += 1) {
      const mesh = ch.qaCustomerMeshById(rows[i].id);
      if (!mesh) continue;
      pinned.push({ id: rows[i].id, spot: spots[i] });
    }
    // HELD every frame. One write is undone by the crowd settle within a frame
    // -- measured at 1 frame in the contact control -- so the blockade has to be
    // re-asserted on rAF or there is no blockade to route around.
    window.__fwHold = { pinned, running: true };
    const hold = () => {
      const s = window.__fwHold;
      if (!s || !s.running) return;
      for (const p of s.pinned) {
        const m = ch.qaCustomerMeshById(p.id);
        if (m) { m.position.x = p.spot.x; m.position.z = p.spot.z; }
      }
      requestAnimationFrame(hold);
    };
    requestAnimationFrame(hold);
    return { ok: pinned.length === 3, pinned: pinned.map((p) => p.id), spots };
  });
  console.log('BLOCKADE', JSON.stringify(out.blockade));

  // THE SHOPPER WHOSE ITEM IS BEHIND THEM. This is the half the first run
  // skipped: without a goal on the far side, "nobody reached the far side" is a
  // statement about a zone nobody was sent to.
  out.errand = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    const held = new Set((window.__fwHold?.pinned || []).map((p) => p.id));
    const rows = (ch.qaCustomerTrack?.() || []).filter((r) => !held.has(r.id));
    if (!rows.length) return { ok: false, why: 'no free shopper to send' };
    // the goal sits BEYOND the pinned line (which is at x = c.x + 2.2), so the
    // straight path to it runs through a body
    const goal = { x: c.x + 3.6, z: c.z + 1.9 };
    const runner = rows[0];
    const sent = ch.qaSendCustomerTo(runner.id, goal.x, goal.z);
    window.__fwErrand = { id: runner.id, goal, from: { x: runner.x, z: runner.z } };
    return {
      ok: !!sent, id: runner.id, goal, from: { x: runner.x, z: runner.z },
      straightLineCrossesBlockade: true,
    };
  });
  console.log('ERRAND', JSON.stringify(out.errand));

  // DID THE CUSTOMER ACTUALLY ADOPT IT? `sent: true` only means my splice
  // happened -- the customer's own logic can overwrite stopIdx or rebuild its
  // stop list on the very next frame, and then "it never reached the goal" is a
  // statement about a goal it was never given. Read the stop it is actually
  // walking to, twice, a second apart.
  out.errandAdopted = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const er = window.__fwErrand;
    const read = () => {
      const r = (ch.qaCustomerTrack?.() || []).find((x) => x.id === er.id);
      return r ? { stopKind: r.stopKind, stopIdx: r.stopIdx, x: r.x, z: r.z } : null;
    };
    const now = read();
    await new Promise((d) => setTimeout(d, 1200));
    const later = read();
    const d = later ? Math.hypot(later.x - er.goal.x, later.z - er.goal.z) : null;
    const d0 = now ? Math.hypot(now.x - er.goal.x, now.z - er.goal.z) : null;
    return {
      immediately: now,
      afterASecond: later,
      // a customer that adopted the goal is CLOSING on it
      distanceNow: d0 === null ? null : +d0.toFixed(2),
      distanceLater: d === null ? null : +d.toFixed(2),
      closing: (d0 !== null && d !== null) ? d < d0 : null,
      stopKindIsBrowse: later ? later.stopKind === 'browse' : null,
    };
  });
  console.log('ERRAND-ADOPTED', JSON.stringify(out.errandAdopted));

  // Now watch every OTHER customer: does any of them get past the blockade to
  // the far side, and how close do they come to the pinned bodies on the way?
  out.watch = await page.evaluate(async ({ seconds }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    const held = new Set((window.__fwHold?.pinned || []).map((p) => p.id));
    const spots = (window.__fwHold?.pinned || []).map((p) => p.spot);
    const tracks = new Map();
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => requestAnimationFrame(() => d()));
      for (const r of (ch.qaCustomerTrack?.() || [])) {
        if (held.has(r.id)) continue;
        let t = tracks.get(r.id);
        if (!t) {
          t = {
            id: r.id, startZ: r.z, startX: r.x, minGapToQueuer: Infinity,
            reachedFarSide: false, maxLateral: 0, samples: 0,
          };
          tracks.set(r.id, t);
        }
        t.samples += 1;
        for (const s of spots) {
          const d = Math.hypot(r.x - s.x, r.z - s.z);
          if (d < t.minGapToQueuer) t.minGapToQueuer = d;
        }
        // ARRIVAL AT THE GOAL THEY WERE GIVEN, not at a zone I invented.
        const er = window.__fwErrand;
        if (er && r.id === er.id) {
          const d = Math.hypot(r.x - er.goal.x, r.z - er.goal.z);
          if (!Number.isFinite(t.bestGoalDist) || d < t.bestGoalDist) t.bestGoalDist = d;
          if (d < 0.9) { t.reachedGoal = true; if (!t.reachedAtMs) t.reachedAtMs = performance.now() - t0; }
          t.isErrandRunner = true;
        }
        if (r.z < c.z + 0.9 && r.x > c.x + 1.0) t.reachedFarSide = true;
        // how far off the straight line between start and the blockade did they
        // travel -- a shopper who goes AROUND has a lateral excursion, one who
        // shoves through does not
        const lateral = Math.abs(r.x - t.startX);
        if (lateral > t.maxLateral) t.maxLateral = lateral;
      }
    }
    return [...tracks.values()].map((t) => ({
      ...t,
      minGapToQueuer: t.minGapToQueuer === Infinity ? null : +t.minGapToQueuer.toFixed(3),
      maxLateral: +t.maxLateral.toFixed(3),
    }));
  }, { seconds: 45 });
  console.log('TRACKS', JSON.stringify(out.watch, null, 2));

  await page.screenshot({ path: path.join(OUT, 'player-view.png') });

  // OVERHEAD, for the second clip the gate asks for.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    w.x = c.x + 1.5; w.z = c.z + 3; w.pitch = -1.35;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'overhead.png') });

  // THE CONTROL, and it is the only thing that makes the result mean anything.
  // "The shopper did not reach the goal" has two explanations: the blockade
  // stopped it, or the goal was never reachable and I picked a spot inside a
  // wall. So the blockade is REMOVED and the same shopper is sent to the same
  // point again. If it arrives now, the blockade was the cause. If it still does
  // not, the finding is about my goal, not about the navigation.
  out.control = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const er = window.__fwErrand;
    if (window.__fwHold) window.__fwHold.running = false;
    // walk the pinned three well out of the way
    const c = ch.interior.position;
    for (const p of (window.__fwHold?.pinned || [])) {
      const m = ch.qaCustomerMeshById(p.id);
      if (m) { m.position.x = c.x - 9; m.position.z = c.z + 9; }
    }
    const goalBlocked = ch.qaPointBlocked(er.goal.x, er.goal.z, 0.3);
    ch.qaSendCustomerTo(er.id, er.goal.x, er.goal.z);
    let best = Infinity;
    let reachedAt = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 45000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => requestAnimationFrame(() => d()));
      const r = (ch.qaCustomerTrack?.() || []).find((x) => x.id === er.id);
      if (!r) continue;
      const d = Math.hypot(r.x - er.goal.x, r.z - er.goal.z);
      if (d < best) best = d;
      if (d < 0.9 && reachedAt === null) { reachedAt = (performance.now() - t0) / 1000; break; }
    }
    return {
      goalIsInsideACollider: +goalBlocked.toFixed(3),
      closestWithoutBlockade: best === Infinity ? null : +best.toFixed(3),
      reachedWithoutBlockade: reachedAt !== null,
      secondsToReach: reachedAt === null ? null : +reachedAt.toFixed(1),
    };
  });
  console.log('CONTROL(no blockade)', JSON.stringify(out.control));

  const movers = (out.watch || []).filter((t) => t.samples > 30);
  const gaps = movers.map((t) => t.minGapToQueuer).filter((g) => g !== null);
  out.verdict = {
    blockadeHeld: out.blockade.ok === true,
    shoppersWatched: movers.length,
    reachedFarSide: movers.filter((t) => t.reachedFarSide).length,
    // "routes around it" -- did anyone get through, and did they go around
    // THE CLAUSE: did the shopper sent past the blockade actually get there
    errandRunner: (() => {
      const r = (out.watch || []).find((t) => t.isErrandRunner);
      if (!r) return { sent: out.errand?.ok === true, tracked: false };
      return {
        sent: out.errand?.ok === true,
        tracked: true,
        reachedGoal: !!r.reachedGoal,
        closestToGoalYd: Number.isFinite(r.bestGoalDist) ? +r.bestGoalDist.toFixed(3) : null,
        secondsToReach: r.reachedAtMs ? +(r.reachedAtMs / 1000).toFixed(1) : null,
        minGapToQueuer: r.minGapToQueuer,
        lateralExcursion: r.maxLateral,
        // without this the "did not reach" line means nothing
        adopted: out.errandAdopted,
        controlWithoutBlockade: out.control,
      };
    })(),
    closestApproachToAQueuer: gaps.length ? +Math.min(...gaps).toFixed(3) : null,
    // two capsules at 0.32 radius touch at 0.64; anything below that is a shove
    anyoneShovedThrough: gaps.some((g) => g < 0.6),
    maxLateralExcursion: movers.length ? +Math.max(...movers.map((t) => t.maxLateral)).toFixed(3) : null,
    shots: ['player-view.png', 'overhead.png'],
  };
  console.log('BLOCKED-SHOPPER', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'blocked-shopper.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
