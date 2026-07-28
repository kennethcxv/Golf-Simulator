// A/B the cross-file texture sharing lever against the same build.
//
// `sharedTexturePool.js` reports how many bytes it avoided, but a module
// reporting its own saving is not evidence. This loads the identical scene twice
// on the identical seed — once with interning disabled, once with it on — and
// compares what the RENDERER ended up holding, which is the number that matters.
//
// The measured quantities are deliberately renderer-side, not pool-side:
//   renderer.info.memory.textures  — textures the GPU actually initialised
//   estimated resident bytes       — walked from live material slots
// A saving that shows up in the pool's own counter but not in these is not a
// saving.
async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = 20260727;

  const runOnce = async (disableInterning) => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      const empire = E.newStarterEmpire('relaxed', seed);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    }, SEED);

    // Set the flag before any module runs, so it is in place when the first GLB
    // resolves rather than racing the loader.
    await page.addInitScript((off) => {
      if (off) globalThis.__FW_DISABLE_TEXTURE_INTERNING = true;
      else delete globalThis.__FW_DISABLE_TEXTURE_INTERNING;
    }, disableInterning);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 120000 });
    // Assets stream in after the veil lifts; wait for the scene to settle so both
    // arms are measured with the same set of GLBs resident.
    await page.waitForFunction(() => window.__fw?.scene3d?.whenAssetsIdle, null, { timeout: 60000 });
    await page.evaluate(() => window.__fw.scene3d.whenAssetsIdle()).catch(() => {});
    await page.waitForTimeout(6000);

    return page.evaluate((off) => {
      const s3 = window.__fw.scene3d;
      const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];
      const seen = new Set();
      let bytes = 0;
      const sizes = {};
      s3.scene.traverse((o) => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (!m) return;
          SLOTS.forEach((k) => {
            const t = m[k];
            if (!t || !t.image) return;
            // Source, not Texture — see proshop-texture-infrastructure.js.
            const srcKey = t.source?.uuid || t.uuid;
            if (seen.has(srcKey)) return;
            const w = t.image.width || 0; const h = t.image.height || 0;
            if (!w) return;
            seen.add(srcKey);
            bytes += w * h * (t.isCompressedTexture ? 1 : 4) * (4 / 3);
            sizes[`${w}x${h}`] = (sizes[`${w}x${h}`] || 0) + 1;
          });
        });
      });
      return {
        interningDisabled: !!off,
        flagSeen: !!globalThis.__FW_DISABLE_TEXTURE_INTERNING,
        distinctTextureInstances: seen.size,
        estResidentMB: +(bytes / 1048576).toFixed(1),
        rendererTextures: s3.renderer.info.memory.textures,
        rendererGeometries: s3.renderer.info.memory.geometries,
        programs: s3.renderer.info.programs ? s3.renderer.info.programs.length : null,
        poolReport: s3.textureMemory ? s3.textureMemory().shared : null,
        sizeHistogram: sizes,
      };
    }, disableInterning);
  };

  // Control first, so the treatment cannot benefit from a warm state the control
  // did not have.
  const off = await runOnce(true);
  const on = await runOnce(false);

  const delta = {
    distinctTextureInstances: off.distinctTextureInstances - on.distinctTextureInstances,
    estResidentMB: +(off.estResidentMB - on.estResidentMB).toFixed(1),
    rendererTextures: off.rendererTextures - on.rendererTextures,
    percentResidentSaved: off.estResidentMB
      ? +(((off.estResidentMB - on.estResidentMB) / off.estResidentMB) * 100).toFixed(1)
      : null,
  };

  const failures = [];
  if (!off.flagSeen) failures.push('control arm did not actually disable interning');
  if (on.flagSeen) failures.push('treatment arm still had interning disabled');
  if (off.poolReport?.interned) failures.push('control arm interned textures anyway');
  if (!on.poolReport?.interned) failures.push('treatment arm interned nothing');
  // Both arms must have loaded the same scene, or the comparison is meaningless.
  if (Math.abs(off.rendererGeometries - on.rendererGeometries) > off.rendererGeometries * 0.02) {
    failures.push(
      `arms loaded different scenes: ${off.rendererGeometries} vs ${on.rendererGeometries} geometries`,
    );
  }

  return { ok: failures.length === 0, failures, control: off, treatment: on, delta };
}
