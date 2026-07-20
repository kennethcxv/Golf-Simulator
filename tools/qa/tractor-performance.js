// Same 1600x900 / 2.5s warm-up / 6s rAF protocol used by the branch baseline.
async (page) => {
  const target = 'http://127.0.0.1:18457/';
  const goto = page.__qaOriginalGoto ? page.__qaOriginalGoto.bind(page) : page.goto.bind(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => window.__fw?.prewarming !== true, null, { timeout: 90000 });
  if (!await page.evaluate(() => window.__fw.state.tractor?.repaired === true)) {
    await page.evaluate(async () => {
      const app = window.__fw;
      app.state.tractor.repaired = true;
      app.state.tractor.steps = { cleared: true, fuel: true, belt: true };
      app.state.tractor.attachment = 'mower';
      app.state.tractor.fuel = 1;
      app.state.tractor.condition = 0.94;
      await app.autosave();
    });
    await goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const continueAgain = page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueAgain.isVisible().catch(() => false)) await continueAgain.click();
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => window.__fw?.prewarming !== true, null, { timeout: 90000 });
  }
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    app.scene3d.walk.clearKeys?.();
    app.scene3d.walk.placeCart(-132, -268, 0);
    const cart = app.scene3d.walk.cart;
    const walk = app.scene3d.walk.state;
    walk.x = cart.x - 2.45;
    walk.z = cart.z;
    walk.yaw = Math.atan2(-(cart.x - walk.x), -(cart.z - walk.z));
    walk.pitch = -0.08;
  });
  await page.waitForTimeout(2500);

  const sample = async (label, durationMs) => page.evaluate(({ label, durationMs }) => new Promise((resolve) => {
    const deltas = [];
    const app = window.__fw;
    let last = null;
    const started = performance.now();
    const finish = () => {
      const sorted = [...deltas].sort((a, b) => b - a);
      const avgMs = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
      const worstCount = Math.max(1, Math.ceil(deltas.length * 0.01));
      const worstAvg = sorted.slice(0, worstCount).reduce((sum, value) => sum + value, 0) / worstCount;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      let sceneMeshes = 0;
      let sceneTriangles = 0;
      app.scene3d.scene.traverse((object) => {
        if (!object.isMesh) return;
        sceneMeshes += 1;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        sceneTriangles += object.geometry.index
          ? Math.floor(object.geometry.index.count / 3)
          : Math.floor((object.geometry.attributes.position?.count || 0) / 3);
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of mats.filter(Boolean)) {
          materials.add(material.uuid);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value.uuid);
        }
      });
      resolve({
        label,
        durationMs,
        frameDeltasMs: deltas,
        renderer: {
          drawCallsPerFrame: app.scene3d.renderer.info.render.calls,
          trianglesDrawnPerFrame: app.scene3d.renderer.info.render.triangles,
          sceneMeshes,
          sceneTriangles,
          uniqueMaterials: materials.size,
          uniqueTextures: textures.size,
          geometriesInMemory: app.scene3d.renderer.info.memory.geometries,
          texturesInMemory: app.scene3d.renderer.info.memory.textures,
        },
        summary: {
          sampleFrames: deltas.length,
          averageFps: 1000 / avgMs,
          onePercentLowFps: 1000 / worstAvg,
          worstFrameMs: sorted[0] || 0,
        },
      });
    };
    const tick = (now) => {
      if (last !== null) deltas.push(now - last);
      last = now;
      if (now - started >= durationMs) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { label, durationMs });

  const idle = await sample('tractor-yard-idle-1600x900', 6000);
  await page.waitForFunction(() => /take the wheel/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''), null, { timeout: 5000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.walk.cart.mounted === true, null, { timeout: 5000 });
  await page.keyboard.down('w');
  const drive = await sample('tractor-drive-1600x900', 6000);
  await page.keyboard.up('w');
  await page.keyboard.press('e');
  return {
    protocol: {
      viewport: { width: 1600, height: 900 },
      quality: 'default', warmupMs: 2500,
      browser: await page.evaluate(() => navigator.userAgent),
      fixture: 'repaired production tractor on fairway; idle then hold W via normal keyboard input',
    },
    idle,
    drive,
  };
}
