// MATCHED CLEANING PERFORMANCE BASELINE.
//
// Run this driver against an immutable-base server, then let
// cleaning-gameplay-acceptance.js compare the candidate with the retained JSON. It deliberately
// uses the same camera poses, normal F/mouse controls, EffectComposer accounting, post-GC heap
// boundary, and texture-memory estimate as the final acceptance route.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:8464/';
  const resultPath = process.env.QA_RESULT_PATH || path.join(
    repo, 'qa', 'overnight', 'cleaning-gameplay', 'baseline',
    'baseline-performance-comparable.json',
  );
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const cdp = await page.context().newCDPSession(page);
  const consoleErrors = [];
  const consoleWarnings = [];
  const failedRequests = [];
  const normalControlProof = [];
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
    if (message.type() === 'warning') consoleWarnings.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));

  async function pose(localX, localZ, yaw = 0, pitch = -0.62) {
    await page.evaluate(({ localX, localZ, yaw, pitch }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + localX;
      walk.state.z = origin.z + localZ;
      walk.state.yaw = yaw;
      walk.state.pitch = pitch;
    }, { localX, localZ, yaw, pitch });
    await page.waitForTimeout(260);
  }

  async function poseFacing(localX, localZ, targetX, targetZ, pitch) {
    await pose(localX, localZ, Math.atan2(-(targetX - localX), -(targetZ - localZ)), pitch);
  }

  async function cycleTo(expected, scope = 'indoor') {
    for (let press = 0; press < 14; press += 1) {
      const current = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
      if (current === expected) {
        normalControlProof.push({ control: 'F', scope, expected, equipped: current, presses: press });
        await page.waitForTimeout(260);
        return true;
      }
      await page.keyboard.press('f');
      await page.waitForTimeout(85);
    }
    const equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
    normalControlProof.push({ control: 'F', scope, expected, equipped, presses: 14 });
    return equipped === expected;
  }

  async function performanceSample(label, durationMs = 2500) {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(120);
    const beforeDom = await cdp.send('Memory.getDOMCounters');
    const sample = await page.evaluate(async ({ label, durationMs }) => {
      const app = window.__fw;
      const renderer = app.scene3d.renderer;
      const info = renderer.info;
      const priorAutoReset = info.autoReset;
      const frames = [];
      const observerTarget = document.querySelector('#ui') || document.body;
      let mutations = 0;
      const observer = new MutationObserver((list) => { mutations += list.length; });
      observer.observe(observerTarget, {
        subtree: true, childList: true, attributes: true, characterData: true,
      });

      const materials = new Set();
      const referencedTextures = new Map();
      const rememberTexture = (texture) => {
        if (!texture?.isTexture || referencedTextures.has(texture.uuid)) return;
        const data = texture.source?.data ?? texture.image;
        const images = Array.isArray(data) ? data : [data];
        let bytes = 0;
        for (const image of images) {
          const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
          const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
          if (width && height) {
            bytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
          }
        }
        referencedTextures.set(texture.uuid, Math.round(bytes));
      };
      app.scene3d.scene.traverse((object) => {
        if (!object.material) return;
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) {
          if (!material) continue;
          materials.add(material);
          for (const value of Object.values(material)) rememberTexture(value);
        }
      });

      info.autoReset = false;
      info.reset();
      let previous = performance.now();
      const start = previous;
      await new Promise((resolve) => {
        const frame = (now) => {
          frames.push(now - previous);
          previous = now;
          if (now - start >= durationMs) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      const duration = previous - start;
      const sorted = frames.slice().sort((a, b) => b - a);
      const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
      const slowMean = sorted.slice(0, slowCount)
        .reduce((sum, value) => sum + value, 0) / slowCount;
      const renderTotals = { calls: info.render.calls, triangles: info.render.triangles };
      info.reset();
      info.autoReset = priorAutoReset;
      return {
        label,
        durationMs: duration,
        frames: frames.length,
        averageFps: frames.length * 1000 / duration,
        onePercentLowFps: 1000 / slowMean,
        worstFrameMs: sorted[0] || null,
        drawCalls: renderTotals.calls / Math.max(1, frames.length),
        renderedTriangles: renderTotals.triangles / Math.max(1, frames.length),
        drawCallsTotal: renderTotals.calls,
        renderedTrianglesTotal: renderTotals.triangles,
        materialCount: materials.size,
        geometryCount: info.memory.geometries,
        textureCount: info.memory.textures,
        referencedTextureCount: referencedTextures.size,
        textureMemoryBytes: [...referencedTextures.values()]
          .reduce((sum, value) => sum + value, 0),
        textureMemoryMethod: 'unique scene-referenced decoded RGBA8 texels plus mip-chain estimate',
        programCount: info.programs?.length || 0,
        jsHeapUsedBytes: performance.memory?.usedJSHeapSize || null,
        uiMutationsPerSecond: mutations / (duration / 1000),
      };
    }, { label, durationMs });
    const afterDom = await cdp.send('Memory.getDOMCounters');
    sample.eventListeners = afterDom.jsEventListeners;
    sample.domNodeDelta = afterDom.nodes - beforeDom.nodes;
    for (const key of [
      'durationMs', 'averageFps', 'onePercentLowFps', 'worstFrameMs',
      'drawCalls', 'renderedTriangles', 'uiMutationsPerSecond',
    ]) sample[key] = round(sample[key]);
    return sample;
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isEnabled()) await continueButton.click();
  else {
    await page.getByRole('button', { name: /New Empire — Relaxed/i }).click();
    await page.getByRole('heading', { name: 'Property market', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    await ch.sheet06ProductionReady?.();
    await ch.props71to100?.ready;
    ch.setOrganicWalkins?.(false);
    ch.clearWalkins?.();
    app.scene3d.setGolfersFrozen?.(true);
    app.scene3d.clearGolfers?.();
    const inventory = app.state.shop.inventory;
    if (!inventory.vac1) inventory.vac1 = { shelf: 0, back: 1, ordered: 0 };
    inventory.vac1.back = Math.max(1, Number(inventory.vac1.back) || 0);
    app.state.tutorial.complete = true;
    app.state.tutorial.hidden = true;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    app.scene3d.walk.clearKeys?.();
  });
  await page.waitForTimeout(1650);

  const performance = { idleIndoor: [], vacuumActive: [], washerIdle: [], washerActive: [] };
  await pose(-5.5, 3.2, 0, -0.62);
  if (!await cycleTo(null)) throw new Error('Could not stow the base tool belt');
  for (let index = 0; index < 3; index += 1) {
    performance.idleIndoor.push(await performanceSample(`idle-indoor-${index + 1}`));
  }

  if (!await cycleTo('vacuum')) throw new Error('Could not equip the base vacuum through F');
  const indoorViewport = page.viewportSize();
  await page.mouse.move(Math.floor(indoorViewport.width / 2), Math.floor(indoorViewport.height / 2));
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(300);
  for (let index = 0; index < 3; index += 1) {
    performance.vacuumActive.push(await performanceSample(`vacuum-active-${index + 1}`));
  }
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(300);

  await poseFacing(5.6, 9.2, 5.6, 6.5, 0.06);
  if (!await cycleTo('washer', 'outdoor')) {
    throw new Error('Could not equip the base washer through outdoor F');
  }
  const outdoorViewport = page.viewportSize();
  await page.mouse.move(Math.floor(outdoorViewport.width / 2), Math.floor(outdoorViewport.height / 2));
  for (let index = 0; index < 3; index += 1) {
    performance.washerIdle.push(await performanceSample(`washer-idle-${index + 1}`));
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(300);
    performance.washerActive.push(await performanceSample(`washer-active-${index + 1}`));
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(300);
  }
  await cycleTo(null, 'outdoor');

  const result = {
    capturedAt: new Date().toISOString(),
    branch: 'immutable-base',
    baseCommit: '1dfb9de646c6785b027ddb023dda1e3a6af9a5c6',
    launch: 'PORT=8464 node tools/serve.cjs',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    fixture: {
      time: '14:00',
      weather: 'new-game clear state',
      floor: { x: -5.5, z: 3.2, yaw: 0, pitch: -0.62 },
      outside: { x: 5.6, z: 9.2, targetX: 5.6, targetZ: 6.5, pitch: 0.06 },
    },
    measurement: {
      durationSeconds: 2.5,
      samplesPerScenario: 3,
      fps: 'requestAnimationFrame intervals; average and slowest-1%-window FPS',
      rendering: 'Three WebGLRenderer.info accumulated across every EffectComposer pass per display frame',
      textureMemory: 'unique scene-referenced decoded RGBA8 texels plus a 4/3 mip-chain estimate',
      heap: 'performance.memory.usedJSHeapSize after CDP HeapProfiler.collectGarbage',
      listeners: 'CDP Memory.getDOMCounters.jsEventListeners',
      ui: 'MutationObserver records per second under #ui',
    },
    normalControlProof,
    performance,
    diagnostics: { consoleErrors, consoleWarnings, failedRequests },
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return { ...result, resultPath };
}
