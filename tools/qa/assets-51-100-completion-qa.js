async (page) => {
  // ASSETS 51-100 COMPLETION QA
  //
  // Direct state/pose writes establish deterministic review fixtures only. Customer movement,
  // laptop entry/exit, and resize handling all continue through the running game's normal paths.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(repo, process.env.ASSETS_51_100_COMPLETION_OUT
    || 'qa/assets_51_100_master/completion/current');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  const captures = [];
  const checks = [];
  let phase = 'boot';
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ phase, kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({
    phase, kind: 'pageerror', message: error.message,
  }));
  page.on('requestfailed', (request) => diagnostics.push({
    phase,
    kind: /ERR_ABORTED/u.test(request.failure()?.errorText || '') ? 'requestaborted' : 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));

  const addCheck = (id, ok, actual) => checks.push({ id, ok: Boolean(ok), actual });
  const capture = async (file) => {
    const target = path.join(out, file);
    await page.screenshot({ path: target });
    captures.push(target);
    return target;
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => {
    const app = window.__fw;
    const clubhouse = app?.scene3d?.clubhouse?.();
    const runtime = clubhouse?.assets51to100Runtime?.diagnostics?.();
    const sheet06 = clubhouse?.sheet06Production?.diagnostics?.();
    return runtime?.placed === 40 && runtime?.failed === 0
      && runtime?.instances === 41
      && sheet06?.activationStatus === 'active'
      && sheet06?.loadedAssetCount === 10;
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 90000 });

  await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
  await page.waitForTimeout(300);
  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    app.speedIdx = 1;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const reno = app.state.shop?.reno;
    if (reno) {
      if (Array.isArray(reno.grime)) reno.grime.fill(0);
      for (const clutter of reno.clutter || []) clutter.cleared = true;
      clubhouse.rebuildReno?.();
    }
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.setTool?.(null);
    walk.state.x = origin.x - 3.4;
    walk.state.z = origin.z + 4.4;
    const dx = clubhouse.doorWorld.x - walk.state.x;
    const dz = clubhouse.doorWorld.z - walk.state.z;
    walk.state.yaw = Math.atan2(-dx, -dz);
    walk.state.pitch = -0.04;
    return {
      description: 'isolated bootstrap save, 2 PM, no organic walk-ins, clean review fixture',
      origin: origin.toArray(),
    };
  });
  await page.waitForTimeout(700);
  await capture('01-runtime-mounts-and-entry.png');

  phase = 'mount-audit';
  const mountAudit = await page.evaluate(async () => {
    const THREE = await import('three');
    const [{ PROP_PLACEMENTS, RUNTIME_ASSET_MANIFEST_BY_NUMBER }, { INTERIOR, SHELL }] = await Promise.all([
      import('/src/render3d/assets51to100/runtimeManifest.js'),
      import('/src/data/shopLayout.js'),
    ]);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const runtime = clubhouse.assets51to100Runtime;
    const interior = clubhouse.interior;
    interior.updateWorldMatrix(true, true);

    const effectivelyVisible = (object, stop) => {
      for (let cursor = object; cursor; cursor = cursor.parent) {
        if (cursor.visible === false) return false;
        if (cursor === stop) break;
      }
      return true;
    };
    const localPoint = (world) => interior.worldToLocal(world.clone());
    const visibleBounds = (root) => {
      const world = new THREE.Box3();
      root.updateWorldMatrix(true, true);
      root.traverse((object) => {
        if (!object.isMesh || !effectivelyVisible(object, root)) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        if (!object.geometry.boundingBox) return;
        world.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      });
      if (world.isEmpty()) return null;
      const local = new THREE.Box3();
      for (const x of [world.min.x, world.max.x]) {
        for (const y of [world.min.y, world.max.y]) {
          for (const z of [world.min.z, world.max.z]) {
            local.expandByPoint(localPoint(new THREE.Vector3(x, y, z)));
          }
        }
      }
      return {
        min: local.min.toArray(),
        max: local.max.toArray(),
        size: local.getSize(new THREE.Vector3()).toArray(),
      };
    };

    const instances = [];
    for (const placement of PROP_PLACEMENTS) {
      const fixtureIds = placement.fixtureIds?.length ? placement.fixtureIds : [null];
      for (const fixtureId of fixtureIds) {
        const root = runtime.getRoot(placement.n, fixtureId);
        if (!root) {
          instances.push({ number: placement.n, fixtureId, missing: true });
          continue;
        }
        root.updateWorldMatrix(true, true);
        let visibleMeshes = 0;
        root.traverse((object) => {
          if (object.isMesh && effectivelyVisible(object, root)) visibleMeshes += 1;
        });
        const placementSocket = root.getObjectByName('SOCKET_PLACEMENT');
        const socketLocal = placementSocket
          ? localPoint(placementSocket.getWorldPosition(new THREE.Vector3())).toArray()
          : null;
        const expected = RUNTIME_ASSET_MANIFEST_BY_NUMBER[placement.n].defaultTransform.position;
        const socketError = socketLocal && !fixtureId
          ? Math.hypot(
            socketLocal[0] - expected[0],
            socketLocal[1] - expected[1],
            socketLocal[2] - expected[2],
          )
          : null;
        instances.push({
          number: placement.n,
          fixtureId,
          mount: placement.mount,
          parent: root.parent?.name || null,
          parentFixtureId: root.parent?.userData?.fixtureLayoutId || null,
          parentSocket: placement.parentSocket || null,
          visible: effectivelyVisible(root, interior),
          visibleMeshes,
          socketLocal,
          expected: [...expected],
          socketError,
          bounds: visibleBounds(root),
        });
      }
    }

    const root70 = runtime.getRoot(70);
    const trophySockets = ['SOCKET_Trophy_01', 'SOCKET_Trophy_02', 'SOCKET_Collectible_01']
      .map((name) => {
        const socket = root70?.getObjectByName(name);
        return {
          name,
          populated: socket?.children?.some((child) => /^Asset70SocketTrophy_/u.test(child.name)) || false,
          children: socket?.children?.map((child) => child.name) || [],
        };
      });

    const root61 = runtime.getRoot(61);
    const registerSockets = [
      'SOCKET_ProductStage', 'SOCKET_Scanner', 'SOCKET_POS', 'SOCKET_CardTerminal',
      'SOCKET_CashDrawer', 'SOCKET_ReceiptPrinter', 'SOCKET_Bagging',
    ].map((name) => {
      const socket = root61?.getObjectByName(name);
      return { name, local: socket ? localPoint(socket.getWorldPosition(new THREE.Vector3())).toArray() : null };
    });

    const root66 = runtime.getRoot(66);
    const root81 = runtime.getRoot(81);
    const laptopRig = clubhouse.laptopRig();
    const laptopSocket = root66?.getObjectByName('SOCKET_Laptop');
    const chairSocket = root66?.getObjectByName('SOCKET_ChairPlacement');
    const laptopWorld = laptopRig?.object?.getWorldPosition(new THREE.Vector3()) || null;
    const chairWorld = root81?.getWorldPosition(new THREE.Vector3()) || null;
    const laptopSocketWorld = laptopSocket?.getWorldPosition(new THREE.Vector3()) || null;
    const chairSocketWorld = chairSocket?.getWorldPosition(new THREE.Vector3()) || null;
    const seatPose = clubhouse.laptopPose(34, 16 / 9);
    const office = {
      laptopDistanceToSocket: laptopWorld && laptopSocketWorld
        ? laptopWorld.distanceTo(laptopSocketWorld) : null,
      chairDistanceToSocket: chairWorld && chairSocketWorld
        ? chairWorld.distanceTo(chairSocketWorld) : null,
      laptopVisible: laptopRig?.object ? effectivelyVisible(laptopRig.object, interior) : false,
      chairVisible: root81 ? effectivelyVisible(root81, interior) : false,
      seatPoseFinite: seatPose ? Object.values(seatPose).every(Number.isFinite) : false,
      laptopLocal: laptopWorld ? localPoint(laptopWorld).toArray() : null,
      laptopSocketLocal: laptopSocketWorld ? localPoint(laptopSocketWorld).toArray() : null,
      chairLocal: chairWorld ? localPoint(chairWorld).toArray() : null,
      chairSocketLocal: chairSocketWorld ? localPoint(chairSocketWorld).toArray() : null,
    };

    const shellOverflow = instances.map((entry) => {
      if (!entry.bounds) return { number: entry.number, fixtureId: entry.fixtureId, finite: false };
      const [minX, minY, minZ] = entry.bounds.min;
      const [maxX, maxY, maxZ] = entry.bounds.max;
      return {
        number: entry.number,
        fixtureId: entry.fixtureId,
        finite: [...entry.bounds.min, ...entry.bounds.max].every(Number.isFinite),
        overflow: Math.max(
          0,
          maxX - SHELL.w / 2,
          -SHELL.w / 2 - minX,
          maxZ - SHELL.d / 2,
          -SHELL.d / 2 - minZ,
          maxY - SHELL.h - 0.3,
          -0.35 - minY,
        ),
      };
    });

    return {
      runtime: runtime.diagnostics(),
      instances,
      trophySockets,
      populatedTrophySockets: root70?.userData?.populatedTrophySockets ?? null,
      registerSockets,
      office,
      shellOverflow,
    };
  });

  const nonFixture = mountAudit.instances.filter((entry) => !entry.fixtureId);
  addCheck('all-41-runtime-instances-render',
    mountAudit.instances.length === 41
      && mountAudit.instances.every((entry) => !entry.missing && entry.visible && entry.visibleMeshes > 0),
    mountAudit.instances);
  addCheck('all-nonfixture-placement-sockets-match-runtime-manifest',
    nonFixture.every((entry) => Number.isFinite(entry.socketError) && entry.socketError <= 0.003),
    nonFixture.map(({ number, mount, socketError, socketLocal, expected }) => ({
      number, mount, socketError, socketLocal, expected,
    })));
  addCheck('movable-fixtures-remain-attached-to-save-identities',
    mountAudit.instances.filter((entry) => entry.fixtureId).every((entry) => (
      entry.parentFixtureId === entry.fixtureId && entry.visible
    )),
    mountAudit.instances.filter((entry) => entry.fixtureId));
  addCheck('visible-asset-bounds-are-finite-and-contained-by-clubhouse-shell',
    mountAudit.shellOverflow.every((entry) => entry.finite && entry.overflow <= 0.001),
    mountAudit.shellOverflow);
  addCheck('asset-70-populates-all-three-authored-trophy-sockets',
    mountAudit.populatedTrophySockets === 3
      && mountAudit.trophySockets.every((socket) => socket.populated),
    { count: mountAudit.populatedTrophySockets, sockets: mountAudit.trophySockets });
  addCheck('asset-61-register-hardware-sockets-are-finite-and-above-the-counter',
    mountAudit.registerSockets.every((socket) => (
      socket.local?.every(Number.isFinite) && socket.local[1] >= 0.75 && socket.local[1] <= 1.45
    )),
    mountAudit.registerSockets);
  addCheck('desk-laptop-chair-alignment-is-visible-and-finite',
    mountAudit.office.laptopVisible
      && mountAudit.office.chairVisible
      && mountAudit.office.seatPoseFinite
      && mountAudit.office.laptopDistanceToSocket <= 0.3
      && mountAudit.office.chairDistanceToSocket <= 0.55,
    mountAudit.office);

  phase = 'customer-navigation';
  const customerFixture = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = () => (typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers);
    const customer = clubhouse.debugSpawn(false);
    window.__assetsCompletionCustomerTrace = {
      id: customer.customerId,
      samples: [],
      maxStuck: 0,
      repathedSamples: 0,
      enteredObserved: false,
    };
    window.__assetsCompletionCustomerTimer = setInterval(() => {
      const trace = window.__assetsCompletionCustomerTrace;
      const live = customers().find((entry) => entry.customerId === trace.id);
      if (!live) return;
      const sample = {
        x: live.mesh.position.x,
        y: live.mesh.position.y,
        z: live.mesh.position.z,
        stopIdx: live.stopIdx,
        stopKind: live.stops[live.stopIdx]?.kind || null,
        stuckT: live.stuckT || 0,
        repathed: !!live.repathed,
        entered: !!live.entered,
      };
      trace.samples.push(sample);
      if (trace.samples.length > 500) trace.samples.shift();
      trace.maxStuck = Math.max(trace.maxStuck, sample.stuckT);
      if (sample.repathed) trace.repathedSamples += 1;
      if (sample.entered) trace.enteredObserved = true;
    }, 100);
    return {
      customerId: customer.customerId,
      start: customer.mesh.position.toArray(),
      stops: customer.stops.map(({ kind, x, z }) => ({ kind, x, z })),
    };
  });
  const entered = await page.waitForFunction((customerId) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    const customer = customers
      .find((entry) => entry.customerId === customerId);
    return customer?.entered === true && customer.stopIdx >= 2;
  }, customerFixture.customerId, { timeout: 30000 }).then(() => true).catch(() => false);
  await capture('02-customer-entered-through-authored-door.png');
  const exitFixture = await page.evaluate((customerId) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers() : clubhouse.customers;
    const customer = customers.find((entry) => entry.customerId === customerId);
    if (!customer) return null;
    const exitIndex = customer.stops.findIndex((stop) => stop.kind === 'exit');
    customer.cart = [];
    customer.stopIdx = exitIndex;
    customer.linger = 0;
    customer.path = [];
    customer.pathGoal = null;
    customer.stuckT = 0;
    customer.repathed = false;
    return { exitIndex, position: customer.mesh.position.toArray() };
  }, customerFixture.customerId);
  const exited = exitFixture ? await page.waitForFunction((customerId) => (
    (() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = typeof clubhouse.customers === 'function'
        ? clubhouse.customers() : clubhouse.customers;
      return !customers.some((entry) => entry.customerId === customerId);
    })()
  ), customerFixture.customerId, { timeout: 30000 }).then(() => true).catch(() => false) : false;
  await capture('03-customer-exited-through-authored-door.png');
  const customerTrace = await page.evaluate(() => {
    clearInterval(window.__assetsCompletionCustomerTimer);
    const result = structuredClone(window.__assetsCompletionCustomerTrace);
    delete window.__assetsCompletionCustomerTimer;
    delete window.__assetsCompletionCustomerTrace;
    return result;
  });
  addCheck('customer-enters-and-exits-without-repath-or-snag',
    entered && exited
      && customerTrace.enteredObserved
      && customerTrace.maxStuck < 1.2
      && customerTrace.repathedSamples === 0
      && customerTrace.samples.every((sample) => (
        [sample.x, sample.y, sample.z, sample.stuckT].every(Number.isFinite)
      )),
    { customerFixture, exitFixture, entered, exited, trace: customerTrace });

  phase = 'laptop-resize';
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = origin.x + 8.45;
    walk.state.z = origin.z + 4.5;
    walk.state.yaw = -Math.PI / 2;
    walk.state.pitch = -0.05;
  });
  await page.waitForFunction(() => /laptop/iu.test(
    window.__fw.scene3d.walk.getFocusLabel?.() || '',
  ), null, { timeout: 10000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const root = document.querySelector('.laptop-screen');
    return window.__fw?.laptopOpen === true && root && root.style.display !== 'none';
  }, null, { timeout: 15000 });
  await page.waitForTimeout(900);

  const viewportResults = [];
  for (const viewport of [
    { width: 1280, height: 720, file: '04-laptop-1280x720.png' },
    { width: 1440, height: 900, file: '05-laptop-1440x900.png' },
    { width: 1920, height: 1080, file: '06-laptop-1920x1080.png' },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(700);
    const result = await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const canvas = document.getElementById('game');
      const rect = canvas.getBoundingClientRect();
      const camera = app.scene3d.camera;
      camera.updateMatrixWorld();
      const points = clubhouse.laptopScreenCorners().map((corner) => {
        const projected = corner.clone().project(camera);
        return {
          x: rect.left + ((projected.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - projected.y) / 2) * rect.height,
        };
      });
      const xs = points.map(({ x }) => x);
      const ys = points.map(({ y }) => y);
      const box = {
        left: Math.min(...xs), right: Math.max(...xs),
        top: Math.min(...ys), bottom: Math.max(...ys),
      };
      const frame = document.querySelector('.lt-frame');
      const frameRect = frame?.getBoundingClientRect();
      const transform = frame ? getComputedStyle(frame).transform : null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvas: { width: rect.width, height: rect.height },
        cameraAspect: camera.aspect,
        expectedAspect: rect.width / rect.height,
        points,
        coverage: {
          width: (box.right - box.left) / rect.width,
          height: (box.bottom - box.top) / rect.height,
        },
        inside: points.every((point) => (
          point.x >= rect.left - 1 && point.x <= rect.right + 1
          && point.y >= rect.top - 1 && point.y <= rect.bottom + 1
        )),
        finite: points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
        frame: frameRect ? {
          left: frameRect.left, top: frameRect.top,
          width: frameRect.width, height: frameRect.height,
        } : null,
        transform,
        transformFinite: !!transform && transform !== 'none' && !/NaN|Infinity/iu.test(transform),
        laptopOpen: app.laptopOpen,
      };
    });
    viewportResults.push(result);
    await capture(viewport.file);
  }
  addCheck('laptop-ui-remains-welded-to-screen-across-resolution-and-aspect-changes',
    viewportResults.every((result) => (
      result.viewport.width === result.canvas.width
      && result.viewport.height === result.canvas.height
      && Math.abs(result.cameraAspect - result.expectedAspect) <= 0.0001
      && result.finite && result.inside && result.transformFinite && result.laptopOpen
      && result.coverage.width >= 0.55 && result.coverage.width <= 0.95
      && result.coverage.height >= 0.55 && result.coverage.height <= 0.95
    )),
    viewportResults);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw?.laptopOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(800);
  const officeAfterExit = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const root81 = clubhouse.assets51to100Runtime.getRoot(81);
    const laptop = clubhouse.laptopRig()?.object;
    const shown = (object) => {
      if (!object) return false;
      for (let cursor = object; cursor; cursor = cursor.parent) {
        if (cursor.visible === false) return false;
      }
      return true;
    };
    return {
      chairPresent: !!root81?.parent,
      chairVisible: shown(root81),
      laptopPresent: !!laptop?.parent,
      laptopVisible: shown(laptop),
      fov: app.scene3d.camera.fov,
      near: app.scene3d.camera.near,
      laptopRoots: document.querySelectorAll('.laptop-screen').length,
      visibleLaptopRoots: [...document.querySelectorAll('.laptop-screen')]
        .filter((root) => root.style.display !== 'none').length,
    };
  });
  const beforeWalkAway = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  await page.keyboard.down('a');
  await page.waitForTimeout(600);
  await page.keyboard.up('a');
  const afterWalkAway = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  const walkAwayDistance = Math.hypot(
    afterWalkAway.x - beforeWalkAway.x,
    afterWalkAway.z - beforeWalkAway.z,
  );
  await capture('07-office-chair-and-laptop-after-exit.png');
  addCheck('office-chair-and-laptop-remain-after-mode-exit-and-player-can-walk-away',
    officeAfterExit.chairPresent && officeAfterExit.chairVisible
      && officeAfterExit.laptopPresent && officeAfterExit.laptopVisible
      && officeAfterExit.fov === 66 && officeAfterExit.near === 0.15
      && officeAfterExit.laptopRoots === 1 && officeAfterExit.visibleLaptopRoots === 0
      && walkAwayDistance > 0.05,
    { officeAfterExit, walkAwayDistance, beforeWalkAway, afterWalkAway });

  const blockingDiagnostics = diagnostics.filter((entry) => !(
    (entry.kind === 'console:warning'
      && /dyn_index_vec4_float4_int|THREE\.WebGLProgram/u.test(entry.message))
    || entry.kind === 'requestaborted'
  ));
  addCheck('blocking-browser-diagnostics', blockingDiagnostics.length === 0, blockingDiagnostics);
  addCheck('completion-screenshot-evidence-retained',
    captures.length === 7 && captures.every((file) => fs.existsSync(file)), captures);

  const report = {
    schemaVersion: 1,
    ok: checks.every((check) => check.ok),
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/assets-51-100-completion-qa.js --bootstrap',
    methodology: {
      fixture,
      runtimeMounts: 'live roots, rendered mesh ancestry, SOCKET_PLACEMENT world alignment, shell containment, nested/fixture parenting',
      customerNavigation: 'debugSpawn creates a normal customer; entry and exit locomotion run through live nav, collision, and automatic authored doors',
      customerFixtureBoundary: 'after observed entry, only the next stop is advanced to exit; all movement remains the ordinary customer update path',
      laptopControls: 'normal E entry, browser resize events, normal Escape exit, normal A walk-away',
      viewports: viewportResults.map(({ viewport }) => viewport),
    },
    captures,
    mountAudit,
    customer: { customerFixture, exitFixture, entered, exited, trace: customerTrace },
    viewportResults,
    officeAfterExit: { ...officeAfterExit, walkAwayDistance },
    checks,
    diagnostics,
    blockingDiagnostics,
  };
  fs.writeFileSync(path.join(out, 'completion-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
