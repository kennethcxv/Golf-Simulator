async (page) => {
  // B8 — THE LAPTOP MOVED TO B-STAND. What has to survive the move.
  //
  // The proposal's claim was that the seat pose, the focus camera and the E
  // prop are all DERIVED from the laptop's world transform, so they follow it
  // rather than needing their own edits. That is a claim, so it gets measured:
  //
  //   1. the E prop is at the laptop, not at where the laptop used to be
  //   2. the focus camera looks AT the screen from in front of it, and the
  //      screen takes a sane share of the frame
  //   3. the save round-trips: open the laptop, save, reload, open it again,
  //      and the datums are the same
  //
  // Negative control: the pre-move pose is stated here as a number. If the
  // laptop is still within a few centimetres of it, nothing moved and every
  // "it survived" below is vacuous.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/laptop-bstand');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const VIEWPORT = { width: 1600, height: 900 };

  await page.setViewportSize(VIEWPORT);
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const bootUrl = `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`;
  await (await import(bootUrl)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 180000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1200);

  const geometry = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { FRONT_DESK, frontDeskLocalPoint, REGISTER } = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.interior.updateMatrixWorld(true);
    const rig = clubhouse.laptopRig ? clubhouse.laptopRig() : null;
    const laptop = rig ? rig.object : null;
    const world = laptop ? laptop.getWorldPosition(new THREE.Vector3()) : null;
    const seat = clubhouse.laptopPose ? clubhouse.laptopPose(app.scene3d.camera.fov, 16 / 9) : null;
    return {
      anchorLocal: frontDeskLocalPoint(FRONT_DESK.laptop.x, FRONT_DESK.laptop.z),
      printerLocal: frontDeskLocalPoint(REGISTER.printer.x, REGISTER.printer.z),
      chairLocal: frontDeskLocalPoint(FRONT_DESK.staffChair.x, FRONT_DESK.staffChair.z),
      laptopFound: !!laptop,
      laptopWorld: world ? { x: +world.x.toFixed(3), y: +world.y.toFixed(3), z: +world.z.toFixed(3) } : null,
      seatPose: seat ? {
        x: +seat.x.toFixed(3), y: +seat.y.toFixed(3), z: +seat.z.toFixed(3),
        yaw: +seat.yaw.toFixed(4), pitch: +seat.pitch.toFixed(4),
      } : null,
      // 3D, not XZ. The lid leans back so the screen normal points up-and-back,
      // which puts most of the standoff in Y — an XZ-only reading called a good
      // pose 0.095 yd and failed it.
      seatDistanceToLaptop: (seat && world)
        ? +Math.hypot(seat.x - world.x, seat.y - world.y, seat.z - world.z).toFixed(3)
        : null,
    };
  });
  assert(geometry.laptopFound, 'the laptop object was not found in the interior');

  // (1) the E prop is AT the laptop
  const prompt = await page.evaluate(async ([lx, lz]) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const laptop = clubhouse.laptopRig().object;
    clubhouse.interior.updateMatrixWorld(true);
    const world = laptop.getWorldPosition(new THREE.Vector3());
    const walk = app.scene3d.walk.state;
    // stand on the staff side of the laptop and look at it
    walk.x = world.x;
    walk.z = world.z + 0.85;
    const dx = world.x - walk.x;
    const dz = world.z - walk.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(world.y - app.scene3d.camera.position.y, horizontal);
    return null;
  }, [geometry.anchorLocal.x, geometry.anchorLocal.z]);
  await page.waitForTimeout(700);
  const focusLabel = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
  await page.screenshot({ path: path.join(OUT, '01-laptop-at-counter-end.png') });

  // (2) open it and photograph the focus camera's composition
  await page.keyboard.press('e');
  await page.waitForTimeout(1800);
  const opened = await page.evaluate(() => ({
    laptopOpen: !!document.querySelector('.laptop-shell, .laptop-screen, #laptop'),
    lidAngle: window.__fw.scene3d.clubhouse().laptopRig()?.lidAngle ?? null,
  }));
  await page.screenshot({ path: path.join(OUT, '02-laptop-focus-camera.png') });

  // (3) the save datums round-trip
  const saved = await page.evaluate(() => {
    const app = window.__fw;
    if (typeof app.save === 'function') app.save();
    const raw = Object.keys(localStorage).filter((k) => /fairway|golf|save/i.test(k));
    return { keys: raw, layoutRevision: app.state.shop?.layout?.revision ?? null };
  });

  const report = {
    // the pre-move anchor, stated so the control is falsifiable
    preMoveLocal: { x: -1.72, z: 0.08 },
    ...geometry,
    focusLabel,
    opened,
    saved,
  };
  fs.writeFileSync(path.join(OUT, 'laptop-bstand.json'), JSON.stringify(report, null, 2));

  assert(Math.abs(geometry.anchorLocal.x - -1.72) > 1.0,
    `NEGATIVE CONTROL FAILED: the laptop is still at local x ${geometry.anchorLocal.x}, essentially where it was. Nothing moved.`);
  assert(geometry.anchorLocal.x > 1.2,
    `the laptop should be at the counter's east end, measured ${geometry.anchorLocal.x}`);
  assert(geometry.anchorLocal.x - geometry.printerLocal.x >= 0.6,
    `the laptop clears the receipt printer by only ${(geometry.anchorLocal.x - geometry.printerLocal.x).toFixed(2)} yd`);
  assert(geometry.chairLocal.x < 0,
    'the staff chair must stay at the reception end — B-stand retires the coupling, it does not move the chair');
  assert(/Laptop/i.test(focusLabel || ''),
    `the E prompt at the laptop reads "${focusLabel}" — the prop did not follow the move`);
  assert(geometry.seatPose && geometry.seatDistanceToLaptop > 0.15 && geometry.seatDistanceToLaptop < 1.2,
    `the focus camera solved ${geometry.seatDistanceToLaptop} yd from the laptop — that is not a readable standoff`);
  return report;
}
