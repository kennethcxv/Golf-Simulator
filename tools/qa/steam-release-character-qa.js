async (page) => {
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.QA_OUTPUT_DIR || 'qa/steam-release-polish/character-polish/current';

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(base);
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1800);

  const setPose = (pose) => page.evaluate((next) => {
    const app = window.__fw;
    app.speedIdx = 0;
    const interior = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = interior.x + next.x;
    walk.z = interior.z + next.z;
    walk.yaw = next.yaw;
    walk.pitch = next.pitch;
  }, pose);

  // This documented fixture only skips waiting for shopper RNG. The player-facing
  // register entry below still goes through the normal E control.
  await page.evaluate(() => {
    const app = window.__fw;
    const clock = app.state.clock;
    clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.clubhouse().sendToCounter(['balls3', 'glove1'], 'card');
  });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().customers().length > 0);
  await page.waitForTimeout(900);

  const views = [
    { name: '01-staff-counter', x: 2.80, z: 5.10, yaw: 0, pitch: -0.12 },
    { name: '02-shopper-reverse', x: 2.80, z: 0.90, yaw: Math.PI, pitch: -0.04 },
    { name: '03-shopper-profile', x: -0.20, z: 3.35, yaw: -Math.PI / 2, pitch: -0.05 },
  ];
  for (const view of views) {
    await setPose(view);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${view.name}.png` });
  }

  await setPose(views[0]);
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/04-register-checkout-pose.png` });

  const inspection = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const customer = window.__fw.scene3d.clubhouse().customers[0];
    const char = customer?.mesh?.userData?.char || null;
    const geometries = new Set();
    let meshInstances = 0;
    let renderedTriangles = 0;
    char?.root.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      meshInstances++;
      geometries.add(node.geometry);
      renderedTriangles += node.geometry.index
        ? node.geometry.index.count / 3
        : node.geometry.attributes.position.count / 3;
    });
    const bounds = new THREE.Box3().setFromObject(char.root);
    const size = bounds.getSize(new THREE.Vector3());
    const rootWorld = char.root.getWorldPosition(new THREE.Vector3());
    const pivotNames = [
      'chestJoint', 'headJoint', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
      'hipL', 'hipR', 'kneeL', 'kneeR', 'handL', 'handR', 'carryAnchor',
    ];
    const pivots = {};
    for (const name of pivotNames) {
      const node = char.root.getObjectByName(name);
      if (!node) continue;
      const world = node.getWorldPosition(new THREE.Vector3());
      pivots[name] = world.sub(rootWorld).toArray();
    }
    const asset = await import(new URL('src/render3d/characterAsset.js', document.baseURI).href);
    return {
      assetKind: char?.assetKind || null,
      assetStatus: asset.characterPartsStatus(),
      meshInstances,
      uniqueGeometries: geometries.size,
      renderedTriangles,
      dimensions: size.toArray(),
      groundClearance: bounds.min.y - rootWorld.y,
      hierarchy: char.root.children.map((node) => node.name),
      pivots,
      rootScale: customer?.mesh?.scale?.toArray() || null,
      transactionStage: window.__fw.scene3d.clubhouse().register.getTx()?.stage || null,
      registerActive: window.__fw.scene3d.clubhouse().register.isActive(),
    };
  });

  return { ok: inspection.assetKind === 'blender' && inspection.registerActive, views, inspection };
}
