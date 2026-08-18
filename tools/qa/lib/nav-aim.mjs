// AIM AT THE PEOPLE, AND PROVE THEY WERE IN FRAME.
//
// The first cut of the nav watch turned by a fixed 420 px and recorded five
// minutes of the ceiling and the back-office desk with not one customer in shot
// (qa/nav/before, tiles-13). That is the same fault that parked the D6 driver,
// and a clip of the wrong thing is worse than no clip because it invites a
// verdict. Lifted out of that driver so every nav clip from here on aims the
// same way and carries the same gate, rather than each one growing its own.
//
// The projection is done by hand rather than by importing THREE: the page's
// import map owns `three` and a driver cannot reach it. Camera matrices are the
// live ones, refreshed per call, because a cached matrixWorld is a lie the
// moment the player turns.

// Calibrated on this machine under pointer lock; see the goal-33 aiming notes.
export const YAW_PER_PX = -0.001927;
export const PITCH_PER_PX = -0.0019;

export async function installAim(page) {
  await page.evaluate(() => {
    window.__navAim = {
      project(x, y, z) {
        const cam = window.__fw.scene3d.camera;
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        const v = cam.matrixWorldInverse.elements;
        const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
        const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
        const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
        const p = cam.projectionMatrix.elements;
        const ax = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
        const ay = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
        const aw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        if (!aw || aw <= 0) return null;
        return { ndcX: ax / aw, ndcY: ay / aw };
      },
      // how many visible customers project inside the frame, right now
      onScreen() {
        const ch = window.__fw.scene3d.clubhouse();
        let n = 0;
        for (const c of (ch.customers() || [])) {
          if (!c.mesh || c.mesh.visible === false) continue;
          const p = this.project(c.mesh.position.x, c.mesh.position.y + 1.0, c.mesh.position.z);
          if (p && Math.abs(p.ndcX) < 0.95 && Math.abs(p.ndcY) < 0.95) n += 1;
        }
        return n;
      },
      centroid() {
        const ch = window.__fw.scene3d.clubhouse();
        const live = (ch.customers() || []).filter((c) => c.mesh && c.mesh.visible !== false);
        if (!live.length) return null;
        let x = 0;
        let z = 0;
        for (const c of live) { x += c.mesh.position.x; z += c.mesh.position.z; }
        return { x: x / live.length, y: live[0].mesh.position.y + 0.9, z: z / live.length, n: live.length };
      },
    };
  });
}

/** Turn the player until at least two customers are on screen. */
export async function aimAtPeople(page, vp, tries = 6) {
  const cx = Math.round(vp.w / 2);
  const cy = Math.round(vp.h / 2);
  for (let i = 0; i < tries; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const t = await page.evaluate(() => {
      const A = window.__navAim;
      const p = A.centroid();
      if (!p) return null;
      const w = window.__fw.scene3d.walk.state;
      const cam = window.__fw.scene3d.camera;
      const d = Math.hypot(p.x - w.x, p.z - w.z);
      let dy = Math.atan2(-(p.x - w.x), -(p.z - w.z)) - w.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      return { dy, dp: Math.atan2(p.y - cam.position.y, d) - w.pitch, onScreen: A.onScreen(), n: p.n };
    });
    if (!t) return { ok: false, why: 'nobody visible to aim at' };
    if (t.onScreen >= Math.min(2, t.n) && Math.abs(t.dy) < 0.35) {
      return { ok: true, iters: i, onScreen: t.onScreen };
    }
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(cx, cy);
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(
      cx + Math.round(Math.max(-1400, Math.min(1400, t.dy / YAW_PER_PX))),
      cy + Math.round(Math.max(-350, Math.min(350, t.dp / PITCH_PER_PX))),
      { steps: 14 },
    );
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(220);
  }
  return { ok: false, why: 'aim did not converge' };
}

/** Turn the player to face a world point. */
export async function aimAtPoint(page, vp, point, tries = 4) {
  const cx = Math.round(vp.w / 2);
  const cy = Math.round(vp.h / 2);
  for (let i = 0; i < tries; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const t = await page.evaluate((p) => {
      const w = window.__fw.scene3d.walk.state;
      let dy = Math.atan2(-(p.x - w.x), -(p.z - w.z)) - w.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      return { dy, dp: -w.pitch };
    }, point);
    if (Math.abs(t.dy) < 0.08) return { ok: true, iters: i };
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(cx, cy);
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(
      cx + Math.round(Math.max(-1400, Math.min(1400, t.dy / YAW_PER_PX))),
      cy + Math.round(Math.max(-350, Math.min(350, t.dp / PITCH_PER_PX))),
      { steps: 14 },
    );
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(220);
  }
  return { ok: false, why: 'aim did not converge' };
}

