// Before evidence for Phase 4: golfers are ambient walkers with no assigned
// cart lifecycle. Run through run-playwright.cjs --bootstrap.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const out = path.resolve(repo, process.env.CUSTOMER_CART_BASELINE_OUT
    || 'qa/property-expansion-world-overhaul/customer-carts/before');
  fs.mkdirSync(out, { recursive: true });
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(
    `requestfailed:${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  ));

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const E = await import('/src/sim/empire.js');
    const empire = E.deserializeEmpire(JSON.parse(localStorage.getItem('golfempire:autosave')));
    const state = E.activeState(empire);
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.tractor = { steps: { cleared: true, fuel: true, belt: true }, repaired: true };
    state.weather.locked = true;
    state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.42, windMph: 4 };
    state.club.lastRounds = 40;
    const day = Math.floor(state.clock.minutes / 1440);
    state.clock.minutes = day * 1440 + 14 * 60;
    empire.clockMinutes = state.clock.minutes;
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.state, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const barrier = window.__fw.scene3d.assetBarrier?.(120000);
    if (barrier?.promise) await barrier.promise;
    window.__fw.speedIdx = 0;
    window.__fw.scene3d.walk.clearKeys();
  });
  await page.waitForFunction(() => window.__fw.scene3d.golferCount() >= 4, null, { timeout: 30000 });
  const evidence = await page.evaluate(() => {
    const app = window.__fw;
    app.scene3d.scene.updateMatrixWorld(true);
    let golfer = null;
    app.scene3d.scene.traverse((object) => {
      if (!golfer && object.userData?.char && !String(object.name).startsWith('VehicleDriver_')) golfer = object;
    });
    const target = golfer ? { x: golfer.position.x, y: golfer.position.y, z: golfer.position.z }
      : { x: 0, y: 0, z: 0 };
    const walk = app.scene3d.walk.state;
    walk.x = target.x + 8;
    walk.z = target.z + 9;
    walk.yaw = Math.atan2(-(target.x - walk.x), -(target.z - walk.z));
    walk.pitch = -0.13;
    return {
      golferCount: app.scene3d.golferCount(),
      customerCartStatePresent: !!app.state.customerCarts,
      vehicleCount: app.scene3d.walk.vehicles.length,
      note: 'Ambient golfers choose random hole corridors and walk every transition; no rental assignment exists.',
    };
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, '01-ambient-walking-golfers-no-cart-lifecycle.png') });
  const result = { ok: diagnostics.length === 0, evidence, diagnostics };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
