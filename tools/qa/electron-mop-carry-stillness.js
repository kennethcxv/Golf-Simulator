// PLAYTEST 4, ITEM 3 — THE MOP, ON CAMERA: LOOK AROUND, THEN WALK, THEN MOP.
//
// "They move too easily. Right now they swing when I am merely LOOKING AROUND,
// which is wrong -- turning my head is not moving the mop. The strands should
// only move when I am holding the left mouse button."
//
// That is a claim about a GESTURE, so it gets a clip, in three deliberately
// separated acts with a still pause between each so the frames can be told apart:
//
//   0.0 - 4.0 s   stand still, holding the mop          (nothing should move)
//   4.0 - 9.0 s   LOOK AROUND, hard, left and right     (nothing should move)
//   9.0 - 14.0 s  WALK forward and back                 (nothing should move)
//  14.0 - 20.0 s  HOLD THE LEFT BUTTON AND MOP          (it should move)
//
// Alongside the video it records the number the video cannot: the tip cloud's
// offset from the head, sampled every frame, so "it moved" has a magnitude and
// the acts can be compared to each other rather than to memory.
//
//   VIDEO_DIR=qa/clips/mop-carry node tools/qa/run-electron.cjs tools/qa/electron-mop-carry-stillness.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-carry');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(400);

  // Equip the mop the way a player does, then confirm the rig is the simulated
  // one -- the filtered rig has no tipsWorld and would silently measure nothing.
  // walk.setTool is DEBOUNCED and runs a holster first, so it does not take
  // effect on the calling frame and its return value says nothing. The first
  // version of this driver read that return value, got null, carried on, and
  // reported four acts of statistics for a mop that was never in frame -- probe
  // lie 33. The equip is now CONFIRMED from the live rig before anything is
  // measured, and the run stops if it did not happen.
  await page.evaluate(() => { window.__fw.scene3d.walk.setTool('mop'); });
  await page.waitForFunction(
    () => window.__fw.scene3d.walk.getTool?.() === 'mop'
      && window.__fw.scene3d.walk.strandRigDiagnostics?.('mop')?.equipped === true,
    null, { timeout: 30000 },
  );
  out.equip = await page.evaluate(() => ({
    tool: window.__fw.scene3d.walk.getTool(),
    rig: window.__fw.scene3d.walk.strandRigDiagnostics('mop'),
  }));
  console.log('EQUIP', JSON.stringify(out.equip));
  await page.waitForTimeout(2500);

  out.probe = await page.evaluate(() => {
    // The rig lives on the viewmodel entry for the held tool. Found by walking the
    // scene for the instanced layers rather than by guessing an accessor name --
    // an accessor that has been renamed reads to a probe as "no mop".
    let rig = null;
    const seen = [];
    window.__fw.scene3d.scene.traverse((o) => {
      if (o.name && /MopVerlet/.test(o.name)) seen.push(o.name);
    });
    rig = window.__fw.scene3d.qaMopRig?.() || null;
    return { layerNames: seen.slice(0, 8), hasAccessor: !!rig };
  });
  console.log('PROBE', JSON.stringify(out.probe));

  // The measurement: mean tip position relative to the mop head, every frame.
  await page.evaluate(() => {
    window.__mop = { rows: [], act: 'still', t0: performance.now() };
    const layerName = 'MopVerletLayer_0';
    const tick = () => {
      const scene = window.__fw.scene3d.scene;
      let tips = null;
      let anchorLayer = null;
      scene.traverse((o) => {
        if (o.name === 'MopVerletTips') tips = o;
        if (o.name === layerName) anchorLayer = o;
      });
      if (tips && anchorLayer && tips.count) {
        // Instance 0's translation in each layer: the hem bead and the collar
        // node of the same strand. Their separation in the RIG's own frame is
        // the deflection, which is what "the strands moved" means -- the head
        // moving with the player is not the strands moving.
        const m = tips.instanceMatrix.array;
        const a = anchorLayer.instanceMatrix.array;
        let sx = 0; let sz = 0; let n = 0;
        for (let i = 0; i < tips.count; i += 7) {
          sx += m[i * 16 + 12] - a[i * 16 + 12];
          sz += m[i * 16 + 14] - a[i * 16 + 14];
          n += 1;
        }
        window.__mop.rows.push({
          t: +((performance.now() - window.__mop.t0) / 1000).toFixed(2),
          act: window.__mop.act,
          dx: +(sx / n).toFixed(5),
          dz: +(sz / n).toFixed(5),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const act = async (name) => {
    await page.evaluate((a) => { window.__mop.act = a; }, name);
    const mode = await page.evaluate(() => window.__fw.scene3d.walk.strandRigDiagnostics('mop'));
    out[`mode_${name}`] = { active: mode?.active ?? null, using: mode?.using ?? null, rigidity: mode?.feel?.rigidity ?? null };
    console.log('ACT', name, JSON.stringify(out[`mode_${name}`]));
  };

  // ACT 1 — stand still.
  await act('still');
  await page.waitForTimeout(4000);

  // ACT 2 — look around, hard. Mouse only; no key is pressed.
  await act('look');
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(800 + (i % 2 ? 420 : -420), 450, { steps: 12 });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
  }

  // ACT 3 — walk. Still no button.
  await act('walk');
  for (const key of ['KeyW', 'KeyS', 'KeyW', 'KeyS']) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.down(key);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(600);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.up(key);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }

  // ACT 4 — MOP. Left button held down for the whole stroke.
  await act('mop');
  await page.mouse.down();
  await page.waitForTimeout(300);
  out.modeWhileHolding = await page.evaluate(() => window.__fw.scene3d.walk.strandRigDiagnostics('mop'));
  console.log('MODE WHILE HOLDING LMB', JSON.stringify(out.modeWhileHolding));
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(800 + (i % 2 ? 260 : -260), 470, { steps: 8 });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(320);
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const rows = await page.evaluate(() => window.__mop.rows.slice());
  out.samples = rows.length;
  const stat = (name) => {
    const xs = rows.filter((r) => r.act === name).map((r) => Math.hypot(r.dx, r.dz));
    if (!xs.length) return null;
    return {
      frames: xs.length,
      peak: +Math.max(...xs).toFixed(4),
      mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4),
      // How much the deflection VARIES is the thing the eye calls movement: a
      // constant hang is not a swing.
      swing: +(Math.max(...xs) - Math.min(...xs)).toFixed(4),
    };
  };
  out.acts = { still: stat('still'), look: stat('look'), walk: stat('walk'), mop: stat('mop') };
  out.verdict = {
    ...out.acts,
    // The claim, as a comparison rather than an adjective.
    mopSwingsMoreThanLooking: (out.acts.mop && out.acts.look)
      ? +(out.acts.mop.swing / Math.max(1e-4, out.acts.look.swing)).toFixed(2) : null,
    mopSwingsMoreThanWalking: (out.acts.mop && out.acts.walk)
      ? +(out.acts.mop.swing / Math.max(1e-4, out.acts.walk.swing)).toFixed(2) : null,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('MOP-CARRY', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'mop-carry.json'), `${JSON.stringify(out, null, 2)}\n`);
  await page.screenshot({ path: path.join(OUT, 'mop-final.png') });
  return out;
}
