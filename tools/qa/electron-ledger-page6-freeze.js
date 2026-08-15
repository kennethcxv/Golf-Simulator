// PLAYTEST 3, P0 — "TURNING PAGES, I REACHED PAGE 6 AND THE SCREEN FROZE."
//
// A freeze is not an exception. An exception would land in the page-error log
// and the game would carry on with a blank leaf; a FROZEN SCREEN means the main
// thread never returned, so rAF stopped. Those two need different instruments,
// and the one that matters here has to survive the thing it is measuring.
//
// So this drives the book one page at a time and, after each turn, asks a
// question the renderer can only answer IF IT IS STILL RUNNING: has the rAF
// counter advanced? Every call is given a short timeout of its own. When the
// main thread wedges, `evaluate` never resolves -- and a driver without
// per-step timeouts would simply hang beside it and report nothing at all.
//
// The page number the player counts is 1-based and the model is 0-based, so the
// index and the kind are BOTH recorded: "page 6" is only a useful bug report if
// it names which painter was on it, and on a starter book that is `takings`.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-ledger-page6-freeze.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-page6');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], steps: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (/error|Error|freeze|RangeError|TypeError/.test(t)) out.errs.push(`console: ${t.slice(0, 300)}`);
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: process.env.FW_FRESH === '1' });
  // DEFAULT TO *HIS* SAVE. The starter book is 9 pages and its page 6 is
  // `firsts`; a played save paginates the guest register and the notes, so the
  // same folio is a different painter and the freeze may live on a page a clean
  // profile never builds. FW_FRESH=1 forces the clean-profile run for contrast.
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  // A HEARTBEAT THE RENDERER OWNS. Reading it is how "still running" is asked
  // without trusting the same call that would wedge.
  await page.evaluate(() => {
    window.__fwBeat = 0;
    const tick = () => { window.__fwBeat += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  out.opened = await page.evaluate(async () => {
    const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
    if (!book) return { ok: false, why: 'no ledgerBook' };
    book.setCarried?.(false);
    book.setOpen?.(true);
    for (let i = 0; i < 40 && !book.isOpen?.(); i += 1) {
      book.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 60));
    }
    const d = book.diagnostics?.() || {};
    return { ok: !!book.isOpen?.(), spreads: d.spreadCount ?? null, pageCount: d.pageCount ?? null };
  });
  console.log('OPENED', JSON.stringify(out.opened));

  // Name every page BEFORE walking, so a freeze on page 6 can be attributed even
  // if nothing after it ever answers again.
  out.pageMap = await page.evaluate(() => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    return book.diagnostics?.()?.pageKinds ?? { note: 'pageKinds not exposed' };
  });
  console.log('PAGE MAP', JSON.stringify(out.pageMap));

  const beat = async () => {
    try { return await page.evaluate(() => window.__fwBeat, { timeout: 5000 }); } catch { return null; }
  };

  // Walk one spread at a time. `turnPage` moves a SPREAD, so the pages the player
  // counts advance two at a time; both indices are recorded.
  for (let step = 0; step < 10; step += 1) {
    const before = await beat();
    let turned = null;
    let wedged = false;
    try {
      turned = await Promise.race([
        page.evaluate(async () => {
          const book = window.__fw.scene3d.clubhouse().ledgerBook;
          const t0 = performance.now();
          const ok = book.turnPage?.(1);
          await new Promise((d) => setTimeout(d, 900));
          const d = book.diagnostics?.() || {};
          return {
            ok: !!ok,
            spread: d.spread ?? null,
            ms: Math.round(performance.now() - t0),
            paintMs: d.paintStats?.lastTurnFrameMs ?? null,
          };
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate did not return in 25 s')), 25000)),
      ]);
    } catch (e) {
      wedged = true;
      turned = { error: String(e.message || e) };
    }
    await page.waitForTimeout(600);
    const after = await beat();
    const alive = before !== null && after !== null && after > before;
    const row = {
      step,
      turned,
      beatBefore: before,
      beatAfter: after,
      // THE FREEZE TEST. Not "did it throw" -- did the renderer keep drawing.
      rafStillRunning: alive,
      wedged,
    };
    out.steps.push(row);
    console.log('STEP', JSON.stringify(row));
    if (wedged || !alive) {
      console.log('*** FROZE at step', step, '***');
      try { await page.screenshot({ path: path.join(OUT, `frozen-step-${step}.png`) }); } catch { /* a frozen page may refuse */ }
      break;
    }
    try { await page.screenshot({ path: path.join(OUT, `spread-${String(step).padStart(2, '0')}.png`) }); } catch { /* keep walking */ }
  }

  const froze = out.steps.find((s) => s.wedged || !s.rafStillRunning);
  out.verdict = {
    opened: out.opened.ok,
    stepsWalked: out.steps.length,
    froze: !!froze,
    frozeAtStep: froze ? froze.step : null,
    // spread s shows 1-based pages s*2+1 and s*2+2
    frozeShowingPages: froze && froze.turned?.spread != null
      ? [froze.turned.spread * 2 + 1, froze.turned.spread * 2 + 2] : null,
    pageErrors: out.errs.slice(0, 12),
    pageMap: out.pageMap,
  };
  console.log('LEDGER-PAGE6', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'page6.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
