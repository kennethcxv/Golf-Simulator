// A5 — DOES THE GAME OPEN FULL-WINDOW AT THE DISPLAY'S OWN RESOLUTION?
//
// The reviewers' correction, and the reason this driver reads more than the
// obvious: EVERY natural probe here measures the WINDOW. `getContentBounds()`
// times scaleFactor, `innerWidth` times devicePixelRatio, and the screenshot's
// own dimensions all report the composited surface, which is 4K on a maximised
// 4K window no matter how few pixels the scene actually drew. The DPR cap
// (src/render3d/courseScene.js and src/main.js applySettings) can leave the
// drawing buffer far smaller and the compositor will upscale it, so the
// picture is soft while every stated reading is green. That is the mop-strand
// fault wearing a resolution costume.
//
// So the headline number here is the DRAWING BUFFER — the canvas's backing
// store — reported against the window's physical size, with the shortfall
// named in pixels and per cent.
//
// The negative control is delivered by the MARKER FILE (fw-fake-display.txt),
// not by an env var: main.cjs records that env never crosses the QA launcher
// into the main process (logged fault 54). The caller writes the marker, runs,
// and deletes it; this driver reports `qaFakeDisplay` back so a stale marker
// announces itself instead of quietly poisoning a real leg (fault 53).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a5-window.js --clubhouse=pine-hills-v2
//   A5_TAG=fake  ... (with fw-fake-display.txt written first)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const TAG = process.env.A5_TAG || 'real';
  const OUT = path.resolve('qa/electron/a5-window');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: TAG, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // NOTHING here calls setViewportSize. The whole point is what the window does
  // on its own, unassisted, exactly as the owner launches it.
  const app = page.electronApp;
  out.window = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const display = screen.getDisplayMatching(win.getBounds());
    const content = win.getContentBounds();
    const scale = display.scaleFactor || 1;
    return {
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
      contentDip: { width: content.width, height: content.height },
      contentPhysical: {
        width: Math.round(content.width * scale),
        height: Math.round(content.height * scale),
      },
      scaleFactor: scale,
      displaySizeDip: { width: display.size.width, height: display.size.height },
      displayPhysical: {
        width: Math.round(display.size.width * scale),
        height: Math.round(display.size.height * scale),
      },
      workAreaPhysical: {
        width: Math.round(display.workAreaSize.width * scale),
        height: Math.round(display.workAreaSize.height * scale),
      },
      displayCount: screen.getAllDisplays().length,
    };
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // THE NUMBER THE REVIEWERS ASKED FOR. domElement.width/height IS the drawing
  // buffer: what WebGL actually rendered, before the compositor stretched it.
  out.render = await page.evaluate(() => {
    const r = window.__fw?.scene3d?.renderer;
    const c = r?.domElement;
    return {
      devicePixelRatio: window.devicePixelRatio,
      rendererPixelRatio: r?.getPixelRatio?.() ?? null,
      cssSize: { width: c?.clientWidth ?? null, height: c?.clientHeight ?? null },
      drawingBuffer: { width: c?.width ?? null, height: c?.height ?? null },
      innerSize: { width: window.innerWidth, height: window.innerHeight },
      renderScale: window.__fw?.preferences?.values?.display?.renderScale ?? null,
    };
  });

  out.displayInfo = await page.evaluate(
    () => window.fairwayNative?.displayInfo?.().catch(() => null) ?? null,
  );

  const shot = path.join(OUT, `a5-${TAG}-default-camera.png`);
  await page.screenshot({ path: shot });
  out.screenshot = shot;

  // The verdict, stated as the two separate questions it actually is.
  const winPhys = out.window.contentPhysical;
  const buf = out.render.drawingBuffer;
  const wantPhys = out.window.workAreaPhysical;
  const bufPixels = (buf.width || 0) * (buf.height || 0);
  const winPixels = winPhys.width * winPhys.height;
  out.verdict = {
    // 1. is the WINDOW full-window at the display's size? A maximised window's
    //    CONTENT is the work area minus the title bar, so the honest test is
    //    "full width, and within a title bar of the full height" — not equality,
    //    which would fail a window that is doing exactly the right thing.
    windowFillsDisplay: out.window.maximized === true
      && winPhys.width === wantPhys.width
      && winPhys.height <= wantPhys.height
      && winPhys.height >= wantPhys.height - 60,
    titleBarPhysicalPx: wantPhys.height - winPhys.height,
    taskbarPhysicalPx: out.window.displayPhysical.height - wantPhys.height,
    // 2. does the PICTURE have that many pixels, or is it being upscaled?
    bufferMatchesWindow: bufPixels > 0 && Math.abs(buf.width - winPhys.width) <= 2
      && Math.abs(buf.height - winPhys.height) <= 2,
    bufferShortfallPct: bufPixels > 0
      ? +(100 * (1 - bufPixels / winPixels)).toFixed(1) : null,
    qaFakeDisplay: out.displayInfo?.qaFakeDisplay ?? null,
  };
  fs.writeFileSync(path.join(OUT, `a5-${TAG}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`A5[${TAG}]`, JSON.stringify(out.verdict));
  console.log(`A5[${TAG}] window`, JSON.stringify(out.window));
  console.log(`A5[${TAG}] render`, JSON.stringify(out.render));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
