// Assert the texture-memory infrastructure is actually running in the live scene.
//
// Three levers, three claims, each of which is easy to believe and wrong:
//   sharing     — that the cached loader is on the sheet_07/08 path at all
//   format      — that KTX2 is OFF, per the §3 rejection, and no GLB needs it
//   resolution  — that the interior's texture inventory is what we think it is
//
// The format check inverted when KTX2 was rejected (TEXTURE_MEMORY_POLICY.md §3). It now
// asserts the loader is detached and that nothing in the scene arrived compressed, because
// a compressed texture reaching a runtime that cannot transcode one is the failure mode
// the rejection creates.
//
// This also reports TOTAL resident texture memory for the whole scene, which is the number
// §3's reopen condition is written against: measured texture memory above 150 MB on the
// full slice puts the format lever back on the table. A threshold nobody measures is not a
// condition, so it is measured here.
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
            if (!t || !t.image) return;
            // Key on the SOURCE, not the Texture: three.js uploads once per
            // (Source, parameter key), so two clones of one image that differ only in
            // their UV transform cost one GPU texture, not two.
            const srcKey = t.source?.uuid || t.uuid;
            if (seen.has(srcKey)) return;
            const w = t.image.width || 0; const h = t.image.height || 0;
            if (!w) return;
            seen.add(srcKey);
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

    // Resident totals, keyed on Source for the same reason as above.
    //
    // Reported at TWO scopes deliberately. §3's reopen threshold is written against "the
    // full slice", and the slice is the pro shop — the clubhouse interior. The whole scene
    // also carries the golf course, sky, terrain and course props, which the slice does not
    // own and cannot fix. Quoting one number for both would either exonerate the room or
    // blame it for the course.
    const walk = (root) => {
      const seen = new Set();
      let bytes = 0;
      let compressed = 0;
      const sizes = {};
      const over512 = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => {
          if (!mat) return;
          [...SLOTS, 'alphaMap', 'lightMap'].forEach((slot) => {
            const t = mat[slot];
            if (!t || !t.image) return;
            const srcKey = t.source?.uuid || t.uuid;
            if (seen.has(srcKey)) return;
            const w = t.image.width || 0; const h = t.image.height || 0;
            if (!w) return;
            seen.add(srcKey);
            if (t.isCompressedTexture) compressed += 1;
            const mb = (w * h * (t.isCompressedTexture ? 1 : 4) * (4 / 3)) / 1048576;
            bytes += mb * 1048576;
            sizes[`${w}x${h}`] = (sizes[`${w}x${h}`] || 0) + 1;
            // The §7.3 ceiling is 512 on the long edge. Anything above it is where the
            // resolution lever still has room, listed so the biggest wins are named.
            if (Math.max(w, h) > 512) {
              over512.push({ name: t.name || slot, size: `${w}x${h}`, mb: +mb.toFixed(2) });
            }
          });
        });
      });
      over512.sort((a, b) => b.mb - a.mb);
      return {
        sources: seen.size,
        residentMB: +(bytes / 1048576).toFixed(1),
        compressed,
        sizeHistogram: sizes,
        aboveCeilingCount: over512.length,
        aboveCeilingMB: +over512.reduce((a, t) => a + t.mb, 0).toFixed(1),
        aboveCeilingWorst: over512.slice(0, 12),
      };
    };

    const sceneTotals = walk(s3.scene);
    const interiorTotals = walk(ch.interior);
    const compressedInScene = sceneTotals.compressed;

    return {
      sceneTotals,
      interiorTotals,
      textureMemory: mem,
      rendererTextures: s3.renderer.info.memory.textures,
      drawCalls: s3.renderer.info.render.calls,
      programs: s3.renderer.info.programs ? s3.renderer.info.programs.length : null,
      compressedTexturesInScene: compressedInScene,
      texturedAssets: assets,
    };
  });

  const ktx2 = data.textureMemory?.ktx2;
  const failures = [];
  // Format lever: rejected. Assert it stayed rejected.
  if (!ktx2?.rejected) {
    failures.push('KTX2 is live — it was rejected in TEXTURE_MEMORY_POLICY.md §3');
  }
  if (ktx2?.initialised) failures.push('a KTX2 loader was stood up despite the rejection');
  if (data.compressedTexturesInScene) {
    failures.push(
      `${data.compressedTexturesInScene} compressed textures in the scene, but the transcoder `
      + 'is disabled — these cannot decode. See §3',
    );
  }
  if (!data.textureMemory?.shared) failures.push('shared texture pool is not reporting');
  const fatal = consoleErrors.filter((e) => !/favicon|Download the React/i.test(e));
  if (fatal.length) failures.push(`console errors: ${fatal.slice(0, 3).join(' | ')}`);

  // Not a failure — a reported condition. §3 reopens the format lever above 150 MB on the
  // slice, which is the clubhouse interior. The scene figure is reported alongside it
  // because it is much larger and belongs to work the slice does not own.
  const REOPEN_MB = 150;
  const reopen = {
    thresholdMB: REOPEN_MB,
    sliceMB: data.interiorTotals.residentMB,
    sceneMB: data.sceneTotals.residentMB,
    formatLeverShouldBeReconsidered: data.interiorTotals.residentMB > REOPEN_MB,
    // Before reaching for the format lever, spend the resolution one: this is how much
    // sits above the §7.3 512-on-the-long-edge ceiling and could be halved twice over.
    sliceAboveCeilingMB: data.interiorTotals.aboveCeilingMB,
    sceneAboveCeilingMB: data.sceneTotals.aboveCeilingMB,
  };

  return { ok: failures.length === 0, failures, consoleErrors: fatal.slice(0, 8), reopen, ...data };
}
