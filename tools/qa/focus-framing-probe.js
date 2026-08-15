async (page) => {
  // FOCUS-MODE FRAMING â€” item 9's measurement pass. Captures, for the laptop
  // seat and the register opening pose, where the screen actually lands in the
  // frame: NDC of the screen quad, fraction of viewport height, eye height vs
  // screen centre, and camera pitch. Screenshots at these fixed poses are the
  // before/after evidence pair.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/focus-framing-probe.js
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const TAG = String(process.env.FRAMING_TAG || 'before');
  const SKUS = ['tees1', 'marker1', 'glove1'];

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async () => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newEmpire('relaxed', 424242);
    empire.cash = 10_000_000;
    const first = empire.market.find((l) => l.id === 'willow-creek') || empire.market[0];
    const bought = E.buyProperty(empire, first.id);
    if (!bought.ok) throw new Error(`bootstrap failed: ${bought.reason}`);
    bought.state.tutorial.complete = true;
    bought.state.tutorial.hidden = true;
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(200);

  const measureQuad = (mode) => page.evaluate(async (which) => {
    const THREE = await import('three');
    const app = window.__fw;
    const camera = app.scene3d.camera;
    camera.updateMatrixWorld(true);
    const clubhouse = app.scene3d.clubhouse();
    let corners = null;
    if (which === 'laptop') {
      corners = clubhouse.laptopScreenCorners();
    } else {
      let mesh = null;
      clubhouse.interior.traverse((node) => {
        if (!mesh && node.isMesh && /monitor|posscreen|screen/i.test(node.name || '')
          && !/laptop/i.test(node.name || '')) mesh = node;
      });
      if (mesh) {
        mesh.updateWorldMatrix(true, false);
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        corners = [
          new THREE.Vector3(bb.min.x, bb.max.y, (bb.min.z + bb.max.z) / 2),
          new THREE.Vector3(bb.max.x, bb.max.y, (bb.min.z + bb.max.z) / 2),
          new THREE.Vector3(bb.max.x, bb.min.y, (bb.min.z + bb.max.z) / 2),
          new THREE.Vector3(bb.min.x, bb.min.y, (bb.min.z + bb.max.z) / 2),
        ].map((v) => mesh.localToWorld(v));
      }
    }
    if (!corners || !corners.length) return null;
    const ndc = corners.map((c) => c.clone().project(camera));
    const ys = ndc.map((p) => p.y);
    const xs = ndc.map((p) => p.x);
    const centre = corners.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / corners.length);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const forward = camera.getWorldDirection(new THREE.Vector3());
    return {
      cameraFov: camera.fov,
      ndcTop: +Math.max(...ys).toFixed(3),
      ndcBottom: +Math.min(...ys).toFixed(3),
      ndcCentreY: +((Math.max(...ys) + Math.min(...ys)) / 2).toFixed(3),
      ndcWidth: +(Math.max(...xs) - Math.min(...xs)).toFixed(3),
      viewportHeightFraction: +((Math.max(...ys) - Math.min(...ys)) / 2).toFixed(3),
      eyeY: +eye.y.toFixed(3),
      screenCentreY: +centre.y.toFixed(3),
      eyeAboveScreenCentre: +(eye.y - centre.y).toFixed(3),
      pitchDeg: +(Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180 / Math.PI).toFixed(2),
      standoff: +eye.distanceTo(centre).toFixed(3),
    };
  }, mode);

  const out = { tag: TAG };

  // --- laptop seat ---------------------------------------------------------------
  await page.evaluate(async () => {
    const app = window.__fw;
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    const laptop = L.FRONT_DESK.laptop;
    w.x = laptop.x + o.x;
    w.z = laptop.z + 0.95 + o.z;
    w.yaw = 0;
    w.pitch = Math.atan2(1.06 - 1.62, 0.95);
  });
  await page.waitForTimeout(600);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const f = document.querySelector('.lt-frame');
    if (!f) return false;
    const r = f.getBoundingClientRect();
    const prev = window.__settle || {};
    window.__settle = { x: r.left, w: r.width };
    return Math.abs((prev.x ?? 0) - r.left) < 0.05 && Math.abs((prev.w ?? 0) - r.width) < 0.05 && r.width > 100;
  }, null, { timeout: 15000, polling: 120 });
  await page.waitForTimeout(400);
  out.laptop = await measureQuad('laptop');
  await page.screenshot({ path: path.join(outDir, `framing-laptop-${TAG}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(500);

  // --- register opening pose -----------------------------------------------------
  await page.evaluate(async (skuIds) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const id of skuIds) {
      const line = app.state.shop.inventory[id];
      line.shelf = Math.max(line.shelf, 12);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const off = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    clubhouse.sendToCounter(skuIds, 'card');
  }, SKUS);
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx?.();
    return !!tx && tx.items?.length === 3;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1600);
  // The register monitor: find its screen mesh bbox corners in world space.
  out.register = await measureQuad('register');
  out.registerScreenMesh = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let name = null;
    clubhouse.interior.traverse((node) => {
      if (!name && node.isMesh && /monitor|posscreen|screen/i.test(node.name || '')
        && !/laptop/i.test(node.name || '')) name = node.name;
    });
    return name;
  });
  await page.screenshot({ path: path.join(outDir, `framing-register-${TAG}.png`) });

  fs.writeFileSync(path.join(outDir, `focus-framing-${TAG}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
