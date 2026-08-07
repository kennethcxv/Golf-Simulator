// B2 — THE BROOM'S HEAD, AT THE PLAYER'S CAMERA.
//
// The brief asks for three things and I have so far done one: dense bristles
// (done, 22 tufts -> 96 instanced), a DEFINED BLOCK, and a VISIBLE FERRULE.
// This is both the confirmation shot for the density and the diagnosis for the
// other two, because a visual claim without a player-camera screenshot is
// UNCONFIRMED by this brief's own rule.
//
// Three frames, all at the default camera with the tool really equipped through
// the real wheel:
//   1. carry pose, level look   - how it reads walking about
//   2. work pitch, head planted - the pose the bristles are for
//   3. a crop on the head       - because a head is a small part of a 4K frame
//      and every judgement made at full-frame size in this project has been
//      wrong at least once
//
// It also reports what the head is actually MADE of, so "there is no block" and
// "the block is there but reads flat" are told apart before anything is built.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* crop skipped, full frames still land */ }
  const OUT = path.resolve('qa/electron/b2-broomhead');
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
  await page.waitForTimeout(6000);

  // Indoors: the cleaning wheel is an indoor wheel (fault 64 - a wheel opened
  // at spawn lists course tools only).
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.05;
  });
  await page.waitForTimeout(700);

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
  const at = items.findIndex((label) => /broom/i.test(label));
  if (at >= 0) await page.keyboard.press(String(at === 9 ? 0 : at + 1));
  await page.waitForTimeout(900);
  out.equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);

  // WHAT THE HEAD IS MADE OF. Names, visibility and world sizes, so a missing
  // block and a flat-looking block are different findings.
  out.head = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const group = s3.scene.getObjectByName('Tool_broom');
    if (!group) return { found: false };
    const parts = [];
    group.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const box = new (Object.getPrototypeOf(o.position).constructor.name === 'Vector3'
        ? window.__fwTHREE?.Box3 || Object : Object)();
      parts.push({
        name: o.name || '(unnamed)',
        instanced: !!o.isInstancedMesh,
        count: o.isInstancedMesh ? o.count : 1,
        visible: o.visible,
        material: o.material?.type || null,
        color: o.material?.color ? `#${o.material.color.getHexString()}` : null,
      });
    });
    const rig = s3.walk.strandRigFor?.('broom') || null;
    return {
      found: true,
      parts,
      fibreStrands: rig?.strandCount ?? null,
      fibreDrawCalls: rig?.drawCalls ?? null,
    };
  });

  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };

  // 1. carry, level look
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.05; });
  await page.waitForTimeout(700);
  out.carryShot = await shot('b2-01-carry-level');

  // 2. work pitch - looking down at the floor, where the head plants
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.62; });
  await page.waitForTimeout(900);
  out.workShot = await shot('b2-02-work-pitch');

  // 3. the head, cropped. The rig knows where it drew the contact socket, so
  // the crop is taken from the lens that ACTUALLY drew the tool rather than the
  // world camera - projecting through the wrong lens is a logged fault here.
  out.headNdc = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const w = s3.walk;
    const group = s3.scene.getObjectByName('Tool_broom');
    const contact = group?.getObjectByName('SOCKET_FloorContact');
    const cam = w.toolDrawCamera?.('broom');
    if (!contact || !cam) return null;
    const V = Object.getPrototypeOf(contact.position).constructor;
    const ndc = contact.getWorldPosition(new V()).project(cam);
    return { x: +ndc.x.toFixed(4), y: +ndc.y.toFixed(4) };
  });
  if (sharp && out.headNdc) {
    const meta = await sharp(out.workShot).metadata();
    const cx = Math.round((out.headNdc.x * 0.5 + 0.5) * meta.width);
    const cy = Math.round((-out.headNdc.y * 0.5 + 0.5) * meta.height);
    const half = 420;
    const left = Math.max(0, Math.min(meta.width - 2 * half, cx - half));
    const top = Math.max(0, Math.min(meta.height - 2 * half, cy - half));
    const file = path.join(OUT, 'b2-03-head-crop.png');
    await sharp(out.workShot)
      .extract({ left, top, width: Math.min(2 * half, meta.width), height: Math.min(2 * half, meta.height) })
      .toFile(file);
    out.headCrop = file;
    out.frameSize = { width: meta.width, height: meta.height };
  }

  fs.writeFileSync(path.join(OUT, 'b2.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B2 equipped', out.equipped, 'ndc', JSON.stringify(out.headNdc), 'frame', JSON.stringify(out.frameSize));
  console.log('B2 fibres', out.head?.fibreStrands, 'drawCalls', out.head?.fibreDrawCalls);
  console.log('B2 parts', JSON.stringify((out.head?.parts || []).map((p) => `${p.name}${p.instanced ? `x${p.count}` : ''}${p.visible ? '' : ' [HIDDEN]'} ${p.color || ''}`)));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
