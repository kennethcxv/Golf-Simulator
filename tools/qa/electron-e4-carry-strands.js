// E4 — DO THE MOP'S STRANDS MOVE WHEN CARRIED (not only while cleaning)?
//
// Real input: W held to walk, a mouse turn, then a stop — while an in-page
// rAF grabber captures 640w frames (the video-frame fidelity the brief asks
// to watch; VIDEO_DIR also records the webm) and the strand rig's tip
// positions are sampled per frame. NEGATIVE CONTROL: standing still, not
// using — tip motion must be near zero there, or the instrument is reading
// camera noise rather than strand life.
//
//   VIDEO_DIR=qa/electron/e4-carry node tools/qa/run-electron.cjs tools/qa/electron-e4-carry-strands.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e4-carry');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 2.0; w.state.z = o.z + 1.0; w.state.yaw = Math.PI / 2; w.state.pitch = -0.1;
    app.speedIdx = 0;
    w.setTool('mop');
  });
  await page.waitForFunction(() => !!window.__fw.scene3d.strandRigFor?.('mop'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2200);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(300);

  const sampler = (ms) => page.evaluate((dur) => new Promise((res) => {
    const rig = window.__fw.scene3d.strandRigFor?.('mop');
    const tips = [];
    const grab = [];
    const src = document.getElementById('game');
    const c = document.createElement('canvas');
    c.width = 640; c.height = Math.round(src.height / src.width * 640);
    const ctx = c.getContext('2d');
    const t0 = performance.now();
    let probe = null;
    if (rig && rig.group) {
      rig.group.traverse((n) => { if (!probe && n.isMesh) probe = n; });
    }
    const tick = () => {
      if (probe) {
        probe.updateWorldMatrix(true, false);
        const e = probe.matrixWorld.elements;
        tips.push([e[12], e[13], e[14]]);
      }
      if (grab.length < 26 && (performance.now() - t0) > grab.length * (dur / 26)) {
        ctx.drawImage(src, 0, 0, c.width, c.height);
        grab.push(c.toDataURL('image/png'));
      }
      if (performance.now() - t0 < dur) requestAnimationFrame(tick);
      else res({ tips, grab, hadRig: !!rig, hadProbe: !!probe });
    };
    requestAnimationFrame(tick);
  }), ms);
  const motion = (tips) => {
    let sum = 0;
    for (let i = 1; i < tips.length; i += 1) {
      sum += Math.hypot(tips[i][0] - tips[i - 1][0], tips[i][1] - tips[i - 1][1], tips[i][2] - tips[i - 1][2]);
    }
    return +(sum).toFixed(4);
  };

  // CONTROL: parked, no input.
  const still = await sampler(2000);
  // WALK: real W hold.
  await page.keyboard.down('w');
  const walking = await sampler(2200);
  await page.keyboard.up('w');
  // TURN: real mouse sweep.
  const turnP = sampler(1400);
  await page.mouse.move(800, 450);
  for (let i = 0; i < 14; i += 1) { await page.mouse.move(800 + i * 40, 450, { steps: 2 }); await page.waitForTimeout(60); }
  const turning = await turnP;

  const save = (frames, prefix) => frames.forEach((d, i) => fs.writeFileSync(path.join(OUT, `${prefix}-${String(i).padStart(2, '0')}.png`), Buffer.from(d.split(',')[1], 'base64')));
  save(still.grab.filter((_, i) => i % 5 === 0), 'still');
  save(walking.grab.filter((_, i) => i % 3 === 0), 'walk');
  save(turning.grab.filter((_, i) => i % 3 === 0), 'turn');

  const verdict = {
    hadRig: walking.hadRig,
    hadProbe: walking.hadProbe,
    stillMotion: motion(still.tips),
    walkMotion: motion(walking.tips),
    turnMotion: motion(turning.tips),
    strandsLiveWhileCarried: null,
  };
  verdict.strandsLiveWhileCarried = verdict.walkMotion > verdict.stillMotion * 3 && verdict.walkMotion > 0.05;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ verdict }, null, 2));
  console.log('E4-CARRY', JSON.stringify(verdict));
}
