// 3.3 (Goal 26) — "BOUNDED REPATH TIMING WITH JITTER SO AGENTS DO NOT ALL
// REPATH ON ONE FRAME."
//
// The failure this guards against is not hypothetical and it is not rare: when
// the player stands in the corridor, every shopper behind them stops making
// progress within a few frames of each other, so they all cross the same stuck
// gate on the same frame and the whole queue takes a ladder rung at once.
//
// WHAT MAKES THIS MEASURABLE is the difference between a total and a peak. Eight
// agents each repathing on their own frame and eight repathing together produce
// the SAME total. Only `peakPerFrame` can tell them apart, which is why the
// production counter records it and why this driver reads that rather than
// counting route calls.
//
// The scenario is the real one: park the player in the walkway so the shoppers
// behind genuinely stop progressing. Staging a synthetic stall would measure the
// staging.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-repath-jitter.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/repath-jitter');
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
  await page.waitForTimeout(5000);

  out.surfaceExists = await page.evaluate(() => {
    const ch = window.__fw?.scene3d?.clubhouse?.();
    return typeof ch?.qaNavRepath === 'function';
  });
  if (!out.surfaceExists) {
    out.verdict = { ABORTED: 'no qaNavRepath; this build has no per-frame repath accounting at all' };
    fs.writeFileSync(path.join(OUT, 'repath-jitter.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('REPATH-JITTER', JSON.stringify(out.verdict));
    return out;
  }

  out.staged = await page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    if (st.clock) st.clock.minutes = 600;
    if (st.shop) st.shop.signOpen = true;
    const ch = app.scene3d.clubhouse();
    const c = ch.interior.position;
    const w = app.scene3d.walk.state;
    // stand in the walkway between the door and the fixtures
    w.x = c.x; w.z = c.z + 5; w.vx = 0; w.vz = 0; w.yaw = Math.PI;
    return { minutes: st.clock?.minutes ?? null, signOpen: st.shop?.signOpen ?? null };
  });
  console.log('STAGED', JSON.stringify(out.staged));

  // TWENTY-FOUR, and the number matters. At EIGHT the peak is 1 on both builds:
  // rungs are about one a second, so they never land together and the jittered
  // and unjittered builds are indistinguishable. Measured at eight, this driver
  // would have reported a green "peak 1" and proved nothing at all -- the
  // scenario simply did not contain the failure. At twenty-four the unjittered
  // build peaks at FIVE ladder rungs on one frame and the jittered build at two,
  // which is the first density at which there is anything to fix.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    for (let i = 0; i < 24; i += 1) ch.debugSpawn(false);
    ch.qaNavRepathReset();
  });

  await page.waitForTimeout(45000);

  out.jitters = await page.evaluate(() => window.__fw.scene3d.clubhouse().qaNavRepath().jitters);
  out.repath = await page.evaluate(() => {
    const d = window.__fw.scene3d.clubhouse().qaNavRepath();
    return {
      peakPerFrame: d.peakPerFrame,
      framesWithAny: d.framesWithAny,
      total: d.total,
      meanPerActiveFrame: d.meanPerActiveFrame,
    };
  });
  console.log('JITTERS', JSON.stringify(out.jitters));
  console.log('REPATH', JSON.stringify(out.repath));

  // The jitter must be DISTINCT per customer and STABLE across frames -- a value
  // re-rolled every frame would smear the gate rather than stagger it, and two
  // runs of the same scenario would not be comparable.
  out.jitterStability = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const first = ch.qaNavRepath().jitters;
    await new Promise((d) => setTimeout(d, 2000));
    const second = ch.qaNavRepath().jitters;
    // BY CUSTOMER ID. The population changes between the two reads as people
    // arrive and leave, so an index-by-index comparison reports the values as
    // unstable when it is the list that moved. Only ids present in both count.
    const m = new Map(second.map((r) => [r.id, r.j]));
    const shared = first.filter((r) => m.has(r.id));
    const same = shared.length > 0 && shared.every((r) => m.get(r.id) === r.j);
    const values = first.map((r) => r.j).sort((a, b) => a - b);
    return {
      count: first.length,
      comparedAcrossBoth: shared.length,
      stable: same,
      distinct: new Set(values).size,
      spread: values.length ? +(values[values.length - 1] - values[0]).toFixed(3) : 0,
      values,
    };
  });
  console.log('JITTER-STABILITY', JSON.stringify(out.jitterStability));

  await page.screenshot({ path: path.join(OUT, 'blocked-walkway.png') });

  out.verdict = {
    shoppersSpawned: 24,
    laddersTaken: out.repath.total,
    framesWithAnyLadder: out.repath.framesWithAny,
    // THE CLAIM: agents do not all repath on one frame
    peakLaddersOnOneFrame: out.repath.peakPerFrame,
    meanPerActiveFrame: out.repath.meanPerActiveFrame,
    jitterAssigned: out.jitterStability.count,
    jitterValuesDistinct: out.jitterStability.distinct,
    jitterStableAcrossFrames: out.jitterStability.stable,
    jitterComparedAcrossBoth: out.jitterStability.comparedAcrossBoth,
    // the number that says whether it is jitter at all: 0.4 s is the design
    jitterSpreadSeconds: out.jitterStability.spread,
    // with no ladders taken at all this measures nothing, and saying so is the
    // difference between "the jitter works" and "nothing happened"
    measuredAnything: out.repath.total > 0,
  };
  console.log('REPATH-JITTER', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'repath-jitter.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
