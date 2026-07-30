async (page) => {
  // Reference-46 generic merchandise carton production probe.
  //
  // The documented fixture below establishes one repeatable delivery and fixed
  // player-camera poses. Every lifecycle transition after staging is exercised
  // through the game's normal pointer/keyboard path: three E presses open the
  // carton (press one tears the tape and swings the wide flap pair, press two
  // folds the other pair, press three takes an armful), tap E to
  // flatten/carry/recycle, and hold E at the Hat tree to stock.
  // The script also proves the authored reference-50 tape roll in its real
  // packing-bench context and records a matched pre/post three-cycle profile.
  // (Ported off the box-cutter equip 2026-07-30 — cartons tear on a press;
  // proshop-box-open-loop.js owns the gesture contract.)

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const sampleMs = Math.max(2000, Number.parseInt(process.env.BOX_QA_SAMPLE_MS || '5000', 10));
  // Default output is the fixed production evidence path. Asset authors may
  // opt into a disposable candidate pass while Blender revisions are active.
  const phase = process.env.GENERIC_BOX_QA_CANDIDATE === '1' ? 'candidate' : 'after';
  const iteration = 1;

  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const iterationName = `iteration-${String(iteration).padStart(2, '0')}`;
  const out = path.join(repo, 'qa', 'box_system_master', 'generic_merchandise', phase, iterationName);
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
    hatWall: { x: -3.4, z: -0.10, yaw: 0, pitch: -0.24 },
    packingBench: { x: 6.9, z: 0.28, yaw: 0, pitch: -0.52 },
    recycling: { x: 9.05, z: 1.3, yaw: -Math.PI / 2, pitch: -0.40 },
  });
  // Clean working aisle beside the stockroom packing bench: label faces the
  // player, the top seam is unobstructed, and no dressing carton shares frame.
  const fixtureSpot = Object.freeze({ x: 8.25, z: -1.7, ry: 0 });
  const fixtureOrderId = 930046;
  const fixtureQty = 8; // production case: four honest two-cap armfuls expose 8 -> 6 -> 4 -> 2 -> 0.

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
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
      const D = await import('/src/sim/deliveries.js');
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
        skuId: box.skuId,
        boxKind: box.box,
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
      return qty === 0 ? !carry : !!carry && carry.skuId === 'cap1' && carry.qty === qty;
    }, expectedQty, { timeout });
  }

  async function stageGeneric({ orderId, qty, resetDelivery }) {
    const staged = await page.evaluate(async ({ orderId: id, qty: units, spot, reset }) => {
      const D = await import('/src/sim/deliveries.js');
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
      state.shop.inventory.cap1.shelf = 0;
      state.shop.inventory.cap1.back = 0;
      if (state.shop.reno) {
        state.shop.reno.grime.fill(0);
        state.shop.reno.clutter = [];
      }
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }
      const manifest = {
        supplierId: 'willow-creek-merchandise-qa',
        supplier: 'Willow Creek Merchandise',
        boxes: [{ kind: 'merchbox', qty: units, w: 0.60, h: 0.40, d: 0.40, lb: +(units * 0.25).toFixed(2), fragile: false }],
        boxCount: 1,
        weight: +(units * 0.25).toFixed(2),
        fee: 9,
      };
      const [box] = D.arriveOrder(state, { id, skuId: 'cap1', qty: units, manifest });
      if (!box) throw new Error(`Fixture failed to create order ${id}.`);
      D.pickUpBox(state, box.id);
      D.putDownBox(state, box.id, spot);
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.rebuildReno?.();
      clubhouse.refreshCondition?.();
      clubhouse.rebuildStock?.();
      clubhouse.rebuildBoxes();
      const B = await import('/src/data/boxes.js');
      const V = await import('/src/render3d/clubhouse/deliveryBoxVisual.js');
      return {
        id: box.id,
        orderId: id,
        skuId: box.skuId,
        qty: box.qty,
        cap: box.cap,
        boxKind: box.box,
        dimensions: B.boxDims(box.box),
        model: V.DELIVERY_MODEL_BY_BOX_KIND[box.box] || null,
      };
    }, { orderId, qty, spot: fixtureSpot, reset: resetDelivery });

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
      let authoredAssetMetadata = null;
      root?.traverse((object) => {
        if (object.name) names.push(object.name);
        if (object.userData?.asset_id === 'delivery_generic_merchandise_box') authoredAssetMetadata = { ...object.userData };
      });
      const requiredNodes = [
        'BOX_BASE',
        'BOX_WALL_FRONT', 'BOX_WALL_BACK', 'BOX_WALL_LEFT', 'BOX_WALL_RIGHT',
        'BOX_FLAP_FRONT', 'BOX_FLAP_BACK', 'BOX_FLAP_LEFT', 'BOX_FLAP_RIGHT',
        'FLAP_TOP_FRONT', 'FLAP_TOP_BACK', 'FLAP_TOP_LEFT', 'FLAP_TOP_RIGHT',
        'TAPE_CENTER', 'TAPE_SIDE_FRONT', 'TAPE_SIDE_BACK',
        'LABEL_MAIN', 'LABEL_SHIPPING', 'LABEL_DYNAMIC',
        'INSERT_BOTTOM', 'INSERT_SIDE_LEFT', 'INSERT_SIDE_RIGHT',
        'COLLISION_CLOSED', 'COLLISION_OPEN',
        'INTERACTION_TARGET', 'CUT_PATH', 'VOLUME_CONTENTS',
        'BOX_FLAT_BUNDLE', 'FLAT_PANEL_BASE', 'FLAT_PANEL_FRONT',
        'FLAT_PANEL_BACK', 'FLAT_PANEL_LEFT', 'FLAT_PANEL_RIGHT', 'FLAT_LABEL',
      ];
      const slots = Array.from({ length: 8 }, (_, index) => `CONTENT_SLOT_${String(index + 1).padStart(2, '0')}`);
      const slotMetadata = slots.map((name) => {
        const slot = root?.getObjectByName(name);
        return {
          name,
          exists: !!slot,
          allowedCategory: slot?.userData?.allowed_category ?? null,
          maxW: slot?.userData?.max_w ?? null,
          maxD: slot?.userData?.max_d ?? null,
          maxH: slot?.userData?.max_h ?? null,
          stackOrder: slot?.userData?.stack_order ?? null,
          visibilityThreshold: slot?.userData?.visibility_threshold ?? null,
          removalOrder: slot?.userData?.removal_order ?? null,
        };
      });
      const actualCapNames = names.filter((name) => /^BOX_CONTENT_\d{2}_cap1$/.test(name));
      return {
        authoredBox: !!root,
        authoredAssetRoot: !!root?.getObjectByName('delivery_generic_merchandise_box') || !!authoredAssetMetadata,
        authoredAssetMetadata,
        authoredRecycling: !!recycling,
        requiredNodes,
        missingRequiredNodes: requiredNodes.filter((name) => !root?.getObjectByName(name)),
        flatBundle: !!root?.getObjectByName('BOX_FLAT_BUNDLE'),
        fourFlaps: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_FLAP_${side}`)),
        fourWalls: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_WALL_${side}`)),
        contentSlots: names.filter((name) => name.startsWith('CONTENT_SLOT_')).length,
        slotMetadata,
        actualProducts: names.filter((name) => name.startsWith('BOX_CONTENT_')).length,
        actualCapProducts: actualCapNames.length,
        actualCapNames,
        tapeSegments: names.filter((name) => name.startsWith('TAPE_') && !name.includes('PEELED')).length,
        shippingLabel: names.some((name) => name.includes('LABEL_DYNAMIC') || name.includes('LABEL_SHIPPING')),
        sceneNames: names,
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
    await page.evaluate(() => { delete window.__genericBoxStableScene; });
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
      const prior = window.__genericBoxStableScene || { signature: '', repeats: 0 };
      window.__genericBoxStableScene = signature === prior.signature
        ? { signature, repeats: prior.repeats + 1 }
        : { signature, repeats: 0 };
      return window.__genericBoxStableScene.repeats >= 5;
    }, null, { timeout: 20000, polling: 250 });
  }

  async function stockCurrentArmful() {
    await setCamera(cameras.hatWall);
    await waitForFocus(/Hat tree.*hold \[E\] to stock/i);
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
    if (window.__genericBoxDrawProbe) return;
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
    window.__genericBoxDrawProbe = probe;
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
      window.__genericBoxDrawProbe.begin();
      requestAnimationFrame(tick);
      window.__genericBoxMetric = { ui, frame, startedAt: performance.now() };
    });
  }

  async function stopMeasurement() {
    return page.evaluate(() => {
      const metric = window.__genericBoxMetric;
      metric.frame.running = false;
      metric.ui.observers.forEach((observer) => observer.disconnect());
      const elapsedMs = performance.now() - metric.startedAt;
      const deltas = metric.frame.deltas.slice(5).sort((a, b) => a - b);
      const avg = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
      const worstCount = Math.max(1, Math.ceil(deltas.length * 0.01));
      const lowWindowMs = deltas.slice(-worstCount).reduce((sum, value) => sum + value, 0) / worstCount;
      const drawFrames = window.__genericBoxDrawProbe.end();
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

  const median = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  async function measureMatchedPair(name) {
    const runs = [];
    for (let index = 1; index <= 2; index += 1) {
      runs.push(await measure(`${name}-run-${index}`));
    }
    const aggregate = {
      name,
      methodology: 'Median of two consecutive matched fixed-camera samples; each run uses the same sampleMs and scene state.',
      sampleMs,
      runs,
    };
    for (const key of Object.keys(runs[0])) {
      if (runs.every((run) => Number.isFinite(run[key]))) aggregate[key] = median(runs.map((run) => run[key]));
    }
    const aggregateCounters = (key) => {
      const samples = runs.map((run) => run[key]);
      const combined = { source: samples[0].source };
      for (const field of Object.keys(samples[0])) {
        if (samples.every((entry) => Number.isFinite(entry[field]))) combined[field] = median(samples.map((entry) => entry[field]));
      }
      return combined;
    };
    aggregate.countersBefore = aggregateCounters('countersBefore');
    aggregate.countersAfter = aggregateCounters('countersAfter');
    aggregate.uiTargets = runs[runs.length - 1].uiTargets;
    return aggregate;
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
    const stockState = await page.evaluate(() => ({
      carry: window.__fw.state.shop.carry ? { ...window.__fw.state.shop.carry } : null,
      shelf: window.__fw.state.shop.inventory.cap1.shelf,
      back: window.__fw.state.shop.inventory.cap1.back,
    }));
    captures.push({
      file: filePath,
      note,
      camera: cameraName,
      actualCamera,
      visual,
      stockState,
      focus: await focusInfo(),
      box: boxId == null ? null : await boxSnapshot(boxId),
    });
    fs.writeFileSync(path.join(out, 'run-state.json'), JSON.stringify({
      status: 'running', phase, iteration, captures, updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  // Warm one complete production lifecycle and every evidence camera before
  // the comparable baseline. Three.js uploads a frustum-visible geometry on
  // first render, so visiting the packing bench only between the two samples
  // would incorrectly report its static authored props as retained cycle data.
  await runCompactNormalCycle(0, true, fixtureQty);
  await setCamera(cameras.packingBench);
  await page.waitForFunction(() => {
    const roll = window.__fw?.scene3d?.scene?.getObjectByName('PackingBenchTapeRoll');
    return !!roll?.getObjectByName?.('TAPE_WOUND');
  }, null, { timeout: 15000 });
  await waitForStableScene();
  await page.waitForTimeout(3000);
  const fixtureCase = await stageGeneric({ orderId: fixtureOrderId, qty: fixtureQty, resetDelivery: true });
  const assets = await assetContract(fixtureCase.id);
  await setCamera(cameras.box);
  await waitForFocus(/tear the tape open/i);
  await capture('01-sealed.png', fixtureCase.id, 'Sealed 0.60 x 0.40 x 0.40 m generic merchandise case at the clean stockroom fixture; the focus prompt offers the first press: tear the tape.', 'box');

  const performance = {};
  performance.preCycle = await measureMatchedPair('identical-sealed-generic-case-before-cycles');
  await waitForFocus(/tear the tape open/i);
  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'cut', 5000);
  await capture('02-tape-press.png', fixtureCase.id, 'The first E press tears the full segmented tape run in one motion — no tool is equipped.', 'box');

  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[2] || 0) > 0.25;
  }, fixtureCase.id, { timeout: 4000 });
  await capture('03-wide-pair-opening.png', fixtureCase.id, 'The same first press swings the wide facing flap pair on its authored hinges.', 'box');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[2] || 0) >= 0.999 && (box?.flapProgress?.[3] || 0) >= 0.999
      && (box?.flapProgress?.[0] || 0) < 0.001;
  }, fixtureCase.id, { timeout: 4000 });
  await capture('04-wide-pair-open.png', fixtureCase.id, 'Press one complete: tape torn and the wide pair open; the narrow pair still closes the carton.', 'box');

  await setCamera(cameras.boxOpen);
  await waitForFocus(/open the other flap/i);
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[0] || 0) > 0.25;
  }, fixtureCase.id, { timeout: 4000 });
  await capture('05-other-flap-press.png', fixtureCase.id, 'The second E press folds the narrow flap pair on its authored hinges.', 'boxOpen');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[0] || 0) > 0.78;
  }, fixtureCase.id, { timeout: 4000 });
  await capture('05b-narrow-pair-opening.png', fixtureCase.id, 'The narrow pair clears the packed contents as the second press finishes.', 'boxOpen');
  await waitForBox(fixtureCase.id, 'open', 4000);
  await setCamera(cameras.boxOpen);
  await capture('06-open-8-caps.png', fixtureCase.id, 'Open authored case with all eight actual Willow Creek cap proxies visible in their sockets.', 'boxOpen');

  // The production eight-unit carton and two-cap apparel armful expose the
  // complete honest sequence: 8 -> 6 -> 4 -> 2 -> 0. The third press takes an
  // armful; every take and stock is a normal E action and no quantity is
  // injected between captures.
  await waitForFocus(/take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'qty:6');
  await waitCarry(2);
  await capture('07-qty-6-carried-two-caps.png', fixtureCase.id, 'First real two-cap armful leaves six actual cap proxies in the carton.', 'boxOpen');
  await stockCurrentArmful();
  await capture('08-first-two-caps-stocked.png', fixtureCase.id, 'First armful lands on the real Hat tree through the normal hold-E stock path.', 'hatWall');

  await setCamera(cameras.boxOpen);
  await waitForFocus(/Willow Creek cap.*take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'qty:4');
  await waitCarry(2);
  await capture('09-qty-4-carried-two-caps.png', fixtureCase.id, 'Second real two-cap armful exposes the half-full content band.', 'boxOpen');
  await stockCurrentArmful();
  await capture('10-second-two-caps-stocked.png', fixtureCase.id, 'Second armful is stocked on the Hat tree through normal controls.', 'hatWall');

  await setCamera(cameras.boxOpen);
  await waitForFocus(/Willow Creek cap.*take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'qty:2');
  await waitCarry(2);
  await capture('11-qty-2-carried-two-caps.png', fixtureCase.id, 'Third real two-cap armful leaves only two cap proxies in the authored sockets.', 'boxOpen');
  await stockCurrentArmful();
  await capture('12-third-two-caps-stocked.png', fixtureCase.id, 'Third armful is stocked on the Hat tree through normal controls.', 'hatWall');

  await setCamera(cameras.boxOpen);
  await waitForFocus(/Willow Creek cap.*take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'qty:0');
  await waitCarry(2);
  await capture('13-qty-0-carried-final-two-caps.png', fixtureCase.id, 'The final two cap products are carried while the carton honestly shows zero contents.', 'boxOpen');
  await stockCurrentArmful();
  await capture('14-final-two-caps-stocked.png', fixtureCase.id, 'All eight caps are now stocked on the real Hat tree through four normal hold-E actions.', 'hatWall');
  await setCamera(cameras.boxOpen);
  await waitForFocus(/Empty Willow Creek cap box.*flatten/i);
  await capture('15-empty.png', fixtureCase.id, 'Empty generic merchandise carton persists after all eight caps have been stocked.', 'boxOpen');

  await page.waitForTimeout(2200); // clear the final-armful status before the flatten proof
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flattenProgress || 0) >= 0.52 && (box?.flattenProgress || 0) < 0.92;
  }, fixtureCase.id, { timeout: 2500 });
  await capture('16-flattening.png', fixtureCase.id, 'Walls and flaps partway through the authored flattening animation.', 'boxOpen');
  await waitForBox(fixtureCase.id, 'flat', 4000);
  await page.waitForTimeout(3000);
  await capture('17-flattened.png', fixtureCase.id, 'Generic merchandise carton is fully folded flat and remains a world prop.', 'boxOpen');

  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'loc:carried');
  await capture('18-flattened-carried.png', fixtureCase.id, 'Flattened cardboard is carried at full authored scale.', 'boxOpen');
  const recyclingFocus = await chooseRecyclingFocus();
  await capture('19-recycling-ready.png', fixtureCase.id, 'Flattened generic carton held at the physical recycling-bin interaction.', 'recycling');
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${boxId}`);
    return !!box && box.loc === 'carried' && !!root && root.position.y < -0.58;
  }, fixtureCase.id, { timeout: 2500 });
  await capture('20-recycling-drop.png', fixtureCase.id, 'Flattened bundle visibly descends into the authored recycling station.', 'recycling');
  await waitForBox(fixtureCase.id, 'gone', 4000);
  await page.waitForTimeout(3000);
  await capture('21-recycled.png', fixtureCase.id, 'Carton is gone only after the normal recycling-bin action.', 'recycling');

  // Reference 50 is a stockroom prop, not a detached asset-preview turntable.
  // Prove the named authored roll is actually on the real packing bench and in
  // the fixed player camera's view before taking the dedicated evidence frame.
  await setCamera(cameras.packingBench);
  await page.waitForFunction(() => {
    const roll = window.__fw?.scene3d?.scene?.getObjectByName('PackingBenchTapeRoll');
    if (!roll) return false;
    const names = [];
    roll.traverse((object) => { if (object.name) names.push(object.name); });
    return roll.userData?.asset_id === 'delivery_packing_tape_roll'
      || names.includes('delivery_packing_tape_roll');
  }, null, { timeout: 15000 });
  const packingBenchTape = await page.evaluate(() => {
    const scene3d = window.__fw.scene3d;
    const roll = scene3d.scene.getObjectByName('PackingBenchTapeRoll');
    const names = [];
    roll?.traverse((object) => { if (object.name) names.push(object.name); });
    const assetRoot = roll.getObjectByName('delivery_packing_tape_roll') || roll;
    assetRoot.updateWorldMatrix(true, true);
    const rootInverse = assetRoot.matrixWorld.clone().invert();
    const localMin = [Infinity, Infinity, Infinity];
    const localMax = [-Infinity, -Infinity, -Infinity];
    assetRoot.traverse((object) => {
      if (!object.isMesh || object.name.startsWith('COL_')) return;
      object.geometry.computeBoundingBox?.();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const point = assetRoot.position.clone().set(x, y, z)
              .applyMatrix4(object.matrixWorld)
              .applyMatrix4(rootInverse);
            localMin[0] = Math.min(localMin[0], point.x);
            localMin[1] = Math.min(localMin[1], point.y);
            localMin[2] = Math.min(localMin[2], point.z);
            localMax[0] = Math.max(localMax[0], point.x);
            localMax[1] = Math.max(localMax[1], point.y);
            localMax[2] = Math.max(localMax[2], point.z);
          }
        }
      }
    });
    const localSize = localMax.map((value, index) => +(value - localMin[index]).toFixed(4));
    const world = roll.getWorldPosition(roll.position.clone());
    const ndc = world.clone().project(scene3d.camera);
    let visibleThroughParents = true;
    for (let node = roll; node; node = node.parent) visibleThroughParents = visibleThroughParents && node.visible;
    const required = [
      'delivery_packing_tape_roll', 'TAPE_WOUND', 'TAPE_CORE',
      'TAPE_LOOSE_END', 'COL_PACKING_TAPE', 'TAPE_GRIP_POINT',
    ];
    return {
      objectName: roll.name,
      authoredAssetRoot: roll.userData?.asset_id === 'delivery_packing_tape_roll'
        || names.includes('delivery_packing_tape_roll'),
      requiredNodes: required,
      missingRequiredNodes: required.filter((name) => !names.includes(name)),
      woundLayers: names.filter((name) => /^TAPE_LAYER_\d{2}$/.test(name)).length,
      corePrints: names.filter((name) => /^CORE_PRINT_\d{2}$/.test(name)).length,
      localAxisBounds: {
        min: localMin.map((value) => +value.toFixed(4)),
        max: localMax.map((value) => +value.toFixed(4)),
        size: { x: localSize[0], y: localSize[1], z: localSize[2] },
        contract: 'X/Y are the ~10 cm roll diameter; Z is the ~5 cm axial width.',
      },
      world: { x: +world.x.toFixed(3), y: +world.y.toFixed(3), z: +world.z.toFixed(3) },
      ndc: { x: +ndc.x.toFixed(3), y: +ndc.y.toFixed(3), z: +ndc.z.toFixed(3) },
      insidePlayerFrame: visibleThroughParents && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1,
      names,
    };
  });
  await capture('22-packing-bench-authored-tape-roll.png', null, 'Dedicated normal-player view proving PackingBenchTapeRoll uses delivery_packing_tape_roll on the real stockroom bench.', 'packingBench');

  const mainRoute = await page.evaluate(() => ({
    shelf: window.__fw.state.shop.inventory.cap1.shelf,
    back: window.__fw.state.shop.inventory.cap1.back,
    carry: window.__fw.state.shop.carry,
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
  }));

  async function runCompactNormalCycle(index, resetDelivery = index === 1, units = 1) {
    const orderId = 930100 + index;
    const staged = await stageGeneric({ orderId, qty: units, resetDelivery });
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
        await waitForFocus(/Willow Creek cap.*take an armful/i);
      }
    }
    await setCamera(cameras.boxOpen);
    await waitForFocus(/Empty Willow Creek cap box.*flatten/i);
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
  for (let index = 1; index <= 3; index += 1) stressCycles.push(await runCompactNormalCycle(index));
  const stressState = await page.evaluate(() => ({
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
    carry: window.__fw.state.shop.carry,
  }));
  await collectGarbage();
  const countersAfterStress = await domCounters();

  // Recreate the byte-for-byte fixture state and camera used by preCycle. Any
  // retained views/listeners/resources now show up as post-three-cycle growth.
  const postFixture = await stageGeneric({ orderId: fixtureOrderId, qty: fixtureQty, resetDelivery: true });
  await setCamera(cameras.box);
  await waitForFocus(/tear the tape open/i);
  await waitForStableScene();
  performance.postThreeCycles = await measureMatchedPair('identical-sealed-generic-case-after-3-normal-cycles');
  await capture('23-post-3-cycles-identical-sealed.png', postFixture.id, 'Matched sealed generic-case fixture after three full normal-control lifecycle cycles.', 'box');

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
    'visibleSceneGeometries', 'visibleSceneMaterials', 'visibleSceneTextures', 'estimatedVisibleTextureBytesRGBA8',
    'rendererGeometriesInMemory', 'rendererTexturesInMemory', 'rendererProgramsInMemory',
    'uiMutationRecordsPerSecond',
  ];
  const postCycleGrowth = Object.fromEntries(comparableMetrics.map((key) => [
    key,
    numericDelta(performance.preCycle[key], performance.postThreeCycles[key]),
  ]));
  postCycleGrowth.jsHeapUsedBytes = numericDelta(
    performance.preCycle.countersAfter.jsHeapUsedBytes,
    performance.postThreeCycles.countersAfter.jsHeapUsedBytes,
  );
  postCycleGrowth.jsEventListeners = numericDelta(
    performance.preCycle.countersAfter.jsEventListeners,
    performance.postThreeCycles.countersAfter.jsEventListeners,
  );

  const worstFrameAllowance = Math.max(2, performance.preCycle.worstFrameMs * 0.15);
  const regressionGate = {
    avgFps: performance.postThreeCycles.avgFps >= performance.preCycle.avgFps * 0.95,
    low1Fps: performance.postThreeCycles.low1Fps >= performance.preCycle.low1Fps * 0.90,
    worstFrameMs: performance.postThreeCycles.worstFrameMs <= performance.preCycle.worstFrameMs + worstFrameAllowance,
    drawCalls: performance.postThreeCycles.actualGlDrawCallsPerFrame <= performance.preCycle.actualGlDrawCallsPerFrame + 10,
    triangles: performance.postThreeCycles.actualGlTrianglesPerFrame <= performance.preCycle.actualGlTrianglesPerFrame * 1.15,
    textureMemory: performance.postThreeCycles.estimatedVisibleTextureBytesRGBA8
      <= performance.preCycle.estimatedVisibleTextureBytesRGBA8 + 16 * 1024 * 1024,
    visibleGeometries: performance.postThreeCycles.visibleSceneGeometries
      <= performance.preCycle.visibleSceneGeometries,
    rendererGeometries: performance.postThreeCycles.rendererGeometriesInMemory
      <= performance.preCycle.rendererGeometriesInMemory,
    rendererTextures: performance.postThreeCycles.rendererTexturesInMemory
      <= performance.preCycle.rendererTexturesInMemory,
    rendererPrograms: performance.postThreeCycles.rendererProgramsInMemory
      <= performance.preCycle.rendererProgramsInMemory,
    heap: postCycleGrowth.jsHeapUsedBytes.absolute <= 8 * 1024 * 1024,
    listeners: postCycleGrowth.jsEventListeners.absolute <= 0,
  };

  const assertions = {
    viewport1600x900Dpr1: viewportContract.innerWidth === 1600 && viewportContract.innerHeight === 900 && viewportContract.devicePixelRatio === 1,
    authoredAssets: assets.authoredBox && assets.authoredRecycling && assets.flatBundle
      && assets.authoredAssetRoot && assets.fourFlaps && assets.fourWalls
      && assets.missingRequiredNodes.length === 0
      && assets.contentSlots === 8 && assets.actualProducts === 8 && assets.actualCapProducts === 8
      && assets.slotMetadata.every((slot) => slot.exists && /^apparel(?::cap)?$/.test(slot.allowedCategory || '')
        && Number(slot.maxW) === 0.18 && Number(slot.maxD) === 0.16 && Number(slot.maxH) === 0.12
        && Number.isFinite(Number(slot.stackOrder)) && Number.isFinite(Number(slot.visibilityThreshold)) && Number.isFinite(Number(slot.removalOrder)))
      && assets.tapeSegments >= 10 && assets.shippingLabel,
    exactGenericFixtureContract: fixtureCase.skuId === 'cap1' && fixtureCase.boxKind === 'merchbox' && fixtureCase.qty === 8 && fixtureCase.cap === 8
      && fixtureCase.dimensions.w === 0.60 && fixtureCase.dimensions.h === 0.40 && fixtureCase.dimensions.d === 0.40
      && fixtureCase.model === 'delivery_generic_merchandise_box',
    packingBenchTapeVisible: packingBenchTape.objectName === 'PackingBenchTapeRoll'
      && packingBenchTape.authoredAssetRoot && packingBenchTape.missingRequiredNodes.length === 0
      && packingBenchTape.woundLayers === 4 && packingBenchTape.corePrints === 4 && packingBenchTape.insidePlayerFrame
      && Math.abs(packingBenchTape.localAxisBounds.size.x - 0.10) <= 0.004
      && packingBenchTape.localAxisBounds.size.y >= 0.10 && packingBenchTape.localAxisBounds.size.y <= 0.106
      && Math.abs(packingBenchTape.localAxisBounds.size.z - 0.05) <= 0.004,
    pressPromptOffered: /tear the tape/i.test(
      captures.find((entry) => entry.file.endsWith('01-sealed.png'))?.focus?.label || '',
    ),
    noToolInvolved: captures.length > 0
      && captures.every((entry) => (entry.focus?.tool ?? null) === null),
    quantityVisuals: [
      ['06-open-8-caps.png', 8],
      ['07-qty-6-carried-two-caps.png', 6],
      ['09-qty-4-carried-two-caps.png', 4],
      ['11-qty-2-carried-two-caps.png', 2],
      ['13-qty-0-carried-final-two-caps.png', 0],
    ].every(([file, expected]) => captures.find((entry) => entry.file.endsWith(file))?.visual?.productsVisible === expected),
    honestTwoCapArmfuls: [
      '07-qty-6-carried-two-caps.png',
      '09-qty-4-carried-two-caps.png',
      '11-qty-2-carried-two-caps.png',
      '13-qty-0-carried-final-two-caps.png',
    ].every((file) => {
      const carry = captures.find((entry) => entry.file.endsWith(file))?.stockState?.carry;
      return carry?.skuId === 'cap1' && carry.qty === 2;
    }),
    honestHatTreeStocking: [
      ['08-first-two-caps-stocked.png', 2],
      ['10-second-two-caps-stocked.png', 4],
      ['12-third-two-caps-stocked.png', 6],
      ['14-final-two-caps-stocked.png', 8],
    ].every(([file, expectedShelf]) => {
      const state = captures.find((entry) => entry.file.endsWith(file))?.stockState;
      return state && !state.carry && state.shelf === expectedShelf && state.back === 0;
    }),
    pointerLockHeldThroughout: captures.every((entry) => entry.actualCamera.pointerLocked),
    mainRouteConservedUnits: mainRoute.shelf === fixtureQty && mainRoute.back === 0 && !mainRoute.carry,
    mainRouteDisposedExactlyOnce: mainRoute.liveBoxes === 0 && mainRoute.recycled === 1 && mainRoute.trash === 0,
    threeStressCyclesDisposed: stressCycles.length === 3 && stressState.liveBoxes === 0 && stressState.recycled === 3 && stressState.trash === 0 && !stressState.carry,
    noListenerGrowthAfterThreeCycles: countersAfterStress.jsEventListeners <= countersBeforeStress.jsEventListeners,
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

  const result = {
    ok: Object.values(assertions).every(Boolean),
    phase,
    iteration,
    outputDirectory: out,
    launch: 'node tools/qa/run-playwright.cjs tools/qa/generic-merchandise-box-qa.js --bootstrap',
    viewportContract,
    qualityContract,
    fixedCameras: cameras,
    fixture: { skuId: 'cap1', orderId: fixtureOrderId, qty: fixtureQty, boxKind: 'merchbox', dimensions: { w: 0.60, h: 0.40, d: 0.40 }, spot: fixtureSpot },
    assets,
    packingBenchTape,
    captures,
    mainRoute,
    recyclingFocus,
    stress: { cycles: stressCycles, state: stressState, countersBefore: countersBeforeStress, countersAfter: countersAfterStress },
    performance,
    postCycleGrowth,
    regressionGate,
    metricSources,
    regressionGateThresholds: {
      avgFps: 'no more than 5% lower',
      low1Fps: 'no more than 10% lower',
      worstFrameMs: 'no more than 2 ms or 15% higher, whichever is larger',
      drawCalls: 'no more than 10 additional actual GL calls per frame',
      triangles: 'no more than 15% higher unless the reviewed authored silhouette requires it',
      textureMemory: 'no more than 16 MiB additional estimated visible RGBA8 source memory',
      visibleGeometries: 'zero growth at the identical sealed-case scene state',
      rendererGeometries: 'zero retained renderer-geometry growth after all evidence cameras are pre-warmed',
      rendererTextures: 'zero retained renderer-texture growth after all evidence cameras are pre-warmed',
      rendererPrograms: 'zero retained renderer-program growth after all lifecycle states and evidence cameras are pre-warmed',
      heapAfterThreeCycles: 'no more than 8 MiB growth',
      listenersAfterThreeCycles: 'zero growth',
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
