// F1 (Goal 19) — the settings scrollbar wears the game's clothes.
// Opens the pause menu, Settings, Controls tab (the photographed page), and
// screenshots it; also the Display tab (named in the brief). The judgement
// is by eye on the captures; the driver just gets us there with real clicks.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f1-scrollbar.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-scrollbar');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('p');
  await page.waitForTimeout(800);
  const clickByText = async (text, { rightPane = false } = {}) => {
    const done = await page.evaluate(([t, right]) => {
      const all = [...document.querySelectorAll('button, [role="tab"]')]
        .filter((n) => (n.textContent || '').trim() === t && n.offsetParent);
      // the pause NAV and the settings TAB BAR both say "Controls"; the tab
      // bar lives in the right pane
      const el = right
        ? all.find((n) => n.getBoundingClientRect().left > window.innerWidth * 0.35) || all[all.length - 1]
        : all[0];
      if (el) { el.click(); return true; }
      return false;
    }, [text, rightPane]);
    await page.waitForTimeout(600);
    return done;
  };
  await clickByText('Settings');
  await clickByText('Controls', { rightPane: true });
  await page.screenshot({ path: path.join(OUT, 'controls-tab.png') });
  await clickByText('Display', { rightPane: true });
  await page.screenshot({ path: path.join(OUT, 'display-tab.png') });
  console.log('F1-SCROLLBAR captured');
}
