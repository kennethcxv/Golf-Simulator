// A1 — WHAT IN THE FRAME IS PATCHABLE FROM OUTSIDE?
//
// ~15 of invariant 1's 23 indoor points are unattributed, and the only large
// part of the frame never measured is the game update. courseScene has no
// per-subsystem timing hook, and adding one means editing the render loop of a
// hot shared file — so before doing that, find out how much of the update is
// reachable as a function property on an object a driver can already hold.
//
// `renderer.render` was patchable and gave the render/logic split for free. This
// asks the same question of every update-shaped function on the scene, the walk
// and the clubhouse: enumerate them, report their names, and report which are
// OWN properties (patchable) versus prototype methods.
//
// A LISTING, NOT A CHANGE. This driver measures nothing and patches nothing. It
// exists so the next step is chosen from what is actually there instead of from
// what seemed likely.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-update-probe.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-update-probe');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(5000);

  out.surface = await page.evaluate(() => {
    const s3 = window.__fw?.scene3d;
    const ch = s3?.clubhouse?.();
    const roots = {
      scene3d: s3,
      walk: s3?.walk,
      clubhouse: ch,
      post: s3?.post,
    };
    const result = {};
    for (const [name, obj] of Object.entries(roots)) {
      if (!obj) { result[name] = null; continue; }
      const fns = [];
      for (const k of Object.keys(obj)) {
        let v;
        try { v = obj[k]; } catch { continue; }
        if (typeof v === 'function') fns.push(k);
      }
      result[name] = {
        totalKeys: Object.keys(obj).length,
        functions: fns.length,
        // The ones that look like per-frame work.
        updateShaped: fns.filter((k) => /update|tick|step|frame|animate|render|sim/i.test(k)),
        // Everything, truncated, so a name nobody guessed is still visible.
        sample: fns.slice(0, 60),
      };
    }
    return result;
  }).catch((e) => ({ threw: String(e && e.message) }));

  fs.writeFileSync(path.join(OUT, 'a1-update-probe.json'), `${JSON.stringify(out, null, 2)}\n`);
  for (const [name, info] of Object.entries(out.surface || {})) {
    if (!info) { console.log(`  ${name}: MISSING`); continue; }
    console.log(`  ${name}: ${info.functions} fns of ${info.totalKeys} keys`);
    console.log(`     update-shaped: ${JSON.stringify(info.updateShaped)}`);
  }
  return out;
}
