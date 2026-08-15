// B (Goal 21) — DOES THE LOOK-AHEAD RUN IN THE REAL SHOP?
//
// It passed eight headless tests against a hand-drawn room of literal boxes and
// the owner still watches customers walk into things. Every one of those tests
// called steerAround directly. NONE of them asked whether the shop ever calls
// it — which is the question, and the reason the check passed while the game
// did not change.
//
// This lets real customers walk around the real shop for a minute and reads the
// counters the movement path now keeps. The number that matters is `engagedPct`:
// the share of movement steps where the look-ahead was allowed to look at all.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b-steer-runs.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b-steer');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2000);

  // A busy shop with the doors open, and the player standing out of the way so
  // the numbers are about customers rather than about me.
  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x + 4.4; w.z = o.z + 4.0; w.yaw = Math.PI * 0.75; w.pitch = -0.1;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 11 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    ch.setOrganicWalkins?.(true);
  });

  // The live customer loop is in clubhouse.js, not in clubhouse/customers.js
  // (which nothing imports), so the counters come off navBlockDiagnostics.
  const read = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const d = ch.navBlockDiagnostics?.();
    if (!d) return { missing: true };
    const cust = typeof ch.customers === 'function' ? ch.customers() : null;
    return { steer: d.steer || null, actors: Array.isArray(cust) ? cust.length : -1 };
  });

  // let the shop fill and walk for a minute of real time
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(5000);
    const s = await read();
    if (s) samples.push({ atSec: (i + 1) * 5, ...s });
  }
  await page.screenshot({ path: path.join(OUT, 'shop.png') });

  const last = samples.at(-1);
  const out = {
    samples,
    final: last,
    errs,
  };
  out.checks = {
    customersExisted: (last?.actors || 0) > 0,
    movementHappened: (last?.steer?.calls || 0) > 100,
    // THE QUESTION. If this is near zero the look-ahead is shipped disabled and
    // every test that passed measured code the game never reaches.
    lookAheadEverEngaged: (last?.steer?.engagedPct || 0) > 5,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'steer-runs.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
