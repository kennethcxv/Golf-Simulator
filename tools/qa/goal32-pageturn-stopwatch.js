// THE FIRST PAGE TURN, TIMED IN PLAY — is anything left, or is it ambient?
//
// The prewarm's ROUND 7 opens the real ledger and turns a real page behind
// the veil. The goal asks what REMAINS on the first played turn: this opens
// the book with the real K key, turns pages with the real E key, and clocks
// every rAF gap — first turn against later turns against the pre-turn idle.
// If the first turn's worst frame sits inside the ambient band, the answer
// is "ambient" and the item stops there.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<seeded> node tools/qa/run-electron.cjs \
//     tools/qa/goal32-pageturn-stopwatch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'pageturn-stopwatch', errs: [], failures: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const cont = [...document.querySelectorAll('button')]
        .find((b) => /\bContinue\b/.test(
          b.querySelector('.menu-action-label')?.textContent || b.textContent || '',
        ));
      return !!(cont && !cont.disabled);
    }, null, { timeout: 90000 });
  }
  const how = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  out.bootPath = how;
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);

  // gap sampler with absolute stamps; marks bracket each turn
  await page.evaluate(() => {
    const T = { gaps: [], marks: {}, before: null };
    window.__pt = T;
    const r = window.__fw.scene3d.renderer;
    T.before = { programs: r.info.programs.length, geometries: r.info.memory.geometries };
    let last = performance.now();
    const pump = () => {
      const now = performance.now();
      T.gaps.push({ t: +now.toFixed(1), g: +(now - last).toFixed(1) });
      last = now;
      if (T.gaps.length < 4800) requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  });

  const mark = (name) => page.evaluate((n) => { window.__pt.marks[n] = performance.now(); }, name);

  await page.waitForTimeout(3000); // ambient idle band, pre-book
  await mark('kAt');
  await page.keyboard.press('k');
  const opened = await page.waitForFunction(
    () => !!window.__fw.scene3d.clubhouse?.()?.ledgerBook?.isOpen?.(),
    null, { timeout: 15000 },
  ).then(() => true).catch(() => false);
  out.ledgerOpened = opened;
  if (!opened) {
    out.failures.push('ledger did not open on K - position may refuse; measurement void');
  } else {
    await page.waitForTimeout(2000); // let the open settle; turns measured alone
    for (let turn = 1; turn <= 4; turn += 1) {
      await mark(`turn${turn}`);
      await page.keyboard.press('e');
      await page.waitForTimeout(1800);
    }
    await mark('done');
  }
  const res = await page.evaluate(() => {
    const T = window.__pt;
    const r = window.__fw.scene3d.renderer;
    const after = { programs: r.info.programs.length, geometries: r.info.memory.geometries };
    const band = (a, b) => {
      const g = T.gaps.filter((s) => s.t >= a && s.t < b).map((s) => s.g);
      if (!g.length) return null;
      const sorted = [...g].sort((x, y) => x - y);
      return {
        frames: g.length,
        median: sorted[Math.floor(g.length / 2)],
        worst: sorted[g.length - 1],
      };
    };
    const m = T.marks;
    return {
      before: T.before,
      after,
      delta: { programs: after.programs - T.before.programs, geometries: after.geometries - T.before.geometries },
      ambient: band(m.kAt - 3000, m.kAt),
      open: band(m.kAt, m.turn1 ?? m.kAt + 4000),
      turn1: m.turn1 ? band(m.turn1, m.turn2 ?? m.turn1 + 1800) : null,
      turn2: m.turn2 ? band(m.turn2, m.turn3 ?? m.turn2 + 1800) : null,
      turn3: m.turn3 ? band(m.turn3, m.turn4 ?? m.turn3 + 1800) : null,
      turn4: m.turn4 ? band(m.turn4, m.done ?? m.turn4 + 1800) : null,
    };
  });
  out.bands = res;
  await page.screenshot({ path: path.join(OUT, 'pageturn-open-book.png') });

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  if (out.failures.length) process.exitCode = 1;
  return out;
}
