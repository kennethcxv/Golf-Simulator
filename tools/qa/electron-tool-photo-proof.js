// PLAYTEST 5, ITEM 6 — PROVE THE PHOTOGRAPH RECIPE BEFORE MODELLING AGAINST IT.
//
// tools/qa/lib/tool-photo.mjs claims it can photograph a held tool reliably. This
// is the check that says so with numbers rather than a picture that happens to
// have worked once: it photographs three tools in a row, across the whole
// deferred-warm-up window, and requires every shot to have been taken with the
// right tool held and a non-zero drawable mesh count.
//
// THE CONTROL: one shot is taken with NO tool. Its drawable count must be zero.
// Without it, "3 of 3 tools photographed" is equally consistent with a helper
// that reports success unconditionally.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-tool-photo-proof.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-photo');
  fs.mkdirSync(OUT, { recursive: true });
  const libPath = `${process.cwd()}/tools/qa/lib/tool-photo.mjs`.replace(/\\/g, '/');
  const { photographTool, drawableCount, setToolPose } = await import(`file:///${libPath}`);
  const out = { errs: [], shots: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);

  // Deliberately started INSIDE the deferred warm-up window, which is when the
  // tool used to be taken away. If the recipe only works after waiting the timer
  // out, it is not a recipe, it is a coincidence.
  for (const tool of ['mop', 'broom', 'vacuum']) {
    // eslint-disable-next-line no-await-in-loop
    const shot = await photographTool(page, tool, path.join(OUT, `held-${tool}.png`));
    out.shots.push({ tool, ...shot });
    console.log('SHOT', JSON.stringify(out.shots[out.shots.length - 1]));
  }

  // ---- CONTROL: no tool held ----------------------------------------------
  await page.evaluate(() => { try { window.__fw.scene3d.walk.setTool(null); } catch { /* bare hands */ } });
  await page.waitForTimeout(3000);
  await setToolPose(page);
  const bare = await drawableCount(page, 'mop');
  await page.screenshot({ path: path.join(OUT, 'held-none.png') });
  out.control = bare;
  console.log('CONTROL(no tool)', JSON.stringify(bare));

  out.verdict = {
    shotsTaken: out.shots.length,
    allHeldTheRightTool: out.shots.every((s) => s.toolAtShot === s.tool),
    allDrewSomething: out.shots.every((s) => s.drawableAtShot > 0),
    drawablePerTool: Object.fromEntries(out.shots.map((s) => [s.tool, `${s.drawableAtShot}/${s.totalMeshes}`])),
    controlDrewNothing: bare.drawable === 0,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('PHOTO-PROOF', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'tool-photo.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
