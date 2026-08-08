// G4.1 — A BAG IS ALWAYS PRESENT AT THE BAGGING POSITION, SEEN.
//
// "A bag is always present on the counter at the bagging position. The player
// never spawns one, never fetches one, and never waits for one."
//
// That was fixed in the sim (two branches used to leave the counter empty) and
// pinned by a source-level test. Source tests were the weaker instrument all
// session and the report has carried this as UNCONFIRMED. This is the frame.
//
// Two things are measured, because a screenshot alone proves neither:
//   1. the bag EXISTS in the scene graph and is visible
//   2. it is IN FRONT OF THE CAMERA at the default view - a bag behind the
//      player is present and useless
//
// NEGATIVE CONTROL: the same measurement with the bag hidden must report it
// missing. Otherwise "found a bag" is a sentence the driver would say either way.
//
// The pointer is captured before the frame is taken. An earlier driver in this
// session measured a HUD element at opacity 0 and I spent three runs blaming the
// wrong element - the HUD hides itself when the player is not captured, and the
// driver was the thing behaving unlike a player.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g4-bag-present');
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

  // Stand where the player stands to bag, facing the counter.
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const reg = ch.register;
    const bag = reg?.root ? reg.root.getWorldPosition(new fw.THREE.Vector3()) : null;
    if (!bag) return;
    st.x = bag.x + 0.2;
    st.z = bag.z + 1.5;
    st.yaw = Math.atan2(-(bag.x - st.x), -(bag.z - st.z));
    st.pitch = -0.28;
  }).catch(() => {});
  await page.mouse.click(700, 500);   // capture, like a player
  await page.waitForTimeout(1600);

  const look = () => page.evaluate(() => {
    const fw = window.__fw;
    const THREE = fw.THREE;
    const ch = fw.scene3d.clubhouse();
    const cam = fw.scene3d.camera;
    // find the counter bag by its own marker rather than by name guessing
    let bag = null;
    ch.register?.root?.traverse?.((o) => {
      if (!bag && o.userData?.checkoutOwner !== 'customer'
        && /bag/i.test(o.name || '') && o.visible) bag = o;
    });
    if (!bag) return { found: false };
    const p = bag.getWorldPosition(new THREE.Vector3());
    // is it drawn, and is it in front of the eye?
    let drawn = bag.visible;
    for (let n = bag.parent; n; n = n.parent) if (!n.visible) drawn = false;
    const ndc = p.clone().project(cam);
    return {
      found: true,
      name: bag.name,
      drawn,
      onScreen: ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
      ndc: { x: +ndc.x.toFixed(3), y: +ndc.y.toFixed(3), z: +ndc.z.toFixed(3) },
      distanceYd: +p.distanceTo(cam.getWorldPosition(new THREE.Vector3())).toFixed(2),
    };
  });

  out.present = await look();
  await page.screenshot({ path: path.join(OUT, 'g4-bag-default-camera.png') });

  // THE CONTROL: hide it, and the same measurement must say so.
  out.controlHidden = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    let hid = 0;
    ch.register?.root?.traverse?.((o) => {
      if (/bag/i.test(o.name || '') && o.visible) { o.visible = false; hid += 1; }
    });
    return hid;
  });
  await page.waitForTimeout(400);
  out.afterHiding = await look();
  await page.screenshot({ path: path.join(OUT, 'g4-bag-control-hidden.png') });

  out.verdict = {
    bagFound: out.present.found === true,
    bagDrawn: out.present.drawn === true,
    bagOnScreenAtDefaultCamera: out.present.onScreen === true,
    distanceYd: out.present.distanceYd ?? null,
    // the control must flip
    controlHidAnything: out.controlHidden > 0,
    controlReportsGone: out.afterHiding.found === false || out.afterHiding.drawn === false,
    cameraUntouched: out.camera,
    shots: ['g4-bag-default-camera.png', 'g4-bag-control-hidden.png'],
  };
  fs.writeFileSync(path.join(OUT, 'g4-bag.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G4-BAG', JSON.stringify(out.verdict));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
