// PHASE 3 GATE, VERIFIER ONE — DID THE SHOPPER EVER ADOPT THE GOAL?
//
// The previous run reported "sent past the blockade, never got within 4.313 yd"
// and its own control reported 4.303 yd with the blockade REMOVED. Two numbers
// that close together, from two worlds that differ by three bodies, are not a
// finding about bodies. `sent: true` only means the splice landed.
//
// A STOP IS NOT A CONSTANT. Reading the stuck ladder settles what that pair of
// numbers means:
//
//   rung 4   `stop.x = open.x; stop.z = open.z` -- the walker's TARGET is moved
//            to the nearest cell the grid can deliver anyone to, up to 6 yd away
//   rung 5   `c.stopIdx += 1` -- the stop is abandoned outright
//
// So a customer sent to a point the grid cannot deliver to will walk to
// somewhere else entirely and stand there, perfectly content, while a driver
// holding the coordinates it asked for reports a walker that stopped short. The
// distance it prints is then the distance from the goal to the nearest OPEN
// FLOOR, and it will reproduce to three decimal places with or without a
// blockade -- which is exactly what happened.
//
// This asks three questions in the order that makes the answers mean something:
//
//   1. IS THE GOAL DELIVERABLE AT ALL, from the grid's own nearestOpenWorld --
//      the same call rung 4 uses. Asked BEFORE anyone is sent, so the answer
//      cannot be contaminated by the run.
//   2. DOES THE CUSTOMER STILL HOLD IT? The LIVE stop coordinates, sampled every
//      frame. If they move, the ladder moved them and the run is void.
//   3. ONLY THEN, did it arrive.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-errand-adoption.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/errand-adoption');
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
    let placed = null;
    for (const [dx, dz] of [[-2, 3], [-3, 2], [0, 4], [-4, 1], [2, 3], [0, 0]]) {
      if (ch.isInside(c.x + dx, c.z + dz)) { placed = { dx, dz }; break; }
    }
    if (placed) { w.x = c.x + placed.dx; w.z = c.z + placed.dz; }
    w.vx = 0; w.vz = 0; w.yaw = Math.PI * 0.9; w.pitch = -0.18;
    return { minutes: st.clock?.minutes ?? null, signOpen: st.shop?.signOpen ?? null, placed };
  });
  console.log('STAGED', JSON.stringify(out.staged));

  // QUESTION 1, AND IT IS ASKED BEFORE ANYBODY IS SENT ANYWHERE. The old goal
  // first, then a scan, so the verdict on the old run stands on the grid's
  // answer rather than on my reconstruction of it.
  out.goalSurvey = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    const theOldGoal = { x: c.x + 3.6, z: c.z + 1.9 };
    const survey = ch.qaNavOpenPoint(theOldGoal.x, theOldGoal.z, 8);
    // and a scan of the whole right-hand side, so a REACHABLE goal behind the
    // blockade line (x = c.x + 2.2) can be chosen on evidence instead of guessed
    const candidates = [];
    for (let dx = 2.6; dx <= 6.0; dx += 0.4) {
      for (let dz = -2.0; dz <= 4.0; dz += 0.4) {
        const p = ch.qaNavOpenPoint(c.x + dx, c.z + dz, 0.2);
        if (p.reachable && ch.isInside(c.x + dx, c.z + dz)) {
          candidates.push({ dx: +dx.toFixed(1), dz: +dz.toFixed(1), x: c.x + dx, z: c.z + dz });
        }
      }
    }
    return {
      theOldGoal,
      theOldGoalSurvey: survey,
      // if this is false, the previous run's 4.313 was never a routing result
      theOldGoalWasDeliverable: survey.reachable,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 40),
    };
  });
  console.log('GOAL-SURVEY old goal:', JSON.stringify(out.goalSurvey.theOldGoalSurvey),
    'deliverable:', out.goalSurvey.theOldGoalWasDeliverable,
    'reachable candidates behind the line:', out.goalSurvey.candidateCount);

  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    for (let i = 0; i < 7; i += 1) ch.debugSpawn(false);
  });
  // Long enough that several shoppers are actually INSIDE: the errand needs a
  // runner standing on the shop floor on the near side of the corridor, and at
  // nine seconds most of a fresh spawn is still crossing the car park.
  await page.waitForTimeout(25000);

  // Hold three bodies across the corridor, re-asserted on rAF -- one write is
  // undone by the crowd settle inside a single frame, measured.
  out.blockade = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    const rows = ch.qaCustomerTrack?.() || [];
    if (rows.length < 4) return { ok: false, why: `only ${rows.length} customers` };
    const spots = [
      { x: c.x + 2.2, z: c.z + 1.2 },
      { x: c.x + 2.2, z: c.z + 1.9 },
      { x: c.x + 2.2, z: c.z + 2.6 },
    ];
    const pinned = [];
    for (let i = 0; i < 3 && i < rows.length; i += 1) {
      if (ch.qaCustomerMeshById(rows[i].id)) pinned.push({ id: rows[i].id, spot: spots[i] });
    }
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

  // Send a free shopper to a goal the GRID says is deliverable, on the far side
  // of the pinned line, and as close to straight through it as the survey allows.
  out.errand = await page.evaluate((survey) => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    const held = new Set((window.__fwHold?.pinned || []).map((p) => p.id));
    const rows = (ch.qaCustomerTrack?.() || []).filter((r) => !held.has(r.id));
    if (!rows.length) return { ok: false, why: 'no free shopper to send' };
    // the blockade sits at x = c.x + 2.2 spanning z = c.z + 1.2 .. 2.6, so the
    // goal that most nearly forces a detour is the deliverable candidate closest
    // to the middle of that span and furthest past it
    const cands = survey.candidates || [];
    if (!cands.length) return { ok: false, why: 'the grid offered no deliverable point behind the line' };
    let pick = null;
    for (const q of cands) {
      const score = Math.abs(q.dz - 1.9) * 2 + Math.abs(q.dx - 3.4);
      if (!pick || score < pick.score) pick = { ...q, score };
    }
    const goal = { x: pick.x, z: pick.z };
    // THE RUNNER MUST BE INSIDE AND NEAR. `rows[0]` handed the errand to whoever
    // happened to be first in the array, which was a customer 17.4 yd away and
    // still out in the car park: it adopted the goal, held it for the full sixty
    // seconds at ladder rung 0, closed monotonically the whole time at 0.116
    // yd/s -- and the window expired with it still walking, 10.5 yd out. That
    // reads as "never reached the item" and is nothing of the kind. A blockade
    // three yards from the goal is also not being tested by somebody who never
    // gets near it.
    // ...and on the NEAR side of the pinned line (x < c.x + 2.2), or the straight
    // path to the goal never crosses the blockade and there is nothing to route
    // around.
    const inside = rows
      .filter((r) => ch.isInside(r.x, r.z) && r.x < c.x + 2.0)
      .map((r) => ({ r, d: Math.hypot(r.x - goal.x, r.z - goal.z) }))
      .sort((a, b) => a.d - b.d);
    if (!inside.length) return { ok: false, why: 'no free shopper is inside the building yet' };
    const runner = inside[0].r;
    const sent = ch.qaSendCustomerTo(runner.id, goal.x, goal.z);
    window.__fwErrand = { id: runner.id, goal, from: { x: runner.x, z: runner.z } };
    return {
      ok: !!sent,
      id: runner.id,
      goal,
      pick,
      from: { x: runner.x, z: runner.z },
      startDistanceToGoal: +inside[0].d.toFixed(2),
      insideCandidates: inside.length,
    };
  }, out.goalSurvey);
  console.log('ERRAND', JSON.stringify(out.errand));

  // QUESTION 2 AND 3 TOGETHER, every frame: does it still hold the goal, and did
  // it arrive. The two are sampled from the same frame so a relocation can never
  // be mistaken for a stall.
  out.watch = await page.evaluate(async ({ seconds }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const er = window.__fwErrand;
    if (!er) return { ok: false, why: 'nobody was sent' };
    const t0 = performance.now();
    let bestToAsked = Infinity;
    let bestToLive = Infinity;
    let arrivedAt = null;
    let maxGoalDrift = 0;
    let everRelocated = false;
    let everAbandoned = false;
    let maxRung = 0;
    let minGapToQueuer = Infinity;
    let maxLateral = 0;
    const spots = (window.__fwHold?.pinned || []).map((p) => p.spot);
    const trail = [];
    let lastKind = null;
    while (performance.now() - t0 < seconds * 1000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => requestAnimationFrame(() => d()));
      const r = (ch.qaCustomerTrack?.() || []).find((x) => x.id === er.id);
      if (!r) { everAbandoned = true; break; }
      lastKind = r.stopKind;
      if (Number.isFinite(r.stuckEscalation) && r.stuckEscalation > maxRung) maxRung = r.stuckEscalation;
      // THE GOAL AS THE CUSTOMER HOLDS IT, this frame
      if (r.stopX !== null && r.stopZ !== null) {
        const drift = Math.hypot(r.stopX - er.goal.x, r.stopZ - er.goal.z);
        if (drift > maxGoalDrift) maxGoalDrift = drift;
        if (drift > 0.05) everRelocated = true;
        const dLive = Math.hypot(r.x - r.stopX, r.z - r.stopZ);
        if (dLive < bestToLive) bestToLive = dLive;
      }
      // STOP THE MOMENT THE OUTCOME IS DECIDED. Abandonment IS the outcome, and
      // watching an extra ninety seconds after it only gives the runner time to
      // finish its route and walk out of the shop -- which is how the first run
      // of this control came back "the errand runner left the shop before the
      // control could run" and left the finding standing on one leg.
      if (r.stopKind !== 'browse') { everAbandoned = true; break; }
      const d = Math.hypot(r.x - er.goal.x, r.z - er.goal.z);
      if (d < bestToAsked) bestToAsked = d;
      // the game's own arrival test is dist < 0.18; 0.5 is generous to the build
      if (d < 0.5 && arrivedAt === null) arrivedAt = (performance.now() - t0) / 1000;
      for (const s of spots) {
        const g = Math.hypot(r.x - s.x, r.z - s.z);
        if (g < minGapToQueuer) minGapToQueuer = g;
      }
      const lat = Math.abs(r.x - er.from.x);
      if (lat > maxLateral) maxLateral = lat;
      if (trail.length < 400 && trail.length * 12 < (performance.now() - t0) / 10) {
        trail.push({
          t: +((performance.now() - t0) / 1000).toFixed(1),
          x: +r.x.toFixed(2), z: +r.z.toFixed(2),
          sx: r.stopX, sz: r.stopZ, kind: r.stopKind, rung: r.stuckEscalation,
        });
      }
      if (arrivedAt !== null) break;
    }
    return {
      ok: true,
      askedGoal: er.goal,
      closestToAskedGoal: bestToAsked === Infinity ? null : +bestToAsked.toFixed(3),
      closestToTheGoalITActuallyHELD: bestToLive === Infinity ? null : +bestToLive.toFixed(3),
      // the two facts that decide whether the previous run measured anything
      theGoalWasMovedUnderIt: everRelocated,
      howFarTheGoalMoved: +maxGoalDrift.toFixed(3),
      theStopWasAbandoned: everAbandoned,
      highestLadderRung: maxRung,
      lastStopKind: lastKind,
      arrivedSeconds: arrivedAt === null ? null : +arrivedAt.toFixed(1),
      minGapToQueuer: minGapToQueuer === Infinity ? null : +minGapToQueuer.toFixed(3),
      lateralExcursion: +maxLateral.toFixed(3),
      trail,
    };
  }, { seconds: 120 });
  console.log('WATCH', JSON.stringify({ ...out.watch, trail: `${out.watch.trail?.length ?? 0} samples` }, null, 2));
  if (out.watch.trail) for (const s of out.watch.trail.slice(0, 30)) console.log('  trail', JSON.stringify(s));

  await page.screenshot({ path: path.join(OUT, 'player-view.png') });

  // THE CONTROL, AND WITHOUT IT THE RESULT ABOVE IS NOT A FINDING. "Gave up
  // 1.9 yd short" has two explanations that look identical from the walker's
  // side: the three bodies were in the way, or this goal is one the shopper
  // would abandon in an empty shop too. So the blockade is removed and the SAME
  // customer is sent to the SAME point with the SAME instrumentation. Only the
  // pair of runs says anything.
  out.control = await page.evaluate(async ({ seconds }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const er = window.__fwErrand;
    if (!er) return { ok: false, why: 'nobody was sent' };
    if (window.__fwHold) window.__fwHold.running = false;
    const c = ch.interior.position;
    // walk the pinned three well out of the corridor
    for (const p of (window.__fwHold?.pinned || [])) {
      const m = ch.qaCustomerMeshById(p.id);
      if (m) { m.position.x = c.x - 9; m.position.z = c.z + 9; }
    }
    await new Promise((d) => setTimeout(d, 600));
    const stillHere = (ch.qaCustomerTrack?.() || []).find((x) => x.id === er.id);
    if (!stillHere) return { ok: false, why: 'the errand runner left the shop before the control could run' };
    const resent = ch.qaSendCustomerTo(er.id, er.goal.x, er.goal.z);
    const t0 = performance.now();
    let best = Infinity;
    let arrivedAt = null;
    let maxRung = 0;
    let abandoned = false;
    let drift = 0;
    while (performance.now() - t0 < seconds * 1000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => requestAnimationFrame(() => d()));
      const r = (ch.qaCustomerTrack?.() || []).find((x) => x.id === er.id);
      if (!r) { abandoned = true; break; }
      if (Number.isFinite(r.stuckEscalation) && r.stuckEscalation > maxRung) maxRung = r.stuckEscalation;
      if (r.stopKind !== 'browse') abandoned = true;
      if (r.stopX !== null && r.stopZ !== null) {
        const dr = Math.hypot(r.stopX - er.goal.x, r.stopZ - er.goal.z);
        if (dr > drift) drift = dr;
      }
      const d = Math.hypot(r.x - er.goal.x, r.z - er.goal.z);
      if (d < best) best = d;
      if (d < 0.5 && arrivedAt === null) { arrivedAt = (performance.now() - t0) / 1000; break; }
    }
    return {
      ok: true,
      resent: !!resent,
      startedFrom: { x: +stillHere.x.toFixed(2), z: +stillHere.z.toFixed(2) },
      closestWithoutBlockade: best === Infinity ? null : +best.toFixed(3),
      arrivedWithoutBlockade: arrivedAt !== null,
      secondsToArrive: arrivedAt === null ? null : +arrivedAt.toFixed(1),
      highestLadderRung: maxRung,
      stopAbandoned: abandoned,
      howFarTheGoalMoved: +drift.toFixed(3),
    };
  }, { seconds: 90 });
  console.log('CONTROL(no blockade)', JSON.stringify(out.control, null, 2));

  out.verdict = {
    // WHAT THE PREVIOUS RUN ACTUALLY MEASURED
    oldGoalDeliverableByTheGrid: out.goalSurvey.theOldGoalWasDeliverable,
    oldGoalNearestOpenFloorYd: out.goalSurvey.theOldGoalSurvey?.movedBy ?? null,
    // THIS RUN
    deliverableGoalsBehindTheLine: out.goalSurvey.candidateCount,
    goalSent: out.errand.ok === true,
    goalUsed: out.errand.goal ?? null,
    // `out.watch.arrivedSeconds !== null` was `undefined !== null`, i.e. TRUE, on
    // a run where nobody was sent anywhere -- the abort path printed
    // "arrived: true, arrivedSeconds: null" next to "goalSent: false".
    arrived: out.watch.ok === true && Number.isFinite(out.watch.arrivedSeconds),
    arrivedSeconds: out.watch.arrivedSeconds ?? null,
    closestToAskedGoal: out.watch.closestToAskedGoal ?? null,
    goalMovedUnderIt: out.watch.theGoalWasMovedUnderIt ?? null,
    howFarTheGoalMoved: out.watch.howFarTheGoalMoved ?? null,
    stopAbandoned: out.watch.theStopWasAbandoned ?? null,
    highestLadderRung: out.watch.highestLadderRung ?? null,
    minGapToQueuer: out.watch.minGapToQueuer ?? null,
    lateralExcursion: out.watch.lateralExcursion ?? null,
    // two capsules at r=0.30 touch at 0.60; below that is a shove, not a detour
    shovedThrough: out.watch.minGapToQueuer !== null && out.watch.minGapToQueuer < 0.6,
    control: out.control ?? null,
    // THE ONLY LINE THAT IS A FINDING. Blocked-and-failed on its own is not one;
    // blocked-and-failed WHILE clear-and-succeeded is.
    theBlockadeIsTheCause: !!(out.control?.ok && out.control.arrivedWithoutBlockade
      && out.watch.arrivedSeconds === null),
    bothRunsFailed: !!(out.control?.ok && !out.control.arrivedWithoutBlockade
      && out.watch.arrivedSeconds === null),
  };
  console.log('ERRAND-ADOPTION', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'errand-adoption.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
