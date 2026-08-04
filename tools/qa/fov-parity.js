async (page) => {
  // FOV PARITY â€” the permanent lens regression instrument (greybox-walk item 1).
  //
  //   node tools/qa/run-playwright.cjs tools/qa/fov-parity.js
  //
  // Asserts, in BOTH clubhouse variants:
  //   1. the boot lens is camera.fov === walk.state.fov === the stored preference
  //      (66 by default), and the projection matrix agrees â€” the render truth,
  //      which catches zoom/aspect corruption that camera.fov alone cannot;
  //   2. a full laptop cycle (Escape exit AND Close-button exit) hands the walk
  //      lens back exactly;
  //   3. the two variants render at the same FOV.
  // Scenario 4 boots once with a non-default stored preference (80) and asserts
  // it reaches the lens â€” the failure mode where "66" only means "nobody moved
  // the slider" stays visible.
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

  const readLens = () => page.evaluate(() => {
    const app = window.__fw;
    const camera = app.scene3d.camera;
    const m11 = camera.projectionMatrix.elements[5];
    return {
      cameraFov: camera.fov,
      walkFov: app.scene3d.walk.state.fov ?? null,
      renderedVerticalFov: +(2 * Math.atan(1 / m11) * 180 / Math.PI).toFixed(3),
      zoom: camera.zoom,
      aspect: +camera.aspect.toFixed(4),
      laptopOpen: !!app.laptopOpen,
    };
  });

  const settle = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 120000 });
    await page.waitForTimeout(2200);
  };

  const bootStarter = async (variant, prefFov = null) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async ([seed, fov]) => {
      localStorage.clear();
      const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
      const empire = E.newStarterEmpire('relaxed', seed);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
      if (fov) localStorage.setItem('golfempire:preferences:v1', JSON.stringify({ camera: { fov } }));
    }, [SEED, prefFov]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await settle();
    return readLens();
  };

  // The laptop cycle needs an installed laptop; campaign starters carry it as an
  // uninstalled facility, so this leg seeds the bootstrap-style empire.
  const bootBootstrapAndCycleLaptop = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async () => {
      localStorage.clear();
      const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
      const empire = E.newEmpire('relaxed', 424242);
      empire.cash = 10_000_000;
      const first = empire.market.find((listing) => listing.id === 'willow-creek') || empire.market[0];
      const bought = E.buyProperty(empire, first.id);
      if (!bought.ok) throw new Error(`bootstrap failed: ${bought.reason}`);
      bought.state.tutorial.complete = true;
      bought.state.tutorial.hidden = true;
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await settle();

    // Two candidate stands: the staff-chair diagonal (the v1 tour's approach) and
    // square-on north of the laptop (v2 â€” the kept desk lamp steals [E] from the
    // diagonal there). Try each until the lid opens.
    const sit = async () => {
      for (const stand of ['chair', 'north']) {
        await page.evaluate(async (which) => {
          const app = window.__fw;
          const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
          const o = app.scene3d.clubhouse().interior.position;
          const w = app.scene3d.walk.state;
          const laptop = L.FRONT_DESK.laptop;
          const seat = which === 'north'
            ? { x: laptop.x, z: laptop.z + 0.95 }
            : { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
          w.x = seat.x + o.x;
          w.z = seat.z + o.z;
          const dx = laptop.x - seat.x;
          const dz = laptop.z - seat.z;
          const horizontal = Math.hypot(dx, dz) || 0.001;
          w.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
          w.pitch = Math.atan2(1.06 - 1.62, horizontal);
        }, stand);
        await page.waitForTimeout(600);
        await page.keyboard.press('e');
        const opened = await page.waitForFunction(
          () => window.__fw.laptopOpen === true, null, { timeout: 6000 },
        ).then(() => true).catch(() => false);
        if (opened) break;
      }
      await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 1000 });
      // The interface is WELDED onto the 3D glass and glides while the seat pose
      // eases in; clicks routed through the projection mapper only land once the
      // frame has stopped moving.
      await page.waitForFunction(() => {
        const f = document.querySelector('.lt-frame');
        if (!f) return false;
        const r = f.getBoundingClientRect();
        const prev = window.__settle || {};
        window.__settle = { x: r.left, w: r.width };
        return Math.abs((prev.x ?? 0) - r.left) < 0.05
          && Math.abs((prev.w ?? 0) - r.width) < 0.05 && r.width > 100;
      }, null, { timeout: 15000, polling: 120 });
      await page.waitForTimeout(300);
    };

    const boot = await readLens();
    await sit();
    const seated = await readLens();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
    await page.waitForTimeout(500);
    const afterEscape = await readLens();
    await sit();
    // The laptop UI is projected onto the 3D screen: clicks route canvasâ†’DOM
    // through the alignment mapper, so a rect read before the projection settles
    // lands on bare canvas and dies silently. Settle, click, verify, retry.
    let afterClose = null;
    for (let attempt = 0; attempt < 3 && !afterClose; attempt += 1) {
      const closeSpot = await page.evaluate(() => {
        const hit = [...document.querySelectorAll('.lt-navbtn, button')]
          .find((entry) => /close laptop/i.test(entry.textContent || ''));
        if (!hit) return null;
        hit.scrollIntoView({ block: 'nearest' });
        const r = hit.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!closeSpot) break;
      await page.mouse.move(closeSpot.x, closeSpot.y);
      await page.waitForTimeout(120);
      await page.mouse.click(closeSpot.x, closeSpot.y);
      const closed = await page.waitForFunction(
        () => window.__fw.laptopOpen === false, null, { timeout: 4000 },
      ).then(() => true).catch(() => false);
      if (!closed) continue;
      await page.waitForTimeout(500);
      // The exit really happened â€” a silent read while still seated would report
      // the 34Â° seat lens as a "restore failure" that never occurred.
      afterClose = await readLens();
    }
    return { boot, seated, afterEscape, afterClose };
  };

  const lensOk = (lens, expected) => !!lens
    && lens.cameraFov === expected
    && lens.walkFov === expected
    && Math.abs(lens.renderedVerticalFov - expected) < 0.01
    && lens.zoom === 1;

  const out = { scenarios: {}, errs };

  // 1+3: starter boot, both variants, default preference.
  out.scenarios.starterIdle = {};
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    out.scenarios.starterIdle[variant] = await bootStarter(variant);
  }

  // 2: laptop cycles in both variants.
  out.scenarios.laptopCycle = {};
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    out.scenarios.laptopCycle[variant] = await bootBootstrapAndCycleLaptop(variant);
  }

  // 4: a non-default stored preference must reach the lens.
  out.scenarios.pref80 = await bootStarter('pine-hills', 80);

  // 5: the same lens truth at native-style DPR 2 (the shared runner pins the
  // context to deviceScaleFactor 1, so this is the one harness leg covering
  // high-DPR rendering; CDP override scoped to this boot only).
  {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 2, mobile: false,
    });
    try {
      out.scenarios.dpr2 = await bootStarter('pine-hills-v2');
      out.scenarios.dpr2.devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await cdp.detach().catch(() => {});
    }
  }

  const idleA = out.scenarios.starterIdle['pine-hills'];
  const idleB = out.scenarios.starterIdle['pine-hills-v2'];
  const cycA = out.scenarios.laptopCycle['pine-hills'];
  const cycB = out.scenarios.laptopCycle['pine-hills-v2'];
  out.checks = {
    idleBothAt66: lensOk(idleA, 66) && lensOk(idleB, 66),
    idleParity: idleA.renderedVerticalFov === idleB.renderedVerticalFov,
    laptopSeatsAt34: cycA.seated.cameraFov === 34 && cycB.seated.cameraFov === 34,
    laptopEscapeRestores: lensOk(cycA.afterEscape, 66) && lensOk(cycB.afterEscape, 66),
    laptopCloseRestores: lensOk(cycA.afterClose, 66) && lensOk(cycB.afterClose, 66),
    prefReachesLens: lensOk(out.scenarios.pref80, 80),
    idleDpr2At66: lensOk(out.scenarios.dpr2, 66)
      && out.scenarios.dpr2.devicePixelRatio === 2,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(outDir, 'fov-parity.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
