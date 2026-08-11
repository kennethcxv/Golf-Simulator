// K (Goal 23) — WHEN MOUSE-LOOK GOES AWAY, DOES THE GAME SAY SO?
//
// "Tab overview forest + silent mouse-look loss." Losing the pointer without
// being told is the worst kind of broken, because the player's next input is
// swallowed and they conclude the game has frozen.
//
// The hint exists (`.shop-lockhint`) and is gated on
// `['walk','placement'].includes(mode) && !document.pointerLockElement`. So the
// question is not whether the code is there — it is whether the hint is ON
// SCREEN at the moments the pointer is actually free.
//
// Three moments, and the CONTROL is the first: with the look held, the hint must
// be ABSENT. A driver that only checks "the hint is visible when unlocked"
// cannot tell a working gate from an element that is simply always there.
//
//   1. LOCKED     look taken            -> hint hidden
//   2. OVERVIEW   Tab pressed           -> (mouse-look is not the verb here)
//   3. BACK       Tab again, on foot    -> hint SHOWN, because the lock is gone
//
// Visibility is read from opacity/display/rect, never elementFromPoint: a
// pointer-events:none HUD layer answers with the canvas beneath it, which is
// how a painted prompt was reported missing in Goal 22.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-k-look-loss.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/k-look-loss');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const read = () => page.evaluate(() => {
    const node = document.querySelector('.shop-lockhint');
    if (!node) return { present: false };
    const cs = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      present: true,
      // opacity/display/rect, never elementFromPoint
      shown: cs.display !== 'none' && cs.visibility !== 'hidden'
        && Number(cs.opacity) > 0.05 && rect.width > 8 && rect.height > 4,
      text: (node.textContent || '').trim().slice(0, 90),
      pointerLocked: !!document.pointerLockElement,
      mode: window.__fw?.mode ?? window.__fw?.screen ?? null,
    };
  });

  // 1. LOCKED — the control. Take the look with a real click and a move.
  await page.mouse.click(700, 400);
  await page.waitForTimeout(400);
  await page.mouse.move(760, 400, { steps: 8 });
  await page.waitForTimeout(600);
  out.locked = await read();

  // 2. OVERVIEW
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1600);
  out.overview = await read();
  out.overviewLegend = await page.evaluate(() => {
    const node = document.querySelector('.hint-bar');
    if (!node) return { present: false };
    const cs = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      present: true,
      shown: cs.display !== 'none' && cs.visibility !== 'hidden'
        && Number(cs.opacity) > 0.05 && rect.width > 8 && rect.height > 4,
      text: (node.textContent || '').trim().slice(0, 120),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'overview.png') });

  // 3. BACK ON FOOT — the pointer is free now and the game must say so
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1800);
  out.back = await read();
  await page.screenshot({ path: path.join(OUT, 'back-on-foot.png') });

  out.checks = {
    hintExists: out.locked.present,
    // CONTROL: with the look held the hint must be ABSENT, or it proves nothing
    hiddenWhileLocked: out.locked.shown === false,
    // THE FINDING: coming back from the overview the pointer is free
    pointerFreeAfterOverview: out.back.pointerLocked === false,
    saysSoAfterOverview: out.back.shown === true,
    // ...and INSIDE the overview, which is where I expected to find the
    // silence and did not. The overview raises its OWN legend (.hint-bar); the
    // walk overlay's hint is hidden there and always was. Reading the wrong
    // element made "no hint" and "a hint I was not looking at" identical --
    // the fifth time this session.
    overviewHasItsOwnLegend: out.overviewLegend?.shown === true,
    overviewLegendNamesTheVerbs: /pan|rotate|zoom|tab/i.test(out.overviewLegend?.text || ''),
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'look-loss.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('K-LOOK', JSON.stringify({ locked: out.locked, overview: out.overview, overviewLegend: out.overviewLegend, back: out.back, checks: out.checks }, null, 2));
  return out;
}
