// E2 — WHICH ELEMENT ACTUALLY SCROLLS IN SETTINGS, AND WHERE IS ITS BAR?
//
// "The scrollbar is in the wrong place. It wraps the whole panel, so it looks
// like the entire page scrolls when only the movement section does. Put it
// inside the scrolling section and nowhere else."
//
// The stylesheet says `.settings-page { overflow-y: auto }` with the modal and
// its wrapper set to `overflow: hidden`. That is a fact about CSS, not about the
// running panel: it does not say which element ends up scrollable at the shipped
// window size, where the bar renders, or whether the movement section is really
// the only thing overflowing.
//
// Section D cost six wrong explanations reasoned from source rather than from
// behaviour. So this walks the live DOM instead: every element under the settings
// shell whose scrollHeight exceeds clientHeight, with its box, so the answer is
// measured.
//
// THE NEGATIVE CONTROL is built in: the same walk reports elements that are NOT
// scrollable too, and the count of each. A walk that called everything scrollable
// (or nothing) would be visible immediately rather than confirming whatever I
// expected.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e2-settings-scroll.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e2-settings-scroll');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);

  // Open the pause menu, then Settings, through real input.
  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  await page.keyboard.press(keys.pause || 'p');
  await page.waitForTimeout(1200);
  out.settingsOpened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, .menu-item, [role=button]')]
      .find((b) => /settings/i.test(b.textContent || ''));
    if (!btn) return { clicked: false, why: 'no settings button found' };
    btn.click();
    return { clicked: true, label: (btn.textContent || '').trim().slice(0, 40) };
  }).catch((e) => ({ clicked: false, threw: String(e && e.message) }));
  await page.waitForTimeout(1500);

  out.scan = await page.evaluate(() => {
    const shell = document.querySelector('.settings-shell')
      || document.querySelector('[class*=settings]');
    if (!shell) return { found: false };
    const rows = [];
    let checked = 0;
    const walk = (el, depth) => {
      if (depth > 8) return;
      checked += 1;
      const cs = getComputedStyle(el);
      const over = el.scrollHeight - el.clientHeight;
      const r = el.getBoundingClientRect();
      rows.push({
        cls: String(el.className || '').split(' ').slice(0, 2).join('.') || el.tagName,
        overflowY: cs.overflowY,
        scrollable: over > 2 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll'),
        overBy: over,
        x: Math.round(r.left),
        w: Math.round(r.width),
        right: Math.round(r.right),
      });
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(shell, 0);
    const shellBox = shell.getBoundingClientRect();
    return {
      found: true,
      checked,
      shell: { x: Math.round(shellBox.left), w: Math.round(shellBox.width), right: Math.round(shellBox.right) },
      scrollables: rows.filter((r) => r.scrollable),
      // The control: how many were NOT scrollable. If this is 0 the walk is
      // broken, and if `scrollables` is 0 there is nothing to place.
      notScrollable: rows.filter((r) => !r.scrollable).length,
    };
  }).catch((e) => ({ found: false, threw: String(e && e.message) }));

  await page.screenshot({ path: path.join(OUT, 'e2-settings.png') });

  const s = out.scan?.scrollables || [];
  out.verdict = {
    settingsOpened: out.settingsOpened?.clicked ?? null,
    elementsChecked: out.scan?.checked ?? null,
    notScrollable: out.scan?.notScrollable ?? null,
    scrollableCount: s.length,
    scrollables: s.map((r) => `${r.cls} overBy=${r.overBy} x=${r.x} w=${r.w}`),
    shellWidth: out.scan?.shell?.w ?? null,
    // E2's actual question: does the scrolling element span the panel (so its
    // bar reads as the panel's), or is it a section inside it?
    scrollerSpansPanel: s.length === 1 && out.scan?.shell?.w
      ? (s[0].w / out.scan.shell.w) > 0.9 : null,
  };
  fs.writeFileSync(path.join(OUT, 'e2-settings-scroll.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('E2-SCROLL', JSON.stringify(out.verdict));
  return out;
}
