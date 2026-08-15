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

  await page.screenshot({ path: path.join(OUT, 'e2-settings-tall.png') });

  // THE SECOND SIZE, WHICH IS THE WHOLE POINT.
  //
  // Zero scrollables at one window size is not "E2 is fixed" — it is "the state
  // the complaint describes did not occur here". E2 names the movement section,
  // which only overflows when the panel is short enough to make it. So shrink
  // the viewport and rescan with the identical walk.
  //
  // The tall reading is the control: if the short one also reports zero, the
  // panel never scrolls and the scrollbar cannot be misplaced; if it reports a
  // scroller spanning the panel, that is E2 reproduced and located.
  out.short = { requested: { w: 1280, h: 620 } };
  await page.setViewportSize({ width: 1280, height: 620 }).catch((e) => {
    out.short.resizeThrew = String(e && e.message);
  });
  await page.waitForTimeout(1400);
  out.short.scan = await page.evaluate(() => {
    const shell = document.querySelector('.settings-shell')
      || document.querySelector('[class*=settings]');
    if (!shell) return { found: false };
    const rows = [];
    const walk = (el, depth) => {
      if (depth > 8) return;
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
      });
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(shell, 0);
    const b = shell.getBoundingClientRect();
    return {
      found: true,
      checked: rows.length,
      shell: { x: Math.round(b.left), w: Math.round(b.width) },
      scrollables: rows.filter((r) => r.scrollable),
      notScrollable: rows.filter((r) => !r.scrollable).length,
    };
  }).catch((e) => ({ found: false, threw: String(e && e.message) }));
  await page.screenshot({ path: path.join(OUT, 'e2-settings-short.png') });

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
    shortScrollableCount: (out.short?.scan?.scrollables || []).length,
    shortNotScrollable: out.short?.scan?.notScrollable ?? null,
    shortScrollables: (out.short?.scan?.scrollables || []).map((r) => r.cls + ' overBy=' + r.overBy + ' w=' + r.w),
    shortShellWidth: out.short?.scan?.shell?.w ?? null,
    scrollerSpansPanel: s.length === 1 && out.scan?.shell?.w
      ? (s[0].w / out.scan.shell.w) > 0.9 : null,
    // E2'S ACCEPTANCE, STATED SO IT CAN FAIL.
    //
    // "Put it inside the scrolling section and nowhere else." Measured at the
    // SHORT viewport, because that is the only size where anything scrolls at
    // all: there must be a scroller, it must not be the panel-width page, and
    // its width must be materially narrower than the shell it sits in.
    //
    // On the current build this reads false — the sole scroller is
    // `.settings-page` at 831 px inside an 831 px shell. That is the check
    // watched failing before the fix, which is what the RULES ask for, and it is
    // the same driver that will confirm the fix rather than a different one.
    // CORRECTED BEFORE IT COULD MISLEAD.
    //
    // The first cut also demanded the scroller be under 90% of the shell's
    // width. That would have REJECTED A CORRECT FIX: a settings section spans
    // the page minus its 8 px padding either side — about 98% of the shell — so
    // moving the scroll onto the section, which is exactly what E2 asks for,
    // could never have satisfied a 90% width test.
    //
    // The width was never the complaint. E2's objection is that the bar reads as
    // the PAGE's ("it looks like the entire page scrolls"), and what fixes that
    // is the bar belonging to the section — rendering inside the page's padding
    // rather than at the panel's edge. So the criterion is IDENTITY, not size.
    //
    // Width is still reported, because a scroller that really did span the shell
    // edge-to-edge would be worth seeing; it is just not the pass condition.
    e2Ok: (() => {
      const short = out.short?.scan?.scrollables || [];
      if (!short.length) return false;
      return short.every((r) => !/settings-page/.test(r.cls));
    })(),
  };
  fs.writeFileSync(path.join(OUT, 'e2-settings-scroll.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('E2-SCROLL', JSON.stringify(out.verdict));
  return out;
}
