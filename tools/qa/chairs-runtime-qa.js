async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const phase = String(process.env.QA_CHAIR_PHASE || 'baseline').trim();
  const requestedAssetSet = String(process.env.QA_CHAIR_ASSET_SET || '').trim().toLowerCase();
  if (requestedAssetSet && !['baseline', 'production'].includes(requestedAssetSet)) {
    throw new Error(`QA_CHAIR_ASSET_SET must be baseline or production, received: ${requestedAssetSet}`);
  }
  const useProductionAssets = requestedAssetSet
    ? requestedAssetSet === 'production'
    : phase !== 'baseline';
  const videoDir = String(process.env.VIDEO_DIR || '').trim();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, 'qa', 'chairs', phase);
  fs.mkdirSync(outDir, { recursive: true });

  const viewport = { width: 1600, height: 900, deviceScaleFactor: 1 };
  const sampleDurationMs = 5000;
  const sampleCount = 3;
  const diagnostics = {
    consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => diagnostics.failedRequests.push({
    url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  await page.addInitScript(() => {
    let active = 0;
    let registrations = 0;
    const registry = new WeakMap();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const captureOf = (options) => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
      if (listener) {
        let types = registry.get(this);
        if (!types) { types = new Map(); registry.set(this, types); }
        let entries = types.get(type);
        if (!entries) { entries = []; types.set(type, entries); }
        const capture = captureOf(options);
        if (!entries.some((entry) => entry.listener === listener && entry.capture === capture)) {
          entries.push({ listener, capture });
          active++;
          registrations++;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
      const entries = registry.get(this)?.get(type);
      const capture = captureOf(options);
      const index = entries?.findIndex((entry) => entry.listener === listener && entry.capture === capture) ?? -1;
      if (index >= 0) { entries.splice(index, 1); active--; }
      return originalRemove.call(this, type, listener, options);
    };
    window.__qaListeners = () => ({ active, registrations });
  });

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => (
    window.__fw?.screen === 'game'
      && window.__fw?.scene3d?.walk?.isActive?.()
      && window.__fw?.scene3d?.clubhouse?.()
  ), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (window.__fw?.prewarming === true) return false;
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(3000);

  // Exercise the actual keyboard path before the fixture establishes a fixed review state.
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 800, y: 450 } }).catch(() => {});
  const normalControls = {
    before: await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state })),
    attempts: [],
  };
  for (const key of ['d', 's', 'a', 'w']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(360);
    await page.keyboard.up(key);
    await page.waitForTimeout(180);
    const state = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
    const distance = Math.hypot(
      state.x - normalControls.before.x,
      state.z - normalControls.before.z,
    );
    normalControls.attempts.push({ key, state, distance });
    if (distance > 0.05) break;
  }
  normalControls.after = normalControls.attempts.at(-1)?.state || normalControls.before;
  normalControls.movedDistance = Math.hypot(
    normalControls.after.x - normalControls.before.x,
    normalControls.after.z - normalControls.before.z,
  );

  const fixture = await page.evaluate(async ({ production }) => {
    const THREE = await import('three');
    const { buildPropertyFurnitureVisual } = await import(new URL('src/render3d/clubhouse/propertyFurnitureVisuals.js', document.baseURI).href);
    const { PRO_SHOP_FURNITURE_SKUS } = await import(new URL('src/data/proShopFurniture.js', document.baseURI).href);
    const app = window.__fw;
    const scene = app.scene3d.scene;
    scene.getObjectByName('ChairQAFixture')?.removeFromParent();

    const baselineModels = [
      { id: 'basic', label: 'Basic', path: '/vendor/models/assets_51_100/sheet_09/asset_081_office_chair_sheet09.glb', count: 15 },
      { id: 'standard', label: 'Standard', path: '/vendor/models/checkout/office_chair.glb', count: 15 },
      { id: 'premium', label: 'Premium', path: '/vendor/models/clubhouse/office_chair.glb', count: 10 },
      { id: 'high-end', label: 'High-End', path: '/vendor/models/assets_51_100/sheet_07/asset_068_lounge_armchair_sheet07.glb', count: 8 },
      { id: 'luxury', label: 'Luxury', path: '/vendor/models/checkout/lounge_armchair.glb', count: 8 },
    ];
    const productionModels = [
      { id: 'basic', catalogTierId: 'basic', kind: 'office', label: 'Basic', path: '/vendor/models/pro_shop_furniture/chairs/basic.glb', count: 15 },
      { id: 'standard', catalogTierId: 'standard', kind: 'office', label: 'Standard', path: '/vendor/models/pro_shop_furniture/chairs/standard.glb', count: 15 },
      { id: 'premium', catalogTierId: 'premium', kind: 'office', label: 'Premium', path: '/vendor/models/pro_shop_furniture/chairs/premium.glb', count: 10 },
      { id: 'high-end', catalogTierId: 'luxury', kind: 'lounge', label: 'High-End', path: '/vendor/models/pro_shop_furniture/chairs/high-end.glb', count: 8 },
      { id: 'luxury', catalogTierId: 'executive', kind: 'lounge', label: 'Luxury', path: '/vendor/models/pro_shop_furniture/chairs/luxury.glb', count: 8 },
    ];
    const models = production ? productionModels : baselineModels;
    const fixtureRoot = new THREE.Group();
    fixtureRoot.name = 'ChairQAFixture';
    scene.add(fixtureRoot);

    const clubhouse = app.scene3d.clubhouse();
    const anchor = new THREE.Vector3();
    clubhouse.interior.getWorldPosition(anchor);
    const lineupCenter = {
      x: anchor.x,
      z: anchor.z + 25,
    };
    // The parking apron has a rendered asphalt cap above heightAt(). Lift the
    // authored review deck enough to cover that cap and its white stall lines
    // while keeping every chair rooted exactly on the deck's top surface.
    const lineupY = app.scene3d.heightAt(lineupCenter.x, lineupCenter.z) + 0.16;
    // Keep the 56-copy stress deck on the broad, already-level clubhouse parking
    // apron. The previous east-side position straddled a terrain bank and made
    // correctly grounded chair roots look as if they were floating.
    const stressCenter = { x: anchor.x, z: anchor.z + 31 };
    const stressY = app.scene3d.heightAt(stressCenter.x, stressCenter.z) + 0.16;

    const stageMaterial = new THREE.MeshStandardMaterial({
      color: 0x667b6d, roughness: 0.91, metalness: 0,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x285442, roughness: 0.72, metalness: 0,
    });
    const makeStage = (name, width, depth, x, y, z) => {
      const group = new THREE.Group();
      group.name = name;
      group.position.set(x, y, z);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, depth), stageMaterial);
      deck.position.y = -0.06;
      deck.receiveShadow = true;
      group.add(deck);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.10, 0.05, depth + 0.10), trimMaterial);
      trim.position.y = -0.135;
      group.add(trim);
      fixtureRoot.add(group);
      return group;
    };
    const lineup = makeStage('ChairQALineup', 9.6, 4.8, lineupCenter.x, lineupY, lineupCenter.z);
    const stress = makeStage('ChairQAStressGrid', 17.5, 19.5, stressCenter.x, stressY, stressCenter.z);
    stress.visible = false;

    const key = new THREE.DirectionalLight(0xfff1d7, 3.8);
    key.position.set(lineupCenter.x + 4, lineupY + 7, lineupCenter.z + 5);
    key.target.position.set(lineupCenter.x, lineupY + 0.7, lineupCenter.z);
    fixtureRoot.add(key, key.target);
    const fill = new THREE.HemisphereLight(0xd7e2dc, 0x2d241d, 2.0);
    const frontFill = new THREE.DirectionalLight(0xe2ecff, 2.2);
    frontFill.position.set(lineupCenter.x - 5, lineupY + 4, lineupCenter.z + 7);
    frontFill.target.position.set(lineupCenter.x, lineupY + 0.65, lineupCenter.z);
    const lift = new THREE.AmbientLight(0xfff3df, 0.60);
    fixtureRoot.add(fill, frontFill, frontFill.target, lift);

    const productionSkus = new Map(PRO_SHOP_FURNITURE_SKUS
      .filter((sku) => sku.furnitureCategory === 'chairs')
      .map((sku) => [sku.furnitureTierId, sku]));
    const skuFor = (model, suffix) => {
      const productionSku = production ? productionSkus.get(model.catalogTierId) : null;
      return productionSku ? {
        ...productionSku,
        id: `chair-qa-${model.id}-${suffix}`,
      } : {
        id: `chair-qa-${model.id}-${suffix}`,
        modelPath: model.path,
        modelScale: 1.0936133,
        mountYOffset: 0,
      };
    };
    const lineupRoots = [];
    const xPositions = [-3.7, -1.85, 0, 1.85, 3.7];
    for (let index = 0; index < models.length; index++) {
      const model = models[index];
      const visual = buildPropertyFurnitureVisual(skuFor(model, 'lineup'));
      visual.name = `ChairQA_${model.id}`;
      visual.position.set(xPositions[index], 0, 0);
      lineup.add(visual);
      await visual.userData.ready;
      if (visual.userData.loadError) throw new Error(`${model.label} failed to load: ${visual.userData.loadError}`);
      lineupRoots.push({ model, visual });
    }

    let ordinal = 0;
    const stressRoots = [];
    for (const model of models) {
      for (let index = 0; index < model.count; index++) {
        const visual = buildPropertyFurnitureVisual(skuFor(model, `stress-${index}`));
        visual.name = `ChairQAStress_${model.id}_${String(index + 1).padStart(2, '0')}`;
        const column = ordinal % 8;
        const row = Math.floor(ordinal / 8);
        visual.position.set(-7.15 + column * 2.05, 0, -7.25 + row * 2.05);
        visual.rotation.y = (row % 2) * 0.20 - 0.10;
        stress.add(visual);
        await visual.userData.ready;
        if (visual.userData.loadError) throw new Error(`${model.label} stress copy failed: ${visual.userData.loadError}`);
        stressRoots.push(visual);
        ordinal++;
      }
    }

    const inventory = lineupRoots.map(({ model, visual }) => {
      const bounds = new THREE.Box3().setFromObject(visual);
      const size = bounds.getSize(new THREE.Vector3());
      const materials = new Set();
      const geometries = new Set();
      const nodeNames = [];
      let meshes = 0;
      let triangles = 0;
      visual.traverse((object) => {
        if (object.name) nodeNames.push(object.name);
        if (!object.isMesh || object.visible === false) return;
        meshes++;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const triangleCount = object.geometry?.index
          ? object.geometry.index.count / 3
          : (object.geometry?.attributes?.position?.count || 0) / 3;
        triangles += triangleCount;
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      return {
        id: model.id,
        label: model.label,
        path: model.path,
        dimensionsWorld: [size.x, size.y, size.z],
        meshes,
        triangles: Math.round(triangles),
        uniqueGeometries: geometries.size,
        uniqueMaterials: materials.size,
        functionalNodes: visual.userData.functionalNodes?.names
          || nodeNames.filter((name) => /(?:ANCHOR|POINT|PIVOT|SWIVEL|INTERACT|PLACEMENT|COLLISION|LOD)/i.test(name)).sort(),
        animationClips: visual.userData.animations || [],
        hasAuthoredLod: visual.userData.authoredLod?.isLOD === true,
        lodDistances: visual.userData.authoredLod?.levels?.map((level) => level.distance) || [],
        seatAnchor: visual.userData.functionalNodes?.seatAnchor?.name || null,
        entryPointCount: visual.userData.functionalNodes?.entryPoints?.length || 0,
        exitPointCount: visual.userData.functionalNodes?.exitPoints?.length || 0,
        casterPivotCount: visual.userData.functionalNodes?.casterPivots?.length || 0,
        hasHeightPivot: !!visual.userData.functionalNodes?.heightAdjustmentPivot,
        hasSwivelPivot: !!visual.userData.functionalNodes?.swivelPivot,
        hasReclinePivot: !!visual.userData.functionalNodes?.backrestTiltPivot,
      };
    });

    window.__chairQA = {
      root: fixtureRoot,
      lineup,
      stress,
      lineupCenter,
      lineupY,
      stressCenter,
      stressY,
      models,
      inventory,
      stressCount: stressRoots.length,
    };
    return {
      production,
      lineupCenter,
      lineupY,
      stressCenter,
      stressY,
      models,
      inventory,
      stressCount: stressRoots.length,
      clubhouseAnchor: { x: anchor.x, y: anchor.y, z: anchor.z },
    };
  }, { production: useProductionAssets });

  // Clear normal player-facing delivery notices so the same furniture pixels remain
  // inspectable in baseline and production screenshots.
  for (let index = 0; index < 20; index++) {
    const dismiss = page.locator('button.notification-dismiss').first();
    if (!await dismiss.isVisible().catch(() => false)) break;
    await dismiss.click();
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => {
    const notificationCenter = document.querySelector('.notification-center');
    if (notificationCenter) notificationCenter.style.visibility = 'hidden';
  });
  await canvas.click({ position: { x: 800, y: 450 } }).catch(() => {});
  await page.waitForTimeout(300);

  const placeCamera = async ({ x, z, targetX, targetZ, eye = 1.28, pitch = -0.08 }) => {
    await page.evaluate((pose) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const state = walk.state;
      walk.clearKeys();
      walk.setSpraying(false);
      state.x = pose.x;
      state.z = pose.z;
      state.eye = pose.eye;
      state.yaw = Math.atan2(-(pose.targetX - pose.x), -(pose.targetZ - pose.z));
      state.pitch = pose.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 14 * 60;
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    }, { x, z, targetX, targetZ, eye, pitch });
    await page.waitForTimeout(800);
  };

  const cameras = [
    {
      id: '01-lineup-front',
      x: fixture.lineupCenter.x,
      z: fixture.lineupCenter.z + 5.8,
      targetX: fixture.lineupCenter.x,
      targetZ: fixture.lineupCenter.z,
      eye: 1.24,
      pitch: -0.085,
    },
    {
      id: '02-lineup-three-quarter',
      x: fixture.lineupCenter.x + 4.7,
      z: fixture.lineupCenter.z + 4.9,
      targetX: fixture.lineupCenter.x,
      targetZ: fixture.lineupCenter.z,
      eye: 1.34,
      pitch: -0.10,
    },
    {
      id: '03-lineup-player-eye',
      x: fixture.lineupCenter.x - 1.85,
      z: fixture.lineupCenter.z + 3.20,
      targetX: fixture.lineupCenter.x - 1.85,
      targetZ: fixture.lineupCenter.z,
      eye: 1.70,
      pitch: -0.22,
    },
  ];
  const screenshots = [];
  for (const camera of cameras) {
    await placeCamera(camera);
    const file = path.join(outDir, `${camera.id}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    screenshots.push(file);
  }

  await page.evaluate(() => {
    window.__chairQA.lineup.visible = false;
    window.__chairQA.stress.visible = true;
  });
  const stressCamera = {
    id: '04-stress-grid',
    x: fixture.stressCenter.x,
    z: fixture.stressCenter.z + 15.4,
    targetX: fixture.stressCenter.x,
    targetZ: fixture.stressCenter.z,
    eye: 5.4,
    pitch: -0.31,
  };
  await placeCamera(stressCamera);
  const stressScreenshot = path.join(outDir, `${stressCamera.id}.png`);
  await page.screenshot({ path: stressScreenshot, animations: 'disabled' });
  screenshots.push(stressScreenshot);
  await page.waitForTimeout(5000);

  const rawSamples = [];
  for (let run = 0; run < sampleCount; run++) {
    rawSamples.push(await page.evaluate(async ({ durationMs, label }) => {
      const renderer = window.__fw.scene3d.renderer;
      const uiRoot = document.querySelector('#ui') || document.body;
      let uiMutationCallbacks = 0;
      const observer = new MutationObserver(() => { uiMutationCallbacks++; });
      observer.observe(uiRoot, { childList: true, subtree: true, attributes: true, characterData: true });
      const frameDeltas = [];
      await new Promise((resolve) => {
        let started = 0;
        let previous = 0;
        const tick = (now) => {
          if (!started) {
            started = now;
            previous = now;
            requestAnimationFrame(tick);
            return;
          }
          frameDeltas.push(now - previous);
          previous = now;
          if (now - started >= durationMs) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      observer.disconnect();
      const sortedSlowest = [...frameDeltas].sort((a, b) => b - a);
      const slowCount = Math.max(1, Math.ceil(sortedSlowest.length * 0.01));
      const averageMs = frameDeltas.reduce((sum, value) => sum + value, 0) / Math.max(1, frameDeltas.length);
      const slowMean = sortedSlowest.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;

      const previousAutoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      renderer.info.reset();
      const rendered = await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        drawCalls: renderer.info.render.calls,
        renderedTriangles: renderer.info.render.triangles,
      }))));
      renderer.info.autoReset = previousAutoReset;

      const materials = new Map();
      const textures = new Map();
      let sceneTriangles = 0;
      let visibleMeshes = 0;
      window.__fw.scene3d.scene.traverseVisible((object) => {
        if (!object.isMesh) return;
        visibleMeshes++;
        const triangleCount = object.geometry?.index
          ? object.geometry.index.count / 3
          : (object.geometry?.attributes?.position?.count || 0) / 3;
        sceneTriangles += triangleCount * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.set(material.uuid, material);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
            if (material[key]) textures.set(material[key].uuid, material[key]);
          }
        }
      });
      let estimatedTextureMemoryBytes = 0;
      for (const texture of textures.values()) {
        const image = texture?.image;
        const width = Number(image?.width || image?.videoWidth || 0);
        const height = Number(image?.height || image?.videoHeight || 0);
        estimatedTextureMemoryBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
      }
      return {
        label,
        durationMs,
        frameCount: frameDeltas.length,
        averageFps: 1000 / Math.max(0.001, averageMs),
        onePercentLowFps: 1000 / Math.max(0.001, slowMean),
        worstFrameMs: sortedSlowest[0] || 0,
        ...rendered,
        sceneTriangles: Math.round(sceneTriangles),
        visibleMeshes,
        uniqueMaterials: materials.size,
        uniqueTextures: textures.size,
        estimatedTextureMemoryBytes: Math.round(estimatedTextureMemoryBytes),
        rendererMemory: { ...renderer.info.memory },
        jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
        activeListeners: window.__qaListeners?.().active ?? null,
        listenerRegistrations: window.__qaListeners?.().registrations ?? null,
        uiMutationCallbacks,
        uiMutationCallbacksPerSecond: uiMutationCallbacks / (durationMs / 1000),
      };
    }, { durationMs: sampleDurationMs, label: `chair-stress-${run + 1}` }));
  }

  const median = (values) => {
    const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
    return finite[Math.floor(finite.length / 2)] ?? null;
  };
  const summary = {
    medianAverageFps: median(rawSamples.map((sample) => sample.averageFps)),
    medianOnePercentLowFps: median(rawSamples.map((sample) => sample.onePercentLowFps)),
    medianWorstFrameMs: median(rawSamples.map((sample) => sample.worstFrameMs)),
    medianDrawCalls: median(rawSamples.map((sample) => sample.drawCalls)),
    medianRenderedTriangles: median(rawSamples.map((sample) => sample.renderedTriangles)),
    medianSceneTriangles: median(rawSamples.map((sample) => sample.sceneTriangles)),
    medianMaterials: median(rawSamples.map((sample) => sample.uniqueMaterials)),
    medianTextureMemoryBytes: median(rawSamples.map((sample) => sample.estimatedTextureMemoryBytes)),
    medianHeapBytes: median(rawSamples.map((sample) => sample.jsHeapUsedBytes)),
    medianActiveListeners: median(rawSamples.map((sample) => sample.activeListeners)),
    medianUiMutationCallbacksPerSecond: median(rawSamples.map((sample) => sample.uiMutationCallbacksPerSecond)),
  };

  const report = {
    ok: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.failedRequests.length === 0
      && normalControls.movedDistance > 0.05
      && fixture.stressCount === 56
      && (!useProductionAssets || fixture.inventory.every((asset) => (
        asset.hasAuthoredLod
        && asset.seatAnchor === 'SEAT_ANCHOR'
        && asset.entryPointCount === 2
        && asset.exitPointCount === 2
      )))
      && (!useProductionAssets || fixture.inventory
        .filter((asset) => ['basic', 'standard', 'premium'].includes(asset.id))
        .every((asset) => asset.casterPivotCount === 5 && asset.hasHeightPivot && asset.hasSwivelPivot)),
    capturedAt: new Date().toISOString(),
    phase,
    assetSet: useProductionAssets ? 'production-chair-assets' : 'current-shipped-chair-stand-ins',
    launch: {
      command: `QA_CHAIR_PHASE=${phase}${requestedAssetSet ? ` QA_CHAIR_ASSET_SET=${requestedAssetSet}` : ''}${videoDir ? ` VIDEO_DIR=${videoDir}` : ''} node tools/qa/run-playwright.cjs tools/qa/chairs-runtime-qa.js --bootstrap`,
      url: baseUrl,
      viewport,
      quality: 'repository defaults',
      warmupMs: 5000,
      sampleCount,
      sampleDurationMs,
    },
    fixture,
    normalControls,
    cameras: [...cameras, stressCamera],
    screenshots,
    rawSamples,
    summary,
    diagnostics,
  };
  fs.writeFileSync(path.join(outDir, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
