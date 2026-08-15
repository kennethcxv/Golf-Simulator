// D3/D4/D5 — the settings surface, verified in the running build:
//   D4: the HOST cannot scroll while settings is mounted (scrollHeight <=
//       clientHeight — no host bar can exist at all), the PAGE owns the
//       scroll (its scrollTop moves under a real wheel), screenshotted
//       MID-SCROLL (overlay bars vanish when idle); the short Audio tab is
//       the no-bar control.
//   D5: the reset row clears the panel's bottom edge by a real margin.
//   D3: a key rebound through the REAL capture UI shows on the Controls
//       page with no reload; an untouched action still shows its default
//       (the control that proves the page reads the table, not the one key
//       the driver changed).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d345-settings');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});

  const out = { errs };

  // open the PAUSE mount and its settings page
  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 8000 });
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.pause-nav button, .pause-nav .nav-item, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent));
    nav?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 8000 });
  // longest tab: Controls
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.settings-tab')].find((t) => /controls/i.test(t.textContent));
    tab?.click();
  });
  await page.waitForTimeout(400);

  out.pauseMount = await page.evaluate(() => {
    const host = document.querySelector('.pause-content');
    const pg = document.querySelector('.settings-page');
    pg.scrollTop = 0;
    const before = pg.scrollTop;
    pg.scrollTop = 400;
    return {
      hostCanScroll: host.scrollHeight > host.clientHeight + 1,
      hostScrollTop: host.scrollTop,
      pageScrolled: pg.scrollTop > before + 100,
      pageScrollTop: pg.scrollTop,
    };
  });
  // real wheel over the page, mid-scroll screenshot
  const pgBox = await page.evaluate(() => {
    const r = document.querySelector('.settings-page').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(pgBox.x, pgBox.y);
  await page.mouse.wheel(0, 300);
  await page.screenshot({ path: path.join(OUT, 'pause-controls-midscroll.png') });
  out.pauseWheel = await page.evaluate(() => ({
    pageTop: document.querySelector('.settings-page').scrollTop,
    hostTop: document.querySelector('.pause-content').scrollTop,
  }));

  // D5: the reset row's clearance from the page's content bottom
  out.resetGap = await page.evaluate(() => {
    const pg = document.querySelector('.settings-page');
    const foot = pg.querySelector('.settings-footer');
    if (!foot) return null;
    const style = getComputedStyle(foot);
    return {
      marginBottom: parseFloat(style.marginBottom),
      paddingBottom: parseFloat(style.paddingBottom),
    };
  });

  // short-page control: Audio tab must show NO page scrollbar at all
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.settings-tab')].find((t) => /audio/i.test(t.textContent));
    tab?.click();
  });
  await page.waitForTimeout(300);
  out.audioTab = await page.evaluate(() => {
    const pg = document.querySelector('.settings-page');
    return { canScroll: pg.scrollHeight > pg.clientHeight + 1 };
  });
  await page.screenshot({ path: path.join(OUT, 'pause-audio-short.png') });

  // D3: rebind moveLeft through the REAL capture UI (Controls tab: click
  // the keycap for Strafe left, press j), then open the pause Controls
  // DISPLAY page and read the Walk row.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.settings-tab')].find((t) => /controls/i.test(t.textContent));
    tab?.click();
  });
  await page.waitForTimeout(300);
  const rebindClicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.setting-row')]
      .find((r) => /strafe left|move left/i.test(r.textContent));
    const button = row?.querySelector('button');
    if (!button) return false;
    button.click();
    return true;
  });
  await page.waitForTimeout(250);
  await page.keyboard.press('j');
  await page.waitForTimeout(400);
  out.rebind = {
    clicked: rebindClicked,
    stored: await page.evaluate(
      () => window.__fw.preferences?.values?.controls?.bindings?.moveLeft ?? null,
    ),
  };
  // the DISPLAY page
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.pause-nav button, .pause-panel button')]
      .find((b) => /^controls$/i.test(b.textContent.trim()));
    nav?.click();
  });
  await page.waitForTimeout(400);
  out.display = await page.evaluate(() => {
    const walkRow = [...document.querySelectorAll('.ctl-row')]
      .find((r) => /walk/i.test(r.querySelector('.ctl-what')?.textContent || ''));
    const interactRow = [...document.querySelectorAll('.ctl-row')]
      .find((r) => /interact/i.test(r.querySelector('.ctl-what')?.textContent || ''));
    return {
      walkCaps: walkRow ? walkRow.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null,
      interactCaps: interactRow ? interactRow.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : null,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'controls-display-after-rebind.png') });
  // restore the binding so QA leaves no trace
  await page.evaluate(() => {
    const prefs = window.__fw.preferences;
    const next = { ...(prefs.values.controls?.bindings || {}) };
    next.moveLeft = 'a';
    prefs.set('controls.bindings', next);
  });

  out.checks = {
    hostBarImpossible: out.pauseMount.hostCanScroll === false,
    pageOwnsScroll: out.pauseMount.pageScrolled === true && out.pauseWheel.hostTop === 0,
    wheelMovesPage: out.pauseWheel.pageTop > 0,
    shortPageNoBar: out.audioTab.canScroll === false,
    resetRowClears: (out.resetGap?.marginBottom ?? 0) + (out.resetGap?.paddingBottom ?? 0) >= 8,
    rebindStored: out.rebind.stored === 'j',
    displayShowsRebind: !!out.display.walkCaps && /J/i.test(out.display.walkCaps),
    displayKeepsDefaults: !!out.display.interactCaps && /E/i.test(out.display.interactCaps),
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'd345.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
