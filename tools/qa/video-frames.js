async (page) => {
  // Scrub a recorded .webm and save stills — the LOOK step for clip evidence
  // on a machine with no ffmpeg. Chromium plays its own recordings.
  //
  //   VIDEO_SRC=<path.webm> FRAME_TIMES=1.5,4,9 FRAME_OUT=<dir> \
  //     node tools/qa/run-playwright.cjs tools/qa/video-frames.js
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const src = path.resolve(process.env.VIDEO_SRC || '');
  if (!src || !fs.existsSync(src)) throw new Error(`VIDEO_SRC missing: ${src}`);
  const out = path.resolve(process.env.FRAME_OUT || 'qa/video-frames');
  fs.mkdirSync(out, { recursive: true });
  const times = String(process.env.FRAME_TIMES || '1')
    .split(',').map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0);

  await page.setViewportSize({ width: 1600, height: 900 });
  // an about:blank document may not load file:// media, but a file:// document
  // may — stage a sibling page next to the video and navigate to it
  const stage = path.join(path.dirname(src), '__video-frames.html');
  fs.writeFileSync(stage, `<!doctype html><body style="margin:0;background:#000">
    <video id="v" src="${path.basename(src)}" style="width:1600px;height:900px" muted></video></body>`);
  await page.goto(`file:///${stage.replaceAll('\\', '/')}`);
  await page.waitForFunction(() => {
    const video = document.getElementById('v');
    return video && video.readyState >= 2;
  }, null, { timeout: 20000 });
  const duration = await page.evaluate(() => document.getElementById('v').duration);

  const saved = [];
  for (const t of times) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(async (seekTo) => {
      const video = document.getElementById('v');
      video.currentTime = Math.min(seekTo, Math.max(0, (video.duration || seekTo) - 0.05));
      await new Promise((resolve) => {
        video.onseeked = resolve;
        setTimeout(resolve, 3000);
      });
    }, t);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(150);
    const file = path.join(out, `t${String(t).replace('.', '_')}s.png`);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: file });
    saved.push(file);
  }
  fs.rmSync(stage, { force: true });
  return { ok: true, duration, saved };
}
