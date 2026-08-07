// B1 — DO THE MOP'S STRANDS MOVE ON THE PLAYER'S SCREEN?
//
// The brief: "I have been told they move and shown a measurement of 0.25 yd of
// travel, and they do not move at all on my screen. Resolve that before you
// build."
//
// Both statements can be true at once, and that is the point. 0.25 yd is a
// WORLD-SPACE measurement of where a tip went. What the owner sees is PIXELS at
// arm's length through a viewmodel lens. A tip can travel a quarter of a yard
// in world space and move barely any pixels if the motion is mostly along the
// view direction, or if it is hidden behind the head, or if the whole head is
// swinging so the strands move WITH it rather than relative to it.
//
// So this measures the thing the owner is actually looking at: the pixels in
// the head region, during a real stroke driven by a real held mouse button.
//
// THE CONTROL IS THE WHOLE INSTRUMENT. The same stroke is measured twice:
//   A. strands live, as shipped
//   B. strands FROZEN - every motion parameter zeroed through the same live
//      door the tuning overlay uses, so the fibres are welded to the head
// If A and B produce the same pixel difference, the strands are not visibly
// moving and the owner is right. If A is clearly larger, they move and the
// question becomes whether it is enough.
//
// A third leg measures the tips in WORLD space at the same time, so the two
// numbers - the one that was reported and the one the eye sees - sit side by
// side instead of being argued about.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* no verdict without it */ }
  const OUT = path.resolve('qa/electron/b1-divergence');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(7000);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.55;
  });
  await page.waitForTimeout(700);

  // Equip the mop through the real wheel, then close it.
  await page.mouse.click(640, 380);
  await page.waitForTimeout(400);
  const bindings = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  await page.keyboard.down(bindings.toolBelt || 'f');
  await page.waitForTimeout(450);
  await page.keyboard.up(bindings.toolBelt || 'f');
  await page.waitForTimeout(300);
  const items = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    return el ? [...el.querySelectorAll('.tool-wheel-item')]
      .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
  });
  const at = items.findIndex((label) => /^mop$/i.test(label.trim()) || /\bmop\b/i.test(label));
  if (at >= 0) await page.keyboard.press(String(at === 9 ? 0 : at + 1));
  await page.waitForTimeout(1000);
  out.equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  out.rig = await page.evaluate(() => {
    const r = window.__fw.scene3d.walk.strandRigFor?.('mop');
    return r ? { strands: r.strandCount, drawCalls: r.drawCalls, params: r.params() } : null;
  });

  // The head's position on screen, through the lens that DREW it.
  const headNdc = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const group = s3.scene.getObjectByName('Tool_mop');
    const contact = group?.getObjectByName('SOCKET_FloorContact');
    const cam = s3.walk.toolDrawCamera?.('mop');
    if (!contact || !cam) return null;
    const V = Object.getPrototypeOf(contact.position).constructor;
    const n = contact.getWorldPosition(new V()).project(cam);
    return { x: n.x, y: n.y };
  });
  out.headNdc = await headNdc();

  // Pixel difference inside a box centred on the head, in IMAGE pixels. A
  // screenshot is physical and the viewport is CSS - conflating the two is a
  // logged fault (75) that once measured a patch of static ceiling.
  const diffHead = async (a, b) => {
    if (!sharp || !out.headNdc) return null;
    const meta = await sharp(a).metadata();
    const cx = Math.round((out.headNdc.x * 0.5 + 0.5) * meta.width);
    const cy = Math.round((-out.headNdc.y * 0.5 + 0.5) * meta.height);
    const half = 300;
    const left = Math.max(0, Math.min(meta.width - 2 * half, cx - half));
    const top = Math.max(0, Math.min(meta.height - 2 * half, cy - half));
    const region = { left, top, width: 2 * half, height: 2 * half };
    const [ra, rb] = await Promise.all([
      sharp(a).extract(region).raw().toBuffer(),
      sharp(b).extract(region).raw().toBuffer(),
    ]);
    let moved = 0;
    for (let i = 0; i < ra.length; i += 3) if (Math.abs(ra[i] - rb[i]) > 14) moved += 1;
    return moved;
  };

  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };

  // World-space tip travel, sampled over the same window: the number that was
  // REPORTED, measured beside the number the eye gets.
  const tipTravel = async (ms) => page.evaluate(async (dur) => {
    const rig = window.__fw.scene3d.walk.strandRigFor?.('mop');
    if (!rig?.tipsLocal) return null;
    const first = rig.tipsLocal().map((v) => ({ x: v.x, y: v.y, z: v.z }));
    const maxima = new Array(first.length).fill(0);
    const t0 = performance.now();
    while (performance.now() - t0 < dur) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = rig.tipsLocal();
      for (let i = 0; i < first.length; i += 1) {
        const d = Math.hypot(now[i].x - first[i].x, now[i].y - first[i].y, now[i].z - first[i].z);
        if (d > maxima[i]) maxima[i] = d;
      }
    }
    maxima.sort((a, b) => b - a);
    return {
      // GLB-local metres; the tool's runtime scale turns these into yards
      worstTipMetres: +maxima[0].toFixed(4),
      medianTipMetres: +maxima[Math.floor(maxima.length / 2)].toFixed(4),
    };
  }, ms);

  // ONE STROKE, driven by a real held mouse button, sampled as pixels.
  const strokeLeg = async (tag) => {
    const before = await shot(`${tag}-a`);
    await page.mouse.down();
    await page.waitForTimeout(420);          // mid-stroke
    const mid = await shot(`${tag}-b`);
    const travel = await tipTravel(700);
    await page.waitForTimeout(120);
    const late = await shot(`${tag}-c`);
    await page.mouse.up();
    await page.waitForTimeout(900);          // let it settle
    const settled = await shot(`${tag}-d`);
    return {
      tag,
      travel,
      startToMid: await diffHead(before, mid),
      midToLate: await diffHead(mid, late),
      lateToSettled: await diffHead(late, settled),
    };
  };

  // NOISE: two frames, no input at all. Everything else must clear this.
  const n0 = await shot('noise-a');
  await page.waitForTimeout(500);
  const n1 = await shot('noise-b');
  out.noise = await diffHead(n0, n1);

  // A. as shipped
  out.live = await strokeLeg('live');

  // B. THE CONTROL: fibres welded to the head, through the same live door the
  // tuning overlay writes with, so nothing else about the frame changes.
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    const f = w.toolFeelLive?.('mop');
    if (f && !f.strands) f.strands = {};
    for (const [k, v] of Object.entries({
      pushGain: 0, dragGain: 0, splayBase: 0, splayGrow: 0,
      deficitBase: 0, deficitGrow: 0, targetBase: 0, targetGrow: 0,
    })) w.toolFeelSet?.('mop', `strands.${k}`, v);
  });
  await page.waitForTimeout(700);
  out.frozenParams = await page.evaluate(
    () => window.__fw.scene3d.walk.strandRigFor?.('mop')?.params?.() ?? null,
  );
  out.frozen = await strokeLeg('frozen');

  const floor = Math.max(out.noise ?? 0, 1);
  out.verdict = {
    noiseFloor: out.noise,
    liveHeadPixels: out.live.startToMid,
    frozenHeadPixels: out.frozen.startToMid,
    // The question the brief actually asks: can the eye tell live from frozen?
    liveVsFrozenRatio: out.frozen.startToMid
      ? +(out.live.startToMid / out.frozen.startToMid).toFixed(2) : null,
    strandsVisiblyMove: out.live.startToMid > floor * 3
      && out.frozen.startToMid > 0
      && out.live.startToMid / out.frozen.startToMid > 1.25,
    worldTipTravelLiveMetres: out.live.travel?.worstTipMetres ?? null,
    worldTipTravelFrozenMetres: out.frozen.travel?.worstTipMetres ?? null,
  };
  fs.writeFileSync(path.join(OUT, 'b1.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B1 equipped', out.equipped, 'rig', JSON.stringify(out.rig && {
    strands: out.rig.strands, drawCalls: out.rig.drawCalls,
  }));
  console.log('B1 verdict', JSON.stringify(out.verdict));
  console.log('B1 live', JSON.stringify(out.live), 'frozen', JSON.stringify(out.frozen));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
