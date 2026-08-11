// X3 (Goal 21) — IS THE CURRENT TASK ON SCREEN?
//
// A stranger played for 25 minutes and could not find out what the game wanted
// from them. The objectives card was in the DOM the whole time, and never
// rendered: every gate in its refresh() read `state.tutorial`, while a real new
// game is a CAMPAIGN and takes its current task from campaignView(). A save
// with no tutorial hid the card outright, and tickTutorial sets
// tutorial.complete once the first day is done, which hid it for ever.
//
// The check that would have caught it is the simplest one imaginable and nobody
// had written it: boot a new game, look at the screen, and read the card.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-x3-current-task.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/x3-current-task');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true, mode: process.env.QA_MODE || 'relaxed' });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const readCard = () => page.evaluate(() => {
    const card = document.querySelector('.objectives-card');
    if (!card) return { present: false };
    const style = getComputedStyle(card);
    const rect = card.getBoundingClientRect();
    // THE INSTRUMENT WAS WRONG (Goal 21). This used to read the ELEMENT's own
    // computed style and its rect, and reported visible:true for a card that is
    // demonstrably not on screen — because an ancestor with opacity 0 leaves the
    // child's own computed opacity at 1 and its rect intact. Ask the browser the
    // whole question instead, and name the ancestor that is hiding it, so the
    // next person does not have to guess.
    let hiddenBy = null;
    for (let node = card; node && node !== document.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) <= 0.05) {
        hiddenBy = {
          tag: node.tagName.toLowerCase(),
          cls: node.className || null,
          display: s.display,
          visibility: s.visibility,
          opacity: s.opacity,
          isTheCardItself: node === card,
        };
        break;
      }
    }
    // WHAT IS ACTUALLY AT THAT POINT? checkVisibility answers a CSS question;
    // this answers the compositor's. If the canvas comes back, the card is
    // behind the game and every CSS check in the world will keep saying fine.
    const cx = Math.round(rect.x + rect.width / 2);
    const cy = Math.round(rect.y + rect.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      present: true,
      hiddenBy,
      atItsCentre: top ? { tag: top.tagName.toLowerCase(), cls: String(top.className || '').slice(0, 40), isCardOrChild: card.contains(top) } : null,
      zIndex: getComputedStyle(card).zIndex,
      parentCls: String(card.parentElement?.className || ''),
      // checkVisibility walks the ancestors the way the compositor does
      visible: typeof card.checkVisibility === 'function'
        ? card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : (!hiddenBy && rect.width > 0 && rect.height > 0),
      ownStyleSaysVisible: style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0,
      eyebrow: card.querySelector('.objective-eyebrow')?.textContent || '',
      progress: card.querySelector('.objective-progress')?.textContent || '',
      title: card.querySelector('.objective-title')?.textContent || '',
      hint: card.querySelector('.objective-hint')?.textContent || '',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      campaignEnabled: !!window.__fw?.state?.campaign?.enabled,
      hasTutorial: !!window.__fw?.state?.tutorial,
    };
  });

  const onArrival = await readCard();
  await page.screenshot({ path: path.join(OUT, 'arrival.png') });

  // ...and it must survive the first day completing, which is the flag that
  // used to hide it for the rest of the game
  await page.evaluate(() => {
    const st = window.__fw.state;
    if (st.tutorial) { st.tutorial.complete = true; st.tutorial.step = 99; }
  });
  await page.waitForTimeout(1500);
  const afterFirstDay = await readCard();
  await page.screenshot({ path: path.join(OUT, 'after-first-day-complete.png') });

  const named = (c) => !!(c.title && c.title.trim().length > 3);
  const out = {
    onArrival,
    afterFirstDay,
    errs,
    checks: {
      cardExists: onArrival.present === true,
      cardVisibleOnArrival: onArrival.visible === true,
      // the check that actually catches it: is the CARD what is painted there?
      cardIsWhatIsPainted: onArrival.atItsCentre?.isCardOrChild === true,
      cardNamesATask: named(onArrival),
      progressIsReal: /\d+\s*\/\s*\d+/.test(onArrival.progress || ''),
      // the fault that hid it for ever
      survivesTutorialComplete: afterFirstDay.visible === true && named(afterFirstDay),
      noPageErrors: errs.length === 0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'current-task.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
