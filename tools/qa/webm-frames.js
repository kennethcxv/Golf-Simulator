// B1 support — extract frames from a session webm so the clip can be
// WATCHED (read frame-by-frame) and cited by frame number in the report.
// Electron decodes webm natively; no ffmpeg on this machine.
//
//   QA_WEBM=path/to/clip.webm QA_FRAMES_OUT=qa/electron/b1/broom-frames \
//     node tools/qa/run-electron.cjs tools/qa/webm-frames.js
//
// Seeks in fixed steps and writes PNGs named by their timestamp in ms.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const SRC = path.resolve(process.env.QA_WEBM || '');
  const OUT = path.resolve(process.env.QA_FRAMES_OUT || 'qa/electron/webm-frames');
  const STEP = Number(process.env.QA_FRAME_STEP_MS || 700);
  if (!fs.existsSync(SRC)) return { ok: false, fail: `no such webm: ${SRC}` };
  fs.mkdirSync(OUT, { recursive: true });

  const url = `file:///${SRC.replace(/\\/g, '/')}`;
  const frames = await page.evaluate(async ({ src, stepMs }) => {
    const video = document.createElement('video');
    video.muted = true;
    video.src = src;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('video load failed'));
    });
    // some recorder webms report Infinity until a big seek forces the
    // duration to materialise
    if (!Number.isFinite(video.duration)) {
      video.currentTime = 1e9;
      await new Promise((resolve) => { video.onseeked = resolve; });
      video.currentTime = 0;
      await new Promise((resolve) => { video.onseeked = resolve; });
    }
    const duration = video.duration;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    const shots = [];
    for (let t = 0; t < duration; t += stepMs / 1000) {
      video.currentTime = t;
      await new Promise((resolve) => { video.onseeked = resolve; });
      ctx.drawImage(video, 0, 0);
      shots.push({ ms: Math.round(t * 1000), data: canvas.toDataURL('image/png') });
    }
    return { duration, w: video.videoWidth, h: video.videoHeight, shots };
  }, { src: url, stepMs: STEP });

  if (!frames.shots) return { ok: false, fail: 'no frames decoded' };
  for (const shot of frames.shots) {
    const b64 = shot.data.split(',')[1];
    fs.writeFileSync(path.join(OUT, `t${String(shot.ms).padStart(6, '0')}.png`), Buffer.from(b64, 'base64'));
  }
  return {
    ok: true,
    src: SRC,
    out: OUT,
    durationS: +frames.duration.toFixed(2),
    size: `${frames.w}x${frames.h}`,
    frameCount: frames.shots.length,
  };
}
