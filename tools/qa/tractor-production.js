// Production tractor browser acceptance. Fixture placement is deterministic, but
// mounting, driving, steering, mowing, parking, saving, and continuing all use the
// normal controls and the game's own save path.
async (page) => {
  const repo = process.cwd().replaceAll('\\', '/');
  const outDir = `${repo}/qa/checkout-delivery-groundskeeping-balance/current/tractor`;
  const target = 'http://127.0.0.1:18457/';
  const shot = page.__qaOriginalScreenshot ? page.__qaOriginalScreenshot.bind(page) : page.screenshot.bind(page);
  const goto = page.__qaOriginalGoto ? page.__qaOriginalGoto.bind(page) : page.goto.bind(page);
  const log = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const waitGame = async () => {
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
    await page.waitForFunction(() => (
      window.__fw?.screen === 'game'
        && window.__fw?.scene3d?.walk?.isActive?.()
        && window.__fw?.state?.tractor
    ), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (window.__fw?.prewarming === true) return false;
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(650);
  };

  const reloadGame = async () => {
    await goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitGame();
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await reloadGame();

  // Fixture only: earn the machine, suppress unrelated ambient churn, fix weather,
  // and choose a clear turf lane long enough to exercise the normal drive controls.
  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const st = app.state;
    const { ZONE } = await import('/src/sim/constants.js');
    st.tutorial.complete = true;
    st.tutorial.hidden = true;
    st.tractor.repaired = true;
    st.tractor.steps = { cleared: true, fuel: true, belt: true };
    st.tractor.condition = 0.94;
    st.tractor.fuel = 1;
    st.tractor.attachment = 'mower';
    st.tractor.engineHours = 0;
    st.weather.locked = true;
    st.weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 11 * 60;
    app.empire.clockMinutes = st.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    const api = app.scene3d.walk;
    const w = st.course.w;
    const h = st.course.h;
    const worldW = w * 8;
    const worldH = h * 8;
    let lane = null;
    for (let cy = 3; cy < h - 3 && !lane; cy += 1) {
      for (let cx = 3; cx < w - 3 && !lane; cx += 1) {
        const x = (cx + 0.5) * 8 - worldW / 2;
        const z = (cy + 0.5) * 8 - worldH / 2;
        if (st.course.zones[cy * w + cx] !== ZONE.FAIRWAY) continue;
        const clearOffsets = [
          [0, 0], [0, -4], [0, -8], [0, -12], [0, -16],
          [-8, 0], [8, 0], [-8, -8], [8, -8], [-8, -16], [8, -16],
          [0, 8], [-8, 8], [8, 8],
        ];
        if (clearOffsets.every(([ox, oz]) => api.isFree(x + ox, z + oz, 1.35))) lane = { x, z, yaw: 0 };
      }
    }
    if (!lane) throw new Error('No clear deterministic tractor lane was found.');
    st.tractor.location = lane;
    await app.autosave();
    return { lane, clubName: st.clubName };
  });
  log.push({ step: 'fixture', ...fixture });

  // Reload through Continue so the initial cart transform comes from serialized state.
  await reloadGame();
  const initial = await page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const tractor = scene.getObjectByName('TractorRoot');
    const mower = scene.getObjectByName('MowerRoot');
    const required = [
      'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR', 'Steer_FL', 'Steer_FR',
      'SteeringWheel', 'Hood_Pivot', 'Mower_Hitch', 'MowerDeck_Pivot',
    ];
    let meshes = 0;
    let triangles = 0;
    const seenMeshes = new Set();
    for (const root of [tractor, mower]) root?.traverse((object) => {
      if (!object.isMesh || seenMeshes.has(object.uuid)) return;
      seenMeshes.add(object.uuid);
      meshes += 1;
      triangles += object.geometry.index
        ? Math.floor(object.geometry.index.count / 3)
        : Math.floor((object.geometry.attributes.position?.count || 0) / 3);
    });
    return {
      tractor: !!tractor,
      mower: !!mower,
      required: Object.fromEntries(required.map((name) => [name, !!scene.getObjectByName(name)])),
      meshes,
      triangles,
      cart: { ...app.scene3d.walk.cart },
      saved: { ...app.state.tractor.location },
      attachment: app.state.tractor.attachment,
    };
  });
  if (!initial.tractor || !initial.mower || Object.values(initial.required).some((value) => !value)) {
    throw new Error(`Production rig incomplete: ${JSON.stringify(initial)}`);
  }
  log.push({ step: 'serialized spawn and authored hierarchy', ...initial });

  const poseAndShoot = async (name, angle, distance = 6.6) => {
    await page.evaluate(({ angle, distance }) => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const cart = app.scene3d.walk.cart;
      const walk = app.scene3d.walk.state;
      const api = app.scene3d.walk;
      let pose = null;
      for (const delta of [0, 0.45, -0.45, 0.9, -0.9]) {
        const a = angle + delta;
        const candidate = { x: cart.x + Math.sin(a) * distance, z: cart.z + Math.cos(a) * distance };
        if (api.isFree(candidate.x, candidate.z, 0.5)) { pose = candidate; break; }
      }
      if (!pose) pose = { x: cart.x + Math.sin(angle) * distance, z: cart.z + Math.cos(angle) * distance };
      walk.x = pose.x;
      walk.z = pose.z;
      const dx = cart.x - walk.x;
      const dz = cart.z - walk.z;
      walk.yaw = Math.atan2(-dx, -dz);
      const tractor = scene.getObjectByName('TractorRoot');
      tractor?.updateWorldMatrix(true, true);
      walk.pitch = -0.16;
      api.clearKeys?.();
    }, { angle, distance });
    await page.waitForTimeout(450);
    await shot({ path: `${outDir}/${name}.png` });
  };

  await poseAndShoot('01-front-three-quarter', Math.PI * 0.76);
  await poseAndShoot('02-rear-mower', Math.PI * 0.18);
  await poseAndShoot('03-side-profile', Math.PI / 2);

  // Put the player at the left side, aim at the seat, and mount with the normal E key.
  await page.evaluate(() => {
    const app = window.__fw;
    const cart = app.scene3d.walk.cart;
    const walk = app.scene3d.walk.state;
    walk.x = cart.x - 2.45;
    walk.z = cart.z;
    const dx = cart.x - walk.x;
    const dz = cart.z - walk.z;
    walk.yaw = Math.atan2(-dx, -dz);
    walk.pitch = -0.08;
  });
  await page.waitForFunction(() => /take the wheel/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''), null, { timeout: 5000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.walk.cart.mounted === true, null, { timeout: 5000 });

  const beforeDrive = await page.evaluate(async () => {
    const app = window.__fw;
    const { BALANCE } = await import('/src/sim/balance.js');
    const { ZONE } = await import('/src/sim/constants.js');
    const target = {
      [ZONE.GREEN]: BALANCE.turf.ideal.green.height,
      [ZONE.TEE]: BALANCE.turf.ideal.tee.height,
      [ZONE.FAIRWAY]: BALANCE.turf.ideal.fairway.height,
      [ZONE.ROUGH]: BALANCE.turf.ideal.rough.height,
    };
    let overgrown = 0;
    for (let i = 0; i < app.state.turf.heightMm.length; i += 1) {
      if (target[app.state.course.zones[i]] === undefined) continue;
      app.state.turf.heightMm[i] = target[app.state.course.zones[i]] + 25;
      overgrown += 1;
    }
    const node = (name) => app.scene3d.scene.getObjectByName(name);
    return {
      cart: { x: app.scene3d.walk.cart.x, z: app.scene3d.walk.cart.z, yaw: app.scene3d.walk.cart.yaw },
      overgrown,
      wheel: node('Wheel_FL').rotation.x,
      steer: node('Steer_FL').rotation.y,
      steeringWheel: node('SteeringWheel').rotation.z,
      blade: node('BladeDisc_+000').rotation.y,
      engineHours: app.state.tractor.engineHours,
      condition: app.state.tractor.condition,
      fuel: app.state.tractor.fuel,
    };
  });

  await page.keyboard.down('w');
  await page.keyboard.down('a');
  await page.waitForTimeout(850);
  const duringDrive = await page.evaluate(() => {
    const app = window.__fw;
    const node = (name) => app.scene3d.scene.getObjectByName(name);
    return {
      cart: { x: app.scene3d.walk.cart.x, z: app.scene3d.walk.cart.z, yaw: app.scene3d.walk.cart.yaw },
      wheel: node('Wheel_FL').rotation.x,
      steer: node('Steer_FL').rotation.y,
      steeringWheel: node('SteeringWheel').rotation.z,
      blade: node('BladeDisc_+000').rotation.y,
    };
  });
  await shot({ path: `${outDir}/04-driving-and-mowing.png` });
  await page.keyboard.up('a');
  await page.waitForTimeout(750);
  await page.keyboard.up('w');
  await page.waitForTimeout(250);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.walk.cart.mounted === false, null, { timeout: 5000 });

  const afterDrive = await page.evaluate(async () => {
    const app = window.__fw;
    const { BALANCE } = await import('/src/sim/balance.js');
    const { ZONE } = await import('/src/sim/constants.js');
    const target = {
      [ZONE.GREEN]: BALANCE.turf.ideal.green.height,
      [ZONE.TEE]: BALANCE.turf.ideal.tee.height,
      [ZONE.FAIRWAY]: BALANCE.turf.ideal.fairway.height,
      [ZONE.ROUGH]: BALANCE.turf.ideal.rough.height,
    };
    let cutCells = 0;
    for (let i = 0; i < app.state.turf.heightMm.length; i += 1) {
      if (target[app.state.course.zones[i]] !== undefined
        && app.state.turf.heightMm[i] <= target[app.state.course.zones[i]] + 0.5) cutCells += 1;
    }
    await app.autosave();
    return {
      cart: { x: app.scene3d.walk.cart.x, z: app.scene3d.walk.cart.z, yaw: app.scene3d.walk.cart.yaw },
      saved: { ...app.state.tractor.location },
      cutCells,
      engineHours: app.state.tractor.engineHours,
      condition: app.state.tractor.condition,
      fuel: app.state.tractor.fuel,
      attachment: app.state.tractor.attachment,
    };
  });

  const moved = Math.hypot(afterDrive.cart.x - beforeDrive.cart.x, afterDrive.cart.z - beforeDrive.cart.z);
  const checks = {
    moved: moved > 1,
    wheelRolled: Math.abs(duringDrive.wheel - beforeDrive.wheel) > 0.2,
    frontSteered: Math.abs(duringDrive.steer - beforeDrive.steer) > 0.1,
    steeringWheelMoved: Math.abs(duringDrive.steeringWheel - beforeDrive.steeringWheel) > 0.1,
    bladesSpun: Math.abs(duringDrive.blade - beforeDrive.blade) > 0.2,
    turfCut: afterDrive.cutCells > 0,
    hoursAdvanced: afterDrive.engineHours > beforeDrive.engineHours,
    fuelUsed: afterDrive.fuel < beforeDrive.fuel,
    conditionWore: afterDrive.condition < beforeDrive.condition,
    exactSavedTransform: JSON.stringify(afterDrive.saved) === JSON.stringify({
      x: Math.round(afterDrive.cart.x * 1000) / 1000,
      z: Math.round(afterDrive.cart.z * 1000) / 1000,
      yaw: Math.round(afterDrive.cart.yaw * 10000) / 10000,
    }),
  };
  log.push({ step: 'normal drive, animation, mowing, and saved state', beforeDrive, duringDrive, afterDrive, moved, checks });
  await poseAndShoot('05-parked-after-work', Math.PI * 0.78, 7.2);

  const saved = afterDrive.saved;
  await reloadGame();
  const reloaded = await page.evaluate(() => ({
    cart: {
      x: window.__fw.scene3d.walk.cart.x,
      z: window.__fw.scene3d.walk.cart.z,
      yaw: window.__fw.scene3d.walk.cart.yaw,
    },
    saved: { ...window.__fw.state.tractor.location },
    condition: window.__fw.state.tractor.condition,
    fuel: window.__fw.state.tractor.fuel,
    engineHours: window.__fw.state.tractor.engineHours,
    attachment: window.__fw.state.tractor.attachment,
  }));
  checks.reloadTransform = JSON.stringify(reloaded.cart) === JSON.stringify(saved);
  checks.reloadState = reloaded.attachment === 'mower'
    && reloaded.condition === afterDrive.condition
    && reloaded.fuel === afterDrive.fuel
    && reloaded.engineHours === afterDrive.engineHours;
  log.push({ step: 'Continue restores exact tractor lifecycle', reloaded, checks: { reloadTransform: checks.reloadTransform, reloadState: checks.reloadState } });
  await poseAndShoot('06-reloaded-persisted-park.png'.replace('.png', ''), -Math.PI / 2, 6.8);

  const report = { ok: Object.values(checks).every(Boolean) && errors.length === 0, checks, errors, log };
  if (!report.ok) throw new Error(`Tractor acceptance failed: ${JSON.stringify(report)}`);
  return report;
}
