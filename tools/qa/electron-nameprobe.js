// throwaway probe #5 (D2 tofu check): render the settings page in zh-Hans
// and ja and screenshot both — real glyphs vs box-tofu is judged on the
// frames, since coverage counts keys and DOM asserts can't see fonts.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d2-tofu');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.bringToFront().catch(() => {});
  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 8000 });
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.pause-panel button')]
      .find((b) => /settings/i.test(b.textContent));
    nav?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 8000 });
  const shots = [];
  for (const locale of ['zh-Hans', 'ja', 'ko', 'ru']) {
    await page.evaluate((l) => window.__fw.preferences.set('locale', l), locale);
    await page.waitForTimeout(500);
    const shot = `settings-${locale}.png`;
    await page.screenshot({ path: path.join(OUT, shot) });
    shots.push(shot);
  }
  await page.evaluate(() => window.__fw.preferences.set('locale', 'en'));
  return { ok: true, shots };
}
