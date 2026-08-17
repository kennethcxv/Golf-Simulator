// WHICH TWO PROGRAMS DOES THE EDITOR EXIT COMPILE? Keys, not guesses.
//
// The exit's 4.8 s longtask profiles as GL compile machinery. The renderer's
// program cache keys are diffable (first-equip-stall technique): snapshot the
// cacheKey set before J, inside the editor, and after Exit; the exit-only
// keys, diffed field-against-field with their nearest pre-existing neighbour,
// name the material and the state flip that made them novel.
//
//   node tools/qa/run-electron.cjs tools/qa/goal32-exit-program-keys.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'exit-program-keys', errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  const snap = () => page.evaluate(() => {
    const r = window.__fw.scene3d.renderer;
    return r.info.programs.map((p) => String(p.cacheKey));
  });

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);
  const beforeJ = await snap();

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.courseMode === 'editor', null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const inEditor = await snap();

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Exit\s*$/.test((x.textContent || '').trim()));
    b?.click();
  });
  await page.waitForFunction(() => window.__fw.courseMode === 'walk', null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const afterExit = await snap();

  const setB = new Set(beforeJ);
  const setE = new Set(inEditor);
  out.counts = { beforeJ: beforeJ.length, inEditor: inEditor.length, afterExit: afterExit.length };
  out.editorNew = inEditor.filter((k) => !setB.has(k));
  out.exitNew = afterExit.filter((k) => !setE.has(k) && !setB.has(k));

  // nearest-neighbour field diff: cache keys are comma-joined fields
  const diffNearest = (key, pool) => {
    const f = key.split(',');
    let best = null;
    for (const cand of pool) {
      const c = cand.split(',');
      if (c.length !== f.length) continue;
      const diffs = [];
      for (let i = 0; i < f.length; i += 1) if (f[i] !== c[i]) diffs.push({ i, novel: f[i], neighbour: c[i] });
      if (!best || diffs.length < best.diffs.length) best = { candidate: cand.slice(0, 80), diffs };
      if (best.diffs.length <= 3) break;
    }
    return best ? { fieldsDiffering: best.diffs.length, diffs: best.diffs.slice(0, 12) } : null;
  };
  out.exitNewDiffs = out.exitNew.map((k) => ({ key: k.slice(0, 120), vsNearest: diffNearest(k, beforeJ) }));

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
