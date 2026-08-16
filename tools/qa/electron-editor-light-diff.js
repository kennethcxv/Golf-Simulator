// GOAL 27 — NAME THE LIGHT THAT SEPARATES THE EDITOR WARM FROM A REAL ENTRY.
//
// The residual 11 first-entry arrivals differ from their warmed twins on one
// light-count key field (4 vs 3, value-diffed by electron-editor-arrivals).
// Static reading cannot name the light: the main scene owns ONE directional
// sun, so a count of 4 means embedded GLB lights, another module's lights, or
// a state gate (visibility chain / camera layers) flipping between the two
// moments. This driver reads both moments live:
//   - the prewarm's editor warm draw records its own light state into
//     window.__fwPrewarmEditorLightState (courseScene, at the draw site);
//   - after a real 'j' entry settles, the same enumeration runs against the
//     live camera. The diff names the light and the gate.
// Program-key arrivals are captured in the same boot so the light diff is
// tied to the phenomenon it explains. Counts and names only — valid on a
// degraded machine.
//
// Instrument control: both enumerations must contain the sun (a known,
// always-on DirectionalLight). A set missing the sun means the traversal or
// the capture is broken, and the run reports itself UNRELIABLE.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-editor-light-diff.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/editor-light-diff');
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

  out.warm = await page.evaluate(() => window.__fwPrewarmEditorLightState || null);

  const keys = () => page.evaluate(() => (window.__fw.scene3d.renderer.info.programs || [])
    .map((p) => String(p.cacheKey)));
  const before = await keys();

  await page.keyboard.press('j');
  await page.waitForTimeout(4000);

  out.entry = await page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const camera = app.scene3d.camera;
    const set = [];
    scene.traverse((o) => {
      if (!o.isLight || o.isAmbientLight) return;
      let vis = o.visible;
      let p = o.parent;
      while (vis && p) { vis = p.visible; p = p.parent; }
      set.push({
        t: o.type,
        n: o.name || '',
        s: !!o.castShadow,
        i: +(+o.intensity).toFixed(2),
        visChain: vis,
        layerOk: o.layers.test(camera.layers),
      });
    });
    return set;
  });

  const after = await keys();
  const beforeSet = new Set(before);
  out.programArrivalsThisBoot = after.filter((k) => !beforeSet.has(k)).length;

  const tally = (set) => {
    const counted = {};
    const gatedOut = [];
    for (const l of set || []) {
      if (l.visChain && l.layerOk) counted[l.t] = (counted[l.t] || 0) + 1;
      else gatedOut.push(l);
    }
    return { counted, gatedOut };
  };
  out.warmTally = tally(out.warm);
  out.entryTally = tally(out.entry);
  const sunIn = (set) => (set || []).some((l) => l.t === 'DirectionalLight' && l.visChain && l.layerOk);
  out.controlSunPresent = { warm: sunIn(out.warm), entry: sunIn(out.entry) };
  out.instrumentReliable = out.controlSunPresent.warm && out.controlSunPresent.entry;

  // the named diff: lights counted in one state and not the other
  const sig = (l) => `${l.t}|${l.n}|shadow:${l.s}`;
  const countedSigs = (set) => (set || []).filter((l) => l.visChain && l.layerOk).map(sig);
  const w = countedSigs(out.warm);
  const e = countedSigs(out.entry);
  const eSet = [...e];
  out.inWarmNotEntry = w.filter((s) => {
    const i = eSet.indexOf(s);
    if (i >= 0) { eSet.splice(i, 1); return false; }
    return true;
  });
  const wSet = [...w];
  out.inEntryNotWarm = e.filter((s) => {
    const i = wSet.indexOf(s);
    if (i >= 0) { wSet.splice(i, 1); return false; }
    return true;
  });

  console.log(JSON.stringify({
    instrumentReliable: out.instrumentReliable,
    controlSunPresent: out.controlSunPresent,
    warmCounted: out.warmTally.counted,
    entryCounted: out.entryTally.counted,
    inWarmNotEntry: out.inWarmNotEntry,
    inEntryNotWarm: out.inEntryNotWarm,
    warmGatedOut: out.warmTally.gatedOut,
    entryGatedOut: out.entryTally.gatedOut,
    programArrivalsThisBoot: out.programArrivalsThisBoot,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, 'editor-light-diff.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
