async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.join(repo, 'qa', 'current-fix-pass', 'doors-normal-controls');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], warnings: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    return clubhouse?.modernClubhouse?.diagnostics?.()?.modernRoomDoorBinding?.bound === 3;
  }, null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).display === 'none'
      || Number(getComputedStyle(veil).opacity) <= 0.01;
  }, null, { timeout: 90_000 });
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.speedIdx = 0;
    const day = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = day * 1440 + 14 * 60;
    app.state.weather.today.rainIn = 0;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
  });
  await page.waitForTimeout(800);

  const captures = [];
  const shot = async (name) => {
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    captures.push(path.relative(repo, file).replaceAll('\\', '/'));
  };
  const poseLocal = async (at, target, pitch = -0.08) => {
    await page.evaluate(({ at, target, pitch }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const localToWorld = ([x, z]) => clubhouse.group.localToWorld(
        clubhouse.group.position.clone().set(x, 0, z),
      );
      const a = localToWorld(at);
      const b = localToWorld(target);
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = a.x;
      walk.state.z = a.z;
      walk.state.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
      walk.state.pitch = pitch;
    }, { at, target, pitch });
    await page.waitForTimeout(350);
  };
  const sample = () => page.evaluate(() => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const local = app.scene3d.clubhouse().group.worldToLocal(
      app.scene3d.clubhouse().group.position.clone().set(walk.state.x, 0, walk.state.z),
    );
    return {
      x: local.x,
      z: local.z,
      focus: walk.getFocusLabel?.() || null,
    };
  });
  const holdW = async (duration = 650) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(duration);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(180);
    return sample();
  };
  const doorState = (name) => page.evaluate((doorName) => {
    const door = window.__fw.scene3d.clubhouse().doors.find((entry) => entry.name === doorName);
    return door ? {
      name: door.name,
      open: door.open,
      angle: door.angle,
      collider: { ...door.collider },
      authoredPivot: door.authoredPivot?.name || null,
    } : null;
  }, name);

  async function exercise(spec, index) {
    await poseLocal(spec.at, spec.target);
    await page.waitForFunction((name) => (
      window.__fw?.scene3d?.walk?.getFocusLabel?.() || ''
    ).toLowerCase().includes(name.toLowerCase()), spec.name, { timeout: 10_000 });
    const focused = await sample();
    await shot(`${String(index).padStart(2, '0')}-${spec.slug}-closed-focus`);
    const blocked = await holdW(spec.blockDuration || 650);
    const blockedPass = spec.axis === 'x'
      ? (spec.direction > 0 ? blocked.x < spec.center - 0.22 : blocked.x > spec.center + 0.22)
      : (spec.direction > 0 ? blocked.z < spec.center - 0.22 : blocked.z > spec.center + 0.22);
    await page.waitForFunction((name) => (
      window.__fw?.scene3d?.walk?.getFocusLabel?.() || ''
    ).toLowerCase().includes(name.toLowerCase()), spec.name, { timeout: 10_000 });
    await page.keyboard.press('KeyE');
    await page.waitForFunction((name) => {
      const door = window.__fw?.scene3d?.clubhouse?.()?.doors
        ?.find((entry) => entry.name === name);
      return door?.open === true && Math.abs(door?.angle || 0) > 1.65;
    }, spec.name, { timeout: 10_000 });
    await page.waitForTimeout(180);
    const opened = await doorState(spec.name);
    await shot(`${String(index + 1).padStart(2, '0')}-${spec.slug}-open`);
    const crossed = await holdW(spec.crossDuration || 700);
    const crossedPass = spec.axis === 'x'
      ? (spec.direction > 0 ? crossed.x > spec.center + 0.38 : crossed.x < spec.center - 0.38)
      : (spec.direction > 0 ? crossed.z > spec.center + 0.38 : crossed.z < spec.center - 0.38);
    return {
      name: spec.name,
      focused,
      blocked,
      blockedPass,
      opened,
      crossed,
      crossedPass,
      ok: focused.focus?.toLowerCase().includes(spec.name.toLowerCase())
        && blockedPass
        && opened?.open === true
        && Math.abs(opened?.angle || 0) > 1.65
        && Boolean(opened?.authoredPivot)
        && crossedPass,
    };
  }

  const s = 1 / 0.9144;
  const allSpecs = [
    { name: 'Employee door', slug: 'employee', at: [4.55, 3.70 * s], target: [5.35 * s, 3.70 * s], axis: 'x', direction: 1, center: 5.35 * s },
    { name: 'Storage door', slug: 'storage', at: [4.55, -0.20 * s], target: [5.35 * s, -0.20 * s], axis: 'x', direction: 1, center: 5.35 * s },
    { name: 'Restroom door', slug: 'restroom', at: [4.55, -4.18 * s], target: [5.35 * s, -4.18 * s], axis: 'x', direction: 1, center: 5.35 * s },
    { name: 'Stockroom door', slug: 'stockroom', at: [8.9, 3.35], target: [8.9, 2.0], axis: 'z', direction: -1, center: 2.0 },
    { name: 'Receiving door', slug: 'receiving', at: [9.05, -3.6], target: [10.38, -3.6], axis: 'x', direction: 1, center: 10.38, crossDuration: 850 },
  ];
  const requestedDoor = String(process.env.DOOR_QA_ONLY || '').trim().toLowerCase();
  const specs = requestedDoor
    ? allSpecs.filter((spec) => spec.slug === requestedDoor || spec.name.toLowerCase().includes(requestedDoor))
    : allSpecs;
  if (!specs.length) throw new Error(`No door QA spec matched DOOR_QA_ONLY=${requestedDoor}`);
  const doors = [];
  let shotIndex = 1;
  await poseLocal([1.0, 0], [5.35 * s, 0], 0.01);
  await shot('00-service-wing-overview');
  for (const spec of specs) {
    doors.push(await exercise(spec, shotIndex));
    shotIndex += 2;
  }

  const runtime = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    return {
      modern: clubhouse.modernClubhouse.diagnostics(),
      architectural: clubhouse.architecturalDoors.diagnostics(),
      doors: clubhouse.doors.map((door) => ({
        name: door.name,
        modernRoomKey: door.modernRoomKey || null,
        authoredPivot: door.authoredPivot?.name || null,
        open: door.open,
        angle: door.angle,
      })),
    };
  });
  const boundRoomDoors = runtime.doors.filter((door) => door.modernRoomKey);
  const checks = {
    threeModernRoomDoorsBound: runtime.modern.modernRoomDoorBinding?.bound === 3
      && boundRoomDoors.length === 3
      && boundRoomDoors.every((door) => Boolean(door.authoredPivot)),
    everyDoorFocusedBlockedOpenedAndCrossed: doors.length === specs.length
      && doors.every((entry) => entry.ok),
    noBrowserErrors: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.requestFailures.length === 0,
  };
  const result = {
    ok: Object.values(checks).every(Boolean),
    checks,
    doors,
    runtime,
    diagnostics,
    captures,
  };
  fs.writeFileSync(path.join(out, 'latest-result.json'), JSON.stringify(result, null, 2));
  return result;
}
