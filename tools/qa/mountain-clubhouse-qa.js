async (page) => {
  // Repeatable Course-3 mountain clubhouse acceptance pass. Camera placement is
  // a fixed fixture; the entrance interaction itself uses normal player keys.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const iteration = process.env.MOUNTAIN_CLUBHOUSE_QA_ITERATION || 'iteration-01';
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = path.join(repo, 'qa', 'mountain-clubhouse', iteration);
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const live = Object.create(null);
    const keyFor = (target, type) => `${target === window ? 'window' : 'document'}:${type}`;
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        live[key] = (live[key] || 0) + 1;
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        live[key] = (live[key] || 0) - 1;
      }
      return remove.call(this, type, listener, options);
    };
    window.__mountainClubhouseListeners = live;
  });

  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const url = new URL(base);
  url.searchParams.set('clubhouse', 'mountain-lodge');
  await page.goto(url.toString());
  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).display === 'none' || Number(getComputedStyle(veil).opacity) <= 0.01;
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const api = window.__fw?.scene3d?.clubhouse?.()?.mountainLodge;
    return Boolean(api) && api.diagnostics().status !== 'loading';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1800);

  // Until the central course-theme selector owns all five clubhouse projects,
  // isolate this Course-3 asset from other concurrently authored course shells.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const scene = window.__fw.scene3d;
    for (const root of Object.values(ch.modernClubhouse?.roots?.() || {})) root.visible = false;
    const state = window.__fw.state;
    window.__fw.speedIdx = 0;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 14 * 60;
    state.weather.today = {
      ...(state.weather.today || {}),
      tempHiF: 67,
      tempLoF: 46,
      rainIn: 0,
      humidity: 0.38,
      windMph: 5,
    };
    if (Array.isArray(state.weather.forecast) && state.weather.forecast.length) {
      state.weather.forecast[0] = { ...state.weather.today };
    }
    scene.applyTimeWeather(14 * 60, state.weather);
    scene.clearGolfers?.();
    const customers = typeof ch.customers === 'function'
      ? ch.customers()
      : (Array.isArray(ch.customers) ? ch.customers : []);
    for (const customer of customers) {
      if (customer.mesh) customer.mesh.visible = false;
    }
    const deliveryVan = scene.scene?.getObjectByName('DeliveryEquipmentRoot_delivery_van');
    if (deliveryVan) deliveryVan.visible = false;
    for (const name of ['DeliveryBoxWorldRoot', 'DeliveryPalletStage']) {
      const staging = scene.scene?.getObjectByName(name);
      if (staging) staging.visible = false;
    }
    const qaStyle = document.createElement('style');
    qaStyle.id = 'mountain-clubhouse-qa-isolation';
    qaStyle.textContent = '.notification-center,.toast-wrap{display:none!important}';
    document.head.append(qaStyle);
    document.querySelectorAll('.notification, .toast').forEach((node) => node.remove());
  });

  const poseDiagnostics = [];
  const pose = async (shot) => {
    await page.evaluate(({ x, z, tx, tz, pitch = 0 }) => {
      const scene = window.__fw.scene3d;
      const walk = scene.walk;
      const center = scene.clubhouse().group.position;
      walk.clearKeys();
      walk.clearFocus?.();
      walk.state.x = center.x + x;
      walk.state.z = center.z + z;
      const dx = (center.x + tx) - walk.state.x;
      const dz = (center.z + tz) - walk.state.z;
      const length = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / length, -dz / length);
      walk.state.pitch = pitch;
      const van = scene.scene?.getObjectByName('DeliveryEquipmentRoot_delivery_van');
      if (van) van.visible = false;
      for (const name of ['DeliveryBoxWorldRoot', 'DeliveryPalletStage']) {
        const staging = scene.scene?.getObjectByName(name);
        if (staging) staging.visible = false;
      }
      const ch = scene.clubhouse();
      const customers = typeof ch.customers === 'function'
        ? ch.customers()
        : (Array.isArray(ch.customers) ? ch.customers : []);
      for (const customer of customers) {
        if (customer.mesh) customer.mesh.visible = false;
      }
    }, shot);
    await page.waitForTimeout(650);
    await page.evaluate(() => {
      const scene = window.__fw.scene3d;
      const van = scene.scene?.getObjectByName('DeliveryEquipmentRoot_delivery_van');
      if (van) van.visible = false;
      for (const name of ['DeliveryBoxWorldRoot', 'DeliveryPalletStage']) {
        const staging = scene.scene?.getObjectByName(name);
        if (staging) staging.visible = false;
      }
      const ch = scene.clubhouse();
      const customers = typeof ch.customers === 'function'
        ? ch.customers()
        : (Array.isArray(ch.customers) ? ch.customers : []);
      for (const customer of customers) {
        if (customer.mesh) customer.mesh.visible = false;
      }
      document.querySelectorAll('.notification, .toast').forEach((node) => node.remove());
    });
    poseDiagnostics.push(await page.evaluate((requested) => ({
      requested,
      actual: { ...window.__fw.scene3d.walk.state },
      camera: window.__fw.scene3d.camera.position.toArray(),
      free: window.__fw.scene3d.walk.isFree(
        window.__fw.scene3d.walk.state.x,
        window.__fw.scene3d.walk.state.z,
        window.__fw.scene3d.walk.state.radius,
      ),
    }), shot));
  };

  const shots = [
    { id: '01-front-arrival', x: 0, z: 30, tx: 0, tz: 0, pitch: 0.055 },
    { id: '02-front-cartport-three-quarter', x: -26, z: 4, tx: -14, tz: 3, pitch: 0.025 },
    { id: '03-east-service-approach', x: 26, z: -5, tx: 9, tz: 0, pitch: 0.025 },
    { id: '04-east-employee-delivery', x: 20, z: 3, tx: 9, tz: 1, pitch: 0.015 },
    { id: '05-rear-course-patio', x: 0, z: -30, tx: 0, tz: 0, pitch: 0.035 },
    { id: '06-rear-fireplace-three-quarter', x: 18, z: -12, tx: 5, tz: -2, pitch: 0.035 },
    { id: '07-empty-vaulted-interior', x: -7, z: 0, tx: 7, tz: 0, pitch: -0.14 },
  ];
  for (const shot of shots) {
    await pose(shot);
    if (shot.id === '07-empty-vaulted-interior') {
      const isolatedFrame = await page.evaluate(() => {
        const ch = window.__fw.scene3d.clubhouse();
        const interior = ch.interior;
        const mountainRoot = ch.mountainLodge.root();
        const interiorWasVisible = interior.visible;
        interior.visible = false;
        const groupVisibility = ch.group.children
          .filter((child) => child !== mountainRoot)
          .map((child) => ({ child, visible: child.visible }));
        for (const entry of groupVisibility) entry.child.visible = false;
        const scene = window.__fw.scene3d.scene;
        const sceneVisibility = scene.children
          .filter((child) => child !== ch.group && !child.isCamera && !child.isLight)
          .map((child) => ({ child, visible: child.visible }));
        for (const entry of sceneVisibility) entry.child.visible = false;
        const renderer = window.__fw.scene3d.renderer;
        renderer.render(scene, window.__fw.scene3d.camera);
        const frame = renderer.domElement.toDataURL('image/png');
        for (const entry of groupVisibility) {
          entry.child.visible = entry.visible;
        }
        for (const entry of sceneVisibility) {
          entry.child.visible = entry.visible;
        }
        interior.visible = interiorWasVisible;
        return frame;
      });
      fs.writeFileSync(
        path.join(out, `${shot.id}.png`),
        Buffer.from(isolatedFrame.split(',')[1], 'base64'),
      );
    } else {
      await page.screenshot({ path: path.join(out, `${shot.id}.png`) });
    }
  }

  // Normal-control proof: start within the physical interaction radius and use E.
  await pose({ x: -0.8, z: 9.10, tx: -0.8, tz: 6.95, pitch: -0.025 });
  const doorBefore = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().mountainLodge.root();
    return {
      left: root?.getObjectByName('PIVOT_MainEntranceLeft')?.rotation.y ?? null,
      right: root?.getObjectByName('PIVOT_MainEntranceRight')?.rotation.y ?? null,
      focus: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      walk: { ...window.__fw.scene3d.walk.state },
    };
  });
  await page.mouse.click(800, 450);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const customers = typeof ch.customers === 'function'
      ? ch.customers()
      : (Array.isArray(ch.customers) ? ch.customers : []);
    for (const customer of customers) {
      if (customer.mesh) customer.mesh.visible = false;
    }
  });
  const doorAfter = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().mountainLodge.root();
    return {
      left: root?.getObjectByName('PIVOT_MainEntranceLeft')?.rotation.y ?? null,
      right: root?.getObjectByName('PIVOT_MainEntranceRight')?.rotation.y ?? null,
    };
  });
  await page.screenshot({ path: path.join(out, '08-normal-controls-main-door.png') });
  const doorOpened = Number.isFinite(doorAfter.left)
    && Number.isFinite(doorBefore.left)
    && Math.abs(doorAfter.left - doorBefore.left) > 0.05;

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const [dom, heap, browserMetrics, model] = await Promise.all([
    cdp.send('Memory.getDOMCounters'),
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Performance.getMetrics'),
    page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const root = ch.mountainLodge.root();
      const renderer = window.__fw.scene3d.renderer;
      const families = Object.create(null);
      const materials = new Set();
      const geometries = new Set();
      let meshes = 0;
      let triangles = 0;
      let visibleCollisionMeshes = 0;
      root?.traverse((node) => {
        const family = node.userData?.module_family;
        if (family) families[family] = (families[family] || 0) + 1;
        if (!node.isMesh) return;
        meshes += 1;
        if (node.name.startsWith('COL_') && node.visible) visibleCollisionMeshes += 1;
        if (node.geometry) {
          geometries.add(node.geometry.uuid);
          const count = node.geometry.index?.count || node.geometry.attributes?.position?.count || 0;
          triangles += count / 3;
        }
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      return {
        diagnostics: ch.mountainLodge.diagnostics(),
        meshes,
        triangles: Math.round(triangles),
        uniqueGeometries: geometries.size,
        uniqueMaterials: materials.size,
        rendererMemory: { ...renderer.info.memory },
        moduleFamilies: families,
        visibleCollisionMeshes,
        requiredNodes: Object.fromEntries([
          'ArchitecturalShell', 'CoveredFrontPorch', 'CoveredGolfCartParking',
          'StoneFireplaceAndChimney', 'ModularSitework', 'MountainLandscape',
          'ExposedHeavyTimberTrusses', 'EmptyInterior', 'PIVOT_EmployeeEntrance',
          'PIVOT_DeliveryEntranceNorth', 'PIVOT_DeliveryEntranceSouth',
        ].map((name) => [name, Boolean(
          root?.getObjectByName(name) || root?.getObjectByName(`LOD0_${name}`)
        )])),
        listeners: { ...(window.__mountainClubhouseListeners || {}) },
        browserHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    }),
  ]);
  const browserMetricMap = Object.fromEntries(browserMetrics.metrics.map(({ name, value }) => [name, value]));
  const requiredNodesPresent = Object.values(model.requiredNodes).every(Boolean);
  // Chromium can cancel redundant preloads after GLTFLoader has already completed its
  // own request. A loaded root is authoritative; only a non-aborted model failure is fatal.
  const modelFailures = diagnostics.requestFailures.filter((failure) => (
    failure.url.includes('mountain_clubhouse_3000sqft.glb')
      && !failure.error.includes('ERR_ABORTED')
  ));

  return {
    ok: model.diagnostics.loaded
      && requiredNodesPresent
      && model.visibleCollisionMeshes === 0
      && doorOpened
      && diagnostics.pageErrors.length === 0
      && diagnostics.consoleErrors.length === 0
      && modelFailures.length === 0,
    iteration,
    protocol: {
      viewport: '1600x900@1',
      fixedTime: '2:00 PM',
      fixedWeather: '67F/46F, dry, 38% humidity, 5 mph wind',
      normalControls: 'fixed porch start inside real interaction radius; E; wait 0.9s',
    },
    screenshots: shots.map((shot) => path.join(out, `${shot.id}.png`))
      .concat(path.join(out, '08-normal-controls-main-door.png')),
    interaction: { doorBefore, doorAfter, doorOpened },
    poseDiagnostics,
    model,
    resources: {
      dom,
      heap,
      cdpJsHeapBytes: browserMetricMap.JSHeapUsedSize ?? null,
      nodes: browserMetricMap.Nodes ?? null,
      documents: browserMetricMap.Documents ?? null,
    },
    diagnostics,
  };
}
