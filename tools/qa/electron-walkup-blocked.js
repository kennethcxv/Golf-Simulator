// 2.1 / 3.2 (Goal 26) — DOES ANYONE GET STUCK ON THE WAY TO THE COUNTER?
//
// "The second person walks up, gets blocked by something, sidesteps right to
// left, then walks in place without moving, then leaves."
//
// THE STAGING THIS NEEDS, all three found the hard way, and two of them invisible
// in the worst way — the game behaves perfectly correctly and simply does nothing:
//
//   1. THE OWNER'S SAVE. A fresh profile has no route network: no traffic at all,
//      and walk.stations()[0] is a weed patch outdoors at x -356.9.
//   2. TRADING HOURS. The save resumes at 06:01.
//   3. THE SIGN OPEN. shopAcceptsWalkIns = withinTradingHours && signIsOpen, and
//      when it is false clubhouse.js routes EVERY customer straight to the exit.
//      A 20 Hz trace caught a shopper jumping from stop 0 to stop 6 in SEVENTY
//      MILLISECONDS — which reads exactly like a catastrophic pathing fault and
//      is a closed shop working as designed. debugSpawn does not set
//      `scriptedVisit`, so a spawned shopper gets no exemption from it.
//
// And debugSpawn(FALSE) — a retail shopper who browses fixtures and fills a cart.
// debugSpawn(true) is a tee-time arrival that plans NO basket, so those customers
// pass the till with nothing to buy and leave. That is correct behaviour, and
// mistaking it for a queue defect cost me a published finding.
//
// THE METRIC IS PROGRESS TOWARD THE PATH TARGET, NOT VELOCITY — which is 3.3's
// wording, and the wording matters. Two earlier versions of this file used
// c.vx/c.vz as "intent". They are not intent: clubhouse.js computes them from the
// displacement the resolver actually produced and leaves them UNTOUCHED on any
// frame where the movement block is skipped, so a stopped customer keeps a stale
// high velocity. Worse, both earlier versions counted legitimate standing still —
// queued, or holding for a shelf — as the defect, and reported 59.6% on a build
// that works.
//
// A customer is STUCK here when their distance to their own current stop fails to
// improve for 1.5 s while they are not queued, not holding for a stand and not
// lingering, and they are still further away than an arrival radius.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-walkup-blocked.js --clubhouse=pine-hills-v2
//   VIDEO_DIR=qa/clips/walkup WALKUP_SPAWN=4 WALKUP_SECONDS=170 node tools/qa/run-electron.cjs ...
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/walkup-blocked');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));
  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async ({ save, saveMeta }) => {
    await window.fairwayNative.save('autosave', save);
    await window.fairwayNative.save('autosave-meta', saveMeta);
  }, { save: autosave, saveMeta: meta });
  await page.reload();
  await page.waitForFunction(() => {
    const b = document.querySelector('.menu-action-primary');
    return !!b && !b.disabled;
  }, null, { timeout: 45000 });
  await page.evaluate(() => document.querySelector('.menu-action-primary').click());
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(7000);

  out.clock = await page.evaluate(() => {
    const app = window.__fw;
    const before = app.state.clock.minutes;
    const day = Math.floor(before / 1440);
    app.state.clock.minutes = day * 1440 + 630; // 10:30, mid-morning trade
    if (app.state.shop) app.state.shop.signOpen = true;
    return {
      before: +before.toFixed(1),
      after: app.state.clock.minutes,
      signOpen: !!app.state.shop?.signOpen,
    };
  });
  console.log('CLOCK', JSON.stringify(out.clock));

  // Stand at the till, approaching each station from the INTERIOR side. An
  // earlier version offset z blindly and put the player through the wall, where
  // the crosshair found a weed patch and register.enter() still returned true.
  out.staged = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const stations = s3.walk.stations() || [];
    const w = s3.walk.state;
    const c = ch.interior.position;
    const tryStation = (st) => {
      let dx = c.x - st.x;
      let dz = c.z - st.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      w.x = st.x + dx * 1.15;
      w.z = st.z + dz * 1.15;
      w.vx = 0; w.vz = 0;
      w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
      w.pitch = -0.2;
      return s3.walk.getFocusLabel?.() ?? null;
    };
    for (const st of stations) {
      const label = tryStation(st);
      if (/tee desk|register|till|check-?in/i.test(label || '')) {
        return {
          label, x: +w.x.toFixed(2), z: +w.z.toFixed(2), matched: true, inside: ch.isInside(w.x, w.z),
        };
      }
    }
    const label = stations.length ? tryStation(stations[0]) : null;
    return {
      label, x: +w.x.toFixed(2), z: +w.z.toFixed(2), matched: false, inside: ch.isInside(w.x, w.z),
    };
  });
  await page.waitForTimeout(900);
  out.registerEntered = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse()?.register;
    if (!reg?.enter) return { ok: false, why: 'no register.enter' };
    const ok = reg.enter();
    return { ok: !!ok, active: !!reg.isActive?.() };
  });
  console.log('STAGED', JSON.stringify(out.staged), 'REGISTER', JSON.stringify(out.registerEntered));
  if (!out.registerEntered.active) {
    out.verdict = { ABORTED: 'register mode is not active; the player is not where the report says' };
    fs.writeFileSync(path.join(OUT, 'walkup.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('WALKUP', JSON.stringify(out.verdict));
    return out;
  }

  out.phased = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return ch.qaPlayerBlocksCustomers ? ch.qaPlayerBlocksCustomers() : null;
  });
  console.log('PLAYER-BLOCKS-CUSTOMERS', JSON.stringify(out.phased));

  await page.evaluate((n) => { window.__spawnCount = n; }, Number(process.env.WALKUP_SPAWN || 4));
  out.spawned = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    try { ch.setOrganicWalkins?.(false); } catch { /* older builds */ }
    try { ch.clearWalkins?.(); } catch { /* older builds */ }
    const made = [];
    for (let i = 0; i < (window.__spawnCount || 4); i += 1) {
      try { made.push(!!ch.debugSpawn?.(false)); } catch (e) { made.push(String(e.message)); }
    }
    return { made, onFloor: (ch.qaCustomerTrack?.() || []).length };
  });
  console.log('SPAWNED', JSON.stringify(out.spawned));

  const gotCustomers = await page.waitForFunction(() => {
    const ch = window.__fw?.scene3d?.clubhouse?.();
    return (ch?.qaCustomerTrack?.() || []).length > 0;
  }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  if (!gotCustomers) {
    out.verdict = { ABORTED: 'no customers on the floor; an empty room scores clean on every build' };
    fs.writeFileSync(path.join(OUT, 'walkup.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('WALKUP', JSON.stringify(out.verdict));
    return out;
  }

  const SAMPLE_MS = 100;
  const SECONDS = Number(process.env.WALKUP_SECONDS || 150);
  out.track = await page.evaluate(async ({ sampleMs, seconds }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const prev = new Map();
    const stats = new Map();
    const t0 = performance.now();
    const seen = new Set();
    let samples = 0;
    let controlSamples = 0;
    let controlStalledAtEnd = 0;
    let controlStalledAtStart = null;
    await new Promise((resolve) => {
      const tick = () => {
        const list = (ch.qaCustomerTrack ? ch.qaCustomerTrack() : []) || [];
        samples += 1;
        for (const c of list) {
          seen.add(c.id);
          if (!stats.has(c.id)) {
            stats.set(c.id, {
              id: c.id, frames: 0, moved: 0, travel: 0, reachedQueue: false, left: false,
              cartMax: 0, route: null, lastStopKind: null,
              bestDist: null, noProgress: 0, stalled: 0, stallTargetSum: 0,
              stallCrowded: 0, stallOnCollider: 0,
            });
          }
          const s = stats.get(c.id);
          s.frames += 1;
          if (c.queued) s.reachedQueue = true;
          s.route = c.stopKinds;
          s.lastStopKind = c.stopKind;
          s.cartMax = Math.max(s.cartMax, c.cart || 0);
          const p = prev.get(c.id);
          if (p) {
            const d = Math.hypot(c.x - p.x, c.z - p.z);
            s.travel += d;
            if (d >= 0.004) s.moved += 1;
            // Every legitimate reason to be standing still, excluded BY NAME.
            const waiting = c.queued || c.waitingForStand
              || (Number.isFinite(c.linger) && c.linger > 0);
            if (Number.isFinite(c.targetDist)) {
              if (waiting) {
                s.bestDist = null;
                s.noProgress = 0;
              } else if (s.bestDist == null || c.targetDist < s.bestDist - 0.02) {
                s.bestDist = c.targetDist;
                s.noProgress = 0;
              } else {
                s.noProgress += 1;
                if (s.noProgress >= 15 && c.targetDist > 0.3) { // 1.5 s of nothing
                  s.stalled += 1;
                  s.stallTargetSum += c.targetDist;
                  let nearest = Infinity;
                  for (const o of list) {
                    if (o.id === c.id) continue;
                    nearest = Math.min(nearest, Math.hypot(o.x - c.x, o.z - c.z));
                  }
                  if (Number.isFinite(nearest) && nearest < 0.75) s.stallCrowded += 1;
                  if (Number.isFinite(c.colliderPen) && c.colliderPen > -0.05) s.stallOnCollider += 1;
                }
              }
            }
          }
          prev.set(c.id, { x: c.x, z: c.z });
        }
        for (const [id, s] of stats) if (!list.some((c) => c.id === id)) s.left = true;
        // ---- NEGATIVE CONTROL: PIN SOMEBODY ON PURPOSE --------------------
        //
        // A stuck detector that reports 0 on every build has not proved the game
        // is clean; it has proved nothing at all, and this one DID read 0 on both
        // the fixed and the reverted build before this control existed. So for a
        // window in the middle of the run one customer is physically held in
        // place while the simulation keeps trying to move them. If `stalled` does
        // not rise during that window the instrument cannot see a stall and every
        // zero it reports is worthless.
        const elapsed = performance.now() - t0;
        const inControl = elapsed > seconds * 1000 * 0.55 && elapsed < seconds * 1000 * 0.75;
        if (inControl && list.length) {
          const victim = window.__fw.scene3d.clubhouse().qaCustomerMeshById?.(list[0].id);
          if (victim) {
            if (!window.__pin) {
              window.__pin = { x: victim.position.x, z: victim.position.z, id: list[0].id };
              controlStalledAtStart = stats.get(list[0].id)?.stalled ?? 0;
            }
            if (window.__pin.id === list[0].id) {
              victim.position.x = window.__pin.x;
              victim.position.z = window.__pin.z;
            }
          }
          controlSamples += 1;
          const cs = stats.get(window.__pin?.id);
          if (cs) controlStalledAtEnd = cs.stalled;
        } else if (!inControl && window.__pin) {
          window.__pin = null;
        }
        if (performance.now() - t0 >= seconds * 1000) resolve();
        else setTimeout(tick, sampleMs);
      };
      tick();
    });
    return {
      samples, seen: seen.size, customers: [...stats.values()],
      control: { samples: controlSamples, stalledAtEnd: controlStalledAtEnd, stalledAtStart: controlStalledAtStart },
    };
  }, { sampleMs: SAMPLE_MS, seconds: SECONDS });

  out.pickStats = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return ch.qaPickStats ? ch.qaPickStats() : null;
  });
  console.log('PICK-STATS', JSON.stringify(out.pickStats));

  const tracked = (out.track.customers || []).filter((c) => c.frames > 20);
  const sum = (k) => tracked.reduce((a, c) => a + (c[k] || 0), 0);
  out.verdict = {
    samples: out.track.samples,
    customersSeen: out.track.seen,
    customersTracked: tracked.length,
    reachedQueue: tracked.filter((c) => c.reachedQueue).length,
    everHeldGoods: tracked.filter((c) => c.cartMax > 0).length,
    routes: [...new Set(tracked.map((c) => c.route))],
    stalledSamples: sum('stalled'),
    movedSamples: sum('moved'),
    stallRatio: (() => {
      const st = sum('stalled');
      const mv = sum('moved');
      return (st + mv) ? +(st / (st + mv)).toFixed(4) : null;
    })(),
    stallCrowded: sum('stallCrowded'),
    stallOnCollider: sum('stallOnCollider'),
    stallMeanTargetDist: (() => {
      const st = sum('stalled');
      return st ? +(sum('stallTargetSum') / st).toFixed(3) : null;
    })(),
    // THE CONTROL. If this did not rise while a customer was physically pinned,
    // the detector cannot see a stall and every zero above means nothing.
    control: out.track.control,
    controlDetectedStall: (out.track.control?.stalledAtEnd ?? 0)
      > (out.track.control?.stalledAtStart ?? 0),
    errs: out.errs.slice(0, 6),
  };
  fs.writeFileSync(path.join(OUT, 'walkup.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('WALKUP', JSON.stringify(out.verdict, null, 2));
  return out;
}
