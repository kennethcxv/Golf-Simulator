// B1 — "A STUCK DETECTOR THAT ACTUALLY WORKS. Watch it fail on a deliberately
// blocked agent before you trust it."
//
// The defect, from his own save: arrival is `dist < 0.18`, and resolveCustomer
// holds every body 0.72 yd off the player and 0.3 yd out of every collider. A
// stop point inside one of those exclusions cannot be stood on, so the walker
// grinds until the recovery ladder abandons it. Console evidence:
//
//   visitor:3  nudge->retarget->skip   target 0.22 yd away (player in the doorway)
//   visitor:16 nudge->retarget->skip   shelf browse point 0.34 yd away
//
// Waiting for that to happen by luck took a five-minute watch. This stages it:
// pick a customer already walking to a stop several yards off, WALK THE PLAYER
// ONTO THAT STOP with real keys, and watch whether the customer can complete
// its errand.
//
//   RED   (arrival slack off): stopIdx never advances, escalation climbs to the
//         skip rung, the customer abandons the errand.
//   GREEN (slack on): the customer arrives at the edge of the exclusion, the
//         stop completes, no escalation.
//
// The instrument's own controls: sim health (the day must run at wall rate, a
// stalled clock freezes bodies and reads as stuck), a staged-distance assertion,
// and the subject is named up front so a run that quietly swapped subjects
// cannot pass.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<profile> QA_TAG=red|green \
//   node tools/qa/run-electron.cjs tools/qa/goal33-b1-blocked-agent.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'blocked-agent';
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

  // Walk in, so the player is on the shop floor with the shoppers.
  await page.keyboard.down('w');
  await page.waitForTimeout(6000);
  await page.keyboard.up('w');
  await page.waitForTimeout(800);

  const yawPerPx = -0.001927;
  const walkTo = async (target, within = 0.55, tries = 16) => {
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
      const px = Math.max(-1200, Math.min(1200, st.dYaw / yawPerPx));
      await page.mouse.move(Math.round(vp.w / 2), Math.round(vp.h / 2));
      await page.mouse.move(Math.round(vp.w / 2) + Math.round(px), Math.round(vp.h / 2), { steps: 10 });
      await page.waitForTimeout(110);
      await page.keyboard.down('w');
      await page.waitForTimeout(Math.min(1500, Math.max(160, st.dist * 650)));
      await page.keyboard.up('w');
      await page.waitForTimeout(200);
    }
    const st = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      return { x: +w.x.toFixed(2), z: +w.z.toFixed(2) };
    });
    return { ok: false, ...st };
  };

  // ---- pick a subject: someone walking to a stop several yards off ---------
  const pickSubject = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    let best = null;
    for (const c of ch.customers()) {
      if (!c.mesh || c.mesh.visible === false) continue;
      const stop = c.stops?.[c.stopIdx];
      if (!stop || !['fixture', 'walk', 'enter', 'basket', 'lounge'].includes(stop.kind)) continue;
      const theirs = Math.hypot(stop.x - c.mesh.position.x, stop.z - c.mesh.position.z);
      const mine = Math.hypot(stop.x - w.x, stop.z - w.z);
      // They must be far enough away that the player can get there first, and
      // the errand must not already be finished.
      if (theirs < 2.5 || mine > theirs - 1.2) continue;
      if (!best || theirs > best.theirs) {
        best = {
          id: c.customerId, theirs, mine, stopIdx: c.stopIdx,
          stop: { kind: stop.kind, x: stop.x, z: stop.z, fixtureId: stop.fixtureId ?? null },
        };
      }
    }
    return best;
  });

  let subject = null;
  const hunt0 = Date.now();
  while (!subject && Date.now() - hunt0 < 240000) {
    subject = await pickSubject();
    if (!subject) await page.waitForTimeout(1500);
  }
  out.subject = subject;
  if (!subject) { fail('no customer was walking to a distant stop within four minutes'); return out; }
  console.log('SUBJECT', JSON.stringify(subject));

  // ---- stand on their target ----------------------------------------------
  out.stage = await walkTo(subject.stop);
  console.log('STAGE', JSON.stringify(out.stage));
  const staged = await page.evaluate((s) => {
    const w = window.__fw.scene3d.walk.state;
    return +Math.hypot(w.x - s.x, w.z - s.z).toFixed(2);
  }, subject.stop);
  out.stagedDistYd = staged;
  if (staged > 0.72) fail(`player is ${staged} yd from the stop — outside the 0.72 clamp, the block is not staged`);

  // ---- watch that ONE customer --------------------------------------------
  const before = await page.evaluate(() => ({
    nav: window.__fw.scene3d.clubhouse().navBlockDiagnostics().total,
    clock: window.__fw.state.clock?.minutes ?? null,
  }));
  const navBefore = navLog.length;
  const WATCH_MS = Number(process.env.QA_WATCH_MS || 60000);
  const t0 = Date.now();
  const track = [];
  while (Date.now() - t0 < WATCH_MS) {
    const s = await page.evaluate((sub) => {
      const ch = window.__fw.scene3d.clubhouse();
      const c = ch.customers().find((x) => x.customerId === sub.id);
      if (!c) return { t: performance.now(), gone: true };
      const stop = c.stops?.[c.stopIdx];
      return {
        t: performance.now(),
        gone: false,
        stopIdx: c.stopIdx,
        stopKind: stop?.kind ?? null,
        dist: stop ? +Math.hypot(stop.x - c.mesh.position.x, stop.z - c.mesh.position.z).toFixed(3) : null,
        escalation: c.stuckEscalation || 0,
        noProgressT: +(c.noProgressT || 0).toFixed(2),
        x: +c.mesh.position.x.toFixed(2),
        z: +c.mesh.position.z.toFixed(2),
      };
    }, subject);
    track.push(s);
    await page.waitForTimeout(200);
  }
  const after = await page.evaluate(() => ({
    nav: window.__fw.scene3d.clubhouse().navBlockDiagnostics().total,
    clock: window.__fw.state.clock?.minutes ?? null,
  }));
  const shot = path.join(OUT, `b1-blocked-${tag}.png`);
  await page.screenshot({ path: shot });

  const live = track.filter((s) => !s.gone);
  const wallSeconds = (Date.now() - t0) / 1000;
  const simHealth = +(((after.clock ?? 0) - (before.clock ?? 0)) / (wallSeconds * (4 / 30))).toFixed(3);
  const advanced = live.length ? live[live.length - 1].stopIdx > subject.stopIdx : false;
  const closest = live.reduce((m, s) => (s.dist != null ? Math.min(m, s.dist) : m), 99);
  const maxEsc = live.reduce((m, s) => Math.max(m, s.escalation || 0), 0);
  const subjectLines = navLog.slice(navBefore).filter((l) => l.includes(String(subject.id).slice(-12)));
  out.result = {
    tag,
    subjectId: subject.id,
    stopKind: subject.stop.kind,
    stagedDistYd: staged,
    simHealth,
    watchSeconds: Math.round(wallSeconds),
    errandCompleted: advanced,
    closestApproachYd: closest === 99 ? null : closest,
    maxEscalationRung: maxEsc,
    ladderEscalationsAll: after.nav - before.nav,
    subjectLadderLines: subjectLines.length,
    leftTheShop: track.some((s) => s.gone),
    screenshot: shot,
  };
  out.subjectLines = subjectLines.slice(0, 10);
  if (simHealth < 0.8) fail(`sim ran at ${Math.round(simHealth * 100)}% of wall rate — the leg measures a stalled day`);
  fs.writeFileSync(path.join(OUT, `b1-blocked-${tag}.json`), JSON.stringify({ ...out, track }, null, 2));
  console.log('BLOCKED', JSON.stringify(out.result, null, 2));
  console.log('LINES', JSON.stringify(out.subjectLines, null, 2));
  return out;
}
