// THE TWO SOLVERS, IN ONE BOOT, AGAINST THE SAME SHOP.
//
// Stage 2 of the nav rebuild (Designs/ProShop/NAV_RESEARCH.md §6). The question
// is not "is ORCA good" — it is "does the positional shoving stop", because the
// shoving is what the owner has been watching. The acceptance he set is the
// CORRECTIONS METER, not the overlap count:
//
//     before, five minutes of his save:  11.69 shoves/second, 7.56% of frames,
//                                        36.5 yd of unchosen displacement
//     target:                            under 0.5 shoves/second, zero hard contacts
//
// WHY BOTH LEGS IN ONE BOOT. Two separate runs are two different afternoons: a
// different arrival sequence, a different queue, a different amount of stock on
// the shelves. Half the numbers this project has argued about came from
// comparing runs that were never comparable. So the same session runs legacy
// first, then ORCA, with the watch reset between them — and legacy goes first on
// purpose, because it leaves the room tangled and ORCA then has to get people
// out of contacts it did not create.
//
// separate() and the recovery ladder are STILL PRESENT in this stage and are
// deliberately not removed: the point is to watch the correction meter fall on
// its own, which is what proves the velocities were already contact-free before
// anything pushed. They come out in stage 3.
//
//   VIDEO_DIR=qa/nav/ab QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/nav-solver-ab.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/nav');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'ab';
  const legMinutes = Number(process.env.QA_NAV_LEG_MINUTES || 2.5);
  const out = { tag, legMinutes, errs: [], failures: [], legs: {} };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const libUrl = (f) => `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/${f}`;
  const boot = await import(libUrl('qa-boot.mjs'));
  const aim = await import(libUrl('nav-aim.mjs'));

  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')]
        .find((c) => /\bContinue\b/.test(c.querySelector('.menu-action-label')?.textContent || c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 90000 }).catch(() => {});
  }
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  out.hasSolverSwitch = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    return typeof ch?.setCrowdSolver === 'function';
  });
  if (!out.hasSolverSwitch) {
    fail('this build has no crowd solver switch — nothing to A/B');
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  const { vp } = await aim.getInside(page, out);
  if (!out.inside) fail('never got inside — this is not the room he watches');
  await aim.installAim(page);
  out.firstAim = await aim.aimAtPeople(page, vp);
  await page.waitForTimeout(600);

  // Wait for a crowd. A leg measured against one customer says nothing about
  // people touching each other, and reporting it as clean is exactly the lie
  // this whole exercise is about.
  out.waitedForPeople = await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    return (ch?.customers?.() || []).filter((c) => c.mesh && c.mesh.visible !== false).length >= 2;
  }, null, { timeout: 240000 }).then(() => true).catch(() => false);
  if (!out.waitedForPeople) fail('never had two visible customers before the first leg');

  // THE PINCH. The organic legs are at the mercy of what the shop happens to do:
  // the five-minute before run shoved in BURSTS (436 frames in the first 15 s,
  // then ninety seconds of nothing, then 250 a sample for a minute), so a
  // two-minute leg that lands in a quiet stretch proves nothing about either
  // solver. This stages the stress instead of waiting for it: the visible
  // customers are placed on a ring around their own centroid, sized so the
  // closest pair starts at 0.80 yd — TIGHTER THAN ANYTHING THE SHOP PRODUCES ON
  // ITS OWN, and still legal, since the separation pass only treats under
  // 0.78 yd as a violation. So neither solver starts owing a correction, and
  // every shove that follows is a steering failure rather than something the
  // staging handed it. Then they walk to their own stops, through each other.
  const pinch = (gapYd) => page.evaluate((gap) => {
    const ch = window.__fw.scene3d.clubhouse();
    const live = (ch.customers() || []).filter((c) => c.mesh && c.mesh.visible !== false);
    if (live.length < 2) return { ok: false, why: 'fewer than two visible customers' };
    let cx = 0;
    let cz = 0;
    for (const c of live) { cx += c.mesh.position.x; cz += c.mesh.position.z; }
    cx /= live.length;
    cz /= live.length;
    const radius = gap / (2 * Math.sin(Math.PI / live.length));
    // PLACE THEM WHERE A BODY MAY LEGALLY STAND. The first version of this wrote
    // ring positions blind, dropped somebody inside the counter, and
    // resolveCustomer ejected them 0.76 yd into another customer on the next
    // frame — reported as a 0.04 yd interpenetration the game had not caused.
    // Nothing may be read off a stress the instrument itself created.
    let ejected = 0;
    live.forEach((c, i) => {
      const a = (i / live.length) * Math.PI * 2;
      const legal = ch.debugStandPoint(cx + Math.cos(a) * radius, cz + Math.sin(a) * radius);
      if (legal.moved > 1e-4) ejected += 1;
      c.mesh.position.x = legal.x;
      c.mesh.position.z = legal.z;
    });
    let minGap = Infinity;
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        minGap = Math.min(minGap, Math.hypot(
          live[i].mesh.position.x - live[j].mesh.position.x,
          live[i].mesh.position.z - live[j].mesh.position.z,
        ));
      }
    }
    return {
      ok: true,
      n: live.length,
      ejectedFromGeometry: ejected,
      // Ejecting two bodies off the same box face can close the gap below the
      // 0.78 the separation pass treats as a violation — which would hand the
      // solver a contact it did not create. Flagged, not silently averaged in.
      tooTight: minGap < 0.78,
      minGap: +minGap.toFixed(3),
      at: { x: +cx.toFixed(2), z: +cz.toFixed(2) },
    };
  }, gapYd);

  // STAND FAR ENOUGH BACK TO SEE IT. The pinch gathers everybody at their own
  // centroid, which is often a yard from the player — and the first clip of it
  // is a body filling the frame. Two customers being ON screen is not the same
  // as the crowd being LEGIBLE, and only the second one supports a verdict about
  // whether people touched. So the player backs off until the nearest customer
  // is a few yards away, and re-aims.
  const standOff = async (wantYd = 3.4) => {
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const near = await page.evaluate(() => {
        const w = window.__fw.scene3d.walk.state;
        const ch = window.__fw.scene3d.clubhouse();
        const live = (ch.customers() || []).filter((c) => c.mesh && c.mesh.visible !== false);
        if (!live.length) return 99;
        return Math.min(...live.map((c) => Math.hypot(c.mesh.position.x - w.x, c.mesh.position.z - w.z)));
      });
      if (near >= wantYd) return near;
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.down('s');
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(600);
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.up('s');
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(250);
    }
    return null;
  };

  // A LEG IS A WHOLE MODE, not just a solver. Stage 3 turns off the recovery
  // ladder and stops the separation pass from APPLYING its correction (it still
  // computes it, because `corrections` is the acceptance meter and has to stay
  // comparable across the rebuild). Comparing solvers while leaving the ladder
  // teleporting bodies in both legs would measure neither.
  const runLeg = async (label, mode, { minutes, pinchEverySeconds = 0 } = {}) => {
    const set = await page.evaluate((m) => {
      const ch = window.__fw.scene3d.clubhouse();
      ch.setCrowdSolver(m.solver);
      ch.setNavLadder(m.ladder);
      ch.setSeparateMode(m.separate);
      ch.resetContactWatch();
      return ch.navMode();
    }, mode);
    if (set.crowdSolver !== mode.solver || set.navLadder !== mode.ladder
      || set.separateMode !== mode.separate) {
      fail(`asked for ${JSON.stringify(mode)} and got ${JSON.stringify(set)}`);
    }
    const samples = [];
    const pinches = [];
    const sampleEvery = pinchEverySeconds || 15;
    const until = Date.now() + minutes * 60000;
    let tick = 0;
    while (Date.now() < until) {
      if (pinchEverySeconds) {
        // eslint-disable-next-line no-await-in-loop
        const p = await pinch(0.8);
        pinches.push(p);
        // The pinch RELOCATES everybody to a ring around their own centroid,
        // which can put the whole cluster behind the player. The first run of
        // this leg framed two customers in 33% of samples and the gate refused
        // to let a verdict be read off it — correctly, and the fix is to aim
        // again rather than to lower the gate.
        // eslint-disable-next-line no-await-in-loop
        p.standOff = await standOff();
        // eslint-disable-next-line no-await-in-loop
        await aim.aimAtPeople(page, vp, 4);
      }
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(sampleEvery * 1000);
      tick += 1;
      // eslint-disable-next-line no-await-in-loop
      const s = await page.evaluate(() => {
        const ch = window.__fw.scene3d.clubhouse();
        const w = ch.contactWatchDiagnostics();
        return {
          t: +w.seconds.toFixed(0),
          people: w.people,
          preTouch: w.beforeSolver.framesTouching,
          preHard: w.beforeSolver.framesInterpenetrating,
          closest: w.beforeSolver.closestApproachYd,
          shoves: w.corrections.frames,
          perSecond: w.corrections.perSecond,
          walkers: w.corrections.walkerBodyFrames,
          standers: w.corrections.standerBodyFrames,
          episodes: w.episodes.count,
          infeasible: w.solver.infeasible,
          wallClamps: w.solver.wallClampFrames,
          stalled: w.stuck.episodes,
          worstNoProgress: w.stuck.worstNoProgressSeconds,
          onScreen: window.__navAim.onScreen(),
        };
      });
      if (s.onScreen < 2) {
        out.reaims = (out.reaims || 0) + 1;
        // eslint-disable-next-line no-await-in-loop
        await aim.aimAtPeople(page, vp, 4);
      }
      samples.push(s);
      console.log(`[${label} ${String(s.t).padStart(3)}s] people=${s.people} onScreen=${s.onScreen} `
        + `preTouch=${s.preTouch} preHard=${s.preHard} closest=${s.closest} `
        + `shoves=${s.shoves} (${s.perSecond}/s walk=${s.walkers} stand=${s.standers}) `
        + `contacts=${s.episodes} stalls=${s.stalled} worstNoProg=${s.worstNoProgress}s `
        + `wallClamps=${s.wallClamps} infeasible=${s.infeasible}`);
      if (tick % 4 === 0 || pinchEverySeconds) {
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: path.join(OUT, `${tag}-${label}-t${s.t}.png`) });
      }
    }
    const watch = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      return {
        watch: ch.contactWatchDiagnostics(),
        old: ch.crowdDiagnostics(),
        nav: typeof ch.navBlockDiagnostics === 'function' ? ch.navBlockDiagnostics() : null,
      };
    });
    await page.screenshot({ path: path.join(OUT, `${tag}-${label}-final.png`) });
    const framed = samples.filter((s) => (s.onScreen || 0) >= 2).length;
    const leg = {
      label,
      mode,
      samples,
      pinches,
      framing: {
        samples: samples.length,
        withTwoOnScreen: framed,
        pct: +(100 * framed / Math.max(1, samples.length)).toFixed(1),
      },
      ...watch,
    };
    out.legs[label] = leg;
    return leg;
  };

  // Legacy first, on purpose: it leaves the room tangled and ORCA then has to
  // get people out of contacts it did not create. QA_NAV_PINCH_ONLY skips the
  // organic legs when the staged stress is the only thing under investigation —
  // the organic ones cost four minutes and are at the mercy of what the shop
  // happens to do anyway.
  const pinchOnly = process.env.QA_NAV_PINCH_ONLY === '1';
  // THE SHIPPED SYSTEM, exactly as he has been playing it.
  const SHIPPED = { solver: 'legacy', ladder: true, separate: 'apply' };
  // THE TARGET STATE: velocity solver in charge, no recovery ladder, and the
  // separation pass measuring rather than shoving.
  const TARGET = { solver: 'orca', ladder: false, separate: 'measure' };
  const legacy = pinchOnly ? null : await runLeg('legacy', SHIPPED, { minutes: legMinutes });
  const legacyPinch = await runLeg('legacy-pinch', SHIPPED, { minutes: 1, pinchEverySeconds: 10 });
  const orca = pinchOnly ? null : await runLeg('orca', TARGET, { minutes: legMinutes });
  const orcaPinch = await runLeg('orca-pinch', TARGET, { minutes: 1, pinchEverySeconds: 10 });

  // THE ACCEPTANCE, read off the meter he named.
  const headline = orca || orcaPinch;
  const shovesPerSecond = headline.watch.corrections.perSecond;
  const hardFrames = headline.watch.beforeSolver.framesInterpenetrating;
  out.acceptance = {
    measuredOn: headline.label,
    shovesPerSecond,
    target: 0.5,
    metShoveTarget: shovesPerSecond < 0.5,
    hardContactFrames: hardFrames,
    metContactTarget: hardFrames === 0,
    // NEVER STUCK, measured without reference to the ladder that was deleted.
    stuck: headline.watch.stuck,
    legacyStuck: (legacy || legacyPinch).watch.stuck,
    legacyShovesPerSecond: (legacy || legacyPinch).watch.corrections.perSecond,
    // The staged stress is the honest comparison: same pinch, same gap, same
    // room, ten seconds apart.
    pinch: {
      legacyPerSecond: legacyPinch.watch.corrections.perSecond,
      orcaPerSecond: orcaPinch.watch.corrections.perSecond,
      legacyWalkerBodyFrames: legacyPinch.watch.corrections.walkerBodyFrames,
      orcaWalkerBodyFrames: orcaPinch.watch.corrections.walkerBodyFrames,
      legacyStanderBodyFrames: legacyPinch.watch.corrections.standerBodyFrames,
      orcaStanderBodyFrames: orcaPinch.watch.corrections.standerBodyFrames,
      legacyClosest: legacyPinch.watch.beforeSolver.closestApproachYd,
      orcaClosest: orcaPinch.watch.beforeSolver.closestApproachYd,
    },
  };
  // THE PINCH MUST HAVE BITTEN. If the staging never actually squeezed anybody
  // then "ORCA held them apart" is a claim about a stress that did not happen —
  // the same shape as the quiet organic leg that started this.
  for (const label of ['legacy-pinch', 'orca-pinch']) {
    const staged = (out.legs[label]?.pinches || []).filter((p) => p.ok);
    if (!staged.length) fail(`${label}: not one pinch was staged`);
    const worst = staged.reduce((a, p) => Math.min(a, p.minGap), Infinity);
    if (Number.isFinite(worst) && worst > 0.9) {
      fail(`${label}: the tightest staged gap was ${worst} yd — the pinch did not squeeze anybody`);
    }
    const tooTight = staged.filter((p) => p.tooTight).length;
    if (tooTight) {
      fail(`${label}: ${tooTight} of ${staged.length} pinches were staged INSIDE the violation `
        + 'threshold, so the solver was handed a contact the instrument created');
    }
  }
  for (const [label, leg] of Object.entries(out.legs)) {
    if (leg.framing.pct < 60) {
      fail(`the ${label} leg had two customers in frame in only ${leg.framing.pct}% of samples — `
        + 'no verdict may be read off that footage');
    }
    if (leg.watch.people < 2 && !leg.samples.some((s) => s.people >= 2)) {
      fail(`the ${label} leg never had two people in the room at once`);
    }
  }

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  const brief = (leg) => ({
    seconds: leg.watch.seconds,
    frames: leg.watch.frames,
    solver: leg.watch.solver,
    beforeSolver: leg.watch.beforeSolver,
    afterSolver: leg.watch.afterSolver,
    corrections: leg.watch.corrections,
    solver: leg.watch.solver,
    stuck: leg.watch.stuck,
    episodes: {
      count: leg.watch.episodes.count,
      perMinute: leg.watch.episodes.perMinute,
      hard: leg.watch.episodes.hard,
    },
    oldDetectorSaid: { pairs: leg.old.pairs, worstOverlap: leg.old.worstOverlap },
    navEscalations: leg.nav?.escalations ?? leg.nav?.total ?? null,
    framing: leg.framing,
    pinchesStaged: leg.pinches.filter((p) => p.ok).length,
    tightestStagedGap: leg.pinches.filter((p) => p.ok)
      .reduce((a, p) => Math.min(a, p.minGap), Infinity),
  });
  console.log(JSON.stringify({
    tag,
    legMinutes,
    legacy: legacy && brief(legacy),
    legacyPinch: brief(legacyPinch),
    orca: orca && brief(orca),
    orcaPinch: brief(orcaPinch),
    acceptance: out.acceptance,
    failures: out.failures,
  }, null, 2));
  return out;
}
