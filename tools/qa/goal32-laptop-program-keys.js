// WHICH PROGRAMS DOES THE LAPTOP OPEN COMPILE ON A RESUMED SAVE? Keys.
//
// Owner-shape profile (seeded save, real Continue): open carries a 2.1 s
// longtask that profiles as getProgramInfoLog — compile wait. Snapshot the
// program cache keys before and after the open; diff the novel ones against
// their nearest pre-existing neighbour, field by field.
//
//   QA_ELECTRON_USER_DATA_DIR=<seeded> node tools/qa/run-electron.cjs \
//     tools/qa/goal32-laptop-program-keys.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await page.waitForFunction(() => {
    const cont = [...document.querySelectorAll('button')]
      .find((b) => /\bContinue\b/.test(
        b.querySelector('.menu-action-label')?.textContent || b.textContent || '',
      ));
    return !!(cont && !cont.disabled);
  }, null, { timeout: 90000 });
  const how = await boot.clickThroughMenu(page, {});
  if (how !== 'continue') throw new Error(`did not resume: ${how}`);
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
  const before = await snap();
  await page.evaluate(() => { window.__fw.scene3d.walk.hooks.openLaptop?.(null); });
  await page.waitForFunction(() => document.body.classList.contains('laptop-mode'), null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  const after = await snap();

  out.warm = await page.evaluate(() => window.__fwWarm || null);
  const setB = new Set(before);
  out.counts = { before: before.length, after: after.length };
  const novel = after.filter((k) => !setB.has(k));
  const diffNearest = (key, pool) => {
    const f = key.split(',');
    let best = null;
    for (const cand of pool) {
      const c = cand.split(',');
      if (c.length !== f.length) continue;
      const diffs = [];
      for (let i = 0; i < f.length; i += 1) if (f[i] !== c[i]) diffs.push({ i, novel: f[i].slice(0, 60), neighbour: c[i].slice(0, 60) });
      if (!best || diffs.length < best.diffs.length) best = { diffs };
      if (best.diffs.length <= 2) break;
    }
    return best ? { fieldsDiffering: best.diffs.length, diffs: best.diffs.slice(0, 10) } : null;
  };
  out.novel = novel.map((k) => ({
    head: k.slice(0, 60),
    onBeforeCompileTail: k.length > 400 ? `...${k.slice(-160)}` : null,
    vsNearest: diffNearest(k, before),
  }));
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'laptop-program-keys.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
