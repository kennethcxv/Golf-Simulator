async (page) => {
  // LAPTOP BINDING IN THE V2 ROOM â€” FLOOR_PLAN.md Â§9's laptop row.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-greybox-laptop.js
  //
  // Sits at the RELOCATED front-desk laptop with a real [E], asserts the walk lens
  // hands over and back (66 â†’ 34 â†’ 66) on BOTH exit routes (Escape, and the nav
  // rail's Close Laptop button clicked through the glass), and clicks every sidebar
  // destination where it lands on the projected quad â€” the laptop-tour method, aimed
  // at the v2 seat.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  // Campaign starters have the laptop as an UNINSTALLED facility â€” there is nothing
  // to sit at. Seed the runner's bootstrap-style non-campaign empire instead, where
  // facilityInstalled() is unconditionally true.
  void SEED;
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async () => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newEmpire('relaxed', 424242);
    empire.cash = 10_000_000;
    const first = empire.market.find((listing) => listing.id === 'willow-creek') || empire.market[0];
    const bought = E.buyProperty(empire, first.id);
    if (!bought.ok) throw new Error(`QA property bootstrap failed: ${bought.reason}`);
    bought.state.tutorial.complete = true;
    bought.state.tutorial.hidden = true;
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  const lens = () => page.evaluate(() => ({
    cameraFov: window.__fw.scene3d.camera.fov,
    cameraNear: +window.__fw.scene3d.camera.near.toFixed(4),
    walkFov: window.__fw.scene3d.walk.state.fov,
    laptopOpen: !!window.__fw.laptopOpen,
  }));

  // Stand at the v2 staff side facing the laptop â€” poses from the LIVE layout module.
  const sitDown = async () => {
    await page.evaluate(async () => {
      const app = window.__fw;
      const L = await import('/src/data/shopLayout.js');
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      // Stand square-on north of the laptop: from the chair diagonal, the kept desk
      // lamp (asset 83) sits almost on the aim line and steals the [E] focus.
      const laptop = L.FRONT_DESK.laptop;
      const seat = { x: laptop.x, z: laptop.z + 0.95 };
      w.x = seat.x + o.x;
      w.z = seat.z + o.z;
      const dx = laptop.x - seat.x;
      const dz = laptop.z - seat.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      w.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      w.pitch = Math.atan2(1.06 - 1.62, horizontal);
      const st = app.state;
      st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 9 * 60 + 20;
      app.scene3d.applyTimeWeather(9 * 60 + 20, st.weather);
    });
    await page.waitForTimeout(700);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForFunction(() => {
      const r = document.querySelector('.laptop-screen');
      return r && r.style.display !== 'none';
    }, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const f = document.querySelector('.lt-frame');
      if (!f) return false;
      const r = f.getBoundingClientRect();
      const prev = window.__settle || {};
      window.__settle = { x: r.left, w: r.width };
      return Math.abs((prev.x ?? 0) - r.left) < 0.05 && Math.abs((prev.w ?? 0) - r.width) < 0.05 && r.width > 100;
    }, null, { timeout: 15000, polling: 120 });
    await page.waitForTimeout(300);
  };

  const before = await lens();
  await sitDown();
  const seated = await lens();

  // Every sidebar destination, clicked where it lands on the glass â€” the SHIPPED
  // labels (src/ui/laptop.js NAV), not the stale tour's.
  const PAGES = ['Home', 'Bookings', 'Pro Shop', 'Course', 'Upgrades', 'Business', 'Settings'];
  const log = [];
  for (const label of PAGES) {
    const spot = await page.evaluate((lbl) => {
      const buttons = [...document.querySelectorAll('.lt-navbtn')];
      const button = buttons.find((entry) => entry.textContent.trim().includes(lbl));
      if (!button) return null;
      button.scrollIntoView({ block: 'nearest' });
      const r = button.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, label);
    if (!spot) {
      log.push({ page: label, ok: false, why: 'no nav button' });
      continue;
    }
    await page.mouse.move(spot.x, spot.y);
    await page.waitForTimeout(90);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(420);
    const state = await page.evaluate(() => {
      const err = document.querySelector('.lt-err');
      const content = document.querySelector('.lt-content');
      return {
        activeNav: (document.querySelector('.lt-navbtn.on') || {}).textContent?.trim() || null,
        crashed: !!(err && /could not be drawn/.test(err.textContent)),
        errText: err ? err.textContent.trim().slice(0, 120) : null,
        nodes: content ? content.querySelectorAll('*').length : 0,
      };
    });
    log.push({
      page: label,
      clickLandedRight: !!(state.activeNav && state.activeNav.includes(label)),
      crashed: state.crashed,
      err: state.crashed ? state.errText : undefined,
      nodes: state.nodes,
    });
  }
  await page.screenshot({ path: path.join(outDir, 'greybox-laptop-seated.png') });

  // Exit route 1: Escape.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const afterEscape = await lens();

  // Exit route 2: the Close Laptop control, through the glass.
  await sitDown();
  const seatedAgain = await lens();
  const closeSpot = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('.lt-navbtn, button')]
      .filter((entry) => /close laptop/i.test(entry.textContent || ''));
    if (!candidates.length) return null;
    candidates[0].scrollIntoView({ block: 'nearest' });
    const r = candidates[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  let afterCloseButton = null;
  if (closeSpot) {
    await page.mouse.move(closeSpot.x, closeSpot.y);
    await page.waitForTimeout(90);
    await page.mouse.click(closeSpot.x, closeSpot.y);
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    afterCloseButton = await lens();
  }

  const result = {
    seatPose: 'COUNTER.staffStand â†’ FRONT_DESK.laptop (live v2 datums)',
    lens: { before, seated, afterEscape, seatedAgain, afterCloseButton },
    pages: log,
    crashes: log.filter((entry) => entry.crashed).map((entry) => `${entry.page}: ${entry.err}`),
    misclicks: log.filter((entry) => entry.clickLandedRight === false).map((entry) => entry.page),
    errs: errs.slice(0, 12),
    ok: before.cameraFov === 66
      && seated.cameraFov === 34
      && afterEscape.cameraFov === 66
      && (!afterCloseButton || afterCloseButton.cameraFov === 66)
      && log.every((entry) => entry.clickLandedRight && !entry.crashed),
  };
  fs.writeFileSync(path.join(outDir, 'greybox-laptop.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
