async (page) => {
  // TYPING "kit" MUST SURFACE THE CLUBHOUSE REPAIR KIT â€” READABLY.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/laptop-search-kit.js
  //
  // Round 2, 2026-07-30: "typing 'kit' does not surface the clubhouse repair kit" and
  // "the results UI is unreadable". The first claim is settled by reading the real rows
  // out of the real browser; the second is geometry, so it is measured, not eyeballed:
  // every result must be its own full-width ROW (stacked, not chips in a strip), the
  // page path must render with real height, and the item name must not be ellipsized â€”
  // scrollWidth > clientWidth is exactly the truncation the chip rail caused.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.join(repo, 'qa', 'laptop-search-round2');
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // Sit at the laptop the way the player does â€” the proven open sequence, retry included.
  const openLaptop = async () => {
    await page.evaluate(async () => {
      const app = window.__fw;
      const L = await import('/src/data/shopLayout.js');
      const origin = app.scene3d.clubhouse().interior.position;
      const st = app.scene3d.walk.state;
      const laptop = (() => {
        // D1: the LIVE rig rather than the layout datum.
        //
        // NOT because the datum was stale — it was the first hypothesis and it
        // is wrong. Measured 2026-08-04: the rig sits at interior-local
        // (-2.550, 1.557) and FRONT_DESK.laptop reads (-2.550, 1.557). B8 moved
        // the datum with the machine. This is here so a future move of one
        // without the other cannot silently re-open the same investigation; the
        // interior group carries no rotation, so local == world - origin, which
        // is the frame the surrounding maths is already written in.
        const ch = app.scene3d.clubhouse();
        const rig = ch.laptopRig ? ch.laptopRig() : null;
        const node = rig && rig.object;
        if (!node) return L.FRONT_DESK.laptop;
        ch.interior.updateMatrixWorld(true);
        const m = node.matrixWorld.elements;
        return { x: m[12] - ch.interior.position.x, z: m[14] - ch.interior.position.z };
      })();
      const seat = { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
      st.x = seat.x + origin.x;
      st.z = seat.z + origin.z;
      const dx = laptop.x - seat.x;
      const dz = laptop.z - seat.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      st.pitch = Math.atan2(1.06 - 1.62, horizontal);
      const clock = app.state.clock;
      clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 9 * 60;
      app.scene3d.applyTimeWeather(9 * 60, app.state.weather);
    });
    await page.waitForTimeout(800);
    await page.keyboard.press('KeyE');
    let open = await page.waitForFunction(() => (() => { const a = window.__fw; if (!a || a.laptopOpen !== true) return false; const s = document.querySelector('.laptop-screen'); if (!s || s.style.display === 'none') return false; const f = document.querySelector('.lt-frame'); if (!f) return false; const r = f.getBoundingClientRect(); if (!(r.width > 100 && r.height > 60)) return false; const p = window.__qaLtFrame || {}; window.__qaLtFrame = { x: r.left, w: r.width }; return Math.abs((p.x ?? -1e6) - r.left) < 0.5 && Math.abs((p.w ?? -1e6) - r.width) < 0.5; })(), null, { timeout: 6000 })
      .then(() => true).catch(() => false);
    if (!open) {
      await page.evaluate(async () => {
        const app = window.__fw;
        const L = await import('/src/data/shopLayout.js');
        const origin = app.scene3d.clubhouse().interior.position;
        const st = app.scene3d.walk.state;
        const laptop = (() => {
        // D1: the LIVE rig rather than the layout datum.
        //
        // NOT because the datum was stale — it was the first hypothesis and it
        // is wrong. Measured 2026-08-04: the rig sits at interior-local
        // (-2.550, 1.557) and FRONT_DESK.laptop reads (-2.550, 1.557). B8 moved
        // the datum with the machine. This is here so a future move of one
        // without the other cannot silently re-open the same investigation; the
        // interior group carries no rotation, so local == world - origin, which
        // is the frame the surrounding maths is already written in.
        const ch = app.scene3d.clubhouse();
        const rig = ch.laptopRig ? ch.laptopRig() : null;
        const node = rig && rig.object;
        if (!node) return L.FRONT_DESK.laptop;
        ch.interior.updateMatrixWorld(true);
        const m = node.matrixWorld.elements;
        return { x: m[12] - ch.interior.position.x, z: m[14] - ch.interior.position.z };
      })();
        st.x = laptop.x + origin.x;
        st.z = laptop.z + 0.95 + origin.z;
        st.yaw = Math.atan2(0, 0.95);
        st.pitch = Math.atan2(1.06 - 1.62, 0.95);
      });
      await page.waitForTimeout(700);
      await page.keyboard.press('KeyE');
      open = await page.waitForFunction(() => (() => { const a = window.__fw; if (!a || a.laptopOpen !== true) return false; const s = document.querySelector('.laptop-screen'); if (!s || s.style.display === 'none') return false; const f = document.querySelector('.lt-frame'); if (!f) return false; const r = f.getBoundingClientRect(); if (!(r.width > 100 && r.height > 60)) return false; const p = window.__qaLtFrame || {}; window.__qaLtFrame = { x: r.left, w: r.width }; return Math.abs((p.x ?? -1e6) - r.left) < 0.5 && Math.abs((p.w ?? -1e6) - r.width) < 0.5; })(), null, { timeout: 9000 })
        .then(() => true).catch(() => false);
    }
    await page.waitForFunction(() => {
      const r = document.querySelector('.laptop-screen');
      return r && r.style.display !== 'none';
    }, null, { timeout: 15000 }).catch(() => {});
    return open;
  };
  const laptopOpened = await openLaptop();
  await page.waitForTimeout(1400);

  // TYPE "kit", live, no submit.
  const field = page.locator('.laptop-screen input.lt-search').first();
  await field.click({ timeout: 8000 });
  for (const ch of 'kit') {
    await page.keyboard.type(ch, { delay: 70 });
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(600);

  // READ THE ROWS AND MEASURE THEM. getBoundingClientRect is post-projection (the laptop
  // DOM sits on the 3D screen quad), which is fine for stacking order and relative width;
  // scrollWidth/clientWidth are layout pixels, which is exactly where ellipsis happens.
  const rows = await page.evaluate(() => {
    const rail = document.querySelector('.lt-hitrail');
    const railBox = rail ? rail.getBoundingClientRect() : null;
    const list = [...document.querySelectorAll('.lt-hit')].map((row) => {
      const name = row.querySelector('.lt-hitname');
      const pathEl = row.querySelector('.lt-hitpath');
      const box = row.getBoundingClientRect();
      return {
        name: name ? name.textContent : null,
        nameTruncated: !!name && name.scrollWidth > name.clientWidth + 1,
        crumbs: [...row.querySelectorAll('.lt-hitcrumb')].map((n) => n.textContent),
        pathHasHeight: !!pathEl && pathEl.getBoundingClientRect().height > 1,
        kind: (row.querySelector('.lt-hitkind') || {}).textContent || null,
        box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      };
    });
    return {
      railBox: railBox && {
        x: Math.round(railBox.x), y: Math.round(railBox.y), w: Math.round(railBox.width), h: Math.round(railBox.height),
      },
      list,
      previewBarPresent: !!document.querySelector('.lt-previewbar'),
      previewPresent: !!document.querySelector('.lt-searchpreview'),
    };
  });

  await page.screenshot({ path: path.join(outDir, 'kit-1-viewport.png') });
  const screen = page.locator('.laptop-screen');
  if (await screen.count()) {
    await screen.first().screenshot({ path: path.join(outDir, 'kit-2-screen.png') }).catch(() => {});
  }

  const list = rows.list;
  const kitIndex = list.findIndex((r) => r.name === 'Clubhouse repair components');
  const kitRow = kitIndex >= 0 ? list[kitIndex] : null;

  // ONE RESULT PER ROW is a claim about stacking: each row starts below the previous
  // one's vertical middle. Chips in a strip share a baseline and fail this.
  let stacked = list.length > 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].box.y < list[i - 1].box.y + list[i - 1].box.h * 0.6) { stacked = false; break; }
  }
  // â€¦and each row spans the rail, rather than sitting in a 240 px chip.
  const fullWidth = !!rows.railBox && list.length > 0
    && list.every((r) => r.box.w >= rows.railBox.w * 0.9);

  // Findings are BOOLEANS ONLY â€” ok is every(v === true), and a row count in here
  // once made a fully green run report ok:false.
  const findings = {
    laptopOpened,
    anyRows: list.length > 0,
    repairKitPresent: kitIndex >= 0,
    repairKitFirst: kitIndex === 0,
    repairKitNameUntruncated: !!kitRow && kitRow.nameTruncated === false,
    repairKitPathShown: !!kitRow && kitRow.pathHasHeight && kitRow.crumbs.length >= 2,
    everyRowNamesItsPage: list.length > 0 && list.every((r) => r.crumbs.length >= 1 && r.pathHasHeight),
    noNameTruncatedAnywhere: list.length > 0 && list.every((r) => r.nameTruncated === false),
    oneResultPerRow: stacked,
    rowsSpanTheList: fullWidth,
    // Round 3, 2026-07-30 reversed this driver's last claim: the preview panel that made the
    // results readable-but-buried ("I see search results and a whole Pro Shop dashboard at
    // once") is gone, along with the breadcrumb-and-Open bar that headed it.
    noSecondPageUnderTheResults: !rows.previewPresent && !rows.previewBarPresent,
  };

  const result = {
    what: 'round 2 â€” "kit" surfaces the clubhouse repair kit, one readable location row per result',
    findings,
    rowsShown: list.length,
    rows: list,
    railBox: rows.railBox,
    kitIndex,
    shots: ['kit-1-viewport.png', 'kit-2-screen.png'],
    errs: errs.slice(0, 12),
    ok: Object.values(findings).every((v) => v === true) && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'laptop-search-kit.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
