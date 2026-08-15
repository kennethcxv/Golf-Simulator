// VERIFY-A / A5 leg zero — launch with NO --clubhouse flag (the closest this
// harness can get to the player's own double-click; FW_QA=1 env is still set
// by the runner but main.cjs uses it only to skip a native dialog).
// Question: is the window genuinely maximised at the menu, and does the
// DEFAULT new-game path end with a drawing buffer at window size?
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-a');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const app = page.electronApp;

  const winState = () => app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const display = screen.getDisplayMatching(win.getBounds());
    const content = win.getContentBounds();
    const scale = display.scaleFactor || 1;
    return {
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
      contentPhysical: { width: Math.round(content.width * scale), height: Math.round(content.height * scale) },
      scaleFactor: scale,
      workAreaPhysical: {
        width: Math.round(display.workAreaSize.width * scale),
        height: Math.round(display.workAreaSize.height * scale),
      },
    };
  });

  // at the MENU, before any driver code touches the window
  await page.waitForSelector('button', { timeout: 60000 });
  out.menuWin = await winState();
  await page.screenshot({ path: path.join(OUT, 'va5nf-menu-native.png') });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  out.gameWin = await winState();
  out.buf = await page.evaluate(() => {
    const r = window.__fw?.scene3d?.renderer;
    const c = r?.domElement;
    return {
      dpr: window.devicePixelRatio,
      rendererPixelRatio: r?.getPixelRatio?.() ?? null,
      buffer: { width: c?.width ?? null, height: c?.height ?? null },
      inner: { width: window.innerWidth, height: window.innerHeight },
      renderScale: window.__fw?.preferences?.values?.display?.renderScale ?? null,
      clubhouse: window.__fw?.state?.clubhouseVariant ?? null,
    };
  });
  const bufPx = (out.buf.buffer.width || 0) * (out.buf.buffer.height || 0);
  const winPx = out.gameWin.contentPhysical.width * out.gameWin.contentPhysical.height;
  out.verdict = {
    menuMaximized: out.menuWin.maximized,
    gameMaximized: out.gameWin.maximized,
    contentPhysical: out.gameWin.contentPhysical,
    buffer: out.buf.buffer,
    bufferMatches: bufPx > 0 && Math.abs(out.buf.buffer.width - out.gameWin.contentPhysical.width) <= 2
      && Math.abs(out.buf.buffer.height - out.gameWin.contentPhysical.height) <= 2,
    shortfallPct: bufPx > 0 ? +(100 * (1 - bufPx / winPx)).toFixed(1) : null,
  };
  await page.screenshot({ path: path.join(OUT, 'va5nf-game-native.png') });
  fs.writeFileSync(path.join(OUT, 'va5nf.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('VA5NF', JSON.stringify(out.verdict));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 4)));
  return out;
}
