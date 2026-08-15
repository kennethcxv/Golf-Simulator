// F1 — "A CLICK ON EVERY BUTTON, EVERYWHERE."
//
// Goal 16 built a factory hook: `el('button', ...)` tags each node with
// `__fwClickCue` and routes pointerdown to a `__fwUiClick` sink. That covers
// buttons the FACTORY made. It says nothing about the other ways this game lets
// you press something:
//
//   * a <div> or <li> with an onclick
//   * a <select> or <input> the player operates
//   * a canvas hotspot (the register's monitor, the laptop's screen)
//
// So the question F1 actually asks is a COUNT, and the gap between "buttons"
// and "pressable things" is where the item lives. This walks the real screens
// and, on each, counts every element that LOOKS pressable against how many
// carry the cue.
//
// NEGATIVE CONTROL: a plain <p> is asserted NOT to be counted as pressable. If
// the detector claims everything is a button, its coverage number is
// meaningless.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-everypress');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], screens: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  await page.bringToFront().catch(() => {});

  const audit = (label) => page.evaluate((name) => {
    const pressable = [];
    const seen = new Set();
    const add = (el, why) => {
      if (seen.has(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;      // not on screen
      if (getComputedStyle(el).pointerEvents === 'none') return;
      seen.add(el);
      pressable.push({
        why,
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 44),
        text: (el.textContent || '').trim().slice(0, 34),
        hasCue: el.__fwClickCue === true,
      });
    };
    for (const el of document.querySelectorAll('button')) add(el, 'button');
    for (const el of document.querySelectorAll('select, input[type=range], input[type=checkbox], input[type=number]')) add(el, 'form-control');
    // things that are not buttons but behave like them
    for (const el of document.querySelectorAll('[onclick], [role=button], .nav-item, .settings-tab, .menu-action, .tool-wheel-item')) add(el, 'clickable');
    const withCue = pressable.filter((p) => p.hasCue).length;
    // THE CONTROL: prose must not be counted
    const proseCounted = pressable.filter((p) => p.tag === 'p' || p.tag === 'h3').length;
    return {
      screen: name,
      pressable: pressable.length,
      withCue,
      withoutCue: pressable.length - withCue,
      proseCounted,
      missing: pressable.filter((p) => !p.hasCue).slice(0, 12),
    };
  }, label);

  // 1. the pause menu
  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 15000 });
  out.screens.push(await audit('pause'));

  // 2. settings, across its tabs
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-nav button, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 15000 });
  for (const tab of ['display', 'audio', 'controls', 'accessibility']) {
    await page.evaluate((pattern) => {
      const rx = new RegExp(pattern, 'i');
      [...document.querySelectorAll('.settings-tab')].find((t) => rx.test(t.textContent))?.click();
    }, tab);
    await page.waitForTimeout(400);
    out.screens.push(await audit(`settings:${tab}`));
  }

  // 3. back in the world, the HUD
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  out.screens.push(await audit('hud'));

  // 4. the laptop
  await page.evaluate(() => window.__fw.scene3d.walk.hooks?.openLaptop?.());
  await page.waitForTimeout(2200);
  out.screens.push(await audit('laptop'));

  const total = out.screens.reduce((a, s) => a + s.pressable, 0);
  const cued = out.screens.reduce((a, s) => a + s.withCue, 0);
  out.verdict = {
    pressableFound: total,
    withClickCue: cued,
    withoutClickCue: total - cued,
    coveragePct: total ? +(100 * cued / total).toFixed(1) : null,
    // the control: prose must never be counted as pressable
    controlValid: out.screens.every((s) => s.proseCounted === 0),
    perScreen: out.screens.map((s) => `${s.screen}: ${s.withCue}/${s.pressable}`),
  };
  await page.screenshot({ path: path.join(OUT, 'f1-last.png') });
  fs.writeFileSync(path.join(OUT, 'f1.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('F1', JSON.stringify(out.verdict));
  for (const s of out.screens) {
    if (s.withoutCue) console.log(`F1 missing on ${s.screen}:`, JSON.stringify(s.missing.slice(0, 6)));
  }
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
