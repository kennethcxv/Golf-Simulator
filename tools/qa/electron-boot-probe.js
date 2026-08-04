// Negative control for run-electron.cjs itself.
//
// Before any Electron result is trusted this has to prove three things:
//   1. the runner reaches gameplay in Electron at all,
//   2. the --clubhouse=pine-hills-v2 flag actually selects the greybox room
//      (a runner that silently ran v1 would make every later screenshot a lie),
//   3. a screenshot taken through the runner is the PLAYER's camera, not a menu.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/boot-probe');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const argv = await page.evaluate(() => ({
    href: location.href,
    baseURI: document.baseURI,
  }));

  const boot = await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);

  const t0 = Date.now();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 240000 });
  const msToWalk = Date.now() - t0;
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, 'gameplay.png') });

  // NOT import('/src/...'). Under file:// a leading slash resolves to the DRIVE
  // ROOT, so every driver in tools/qa that imports by absolute path throws
  // "Failed to fetch dynamically imported module: file:///C:/src/...". This is
  // the one edit that makes a browser driver run in the shipping runtime.
  const variant = await page.evaluate(async () => {
    const mod = await import(new URL('src/data/clubhouseVariant.js', document.baseURI).href);
    const fw = window.__fw;
    return {
      resolved: mod.resolveClubhouseVariant(window),
      sources: mod.clubhouseVariantSources(window),
      devSession: mod.devSessionActive(window),
      layoutVariant: fw?.scene3d?.clubhouse?.variant || null,
      walkActive: !!fw?.scene3d?.walk?.isActive?.(),
      screen: fw?.screen || null,
    };
  });

  return { boot, msToWalk, argv, variant };
}
