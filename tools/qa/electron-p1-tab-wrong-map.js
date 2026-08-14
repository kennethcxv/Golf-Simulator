// P1 (Goal 25 round 2) — "TAB LOADS THE WRONG MAP FIRST."
//
// The owner: "Tab takes 3-5 seconds, and for about a second it shows the
// CLEANING TOOLS TEST MAP before my grey one. Something is building or rendering
// a different clubhouse variant on the way in."
//
// THE FIRST VERSION OF THIS DRIVER MEASURED ITSELF. It took a screenshot per
// sample and reported "2.07 s to reach overview, 4.24 s to settle" -- but a 4K
// screenshot costs ~2.2 s, so sample 00 landed at 2068 ms and the entire
// transition had already finished before the first reading. Those numbers were
// the shutter speed, not the game.
//
// So timing is taken INSIDE the page on a requestAnimationFrame loop, which
// costs a fraction of a millisecond per frame and can actually resolve a
// one-second event, and the pictures come from the video recording instead:
//
//   VIDEO_DIR=qa/tab-map node tools/qa/run-electron.cjs \
//     tools/qa/electron-p1-tab-wrong-map.js --clubhouse=pine-hills-v2
//
// then extract frames with the ffmpeg tile pattern in tools/qa/clip-frames.mjs
// and LOOK at them. A number cannot tell me which map was on screen.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-tab-map');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(800);

  // INSIDE THE ROOM, WHICH IS WHERE HE IS. The first run of this driver pressed
  // Tab from the spawn point OUTSIDE the clubhouse, looking at the porch, and
  // the transition went straight to the course with nothing wrong in between.
  // That is a true statement about a place the owner was not standing. He is in
  // the grey room when he presses Tab, so the probe has to be too.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    w.x = c.x; w.z = c.z; w.vx = 0; w.vz = 0;
  });
  await page.waitForTimeout(2500);

  const census = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let visibleMeshes = 0;
    const dirtNames = new Set();
    s3.scene?.traverseVisible?.((o) => {
      if (!o.isMesh) return;
      visibleMeshes += 1;
      const n = String(o.name || '');
      if (/dirt|pile|reveal|pillar|sense|debris|marker/i.test(n) && dirtNames.size < 14) dirtNames.add(n);
    });
    return {
      courseMode: window.__fw?.courseMode ?? null,
      visibleMeshes,
      dirtNames: [...dirtNames],
      drawCalls: s3.renderer?.info?.render?.calls ?? null,
    };
  });
  out.beforeTab = await census();

  // ---- THE IN-PAGE RECORDER ------------------------------------------------
  // Per rendered frame: the mode flag, the renderer's own draw/triangle counts,
  // and the frame duration. Nothing here traverses the scene -- that costs
  // milliseconds and would itself become the thing being measured.
  await page.evaluate(() => {
    window.__tab = [];
    window.__tabStop = false;
    let last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      const info = window.__fw?.scene3d?.renderer?.info;
      window.__tab.push({
        ms: +(now - t0).toFixed(1),
        dt: +(now - last).toFixed(1),
        mode: window.__fw?.courseMode ?? null,
        calls: info?.render?.calls ?? null,
        tris: info?.render?.triangles ?? null,
      });
      last = now;
      if (!window.__tabStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.waitForTimeout(400);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(5000);
  // THE RETURN LEG. His round-3 wording is "clicking tab then tab again", and
  // every earlier version of this driver only ever pressed Tab ONCE -- a true
  // measurement of the half of the round trip he was not complaining about.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(9000);
  const trace = await page.evaluate(() => {
    window.__tabStop = true;
    return window.__tab;
  });
  out.afterTab = await census();

  // Where the Tab press lands in the trace: the frame the mode flag changes.
  const flipIndex = trace.findIndex((f) => f.mode === 'overview');
  const backIndex = trace.findIndex((f, i) => i > flipIndex && f.mode === 'walk');
  const back = backIndex >= 0 ? trace[backIndex] : null;
  const flip = flipIndex >= 0 ? trace[flipIndex] : null;
  // "Settled" = draw calls stop moving for 30 consecutive frames (~0.5 s).
  let settled = null;
  for (let i = flipIndex + 1; i >= 0 && i < trace.length - 30; i += 1) {
    const w = trace.slice(i, i + 30).map((f) => f.calls);
    if (w.every((c) => c != null && Math.abs(c - w[0]) <= 2)) { settled = trace[i]; break; }
  }
  const longFrames = trace.filter((f) => f.dt > 100).map((f) => ({ ms: f.ms, dt: f.dt, mode: f.mode }));

  out.trace = trace;
  out.summary = {
    framesRecorded: trace.length,
    msFromTabToModeFlip: flip ? +(flip.ms - (trace[Math.max(0, flipIndex - 1)]?.ms ?? flip.ms)).toFixed(1) : null,
    modeFlipAtMs: flip?.ms ?? null,
    settledAtMs: settled?.ms ?? null,
    msFlipToSettled: flip && settled ? +(settled.ms - flip.ms).toFixed(1) : null,
    returnedToWalkAtMs: back?.ms ?? null,
    longestFrameOnReturn: backIndex >= 0
      ? trace.slice(backIndex, backIndex + 120).reduce((m, f) => Math.max(m, f.dt), 0) : null,
    framesOver100ms: longFrames.length,
    longestFrameMs: trace.reduce((m, f) => Math.max(m, f.dt), 0),
    longFrames: longFrames.slice(0, 12),
    drawCallsBefore: out.beforeTab.drawCalls,
    drawCallsAfter: out.afterTab.drawCalls,
    visibleMeshesBefore: out.beforeTab.visibleMeshes,
    visibleMeshesAfter: out.afterTab.visibleMeshes,
    dirtNamesBefore: out.beforeTab.dirtNames,
    dirtNamesAfter: out.afterTab.dirtNames,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'tab.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-TAB-MAP', JSON.stringify(out.summary, null, 2));
  return out;
}
