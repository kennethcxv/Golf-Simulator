// 5.1 (Goal 26) — PHOTOGRAPH THE MOP HEAD BESIDE THE REFERENCE.
//
// The Phase 5 gate asks for the tool photographed at the default player camera
// and put side by side with `MopReferenceImage.png`. This is the photograph half:
// boot, equip, look where a player mopping looks, and shoot. It also writes a
// tight crop of the head, because the fault list -- "too thin", "does not connect
// to the stem", "each strand looks like four connected pieces" -- is about
// details that a 1080-tall full frame renders at forty pixels.
//
// It is deliberately small and fast so the look can be iterated: the whole point
// of 5.1 is a judgement about a picture, and a judgement needs the picture in
// front of you, not a number about it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mop-portrait.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-portrait');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], shots: {} };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  out.equipped = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const c = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = c.x; w.z = c.z + 2; w.vx = 0; w.vz = 0; w.yaw = 0; w.pitch = -0.72;
    s3.walk.setTool('mop');
    return { tool: s3.walk.getTool?.() ?? null };
  });
  // long enough for the yarn to settle: a photograph taken while it is still
  // falling from its seeded pose is a photograph of the seed, not the mop
  await page.waitForTimeout(5000);
  console.log('EQUIPPED', JSON.stringify(out.equipped));

  // Where is the head on screen? Project the rig root, so the crop follows the
  // mop instead of being a hard-coded rectangle that silently slides off it.
  out.headScreen = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let rig = null;
    s3.scene.traverse((o) => { if (!rig && o.userData?.strandRig?.tipsWorld) rig = o.userData.strandRig; });
    if (!rig) return null;
    rig.root.updateWorldMatrix(true, false);
    const e = rig.root.matrixWorld.elements;
    const v = new (Object.getPrototypeOf(s3.camera.position).constructor)(e[12], e[13], e[14]);
    v.project(s3.camera);
    return {
      ndc: [+v.x.toFixed(3), +v.y.toFixed(3)],
      px: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
      py: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
    };
  });
  console.log('HEAD-ON-SCREEN', JSON.stringify(out.headScreen));

  const full = path.join(OUT, 'mop-player-camera.png');
  await page.screenshot({ path: full });
  out.shots.full = full;

  if (out.headScreen) {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(full).metadata();
    const scale = meta.width / out.headScreen.w;
    const cx = Math.round(out.headScreen.px * scale);
    const cy = Math.round(out.headScreen.py * scale);
    const half = Math.round(meta.width * 0.13);
    const left = Math.max(0, Math.min(meta.width - 2 * half, cx - half));
    const top = Math.max(0, Math.min(meta.height - 2 * half, cy - half));
    const crop = path.join(OUT, 'mop-head-crop.png');
    await sharp(full).extract({
      left, top, width: 2 * half, height: 2 * half,
    }).resize(900).toFile(crop);
    out.shots.crop = crop;
    out.cropBox = { left, top, size: 2 * half };
  }
  console.log('SHOTS', JSON.stringify(out.shots));
  fs.writeFileSync(path.join(OUT, 'portrait.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
