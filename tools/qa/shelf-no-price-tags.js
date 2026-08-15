// C7 — "Remove every price tag. Products, stocking, checkout… every tag,
// everywhere. On the shelf, in hand, at checkout, in the bag."
//
// Counts every ProductSwingTag mesh in the LIVE stocked scene, then photographs
// the busiest bay so the absence can be seen rather than trusted.
//
// Negative control: the same sweep counts TEXTURED SURFACES. If it reports zero
// of those it is not looking at the room at all, and a zero tag count means
// nothing.
async (page) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/no-price-tags');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (v, m) => { if (!v) throw new Error(m); };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1500);

  // Stock the shelves so there is something to carry a tag.
  await page.evaluate(() => {
    const app = window.__fw;
    for (const id of Object.keys(app.state.shop.inventory)) {
      app.state.shop.inventory[id].shelf = Math.max(app.state.shop.inventory[id].shelf, 6);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.clubhouse().rebuildStock();
  });
  await page.waitForTimeout(2500);

  const sweep = await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let swingTags = 0;
    let texturedSurfaces = 0;
    clubhouse.interior.traverse((o) => {
      if (o.name === 'ProductSwingTag') swingTags += 1;
      const map = o.material && !Array.isArray(o.material) ? o.material.map : null;
      if (map && map.image && map.image.width) texturedSurfaces += 1;
    });
    // The PRICE RAIL is not counted here on purpose: it was a makeSignTexture
    // canvas identical in every runtime respect to the department board beside
    // it, so nothing in the scene graph tells them apart. Its removal is held
    // by the source assertion in tests/no-price-tags.test.js and by the shelf
    // photograph this driver takes; claiming a runtime check that cannot
    // distinguish them would be worse than saying so.
    return { swingTags, texturedSurfaces };
  });

  assert(sweep.texturedSurfaces > 0,
    'NEGATIVE CONTROL FAILED: the sweep found no textured surfaces at all, '
    + 'so a zero tag count says nothing about the shelves.');

  // Photograph the busiest bay.
  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const c = app.scene3d.clubhouse();
    const w = app.scene3d.walk;
    // stand off the apparel wall, the densest stocked display
    let target = null;
    c.interior.traverse((o) => {
      if (!target && /apparel|gondola|ball_shelf|BallShelf/i.test(o.name || '')) target = o;
    });
    if (!target) return;
    c.interior.updateMatrixWorld(true);
    const p = target.getWorldPosition(new THREE.Vector3());
    let best = null;
    let bestD = Infinity;
    for (let step = 0; step < 48; step += 1) {
      const a = (step / 48) * Math.PI * 2;
      const x = p.x + Math.sin(a) * 1.9;
      const z = p.z + Math.cos(a) * 1.9;
      if (!c.isInside(x, z, 0)) continue;
      const d = Math.hypot(x - c.center.x, z - c.center.z);
      if (d < bestD) { bestD = d; best = { x, z }; }
    }
    if (!best) return;
    w.clearKeys();
    w.state.x = best.x; w.state.z = best.z;
    const dx = p.x - w.state.x;
    const dz = p.z - w.state.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.state.yaw = Math.atan2(-dx / h, -dz / h);
    w.state.pitch = Math.atan2(p.y - app.scene3d.camera.position.y, h);
    document.querySelectorAll('.hud,.hud-min,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'shelf.png') });

  const report = { ...sweep, tagsRemain: sweep.swingTags > 0 };
  fs.writeFileSync(path.join(OUT, 'no-price-tags.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert(sweep.swingTags === 0, `${sweep.swingTags} ProductSwingTag meshes are still in the scene`);
  return report;
}
