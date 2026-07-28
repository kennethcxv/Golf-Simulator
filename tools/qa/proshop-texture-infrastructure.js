// Assert the texture-memory infrastructure is actually running in the live scene.
//
// Three levers, three claims, each of which is easy to believe and wrong:
//   sharing     — that the cached loader is on the sheet_07/08 path at all
//   format      — that KTX2 stood up and detected a real compressed format
//   resolution  — that the interior's texture inventory is what we think it is
//
// This checks the first two directly against the running renderer and reports
// the third, so a projection has something measured under it.
async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = 20260727;

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(5000);

  const data = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const mem = s3.textureMemory ? s3.textureMemory() : null;

    // Per-asset texture footprint for the sheet_07/08 props, so the projection
    // for a twelve-file pass has a measured unit rather than an assumed one.
    const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
    const assets = [];
    ch.interior.traverse((node) => {
      const m = /AssetRuntime_(\d+)_([A-Za-z0-9_]+)/.exec(node.name || '');
      if (!m) return;
      const seen = new Set();
      let bytes = 0;
      let compressed = 0;
      const sizes = {};
      const names = [];
      node.traverse((o) => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => {
          if (!mat) return;
          SLOTS.forEach((slot) => {
            const t = mat[slot];
            if (!t || !t.image || seen.has(t.uuid)) return;
            const w = t.image.width || 0; const h = t.image.height || 0;
            if (!w) return;
            seen.add(t.uuid);
            const perTexel = t.isCompressedTexture ? 1 : 4;
            if (t.isCompressedTexture) compressed += 1;
            bytes += w * h * perTexel * (4 / 3);
            sizes[`${w}x${h}`] = (sizes[`${w}x${h}`] || 0) + 1;
            if (t.name) names.push(t.name);
          });
        });
      });
      if (!seen.size) return;
      assets.push({
        asset: `${m[1]} ${m[2]}`,
        uniqueTextures: seen.size,
        compressedTextures: compressed,
        estMB: +(bytes / 1048576).toFixed(2),
        sizes,
        textureNames: [...new Set(names)].sort(),
      });
    });
    assets.sort((a, b) => b.estMB - a.estMB);

    return {
      textureMemory: mem,
      rendererTextures: s3.renderer.info.memory.textures,
      drawCalls: s3.renderer.info.render.calls,
      programs: s3.renderer.info.programs ? s3.renderer.info.programs.length : null,
      texturedAssets: assets,
    };
  });

  const ktx2 = data.textureMemory?.ktx2;
  const failures = [];
  if (!ktx2?.initialised) failures.push('KTX2 loader was never initialised');
  if (!ktx2?.supportDetected) failures.push('KTX2 support was never detected against the renderer');
  if (ktx2 && !ktx2.astc && !ktx2.bptc && !ktx2.dxt) {
    failures.push('no compressed texture format is available on this GPU');
  }
  if (!data.textureMemory?.shared) failures.push('shared texture pool is not reporting');
  const fatal = consoleErrors.filter((e) => !/favicon|Download the React/i.test(e));
  if (fatal.length) failures.push(`console errors: ${fatal.slice(0, 3).join(' | ')}`);

  return { ok: failures.length === 0, failures, consoleErrors: fatal.slice(0, 8), ...data };
}
