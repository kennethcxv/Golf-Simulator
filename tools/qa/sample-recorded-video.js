async (page) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const source = process.env.REGISTER_QA_VIDEO;
  const output = process.env.REGISTER_QA_VIDEO_FRAMES;
  const requested = Number(process.env.REGISTER_QA_VIDEO_FRAME_COUNT || 30);
  if (!source || !output) {
    throw new Error('Set REGISTER_QA_VIDEO and REGISTER_QA_VIDEO_FRAMES.');
  }
  const absoluteSource = path.resolve(source);
  const absoluteOutput = path.resolve(output);
  if (!fs.existsSync(absoluteSource)) throw new Error(`Video does not exist: ${absoluteSource}`);
  fs.mkdirSync(absoluteOutput, { recursive: true });

  await page.goto(pathToFileURL(absoluteSource).href);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && Number.isFinite(video.duration) && video.duration > 0;
  }, null, { timeout: 20000 });
  await page.evaluate(() => {
    document.documentElement.style.background = '#111';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    const video = document.querySelector('video');
    video.controls = false;
    video.muted = true;
    video.style.width = '1600px';
    video.style.height = '900px';
    video.style.objectFit = 'contain';
  });
  const duration = await page.locator('video').evaluate((video) => video.duration);
  const count = Math.max(2, Math.min(80, Math.floor(requested)));
  const frames = [];
  for (let index = 0; index < count; index++) {
    const seconds = Math.min(duration - 0.04, (duration * index) / (count - 1));
    await page.locator('video').evaluate((video, time) => new Promise((resolve, reject) => {
      const done = () => resolve();
      const failed = () => reject(new Error(`Could not seek to ${time.toFixed(3)} s`));
      video.addEventListener('seeked', done, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.currentTime = time;
    }), seconds);
    const name = `${String(index + 1).padStart(2, '0')}-${seconds.toFixed(2).replace('.', '_')}s.png`;
    const target = path.join(absoluteOutput, name);
    await page.locator('video').screenshot({ path: target });
    frames.push({ seconds: Number(seconds.toFixed(3)), path: target });
  }
  return { ok: true, source: absoluteSource, duration, frameCount: frames.length, frames };
}
