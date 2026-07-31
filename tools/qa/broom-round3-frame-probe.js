async (page) => {
  // Where is every part of the broom rig, in the frame the player actually sees?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-round3-frame-probe.js
  //
  // Projects through the VIEWMODEL lens (not the world camera) without touching
  // its matrices — vmCamera.matrixAutoUpdate is false and its matrixWorld is
  // copied from the world camera each frame, so calling updateMatrixWorld on it
  // destroys the pose and every number comes back garbage.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-round3');
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
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.waitForTimeout(1200);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2600);

  const probe = () => page.evaluate(() => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const vm = w.broomViewmodelCamera();
    const world = app.scene3d.camera;
    const Vec3 = world.position.constructor;
    const v = new Vec3();
    // camera-space = world point through the world camera's inverse; the vm
    // camera shares that pose, so this is the rig's frame too.
    const toCam = (p) => new Vec3(p.x, p.y, p.z).applyMatrix4(world.matrixWorldInverse);
    const toNdc = (p) => new Vec3(p.x, p.y, p.z).project(vm);

    const named = {};
    let broomGroup = null;
    app.scene3d.scene.traverse((o) => {
      if (o.name === 'Tool_broom') broomGroup = o;
      if (['FirstPersonRightHand', 'FirstPersonLeftHand', 'BroomRightArm', 'BroomLeftArm',
        'FirstPersonHands'].includes(o.name)) named[o.name] = o;
    });

    const report = (label, obj) => {
      if (!obj) return [label, null];
      obj.getWorldPosition(v);
      const cam = toCam(v);
      const ndc = toNdc(v);
      return [label, {
        visible: obj.visible,
        cam: [+cam.x.toFixed(3), +cam.y.toFixed(3), +cam.z.toFixed(3)],
        ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3)],
      }];
    };

    const out = Object.fromEntries([
      report('rightHand', named.FirstPersonRightHand),
      report('leftHand', named.FirstPersonLeftHand),
      report('handsRoot', named.FirstPersonHands),
      report('toolOrigin', broomGroup),
    ]);

    // the bristle contact socket, tool-local
    if (broomGroup) {
      v.set(0, -0.215, -1.85);
      broomGroup.localToWorld(v);
      const cam = toCam(v); const ndc = toNdc(v);
      out.headSocket = {
        cam: [+cam.x.toFixed(3), +cam.y.toFixed(3), +cam.z.toFixed(3)],
        ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3)],
      };
      out.toolRotation = broomGroup.rotation.toArray().slice(0, 3).map((x) => +(+x).toFixed(3));
    }

    // every mesh under the arm groups: what is the green, and where does it run?
    const arms = [];
    for (const n of ['BroomRightArm', 'BroomLeftArm']) {
      const g = named[n];
      if (!g) continue;
      g.traverse((m) => {
        if (!m.isMesh) return;
        const pos = m.geometry?.attributes?.position;
        if (!pos) return;
        let n0 = [9, 9]; let n1 = [-9, -9];
        const step = Math.max(1, Math.floor(pos.count / 60));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i);
          m.localToWorld(v);
          const p = toNdc(v);
          n0 = [Math.min(n0[0], p.x), Math.min(n0[1], p.y)];
          n1 = [Math.max(n1[0], p.x), Math.max(n1[1], p.y)];
        }
        arms.push({
          arm: n,
          hex: m.material?.color ? `#${m.material.color.getHexString()}` : null,
          visible: m.visible,
          geo: m.geometry.type,
          ndcX: [+n0[0].toFixed(2), +n1[0].toFixed(2)],
          ndcY: [+n0[1].toFixed(2), +n1[1].toFixed(2)],
        });
      });
    }
    out.armMeshes = arms;
    out.diag = w.broomDiagnostics();
    return out;
  });

  const level = await probe();
  // and at a working down-look, where the pose blends onto the boards
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.8; });
  await page.waitForTimeout(900);
  const down = await probe();

  fs.writeFileSync(path.join(OUT, 'frame-probe.json'),
    JSON.stringify({ level, down }, null, 2));
  return { ok: true, level, down };
}
