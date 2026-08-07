// The Section A verifier's finding: choosing a quality preset left the rows
// BELOW it showing the previous preset's values. Pick Low and the sub-rows
// still read 100%/On/On/On; pick Ultra and they read Low's 65%/Off/Off/Off. The
// preferences were always correct - which is worse, because the panel was
// contradicting the game while being wrong about itself.
//
// This reads the rendered controls after a real change, in both directions, so
// the check fails on the unfixed build the way the verifier's screenshots did.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a4-rows');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(9000);
  await page.bringToFront().catch(() => {});

  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 15000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-nav button, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 15000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-tab')].find((t) => /display/i.test(t.textContent))?.click();
  });
  await page.waitForTimeout(400);

  const readRows = () => page.evaluate(() => {
    const pg = document.querySelector('.settings-page');
    const qualitySel = [...pg.querySelectorAll('select')]
      .find((s) => [...s.options].some((o) => o.value === 'ultra'));
    return {
      quality: qualitySel ? qualitySel.value : null,
      checks: [...pg.querySelectorAll('input[type=checkbox]')].map((c) => c.checked),
      ranges: [...pg.querySelectorAll('input[type=range]')].map((r) => Number(r.value)),
      prefs: JSON.parse(JSON.stringify(window.__fw.preferences.values.display)),
    };
  });

  const pick = async (want) => {
    await page.evaluate((w) => {
      const pg = document.querySelector('.settings-page');
      const sel = [...pg.querySelectorAll('select')]
        .find((s) => [...s.options].some((o) => o.value === 'ultra'));
      sel.value = w;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, want);
    await page.waitForTimeout(900);
    return readRows();
  };

  out.afterLow = await pick('low');
  out.afterUltra = await pick('ultra');

  // The render-scale slider is the clearest tell: Low is 0.65 and Ultra 1.15,
  // so a row that still shows the other preset's number is unmistakable.
  const showsScale = (r) => r.ranges.some((v) => Math.abs(v - r.prefs.renderScale) < 0.001);
  out.verdict = {
    lowSelected: out.afterLow.quality === 'low',
    ultraSelected: out.afterUltra.quality === 'ultra',
    lowRowsMatchPrefs: showsScale(out.afterLow),
    ultraRowsMatchPrefs: showsScale(out.afterUltra),
    lowScalePref: out.afterLow.prefs.renderScale,
    lowScalesShown: out.afterLow.ranges,
    ultraScalePref: out.afterUltra.prefs.renderScale,
    ultraScalesShown: out.afterUltra.ranges,
  };
  await page.screenshot({ path: path.join(OUT, 'a4-rows-ultra.png') });
  fs.writeFileSync(path.join(OUT, 'a4-rows.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A4ROWS', JSON.stringify(out.verdict));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
