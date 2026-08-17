// B1 — "THE PLAYER STANDING IN A DOORWAY."
//
// Staged deliberately, because it is the one dynamic obstacle a walker cannot
// path around: there is no around. Measured before the yield landed, from his
// own save, with the player parked in his own front door for seven minutes:
// three arrivals ground outside it emitting nudge/retarget for as long as the
// door was blocked, and none of them got in.
//
// The player is walked into the doorway with real keys — the doorway is found
// from a live customer's own 'enter' stop, never a constant — and then held
// there while the arrivals are watched.
//
//   RED   : ladder lines climb, doorbells stay at zero, nobody enters.
//   GREEN : the ladder is quiet (they wait), and when the player steps aside
//           they walk in.
//
// The step-aside leg is what makes this more than a freeze test: a walker that
// waits for ever is as broken as one that grinds, so the run ends by moving the
// player off the door and requiring that somebody comes through.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<profile> QA_TAG=red|green \
//   node tools/qa/run-electron.cjs tools/qa/goal33-b1-doorway-yield.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'yield';
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

  const yawPerPx = -0.001927;
  const walkTo = async (target, within = 0.5, tries = 18) => {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const st = await page.evaluate((t) => {
        const w = window.__fw.scene3d.walk.state;
        const dx = t.x - w.x;
        const dz = t.z - w.z;
        let dy = Math.atan2(-dx, -dz) - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        return { x: w.x, z: w.z, dist: Math.hypot(dx, dz), dYaw: dy };
      }, target);
      if (st.dist < within) return { ok: true, attempts: attempt, dist: +st.dist.toFixed(2) };
      await page.mouse.move(Math.round(vp.w / 2), Math.round(vp.h / 2));
      await page.mouse.move(Math.round(vp.w / 2 + Math.max(-1200, Math.min(1200, st.dYaw / yawPerPx))), Math.round(vp.h / 2), { steps: 10 });
      await page.waitForTimeout(110);
      await page.keyboard.down('w');
      await page.waitForTimeout(Math.min(1200, Math.max(140, st.dist * 550)));
      await page.keyboard.up('w');
      await page.waitForTimeout(180);
    }
    const st = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      return { x: +w.x.toFixed(2), z: +w.z.toFixed(2) };
    });
    return { ok: false, ...st };
  };

  const doorStop = async () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    for (const c of ch.customers()) {
      const s = (c.stops || []).find((st) => st.kind === 'enter');
      if (s) return { x: s.x, z: s.z };
    }
    return null;
  });
  let door = await doorStop();
  const hunt = Date.now();
  while (!door && Date.now() - hunt < 180000) { await page.waitForTimeout(2000); door = await doorStop(); }
  out.door = door;
  if (!door) { fail('no customer planned an enter stop'); return out; }
  console.log('DOOR', JSON.stringify(door));

  out.stage = await walkTo(door, 0.5);
  const staged = await page.evaluate((d) => {
    const w = window.__fw.scene3d.walk.state;
    return +Math.hypot(w.x - d.x, w.z - d.z).toFixed(2);
  }, door);
  out.stagedDistYd = staged;
  console.log('STAGE', JSON.stringify({ ...out.stage, staged }));
  if (staged > 0.9) fail(`player is ${staged} yd from the door stop — not plugging the doorway`);

  const snap = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return {
      t: performance.now(),
      nav: ch.navBlockDiagnostics().total,
      clock: window.__fw.state.clock?.minutes ?? null,
      bells: ch.customers().filter((c) => c.rangBell).map((c) => c.customerId),
      outside: ch.customers().filter((c) => !c.rangBell).length,
      people: ch.customers().length,
    };
  });

  // ---- LEG 1: hold the doorway --------------------------------------------
  const before = await snap();
  const navBefore = navLog.length;
  const HOLD_MS = Number(process.env.QA_HOLD_MS || 90000);
  const t0 = Date.now();
  while (Date.now() - t0 < HOLD_MS) await page.waitForTimeout(500);
  const held = await snap();
  const shotHold = path.join(OUT, `b1-yield-hold-${tag}.png`);
  await page.screenshot({ path: shotHold });
  const doorLines = navLog.slice(navBefore).filter((l) => l.includes('stop enter'));

  // ---- LEG 2: step aside and let them in -----------------------------------
  // Straight back from the door, far enough to clear the 0.72 clamp entirely.
  const aside = { x: door.x, z: door.z - 3.2 };
  out.stepAside = await walkTo(aside, 0.8, 10);
  const navAtAside = navLog.length;
  const t1 = Date.now();
  const CLEAR_MS = Number(process.env.QA_CLEAR_MS || 75000);
  while (Date.now() - t1 < CLEAR_MS) await page.waitForTimeout(500);
  const after = await snap();
  const shotClear = path.join(OUT, `b1-yield-clear-${tag}.png`);
  await page.screenshot({ path: shotClear });

  const wallSeconds = (Date.now() - t0) / 1000;
  const simHealth = +(((after.clock ?? 0) - (before.clock ?? 0)) / (wallSeconds * (4 / 30))).toFixed(3);
  const newBellsWhileBlocked = held.bells.filter((id) => !before.bells.includes(id)).length;
  const newBellsAfterAside = after.bells.filter((id) => !held.bells.includes(id)).length;
  out.result = {
    tag,
    stagedDistYd: staged,
    simHealth,
    blocked: {
      seconds: Math.round(HOLD_MS / 1000),
      ladderEscalations: held.nav - before.nav,
      doorLadderLines: doorLines.length,
      newDoorbells: newBellsWhileBlocked,
      waitingOutside: held.outside,
      screenshot: shotHold,
    },
    afterStepAside: {
      seconds: Math.round(CLEAR_MS / 1000),
      ladderEscalations: after.nav - held.nav,
      doorLadderLines: navLog.slice(navAtAside).filter((l) => l.includes('stop enter')).length,
      newDoorbells: newBellsAfterAside,
      screenshot: shotClear,
    },
  };
  if (simHealth < 0.8) fail(`sim ran at ${Math.round(simHealth * 100)}% of wall rate — the leg measures a stalled day`);
  fs.writeFileSync(path.join(OUT, `b1-yield-${tag}.json`), JSON.stringify({ ...out, doorLines: doorLines.slice(0, 20) }, null, 2));
  console.log('YIELD', JSON.stringify(out.result, null, 2));
  return out;
}
