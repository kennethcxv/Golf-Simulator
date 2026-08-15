// Locked production-performance acceptance suite.
//
// Start the fixed server in one terminal:
//   $env:PORT='8457'; npm run serve
// Then run the suite in another terminal:
//   $env:HEADED='1'
//   $env:QA_RESULT_PATH='qa/performance/locked-1080p/result.json'
//   node tools/qa/run-playwright.cjs tools/qa/locked-performance-acceptance.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { pathToFileURL } = process.getBuiltinModule('node:url');
  const contract = await import(pathToFileURL(path.join(
    process.cwd(), 'tools', 'qa', 'locked-performance-contract.mjs',
  )).href);
  const {
    LOCKED_PERFORMANCE_PROTOCOL: protocol,
    LOCKED_PERFORMANCE_SCHEMA_VERSION: schemaVersion,
    evaluateLockedPerformanceReport,
  } = contract;
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const evidenceRoot = path.resolve(process.env.LOCKED_PERF_QA_ROOT
    || path.join(process.cwd(), 'qa', 'performance', 'locked-1080p'));
  const sampleMs = 5_000;
  const globalWarmupMs = 3_000;
  const scenarioSettleMs = 750;
  fs.mkdirSync(evidenceRoot, { recursive: true });

  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      diagnostics.httpErrors.push({ url: response.url(), status: response.status() });
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('golfempire:preferences:v1', JSON.stringify({
      audio: { master: 0, effects: 0, ambience: 0, ui: 0, muted: true },
      camera: { sensitivity: 1, invertY: false, fov: 66, bob: true },
      display: {
        quality: 'high',
        renderScale: 1,
        ambientOcclusion: true,
        bloom: true,
        shadows: true,
        uiScale: 1,
      },
      accessibility: {
        reducedMotion: false,
        highContrast: false,
        toolActivation: 'hold',
      },
    }));

    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const registry = new WeakMap();
    const counters = { added: 0, removed: 0, active: 0, byType: {} };
    const captureOf = (options) => typeof options === 'boolean' ? options : !!options?.capture;
    const listenersFor = (target, type, capture, create) => {
      let byKey = registry.get(target);
      if (!byKey && create) {
        byKey = new Map();
        registry.set(target, byKey);
      }
      if (!byKey) return null;
      const key = `${String(type)}:${capture ? 1 : 0}`;
      let listeners = byKey.get(key);
      if (!listeners && create) {
        listeners = new Set();
        byKey.set(key, listeners);
      }
      return listeners || null;
    };
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (listener) {
        const listeners = listenersFor(this, type, captureOf(options), true);
        if (!listeners.has(listener)) {
          listeners.add(listener);
          counters.added += 1;
          counters.active += 1;
          counters.byType[type] = (counters.byType[type] || 0) + 1;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      const listeners = listener ? listenersFor(this, type, captureOf(options), false) : null;
      if (listeners?.delete(listener)) {
        counters.removed += 1;
        counters.active -= 1;
        counters.byType[type] = Math.max(0, (counters.byType[type] || 0) - 1);
      }
      return originalRemove.call(this, type, listener, options);
    };
    globalThis.__lockedPerfListeners = counters;
    globalThis.__lockedPerfUi = { batches: 0, records: 0, addedNodes: 0, removedNodes: 0 };
    addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver((records) => {
        globalThis.__lockedPerfUi.batches += 1;
        globalThis.__lockedPerfUi.records += records.length;
        for (const record of records) {
          globalThis.__lockedPerfUi.addedNodes += record.addedNodes.length;
          globalThis.__lockedPerfUi.removedNodes += record.removedNodes.length;
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      globalThis.__lockedPerfUiObserver = observer;
    }, { once: true });
  });

  await page.setViewportSize({
    width: protocol.viewport.width,
    height: protocol.viewport.height,
  });
  const electronRun = !!(page.qaRunner || page.electronApp);
  if (electronRun) {
    // run-electron attaches this function after the shipping page has already
    // loaded, so addInitScript and a browser-runner --bootstrap fixture would
    // otherwise both be too late. Seed the same canonical save through the
    // game's production snapshot API, then reload once so the init script and
    // listener census cover the measured document from its first script.
    await page.evaluate(async () => {
      const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
      const empire = E.newEmpire('relaxed', 424242);
      empire.cash = 10_000_000;
      const first = empire.market.find((listing) => listing.id === 'willow-creek')
        || empire.market[0];
      const bought = E.buyProperty(empire, first.id);
      if (!bought.ok) throw new Error(`QA property bootstrap failed: ${bought.reason}`);
      bought.state.tutorial.complete = true;
      bought.state.tutorial.hidden = true;
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  }
  const continueButton = page.locator('button.menu-action-primary').filter({
    has: page.locator('.menu-action-label', { hasText: /^Continue$/ }),
  });
  if (!(await continueButton.count())) {
    throw new Error('Locked performance suite requires the --bootstrap save fixture.');
  }
  // The menu validates the freshly written autosave asynchronously. Playwright's
  // normal click action waits for that real Continue control to become enabled;
  // an eager isEnabled() snapshot races the storage inspection on fast reloads.
  await continueButton.click({ timeout: 30_000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });

  // Rule 5: "locked performance" asserted from a CPU rasterizer is not locked
  // performance. Headless-default runs now refuse instead of passing quietly.
  const { gateRenderer } = await import(
    `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`
  );
  const rendererGate = await gateRenderer(page, {
    electronGpuFeatureStatus: page.qaRunner?.metadata?.readbacks?.beforeDriver?.main?.gpu?.featureStatus
      || page.qaRunner?.readbacks?.beforeDriver?.main?.gpu?.featureStatus
      || null,
    requireElectronStatus: electronRun,
  });

  await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    app.scene3d.setGolfersFrozen?.(true);
    app.scene3d.clearGolfers?.();
    app.state.tutorial.complete = true;
    app.state.tutorial.hidden = true;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.locked = true;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    for (const inventory of Object.values(app.state.shop.inventory)) {
      inventory.shelf = Math.max(Number(inventory.shelf) || 0, 12);
    }
    const vacuum = app.state.shop.inventory.vac1;
    if (vacuum) vacuum.back = Math.max(Number(vacuum.back) || 0, 1);
    clubhouse.rebuildStock?.();
    await clubhouse.sheet06ProductionReady?.();
    await clubhouse.props71to100?.ready;
    if (app.scene3d.assetBarrier) await app.scene3d.assetBarrier();
  });
  await page.waitForTimeout(globalWarmupMs);

  const cdp = await page.context().newCDPSession(page);
  const environment = await page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const gl = renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'masked',
      glContextLost: gl.isContextLost(),
      quality: structuredClone(app.preferences?.values?.display || null),
      cameraFov: app.scene3d.camera.fov,
    };
  });
  if (environment.viewport.width !== protocol.viewport.width
    || environment.viewport.height !== protocol.viewport.height
    || Math.abs(environment.devicePixelRatio - protocol.viewport.deviceScaleFactor) > 1e-6) {
    throw new Error(`Browser did not honor locked 1920x1080 DPR1: ${JSON.stringify(environment)}`);
  }
  if (environment.quality?.quality !== protocol.qualityPreset
    || environment.quality?.renderScale !== 1
    || environment.quality?.ambientOcclusion !== true
    || environment.quality?.bloom !== true
    || environment.quality?.shadows !== true) {
    throw new Error(`Browser did not honor locked high quality: ${JSON.stringify(environment.quality)}`);
  }

  const inputProof = [];
  const screenshotPaths = {};
  const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));

  async function pose(localX, localZ, yaw = 0, pitch = -0.18) {
    await page.evaluate(({ localX, localZ, yaw, pitch }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      app.scene3d.walk.clearKeys?.();
      Object.assign(app.scene3d.walk.state, {
        x: origin.x + localX,
        z: origin.z + localZ,
        yaw,
        pitch,
      });
    }, { localX, localZ, yaw, pitch });
  }

  async function leaveCheckout() {
    for (let step = 0; step < 6; step += 1) {
      const state = await page.evaluate(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        return {
          active: register.isActive(),
          workspace: register.workspace(),
          cancel: register.cardXScreenPoint?.() || null,
        };
      });
      if (!state.active) return;
      if (state.workspace === 'card' && state.cancel?.inView) {
        await page.mouse.click(state.cancel.x, state.cancel.y);
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(220);
    }
    const state = await page.evaluate(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return { active: register.isActive(), workspace: register.workspace() };
    });
    throw new Error(`Could not leave checkout through normal controls: ${JSON.stringify(state)}.`);
  }

  async function cycleTool(expected, scenario, run) {
    for (let press = 0; press <= 14; press += 1) {
      const equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
      if (equipped === expected) {
        inputProof.push({ scenario, run, control: 'F', expected, equipped, presses: press });
        return;
      }
      if (press === 14) break;
      await page.keyboard.press('f');
      await page.waitForTimeout(85);
    }
    const equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
    throw new Error(`Could not cycle tool to ${expected}; equipped ${equipped}.`);
  }

  async function resetFloor(scenario, run) {
    await page.mouse.up({ button: 'left' }).catch(() => {});
    for (const key of ['w', 'a', 's', 'd', 'Shift']) await page.keyboard.up(key).catch(() => {});
    await leaveCheckout();
    await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.scene3d.walk.clearKeys?.();
    });
    await pose(-5.5, 3.2, 0, -0.42);
    await cycleTool(null, scenario, run);
    await page.waitForTimeout(scenarioSettleMs);
  }

  async function performanceSample(label, controlAction = null) {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(200);
    const beforeDom = await cdp.send('Memory.getDOMCounters');
    const capture = page.evaluate(({ label, durationMs }) => new Promise((resolve) => {
      const app = window.__fw;
      const renderer = app.scene3d.renderer;
      const info = renderer.info;
      const materials = new Set();
      const textures = new Map();
      const mapKeys = [
        'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
        'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap',
      ];
      app.scene3d.scene.traverse((object) => {
        if (!object.isMesh) return;
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of mapKeys) {
            const texture = material[key];
            if (texture?.isTexture) textures.set(texture.uuid, texture);
          }
        }
      });
      const estimateTextureBytes = () => {
        let bytes = 0;
        for (const texture of textures.values()) {
          const source = texture.source?.data || texture.image;
          const images = Array.isArray(source) ? source : [source];
          for (const image of images) {
            const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
            const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
            if (width > 0 && height > 0) {
              bytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
            }
          }
        }
        return Math.round(bytes);
      };
      const uiBefore = { ...globalThis.__lockedPerfUi };
      const frames = [];
      const renderInfoSamples = [];
      let previous = null;
      let firstFrame = null;
      globalThis.__lockedPerfCaptureActive = true;
      const tick = (now) => {
        if (firstFrame == null) firstFrame = now;
        if (previous != null) frames.push(now - previous);
        renderInfoSamples.push({
          calls: Number(info.render.calls) || 0,
          triangles: Number(info.render.triangles) || 0,
        });
        previous = now;
        if (now - firstFrame < durationMs || frames.length < 10) {
          requestAnimationFrame(tick);
          return;
        }
        globalThis.__lockedPerfCaptureActive = false;
        const retained = frames.slice(5);
        const retainedRenderInfo = renderInfoSamples.slice(-retained.length);
        const sorted = [...retained].sort((a, b) => b - a);
        const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
        const slowMean = sorted.slice(0, slowCount)
          .reduce((sum, value) => sum + value, 0) / slowCount;
        const meanFrameMs = retained.reduce((sum, value) => sum + value, 0)
          / Math.max(1, retained.length);
        const averageRenderMetric = (key) => retainedRenderInfo.reduce(
          (sum, sample) => sum + sample[key],
          0,
        ) / Math.max(1, retainedRenderInfo.length);
        const duration = retained.reduce((sum, value) => sum + value, 0);
        const uiAfter = globalThis.__lockedPerfUi;
        resolve({
          label,
          durationMs: duration,
          frameCount: retained.length,
          averageFps: 1000 / Math.max(0.001, meanFrameMs),
          onePercentLowFps: 1000 / Math.max(0.001, slowMean),
          worstFrameMs: sorted[0] || 0,
          framesOver33Ms: retained.filter((value) => value > 33).length,
          framesOver50Ms: retained.filter((value) => value > 50).length,
          drawCalls: averageRenderMetric('calls'),
          renderedTriangles: averageRenderMetric('triangles'),
          materialCount: materials.size,
          rendererGeometryCount: info.memory.geometries,
          rendererTextureCount: info.memory.textures,
          textureMemoryBytes: estimateTextureBytes(),
          // Chrome exposes this metric in the locked runner. Null means the
          // measurement is unavailable and must fail contract validation; zero
          // must never masquerade as a successful heap sample.
          jsHeapUsedBytes: Number.isFinite(performance.memory?.usedJSHeapSize)
            ? performance.memory.usedJSHeapSize
            : null,
          trackedEventListeners: globalThis.__lockedPerfListeners.active,
          uiMutationsPerSecond: (uiAfter.records - uiBefore.records)
            / Math.max(0.001, duration / 1000),
        });
      };
      requestAnimationFrame(tick);
    }), { label, durationMs: sampleMs });
    await page.waitForFunction(() => globalThis.__lockedPerfCaptureActive === true);
    const action = controlAction ? controlAction() : Promise.resolve();
    const [sample] = await Promise.all([capture, action]);
    const afterDom = await cdp.send('Memory.getDOMCounters');
    sample.activeEventListeners = afterDom.jsEventListeners;
    sample.domNodes = afterDom.nodes;
    sample.domNodeDelta = afterDom.nodes - beforeDom.nodes;
    for (const key of [
      'durationMs', 'worstFrameMs',
      'drawCalls', 'renderedTriangles', 'uiMutationsPerSecond',
    ]) sample[key] = round(sample[key]);
    return sample;
  }

  async function captureEvidence(scenarioKey) {
    const index = protocol.scenarios.indexOf(scenarioKey) + 1;
    const screenshot = path.join(
      evidenceRoot,
      `${String(index).padStart(2, '0')}-${scenarioKey}-1920x1080.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: false });
    screenshotPaths[scenarioKey] = screenshot.replaceAll('\\', '/');
  }

  async function prepareIdle(run) {
    await resetFloor('idle', run);
    await pose(-5.5, 3.2, 0, -0.42);
    return { camera: 'clubhouse floor fixed camera', customers: 0, tool: null };
  }

  async function prepareWalk(run) {
    await resetFloor('walk', run);
    await pose(-2.0, 3.2, 0, -0.18);
    return { camera: 'clubhouse central aisle', customers: 0, tool: null };
  }

  async function walkControls(run) {
    const start = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
    }));
    let maximumDistance = 0;
    const started = Date.now();
    let forward = true;
    while (Date.now() - started < sampleMs) {
      const key = forward ? 'w' : 's';
      await page.keyboard.down(key);
      await page.waitForTimeout(400);
      await page.keyboard.up(key);
      const current = await page.evaluate(() => ({
        x: window.__fw.scene3d.walk.state.x,
        z: window.__fw.scene3d.walk.state.z,
      }));
      maximumDistance = Math.max(
        maximumDistance,
        Math.hypot(current.x - start.x, current.z - start.z),
      );
      forward = !forward;
    }
    if (maximumDistance < 0.2) {
      throw new Error(`Walk controls did not move the player: ${maximumDistance.toFixed(3)}m.`);
    }
    inputProof.push({
      scenario: 'walk',
      run,
      control: 'keyboard',
      keys: ['w', 's'],
      maximumDistance: round(maximumDistance),
    });
  }

  async function prepareCleaning(run) {
    await resetFloor('cleaning', run);
    await pose(-5.5, 3.2, 0, -0.62);
    await cycleTool('vacuum', 'cleaning', run);
    const viewport = page.viewportSize();
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    await page.mouse.down({ button: 'left' });
    inputProof.push({ scenario: 'cleaning', run, control: 'left-mouse-hold', tool: 'vacuum' });
    await page.waitForTimeout(300);
    return { camera: 'clubhouse cleaning floor', customers: 0, tool: 'vacuum', active: true };
  }

  async function prepareCheckout(run) {
    await resetFloor('checkout', run);
    const registerPose = await page.evaluate(async () => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const origin = clubhouse.interior.position;
      const walk = app.scene3d.walk;
      const dx = REGISTER.monitor.x - REGISTER.stand.x;
      const dz = REGISTER.monitor.z - REGISTER.stand.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      walk.clearKeys?.();
      Object.assign(walk.state, {
        x: origin.x + REGISTER.stand.x,
        z: origin.z + REGISTER.stand.z,
        yaw: Math.atan2(-dx / horizontal, -dz / horizontal),
        pitch: Math.atan2(1.18 - 1.62, horizontal),
      });
      return {
        stand: { x: REGISTER.stand.x, z: REGISTER.stand.z },
        monitor: { x: REGISTER.monitor.x, z: REGISTER.monitor.z },
      };
    });
    const customer = await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      return clubhouse.sendToCounter(['tees1', 'marker1', 'glove1'], 'card');
    });
    if (!customer) throw new Error('Could not create the locked three-product checkout fixture.');
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.hasTx?.() || !!register.getTx?.();
    }, null, { timeout: 10_000 });
    await page.waitForTimeout(250);
    const focus = await page.evaluate(() => (
      window.__fw.scene3d.walk.getFocusLabel?.() || null
    ));
    await page.keyboard.press('e');
    inputProof.push({
      scenario: 'checkout', run, control: 'E', action: 'enter register', focus, registerPose,
    });
    await page.waitForFunction(
      () => window.__fw.scene3d.clubhouse().register.isActive(),
      null,
      { timeout: 10_000 },
    );
    await page.evaluate(() => { window.__lockedPerfRegisterCameraProbe = null; });
    await page.waitForFunction(() => {
      const app = window.__fw;
      const register = app.scene3d.clubhouse().register;
      if (register.workspace() !== 'scan') return false;
      const camera = app.scene3d.camera;
      const now = {
        x: camera.position.x, y: camera.position.y, z: camera.position.z,
        qx: camera.quaternion.x, qy: camera.quaternion.y,
        qz: camera.quaternion.z, qw: camera.quaternion.w,
        fov: camera.fov,
      };
      const old = window.__lockedPerfRegisterCameraProbe;
      if (!old) {
        window.__lockedPerfRegisterCameraProbe = { ...now, stable: 0 };
        return false;
      }
      const delta = Math.max(
        Math.abs(now.x - old.x), Math.abs(now.y - old.y), Math.abs(now.z - old.z),
        Math.abs(now.qx - old.qx), Math.abs(now.qy - old.qy),
        Math.abs(now.qz - old.qz), Math.abs(now.qw - old.qw),
        Math.abs(now.fov - old.fov),
      );
      const stable = delta < 0.0008 ? old.stable + 1 : 0;
      window.__lockedPerfRegisterCameraProbe = { ...now, stable };
      return stable >= 4;
    }, null, { timeout: 12_000, polling: 80 });
    await page.waitForTimeout(scenarioSettleMs);
    return {
      camera: 'authored active-register camera',
      customer,
      products: ['tees1', 'marker1', 'glove1'],
      payment: 'card',
      focus,
      registerPose,
    };
  }

  async function checkoutControls(run) {
    const projectProduct = (uid) => page.evaluate(async (id) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      let product = null;
      clubhouse.interior.traverse((object) => {
        if (!product && object.visible && object.userData?.kind === 'item'
          && object.userData?.uid === id) product = object;
      });
      if (!product) return { uid: id, missingMesh: true };
      const bounds = new THREE.Box3().setFromObject(product);
      const world = bounds.isEmpty()
        ? product.getWorldPosition(new THREE.Vector3())
        : bounds.getCenter(new THREE.Vector3());
      world.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return {
        uid: id,
        x: rect.left + ((world.x + 1) / 2) * rect.width,
        y: rect.top + ((-world.y + 1) / 2) * rect.height,
        inView: world.z >= -1 && world.z <= 1
          && world.x >= -1 && world.x <= 1
          && world.y >= -1 && world.y <= 1,
      };
    }, uid);
    const scanned = [];
    for (let index = 0; index < 3; index += 1) {
      const uid = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().register.getTx()?.items
          .find((entry) => !entry.scanned)?.uid || null
      ));
      let point = uid ? await projectProduct(uid) : null;
      for (let settle = 0; settle < 20; settle += 1) {
        await page.waitForTimeout(160);
        const next = uid ? await projectProduct(uid) : null;
        if (next && point && Math.abs(next.x - point.x) < 1.5
          && Math.abs(next.y - point.y) < 1.5) {
          point = next;
          break;
        }
        point = next;
      }
      if (!point?.inView) {
        throw new Error(`Checkout product ${index + 1} has no normal click point: ${JSON.stringify(point)}.`);
      }
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction((uid) => {
        const item = window.__fw.scene3d.clubhouse().register
          .getTx()?.items.find((entry) => entry.uid === uid);
        return !!item?.scanned && !!item?.staged;
      }, point.uid, { timeout: 8_000 });
      await page.waitForFunction(() => {
        const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
        return state === 'WaitingForScan' || state === 'AllProductsScanned';
      }, null, { timeout: 8_000 });
      scanned.push(point.uid);
      inputProof.push({
        scenario: 'checkout',
        run,
        control: 'left-click',
        action: 'physical product scan',
        uid: point.uid,
        x: round(point.x),
        y: round(point.y),
        outcome: 'scanned-and-staged',
      });
    }
    if (new Set(scanned).size !== 3) {
      throw new Error(`Checkout controls did not scan three distinct products: ${JSON.stringify(scanned)}.`);
    }
  }

  async function prepareTenCustomers(run) {
    await resetFloor('tenCustomers', run);
    await pose(2.8, 5.1, 0, -0.18);
    const fixture = await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customersOf = () => (
        typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers
      );
      while (customersOf().length < 10) {
        if (!clubhouse.debugSpawn(false)) break;
      }
      const customers = customersOf();
      const origin = clubhouse.interior.position;
      const positions = [
        [-3.4, -2.5], [-1.65, -2.5], [0.1, -2.5], [1.85, -2.5],
        [-3.4, -1.05], [-1.65, -1.05], [0.1, -1.05], [1.85, -1.05],
        [-1.65, 0.4], [0.1, 0.4],
      ];
      customers.slice(0, 10).forEach((customer, index) => {
        const [localX, localZ] = positions[index];
        const x = origin.x + localX;
        const z = origin.z + localZ;
        customer.mesh.position.set(x, customer.mesh.position.y, z);
        customer.path = [];
        customer.pathGoal = null;
        customer.speed = 0;
        customer.linger = 1e9;
        customer.stops = [{ kind: 'fixture', x, z, faceX: origin.x + 2.8, faceZ: origin.z + 5.1 }];
        customer.stopIdx = 0;
        if (customer.entity) {
          customer.entity.position = { x, z };
          customer.entity.blockedDuration = 0;
        }
      });
      return { activeCustomers: customers.length, positionedCustomers: Math.min(10, customers.length) };
    });
    if (fixture.activeCustomers !== 10 || fixture.positionedCustomers !== 10) {
      throw new Error(`Ten-customer fixture was not exact: ${JSON.stringify(fixture)}`);
    }
    await page.waitForTimeout(scenarioSettleMs);
    return { camera: 'register-facing ten-customer floor', ...fixture };
  }

  async function tenCustomerControls(run) {
    inputProof.push({
      scenario: 'tenCustomers',
      run,
      control: 'keyboard',
      keys: ['a', 'd'],
      action: 'player strafes through the populated sales floor',
    });
    const started = Date.now();
    let left = true;
    while (Date.now() - started < sampleMs) {
      const key = left ? 'a' : 'd';
      await page.keyboard.down(key);
      await page.waitForTimeout(400);
      await page.keyboard.up(key);
      left = !left;
    }
    const activeCustomers = await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : clubhouse.customers;
      return customers.length;
    });
    if (activeCustomers !== 10) {
      throw new Error(`Ten-customer load changed during normal controls: ${activeCustomers}.`);
    }
    inputProof.push({
      scenario: 'tenCustomers',
      run,
      control: 'postcondition',
      activeCustomers,
      expected: 10,
    });
  }

  const scenarioDefinitions = {
    idle: { prepare: prepareIdle },
    walk: { prepare: prepareWalk, controls: walkControls },
    cleaning: { prepare: prepareCleaning },
    checkout: { prepare: prepareCheckout, controls: checkoutControls },
    tenCustomers: { prepare: prepareTenCustomers, controls: tenCustomerControls },
  };
  const scenarios = {};
  for (const scenarioKey of protocol.scenarios) {
    const definition = scenarioDefinitions[scenarioKey];
    const runs = [];
    for (let run = 1; run <= protocol.runsPerScenario; run += 1) {
      const fixture = await definition.prepare(run);
      if (run === 1) await captureEvidence(scenarioKey);
      const sample = await performanceSample(
        `${scenarioKey}-run-${run}`,
        definition.controls ? () => definition.controls(run) : null,
      );
      runs.push({ run, fixture, sample });
      if (scenarioKey === 'cleaning') await page.mouse.up({ button: 'left' });
      if (scenarioKey === 'checkout') await leaveCheckout();
    }
    scenarios[scenarioKey] = { runs, screenshot: screenshotPaths[scenarioKey] };
  }
  await resetFloor('cleanup', 1);

  const allowedWarning = /PCFSoftShadowMap has been deprecated/i;
  const unexpectedWarnings = diagnostics.consoleWarnings
    .filter((message) => !allowedWarning.test(message));
  const report = {
    schemaVersion,
    capturedAt: new Date().toISOString(),
    protocol: {
      viewport: { ...protocol.viewport },
      qualityPreset: protocol.qualityPreset,
      scenarios: [...protocol.scenarios],
      runsPerScenario: protocol.runsPerScenario,
      aggregation: protocol.aggregation,
      thresholds: { ...protocol.thresholds },
      sampleMs,
      globalWarmupMs,
      scenarioSettleMs,
      frameMetric: 'rAF deltas after five settling frames; average FPS is inverse mean frame time; 1% low is inverse mean of slowest ceil(1%) frame times',
      resources: 'WebGLRenderer.info accumulated per display frame; scene materials and decoded RGBA8 texture bytes with mip estimate; authoritative CDP DOM/active-listener counts and growth; add/remove listener balance (implicit once/signal cleanup is diagnostic only); post-GC JS heap; document-wide UI mutation rate',
      fixture: 'relaxed seed 424242 bootstrap; high quality; 14:00 locked weather; simulation paused; organic walk-ins and golfers disabled; fixed camera reset before every run',
      fixtureBoundary: 'direct camera poses, sendToCounter, debugSpawn, and deterministic customer positioning establish repeatable measured state only; walking, vacuum activation, register entry/product scans, and populated-floor movement use normal keyboard/mouse controls',
    },
    rendererGate,
    environment,
    inputProof,
    diagnostics,
    unexpectedWarnings,
    scenarios,
  };
  const performanceEvaluation = evaluateLockedPerformanceReport(report);
  const diagnosticFailures = [
    ...diagnostics.consoleErrors.map((message) => `console error: ${message}`),
    ...unexpectedWarnings.map((message) => `console warning: ${message}`),
    ...diagnostics.pageErrors.map((message) => `page error: ${message}`),
    ...diagnostics.requestFailures.map((entry) => `request failed: ${entry.url} (${entry.error})`),
    ...diagnostics.httpErrors.map((entry) => `HTTP ${entry.status}: ${entry.url}`),
    ...(environment.glContextLost ? ['WebGL context was lost'] : []),
  ];
  return {
    ...report,
    ok: performanceEvaluation.ok && diagnosticFailures.length === 0,
    gates: performanceEvaluation.gates,
    failures: [...performanceEvaluation.failures, ...diagnosticFailures],
  };
}
