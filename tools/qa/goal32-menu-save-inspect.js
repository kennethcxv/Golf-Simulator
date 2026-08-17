// WHY DOES THE SEEDED PROFILE'S MENU REFUSE TO CONTINUE? Ask the menu.
//
//   QA_ELECTRON_USER_DATA_DIR=<seeded> node tools/qa/run-electron.cjs \
//     tools/qa/goal32-menu-save-inspect.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some((b) => /new game/i.test(b.textContent || '')), null, { timeout: 90000 });
  await page.waitForTimeout(6000); // give the save inspection every chance
  out.menu = await page.evaluate(() => {
    const cont = [...document.querySelectorAll('button')].find((b) => /\bContinue\b/.test(b.textContent || ''));
    const title = document.querySelector('.menu-save-title');
    const detail = document.querySelector('.menu-save-detail');
    return {
      continueDisabled: cont ? cont.disabled : null,
      continueText: cont ? cont.textContent.trim().slice(0, 120) : null,
      saveTitle: title ? title.textContent : null,
      saveDetail: detail ? detail.textContent : null,
      state: document.querySelector('.menu-save-block, [data-state]')?.dataset?.state || null,
    };
  });
  out.inspect = await page.evaluate(async () => {
    const mod = await import('./src/core/storage.js');
    const rec = await mod.inspectData('autosave', {});
    return {
      status: rec?.status ?? null,
      version: rec?.version ?? null,
      bytes: rec?.bytes ?? null,
      error: rec?.error ?? null,
      hasData: !!rec?.data,
      keys: rec?.data ? Object.keys(rec.data).slice(0, 12) : null,
    };
  }).catch((e) => ({ evalFailed: String(e.message || e) }));
  out.native = await page.evaluate(() => ({
    hasNative: !!window.fairwayNative,
    fns: window.fairwayNative ? Object.keys(window.fairwayNative).slice(0, 20) : null,
  }));
  await page.screenshot({ path: path.join(OUT, 'menu-seeded-profile.png') });
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'menu-save-inspect.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
