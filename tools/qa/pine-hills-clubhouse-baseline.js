async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const childProcess = process.getBuiltinModule('node:child_process');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, 'qa', 'pine-hills-clubhouse', 'before');
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
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.waitForTimeout(2500);

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const layout = await import('/src/data/shopLayout.js');
    app.speedIdx = 0;
    app.state.clock.minutes = 14 * 60;
    app.state.weather.locked = true;
    app.state.weather.today = {
      tempHiF: 74,
      tempLoF: 55,
      rainIn: 0,
      humidity: 0.4,
      windMph: 6,
    };
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      center: {
        x: clubhouse.interior.position.x,
        y: clubhouse.interior.position.y,
        z: clubhouse.interior.position.z,
      },
      shell: { ...layout.SHELL },
      interior: { ...layout.INTERIOR },
      clubName: app.state.clubName,
      propertyId: app.state.property?.id || app.empire?.activeId || null,
      campaign: app.state.campaign ? {
        version: app.state.campaign.version,
        businessOpen: app.state.campaign.businessOpen,
        enabled: app.state.campaign.enabled,
      } : null,
      reno: app.state.shop?.reno ? {
        condition: app.state.shop.reno.condition,
        grimeCells: app.state.shop.reno.grime?.length || 0,
        windowCells: app.state.shop.reno.windows?.length || 0,
        clutterTargets: app.state.shop.reno.clutter?.length || 0,
      } : null,
    };
  });

  const poses = [
    { id: '01-entry-axis', at: [-0.8, 5.35], target: [-1.1, -1.2], targetY: 1.35 },
    { id: '02-front-desk-customer-side', at: [0.25, 2.55], target: [2.9, 4.25], targetY: 1.05 },
    { id: '03-checkout-staff-side', at: [2.85, 5.15], target: [2.85, 4.15], targetY: 1.02 },
    { id: '04-payment-hardware', at: [2.45, 5.18], target: [3.2, 4.25], targetY: 1.02 },
    { id: '05-handoff-and-bagging', at: [3.75, 5.05], target: [2.35, 4.15], targetY: 0.98 },
    { id: '06-laptop-office', at: [7.25, 4.45], target: [9.55, 4.5], targetY: 1.05 },
    { id: '07-pro-shop-wide', at: [-1.4, 3.5], target: [-6.1, -1.4], targetY: 1.25 },
    { id: '08-retail-wall-fixtures', at: [-5.7, -1.0], target: [-9.4, -1.2], targetY: 1.45 },
    { id: '09-retail-north-wall', at: [-6.0, -3.0], target: [-5.8, -6.1], targetY: 1.35 },
    { id: '10-lounge', at: [0.7, -3.15], target: [4.1, -5.0], targetY: 1.15 },
    { id: '11-cleaning-and-service-wing', at: [7.5, -1.1], target: [6.05, 1.35], targetY: 1.05 },
    { id: '12-internal-doors', at: [4.45, 2.65], target: [8.25, 2.0], targetY: 1.25 },
    { id: '13-floor-finish', at: [-0.4, 0.6], target: [-3.6, -1.6], targetY: 0.15 },
    { id: '14-ceiling-banks', at: [-0.8, 4.7], target: [-1.1, -1.2], targetY: 3.65 },
    { id: '15-windows-and-threshold', at: [-3.4, 2.2], target: [-5.3, 6.25], targetY: 1.65 },
    { id: '16-exterior-threshold', at: [-0.8, 8.3], target: [-0.8, 5.4], targetY: 1.5 },
  ];

  async function setPose(pose) {
    await page.evaluate(({ pose, minute }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
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
    await page.waitForTimeout(750);
  }

  const shots = [];
  for (const pose of poses) {
    await setPose(pose);
    const file = path.join(outDir, `${pose.id}.png`);
    await page.screenshot({ path: file });
    shots.push(path.relative(repoRoot, file).replaceAll('\\', '/'));
  }

  await setPose(poses[0]);
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
        if (now - started < 3000) {
          requestAnimationFrame(tick);
          return;
        }
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
    const scene = window.__fw.scene3d.scene;
    const materials = new Set();
    const textures = new Set();
    let visibleMeshes = 0;
    let sceneTriangles = 0;
    let lights = 0;
    let activeLights = 0;
    scene.traverse((object) => {
      if (object.isLight) {
        lights += 1;
        if (object.visible && object.intensity > 0) activeLights += 1;
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
    return {
      visibleMeshes,
      sceneTriangles: Math.round(sceneTriangles),
      uniqueMaterials: materials.size,
      uniqueTextures: textures.size,
      lights,
      activeLights,
    };
  });

  const cdp = await page.context().newCDPSession(page);
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: 'window',
    objectGroup: 'pine-hills-baseline-listeners',
  });
  const listeners = await cdp.send('DOMDebugger.getEventListeners', {
    objectId: evaluated.result.objectId,
  });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'pine-hills-baseline-listeners' });

  const git = (...args) => childProcess.execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
  const worktree = {
    head: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    statusPorcelainV2: git('status', '--porcelain=v2', '--branch'),
    unstagedDiffStat: git('diff', '--stat'),
    stagedDiffStat: git('diff', '--cached', '--stat'),
    untrackedFiles: git('ls-files', '--others', '--exclude-standard'),
  };

  const blockingDiagnostics = diagnostics.filter((entry) => (
    entry.startsWith('console:error')
    || entry.startsWith('pageerror')
    || entry.startsWith('requestfailed')
  ));
  return {
    ok: blockingDiagnostics.length === 0,
    phase: 'before',
    fixture: 'fresh runner --bootstrap save, seed 424242, first market property, untouched campaign/shop state, paused at 14:00 in fixed clear weather',
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    coordinateSpace: 'clubhouse interior-local yards resolved from the live clubhouse root',
    fixtureState: fixture,
    shots,
    performanceScenario: 'idle entry axis',
    performanceRuns,
    sceneMetrics,
    activeWindowEventListeners: listeners.listeners.length,
    diagnostics,
    worktree,
  };
}