// WALK IN FROM WHEREVER THE SAVE LEFT HIM.
//
// getInside below holds W six times and hopes. That was written against a save
// that spawns on the porch facing the door; a played save can leave the player
// anywhere on the property facing any direction, and then six legs of W walk
// into a wall and the driver reports "never got inside" with every indoor row
// below it already recorded (qa/goal34/base1.json, row 01).
//
// TWO THINGS THAT DID NOT WORK, BOTH RECORDED SO THE THIRD IS NOT A FOURTH
// GUESS. Aiming at the interior's world centre is a heading into a wall from
// outside (14 legs, 7.6 yd, never in). Aiming at the node whose name matches
// the main entrance found `ProceduralMainEntranceFallback` — the HIDDEN stand-in
// that only shows when the authored door fails to bind, sitting at the group
// origin — so that was the same wrong heading with a better name on it, and the
// per-leg distances showed it: 5.48, 2.20, 0.10, 0.83, 0.46 …, a body leaning on
// a collider.
//
// So: prefer a door node that is actually VISIBLE, and when a leg makes no
// ground, strafe CONSISTENTLY in one direction rather than alternating. One
// direction follows the wall around until the opening turns up; alternating
// just rocks against the same brick.
export async function walkInsideClubhouse(page, vp, legs = 26) {
  const target = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse?.();
    if (!ch?.interior) return null;
    const V = s3.camera.position.constructor;
    const centre = ch.interior.getWorldPosition(new V());
    let best = null;
    s3.scene.traverse((o) => {
      if (!/mainentrance|front.?door|entrance.?door/i.test(o.name || '')) return;
      let vis = true;
      for (let p = o; p; p = p.parent) { if (!p.visible) { vis = false; break; } }
      if (!vis) return; // the procedural fallback is hidden when the real door bound
      const p = o.getWorldPosition(new V());
      const d = Math.hypot(p.x - centre.x, p.z - centre.z);
      if (!best || d > best.d) best = { x: p.x, y: p.y, z: p.z, d, name: o.name };
    });
    return {
      door: best,
      centre: { x: centre.x, y: centre.y, z: centre.z },
    };
  });
  const where = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse?.();
    return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), inside: ch?.isInside ? !!ch.isInside(w.x, w.z) : false };
  });
  const start = await where();
  if (!target) return { ok: start.inside, why: 'no clubhouse interior to aim at', start };
  const aim = target.door || target.centre;
  const startDist = Math.hypot(aim.x - start.x, aim.z - start.z);
  const trail = [];
  let strafe = 'a';
  for (let leg = 0; leg < legs; leg += 1) {
    // eslint-disable-next-line no-await-in-loop
    const at = await where();
    if (at.inside) {
      return {
        ok: true,
        legs: leg,
        start,
        startDist: +startDist.toFixed(1),
        door: target.door ? target.door.name : '(interior centre)',
        trail,
      };
    }
    // The doorway is the waypoint, the room is the destination: aiming at the
    // room from outside walks into a wall, aiming at the door once you are
    // standing in it turns you around.
    const toDoor = target.door ? Math.hypot(target.door.x - at.x, target.door.z - at.z) : Infinity;
    const goal = toDoor > 4 ? aim : target.centre;
    const blocked = trail.length >= 1 && trail[trail.length - 1].moved < 0.6;
    // Three blocked legs in a row means this wall is not the one with the door
    // in it; turn the search the other way rather than grind along it forever.
    const grinding = trail.length >= 3 && trail.slice(-3).every((t) => t.moved < 0.6);
    if (grinding) strafe = strafe === 'a' ? 'd' : 'a';
    trail.push({ x: at.x, z: at.z, moved: 0, strafed: blocked ? strafe : null });
    // eslint-disable-next-line no-await-in-loop
    await aimAtPoint(page, vp, goal);
    // A SHUT DOOR IS NOT A WALL, AND IT ANSWERS TO E. Standing 8 yd from
    // SOCKET_MainEntrance and circling the building for 26 legs without getting
    // in is what a closed leaf looks like from the outside.
    if (blocked && toDoor < 4.5) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('e');
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(700);
    }
    if (blocked) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.down(strafe);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(1400);
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.up(strafe);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(250);
    }
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.down('w');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1500);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.up('w');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(350);
    // eslint-disable-next-line no-await-in-loop
    const after = await where();
    trail[trail.length - 1].moved = +Math.hypot(after.x - at.x, after.z - at.z).toFixed(2);
  }
  const end = await where();
  return {
    ok: end.inside,
    legs,
    start,
    end,
    startDist: +startDist.toFixed(1),
    door: target.door ? target.door.name : '(interior centre)',
    trail,
  };
}

/** Boot, walk in through the front door, and stop when the room is underfoot. */
export async function getInside(page, out = {}) {
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);
  for (let leg = 0; leg < 6; leg += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.down('w');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(leg === 0 ? 6500 : 1800);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.up('w');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(600);
    // eslint-disable-next-line no-await-in-loop
    out.inside = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse?.();
      return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
    });
    if (out.inside) break;
  }
  return { vp, inside: !!out.inside };
}
