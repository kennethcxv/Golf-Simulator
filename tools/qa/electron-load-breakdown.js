// GOAL 27, PHASE 1.3 — WHERE DO THE LOAD SECONDS GO?
//
// One boot, one timeline, every phase attributed:
//   process spawn -> renderer start -> menu interactive -> (harness clicks) ->
//   scene construction -> prewarm (per-stage, from the scene's own
//   prewarmTimings) -> walk active -> veil fully lifted.
//
// The outer clock is epoch-ms: Electron's process.getCreationTime() on the
// main-process side, performance.timeOrigin on the page side. Everything else
// is page-relative and converted once. The harness's own think time (waiting,
// clicking) is measured and REPORTED SEPARATELY so it cannot inflate a game
// phase.
//
// Frame gaps are read from a rAF sampler installed before the first click —
// NOT from PerformanceObserver('longtask'), per the Goal 27 brief: a hitch the
// owner feels can be under 50 ms.
//
// NEGATIVE CONTROLS, both live in every run:
//   1. The rAF gap detector must catch a deliberate 400 ms busy-block planted
//      by the driver at a known timestamp. Miss = the gap log is void.
//   2. The phase segments must sum to the outer span within 10% — a clock
//      that loses seconds between buckets is attributing nothing.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-load-breakdown.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/load-breakdown');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // --- outer clock anchors --------------------------------------------------
  out.processCreationEpochMs = await page.electronApp.evaluate(() => process.getCreationTime());
  out.timeOriginEpochMs = await page.evaluate(() => performance.timeOrigin);

  // --- rAF sampler + veil/menu/walk watchers, installed BEFORE any click ----
  await page.evaluate(() => {
    // the default 250-entry resource buffer overflowed on the first run and
    // returned an EMPTY slow-resources list for a load with hundreds of GLBs
    performance.setResourceTimingBufferSize(8192);
    const T = { marks: {}, gaps: [], samples: 0 };
    window.__loadT = T;
    const mark = (name) => { if (!(name in T.marks)) T.marks[name] = +performance.now().toFixed(1); };
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const gap = now - last;
      if (gap > 33) T.gaps.push({ t: +now.toFixed(0), ms: +gap.toFixed(1) });
      last = now;
      T.samples += 1;
      // menu interactive: the New Game button exists and is enabled
      if (!T.marks.menuInteractive) {
        const b = [...document.querySelectorAll('button')]
          .find((x) => /new game/i.test(x.textContent || ''));
        if (b && !b.disabled) mark('menuInteractive');
      }
      // scene alive / walk controllable
      const fw = window.__fw;
      if (!T.marks.sceneObject && fw?.scene3d) mark('sceneObject');
      if (!T.marks.walkActive && fw?.scene3d?.walk?.isActive?.()) mark('walkActive');
      // veil states
      const veil = document.querySelector('.load-veil');
      if (veil) {
        const op = Number(getComputedStyle(veil).opacity);
        if (!T.marks.veilShown && op > 0.9) mark('veilShown');
        if (T.marks.veilShown && !T.marks.veilLiftStart && op < 0.98) mark('veilLiftStart');
        if (T.marks.veilShown && !T.marks.veilGone && (op === 0 || getComputedStyle(veil).display === 'none')) mark('veilGone');
      } else if (T.marks.veilShown && !T.marks.veilGone) mark('veilGone');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // first-input capture: when the harness clicks, record it page-side
    window.addEventListener('pointerdown', () => mark('firstClick'), { capture: true, once: true });
  });

  // --- boot ------------------------------------------------------------------
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  const clickedAt = Date.now();
  out.bootMode = await boot.clickThroughMenu(page, { forceNew: true });
  out.clickWallEpochMs = clickedAt;

  await page.waitForFunction(() => window.__loadT?.marks?.walkActive, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__loadT?.marks?.veilGone, null, { timeout: 300000 });
  // let post-veil settling frames land in the gap log
  await page.waitForTimeout(3000);

  // --- CONTROL 1: planted 400 ms busy-block must appear in the gap log ------
  const plantedAt = await page.evaluate(() => {
    const t0 = performance.now();
    while (performance.now() - t0 < 400) { /* deliberate stall */ }
    return +t0.toFixed(0);
  });
  await page.waitForTimeout(400);

  // --- collect ---------------------------------------------------------------
  const T = await page.evaluate(() => window.__loadT);
  const prewarm = await page.evaluate(() => window.__fw?.scene3d?.prewarmTimings?.() ?? null);
  const warm = await page.evaluate(() => window.__fwWarm ?? null);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((r) => r.duration > 20)
    .map((r) => ({
      name: r.name.replace(/^.*\/(vendor|src|assets)\//, '$1/').slice(0, 90),
      startMs: +r.startTime.toFixed(0),
      durMs: +r.duration.toFixed(0),
      kb: r.transferSize ? +(r.transferSize / 1024).toFixed(0) : null,
    }))
    .sort((a, b) => b.durMs - a.durMs)
    .slice(0, 25));

  out.marks = T.marks;
  // page-side performance.mark()s (GOAL 28 P1: 'app-eval-start' splits the
  // renderer->menu slice into deps-eval vs app-init) + a resource count so
  // the request-collapse claim is count-verified, not inferred
  out.pageMarks = await page.evaluate(() => Object.fromEntries(
    performance.getEntriesByType('mark').map((m) => [m.name, +m.startTime.toFixed(1)])));
  out.moduleRequests = await page.evaluate(() => ({
    src: performance.getEntriesByType('resource').filter((r) => /\/src\/.*\.js/.test(r.name)).length,
    bundle: performance.getEntriesByType('resource').filter((r) => /main\.bundle\.js/.test(r.name)).length,
  }));
  out.gapCount = T.gaps.length;
  out.gaps = T.gaps.filter((g) => g.ms > 60).slice(0, 40);
  out.prewarm = prewarm;
  out.warm = warm;
  out.slowResources = resources;

  const ctrl = T.gaps.find((g) => g.ms >= 380 && Math.abs(g.t - plantedAt - 400) < 500);
  out.control1_gapDetector = ctrl ? `caught planted stall (${ctrl.ms} ms)` : 'MISSED — GAP LOG VOID';

  // --- assemble the timeline in epoch ms ------------------------------------
  const origin = out.timeOriginEpochMs;
  const m = T.marks;
  const spawnToRenderer = +(origin - out.processCreationEpochMs).toFixed(0);
  const phases = [
    ['process spawn -> renderer origin', spawnToRenderer],
    ['renderer origin -> menu interactive', m.menuInteractive ?? null],
    ['menu interactive -> harness click', m.firstClick != null && m.menuInteractive != null ? +(m.firstClick - m.menuInteractive).toFixed(0) : null],
    ['click -> scene object exists', m.sceneObject != null && m.firstClick != null ? +(m.sceneObject - m.firstClick).toFixed(0) : null],
    ['scene object -> walk active', m.walkActive != null && m.sceneObject != null ? +(m.walkActive - m.sceneObject).toFixed(0) : null],
    ['walk active -> veil fully gone', m.veilGone != null && m.walkActive != null ? +(m.veilGone - m.walkActive).toFixed(0) : null],
  ];
  out.phases = phases;
  out.totalClickToPlayableMs = m.veilGone != null && m.firstClick != null
    ? +(m.veilGone - m.firstClick).toFixed(0) : null;
  out.totalSpawnToPlayableMs = m.veilGone != null
    ? +(origin + m.veilGone - out.processCreationEpochMs).toFixed(0) : null;

  // CONTROL 2: inner segments must sum to the outer span within 10%
  const inner = phases.slice(3).map((p) => p[1]).filter((v) => v != null);
  const innerSum = inner.reduce((a, b) => a + b, 0);
  out.control2_sumCheck = out.totalClickToPlayableMs != null && inner.length === 3
    ? (Math.abs(innerSum - out.totalClickToPlayableMs) <= out.totalClickToPlayableMs * 0.1
      ? `ok (segments ${innerSum} vs span ${out.totalClickToPlayableMs})`
      : `FAILED — segments ${innerSum} vs span ${out.totalClickToPlayableMs}, attribution void`)
    : 'INCOMPLETE MARKS';

  console.log('\n=== LOAD TIMELINE ===');
  for (const [label, ms] of phases) console.log(`  ${label}: ${ms} ms`);
  console.log(`  TOTAL spawn -> playable: ${out.totalSpawnToPlayableMs} ms`);
  console.log(`  TOTAL click -> playable: ${out.totalClickToPlayableMs} ms`);
  console.log(`\n=== PREWARM STAGES (scene's own clock) ===`);
  for (const s of prewarm ?? []) console.log(`  ${s.label}: ${s.ms}`);
  console.log(`\n=== SLOWEST RESOURCES ===`);
  for (const r of out.slowResources.slice(0, 12)) console.log(`  ${r.durMs} ms  ${r.kb ?? '?'} KB  ${r.name}`);
  console.log(`\n=== FRAME GAPS >60ms DURING LOAD ===`);
  for (const g of out.gaps) console.log(`  t=${g.t}  ${g.ms} ms`);
  console.log(`\nCONTROL 1 (planted 400ms stall): ${out.control1_gapDetector}`);
  console.log(`CONTROL 2 (segment sum): ${out.control2_sumCheck}`);
  console.log(`deferred warm state: ${JSON.stringify(warm)}`);

  await page.screenshot({ path: path.join(OUT, `${tag}-playable.png`) });
  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
