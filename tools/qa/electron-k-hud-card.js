// K (Goal 23) — WHAT THE TASK CARD ACTUALLY SAYS, AND HOW MANY TIMES.
//
// "The task card is double-printed." I cannot fix a description; I can look at
// the card. This screenshots the HUD at the state a new player is dropped into
// and reads the card's own DOM back beside it, so "printed twice" becomes a
// count of elements rather than an impression.
//
// The DOM read matters as much as the picture: two nodes with the same text is
// a different defect from one node whose text contains the same sentence twice,
// and they have different fixes.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-k-hud-card.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/k-hud-card');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  out.card = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.objectives-card')];
    const read = (root) => ({
      visible: getComputedStyle(root).display !== 'none',
      eyebrow: root.querySelector('.objective-eyebrow')?.textContent ?? null,
      progress: root.querySelector('.objective-progress')?.textContent ?? null,
      title: root.querySelector('.objective-title')?.textContent ?? null,
      hint: root.querySelector('.objective-hint')?.textContent ?? null,
      rect: (() => { const r = root.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; })(),
    });
    // Anywhere else the same sentence might be printed: toasts, the HUD, the
    // prompt bar. A duplicate across widgets is the likelier reading of
    // "double-printed" than one node repeating itself.
    const titles = cards.map((c) => c.querySelector('.objective-title')?.textContent).filter(Boolean);
    const everywhere = [];
    if (titles.length) {
      const needle = titles[0].trim();
      document.querySelectorAll('body *').forEach((n) => {
        if (n.children.length) return; // leaves only, or every ancestor matches
        const text = (n.textContent || '').trim();
        if (text && text === needle) {
          everywhere.push({ cls: n.className || n.tagName, rect: (() => { const r = n.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)}`; })() });
        }
      });
    }
    return {
      cardCount: cards.length,
      cards: cards.map(read),
      titlePrintedAt: everywhere,
    };
  });

  await page.screenshot({ path: path.join(OUT, 'hud-at-start.png') });
  out.checks = {
    exactlyOneCard: out.card.cardCount === 1,
    // the title appears once on screen, not in two widgets
    titlePrintedOnce: out.card.titlePrintedAt.length <= 1,
    cardHasContent: !!out.card.cards[0]?.title,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'hud-card.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('K-HUD', JSON.stringify(out.card, null, 2));
  console.log('K-HUD-CHECKS', JSON.stringify(out.checks));
  return out;
}
