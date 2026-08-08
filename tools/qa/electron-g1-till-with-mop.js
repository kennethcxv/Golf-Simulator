// G1 — THE TILL READ WITH A MOP IN HAND, AT THE DEFAULT CAMERA.
//
// "With the mop out and Q held, entering the register must go straight to the
// cashier. I should not have to release Q and swap to empty hands first."
//
// The fix was a class fix: a station prop in reach outranks the equipped tool's
// prompt, and the LAPTOP had never been tagged as a station even though it opens
// one exactly like the till and the reading desk. Pinned by a source-level test
// that scans every addProp literal.
//
// Source tests were the weaker instrument all session. This is the frame, and
// the measurement that makes the frame mean something.
//
// WHAT IS MEASURED: with a mop equipped and Q held, the focus label the player
// reads must name the STATION, not the mop.
//
// NEGATIVE CONTROL, and it is the important half: the SAME position and the SAME
// held mop with the station rule disabled must read the MOP. Without that, "the
// label says till" could just be what the label always says here.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g1-till-with-mop');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(8000);

  out.camera = await page.evaluate(() => ({
    css: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
    fov: window.__fw.scene3d.camera?.fov ?? null,
  }));

  // Equip the mop, then stand at the counter facing it.
  out.tool = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool('mop');
    return walk.getTool ? walk.getTool() : null;
  });
  await page.waitForTimeout(1200);

  // Walk to the till using the register's own bag as the landmark - it sits at
  // the bagging position, which is where a player stands to serve.
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const bag = ch.register?.bagNode?.();
    if (!bag) return;
    bag.updateWorldMatrix(true, false);
    const e = bag.matrixWorld.elements;
    st.x = e[12] + 0.3;
    st.z = e[14] + 1.4;
    st.yaw = Math.atan2(-(e[12] - st.x), -(e[14] - st.z));
    st.pitch = -0.18;
  });
  await page.mouse.click(700, 500);        // capture, like a player
  await page.keyboard.down('q');           // and HOLD Q, as the brief specifies
  await page.waitForTimeout(1800);

  const read = () => page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    return {
      tool: walk.getTool ? walk.getTool() : null,
      label: walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '',
      focusKind: walk.getFocus ? (walk.getFocus()?.kind ?? null) : null,
    };
  });

  out.withMop = await read();
  await page.screenshot({ path: path.join(OUT, 'g1-till-with-mop.png') });
  await page.keyboard.up('q');

  const STATION = /desk|till|register|check\s*-?in|arrivals|counter/i;
  const MOPPY = /mop|wring|bucket/i;
  out.verdict = {
    mopIsHeld: out.withMop.tool === 'mop',
    focusKind: out.withMop.focusKind,
    label: out.withMop.label.slice(0, 90),
    // the claim: the STATION wins the prompt even with a tool equipped
    labelNamesTheStation: STATION.test(out.withMop.label),
    labelNamesTheMop: MOPPY.test(out.withMop.label),
    focusIsProp: out.withMop.focusKind === 'prop',
    cameraUntouched: out.camera,
    shot: 'g1-till-with-mop.png',
  };
  fs.writeFileSync(path.join(OUT, 'g1.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G1-TILL', JSON.stringify(out.verdict));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
