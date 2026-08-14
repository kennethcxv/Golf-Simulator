// 7.4 (Goal 26) — THE FIRST PAGE TURN STILL COMPILES ONE PROGRAM.
//
// "One `basic` program still compiles — `LedgerTurningLeafBack`. Diff the
// cacheKey built during the warm against the one built on the turn; the
// difference between those two strings names the condition your warm is not
// reproducing."
//
// That is the whole method, and it is the one that already resolved the
// first-equip stall in this repo: a real frame is TWO passes (shadow, then
// colour), and a warm that draws one of them produces a DIFFERENT cache key
// from the one the real gesture needs. Sixteen `renderer.compile()`
// configurations failed before somebody diffed the strings.
//
// "VERIFY BY THE PROGRAM COUNTER, NOT MILLISECONDS. The ms are noise — the same
// build gave 33 ms and 464 ms for one gesture." So this counts programs.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-ledger-first-turn.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-first-turn');
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
  // AFTER the game is interactive, not at the veil boundary -- 7.4 says so, and
  // the reason is that a burst of compiles at the boundary once coincided with a
  // GPU crash.
  await page.waitForTimeout(8000);

  const programs = () => page.evaluate(() => {
    const list = window.__fw.scene3d.renderer.info.programs || [];
    return list.map((p) => ({ key: p.cacheKey, uses: p.usedTimes, id: p.id }));
  });

  out.beforeWarm = await programs();
  console.log('PROGRAMS BEFORE WARM', out.beforeWarm.length);

  // Whatever warm the book ships with.
  out.warm = await page.evaluate(async () => {
    const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
    if (!book) return { ok: false, why: 'no ledgerBook' };
    const r = book.prewarm ? book.prewarm() : (book.qaPrewarm ? book.qaPrewarm() : null);
    await new Promise((d) => setTimeout(d, 800));
    return { ok: true, report: r || 'no prewarm entry point' };
  });
  console.log('WARM', JSON.stringify(out.warm).slice(0, 400));

  out.afterWarm = await programs();
  console.log('PROGRAMS AFTER WARM', out.afterWarm.length);

  // NOW THE REAL GESTURE: open the book and turn a page for real, on the real
  // render path with real lighting at real resolution.
  out.turned = await page.evaluate(async () => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    book.setCarried?.(false);
    book.setOpen?.(true);
    for (let i = 0; i < 30 && !book.isOpen?.(); i += 1) {
      book.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 60));
    }
    const opened = !!book.isOpen?.();
    const t0 = performance.now();
    const ok = book.turnPage?.(1);
    // let the leaf fly the whole arc: the back face is not on screen until the
    // flip passes 90 degrees, so one frame at one instant warms one face
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => requestAnimationFrame(() => d()));
    }
    return { opened, turned: !!ok, ms: Math.round(performance.now() - t0) };
  });
  console.log('TURNED', JSON.stringify(out.turned));

  out.afterTurn = await programs();
  console.log('PROGRAMS AFTER TURN', out.afterTurn.length);

  const keysAfterWarm = new Set(out.afterWarm.map((p) => p.key));
  out.newOnTurn = out.afterTurn.filter((p) => !keysAfterWarm.has(p.key));
  console.log('NEW PROGRAMS ON THE TURN', out.newOnTurn.length);

  // THE DIFF. For each program compiled by the turn, find the warm-time key it
  // is closest to and print the tokens that differ. That difference is the
  // condition the warm is not reproducing, which is exactly what 7.4 asks for.
  out.diffs = out.newOnTurn.map((np) => {
    const nTok = String(np.key).split(',');
    let best = null;
    for (const wp of out.afterWarm) {
      const wTok = String(wp.key).split(',');
      const shared = nTok.filter((t) => wTok.includes(t)).length;
      if (!best || shared > best.shared) best = { shared, key: wp.key, tok: wTok };
    }
    if (!best) return { newKey: np.key, nearest: null };
    const onlyInTurn = nTok.filter((t) => !best.tok.includes(t));
    const onlyInWarm = best.tok.filter((t) => !nTok.includes(t));
    return {
      newKeyHead: String(np.key).slice(0, 120),
      nearestWarmKeyHead: String(best.key).slice(0, 120),
      sharedTokens: best.shared,
      onlyInTheTurn: onlyInTurn.slice(0, 20),
      onlyInTheWarm: onlyInWarm.slice(0, 20),
    };
  });
  for (const d of out.diffs) console.log('DIFF', JSON.stringify(d, null, 2));

  out.verdict = {
    programsBeforeWarm: out.beforeWarm.length,
    programsAfterWarm: out.afterWarm.length,
    programsAfterTurn: out.afterTurn.length,
    compiledByTheWarm: out.afterWarm.length - out.beforeWarm.length,
    // THE CLAIM 7.4 MAKES: one program still compiles on the first turn
    compiledByTheFirstTurn: out.newOnTurn.length,
    bookOpened: out.turned.opened,
    pageTurned: out.turned.turned,
    // the tokens the warm is not reproducing, which is the answer 7.4 wants
    conditionsTheWarmMisses: out.diffs.map((d) => d.onlyInTheTurn).flat(),
  };
  console.log('LEDGER-FIRST-TURN', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'first-turn.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
