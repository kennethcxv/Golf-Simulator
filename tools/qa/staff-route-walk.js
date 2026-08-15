// C5 — WALK it, with real keys, and photograph the three moments.
//
// The grid sweep in staff-route-measure.js proves a route exists in the
// collider set. It does not prove the player's own movement code can follow it:
// walkTryMove is axis-separated and slides along walls, and the stuck monitor
// can shove a body sideways. So this drives genuine keydown/keyup, steers with
// the same yaw the player would, and reports where the body actually ended up.
//
// Photographs: at the door looking in, inside the pass-through, and standing at
// the till looking at the register.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/staff-route');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 240000 });
  await page.waitForTimeout(4500);

  // Start just inside the main door, in world space.
  const start = await page.evaluate(async () => {
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.state.x = L.DOOR_MAIN.x + origin.x;
    walk.state.z = L.PUBLIC_ROOM_BOUNDS.maxZ - 0.75 + origin.z;
    walk.state.yaw = 0;
    walk.state.pitch = -0.02;
    return {
      origin: { x: origin.x, z: origin.z },
      at: { x: walk.state.x - origin.x, z: walk.state.z - origin.z },
      staffStand: L.COUNTER.staffStand,
      counterTop: L.COUNTER_TOP,
      register: L.REGISTER.cardterm,
    };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'walk-1-at-the-door.png') });

  // Steer toward each waypoint and hold W until it is reached (or we give up).
  // Waypoints, not a straight line: with the main doors OPEN their leaves stand
  // in the room beside the pass-through mouth, and a driver that steers straight
  // at (0.45, 4.30) walks the player into the east leaf and stops there. A
  // person steps around their own door; so does this.
  const legs = [
    { x: 0.10, z: 3.60, shot: null },
    { x: 0.80, z: 4.30, shot: null },
    { x: 1.45, z: 4.28, shot: 'walk-2-in-the-pass-through.png' },
    { x: 3.20, z: 4.25, shot: null },
  ];
  const trace = [];
  for (const leg of legs) {
    for (let tick = 0; tick < 70; tick += 1) {
      const done = await page.evaluate(({ tx, tz }) => {
        const app = window.__fw;
        const origin = app.scene3d.clubhouse().interior.position;
        const walk = app.scene3d.walk;
        const dx = (tx + origin.x) - walk.state.x;
        const dz = (tz + origin.z) - walk.state.z;
        const dist = Math.hypot(dx, dz);
        // Forward is (-sin yaw, -cos yaw) — courseScene's own aim probes use it
        // (walk.x - sin(yaw)*ahead). The mirrored guess walked the player out of
        // the door instead of into the room, which is how it was caught.
        walk.state.yaw = Math.atan2(-dx, -dz);
        return { dist, x: walk.state.x - origin.x, z: walk.state.z - origin.z };
      }, { tx: leg.x, tz: leg.z });
      trace.push({ x: +done.x.toFixed(2), z: +done.z.toFixed(2), d: +done.dist.toFixed(2) });
      if (done.dist < 0.22) break;
      await page.keyboard.down('w');
      await page.waitForTimeout(150);
      await page.keyboard.up('w');
      await page.waitForTimeout(20);
    }
    if (leg.shot) await page.screenshot({ path: path.join(OUT, leg.shot) });
  }

  // Face the register from wherever the body actually ended up.
  const finish = await page.evaluate(async () => {
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    const dx = (L.REGISTER.cardterm.x + origin.x) - walk.state.x;
    const dz = (L.REGISTER.cardterm.z + origin.z) - walk.state.z;
    walk.state.yaw = Math.atan2(-dx, -dz);
    walk.state.pitch = -0.30;
    return {
      landed: { x: +(walk.state.x - origin.x).toFixed(2), z: +(walk.state.z - origin.z).toFixed(2) },
      target: L.COUNTER.staffStand,
      focus: app.scene3d.walk.getFocusLabel ? app.scene3d.walk.getFocusLabel() : null,
    };
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'walk-3-behind-the-till.png') });
  const focusAfter = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());

  const reached = Math.hypot(finish.landed.x - finish.target.x, finish.landed.z - finish.target.z);
  return {
    start: start.at,
    landed: finish.landed,
    staffStand: finish.target,
    distanceFromStaffStand: +reached.toFixed(2),
    walkedBehindTheCounter: reached < 0.6,
    focusAtTill: focusAfter,
    traceSample: trace.filter((_, i) => i % 8 === 0).concat(trace.slice(-1)),
  };
}
