// IS IT THE APP, OR IS IT THIS MACHINE?
//
// The boot ledger measured every warm stage at a metronomic 1005 ms per frame
// with document.visibilityState 'visible' and document.hasFocus() true. That is
// Chromium's throttled BeginFrame rate, and if it is in force it multiplies the
// boot by sixty while looking exactly like slow compiles.
//
// So measure the cadence itself, in three places that have nothing to do with
// the warms: on the MENU before any scene exists, right after the scene is
// alive, and again after the veil. A menu that already runs at 1 Hz is a
// machine fact and no change to the warm loops can fix it; a menu at 60 Hz with
// warms at 1 Hz would mean the app is doing it to itself.
//
//   node tools/qa/run-electron.cjs tools/qa/raf-cadence-probe.js --clubhouse=pine-hills-v2
async (page, electronApp) => {
  const sample = async (label, ms) => {
    const out = await page.evaluate((duration) => new Promise((resolve) => {
      const gaps = [];
      let last = 0;
      const t0 = performance.now();
      const tick = (t) => {
        if (last) gaps.push(+(t - last).toFixed(1));
        last = t;
        if (performance.now() - t0 < duration) requestAnimationFrame(tick);
        else {
          const s = gaps.slice().sort((a, b) => a - b);
          resolve({
            frames: gaps.length,
            medianGapMs: s.length ? s[Math.floor(s.length / 2)] : null,
            minGapMs: s[0] ?? null,
            maxGapMs: s[s.length - 1] ?? null,
            visibility: document.visibilityState,
            focused: document.hasFocus ? document.hasFocus() : null,
          });
        }
      };
      requestAnimationFrame(tick);
    }), ms);
    return Object.assign({ where: label }, out);
  };

  // The window as the MAIN process sees it: Chromium's own occlusion verdict,
  // which is the thing document.visibilityState does not report.
  const windowState = async () => {
    const app = electronApp || page?.electronApp || null;
    if (!app) return { error: 'no electronApp handle' };
    try {
      return await app.evaluate(({ BrowserWindow, screen, powerMonitor }) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w) return { error: 'no window' };
        const b = w.getBounds();
        const displays = screen.getAllDisplays().map((d) => ({
          bounds: d.bounds, scale: d.scaleFactor, internal: d.internal,
        }));
        return {
          visible: w.isVisible(),
          minimized: w.isMinimized(),
          focused: w.isFocused(),
          alwaysOnTop: w.isAlwaysOnTop(),
          bounds: b,
          backgroundThrottling: w.webContents.backgroundThrottling,
          displays,
          screenLocked: (() => {
            try { return powerMonitor.getSystemIdleState(5); } catch { return 'unknown'; }
          })(),
        };
      });
    } catch (e) {
      return { error: String(e && e.message) };
    }
  };

  const onMenu = await sample('menu (no scene yet)', 4000);
  const winBefore = await windowState();

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d, null, { timeout: 120000 });
  const onLoad = await sample('scene alive, veil up', 4000);

  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 300000 });
  } catch { /* reported by the sample below either way */ }
  await page.waitForTimeout(1500);
  const inPlay = await sample('in play, veil gone', 4000);
  const winAfter = await windowState();

  return {
    verdict: onMenu.medianGapMs > 500
      ? 'THE MACHINE: rAF is throttled before the app does anything'
      : (inPlay.medianGapMs > 500 ? 'THE APP or its window state, not the menu' : 'no throttle seen'),
    samples: [onMenu, onLoad, inPlay],
    windowBefore: winBefore,
    windowAfter: winAfter,
  };
}
