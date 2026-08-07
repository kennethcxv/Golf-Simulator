// Diagnostic only: what is actually parented under the player camera for a
// stick tool versus a hand-worked one. The pixel probe found the SAME five
// name-matched meshes for all nine tools, which is the shape of a filter that
// has locked onto one system and is blind to the other.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/hand-census');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.30;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1000);

  const rows = {};
  for (const id of ['broom', 'spray', 'cloth']) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), id);
    await page.waitForTimeout(1800);
    rows[id] = await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      const cam = s3.camera;
      const out = [];
      const walkTree = (o, depth, path) => {
        const nm = String(o.name || `(${o.type})`);
        if (o.isMesh) {
          let vis = o.visible;
          for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
          out.push({ name: nm, path, visible: vis, layer: o.layers.mask });
        }
        for (const c of o.children) walkTree(c, depth + 1, `${path}/${nm}`);
      };
      walkTree(cam, 0, '');
      const vis = out.filter((m) => m.visible);
      return { total: out.length, visible: vis.length, meshes: vis.slice(0, 80) };
    });
  }
  fs.writeFileSync(path.join(OUT, 'census.json'), `${JSON.stringify(rows, null, 2)}\n`);
  const summary = {};
  for (const [k, v] of Object.entries(rows)) {
    summary[k] = {
      total: v.total,
      visible: v.visible,
      visibleNames: v.meshes.filter((m) => m.visible).map((m) => `${m.name}[L${m.layer}]`).slice(0, 24),
    };
  }
  return { ok: true, summary };
}
