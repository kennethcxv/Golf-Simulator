async (page) => {
  // C1 — "THERE ARE TWO SIGNS AND ONLY ONE TURNS."
  //
  // The unit tests for this fix read a registry and some source text. Neither
  // can tell a repainted board from a stale one, which is the exact failure
  // mode A2 established. This driver reads the PIXELS on both signs across a
  // real E press and photographs the exterior board from the car park.
  //
  // Negative control: both signs are sampled twice with NO flip in between. If
  // the sampler reports a change while nothing happened — or cannot find one of
  // the boards — the measurement after it means nothing.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/shop-sign-both');
  fs.mkdirSync(OUT, { recursive: true });
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1200);

  // Both boards, found by NAME in the live scene graph — not assumed present.
  const found = await page.evaluate(() => {
    const c = window.__fw.scene3d.clubhouse();
    const hit = (name) => c.group.getObjectByName(name) || c.interior.getObjectByName(name);
    return {
      card: !!hit('ClubhouseOpenClosedSign'),
      board: !!hit('LegacyBusinessHoursSign'),
      registry: c.signDiagnostics ? c.signDiagnostics() : null,
    };
  });
  assert(found.card, 'the interior card ClubhouseOpenClosedSign is not in the scene');
  assert(found.board, 'the exterior board LegacyBusinessHoursSign is not in the scene');
  assert(found.registry && found.registry.names.length >= 2,
    `the sign registry holds ${JSON.stringify(found.registry)} — both boards must be in it`);

  // A signature of what each sign SHOWS. The card carries its state in its yaw
  // (one card, two painted faces), the board in its texture pixels. Sampling
  // the wrong quantity on either is how you measure nothing: a yaw check on the
  // board would read 0 forever, and a pixel check on the card would read the
  // same canvas whichever way it is turned.
  const sample = () => page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const c = window.__fw.scene3d.clubhouse();
    const hit = (name) => c.group.getObjectByName(name) || c.interior.getObjectByName(name);
    const card = hit('ClubhouseOpenClosedSign');
    const board = hit('LegacyBusinessHoursSign');
    card.updateWorldMatrix(true, false);
    const fwd = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(card.getWorldQuaternion(new THREE.Quaternion()));
    // The board's map is a CanvasTexture; hash its ink so a repaint is visible
    // even when the words are the same length.
    const canvas = board.material?.map?.image;
    let ink = null;
    let version = null;
    if (canvas && canvas.getContext) {
      const px = canvas.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let h = 2166136261;
      for (let i = 0; i < px.length; i += 41) { h ^= px[i]; h = Math.imul(h, 16777619); }
      ink = (h >>> 0).toString(16);
      version = board.material.map.version;
    }
    return {
      cardBearing: +Math.atan2(fwd.x, fwd.z).toFixed(4),
      boardInk: ink,
      boardTextureVersion: version,
      signOpen: !!window.__fw.state.shop.signOpen,
      registry: c.signDiagnostics(),
    };
  });

  // ---- negative control: nothing flipped, so nothing may change -------------
  const control0 = await sample();
  await page.waitForTimeout(700);
  const control1 = await sample();
  assert(control0.boardInk, 'the exterior board has no readable canvas — the pixel sampler is blind');
  assert(control0.cardBearing === control1.cardBearing,
    `NEGATIVE CONTROL FAILED: the card turned ${control1.cardBearing - control0.cardBearing} rad with nobody pressing anything.`);
  assert(control0.boardInk === control1.boardInk,
    'NEGATIVE CONTROL FAILED: the board repainted itself with nothing flipping it.');

  // Photograph the board from where a customer reads it: outside, facing the
  // south wall. Stand off it and look back at the building.
  const viewBoard = async (label) => {
    await page.evaluate(async () => {
      const THREE = await import('/vendor/three.module.js');
      const app = window.__fw;
      const c = app.scene3d.clubhouse();
      const board = c.group.getObjectByName('LegacyBusinessHoursSign');
      c.group.updateMatrixWorld(true);
      const w = board.getWorldPosition(new THREE.Vector3());
      // The board faces +z of the shell group; step out along its own normal so
      // this works whatever yaw the building has.
      const n = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      const walk = app.scene3d.walk.state;
      walk.x = w.x + n.x * 3.0;
      walk.z = w.z + n.z * 3.0;
      const dx = w.x - walk.x;
      const dz = w.z - walk.z;
      const horiz = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / horiz, -dz / horiz);
      walk.pitch = Math.atan2(w.y - app.scene3d.camera.position.y, horiz);
    });
    await page.waitForTimeout(800);
    await shot(label);
  };
  await viewBoard('01-board-closed.png');

  // ---- flip it, from inside, with a real E press ----------------------------
  const before = await sample();
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const c = app.scene3d.clubhouse();
    const card = c.interior.getObjectByName('ClubhouseOpenClosedSign');
    c.interior.updateMatrixWorld(true);
    const w = card.getWorldPosition(new THREE.Vector3());
    const walk = app.scene3d.walk.state;
    let stand = null;
    let best = Infinity;
    for (let step = 0; step < 32; step += 1) {
      const a = (step / 32) * Math.PI * 2;
      const x = w.x + Math.sin(a) * 1.05;
      const z = w.z + Math.cos(a) * 1.05;
      if (!c.isInside(x, z, 0)) continue;
      const d = Math.hypot(x - c.center.x, z - c.center.z);
      if (d < best) { best = d; stand = { x, z }; }
    }
    walk.x = stand.x;
    walk.z = stand.z;
    const dx = w.x - walk.x;
    const dz = w.z - walk.z;
    const horiz = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horiz, -dz / horiz);
    walk.pitch = Math.atan2(w.y - app.scene3d.camera.position.y, horiz);
  });
  await page.waitForTimeout(700);
  await page.waitForFunction(() => /Door sign/.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
    null, { timeout: 10000 });
  await shot('02-card-closed.png');
  await page.keyboard.press('e');
  await page.waitForTimeout(900);   // longer than the 0.28 s swing
  await shot('03-card-open.png');
  const after = await sample();
  await viewBoard('04-board-open.png');

  assert(before.signOpen !== after.signOpen, 'the E press did not flip the sim state at all');

  const report = {
    registry: after.registry,
    card: {
      bearingBefore: before.cardBearing,
      bearingAfter: after.cardBearing,
      turnedRad: +Math.abs(after.cardBearing - before.cardBearing).toFixed(4),
      turned: before.cardBearing !== after.cardBearing,
    },
    board: {
      inkBefore: before.boardInk,
      inkAfter: after.boardInk,
      textureVersionBefore: before.boardTextureVersion,
      textureVersionAfter: after.boardTextureVersion,
      // THE BUG: this was false. The board's pixels never changed.
      repainted: before.boardInk !== after.boardInk,
    },
    control: { cardStill: true, boardStill: true },
    bothTurn: before.cardBearing !== after.cardBearing && before.boardInk !== after.boardInk,
  };
  fs.writeFileSync(path.join(OUT, 'sign-both.json'), JSON.stringify(report, null, 2));
  assert(report.card.turned, 'the interior card did not turn');
  assert(report.board.repainted,
    'THE EXTERIOR BOARD DID NOT REPAINT — this is the shipped defect, unfixed.');
  return report;
}
