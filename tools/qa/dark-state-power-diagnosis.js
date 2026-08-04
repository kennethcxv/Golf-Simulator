async (page) => {
  // Why the dark-state probe cannot reach an unpowered room, measured rather
  // than reasoned about.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/dark-state-power-diagnosis.js
  //
  // ceilingLightingDiagnostics().circuitPowered reports the SHELL's flag, which
  // initialises to true and only changes when the clubhouse update runs
  // updateFlicker. So the question is whether the sim says unpowered, and if it
  // does, whether the shell has been told.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  const read = (label) => page.evaluate(async (tag) => {
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    const app = window.__fw;
    const st = app.state;
    const ch = app.scene3d.clubhouse();
    const arch = R.ensureClubhouseArchitecture(st);
    const w = app.scene3d.walk.state;
    const o = ch.center;
    return {
      tag,
      speedIdx: app.speedIdx,
      campaignEnabled: st.campaign?.enabled ?? null,
      ceilingRestored: arch?.components?.ceiling?.restored ?? null,
      simSaysPowered: R.ceilingCircuitPowered(st),
      shellSaysPowered: ch.ceilingLightingDiagnostics?.().circuitPowered ?? null,
      playerLocal: { x: +(w.x - o.x).toFixed(2), z: +(w.z - o.z).toFixed(2) },
    };
  }, label);

  const out = { steps: [] };
  out.steps.push(await read('after boot, player wherever it spawned'));

  // Let the game run a while without touching anything.
  await page.evaluate(() => { window.__fw.speedIdx = 1; });
  await page.waitForTimeout(2000);
  out.steps.push(await read('after 2s at 1x, untouched'));

  // Now stand inside the room and let it run again.
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().center;
    const w = app.scene3d.walk.state;
    w.x = 1.7 + o.x; w.z = 0 + o.z; w.yaw = 0; w.pitch = 0;
  });
  await page.waitForTimeout(2000);
  out.steps.push(await read('after 2s standing inside'));

  return out;
}
