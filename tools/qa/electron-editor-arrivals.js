// GOAL 27, THE 10-SECOND TARGET — WHAT ARE THE EDITOR'S 33-46 ARRIVING
// PROGRAMS, BY NAME?
//
// The course editor's first entry arrives +33-46 programs (census-measured,
// both cache tiers) — the one first-press the warm architecture cannot
// reach, because the materials those programs serve do not EXIST until the
// editor builds its content at entry. This names them: snapshot the live
// program cacheKeys, enter the editor, diff, and cluster the new keys by
// shader family and their key-field spreads. Counts and names only — valid
// on a degraded machine where milliseconds are noise.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-editor-arrivals.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/editor-arrivals');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  const keys = () => page.evaluate(() => (window.__fw.scene3d.renderer.info.programs || [])
    .map((p) => String(p.cacheKey)));
  const before = await keys();

  // also snapshot which MATERIALS exist pre-entry, so a new program can be
  // matched to a material born at entry
  const matsBefore = await page.evaluate(() => {
    const seen = new Set();
    window.__fw.scene3d.scene.traverse((o) => {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m) seen.add(m.uuid);
      }
    });
    return [...seen];
  });

  await page.keyboard.press('j');
  await page.waitForTimeout(4000);
  const after = await keys();

  const newMats = await page.evaluate((prior) => {
    const priorSet = new Set(prior);
    const born = [];
    window.__fw.scene3d.scene.traverse((o) => {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m && !priorSet.has(m.uuid)) {
          born.push({
            type: m.type,
            name: m.name || '(unnamed)',
            owner: o.name || o.type,
            vertexColors: !!m.vertexColors,
            transparent: !!m.transparent,
            maps: ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].filter((k) => m[k]).length,
          });
        }
      }
    });
    return born;
  }, matsBefore);

  const beforeSet = new Set(before);
  const arrivals = after.filter((k) => !beforeSet.has(k));
  const famCount = new Map();
  for (const k of arrivals) {
    const fam = k.split(',')[0];
    famCount.set(fam, (famCount.get(fam) || 0) + 1);
  }

  // nearest-twin field diff: for each arrival, the before-key of the same
  // family with the fewest differing fields — the differing TAIL positions
  // name the frame-state axis the editor changes (three's key tail is a
  // fixed parameter sequence; counting from the end survives define shifts)
  const TAIL = [
    'customProgramCacheKey', 'outputColorSpace', 'booleanFlags', 'depthPacking',
    'numClipIntersection', 'numClippingPlanes', 'toneMapping', 'shadowMapType',
    'numLightProbes', 'numSpotLightShadowsWithMaps', 'numSpotLightShadows',
    'numPointLightShadows', 'numDirLightShadows', 'numRectAreaLights',
    'numHemiLights', 'numSpotLightMaps', 'numSpotLights', 'numPointLights',
    'numDirLights',
  ];
  const diffAxis = new Map();
  for (const k of arrivals) {
    const kf = k.split(',');
    let best = null;
    for (const b of before) {
      const bf = b.split(',');
      if (bf[0] !== kf[0]) continue;
      let diffs = 0;
      const where = [];
      const len = Math.max(kf.length, bf.length);
      for (let i = 1; i <= len; i += 1) {
        const a = kf[kf.length - i];
        const c = bf[bf.length - i];
        if (a !== c) { diffs += 1; where.push(i); }
        if (diffs > 6) break;
      }
      if (!best || diffs < best.diffs) best = { diffs, where };
    }
    if (best) {
      for (const i of best.where) {
        const name = TAIL[i - 1] || `field-from-end-${i}`;
        diffAxis.set(name, (diffAxis.get(name) || 0) + 1);
      }
    }
  }
  out.differingAxes = [...diffAxis.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([axis, programs]) => ({ axis, programs }));
  out.programArrivals = arrivals.length;
  out.arrivalsByFamily = [...famCount.entries()].map(([f, n]) => ({ family: String(f).slice(0, 30), programs: n }));
  out.materialsBornAtEntry = newMats.length;
  out.bornSample = newMats.slice(0, 25);

  console.log(JSON.stringify({
    programArrivals: out.programArrivals,
    arrivalsByFamily: out.arrivalsByFamily,
    materialsBornAtEntry: out.materialsBornAtEntry,
    differingAxes: out.differingAxes,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'editor-arrivals.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
