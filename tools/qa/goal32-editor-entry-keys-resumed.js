// WHICH PROGRAMS DOES J COMPILE ON THE OWNER'S RESUMED SAVE? Keys again.
//
// Fresh world: 27 ms flip, zero compiles. His save: 2,094 ms flip, +12
// programs. Diff the novel keys' fields against nearest neighbours to name
// the axis (light census / packed bits / custom shader tag).
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<seeded> node tools/qa/run-electron.cjs \
//     tools/qa/goal32-editor-entry-keys-resumed.js --clubhouse=pine-hills-v2
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
  await page.waitForTimeout(6000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);

  const snap = () => page.evaluate(() => {
    const r = window.__fw.scene3d.renderer;
    return r.info.programs.map((p) => String(p.cacheKey));
  });
  const before = await snap();
  const t0 = Date.now();
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.courseMode === 'editor', null, { timeout: 30000 });
  out.flipWallMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  const after = await snap();

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
      for (let i = 0; i < f.length; i += 1) if (f[i] !== c[i]) diffs.push({ i, novel: f[i].slice(0, 50), neighbour: c[i].slice(0, 50) });
      if (!best || diffs.length < best.diffs.length) best = { diffs };
      if (best.diffs.length <= 2) break;
    }
    return best ? { fieldsDiffering: best.diffs.length, diffs: best.diffs.slice(0, 8) } : null;
  };
  out.novel = novel.map((k) => ({ head: k.slice(0, 46), vsNearest: diffNearest(k, before) }));
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'editor-entry-keys-resumed.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
