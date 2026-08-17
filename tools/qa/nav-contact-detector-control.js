// PART 2 — PROVE THE CONTACT DETECTOR BEFORE TRUSTING ONE MORE NUMBER FROM IT.
//
// The previous detector reported ZERO body overlaps across five minutes of a
// session in which the owner watched people rub against each other every few
// seconds. Before the new one is allowed to say anything about the shop, it has
// to be shown firing on a case that is unarguable and staying silent on a case
// that is unarguably clean.
//
// THREE LEGS, in this order, and the middle one is the point:
//
//   A  CLEAN CONTROL — two customers held four yards apart for several seconds.
//      Every counter must stay at zero. A detector that fires here is measuring
//      noise and nothing after it means anything.
//   B  STACKED CONTROL — the same two customers written onto the SAME POINT.
//      framesTouching, framesInterpenetrating and closestApproach must all
//      register, on the frame after the write. This is the leg the old detector
//      would also have passed, so it is necessary and not sufficient.
//   C  BRUSHING CONTROL — the two placed 0.66 yd apart: inside the visible
//      margin, OUTSIDE hard interpenetration, and inside the band the SOLVER
//      treats as a violation and pushes out of. This is the case the old
//      detector could not see at all and it is the exact geometry of the
//      rubbing being reported. `beforeSolver.framesTouching` must rise while
//      `framesInterpenetrating` stays at zero.
//
// Leg C is what makes this a different KIND of check rather than a second
// helping of the same one.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/nav-contact-detector-control.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/nav');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'detector';
  const out = { tag, errs: [], failures: [], legs: {} };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
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

  out.hasWatch = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    return typeof ch?.contactWatchDiagnostics === 'function' && typeof ch?.resetContactWatch === 'function';
  });
  if (!out.hasWatch) { fail('this build has no contact watch'); console.log(JSON.stringify(out, null, 2)); return out; }

  // Get inside, where the customers are, and wait until at least two are drawn.
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);
  for (let leg = 0; leg < 6; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6500 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(600);
    out.inside = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse?.();
      return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
    });
    if (out.inside) break;
  }

  out.waitedForPeople = await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    return (ch?.customers?.() || []).filter((c) => c.mesh && c.mesh.visible !== false).length >= 2;
  }, null, { timeout: 300000 }).then(() => true).catch(() => false);
  if (!out.waitedForPeople) { fail('never had two visible customers to stage with'); }

  // Hold two of them at a chosen separation for `seconds`, rewriting every tick
  // so the walker cannot carry them apart before the sim's own per-frame scan
  // reads them. The stage is the control's independent variable and it is
  // reported back from the LIVE positions, not from what was asked for.
  const stage = async (label, gapYd, seconds) => {
    await page.evaluate(() => window.__fw.scene3d.clubhouse().resetContactWatch());
    const staged = await page.evaluate(async ({ gap, secs }) => {
      const ch = window.__fw.scene3d.clubhouse();
      const live = (ch.customers() || []).filter((c) => c.mesh && c.mesh.visible !== false);
      if (live.length < 2) return { ok: false, why: 'fewer than two visible customers' };
      const [a, b] = live;
      const ax = a.mesh.position.x;
      const az = a.mesh.position.z;
      const samples = [];
      const t0 = performance.now();
      while (performance.now() - t0 < secs * 1000) {
        a.mesh.position.x = ax;
        a.mesh.position.z = az;
        b.mesh.position.x = ax + gap;
        b.mesh.position.z = az;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => requestAnimationFrame(r));
        samples.push(+Math.hypot(
          a.mesh.position.x - b.mesh.position.x,
          a.mesh.position.z - b.mesh.position.z,
        ).toFixed(4));
      }
      samples.sort((x, y) => x - y);
      return {
        ok: true,
        askedGap: gap,
        frames: samples.length,
        liveGapMedian: samples[samples.length >> 1] ?? null,
        liveGapMin: samples[0] ?? null,
      };
    }, { gap: gapYd, secs: seconds });
    const watch = await page.evaluate(() => window.__fw.scene3d.clubhouse().contactWatchDiagnostics());
    out.legs[label] = { staged, watch };
    console.log(`[${label}] asked=${gapYd} liveMedian=${staged.liveGapMedian} frames=${watch.frames} `
      + `preTouch=${watch.beforeSolver.framesTouching} preHard=${watch.beforeSolver.framesInterpenetrating} `
      + `postTouch=${watch.afterSolver.framesTouching} closest=${watch.beforeSolver.closestApproachYd} `
      + `corrections=${watch.corrections.frames}`);
    await page.screenshot({ path: path.join(OUT, `${tag}-${label}.png`) });
    return { staged, watch };
  };

  // A — CLEAN. Four yards apart: nothing may fire.
  const clean = await stage('A-clean', 4.0, 3.5);
  if (clean.watch.frames < 30) fail('A: the watch barely ticked — it is not running every frame');
  if (clean.watch.beforeSolver.framesTouching !== 0
    || clean.watch.afterSolver.framesTouching !== 0) {
    fail(`A: the detector fired on two people four yards apart `
      + `(pre ${clean.watch.beforeSolver.framesTouching}, post ${clean.watch.afterSolver.framesTouching})`);
  }
  if (clean.watch.corrections.frames !== 0) {
    fail(`A: the solver shoved somebody with nobody near anybody (${clean.watch.corrections.frames} frames)`);
  }

  // B — STACKED. On top of each other: it must fire, hard.
  const stacked = await stage('B-stacked', 0.0, 3.5);
  if (stacked.watch.beforeSolver.framesTouching === 0) {
    fail('B: TWO CUSTOMERS ON THE SAME POINT AND THE DETECTOR SAID NOTHING');
  }
  if (stacked.watch.beforeSolver.framesInterpenetrating === 0) {
    fail('B: coincident bodies did not register as interpenetrating');
  }
  if (!(stacked.watch.beforeSolver.closestApproachYd < 0.1)) {
    fail(`B: closest approach read ${stacked.watch.beforeSolver.closestApproachYd} for coincident bodies`);
  }
  if (stacked.watch.corrections.frames === 0) {
    fail('B: the positional solver did not record a single shove while pulling two stacked bodies apart');
  }
  if (stacked.watch.episodes.count === 0) fail('B: no contact episode was recorded');

  // C — BRUSHING. 0.66 yd: touching to the eye, not interpenetrating, and
  // inside the band the old detector was blind to.
  const brush = await stage('C-brushing', 0.66, 3.5);
  if (brush.watch.beforeSolver.framesTouching === 0) {
    fail('C: bodies 0.66 yd apart — visibly brushing — did not register as touching. '
      + 'This is the exact blindness that reported zero for five minutes.');
  }
  if (brush.watch.beforeSolver.framesInterpenetrating !== 0) {
    fail(`C: 0.66 yd was counted as hard interpenetration (${brush.watch.beforeSolver.framesInterpenetrating} frames) — `
      + 'the two thresholds are not distinct and the instrument cannot tell brushing from overlap');
  }

  out.detectorProven = out.failures.length === 0;
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    tag,
    inside: out.inside,
    detectorProven: out.detectorProven,
    legs: Object.fromEntries(Object.entries(out.legs).map(([k, v]) => [k, {
      askedGap: v.staged.askedGap,
      liveGapMedian: v.staged.liveGapMedian,
      frames: v.watch.frames,
      preTouching: v.watch.beforeSolver.framesTouching,
      preHard: v.watch.beforeSolver.framesInterpenetrating,
      postTouching: v.watch.afterSolver.framesTouching,
      closest: v.watch.beforeSolver.closestApproachYd,
      correctionFrames: v.watch.corrections.frames,
      worstCorrectionYd: v.watch.corrections.worstYd,
      episodes: v.watch.episodes.count,
    }])),
    failures: out.failures,
  }, null, 2));
  return out;
}
