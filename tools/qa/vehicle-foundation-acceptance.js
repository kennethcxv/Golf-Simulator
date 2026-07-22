async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const out = path.resolve(repo, process.env.VEHICLE_QA_OUT_DIR
    || 'qa/property-expansion-world-overhaul/vehicles/iteration-1');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [] };
  let phase = 'fixture';
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    phase, url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  // The runner's normal bootstrap owns the save. Make this derivative repaired
  // before Continue so the scene follows the same load/migration path as a player.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const E = await import('/src/sim/empire.js');
    const source = localStorage.getItem('golfempire:autosave');
    const empire = E.deserializeEmpire(JSON.parse(source));
    const state = E.activeState(empire);
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.tractor = { steps: { cleared: true, fuel: true, belt: true }, repaired: true };
    state.weather.locked = true;
    state.weather.today = { tempHiF: 70, tempLoF: 52, rainIn: 0, humidity: 0.4, windMph: 3 };
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 19 * 60 + 30;
    empire.clockMinutes = state.clock.minutes;
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.vehicles?.length === 2, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !window.__fw?.prewarming && (!veil || getComputedStyle(veil).display === 'none'
      || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01);
  }, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const barrier = window.__fw.scene3d.assetBarrier?.(120000);
    if (barrier?.promise) await barrier.promise;
    window.__fw.speedIdx = 0;
    window.__fw.scene3d.walk.clearKeys();
  });
  await page.waitForLoadState('networkidle', { timeout: 120000 });
  phase = 'gameplay';
  await page.locator('canvas').click({ position: { x: 800, y: 440 } }).catch(() => {});

  const anchor = await page.evaluate(() => {
    const app = window.__fw;
    const structure = app.state.course.structures[0];
    const cell = 8;
    return {
      bx: (structure.x + structure.w / 2) * cell - app.state.course.w * cell / 2,
      bz: (structure.y + structure.h / 2) * cell - app.state.course.h * cell / 2,
    };
  });

  const prepare = async (vehicleId, x, z, yaw = 0) => {
    await page.evaluate(({ vehicleId, x, z, yaw }) => {
      const walk = window.__fw.scene3d.walk;
      walk.clearKeys();
      if (!walk.isActive()) walk.enter({ x, z: z + 3.1, yaw });
      walk.placeVehicle(vehicleId, x, z, yaw);
      walk.state.x = x;
      walk.state.z = z + 3.1;
      walk.state.yaw = yaw;
      walk.state.pitch = -0.08;
    }, { vehicleId, x, z, yaw });
    await page.waitForFunction((id) => {
      const focus = window.__fw.scene3d.walk.getFocus();
      return focus?.kind === 'cart' && focus?.vehicle?.id === id;
    }, vehicleId, { timeout: 10000 });
  };

  const snapshot = async (vehicleId) => page.evaluate((id) => {
    const app = window.__fw;
    const actor = app.scene3d.walk.vehicles.find((entry) => entry.id === id);
    const record = app.state.vehicles.records.find((entry) => entry.id === id);
    return {
      id,
      actor: {
        x: actor.x, z: actor.z, yaw: actor.yaw, mounted: actor.mounted,
        model: actor.mesh?.children?.[0]?.children?.[0]?.name || actor.mesh?.children?.[0]?.name || null,
        wheels: actor.parts?.wheels?.length || 0,
        steeringPivots: actor.parts?.steer?.length || 0,
        wheelRoll: actor.parts?.wheels?.map((wheel) => wheel.rotation.x) || [],
        steering: actor.parts?.steer?.map((pivot) => pivot.rotation.y) || [],
        lod: { near: actor.parts?.lod0?.visible, far: actor.parts?.lod1?.visible },
        lightsVisible: actor.runtimeLights?.visible === true,
        driverVisible: actor.driver?.root?.visible === true,
      },
      record: JSON.parse(JSON.stringify(record)),
      renderer: { ...app.scene3d.renderer.info.render },
    };
  }, vehicleId);

  const drive = async ({ id, x, z, steerKey, shot }) => {
    await prepare(id, x, z, 0);
    const before = await snapshot(id);
    await page.keyboard.press('e');
    await page.waitForFunction((vehicleId) => (
      window.__fw.scene3d.walk.cart.mounted
        && window.__fw.scene3d.walk.cart.id === vehicleId
    ), id, { timeout: 5000 });
    await page.keyboard.press('l');
    await page.keyboard.down('w');
    await page.keyboard.down(steerKey);
    await page.waitForTimeout(950);
    const steeringDuring = await snapshot(id);
    await page.screenshot({ path: path.join(out, shot) });
    await page.waitForTimeout(500);
    await page.keyboard.up(steerKey);
    await page.keyboard.up('w');
    await page.waitForTimeout(300);
    const driven = await snapshot(id);
    await page.keyboard.press('e');
    await page.waitForFunction(() => !window.__fw.scene3d.walk.cart.mounted, null, { timeout: 5000 });
    const parked = await snapshot(id);
    return { before, steeringDuring, driven, parked };
  };

  const golfCart = await drive({
    id: 'golf-cart-1', x: anchor.bx + 8, z: anchor.bz + 31,
    steerKey: 'a', shot: '01-golf-cart-driven-lights.png',
  });
  const tractor = await drive({
    id: 'tractor-1', x: anchor.bx + 17, z: anchor.bz + 32,
    steerKey: 'd', shot: '02-tractor-driven-mower.png',
  });

  phase = 'persistence-save';
  const saved = await page.evaluate(async () => {
    await window.__fw.autosave();
    return Object.fromEntries(window.__fw.state.vehicles.records.map((record) => [record.id, {
      x: record.x, z: record.z, yaw: record.yaw, lightsOn: record.lightsOn,
      energy: record.energy, condition: record.condition, cleanliness: record.cleanliness,
      odometerYd: record.odometerYd,
    }]));
  });
  // The reload is part of the persistence test, so first prove that the
  // current scene has no environment model requests left in flight. This
  // prevents an intentional navigation from being mistaken for an asset
  // failure and, more importantly, catches genuinely stuck requests here.
  await page.waitForLoadState('networkidle', { timeout: 120000 });
  phase = 'persistence-reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.vehicles?.every((vehicle) => vehicle.parts), null,
    { timeout: 120000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !window.__fw?.prewarming && (!veil || getComputedStyle(veil).display === 'none'
      || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01);
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.locator('canvas').click({ position: { x: 800, y: 440 } }).catch(() => {});
  const reloaded = await page.evaluate(() => ({
    activeId: window.__fw.state.vehicles.activeId,
    records: Object.fromEntries(window.__fw.state.vehicles.records.map((record) => [record.id, {
      x: record.x, z: record.z, yaw: record.yaw, lightsOn: record.lightsOn,
      energy: record.energy, condition: record.condition, cleanliness: record.cleanliness,
      odometerYd: record.odometerYd, parked: record.parked, engineOn: record.engineOn,
    }])),
    actors: Object.fromEntries(window.__fw.scene3d.walk.vehicles.map((actor) => [actor.id, {
      x: actor.x, z: actor.z, yaw: actor.yaw, mounted: actor.mounted,
      wheels: actor.parts?.wheels?.length || 0,
      steeringPivots: actor.parts?.steer?.length || 0,
    }])),
  }));
  await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    walk.state.x = -40;
    walk.state.z = 180;
  });
  await page.waitForTimeout(500);
  const farLod = await page.evaluate(() => Object.fromEntries(
    window.__fw.scene3d.walk.vehicles.map((actor) => [actor.id, {
      near: actor.parts?.lod0?.visible, far: actor.parts?.lod1?.visible,
    }]),
  ));

  const inspect = async (id, file) => {
    await page.evaluate((vehicleId) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const actor = walk.vehicles.find((entry) => entry.id === vehicleId);
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 14 * 60;
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
      const distance = vehicleId === 'tractor-1' ? 6.2 : 4.8;
      const angle = actor.yaw + Math.PI * 0.72;
      const atX = actor.x + Math.sin(angle) * distance;
      const atZ = actor.z + Math.cos(angle) * distance;
      walk.state.x = atX;
      walk.state.z = atZ;
      walk.state.yaw = Math.atan2(-(actor.x - atX), -(actor.z - atZ));
      walk.state.pitch = -0.10;
    }, id);
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(out, file) });
  };
  await inspect('golf-cart-1', '03-reloaded-golf-cart-close.png');
  await inspect('tractor-1', '04-reloaded-tractor-close.png');
  await page.evaluate(() => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const actor = walk.vehicles.find((entry) => entry.id === 'golf-cart-1');
    const day = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = day * 1440 + 21 * 60;
    app.scene3d.applyTimeWeather(21 * 60, app.state.weather);
    const atX = actor.x - Math.sin(actor.yaw) * 5.4;
    const atZ = actor.z - Math.cos(actor.yaw) * 5.4;
    walk.state.x = atX;
    walk.state.z = atZ;
    walk.state.yaw = Math.atan2(-(actor.x - atX), -(actor.z - atZ));
    walk.state.pitch = -0.06;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, '05-golf-cart-headlights-night.png') });

  const moved = (result) => Math.hypot(
    result.parked.record.x - result.before.record.x,
    result.parked.record.z - result.before.record.z,
  );
  const persisted = (id) => ['x', 'z', 'yaw', 'lightsOn', 'energy', 'condition', 'cleanliness', 'odometerYd']
    .every((key) => reloaded.records[id][key] === saved[id][key]);
  const checks = {
    exactAssets: golfCart.parked.actor.model === 'fleet_golf_cart'
      && tractor.parked.actor.model === 'grounds_tractor',
    operationalHierarchy: [golfCart, tractor].every((result) => (
      result.parked.actor.wheels === 4 && result.parked.actor.steeringPivots === 2
    )),
    normalControlDriving: moved(golfCart) > 2 && moved(tractor) > 2,
    wheelAnimation: [golfCart, tractor].every((result) => result.driven.actor.wheelRoll.some((value) => Math.abs(value) > 0.1)),
    steeringAnimation: [golfCart, tractor].every((result) => (
      result.steeringDuring.actor.steering.some((value) => Math.abs(value) > 0.05)
    )),
    lights: golfCart.driven.record.lightsOn && tractor.driven.record.lightsOn,
    seatedDriver: golfCart.steeringDuring.actor.driverVisible && tractor.steeringDuring.actor.driverVisible,
    lodSwitch: Object.values(farLod).every((lod) => lod.near === false && lod.far === true),
    usage: golfCart.parked.record.odometerYd > 0 && tractor.parked.record.odometerYd > 0
      && golfCart.parked.record.energy < 100 && tractor.parked.record.energy < 100,
    parking: golfCart.parked.record.parked && tractor.parked.record.parked,
    persistence: persisted('golf-cart-1') && persisted('tractor-1')
      && reloaded.activeId === null
      && Object.values(reloaded.records).every((record) => record.parked && !record.engineOn),
    noErrors: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.requestFailures.length === 0,
  };
  return {
    ok: Object.values(checks).every(Boolean), checks, anchor,
    movedYd: { golfCart: moved(golfCart), tractor: moved(tractor) },
    golfCart, tractor, saved, reloaded, diagnostics,
    farLod,
    artifacts: [
      '01-golf-cart-driven-lights.png', '02-tractor-driven-mower.png',
      '03-reloaded-golf-cart-close.png', '04-reloaded-tractor-close.png',
      '05-golf-cart-headlights-night.png',
    ],
  };
}
