async (page) => {
  // A2 — "THE SIGN DOES NOT VISUALLY FLIP, AND IT SHIPPED WITH A PASSING TEST."
  //
  // The shipped test asserts SOURCE TEXT in clubhouse.js. It cannot tell a
  // running swing from a dead one, which is why it was green while the card
  // snapped. This driver samples the sign's actual world orientation every
  // animation frame across a real E press and reports how many distinct
  // orientations the card passed through.
  //
  // A turn that renders shows a spread of intermediate angles. A snap shows two.
  //
  // Negative control: the same sampler runs first with NO flip. If it reports
  // motion while nothing is happening, or fails to find the sign at all, the
  // measurement below means nothing.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/shop-sign');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1280, height: 720 };
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
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

  // Stand in front of the sign and look at it.
  const placed = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const sign = clubhouse.interior.getObjectByName('ClubhouseOpenClosedSign');
    if (!sign) return { found: false };
    clubhouse.interior.updateMatrixWorld(true);
    const world = sign.getWorldPosition(new THREE.Vector3());
    const walk = app.scene3d.walk.state;
    // Step off the wall INTO THE ROOM. Which way that is depends on the
    // interior's yaw, so walk the candidates and take the first one the game
    // itself agrees is inside — guessing -Z put the player out on the porch.
    // …and take the candidate the room's own inside test accepts which lies
    // DEEPEST into the room. Taking the first accepted angle put the player out
    // on the porch, where the dead porch light owns the prompt.
    const inside = clubhouse.isInside;
    const centre = clubhouse.center;
    let stand = null;
    let bestToCentre = Infinity;
    for (let step = 0; step < 32; step += 1) {
      const angle = (step / 32) * Math.PI * 2;
      const x = world.x + Math.sin(angle) * 1.05;
      const z = world.z + Math.cos(angle) * 1.05;
      if (!inside(x, z, 0)) continue;
      const toCentre = Math.hypot(x - centre.x, z - centre.z);
      if (toCentre < bestToCentre) { bestToCentre = toCentre; stand = { x, z }; }
    }
    if (!stand) return { found: false, reason: 'no interior standing point beside the sign' };
    walk.x = stand.x;
    walk.z = stand.z;
    const dx = world.x - walk.x;
    const dz = world.z - walk.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    // pitch against the LIVE eye height — the sign's world Y sits on terrain,
    // not on an assumed 1.62, and an assumed one aimed the player past it
    walk.pitch = Math.atan2(world.y - app.scene3d.camera.position.y, horizontal);
    return {
      found: true,
      world: { x: +world.x.toFixed(3), y: +world.y.toFixed(3), z: +world.z.toFixed(3) },
    };
  });
  assert(placed.found, 'the sign object ClubhouseOpenClosedSign is not in the interior');
  await page.waitForTimeout(900);

  // The E press must actually be aimed at the sign. Without this the driver
  // measures a card nobody flipped and calls it a snap.
  await page.waitForFunction(() => (
    /Door sign/.test(window.__fw.scene3d.walk.getFocusLabel() || '')
  ), null, { timeout: 10000 }).catch(async () => {
    const why = await page.evaluate(async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const c = app.scene3d.clubhouse();
      const sign = c.interior.getObjectByName('ClubhouseOpenClosedSign');
      const world = sign.getWorldPosition(new THREE.Vector3());
      const walk = app.scene3d.walk.state;
      return {
        label: app.scene3d.walk.getFocusLabel(),
        focus: app.scene3d.walk.getFocus(),
        walk: {
          x: +walk.x.toFixed(2), z: +walk.z.toFixed(2),
          yaw: +walk.yaw.toFixed(3), pitch: +walk.pitch.toFixed(3),
          active: app.scene3d.walk.isActive(),
        },
        signWorld: world.toArray().map((v) => +v.toFixed(2)),
        eyeY: +app.scene3d.camera.position.y.toFixed(2),
        distance: +Math.hypot(world.x - walk.x, world.z - walk.z).toFixed(2),
        inside: c.isInside(walk.x, walk.z, 0),
      };
    });
    throw new Error(`the sign prompt never appeared: ${JSON.stringify(why)}`);
  });
  const promptBefore = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());

  // Sample the sign's world orientation once per animation frame.
  const sampleFrames = (ms) => page.evaluate(async (durationMs) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    const sign = clubhouse.interior.getObjectByName('ClubhouseOpenClosedSign');
    if (!sign) return { found: false, samples: [] };
    const samples = [];
    const forward = new THREE.Vector3();
    const started = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        sign.updateWorldMatrix(true, false);
        // the direction the OPEN face actually points, in world space — this is
        // what the player sees, not a local euler nobody renders
        forward.set(0, 0, 1).applyQuaternion(sign.getWorldQuaternion(new THREE.Quaternion()));
        samples.push({
          atMs: +(performance.now() - started).toFixed(1),
          localYaw: +sign.rotation.y.toFixed(4),
          bearing: +Math.atan2(forward.x, forward.z).toFixed(4),
        });
        if (performance.now() - started >= durationMs) {
          resolve({ found: true, samples });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, ms);

  const spread = (samples) => {
    const bearings = samples.map((s) => s.bearing);
    const distinct = [...new Set(bearings.map((b) => b.toFixed(3)))];
    return {
      frames: samples.length,
      distinctBearings: distinct.length,
      first: bearings[0],
      last: bearings[bearings.length - 1],
      // how far the card actually travelled, summed frame to frame
      travelRad: +bearings.reduce((total, value, index) => (
        index === 0 ? 0 : total + Math.abs(value - bearings[index - 1])
      ), 0).toFixed(4),
    };
  };

  // ---- negative control: nothing is flipping, so nothing may move ----------
  const idle = await sampleFrames(600);
  assert(idle.found, 'the sampler lost the sign');
  const idleSpread = spread(idle.samples);
  assert(idleSpread.frames > 20,
    `NEGATIVE CONTROL FAILED: only ${idleSpread.frames} frames sampled — the page is not animating, so a still sign proves nothing.`);
  assert(idleSpread.distinctBearings === 1,
    `NEGATIVE CONTROL FAILED: the sign moved ${idleSpread.travelRad} rad while nothing flipped it (${idleSpread.distinctBearings} distinct bearings).`);

  await shot('01-before-flip.png');

  // ---- the flip itself ------------------------------------------------------
  const before = await page.evaluate(() => ({
    open: window.__fw.state.shop.signOpen,
  }));
  const sampling = sampleFrames(1400);
  await page.waitForTimeout(120);
  await page.keyboard.press('e');
  const flipping = await sampling;
  const flipSpread = spread(flipping.samples);
  await shot('02-after-flip.png');
  const after = await page.evaluate(() => ({
    open: window.__fw.state.shop.signOpen,
  }));

  assert(before.open !== after.open,
    `The E press did not flip the sign at all (prompt was "${promptBefore}") — nothing was measured.`);

  const report = {
    sign: placed.world,
    prompt: promptBefore,
    idle: idleSpread,
    flip: flipSpread,
    stateBefore: before.open,
    stateAfter: after.open,
    eDidFlipTheState: before.open !== after.open,
    // A snap lands on exactly two bearings: the old one and the new one.
    // A rendered 0.28 s swing at 60 Hz should show roughly 17 intermediates.
    intermediateBearings: flipSpread.distinctBearings - 2,
    verdict: flipSpread.distinctBearings > 4 ? 'TURNS' : 'SNAPS',
  };
  fs.writeFileSync(path.join(OUT, 'sign-turn.json'), JSON.stringify(report, null, 2));
  return report;
}
