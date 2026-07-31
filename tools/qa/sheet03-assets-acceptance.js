async (page) => {
  // SHEET 03 / ASSETS 21-30 LIVE ACCEPTANCE
  //
  // Launch through the normal isolated runner:
  //   node tools/qa/run-playwright.cjs tools/qa/sheet03-assets-acceptance.js --bootstrap
  //
  // Optional evidence overrides:
  //   SHEET03_QA_OUT=qa/.../sheet03 SHEET03_QA_ITERATION=iteration-2
  //   VIDEO_DIR=qa/.../sheet03/video
  //
  // Direct state setup is deliberately limited to a fixed clock/weather fixture
  // and exact Sheet-03 shelf/back counts. Every restock, fixture move/turn/set-down,
  // save, and load then travels through the player's keyboard or pause-menu controls.
  // Organic fixture browsing is forced only at the arrival boundary; planning,
  // walking, retargeting and shelf debit remain the production customer path.
  // A second documented sendToCounter debit isolates save/load recovery.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.resolve(repo, process.env.SHEET03_QA_OUT
    || 'qa/assets_01_50_master/after/sheet03/sheet03-assets-acceptance');
  fs.mkdirSync(out, { recursive: true });
  const iterationTag = String(process.env.SHEET03_QA_ITERATION || 'iteration-1')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'iteration-1';

  const viewport = { width: 1600, height: 900 };
  const evidence = [];
  const routeLog = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    error: request.failure()?.errorText || 'request failed',
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
    });
  });

  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  async function shot(name) {
    // Iteration-tagged filenames preserve four-pass evidence even when a caller
    // deliberately reuses one output root. The asset/camera suffixes stay fixed,
    // which makes side-by-side tooling pair them without inspecting pixels.
    const file = path.join(out, `${iterationTag}-${name}`);
    await page.screenshot({ path: file });
    evidence.push(file);
    return file;
  }

  const ASSETS = Object.freeze([
    {
      asset: 21,
      id: 'asset21-apparel-wall',
      title: 'Apparel wall display',
      fixtureIds: ['apparel_display'],
      camera: { x: 3.15, z: 1.30, tx: 5.44, tz: 1.30, pitch: -0.16 },
    },
    {
      asset: 22,
      id: 'asset22-hat-wall',
      title: 'Hat wall',
      fixtureIds: ['hatstand'],
      camera: { x: -3.40, z: 0.20, tx: -3.40, tz: -1.60, pitch: -0.12 },
    },
    {
      asset: 23,
      id: 'asset23-accessory-slatwall',
      title: 'Accessory slatwall runs',
      fixtureIds: ['shelf_acc', 'shelf_small'],
      camera: { x: -2.10, z: -3.55, tx: -2.10, tz: -6.15, pitch: -0.12 },
    },
    {
      asset: 24,
      id: 'asset24-club-rack',
      title: 'Driver and iron club racks',
      fixtureIds: ['rack_drivers', 'rack_irons'],
      camera: { x: -7.05, z: -2.20, tx: -9.90, tz: -2.20, pitch: -0.34 },
    },
    {
      asset: 25,
      id: 'asset25-putter-rack',
      title: 'Putter rack',
      fixtureIds: ['rack_putters'],
      camera: { x: -7.80, z: 2.02, tx: -9.90, tz: 2.02, pitch: -0.34 },
    },
    {
      asset: 26,
      id: 'asset26-bag-display',
      title: 'Bag display',
      fixtureIds: ['bagstand'],
      camera: { x: 2.20, z: -0.25, tx: 2.20, tz: -2.60, pitch: -0.20 },
    },
    {
      asset: 27,
      id: 'asset27-shoe-wall',
      title: 'Shoe wall and fitting bench',
      fixtureIds: ['shoerack'],
      camera: { x: 3.05, z: -0.60, tx: 5.10, tz: -0.60, pitch: -0.17 },
    },
    {
      asset: 28,
      id: 'asset28-ball-shelf',
      title: 'Ball wall',
      fixtureIds: ['shelf_balls'],
      camera: { x: -6.90, z: -4.05, tx: -6.90, tz: -6.15, pitch: -0.30 },
    },
    {
      asset: 29,
      id: 'asset29-snack-shelf',
      title: 'Grab and Go shelf',
      fixtureIds: ['snackrack'],
      camera: { x: -6.60, z: 3.75, tx: -6.60, tz: 6.02, pitch: -0.20 },
    },
    {
      asset: 30,
      id: 'asset30-rangefinder-display',
      title: 'Rangefinder display',
      fixtureIds: ['feature'],
      camera: { x: -3.20, z: 5.15, tx: -3.20, tz: 3.80, pitch: -0.20 },
    },
  ]);

  // Every actual retail fixture using Sheet-03 geometry receives its own normal-E
  // restock. Assets 23 and 24 each have two live instances, hence twelve actions.
  const RESTOCK_FIXTURE_IDS = Object.freeze(ASSETS.flatMap((asset) => asset.fixtureIds));
  const PERFORMANCE_CAMERA = Object.freeze({
    id: 'sheet03-performance-overview',
    x: -4.15, z: 4.45, tx: -4.45, tz: -2.15, pitch: -0.04,
  });
  const PROJECT_BASELINE = Object.freeze({
    source: 'qa/assets_01_50_master/baseline/current/baseline-result.json',
    averageFps: 46.63610588515859,
    onePercentLowFps: 27.155465037338228,
    worstFrameMs: 38.900000000001455,
    drawCalls: 15478,
    renderedTriangles: 22046858,
    sceneTriangles: 4269260,
    materialCount: 468,
    geometriesInMemory: 1818,
    texturesInMemory: 325,
  });
  const PERF_BUDGET = Object.freeze({
    averageFpsRatio: 0.70,
    onePercentLowRatio: 0.60,
    // rAF is quantized to the host refresh interval. At 120 Hz, a scene that
    // misses only the occasional refresh reports a ~60 FPS 1% low while a
    // perfectly capped empty scene reports ~116, making their ratio ~0.52.
    // Accept that matched-state ratio only when it clears the relative gate OR
    // the full scene independently holds this commercial-playability floor.
    minimumOnePercentLowFps: 55,
    // Iteration 3 established the honest cost of all 297 authored shelf
    // facings through the complete post stack. Keep a bounded 12% headroom
    // while the real regression gate below remains the captured project baseline.
    addedDrawCalls: 2200,
    addedRenderedTriangles: 1500000,
    addedSceneMaterials: 120,
    addedSceneTextures: 40,
    addedGeometriesInMemory: 240,
    addedTexturesInMemory: 40,
    addedEventListeners: 20,
    addedTextureMemoryBytes: 256 * 1024 * 1024,
    addedUiUpdatesPerSecond: 20,
    baselineAverageFpsRatio: 0.90,
    baselineOnePercentLowRatio: 0.80,
    baselineDrawCallsRatio: 1.05,
    baselineRenderedTrianglesRatio: 1.05,
    baselineSceneTrianglesRatio: 1.05,
    baselineMaterialsRatio: 1.05,
    baselineGeometriesRatio: 1.05,
    baselineTexturesRatio: 1.05,
  });

  async function waitForGame() {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      return clubhouse && (!clubhouse.assetsReady || clubhouse.assetsReady());
    }, null, { timeout: 90000 });
    await page.waitForTimeout(900);
  }

  // Camera coordinates and targets are clubhouse-interior-local yards. Three's
  // camera looks down local -Z, so yaw toward a flat XZ target is atan2(-dx,-dz).
  // Keeping this one helper for screenshots, performance, and interactions makes
  // every comparison use the exact same first-person transform convention.
  async function establishPlayerCamera(camera) {
    const pose = await page.evaluate((definition) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + definition.x;
      walk.state.z = origin.z + definition.z;
      const targetX = origin.x + definition.tx;
      const targetZ = origin.z + definition.tz;
      const dx = targetX - walk.state.x;
      const dz = targetZ - walk.state.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = definition.pitch;
      return {
        local: { x: definition.x, z: definition.z, tx: definition.tx, tz: definition.tz },
        world: { x: walk.state.x, z: walk.state.z, targetX, targetZ },
        yaw: walk.state.yaw,
        pitch: walk.state.pitch,
      };
    }, camera);
    await page.waitForTimeout(260);
    return pose;
  }

  async function ensureLookInput() {
    if (await page.evaluate(() => document.pointerLockElement === document.getElementById('game'))) return true;
    await page.locator('#game').click({
      position: { x: viewport.width / 2, y: viewport.height / 2 },
      force: true,
    });
    const acquired = await page.waitForFunction(() => (
      document.pointerLockElement === document.getElementById('game')
    ), null, { timeout: 1500 }).then(() => true).catch(() => false);
    if (!acquired) {
      // Headless Chromium can reject Pointer Lock after the same normal canvas
      // click a player uses. Hide only that automation reminder in retained
      // art-review media; gameplay keyboard controls remain the real path.
      await page.evaluate(() => {
        const hint = document.querySelector('.shop-lockhint');
        if (hint) hint.style.visibility = 'hidden';
      });
    }
    await page.waitForTimeout(180);
    return acquired;
  }

  async function releaseLookInput() {
    if (!await page.evaluate(() => !!document.pointerLockElement)) return;
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
  }

  async function setSheetStock(mode) {
    return page.evaluate(async ({ fixtureIds, stockMode }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const { placedFixtures } = await import('/src/sim/layout.js');
      const { capacityOf } = await import('/src/data/fixtureSlots.js');
      const fixtures = placedFixtures(app.state)
        .filter((fixture) => fixtureIds.includes(fixture.id));
      const touched = [];
      for (const fixture of fixtures) {
        for (const skuId of fixture.skus || []) {
          const entry = app.state.shop.inventory[skuId];
          const capacity = capacityOf(skuId);
          if (!entry) throw new Error(`Missing inventory entry ${skuId}.`);
          let shelf = 0;
          let back = capacity;
          if (stockMode === 'partial') {
            shelf = Math.max(1, Math.floor(capacity / 2));
            back = capacity - shelf;
          } else if (stockMode === 'full') {
            shelf = capacity;
            back = 0;
          }
          entry.shelf = shelf;
          entry.back = back;
          touched.push({ fixtureId: fixture.id, skuId, capacity, shelf, back });
        }
      }
      clubhouse.rebuildStock?.();
      return touched;
    }, { fixtureIds: RESTOCK_FIXTURE_IDS, stockMode: mode });
  }

  async function snapshotSheet(label) {
    return page.evaluate(async ({ stateLabel, assets }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const { placedFixtures } = await import('/src/sim/layout.js');
      const { capacityOf } = await import('/src/data/fixtureSlots.js');
      const allFixtures = placedFixtures(app.state);
      const fixturesById = new Map(allFixtures.map((fixture) => [fixture.id, fixture]));
      const inventory = app.state.shop.inventory;
      let nonFiniteVisibleObjects = 0;
      let nonFiniteVisibleVertices = 0;
      app.scene3d.scene.updateMatrixWorld(true);
      clubhouse.interior.traverseVisible((object) => {
        if (!object.matrixWorld.elements.every(Number.isFinite)) nonFiniteVisibleObjects += 1;
        if (!object.isMesh || !object.geometry?.attributes?.position?.array) return;
        for (const value of object.geometry.attributes.position.array) {
          if (!Number.isFinite(value)) nonFiniteVisibleVertices += 1;
        }
      });

      function bakedStockAt(fixture) {
        const candidates = clubhouse.stockDisplayDiagnostics().displays
          .filter((display) => display.fixtureId === fixture.id && display.visible);
        return {
          roots: candidates.length,
          meshes: candidates.reduce((sum, display) => sum + display.meshes, 0),
          triangles: candidates.reduce((sum, display) => sum + display.triangles, 0),
          candidates,
        };
      }

      const assetStates = assets.map((asset) => ({
        asset: asset.asset,
        id: asset.id,
        fixtures: asset.fixtureIds.map((fixtureId) => {
          const fixture = fixturesById.get(fixtureId);
          if (!fixture) return { fixtureId, missing: true };
          const skus = (fixture.skus || []).map((skuId) => ({
            skuId,
            shelf: Number(inventory[skuId]?.shelf || 0),
            back: Number(inventory[skuId]?.back || 0),
            capacity: capacityOf(skuId),
          }));
          return {
            fixtureId,
            kind: fixture.kind,
            title: fixture.title,
            x: fixture.x,
            z: fixture.z,
            ry: fixture.ry || 0,
            skus,
            shelfTotal: skus.reduce((sum, sku) => sum + sku.shelf, 0),
            capacityTotal: skus.reduce((sum, sku) => sum + sku.capacity, 0),
            stockRender: bakedStockAt(fixture),
          };
        }),
      }));
      return {
        label: stateLabel,
        assetStates,
        heldSheet03: (app.state.shop.held || []).filter((unit) => (
          assetStates.some((asset) => asset.fixtures.some((fixture) => (
            fixture.skus?.some((sku) => sku.skuId === unit.skuId)
          )))
        )).map((unit) => ({ uid: unit.uid, skuId: unit.skuId })),
        nonFiniteVisibleObjects,
        nonFiniteVisibleVertices,
      };
    }, { stateLabel: label, assets: ASSETS });
  }

  function assertStockMode(snapshot, mode) {
    assert(snapshot.nonFiniteVisibleObjects === 0,
      `${mode}: ${snapshot.nonFiniteVisibleObjects} visible objects have non-finite transforms.`);
    assert(snapshot.nonFiniteVisibleVertices === 0,
      `${mode}: ${snapshot.nonFiniteVisibleVertices} visible geometry values are non-finite.`);
    assert(snapshot.heldSheet03.length === 0,
      `${mode}: Sheet-03 inventory leaked into the held ledger: ${JSON.stringify(snapshot.heldSheet03)}.`);
    for (const asset of snapshot.assetStates) {
      for (const fixture of asset.fixtures) {
        assert(!fixture.missing, `${mode}: fixture ${fixture.fixtureId} is missing.`);
        for (const sku of fixture.skus) {
          if (mode === 'empty') {
            assert(sku.shelf === 0,
              `${mode}: ${fixture.fixtureId}/${sku.skuId} has ${sku.shelf} units on shelf.`);
          } else if (mode === 'partial') {
            assert(sku.shelf > 0 && sku.shelf < sku.capacity,
              `${mode}: ${fixture.fixtureId}/${sku.skuId} is not strictly part-full: ${JSON.stringify(sku)}.`);
          } else if (mode === 'full') {
            assert(sku.shelf === sku.capacity,
              `${mode}: ${fixture.fixtureId}/${sku.skuId} is ${sku.shelf}/${sku.capacity}.`);
          }
        }
        if (mode === 'full') {
          assert(fixture.stockRender.triangles > 0,
            `${mode}: ${fixture.fixtureId} has no visible baked stock geometry.`);
        }
      }
    }
  }

  async function captureAssetCameras(prefix) {
    await ensureLookInput();
    const captures = [];
    for (const [index, asset] of ASSETS.entries()) {
      const pose = await establishPlayerCamera(asset.camera);
      const file = await shot(
        `${prefix}-${String(index + 1).padStart(2, '0')}-${asset.id}-player-camera.png`,
      );
      captures.push({ asset: asset.asset, id: asset.id, title: asset.title, pose, file });
    }
    return captures;
  }

  async function aimAtFixture(fixtureId, distance = 1.55, pitch = -0.10) {
    return page.evaluate(async ({ id, standOff, viewPitch }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const { placedFixtures } = await import('/src/sim/layout.js');
      const fixture = placedFixtures(app.state).find((entry) => entry.id === id);
      if (!fixture) throw new Error(`Fixture ${id} is not placed.`);
      const origin = clubhouse.interior.position;
      const angle = fixture.ry || 0;
      const localX = fixture.x + Math.sin(angle) * standOff;
      const localZ = fixture.z + Math.cos(angle) * standOff;
      const targetX = origin.x + fixture.x;
      const targetZ = origin.z + fixture.z;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + localX;
      walk.state.z = origin.z + localZ;
      const dx = targetX - walk.state.x;
      const dz = targetZ - walk.state.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = viewPitch;
      return {
        fixtureId: id,
        title: fixture.title,
        fixture: { x: fixture.x, z: fixture.z, ry: fixture.ry || 0 },
        playerLocal: { x: localX, z: localZ },
        yaw: walk.state.yaw,
        pitch: walk.state.pitch,
      };
    }, { id: fixtureId, standOff: distance, viewPitch: pitch });
  }

  async function fixtureInventory(fixtureId) {
    return page.evaluate(async (id) => {
      const app = window.__fw;
      const { placedFixtures } = await import('/src/sim/layout.js');
      const { capacityOf } = await import('/src/data/fixtureSlots.js');
      const fixture = placedFixtures(app.state).find((entry) => entry.id === id);
      if (!fixture) return null;
      return {
        fixtureId: id,
        title: fixture.title,
        skus: fixture.skus.map((skuId) => ({
          skuId,
          shelf: Number(app.state.shop.inventory[skuId]?.shelf || 0),
          back: Number(app.state.shop.inventory[skuId]?.back || 0),
          capacity: capacityOf(skuId),
        })),
      };
    }, fixtureId);
  }

  async function normalRestock(fixtureId) {
    const aim = await aimAtFixture(fixtureId);
    await ensureLookInput();
    await page.waitForFunction(({ title }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return label.toLowerCase().includes(title.toLowerCase()) && /\[E\]\s*restock/i.test(label);
    }, { title: aim.title }, { timeout: 6000 });
    const focusBefore = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
    const before = await fixtureInventory(fixtureId);
    assert(before && before.skus.every((sku) => sku.shelf === 0 && sku.back === sku.capacity),
      `${fixtureId}: deterministic empty/back state drifted before E: ${JSON.stringify(before)}.`);
    await page.keyboard.press('e');
    await page.waitForFunction(async (id) => {
      const app = window.__fw;
      const { placedFixtures } = await import('/src/sim/layout.js');
      const { capacityOf } = await import('/src/data/fixtureSlots.js');
      const fixture = placedFixtures(app.state).find((entry) => entry.id === id);
      return fixture && fixture.skus.every((skuId) => (
        Number(app.state.shop.inventory[skuId]?.shelf || 0) === capacityOf(skuId)
        && Number(app.state.shop.inventory[skuId]?.back || 0) === 0
      ));
    }, fixtureId, { timeout: 7000 });
    await page.waitForTimeout(260);
    const after = await fixtureInventory(fixtureId);
    const focusAfter = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
    const record = { fixtureId, aim, focusBefore, focusAfter, before, after, control: 'E' };
    routeLog.push({ action: 'normal-E-restock', ...record });
    return record;
  }

  async function samplePerformance(label) {
    const allFrames = [];
    let uiMutationRecords = 0;
    for (let sample = 0; sample < 3; sample += 1) {
      const values = await page.evaluate(() => new Promise((resolve, reject) => {
        const frames = [];
        let mutationRecords = 0;
        const observer = new MutationObserver((records) => { mutationRecords += records.length; });
        observer.observe(document.body, {
          attributes: true, characterData: true, childList: true, subtree: true,
        });
        const watchdog = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Sheet-03 frame sampler received no 2 s rAF window within 10 s.'));
        }, 10000);
        let previous = performance.now();
        const start = previous;
        function tick(now) {
          frames.push(now - previous);
          previous = now;
          if (now - start >= 2000) {
            clearTimeout(watchdog);
            observer.disconnect();
            resolve({ frames: frames.slice(1), mutationRecords });
          }
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }));
      uiMutationRecords += values.mutationRecords;
      allFrames.push(...values.frames.filter((value) => Number.isFinite(value) && value > 0));
    }
    const slowest = [...allFrames].sort((a, b) => b - a);
    const slowCount = Math.max(1, Math.ceil(slowest.length * 0.01));
    const slowMean = slowest.slice(0, slowCount)
      .reduce((sum, value) => sum + value, 0) / slowCount;
    const durationMs = allFrames.reduce((sum, value) => sum + value, 0);

    const renderer = await page.evaluate(() => new Promise((resolve, reject) => {
      const scene3d = window.__fw.scene3d;
      const output = scene3d.renderer;
      const watchdog = setTimeout(() => {
        output.info.autoReset = true;
        reject(new Error('Sheet-03 renderer counters did not receive two rAF intervals within 10 s.'));
      }, 10000);
      output.info.autoReset = false;
      output.info.reset();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const materials = new Set();
        const textures = new Map();
        let visibleMeshes = 0;
        let visibleSceneTriangles = 0;
        scene3d.scene.traverseVisible((object) => {
          if (!object.isMesh || !object.geometry) return;
          visibleMeshes += 1;
          const instances = object.isInstancedMesh ? object.count : 1;
          const triangles = object.geometry.index
            ? object.geometry.index.count / 3
            : (object.geometry.attributes?.position?.count || 0) / 3;
          visibleSceneTriangles += triangles * instances;
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of list) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of [
              'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
              'emissiveMap', 'alphaMap', 'lightMap', 'bumpMap',
            ]) {
              if (material[key]) textures.set(material[key].uuid, material[key]);
            }
          }
        });
        const imageBytes = (image) => {
          if (!image) return 0;
          if (Array.isArray(image)) return image.reduce((sum, entry) => sum + imageBytes(entry), 0);
          const width = Number(image.width || image.videoWidth || 0);
          const height = Number(image.height || image.videoHeight || 0);
          const depth = Number(image.depth || 1);
          if (!(width > 0 && height > 0 && depth > 0)) return 0;
          const data = image.data;
          if (data && Number.isFinite(data.byteLength)) return Number(data.byteLength);
          return width * height * depth * 4;
        };
        let textureMemoryBytes = 0;
        for (const texture of textures.values()) {
          const base = imageBytes(texture.source?.data || texture.image);
          // Three normally allocates a complete mip chain for these PBR maps.
          textureMemoryBytes += Math.round(base * (texture.generateMipmaps === false ? 1 : 4 / 3));
        }
        const result = {
          counterWindow: 'two rendered requestAnimationFrame intervals with WebGLRenderer.info.autoReset disabled',
          drawCalls: output.info.render.calls,
          renderedTriangles: output.info.render.triangles,
          renderedLines: output.info.render.lines,
          renderedPoints: output.info.render.points,
          visibleMeshes,
          visibleSceneTriangles: Math.round(visibleSceneTriangles),
          materialCount: materials.size,
          referencedTextureCount: textures.size,
          textureMemoryBytes,
          textureMemoryMethod: 'estimated referenced decoded bytes; typed-array byteLength or RGBA8 dimensions, plus generated mip chain',
          geometriesInMemory: output.info.memory.geometries,
          texturesInMemory: output.info.memory.textures,
        };
        output.info.autoReset = true;
        clearTimeout(watchdog);
        resolve(result);
      }));
    }));

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metricResult = await cdp.send('Performance.getMetrics');
    const metrics = Object.fromEntries(metricResult.metrics.map((metric) => [metric.name, metric.value]));
    await cdp.detach();
    return {
      label,
      sampleCount: 3,
      sampleDurationMs: 2000,
      frameCount: allFrames.length,
      averageFps: allFrames.length * 1000 / durationMs,
      onePercentLowFps: 1000 / slowMean,
      worstFrameMs: slowest[0] || null,
      renderer,
      browser: {
        jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
        eventListeners: metrics.JSEventListeners ?? null,
        nodes: metrics.Nodes ?? null,
        documents: metrics.Documents ?? null,
        uiUpdatesPerSecond: durationMs > 0 ? uiMutationRecords * 1000 / durationMs : 0,
        uiMutationRecords,
      },
    };
  }

  async function visibleBakedStockAt(localX, localZ, tolerance = 0.045) {
    return page.evaluate(({ x, z, epsilon }) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const roots = clubhouse.stockDisplayDiagnostics().displays.filter((display) => (
        display.visible
        && Math.abs(display.position.x - x) <= epsilon
        && Math.abs(display.position.z - z) <= epsilon
      ));
      return {
        roots: roots.length,
        meshes: roots.reduce((sum, root) => sum + root.meshes, 0),
        triangles: roots.reduce((sum, root) => sum + root.triangles, 0),
        entries: roots,
      };
    }, { x: localX, z: localZ, epsilon: tolerance });
  }

  async function fixturePose(fixtureId) {
    return page.evaluate(async (id) => {
      const { placedFixtures } = await import('/src/sim/layout.js');
      const fixture = placedFixtures(window.__fw.state).find((entry) => entry.id === id);
      return fixture ? {
        id: fixture.id,
        title: fixture.title,
        x: fixture.x,
        z: fixture.z,
        ry: fixture.ry || 0,
      } : null;
    }, fixtureId);
  }

  async function aimBuildFloorAtFixture(fixtureId, distance = 2.0) {
    return page.evaluate(async ({ id, standOff }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const { placedFixtures } = await import('/src/sim/layout.js');
      const fixture = placedFixtures(app.state).find((entry) => entry.id === id);
      if (!fixture) throw new Error(`Build target ${id} is missing.`);
      const angle = fixture.ry || 0;
      const origin = clubhouse.interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + fixture.x + Math.sin(angle) * standOff;
      walk.state.z = origin.z + fixture.z + Math.cos(angle) * standOff;
      const dx = origin.x + fixture.x - walk.state.x;
      const dz = origin.z + fixture.z - walk.state.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      // buildMode's floor ray starts one walk.eye above FLOOR_TOP. This pitch
      // intersects the floor exactly standOff yards ahead at the fixture centre.
      walk.state.pitch = -Math.atan2(Number(walk.state.eye) || 1.75, standOff);
      return {
        fixture: { x: fixture.x, z: fixture.z, ry: fixture.ry || 0 },
        player: { x: walk.state.x - origin.x, z: walk.state.z - origin.z },
        yaw: walk.state.yaw,
        pitch: walk.state.pitch,
      };
    }, { id: fixtureId, standOff: distance });
  }

  async function holdMovementKey(key, milliseconds) {
    await page.keyboard.down(key);
    await page.waitForTimeout(milliseconds);
    await page.keyboard.up(key);
    await page.waitForTimeout(180);
  }

  async function moveStockedFixtureWithNormalControls(fixtureId) {
    const before = await fixturePose(fixtureId);
    assert(before, `${fixtureId}: missing before build-mode move.`);
    const stockBefore = await visibleBakedStockAt(before.x, before.z);
    assert(stockBefore.triangles > 0,
      `${fixtureId}: fixture is not visibly stocked before build-mode move: ${JSON.stringify(stockBefore)}.`);
    await aimBuildFloorAtFixture(fixtureId);
    await ensureLookInput();
    await page.keyboard.press('b');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive(), null, { timeout: 3000 });
    await page.waitForFunction((id) => {
      const build = window.__fw.scene3d.clubhouse().build;
      return build.isActive() && build.label()?.toLowerCase().includes(id.toLowerCase());
    }, before.title, { timeout: 5000 });
    await shot(`31-build-mode-${fixtureId}-before-pick.png`);
    await page.keyboard.press('e');
    await page.waitForFunction((id) => (
      window.__fw.scene3d.clubhouse().build.isCarrying() === id
    ), fixtureId, { timeout: 3000 });
    await page.waitForTimeout(180);
    const carryDiagnostics = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().build.diagnostics?.() || null
    ));
    assert(carryDiagnostics?.carrying === fixtureId,
      `${fixtureId}: build diagnostics lost the carried fixture.`);
    assert(carryDiagnostics.colliderActive === false
      && carryDiagnostics.colliders?.activeCount === 0,
    `${fixtureId}: invisible old collider remained active while carried: ${JSON.stringify(carryDiagnostics)}.`);
    if (fixtureId === 'shoerack') {
      const profile = carryDiagnostics.ghost?.profile;
      assert(profile
        && Math.abs(profile.width - 2.46) < 1e-6
        && Math.abs(profile.depth - 1.36) < 1e-6
        && Math.abs(profile.offsetZ - 0.50) < 1e-6,
      `shoerack: build ghost does not match its asymmetric footprint: ${JSON.stringify(profile)}.`);
    }
    const hiddenAtOldDuringCarry = await visibleBakedStockAt(before.x, before.z);
    assert(hiddenAtOldDuringCarry.triangles === 0,
      `Stock floated at the old ${fixtureId} pose while carried: ${JSON.stringify(hiddenAtOldDuringCarry)}.`);
    await shot(`32-build-mode-${fixtureId}-carried-no-floating-stock-or-collider.png`);

    await page.keyboard.press('r');
    // Movement remains entirely on the normal first-person held-key path. Start
    // by walking/strafe-moving away from the original cell, then use additional
    // normal keys only if the placement validator reports a red ghost.
    const movementInputs = [];
    const move = async (key, milliseconds) => {
      await holdMovementKey(key, milliseconds);
      movementInputs.push({ key: key.toUpperCase(), milliseconds });
    };
    await move('s', 520);
    await move('d', 380);
    const fallbackMoves = [
      ['s', 360], ['a', 620], ['w', 300], ['d', 600], ['s', 320],
    ];
    let placementLabel = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.label() || '');
    for (const [key, milliseconds] of fallbackMoves) {
      if (/\[E\]\s*set it down/i.test(placementLabel)) break;
      await move(key, milliseconds);
      placementLabel = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.label() || '');
    }
    assert(/\[E\]\s*set it down/i.test(placementLabel),
      `${fixtureId}: normal WASD route did not reach a valid set-down: ${placementLabel}.`);

    const hiddenAtOldAfterMove = await visibleBakedStockAt(before.x, before.z);
    assert(hiddenAtOldAfterMove.triangles === 0,
      `Stock reappeared at the old ${fixtureId} pose before set-down.`);
    await page.keyboard.press('e');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isCarrying(), null, { timeout: 5000 });
    await page.waitForTimeout(750);
    const after = await fixturePose(fixtureId);
    const movedDistance = Math.hypot(after.x - before.x, after.z - before.z);
    const rawTurn = ((after.ry - before.ry) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const quarterTurnError = Math.min(
      Math.abs(rawTurn - Math.PI / 2),
      Math.abs(rawTurn - Math.PI * 3 / 2),
    );
    assert(movedDistance >= 0.25,
      `${fixtureId}: normal WASD route did not move the fixture: ${JSON.stringify({ before, after })}.`);
    assert(quarterTurnError < 0.08,
      `${fixtureId}: normal R did not persist a quarter-turn: ${JSON.stringify({ before, after, rawTurn })}.`);
    const oldAfterSetDown = await visibleBakedStockAt(before.x, before.z);
    const newAfterSetDown = await visibleBakedStockAt(after.x, after.z);
    assert(oldAfterSetDown.triangles === 0,
      `${fixtureId}: old stock remained visible after set-down: ${JSON.stringify(oldAfterSetDown)}.`);
    assert(newAfterSetDown.triangles > 0,
      `${fixtureId}: stock did not rebuild at the new pose: ${JSON.stringify(newAfterSetDown)}.`);
    const setDownDiagnostics = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().build.diagnostics?.() || null
    ));
    assert(setDownDiagnostics?.carrying == null && setDownDiagnostics?.ghost?.visible === false,
      `${fixtureId}: build carry state did not close after set-down: ${JSON.stringify(setDownDiagnostics)}.`);
    await page.keyboard.press('b');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isActive(), null, { timeout: 3000 });
    const evidencePose = await aimAtFixture(
      fixtureId,
      fixtureId === 'shoerack' ? 2.65 : 1.80,
      fixtureId === 'shoerack' ? -0.13 : -0.11,
    );
    await page.waitForTimeout(350);
    await shot(`33-build-mode-${fixtureId}-moved-rotated-set-down.png`);
    const result = {
      fixtureId,
      controls: ['B', 'E', 'R', ...movementInputs.map((input) => `${input.key} (held)`), 'E', 'B'],
      movementInputs,
      before,
      after,
      movedDistance,
      rawTurn,
      quarterTurnError,
      placementLabel,
      stockBefore,
      carryDiagnostics,
      hiddenAtOldDuringCarry,
      hiddenAtOldAfterMove,
      oldAfterSetDown,
      newAfterSetDown,
      setDownDiagnostics,
      evidencePose,
    };
    routeLog.push({ action: 'normal-build-mode-move', ...result });
    return result;
  }

  async function spawnOrganicCustomerForFixture(fixtureId) {
    const result = await page.evaluate(({ targetFixtureId }) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.clearWalkins?.();
      for (let attempt = 1; attempt <= 80; attempt += 1) {
        const customer = clubhouse.debugSpawn(false);
        const fixtureStops = customer.stops.filter((stop) => stop.kind === 'fixture');
        const targetIndex = customer.stops.findIndex((stop) => (
          stop.kind === 'fixture'
          && stop.fixtureId === targetFixtureId
          && !!stop.plannedSku
        ));
        // The target must be the first merchandise visit so the proof observes
        // one production browse/retarget/debit path without an earlier pick.
        if (targetIndex === 2) {
          const stop = customer.stops[targetIndex];
          return {
            attempt,
            customerId: customer.customerId,
            name: customer.name,
            targetFixtureId,
            plannedSku: stop.plannedSku,
            stopIndex: targetIndex,
            initialStop: {
              x: stop.x,
              z: stop.z,
              fixtureLocalX: stop.fixtureLocalX,
              fixtureLocalZ: stop.fixtureLocalZ,
            },
            plannedFixtureIds: fixtureStops.map((entry) => entry.fixtureId),
          };
        }
        clubhouse.clearWalkins?.();
      }
      return null;
    }, { targetFixtureId: fixtureId });
    assert(result, `Could not produce an organic first-stop shopper for ${fixtureId} in 80 arrivals.`);
    routeLog.push({ action: 'production-organic-plan-for-movable-fixture', ...result });
    return result;
  }

  async function awaitOrganicRetargetAndDebit(organic, movedFixture) {
    await page.waitForFunction(({ customerId, plannedSku }) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : clubhouse.customers;
      const customer = customers.find((entry) => entry.customerId === customerId);
      return !!customer?.cart?.some((item) => item.skuId === plannedSku);
    }, { customerId: organic.customerId, plannedSku: organic.plannedSku }, { timeout: 45000 });
    const result = await page.evaluate(({ customerId, fixtureId, plannedSku }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : clubhouse.customers;
      const customer = customers.find((entry) => entry.customerId === customerId);
      const stop = customer?.stops?.find((entry) => (
        entry.kind === 'fixture' && entry.fixtureId === fixtureId
      ));
      const inventory = app.state.shop.inventory[plannedSku];
      return {
        customerId,
        fixtureId,
        plannedSku,
        stop: stop ? {
          x: stop.x,
          z: stop.z,
          fixtureLocalX: stop.fixtureLocalX,
          fixtureLocalZ: stop.fixtureLocalZ,
        } : null,
        cart: (customer?.cart || []).map((item) => ({ uid: item.uid, skuId: item.skuId })),
        inventory: { shelf: Number(inventory.shelf), back: Number(inventory.back) },
        customerPosition: customer ? { x: customer.mesh.position.x, z: customer.mesh.position.z } : null,
      };
    }, {
      customerId: organic.customerId,
      fixtureId: organic.targetFixtureId,
      plannedSku: organic.plannedSku,
    });
    assert(result.stop, `Organic shopper lost its ${organic.targetFixtureId} stop.`);
    assert(Math.hypot(
      result.stop.x - organic.initialStop.x,
      result.stop.z - organic.initialStop.z,
    ) >= 0.20, `Organic shopper stop did not retarget with the moved fixture: ${JSON.stringify(result)}.`);
    assert(result.cart.some((item) => item.skuId === organic.plannedSku),
      `Organic shopper never debited ${organic.plannedSku}: ${JSON.stringify(result)}.`);
    assert(Math.hypot(movedFixture.after.x - movedFixture.before.x,
      movedFixture.after.z - movedFixture.before.z) >= 0.25);
    routeLog.push({ action: 'organic-customer-retarget-and-real-shelf-debit', ...result });
    return result;
  }

  async function clearOrganicCustomerAndVerifyReturn(organicResult) {
    const expectedUids = organicResult.cart
      .filter((item) => item.skuId === organicResult.plannedSku)
      .map((item) => item.uid);
    const result = await page.evaluate(({ skuId, customerId, expectedHeldUids }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const entry = app.state.shop.inventory[skuId];
      const customerList = () => (typeof clubhouse.customers === 'function'
        ? clubhouse.customers()
        : clubhouse.customers);
      const before = {
        shelf: Number(entry.shelf),
        back: Number(entry.back),
        heldUids: (app.state.shop.held || []).filter((unit) => unit.skuId === skuId)
          .map((unit) => unit.uid),
        customerPresent: customerList().some((customer) => customer.customerId === customerId),
      };
      clubhouse.clearWalkins?.();
      const after = {
        shelf: Number(entry.shelf),
        back: Number(entry.back),
        heldUids: (app.state.shop.held || []).filter((unit) => unit.skuId === skuId)
          .map((unit) => unit.uid),
        customerPresent: customerList().some((customer) => customer.customerId === customerId),
      };
      return { skuId, customerId, expectedHeldUids, before, after };
    }, {
      skuId: organicResult.plannedSku,
      customerId: organicResult.customerId,
      expectedHeldUids: expectedUids,
    });
    assert(result.before.customerPresent && !result.after.customerPresent,
      `Organic proof customer was not removed exactly once: ${JSON.stringify(result)}.`);
    assert(expectedUids.length === 1 && result.before.heldUids.includes(expectedUids[0])
      && !result.after.heldUids.includes(expectedUids[0]),
    `Organic proof held UID was not returned exactly once: ${JSON.stringify(result)}.`);
    assert(result.after.shelf === result.before.shelf + 1
      && result.after.back === result.before.back,
    `Organic proof unit did not return to the visible shoe wall: ${JSON.stringify(result)}.`);
    assert(result.after.shelf + result.after.back + result.after.heldUids.length
      === result.before.shelf + result.before.back + result.before.heldUids.length,
    `Clearing the organic proof shopper lost or minted ${result.skuId}: ${JSON.stringify(result)}.`);
    routeLog.push({ action: 'organic-proof-customer-cleanup-conserves-unit', ...result });
    return result;
  }

  async function sendDocumentedCustomerDebit(skuId) {
    const result = await page.evaluate(({ id }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const entry = app.state.shop.inventory[id];
      const before = {
        shelf: Number(entry.shelf),
        back: Number(entry.back),
        held: (app.state.shop.held || []).filter((unit) => unit.skuId === id).length,
        cash: Number(app.state.cash),
      };
      const customerName = clubhouse.sendToCounter([id], 'card');
      const after = {
        shelf: Number(entry.shelf),
        back: Number(entry.back),
        held: (app.state.shop.held || []).filter((unit) => unit.skuId === id)
          .map((unit) => ({ uid: unit.uid, skuId: unit.skuId })),
        cash: Number(app.state.cash),
      };
      return { skuId: id, customerName, before, after };
    }, { id: skuId });
    assert(result.customerName, `sendToCounter could not debit ${skuId}.`);
    assert(result.after.shelf === result.before.shelf - 1,
      `${skuId}: documented customer did not debit exactly one shelf unit: ${JSON.stringify(result)}.`);
    assert(result.after.held.length === result.before.held + 1,
      `${skuId}: documented customer did not create exactly one held UID: ${JSON.stringify(result)}.`);
    assert(new Set(result.after.held.map((unit) => unit.uid)).size === result.after.held.length,
      `${skuId}: customer held UIDs are not unique.`);
    assert(result.after.cash === result.before.cash,
      `${skuId}: an unpaid customer changed cash before checkout.`);
    routeLog.push({ action: 'documented-sendToCounter-real-debit', ...result });
    return result;
  }

  async function openPauseMenu() {
    await releaseLookInput();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await page.locator('.pause-veil-ui').count()) return;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(180);
    }
    await page.waitForSelector('.pause-veil-ui', { timeout: 5000 });
  }

  async function saveAndLoadSlotOne() {
    await openPauseMenu();
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    const saveHere = page.getByRole('button', { name: 'Save here', exact: true }).first();
    await saveHere.waitFor({ state: 'visible' });
    await saveHere.click();
    await page.waitForTimeout(450);
    const saveEvidence = await shot('36-pending-held-unit-saved-through-pause-ui.png');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();

    await openPauseMenu();
    await page.getByRole('button', { name: 'Load game', exact: true }).click();
    const load = page.getByRole('button', { name: 'Load', exact: true }).first();
    await load.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent.trim() === 'Load');
      return !!button && !button.disabled;
    }, null, { timeout: 6000 });
    await page.evaluate(() => { window.__sheet03PriorScene = window.__fw.scene3d; });
    await load.click();
    await page.waitForFunction(() => window.__fw?.scene3d
      && window.__fw.scene3d !== window.__sheet03PriorScene
      && window.__fw.scene3d.clubhouse?.(), null, { timeout: 90000 });
    await waitForGame();
    routeLog.push({
      action: 'pause-ui-save-load',
      controls: ['Escape', 'Save game', 'Save here', 'Resume', 'Escape', 'Load game', 'Load'],
      saveEvidence,
    });
    return { saveEvidence };
  }

  function performanceDelta(empty, full) {
    const nullableDelta = (a, b) => (
      Number.isFinite(a) && Number.isFinite(b) ? b - a : null
    );
    return {
      averageFpsRatio: full.averageFps / empty.averageFps,
      onePercentLowRatio: full.onePercentLowFps / empty.onePercentLowFps,
      worstFrameMs: full.worstFrameMs - empty.worstFrameMs,
      drawCalls: full.renderer.drawCalls - empty.renderer.drawCalls,
      renderedTriangles: full.renderer.renderedTriangles - empty.renderer.renderedTriangles,
      visibleSceneTriangles: full.renderer.visibleSceneTriangles - empty.renderer.visibleSceneTriangles,
      materialCount: full.renderer.materialCount - empty.renderer.materialCount,
      referencedTextureCount: full.renderer.referencedTextureCount - empty.renderer.referencedTextureCount,
      geometriesInMemory: full.renderer.geometriesInMemory - empty.renderer.geometriesInMemory,
      texturesInMemory: full.renderer.texturesInMemory - empty.renderer.texturesInMemory,
      jsHeapUsedBytes: nullableDelta(empty.browser.jsHeapUsedBytes, full.browser.jsHeapUsedBytes),
      eventListeners: nullableDelta(empty.browser.eventListeners, full.browser.eventListeners),
      uiUpdatesPerSecond: nullableDelta(
        empty.browser.uiUpdatesPerSecond,
        full.browser.uiUpdatesPerSecond,
      ),
      textureMemoryBytes: nullableDelta(
        empty.renderer.textureMemoryBytes,
        full.renderer.textureMemoryBytes,
      ),
    };
  }

  function baselinePerformanceComparison(full) {
    return {
      source: PROJECT_BASELINE.source,
      averageFpsRatio: full.averageFps / PROJECT_BASELINE.averageFps,
      onePercentLowRatio: full.onePercentLowFps / PROJECT_BASELINE.onePercentLowFps,
      worstFrameMsRatio: full.worstFrameMs / PROJECT_BASELINE.worstFrameMs,
      drawCallsRatio: full.renderer.drawCalls / PROJECT_BASELINE.drawCalls,
      renderedTrianglesRatio: full.renderer.renderedTriangles / PROJECT_BASELINE.renderedTriangles,
      sceneTrianglesRatio: full.renderer.visibleSceneTriangles / PROJECT_BASELINE.sceneTriangles,
      materialCountRatio: full.renderer.materialCount / PROJECT_BASELINE.materialCount,
      geometriesInMemoryRatio: full.renderer.geometriesInMemory / PROJECT_BASELINE.geometriesInMemory,
      texturesInMemoryRatio: full.renderer.texturesInMemory / PROJECT_BASELINE.texturesInMemory,
    };
  }

  let states = {};
  let cameras = {};
  let performance = {};
  let restocks = [];
  let buildMode = {};
  let organicCustomer = null;
  let customer = null;
  let recovery = null;
  let report = null;

  try {
    await page.setViewportSize(viewport);
    await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await waitForGame();
    const deterministicFixture = await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.speedIdx = 0;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.state.weather.today = {
        tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
      };
      app.state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      return {
        clockMinutes: app.state.clock.minutes,
        weather: { ...app.state.weather.today },
        weatherLocked: app.state.weather.locked,
        organicWalkins: false,
        interiorOffset: clubhouse.interior.position.toArray(),
      };
    });

    // Warm every changed product family once, then remove stock for a matched
    // empty/full A/B. The full sample therefore measures steady-state display
    // overhead rather than deferred GLB decode or first-use GPU upload.
    await setSheetStock('full');
    await establishPlayerCamera(PERFORMANCE_CAMERA);
    await page.waitForTimeout(1500);

    const emptySetup = await setSheetStock('empty');
    await page.waitForTimeout(450);
    states.empty = await snapshotSheet('empty');
    assertStockMode(states.empty, 'empty');
    cameras.empty = await captureAssetCameras('01-empty');
    await establishPlayerCamera(PERFORMANCE_CAMERA);
    await page.waitForTimeout(650);
    performance.empty = await samplePerformance('empty-sheet03-fixed-overview');

    const partialSetup = await setSheetStock('partial');
    await page.waitForTimeout(450);
    states.partial = await snapshotSheet('partial');
    assertStockMode(states.partial, 'partial');
    cameras.partial = await captureAssetCameras('11-partial');

    const normalRestockSetup = await setSheetStock('empty');
    await page.waitForTimeout(350);
    for (const fixtureId of RESTOCK_FIXTURE_IDS) {
      restocks.push(await normalRestock(fixtureId));
    }
    // The final three-second toast lifetime must clear before these become
    // visual-acceptance evidence; interaction records retain every message.
    await page.waitForTimeout(3400);
    states.full = await snapshotSheet('full-after-twelve-normal-E-restocks');
    assertStockMode(states.full, 'full');
    cameras.full = await captureAssetCameras('21-full-after-normal-E');
    await establishPlayerCamera(PERFORMANCE_CAMERA);
    await page.waitForTimeout(650);
    performance.full = await samplePerformance('full-sheet03-fixed-overview');
    performance.delta = performanceDelta(performance.empty, performance.full);
    performance.projectBaseline = PROJECT_BASELINE;
    performance.baselineComparison = baselinePerformanceComparison(performance.full);
    performance.budget = PERF_BUDGET;
    assert(performance.delta.averageFpsRatio >= PERF_BUDGET.averageFpsRatio,
      `Full Sheet-03 average FPS exceeded the proposed steady-state tolerance: ${JSON.stringify(performance.delta)}.`);
    assert(
      performance.delta.onePercentLowRatio >= PERF_BUDGET.onePercentLowRatio
        || performance.full.onePercentLowFps >= PERF_BUDGET.minimumOnePercentLowFps,
      `Full Sheet-03 1% low failed both the matched-state ratio and absolute playability floor: ${JSON.stringify({ delta: performance.delta, fullOnePercentLowFps: performance.full.onePercentLowFps, budget: PERF_BUDGET })}.`,
    );
    assert(performance.delta.drawCalls <= PERF_BUDGET.addedDrawCalls,
      `Full Sheet-03 draw-call delta exceeded budget: ${JSON.stringify(performance.delta)}.`);
    assert(performance.delta.renderedTriangles <= PERF_BUDGET.addedRenderedTriangles,
      `Full Sheet-03 rendered-triangle delta exceeded budget: ${JSON.stringify(performance.delta)}.`);
    assert(performance.delta.materialCount <= PERF_BUDGET.addedSceneMaterials,
      `Full Sheet-03 material delta exceeded budget: ${JSON.stringify(performance.delta)}.`);
    assert(performance.delta.referencedTextureCount <= PERF_BUDGET.addedSceneTextures,
      `Full Sheet-03 texture-reference delta exceeded budget: ${JSON.stringify(performance.delta)}.`);
    assert(performance.delta.geometriesInMemory <= PERF_BUDGET.addedGeometriesInMemory,
      `Full Sheet-03 geometry-memory-count delta exceeded budget: ${JSON.stringify(performance.delta)}.`);
    assert(performance.delta.texturesInMemory <= PERF_BUDGET.addedTexturesInMemory,
      `Full Sheet-03 texture-memory-count delta exceeded budget: ${JSON.stringify(performance.delta)}.`);
    if (Number.isFinite(performance.delta.eventListeners)) {
      assert(performance.delta.eventListeners <= PERF_BUDGET.addedEventListeners,
        `Sheet-03 interaction route grew event listeners beyond budget: ${JSON.stringify(performance.delta)}.`);
    }
    if (Number.isFinite(performance.delta.textureMemoryBytes)) {
      assert(performance.delta.textureMemoryBytes <= PERF_BUDGET.addedTextureMemoryBytes,
        `Sheet-03 estimated referenced texture memory exceeded budget: ${JSON.stringify(performance.delta)}.`);
    }
    if (Number.isFinite(performance.delta.uiUpdatesPerSecond)) {
      assert(performance.delta.uiUpdatesPerSecond <= PERF_BUDGET.addedUiUpdatesPerSecond,
        `Sheet-03 DOM update frequency exceeded budget: ${JSON.stringify(performance.delta)}.`);
    }
    assert(performance.baselineComparison.averageFpsRatio >= PERF_BUDGET.baselineAverageFpsRatio,
      `Full Sheet-03 average FPS regressed against the captured project baseline: ${JSON.stringify(performance.baselineComparison)}.`);
    assert(performance.baselineComparison.onePercentLowRatio >= PERF_BUDGET.baselineOnePercentLowRatio,
      `Full Sheet-03 1% low regressed against the captured project baseline: ${JSON.stringify(performance.baselineComparison)}.`);
    for (const [metric, limit] of [
      ['drawCallsRatio', PERF_BUDGET.baselineDrawCallsRatio],
      ['renderedTrianglesRatio', PERF_BUDGET.baselineRenderedTrianglesRatio],
      ['sceneTrianglesRatio', PERF_BUDGET.baselineSceneTrianglesRatio],
      ['materialCountRatio', PERF_BUDGET.baselineMaterialsRatio],
      ['geometriesInMemoryRatio', PERF_BUDGET.baselineGeometriesRatio],
      ['texturesInMemoryRatio', PERF_BUDGET.baselineTexturesRatio],
    ]) {
      assert(performance.baselineComparison[metric] <= limit,
        `Full Sheet-03 ${metric} regressed against the captured project baseline: ${JSON.stringify(performance.baselineComparison)}.`);
    }

    buildMode.hatstand = await moveStockedFixtureWithNormalControls('hatstand');

    organicCustomer = {
      plan: await spawnOrganicCustomerForFixture('shoerack'),
    };
    buildMode.shoerack = await moveStockedFixtureWithNormalControls('shoerack');
    organicCustomer.debit = await awaitOrganicRetargetAndDebit(
      organicCustomer.plan,
      buildMode.shoerack,
    );
    await aimAtFixture('shoerack', 2.90, -0.13);
    await page.waitForTimeout(300);
    await shot('34-organic-shopper-retargeted-to-moved-shoe-wall.png');
    organicCustomer.cleanup = await clearOrganicCustomerAndVerifyReturn(organicCustomer.debit);

    customer = await sendDocumentedCustomerDebit('polo2');
    await establishPlayerCamera({ x: 0.55, z: 2.15, tx: 2.42, tz: 3.15, pitch: -0.06 });
    await page.waitForTimeout(450);
    await shot('35-documented-customer-real-debit-at-counter.png');
    await saveAndLoadSlotOne();

    recovery = await page.evaluate(async ({ skuId, movedFixtureIds }) => {
      const app = window.__fw;
      const { placedFixtures } = await import('/src/sim/layout.js');
      const { capacityOf } = await import('/src/data/fixtureSlots.js');
      const entry = app.state.shop.inventory[skuId];
      const fixtureMap = new Map(placedFixtures(app.state).map((candidate) => [candidate.id, candidate]));
      return {
        skuId,
        shelf: Number(entry.shelf),
        back: Number(entry.back),
        capacity: capacityOf(skuId),
        held: (app.state.shop.held || []).filter((unit) => unit.skuId === skuId)
          .map((unit) => ({ uid: unit.uid, skuId: unit.skuId })),
        movedFixtures: movedFixtureIds.map((id) => {
          const fixture = fixtureMap.get(id);
          return fixture ? { id: fixture.id, x: fixture.x, z: fixture.z, ry: fixture.ry || 0 } : null;
        }),
      };
    }, { skuId: 'polo2', movedFixtureIds: ['hatstand', 'shoerack'] });
    assert(recovery.shelf === recovery.capacity && recovery.back === 0 && recovery.held.length === 0,
      `Pause-UI load did not return the pending held polo exactly once: ${JSON.stringify(recovery)}.`);
    for (const fixtureId of ['hatstand', 'shoerack']) {
      const loadedFixture = recovery.movedFixtures.find((fixture) => fixture?.id === fixtureId);
      const moved = buildMode[fixtureId];
      assert(loadedFixture
        && Math.hypot(
          loadedFixture.x - moved.after.x,
          loadedFixture.z - moved.after.z,
        ) < 1e-6
        && Math.abs(loadedFixture.ry - moved.after.ry) < 1e-6,
      `Pause-UI load lost the ${fixtureId} normal-control move: ${JSON.stringify({ moved, recovery })}.`);
    }
    await establishPlayerCamera(ASSETS.find((asset) => asset.asset === 21).camera);
    await page.waitForTimeout(500);
    await shot('37-loaded-pending-held-unit-returned-exactly-once.png');

    const nonAbortedFailedRequests = failedRequests
      .filter((entry) => !/ERR_ABORTED/i.test(entry.error));
    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    assert(nonAbortedFailedRequests.length === 0,
      `Non-aborted request failures: ${JSON.stringify(nonAbortedFailedRequests)}.`);
    assert(badResponses.length === 0, `HTTP error responses: ${JSON.stringify(badResponses)}.`);

    report = {
      ok: true,
      capturedAt: new Date().toISOString(),
      iteration: iterationTag,
      route: 'sheet03-assets-21-30-normal-controls-visual-performance-and-recovery',
      launch: 'node tools/qa/run-playwright.cjs tools/qa/sheet03-assets-acceptance.js --bootstrap',
      fixtureBoundary: 'fixed player pose/time/weather plus exact Sheet-03 inventory normalization only; twelve restocks use focused normal E, two fixture rearrangements use B/E/R/held WASD/E, one forced-arrival shopper uses production organic planning/walking/retarget/debit, a separate accounting-real sendToCounter unit isolates recovery, and recovery uses pause UI Save/Load',
      deterministicCustomerChoice: 'debugSpawn forces only arrival timing and retries until the moved shoe wall is the first merchandise stop; planOrganicOrder, walking, build-mode retargeting and pickFromShelf remain production paths. sendToCounter is retained separately to isolate pending-unit save/load recovery.',
      methodology: {
        viewport,
        deviceScaleFactor: 1,
        deterministicFixture,
        cameraCoordinates: 'clubhouse-interior-local yards; yaw = Math.atan2(-dx, -dz), matching Three camera forward -Z',
        cameraWarmupMs: 260,
        assetResidencyWarmup: 'all Sheet-03 lines rendered full for 1.5 s before matched empty/full sampling',
        performanceCamera: PERFORMANCE_CAMERA,
        performanceSampling: 'three consecutive 2.0 s requestAnimationFrame samples per state at the identical fixed first-person camera',
        performanceTolerance: 'Matched empty/full gate retains at least 70% average and 60% 1% low and caps iteration-3-calibrated authored-facing deltas. The authoritative regression gate separately requires the full state to preserve the captured project baseline FPS and stay within 5% of its renderer/resource counts.',
        textureMemory: 'estimated from every uniquely referenced decoded texture (typed-array byteLength or RGBA8 dimensions) plus generated mip chains; renderer texture counts are also recorded',
        uiUpdateFrequency: 'MutationObserver records per second across the same three matched 2 s performance samples',
        video: process.env.VIDEO_DIR ? path.resolve(process.env.VIDEO_DIR) : null,
      },
      assets: ASSETS,
      setup: { empty: emptySetup, partial: partialSetup, normalRestock: normalRestockSetup },
      states,
      cameras,
      restocks,
      buildMode,
      organicCustomer,
      customer,
      recovery,
      performance,
      routeLog,
      evidence,
      diagnostics: {
        consoleErrors,
        consoleWarnings,
        pageErrors,
        failedRequests,
        nonAbortedFailedRequests,
        badResponses,
      },
    };
  } catch (error) {
    const blocker = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: String(error?.stack || error),
    };
    try { await shot('99-sheet03-acceptance-failure.png'); } catch { /* retain the primary blocker */ }
    report = {
      ok: false,
      capturedAt: new Date().toISOString(),
      iteration: iterationTag,
      route: 'sheet03-assets-21-30-normal-controls-visual-performance-and-recovery',
      blocker,
      viewport,
      assets: ASSETS,
      states,
      cameras,
      restocks,
      buildMode,
      organicCustomer,
      customer,
      recovery,
      performance,
      routeLog,
      evidence,
      diagnostics: {
        consoleErrors,
        consoleWarnings,
        pageErrors,
        failedRequests,
        badResponses,
      },
    };
  }

  const resultJson = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(path.join(out, `sheet03-assets-acceptance-result-${iterationTag}.json`), resultJson);
  // Stable latest path remains convenient for the runner/validator, while the
  // iteration-qualified result above is never overwritten by passes 2-4.
  fs.writeFileSync(path.join(out, 'sheet03-assets-acceptance-result.json'), resultJson);
  return report;
}
