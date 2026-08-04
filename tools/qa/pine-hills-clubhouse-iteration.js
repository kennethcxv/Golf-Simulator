async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const phase = String(process.env.QA_PHASE || 'iteration-01').replace(/[^a-z0-9_-]+/gi, '-');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, 'qa', 'pine-hills-clubhouse', phase);
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText || 'unknown'}`);
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseUrl);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    await Promise.all([
      clubhouse.pineHillsInterior?.ready,
      clubhouse.sheet07Production?.ready,
      clubhouse.modernClubhouse?.ready,
    ].filter(Boolean));
  });
  await page.waitForTimeout(1800);

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    app.speedIdx = 0;
    app.state.clock.minutes = 14 * 60;
    app.state.weather.locked = true;
    app.state.weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const desk = layout.COUNTER;
    const register = layout.REGISTER;
    const queue = layout.queueSlot(0);
    const laptop = layout.FRONT_DESK.laptop;
    const board = layout.FRONT_DESK.teeTimeBoard;
    const boardObject = clubhouse.interior.getObjectByName('PineHillsTeeTimeBoard');
    boardObject?.updateWorldMatrix(true, false);
    const boardMatrix = boardObject?.matrixWorld?.elements;
    const boardWorld = boardMatrix ? {
      x: boardMatrix[12],
      y: boardMatrix[13],
      z: boardMatrix[14],
    } : {
      x: clubhouse.interior.position.x + board.x,
      y: clubhouse.interior.position.y + 1.61,
      z: clubhouse.interior.position.z + board.z + 0.20,
    };
    const cooler = layout.FIXTURES.find((entry) => entry.id === 'cold_drinks');
    const coolerBrowse = layout.fixtureBrowsePoint(cooler);
    const balls = layout.FIXTURES.find((entry) => entry.id === 'shelf_balls');
    const accessories = layout.FIXTURES.find((entry) => entry.id === 'shelf_acc');
    const apparel = layout.FIXTURES.find((entry) => entry.id === 'shelf_small');
    const retailNorthCenter = {
      x: (balls.x + accessories.x + apparel.x) / 3,
      z: (balls.z + accessories.z + apparel.z) / 3,
    };
    const poses = [
      { id: '01-entry-axis', at: [layout.DOOR_MAIN.x, 5.55], target: [desk.x, desk.z], targetY: 1.34 },
      { id: '02-front-desk-customer-side', at: [queue.x, queue.z + 0.20], target: [desk.x, desk.z], targetY: 1.10 },
      { id: '03-checkout-staff-side', at: [register.stand.x, register.stand.z], target: [register.monitor.x, register.monitor.z], targetY: 1.14 },
      { id: '04-payment-hardware', at: [register.stand.x + 0.32, register.stand.z], target: [register.cardterm.x, register.cardterm.z], targetY: 1.10 },
      { id: '05-handoff-and-bagging', at: [register.stand.x - 0.50, register.stand.z - 0.05], target: [register.bag.x, register.bag.z], targetY: 1.04 },
      { id: '06-laptop-and-tee-board', at: [laptop.x - 0.10, laptop.z + 1.25], target: [laptop.x, laptop.z], targetY: 1.18 },
      { id: '07-pro-shop-wide', at: [-1.7, 3.65], target: [-6.4, -1.0], targetY: 1.25 },
      { id: '08-cooler-and-south-retail', at: [coolerBrowse.x + 0.82, coolerBrowse.z], target: [cooler.x, cooler.z], targetY: 1.06 },
      { id: '09-retail-north-wall', at: [retailNorthCenter.x, -3.55], target: [retailNorthCenter.x, retailNorthCenter.z], targetY: 1.22 },
      { id: '10-lounge', at: [1.20, -3.15], target: [3.90, -5.45], targetY: 1.24 },
      { id: '11-cleaning-and-service-wing', at: [8.50, 0.60], target: [layout.STOCKROOM.cleaning.x, layout.STOCKROOM.cleaning.z], targetY: 0.98 },
      { id: '12-internal-doors', at: [8.90, 4.15], target: [layout.DOOR_STOCK.x, layout.DOOR_STOCK.z], targetY: 1.42 },
      { id: '13-floor-finish', at: [-7.10, 3.65], target: [-5.20, 0.10], targetY: 0.16 },
      { id: '14-ceiling-banks', at: [-0.8, 4.65], target: [-1.1, -1.25], targetY: layout.SHELL.h - 0.10 },
      { id: '15-windows-and-threshold', at: [-3.3, 2.15], target: [-5.25, 6.25], targetY: 1.68 },
      { id: '16-exterior-threshold', at: [layout.DOOR_MAIN.x + 3.10, 11.85], target: [layout.DOOR_MAIN.x, 7.05], targetY: 1.75 },
    ];
    return {
      center: {
        x: clubhouse.interior.position.x,
        y: clubhouse.interior.position.y,
        z: clubhouse.interior.position.z,
      },
      poses,
      board,
      boardWorld,
      layoutVersion: app.state.shop?.reno?.clubhouseLayoutVersion,
      restorationVersion: app.state.shop?.reno?.restorationVersion,
      clubName: app.state.clubName,
      propertyId: app.state.property?.id || app.empire?.activeId || null,
    };
  });

  async function setPose(pose) {
    await page.evaluate(({ pose, minute }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      const state = walk.state;
      walk.clearKeys();
      walk.setSpraying?.(false);
      app.speedIdx = 0;
      app.state.clock.minutes = minute;
      app.scene3d.applyTimeWeather?.(minute, app.state.weather);
      state.x = origin.x + pose.at[0];
      state.z = origin.z + pose.at[1];
      const dx = pose.target[0] - pose.at[0];
      const dz = pose.target[1] - pose.at[1];
      const horizontal = Math.hypot(dx, dz) || 0.001;
      state.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      state.pitch = Math.atan2(pose.targetY - 1.62, horizontal);
    }, { pose, minute: 14 * 60 });
    await page.waitForTimeout(600);
  }

  const shots = [];
  for (const pose of fixture.poses) {
    await setPose(pose);
    const file = path.join(outDir, `${pose.id}.png`);
    await page.screenshot({ path: file });
    shots.push(path.relative(repoRoot, file).replaceAll('\\', '/'));
  }

  // Fixture placement is deterministic; the interaction itself uses the same
  // keyboard path as normal play. Take a real movement step first, then E on
  // the physical tee board and verify that the shared reservations laptop opens.
  const normalControls = await page.evaluate(({ boardWorld }) => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    // Start in the clear staff corridor, west of the reception chair, and aim
    // at the authored board's live world-space centre. The short W step below
    // is normal first-person movement; no focus or action is injected.
    walk.state.x = boardWorld.x - 0.65;
    walk.state.z = boardWorld.z + 1.25;
    const dx = boardWorld.x - walk.state.x;
    const dz = boardWorld.z - walk.state.z;
    walk.state.yaw = Math.atan2(-dx, -dz);
    walk.state.pitch = Math.atan2(boardWorld.y - (origin.y + 1.62), Math.hypot(dx, dz));
    return { beforeX: walk.state.x, beforeZ: walk.state.z };
  }, { boardWorld: fixture.boardWorld });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(120);
  await page.keyboard.up('KeyW');
  const afterMovement = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));
  normalControls.movementDistance = Math.hypot(
    afterMovement.x - normalControls.beforeX,
    afterMovement.z - normalControls.beforeZ,
  );
  normalControls.focusBeforeInteract = await page.evaluate(() => (
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || null
  ));
  normalControls.focusDetails = await page.evaluate(() => {
    const focus = window.__fw?.scene3d?.walk?.getFocus?.();
    const prop = focus?.kind === 'prop' ? focus.prop : null;
    return prop ? {
      x: prop.x,
      z: prop.z,
      radius: prop.r,
      aimY: prop.aimY,
      focusBias: typeof prop.focusBias === 'function' ? prop.focusBias() : prop.focusBias,
      assetNumber: prop.userData?.assetNumber || null,
    } : null;
  });
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1800);
  normalControls.laptopOpened = await page.evaluate(() => window.__fw?.laptopOpen === true);
  normalControls.reservationsVisible = await page.locator('body').innerText()
    .then((text) => /reservations|tee times|bookings|booking\s*&\s*check-in/i.test(text));
  if (normalControls.laptopOpened) {
    await page.screenshot({ path: path.join(outDir, '17-normal-control-tee-board.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  await setPose(fixture.poses[0]);
  const performanceRuns = [];
  for (let run = 0; run < 3; run += 1) {
    performanceRuns.push(await page.evaluate(() => new Promise((resolve) => {
      const frames = [];
      let previous = performance.now();
      const started = previous;
      const renderer = window.__fw.scene3d.renderer;
      function tick(now) {
        frames.push(now - previous);
        previous = now;
        if (now - started < 3000) return requestAnimationFrame(tick);
        const sorted = [...frames].sort((a, b) => a - b);
        const total = frames.reduce((sum, value) => sum + value, 0);
        const onePercentIndex = Math.max(0, Math.ceil(sorted.length * 0.99) - 1);
        resolve({
          durationMs: now - started,
          frameCount: frames.length,
          averageFps: frames.length * 1000 / Math.max(total, 0.001),
          onePercentLowFps: 1000 / Math.max(sorted[onePercentIndex] || 0.001, 0.001),
          worstFrameMs: Math.max(...frames),
          drawCalls: renderer.info.render.calls,
          renderedTriangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        });
      }
      requestAnimationFrame(tick);
    })));
  }

  const sceneMetrics = await page.evaluate(() => {
    const app = window.__fw;
    const scene = window.__fw.scene3d.scene;
    const materials = new Set();
    const textures = new Set();
    let visibleMeshes = 0;
    let sceneTriangles = 0;
    let lights = 0;
    let activeLights = 0;
    let rectAreaLights = 0;
    let panelLights = 0;
    const panelLightBackends = {};
    scene.traverse((object) => {
      if (object.isLight) {
        lights += 1;
        if (object.visible && object.intensity > 0) activeLights += 1;
        if (object.isRectAreaLight) rectAreaLights += 1;
        if (/^CeilingPanelLight_/.test(object.name || '')) {
          panelLights += 1;
          const backend = object.userData?.lightingBackend || object.type || 'unknown';
          panelLightBackends[backend] = (panelLightBackends[backend] || 0) + 1;
        }
      }
      if (!object.isMesh || !object.visible) return;
      visibleMeshes += 1;
      const count = object.geometry?.index?.count ?? object.geometry?.attributes?.position?.count ?? 0;
      sceneTriangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (material[key]) textures.add(material[key].uuid);
        }
      }
    });
    const clubhouse = window.__fw.scene3d.clubhouse();
    const starterCartons = (app.state.shop?.deliveries?.boxes || [])
      .filter((box) => Number(box.starterRestockVersion) > 0)
      .map((box) => ({
        id: box.id,
        starterCartonId: box.starterCartonId,
        loc: box.loc,
        surfaceId: box.surfaceId || null,
        x: Number.isFinite(box.x) ? box.x : null,
        z: Number.isFinite(box.z) ? box.z : null,
      openedState: box.openedState,
      qty: box.qty,
      contents: Array.isArray(box.contents)
          ? box.contents.map((entry) => ({
            skuId: entry.skuId,
            qty: Number(entry.remainingQuantity ?? entry.quantity) || 0,
          }))
          : null,
      }));
    return {
      visibleMeshes,
      sceneTriangles: Math.round(sceneTriangles),
      uniqueMaterials: materials.size,
      uniqueTextures: textures.size,
      lights,
      activeLights,
      rectAreaLights,
      panelLights,
      panelLightBackends,
      maxTextureImageUnits: window.__fw.scene3d.renderer.capabilities.maxTextures,
      pineHills: clubhouse.pineHillsInterior?.diagnostics?.() || null,
      props: clubhouse.assets51to100Runtime?.diagnostics?.() || null,
      stockDisplays: clubhouse.stockDisplayDiagnostics?.() || null,
      starterCartons,
    };
  });

  const cdp = await page.context().newCDPSession(page);
  const evaluated = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup: `pine-hills-${phase}` });
  const listeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: evaluated.result.objectId });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: `pine-hills-${phase}` });

  const performanceMedian = (key) => {
    const values = performanceRuns.map((run) => run[key]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  const performanceSummary = {
    medianAverageFps: performanceMedian('averageFps'),
    medianOnePercentLowFps: performanceMedian('onePercentLowFps'),
  };
  performanceSummary.passes = performanceSummary.medianAverageFps >= 60
    && performanceSummary.medianOnePercentLowFps >= 30;
  const panelBackendCount = sceneMetrics.panelLightBackends['rect-area'] || 0;
  const blockingDiagnostics = diagnostics.filter((entry) => (
    entry.startsWith('console:error') || entry.startsWith('pageerror') || entry.startsWith('requestfailed')
  ));
  const ok = blockingDiagnostics.length === 0
    && normalControls.movementDistance > 0.02
    && /tee-time board/i.test(normalControls.focusBeforeInteract || '')
    && normalControls.laptopOpened
    && normalControls.reservationsVisible
    && sceneMetrics.pineHills?.failed === 0
    && sceneMetrics.panelLights === 8
    && sceneMetrics.rectAreaLights === 8
    && panelBackendCount === 8
    && sceneMetrics.starterCartons.length === 3
    && performanceSummary.passes;
  const result = {
    ok,
    phase,
    fixture: 'fresh locked Playwright bootstrap, seed 424242, Pine Hills starting property, fixed 14:00 clear weather',
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    fixtureState: fixture,
    shots,
    normalControls,
    performanceScenario: 'idle entry axis, three 3-second warmed samples',
    performanceRuns,
    performanceSummary,
    sceneMetrics,
    activeWindowEventListeners: listeners.listeners.length,
    diagnostics,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
