// GOAL 27, PHASE 6 — DOES THE RENDER RESOLUTION FOLLOW THE MONITOR?
//
// The owner's report: dragging the window from the 4K panel (dpr 1.5) to the
// 1440p panel should change the render resolution, and never has. The defect:
// scene3d.resize() sizes the composer from the renderer's CACHED pixel ratio,
// set once at construction — a devicePixelRatio change never reached it.
//
// A real cross-monitor drag cannot be scripted on one display, so the dpr
// change is emulated with CDP Emulation.setDeviceMetricsOverride, which
// changes window.devicePixelRatio and fires the same resize event a monitor
// change fires.
//
// SELF-CHECK: if the override does not actually change window.devicePixelRatio
// in this Electron, the run reports VOID rather than a false verdict.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-dpr-follows-monitor.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/dpr-follows-monitor');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize(); // the setContentSize trap
    win.setContentSize(1600, 900);
    win.center();
  });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const readState = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    return {
      dpr: window.devicePixelRatio,
      rendererRatio: window.__fw.scene3d.renderer.getPixelRatio(),
      cssW: c.clientWidth,
      bufW: c.width,
      bufH: c.height,
      effectiveRatio: +(c.width / c.clientWidth).toFixed(3),
    };
  });

  out.boot = await readState();
  console.log(`boot:     ${JSON.stringify(out.boot)}`);

  const cdp = await page.context().newCDPSession(page);
  // A real cross-monitor drag changes the window BOUNDS and the scale factor
  // together, and the bounds change is what fires the resize event. The first
  // version of this driver overrode only deviceScaleFactor — no resize event,
  // so the fix under test could never run and the FIXED build read as FAIL.
  // The production matchMedia listener covers the no-resize case too, but the
  // emulation stays faithful to the drag.
  let sizeNudge = 0;
  const setDpr = async (factor) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 0, height: 0, mobile: false, deviceScaleFactor: factor,
    });
    sizeNudge = sizeNudge === 0 ? 1 : 0;
    await page.electronApp.evaluate(({ BrowserWindow }, nudge) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(1600 + nudge, 900);
    }, sizeNudge);
    await page.waitForTimeout(900); // both resize passes + debounce
  };

  // the drag to the 1440p panel: dpr 1.5 -> 1.0
  await setDpr(1.0);
  out.at1x = await readState();
  console.log(`dpr 1.0:  ${JSON.stringify(out.at1x)}`);
  // ...and back to the 4K panel
  await setDpr(1.5);
  out.back15 = await readState();
  console.log(`dpr 1.5:  ${JSON.stringify(out.back15)}`);
  // ...and the scale change that arrives with NO resize event (Windows
  // display-scaling changed while the window sits still) — the matchMedia
  // listener's case, override only, no bounds nudge.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 0, height: 0, mobile: false, deviceScaleFactor: 1.25,
  });
  await page.waitForTimeout(900);
  out.noResize125 = await readState();
  console.log(`dpr 1.25 (no resize event): ${JSON.stringify(out.noResize125)}`);
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});

  if (out.at1x.dpr === out.boot.dpr) {
    out.verdict = 'VOID — the CDP override did not change devicePixelRatio; nothing was tested';
  } else {
    const followedDown = Math.abs(out.at1x.rendererRatio - out.at1x.dpr) < 0.01
      && Math.abs(out.at1x.effectiveRatio - out.at1x.dpr) < 0.05;
    const followedBack = Math.abs(out.back15.rendererRatio - out.back15.dpr) < 0.01
      && Math.abs(out.back15.effectiveRatio - out.back15.dpr) < 0.05;
    const followedNoResize = Math.abs(out.noResize125.rendererRatio - out.noResize125.dpr) < 0.01;
    out.verdict = followedDown && followedBack && followedNoResize
      ? 'PASS — the render resolution follows the monitor in both directions, resize event or not'
      : `FAIL — drag-down ${followedDown}, drag-back ${followedBack}, no-resize scale change ${followedNoResize}`
        + ` (renderer ${out.at1x.rendererRatio}/${out.back15.rendererRatio}/${out.noResize125.rendererRatio}`
        + ` vs dpr ${out.at1x.dpr}/${out.back15.dpr}/${out.noResize125.dpr})`;
  }
  console.log(`VERDICT: ${out.verdict}`);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
