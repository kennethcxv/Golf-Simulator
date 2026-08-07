// G2 — DOES THE SLIDING BRANCH EVER GET TO RESCUE ANYBODY?
//
// tests/nav-stuck-verdict.test.js proves the two stuck tests answer for
// different states: there is an input where displacement says "walking fine"
// and progress says "stuck". That is half the brief's question. The other half
// is whether the game ever produces that input at the shipped 2.5 s threshold —
// report 14 measured the no-progress clock peaking at 1.66 s and could say no
// more than "the branch never fired".
//
// So run the shop busy for a long stretch at 1x with the doors open, and read
// the high-water mark and the rescue count off the nav diagnostics.
//
// CONTROL. The same window is sampled with the customer simulation SUSPENDED.
// With nobody walking, the peak must stay at whatever it already was and the
// rescue count must not move. If the numbers climb with nothing moving, they
// are not about customers and neither is the conclusion.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/nav-progress');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  const world = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins?.(true);
    // stand out of the way so the player is not itself an obstacle
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 7.4; w.z = o.z + 5.6; w.yaw = 0.6; w.pitch = -0.05;
    return { speedIdx: app.speedIdx, open: !!app.state.shop?.signOpen };
  });

  const read = () => page.evaluate(() => {
    const d = window.__fw.scene3d.clubhouse().navBlockDiagnostics();
    const byAction = {};
    for (const entry of d.recent || []) byAction[entry.action] = (byAction[entry.action] || 0) + 1;
    return {
      total: d.total,
      progressPeakSeconds: d.progressPeakSeconds,
      slidingRescues: d.slidingRescues,
      slidingThresholdSeconds: d.slidingThresholdSeconds,
      byAction,
    };
  });

  const start = await read();
  // a long busy stretch: shoppers arriving, routing round fixtures and each other
  await page.waitForTimeout(150000);
  const busy = await read();

  // ---- CONTROL: the same span with nobody walking -------------------------------------
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.setOrganicWalkins?.(false);
    window.__fw.speedIdx = 0; // paused: no customer stepping at all
  });
  await page.waitForTimeout(3000);
  const beforeQuiet = await read();
  await page.waitForTimeout(40000);
  const afterQuiet = await read();

  await page.screenshot({ path: path.join(OUT, 'shop-floor.png') });

  const out = {
    world, start, busy, beforeQuiet, afterQuiet,
    climbedWhileBusy: {
      peak: +(busy.progressPeakSeconds - start.progressPeakSeconds).toFixed(2),
      blocks: busy.total - start.total,
      slidingRescues: busy.slidingRescues - start.slidingRescues,
    },
    climbedWhileQuiet: {
      peak: +(afterQuiet.progressPeakSeconds - beforeQuiet.progressPeakSeconds).toFixed(2),
      blocks: afterQuiet.total - beforeQuiet.total,
      slidingRescues: afterQuiet.slidingRescues - beforeQuiet.slidingRescues,
    },
    checks: {
      // the control: nothing may climb with nobody walking
      quietRunIsQuiet: true, // filled below
      busyRunSawCustomers: busy.total > start.total || busy.progressPeakSeconds > 0,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.checks.quietRunIsQuiet = out.climbedWhileQuiet.peak <= 0.01
    && out.climbedWhileQuiet.slidingRescues === 0;
  // THE ANSWER the brief asks for
  out.verdict = busy.slidingRescues > 0
    ? 'the sliding branch rescued customers displacement did not flag'
    : `the sliding branch never fired: peak ${busy.progressPeakSeconds}s against a ${busy.slidingThresholdSeconds}s threshold`;
  out.ok = out.checks.quietRunIsQuiet && out.checks.busyRunSawCustomers;
  fs.writeFileSync(path.join(OUT, 'nav-progress.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
