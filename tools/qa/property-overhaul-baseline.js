async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const BASE = process.env.QA_BASE_URL || 'http://localhost:8467/';
  const OUT = process.env.PROPERTY_OVERHAUL_QA_OUT_DIR
    ? path.resolve(repo, process.env.PROPERTY_OVERHAUL_QA_OUT_DIR)
    : path.join(repo, 'qa', 'property-expansion-world-overhaul', 'baseline');
  const performanceOnly = process.env.PROPERTY_OVERHAUL_PERFORMANCE_ONLY === '1';
  fs.mkdirSync(OUT, { recursive: true });
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(BASE);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    const baseReady = !clubhouse.assetsReady || clubhouse.assetsReady();
    const equipmentReady = !clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady();
    const sheet06 = clubhouse.sheet06Production?.diagnostics?.() || null;
    const sheet06Ready = !clubhouse.sheet06Production
      || (sheet06?.actualSharedGameIntegrated === true && sheet06?.activationStatus === 'active');
    return baseReady && equipmentReady && sheet06Ready;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2000);

  const anchor = await page.evaluate(() => {
    const app = window.__fw;
    const course = app.state.course;
    const s = course.structures[0];
    const cell = 8;
    return {
      bx: (s.x + s.w / 2) * cell - course.w * cell / 2,
      bz: (s.y + s.h / 2) * cell - course.h * cell / 2,
    };
  });

  const pose = async (id, at, target, pitch = -0.03) => {
    await page.evaluate(({ at, target, pitch }) => {
      const app = window.__fw;
      const st = app.scene3d.walk.state;
      app.scene3d.walk.clearKeys();
      app.scene3d.walk.setSpraying(false);
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 14 * 60;
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
      st.x = at[0];
      st.z = at[1];
      const dx = target[0] - at[0];
      const dz = target[1] - at[1];
      const len = Math.hypot(dx, dz) || 1;
      st.yaw = Math.atan2(-dx / len, -dz / len);
      st.pitch = pitch;
    }, { at, target, pitch });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${id}.png` });
    return id;
  };

  const { bx, bz } = anchor;
  const shots = [];
  shots.push(await pose('01-clubhouse-exterior', [bx + 6.5, bz + 15.5], [bx - 0.5, bz + 3], 0.03));
  shots.push(await pose('02-front-entrance', [bx - 0.8, bz + 5.2], [bx - 1.2, bz - 2], -0.05));
  shots.push(await pose('03-maintenance-yard', [bx + 7, bz + 27], [bx + 16, bz + 17], -0.04));
  shots.push(await pose('04-current-tractor', [bx + 8, bz + 24], [bx + 14.5, bz + 18.5], -0.08));
  shots.push(await pose('05-current-golf-cart', [bx + 3, bz + 18], [bx + 9.5, bz + 12.5], -0.08));
  shots.push(await pose('06-current-shed', [bx + 14, bz + 23], [bx + 20.5, bz + 13], -0.02));
  shots.push(await pose('07-current-sign', [bx - 7, bz + 25], [bx - 15, bz + 16], -0.05));
  shots.push(await pose('08-current-house', [bx - 13, bz + 37], [bx - 30, bz + 27], -0.01));
  shots.push(await pose('09-current-leaf-pile', [bx + 6.5, bz + 24], [bx + 11.8, bz + 20.4], -0.18));

  await page.evaluate(() => {
    const app = window.__fw;
    for (const item of Object.values(app.state.shop.inventory)) {
      item.shelf = Math.max(item.shelf || 0, 8);
    }
    app.scene3d.clubhouse().rebuildStock();
    app.scene3d.clubhouse().sendToCounter(['balls3', 'glove1'], 'card');
  });
  shots.push(await pose('10-current-character-and-hat', [bx + 0.5, bz + 2.3], [bx + 2.9, bz + 4.5], -0.10));
  shots.push(await pose('11-current-shop-and-register', [bx + 0.5, bz + 2.3], [bx + 2.9, bz + 4.5], -0.10));

  await page.evaluate(() => window.__fw.scene3d.walk.setTool('vacuum'));
  shots.push(await pose('12-current-vacuum', [bx - 2.5, bz + 1.2], [bx - 3.2, bz - 3.5], -0.22));
  await page.evaluate(() => {
    window.__fw.scene3d.walk.setTool('vacuum');
    window.__fw.scene3d.walk.setSpraying(true);
  });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/13-current-vacuum-active.png` });
  shots.push('13-current-vacuum-active');

  await page.evaluate(() => window.__fw.scene3d.walk.setTool('washer'));
  shots.push(await pose('14-current-pressure-washer', [bx + 5.5, bz + 13], [bx - 1, bz + 5.8], -0.10));
  await page.evaluate(() => {
    window.__fw.scene3d.walk.setTool('washer');
    window.__fw.scene3d.walk.setSpraying(true);
  });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/15-current-pressure-washer-active.png` });
  shots.push('15-current-pressure-washer-active');
  await page.evaluate(() => {
    window.__fw.scene3d.walk.setSpraying(false);
    window.__fw.scene3d.walk.setTool(null);
  });

  if (!performanceOnly) {
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.__fw.courseMode === 'overview');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/16-course-and-tree-baseline.png` });
    shots.push('16-course-and-tree-baseline');
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__fw.courseMode === 'editor');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/17-current-course-editor-no-tree-placement.png` });
    shots.push('17-current-course-editor-no-tree-placement');
    await page.getByTitle('Leave the editor').click();
    await page.waitForFunction(() => window.__fw.courseMode === 'overview');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.__fw.courseMode === 'walk');

    await page.evaluate(async () => {
      const app = window.__fw;
      const shop = await import('/src/sim/shop.js');
      app.state.cash = Math.max(app.state.cash, 100000);
      app.state.shop.unlockedTier = Math.max(app.state.shop.unlockedTier, 3);
      shop.placeOrder(app.state, 'balls3', 24);
      const o = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = 8.45 + o.x;
      walk.z = 4.5 + o.z;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
    });
    await page.waitForTimeout(800);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('.lt-frame');
      return frame && frame.getBoundingClientRect().width > 100;
    }, null, { timeout: 15000 });
    await page.locator('.lt-navbtn[title="Shop"]').click();
    const deliveryButton = page.locator('.lt-tab').filter({ hasText: 'Deliveries' });
    await deliveryButton.scrollIntoViewIfNeeded();
    await deliveryButton.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/18-current-delivery-eta.png` });
    shots.push('18-current-delivery-eta');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false);
  }
  await pose('19-performance-fixed-camera', [bx + 6.5, bz + 15.5], [bx - 0.5, bz + 3], 0.03);
  const performanceSamples = [];
  for (let run = 0; run < 3; run++) {
    performanceSamples.push(await page.evaluate(() => new Promise((resolve) => {
      const renderer = window.__fw.scene3d.renderer;
      const frames = [];
      const started = performance.now();
      let previous = started;
      function tick(now) {
        frames.push(now - previous);
        previous = now;
        if (now - started < 5000) {
          requestAnimationFrame(tick);
          return;
        }
        const sorted = [...frames].sort((a, b) => a - b);
        const total = frames.reduce((sum, value) => sum + value, 0);
        const heap = performance.memory?.usedJSHeapSize ?? null;
        resolve({
          durationMs: now - started,
          frameCount: frames.length,
          averageFps: frames.length * 1000 / total,
          onePercentLowFps: 1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)],
          worstFrameMs: Math.max(...frames),
          drawCalls: renderer.info.render.calls,
          renderedTriangles: renderer.info.render.triangles,
          geometryCount: renderer.info.memory.geometries,
          textureResourceCount: renderer.info.memory.textures,
          jsHeapBytes: heap,
        });
      }
      requestAnimationFrame(tick);
    })));
  }

  const sceneMetrics = await page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    let meshes = 0;
    let triangles = 0;
    let drawSubmissionUpperBound = 0;
    const materials = new Set();
    const textures = new Map();
    const textureKeys = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
      'alphaMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap', 'specularMap',
    ];
    scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      meshes += 1;
      const geometry = object.geometry;
      const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
      triangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
      drawSubmissionUpperBound += Math.max(1, geometry?.groups?.length || 0);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of textureKeys) {
          const texture = material[key];
          if (texture?.isTexture) textures.set(texture.uuid, texture);
        }
      }
    });
    let textureMemoryBytes = 0;
    let texturesWithDimensions = 0;
    for (const texture of textures.values()) {
      const source = texture.source?.data || texture.image;
      const images = Array.isArray(source) ? source : [source];
      let baseBytes = 0;
      for (const image of images) {
        const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
        const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
        if (width > 0 && height > 0) baseBytes += width * height * 4;
      }
      if (baseBytes <= 0) continue;
      texturesWithDimensions += 1;
      textureMemoryBytes += baseBytes * (texture.generateMipmaps === false ? 1 : 4 / 3);
    }
    return {
      visibleMeshes: meshes,
      sceneTriangles: Math.round(triangles),
      materialCount: materials.size,
      drawSubmissionUpperBound,
      referencedTextureCount: textures.size,
      texturesWithDimensions,
      textureMemoryBytes: Math.round(textureMemoryBytes),
      textureMemoryMethod: 'Unique referenced texture dimensions × four RGBA bytes, plus a 4/3 mip factor when mip generation is enabled; compressed GPU allocation is not exposed by Three.js.',
    };
  });
  const cdp = await page.context().newCDPSession(page);
  const activeWindowListeners = async (objectGroup) => {
    const evaluated = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup });
    const listeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: evaluated.result.objectId });
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup });
    return listeners.listeners.length;
  };
  const activeWindowEventListenersBeforeToolCycles = await activeWindowListeners('qa-listeners-before');
  const heapBeforeToolCycles = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);

  // Positioning creates the deterministic fixture. Every actual tool transition and
  // use below travels through the same keyboard/mouse handlers as normal gameplay.
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.setSpraying?.(false);
    walk.setTool?.(null);
    const vacuum = app.state.shop.inventory.vac1 || (app.state.shop.inventory.vac1 = {});
    vacuum.back = Math.max(1, Number(vacuum.back) || 0);
    walk.state.x = origin.x - 5.5;
    walk.state.z = origin.z + 3.2;
    walk.state.yaw = 0;
    walk.state.pitch = -0.3;
  });
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() === 'vacuum');
  const uiWriteSample = await page.evaluate(() => {
    const element = document.querySelector('.shop-cond');
    window.__qaConditionWrites = 0;
    window.__qaConditionObserver = new MutationObserver((records) => {
      window.__qaConditionWrites += records.length;
    });
    if (element) window.__qaConditionObserver.observe(element, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    return { startedAt: performance.now(), elementFound: !!element };
  });
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(5000);
  await page.mouse.up({ button: 'left' });
  const uiWriteResult = await page.evaluate((startedAt) => {
    window.__qaConditionObserver?.disconnect();
    const durationMs = performance.now() - startedAt;
    const writes = window.__qaConditionWrites || 0;
    delete window.__qaConditionObserver;
    delete window.__qaConditionWrites;
    return { durationMs, writes, writesPerSecond: writes / (durationMs / 1000) };
  }, uiWriteSample.startedAt);

  const toolCycleCount = 48;
  for (let index = 0; index < toolCycleCount; index += 1) {
    await page.keyboard.press('f');
    await page.waitForTimeout(25);
  }
  await page.evaluate(() => window.__fw.scene3d.walk.toolViewmodelsReady?.());
  await page.waitForTimeout(1200);
  const activeWindowEventListenersAfterToolCycles = await activeWindowListeners('qa-listeners-after');
  const heapAfterToolCycles = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  await cdp.detach();

  const interactionStability = {
    toolCycleCount,
    activeWindowEventListenersBefore: activeWindowEventListenersBeforeToolCycles,
    activeWindowEventListenersAfter: activeWindowEventListenersAfterToolCycles,
    activeWindowEventListenerGrowth: activeWindowEventListenersAfterToolCycles - activeWindowEventListenersBeforeToolCycles,
    jsHeapBytesBefore: heapBeforeToolCycles,
    jsHeapBytesAfter: heapAfterToolCycles,
    jsHeapGrowthBytes: heapBeforeToolCycles == null || heapAfterToolCycles == null
      ? null
      : heapAfterToolCycles - heapBeforeToolCycles,
    uiConditionElementFound: uiWriteSample.elementFound,
    uiConditionWrites: uiWriteResult.writes,
    uiConditionSampleDurationMs: uiWriteResult.durationMs,
    uiConditionWritesPerSecond: uiWriteResult.writesPerSecond,
  };

  return {
    ok: diagnostics.filter((entry) => entry.startsWith('console:error') || entry.startsWith('pageerror')).length === 0,
    branch: 'overnight/property-expansion-world-overhaul',
    startingCommit: '0c5137e5f0efac9627ce2309b9e66936f1eeb769',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixedCamera: { anchor, time: '14:00', weather: 'save fixture' },
    shots,
    performanceSamples,
    sceneMetrics,
    interactionStability,
    activeWindowEventListeners: activeWindowEventListenersAfterToolCycles,
    textureMemoryBytes: sceneMetrics.textureMemoryBytes,
    uiUpdateFrequencyHz: uiWriteResult.writesPerSecond,
    diagnostics,
  };
}
