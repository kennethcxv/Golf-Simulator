// HIS SAVE, ON A CLEAN PROFILE — the decisive split for "3 fps from load".
//
// Two things differ between the owner's broken launches and every healthy
// harness run: HIS SAVE (the harness boots fresh campaigns) and per-launch GPU
// state (his log shows `GPU state invalid after WaitForGetOffsetInRange`, a GPU
// process loss). This driver removes exactly one of them: it copies his real
// autosave into the QA profile, boots it through Continue, and measures.
//
//   reproduces 3 fps  -> his SAVE content interacting with tonight's code; mine to fix
//   stays ~60         -> his launch/GPU environment; a different fix entirely
//
// It also prints the UNMASKED WebGL renderer string, because after a GPU process
// loss Chromium can fall back to SwiftShader, and software rendering IS "3 fps
// from load" — a number cannot separate that from a slow scene, the renderer
// string can.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-owner-save-fps.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/owner-save-fps');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));

  // Reach the menu, plant his save through the shipped bridge, reload so the
  // menu re-derives Continue from the now-present slot.
  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  out.planted = await page.evaluate(async ({ save, saveMeta }) => {
    await window.fairwayNative.save('autosave', save);
    await window.fairwayNative.save('autosave-meta', saveMeta);
    return true;
  }, { save: autosave, saveMeta: meta });
  await page.reload();
  // The menu enables Continue ASYNCHRONOUSLY after inspecting the save files.
  // The first run of this driver sampled a still-disabled button through
  // clickThroughMenu, silently fell back to a new game, and measured a fresh
  // campaign while claiming to test his save -- the `route` field is what caught
  // it. So: wait for the button to actually ENABLE, then click it ourselves.
  // A timeout here is a loud failure, not a fallback.
  // NOT /\bContinue\b/. An ENABLED Continue reads "ContinuePine Hills…" -- the
  // label and the summary detail concatenate with no separator, so the trailing
  // word boundary fails and the regex can only ever match a DISABLED button.
  // qa-boot's own VERIFY2_L comment documents this exact landmine, and it cost
  // this driver a 45-second timeout on a save the menu had already accepted.
  await page.waitForFunction(() => {
    const b = document.querySelector('.menu-action-primary');
    return !!b && !b.disabled;
  }, null, { timeout: 45000 });
  await page.evaluate(() => document.querySelector('.menu-action-primary').click());
  out.route = 'continue';
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(1500);

  out.gpu = await page.evaluate(() => {
    const gl = window.__fw?.scene3d?.renderer?.getContext?.();
    if (!gl) return { error: 'no context' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      contextLost: gl.isContextLost(),
    };
  });

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(500);

  const measure = async (label, seconds, act) => {
    await page.evaluate(() => {
      window.__f = []; window.__fStop = false;
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        window.__f.push(+(now - last).toFixed(2));
        last = now;
        if (!window.__fStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (act) await act();
    await page.waitForTimeout(seconds * 1000);
    const dts = (await page.evaluate(() => { window.__fStop = true; return window.__f; })).slice(2).sort((a, b) => a - b);
    if (!dts.length) return { label, error: 'no frames' };
    const pick = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
    const row = {
      label,
      frames: dts.length,
      medianMs: +pick(0.5).toFixed(2),
      p95Ms: +pick(0.95).toFixed(2),
      worstMs: +dts[dts.length - 1].toFixed(1),
      effectiveFps: +(1000 / pick(0.5)).toFixed(1),
      over100: dts.filter((d) => d > 100).length,
    };
    out[label] = row;
    console.log('OWNER-FPS', JSON.stringify(row));
    return row;
  };

  out.world = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    return {
      customers: ch?.customers?.()?.length ?? null,
      heldItems: window.__fw.state?.shop?.held?.length ?? null,
      speedIdx: window.__fw.speedIdx ?? null,
      fpsCap: window.__fw.state?.meta?.uiPrefs?.fpsCap
        ?? window.__fw.state?.uiPrefs?.fpsCap ?? null,
    };
  });

  await measure('standingStill', 4, null);
  await measure('walkingForward', 4, async () => { await page.keyboard.down('w'); });
  await page.keyboard.up('w');

  out.summary = {
    route: out.route,
    gpuRenderer: out.gpu?.renderer,
    softwareRendering: /swiftshader|software|llvmpipe/i.test(String(out.gpu?.renderer || '')),
    customers: out.world?.customers,
    fpsCap: out.world?.fpsCap,
    standingFps: out.standingStill?.effectiveFps,
    walkingFps: out.walkingForward?.effectiveFps,
    REPRODUCED_3FPS: (out.standingStill?.effectiveFps ?? 60) < 15,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'owner-save-fps.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('OWNER-SAVE-FPS', JSON.stringify(out.summary, null, 2));
  return out;
}
