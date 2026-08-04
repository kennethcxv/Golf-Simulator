async (page) => {
  // Medium apparel-carton production probe.
  //
  // The documented fixture below establishes one repeatable delivery and fixed
  // player-camera poses. Every lifecycle transition after staging is exercised
  // through the game's normal pointer/keyboard path: three E presses open the
  // carton (press one tears the tape and swings the wide flap pair, press two
  // folds the other pair, press three takes an armful), tap E to
  // flatten/carry/recycle, and hold E at the apparel table to stock.
  // (Ported off the box-cutter equip 2026-07-30 — cartons tear on a press;
  // proshop-box-open-loop.js owns the gesture contract.)
  //
  // Run through tools/qa/run-playwright.cjs; see
  // qa/box_system_master/hero_apparel/QA_PROTOCOL.md for the four-pass protocol.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const phase = String(process.env.BOX_QA_PHASE || 'after').toLowerCase();
  const iteration = Number.parseInt(process.env.BOX_QA_ITERATION || '1', 10);
  const sampleMs = Math.max(2000, Number.parseInt(process.env.BOX_QA_SAMPLE_MS || '5000', 10));
  const allowedPhases = new Set(['before', 'after', 'candidate']);
  if (!allowedPhases.has(phase)) throw new Error(`BOX_QA_PHASE must be before, after, or candidate; got ${phase}.`);
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > 4) {
    throw new Error(`BOX_QA_ITERATION must be an integer from 1 through 4; got ${iteration}.`);
  }

  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const iterationName = `iteration-${String(iteration).padStart(2, '0')}`;
  const out = path.join(repo, 'qa', 'box_system_master', 'hero_apparel', phase, iterationName);
  fs.mkdirSync(out, { recursive: true });

  // The runner's --bootstrap document only seeds localStorage. Drain its async
  // model requests before the intentional fixture reload so old-document
  // cancellations cannot masquerade as failures in this measured run.
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(750);

  const diagnostics = [];
  const diagnosticCounts = { consoleError: 0, consoleWarning: 0, pageError: 0, requestFailed: 0 };
  let probeReady = false;
  const noteDiagnostic = (kind, text) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({ kind, text: String(text), atMs: Date.now() });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') noteDiagnostic('consoleError', message.text());
    if (message.type() === 'warning') noteDiagnostic('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => noteDiagnostic('pageError', error.message));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'unknown';
    // The runner bootstraps once before this probe loads its fixed fixture.
    // In-flight assets from that old document are expected to abort at this
    // deliberate navigation and are not failures of the measured scene.
    if (!probeReady && /ERR_ABORTED/i.test(errorText)) return;
    noteDiagnostic('requestFailed', `${request.url()} (${errorText})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      noteDiagnostic('requestFailed', `${response.url()} (HTTP ${response.status()})`);
    }
  });

  const cameras = Object.freeze({
    box: { x: 8.25, z: -0.43, yaw: 0, pitch: -0.58 },
    boxOpen: { x: 8.25, z: -0.43, yaw: 0, pitch: -0.78 },
    apparelTable: { x: -5.9, z: 2.05, yaw: 0, pitch: -0.42 },
    recycling: { x: 9.05, z: 1.3, yaw: -Math.PI / 2, pitch: -0.40 },
  });
  // Clean working aisle beside the stockroom packing bench: label faces the
  // player, the top seam is unobstructed, and no dressing carton shares frame.
  const heroSpot = Object.freeze({ x: 8.25, z: -1.7, ry: 0 });
  const heroOrderId = 910001;
  const heroQty = 8; // production carton: four two-garment trips expose every depletion band.

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.assetsReady?.(), null, { timeout: 90000 });
  await page.waitForTimeout(750);
  probeReady = true;

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    if (app.state.weather) app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
  });

  const viewportContract = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
  if (viewportContract.innerWidth !== 1600 || viewportContract.innerHeight !== 900 || viewportContract.devicePixelRatio !== 1) {
    throw new Error(`Fixed viewport contract failed: ${JSON.stringify(viewportContract)}.`);
  }

  // Exercise the real pointer path once. The fixed camera fixture is used after
  // this click so screenshots remain pixel-comparable between iterations.
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 30000 });
  await page.bringToFront();
  await page.mouse.move(800, 450);
  await canvas.click({ position: { x: 800, y: 450 }, force: true });
  await page.waitForFunction((target) => document.pointerLockElement === target, await canvas.elementHandle(), { timeout: 7000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  async function setCamera(pose) {
    await page.evaluate((next) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + next.x;
      walk.state.z = origin.z + next.z;
      walk.state.yaw = next.yaw;
      walk.state.pitch = next.pitch;
    }, pose);
    await page.waitForTimeout(280);
  }

  async function focusInfo() {
    return page.evaluate(() => ({
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      tool: window.__fw.scene3d.walk.getTool?.() || null,
    }));
  }

  async function waitForFocus(pattern, timeout = 7000) {
    const source = pattern.source;
    const flags = pattern.flags;
    await page.waitForFunction(({ source: reSource, flags: reFlags }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return new RegExp(reSource, reFlags).test(label);
    }, { source, flags }, { timeout });
    return focusInfo();
  }

  async function boxSnapshot(id) {
    return page.evaluate(async (boxId) => {
      const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const box = D.findBox(window.__fw.state, boxId);
      if (!box) {
        const delivery = window.__fw.state.shop.deliveries;
        return {
          exists: false,
          lifecycle: 'DISCARDED',
          recycled: delivery.recycled || 0,
          trash: delivery.trash || 0,
        };
      }
      return {
        exists: true,
        id: box.id,
        state: D.boxState(box),
        lifecycle: D.boxLifecycleState(box),
        loc: box.loc,
        qty: box.qty,
        cap: box.cap,
        cutProgress: box.cutProgress ?? box.tape ?? 0,
        tapeSegments: { ...(box.tapeSegments || {}) },
        flapProgress: [...(box.flapProgress || box.flaps || [])],
        openingProgress: box.openingProgress || 0,
        flattenProgress: box.flattenProgress || 0,
        flat: !!box.flat,
      };
    }, id);
  }

  async function waitForBox(id, condition, timeout = 6000) {
    await page.waitForFunction(({ boxId, condition: wanted }) => {
      const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === boxId);
      if (wanted === 'gone') return !box;
      if (!box) return false;
      if (wanted === 'cut') return (box.cutProgress ?? box.tape ?? 0) >= 1;
      if (wanted === 'opening') return (box.openingProgress || 0) > 0.05 && (box.openingProgress || 0) < 0.95;
      if (wanted === 'open') return (box.flapProgress || []).length === 4 && box.flapProgress.every((value) => value >= 0.999);
      if (wanted === 'flat') return box.flat && (box.flattenProgress || 0) >= 0.999;
      if (wanted.startsWith('qty:')) return box.qty === Number(wanted.slice(4));
      if (wanted.startsWith('loc:')) return box.loc === wanted.slice(4);
      return false;
    }, { boxId: id, condition }, { timeout });
  }

  async function waitCarry(expectedQty, timeout = 5000) {
    await page.waitForFunction((qty) => {
      const carry = window.__fw?.state?.shop?.carry;
      return qty === 0 ? !carry : !!carry && carry.skuId === 'polo1' && carry.qty === qty;
    }, expectedQty, { timeout });
  }

  async function stageHero({ orderId, qty, resetDelivery }) {
    const staged = await page.evaluate(async ({ orderId: id, qty: units, spot, reset }) => {
      const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const state = window.__fw.state;
      D.ensureDeliveries(state);
      const delivery = state.shop.deliveries;
      if (reset) {
        delivery.boxes = [];
        delivery.shipments = [];
        delivery.arrivedOrderIds = [];
        delivery.nextBoxId = 1;
        delivery.trash = 0;
        delivery.recycled = 0;
      }
      state.shop.carry = null;
      state.shop.inventory.polo1.shelf = 0;
      state.shop.inventory.polo1.back = 0;
      if (state.shop.reno) {
        state.shop.reno.grime.fill(0);
        state.shop.reno.clutter = [];
      }
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }
      const manifest = {
        supplierId: 'pinehollow-apparel-qa',
        supplier: 'Pinehollow Apparel Works',
        boxes: [{ kind: 'apparel', qty: units, w: 0.60, h: 0.35, d: 0.40, lb: +(units * 0.5).toFixed(1), fragile: false }],
        boxCount: 1,
        weight: +(units * 0.5).toFixed(1),
        fee: 9,
      };
      const [box] = D.arriveOrder(state, { id, skuId: 'polo1', qty: units, manifest });
      if (!box) throw new Error(`Fixture failed to create order ${id}.`);
      D.pickUpBox(state, box.id);
      D.putDownBox(state, box.id, spot);
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.rebuildReno?.();
      clubhouse.refreshCondition?.();
      clubhouse.rebuildStock?.();
      clubhouse.rebuildBoxes();
      return { id: box.id, orderId: id, qty: box.qty, cap: box.cap };
    }, { orderId, qty, spot: heroSpot, reset: resetDelivery });

    await page.waitForFunction((id) => {
      const scene = window.__fw?.scene3d?.scene;
      const root = scene?.getObjectByName(`DeliveryBox_${id}`);
      const names = [];
      root?.traverse((object) => { if (object.name) names.push(object.name); });
      return !!(
        root
        && root.getObjectByName('BOX_FLAP_FRONT')
        && root.getObjectByName('BOX_FLAP_BACK')
        && root.getObjectByName('BOX_FLAP_LEFT')
        && root.getObjectByName('BOX_FLAP_RIGHT')
        && root.getObjectByName('BOX_WALL_FRONT')
        && root.getObjectByName('CONTENT_SLOT_01')
        && names.some((name) => name.startsWith('TAPE_') && !name.includes('PEELED'))
      );
    }, staged.id, { timeout: 30000 });
    return staged;
  }

  async function assetContract(id) {
    return page.evaluate((boxId) => {
      const scene = window.__fw.scene3d.scene;
      const root = scene.getObjectByName(`DeliveryBox_${boxId}`);
      const recycling = scene.getObjectByName('DeliveryRecyclingStationAuthored');
      const names = [];
      root?.traverse((object) => { if (object.name) names.push(object.name); });
      return {
        authoredBox: !!root,
        authoredRecycling: !!recycling,
        flatBundle: !!root?.getObjectByName('BOX_FLAT_BUNDLE'),
        fourFlaps: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_FLAP_${side}`)),
        fourWalls: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_WALL_${side}`)),
        contentSlots: names.filter((name) => name.startsWith('CONTENT_SLOT_')).length,
        actualProducts: names.filter((name) => name.startsWith('BOX_CONTENT_')).length,
        tapeSegments: names.filter((name) => name.startsWith('TAPE_') && !name.includes('PEELED')).length,
        shippingLabel: names.some((name) => name.includes('LABEL_DYNAMIC') || name.includes('LABEL_SHIPPING')),
      };
    }, id);
  }

  async function pressState(id) {
    return page.evaluate(async (boxId) => {
      const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const st = window.__fw.state;
      const walk = window.__fw.scene3d.walk;
      const box = D.findBox(st, boxId);
      return {
        label: walk.getFocusLabel?.() ?? null,
        tool: walk.getTool?.() ?? null,
        tapeCut: box ? D.tapeCut(box) : null,
        flapsOpen: box ? D.flapsOpen(box) : null,
        carried: st.shop.carry?.qty || 0,
      };
    }, id);
  }

  async function openCartonByPresses(id) {
    // Press one tears the tape in a single press and swings the wide flap pair
    // open; press two folds the other pair. No tool, no equip, no drag —
    // proshop-box-open-loop.js owns the gesture contract.
    await waitForFocus(/tear the tape open/i);
    await page.keyboard.press('e');
    await waitForBox(id, 'cut', 5000);
    await waitForFocus(/open the other flap/i);
    await page.keyboard.press('e');
    await waitForBox(id, 'open', 5000);
  }

  async function waitForStableScene() {
    await page.evaluate(() => { delete window.__heroStableScene; });
    await page.waitForFunction(() => {
      const scene = window.__fw?.scene3d?.scene;
      if (!scene) return false;
      const counts = { objects: 0, meshes: 0, materials: new Set(), geometries: new Set() };
      scene.traverseVisible((object) => {
        counts.objects += 1;
        if (!object.isMesh) return;
        counts.meshes += 1;
        if (object.geometry) counts.geometries.add(object.geometry.uuid);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material) counts.materials.add(material.uuid);
      });
      const signature = `${counts.objects}|${counts.meshes}|${counts.geometries.size}|${counts.materials.size}`;
      const prior = window.__heroStableScene || { signature: '', repeats: 0 };
      window.__heroStableScene = signature === prior.signature
        ? { signature, repeats: prior.repeats + 1 }
        : { signature, repeats: 0 };
      return window.__heroStableScene.repeats >= 5;
    }, null, { timeout: 20000, polling: 250 });
  }

  async function stockCurrentArmful() {
    await setCamera(cameras.apparelTable);
    await waitForFocus(/Apparel tables.*hold \[E\] to stock/i);
    await page.keyboard.down('e');
    try {
      await waitCarry(0, 5000);
    } finally {
      await page.keyboard.up('e').catch(() => {});
    }
    await page.waitForTimeout(650); // let the authored stock-flight settle into its slots
  }

  async function chooseRecyclingFocus() {
    const candidates = [
      cameras.recycling,
      { x: 9.10, z: 1.3, yaw: -Math.PI / 2, pitch: -0.46 },
      { x: 9.85, z: -0.15, yaw: Math.PI, pitch: -0.42 },
    ];
    for (const pose of candidates) {
      await setCamera(pose);
      const info = await focusInfo();
      if (/Recycling.*drop the flattened carton/i.test(info.label || '')) return { pose, info };
    }
    throw new Error(`Could not focus the recycling-bin drop action; last focus was ${JSON.stringify(await focusInfo())}.`);
  }

  // Count actual WebGL calls across every pass by wrapping draw entry points.
  // This deliberately does not read or reset renderer.info, which EffectComposer
  // resets between passes and can otherwise report only its final fullscreen quad.
  await page.evaluate(() => {
    const renderer = window.__fw.scene3d.renderer;
    const gl = renderer.getContext();
    if (window.__heroBoxDrawProbe) return;
    const probe = {
      active: false,
      calls: 0,
      triangles: 0,
      frames: [],
      begin() { this.active = true; this.calls = 0; this.triangles = 0; this.frames = []; },
      end() { this.active = false; return this.frames.slice(4); },
    };
    const trianglesFor = (mode, count, instances) => {
      const n = Math.max(0, Number(count) || 0);
      const copies = Math.max(1, Number(instances) || 1);
      if (mode === gl.TRIANGLES) return Math.floor(n / 3) * copies;
      if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) return Math.max(0, n - 2) * copies;
      return 0;
    };
    const wrap = (name, countIndex, modeIndex, instanceIndex = -1) => {
      const original = gl[name];
      if (typeof original !== 'function') return;
      gl[name] = function wrappedDraw(...args) {
        if (probe.active) {
          probe.calls += 1;
          probe.triangles += trianglesFor(args[modeIndex], args[countIndex], instanceIndex >= 0 ? args[instanceIndex] : 1);
        }
        return original.apply(this, args);
      };
    };
    wrap('drawArrays', 2, 0);
    wrap('drawElements', 1, 0);
    wrap('drawArraysInstanced', 2, 0, 3);
    wrap('drawElementsInstanced', 1, 0, 4);
    const rollFrame = () => {
      if (probe.active) {
        probe.frames.push({ calls: probe.calls, triangles: probe.triangles });
        probe.calls = 0;
        probe.triangles = 0;
      }
      requestAnimationFrame(rollFrame);
    };
    requestAnimationFrame(rollFrame);
    window.__heroBoxDrawProbe = probe;
  });

  async function domCounters() {
    const counters = await cdp.send('Memory.getDOMCounters');
    const performanceMetrics = await cdp.send('Performance.getMetrics');
    const byName = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value]));
    return {
      documents: counters.documents,
      domNodes: counters.nodes,
      jsEventListeners: counters.jsEventListeners,
      jsHeapUsedBytes: Number.isFinite(byName.JSHeapUsedSize) ? byName.JSHeapUsedSize : null,
      jsHeapTotalBytes: Number.isFinite(byName.JSHeapTotalSize) ? byName.JSHeapTotalSize : null,
      source: 'Chrome DevTools Protocol Memory.getDOMCounters + Performance.getMetrics',
    };
  }

  async function collectGarbage() {
    // Heap deltas are intended to detect retained lifecycle resources, not
    // whether V8 happened to collect short-lived render/QA allocations before
    // one of the two samples. CDP collection makes the strict 8 MiB gate
    // repeatable while leaving the live scene and its resources untouched.
    await cdp.send('HeapProfiler.enable').catch(() => {});
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  }

  async function startMeasurement() {
    await page.evaluate(() => {
      const targets = ['.shop-prompt', '.topbar', '.hud-min', '.toast-wrap']
        .map((selector) => ({ selector, node: document.querySelector(selector) }))
        .filter((entry) => entry.node);
      const ui = { records: 0, callbacks: 0, targets: targets.map((entry) => entry.selector), observers: [] };
      for (const entry of targets) {
        const observer = new MutationObserver((records) => { ui.callbacks += 1; ui.records += records.length; });
        observer.observe(entry.node, { attributes: true, childList: true, characterData: true, subtree: true });
        ui.observers.push(observer);
      }
      const frame = { deltas: [], last: performance.now(), running: true };
      const tick = (time) => {
        if (!frame.running) return;
        frame.deltas.push(time - frame.last);
        frame.last = time;
        requestAnimationFrame(tick);
      };
      window.__heroBoxDrawProbe.begin();
      requestAnimationFrame(tick);
      window.__heroBoxMetric = { ui, frame, startedAt: performance.now() };
    });
  }

  async function stopMeasurement() {
    return page.evaluate(() => {
      const metric = window.__heroBoxMetric;
      metric.frame.running = false;
      metric.ui.observers.forEach((observer) => observer.disconnect());
      const elapsedMs = performance.now() - metric.startedAt;
      const deltas = metric.frame.deltas.slice(5).sort((a, b) => a - b);
      const avg = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
      const worstCount = Math.max(1, Math.ceil(deltas.length * 0.01));
      const lowWindowMs = deltas.slice(-worstCount).reduce((sum, value) => sum + value, 0) / worstCount;
      const drawFrames = window.__heroBoxDrawProbe.end();
      const drawAvg = (key) => drawFrames.reduce((sum, frame) => sum + frame[key], 0) / Math.max(1, drawFrames.length);
      const drawMax = (key) => drawFrames.reduce((greatest, frame) => Math.max(greatest, frame[key]), 0);

      const scene = window.__fw.scene3d.scene;
      const renderer = window.__fw.scene3d.renderer;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Map();
      let meshes = 0;
      let visibleSceneTriangles = 0;
      const rememberTexture = (texture) => {
        if (!texture?.isTexture || textures.has(texture.uuid)) return;
        const data = texture.source?.data ?? texture.image;
        const images = Array.isArray(data) ? data : [data];
        let bytes = 0;
        for (const image of images) {
          const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
          const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
          if (width && height) bytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
        }
        textures.set(texture.uuid, Math.round(bytes));
      };
      scene.traverseVisible((object) => {
        if (!object.isMesh && !object.isPoints && !object.isLine) return;
        meshes += 1;
        if (object.geometry) {
          geometries.add(object.geometry.uuid);
          const count = object.geometry.index?.count || object.geometry.attributes?.position?.count || 0;
          const copies = object.isInstancedMesh ? object.count : 1;
          if (object.isMesh) visibleSceneTriangles += Math.floor(count / 3) * copies;
        }
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const value of Object.values(material)) rememberTexture(value);
        }
      });
      const estimatedTextureBytes = [...textures.values()].reduce((sum, value) => sum + value, 0);
      return {
        elapsedMs,
        frames: deltas.length,
        avgFps: +(1000 / avg).toFixed(2),
        low1Fps: +(1000 / lowWindowMs).toFixed(2),
        avgFrameMs: +avg.toFixed(3),
        worstFrameMs: deltas.length ? +deltas[deltas.length - 1].toFixed(3) : null,
        p95FrameMs: deltas.length ? +deltas[Math.floor((deltas.length - 1) * 0.95)].toFixed(3) : null,
        framesOver33ms: deltas.filter((value) => value > 33.334).length,
        actualGlDrawCallsPerFrame: +drawAvg('calls').toFixed(2),
        maxGlDrawCallsInFrame: drawMax('calls'),
        actualGlTrianglesPerFrame: Math.round(drawAvg('triangles')),
        maxGlTrianglesInFrame: drawMax('triangles'),
        drawProbeFrames: drawFrames.length,
        visibleSceneMeshes: meshes,
        visibleSceneGeometries: geometries.size,
        visibleSceneTriangles: Math.round(visibleSceneTriangles),
        visibleSceneMaterials: materials.size,
        visibleSceneTextures: textures.size,
        estimatedVisibleTextureBytesRGBA8: estimatedTextureBytes,
        rendererGeometriesInMemory: renderer.info.memory.geometries,
        rendererTexturesInMemory: renderer.info.memory.textures,
        rendererProgramsInMemory: renderer.info.programs?.length ?? null,
        uiMutationRecords: metric.ui.records,
        uiMutationCallbacks: metric.ui.callbacks,
        uiMutationRecordsPerSecond: +(metric.ui.records / Math.max(0.001, elapsedMs / 1000)).toFixed(2),
        uiTargets: metric.ui.targets,
      };
    });
  }

  async function measure(name) {
    await page.waitForTimeout(900);
    await collectGarbage();
    const countersBefore = await domCounters();
    await startMeasurement();
    await page.waitForTimeout(sampleMs);
    const browser = await stopMeasurement();
    await collectGarbage();
    const countersAfter = await domCounters();
    return { name, sampleMs, ...browser, countersBefore, countersAfter };
  }

  const captures = [];
  async function capture(fileName, boxId, note, cameraName) {
    const filePath = path.join(out, fileName);
    await page.screenshot({ path: filePath });
    const actualCamera = await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      return {
        x: +(walk.x - origin.x).toFixed(3),
        z: +(walk.z - origin.z).toFixed(3),
        yaw: +walk.yaw.toFixed(4),
        pitch: +walk.pitch.toFixed(4),
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
      };
    });
    const visual = boxId == null ? null : await page.evaluate((id) => {
      const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`);
      if (!root) return null;
      const products = [];
      root.updateWorldMatrix(true, true);
      root.traverse((object) => {
        if (!object.name?.startsWith('BOX_CONTENT_')) return;
        const world = object.getWorldPosition({
          x: 0, y: 0, z: 0,
          set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
          setFromMatrixPosition(matrix) {
            const elements = matrix.elements;
            this.x = elements[12]; this.y = elements[13]; this.z = elements[14];
            return this;
          },
        });
        products.push({ name: object.name, visible: object.visible, worldY: +world.y.toFixed(3) });
      });
      return {
        productsTotal: products.length,
        productsVisible: products.filter((product) => product.visible).length,
        products,
      };
    }, boxId);
    captures.push({
      file: filePath,
      note,
      camera: cameraName,
      actualCamera,
      visual,
      focus: await focusInfo(),
      box: boxId == null ? null : await boxSnapshot(boxId),
    });
    fs.writeFileSync(path.join(out, 'run-state.json'), JSON.stringify({
      status: 'running', phase, iteration, captures, updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  // Warm one complete production lifecycle before the comparable baseline so
  // first-use GL uploads and late fixture replacement are outside the leak gate.
  await runCompactNormalCycle(0, true, heroQty);
  await page.waitForTimeout(3000);
  await waitForStableScene();
  const hero = await stageHero({ orderId: heroOrderId, qty: heroQty, resetDelivery: true });
  const assets = await assetContract(hero.id);
  await setCamera(cameras.box);
  await waitForFocus(/tear the tape open/i);
  await capture('01-sealed.png', hero.id, 'Sealed medium apparel carton; the focus prompt offers the first press and there is no tool to equip.', 'box');

  const performance = {};
  performance.preCycle = await measure('identical-sealed-hero-before-cycles');

  // THE HEADLINE: three E presses open the carton with no tool. One state read
  // per press, shaped like tools/qa/proshop-box-open-loop.js, which owns the
  // gesture contract.
  const pressSteps = [];

  // Press one: tear the tape (the wide flap pair swings on the same press).
  await waitForFocus(/tear the tape open/i);
  const beforeTear = await pressState(hero.id);
  await page.keyboard.press('e');
  await waitForBox(hero.id, 'cut', 4000);
  await capture('02-tape-press.png', hero.id,
    'The first E press tears every authored seam segment in one motion — no tool is equipped.', 'box');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[2] || 0) > 0.25;
  }, hero.id, { timeout: 4000 });
  await capture('03-wide-pair-opening.png', hero.id,
    'The same first press swings the wide facing flap pair on its authored hinges.', 'box');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[2] || 0) >= 0.999 && (box?.flapProgress?.[3] || 0) >= 0.999;
  }, hero.id, { timeout: 4000 });
  const afterTear = await pressState(hero.id);
  pressSteps.push({
    press: 1,
    promptBefore: beforeTear.label,
    tool: beforeTear.tool,
    tapeCutAfter: afterTear.tapeCut,
    flapsOpenAfter: afterTear.flapsOpen,
    tookSomething: afterTear.carried > beforeTear.carried,
  });
  await capture('04-wide-pair-open.png', hero.id,
    'Press one complete: tape torn and the wide pair open; the narrow pair still closes the carton.', 'box');

  // Press two: fold the other flap pair open.
  await setCamera(cameras.boxOpen);
  await waitForFocus(/open the other flap/i);
  const beforeFlap = await pressState(hero.id);
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[0] || 0) > 0.25;
  }, hero.id, { timeout: 4000 });
  await capture('05-other-flap-press.png', hero.id, 'The second E press folds the narrow flap pair on its authored hinges.', 'boxOpen');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[0] || 0) > 0.78;
  }, hero.id, { timeout: 4000 });
  await capture('05b-narrow-pair-opening.png', hero.id, 'The narrow pair clears the packed contents as the second press finishes.', 'boxOpen');
  await waitForBox(hero.id, 'open', 4000);
  const afterFlap = await pressState(hero.id);
  pressSteps.push({
    press: 2,
    promptBefore: beforeFlap.label,
    tool: beforeFlap.tool,
    tapeCutAfter: afterFlap.tapeCut,
    flapsOpenAfter: afterFlap.flapsOpen,
    tookSomething: afterFlap.carried > beforeFlap.carried,
  });
  await setCamera(cameras.boxOpen);
  await capture('06-open-full-contents.png', hero.id, 'Open carton with actual folded catalog products, tissue, inserts, and tags visible.', 'boxOpen');

  // Press three: take an armful. The production eight-unit carton and
  // two-garment apparel armful expose the complete honest sequence:
  // 8 -> 6 -> 4 -> 2 -> 0. Every take and stock is a normal E action; no
  // quantity is injected between captures.
  await waitForFocus(/take an armful/i);
  const beforeTake = await pressState(hero.id);
  await page.keyboard.press('e');
  await waitForBox(hero.id, 'qty:6');
  await waitCarry(2);
  const afterTake = await pressState(hero.id);
  pressSteps.push({
    press: 3,
    promptBefore: beforeTake.label,
    tool: beforeTake.tool,
    tapeCutAfter: afterTake.tapeCut,
    flapsOpenAfter: afterTake.flapsOpen,
    tookSomething: afterTake.carried > beforeTake.carried,
  });
  await capture('07-three-quarter-and-carried-armful.png', hero.id, 'First two-garment armful leaves the real carton at three-quarter fill.', 'boxOpen');
  await stockCurrentArmful();
  await capture('08-first-armful-stocked.png', hero.id, 'First armful lands on the real apparel table through the normal hold-E stock path.', 'apparelTable');

  await setCamera(cameras.boxOpen);
  await waitForFocus(/Club polo.*take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(hero.id, 'qty:4');
  await waitCarry(2);
  await capture('09-half-and-carried-armful.png', hero.id, 'Second two-garment armful exposes the half-full content band.', 'boxOpen');
  await stockCurrentArmful();

  await setCamera(cameras.boxOpen);
  await waitForFocus(/Club polo.*take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(hero.id, 'qty:2');
  await waitCarry(2);
  await capture('10-low-and-carried-armful.png', hero.id, 'Third two-garment armful exposes the low-content visual band.', 'boxOpen');
  await stockCurrentArmful();

  await setCamera(cameras.boxOpen);
  await waitForFocus(/Club polo.*take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(hero.id, 'qty:0');
  await waitCarry(2);
  await capture('11-empty-with-final-armful.png', hero.id, 'The fourth and final two products are in the arms; the carton remains physically empty.', 'boxOpen');
  await stockCurrentArmful();
  await setCamera(cameras.boxOpen);
  await waitForFocus(/Empty Club polo box.*flatten/i);
  await capture('12-empty.png', hero.id, 'Empty carton persists after all eight products have been stocked.', 'boxOpen');

  await page.waitForTimeout(2200); // clear the final-armful status before the flatten proof
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flattenProgress || 0) >= 0.52 && (box?.flattenProgress || 0) < 0.92;
  }, hero.id, { timeout: 2500 });
  await capture('13-flattening.png', hero.id, 'Walls and flaps partway through the authored flattening animation.', 'boxOpen');
  await waitForBox(hero.id, 'flat', 4000);
  await page.waitForTimeout(3000);
  await capture('14-flattened.png', hero.id, 'Carton is fully folded flat and remains a world prop.', 'boxOpen');

  await page.keyboard.press('e');
  await waitForBox(hero.id, 'loc:carried');
  await capture('15-flattened-carried.png', hero.id, 'Flattened cardboard is carried at full authored scale.', 'boxOpen');
  const recyclingFocus = await chooseRecyclingFocus();
  await capture('16-recycling-ready.png', hero.id, 'Flattened carton held at the physical recycling-bin interaction.', 'recycling');
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${boxId}`);
    return !!box && box.loc === 'carried' && !!root && root.position.y < -0.58;
  }, hero.id, { timeout: 2500 });
  await capture('16b-recycling-drop.png', hero.id, 'Flattened bundle visibly descends into the authored recycling station.', 'recycling');
  await waitForBox(hero.id, 'gone', 4000);
  await page.waitForTimeout(3000);
  await capture('17-discarded.png', hero.id, 'Carton is gone only after the normal recycling-bin action.', 'recycling');

  const mainRoute = await page.evaluate(() => ({
    shelf: window.__fw.state.shop.inventory.polo1.shelf,
    back: window.__fw.state.shop.inventory.polo1.back,
    carry: window.__fw.state.shop.carry,
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
  }));

  async function runCompactNormalCycle(index, resetDelivery = index === 1, units = 1) {
    const orderId = 920000 + index;
    const staged = await stageHero({ orderId, qty: units, resetDelivery });
    await setCamera(cameras.box);
    await openCartonByPresses(staged.id);
    let remaining = units;
    while (remaining > 0) {
      await waitForFocus(/take an armful/i);
      await page.keyboard.press('e');
      const carried = Math.min(2, remaining);
      remaining -= carried;
      await waitForBox(staged.id, `qty:${remaining}`);
      await waitCarry(carried);
      await stockCurrentArmful();
      if (remaining > 0) {
        await setCamera(cameras.boxOpen);
        await waitForFocus(/Club polo.*take an armful/i);
      }
    }
    await setCamera(cameras.boxOpen);
    await waitForFocus(/Empty Club polo box.*flatten/i);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'flat', 4000);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'loc:carried');
    await chooseRecyclingFocus();
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'gone', 4000);
    return { index, orderId, recycled: true };
  }

  await collectGarbage();
  const countersBeforeStress = await domCounters();
  const stressCycles = [];
  for (let index = 1; index <= 20; index += 1) stressCycles.push(await runCompactNormalCycle(index));
  const stressState = await page.evaluate(() => ({
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
    carry: window.__fw.state.shop.carry,
  }));
  await collectGarbage();
  const countersAfterStress = await domCounters();

  // Recreate the byte-for-byte fixture state and camera used by preCycle. Any
  // retained views/listeners/resources now show up as post-twenty-cycle growth.
  const postHero = await stageHero({ orderId: heroOrderId, qty: heroQty, resetDelivery: true });
  await setCamera(cameras.box);
  await waitForFocus(/tear the tape open/i);
  await waitForStableScene();
  performance.postTwentyCycles = await measure('identical-sealed-hero-after-20-normal-cycles');
  await capture('18-post-20-cycles-identical-sealed.png', postHero.id,
    'Identical sealed fixture after twenty full normal-control press-open lifecycle cycles.', 'box');

  const qualityContract = await page.evaluate(() => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const size = renderer.getSize({ set(x, y) { this.x = x; this.y = y; return this; } });
    return {
      userAgent: navigator.userAgent,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'masked',
      rendererPixelRatio: renderer.getPixelRatio(),
      rendererWidth: size.x,
      rendererHeight: size.y,
      gtao: scene3d.post?.gtao?.enabled ?? null,
      bloom: scene3d.post?.bloom?.enabled ?? null,
      clockMinutes: window.__fw.state.clock.minutes,
      speedIndex: window.__fw.speedIdx,
    };
  });

  function numericDelta(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) return { before, after, absolute: null, percent: null };
    const absolute = after - before;
    return {
      before,
      after,
      absolute: +absolute.toFixed(3),
      percent: before === 0 ? null : +((absolute / before) * 100).toFixed(2),
    };
  }

  const comparableMetrics = [
    'avgFps', 'low1Fps', 'avgFrameMs', 'worstFrameMs',
    'actualGlDrawCallsPerFrame', 'actualGlTrianglesPerFrame',
    'visibleSceneMaterials', 'visibleSceneTextures', 'estimatedVisibleTextureBytesRGBA8',
    'rendererGeometriesInMemory', 'rendererTexturesInMemory', 'rendererProgramsInMemory',
    'uiMutationRecordsPerSecond',
  ];
  const postCycleGrowth = Object.fromEntries(comparableMetrics.map((key) => [
    key,
    numericDelta(performance.preCycle[key], performance.postTwentyCycles[key]),
  ]));
  postCycleGrowth.jsHeapUsedBytes = numericDelta(
    performance.preCycle.countersAfter.jsHeapUsedBytes,
    performance.postTwentyCycles.countersAfter.jsHeapUsedBytes,
  );
  postCycleGrowth.jsEventListeners = numericDelta(
    performance.preCycle.countersAfter.jsEventListeners,
    performance.postTwentyCycles.countersAfter.jsEventListeners,
  );

  const worstFrameAllowance = Math.max(2, performance.preCycle.worstFrameMs * 0.15);
  const regressionGate = {
    avgFps: performance.postTwentyCycles.avgFps >= performance.preCycle.avgFps * 0.95,
    low1Fps: performance.postTwentyCycles.low1Fps >= performance.preCycle.low1Fps * 0.90,
    worstFrameMs: performance.postTwentyCycles.worstFrameMs <= performance.preCycle.worstFrameMs + worstFrameAllowance,
    drawCalls: performance.postTwentyCycles.actualGlDrawCallsPerFrame <= performance.preCycle.actualGlDrawCallsPerFrame + 10,
    triangles: performance.postTwentyCycles.actualGlTrianglesPerFrame <= performance.preCycle.actualGlTrianglesPerFrame * 1.15,
    textureMemory: performance.postTwentyCycles.estimatedVisibleTextureBytesRGBA8
      <= performance.preCycle.estimatedVisibleTextureBytesRGBA8 + 16 * 1024 * 1024,
    heap: postCycleGrowth.jsHeapUsedBytes.absolute <= 8 * 1024 * 1024,
    listeners: postCycleGrowth.jsEventListeners.absolute <= 0,
  };

  const assertions = {
    viewport1600x900Dpr1: viewportContract.innerWidth === 1600 && viewportContract.innerHeight === 900 && viewportContract.devicePixelRatio === 1,
    authoredAssets: assets.authoredBox && assets.authoredRecycling && assets.flatBundle
      && assets.fourFlaps && assets.fourWalls
      && assets.contentSlots === 8 && assets.actualProducts === 8 && assets.tapeSegments >= 10 && assets.shippingLabel,
    // THE HEADLINE, asserted (shape from tools/qa/proshop-box-open-loop.js):
    // three presses open the carton, no tool is required, each press names
    // itself, and each press moves exactly one mechanical thing.
    threePresses: pressSteps.length === 3 && pressSteps[2].tookSomething === true,
    noToolRequired: pressSteps.length === 3
      && pressSteps.every((step) => step.tool === null)
      && captures.every((entry) => (entry.focus?.tool ?? null) === null),
    promptNamesEachStep: pressSteps.length === 3
      && /tear the tape/i.test(pressSteps[0].promptBefore || '')
      && /other flap/i.test(pressSteps[1].promptBefore || '')
      && /armful/i.test(pressSteps[2].promptBefore || ''),
    oneStepPerPress: pressSteps.length === 3
      && pressSteps[0].tapeCutAfter === true && pressSteps[0].flapsOpenAfter === false
      && pressSteps[1].flapsOpenAfter === true && pressSteps[1].tookSomething === false,
    quantityVisuals: [
      ['06-open-full-contents.png', 8],
      ['07-three-quarter-and-carried-armful.png', 6],
      ['09-half-and-carried-armful.png', 4],
      ['10-low-and-carried-armful.png', 2],
      ['11-empty-with-final-armful.png', 0],
    ].every(([file, expected]) => captures.find((entry) => entry.file.endsWith(file))?.visual?.productsVisible === expected),
    pointerLockHeldThroughout: captures.every((entry) => entry.actualCamera.pointerLocked),
    mainRouteConservedUnits: mainRoute.shelf === heroQty && mainRoute.back === 0 && !mainRoute.carry,
    mainRouteDisposedExactlyOnce: mainRoute.liveBoxes === 0 && mainRoute.recycled === 1 && mainRoute.trash === 0,
    twentySequentialPressCyclesDisposed: stressCycles.length === 20
      && stressCycles.every((cycle) => cycle.recycled)
      && stressState.liveBoxes === 0 && stressState.recycled === 20
      && stressState.trash === 0 && !stressState.carry,
    noListenerGrowthAfterTwentyCycles: countersAfterStress.jsEventListeners <= countersBeforeStress.jsEventListeners,
    performanceRegressionGate: Object.values(regressionGate).every(Boolean),
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    noFailedRequestsDuringProbe: diagnosticCounts.requestFailed === 0,
  };

  const metricSources = {
    frameTime: 'requestAnimationFrame deltas in milliseconds; five settling frames removed; 1% low uses mean of slowest 1% frame times.',
    drawCallsAndTriangles: 'Actual WebGL drawArrays/drawElements/instanced calls across all passes, wrapped once at the context; renderer.info is neither read nor reset.',
    sceneResources: 'THREE.Scene.traverseVisible UUID census; visible triangles are geometry indices/positions times instance count.',
    textureMemory: 'Estimated visible RGBA8 source bytes with a 4/3 mip factor when generateMipmaps is enabled; actual driver/GPU allocation is unavailable and therefore explicitly unmeasured.',
    heapAndListeners: 'Chrome DevTools Protocol HeapProfiler.collectGarbage, Performance.getMetrics, and Memory.getDOMCounters; retained bytes and active JS event-listener count.',
    uiFrequency: 'MutationObserver records per second for the available shop prompt/topbar/HUD/toast nodes.',
  };

  let crossPhaseComparison = null;
  if (phase === 'after') {
    const beforePath = path.join(repo, 'qa', 'box_system_master', 'hero_apparel', 'before', iterationName, 'result.json');
    if (fs.existsSync(beforePath)) {
      const beforeResult = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
      const compareScenario = (beforeMetric, afterMetric) => {
        if (!beforeMetric || !afterMetric) return null;
        const compared = Object.fromEntries(comparableMetrics.map((key) => [key, numericDelta(beforeMetric[key], afterMetric[key])]));
        compared.jsHeapUsedBytes = numericDelta(beforeMetric.countersAfter?.jsHeapUsedBytes, afterMetric.countersAfter?.jsHeapUsedBytes);
        compared.jsEventListeners = numericDelta(beforeMetric.countersAfter?.jsEventListeners, afterMetric.countersAfter?.jsEventListeners);
        return compared;
      };
      crossPhaseComparison = {
        beforeResult: beforePath,
        identicalSealedPreCycle: compareScenario(beforeResult.performance?.preCycle, performance.preCycle),
        identicalSealedPostTwentyCycles: compareScenario(
          beforeResult.performance?.postTwentyCycles || beforeResult.performance?.postTenCycles,
          performance.postTwentyCycles,
        ),
      };
    }
  }

  const result = {
    ok: Object.values(assertions).every(Boolean),
    phase,
    iteration,
    outputDirectory: out,
    launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/hero-apparel-box-qa.js --bootstrap',
    viewportContract,
    qualityContract,
    fixedCameras: cameras,
    heroFixture: { skuId: 'polo1', orderId: heroOrderId, qty: heroQty, boxKind: 'apparel', spot: heroSpot },
    assets,
    captures,
    mainPressFlow: { presses: pressSteps.length, steps: pressSteps },
    mainRoute,
    recyclingFocus,
    stress: { cycles: stressCycles, state: stressState, countersBefore: countersBeforeStress, countersAfter: countersAfterStress },
    performance,
    postCycleGrowth,
    regressionGate,
    crossPhaseComparison,
    metricSources,
    regressionGateThresholds: {
      avgFps: 'no more than 5% lower',
      low1Fps: 'no more than 10% lower',
      worstFrameMs: 'no more than 2 ms or 15% higher, whichever is larger',
      drawCalls: 'no more than 10 additional actual GL calls per frame',
      triangles: 'no more than 15% higher unless the reviewed authored silhouette requires it',
      textureMemory: 'no more than 16 MiB additional estimated visible RGBA8 source memory',
      heapAfterTwentyCycles: 'no more than 8 MiB growth',
      listenersAfterTwentyCycles: 'zero growth',
      uiUpdates: 'no new continuous static-scene mutations',
    },
    unmeasured: [
      'Actual driver/GPU texture allocation bytes (the result reports a labeled RGBA8 source estimate and renderer texture count).',
      'Audio waveform quality (functional playback belongs in the final recorded-gameplay review).',
    ],
    assertions,
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
    status: result.ok ? 'passed' : 'failed', phase, iteration, result: path.join(out, 'result.json'),
    captures: captures.map((entry) => entry.file), updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return result;
}
