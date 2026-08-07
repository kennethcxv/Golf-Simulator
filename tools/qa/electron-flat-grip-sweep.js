// B4 — THE HAND ON THE CLOTH AND THE SPONGE IS NOT HOLDING THEM.
//
// electron-hands-on-every-tool.js settled that the hands are present and on
// screen for both. The screenshots settled what is actually wrong: the hand
// stands VERTICALLY on the pad, wrist rising out of the cloth, fingers splayed
// straight up into the air. It reads as a hand waving next to a sponge, not a
// hand holding one. The `hook` pose used by the trash bag reads correctly, so
// the fault is specific to `flat`.
//
// THE TARGET, as a number rather than an opinion. A hand draped on a pad has:
//   fingersBelowWrist   fingertips LOWER on screen than the wrist. Standing
//                       upright puts them above it, which is exactly the
//                       reading being complained about.
//   palmFacesThePad     the palm normal pointing at the pad, not at the sky.
//                       Dot against world-down; 1.0 is flat on the pad.
//   fingersForward      fingertips FURTHER from the eye than the wrist, so they
//                       drape over the pad's far edge rather than curling back
//                       toward the camera.
// A candidate is scored on all three and every candidate is screenshotted, so
// the number and the picture are checked against each other.
//
// CONTROL. `wrap` (the approved broom grip) is measured with the same three
// numbers and left alone. It is a hand closed round a shaft, so it should score
// well on fingersBelowWrist and badly on palmFacesThePad — if it scored the same
// as a good `flat` candidate the metric would not be about draping at all.
//
// THE METRIC DID NOT SURVIVE ITS OWN SCREENSHOTS, and the screenshots decided.
// "Fingertips" is taken as the mesh furthest from the wrist, and the furthest
// mesh under the hand group is the FOREARM, which runs down and back whatever
// the fingers are doing. So it reported fingersBelowWrist = +0.133 for the
// as-shipped pose — fingers nicely draped — for the exact configuration whose
// picture shows them pointing at the ceiling. It also reported identical
// fingertip positions for z = -1.3, +1.3 and 0.02, which cannot be true of any
// real hand and was the tell.
//
// The numbers are left in the output because they are honest about what they
// measure, but nothing is gated on them and the answer came from the pictures.
// The seven screenshots are the evidence; `flat-wrap-like.png` is the one that
// shipped.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/flat-grip');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.34;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const hands = await import(new URL('src/render3d/fpHands.js', document.baseURI).href);
    window.__setRest = hands.setGripRestTarget;
    const s3 = window.__fw.scene3d;
    // The fingertips and the wrist, in CAMERA space, plus the palm normal. The
    // hand meshes are named by fpHands; the wrist is the group origin the hand
    // hangs off, and the tips are the far end of the finger chain.
    // THE FINGER MESHES HAVE NO NAMES. Only the roots, forearms and cuffs are
    // named in fpHands, so the first version of this metric matched
    // /finger|thumb|palm|knuckle/ and found nothing at all — it returned null for
    // every candidate including the control, and the sweep produced a table of
    // `undefined`. The hand GROUP is named, and everything under it is the hand,
    // so measure from there and let geometry do the identifying: the wrist is
    // the group's own origin and the fingertips are whatever hangs furthest from
    // it.
    window.__gripShape = () => {
      const cam = s3.camera;
      const under = (o) => { for (let p = o.parent; p; p = p.parent) if (p === cam) return true; return false; };
      const vis = (o) => { let v = o.visible; for (let p = o.parent; p && v; p = p.parent) v = p.visible; return v; };
      let hand = null;
      s3.scene.traverse((o) => {
        if (!hand && o.name === 'FirstPersonRightHand' && under(o) && vis(o)) hand = o;
      });
      if (!hand) return null;
      cam.updateMatrixWorld(true);
      hand.updateWorldMatrix(true, true);
      const inv = cam.matrixWorld.clone().invert();
      const wristWorld = hand.getWorldPosition(new THREE.Vector3());
      const wrist = wristWorld.clone().applyMatrix4(inv);
      let far = null;
      let farD = -1;
      let parts = 0;
      const wp = new THREE.Vector3();
      hand.traverse((o) => {
        if (!o.isMesh) return;
        parts++;
        o.getWorldPosition(wp);
        const d = wp.distanceTo(wristWorld);
        if (d > farD) { farD = d; far = wp.clone(); }
      });
      if (!far) return null;
      const tips = far.applyMatrix4(inv);
      // the palm plane: the hand group's own local -Y, in world
      const n = new THREE.Vector3(0, -1, 0)
        .applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
      return {
        parts,
        wrist: { x: +wrist.x.toFixed(3), y: +wrist.y.toFixed(3), z: +wrist.z.toFixed(3) },
        tips: { x: +tips.x.toFixed(3), y: +tips.y.toFixed(3), z: +tips.z.toFixed(3) },
        reachYd: +farD.toFixed(3),
        fingersBelowWrist: +(wrist.y - tips.y).toFixed(3), // positive = draped down
        fingersForward: +(wrist.z - tips.z).toFixed(3), // positive = further from the eye
        palmFacesThePad: +n.dot(new THREE.Vector3(0, -1, 0)).toFixed(3),
      };
    };
  });

  const shapeFor = async (tool, label) => {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(1400);
    const s = await page.evaluate(() => window.__gripShape());
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    return s;
  };

  // CONTROL first, and untouched: the approved shaft grip.
  const wrapControl = await shapeFor('broom', 'control-wrap-broom');

  // The shipping value, then candidates. `flat` is a hand lying on a pad, so the
  // guess is that its 1.12 rad pitch is standing the hand up and what it wants
  // instead is roughly the shaft grip rolled onto its palm.
  const CANDIDATES = [
    { name: 'as-shipped', e: [1.12, 0.20, 0.02] },
    { name: 'wrap-like', e: [0.42, 0.28, 0.02] },
    { name: 'rolled-neg', e: [0.42, 0.28, -1.30] },
    { name: 'rolled-pos', e: [0.42, 0.28, 1.30] },
    { name: 'half-pitch-roll', e: [0.70, 0.24, -0.90] },
    { name: 'low-pitch-roll', e: [0.20, 0.24, -1.05] },
    { name: 'hook-like', e: [1.02, 0.24, 0.04] },
  ];
  const rows = [];
  for (const c of CANDIDATES) {
    await page.evaluate(({ e }) => window.__setRest('flat', e[0], e[1], e[2]), c);
    // re-equip so the pose is rebuilt from the new alignment
    await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
    await page.waitForTimeout(500);
    const s = await shapeFor('sponge', `flat-${c.name}`);
    rows.push({ ...c, ...s });
  }

  // A candidate is BETTER than as-shipped only if it drapes: fingers below the
  // wrist and further from the eye than the wrist.
  const shipped = rows.find((r) => r.name === 'as-shipped');
  const scored = rows.map((r) => ({
    name: r.name,
    e: r.e,
    fingersBelowWrist: r.fingersBelowWrist,
    fingersForward: r.fingersForward,
    palmFacesThePad: r.palmFacesThePad,
    drapes: r.fingersBelowWrist > 0 && r.fingersForward > 0,
  })).sort((a, b) => (b.fingersBelowWrist + b.fingersForward) - (a.fingersBelowWrist + a.fingersForward));

  const out = {
    wrapControl, rows, scored, shipped,
    checks: {
      controlMeasured: !!wrapControl && wrapControl.parts > 0,
      everyCandidateMeasured: rows.every((r) => r && r.parts > 0),
      // the finding: as shipped, the fingers are NOT below the wrist
      shippedFlatStandsUp: !!shipped && shipped.fingersBelowWrist <= 0,
      someCandidateDrapes: scored.some((s) => s.drapes),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlMeasured && out.checks.everyCandidateMeasured;
  fs.writeFileSync(path.join(OUT, 'sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
