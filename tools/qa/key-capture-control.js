async (page) => {
  // SYNTHETIC CONTROL for the ?keydebug=1 capture overlay.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/key-capture-control.js
  //
  // This does NOT prove D works. It proves what a HEALTHY synthetic capture
  // looks like, so a real-hand capture from the same overlay can be diffed
  // against it. That distinction is the whole point of this file: two existing
  // harnesses measured D, both passed, and D still does not strafe in real
  // play â€” so a green synthetic run is evidence about the driver, not about
  // the game under a human hand.
  //
  // Expected (and measured 2026-07-28, chromium, pine-hills-v2): every one of
  // W/A/S/D reaches all four checkpoints â€” window capture, window bubble,
  // walkHeld, and a position delta. If a REAL capture shows D dropping out at
  // any of those four, the stage it drops at names the layer at fault.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const VARIANT = process.env.GREYBOX_VARIANT || 'pine-hills-v2';
  const query = VARIANT === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2&keydebug=1' : '?keydebug=1';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(400);

  const overlayPresent = await page.evaluate(() => !!window.__fwKeyCapture);
  if (!overlayPresent) throw new Error('?keydebug=1 did not start the capture overlay');

  for (const key of ['w', 'a', 's', 'd']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(450);
    await page.keyboard.up(key);
    await page.waitForTimeout(200);
  }

  const report = await page.evaluate(() => JSON.parse(window.__fwKeyCapture.report()));
  const perKey = {};
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    const downs = report.events.filter((e) => e.code === code && e.type === 'keydown');
    perKey[code] = {
      downs: downs.length,
      key: downs[0]?.key ?? null,
      reachedBubble: downs.filter((e) => e.reachedBubble).length,
      inHeld: downs.filter((e) => e.heldHasKey).length,
      moved: downs.filter((e) => (e.movedWithin0ms || 0) > 0.0005).length,
      trusted: downs.filter((e) => e.isTrusted).length,
    };
  }
  const ok = Object.values(perKey).every((r) => (
    r.downs > 0 && r.reachedBubble === r.downs && r.inHeld === r.downs && r.moved === r.downs
  ));
  const out = {
    variant: VARIANT,
    // Stated so nobody reads this file's green as "D works".
    proves: 'the capture overlay instruments all four stages under SYNTHETIC input',
    doesNotProve: 'that a real keyboard press reaches the walker',
    electron: report.electron,
    userAgent: report.userAgent,
    perKey,
    ok,
  };
  fs.writeFileSync(path.join(outDir, 'key-capture-control.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
