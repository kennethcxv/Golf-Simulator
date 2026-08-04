async (page) => {
  // A7 — CUSTOMER CONCURRENCY vs SHOP PERFORMANCE, measured at 1x.
  //
  // "Concurrency is pinned near one. Scale it with how the shop is doing."
  //
  // Runs the live floor at 1x for three shops that differ only in reputation
  // and cleanliness, and samples how many shoppers are actually in the room.
  // The model's own target is read alongside, so a gap between "what it aimed
  // for" and "who turned up" is visible rather than hidden inside one number.
  //
  // Negative controls, stated before the results are used:
  //   - CLOSED: with the sign flipped to closed the floor must drain to zero.
  //     A sampler that reports a crowd with the shop shut is reading something
  //     other than the floor.
  //   - The three runs must not all report the same peak. Identical numbers
  //     mean the inputs never reached the model.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/shop-footfall');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const VIEWPORT = { width: 1280, height: 720 };

  await page.setViewportSize(VIEWPORT);
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const bootUrl = `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`;
  await (await import(bootUrl)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1200);

  // 1x, explicitly. speedIdx 0 is PAUSED in this build, not 1x — the whole
  // measurement would read zero arrivals and look like a scaling failure.
  const speed = await page.evaluate(() => {
    const app = window.__fw;
    const before = app.speedIdx;
    app.speedIdx = 1;
    return { before, after: app.speedIdx };
  });
  assert(speed.after === 1, `could not set 1x (speedIdx ${JSON.stringify(speed)})`);

  const configure = (shop) => page.evaluate(async (input) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const { seedReputation } = await import(new URL('src/sim/reputation.js', document.baseURI).href);
    const { flipSign, signIsOpen } = await import(new URL('src/sim/shopSign.js', document.baseURI).href);
    const { shopCondition } = await import(new URL('src/sim/shop.js', document.baseURI).href);
    const state = app.state;
    clubhouse.clearWalkins();
    clubhouse.setOrganicWalkins(true);
    seedReputation(state, input.reputation);
    // cleanliness is derived from the renovation arrays, so drive those
    const reno = state.shop.reno;
    if (Array.isArray(reno.grime)) reno.grime = reno.grime.map(() => 1 - input.clean);
    if (Array.isArray(reno.windows)) reno.windows = reno.windows.map(() => 1 - input.clean);
    if (Array.isArray(reno.clutter)) {
      reno.clutter = reno.clutter.map((item) => ({ ...item, cleared: input.clean > 0.5 }));
    }
    // NOTE: an earlier version raised state.shop.progression.tier here to widen
    // the capacity ceiling. Writing the tier at runtime throws
    // "fixtureSockets is not defined" out of a rebuild path, and an exception
    // inside the frame callback stops the loop — the clock froze at 840.04 and
    // every shop measured zero, which reads exactly like a scaling failure.
    // The tier stays where the save has it; the ceiling is reported instead.
    // mid-afternoon, trading, sign open
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (input.open && !signIsOpen(state)) flipSign(state, 14 * 60);
    if (!input.open && signIsOpen(state)) flipSign(state, 14 * 60);
    return {
      reputation: state.reputation.overall,
      condition: Math.round(shopCondition(state)),
      open: signIsOpen(state),
      diagnostics: clubhouse.footfallDiagnostics(),
    };
  }, shop);

  const sampleFloor = async (seconds) => {
    const samples = [];
    for (let tick = 0; tick < seconds; tick += 1) {
      await page.waitForTimeout(1000);
      samples.push(await page.evaluate(() => {
        const clubhouse = window.__fw.scene3d.clubhouse();
        return {
          onFloor: clubhouse.footfallDiagnostics().onFloor,
          target: clubhouse.footfallDiagnostics().target,
        };
      }));
    }
    const counts = samples.map((s) => s.onFloor);
    return {
      seconds,
      peak: Math.max(...counts),
      mean: +(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2),
      finalTarget: samples[samples.length - 1].target,
      trace: counts,
    };
  };

  const report = { speedIdx: speed.after, runs: {} };
  const CASES = [
    { name: 'low', reputation: 25, clean: 0.0, open: true, seconds: 75 },
    { name: 'mid', reputation: 55, clean: 0.7, open: true, seconds: 75 },
    { name: 'high', reputation: 85, clean: 1.0, open: true, seconds: 75 },
  ];
  for (const shop of CASES) {
    const setup = await configure(shop);
    const floor = await sampleFloor(shop.seconds);
    report.runs[shop.name] = { setup, floor };
  }

  // ---- negative control: shut the door and the floor must empty -------------
  const closed = await configure({ reputation: 85, clean: 1.0, open: false });
  const closedFloor = await sampleFloor(40);
  report.closedControl = { setup: closed, floor: closedFloor };

  fs.writeFileSync(path.join(OUT, 'shop-footfall.json'), JSON.stringify(report, null, 2));

  assert(closedFloor.trace[closedFloor.trace.length - 1] === 0,
    `NEGATIVE CONTROL FAILED: ${closedFloor.trace.at(-1)} shoppers were still on the floor with the sign CLOSED. The sampler is not reading the live floor.`);
  const peaks = CASES.map((shop) => report.runs[shop.name].floor.peak);
  assert(new Set(peaks).size > 1,
    `NEGATIVE CONTROL FAILED: all three shops peaked at ${peaks[0]}. The reputation and cleanliness inputs never reached the model.`);
  assert(peaks[2] > peaks[0],
    `a high-performing shop (${peaks[2]}) must draw more than a failing one (${peaks[0]}).`);
  return report;
}
