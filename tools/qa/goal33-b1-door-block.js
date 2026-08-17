// B1 — THE DELIBERATELY BLOCKED AGENT. "Watch it fail before you trust it."
//
// The five-minute watch found 100 stuck episodes and 354 ladder escalations in
// his shop, and the console named the shape:
//
//   visitor:3  nudge -> retarget -> skip   at (-360.79, 8.44) -> stop 'enter' (-360.80, 8.22)
//
// A walker escalating the entire recovery ladder to abandon a target 0.22 yd
// away. The arithmetic: arrival is `dist < 0.18`, and resolveCustomer holds
// every body 0.72 yd off the player. So a player standing within 0.90 yd of a
// stop makes that stop UNREACHABLE — not difficult, unreachable — and the
// walker grinds against the clamp until the ladder gives up. The player after
// walking in through his own front door stands exactly there.
//
// This driver stages that on purpose, with real input only:
//   1. resume his save, walk in through the door;
//   2. walk the player ONTO the 'enter' stop using WASD in a closed loop
//      (no teleport — the loop reads the achieved position back);
//   3. watch for 90 s and count what the entering customers do.
//
// RED (unfixed):  doorbells 0, ladder escalations climbing, nobody gets in.
// GREEN (fixed):  doorbells ring, escalations at the door stop.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<profile> \
//   node tools/qa/run-electron.cjs tools/qa/goal33-b1-door-block.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'door-block';
  const out = { tag, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const navLog = [];
  page.on('console', (m) => { const t = m.text(); if (t.includes('[customer-nav]')) navLog.push(t); });

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
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);

  // Where is the door stop? Read it from a live customer's own plan rather than
  // from a constant, so the driver cannot drift from the layout.
  const findEnterStop = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    for (const c of ch.customers()) {
      const s = (c.stops || []).find((st) => st.kind === 'enter');
      if (s) return { x: s.x, z: s.z };
    }
    return null;
  });
  let enterStop = await findEnterStop();
  // Nobody in the room yet: walk in first and look again.
  await page.keyboard.down('w');
  await page.waitForTimeout(6000);
  await page.keyboard.up('w');
  await page.waitForTimeout(700);
  if (!enterStop) enterStop = await findEnterStop();
  const t0wait = Date.now();
  while (!enterStop && Date.now() - t0wait < 180000) {
    await page.waitForTimeout(2000);
    enterStop = await findEnterStop();
  }
  out.enterStop = enterStop;
  if (!enterStop) { fail('no customer ever planned an enter stop — nothing to block'); return out; }
  console.log('ENTER STOP', JSON.stringify(enterStop));

  // ---- walk the player onto that spot with real keys -----------------------
  const yawPerPx = -0.001927; // calibrated in the B0 driver on this machine
  const stand = async () => {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const st = await page.evaluate((target) => {
        const w = window.__fw.scene3d.walk.state;
        const dx = target.x - w.x;
        const dz = target.z - w.z;
        const dist = Math.hypot(dx, dz);
        const wantYaw = Math.atan2(-dx, -dz);
        let dy = wantYaw - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        return { x: w.x, z: w.z, dist, dYaw: dy };
      }, enterStop);
      // 0.6 is enough to stage the block: the clamp is 0.72, so any stop inside
      // that disc is already unreachable. Demanding 0.35 failed the stage at
      // 0.49 and reported "not staged" about a perfectly blocked door.
      if (st.dist < 0.6) return { ok: true, attempts: attempt, dist: +st.dist.toFixed(2), x: +st.x.toFixed(2), z: +st.z.toFixed(2) };
      // face it, then step
      const px = Math.max(-1200, Math.min(1200, st.dYaw / yawPerPx));
      await page.mouse.move(Math.round(vp.w / 2), Math.round(vp.h / 2));
      await page.mouse.move(Math.round(vp.w / 2) + Math.round(px), Math.round(vp.h / 2), { steps: 10 });
      await page.waitForTimeout(120);
      await page.keyboard.down('w');
      await page.waitForTimeout(Math.min(1400, Math.max(180, st.dist * 700)));
      await page.keyboard.up('w');
      await page.waitForTimeout(220);
    }
    const st = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      return { x: +w.x.toFixed(2), z: +w.z.toFixed(2) };
    });
    return { ok: false, ...st };
  };
  out.standOnDoor = await stand();
  console.log('STAND', JSON.stringify(out.standOnDoor));
  if (!out.standOnDoor.ok) fail('could not walk the player onto the door stop; the block is not staged');

  // ---- watch what the arrivals do ------------------------------------------
  const before = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return {
      nav: ch.navBlockDiagnostics().total,
      // WHO had already rung before the block was staged. Counting the FLAG
      // rather than the transition credited the fix with customers who walked
      // in while the player was still walking to the door.
      bellIds: ch.customers().filter((c) => c.rangBell).map((c) => c.customerId),
      people: ch.customers().length,
      clock: window.__fw.state.clock?.minutes ?? null,
    };
  });
  const alreadyRang = new Set(before.bellIds);
  const navLogBefore = navLog.length;
  const WATCH_MS = Number(process.env.QA_WATCH_MS || 90000);
  const t0 = Date.now();
  const track = [];
  while (Date.now() - t0 < WATCH_MS) {
    const s = await page.evaluate((target) => {
      const ch = window.__fw.scene3d.clubhouse();
      const w = window.__fw.scene3d.walk.state;
      return {
        t: performance.now(),
        playerDistToStop: +Math.hypot(w.x - target.x, w.z - target.z).toFixed(2),
        nav: ch.navBlockDiagnostics().total,
        bodies: ch.customers().map((c) => ({
          id: c.customerId,
          stop: c.stops?.[c.stopIdx]?.kind ?? null,
          rangBell: !!c.rangBell,
          entered: !!c.entered,
          escalation: c.stuckEscalation || 0,
          distToStop: c.stops?.[c.stopIdx]
            ? +Math.hypot(c.stops[c.stopIdx].x - c.mesh.position.x, c.stops[c.stopIdx].z - c.mesh.position.z).toFixed(2)
            : null,
        })),
      };
    }, enterStop);
    track.push(s);
    await page.waitForTimeout(250);
  }
  const after = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return {
      nav: ch.navBlockDiagnostics().total,
      people: ch.customers().length,
      clock: window.__fw.state.clock?.minutes ?? null,
    };
  });
  const shot = path.join(OUT, `b1-doorblock-${tag}.png`);
  await page.screenshot({ path: shot });

  // How many DISTINCT customers got through the door while it was blocked, and
  // how close the nearest one got without arriving.
  const newBells = new Set();
  const sawEnterStop = new Set();
  let closestNonArrival = 99;
  for (const s of track) {
    for (const b of s.bodies) {
      if (b.stop === 'enter') sawEnterStop.add(b.id);
      if (b.rangBell && !alreadyRang.has(b.id)) newBells.add(b.id);
      if (!b.rangBell && b.stop === 'enter' && b.distToStop != null) {
        closestNonArrival = Math.min(closestNonArrival, b.distToStop);
      }
    }
  }
  const doorLines = navLog.slice(navLogBefore).filter((l) => l.includes('stop enter'));
  // THE ENVIRONMENT CONTROL. The five-minute watch was compromised once by the
  // sim clock advancing at two thirds of wall time, which freezes bodies and
  // reads as a room full of stuck customers. Expected advance is
  // BALANCE.gameMinutesPerRealSecond (4/30) per real second.
  const wallSeconds = (Date.now() - t0) / 1000;
  const gameMinutes = (after.clock ?? 0) - (before.clock ?? 0);
  const simHealth = +(gameMinutes / (wallSeconds * (4 / 30))).toFixed(3);
  let maxSampleGapMs = 0;
  for (let i = 1; i < track.length; i += 1) maxSampleGapMs = Math.max(maxSampleGapMs, track[i].t - track[i - 1].t);
  out.result = {
    tag,
    playerHeldAtStopDist: track.length ? track[track.length - 1].playerDistToStop : null,
    watchSeconds: Math.round(wallSeconds),
    simHealth, // 1.0 = the day ran at its proper rate
    maxSampleGapMs: Math.round(maxSampleGapMs),
    ladderEscalationsDuringWatch: after.nav - before.nav,
    doorLadderLines: doorLines.length,
    customersAtTheDoor: sawEnterStop.size,
    customersThatRangTheBellDuringWatch: newBells.size,
    closestNonArrivalYd: closestNonArrival === 99 ? null : closestNonArrival,
    peopleAtEnd: after.people,
    screenshot: shot,
  };
  if (simHealth < 0.8) fail(`sim ran at ${Math.round(simHealth * 100)}% of wall rate — this leg measures a stalled day, not the fix`);
  out.doorLinesSample = doorLines.slice(0, 8);
  fs.writeFileSync(path.join(OUT, `b1-door-block-${tag}.json`), JSON.stringify({ ...out, track: track.slice(0, 400) }, null, 2));
  console.log('DOORBLOCK', JSON.stringify(out.result, null, 2));
  console.log('DOOR LINES', JSON.stringify(out.doorLinesSample, null, 2));
  return out;
}
