// GOAL 27 — THE LOAD-IN FIRST MINUTE, FOR THE CLIP STANDARD.
//
// The deferred belt warm now cycles all nine tools through the player's hands
// at ~1.6-2.5 s after the veil lifts. The claim that nothing visibly flashes
// is a claim about MOTION, so it takes a clip with frames viewed, not a
// number. This driver just boots and holds still through the warm window;
// the recording is the artifact.
//
//   VIDEO_DIR=qa/clips/g27-load node tools/qa/run-electron.cjs tools/qa/electron-load-first-minute.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // hold through the deferred warm window and a little beyond
  await page.waitForTimeout(10000);
  const warm = await page.evaluate(() => window.__fwWarm);
  const held = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);
  console.log(`warm state: ${JSON.stringify(warm)}; held after warm: ${JSON.stringify(held)}`);
  return { warm, held };
}
