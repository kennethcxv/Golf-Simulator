// D6 — THE TWO CHARACTER FAULTS, PHOTOGRAPHED FROM THE ANGLE HE REPORTED THEM.
//
// "Stomachs detach and pump while walking; eyebrows and moustaches float in
//  front of the face in profile. Both reported, both open."
//
// Both were worked in an earlier session — characterAsset.js quotes the
// complaint verbatim at line 228 and reseats the features "<=2 mm proud", and
// the stomach's bob multiplier is at line 796. They are still on his list, which
// is the found-false shape: fixed against a check, false in his hands. So this
// takes the pictures at the angles the complaint names, and the pictures are the
// verdict.
//
//   PROFILE  stand beside a customer who is standing still (a queuer faces the
//            desk, so their side is presented to anyone beside the line), aim at
//            head height, close.
//   WALKING  aim at the torso of somebody crossing the floor and hold the shot
//            through several strides.
//
// The instrument's control is the framing itself: the subject's head is
// projected into the frame and required on screen before the shutter, because a
// D6 verdict from a photograph of the wrong thing is worse than no verdict.
//
// STATUS 2026-08-17: PARKED, AND NOT YET AN ACCEPTANCE. The driver runs and the
// aim reports success, but success is measured as "the subject projects inside
// the frame", which a subject six yards away behind a half-open door also
// satisfies. Both attempts photographed the doorway: walkTo() has no
// pathfinding, so it could not reach the standing spot beside the subject and
// left the player in the door. What this needs before it can answer D6 is an
// approach that routes (or a subject chosen for having clear floor around it)
// plus a framing gate on how much of the frame the head FILLS, not merely
// whether it is inside it. Issuing a D6 verdict from those frames would be
// exactly the "the probe said clean" failure this goal exists to stop.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<profile> \
//   node tools/qa/run-electron.cjs tools/qa/goal33-d6-character-faults.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'd6', errs: [], failures: [], shots: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const cont = [...document.querySelectorAll('button')]
        .find((b) => /\bContinue\b/.test(b.querySelector('.menu-action-label')?.textContent || b.textContent || ''));
      return !!(cont && !cont.disabled);
    }, null, { timeout: 90000 });
  }
  const how = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  if (process.env.QA_RESUME && how !== 'continue') throw new Error(`seeded profile did not resume: ${how}`);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1200);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__p0 = {
      project(x, y, z) {
        const cam = window.__fw.scene3d.camera;
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        const v = cam.matrixWorldInverse.elements;
        const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
        const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
        const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
        const p = cam.projectionMatrix.elements;
        const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
        const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
        const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        if (!cw) return null;
        return { ndcX: cx / cw, ndcY: cy / cw, behind: cw <= 0 };
      },
    };
  });

  const yawPerPx = -0.001927;
  const pitchPerPx = -0.0019;
  const cx = Math.round(vp.w / 2);
  const cy = Math.round(vp.h / 2);
  const lookAt = async (pt) => {
    for (let i = 0; i < 8; i += 1) {
      const t = await page.evaluate((p) => {
        const w = window.__fw.scene3d.walk.state;
        const cam = window.__fw.scene3d.camera;
        const d = Math.hypot(p.x - w.x, p.z - w.z);
        let dy = Math.atan2(-(p.x - w.x), -(p.z - w.z)) - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        const pr = window.__p0.project(p.x, p.y, p.z);
        return {
          dy, dp: Math.atan2(p.y - cam.position.y, d) - w.pitch, d,
          ndcX: pr?.ndcX ?? null, ndcY: pr?.ndcY ?? null, behind: pr?.behind ?? true,
        };
      }, pt);
      if (!t.behind && Math.abs(t.ndcX) < 0.2 && Math.abs(t.ndcY) < 0.35) {
        return { ok: true, iters: i, dist: +t.d.toFixed(2) };
      }
      await page.mouse.move(cx, cy);
      await page.mouse.move(
        cx + Math.round(Math.max(-1200, Math.min(1200, t.dy / yawPerPx))),
        cy + Math.round(Math.max(-400, Math.min(400, t.dp / pitchPerPx))),
        { steps: 12 },
      );
      await page.waitForTimeout(140);
    }
    return { ok: false };
  };
  const walkTo = async (target, within = 0.7, tries = 14) => {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const st = await page.evaluate((t) => {
        const w = window.__fw.scene3d.walk.state;
        const dx = t.x - w.x;
        const dz = t.z - w.z;
        let dy = Math.atan2(-dx, -dz) - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        return { dist: Math.hypot(dx, dz), dYaw: dy };
      }, target);
      if (st.dist < within) return { ok: true, dist: +st.dist.toFixed(2) };
      await page.mouse.move(cx, cy);
      await page.mouse.move(cx + Math.round(Math.max(-1200, Math.min(1200, st.dYaw / yawPerPx))), cy, { steps: 10 });
      await page.waitForTimeout(110);
      await page.keyboard.down('w');
      await page.waitForTimeout(Math.min(1300, Math.max(150, st.dist * 600)));
      await page.keyboard.up('w');
      await page.waitForTimeout(180);
    }
    return { ok: false };
  };

  // walk inside
  for (let leg = 0; leg < 4; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6000 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(500);
    const inside = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse();
      return ch.isInside ? ch.isInside(w.x, w.z) : false;
    });
    if (inside) break;
  }

  // ---- find a customer standing still, and a spot at their SIDE -----------
  const findStill = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    let best = null;
    for (const c of ch.customers()) {
      if (!c.mesh || c.mesh.visible === false) continue;
      const speed = Math.hypot(c.vx || 0, c.vz || 0);
      if (speed > 0.25) continue;
      const yaw = c.mesh.rotation.y;
      // Their side: perpendicular to the way they are facing.
      const sx = Math.cos(yaw);
      const sz = -Math.sin(yaw);
      const stand = 2.2;
      if (!best || speed < best.speed) {
        best = {
          id: c.customerId,
          speed,
          head: { x: c.mesh.position.x, y: c.mesh.position.y + 1.55, z: c.mesh.position.z },
          side: { x: c.mesh.position.x + sx * stand, z: c.mesh.position.z + sz * stand },
          sideOther: { x: c.mesh.position.x - sx * stand, z: c.mesh.position.z - sz * stand },
        };
      }
    }
    return best;
  });
  let still = null;
  const hunt = Date.now();
  while (!still && Date.now() - hunt < 300000) {
    still = await findStill();
    if (!still) await page.waitForTimeout(2000);
  }
  out.profileSubject = still ? { id: still.id, speed: +still.speed.toFixed(3) } : null;
  if (!still) { fail('nobody stood still long enough to photograph in profile'); return out; }

  // stand beside them, whichever side is easier to reach
  const here = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z };
  });
  const dA = Math.hypot(still.side.x - here.x, still.side.z - here.z);
  const dB = Math.hypot(still.sideOther.x - here.x, still.sideOther.z - here.z);
  out.walkToSide = await walkTo(dA <= dB ? still.side : still.sideOther, 0.9);
  const fresh = await findStill();
  const head = (fresh && fresh.id === still.id) ? fresh.head : still.head;
  out.aimProfile = await lookAt(head);
  await page.waitForTimeout(500);
  const profileShot = path.join(OUT, `d6-profile-${out.tag}.png`);
  await page.screenshot({ path: profileShot });
  out.shots.push(profileShot);
  if (!out.aimProfile.ok) fail('could not frame the head for the profile shot');

  // ---- and a walker, held through several strides -------------------------
  const findWalker = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    let best = null;
    for (const c of ch.customers()) {
      if (!c.mesh || c.mesh.visible === false) continue;
      const speed = Math.hypot(c.vx || 0, c.vz || 0);
      if (speed < 0.4) continue;
      if (!best || speed > best.speed) {
        best = {
          id: c.customerId, speed,
          torso: { x: c.mesh.position.x, y: c.mesh.position.y + 1.05, z: c.mesh.position.z },
        };
      }
    }
    return best;
  });
  let walker = null;
  const hunt2 = Date.now();
  while (!walker && Date.now() - hunt2 < 180000) {
    walker = await findWalker();
    if (!walker) await page.waitForTimeout(700);
  }
  out.walkSubject = walker ? { id: walker.id, speed: +walker.speed.toFixed(2) } : null;
  if (walker) {
    for (let shot = 0; shot < 3; shot += 1) {
      const live = await findWalker();
      const t = (live && live.id === walker.id) ? live.torso : walker.torso;
      await lookAt(t);
      const f = path.join(OUT, `d6-walking-${out.tag}-${shot}.png`);
      await page.screenshot({ path: f });
      out.shots.push(f);
      await page.waitForTimeout(420);
    }
  } else {
    fail('nobody walked during the window, so the stomach cannot be photographed in motion');
  }

  fs.writeFileSync(path.join(OUT, `d6-character-${out.tag}.json`), JSON.stringify(out, null, 2));
  console.log('D6', JSON.stringify({
    profileSubject: out.profileSubject,
    aimProfile: out.aimProfile,
    walkSubject: out.walkSubject,
    shots: out.shots,
    failures: out.failures,
  }, null, 2));
  return out;
}
