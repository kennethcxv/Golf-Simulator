// B1 — WATCH THE SHOP AND COUNT WHAT GOES WRONG, ON THE POPULATION HE SEES.
//
// B0 settled which population that is: clubhouse.customers(), the inline array
// in clubhouse.js. sim/customerSimulation.js's `active` was EMPTY the whole time
// three bodies walked his shop, so every number here reads ch.customers().
//
// Sampled at 10 Hz over a played session on his own save, nothing spawned or
// placed:
//
//   PENETRATION   a body centre inside one of the collider boxes the game's own
//                 resolveCustomer pushes out of (ch.customerColliders(), the
//                 same list navFresh() bakes the grid from). Doors excluded —
//                 they are openings, not obstacles.
//   OVERLAP       two bodies closer than two body radii (0.68 yd).
//   STUCK         a body that moves under 0.05 yd for 3 s while its current stop
//                 is somewhere it has not arrived at.
//   LADDER        the game's own stuck-recovery escalations
//                 (navBlockDiagnostics), which the console prints as
//                 nudge/retarget/skip.
//   QUEUE         spacing and lateral spread of everyone standing in line, so
//                 "sideways instead of single file" becomes a number.
//
// CONTROLS (golf-qa law 1). Every detector is run first over PLANTED bad data —
// a body parked inside a collider, two bodies 0.1 yd apart, a frozen track — and
// the run aborts if a detector fails to fire on its own planted case. A detector
// that cannot fail is not evidence, and this is the fourth night in a row that
// rule has caught something.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<seeded profile> \
//   VIDEO_DIR=qa/goal33/b1-clip \
//   node tools/qa/run-electron.cjs tools/qa/goal33-b1-nav-watch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'b1-nav-watch', errs: [], failures: [], notes: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const navLog = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[customer-nav]')) navLog.push(t);
  });

  const BODY_RADIUS = 0.34;
  const TOUCH = BODY_RADIUS * 2;

  // ---------- the detectors, as pure functions over samples ----------
  // Pure so the planted controls below exercise the SAME code the real run uses.
  const insideCollider = (x, z, cols) => {
    for (const c of cols) {
      if (c.door) continue;
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) {
        const depth = Math.min(x - c.minX, c.maxX - x, z - c.minZ, c.maxZ - z);
        return { hit: true, depth: +depth.toFixed(3), box: c };
      }
    }
    return { hit: false };
  };
  const findOverlaps = (bodies) => {
    const pairs = [];
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const d = Math.hypot(bodies[i].x - bodies[j].x, bodies[i].z - bodies[j].z);
        if (d < TOUCH) pairs.push({ a: bodies[i].id, b: bodies[j].id, d: +d.toFixed(3), overlap: +(TOUCH - d).toFixed(3) });
      }
    }
    return pairs;
  };
  // A track is stuck when it barely moved across the window AND it still has
  // somewhere to be. Browsing at a shelf is standing still on purpose.
  const findStuck = (track, windowSamples, moveFloor = 0.05) => {
    const episodes = [];
    let run = 0;
    for (let i = windowSamples; i < track.length; i += 1) {
      const a = track[i - windowSamples];
      const b = track[i];
      const moved = Math.hypot(b.x - a.x, b.z - a.z);
      const busy = b.stop && !['gone', null].includes(b.stop) && b.arrived !== true;
      if (moved < moveFloor && busy) {
        run += 1;
        if (run === 1) episodes.push({ from: a.t, to: b.t, x: b.x, z: b.z, stop: b.stop, samples: 1 });
        else episodes[episodes.length - 1] = { ...episodes[episodes.length - 1], to: b.t, samples: run };
      } else run = 0;
    }
    return episodes;
  };

  // ---------- planted controls: each detector must FAIL on purpose ----------
  const control = { };
  {
    const cols = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, door: false }, { minX: 5, maxX: 6, minZ: 5, maxZ: 6, door: true }];
    control.penetrationFires = insideCollider(0, 0, cols).hit === true;
    control.penetrationQuietOutside = insideCollider(3, 3, cols).hit === false;
    control.penetrationIgnoresDoors = insideCollider(5.5, 5.5, cols).hit === false;
    control.overlapFires = findOverlaps([{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 0.1, z: 0 }]).length === 1;
    control.overlapQuietApart = findOverlaps([{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 2, z: 0 }]).length === 0;
    const frozen = Array.from({ length: 40 }, (_, i) => ({ t: i * 100, x: 1, z: 1, stop: 'fixture' }));
    const walking = Array.from({ length: 40 }, (_, i) => ({ t: i * 100, x: i * 0.1, z: 1, stop: 'fixture' }));
    control.stuckFires = findStuck(frozen, 30).length > 0;
    control.stuckQuietWhileWalking = findStuck(walking, 30).length === 0;
  }
  out.controls = control;
  console.log('CONTROLS', JSON.stringify(control));
  for (const [k, v] of Object.entries(control)) if (!v) fail(`negative control ${k} did not hold — the detectors are not trustworthy`);

  // ---------- boot on his save ----------
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
  out.bootPath = how;
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(600);

  out.colliders = await page.evaluate(() => window.__fw.scene3d.clubhouse().customerColliders?.() ?? null);
  if (!out.colliders) { fail('customerColliders() missing — cannot measure penetration against the real boxes'); return out; }
  out.colliderCount = out.colliders.length;
  console.log('COLLIDERS', out.colliderCount, 'doors', out.colliders.filter((c) => c.door).length);

  // Walk in through the door with real input, so the watch happens where the
  // shopping does. The player is an obstacle too and must be in the room.
  //
  // AND KEEP WALKING UNTIL ACTUALLY INSIDE. One fixed 6.5 s leg landed the
  // player at z 5.28, 7.41 and 10.14 on three runs of the same save, and that
  // one variable swung the result from 1 ladder escalation to 61: a player
  // stopped on the porch plugs the shop's only entrance. An unstated variable
  // that large makes two runs incomparable, which is how a fix gets credited or
  // blamed for the walk-in.
  for (let leg = 0; leg < 4; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6000 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(600);
    const p = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse();
      return { z: w.z, inside: ch.isInside ? ch.isInside(w.x, w.z) : null };
    });
    if (p.inside) break;
  }
  out.playerAfterWalkIn = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse();
    return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), inside: ch.isInside ? ch.isInside(w.x, w.z) : null };
  });
  console.log('PLAYER', JSON.stringify(out.playerAfterWalkIn));

  // ---------- the watch ----------
  const WATCH_MS = Number(process.env.QA_WATCH_MS || 300000);
  const samples = [];
  const shots = [];
  const t0 = Date.now();
  let lastShot = 0;
  while (Date.now() - t0 < WATCH_MS) {
    const s = await page.evaluate(() => {
      const fw = window.__fw;
      const ch = fw.scene3d.clubhouse();
      const w = fw.scene3d.walk.state;
      const bodies = [];
      for (const c of ch.customers()) {
        if (!c.mesh) continue;
        const stop = c.stops?.[c.stopIdx] ?? null;
        const d = stop ? Math.hypot(stop.x - c.mesh.position.x, stop.z - c.mesh.position.z) : null;
        bodies.push({
          id: c.customerId ?? null,
          x: +c.mesh.position.x.toFixed(3),
          z: +c.mesh.position.z.toFixed(3),
          vx: +(c.vx || 0).toFixed(3),
          vz: +(c.vz || 0).toFixed(3),
          stop: stop?.kind ?? null,
          arrived: d != null ? d < 0.35 : null,
          queued: !!c.queued,
          slot: Number.isFinite(c.queueSlotHeld) ? c.queueSlotHeld : null,
          pathLen: Array.isArray(c.path) ? c.path.length : null,
          visible: c.mesh.visible !== false,
          linger: +(c.linger || 0).toFixed(2),
          noProgressT: +(c.noProgressT || 0).toFixed(2),
          escalation: c.stuckEscalation || 0,
        });
      }
      const nav = ch.navBlockDiagnostics?.() ?? null;
      return {
        t: performance.now(),
        clock: fw.state.clock?.minutes ?? null,
        player: { x: +w.x.toFixed(2), z: +w.z.toFixed(2) },
        bodies,
        crowd: ch.crowdDiagnostics?.() ?? null,
        navTotal: nav?.total ?? null,
        navProgressPeak: nav?.progressPeakSeconds ?? null,
        steerEngagedPct: nav?.steer?.engagedPct ?? null,
        steeredPct: nav?.steer?.steeredPct ?? null,
        queueSlots: [0, 1, 2, 3].map((i) => ch.queueSlotForIndex?.(i) ?? null),
      };
    });
    samples.push(s);
    if (Date.now() - lastShot > 45000) {
      lastShot = Date.now();
      const f = path.join(OUT, `b1-watch-${shots.length}.png`);
      await page.screenshot({ path: f });
      shots.push({ file: f, atMs: Date.now() - t0, bodies: s.bodies.length });
    }
    await page.waitForTimeout(100);
  }
  out.shots = shots;
  out.watchMs = Date.now() - t0;
  out.sampleCount = samples.length;

  // ---- B2's acceptance photograph: AIM AT THE LINE ------------------------
  // The periodic shots above point wherever the player happens to face, and a
  // queue nobody photographed is exactly the kind of "measured clean" this goal
  // exists to stop. Aim with real mouse input at the queue head and shoot.
  const queued = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const q = ch.customers().filter((c) => c.mesh && c.queued);
    if (q.length < 2) return null;
    const s = ch.queueSlotForIndex(1);
    return { n: q.length, x: s.x, z: s.z };
  });
  out.queueShot = { queuedWhenAimed: queued?.n ?? 0 };
  if (queued) {
    const cal = { yawPerPx: -0.001927, pitchPerPx: -0.0019 };
    for (let i = 0; i < 8; i += 1) {
      const t = await page.evaluate((pt) => {
        const w = window.__fw.scene3d.walk.state;
        const cam = window.__fw.scene3d.camera;
        const d = Math.hypot(pt.x - w.x, pt.z - w.z);
        let dy = Math.atan2(-(pt.x - w.x), -(pt.z - w.z)) - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        return { dy, dp: Math.atan2(1.0 - cam.position.y, d) - w.pitch, d };
      }, queued);
      if (Math.abs(t.dy) < 0.08 && Math.abs(t.dp) < 0.12) break;
      const cx = Math.round(vp.w / 2);
      const cy = Math.round(vp.h / 2);
      await page.mouse.move(cx, cy);
      await page.mouse.move(
        cx + Math.round(Math.max(-1200, Math.min(1200, t.dy / cal.yawPerPx))),
        cy + Math.round(Math.max(-400, Math.min(400, t.dp / cal.pitchPerPx))),
        { steps: 12 },
      );
      await page.waitForTimeout(140);
    }
    await page.waitForTimeout(700);
    const qShot = path.join(OUT, `b1-queue-aimed-${out.tag}.png`);
    await page.screenshot({ path: qShot });
    out.queueShot.file = qShot;
    out.queueShot.geometry = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const q = ch.customers().filter((c) => c.mesh && c.queued)
        .map((c) => ({
          slot: Number.isFinite(c.queueSlotHeld) ? c.queueSlotHeld : null,
          x: +c.mesh.position.x.toFixed(2),
          z: +c.mesh.position.z.toFixed(2),
        }))
        .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
      return q;
    });
    console.log('QUEUE SHOT', JSON.stringify(out.queueShot));
  }

  // ---------- analysis over the real samples ----------
  const cols = out.colliders;
  const tracks = new Map();
  const penetrations = [];
  const overlapPairs = [];
  let peopleMax = 0;
  let framesWithBodies = 0;
  for (const s of samples) {
    if (s.bodies.length) framesWithBodies += 1;
    peopleMax = Math.max(peopleMax, s.bodies.length);
    for (const b of s.bodies) {
      if (!tracks.has(b.id)) tracks.set(b.id, []);
      tracks.get(b.id).push({ t: s.t, ...b });
      const pen = insideCollider(b.x, b.z, cols);
      if (pen.hit) penetrations.push({ t: s.t, id: b.id, x: b.x, z: b.z, depth: pen.depth, stop: b.stop, box: pen.box });
    }
    for (const p of findOverlaps(s.bodies)) overlapPairs.push({ t: s.t, ...p });
  }
  // Episodes rather than sample counts: one body standing in a wall for ten
  // seconds is one fault, not a hundred.
  const episodesOf = (rows, keyOf, gapMs = 1500) => {
    const byKey = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
    const eps = [];
    for (const [k, list] of byKey) {
      list.sort((a, b) => a.t - b.t);
      let cur = null;
      for (const r of list) {
        if (cur && r.t - cur.to <= gapMs) {
          cur.to = r.t; cur.n += 1;
          cur.worst = Math.max(cur.worst, r.depth ?? r.overlap ?? 0);
        } else {
          if (cur) eps.push(cur);
          cur = { key: k, from: r.t, to: r.t, n: 1, worst: r.depth ?? r.overlap ?? 0, sample: r };
        }
      }
      if (cur) eps.push(cur);
    }
    return eps.sort((a, b) => b.worst - a.worst);
  };
  const penEpisodes = episodesOf(penetrations, (r) => `${r.id}@${Math.round(r.box.minX)},${Math.round(r.box.minZ)}`);
  const overlapEpisodes = episodesOf(overlapPairs, (r) => `${r.a}|${r.b}`);
  const stuckEpisodes = [];
  for (const [id, track] of tracks) {
    for (const e of findStuck(track, 30)) stuckEpisodes.push({ id, ...e, durMs: Math.round(e.to - e.from) });
  }

  // Queue shape: for every sample with 2+ queued bodies, how far apart are
  // consecutive people, and how far off the line's own axis do they sit?
  const queueShots = [];
  for (const s of samples) {
    const q = s.bodies.filter((b) => b.queued).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
    if (q.length < 2) continue;
    const s0 = s.queueSlots[0];
    const s1 = s.queueSlots[1];
    if (!s0 || !s1) continue;
    const ax = s1.x - s0.x;
    const az = s1.z - s0.z;
    const alen = Math.hypot(ax, az) || 1;
    const ux = ax / alen;
    const uz = az / alen;
    const lateral = q.map((b) => {
      const dx = b.x - s0.x;
      const dz = b.z - s0.z;
      return +Math.abs(dx * uz - dz * ux).toFixed(3); // distance off the queue axis
    });
    const gaps = [];
    for (let i = 1; i < q.length; i += 1) gaps.push(+Math.hypot(q[i].x - q[i - 1].x, q[i].z - q[i - 1].z).toFixed(3));
    queueShots.push({ t: s.t, n: q.length, lateral, gaps, slots: q.map((b) => b.slot) });
  }
  const flat = (arr) => arr.reduce((a, b) => a.concat(b), []);
  const med = (a) => (a.length ? +a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(3) : null);

  // Mass exodus: how many bodies left within any 3 s window.
  const seen = new Map();
  const departures = [];
  for (const s of samples) {
    const ids = new Set(s.bodies.map((b) => b.id));
    for (const id of seen.keys()) if (!ids.has(id)) { departures.push({ t: s.t, id }); seen.delete(id); }
    for (const id of ids) seen.set(id, s.t);
  }
  let worstBurst = 0;
  for (const d of departures) {
    const n = departures.filter((o) => Math.abs(o.t - d.t) < 3000).length;
    worstBurst = Math.max(worstBurst, n);
  }

  // THE ENVIRONMENT CONTROL. One five-minute leg came back with a third of its
  // samples showing the clock barely moving and a "166 second stuck customer"
  // that was really a stalled day. Expected advance is 4/30 game-minutes per
  // real second; anything under 0.8 of that and the leg is not about the game.
  const wallSeconds = out.watchMs / 1000;
  const gameMinutes = (samples[samples.length - 1]?.clock ?? 0) - (samples[0]?.clock ?? 0);
  const simHealth = +(gameMinutes / (wallSeconds * (4 / 30))).toFixed(3);
  let maxSampleGapMs = 0;
  for (let i = 1; i < samples.length; i += 1) {
    maxSampleGapMs = Math.max(maxSampleGapMs, samples[i].t - samples[i - 1].t);
  }
  if (simHealth < 0.8) fail(`sim ran at ${Math.round(simHealth * 100)}% of wall rate — this watch measures a stalled day, not the shop`);

  const last = samples[samples.length - 1] || {};
  out.result = {
    sampleCount: samples.length,
    watchSeconds: Math.round(out.watchMs / 1000),
    simHealth,
    maxSampleGapMs: Math.round(maxSampleGapMs),
    playerInside: out.playerAfterWalkIn?.inside ?? null,
    peopleMax,
    framesWithBodies,
    clockFrom: samples[0]?.clock ?? null,
    clockTo: last.clock ?? null,
    penetrationEpisodes: penEpisodes.length,
    worstPenetrationYd: penEpisodes[0]?.worst ?? 0,
    overlapEpisodes: overlapEpisodes.length,
    worstOverlapYd: overlapEpisodes[0]?.worst ?? 0,
    stuckEpisodes: stuckEpisodes.length,
    longestStuckMs: stuckEpisodes.reduce((m, e) => Math.max(m, e.durMs), 0),
    ladderEscalationsTotal: last.navTotal ?? null,
    navProgressPeakSeconds: last.navProgressPeak ?? null,
    steerEngagedPct: last.steerEngagedPct ?? null,
    steeredPct: last.steeredPct ?? null,
    queueSamples: queueShots.length,
    medianQueueGapYd: med(flat(queueShots.map((q) => q.gaps))),
    medianQueueLateralYd: med(flat(queueShots.map((q) => q.lateral))),
    worstQueueLateralYd: queueShots.length ? Math.max(...flat(queueShots.map((q) => q.lateral))) : null,
    departures: departures.length,
    worstDepartureBurst3s: worstBurst,
    consoleNavLines: navLog.length,
  };
  out.worstPenetrations = penEpisodes.slice(0, 8);
  out.worstOverlaps = overlapEpisodes.slice(0, 8);
  out.stuckEpisodes = stuckEpisodes.slice(0, 12);
  out.navConsole = navLog.slice(0, 40);

  if (peopleMax === 0) fail('nobody was in the shop for the whole watch — this measures an empty room');
  fs.writeFileSync(path.join(OUT, 'b1-nav-watch.json'), JSON.stringify({ ...out, samples: samples.slice(0, 4000) }, null, 2));
  console.log('B1 RESULT', JSON.stringify(out.result, null, 2));
  console.log('WORST PEN', JSON.stringify(out.worstPenetrations.slice(0, 3), null, 2));
  console.log('WORST OVERLAP', JSON.stringify(out.worstOverlaps.slice(0, 3), null, 2));
  console.log('STUCK', JSON.stringify(out.stuckEpisodes.slice(0, 5), null, 2));
  if (out.failures.length) process.exitCode = 1;
  return out;
}
