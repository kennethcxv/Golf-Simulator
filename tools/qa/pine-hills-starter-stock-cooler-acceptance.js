async (page) => {
  // Pine Hills furnished-start acceptance: all three conserved starter cartons,
  // every authored carton-to-fixture route, the six exact-once restock rewards,
  // a deliberate mid-restock pause-menu save/load, and the opening drinks
  // cooler's normal-control/manual-slot persistence contract.
  //
  // Run only through the repository lock-owning runner:
  //   node tools/qa/run-playwright.cjs tools/qa/pine-hills-starter-stock-cooler-acceptance.js --bootstrap
  //
  // DOCUMENTED QA FIXTURE BOUNDARY
  // --------------------------------
  // --bootstrap owns creation of the fresh relaxed empire (seed 424242) and
  // its first campaign property. This callback fixes only clock, weather,
  // simulation speed, organic walk-ins, and the player camera. It never edits
  // starter inventory, lots, cartons, tape, flaps, carry, shelf quantities, or
  // cooler door state. Every player-visible state transition uses keyboard or
  // mouse input. Direct camera positioning establishes repeatable approaches;
  // reads through imported simulation modules are diagnostics only.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const phaseName = String(process.env.PINE_HILLS_STOCK_PHASE || 'acceptance')
    .replace(/[^a-z0-9_-]+/gi, '-');
  const iteration = Math.max(
    1,
    Number.parseInt(process.env.PINE_HILLS_STOCK_ITERATION || '1', 10) || 1,
  );
  const out = path.resolve(
    repo,
    process.env.PINE_HILLS_STOCK_COOLER_OUT || path.join(
      'qa',
      'pine-hills-stock-cooler',
      phaseName,
      `iteration-${String(iteration).padStart(2, '0')}`,
    ),
  );
  const resultPath = path.resolve(process.env.QA_RESULT_PATH || path.join(out, 'result.json'));
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const viewport = Object.freeze({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const expectedStarterGroupIds = Object.freeze([
    'balls', 'accessories', 'headwear', 'apparel', 'cooler', 'snacks',
  ]);
  const diagnostics = [];
  const screenshots = [];
  const assertions = [];
  const inputTraceSegments = [];
  const blockers = [];
  let currentPhase = 'boot';
  let documentReady = false;
  let fixture = null;
  let cartonCensus = null;
  let inventoryBefore = null;
  let inventoryAfterCoolerPauseLoad = null;
  let inventoryAfter = null;
  let coolerRoute = null;
  let cartonRoute = null;
  let browserReady = false;
  let activeMediaCapture = null;
  const mediaCaptures = [];

  const relative = (file) => path.relative(repo, file).replaceAll('\\', '/');
  const errorRecord = (stage, error, evidence = null) => ({
    stage,
    message: error?.message || String(error),
    stack: error?.stack || null,
    evidence: evidence || error?.evidence || null,
  });
  const noteDiagnostic = (kind, message, extra = {}) => {
    if (diagnostics.length >= 300) return;
    diagnostics.push({
      phase: currentPhase,
      kind,
      message: String(message),
      atMs: Date.now(),
      ...extra,
    });
  };

  page.on('console', (message) => {
    if (message.type() === 'error') noteDiagnostic('console:error', message.text());
    if (message.type() === 'warning') noteDiagnostic('console:warning', message.text());
  });
  page.on('pageerror', (error) => noteDiagnostic('pageerror', error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (!documentReady && /ERR_ABORTED/i.test(failure)) return;
    noteDiagnostic('requestfailed', `${request.url()} (${failure})`, {
      url: request.url(),
      failure,
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      noteDiagnostic('response:error', `${response.url()} (HTTP ${response.status()})`, {
        url: response.url(),
        status: response.status(),
      });
    }
  });

  function check(id, condition, evidence = null) {
    const entry = { id, ok: !!condition, evidence };
    assertions.push(entry);
    return entry.ok;
  }

  function requireCheck(id, condition, message, evidence = null) {
    check(id, condition, evidence);
    if (condition) return;
    const error = new Error(message);
    error.evidence = evidence;
    throw error;
  }

  function writeRunState(status, extra = {}) {
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status,
      phase: currentPhase,
      iteration,
      screenshots: screenshots.map((entry) => entry.file),
      blockers,
      updatedAt: new Date().toISOString(),
      ...extra,
    }, null, 2)}\n`);
  }

  async function focusInfo() {
    return page.evaluate(() => {
      const app = window.__fw;
      const walk = app?.scene3d?.walk;
      const focus = walk?.getFocus?.();
      const prop = focus?.kind === 'prop' ? focus.prop : null;
      let nearestCartonId = null;
      let nearestCartonDistance = null;
      if (prop && app?.scene3d?.scene) {
        const Vector3 = app.scene3d.camera.position.constructor;
        const world = new Vector3();
        for (const box of app.state?.shop?.deliveries?.boxes || []) {
          const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${box.id}`)
            || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${box.id}`);
          if (!root) continue;
          root.getWorldPosition(world);
          const distance = Math.hypot((prop.x || 0) - world.x, (prop.z || 0) - world.z);
          if (nearestCartonDistance === null || distance < nearestCartonDistance) {
            nearestCartonDistance = distance;
            nearestCartonId = box.id;
          }
        }
      }
      return {
        label: walk?.getFocusLabel?.() || null,
        tool: walk?.getTool?.() || null,
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
        focusKind: focus?.kind || null,
        prop: prop ? {
          x: prop.x ?? null,
          y: prop.y ?? null,
          z: prop.z ?? null,
          radius: prop.r ?? null,
          aimY: prop.aimY ?? null,
        } : null,
        nearestCartonId,
        nearestCartonDistance,
      };
    });
  }

  async function capture(id, metadata = {}) {
    const file = path.join(out, `${id}.png`);
    await page.screenshot({ path: file });
    const entry = {
      id,
      file: relative(file),
      phase: currentPhase,
      focus: await focusInfo().catch(() => null),
      metadata,
    };
    screenshots.push(entry);
    writeRunState('running');
    return entry;
  }

  async function installInputTrace(label) {
    await page.evaluate((segmentLabel) => {
      const trace = {
        label: segmentLabel,
        keyDown: {},
        keyUp: {},
        pointerDown: 0,
        pointerUp: 0,
        heldLmbMoves: 0,
        lmbHeld: false,
      };
      const increment = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
      document.addEventListener('keydown', (event) => {
        increment(trace.keyDown, String(event.key || '').toLowerCase());
      }, true);
      document.addEventListener('keyup', (event) => {
        increment(trace.keyUp, String(event.key || '').toLowerCase());
      }, true);
      document.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        trace.pointerDown += 1;
        trace.lmbHeld = true;
      }, true);
      window.addEventListener('pointerup', (event) => {
        if (event.button !== 0) return;
        trace.pointerUp += 1;
        trace.lmbHeld = false;
      }, true);
      document.addEventListener('mousemove', () => {
        if (trace.lmbHeld) trace.heldLmbMoves += 1;
      }, true);
      window.__pineHillsStockInputTrace = trace;
    }, label);
  }

  async function collectInputTrace() {
    const trace = await page.evaluate(() => (
      window.__pineHillsStockInputTrace
        ? JSON.parse(JSON.stringify(window.__pineHillsStockInputTrace))
        : null
    )).catch(() => null);
    if (trace) inputTraceSegments.push(trace);
    return trace;
  }

  async function acquirePointerLock() {
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    await page.bringToFront();
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await canvas.click({
      position: { x: viewport.width / 2, y: viewport.height / 2 },
      force: true,
    });
    await page.waitForFunction(() => (
      document.pointerLockElement === document.querySelector('canvas')
    ), null, { timeout: 7000 });
  }

  async function waitForRuntime() {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, {
      timeout: 90000,
    });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || getComputedStyle(veil).display === 'none'
        || parseFloat(getComputedStyle(veil).opacity || '0') < 0.02;
    }, null, { timeout: 90000 });
    await page.evaluate(async () => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      await Promise.all([
        clubhouse.pineHillsInterior?.ready,
        clubhouse.assets51to100Runtime?.ready,
      ].filter(Boolean));
    });
    await page.waitForFunction(() => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      if (!clubhouse?.assetsReady?.()) return false;
      const starter = (app.state?.shop?.deliveries?.boxes || [])
        .filter((box) => box.starterRestockVersion === 1);
      if (starter.length !== 3) return false;
      const rootsReady = starter.every((box) => (
        app.scene3d.scene.getObjectByName(`DeliveryBox_${box.id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${box.id}`)
      ));
      const cooler = app.scene3d.scene.getObjectByName('PineHillsOpeningDrinksCoolerAnchor');
      return rootsReady && !!cooler?.userData?.openingCoolerController;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(900);
  }

  async function clickVisibleContinue() {
    const label = page.getByText('Continue', { exact: true }).first();
    await label.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => {
      const candidate = [...document.querySelectorAll('.menu-action-label')]
        .find((entry) => entry.textContent.trim() === 'Continue')
        ?.closest('button');
      return !!candidate && !candidate.disabled;
    }, null, { timeout: 30000 });
    await label.locator('..').click();
  }

  async function boot() {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await clickVisibleContinue();
    await waitForRuntime();
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
    });
    documentReady = true;
    await acquirePointerLock();
    await installInputTrace('before-pause-menu-load');
    browserReady = true;
  }

  async function fixEnvironment() {
    return page.evaluate(async () => {
      const app = window.__fw;
      const state = app.state;
      const day = Math.floor(state.clock.minutes / 1440);
      const minute = day * 1440 + 14 * 60;
      app.speedIdx = 0;
      app.scene3d.walk.clearKeys?.();
      state.clock.minutes = minute;
      if (state.weather) {
        state.weather.locked = true;
        state.weather.today = {
          tempHiF: 74,
          tempLoF: 55,
          rainIn: 0,
          humidity: 0.4,
          windMph: 6,
        };
      }
      app.scene3d.applyTimeWeather?.(minute % 1440, state.weather);
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      return {
        runnerBootstrapSeed: app.empire?.seed ?? null,
        stateSeed: state.seed ?? null,
        propertyId: app.empire?.activeId || state.propertyId || null,
        clubName: state.clubName,
        campaignEnabled: state.campaign?.enabled === true,
        campaignFurnishedStartVersion: state.campaign?.furnishedStartVersion ?? null,
        starterRestockVersion: state.shop?.reno?.starterRestockVersion ?? null,
        minute,
        localTimeMinutes: minute % 1440,
        weather: JSON.parse(JSON.stringify(state.weather || null)),
        clubhouseOrigin: clubhouse.interior.position.toArray(),
        stockroom: JSON.parse(JSON.stringify(layout.STOCKROOM)),
        coolerFixture: JSON.parse(JSON.stringify(
          layout.FIXTURES.find((entry) => entry.id === 'cold_drinks') || null,
        )),
      };
    });
  }

  async function inventorySnapshot(label) {
    return page.evaluate(async (snapshotLabel) => {
      const starter = await import(new URL('src/sim/clubhouseStarterStock.js', document.baseURI).href);
      const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
      const state = window.__fw.state;
      const boxes = (state.shop.deliveries?.boxes || []).filter((box) => (
        box.starterRestockVersion === starter.STARTER_RESTOCK_VERSION
      ));
      const lines = {};
      for (const skuId of starter.STARTER_RETAIL_SKU_IDS) {
        const cartonRemaining = boxes.reduce((sum, box) => (
          sum + (box.contents || [])
            .filter((entry) => entry.skuId === skuId)
            .reduce((lineSum, entry) => lineSum + (entry.remainingQuantity || 0), 0)
        ), 0);
        const shelf = state.shop.inventory[skuId]?.shelf || 0;
        const back = state.shop.inventory[skuId]?.back || 0;
        const carry = state.shop.carry?.skuId === skuId ? state.shop.carry.qty : 0;
        const position = lifecycle.inventoryPosition(state, skuId);
        const customerHeld = position[lifecycle.INVENTORY_STAGE.CUSTOMER_HELD] || 0;
        lines[skuId] = {
          skuId,
          entitlement: starter.STARTER_RETAIL_ENTITLEMENT[skuId],
          shelf,
          back,
          carry,
          customerHeld,
          cartonRemaining,
          physicalTotal: shelf + back + carry + customerHeld + cartonRemaining,
          starterRetailQuantity: starter.starterRetailQuantity(state, skuId),
          lifecycle: position,
        };
      }
      return {
        label: snapshotLabel,
        lines,
        totals: {
          physical: Object.values(lines).reduce((sum, entry) => sum + entry.physicalTotal, 0),
          lifecycleOnHand: Object.values(lines).reduce((sum, entry) => (
            sum + entry.lifecycle.onHand
          ), 0),
          entitlement: Object.values(lines).reduce((sum, entry) => sum + entry.entitlement, 0),
        },
        carry: state.shop.carry ? JSON.parse(JSON.stringify(state.shop.carry)) : null,
        starterLots: (state.shop.inventoryLifecycle?.lots || [])
          .filter((lot) => String(lot.lineId || '').startsWith('pine-hills-starter-'))
          .map((lot) => ({
            id: lot.id,
            lineId: lot.lineId,
            skuId: lot.skuId,
            orderedQuantity: lot.orderedQuantity,
            buckets: { ...lot.buckets },
          })),
      };
    }, label);
  }

  async function starterCartonCensus() {
    return page.evaluate(async () => {
      const starter = await import(new URL('src/sim/clubhouseStarterStock.js', document.baseURI).href);
      const placement = await import(new URL('src/sim/boxPlacement.js', document.baseURI).href);
      const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
      const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const state = window.__fw.state;
      const scene = window.__fw.scene3d.scene;
      const fixtureById = new Map(layout.FIXTURES.map((entry) => [entry.id, entry]));
      const lotById = new Map(
        (state.shop.inventoryLifecycle?.lots || []).map((lot) => [lot.id, lot]),
      );
      const boxes = (state.shop.deliveries?.boxes || []).filter((box) => (
        box.starterRestockVersion === starter.STARTER_RESTOCK_VERSION
      ));
      const sceneRootIds = [];
      scene.traverse((object) => {
        const match = /^DeliveryBox_(\d+)$/.exec(object.name || '');
        if (match) sceneRootIds.push(Number(match[1]));
      });
      const cartons = boxes.map((box) => {
        const root = scene.getObjectByName(`DeliveryBox_${box.id}`)
          || scene.getObjectByName(`DeliveryBoxFallback_${box.id}`);
        let hierarchyVisible = !!root;
        for (let object = root; object && hierarchyVisible; object = object.parent) {
          hierarchyVisible = object.visible !== false;
        }
        let visibleMeshes = 0;
        let meshes = 0;
        root?.traverse((object) => {
          if (!object.isMesh) return;
          meshes += 1;
          if (object.visible) visibleMeshes += 1;
        });
        const target = {
          kind: 'surface',
          surfaceId: box.surfaceId,
          x: box.x,
          z: box.z,
          ry: box.ry,
        };
        const preview = placement.previewBoxPlacement(state, box, target);
        const contentBacking = (box.contents || []).map((entry) => {
          const lot = lotById.get(entry.lotId);
          const unopened = lot?.buckets?.[lifecycle.INVENTORY_STAGE.DELIVERED_UNOPENED] || 0;
          return {
            lineId: entry.lineId,
            lotId: entry.lotId,
            skuId: entry.skuId,
            remainingQuantity: entry.remainingQuantity,
            lotExists: !!lot,
            lotSkuId: lot?.skuId || null,
            deliveredUnopened: unopened,
            backed: !!lot
              && lot.skuId === entry.skuId
              && unopened === entry.remainingQuantity,
          };
        });
        const spec = starter.STARTER_CARTON_SPECS.find((entry) => (
          entry.id === box.starterCartonId
        ));
        const nearFixtures = (spec?.nearFixtureIds || []).map((fixtureId) => {
          const fixture = fixtureById.get(fixtureId);
          return {
            fixtureId,
            distance: fixture ? Math.hypot(box.x - fixture.x, box.z - fixture.z) : null,
          };
        });
        return {
          id: box.id,
          starterCartonId: box.starterCartonId,
          starterCartonOrdinal: box.starterCartonOrdinal ?? null,
          starterCartonCount: box.starterCartonCount ?? null,
          assortmentLabel: box.assortmentLabel,
          representativeSkuId: box.skuId,
          qty: box.qty,
          initialQty: box.initialQty,
          loc: box.loc,
          surfaceId: box.surfaceId,
          pose: { x: box.x, z: box.z, ry: box.ry },
          lifecycle: box.lifecycle,
          cutProgress: box.cutProgress ?? box.tape ?? 0,
          flapProgress: [...(box.flapProgress || [])],
          starterPlacement: JSON.parse(JSON.stringify(box.starterPlacement || null)),
          nearFixtures,
          placementValidation: {
            ok: preview.ok,
            reason: preview.reason || null,
            target: preview.target || null,
          },
          contentQuantity: (box.contents || []).reduce((sum, entry) => (
            sum + (entry.remainingQuantity || 0)
          ), 0),
          contentBacking,
          inventoryBacked: contentBacking.length > 1
            && contentBacking.every((entry) => entry.backed),
          scene: {
            rootName: root?.name || null,
            sceneRootCount: sceneRootIds.filter((id) => id === box.id).length,
            hierarchyVisible,
            meshes,
            visibleMeshes,
            rendered: hierarchyVisible && visibleMeshes > 0,
          },
        };
      });
      return {
        expectedVersion: starter.STARTER_RESTOCK_VERSION,
        expectedSpecIds: starter.STARTER_CARTON_SPECS.map((entry) => entry.id),
        starterBoxCount: boxes.length,
        sceneRootIds,
        cartons,
      };
    });
  }

  async function boxSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const deliveries = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const placement = await import(new URL('src/sim/boxPlacement.js', document.baseURI).href);
      const box = deliveries.findBox(window.__fw.state, id);
      if (!box) return { exists: false, id };
      return {
        exists: true,
        id: box.id,
        starterCartonId: box.starterCartonId || null,
        skuId: box.skuId,
        qty: box.qty,
        initialQty: box.initialQty,
        loc: box.loc,
        surfaceId: box.surfaceId || null,
        x: box.x ?? null,
        z: box.z ?? null,
        ry: box.ry ?? null,
        boxKind: box.box,
        lifecycle: deliveries.boxLifecycleState(box),
        cutProgress: box.cutProgress ?? box.tape ?? 0,
        tapeSegments: { ...(box.tapeSegments || {}) },
        flapProgress: [...(box.flapProgress || box.flaps || [])],
        openingProgress: box.openingProgress || 0,
        inventoryOpened: !!box.inventoryOpened,
        canUnpack: placement.boxPlacementCapabilities(window.__fw.state, box).canUnpack,
        contents: (box.contents || []).map((entry) => ({
          skuId: entry.skuId,
          lotId: entry.lotId,
          remainingQuantity: entry.remainingQuantity,
        })),
      };
    }, boxId);
  }

  async function waitForBox(boxId, wanted, timeout = 8000) {
    await page.waitForFunction(({ id, stateWanted }) => {
      const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((entry) => entry.id === id);
      if (!box) return false;
      if (stateWanted === 'carried') return box.loc === 'carried';
      if (stateWanted === 'world') return box.loc === 'world';
      if (stateWanted === 'cut') return (box.cutProgress ?? box.tape ?? 0) >= 0.999;
      if (stateWanted === 'open') return Array.isArray(box.flapProgress)
        && box.flapProgress.length === 4
        && box.flapProgress.every((value) => value >= 0.999);
      return false;
    }, { id: boxId, stateWanted: wanted }, { timeout });
    return boxSnapshot(boxId);
  }

  async function setWorldLook(pose) {
    await page.evaluate((next) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.setSpraying?.(false);
      walk.state.x = next.x;
      walk.state.z = next.z;
      walk.state.yaw = next.yaw;
      walk.state.pitch = next.pitch;
    }, pose);
    await page.waitForTimeout(260);
  }

  async function cartonApproachCandidates(boxId, distance = 1.34) {
    return page.evaluate(async ({ id, requestedDistance }) => {
      const boxes = await import(new URL('src/data/boxes.js', document.baseURI).href);
      const app = window.__fw;
      const box = app.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      if (!box || !root) return [];
      const dims = boxes.boxDims(box.box || 'carton');
      const Vector3 = app.scene3d.camera.position.constructor;
      const target = root.getWorldPosition(new Vector3());
      const targetY = target.y + Math.min(dims.h * 0.62, Math.max(0.18, dims.h - 0.04));
      const eyeY = app.scene3d.clubhouse().interior.position.y + (app.scene3d.walk.state.eye || 1.62);
      const candidates = [];
      for (const radius of [requestedDistance, requestedDistance + 0.28]) {
        for (const angle of [0, Math.PI, Math.PI / 2, -Math.PI / 2,
          Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4]) {
          const x = target.x + Math.sin(angle) * radius;
          const z = target.z + Math.cos(angle) * radius;
          const dx = target.x - x;
          const dz = target.z - z;
          const horizontal = Math.hypot(dx, dz) || 0.001;
          candidates.push({
            x,
            z,
            yaw: Math.atan2(-dx / horizontal, -dz / horizontal),
            pitch: Math.max(-1.12, Math.min(0.5, Math.atan2(targetY - eyeY, horizontal))),
            target: { x: target.x, y: targetY, z: target.z },
            radius,
            walkFree: app.scene3d.walk.isFree?.(x, z, 0.28) !== false,
          });
        }
      }
      return candidates.sort((a, b) => Number(b.walkFree) - Number(a.walkFree));
    }, { id: boxId, requestedDistance: distance });
  }

  async function focusCarton(boxId, pattern, { distance = 1.34, timeoutPerPose = 500 } = {}) {
    const candidates = await cartonApproachCandidates(boxId, distance);
    let latest = null;
    for (const candidate of candidates) {
      await setWorldLook(candidate);
      latest = await focusInfo();
      if (pattern.test(latest.label || '')
        && latest.nearestCartonId === boxId
        && latest.nearestCartonDistance < 0.35) {
        return { pose: candidate, focus: latest };
      }
      await page.waitForTimeout(Math.min(120, timeoutPerPose));
    }
    const error = new Error(`Could not focus carton ${boxId} for ${pattern}: ${JSON.stringify(latest)}.`);
    error.evidence = { candidates, latest };
    throw error;
  }

  async function projectedCartonVisual(boxId) {
    return page.evaluate((id) => {
      const app = window.__fw;
      const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      const camera = app.scene3d.camera;
      if (!root || !camera) return { rootExists: false };
      root.updateWorldMatrix(true, true);
      camera.updateMatrixWorld(true);
      const Vector3 = camera.position.constructor;
      const point = new Vector3();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let meshes = 0;
      let visibleMeshes = 0;
      root.traverseVisible((object) => {
        if (!object.isMesh || !object.geometry) return;
        meshes += 1;
        visibleMeshes += 1;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox;
        if (!bounds) return;
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              point.set(x, y, z).applyMatrix4(object.matrixWorld).project(camera);
              const px = (point.x * 0.5 + 0.5) * innerWidth;
              const py = (0.5 - point.y * 0.5) * innerHeight;
              if (![px, py].every(Number.isFinite)) continue;
              minX = Math.min(minX, px);
              minY = Math.min(minY, py);
              maxX = Math.max(maxX, px);
              maxY = Math.max(maxY, py);
            }
          }
        }
      });
      const valid = [minX, minY, maxX, maxY].every(Number.isFinite);
      const bounds = valid ? {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY),
        area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
      } : null;
      return {
        rootExists: true,
        rootName: root.name,
        meshes,
        visibleMeshes,
        bounds,
        intersectsViewport: !!bounds
          && bounds.maxX > 0 && bounds.minX < innerWidth
          && bounds.maxY > 0 && bounds.minY < innerHeight,
      };
    }, boxId);
  }

  async function fixtureApproachPoses(fixtureId, aimY = 1.05) {
    return page.evaluate(async ({ id, targetY }) => {
      const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const app = window.__fw;
      const fixture = layout.FIXTURES.find((entry) => entry.id === id);
      if (!fixture) return [];
      const browseSpecs = fixture.browse?.length ? fixture.browse : [{ x: 0, z: null }];
      const localCandidates = browseSpecs.map((browse) => ({
        ...layout.fixtureBrowsePoint(fixture, browse.x || 0, browse.z),
        source: 'shopLayout.fixtureBrowsePoint',
      }));
      for (const extra of [0.92, 1.18, 1.42]) {
        localCandidates.push({
          ...layout.fixtureBrowsePoint(fixture, 0, extra),
          source: `shopLayout.fixtureBrowsePoint:${extra}`,
        });
      }
      const interior = app.scene3d.clubhouse().interior;
      const Vector3 = app.scene3d.camera.position.constructor;
      const target = new Vector3(fixture.x, targetY, fixture.z);
      interior.localToWorld(target);
      return localCandidates.map((local) => {
        const at = new Vector3(local.x, 0, local.z);
        interior.localToWorld(at);
        const dx = target.x - at.x;
        const dz = target.z - at.z;
        const horizontal = Math.hypot(dx, dz) || 0.001;
        const eyeY = interior.position.y + (app.scene3d.walk.state.eye || 1.62);
        return {
          x: at.x,
          z: at.z,
          yaw: Math.atan2(-dx / horizontal, -dz / horizontal),
          pitch: Math.max(-1.12, Math.min(0.55, Math.atan2(target.y - eyeY, horizontal))),
          localAt: { x: local.x, z: local.z },
          localTarget: { x: fixture.x, y: targetY, z: fixture.z },
          source: local.source,
          walkFree: app.scene3d.walk.isFree?.(at.x, at.z, 0.28) !== false,
        };
      }).sort((a, b) => Number(b.walkFree) - Number(a.walkFree));
    }, { id: fixtureId, targetY: aimY });
  }

  async function focusFixture(fixtureId, pattern, aimY = 1.05) {
    const poses = await fixtureApproachPoses(fixtureId, aimY);
    let latest = null;
    for (const pose of poses) {
      await setWorldLook(pose);
      latest = await focusInfo();
      if (pattern.test(latest.label || '')) return { pose, focus: latest };
    }
    const error = new Error(`Could not focus fixture ${fixtureId} for ${pattern}: ${JSON.stringify(latest)}.`);
    error.evidence = { poses, latest };
    throw error;
  }

  async function coolerSnapshot(label) {
    return page.evaluate(async (snapshotLabel) => {
      const coolerModule = await import(new URL('src/sim/openingDrinksCooler.js', document.baseURI).href);
      const app = window.__fw;
      const state = coolerModule.openingDrinksCoolerSnapshot(app.state);
      const anchor = app.scene3d.scene.getObjectByName('PineHillsOpeningDrinksCoolerAnchor');
      const controller = anchor?.userData?.openingCoolerController || null;
      const collider = controller?.doorCollider || null;
      const door = controller?.doorNode || null;
      const root = controller?.root || null;
      const finiteCollider = !!collider
        && [collider.minX, collider.maxX, collider.minZ, collider.maxZ].every(Number.isFinite);
      const center = finiteCollider ? {
        x: (collider.minX + collider.maxX) / 2,
        z: (collider.minZ + collider.maxZ) / 2,
      } : null;
      return {
        label: snapshotLabel,
        state,
        anchor: anchor ? {
          name: anchor.name,
          visible: anchor.visible,
          fixtureLayoutId: anchor.userData?.fixtureLayoutId || null,
        } : null,
        controller: controller ? {
          doorState: controller.doorState,
          clips: controller.clips?.map((clip) => clip.name) || [],
          rootName: root?.name || null,
          rootVisible: root?.visible !== false,
          doorName: door?.name || null,
          doorRotation: door ? [door.rotation.x, door.rotation.y, door.rotation.z] : null,
          doorQuaternion: door ? door.getWorldQuaternion(door.quaternion.clone()).toArray() : null,
        } : null,
        collider: collider ? {
          minX: collider.minX,
          maxX: collider.maxX,
          minZ: collider.minZ,
          maxZ: collider.maxZ,
          width: collider.maxX - collider.minX,
          depth: collider.maxZ - collider.minZ,
          openingCoolerDoor: collider.openingCoolerDoor === true,
          dynamic: collider.dynamic === true,
          finite: finiteCollider,
          center,
          blocksAtCenter: center
            ? app.scene3d.walk.isFree?.(center.x, center.z, 0.03) === false
            : false,
        } : null,
      };
    }, label);
  }

  async function waitForCoolerState(wanted, timeout = 6000) {
    await page.waitForFunction((stateWanted) => {
      const state = window.__fw?.state?.shop?.reno?.openingDrinksCooler?.doorState;
      const anchor = window.__fw?.scene3d?.scene
        ?.getObjectByName('PineHillsOpeningDrinksCoolerAnchor');
      return state === stateWanted
        && anchor?.userData?.openingCoolerController?.doorState === stateWanted;
    }, wanted, { timeout });
    await page.waitForTimeout(1500);
    return coolerSnapshot(wanted);
  }

  const aabbDelta = (a, b) => {
    if (!a || !b) return Infinity;
    return Math.max(
      Math.abs(a.minX - b.minX),
      Math.abs(a.maxX - b.maxX),
      Math.abs(a.minZ - b.minZ),
      Math.abs(a.maxZ - b.maxZ),
    );
  };

  async function exerciseCoolerPersistence() {
    const route = { controls: [], snapshots: {} };
    route.snapshots.initial = await coolerSnapshot('initial-closed');
    requireCheck(
      'cooler-fresh-state-closed',
      route.snapshots.initial.state?.door?.state === 'closed',
      'Fresh Pine Hills did not start with the drinks cooler closed.',
      route.snapshots.initial,
    );
    requireCheck(
      'cooler-initial-dynamic-collider',
      route.snapshots.initial.collider?.finite
        && route.snapshots.initial.collider?.dynamic
        && route.snapshots.initial.collider?.openingCoolerDoor,
      'The opening cooler did not expose its finite dynamic door collider.',
      route.snapshots.initial.collider,
    );

    const openFocus = await focusFixture(
      'cold_drinks',
      /Cold drinks.*\[E\].*open/i,
      1.05,
    );
    await capture('04-cooler-closed-before-normal-open');
    await page.keyboard.press('e');
    route.controls.push({ action: 'E open', focus: openFocus.focus });
    route.snapshots.opened = await waitForCoolerState('open');
    const closeFocus = await focusFixture(
      'cold_drinks',
      /Cold drinks.*\[E\].*close/i,
      1.05,
    );
    await capture('05-cooler-open-normal-e');
    requireCheck(
      'cooler-opened-with-e',
      route.snapshots.opened.state?.door?.state === 'open'
        && route.snapshots.opened.controller?.doorState === 'open',
      'E did not open both the cooler state and physical controller.',
      route.snapshots.opened,
    );
    requireCheck(
      'cooler-open-collider-blocking',
      route.snapshots.opened.collider?.blocksAtCenter === true,
      'The open-state dynamic door collider did not block its own live center.',
      route.snapshots.opened.collider,
    );
    const openDelta = aabbDelta(
      route.snapshots.initial.collider,
      route.snapshots.opened.collider,
    );
    requireCheck(
      'cooler-collider-moves-with-door',
      openDelta > 0.05,
      'The cooler door changed state without a material collider pose change.',
      { openDelta, initial: route.snapshots.initial.collider, opened: route.snapshots.opened.collider },
    );

    await page.keyboard.press('e');
    route.controls.push({ action: 'E close', focus: closeFocus.focus });
    route.snapshots.closed = await waitForCoolerState('closed');
    const reopenFocus = await focusFixture(
      'cold_drinks',
      /Cold drinks.*\[E\].*open/i,
      1.05,
    );
    await capture('06-cooler-closed-normal-e');
    const closedDelta = aabbDelta(
      route.snapshots.initial.collider,
      route.snapshots.closed.collider,
    );
    requireCheck(
      'cooler-closed-with-e',
      route.snapshots.closed.state?.door?.state === 'closed'
        && closedDelta < 0.05,
      'E did not return the cooler state and collider to the closed pose.',
      { closedDelta, closed: route.snapshots.closed },
    );

    await page.keyboard.press('e');
    route.controls.push({ action: 'E reopen before save', focus: reopenFocus.focus });
    route.snapshots.openBeforeSave = await waitForCoolerState('open');
    await focusFixture(
      'cold_drinks',
      /Cold drinks.*\[E\].*close/i,
      1.05,
    );
    await capture('07-cooler-open-before-manual-save');
    await collectInputTrace();
    route.manualSave = await pauseMenuSaveSlotOne({
      evidenceStem: '07-cooler-slot-1',
    });
    route.controls.push(...route.manualSave.controls);
    route.savedSlot = await page.evaluate(async () => {
      const raw = localStorage.getItem('golfempire:slot1');
      if (!raw) throw new Error('Pause-menu save did not write golfempire:slot1.');
      const empire = JSON.parse(raw);
      const holding = empire.holdings.find((entry) => entry.property.id === empire.activeId);
      if (!holding) throw new Error(`Manual slot has no active holding for ${empire.activeId}.`);
      return {
        storageKey: 'golfempire:slot1',
        bytes: raw.length,
        empireSeed: empire.seed,
        activeId: empire.activeId,
        cooler: JSON.parse(JSON.stringify(holding.state.shop.reno.openingDrinksCooler)),
        starterCartons: holding.state.shop.deliveries.boxes
          .filter((box) => box.starterRestockVersion === 1)
          .map((box) => ({
            id: box.id,
            starterCartonId: box.starterCartonId,
            qty: box.qty,
            loc: box.loc,
            surfaceId: box.surfaceId,
            x: box.x,
            z: box.z,
            ry: box.ry,
          })),
      };
    });
    requireCheck(
      'manual-slot-save-captured-open-cooler',
      route.savedSlot.cooler?.doorState === 'open'
        && route.savedSlot.starterCartons.length === 3,
      'Pause-menu slot save omitted the open cooler state or one of the three starter cartons.',
      { save: route.manualSave, slot: route.savedSlot },
    );

    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    currentPhase = 'cooler-pause-menu-load';
    route.manualLoad = await pauseMenuLoadSlotOne({
      evidenceStem: '08-cooler-slot-1',
      traceLabel: 'after-cooler-pause-menu-load',
    });
    route.controls.push(...route.manualLoad.controls);
    route.snapshots.reloadedOpen = await waitForCoolerState('open');
    const postPauseLoadCloseFocus = await focusFixture(
      'cold_drinks',
      /Cold drinks.*\[E\].*close/i,
      1.05,
    );
    await capture('08-cooler-open-after-pause-menu-load');
    const reloadDelta = aabbDelta(
      route.snapshots.openBeforeSave.collider,
      route.snapshots.reloadedOpen.collider,
    );
    requireCheck(
      'cooler-state-survives-pause-menu-load',
      route.snapshots.reloadedOpen.state?.door?.state === 'open'
        && route.snapshots.reloadedOpen.controller?.doorState === 'open',
      'The saved open cooler did not restore into both state and renderer controller.',
      route.snapshots.reloadedOpen,
    );
    requireCheck(
      'cooler-collider-survives-pause-menu-load',
      route.snapshots.reloadedOpen.collider?.finite
        && route.snapshots.reloadedOpen.collider?.blocksAtCenter
        && reloadDelta < 0.08,
      'The saved open cooler collider did not restore to its pre-save live AABB.',
      { reloadDelta, before: route.snapshots.openBeforeSave.collider, after: route.snapshots.reloadedOpen.collider },
    );

    await page.keyboard.press('e');
    route.controls.push({ action: 'E close after pause-menu load', focus: postPauseLoadCloseFocus.focus });
    route.snapshots.closedAfterReload = await waitForCoolerState('closed');
    await focusFixture(
      'cold_drinks',
      /Cold drinks.*\[E\].*open/i,
      1.05,
    );
    await capture('09-cooler-closed-after-reload-normal-e');
    requireCheck(
      'cooler-remains-interactive-after-reload',
      route.snapshots.closedAfterReload.state?.door?.state === 'closed'
        && aabbDelta(
          route.snapshots.initial.collider,
          route.snapshots.closedAfterReload.collider,
        ) < 0.08,
      'The reloaded cooler did not close normally or recover its closed collider pose.',
      route.snapshots.closedAfterReload,
    );
    return route;
  }

  async function deriveStockroomPlacementCandidates(boxId) {
    return page.evaluate(async (id) => {
      const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const placement = await import(new URL('src/sim/boxPlacement.js', document.baseURI).href);
      const surfaces = await import(new URL('src/data/boxPlacementSurfaces.js', document.baseURI).href);
      const app = window.__fw;
      const box = app.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      if (!box) return [];
      const bounds = layout.STOCKROOM.bounds;
      const base = {
        x: Math.min(bounds.maxX - 0.85, Math.max(bounds.minX + 0.85, layout.STOCKROOM.packing.x + 1.35)),
        z: Math.min(bounds.maxZ - 0.85, Math.max(bounds.minZ + 0.85, layout.STOCKROOM.packing.z - 0.80)),
      };
      // An emptied four-flap carton retains its honest open placement envelope.
      // Search full carton-sized bays instead of half-yard nudges so the second
      // and third starter cartons can be staged beside earlier open empties.
      const offsets = [
        [0, 0], [1.5, 0], [-1.5, 0], [0, -1.5], [0, 1.5],
        [1.5, -1.5], [-1.5, -1.5], [1.5, 1.5], [-1.5, 1.5],
        [0, -3.0], [1.5, -3.0], [-1.5, -3.0],
      ];
      const validatedTargets = [];
      for (const [dx, dz] of offsets) {
        const target = {
          kind: 'surface',
          surfaceId: surfaces.FLOOR_BOX_SURFACE_ID,
          x: Math.min(bounds.maxX - 0.55, Math.max(bounds.minX + 0.55, base.x + dx)),
          z: Math.min(bounds.maxZ - 0.55, Math.max(bounds.minZ + 0.55, base.z + dz)),
          ry: 0,
        };
        const preview = placement.previewBoxPlacement(app.state, box, target);
        if (preview.ok) validatedTargets.push({ target, simulationPreview: preview });
      }
      const cameras = [];
      const interior = app.scene3d.clubhouse().interior;
      const Vector3 = app.scene3d.camera.position.constructor;
      const eye = app.scene3d.walk.state.eye || 1.62;
      for (const entry of validatedTargets) {
        for (const angle of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
          const distance = 1.36;
          const localAt = {
            x: entry.target.x + Math.sin(angle) * distance,
            z: entry.target.z + Math.cos(angle) * distance,
          };
          const at = new Vector3(localAt.x, 0, localAt.z);
          const targetWorld = new Vector3(entry.target.x, 0.025, entry.target.z);
          interior.localToWorld(at);
          interior.localToWorld(targetWorld);
          const dx = targetWorld.x - at.x;
          const dz = targetWorld.z - at.z;
          const horizontal = Math.hypot(dx, dz) || 0.001;
          cameras.push({
            x: at.x,
            z: at.z,
            yaw: Math.atan2(-dx / horizontal, -dz / horizontal),
            pitch: Math.atan2(targetWorld.y - (interior.position.y + eye), horizontal),
            target: entry.target,
            simulationPreview: {
              ok: entry.simulationPreview.ok,
              target: entry.simulationPreview.target,
            },
            derivedFrom: 'STOCKROOM.packing + STOCKROOM.bounds + live previewBoxPlacement',
          });
        }
      }
      return cameras;
    }, boxId);
  }

  async function placeCarriedCartonInStockroom(boxId) {
    const candidates = await deriveStockroomPlacementCandidates(boxId);
    let chosen = null;
    let runtimeDiagnostics = null;
    for (const candidate of candidates) {
      await setWorldLook(candidate);
      await page.waitForTimeout(180);
      runtimeDiagnostics = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().boxPlacement.diagnostics()
      ));
      if (runtimeDiagnostics.visible
        && runtimeDiagnostics.legal
        && runtimeDiagnostics.surfaceId === 'floor:clubhouse') {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      const error = new Error(`No legal normal-control stockroom placement for carton ${boxId}.`);
      error.evidence = { candidates, runtimeDiagnostics };
      throw error;
    }
    const focus = await focusInfo();
    requireCheck(
      'carried-carton-exposes-place-verb',
      /\[E\] place/i.test(focus.label || ''),
      'The carried starter carton did not expose its normal E placement verb.',
      { focus, chosen, runtimeDiagnostics },
    );
    await page.keyboard.press('e');
    const placed = await waitForBox(boxId, 'world');
    requireCheck(
      'starter-carton-placed-in-unpacking-zone',
      placed.loc === 'world' && placed.canUnpack,
      'The starter carton was not placed on an unpack-capable stockroom surface.',
      placed,
    );
    return { chosen, runtimeDiagnostics, focus, placed };
  }

  // Ported off the box-cutter equip/drag 2026-07-30 — cartons tear on a
  // single E press, no tool, no drag, no held-E fallback.
  // tools/qa/proshop-box-open-loop.js owns the gesture contract; this driver
  // holds the starter-stock and cooler claims around it.
  async function cutCartonThroughNormalControls(boxId, evidenceStem = 'starter-carton') {
    const result = {
      primary: {
        control: 'single E press on the focused sealed carton',
        attempted: true,
        completed: false,
        error: null,
      },
      completedBy: null,
    };
    const focused = await focusCarton(
      boxId,
      /tear the tape/i,
      { distance: 1.10 },
    );
    const before = await focusInfo();
    if (before.tool !== null) {
      throw new Error(`A carton press must not involve a tool: ${JSON.stringify(before)}`);
    }
    result.primary.focusLabel = focused?.label ?? before.label ?? null;
    try {
      await page.keyboard.press('e');
      await page.waitForFunction((id) => {
        const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === id);
        return !!box && (box.cutProgress ?? box.tape ?? 0) >= 0.999;
      }, boxId, { timeout: 5000 });
      result.primary.tornScreenshot = (await capture(
        `${evidenceStem}-tape-torn-one-press`,
        { cutProgress: (await boxSnapshot(boxId)).cutProgress },
      )).file;
    } catch (error) {
      result.primary.error = errorRecord('press-tear', error);
    }
    const afterPrimary = await boxSnapshot(boxId);
    result.primary.cutProgress = afterPrimary.cutProgress;
    result.primary.completed = afterPrimary.cutProgress >= 0.999;
    if (result.primary.completed) result.completedBy = 'single-e-press';
    return result;
  }

  async function attemptStoreCarryInBack() {
    const carry = await page.evaluate(() => (
      window.__fw.state.shop.carry
        ? JSON.parse(JSON.stringify(window.__fw.state.shop.carry))
        : null
    ));
    if (!carry) return { attempted: false, reason: 'hands-empty' };
    try {
      const focused = await focusFixture(
        'backshelf_n',
        /Receiving reserve.*\[E\] store/i,
        1.05,
      );
      await page.keyboard.press('e');
      await page.waitForFunction(() => !window.__fw.state.shop.carry, null, { timeout: 4000 });
      return { attempted: true, stored: true, before: carry, focus: focused.focus };
    } catch (error) {
      return {
        attempted: true,
        stored: false,
        before: carry,
        error: errorRecord('store-carry-in-back', error),
        remainder: await page.evaluate(() => (
          window.__fw.state.shop.carry
            ? JSON.parse(JSON.stringify(window.__fw.state.shop.carry))
            : null
        )),
      };
    }
  }

  const evidenceSlug = (value) => String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  async function restorationRewardSnapshot(label) {
    return page.evaluate(async (snapshotLabel) => {
      const starter = await import(new URL('src/sim/clubhouseStarterStock.js', document.baseURI).href);
      const restoration = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
      const state = window.__fw.state;
      const snapshot = restoration.restorationSnapshot(state);
      const groupIds = Object.keys(starter.STARTER_RETAIL_GROUPS);
      const rewardIds = Object.fromEntries(groupIds.map((groupId) => [
        groupId,
        `clubhouse-restoration:${snapshot.propertyId}:${snapshot.version}:restock:${groupId}`,
      ]));
      const history = Array.isArray(state.reputation?.history)
        ? state.reputation.history.map((entry) => ({
          id: entry.id,
          source: entry.source,
          sourceId: entry.sourceId,
          categoryDeltas: { ...(entry.categoryDeltas || {}) },
          overallDelta: entry.overallDelta,
        }))
        : [];
      return {
        label: snapshotLabel,
        snapshot,
        groupIds,
        groupComplete: Object.fromEntries(groupIds.map((groupId) => [
          groupId,
          starter.starterRestockGroupComplete(state, groupId),
        ])),
        rewardIds,
        rewardHistory: Object.fromEntries(groupIds.map((groupId) => [
          groupId,
          history.filter((entry) => entry.id === rewardIds[groupId]),
        ])),
        processed: Object.fromEntries(groupIds.map((groupId) => [
          groupId,
          state.reputation?.processedIds?.[rewardIds[groupId]] === true,
        ])),
        reputation: {
          overall: state.reputation?.overall ?? null,
          retail: state.reputation?.categories?.retail ?? null,
          historyLength: history.length,
        },
      };
    }, label);
  }

  async function starterSkuRoute(skuId) {
    return page.evaluate(async (id) => {
      const starter = await import(new URL('src/sim/clubhouseStarterStock.js', document.baseURI).href);
      const slots = await import(new URL('src/data/fixtureSlots.js', document.baseURI).href);
      const fixture = slots.homeFixture(id);
      const groupId = Object.entries(starter.STARTER_RETAIL_GROUPS)
        .find(([, skuIds]) => skuIds.includes(id))?.[0] || null;
      const line = window.__fw.state.shop.inventory[id];
      const carry = window.__fw.state.shop.carry;
      return {
        skuId: id,
        groupId,
        fixture: fixture ? {
          id: fixture.id,
          title: fixture.title,
          skus: [...fixture.skus],
        } : null,
        shelf: line?.shelf || 0,
        back: line?.back || 0,
        capacity: slots.capacityOf(id),
        carry: carry?.skuId === id ? {
          skuId: carry.skuId,
          qty: carry.qty,
        } : null,
      };
    }, skuId);
  }

  async function startGameplayCapture(segmentId) {
    const file = path.join(out, `${segmentId}-normal-controls-audio.webm`);
    const started = await page.evaluate(async () => {
      const audio = window.__fw.audio;
      audio.setMuted(false);
      audio.setVolume(0.8);
      return audio.startCapture(document.getElementById('game'), {
        fps: 30,
        videoBitsPerSecond: 4_000_000,
        audioBitsPerSecond: 128_000,
      });
    });
    activeMediaCapture = { segmentId, file, started };
    requireCheck(
      `av-${segmentId}-started`,
      started.audioTracks > 0
        && started.videoTracks > 0
        && started.audioContextState === 'running',
      `Audio-bearing gameplay capture ${segmentId} did not start.`,
      started,
    );
    return activeMediaCapture;
  }

  async function stopGameplayCapture() {
    if (!activeMediaCapture) return null;
    const active = activeMediaCapture;
    activeMediaCapture = null;
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((downloadName) => (
      window.__fw.audio.stopCapture({ downloadName })
    ), path.basename(active.file));
    const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
    const failure = await download.failure();
    if (failure) throw new Error(`Gameplay capture ${active.segmentId} failed: ${failure}`);
    await download.saveAs(active.file);
    const evidence = {
      segmentId: active.segmentId,
      file: relative(active.file),
      bytesOnDisk: fs.statSync(active.file).size,
      ...active.started,
      ...stopped,
    };
    mediaCaptures.push(evidence);
    requireCheck(
      `av-${active.segmentId}-retained-with-player-audio`,
      evidence.bytesOnDisk > 100_000
        && evidence.audioPeak > 0.0001
        && evidence.nonSilentAudioWindows > 0,
      `Gameplay capture ${active.segmentId} did not retain non-silent player audio.`,
      evidence,
    );
    return evidence;
  }

  async function openPauseMenu() {
    const pause = page.locator('.pause-veil-ui');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (await pause.isVisible().catch(() => false)) return pause;
      // P is the production universal pause key, including while pointer lock,
      // register, laptop, or box placement owns Escape contextually.
      await page.keyboard.press('p');
      if (await pause.waitFor({ state: 'visible', timeout: 1400 }).then(() => true).catch(() => false)) {
        return pause;
      }
      // Retain the ordinary walk-mode fallback after pointer-lock release.
      await page.keyboard.press('Escape');
    }
    throw new Error('P/Escape did not open the visible player pause menu.');
  }

  async function waitForOptionalDialog(name, timeout = 2000) {
    const dialog = page.getByRole('dialog', { name, exact: true });
    const visible = await dialog.waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    return visible ? dialog : null;
  }

  async function pauseMenuSaveSlotOne({ requireOverwrite = false, evidenceStem = 'pause-slot-1' } = {}) {
    const pause = await openPauseMenu();
    await pause.getByRole('button', { name: 'Save game', exact: true }).click();
    const saveHere = pause.getByRole('button', { name: 'Save here', exact: true }).first();
    await saveHere.waitFor({ state: 'visible', timeout: 6000 });
    await saveHere.click();

    const replaceDialog = await waitForOptionalDialog('Replace slot 1?');
    let confirmationScreenshot = null;
    if (replaceDialog) {
      confirmationScreenshot = (await capture(`${evidenceStem}-replace-and-save-confirmation`, {
        dialog: 'Replace slot 1?',
      })).file;
      await replaceDialog.getByRole('button', { name: 'Replace and save', exact: true }).click();
    }
    requireCheck(
      `${evidenceStem}-overwrite-confirmation`,
      !requireOverwrite || !!replaceDialog,
      'Slot 1 was expected to require the visible Replace and save confirmation.',
      { requireOverwrite, confirmationVisible: !!replaceDialog },
    );
    await page.waitForFunction(() => (
      !!localStorage.getItem('golfempire:slot1')
        && !!localStorage.getItem('golfempire:slot1-meta')
        && document.querySelector('.pause-status')?.textContent?.includes('Saved to slot 1')
    ), null, { timeout: 10000 });
    const storage = await page.evaluate(async () => {
      const raw = localStorage.getItem('golfempire:slot1');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return {
        storageKey: 'golfempire:slot1',
        bytes: raw.length,
        sha256: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      };
    });
    return {
      controls: replaceDialog
        ? ['P', 'Save game', 'Save here', 'Replace and save']
        : ['P', 'Save game', 'Save here'],
      overwriteConfirmed: !!replaceDialog,
      confirmationScreenshot,
      storage,
    };
  }

  async function pauseMenuLoadSlotOne({ evidenceStem = 'pause-slot-1', traceLabel } = {}) {
    const pause = await openPauseMenu();
    await pause.getByRole('button', { name: 'Load game', exact: true }).click();
    const load = pause.getByRole('button', { name: 'Load', exact: true }).first();
    await load.waitFor({ state: 'visible', timeout: 6000 });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('.pause-veil-ui button')]
        .find((entry) => entry.textContent.trim() === 'Load');
      return !!button && !button.disabled;
    }, null, { timeout: 6000 });
    await page.evaluate(() => { window.__pineHillsSceneBeforeManualLoad = window.__fw.scene3d; });
    await load.click();

    const confirmation = page.getByRole('dialog', { name: 'Load slot 1?', exact: true });
    await confirmation.waitFor({ state: 'visible', timeout: 6000 });
    const confirmationScreenshot = (await capture(`${evidenceStem}-load-game-confirmation`, {
      dialog: 'Load slot 1?',
    })).file;
    await confirmation.getByRole('button', { name: 'Load game', exact: true }).click();
    await page.waitForFunction(() => (
      window.__fw?.scene3d
        && window.__fw.scene3d !== window.__pineHillsSceneBeforeManualLoad
        && window.__fw.scene3d.clubhouse?.()
    ), null, { timeout: 90000 });
    await waitForRuntime();
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
    });
    await acquirePointerLock();
    if (traceLabel) await installInputTrace(traceLabel);
    return {
      controls: ['P', 'Load game', 'Load', 'Load game confirmation'],
      confirmationScreenshot,
    };
  }

  function inventoryConservedBetween(before, after) {
    if (!before || !after) return false;
    const skuIds = Object.keys(before.lines);
    return skuIds.length === Object.keys(after.lines).length
      && skuIds.every((skuId) => {
        const a = before.lines[skuId];
        const b = after.lines[skuId];
        return !!b
          && a.physicalTotal === b.physicalTotal
          && a.lifecycle.onHand === b.lifecycle.onHand
          && a.entitlement === b.entitlement;
      });
  }

  function cartonStateConservedBetween(before, after) {
    if (!before || !after || before.cartons.length !== after.cartons.length) return false;
    return before.cartons.every((carton) => {
      const next = after.cartons.find((entry) => entry.id === carton.id);
      return !!next
        && next.starterCartonId === carton.starterCartonId
        && next.qty === carton.qty
        && next.cutProgress === carton.cutProgress
        && next.lifecycle === carton.lifecycle
        && JSON.stringify(next.flapProgress) === JSON.stringify(carton.flapProgress)
        && JSON.stringify(next.contentBacking) === JSON.stringify(carton.contentBacking);
    });
  }

  async function pauseMenuSaveLoadMidRestock(before) {
    const route = { controls: [] };
    await collectInputTrace();
    route.save = await pauseMenuSaveSlotOne({
      requireOverwrite: true,
      evidenceStem: '30-mid-restock-slot-1',
    });
    route.controls.push(...route.save.controls);
    route.saveScreenshot = (await capture('30-mid-restock-pause-menu-save-slot-1', {
      completedGroups: Object.entries(before.restoration.groupComplete)
        .filter(([, complete]) => complete)
        .map(([groupId]) => groupId),
    })).file;
    await page.getByRole('button', { name: 'Resume', exact: true }).click();

    route.load = await pauseMenuLoadSlotOne({
      evidenceStem: '31-mid-restock-slot-1',
      traceLabel: 'after-mid-restock-pause-menu-load',
    });
    route.controls.push(...route.load.controls);
    const after = {
      inventory: await inventorySnapshot('after-mid-restock-pause-menu-load'),
      cartons: await starterCartonCensus(),
      restoration: await restorationRewardSnapshot('after-mid-restock-pause-menu-load'),
    };
    route.after = after;
    requireCheck(
      'mid-restock-pause-load-inventory-conserved',
      inventoryConservedBetween(before.inventory, after.inventory),
      'Pause-menu slot save/load changed a starter inventory entitlement.',
      { before: before.inventory, after: after.inventory },
    );
    requireCheck(
      'mid-restock-pause-load-cartons-conserved',
      cartonStateConservedBetween(before.cartons, after.cartons),
      'Pause-menu slot save/load changed a carton lifecycle or conserved content line.',
      { before: before.cartons, after: after.cartons },
    );
    requireCheck(
      'mid-restock-pause-load-rewards-not-duplicated',
      JSON.stringify(before.restoration.snapshot.restockMilestones)
        === JSON.stringify(after.restoration.snapshot.restockMilestones)
        && before.restoration.groupIds.every((groupId) => (
          before.restoration.rewardHistory[groupId].length
            === after.restoration.rewardHistory[groupId].length
        )),
      'Pause-menu slot load duplicated or lost a restock milestone reward.',
      { before: before.restoration, after: after.restoration },
    );
    await capture('31-mid-restock-slot-1-loaded-player-view', {
      conserved: true,
      cartons: after.cartons.cartons.map((entry) => ({
        starterCartonId: entry.starterCartonId,
        qty: entry.qty,
        lifecycle: entry.lifecycle,
      })),
    });
    return route;
  }

  async function prepareStarterCarton(boxId, cartonIndex) {
    const route = { boxId, cartonIndex, controls: [] };
    const initialFocus = await focusCarton(boxId, /\[E\] pick up/i);
    route.initial = await boxSnapshot(boxId);
    const stem = `${String(10 + cartonIndex * 6).padStart(2, '0')}-${evidenceSlug(route.initial.starterCartonId)}`;
    route.evidenceStem = stem;
    route.controls.push({ action: 'E pick up retail-floor starter carton', focus: initialFocus.focus });
    await capture(`${stem}-retail-pickup-focus`, {
      boxId,
      starterCartonId: route.initial.starterCartonId,
    });
    await page.keyboard.press('e');
    route.carried = await waitForBox(boxId, 'carried');
    requireCheck(
      `${route.initial.starterCartonId}-picked-up-with-e`,
      route.carried.loc === 'carried',
      `E did not pick up starter carton ${route.initial.starterCartonId}.`,
      route.carried,
    );
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().boxPlacement.isActive()
    ), null, { timeout: 4000 });
    route.placement = await placeCarriedCartonInStockroom(boxId);
    route.controls.push({ action: 'E commit green stockroom placement' });
    // Normalize the synthetic pointer before the tear press. A large
    // pointer-lock look delta left over from the previous carton can
    // legitimately drop focus mid-sequence.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await focusCarton(boxId, /tear the tape/i, { distance: 1.24 });
    await capture(`${stem}-stockroom-placement`);
    route.cutter = await cutCartonThroughNormalControls(boxId, stem);
    requireCheck(
      `${route.initial.starterCartonId}-cut-through-normal-control`,
      !!route.cutter.completedBy,
      `The tear press did not cut starter carton ${route.initial.starterCartonId}.`,
      { cutter: route.cutter, box: await boxSnapshot(boxId) },
    );
    route.controls.push({ action: route.cutter.completedBy });
    const openFocus = await focusCarton(boxId, /open the other flap/i, { distance: 1.18 });
    route.controls.push({ action: 'E open all four flaps', focus: openFocus.focus });
    await page.keyboard.press('e');
    route.opened = await waitForBox(boxId, 'open', 9000);
    requireCheck(
      `${route.initial.starterCartonId}-four-flap-open`,
      route.opened.inventoryOpened
        && route.opened.flapProgress.length === 4
        && route.opened.flapProgress.every((value) => value >= 0.999),
      `Normal E interaction did not open all four flaps on ${route.initial.starterCartonId}.`,
      route.opened,
    );
    await focusCarton(boxId, /\[E\] take an armful/i, { distance: 1.18 });
    await capture(`${stem}-open-four-flaps`, { contents: route.opened.contents });
    return route;
  }

  async function takeAndStockArmful(boxId, cartonRouteEntry, armfulIndex) {
    const beforeBox = await boxSnapshot(boxId);
    const activeContent = beforeBox.contents.find((entry) => entry.remainingQuantity > 0);
    requireCheck(
      `${cartonRouteEntry.initial.starterCartonId}-armful-${armfulIndex}-active-line`,
      !!activeContent?.skuId,
      `Starter carton ${cartonRouteEntry.initial.starterCartonId} exposed no active conserved line.`,
      beforeBox,
    );
    const takeFocus = await focusCarton(boxId, /\[E\] take an armful/i, { distance: 1.18 });
    await page.keyboard.press('e');
    await page.waitForFunction(({ id, before, skuId }) => {
      const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      const carry = window.__fw.state.shop.carry;
      return !!box && box.qty < before && carry?.skuId === skuId && carry.qty > 0;
    }, {
      id: boxId,
      before: beforeBox.qty,
      skuId: activeContent.skuId,
    }, { timeout: 5000 });
    const routeBefore = await starterSkuRoute(activeContent.skuId);
    requireCheck(
      `${activeContent.skuId}-armful-${armfulIndex}-has-authoritative-home`,
      !!routeBefore.groupId
        && !!routeBefore.fixture?.id
        && routeBefore.fixture.skus.includes(activeContent.skuId),
      `Starter SKU ${activeContent.skuId} has no authoritative furnished fixture.`,
      routeBefore,
    );
    const entry = {
      armfulIndex,
      skuId: activeContent.skuId,
      groupId: routeBefore.groupId,
      fixtureId: routeBefore.fixture.id,
      beforeBox,
      takeFocus: takeFocus.focus,
      carried: routeBefore.carry,
      shelfBefore: routeBefore.shelf,
      capacity: routeBefore.capacity,
      controls: ['E take one normal armful'],
    };
    if (armfulIndex === 1) {
      await capture(`${cartonRouteEntry.evidenceStem}-first-armful-carried`, entry);
    }

    if (routeBefore.fixture.id === 'cold_drinks') {
      const cooler = await coolerSnapshot(`before-${activeContent.skuId}-stock`);
      if (cooler.state?.door?.state !== 'open') {
        const openFocus = await focusFixture(
          'cold_drinks',
          /door closed.*\[E\] open before stocking/i,
          1.05,
        );
        await page.keyboard.press('e');
        await waitForCoolerState('open');
        entry.controls.push('E open cooler before stocking');
        entry.coolerOpenFocus = openFocus.focus;
      }
    }

    const stockFocus = await focusFixture(
      routeBefore.fixture.id,
      /hold \[E\] to stock/i,
      1.05,
    );
    const expectedShelf = Math.min(
      routeBefore.capacity,
      routeBefore.shelf + routeBefore.carry.qty,
    );
    await page.keyboard.down('e');
    try {
      await page.waitForFunction(({ skuId, expected }) => (
        (window.__fw.state.shop.inventory[skuId]?.shelf || 0) >= expected
          && !window.__fw.state.shop.carry
      ), { skuId: activeContent.skuId, expected: expectedShelf }, { timeout: 8000 });
    } finally {
      await page.keyboard.up('e').catch(() => {});
    }
    await page.waitForTimeout(160);
    const routeAfter = await starterSkuRoute(activeContent.skuId);
    entry.controls.push(`held E stock ${routeBefore.fixture.title}`);
    entry.stockFocus = stockFocus.focus;
    entry.shelfAfter = routeAfter.shelf;
    entry.carryAfter = routeAfter.carry;
    entry.boxAfter = await boxSnapshot(boxId);
    requireCheck(
      `${activeContent.skuId}-armful-${armfulIndex}-conserved-to-home-fixture`,
      entry.shelfAfter === expectedShelf
        && entry.carryAfter === null
        && (entry.shelfAfter - entry.shelfBefore) === routeBefore.carry.qty
        && (beforeBox.qty - entry.boxAfter.qty) === routeBefore.carry.qty,
      `Held E did not conserve ${activeContent.skuId} from carton to ${routeBefore.fixture.title}.`,
      entry,
    );
    return entry;
  }

  async function exerciseAllStarterCartons(census) {
    const route = {
      controls: [],
      cartons: [],
      groupEvidence: {},
      pauseMenuCheckpoint: null,
      initialRestoration: await restorationRewardSnapshot('before-all-three-cartons'),
    };
    requireCheck(
      'all-six-restock-milestones-start-incomplete',
      JSON.stringify(route.initialRestoration.groupIds)
        === JSON.stringify(expectedStarterGroupIds)
        && route.initialRestoration.groupIds.every((groupId) => (
          route.initialRestoration.snapshot.restockMilestones[groupId] === false
            && route.initialRestoration.rewardHistory[groupId].length === 0
            && route.initialRestoration.processed[groupId] === false
        )),
      'Fresh furnished start already contained a restock milestone reward.',
      route.initialRestoration,
    );
    await startGameplayCapture('starter-cartons-segment-1-before-save');
    let midPauseComplete = false;
    let totalArmfuls = 0;
    const ordered = [...census.cartons].sort((a, b) => (
      census.expectedSpecIds.indexOf(a.starterCartonId)
        - census.expectedSpecIds.indexOf(b.starterCartonId)
    ));

    for (let cartonIndex = 0; cartonIndex < ordered.length; cartonIndex += 1) {
      const carton = ordered[cartonIndex];
      const entry = await prepareStarterCarton(carton.id, cartonIndex);
      route.cartons.push(entry);
      let armfulIndex = 0;
      while (true) {
        const beforeBox = await boxSnapshot(carton.id);
        if (beforeBox.qty <= 0) break;
        armfulIndex += 1;
        totalArmfuls += 1;
        const transfer = await takeAndStockArmful(carton.id, entry, armfulIndex);
        entry.controls.push(...transfer.controls);
        entry.transfers ||= [];
        entry.transfers.push(transfer);
        const afterReward = await restorationRewardSnapshot(
          `after-${transfer.skuId}-armful-${armfulIndex}`,
        );
        if (afterReward.snapshot.restockMilestones[transfer.groupId]
          && !route.groupEvidence[transfer.groupId]) {
          route.groupEvidence[transfer.groupId] = {
            groupId: transfer.groupId,
            completedBySkuId: transfer.skuId,
            transfer,
            reward: afterReward.rewardHistory[transfer.groupId],
            screenshot: (await capture(
              `${String(40 + Object.keys(route.groupEvidence).length).padStart(2, '0')}-restocked-${transfer.groupId}`,
              { groupId: transfer.groupId, completedBySkuId: transfer.skuId },
            )).file,
          };
        }

        if (transfer.groupId === 'cooler'
          && afterReward.snapshot.restockMilestones.cooler
          && (await coolerSnapshot('cooler-group-complete')).state?.door?.state === 'open') {
          const closeFocus = await focusFixture('cold_drinks', /\[E\].*close/i, 1.05);
          await page.keyboard.press('e');
          await waitForCoolerState('closed');
          entry.controls.push('E close cooler after its complete conserved restock');
          await capture('45-restocked-cooler-door-closed', { focus: closeFocus.focus });
        }

        if (!midPauseComplete
          && afterReward.snapshot.restockMilestones.apparel
          && transfer.groupId === 'apparel') {
          const completed = afterReward.groupIds.filter((groupId) => (
            afterReward.snapshot.restockMilestones[groupId]
          ));
          requireCheck(
            'mid-restock-checkpoint-is-exactly-three-groups',
            JSON.stringify(completed) === JSON.stringify(['balls', 'accessories', 'apparel']),
            'The deliberate pause did not occur after exactly balls, accessories, and apparel.',
            afterReward,
          );
          await stopGameplayCapture();
          const before = {
            inventory: await inventorySnapshot('before-mid-restock-pause-menu-save'),
            cartons: await starterCartonCensus(),
            restoration: afterReward,
          };
          route.pauseMenuCheckpoint = {
            before,
            route: await pauseMenuSaveLoadMidRestock(before),
          };
          midPauseComplete = true;
          await startGameplayCapture('starter-cartons-segment-2-after-load');
        }
      }
      entry.final = await boxSnapshot(carton.id);
      requireCheck(
        `${entry.initial.starterCartonId}-emptied-through-normal-controls`,
        entry.final.qty === 0
          && entry.final.lifecycle === 'EMPTY'
          && entry.final.contents.every((content) => content.remainingQuantity === 0),
        `Starter carton ${entry.initial.starterCartonId} was not exactly emptied.`,
        entry.final,
      );
      await capture(`${entry.evidenceStem}-empty-conserved-carton`, entry.final);
    }
    await stopGameplayCapture();

    route.totalArmfuls = totalArmfuls;
    route.finalInventory = await inventorySnapshot('after-all-three-cartons');
    route.finalCartons = await starterCartonCensus();
    route.finalRestoration = await restorationRewardSnapshot('after-all-six-groups');
    requireCheck(
      'all-three-starter-cartons-opened-and-emptied',
      route.finalCartons.starterBoxCount === 3
        && route.finalCartons.cartons.every((entry) => (
          entry.qty === 0
            && entry.contentQuantity === 0
            && entry.lifecycle === 'EMPTY'
            && entry.contentBacking.every((content) => (
              content.remainingQuantity === 0 && content.deliveredUnopened === 0
            ))
        )),
      'One of the three authoritative cartons retained stock after the full route.',
      route.finalCartons,
    );
    requireCheck(
      'all-starter-lines-full-on-authoritative-fixtures',
      Object.values(route.finalInventory.lines).every((line) => (
        line.shelf === line.entitlement
          && line.back === 0
          && line.carry === 0
          && line.customerHeld === 0
          && line.cartonRemaining === 0
          && line.physicalTotal === line.entitlement
          && line.lifecycle.onHand === line.entitlement
      )),
      'A starter line was not fully and conservatively stocked on its authored fixture.',
      route.finalInventory,
    );
    requireCheck(
      'all-six-restock-groups-complete',
      route.finalRestoration.groupIds.length === 6
        && route.finalRestoration.groupIds.every((groupId) => (
          route.finalRestoration.groupComplete[groupId]
            && route.finalRestoration.snapshot.restockMilestones[groupId]
        )),
      'Not every starter group reached its exact furnished capacity.',
      route.finalRestoration,
    );
    requireCheck(
      'all-six-restock-reputation-awards-exactly-once',
      route.finalRestoration.groupIds.every((groupId) => {
        const history = route.finalRestoration.rewardHistory[groupId];
        return route.finalRestoration.processed[groupId]
          && history.length === 1
          && history[0].source === 'clubhouse-restoration'
          && history[0].sourceId === `restock:${groupId}`
          && history[0].categoryDeltas.retail === 0.3;
      }),
      'A restock reward was missing, duplicated, or had the wrong exact reputation delta.',
      route.finalRestoration,
    );
    requireCheck(
      'six-restock-rewards-add-exactly-one-point-eight-retail-reputation',
      Math.abs(
        route.finalRestoration.reputation.retail
          - route.initialRestoration.reputation.retail
          - 1.8
      ) < 0.0001,
      'The six exact-once +0.3 retail awards did not total +1.8.',
      {
        before: route.initialRestoration.reputation,
        after: route.finalRestoration.reputation,
      },
    );
    requireCheck(
      'mid-restock-pause-menu-save-load-exercised',
      midPauseComplete && !!route.pauseMenuCheckpoint?.route?.saveScreenshot,
      'The deliberate mid-restock pause-menu slot save/load did not run.',
      route.pauseMenuCheckpoint,
    );
    await capture('49-all-six-groups-restocked-final', {
      groups: route.finalRestoration.snapshot.restockMilestones,
      rewardIds: route.finalRestoration.rewardIds,
      totalArmfuls,
    });
    return route;
  }

  try {
    currentPhase = 'fresh-bootstrap';
    writeRunState('running');
    await boot();
    fixture = await fixEnvironment();
    requireCheck(
      'locked-runner-fixed-seed',
      fixture.runnerBootstrapSeed === 424242,
      'The acceptance driver was not launched against the runner --bootstrap seed 424242.',
      fixture,
    );
    requireCheck(
      'fixed-two-pm-time',
      fixture.localTimeMinutes === 14 * 60 && fixture.weather?.locked === true,
      'The repeatable 14:00/weather fixture was not established.',
      fixture,
    );
    requireCheck(
      'fresh-campaign-furnished-start',
      fixture.campaignEnabled
        && fixture.campaignFurnishedStartVersion > 0
        && fixture.starterRestockVersion === 1,
      'The bootstrap did not produce the Pine Hills furnished campaign start.',
      fixture,
    );

    currentPhase = 'three-carton-census';
    inventoryBefore = await inventorySnapshot('fresh-bootstrap-before-controls');
    cartonCensus = await starterCartonCensus();
    requireCheck(
      'exactly-three-starter-cartons',
      cartonCensus.starterBoxCount === 3
        && cartonCensus.cartons.length === 3
        && new Set(cartonCensus.cartons.map((entry) => entry.starterCartonId)).size === 3
        && cartonCensus.expectedSpecIds.every((specId, index) => (
          cartonCensus.cartons.some((entry) => (
            entry.starterCartonId === specId
              && entry.starterCartonOrdinal === index + 1
              && entry.starterCartonCount === 3
          ))
        )),
      'Fresh Pine Hills did not expose exactly the three expected starter cartons.',
      cartonCensus,
    );
    requireCheck(
      'three-cartons-inventory-backed',
      cartonCensus.cartons.every((entry) => (
        entry.inventoryBacked
        && entry.qty === entry.contentQuantity
        && entry.placementValidation.ok
        && entry.starterPlacement?.validated === true
      )),
      'A starter carton was not lot-backed, conserved, or placement-valid.',
      cartonCensus.cartons,
    );
    requireCheck(
      'three-cartons-rendered',
      cartonCensus.cartons.every((entry) => (
        entry.scene.sceneRootCount === 1 && entry.scene.rendered
      )),
      'A starter carton lacked exactly one visible scene root.',
      cartonCensus.cartons.map((entry) => entry.scene),
    );
    requireCheck(
      'fresh-starter-inventory-conserved',
      Object.values(inventoryBefore.lines).every((entry) => (
        entry.physicalTotal === entry.entitlement
        && entry.lifecycle.onHand === entry.entitlement
        && entry.starterRetailQuantity === entry.entitlement
      )),
      'Fresh starter inventory did not conserve every entitlement across shelf/carton/lots.',
      inventoryBefore,
    );

    for (let index = 0; index < cartonCensus.cartons.length; index += 1) {
      const carton = cartonCensus.cartons[index];
      const focused = await focusCarton(carton.id, /\[E\] pick up/i);
      const visual = await projectedCartonVisual(carton.id);
      carton.reachability = {
        reachable: focused.focus.nearestCartonId === carton.id
          && focused.focus.nearestCartonDistance < 0.35,
        pose: focused.pose,
        focus: focused.focus,
        visual,
      };
      await capture(
        `${String(index + 1).padStart(2, '0')}-starter-carton-${carton.starterCartonId}`,
        { boxId: carton.id, reachability: carton.reachability },
      );
    }
    requireCheck(
      'three-cartons-player-reachable',
      cartonCensus.cartons.every((entry) => (
        entry.reachability?.reachable
        && entry.reachability?.visual?.intersectsViewport
        && entry.reachability?.visual?.bounds?.area > 400
      )),
      'A starter carton could not be focused and visibly framed from a derived player approach.',
      cartonCensus.cartons.map((entry) => entry.reachability),
    );

    currentPhase = 'cooler-normal-controls-manual-slot-save-load';
    try {
      coolerRoute = await exerciseCoolerPersistence();
    } catch (error) {
      const blocker = errorRecord(currentPhase, error, {
        cooler: await coolerSnapshot('cooler-blocker').catch(() => null),
      });
      blockers.push(blocker);
      coolerRoute = { blocked: true, blocker };
      await capture('98-cooler-route-blocker', blocker).catch(() => {});
    }

    if (browserReady) {
      currentPhase = 'post-pause-load-carton-authority';
      inventoryAfterCoolerPauseLoad = await inventorySnapshot('after-cooler-pause-menu-load');
      const postPauseLoadCensus = await starterCartonCensus();
      check(
        'three-cartons-survive-cooler-pause-menu-load',
        postPauseLoadCensus.starterBoxCount === 3
          && postPauseLoadCensus.cartons.every((entry) => entry.inventoryBacked && entry.scene.rendered),
        postPauseLoadCensus,
      );
      check(
        'cooler-pause-menu-save-load-preserves-starter-inventory',
        inventoryBefore && Object.keys(inventoryBefore.lines).every((skuId) => (
          inventoryBefore.lines[skuId].physicalTotal
            === inventoryAfterCoolerPauseLoad.lines[skuId].physicalTotal
          && inventoryBefore.lines[skuId].lifecycle.onHand
            === inventoryAfterCoolerPauseLoad.lines[skuId].lifecycle.onHand
        )),
        { before: inventoryBefore, after: inventoryAfterCoolerPauseLoad },
      );

      currentPhase = 'all-three-cartons-all-six-groups-normal-controls';
      try {
        cartonRoute = await exerciseAllStarterCartons(postPauseLoadCensus);
      } catch (error) {
        const blocker = errorRecord(currentPhase, error, {
          cartons: await starterCartonCensus().catch(() => null),
          carry: await page.evaluate(() => (
            window.__fw?.state?.shop?.carry
              ? JSON.parse(JSON.stringify(window.__fw.state.shop.carry))
              : null
          )).catch(() => null),
          focus: await focusInfo().catch(() => null),
        });
        blockers.push(blocker);
        cartonRoute = {
          blocked: true,
          strongestNormalControlPath: 'No delivery or inventory state was injected after the blocker.',
          blocker,
          stateRemainder: blocker.evidence,
        };
        await capture('99-carton-route-blocker-state-remainder', blocker).catch(() => {});
      }
    }
  } catch (error) {
    const blocker = errorRecord(currentPhase, error);
    blockers.push(blocker);
    await capture('97-fatal-acceptance-blocker', blocker).catch(() => {});
  } finally {
    await stopGameplayCapture().catch((error) => {
      blockers.push(errorRecord('stop-audio-bearing-gameplay-capture', error));
    });
    await page.keyboard.up('e').catch(() => {});
    await page.keyboard.up('a').catch(() => {});
    await page.keyboard.up('d').catch(() => {});
    await page.mouse.up({ button: 'left' }).catch(() => {});
    await collectInputTrace().catch(() => {});
    if (browserReady) {
      inventoryAfter = await inventorySnapshot('final-after-normal-controls').catch(() => null);
    }
  }

  const conservation = inventoryBefore && inventoryAfter ? {
    perSku: Object.fromEntries(Object.keys(inventoryBefore.lines).map((skuId) => {
      const before = inventoryBefore.lines[skuId];
      const after = inventoryAfter.lines[skuId];
      return [skuId, {
        beforePhysical: before.physicalTotal,
        afterPhysical: after.physicalTotal,
        beforeLifecycleOnHand: before.lifecycle.onHand,
        afterLifecycleOnHand: after.lifecycle.onHand,
        entitlement: before.entitlement,
        conserved: before.physicalTotal === after.physicalTotal
          && before.lifecycle.onHand === after.lifecycle.onHand
          && after.physicalTotal === after.lifecycle.onHand
          && after.physicalTotal === before.entitlement,
      }];
    })),
  } : null;
  if (conservation) {
    conservation.ok = Object.values(conservation.perSku).every((entry) => entry.conserved);
    check(
      'inventory-conserved-before-after',
      conservation.ok,
      conservation,
    );
  }

  const allowedWarning = /PCFSoftShadowMap has been deprecated/i;
  const blockingDiagnostics = diagnostics.filter((entry) => (
    entry.kind === 'console:error'
    || (entry.kind === 'console:warning' && !allowedWarning.test(entry.message))
    || entry.kind === 'pageerror'
    || entry.kind === 'response:error'
    || (entry.kind === 'requestfailed' && !/ERR_ABORTED/i.test(entry.message))
  ));
  check(
    'two-audio-bearing-gameplay-segments-span-mid-restock-load',
    mediaCaptures.length === 2
      && mediaCaptures.every((entry) => (
        entry.bytesOnDisk > 100_000
          && entry.audioPeak > 0.0001
          && entry.nonSilentAudioWindows > 0
      )),
    mediaCaptures,
  );
  const requiredAssertionsPassed = assertions.every((entry) => entry.ok);
  const overallOk = blockers.length === 0
    && requiredAssertionsPassed
    && blockingDiagnostics.length === 0
    && conservation?.ok === true;
  const result = {
    ok: overallOk,
    status: overallOk ? 'passed' : (blockers.length ? 'blocked' : 'failed'),
    capturedAt: new Date().toISOString(),
    launch: [
      `$env:PINE_HILLS_STOCK_ITERATION='${iteration}'`,
      `$env:PINE_HILLS_STOCK_PHASE='${phaseName}'`,
      `$env:PINE_HILLS_STOCK_COOLER_OUT='${relative(out)}'`,
      `$env:VIDEO_DIR='${relative(path.join(out, 'video'))}'`,
      `$env:QA_RESULT_PATH='${relative(resultPath)}'`,
      'node tools/qa/run-playwright.cjs tools/qa/pine-hills-starter-stock-cooler-acceptance.js --bootstrap',
    ].join('; '),
    methodology: {
      runner: 'tools/qa/run-playwright.cjs owns the Playwright lock and fresh --bootstrap save.',
      fixtureBoundary: [
        'Fresh relaxed empire seed 424242 and first campaign property come from --bootstrap.',
        'Clock is paused at 14:00 with fixed clear weather; organic walk-ins are disabled.',
        'Camera poses are derived from live carton roots, FIXTURES/fixtureBrowsePoint, STOCKROOM bounds/packing datum, and live previewBoxPlacement.',
        'No inventory, lot, carton lifecycle, carry, shelf, or cooler-door value is injected.',
      ],
      normalControls: [
        'E opens/closes the cooler and all three cartons, picks up and places each carton, tears each tape in one press, opens all flaps, and takes every armful.',
        'Cartons open with three E presses and no tool (the box cutter was deleted 2026-07-30).',
        'Held E stocks every starter SKU on the authoritative fixture for balls, accessories, apparel, headwear, drinks, and snacks.',
        'P > Save game > Save here > Replace and save and P > Load game > Load > Load game exercise the deliberate mid-restock slot checkpoint.',
      ],
      persistence: [
        'Cooler contract: pause menu -> Save game -> Save here (slot 1) -> Resume -> pause menu -> Load game -> Load -> visible Load game confirmation.',
        'Mid-restock contract: pause menu -> Save game -> Save here (slot 1) -> visible Replace and save confirmation -> Resume -> pause menu -> Load game -> Load -> visible Load game confirmation.',
      ],
      cutterFallbackPolicy: 'If the tear press fails, the driver records the exact box/carry/focus remainder and performs no simulation shortcut.',
    },
    viewport,
    fixture,
    cartonCensus,
    coolerRoute,
    cartonRoute,
    inventory: {
      before: inventoryBefore,
      afterCoolerPauseLoad: inventoryAfterCoolerPauseLoad,
      after: inventoryAfter,
      conservation,
    },
    assertions,
    screenshots,
    mediaCaptures,
    inputTraceSegments,
    diagnostics: {
      entries: diagnostics,
      blocking: blockingDiagnostics,
      counts: diagnostics.reduce((counts, entry) => ({
        ...counts,
        [entry.kind]: (counts[entry.kind] || 0) + 1,
      }), {}),
    },
    blocker: blockers[0] || null,
    blockers,
    resultPath: relative(resultPath),
  };

  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  currentPhase = 'complete';
  writeRunState(result.ok ? 'passed' : 'failed', { result: relative(resultPath) });
  return result;
}
