async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const out = process.env.VISUAL_OUT || 'qa/steam-performance-master-pass/baseline/leaves-pile';
  const assetOverride = process.env.LEAVES_ASSET_OVERRIDE || '';
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  if (assetOverride) {
    const body = fs.readFileSync(assetOverride);
    await page.route('**/vendor/models/leaves_pile.glb', (route) => route.fulfill({
      status: 200, contentType: 'model/gltf-binary', body,
    }));
  }
  await page.evaluate(async () => {
    const raw = localStorage.getItem('golfempire:autosave');
    if (!raw) return;
    const empire = JSON.parse(raw);
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const state = E.activeState(empire);
    if (!state?.props?.litter?.length) return;
    state.props.litter.forEach((pile, index) => {
      pile.cleared = index !== 0;
      if (index === 0) { pile.cx = 20; pile.cy = 41; }
    });
    localStorage.setItem('golfempire:autosave', JSON.stringify(empire));
  });
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(500);

  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const course = app.state.course;
    const pile = app.state.props?.litter?.find((entry) => !entry.cleared);
    if (!pile) throw new Error('No uncleared litter pile is available for the visual fixture.');
    const x = (pile.cx + 0.5) * 8 - (course.w * 8) / 2;
    const z = (pile.cy + 0.5) * 8 - (course.h * 8) / 2;
    return { x, z, y: app.scene3d.heightAt(x, z), cx: pile.cx, cy: pile.cy };
  });

  const cameras = [
    { id: 'close-front', dx: 3.5, dz: 4.2, eye: 1.45, targetY: 0.35 },
    { id: 'player-distance', dx: -5.8, dz: 6.2, eye: 1.65, targetY: 0.25 },
    { id: 'low-side', dx: 4.8, dz: -3.1, eye: 1.05, targetY: 0.28 },
  ];
  const screenshots = [];
  for (const view of cameras) {
    await page.evaluate(({ fixture, view }) => {
      const app = window.__fw;
      const eyeX = fixture.x + view.dx;
      const eyeZ = fixture.z + view.dz;
      const eyeY = fixture.y + view.eye;
      const dx = fixture.x - eyeX;
      const dz = fixture.z - eyeZ;
      const horizontal = Math.hypot(dx, dz) || 1;
      app.scene3d.walk.focusOn({
        x: eyeX,
        y: eyeY,
        z: eyeZ,
        yaw: Math.atan2(-dx / horizontal, -dz / horizontal),
        pitch: Math.atan2((fixture.y + view.targetY) - eyeY, horizontal),
      });
    }, { fixture, view });
    await page.waitForTimeout(450);
    const file = path.join(out, `${view.id}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
  }

  const census = await page.evaluate((fixture) => {
    const candidates = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      const world = object.getWorldPosition(object.position.clone());
      if (Math.hypot(world.x - fixture.x, world.z - fixture.z) > 2.5) return;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      const map = material?.map;
      candidates.push({
        name: object.name,
        vertices: object.geometry.attributes.position?.count || 0,
        triangles: object.geometry.index
          ? object.geometry.index.count / 3
          : (object.geometry.attributes.position?.count || 0) / 3,
        map: map ? { width: map.image?.width || 0, height: map.image?.height || 0 } : null,
      });
    });
    return candidates;
  }, fixture);

  return {
    fixtureBoundary: 'Fixed saved litter[0] at cell 20,41; all sibling litter hidden; camera injection is visual-only.',
    assetOverride: assetOverride || null,
    fixture, cameras, screenshots, census, errors,
  };
}
