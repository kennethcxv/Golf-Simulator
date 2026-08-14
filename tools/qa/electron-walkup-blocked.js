// 2.1 (Goal 26) — DOES MY BODY BLOCK THE QUEUE?
//
// "I finish a transaction. The second person walks up, gets blocked by something,
// sidesteps right to left, then walks in place without moving, then leaves. It
// happens when I am standing in the middle of the cash register from the opposite
// side. THAT IS ME."
//
// The claim to test is not "customers reach the till" -- that can be true while
// the symptom he describes still happens on the way. The symptom has two named
// signatures and both are measurable per customer per frame:
//
//   WALKING IN PLACE  the animation says moving, the position does not change.
//                     Measured as: intended speed above a threshold while actual
//                     travel over the same interval is near zero.
//   SIDESTEPPING      lateral displacement without progress toward the target.
//
// And one outcome: LEAVING UNSERVED.
//
// THE INSTRUMENT MUST NOT MEASURE ITS OWN INTERVENTION. The fix phases the player
// out of the crowd tests while register mode owns the camera, so a driver that
// stands the player anywhere ELSE would report clean numbers on both builds and
// prove nothing. This one puts the player exactly where he says he stands -- at
// the till, in register mode -- and that is asserted before any sampling starts.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-walkup-blocked.js --clubhouse=pine-hills-v2
//   VIDEO_DIR=qa/clips/walkup node tools/qa/run-electron.cjs tools/qa/electron-walkup-blocked.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/walkup-blocked');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // THE OWNER'S OWN SAVE. A fresh profile has no route network, so the shop has
  // no traffic: the first version of this driver ran 150 s and saw ZERO
  // customers, which is a true answer to the wrong question -- with nobody in the
  // room, "nobody walks in place" is guaranteed on both builds and proves
  // nothing. It also mis-staged the player: walk.stations()[0] on a clean profile
  // is a WEED PATCH at x -356.9, outdoors, nowhere near a till, and
  // register.enter() still returned true from there.
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

  // OPEN THE SHOP. The save resumes at 06:01 on day 0, before trading, and the
  // first attempt sampled 150 s of an empty room and reported it clean. An empty
  // room scores perfectly on every build.
  out.clock = await page.evaluate(() => {
    const app = window.__fw;
    const before = app.state.clock.minutes;
    const day = Math.floor(before / 1440);
    app.state.clock.minutes = day * 1440 + 630; // 10:30, mid-morning trade
    return { before: +before.toFixed(1), after: app.state.clock.minutes };
  });
  console.log('CLOCK', JSON.stringify(out.clock));

  // STAND WHERE HE STANDS -- BEHIND the counter, which means approaching each
  // station from the INTERIOR side. The first attempt offset z by +1.15 blindly
  // and put the player OUTSIDE the building (interior centre z 4, stations z 7.5,
  // so +1.15 lands at 8.5 -- through the wall), where the crosshair found a weed
  // patch and register.enter() still returned true.
  out.staged = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const stations = s3.walk.stations() || [];
    const w = s3.walk.state;
    const c = ch.interior.position;
    const tryStation = (st) => {
      // step from the station toward the interior centre, never away from it
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
          label, x: +w.x.toFixed(2), z: +w.z.toFixed(2), stations: stations.length,
          matched: true, inside: ch.isInside(w.x, w.z),
        };
      }
    }
    const label = stations.length ? tryStation(stations[0]) : null;
    return {
      label, x: +w.x.toFixed(2), z: +w.z.toFixed(2), stations: stations.length,
      matched: false, inside: ch.isInside(w.x, w.z),
    };
  });
  await page.waitForTimeout(900);
  const entered = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse()?.register;
    if (!reg?.enter) return { ok: false, why: 'no register.enter' };
    const ok = reg.enter();
    return { ok: !!ok, active: !!reg.isActive?.() };
  });
  out.registerEntered = entered;
  console.log('STAGED', JSON.stringify(out.staged), 'REGISTER', JSON.stringify(entered));
  // FAIL CLOSED. Sampling with the player NOT in register mode measures a
  // different situation from the one being fixed and would read clean either way.
  if (!entered.active) {
    out.summary = { ABORTED: 'register mode is not active; the player is not where the report says' };
    fs.writeFileSync(path.join(OUT, 'walkup.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('WALKUP', JSON.stringify(out.summary));
    return out;
  }

  out.phased = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return ch.qaPlayerBlocksCustomers ? ch.qaPlayerBlocksCustomers() : null;
  });
  console.log('PLAYER-BLOCKS-CUSTOMERS', JSON.stringify(out.phased));

  // FOUR CUSTOMERS, SPAWNED DELIBERATELY. Waiting for organic arrivals was the
  // blocker: the save resumes at 06:01 and moving the clock forward does not
  // drive the arrival loop, so the first runs sampled an empty room -- which
  // scores perfectly on every build. clubhouse.debugSpawn(true) is the hook the
  // module already exposes for exactly this ("QA: force a walk-in"), and
  // setOrganicWalkins(false) keeps the population to the four being watched
  // instead of letting random traffic wander through the measurement.
  out.spawned = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    try { ch.setOrganicWalkins?.(false); } catch { /* older builds */ }
    try { ch.clearWalkins?.(); } catch { /* older builds */ }
    const made = [];
    for (let i = 0; i < 4; i += 1) {
      try { made.push(!!ch.debugSpawn?.(true)); } catch (e) { made.push(String(e.message)); }
    }
    return { made, onFloor: (ch.qaCustomerTrack?.() || []).length };
  });
  console.log('SPAWNED', JSON.stringify(out.spawned));

  const gotCustomers = await page.waitForFunction(() => {
    const ch = window.__fw?.scene3d?.clubhouse?.();
    return (ch?.qaCustomerTrack?.() || []).length > 0;
  }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  out.customersPresent = gotCustomers;
  console.log('CUSTOMERS-PRESENT', gotCustomers);
  if (!gotCustomers) {
    out.summary = { ABORTED: 'no customers on the floor; an empty room scores clean on every build' };
    fs.writeFileSync(path.join(OUT, 'walkup.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('WALKUP', JSON.stringify(out.summary));
    return out;
  }

  // Sample every customer every ~100 ms for a long stretch. Per customer we keep
  // the previous position so "walking in place" can be computed as intent versus
  // actual travel -- a single snapshot cannot express it.
  const SAMPLE_MS = 100;
  const SECONDS = Number(process.env.WALKUP_SECONDS || 150);
  out.track = await page.evaluate(async ({ sampleMs, seconds }) => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const prev = new Map();
    const stats = new Map();
    const t0 = performance.now();
    const seenIds = new Set();
    let samples = 0;
    await new Promise((resolve) => {
      const tick = () => {
        const list = (ch.qaCustomerTrack ? ch.qaCustomerTrack() : []) || [];
        samples += 1;
        for (const c of list) {
          seenIds.add(c.id);
          const p = prev.get(c.id);
          if (!stats.has(c.id)) {
            stats.set(c.id, {
              id: c.id, frames: 0, walkInPlace: 0, moved: 0, travel: 0,
              maxSpeedIntent: 0, reachedQueue: false, served: false, left: false,
            });
          }
          const s = stats.get(c.id);
          s.frames += 1;
          if (c.queued) s.reachedQueue = true;
          if (c.served) s.served = true;
          const intent = Math.hypot(c.vx || 0, c.vz || 0);
          s.maxSpeedIntent = Math.max(s.maxSpeedIntent, intent);
          if (p) {
            const d = Math.hypot(c.x - p.x, c.z - p.z);
            s.travel += d;
            // WALKING IN PLACE: the sim wants to move at a real speed and the
            // body goes essentially nowhere over the interval. The thresholds are
            // in yards per sample: 0.35 yd/s of intent is a purposeful walk, and
            // 0.004 yd over 100 ms is under half a centimetre.
            if (intent > 0.35 && d < 0.004) s.walkInPlace += 1;
            else if (d >= 0.004) s.moved += 1;
          }
          prev.set(c.id, { x: c.x, z: c.z });
        }
        // anybody we had and no longer have has gone
        for (const [id, s] of stats) if (!list.some((c) => c.id === id)) s.left = true;
        if (performance.now() - t0 >= seconds * 1000) resolve();
        else setTimeout(tick, sampleMs);
      };
      tick();
    });
    return { samples, seen: seenIds.size, customers: [...stats.values()] };
  }, { sampleMs: SAMPLE_MS, seconds: SECONDS });

  const cs = out.track.customers || [];
  const withMotion = cs.filter((c) => c.frames > 20);
  out.verdict = {
    samples: out.track.samples,
    customersSeen: out.track.seen,
    customersTracked: withMotion.length,
    // the headline: how many sampled frames had somebody treading air
    walkInPlaceFrames: withMotion.reduce((a, c) => a + c.walkInPlace, 0),
    movedFrames: withMotion.reduce((a, c) => a + c.moved, 0),
    walkInPlaceRatio: (() => {
      const w = withMotion.reduce((a, c) => a + c.walkInPlace, 0);
      const m = withMotion.reduce((a, c) => a + c.moved, 0);
      return (w + m) ? +(w / (w + m)).toFixed(4) : null;
    })(),
    worstCustomer: withMotion.slice().sort((a, b) => b.walkInPlace - a.walkInPlace)[0] || null,
    reachedQueue: withMotion.filter((c) => c.reachedQueue).length,
    leftWithoutQueueing: withMotion.filter((c) => c.left && !c.reachedQueue).length,
  };
  fs.writeFileSync(path.join(OUT, 'walkup.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('WALKUP', JSON.stringify(out.verdict, null, 2));
  return out;
}
