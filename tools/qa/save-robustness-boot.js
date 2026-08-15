// N4 — one boot against whatever save state the WRAPPER just planted.
//
// The wrapper (bash) writes a specific corruption into the REAL userData saves
// dir, launches this, and reads the verdict; the driver itself only reports
// what the menu did with it:
//   - did the renderer throw? (pageerror list)
//   - is the menu up, and is Continue enabled or disabled?
//   - if Continue is enabled: click it — does a game boot, and from WHICH
//     source (the loader's own recovery notice text carries it)?
// The per-case EXPECTATION lives in the wrapper, next to the corruption it
// planted — the driver cannot pass a case by not knowing what it was.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/save-robustness');
  fs.mkdirSync(OUT, { recursive: true });
  const CASE = process.env.SAVE_CASE || 'unnamed';

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  // straight to the menu — do NOT click through it; the menu's own reading of
  // the planted save is the thing under test
  await page.waitForFunction(() => !!document.querySelector('.menu-screen'), null, { timeout: 240000 })
    .catch(() => {});
  await page.waitForTimeout(2500);

  const menu = await page.evaluate(() => {
    const root = document.querySelector('.menu-screen');
    const buttons = root ? [...root.querySelectorAll('button')] : [];
    const find = (re) => buttons.find((b) => re.test(b.textContent || ''));
    const cont = find(/continue/i);
    return {
      menuUp: !!root,
      continuePresent: !!cont,
      continueDisabled: cont ? cont.disabled || cont.getAttribute('aria-disabled') === 'true' : null,
      continueText: cont ? cont.textContent.trim() : null,
      bodyHasCrashVeil: [...document.querySelectorAll('div')]
        .some((n) => n.textContent && n.textContent.includes('The game hit a problem') && n.offsetParent !== null),
    };
  });
  await page.screenshot({ path: path.join(OUT, `menu-${CASE}.png`) });

  let boot = { attempted: false };
  if (menu.continuePresent && menu.continueDisabled === false) {
    await page.evaluate(() => {
      const root = document.querySelector('.menu-screen');
      [...root.querySelectorAll('button')].find((b) => /continue/i.test(b.textContent || ''))?.click();
    });
    const booted = await page.waitForFunction(
      () => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 180000 },
    ).then(() => true).catch(() => false);
    await page.waitForTimeout(1200);
    const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast, .notify, [class*=toast]')]
      .map((n) => n.textContent.trim()).filter(Boolean).slice(0, 6));
    boot = { attempted: true, booted, toasts };
    await page.screenshot({ path: path.join(OUT, `boot-${CASE}.png`) });
  }

  const out = { case: CASE, menu, boot, errs: errs.slice(0, 10) };
  fs.writeFileSync(path.join(OUT, `case-${CASE}.json`), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
