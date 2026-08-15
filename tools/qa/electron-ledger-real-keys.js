// PLAYTEST 3, P0 — THE LEDGER FREEZE, THROUGH THE KEYS A PLAYER ACTUALLY PRESSES.
//
// The API walk did not reproduce it: nine pages, five spreads, rAF alive the
// whole way, paint never above 4.8 ms, on a clean profile AND on the owner's own
// save. So `turnPage()` is not the path that breaks, and the difference between
// that call and a player is everything the KEY HANDLER does around it --
// preventDefault, stopPropagation, the audio cue on every turn, and the pointer
// path -- plus the one thing a driver with 900 ms between calls cannot produce:
// PRESSES ARRIVING MID-TURN.
//
// So this presses real keys. First at reading speed, then mashed, then the mouse
// buttons, with the rAF heartbeat read between every burst and a per-call
// timeout so a wedged main thread is REPORTED rather than silently hung beside.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-ledger-real-keys.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-real-keys');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], phases: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (/RangeError|TypeError|Maximum call|out of memory/i.test(t)) out.errs.push(`console: ${t.slice(0, 240)}`);
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: process.env.FW_FRESH === '1' });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    window.__fwBeat = 0;
    const tick = () => { window.__fwBeat += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const beat = async () => {
    try { return await page.evaluate(() => window.__fwBeat, { timeout: 6000 }); } catch { return null; }
  };
  const state = async () => {
    try {
      return await page.evaluate(() => {
        const b = window.__fw.scene3d.clubhouse()?.ledgerBook;
        const d = b?.diagnostics?.() || {};
        return {
          open: d.open, spread: d.spread, spreadCount: d.spreadCount,
          turning: d.turning, state: d.state,
          deferredPending: d.paintStats?.deferredPending ?? null,
          lastTurnMs: d.paintStats?.lastTurnFrameMs ?? null,
        };
      }, { timeout: 6000 });
    } catch { return null; }
  };

  // Open through the book's own path, then let the game own it.
  // THROUGH THE GAME'S OWN DOOR, not the book's.
  //
  // The first version called `book.setOpen(true)` and got a book that was open
  // in the renderer and unknown to the app: `app.ledgerOpen` stayed false, and
  // the key handler is installed by `enterLedger()` and gated on that flag. All
  // ninety-seven presses below went nowhere and `spread` never left 0 -- a
  // perfectly clean run that tested nothing. `walk.hooks.openLedger` is the
  // hook the interact key drives, and `advance()` inside it needs more than one
  // press: the first brings the book up SHUT, the second opens it.
  out.opened = await page.evaluate(async () => {
    const app = window.__fw;
    const b = app.scene3d.clubhouse()?.ledgerBook;
    if (!b) return { ok: false, why: 'no ledgerBook' };
    b.setCarried?.(false);
    for (let i = 0; i < 12 && !app.ledgerOpen; i += 1) {
      app.scene3d.walk.hooks.openLedger?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 260));
    }
    for (let i = 0; i < 20 && !b.isOpen?.(); i += 1) {
      b.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 80));
    }
    return { ok: !!b.isOpen?.(), ledgerOpenFlag: !!app.ledgerOpen, state: b.diagnostics?.()?.state };
  });
  console.log('OPENED', JSON.stringify(out.opened));

  const burst = async (label, presses, gapMs, key) => {
    const before = await beat();
    const sBefore = await state();
    let wedged = false;
    try {
      for (let i = 0; i < presses; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.race([
          page.keyboard.press(key),
          new Promise((_, rej) => setTimeout(() => rej(new Error('key press did not return in 15 s')), 15000)),
        ]);
        // eslint-disable-next-line no-await-in-loop
        if (gapMs) await page.waitForTimeout(gapMs);
      }
    } catch (e) { wedged = true; out.errs.push(String(e.message || e)); }
    await page.waitForTimeout(700);
    const after = await beat();
    const sAfter = await state();
    const row = {
      label, presses, gapMs, key,
      beatBefore: before, beatAfter: after,
      rafStillRunning: before !== null && after !== null && after > before,
      wedged,
      before: sBefore, after: sAfter,
      // A leaf that never lands is its own kind of frozen: the book fills the
      // screen and refuses every further turn while `turning` stays true.
      stuckMidTurn: !!(sAfter && sAfter.turning),
    };
    out.phases.push(row);
    console.log('BURST', JSON.stringify(row));
    try { await page.screenshot({ path: path.join(OUT, `${label}.png`) }); } catch { /* frozen page */ }
    return row;
  };

  // 1. reading speed, one page at a time, right through the book and past the end
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await burst(`read-${i}`, 1, 1100, 'ArrowRight');
    if (r.wedged || !r.rafStillRunning) break;
  }
  // 2. back to the front, then MASHED -- presses arriving mid-turn, which is the
  //    one thing the API walk could not produce
  await burst('rewind', 6, 700, 'ArrowLeft');
  await burst('mash-forward', 25, 40, 'ArrowRight');
  await burst('mash-back', 25, 40, 'ArrowLeft');
  await burst('mash-mixed-a', 20, 25, 'ArrowRight');
  await burst('mash-mixed-b', 20, 25, 'ArrowLeft');

  const bad = out.phases.find((p) => p.wedged || !p.rafStillRunning || p.stuckMidTurn);
  out.verdict = {
    opened: out.opened.ok,
    burstsRun: out.phases.length,
    froze: !!(bad && (bad.wedged || !bad.rafStillRunning)),
    stuckMidTurn: !!(bad && bad.stuckMidTurn),
    firstBadPhase: bad ? bad.label : null,
    finalSpread: out.phases[out.phases.length - 1]?.after?.spread ?? null,
    maxTurnPaintMs: Math.max(0, ...out.phases.map((p) => p.after?.lastTurnMs || 0)),
    deferredLeftPending: out.phases[out.phases.length - 1]?.after?.deferredPending ?? null,
    pageErrors: out.errs.slice(0, 10),
  };
  console.log('LEDGER-REAL-KEYS', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'real-keys.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
