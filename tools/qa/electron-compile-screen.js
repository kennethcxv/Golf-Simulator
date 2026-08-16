// FIRST-RUN COMPILE SCREEN — the three-way acceptance instrument.
//
// QA_EXPECT selects the claim under test:
//   first-run     — fresh profile: the screen MUST appear with the first-time
//                   line, and its count must be the live program count climbing,
//                   not a timer.
//   absent        — second boot, same profile: the screen must NEVER appear
//                   during the load. The sampler proves it was alive with a
//                   PLANTED activation after the load completes.
//   driver-update — same profile, the stored stamp's driver string is mutated
//                   at the menu: the screen must appear with the driver line,
//                   and the stamp must be re-armed to the real driver at the end.
//
// COUNT REALNESS: every displayed "n / m" is compared against
// renderer.info.programs.length read in the same evaluate tick. Displayed n may
// LAG live (paint happens at yields) but may never EXCEED it, must climb
// through at least three distinct values on a first run, and the stamp written
// at completion must sit between the last displayed n and the final live count.
//
//   QA_EXPECT=first-run QA_ELECTRON_USER_DATA_DIR=<fresh dir> \
//     node tools/qa/run-electron.cjs tools/qa/electron-compile-screen.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/compile-screen');
  fs.mkdirSync(OUT, { recursive: true });
  const EXPECT = process.env.QA_EXPECT || 'first-run';
  const tag = process.env.QA_TAG || EXPECT;
  const STAMP_KEY = 'golfEmpire.shaderCompileStamp.v1';
  const TITLE = 'Compiling shaders';
  const LINES = {
    'first-run': 'First-time setup. This only happens once.',
    'driver-update': 'Your graphics driver was updated. Rebuilding for the new version.',
  };
  const out = { tag, expect: EXPECT, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootLib = await import(`file:///${`${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/')}`);
  out.ownerRes = (await bootLib.ownerResolution(page, page.electronApp)).caption;

  // The sampler goes in BEFORE anything else so the veil's creation and every
  // dataset flip is on record. It dedupes on change, reads DOM text (the claim
  // is about a DOM overlay, so DOM is the right layer) plus computed opacity
  // and the live program count in the same tick.
  await page.evaluate(() => {
    const S = { samples: [], activations: [], t0: performance.now() };
    window.__csT = S;
    const read = () => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return;
      const mode = veil.dataset.compileMode || null;
      const s = {
        t: +performance.now().toFixed(0),
        mode,
        title: veil.querySelector('.load-veil-title')?.textContent || '',
        note: veil.querySelector('.load-veil-compile-note')?.textContent || '',
        count: veil.querySelector('.load-veil-compile-count')?.textContent || '',
        op: getComputedStyle(veil).opacity,
        disp: getComputedStyle(veil).display,
        live: window.__fw?.scene3d?.renderer?.info?.programs?.length ?? -1,
      };
      const p = S.samples[S.samples.length - 1];
      if (!p || p.mode !== s.mode || p.count !== s.count || p.note !== s.note
        || p.title !== s.title || p.op !== s.op || p.disp !== s.disp) {
        if (S.samples.length < 4000) S.samples.push(s);
      }
      if (mode && (!p || p.mode !== mode)) S.activations.push(s);
    };
    setInterval(read, 100);
    const raf = () => { read(); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    new MutationObserver(read).observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-compile-mode', 'class', 'style'],
    });
  });

  // stamp state before the boot proper
  out.stampBefore = await page.evaluate((KEY) => localStorage.getItem(KEY), STAMP_KEY);
  if (EXPECT === 'driver-update') {
    if (!out.stampBefore) throw new Error('driver-update run needs an existing stamp: run the first-run boot on this profile first');
    await page.evaluate((KEY) => {
      const p = JSON.parse(localStorage.getItem(KEY));
      p.driver = 'QA-PREVIOUS-DRIVER 0.0.0.0';
      localStorage.setItem(KEY, JSON.stringify(p));
    }, STAMP_KEY);
  }
  if (EXPECT === 'absent' && !out.stampBefore) fail('absent run started with NO stamp: this profile is not a second boot');

  await bootLib.clickThroughMenu(page, { forceNew: true });

  // mid-compile screenshot as soon as an activation with a painted count exists
  const shotPath = path.join(OUT, `${tag}-mid-compile.png`);
  let done = false;
  let shot = false;
  const poller = (async () => {
    while (!done) {
      const st = await page.evaluate(() => {
        const S = window.__csT;
        const last = [...(S?.samples || [])].reverse().find((x) => x.mode && x.count);
        return { n: S?.activations.length || 0, count: last ? last.count : '' };
      }).catch(() => null);
      if (st && st.n > 0 && st.count && !shot) {
        shot = true;
        try { await page.screenshot({ path: shotPath }); out.midCompileShot = shotPath; } catch (e) { out.midCompileShot = `FAILED: ${e.message}`; }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  const loadEndedAt = await page.evaluate(() => +performance.now().toFixed(0));
  done = true;
  await poller;

  // PLANTED CONTROL for the sampler (the 'absent' verdict is only as good as
  // the sampler): flip compile mode on the now-hidden veil and require the
  // sampler to catch it. Runs on every mode so the instrument is proven in the
  // same boot that uses it.
  const planted = await page.evaluate(() => {
    const before = window.__csT.activations.length;
    const at = +performance.now().toFixed(0);
    const veil = window.__fw?.loadVeil;
    if (!veil?.compileBegin) return { ok: false, why: 'no __fw.loadVeil.compileBegin hook' };
    veil.compileBegin('first-run', 'Compiling shaders', 'sampler control');
    return { ok: true, at, before };
  });
  await page.waitForTimeout(500);
  const plantedCaught = planted.ok ? await page.evaluate((info) => {
    const later = window.__csT.activations.filter((a) => a.t >= info.at - 20);
    window.__fw.loadVeil.compileEnd();
    return later.length > 0;
  }, planted) : false;
  out.control_planted_activation = planted.ok
    ? (plantedCaught ? 'caught' : 'MISSED - SAMPLER VOID') : `UNAVAILABLE (${planted.why})`;
  if (!plantedCaught) fail('planted activation control failed: ' + out.control_planted_activation);

  out.final = await page.evaluate((KEY) => {
    const r = window.__fw?.scene3d?.renderer;
    const gl = r?.getContext?.();
    let driverKey;
    try {
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      driverKey = [
        dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
        dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
        gl?.getParameter(gl.VERSION),
      ].filter(Boolean).join(' | ');
    } catch (e) { driverKey = `ERR:${e.message}`; }
    let stamp;
    try { stamp = JSON.parse(localStorage.getItem(KEY)); } catch { stamp = null; }
    return { programs: r?.info?.programs?.length ?? -1, stamp, stampRaw: localStorage.getItem(KEY), driverKey };
  }, STAMP_KEY);

  const S = await page.evaluate(() => window.__csT);
  const loadActivations = S.activations.filter((a) => a.t <= loadEndedAt + 20);
  const active = S.samples.filter((s) => s.mode && s.t <= loadEndedAt + 20);
  out.loadActivationModes = [...new Set(loadActivations.map((a) => a.mode))];
  out.sampleCount = S.samples.length;

  const counts = active
    .map((s) => ({ ...s, m: s.count.match(/^(\d+) \/ (\d+)$/) }))
    .filter((s) => s.m)
    .map((s) => ({ t: s.t, n: +s.m[1], total: +s.m[2], live: s.live }));
  out.countSeries = counts.map((c) => `${c.t}: ${c.n}/${c.total} live=${c.live}`);

  if (EXPECT === 'first-run' || EXPECT === 'driver-update') {
    if (!loadActivations.length) fail('the compile screen never appeared during the load');
    if (out.loadActivationModes.some((m) => m !== EXPECT)) fail(`activation mode(s) ${out.loadActivationModes} where only '${EXPECT}' belongs`);
    const visible = active.filter((s) => +s.op >= 0.9 && s.disp !== 'none');
    if (!visible.length) fail('compile mode was set but never on a VISIBLE veil');
    const badTitle = active.find((s) => s.title !== TITLE);
    if (badTitle) fail(`title read "${badTitle.title}" while compiling, wanted "${TITLE}"`);
    const badNote = active.find((s) => s.note !== LINES[EXPECT]);
    if (badNote) fail(`line 2 read "${badNote.note}", wanted "${LINES[EXPECT]}"`);
    if (!counts.length) fail('no "n / m" count was ever painted');
    for (let i = 1; i < counts.length; i += 1) {
      if (counts[i].n < counts[i - 1].n) { fail(`count went BACKWARDS at ${counts[i].t} (${counts[i - 1].n} -> ${counts[i].n})`); break; }
    }
    const over = counts.filter((c) => c.live >= 0 && c.n > c.live);
    if (over.length) fail(`displayed count EXCEEDED the live program count ${over.length} time(s), e.g. ${over[0].n} vs live ${over[0].live} - a fabricated number`);
    let lagViolations = 0;
    for (let i = 2; i < counts.length; i += 1) {
      const ref = counts[i - 2];
      if (ref.live >= 0 && counts[i].n < ref.live && counts[i].total > counts[i].n) lagViolations += 1;
    }
    out.lagViolations = `${lagViolations}/${Math.max(0, counts.length - 2)}`;
    if (counts.length > 2 && lagViolations > Math.max(2, 0.05 * counts.length)) {
      fail(`displayed count failed to track the live count (${out.lagViolations} stale beyond one paint) - looks timer-driven, not program-driven`);
    }
    const distinct = new Set(counts.map((c) => c.n));
    out.distinctCounts = distinct.size;
    if (EXPECT === 'first-run' && distinct.size < 3) fail(`count showed only ${distinct.size} distinct value(s): it popped, it did not climb`);
    const stamp = out.final.stamp;
    if (!stamp) fail('no stamp was written after a completed compile');
    else {
      if (stamp.driver !== out.final.driverKey) fail(`stamp driver "${stamp.driver}" != live driver "${out.final.driverKey}"`);
      const lastN = counts.length ? counts[counts.length - 1].n : 0;
      if (!(stamp.programs >= lastN && stamp.programs <= out.final.programs)) {
        fail(`stamp.programs ${stamp.programs} outside [last displayed ${lastN}, final live ${out.final.programs}]`);
      }
    }
  }

  if (EXPECT === 'absent') {
    if (loadActivations.length) fail(`the compile screen APPEARED on a stamped profile: modes ${out.loadActivationModes} at t=${loadActivations[0].t}`);
    if (out.final.stampRaw !== out.stampBefore) fail('the stamp changed on a boot that showed no screen');
  }
  if (EXPECT === 'driver-update') {
    const stamp = out.final.stamp;
    if (stamp && stamp.driver === 'QA-PREVIOUS-DRIVER 0.0.0.0') fail('stamp was NOT re-armed after the driver-update rebuild');
  }

  out.verdict = out.failures.length ? 'FAIL' : 'PASS';
  const file = path.join(OUT, `${tag}-result.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ tag: out.tag, expect: EXPECT, verdict: out.verdict, failures: out.failures, ownerRes: out.ownerRes, loadActivationModes: out.loadActivationModes, distinctCounts: out.distinctCounts, lagViolations: out.lagViolations, control: out.control_planted_activation, midCompileShot: out.midCompileShot, stamp: out.final?.stamp, finalPrograms: out.final?.programs, countSamples: out.countSeries?.length }, null, 2));
  console.log(`full result: ${file}`);
  if (out.failures.length || out.errs.length) process.exitCode = 1;
}
