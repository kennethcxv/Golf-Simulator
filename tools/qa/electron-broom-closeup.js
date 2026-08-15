// PLAYTEST 5, ITEM 6.1 — A FRAME THE HAND CAN ACTUALLY BE JUDGED IN.
//
// The default player camera is the ACCEPTANCE shot and it stays that. But the
// reference photograph is a hand at arm's length filling most of the frame, and
// the acceptance shot puts the same hand small and dark in a corner. Comparing
// those two and concluding anything about proportion is comparing apparent sizes,
// not shapes.
//
// So this takes a supporting exhibit at a NARROW FIELD OF VIEW. Nothing about the
// hand moves; only the lens changes, which magnifies the viewmodel without
// altering a single transform. The FOV is restored afterwards and the acceptance
// shot is taken again from the same run, so the pair can be shown together and
// neither is a substitute for the other.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-hand-closeup.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/broom-closeup');
  fs.mkdirSync(OUT, { recursive: true });
  const libPath = `${process.cwd()}/tools/qa/lib/tool-photo.mjs`.replace(/\\/g, '/');
  const { photographTool, drawableCount, setToolPose, lightTheRoom } = await import(`file:///${libPath}`);
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  // Light the room ONCE, before anything is equipped. The acceptance CAMERA is
  // untouched -- default FOV, default pose. It is the room that changes.
  await lightTheRoom(page);
  await page.waitForTimeout(1500);

  // ACCEPTANCE first, at the default camera, unmodified.
  out.acceptance = await photographTool(page, 'broom', path.join(OUT, 'acceptance-default-camera.png'));
  console.log('ACCEPTANCE', JSON.stringify(out.acceptance));

  // Then the exhibit. Only the lens changes.
  out.exhibit = [];
  for (const fov of [30, 18]) {
    // eslint-disable-next-line no-await-in-loop
    const before = await page.evaluate((f) => {
      const cam = window.__fw.scene3d.camera;
      const was = cam.fov;
      cam.fov = f;
      cam.updateProjectionMatrix();
      return was;
    }, fov);
    // eslint-disable-next-line no-await-in-loop
    await setToolPose(page, { pitch: -0.62 });
    // Re-assert: the exhibit loop re-poses, and a run crossing the deferred
    // warm-up window otherwise photographs an empty hand (drawable 0, tool null).
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => { window.__fw.scene3d.walk.setTool('broom'); });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() === 'broom',
      null, { timeout: 30000 }).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1800);
    // eslint-disable-next-line no-await-in-loop
    const held = await drawableCount(page, 'broom');
    const file = path.join(OUT, `exhibit-fov${fov}.png`);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: file });
    out.exhibit.push({ fov, restoredFrom: before, drawable: held.drawable, tool: held.tool, file });
    console.log('EXHIBIT', JSON.stringify(out.exhibit[out.exhibit.length - 1]));
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((f) => {
      const cam = window.__fw.scene3d.camera;
      cam.fov = f;
      cam.updateProjectionMatrix();
    }, before);
  }

  out.verdict = {
    acceptanceDrawable: out.acceptance.drawableAtShot,
    exhibitsTaken: out.exhibit.length,
    allHeldTheTool: out.exhibit.every((e) => e.tool === 'broom' && e.drawable > 0),
    fovRestored: await page.evaluate(() => window.__fw.scene3d.camera.fov),
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('CLOSEUP', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'broom-closeup.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
