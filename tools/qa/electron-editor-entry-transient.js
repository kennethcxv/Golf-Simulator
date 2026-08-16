// GOAL 27 — DOES THE EDITOR'S FIRST-ENTRY COMPILE HAPPEN IN A TRANSIENT
// LIGHT STATE THE SETTLED EDITOR NEVER SHOWS AGAIN?
//
// electron-editor-light-diff proved the warm draw's state and the settled
// entry state are IDENTICAL (1 sun + 1 hemi, same gated-out set) — yet entry
// still arrives new programs whose keys differ on a light-count field. The
// remaining place a different light state can exist is BETWEEN the keypress
// and settle: if entry's operations span frames (hide interior on one, apply
// the lighting override on another), the first editor frames draw transition
// states, and programs compile against THOSE. This driver samples every rAF
// for 3 s after 'j': the live program count, the counted light tally, and
// interior visibility. A frame where programs jump while the tally differs
// from the settled tally names the transient and convicts sequencing.
//
// Instrument control: the pre-entry frames must show the settled-equal tally
// (sun+hemi) — if they do not, the sampler itself is broken.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-editor-entry-transient.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/editor-entry-transient');
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

  // arm the per-frame sampler BEFORE the keypress so frame 0 is pre-entry
  await page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const renderer = app.scene3d.renderer;
    const camera = app.scene3d.camera;
    const interior = app.scene3d.clubhouse()?.interior || null;
    const frames = [];
    const tally = () => {
      const t = {};
      scene.traverse((o) => {
        if (!o.isLight || o.isAmbientLight) return;
        let vis = o.visible;
        let p = o.parent;
        while (vis && p) { vis = p.visible; p = p.parent; }
        if (vis && o.layers.test(camera.layers)) t[o.type] = (t[o.type] || 0) + 1;
      });
      return t;
    };
    const t0 = performance.now();
    const step = () => {
      frames.push({
        atMs: +(performance.now() - t0).toFixed(0),
        programs: renderer.info.programs?.length ?? -1,
        lights: tally(),
        interiorVisible: interior ? interior.visible : null,
      });
      if (performance.now() - t0 < 3600) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    window.__fwTransientFrames = frames;
  });
  await page.waitForTimeout(120);
  await page.keyboard.press('j');
  await page.waitForTimeout(4200);

  const frames = await page.evaluate(() => window.__fwTransientFrames || []);
  out.frameCount = frames.length;
  out.preEntry = frames[0] || null;
  // keep only frames where programs or the tally or visibility CHANGED
  const key = (f) => `${f.programs}|${JSON.stringify(f.lights)}|${f.interiorVisible}`;
  const changes = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (i === 0 || key(frames[i]) !== key(frames[i - 1])) changes.push(frames[i]);
  }
  out.changes = changes;
  out.settled = frames[frames.length - 1] || null;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  out.controlPreEntryTallySane = !!out.preEntry
    && (out.preEntry.lights.DirectionalLight === 1) && (out.preEntry.lights.HemisphereLight === 1);
  out.transientStates = changes.filter((f) => !eq(f.lights, out.preEntry?.lights)).map((f) => f);
  out.programsArrivedDuringWindow = (out.settled?.programs ?? 0) - (out.preEntry?.programs ?? 0);

  console.log(JSON.stringify(out, null, 2).slice(0, 6000));
  fs.writeFileSync(path.join(OUT, 'transient.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
