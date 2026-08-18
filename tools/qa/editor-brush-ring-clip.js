// THE BRUSH RING FOLLOWING THE CURSOR — as a gesture, not a still.
//
// "It follows the cursor continuously and never disappears." A screenshot
// cannot show that. This drives a slow path with the real mouse: out across the
// fairway, ONTO the tool panel and back off it (the transition the anchor now
// owns), then a held sculpt stroke, which is the one case where the pointer
// must keep the ring even if it leaves the canvas.
//
// It also samples the ring every frame so the report can say the ring was never
// hidden for a single frame instead of describing what the frames ought to show.
//
//   VIDEO_DIR=qa/clips/editor-brush node tools/qa/run-electron.cjs \
//     tools/qa/editor-brush-ring-clip.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  const out = { failures: [] };

  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor'
    && !!document.querySelector('.ced-rail'), null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  // per-frame ring sampler
  await page.evaluate(() => {
    const S = { on: false, frames: [] };
    window.__brush = S;
    const tick = () => {
      if (S.on) {
        const st = window.__fw.scene3d.editorCursorState?.();
        S.frames.push(st?.brush
          ? { t: +performance.now().toFixed(0), x: st.brush.x, z: st.brush.z, r: st.brush.radiusYd }
          : { t: +performance.now().toFixed(0), gone: true });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.evaluate(() => {
    [...document.querySelectorAll('.ced-tool')].find((b) => /terrain/i.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__brush.on = true; window.__brush.frames = []; });

  const panel = await page.evaluate(() => {
    const t = document.querySelector('.ced-tool-panel');
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });

  const glide = async (x0, y0, x1, y1, steps) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.move(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(45);
    }
  };

  const A = { x: Math.round(vp.w * 0.72), y: Math.round(vp.h * 0.30) };
  const B = { x: Math.round(vp.w * 0.40), y: Math.round(vp.h * 0.72) };

  await page.mouse.move(A.x, A.y, { steps: 10 });
  await page.waitForTimeout(900);
  await glide(A.x, A.y, B.x, B.y, 26); // across the course
  await page.waitForTimeout(700);
  await glide(B.x, B.y, panel.x, panel.y, 20); // onto the panel
  await page.waitForTimeout(1200);
  await glide(panel.x, panel.y, A.x, A.y, 24); // back off it
  await page.waitForTimeout(900);

  // a held sculpt stroke — the ring must ride the pointer through the drag
  await page.mouse.move(A.x, A.y);
  await page.mouse.down();
  await glide(A.x, A.y, Math.round(vp.w * 0.55), Math.round(vp.h * 0.55), 16);
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const frames = await page.evaluate(() => {
    window.__brush.on = false;
    return window.__brush.frames;
  });
  const gone = frames.filter((f) => f.gone).length;
  let moved = 0;
  for (let i = 1; i < frames.length; i++) {
    if (!frames[i].gone && !frames[i - 1].gone
      && (frames[i].x !== frames[i - 1].x || frames[i].z !== frames[i - 1].z)) moved += 1;
  }
  out.sampledFrames = frames.length;
  out.framesWithNoRing = gone;
  out.framesWhereItMoved = moved;
  if (gone) out.failures.push(`the ring was absent on ${gone} of ${frames.length} frames`);
  if (moved < 20) out.failures.push(`the ring barely moved (${moved} changes) — it is not following the cursor`);
  console.log(JSON.stringify(out, null, 2));

  // leave without billing the save
  await page.evaluate(() => {
    [...document.querySelectorAll('.ced-top-btn')].find((x) => /exit/i.test(x.textContent || ''))?.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => /discard/i.test(x.textContent || ''))?.click();
  });
  await page.waitForTimeout(2500);
  return out;
}
