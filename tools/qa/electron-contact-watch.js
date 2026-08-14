// PHASE 3 GATE, VERIFIER TWO (Goal 26) — TEN MINUTES OF A BUSY SHOP.
//
// "Watch a busy shop for TEN MINUTES and report every contact -- body to body,
// body to fixture, body to player, product through body -- with duration. Any
// sustained contact is a finding and a finding is the next item."
//
// The four contact kinds are measured separately because they fail separately
// and they are fixed in different code:
//
//   BODY-BODY      two customer capsules overlapping. 3.2: "never walks into
//                  another person", "two customers heading opposite ways step
//                  around each other".
//   BODY-FIXTURE   a customer capsule inside a static collider. 3.2: "never
//                  grinds along a wall, fixture or body".
//   BODY-PLAYER    a customer capsule overlapping the player's. 3.2: "never
//                  walks into... me".
//   RUN-IN-PLACE   moving the legs while going nowhere. 3.2: "NEVER runs in
//                  place." Measured as animating-and-not-translating, and
//                  QUEUE-STANDING IS EXCLUDED BY NAME -- a customer waiting in
//                  line is stationary on purpose, and counting them is how a
//                  previous run reported 59.6 % run-in-place on a working build.
//
// DURATION IS THE POINT, not incidence. Two people brushing past each other for
// one frame is contact; two people welded together for nine seconds is a bug.
// Every contact is tracked as an interval keyed by the pair, so the report can
// say "the longest body-to-body contact lasted 4.2 s" instead of "there were
// 900 contact frames".
//
// The sampler runs on rAF, so it sees what the renderer sees rather than a
// fixed-Hz approximation of it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-contact-watch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/contact-watch');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const WATCH_MS = Number(process.env.CONTACT_WATCH_MS || 600000);

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  out.staged = await page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    // The three facts, two of them invisible: trading hours on the clock, the
    // OPEN sign, and a save with a route network. With the sign shut every
    // arrival is sent straight to the exit and the shop looks empty and healthy.
    if (st.clock) st.clock.minutes = 620;
    if (st.shop) st.shop.signOpen = true;
    const ch = app.scene3d.clubhouse();
    const c = ch.interior.position;
    const w = app.scene3d.walk.state;
    w.x = c.x + 1.5; w.z = c.z + 4; w.vx = 0; w.vz = 0; w.yaw = Math.PI; w.pitch = -0.15;
    return { minutes: st.clock?.minutes ?? null, signOpen: st.shop?.signOpen ?? null };
  });
  console.log('STAGED', JSON.stringify(out.staged));

  // Start the watcher inside the page, on rAF, and let it run.
  await page.evaluate((durationMs) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const R = 0.32;          // a person's radius, matching the nav inflation
    const PAIR_HIT = R * 2;  // two capsules touching
    const PLAYER_HIT = R + 0.35;

    const state = {
      startedAt: performance.now(),
      durationMs,
      frames: 0,
      running: true,
      open: new Map(),   // key -> { kind, since, peakDepth }
      closed: [],        // finished intervals
      moveById: new Map(),
      runInPlace: new Map(),
      counts: { bodyBody: 0, bodyFixture: 0, bodyPlayer: 0, runInPlace: 0 },
      sampleErrors: 0,
    };
    window.__fwContactWatch = state;

    // The projection already carries a stable id, stamped once via a WeakMap --
    // the array index changes under a walker the moment anyone ahead of them is
    // removed, and a tracker keyed on that compares one person's position with
    // another's and calls the difference travel.
    const idOf = (c, i) => String(c.id != null ? c.id : `idx${i}`);

    const openOrExtend = (key, kind, depth, now) => {
      let iv = state.open.get(key);
      if (!iv) {
        iv = { key, kind, since: now, peakDepth: depth, lastSeen: now };
        state.open.set(key, iv);
        state.counts[kind] += 1;
      }
      iv.lastSeen = now;
      if (depth > iv.peakDepth) iv.peakDepth = depth;
    };

    const sweepClosed = (now) => {
      for (const [key, iv] of state.open) {
        // one missed frame is a sampling gap, not a separation
        if (now - iv.lastSeen > 120) {
          state.closed.push({
            kind: iv.kind, key: iv.key,
            seconds: +((iv.lastSeen - iv.since) / 1000).toFixed(2),
            peakDepth: +iv.peakDepth.toFixed(3),
          });
          state.open.delete(key);
        }
      }
    };

    const tick = () => {
      if (!state.running) return;
      const now = performance.now();
      if (now - state.startedAt > state.durationMs) {
        sweepClosed(now + 1000);
        state.running = false;
        return;
      }
      state.frames += 1;
      try {
        // THE PROJECTION, not live customer objects. qaCustomerTrack returns
        // {id, x, z, walking, stopKind, waitingForStand, ...} and has no `.mesh`
        // at all -- filtering it on `c.mesh` matches nothing and reports a
        // spotless shop with zero customers in it, which is what my first
        // version of this did.
        const list = ch.qaCustomerTrack?.() || [];
        const w = app.scene3d.walk.state;

        for (let i = 0; i < list.length; i += 1) {
          const a = list[i];
          const ai = idOf(a, i);
          const ap = { x: a.x, z: a.z };

          // RUN IN PLACE -- animating and not translating. Queue-standing is
          // excluded: a customer at a counter stop is stationary ON PURPOSE.
          const prev = state.moveById.get(ai);
          state.moveById.set(ai, { x: ap.x, z: ap.z });
          const waiting = a.waitingForStand === true
            || a.stopKind === 'counter'
            || a.queued === true
            || (a.linger || 0) > 0;
          if (prev && !waiting) {
            const moved = Math.hypot(ap.x - prev.x, ap.z - prev.z);
            const walking = a.walking === true;
            if (walking && moved < 0.0015) {
              const run = (state.runInPlace.get(ai) || 0) + 1;
              state.runInPlace.set(ai, run);
              if (run > 30) openOrExtend(`rip:${ai}`, 'runInPlace', run / 60, now);
            } else {
              state.runInPlace.set(ai, 0);
            }
          }

          // BODY - PLAYER
          const dp = Math.hypot(ap.x - w.x, ap.z - w.z);
          if (dp < PLAYER_HIT) openOrExtend(`bp:${ai}`, 'bodyPlayer', PLAYER_HIT - dp, now);

          // BODY - FIXTURE. The clubhouse's own collider test is the truth here;
          // re-deriving one from the scene graph would measure a different world
          // from the one the customers are actually resolved against.
          const pen = typeof ch.qaPointBlocked === 'function'
            ? ch.qaPointBlocked(ap.x, ap.z, R)
            : (Number.isFinite(a.colliderPen) ? a.colliderPen : 0);
          if (pen > 0) openOrExtend(`bf:${ai}`, 'bodyFixture', pen, now);

          // BODY - BODY
          for (let j = i + 1; j < list.length; j += 1) {
            const b = list[j];
            const bp = { x: b.x, z: b.z };
            const d = Math.hypot(ap.x - bp.x, ap.z - bp.z);
            if (d < PAIR_HIT) {
              const bi = idOf(b, j);
              openOrExtend(`bb:${ai < bi ? ai : bi}|${ai < bi ? bi : ai}`, 'bodyBody', PAIR_HIT - d, now);
            }
          }
        }
        sweepClosed(now);
      } catch (e) {
        state.sampleErrors += 1;
        state.lastError = String((e && e.message) || e).slice(0, 200);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, WATCH_MS);

  // Keep the shop busy for the whole watch: a "busy shop" that empties after two
  // minutes is a nine-minute measurement of an empty room.
  const topUps = Math.max(1, Math.round(WATCH_MS / 45000));
  for (let t = 0; t < topUps; t += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const live = (ch.qaCustomerTrack?.() || []).length;
      for (let i = live; i < 12; i += 1) ch.debugSpawn(false);
    });
    // eslint-disable-next-line no-await-in-loop
    const progress = await page.evaluate(() => {
      const s = window.__fwContactWatch;
      const ch = window.__fw.scene3d.clubhouse();
      return {
        elapsedS: Math.round((performance.now() - s.startedAt) / 1000),
        frames: s.frames,
        live: (ch.qaCustomerTrack?.() || []).length,
        open: s.open.size,
        closed: s.closed.length,
        counts: { ...s.counts },
      };
    });
    console.log('PROGRESS', JSON.stringify(progress));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(45000);
  }

  await page.waitForFunction(() => window.__fwContactWatch?.running === false, null, { timeout: 120000 })
    .catch(() => {});

  out.watch = await page.evaluate(() => {
    const s = window.__fwContactWatch;
    // close anything still open at the whistle, or a nine-second contact that
    // was still running at the end would vanish from the report entirely
    const now = performance.now();
    for (const iv of s.open.values()) {
      s.closed.push({
        kind: iv.kind, key: iv.key,
        seconds: +((iv.lastSeen - iv.since) / 1000).toFixed(2),
        peakDepth: +iv.peakDepth.toFixed(3),
        stillOpenAtEnd: true,
      });
    }
    s.open.clear();
    const byKind = {};
    for (const c of s.closed) {
      const k = byKind[c.kind] || (byKind[c.kind] = { count: 0, totalS: 0, longestS: 0, longest: null, over1s: 0 });
      k.count += 1;
      k.totalS += c.seconds;
      if (c.seconds > k.longestS) { k.longestS = c.seconds; k.longest = c; }
      if (c.seconds >= 1) k.over1s += 1;
    }
    for (const k of Object.values(byKind)) k.totalS = +k.totalS.toFixed(2);
    return {
      frames: s.frames,
      watchedS: Math.round((now - s.startedAt) / 1000),
      sampleErrors: s.sampleErrors,
      lastError: s.lastError || null,
      byKind,
      worst: s.closed.slice().sort((a, b) => b.seconds - a.seconds).slice(0, 12),
    };
  });

  await page.screenshot({ path: path.join(OUT, 'busy-shop.png') });

  const k = out.watch.byKind;
  const kindRow = (name) => {
    const r = k[name];
    if (!r) return { contacts: 0, longestS: 0, sustainedOver1s: 0 };
    return { contacts: r.count, longestS: r.longestS, sustainedOver1s: r.over1s, totalS: r.totalS };
  };
  out.verdict = {
    watchedSeconds: out.watch.watchedS,
    framesSampled: out.watch.frames,
    sampleErrors: out.watch.sampleErrors,
    bodyToBody: kindRow('bodyBody'),
    bodyToFixture: kindRow('bodyFixture'),
    bodyToPlayer: kindRow('bodyPlayer'),
    runsInPlace: kindRow('runInPlace'),
    // "Any SUSTAINED contact is a finding" -- so that is the headline number
    sustainedContacts: ['bodyBody', 'bodyFixture', 'bodyPlayer', 'runInPlace']
      .reduce((n, name) => n + (k[name]?.over1s || 0), 0),
    longestContactOverall: out.watch.worst[0] || null,
  };
  console.log('CONTACT-WATCH', JSON.stringify(out.verdict, null, 2));
  console.log('WORST', JSON.stringify(out.watch.worst, null, 2));
  fs.writeFileSync(path.join(OUT, 'contact-watch.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
