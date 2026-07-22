// Production acceptance for the persistent grounds tractor and fleet golf cart.
//
// The save fixture only skips the tractor-repair tutorial. Every vehicle action
// below uses the shipped first-person keyboard path: approach, E to mount/park,
// WASD to drive and steer, and L to switch the authored lamps.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8467/';
  const out = process.env.PROPERTY_VEHICLE_QA_OUT_DIR
    ? path.resolve(repo, process.env.PROPERTY_VEHICLE_QA_OUT_DIR)
    : path.join(repo, 'qa', 'property-expansion-world-overhaul', 'vehicles', 'iteration-1');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  const vehicleAssetRequests = [];
  const inFlightRequests = new Set();
  let phase = 'fixture';
  page.on('request', (request) => inFlightRequests.add(request));
  page.on('requestfinished', (request) => inFlightRequests.delete(request));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push({ phase, kind: 'console', text: message.text() });
  });
  page.on('pageerror', (error) => diagnostics.push({ phase, kind: 'pageerror', text: error.message }));
  page.on('requestfailed', (request) => {
    inFlightRequests.delete(request);
    diagnostics.push({
      phase, kind: 'requestfailed', text: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
    });
  });
  page.on('request', (request) => {
    const url = request.url();
    if (/\/vendor\/models\/vehicles\/.+\.glb(?:\?|$)/.test(url)
      || /\/Assets\/(?:tractor|red tractor|golf cart)/i.test(url)) {
      vehicleAssetRequests.push({ phase, url });
    }
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  const waitForNetworkQuiet = async (timeoutMs = 120000, quietMs = 750) => {
    const deadline = Date.now() + timeoutMs;
    let quietSince = null;
    while (Date.now() < deadline) {
      if (inFlightRequests.size === 0) {
        if (quietSince == null) quietSince = Date.now();
        if (Date.now() - quietSince >= quietMs) return;
      } else {
        quietSince = null;
      }
      await page.waitForTimeout(100);
    }
    throw new Error(`Network did not become quiet; ${inFlightRequests.size} request(s) remain`);
  };

  // Begin with a deterministic unrepaired property so the broken authored model
  // is evaluated before the repaired/drivable scene is built.
  await page.evaluate(async () => {
    const E = await import('/src/sim/empire.js');
    const V = await import('/src/sim/vehicles.js');
    const source = localStorage.getItem('golfempire:autosave');
    const empire = E.deserializeEmpire(JSON.parse(source));
    const state = E.activeState(empire);
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.tractor = { steps: { cleared: false, fuel: false, belt: false }, repaired: false };
    V.ensureVehicles(state, { recoverActive: true });
    state.weather.locked = true;
    state.weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 5 };
    const day = Math.floor(state.clock.minutes / 1440);
    state.clock.minutes = day * 1440 + 14 * 60;
    empire.clockMinutes = state.clock.minutes;
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  });

  const waitForGame = async ({ repaired }) => {
    await page.getByText('Continue', { exact: true }).click();
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.state, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (window.__fw?.prewarming === true) return false;
      return !veil || getComputedStyle(veil).display === 'none' || Number(getComputedStyle(veil).opacity) < 0.02;
    }, null, { timeout: 90000 });
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      app.scene3d.walk.clearKeys?.();
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    });
    await page.waitForFunction((needsTractor) => {
      const vehicles = window.__fw?.scene3d?.walk?.vehicles;
      if (!Array.isArray(vehicles)) return false;
      const cart = vehicles.find((entry) => entry.id === 'golf-cart-1');
      const tractor = vehicles.find((entry) => entry.id === 'tractor-1');
      return !!cart?.parts && (!needsTractor || !!tractor?.parts);
    }, repaired, { timeout: 90000 });
    await page.evaluate(async () => {
      const barrier = window.__fw?.scene3d?.assetBarrier?.(120000);
      if (barrier?.promise) await barrier.promise;
    });
    await waitForNetworkQuiet();
    await page.waitForTimeout(800);
    await page.locator('#game').click({ position: { x: 800, y: 450 } });
    await page.waitForFunction(() => document.pointerLockElement?.id === 'game', null, { timeout: 2500 })
      .catch(() => {});
    const pointerLockAcquired = await page.evaluate(() => document.pointerLockElement?.id === 'game');
    if (!pointerLockAcquired) {
      await page.locator('.shop-lockhint').evaluate((node) => { node.style.visibility = 'hidden'; }).catch(() => {});
    }
  };

  const anchor = async () => page.evaluate(() => {
    const course = window.__fw.state.course;
    const structure = course.structures[0];
    return {
      bx: (structure.x + structure.w / 2) * 8 - course.w * 8 / 2,
      bz: (structure.y + structure.h / 2) * 8 - course.h * 8 / 2,
    };
  });

  const pose = async (at, target, pitch = -0.06) => {
    await page.evaluate(({ at, target, pitch }) => {
      const walk = window.__fw.scene3d.walk;
      walk.clearKeys?.();
      const dx = target.x - at.x;
      const dz = target.z - at.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.x = at.x;
      walk.state.z = at.z;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = pitch;
    }, { at, target, pitch });
    await page.waitForTimeout(700);
  };

  // The runner has already booted the title screen before this function can
  // attach request listeners. Drain that bootstrap prewarm before replacing
  // its save fixture so the intentional navigation does not cancel invisible
  // title-screen work.
  await page.waitForFunction(() => window.__fw?.prewarming !== true, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await waitForNetworkQuiet();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  phase = 'broken-tractor';
  await waitForGame({ repaired: false });
  const brokenAnchor = await anchor();
  await pose(
    { x: brokenAnchor.bx + 7.8, z: brokenAnchor.bz + 24.2 },
    { x: brokenAnchor.bx + 14.5, z: brokenAnchor.bz + 18.5 },
    -0.1,
  );
  await page.screenshot({ path: path.join(out, '01-broken-tractor-yard.png') });

  // Promote the existing repair state and use the game's own autosave before a
  // cold scene rebuild. This checks that the repaired asset follows persistence.
  phase = 'repair-fixture-save';
  await page.evaluate(async () => {
    const app = window.__fw;
    app.state.tractor.steps = { cleared: true, fuel: true, belt: true };
    app.state.tractor.repaired = true;
    await app.autosave();
  });
  await waitForNetworkQuiet();
  phase = 'repaired-load';
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitForGame({ repaired: true });

  const vehicleSnapshot = async (id) => page.evaluate((vehicleId) => {
    const actor = window.__fw.scene3d.walk.vehicles.find((entry) => entry.id === vehicleId);
    const record = window.__fw.state.vehicles.records.find((entry) => entry.id === vehicleId);
    const rotations = actor?.parts?.wheels?.map((wheel) => +wheel.rotation.x.toFixed(5)) || [];
    return {
      id: vehicleId,
      mounted: actor?.mounted === true,
      x: +Number(record?.x).toFixed(4),
      z: +Number(record?.z).toFixed(4),
      yaw: +Number(record?.yaw).toFixed(4),
      energy: +Number(record?.energy).toFixed(4),
      condition: +Number(record?.condition).toFixed(4),
      cleanliness: +Number(record?.cleanliness).toFixed(4),
      odometerYd: +Number(record?.odometerYd).toFixed(4),
      lightsOn: record?.lightsOn === true,
      parked: record?.parked === true,
      engineOn: record?.engineOn === true,
      wheelRotations: rotations,
      lod0Visible: actor?.parts?.lod0?.visible ?? null,
      lod1Visible: actor?.parts?.lod1?.visible ?? null,
      meshCount: (() => {
        let count = 0;
        actor?.mesh?.traverse((object) => { if (object.isMesh && object.visible) count += 1; });
        return count;
      })(),
    };
  }, id);

  const approach = async (id) => {
    const approachResult = await page.evaluate((vehicleId) => {
      const app = window.__fw;
      const actor = app.scene3d.walk.vehicles.find((entry) => entry.id === vehicleId);
      const walk = app.scene3d.walk;
      const radius = Math.min(3.65, actor.radius + 2.25);
      for (let i = 0; i < 24; i += 1) {
        const angle = (i / 24) * Math.PI * 2;
        const x = actor.x + Math.cos(angle) * radius;
        const z = actor.z + Math.sin(angle) * radius;
        if (!walk.isFree(x, z, 0.34)) continue;
        const dx = actor.x - x;
        const dz = actor.z - z;
        const distance = Math.hypot(dx, dz) || 1;
        walk.clearKeys?.();
        walk.state.x = x;
        walk.state.z = z;
        walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
        walk.state.pitch = -0.08;
        return { ok: true, x, z, actorX: actor.x, actorZ: actor.z };
      }
      return { ok: false };
    }, id);
    if (!approachResult.ok) throw new Error(`No collision-free approach to ${id}`);
    await page.waitForFunction((vehicleId) => (
      window.__fw?.scene3d?.walk?.getFocus?.()?.vehicle?.id === vehicleId
    ), id, { timeout: 10000 });
    return approachResult;
  };

  const driveVehicle = async ({ id, prefix, steerKey }) => {
    phase = `${id}-approach`;
    await approach(id);
    const prompt = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
    await page.screenshot({ path: path.join(out, `${prefix}-approach-prompt.png`) });
    const before = await vehicleSnapshot(id);

    phase = `${id}-storage`;
    await page.keyboard.press('f');
    await page.waitForFunction(() => window.__fw.scene3d.walk.getTool() === 'washer', null, { timeout: 3000 });
    await page.keyboard.press('x');
    await page.waitForFunction((vehicleId) => {
      const actor = window.__fw.scene3d.walk.vehicles.find((entry) => entry.id === vehicleId);
      return window.__fw.scene3d.walk.getTool() === null
        && actor.record.cargo.some((entry) => entry.id === 'washer');
    }, id, { timeout: 3000 });
    await page.waitForTimeout(900);
    const storedPrompt = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
    await page.screenshot({ path: path.join(out, `${prefix}-tool-stowed.png`) });
    await page.keyboard.press('x');
    await page.waitForFunction((vehicleId) => {
      const actor = window.__fw.scene3d.walk.vehicles.find((entry) => entry.id === vehicleId);
      return window.__fw.scene3d.walk.getTool() === 'washer' && actor.record.cargo.length === 0;
    }, id, { timeout: 3000 });
    await page.keyboard.press('x');
    await page.waitForFunction((vehicleId) => {
      const actor = window.__fw.scene3d.walk.vehicles.find((entry) => entry.id === vehicleId);
      return window.__fw.scene3d.walk.getTool() === null
        && actor.record.cargo.some((entry) => entry.id === 'washer');
    }, id, { timeout: 3000 });
    await page.waitForTimeout(3600);

    phase = `${id}-mount`;
    await page.keyboard.press('e');
    await page.waitForFunction((vehicleId) => {
      const actor = window.__fw.scene3d.walk.vehicles.find((entry) => entry.id === vehicleId);
      return actor?.mounted === true && actor?.record?.engineOn === true;
    }, id, { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `${prefix}-driver-seat.png`) });

    phase = `${id}-lights`;
    await page.keyboard.press('l');
    await page.waitForFunction((vehicleId) => (
      window.__fw.state.vehicles.records.find((entry) => entry.id === vehicleId)?.lightsOn === true
    ), id, { timeout: 3000 });
    await page.evaluate(() => {
      const app = window.__fw;
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 22 * 60;
      app.scene3d.applyTimeWeather?.(22 * 60, app.state.weather);
    });
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(out, `${prefix}-lights-on.png`) });
    await page.evaluate(() => {
      const app = window.__fw;
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    });
    await page.waitForTimeout(350);

    phase = `${id}-drive`;
    await page.keyboard.down('s');
    await page.waitForTimeout(1100);
    await page.keyboard.up('s');
    await page.waitForTimeout(250);
    await page.keyboard.down('w');
    await page.keyboard.down(steerKey);
    await page.waitForTimeout(1100);
    await page.keyboard.up(steerKey);
    await page.waitForTimeout(900);
    await page.keyboard.up('w');
    await page.waitForTimeout(350);
    const afterDrive = await vehicleSnapshot(id);
    await page.screenshot({ path: path.join(out, `${prefix}-after-drive.png`) });

    phase = `${id}-park`;
    await page.keyboard.press('e');
    await page.waitForFunction((vehicleId) => {
      const actor = window.__fw.scene3d.walk.vehicles.find((entry) => entry.id === vehicleId);
      const record = window.__fw.state.vehicles.records.find((entry) => entry.id === vehicleId);
      return actor?.mounted === false && record?.parked === true && record?.engineOn === false;
    }, id, { timeout: 5000 });
    await page.waitForTimeout(450);
    const parked = await vehicleSnapshot(id);
    const safeExit = await page.evaluate((vehicleId) => {
      const walk = window.__fw.scene3d.walk;
      const actor = walk.vehicles.find((entry) => entry.id === vehicleId);
      return {
        free: walk.isFree(walk.state.x, walk.state.z, walk.state.radius),
        distanceFromVehicle: Math.hypot(walk.state.x - actor.x, walk.state.z - actor.z),
        requiredClearance: actor.radius + walk.state.radius,
      };
    }, id);
    await page.screenshot({ path: path.join(out, `${prefix}-parked.png`) });

    return {
      id,
      prompt,
      storedPrompt,
      before,
      afterDrive,
      parked,
      safeExit,
      distanceYd: +Math.hypot(afterDrive.x - before.x, afterDrive.z - before.z).toFixed(4),
      odometerGainYd: +(afterDrive.odometerYd - before.odometerYd).toFixed(4),
      energyUsed: +(before.energy - afterDrive.energy).toFixed(4),
      wheelAnimationChanged: afterDrive.wheelRotations.some((value, index) => value !== before.wheelRotations[index]),
    };
  };

  const repairedAnchor = await anchor();
  await pose(
    { x: repairedAnchor.bx + 7.4, z: repairedAnchor.bz + 24.5 },
    { x: repairedAnchor.bx + 14.5, z: repairedAnchor.bz + 18.5 },
    -0.08,
  );
  await page.screenshot({ path: path.join(out, '02-repaired-tractor-static.png') });
  await pose(
    { x: repairedAnchor.bx + 3.2, z: repairedAnchor.bz + 18.2 },
    { x: repairedAnchor.bx + 9.5, z: repairedAnchor.bz + 12.5 },
    -0.08,
  );
  await page.screenshot({ path: path.join(out, '03-golf-cart-static.png') });

  const tractor = await driveVehicle({ id: 'tractor-1', prefix: '04-tractor', steerKey: 'a' });
  const golfCart = await driveVehicle({ id: 'golf-cart-1', prefix: '05-golf-cart', steerKey: 'd' });

  const beforeReload = await page.evaluate(() => ({
    activeId: window.__fw.state.vehicles.activeId,
    records: window.__fw.state.vehicles.records.map((record) => ({
      id: record.id,
      x: record.x,
      z: record.z,
      yaw: record.yaw,
      lightsOn: record.lightsOn,
      energy: record.energy,
      condition: record.condition,
      cleanliness: record.cleanliness,
      odometerYd: record.odometerYd,
      parked: record.parked,
      engineOn: record.engineOn,
      cargo: record.cargo.map((entry) => ({ ...entry })),
    })),
  }));

  phase = 'save-reload';
  await page.evaluate(() => window.__fw.autosave());
  await waitForNetworkQuiet();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitForGame({ repaired: true });
  const afterReload = await page.evaluate(() => ({
    activeId: window.__fw.state.vehicles.activeId,
    records: window.__fw.state.vehicles.records.map((record) => ({
      id: record.id,
      x: record.x,
      z: record.z,
      yaw: record.yaw,
      lightsOn: record.lightsOn,
      energy: record.energy,
      condition: record.condition,
      cleanliness: record.cleanliness,
      odometerYd: record.odometerYd,
      parked: record.parked,
      engineOn: record.engineOn,
      cargo: record.cargo.map((entry) => ({ ...entry })),
    })),
    actorIds: window.__fw.scene3d.walk.vehicles.map((actor) => actor.id),
    sceneVehicleRoots: window.__fw.scene3d.scene.children
      .filter((object) => /^Vehicle_(tractor-1|golf-cart-1)$/.test(object.name))
      .map((object) => object.name),
  }));

  const almost = (a, b) => Math.abs(Number(a) - Number(b)) < 0.002;
  const persistenceMatches = beforeReload.records.every((before) => {
    const after = afterReload.records.find((record) => record.id === before.id);
    return !!after
      && almost(after.x, before.x)
      && almost(after.z, before.z)
      && almost(after.yaw, before.yaw)
      && almost(after.energy, before.energy)
      && almost(after.condition, before.condition)
      && almost(after.cleanliness, before.cleanliness)
      && almost(after.odometerYd, before.odometerYd)
      && after.lightsOn === before.lightsOn
      && JSON.stringify(after.cargo) === JSON.stringify(before.cargo)
      && after.parked === true
      && after.engineOn === false;
  });

  phase = 'lod';
  const lod = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const actor = walk.vehicles.find((entry) => entry.id === 'tractor-1');
    walk.clearKeys?.();
    walk.state.x = actor.x + actor.spec.lodDistanceYd + 22;
    walk.state.z = actor.z;
    walk.state.yaw = Math.PI / 2;
    walk.state.pitch = -0.03;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const far = { lod0: actor.parts.lod0.visible, lod1: actor.parts.lod1.visible };
    walk.state.x = actor.x + 7;
    walk.state.z = actor.z + 8;
    const dx = actor.x - walk.state.x;
    const dz = actor.z - walk.state.z;
    walk.state.yaw = Math.atan2(-dx, -dz);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const near = { lod0: actor.parts.lod0.visible, lod1: actor.parts.lod1.visible };
    return { far, near };
  });
  await page.screenshot({ path: path.join(out, '06-near-lod-after-reload.png') });

  phase = 'performance';
  const performanceSamples = [];
  for (let run = 0; run < 3; run += 1) {
    performanceSamples.push(await page.evaluate(() => new Promise((resolve) => {
      const frames = [];
      const started = performance.now();
      let prior = started;
      const tick = (now) => {
        frames.push(now - prior);
        prior = now;
        if (now - started < 5000) return requestAnimationFrame(tick);
        const sorted = [...frames].sort((a, b) => a - b);
        const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 0;
        resolve({
          durationMs: now - started,
          frameCount: frames.length,
          averageFps: frames.length / ((now - started) / 1000),
          onePercentLowFps: p99 > 0 ? 1000 / p99 : 0,
          worstFrameMs: Math.max(...frames),
          geometries: window.__fw.scene3d.renderer.info.memory.geometries,
          textures: window.__fw.scene3d.renderer.info.memory.textures,
          jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        });
      };
      requestAnimationFrame(tick);
    })));
  }
  await page.screenshot({ path: path.join(out, '07-persistence-and-performance.png') });

  const duplicateSafe = new Set(afterReload.actorIds).size === 2
    && afterReload.actorIds.length === 2
    && afterReload.sceneVehicleRoots.length === 2;
  const expectedAbortedRequests = diagnostics.filter((entry) => (
    entry.kind === 'requestfailed'
      && /\.glb \(net::ERR_ABORTED\)$/.test(entry.text)
  ));
  const unexpectedDiagnostics = diagnostics.filter((entry) => !expectedAbortedRequests.includes(entry));
  const requestedDuring = (requestPhase, suffix) => vehicleAssetRequests.some((entry) => (
    entry.phase === requestPhase && new URL(entry.url).pathname.endsWith(suffix)
  ));
  const assertions = {
    brokenAssetRoute: requestedDuring('broken-tractor', '/vendor/models/vehicles/grounds_tractor_broken.glb')
      && !requestedDuring('broken-tractor', '/vendor/models/vehicles/grounds_tractor.glb'),
    repairedAssetRoute: requestedDuring('repaired-load', '/vendor/models/vehicles/grounds_tractor.glb'),
    golfCartAssetRoute: vehicleAssetRequests.some((entry) => (
      new URL(entry.url).pathname.endsWith('/vendor/models/vehicles/fleet_golf_cart.glb')
    )),
    legacyAssetRoutesAbsent: vehicleAssetRequests.every((entry) => !/\/Assets\//i.test(entry.url)),
    tractorMoved: tractor.distanceYd > 0.5,
    tractorRecordedUse: tractor.odometerGainYd > 0.5 && tractor.energyUsed > 0,
    tractorWheelAnimation: tractor.wheelAnimationChanged,
    tractorPrompt: /fuel.+storage.+take the wheel/i.test(tractor.prompt || ''),
    tractorStorage: /1\/2 storage.+retrieve pressure washer/i.test(tractor.storedPrompt || ''),
    tractorSafeExit: tractor.safeExit.free
      && tractor.safeExit.distanceFromVehicle > tractor.safeExit.requiredClearance,
    golfCartMoved: golfCart.distanceYd > 0.5,
    golfCartRecordedUse: golfCart.odometerGainYd > 0.5 && golfCart.energyUsed > 0,
    golfCartWheelAnimation: golfCart.wheelAnimationChanged,
    golfCartPrompt: /charge.+storage.+take the wheel/i.test(golfCart.prompt || ''),
    golfCartStorage: /1\/4 storage.+retrieve pressure washer/i.test(golfCart.storedPrompt || ''),
    golfCartSafeExit: golfCart.safeExit.free
      && golfCart.safeExit.distanceFromVehicle > golfCart.safeExit.requiredClearance,
    cargoPersisted: afterReload.records.every((record) => record.cargo.some((entry) => entry.id === 'washer')),
    lightsPersisted: afterReload.records.every((record) => record.lightsOn === true),
    saveReloadExact: persistenceMatches,
    safeRecovery: beforeReload.activeId === null && afterReload.activeId === null,
    duplicateSafe,
    lodTransitions: lod.far.lod0 === false && lod.far.lod1 === true
      && lod.near.lod0 === true && lod.near.lod1 === false,
    noRuntimeErrors: unexpectedDiagnostics.length === 0,
  };
  const ok = Object.values(assertions).every(Boolean);
  const result = {
    ok,
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixture: 'repair completion only; all vehicle controls exercised through keyboard',
    tractor,
    golfCart,
    beforeReload,
    afterReload,
    assertions,
    performanceSamples,
    lod,
    vehicleAssetRequests,
    diagnostics,
    expectedAbortedRequests,
    unexpectedDiagnostics,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
