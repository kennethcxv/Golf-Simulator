async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseUrl);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    await Promise.all([
      clubhouse.pineHillsInterior?.ready,
      clubhouse.modernClubhouse?.ready,
      clubhouse.sheet07Production?.ready,
    ].filter(Boolean));
    const layout = await import('/src/data/shopLayout.js');
    const origin = clubhouse.interior.position;
    const walk = window.__fw.scene3d.walk;
    walk.state.x = origin.x + layout.DOOR_MAIN.x;
    walk.state.z = origin.z + 5.55;
    walk.state.yaw = 0;
    walk.state.pitch = -0.08;
    window.__fw.speedIdx = 0;
    window.__fw.state.clock.minutes = 14 * 60;
    window.__fw.scene3d.applyTimeWeather?.(14 * 60, window.__fw.state.weather);
  });
  await page.waitForTimeout(2200);

  const rootStats = await page.evaluate(() => {
    const interior = window.__fw.scene3d.clubhouse().interior;
    const count = (root) => {
      let meshes = 0;
      let triangles = 0;
      const materials = new Set();
      root.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        meshes += 1;
        const indexCount = object.geometry?.index?.count
          ?? object.geometry?.attributes?.position?.count
          ?? 0;
        triangles += indexCount / 3 * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      return { name: root.name || '(unnamed)', meshes, triangles: Math.round(triangles), materials: materials.size };
    };
    return interior.children.map(count).sort((left, right) => right.meshes - left.meshes).slice(0, 40);
  });

  async function measure(label) {
    return page.evaluate((scenario) => new Promise((resolve) => {
      const frames = [];
      const renderer = window.__fw.scene3d.renderer;
      let prior = performance.now();
      const started = prior;
      function tick(now) {
        frames.push(now - prior);
        prior = now;
        if (now - started < 2500) return requestAnimationFrame(tick);
        const sorted = [...frames].sort((a, b) => a - b);
        const onePercent = sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] || 0;
        resolve({
          label: scenario,
          averageFps: frames.length * 1000 / frames.reduce((sum, value) => sum + value, 0),
          onePercentLowFps: onePercent > 0 ? 1000 / onePercent : 0,
          worstFrameMs: Math.max(...frames),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
      }
      requestAnimationFrame(tick);
    }), label);
  }

  const scenarios = [];
  scenarios.push(await measure('production'));

  async function measureWithInteriorRootsHidden(label, names, prefixes = []) {
    const records = await page.evaluate(({ exactNames, namePrefixes }) => {
      const interior = window.__fw.scene3d.clubhouse().interior;
      const hidden = [];
      for (const object of interior.children) {
        const name = String(object.name || '');
        if (!exactNames.includes(name) && !namePrefixes.some((prefix) => name.startsWith(prefix))) continue;
        hidden.push({ uuid: object.uuid, visible: object.visible });
        object.visible = false;
      }
      return hidden;
    }, { exactNames: names, namePrefixes: prefixes });
    scenarios.push(await measure(label));
    await page.evaluate((hidden) => {
      const visibility = new Map(hidden.map((entry) => [entry.uuid, entry.visible]));
      window.__fw.scene3d.clubhouse().interior.children.forEach((object) => {
        if (visibility.has(object.uuid)) object.visible = visibility.get(object.uuid);
      });
    }, records);
  }

  await measureWithInteriorRootsHidden('assets-61-100-hidden', ['Assets61to100Runtime']);
  await measureWithInteriorRootsHidden('fixture-roots-hidden', [], ['Fixture_']);
  await measureWithInteriorRootsHidden('shop-stock-hidden', ['shop-stock']);
  await measureWithInteriorRootsHidden('sheet06-hidden', [
    'SHEET06_PRODUCTION_INTERIOR_LIVE',
    'SHEET06_PRODUCTION_INTERIOR_STAGING',
  ]);
  await measureWithInteriorRootsHidden('register-roots-hidden', [
    'SimplifiedFrontDeskRegister',
    'CheckoutHardwareVisualRoot',
    'CheckoutCounterVisualRoot',
  ]);
  await measureWithInteriorRootsHidden('delivery-equipment-hidden', [
    'DeliveryEquipmentInteriorRoot',
    'DeliveryRecyclingStation',
  ]);

  const lightState = await page.evaluate(() => {
    const records = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.isLight || !/CeilingPanelLight_|PineHillsAccent_/.test(object.name || '')) return;
      records.push({ uuid: object.uuid, visible: object.visible, intensity: object.intensity });
      object.visible = false;
    });
    return records;
  });
  scenarios.push(await measure('pine-lights-hidden'));
  await page.evaluate((records) => {
    const byId = new Map(records.map((record) => [record.uuid, record]));
    window.__fw.scene3d.scene.traverse((object) => {
      const record = byId.get(object.uuid);
      if (!record) return;
      object.visible = record.visible;
      object.intensity = record.intensity;
    });
  }, lightState);

  const pineWasVisible = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const root = clubhouse.interior?.getObjectByName('PineHillsInteriorLayer');
    if (!root) return null;
    const visible = root.visible;
    root.visible = false;
    return visible;
  });
  scenarios.push(await measure('pine-dressing-hidden'));
  await page.evaluate((visible) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const root = clubhouse.interior?.getObjectByName('PineHillsInteriorLayer');
    if (root && visible != null) root.visible = visible;
  }, pineWasVisible);

  return { ok: true, rootStats, scenarios };
}
