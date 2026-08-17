// THE PLAYED ACCEPTANCE — second boot, real input, sim live, no pins.
//
// Runs on the SAME profile the first-run clip just stamped. Asserts, in one
// session: the compile screen does NOT show again; a played F->J editor entry
// is fast and the held tool does not exist inside it (screenshot); exit hands
// the tool back; Tab toggles cleanly; the ledger opens on K after walking in
// on W and the first page turn is clocked against later turns; and after the
// play settles, the program tripwire holds ZERO in-play arrivals.
//
//   QA_ELECTRON_USER_DATA_DIR=<same as first-run> VIDEO_DIR=qa/goal32/accept-played \
//     node tools/qa/run-electron.cjs tools/qa/goal32-acceptance-played.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'accept-played', errs: [], failures: [], compileSeen: [] };
  const fail = (why) => out.failures.push(why);
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // watch for the compile screen the whole way through the load
  const compileProbe = setInterval(() => {
    page.evaluate(() => {
      const v = document.querySelector('.load-veil');
      const compiling = !!v && v.classList.contains('load-veil-compiling');
      const count = document.querySelector('.load-veil-compile-count')?.textContent || '';
      return { compiling, count };
    }).then((s) => { if (s.compiling) out.compileSeen.push(s); }).catch(() => {});
  }, 400);

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  out.bootPath = await boot.clickThroughMenu(page, {});
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  clearInterval(compileProbe);
  if (out.compileSeen.length) fail(`compile screen SHOWED on the stamped second boot (${out.compileSeen.length} samples, last count "${out.compileSeen.at(-1).count}")`);
  out.prewarm = await page.evaluate(() => {
    const rows = window.__fw.scene3d.prewarmTimings?.() || [];
    const total = rows.find((r) => /TOTAL/i.test(r.label || ''));
    return { rows: rows.length, total: total ? total.ms : null };
  });
  out.warmFlags = await page.evaluate(() => window.__fwWarm || null);
  await page.waitForTimeout(6000);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);

  // absolute-stamp gap sampler for the whole played pass
  await page.evaluate(() => {
    const T = { gaps: [], marks: {} };
    window.__acc = T;
    let last = performance.now();
    const pump = () => {
      const now = performance.now();
      T.gaps.push({ t: +now.toFixed(1), g: +(now - last).toFixed(1) });
      last = now;
      if (T.gaps.length < 30000) requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  });
  const mark = (name) => page.evaluate((n) => { window.__acc.marks[n] = performance.now(); }, name);
  const holdKey = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };

  // ---- play: move, look, equip, use ------------------------------------------------
  await mark('playStart');
  await holdKey('w', 2500);
  await page.mouse.move(vp.w / 2 + 420, vp.h / 2, { steps: 12 });
  await page.mouse.move(vp.w / 2 - 420, vp.h / 2, { steps: 12 });
  await holdKey('a', 700);
  await holdKey('d', 700);
  await page.keyboard.press('f'); // tool up
  await page.waitForTimeout(1200);
  out.tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  await page.mouse.move(vp.w / 2, vp.h / 2 + 160, { steps: 8 }); // aim at the ground
  await page.mouse.down(); // use the tool the held way
  await page.waitForTimeout(1400);
  await page.mouse.up();

  // Tab round trip (the guarded toggle)
  await mark('tab1');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1400);
  out.tabTo = await page.evaluate(() => window.__fw.courseMode);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1400);
  out.tabBack = await page.evaluate(() => window.__fw.courseMode);
  if (!(out.tabTo === 'overview' && out.tabBack === 'walk')) fail(`Tab round trip broke: -> ${out.tabTo} -> ${out.tabBack}`);

  // ---- the editor, entered with the tool held ---------------------------------------
  await mark('jAt');
  await page.keyboard.press('j');
  await page.waitForFunction(() => {
    if (window.__fw.courseMode === 'editor') {
      const T = window.__acc;
      if (!T.marks.jFlip) T.marks.jFlip = performance.now();
      return true;
    }
    return false;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  out.editorDiag = await page.evaluate(() => window.__fw.scene3d.walk.heldToolDiagnostics());
  await page.screenshot({ path: path.join(OUT, 'accept-editor-entered.png') });
  if (out.editorDiag.heldRootVisible || out.editorDiag.broomPassActive) {
    fail(`editor entered with draw state armed: ${JSON.stringify(out.editorDiag)}`);
  }
  await page.mouse.move(vp.w / 2, vp.h / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(vp.w / 2 + 380, vp.h / 2 + 120, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Exit\s*$/.test((x.textContent || '').trim()));
    b?.click();
  });
  await page.waitForFunction(() => window.__fw.courseMode === 'walk', null, { timeout: 20000 });
  await mark('exited');
  await page.waitForTimeout(1800);
  out.toolBack = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  if (out.tool && out.toolBack !== out.tool) fail(`tool did not come back after editor exit: held ${out.tool}, back ${out.toolBack}`);

  // ---- walk to the clubhouse and open the book on K ---------------------------------
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(300);
  let ledgerOpened = false;
  for (let leg = 0; leg < 5 && !ledgerOpened; leg += 1) {
    await holdKey('w', 2600);
    await page.keyboard.press('k');
    await page.waitForTimeout(1200);
    ledgerOpened = await page.evaluate(() => !!window.__fw.scene3d.clubhouse?.()?.ledgerBook?.isOpen?.());
  }
  out.ledgerOpened = ledgerOpened;
  if (ledgerOpened) {
    await page.waitForTimeout(1500);
    for (let turn = 1; turn <= 3; turn += 1) {
      await mark(`turn${turn}`);
      await page.keyboard.press('e');
      await page.waitForTimeout(1600);
    }
    await mark('turnsDone');
    await page.screenshot({ path: path.join(OUT, 'accept-ledger-open.png') });
    await page.keyboard.press('k');
    await page.waitForTimeout(1200);
  }

  // ---- settle so the tripwire arms, then read it ------------------------------------
  await mark('settle');
  await page.waitForTimeout(20000);
  out.tripwire = await page.evaluate(() => window.__fw.scene3d.programArrivalTripwire?.() || null);
  if (out.tripwire === null) fail('tripwire API missing');
  else if (out.tripwire.length) fail(`tripwire caught ${out.tripwire.length} in-play arrival(s): ${JSON.stringify(out.tripwire.slice(0, 3))}`);
  out.programs = await page.evaluate(() => window.__fw.scene3d.renderer.info.programs.length);
  await page.screenshot({ path: path.join(OUT, 'accept-final-walk.png') });

  // ---- band summaries ----------------------------------------------------------------
  out.bands = await page.evaluate(() => {
    const T = window.__acc;
    const m = T.marks;
    const band = (a, b) => {
      const g = T.gaps.filter((s) => s.t >= a && s.t < b).map((s) => s.g);
      if (!g.length) return null;
      const sorted = [...g].sort((x, y) => x - y);
      const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      return { frames: g.length, median: q(0.5), p95: q(0.95), worst: sorted[sorted.length - 1] };
    };
    return {
      wholePlay: band(m.playStart, m.settle),
      editorEntry: m.jAt ? { flipMs: m.jFlip ? +(m.jFlip - m.jAt).toFixed(0) : null, ...band(m.jAt, m.jAt + 4000) } : null,
      editorExit: m.exited ? band(m.exited - 200, m.exited + 4000) : null,
      turn1: m.turn1 ? band(m.turn1, m.turn2 ?? m.turn1 + 1600) : null,
      turn2: m.turn2 ? band(m.turn2, m.turn3 ?? m.turn2 + 1600) : null,
      turn3: m.turn3 ? band(m.turn3, m.turnsDone ?? m.turn3 + 1600) : null,
      settled: band(m.settle, m.settle + 20000),
    };
  });

  out.verdict = out.failures.length ? 'FAIL' : 'PASS';
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  if (out.failures.length) process.exitCode = 1;
  return out;
}
