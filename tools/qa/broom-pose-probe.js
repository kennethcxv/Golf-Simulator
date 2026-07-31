async (page) => {
  // One-off geometry probe for the arm recomposition: where the authored
  // grips, hands, and head socket actually sit in the broom group's frame.
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
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    app.speedIdx = 0;
    w.setTool('broom');
  });
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    let broomGroup = null;
    scene.traverse((o) => {
      if (!broomGroup && o.name && /broom/i.test(o.name) && o.type === 'Group') broomGroup = o;
    });
    // find the held broom group by looking for the arm groups we added
    let rigParent = null;
    scene.traverse((o) => {
      if (!rigParent && o.name === 'BroomRightArm') rigParent = o.parent;
    });
    const g = rigParent || broomGroup;
    if (!g) return { error: 'no broom group found' };
    const kids = [];
    g.traverse((o) => {
      if (kids.length > 40) return;
      const p = o.position;
      kids.push({
        name: o.name || o.type,
        local: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
      });
    });
    const Vec3 = g.position.constructor; // THREE.Vector3 without an import
    const toLocal = (obj) => {
      const v = new Vec3();
      obj.getWorldPosition(v);
      g.worldToLocal(v);
      return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
    };
    const rh = scene.getObjectByName('FirstPersonRightHand');
    const lh = scene.getObjectByName('FirstPersonLeftHand');
    const camLocal = (obj) => {
      const v = new Vec3();
      obj.getWorldPosition(v);
      app.scene3d.camera.worldToLocal(v);
      return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
    };
    return {
      groupName: g.name,
      groupPos: [g.position.x, g.position.y, g.position.z].map((n) => +n.toFixed(3)),
      groupRot: [g.rotation.x, g.rotation.y, g.rotation.z].map((n) => +n.toFixed(3)),
      rightHand: rh ? { broomLocal: toLocal(rh), camLocal: camLocal(rh) } : null,
      leftHand: lh ? { broomLocal: toLocal(lh), camLocal: camLocal(lh), visible: lh.visible } : null,
      kids: kids.slice(0, 34),
      diag: app.scene3d.walk.broomDiagnostics(),
    };
  });
}
