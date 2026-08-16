// GOAL 29 PHASE 7 — the register-till instrument Goal 28 named and did not
// build: "count geometries/textures/programs across the enter() span".
// Counts only — valid on the degraded machine.
//
// Protocol: settle -> snapshot -> FIRST enter (deltas are the residual's
// attribution) -> leave -> snapshot -> SECOND enter (the null control: a
// warmed surface must show ~zero deltas, or the instrument is reading
// ambient churn, not press work) -> leave -> PLANTED UPLOAD control (a mesh
// with a fresh geometry and a fresh texture during a sampled span must read
// +1/+1 exactly, or the counters are not measuring uploads).
//
//   node tools/qa/run-electron.cjs tools/qa/goal29-register-till-attribution.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-programs');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'till-attr';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(10000); // deferred warms fully retired

  const snap = () => page.evaluate(() => {
    const info = window.__fw.scene3d.renderer.info;
    return { g: info.memory.geometries, t: info.memory.textures, p: info.programs?.length ?? -1 };
  });
  const delta = (a, b) => ({ geometries: b.g - a.g, textures: b.t - a.t, programs: b.p - a.p });

  // ---- first press ------------------------------------------------------------
  // light-state census, taken alongside the program census: if the till's
  // arriving programs sit one key-step from their twins on a light-count
  // field, the visible-light delta across enter() NAMES that field.
  const lightCensus = () => page.evaluate(() => {
    const counts = {};
    window.__fw.scene3d.scene.traverse((o) => {
      if (!o.isLight) return;
      let chainVisible = true;
      for (let n = o; n; n = n.parent) { if (!n.visible) { chainVisible = false; break; } }
      const key = `${o.type}${o.castShadow ? '+shadow' : ''}${chainVisible ? '' : ':hidden'}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  });
  const a = await snap();
  out.lightsBefore = await lightCensus();
  await page.evaluate(() => {
    window.__g29keysBefore = (window.__fw.scene3d.renderer.info.programs || []).map((p) => String(p.cacheKey));
  });
  const entered1 = await page.evaluate(() => {
    const reg = window.__fw.scene3d?.clubhouse?.()?.register;
    if (typeof reg?.enter !== 'function') return 'no register.enter';
    reg.enter();
    return true;
  });
  await page.waitForTimeout(2500);
  const b = await snap();
  out.lightsDuring = await lightCensus();
  // name the arrivals: the new cacheKeys and where they differ from their
  // nearest settled twin (the fix needs the axis, not just the count)
  out.firstPressArrivals = await page.evaluate(() => {
    const before = new Set(window.__g29keysBefore || []);
    const now = (window.__fw.scene3d.renderer.info.programs || []).map((p) => ({ key: String(p.cacheKey), used: p.usedTimes }));
    const fresh = now.filter((p) => !before.has(p.key));
    return fresh.map((p) => {
      const f = p.key.split(',');
      let best = null;
      for (const oldKey of before) {
        const o = oldKey.split(',');
        if (o.length !== f.length) continue;
        const diffs = [];
        for (let i = 0; i < f.length && diffs.length <= 4; i += 1) if (o[i] !== f[i]) diffs.push({ i, was: o[i], is: f[i] });
        if (diffs.length && (!best || diffs.length < best.diffs.length)) best = { diffs };
      }
      return { used: p.used, width: f.length, family: f[0].slice(0, 20), nearestTwinDiffs: best?.diffs || 'no same-width twin' };
    });
  });
  const active1 = await page.evaluate(() => window.__fw.scene3d?.clubhouse?.()?.register?.isActive?.() === true);
  await page.evaluate(() => window.__fw.scene3d?.clubhouse?.()?.register?.leave?.());
  await page.waitForTimeout(2000);

  // ---- second press (null control) ---------------------------------------------
  const c = await snap();
  await page.evaluate(() => window.__fw.scene3d?.clubhouse?.()?.register?.enter?.());
  await page.waitForTimeout(2500);
  const d = await snap();
  const active2 = await page.evaluate(() => window.__fw.scene3d?.clubhouse?.()?.register?.isActive?.() === true);
  await page.evaluate(() => window.__fw.scene3d?.clubhouse?.()?.register?.leave?.());
  await page.waitForTimeout(1500);

  // ---- planted upload control ----------------------------------------------------
  const e = await snap();
  const planted = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let donor = null;
    s3.scene.traverse((o) => {
      if (!donor && o.isMesh && o.constructor?.name === 'Mesh' && !Array.isArray(o.material) && o.geometry?.attributes?.position && !o.geometry.attributes.position.isInterleavedBufferAttribute) donor = o;
    });
    if (!donor) return { err: 'no donor' };
    const GeoC = donor.geometry.constructor;
    const BA = donor.geometry.attributes.position.constructor;
    const g = new GeoC();
    g.setIndex?.(null);
    for (const name of Object.keys(g.attributes || {})) g.deleteAttribute(name);
    g.setAttribute('position', new BA(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new BA(new Float32Array(6), 2));
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    canvas.getContext('2d').fillRect(0, 0, 64, 64);
    const donorTexMat = donor.material;
    const tex = (donorTexMat.map || null) ? donorTexMat.map.clone() : null;
    let material;
    if (tex) {
      tex.source = new donorTexMat.map.source.constructor(canvas);
      tex.needsUpdate = true;
      material = donorTexMat.clone();
      material.map = tex;
    } else {
      material = donorTexMat.clone();
    }
    const mesh = new donor.constructor();
    mesh.geometry = g;
    mesh.material = material;
    mesh.frustumCulled = false;
    s3.scene.add(mesh);
    window.__g29till = { mesh, material, tex, g };
    return { ok: true, withTexture: !!tex };
  });
  await page.waitForTimeout(1500); // a real frame uploads it
  const f = await snap();
  await page.evaluate(() => {
    const st = window.__g29till;
    if (!st) return;
    st.mesh.removeFromParent();
    st.g.dispose();
    st.material.dispose();
    st.tex?.dispose?.();
    window.__g29till = null;
  });

  out.firstPress = { entered: entered1, active: active1, ...delta(a, b) };
  out.secondPress = { active: active2, ...delta(c, d) };
  out.plantedControl = { ...delta(e, f), planted };
  const controlOk = planted.ok
    && out.plantedControl.geometries === 1
    && (!planted.withTexture || out.plantedControl.textures === 1);
  const nullOk = Math.abs(out.secondPress.geometries) <= 1 && Math.abs(out.secondPress.textures) <= 1;
  out.control_plantedUpload = controlOk
    ? `ok — +${out.plantedControl.geometries} geometry, +${out.plantedControl.textures} texture read exactly`
    : `FAILED — ${JSON.stringify(out.plantedControl)}`;
  out.control_secondPressNull = nullOk
    ? `ok — second press residue g${out.secondPress.geometries}/t${out.secondPress.textures}/p${out.secondPress.programs}`
    : `SECOND PRESS NOT NULL — ${JSON.stringify(out.secondPress)} (instrument reads ambient churn)`;

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  const ok = controlOk && nullOk;
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED');
  if (!ok) process.exitCode = 1;
  return out;
}
