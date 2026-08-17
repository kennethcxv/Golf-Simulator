// THE VSYNC CONTROL — is this machine even able to present frames right now?
//
// Every leg of the first A1 run reported ~1 fps with a ~1,036 ms p99. That is
// not a game measurement, it is Chromium's throttle: a window it believes is
// occluded gets rAF at ~1 Hz. A previous night lost two runs to the same
// signature and mis-attributed it to the display being asleep.
//
// So this is the cheapest possible instrument, and it runs BEFORE the world
// loads: sample rAF on the menu for four seconds and report the median gap.
//   ~4.2 ms   -> presenting at the panel's 240 Hz
//   ~8.3 ms   -> half rate
//   ~1000 ms  -> throttled; every timing number taken in this state is void
//
// Run it bare, then again with the occlusion switches, and the pair is the
// red/green for the harness fix:
//   node tools/qa/run-electron.cjs tools/qa/goal33-vsync-control.js
//   node tools/qa/run-electron.cjs tools/qa/goal33-vsync-control.js \
//     --disable-features=CalculateNativeWinOcclusion \
//     --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
async (page) => {
  const out = { tag: process.env.QA_TAG || 'vsync-control' };
  await page.waitForTimeout(3000);
  await page.bringToFront().catch(() => {});

  out.windowState = await page.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win) return null;
    return {
      visible: win.isVisible(),
      focused: win.isFocused(),
      minimized: win.isMinimized(),
      maximized: win.isMaximized(),
      alwaysOnTop: win.isAlwaysOnTop(),
      bounds: win.getBounds(),
      backgroundThrottling: win.webContents.getBackgroundThrottling?.() ?? null,
    };
  });

  const sample = async (label) => {
    const r = await page.evaluate(() => new Promise((resolve) => {
      const gaps = [];
      let last = performance.now();
      const t0 = last;
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        if (now - t0 < 4000) requestAnimationFrame(tick);
        else resolve({
          gaps,
          visibility: document.visibilityState,
          hidden: document.hidden,
          hasFocus: document.hasFocus(),
          booted: !!window.__fw,
        });
      };
      requestAnimationFrame(tick);
    }));
    const xs = r.gaps.slice(1).sort((a, b) => a - b);
    return {
      label,
      frames: xs.length,
      medianMs: xs.length ? +xs[xs.length >> 1].toFixed(2) : null,
      minMs: xs.length ? +xs[0].toFixed(2) : null,
      maxMs: xs.length ? +xs[xs.length - 1].toFixed(2) : null,
      impliedHz: xs.length ? +(1000 / xs[xs.length >> 1]).toFixed(1) : null,
      visibility: r.visibility,
      hidden: r.hidden,
      hasFocus: r.hasFocus,
      booted: r.booted,
    };
  };

  out.onMenu = await sample('menu');
  console.log('VSYNC', JSON.stringify(out, null, 2));
  return out;
}
