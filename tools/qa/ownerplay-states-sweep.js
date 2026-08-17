// OWNER-PLAY STATES SWEEP — does warming the ENTRY state just move the
// freeze to the states a player reaches later? Evening, night, rain, and
// a shop that has been open a while, each visited in ONE live session with
// the warms held open; the tripwire and renderer.info arrivals are read
// per state. Any state that still compiles in play names itself here.
//
//   QA_OWNERPLAY_NO_BAILOUT=1 node tools/qa/run-electron.cjs \
//     tools/qa/ownerplay-states-sweep.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/ownerplay');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], states: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (process.env.QA_OWNERPLAY_NO_BAILOUT === '1') {
    await page.evaluate(() => { globalThis.__FW_PREWARM_NO_BAILOUT = true; });
    out.noBailout = true;
  }
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);

  const snapKeys = () => page.evaluate(
    () => (window.__fw.scene3d.renderer.info.programs || []).map((p) => String(p.cacheKey)),
  );
  const gapSampler = () => page.evaluate(() => {
    const S = { worst: 0, last: performance.now(), on: true };
    window.__sweepGap = S;
    const tick = () => {
      if (!S.on) return;
      const now = performance.now();
      S.worst = Math.max(S.worst, now - S.last);
      S.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const gapStop = () => page.evaluate(() => {
    const S = window.__sweepGap;
    S.on = false;
    return +S.worst.toFixed(0);
  });

  // one state visit: set the state, live a moment, walk a step, Tab round trip
  const visit = async (name, setup) => {
    const before = await snapKeys();
    await page.evaluate(setup);
    await page.waitForTimeout(2500); // the state takes hold on live frames
    await gapSampler();
    await page.keyboard.down('w');
    await page.waitForTimeout(1200);
    await page.keyboard.up('w');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(2500);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    const worst = await gapStop();
    const after = await snapKeys();
    const B = new Set(before);
    const fresh = after.filter((k) => !B.has(k));
    const named = fresh.slice(0, 12).map((key) => {
      const f = key.split(',');
      let best = null;
      for (const oldKey of B) {
        const o = oldKey.split(',');
        if (o.length !== f.length) continue;
        const diffs = [];
        for (let i = 0; i < f.length && diffs.length <= 4; i += 1) {
          if (o[i] !== f[i]) diffs.push({ i, was: o[i], is: f[i] });
        }
        if (diffs.length && (!best || diffs.length < best.length)) best = diffs;
      }
      return { family: f[0]?.slice(0, 12), diffs: best };
    });
    out.states.push({ name, arrivals: fresh.length, worstFrameMs: worst, named });
  };

  await visit('evening-1930', () => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 19 * 60 + 30;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
  });
  await visit('night-2300', () => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 23 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
  });
  await visit('rain-heavy', () => {
    const app = window.__fw;
    if (app.state.weather?.today) app.state.weather.today.rainIn = 0.8;
  });
  await visit('shop-open-awhile', () => {
    const app = window.__fw;
    // morning trading, sign open, an hour on the clock — the state a shop
    // that has been open a while actually sits in
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.state.signOpen = true;
  });

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(OUT, 'states-sweep.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
