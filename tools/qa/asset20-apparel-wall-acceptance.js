async (page) => {
  // Asset 20 focused acceptance. Deterministic setup changes inventory and the
  // player pose only; restocking, customer pickup, save and load use the game's
  // normal keyboard/UI paths or the documented real-debit customer fixture.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.resolve(repo, process.env.ASSET20_QA_OUT
    || 'qa/assets_01_50_master/after/sheet02/asset20-acceptance');
  fs.mkdirSync(out, { recursive: true });

  const viewport = { width: 1600, height: 900 };
  const errors = [];
  const warnings = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const evidence = [];
  async function shot(name) {
    const file = path.join(out, name);
    await page.screenshot({ path: file });
    evidence.push(file);
    return file;
  }

  async function waitForGame() {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      return clubhouse && (!clubhouse.assetsReady || clubhouse.assetsReady());
    }, null, { timeout: 90000 });
    await page.waitForTimeout(900);
  }

  async function aimAtDisplay() {
    await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x - 0.30;
      walk.state.z = origin.z + 0.90;
      const dx = (origin.x - 2.40) - walk.state.x;
      const dz = (origin.z + 0.90) - walk.state.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = -0.08;
    });
    await page.waitForTimeout(180);
  }

  async function setDisplay(shelf, back) {
    return page.evaluate(({ shelfCount, backCount }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.speedIdx = 0;
      app.state.shop.inventory.jacket2.shelf = shelfCount;
      app.state.shop.inventory.jacket2.back = backCount;
      app.state.shop.held = (app.state.shop.held || []).filter((unit) => unit.skuId !== 'jacket2');
      clubhouse.rebuildStock?.();
      return { shelf: shelfCount, back: backCount };
    }, { shelfCount: shelf, backCount: back });
  }

  async function snapshot(label) {
    return page.evaluate((stateLabel) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const inventory = app.state.shop.inventory.jacket2;
      const candidates = [];
      let nonFiniteVisibleObjects = 0;
      app.scene3d.scene.updateMatrixWorld(true);
      clubhouse.interior.traverseVisible((object) => {
        if (!object.matrixWorld.elements.every(Number.isFinite)) nonFiniteVisibleObjects += 1;
        if (!object.userData?.merchBaked) return;
        if (Math.abs(object.position.x + 2.4) > 0.02 || Math.abs(object.position.z - 0.9) > 0.02) return;
        let meshes = 0;
        let triangles = 0;
        let nonFiniteVertices = 0;
        object.traverseVisible((child) => {
          if (!child.isMesh || !child.geometry) return;
          meshes += 1;
          const geometry = child.geometry;
          triangles += geometry.index
            ? geometry.index.count / 3
            : (geometry.attributes?.position?.count || 0) / 3;
          const position = geometry.attributes?.position?.array || [];
          for (let index = 0; index < position.length; index += 1) {
            if (!Number.isFinite(position[index])) nonFiniteVertices += 1;
          }
        });
        candidates.push({ meshes, triangles, nonFiniteVertices });
      });
      return {
        label: stateLabel,
        shelf: Number(inventory.shelf),
        back: Number(inventory.back),
        capacity: 8,
        heldJackets: (app.state.shop.held || []).filter((unit) => unit.skuId === 'jacket2').length,
        focusLabel: app.scene3d.walk.getFocusLabel?.() || '',
        nonFiniteVisibleObjects,
        stock: candidates[0] || null,
        stockCandidates: candidates.length,
      };
    }, label);
  }

  async function samplePerformance(label) {
    const frameTimes = [];
    for (let sample = 0; sample < 2; sample += 1) {
      const values = await page.evaluate(() => new Promise((resolve) => {
        const frames = [];
        let previous = performance.now();
        const start = previous;
        function tick(now) {
          frames.push(now - previous);
          previous = now;
          if (now - start >= 1600) resolve(frames.slice(1));
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }));
      frameTimes.push(...values);
    }
    const sorted = [...frameTimes].filter((value) => value > 0).sort((a, b) => b - a);
    const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const slowMean = sorted.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
    const duration = sorted.reduce((sum, value) => sum + value, 0);
    const renderer = await page.evaluate(() => new Promise((resolve) => {
      const info = window.__fw.scene3d.renderer.info;
      info.autoReset = false;
      info.reset();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const result = {
          drawCalls: info.render.calls,
          renderedTriangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
        };
        info.autoReset = true;
        resolve(result);
      }));
    }));
    return {
      label,
      frameCount: sorted.length,
      averageFps: sorted.length * 1000 / duration,
      onePercentLowFps: 1000 / slowMean,
      worstFrameMs: sorted[0] || null,
      renderer,
    };
  }

  async function openPauseMenu() {
    if (await page.evaluate(() => !!document.pointerLockElement)) {
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await page.locator('.pause-veil-ui').count()) return;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(180);
    }
    await page.waitForSelector('.pause-veil-ui', { timeout: 5000 });
  }

  async function saveAndLoadSlotOne() {
    await openPauseMenu();
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    const saveHere = page.getByRole('button', { name: 'Save here', exact: true }).first();
    await saveHere.waitFor({ state: 'visible' });
    await saveHere.click();
    await page.waitForTimeout(450);
    const saveEvidence = await shot('05-pending-pickup-saved-through-pause-menu.png');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();

    await openPauseMenu();
    await page.getByRole('button', { name: 'Load game', exact: true }).click();
    const load = page.getByRole('button', { name: 'Load', exact: true }).first();
    await load.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent.trim() === 'Load');
      return !!button && !button.disabled;
    }, null, { timeout: 6000 });
    await page.evaluate(() => { window.__asset20PriorScene = window.__fw.scene3d; });
    await load.click();
    await page.waitForFunction(() => window.__fw?.scene3d
      && window.__fw.scene3d !== window.__asset20PriorScene
      && window.__fw.scene3d.clubhouse?.(), null, { timeout: 90000 });
    await waitForGame();
    return saveEvidence;
  }

  await page.setViewportSize(viewport);
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await waitForGame();
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.state.weather.locked = true;
    if (app.state.shop.reno) {
      app.state.shop.reno.grime.fill(0);
      for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
      clubhouse.rebuildReno?.();
    }
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
  });

  // Make both authored jacket families GPU-resident before the matched A/B.
  // Otherwise the full sample also measures deferred first-use upload for the
  // prototype meshes, which is startup residency rather than display overhead.
  await setDisplay(8, 0);
  await aimAtDisplay();
  await page.waitForTimeout(1200);
  await setDisplay(0, 8);
  await aimAtDisplay();
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(240);
  await page.waitForFunction(() => /Outerwear rail/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 5000 });
  const empty = await snapshot('empty');
  assert(empty.shelf === 0 && empty.back === 8 && empty.heldJackets === 0,
    `Empty state drifted: ${JSON.stringify(empty)}.`);
  assert(empty.nonFiniteVisibleObjects === 0, 'Empty display has a non-finite visible object.');
  await shot('01-empty-0-of-8-player-camera.png');
  const emptyPerformance = await samplePerformance('empty-0-of-8');

  await setDisplay(4, 4);
  await page.waitForTimeout(350);
  const half = await snapshot('half');
  assert(half.shelf === 4 && half.back === 4 && half.stock?.triangles > 0,
    `Half-full state is not physically rendered: ${JSON.stringify(half)}.`);
  assert(half.stock.nonFiniteVertices === 0 && half.nonFiniteVisibleObjects === 0,
    'Half-full display contains non-finite geometry.');
  await shot('02-half-full-4-hanging-player-camera.png');

  await setDisplay(0, 8);
  await aimAtDisplay();
  await page.waitForFunction(() => /Outerwear rail.*0 out.*8 in the back.*restock/i.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 5000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const item = window.__fw?.state?.shop?.inventory?.jacket2;
    return item?.shelf === 8 && item?.back === 0;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(800);
  const full = await snapshot('full-after-normal-E-restock');
  assert(full.shelf === full.capacity && full.stock?.triangles > half.stock.triangles,
    `Normal E restock did not render all eight units: ${JSON.stringify(full)}.`);
  assert(full.stock.nonFiniteVertices === 0 && full.nonFiniteVisibleObjects === 0,
    'Full display contains non-finite geometry.');
  await shot('03-full-8-of-8-after-normal-E-restock.png');
  const fullPerformance = await samplePerformance('full-8-of-8');

  const customer = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().sendToCounter(['jacket2'], 'card')
  ));
  assert(customer, 'Documented customer fixture could not pick one jacket from the shelf.');
  await page.waitForFunction(() => {
    const app = window.__fw;
    return app.state.shop.inventory.jacket2.shelf === 7
      && (app.state.shop.held || []).filter((unit) => unit.skuId === 'jacket2').length === 1;
  }, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const pickup = await snapshot('customer-pickup');
  assert(pickup.shelf === 7 && pickup.heldJackets === 1,
    `Customer pickup did not debit exactly one visible unit: ${JSON.stringify(pickup)}.`);
  await shot('04-customer-pickup-7-visible-1-held.png');

  await saveAndLoadSlotOne();
  await aimAtDisplay();
  await page.waitForTimeout(500);
  const recovered = await snapshot('loaded-pending-pickup-recovery');
  assert(recovered.shelf === 8 && recovered.back === 0 && recovered.heldJackets === 0,
    `Load did not return the unpaid held jacket exactly once: ${JSON.stringify(recovered)}.`);
  assert(recovered.stock?.nonFiniteVertices === 0 && recovered.nonFiniteVisibleObjects === 0,
    'Reloaded display contains non-finite geometry.');
  await shot('06-loaded-unpaid-jacket-returned-exactly-once.png');

  const performanceDelta = {
    averageFpsRatio: fullPerformance.averageFps / emptyPerformance.averageFps,
    onePercentLowRatio: fullPerformance.onePercentLowFps / emptyPerformance.onePercentLowFps,
    drawCalls: fullPerformance.renderer.drawCalls - emptyPerformance.renderer.drawCalls,
    renderedTriangles: fullPerformance.renderer.renderedTriangles
      - emptyPerformance.renderer.renderedTriangles,
    geometries: fullPerformance.renderer.geometries - emptyPerformance.renderer.geometries,
    textures: fullPerformance.renderer.textures - emptyPerformance.renderer.textures,
  };
  assert(performanceDelta.averageFpsRatio >= 0.75,
    `Eight-unit display reduced matched-camera average FPS too far: ${JSON.stringify(performanceDelta)}.`);
  assert(performanceDelta.onePercentLowRatio >= 0.70,
    `Eight-unit display reduced matched-camera 1% low too far: ${JSON.stringify(performanceDelta)}.`);
  assert(performanceDelta.drawCalls <= 80
      && performanceDelta.renderedTriangles <= 70000
      && performanceDelta.geometries <= 24
      && performanceDelta.textures <= 8,
  `Eight-unit display exceeded its incremental renderer budget: ${JSON.stringify(performanceDelta)}.`);

  const nonAbortedFailedRequests = failedRequests.filter((entry) => !/ERR_ABORTED/i.test(entry.error));
  assert(errors.length === 0, `Console errors: ${errors.join(' | ')}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
  assert(nonAbortedFailedRequests.length === 0,
    `Non-aborted request failures: ${JSON.stringify(nonAbortedFailedRequests)}.`);

  return {
    ok: true,
    route: 'asset20-normal-controls-and-recovery',
    fixtureBoundary: 'inventory/time/weather/player-pose normalization plus documented real-debit sendToCounter only; E restock and pause-menu save/load use Playwright controls',
    viewport,
    states: { empty, half, full, pickup, recovered },
    controls: {
      restock: 'normal E key while Outerwear rail focus prompt was active',
      pickup: 'documented sendToCounter fixture; real pickFromShelf debit and held UID',
      save: 'pause menu > Save game > Save here',
      load: 'pause menu > Load game > Load',
    },
    performance: { empty: emptyPerformance, full: fullPerformance, delta: performanceDelta },
    evidence,
    diagnostics: { errors, warnings, pageErrors, failedRequests, nonAbortedFailedRequests },
  };
}
