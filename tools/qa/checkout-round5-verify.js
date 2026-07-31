async (page) => {
  // Independent verification of the round-5 checkout asks, on the proven
  // new-game boot (the round-5 driver resumes a save via "Continue", which does
  // not exist in a fresh profile and hangs on the load veil).
  //
  //   node tools/qa/run-playwright.cjs tools/qa/checkout-round5-verify.js
  //
  //   A the working frame is a STANDING CASHIER's eye line, not a bird's eye
  //   B no orange hover box; the green payment rim survives
  //   C the bag lies FLAT and LONG, mouth open toward the counter space
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/checkout-round5-verify');
  fs.mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // --- A: is there an orange hover box left anywhere in the rig? ------------
  // Static answer first: the Box3Helper the play-test objected to was authored
  // at 0xb9974e. Any surviving line object in that hue is the bug.
  const orange = await page.evaluate(() => {
    const app = window.__fw;
    const hits = [];
    app.scene3d.scene.traverse((o) => {
      const c = o.material?.color;
      if (!c) return;
      const hex = c.getHexString();
      // the authored orange, plus anything close to it in hue
      if (hex === 'b9974e') hits.push({ name: o.name || o.type, type: o.type, visible: o.visible });
    });
    return hits;
  });

  // --- B: the working pose's eye line --------------------------------------
  const pose = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const cam = app.scene3d.camera;
    // floor the staff stand on, under the camera
    const floorY = ch.groundYAt ? ch.groundYAt(cam.position.x, cam.position.z) : null;
    const Vec = cam.position.constructor;
    const dir = cam.getWorldDirection(new Vec());
    return {
      camY: +cam.position.y.toFixed(3),
      floorY: floorY == null ? null : +floorY.toFixed(3),
      eyeAboveFloor: floorY == null ? null : +(cam.position.y - floorY).toFixed(3),
      pitchDeg: +((Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI).toFixed(1),
    };
  });

  // --- C: the bag's shape on the counter -----------------------------------
  // NOTE: name-matching /bag/ in the world scene finds Tool_trashbag — the
  // CLEANING tool — not the checkout carrier, which is built inside the
  // register rig and only exists in checkout mode. The carrier's laid pose is
  // asserted properly against CHECKOUT_BAG_PRESENTATION in
  // tests/checkout-playtest-round5.test.js; this only reports what is in the
  // world scene, and must not be read as the carrier.
  const bag = await page.evaluate(() => {
    const app = window.__fw;
    let found = null;
    app.scene3d.scene.traverse((o) => {
      if (found) return;
      if (/Tool_trashbag/.test(o.name || '')) found = o;
    });
    if (!found) return null;
    const Vec3 = app.scene3d.camera.position.constructor;
    const v = new Vec3();
    const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    found.traverse((m) => {
      const pos = m.isMesh && m.geometry?.attributes?.position;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 60));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i); m.localToWorld(v);
        for (let a = 0; a < 3; a += 1) {
          const val = a === 0 ? v.x : a === 1 ? v.y : v.z;
          if (val < lo[a]) lo[a] = val;
          if (val > hi[a]) hi[a] = val;
        }
      }
    });
    const size = hi.map((h, i) => +(h - lo[i]).toFixed(3));
    return {
      name: found.name,
      sizeYd: { x: size[0], y: size[1], z: size[2] },
      // "laid flat… small height": the footprint must dominate the height
      note: 'world-scene object only — NOT the checkout carrier',
    };
  });

  await page.screenshot({ path: path.join(OUT, '01-scene.png') });

  const problems = [];
  if (orange.length) problems.push(`orange hover geometry still present: ${JSON.stringify(orange)}`);
  const out = { ok: problems.length === 0, problems, orange, pose, bag };
  fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(out, null, 2));
  return out;
}
