// WHAT CHANGES WHEN TAB IS PRESSED — the chain-visible light census in walk
// mode vs the real overview, beside the arriving program keys' field 36.
// Names the 4 -> 1 axis empirically instead of by another theory.
//   node tools/qa/run-electron.cjs tools/qa/goal-tab-light-census.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  if (process.env.QA_OWNERPLAY_NO_BAILOUT === '1') {
    await page.evaluate(() => { globalThis.__FW_PREWARM_NO_BAILOUT = true; });
  }
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(8000);

  const census = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const rows = {};
    s3.scene.traverse((o) => {
      if (!o.isLight) return;
      let vis = true;
      for (let n = o; n; n = n.parent) { if (!n.visible) { vis = false; break; } }
      const layerOk = o.layers.test(s3.camera.layers);
      const key = `${o.type}${o.castShadow ? '+sh' : ''}${vis ? '' : ':HIDDEN'}${layerOk ? '' : ':OFFLAYER'}`;
      rows[key] = (rows[key] || 0) + 1;
    });
    return { mode: window.__fw.courseMode, rows, keys: (s3.renderer.info.programs || []).map((p) => String(p.cacheKey)) };
  });

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);

  const walkC = await census();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(3500);
  const ovC = await census();
  // owners are read IN overview — after Tab-back the materials re-acquire
  // their walk-state programs and the fresh keys would match nothing

  const before = new Set(walkC.keys);
  const fresh = ovC.keys.filter((k) => !before.has(k));
  const f36 = fresh.map((k) => k.split(',')[36]);
  // name the arriving programs' OWNERS: which mesh/material rode each key
  const owners = await page.evaluate((freshKeys) => {
    const s3 = window.__fw.scene3d;
    const set = new Set(freshKeys);
    const rows = [];
    s3.scene.traverse((o) => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        const p = s3.renderer.properties.get(m);
        const key = p?.currentProgram?.cacheKey;
        if (key && set.has(String(key)) && rows.length < 30) {
          let chain = o.name || o.type;
          for (let n = o.parent; n && n !== s3.scene; n = n.parent) chain = `${n.name || n.type}/${chain}`;
          rows.push({ mesh: chain.slice(-90), material: m.name || m.type });
        }
      }
    });
    return rows;
  }, fresh);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1200);
  const out = {
    walkMode: walkC.mode,
    walkLights: walkC.rows,
    overviewMode: ovC.mode,
    overviewLights: ovC.rows,
    freshPrograms: fresh.length,
    field36OfFresh: f36,
    freshOwners: owners,
    field36Histogram: ovC.keys.reduce((h, k) => {
      const v = k.split(',')[36];
      h[v] = (h[v] || 0) + 1;
      return h;
    }, {}),
  };
  console.log(JSON.stringify(out, null, 1));
  return out;
}
