async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = process.env.SHEET06_FLOOR_STATE_OUT
    ? path.resolve(repo, process.env.SHEET06_FLOOR_STATE_OUT)
    : path.join(repo, 'qa', 'assets_51_100_master', 'sheet_06', 'diagnostics', 'floor_restoration_state');
  fs.mkdirSync(out, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.scene, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    if (!production) return false;
    try { await production.ready; } catch { return false; }
    return production.diagnostics?.().activationStatus === 'active';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });

  const setFloorRestored = async (restored) => {
    const before = await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const production = typeof clubhouse.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse.sheet06Production;
      return production.diagnostics().stateApplications;
    });
    await page.evaluate(async (nextRestored) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      app.state.shop.reno.grime.fill(0);
      for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
      const restoration = await import('/src/sim/clubhouseRestoration.js');
      const mutation = restoration.setFloorRestored(app.state, nextRestored);
      if (mutation?.ok !== true) {
        throw new Error(`Floor restoration mutation failed: ${JSON.stringify(mutation)}`);
      }
      clubhouse.rebuildReno();
    }, restored);
    await page.waitForFunction((prior) => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      return production?.diagnostics?.().stateApplications > prior;
    }, before, { timeout: 10000 });
    await page.waitForFunction((expectedRestored) => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      const damage = production?.getAssemblyRoot?.(60);
      return app?.state?.shop?.reno?.architecture?.components?.floor?.restored === expectedRestored
        && damage?.visible === !expectedRestored;
    }, restored, { timeout: 10000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
  };

  const setCamera = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      const shot = { x: -0.35, z: 2.4, tx: -0.35, tz: -2.45, pitch: -0.55 };
      walk.clearKeys?.();
      walk.state.x = origin.x + shot.x;
      walk.state.z = origin.z + shot.z;
      walk.state.yaw = Math.atan2(-(shot.tx - shot.x), -(shot.tz - shot.z));
      walk.state.pitch = shot.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
      app.state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    });
    await page.waitForTimeout(650);
  };

  const inspect = () => page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const floor = production.getAssemblyRoot(59);
    const damage = production.getAssemblyRoot(60);
    const renderMeshes = (root) => {
      const entries = [];
      root?.traverse((node) => {
        if (!node.isMesh || !node.geometry || !node.material) return;
        let effectiveVisible = true;
        for (let cursor = node; cursor; cursor = cursor.parent) {
          if (cursor.visible === false) effectiveVisible = false;
          if (cursor === root) break;
        }
        const materials = (Array.isArray(node.material) ? node.material : [node.material]).map((material) => ({
          name: material.name || '',
          color: material.color?.getHexString?.() || null,
          map: material.map?.name || null,
          roughness: material.roughness ?? null,
        }));
        entries.push({ name: node.name || '', effectiveVisible, materials });
      });
      return entries;
    };
    return {
      restored: window.__fw.state.shop.reno.architecture.components.floor.restored,
      grimeSum: window.__fw.state.shop.reno.grime.reduce((sum, value) => sum + value, 0),
      diagnostics: production.diagnostics(),
      floor: { visible: floor.visible, meshes: renderMeshes(floor) },
      damage: { visible: damage.visible, meshes: renderMeshes(damage) },
    };
  });

  const originalRestored = await page.evaluate(() => (
    window.__fw.state.shop.reno.architecture.components.floor.restored
  ));
  await setFloorRestored(false);
  await setCamera();
  const unrestoredScreenshot = path.join(out, 'floor-unrestored-damage-visible.png');
  await page.screenshot({ path: unrestoredScreenshot });
  const unrestored = await inspect();

  await setFloorRestored(true);
  await setCamera();
  const restoredScreenshot = path.join(out, 'floor-restored-damage-hidden.png');
  await page.screenshot({ path: restoredScreenshot });
  const restored = await inspect();

  await setFloorRestored(originalRestored);
  return {
    ok: unrestored.damage.visible === true
      && restored.damage.visible === false
      && unrestored.restored === false
      && restored.restored === true
      && unrestored.floor.visible === true
      && restored.floor.visible === true
      && unrestored.grimeSum === 0
      && restored.grimeSum === 0,
    capturedAt: new Date().toISOString(),
    originalRestored,
    screenshots: { unrestored: unrestoredScreenshot, restored: restoredScreenshot },
    unrestored,
    restored,
  };
}
