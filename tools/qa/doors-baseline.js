async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const pass = process.env.DOORS_QA_PASS || 'baseline';
  const out = path.join(repoRoot, 'qa', 'doors', pass);
  fs.mkdirSync(out, { recursive: true });

  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const registrations = new WeakMap();
    const summary = { active: 0, added: 0, removed: 0, byType: Object.create(null) };

    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (listener) {
        let target = registrations.get(this);
        if (!target) {
          target = new Map();
          registrations.set(this, target);
        }
        let listeners = target.get(type);
        if (!listeners) {
          listeners = new Set();
          target.set(type, listeners);
        }
        if (!listeners.has(listener)) {
          listeners.add(listener);
          summary.active += 1;
          summary.added += 1;
          summary.byType[type] = (summary.byType[type] || 0) + 1;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      const listeners = registrations.get(this)?.get(type);
      if (listener && listeners?.delete(listener)) {
        summary.active -= 1;
        summary.removed += 1;
        summary.byType[type] = Math.max(0, (summary.byType[type] || 0) - 1);
      }
      return originalRemove.call(this, type, listener, options);
    };

    window.__doorsQaListeners = summary;
    window.__doorsQaUi = { mutationRecords: 0, callbacks: 0 };
    addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver((records) => {
        window.__doorsQaUi.callbacks += 1;
        window.__doorsQaUi.mutationRecords += records.length;
      });
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      window.__doorsQaUiObserver = observer;
    }, { once: true });
  });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: '.toast-wrap, .notification-center { display: none !important; }' });

  const shots = [
    { id: '01-main-exterior-closed', at: [-0.8, 8.25], to: [-0.8, 6.5], pitch: -0.03 },
    { id: '02-main-interior-closed', at: [-0.8, 4.35], to: [-0.8, 6.5], pitch: -0.04 },
    { id: '03-stock-office-closed', at: [7.0, 4.05], to: [8.9, 2.0], pitch: -0.05 },
    { id: '04-stock-room-closed', at: [8.9, 0.25], to: [8.9, 2.0], pitch: -0.05 },
    { id: '05-receiving-interior-closed', at: [8.0, -3.6], to: [10.7, -3.6], pitch: -0.05 },
    { id: '06-receiving-exterior-closed', at: [12.8, -3.6], to: [10.7, -3.6], pitch: -0.05 },
  ];

  async function setPose(shot) {
    await page.evaluate(({ atLocal, targetLocal, pitch }) => {
      const scene = window.__fw.scene3d;
      const clubhouse = scene.clubhouse();
      const root = clubhouse.group;
      root.updateWorldMatrix(true, false);
      const atWorld = root.localToWorld(root.position.clone().set(atLocal[0], 0, atLocal[1]));
      const targetWorld = root.localToWorld(root.position.clone().set(targetLocal[0], 0, targetLocal[1]));
      const walk = scene.walk;
      walk.clearKeys();
      walk.state.x = atWorld.x;
      walk.state.z = atWorld.z;
      const dx = targetWorld.x - atWorld.x;
      const dz = targetWorld.z - atWorld.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = pitch;
      const clock = window.__fw.state.clock;
      clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 14 * 60;
      window.__fw.state.weather.today.rainIn = 0;
      scene.applyTimeWeather(14 * 60, window.__fw.state.weather);
    }, { atLocal: shot.at, targetLocal: shot.to, pitch: shot.pitch });
    await page.waitForTimeout(500);
  }

  for (const shot of shots) {
    await setPose(shot);
    await page.screenshot({ path: path.join(out, `${shot.id}.png`) });
  }

  await setPose({ at: [-0.8, 7.7], to: [-0.8, 6.5], pitch: -0.04 });
  await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1200);
  const opened = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    return clubhouse.doors.filter((door) => door.isMain).map((door) => ({
      leaf: door.mainLeaf,
      angle: door.angle,
      open: door.open,
      desiredOpen: door.desiredOpen,
      collider: { ...door.collider },
    }));
  });
  await page.screenshot({ path: path.join(out, '07-main-exterior-open-normal-control.png') });

  await setPose({ at: [-0.8, 4.35], to: [-0.8, 6.5], pitch: -0.04 });
  await page.screenshot({ path: path.join(out, '08-main-interior-open.png') });

  const perf = await page.evaluate(async () => {
    const scene = window.__fw.scene3d;
    const renderer = scene.renderer;
    const listenerBefore = { ...window.__doorsQaListeners };
    const uiBefore = { ...window.__doorsQaUi };
    const heapBefore = performance.memory?.usedJSHeapSize ?? null;
    const frameTimes = [];
    const sampleStart = performance.now();
    let previous = sampleStart;
    await new Promise((resolve) => {
      const tick = (now) => {
        frameTimes.push(now - previous);
        previous = now;
        if (frameTimes.length >= 360) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const sampleEnd = performance.now();

    renderer.info.autoReset = false;
    renderer.info.reset();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const drawCalls = renderer.info.render.calls;
    const renderedTriangles = renderer.info.render.triangles;
    renderer.info.autoReset = true;

    const materials = new Set();
    const textures = new Set();
    let sceneTriangles = 0;
    scene.scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      const geometry = object.geometry;
      const triangles = geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position?.count || 0) / 3;
      sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (material[key]) textures.add(material[key]);
        }
      }
    });
    let estimatedTextureBytes = 0;
    for (const texture of textures) {
      const image = texture.image || texture.source?.data;
      const width = Number(image?.width || image?.videoWidth || 0);
      const height = Number(image?.height || image?.videoHeight || 0);
      if (width > 0 && height > 0) estimatedTextureBytes += width * height * 4 * (4 / 3);
    }

    const sorted = frameTimes.slice(1).sort((a, b) => b - a);
    const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const worstOnePercentAverage = sorted.slice(0, worstCount)
      .reduce((sum, value) => sum + value, 0) / worstCount;
    const durationSeconds = (sampleEnd - sampleStart) / 1000;
    const listenerAfter = { ...window.__doorsQaListeners };
    const uiAfter = { ...window.__doorsQaUi };
    return {
      protocol: {
        browser: navigator.userAgent,
        viewport: [innerWidth, innerHeight],
        deviceScaleFactor: devicePixelRatio,
        clockMinuteOfDay: window.__fw.state.clock.minutes % 1440,
        sampleFrames: frameTimes.length - 1,
        durationSeconds,
        warmupSeconds: 2.5,
      },
      averageFps: (frameTimes.length - 1) / durationSeconds,
      onePercentLowFps: 1000 / worstOnePercentAverage,
      worstFrameMs: Math.max(...sorted),
      drawCalls,
      renderedTriangles,
      visibleSceneTriangles: Math.round(sceneTriangles),
      materialCount: materials.size,
      textureCount: textures.size,
      textureMemoryEstimateBytes: Math.round(estimatedTextureBytes),
      textureMemorySource: 'RGBA8 plus 4/3 mip-chain estimate from visible material image dimensions',
      rendererMemory: { ...renderer.info.memory },
      jsHeapBeforeBytes: heapBefore,
      jsHeapAfterBytes: performance.memory?.usedJSHeapSize ?? null,
      listeners: {
        before: listenerBefore.active,
        after: listenerAfter.active,
        growth: listenerAfter.active - listenerBefore.active,
        byType: listenerAfter.byType,
      },
      uiUpdates: {
        source: 'document-wide MutationObserver callback and record counts',
        callbacks: uiAfter.callbacks - uiBefore.callbacks,
        mutationRecords: uiAfter.mutationRecords - uiBefore.mutationRecords,
        callbacksPerSecond: (uiAfter.callbacks - uiBefore.callbacks) / durationSeconds,
        recordsPerSecond: (uiAfter.mutationRecords - uiBefore.mutationRecords) / durationSeconds,
      },
    };
  });

  fs.writeFileSync(path.join(out, 'diagnostics.json'), `${JSON.stringify(diagnostics, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'performance.json'), `${JSON.stringify(perf, null, 2)}\n`);
  return {
    ok: true,
    pass,
    out,
    screenshots: [...shots.map(({ id }) => `${id}.png`),
      '07-main-exterior-open-normal-control.png', '08-main-interior-open.png'],
    normalControlMainDoor: opened,
    diagnostics,
    performance: perf,
  };
}
