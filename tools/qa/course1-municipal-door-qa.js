async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const out = path.join(repo, 'qa', 'course1_municipal', 'door-functional');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || 'unknown';
    if (!/ERR_ABORTED/i.test(reason)) diagnostics.push(`request:${request.url()} (${reason})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(async () => {
    const municipal = window.__fw?.scene3d?.clubhouse?.()?.course1Municipal;
    if (!municipal) return false;
    try { await municipal.ready; } catch { return false; }
    return municipal.diagnostics?.().ready === true;
  }, null, { timeout: 90000 });
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    app.scene3d.clubhouse().setOrganicWalkins?.(false);
    app.scene3d.clubhouse().clearWalkins?.();
  });
  await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });

  async function poseNear(x, z, offsetX, offsetZ) {
    await page.evaluate(({ x: targetX, z: targetZ, offsetX: dx, offsetZ: dz }) => {
      const walk = window.__fw.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = targetX + dx;
      walk.state.z = targetZ + dz;
      const vx = targetX - walk.state.x;
      const vz = targetZ - walk.state.z;
      const distance = Math.hypot(vx, vz) || 1;
      walk.state.yaw = Math.atan2(-vx / distance, -vz / distance);
      walk.state.pitch = 0;
    }, { x, z, offsetX, offsetZ });
    await page.waitForTimeout(180);
  }

  const initial = await page.evaluate(() => window.__fw.scene3d.clubhouse().course1Municipal.diagnostics());
  const results = [];

  await poseNear(initial.mainDoor.interactionX, initial.mainDoor.interactionZ, 0, 1.35);
  await page.keyboard.press('e');
  await page.waitForTimeout(700);
  const main = await page.evaluate(() => window.__fw.scene3d.clubhouse().course1Municipal.diagnostics().mainDoor);
  results.push({
    name: 'DOOR_MAIN_DOUBLE',
    usedNormalEControl: true,
    open: main.leftState === 'open' && main.rightState === 'open',
    angle: Math.min(Math.abs(main.leftAngle), Math.abs(main.rightAngle)),
  });

  const offsets = {
    DOOR_SERVICE_EAST: [1.20, 0],
    DOOR_MAINTENANCE_BACK: [0, -1.20],
    DOOR_INTERIOR_EMPLOYEE: [-1.15, 0],
    DOOR_INTERIOR_OFFICE: [-1.15, 0],
    DOOR_INTERIOR_RESTROOM: [-1.15, 0],
    DOOR_INTERIOR_STORAGE: [-1.15, 0],
  };
  for (const source of initial.auxiliaryDoors) {
    const [offsetX, offsetZ] = offsets[source.name];
    await poseNear(source.interactionX, source.interactionZ, offsetX, offsetZ);
    await page.keyboard.press('e');
    await page.waitForTimeout(700);
    const state = await page.evaluate((name) => (
      window.__fw.scene3d.clubhouse().course1Municipal
        .diagnostics().auxiliaryDoors.find((door) => door.name === name)
    ), source.name);
    results.push({
      name: source.name,
      usedNormalEControl: true,
      open: state?.open === true,
      angle: Math.abs(state?.angle || 0),
    });
  }

  const screenshot = path.join(out, 'all-authored-doors-open.png');
  await page.screenshot({ path: screenshot });
  const failures = results.filter((result) => !result.open || result.angle < 0.35);
  const report = {
    ok: failures.length === 0 && diagnostics.length === 0,
    capturedAt: new Date().toISOString(),
    controls: 'deterministic player pose followed by the normal E interaction for every doorway',
    results,
    failures,
    screenshot,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'door-functional-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
