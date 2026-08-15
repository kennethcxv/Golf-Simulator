// ROUND 4 — Tab, on HIS save. "I click tab and it lags pretty hard, and when I
// click it again it shows another like concrete floor for a second."
//
// The fresh-save recording shows a clean cut both ways, so whatever he is
// seeing needs his world: his position, his course's 3,482 objects, his dirt.
// This plants his autosave, Continues into it, presses Tab twice from wherever
// his character actually stands, and records video + an in-page frame trace.
//
//   VIDEO_DIR=qa/tab-owner node tools/qa/run-electron.cjs \
//     tools/qa/electron-tab-owner-save.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tab-owner');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));

  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async ({ save, saveMeta }) => {
    await window.fairwayNative.save('autosave', save);
    await window.fairwayNative.save('autosave-meta', saveMeta);
  }, { save: autosave, saveMeta: meta });
  await page.reload();
  await page.waitForFunction(() => {
    const b = document.querySelector('.menu-action-primary');
    return !!b && !b.disabled;
  }, null, { timeout: 45000 });
  await page.evaluate(() => document.querySelector('.menu-action-primary').click());
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(600);

  out.where = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse();
    return {
      x: +w.x.toFixed(1),
      z: +w.z.toFixed(1),
      inside: ch.isInside ? !!ch.isInside(w.x, w.z, 0.35) : null,
      courseObjects: window.__fw.state?.course?.objects?.length ?? null,
    };
  });

  await page.evaluate(() => {
    window.__tab = [];
    window.__tabStop = false;
    let last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      window.__tab.push({
        ms: +(now - t0).toFixed(1),
        dt: +(now - last).toFixed(1),
        mode: window.__fw?.courseMode ?? null,
      });
      last = now;
      if (!window.__tabStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.waitForTimeout(400);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(5000);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(6000);
  const trace = await page.evaluate(() => { window.__tabStop = true; return window.__tab; });

  const long = trace.filter((f) => f.dt > 100).map((f) => ({ ms: f.ms, dt: f.dt, mode: f.mode }));
  out.summary = {
    where: out.where,
    frames: trace.length,
    longestFrameMs: trace.reduce((m, f) => Math.max(m, f.dt), 0),
    framesOver100ms: long.length,
    longFrames: long.slice(0, 10),
  };
  out.trace = trace;
  fs.writeFileSync(path.join(OUT, 'tab-owner.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('TAB-OWNER', JSON.stringify(out.summary, null, 2));
  return out;
}
