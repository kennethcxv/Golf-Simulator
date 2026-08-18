// THE CURSOR, AS A GESTURE.
//
// The still frames prove the ring is under the pointer at five discrete points.
// They cannot show the thing he actually described — a cursor that does not
// FOLLOW. So this one waits for the stability freeze to arm (the state the
// defect needs), opens the editor, and sweeps the real mouse continuously in a
// wide loop across the course with Terrain selected, then again with Paint.
//
// Record and look:
//   VIDEO_DIR=qa/clips/cursor node tools/qa/run-electron.cjs \
//     tools/qa/editor-cursor-sweep-clip.js --clubhouse=pine-hills-v2
//   node tools/qa/clip-frames.mjs qa/clips/cursor
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);

  // the state the defect needs: fifteen seconds of walk, then the freeze
  const frozen = await page.waitForFunction(
    () => (window.__fw?.scene3d?.matrixFreezeDiagnostics?.()?.stabilityFrozen || 0) > 0
      && window.__fw.scene3d.matrixFreezeDiagnostics(),
    null, { timeout: 120000, polling: 500 },
  ).then((h) => h.jsonValue()).catch(() => null);
  console.log('freeze:', JSON.stringify(frozen));

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor'
    && !!document.querySelector('.ced-rail'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

  const pick = async (re) => {
    await page.evaluate((src) => {
      const rx = new RegExp(src, 'i');
      [...document.querySelectorAll('.ced-tool')].find((b) => rx.test(b.textContent || ''))?.click();
    }, re.source);
    await page.waitForTimeout(1200);
  };

  // A wide slow loop over the open canvas, right of the tool rail. Slow on
  // purpose: at 4 fps extraction a fast sweep gives four frames and no gesture.
  const sweep = async (seconds) => {
    const steps = seconds * 20;
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(vp.w * (0.58 + 0.26 * Math.cos(a)));
      const y = Math.round(vp.h * (0.52 + 0.26 * Math.sin(a)));
      await page.mouse.move(x, y);
      await page.waitForTimeout(50);
    }
  };

  await pick(/terrain/);
  await sweep(9);
  await pick(/paint/);
  await sweep(9);
  await page.waitForTimeout(700);
  console.log('sweep done');
}
