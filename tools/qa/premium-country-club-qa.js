async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const pass = process.env.PREMIUM_QA_PASS || 'iteration-1';
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.join(process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'premium-clubhouse', pass);
  fs.mkdirSync(out, { recursive: true });

  const browserDiagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') browserDiagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') browserDiagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => browserDiagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => browserDiagnostics.requestFailures.push({
    url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = 'premiumPrivate';
    holding.state.property.tierId = 'premiumPrivate';
    holding.state.tutorial.complete = true;
    holding.state.tutorial.hidden = true;
    if (holding.state.campaign) holding.state.campaign.businessOpen = false;
    const reno = holding.state.shop.reno;
    if (Array.isArray(reno.decor)) reno.decor.length = 0;
    reno.grime?.fill(0);
    reno.windows?.fill(0);
    reno.clutter?.forEach((pile) => { pile.cleared = true; });
    if (reno.exterior) {
      reno.exterior.weeds?.fill(0);
      reno.exterior.siding?.fill(0);
      reno.exterior.gutter = 0;
      reno.exterior.cobwebs = 0;
      reno.exterior.light = 0;
    }
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    return clubhouse?.premiumCountryClub?.diagnostics?.().status === 'ready';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(3500);

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather = {
      ...app.state.weather,
      today: {
        ...app.state.weather?.today,
        tempHiF: 72,
        tempLoF: 53,
        rainIn: 0,
        humidity: 0.42,
        windMph: 4,
      },
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    ui.clearToasts();
    // Dynamic campaign and delivery beats are outside this architectural QA
    // scope. Keep the regular HUD visible, but suppress its transient stack so
    // fixed-angle comparisons are deterministic and unobstructed.
    const notifications = document.querySelector('.notification-center');
    if (notifications) notifications.style.display = 'none';
    const clubhouse = app.scene3d.clubhouse();
    return {
      center: { x: clubhouse.group.position.x, z: clubhouse.group.position.z },
      diagnostics: clubhouse.premiumCountryClub.diagnostics(),
      tier: app.state.property?.tierId,
      checkoutSnapshot: {
        phase: app.state.shop?.register?.phase,
        inventorySkuCount: Object.keys(app.state.shop?.inventory || {}).length,
        cash: app.state.cash,
      },
    };
  });
  await page.mouse.click(800, 450);
  await page.waitForTimeout(300);

  const shots = [
    { id: '01-grand-approach', at: [0, 70], to: [0, 8], pitch: 0.075 },
    { id: '02-front-symmetry', at: [0, 57], to: [0, 7], pitch: 0.055 },
    { id: '03-member-entrance', at: [0, 24], to: [0, 7], pitch: 0.035 },
    { id: '04-bag-drop', at: [-26, 24], to: [-11, 7], pitch: 0.02 },
    { id: '05-tournament-entry', at: [26, 24], to: [11, 7], pitch: 0.02 },
    { id: '06-roundabout-fountain', at: [-15, 48], to: [0, 38], pitch: -0.015 },
    { id: '07-west-parking', at: [-35.5, 69], to: [-35.5, 49], pitch: 0.12 },
    { id: '08-east-parking', at: [35.5, 69], to: [35.5, 49], pitch: 0.12 },
    { id: '09-east-terrace', at: [21, -23], to: [7, -11], pitch: 0.045 },
    { id: '10-rear-veranda', at: [0, -24], to: [0, -5], pitch: 0.045 },
    { id: '11-cart-staging', at: [-36, -28], to: [-21, -14], pitch: 0.035 },
    { id: '12-service-court', at: [20, -27], to: [8, -14], pitch: 0.04 },
    { id: '13-empty-interior', at: [0, 3], to: [12, -1], pitch: -0.01 },
  ];
  const captured = [];
  for (const shot of shots) {
    await page.evaluate(async ({ shot, center }) => {
      const app = window.__fw;
      const ui = await import('/src/ui/ui.js');
      ui.clearNotifications();
      ui.clearToasts();
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.state.x = center.x + shot.at[0];
      walk.state.z = center.z + shot.at[1];
      const dx = shot.to[0] - shot.at[0];
      const dz = shot.to[1] - shot.at[1];
      const length = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / length, -dz / length);
      walk.state.pitch = shot.pitch;
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    }, { shot, center: fixture.center });
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const ui = await import('/src/ui/ui.js');
      ui.clearNotifications();
      ui.clearToasts();
    });
    const filename = path.join(out, `${shot.id}.png`);
    await page.screenshot({ path: filename });
    captured.push(filename);
  }

  await page.evaluate(async (center) => {
    const app = window.__fw;
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    ui.clearToasts();
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.state.x = center.x + 8;
    walk.state.z = center.z + 43;
    const dx = -8;
    const dz = -38;
    const length = Math.hypot(dx, dz);
    walk.state.yaw = Math.atan2(-dx / length, -dz / length);
    walk.state.pitch = 0.05;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 21 * 60;
    app.scene3d.applyTimeWeather(21 * 60, app.state.weather);
  }, fixture.center);
  await page.waitForTimeout(800);
  const nightLightFactor = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().premiumCountryClub.diagnostics().runtimeLightFactor
  ));
  await page.evaluate(async () => {
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    ui.clearToasts();
  });
  const nightPath = path.join(out, '14-night-arrival.png');
  await page.screenshot({ path: nightPath });
  captured.push(nightPath);

  // Normal player route: walk to the real member door, use E, and cross it.
  await page.evaluate(async (center) => {
    const app = window.__fw;
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    ui.clearToasts();
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.state.x = center.x;
    walk.state.z = center.z + 15;
    walk.state.yaw = 0;
    walk.state.pitch = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
  }, fixture.center);
  const normalStart = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  await page.keyboard.down('w');
  await page.waitForTimeout(950);
  await page.keyboard.up('w');
  await page.keyboard.press('e');
  await page.waitForTimeout(650);
  await page.keyboard.down('w');
  await page.waitForTimeout(1550);
  await page.keyboard.up('w');
  await page.waitForTimeout(350);
  const normalEnd = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  const controlsPath = path.join(out, '15-normal-controls-after-entry.png');
  await page.screenshot({ path: controlsPath });
  captured.push(controlsPath);

  const performance = await page.evaluate(() => new Promise((resolve) => {
    const renderer = window.__fw.scene3d.renderer;
    const frameTimes = [];
    let previous = performance.now();
    const sample = (now) => {
      frameTimes.push(now - previous);
      previous = now;
      if (frameTimes.length < 180) return requestAnimationFrame(sample);
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const worst = sorted.slice(Math.floor(sorted.length * 0.99));
      const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
      let visibleMeshes = 0;
      let visibleTriangles = 0;
      const materials = new Set();
      const textures = new Set();
      window.__fw.scene3d.scene.traverseVisible((object) => {
        if (!object.isMesh || !object.geometry) return;
        visibleMeshes += 1;
        const count = object.geometry.index?.count || object.geometry.getAttribute('position')?.count || 0;
        visibleTriangles += count / 3 * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            if (material[key]) textures.add(material[key].uuid);
          }
        }
      });
      resolve({
        averageFps: 1000 / mean(frameTimes),
        onePercentLowFps: 1000 / mean(worst),
        worstFrameMs: sorted.at(-1),
        drawCalls: renderer.info.render.calls,
        renderedTriangles: renderer.info.render.triangles,
        visibleMeshes,
        visibleTriangles: Math.round(visibleTriangles),
        uniqueMaterials: materials.size,
        uniqueTextures: textures.size,
        rendererMemory: { ...renderer.info.memory },
      });
    };
    requestAnimationFrame(sample);
  }));

  const result = {
    ok: fixture.tier === 'premiumPrivate'
      && fixture.diagnostics.status === 'ready'
      && fixture.diagnostics.conditionedAreaSquareFeet >= 5500
      && fixture.diagnostics.conditionedAreaSquareFeet <= 7000
      && fixture.diagnostics.runtimeBatch?.drawCallsSaved > 500
      && fixture.diagnostics.runtimeLightCount <= fixture.diagnostics.runtimeLightCap
      && fixture.diagnostics.colliderCount >= 10
      && fixture.diagnostics.pivotCount === 2
      && normalEnd.z < normalStart.z - 1
      && browserDiagnostics.consoleErrors.length === 0
      && browserDiagnostics.pageErrors.length === 0,
    pass,
    out,
    fixture,
    normalControls: {
      start: { x: normalStart.x, z: normalStart.z },
      end: { x: normalEnd.x, z: normalEnd.z },
      forwardDistance: normalStart.z - normalEnd.z,
    },
    lighting: {
      dayFactor: fixture.diagnostics.runtimeLightFactor,
      nightFactor: nightLightFactor,
    },
    performance,
    browserDiagnostics,
    screenshots: captured,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
