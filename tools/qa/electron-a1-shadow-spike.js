// A1 / INVARIANT 1 / C6 — ARE THE FRAMES OVER 16 ms THE SHADOW BAKES?
//
// Three separate threads this session arrived at the same wall:
//
//   - Invariant 1 has been the one red gate item all along: "no frame over
//     16 ms during normal play", and the walk reports 6-11% of frames over it.
//   - B2's dense broom head looked like it doubled the over-16 tail, until the
//     per-beat breakdown showed beats holding NO TOOL running higher than the
//     ones holding it.
//   - C6 says "page turns are laggy". The turn's own frame costs 0.8 ms and the
//     worst frame during turns is 29.3 ms — and standing still doing nothing
//     measures 27-36 ms too. The turn is not what is slow.
//
// So the spikes are not the broom, not the ledger, and not the tool. They are
// everywhere, they leave the median alone (5.4-5.8 ms), and they hit roughly one
// frame in five.
//
// ONE FRAME IN FIVE IS A SUSPICIOUS NUMBER. The sun shadow re-bakes on a fixed
// 100 ms clock (`shadowBakeMs = 100`, courseScene.js:10351) and sets
// `renderer.shadowMap.needsUpdate`. At 60 fps that is one frame in six — 16.7%
// — against a measured over-16 rate of ~20%.
//
// `shadowBakes` is already exposed at `scene3d.post.stats()`, with a comment
// that reads "perf probes read this to attribute frame spikes to bakes". The
// hook was built for this question and nobody has asked it.
//
// THE CONTROL IS FREE AND PERFECT: the non-bake frames in the SAME run, the same
// second, the same scene, the same camera. The only difference between the two
// populations is whether the shadow pass ran. Nothing else has to be held equal
// because nothing else differs.
//
// ALIGNMENT IS REPORTED BOTH WAYS ON PURPOSE. This sampler's rAF and the game's
// rAF are separate callbacks and their order is not guaranteed, so a bake may
// land in the sample before or after the frame it paid for. Attributing to the
// wrong one would show no effect for a real one, so both alignments are computed
// and printed; if only one separates, that is the alignment, and if neither
// does, the hypothesis is dead.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-shadow-spike.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-shadow-spike');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(7000);

  out.shadowCfg = await page.evaluate(() => {
    const s3 = window.__fw?.scene3d;
    const st = s3?.post?.stats?.() ?? null;
    return { stats: st, hasStats: !!st };
  }).catch(() => null);

  // Standing still, nothing equipped, nothing open. "Normal play" in the least
  // eventful form available, so anything periodic stands out.
  //
  // MEASURED IN BOTH PLACES, IN ONE RUN. The first version of this driver
  // sampled only where the player boots — outdoors — and reported 1.0% of frames
  // over 16.7 ms with a median of 8.9. Every earlier reading that made invariant
  // 1 red was taken INSIDE the clubhouse, and those measured a LOWER median
  // (5.4-5.8) with a twentyfold higher over-16 rate (~20%).
  //
  // Comparing those two across runs would be comparing two machines' moods. Both
  // are sampled here, in the same run, seconds apart, with nothing changed but
  // where the player stands — which is the only way the difference can be
  // attributed to the place rather than to the day.
  const sampler = () => page.evaluate(() => new Promise((resolve) => {
    const rows = [];
    const bakes = () => {
      try { return window.__fw.scene3d.post.stats().shadowBakes; } catch { return null; }
    };
    let prev = performance.now();
    let prevBakes = bakes();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      const b = bakes();
      rows.push({
        t: +(now - t0).toFixed(0),
        dt: +(now - prev).toFixed(2),
        dBakes: b === null || prevBakes === null ? null : b - prevBakes,
      });
      prev = now; prevBakes = b;
      if (now - t0 < 12000) requestAnimationFrame(tick);
      else resolve(rows);
    };
    requestAnimationFrame(tick);
  }));

  const outdoor = await sampler();
  // Now inside, on the same route the other drivers already prove works.
  out.teleport = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw?.scene3d?.clubhouse?.();
    const st = fw?.scene3d?.walk?.state;
    if (!ch || !st) return { ok: false };
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.2;
    return { ok: true, x: +st.x.toFixed(2), z: +st.z.toFixed(2) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(4000);
  // WHERE THE PLAYER ACTUALLY IS, read from the state object rather than from
  // the API surface. The first version asked `isInside(w.x, w.z)` and got back
  // `false` — because the walk API exposes its position on `w.state`, so `w.x`
  // was `undefined` and `isInside(undefined, undefined)` is perfectly happy to
  // say no. A confirmation that returns the same answer for "outside" and for
  // "you asked wrong" confirms nothing, and it would have discredited a real
  // result. Both readings are kept so the two cases stay distinguishable.
  out.insideConfirmed = await page.evaluate(() => {
    const s3 = window.__fw?.scene3d;
    const w = s3?.walk;
    const ch = s3?.clubhouse?.();
    const x = w?.state?.x ?? w?.x;
    const z = w?.state?.z ?? w?.z;
    if (!ch?.isInside) return { known: false, why: 'no isInside' };
    return {
      known: Number.isFinite(x) && Number.isFinite(z),
      x: Number.isFinite(x) ? +x.toFixed(2) : null,
      z: Number.isFinite(z) ? +z.toFixed(2) : null,
      inside: !!ch.isInside(x, z, 0.35),
      viaApiFields: !!ch.isInside(w?.x, w?.z, 0.35),
    };
  }).catch(() => null);
  const indoor = await sampler();
  const samples = outdoor;

  const stat = (xs) => {
    if (!xs.length) return { n: 0 };
    const v = xs.slice().sort((a, b) => a - b);
    const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
    return {
      n: v.length,
      median: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      worst: +v[v.length - 1].toFixed(2),
      over16: v.filter((d) => d > 16.7).length,
      over16pct: +((v.filter((d) => d > 16.7).length / v.length) * 100).toFixed(1),
    };
  };

  // Alignment A: the bake counted in THIS sample paid for THIS frame's dt.
  const bakeA = samples.filter((r) => r.dBakes > 0).map((r) => r.dt);
  const idleA = samples.filter((r) => r.dBakes === 0).map((r) => r.dt);
  // Alignment B: the bake counted in the NEXT sample paid for this frame's dt.
  const bakeB = []; const idleB = [];
  for (let i = 0; i < samples.length - 1; i += 1) {
    (samples[i + 1].dBakes > 0 ? bakeB : idleB).push(samples[i].dt);
  }

  out.totalFrames = samples.length;
  out.bakeCount = samples.filter((r) => r.dBakes > 0).length;
  out.bakeSharePct = +((out.bakeCount / samples.length) * 100).toFixed(1);
  out.alignA = { bake: stat(bakeA), nonBake: stat(idleA) };
  out.alignB = { bake: stat(bakeB), nonBake: stat(idleB) };
  out.all = stat(samples.map((r) => r.dt));

  const sep = (g) => (g.bake.n && g.nonBake.n
    ? +(g.bake.median - g.nonBake.median).toFixed(2) : null);
  // THE PLACE COMPARISON, which is the finding this driver actually produced.
  const bakeIn = indoor.filter((r) => r.dBakes > 0).map((r) => r.dt);
  const idleIn = indoor.filter((r) => r.dBakes === 0).map((r) => r.dt);
  out.indoor = {
    all: stat(indoor.map((r) => r.dt)),
    bake: stat(bakeIn),
    nonBake: stat(idleIn),
    insideConfirmed: out.insideConfirmed,
  };
  out.outdoor = { all: out.all };

  out.verdict = {
    frames: out.totalFrames,
    bakeFrames: out.bakeCount,
    bakeSharePct: out.bakeSharePct,
    // The place effect, paired within one run.
    outdoorMedian: out.all.median,
    outdoorOver16pct: out.all.over16pct,
    indoorMedian: out.indoor.all.median,
    indoorOver16pct: out.indoor.all.over16pct,
    indoorWorst: out.indoor.all.worst,
    insideConfirmed: out.insideConfirmed,
    // Do bakes explain the indoor spikes, even if they did not explain the
    // outdoor ones? Asked separately, because a cheap pass outdoors can be an
    // expensive one indoors.
    indoorBakeOver16pct: out.indoor.bake.over16pct ?? null,
    indoorNonBakeOver16pct: out.indoor.nonBake.over16pct ?? null,
    // If bakes ARE the spikes, over-16 concentrates almost entirely in them.
    overallOver16pct: out.all.over16pct,
    alignA_medianGapMs: sep(out.alignA),
    alignA_bakeOver16pct: out.alignA.bake.over16pct ?? null,
    alignA_nonBakeOver16pct: out.alignA.nonBake.over16pct ?? null,
    alignB_medianGapMs: sep(out.alignB),
    alignB_bakeOver16pct: out.alignB.bake.over16pct ?? null,
    alignB_nonBakeOver16pct: out.alignB.nonBake.over16pct ?? null,
  };
  fs.writeFileSync(path.join(OUT, 'a1-shadow-spike.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-SHADOW', JSON.stringify(out.verdict));
  console.log('  outdoor  ', JSON.stringify(out.all));
  console.log('  indoor   ', JSON.stringify(out.indoor.all));
  console.log('  in bake  ', JSON.stringify(out.indoor.bake));
  console.log('  in idle  ', JSON.stringify(out.indoor.nonBake));
  console.log('  A bake   ', JSON.stringify(out.alignA.bake));
  console.log('  A nonbake', JSON.stringify(out.alignA.nonBake));
  console.log('  B bake   ', JSON.stringify(out.alignB.bake));
  console.log('  B nonbake', JSON.stringify(out.alignB.nonBake));
  return out;
}
