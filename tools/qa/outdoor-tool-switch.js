// OUTSIDE HAS NEVER BEEN MEASURED. THIS MEASURES IT.
//
// Every warm and every tool census in this repo was taken on the shop floor.
// The belt warm equips each tool at the spawn point; the played route walked
// the shop; the tripwire baseline is the first post-veil frame. So "switching
// items outdoors is laggy" has never had a number against it, and neither has
// the claim that it is fine indoors.
//
// The same belt, pressed in BOTH places, in ONE boot, so the GPU, the disk
// cache and the driver's program cache are identical on both sides. Per press:
// the longest frame it caused, the programs it minted, the textures it
// uploaded. Plus walking frame time in each place, because the ground work just
// landed on the largest surface in the game and "it is compiles" has to be
// shown rather than assumed.
//
//   node tools/qa/run-electron.cjs tools/qa/outdoor-tool-switch.js --clubhouse=pine-hills-v2
async (page) => {
  const errors = [];
  const tripwire = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[program-tripwire]')) tripwire.push(t);
    if (m.type() === 'error') errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d, null, { timeout: 120000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 300000 });
  } catch { /* recorded by veilStillUp below rather than thrown */ }
  const veilUp = await page.evaluate(() => {
    const v = document.querySelector('.load-veil');
    return !!(v && getComputedStyle(v).opacity !== '0');
  });
  await page.waitForTimeout(2500);

  // A frame-time recorder that lives in the page, so a stall is measured by the
  // loop that stalls rather than across a Playwright round trip.
  await page.evaluate(() => {
    window.__fwFrames = { on: false, last: 0, samples: [] };
    const tick = (t) => {
      const f = window.__fwFrames;
      if (f.on && f.last) f.samples.push(+(t - f.last).toFixed(2));
      f.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // THE rAF RECORDER CAN RETURN NOTHING, AND NOTHING READS LIKE FINE.
  //
  // The red run reported worstMs: null for the indoor vacuum and mop presses
  // and for the outdoor washer, and a null in a worst-frame column is exactly
  // the shape of a stall being hidden: if a press blocks the main thread for
  // most of the 1.2 s window, fewer than two rAF callbacks fire and there are
  // no GAPS to report. So a second recorder runs on the TIMER queue, which
  // does not wait on the compositor and always lands a sample once the block
  // ends. Its longest gap is the stall, whether or not any frame was drawn.
  const startBlocks = () => page.evaluate(() => {
    const b = { on: true, last: 0, worst: 0 };
    window.__fwBlocks = b;
    const tick = () => {
      const t = performance.now();
      if (b.last) b.worst = Math.max(b.worst, t - b.last);
      b.last = t;
      if (b.on) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  });
  const stopBlocks = () => page.evaluate(() => {
    const b = window.__fwBlocks;
    if (!b) return null;
    b.on = false;
    return +b.worst.toFixed(1);
  });

  const startFrames = () => page.evaluate(() => {
    window.__fwFrames.samples.length = 0;
    window.__fwFrames.last = 0;
    window.__fwFrames.on = true;
  });
  const stopFrames = () => page.evaluate(() => {
    const f = window.__fwFrames;
    f.on = false;
    const s = f.samples.slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
    return {
      n: s.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      worstMs: s[s.length - 1],
      over33: s.filter((v) => v > 33).length,
      over100: s.filter((v) => v > 100).length,
    };
  });

  // THE VIEWMODEL LEAK the owner flagged: rigs left VISIBLE with no tool held.
  const viewmodelState = () => page.evaluate(() => {
    const sc = window.__fw.scene3d;
    const held = sc.walk?.getTool?.() ?? null;
    const shown = [];
    sc.scene.traverse((o) => {
      const n = o.name || '';
      if (!/^Tool_/.test(n) && !/^Held/.test(n)) return;
      let vis = o.visible;
      for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      if (vis) shown.push(n);
    });
    return { held, shown };
  });

  const place = (pos, yaw, pitch) => page.evaluate(([p, y, pi]) => {
    const sc = window.__fw.scene3d;
    if (!sc.walk.isActive()) sc.walk.enter({ x: p.x, z: p.z, yaw: y });
    const st = sc.walk.state;
    st.x = p.x; st.z = p.z; st.yaw = y; st.pitch = pi;
    return { x: st.x, z: st.z };
  }, [pos, yaw, pitch]);

  const spots = await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    const ch = sc.clubhouse();
    // The LIVE interior origin, never a stale constant.
    const inside = ch.interior ? { x: ch.interior.position.x, z: ch.interior.position.z } : null;
    const st = window.__fw.state;
    const CELL = 8;
    const course = st.course;
    const worldW = course.w * CELL;
    const worldH = course.h * CELL;
    const h = (course.vec.holes || [])[0];
    const line = h && h.line ? h.line : [];
    const toWorld = (p) => ({ x: p.x * CELL - worldW / 2, z: p.y * CELL - worldH / 2 });
    const mid = line.length ? toWorld(line[Math.floor(line.length * 0.55)]) : null;
    return { inside, fairway: mid };
  });
  if (!spots.inside || !spots.fairway) throw new Error(`no places to stand: ${JSON.stringify(spots)}`);

  const belt = ['washer', 'vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag'];

  async function pressRoute(labelWhere, pos, yaw) {
    await place(pos, yaw, -0.12);
    // Confirm where the GAME thinks we are rather than trusting the numbers we
    // wrote: a coordinate inside the walls is not the same claim as isInside().
    const where = await page.evaluate(() => {
      const sc = window.__fw.scene3d;
      const ch = sc.clubhouse();
      const st = sc.walk.state;
      // THE LIGHT CENSUS, because that is what three keys a program on. A warm
      // that ran under a different census warmed a state the player never
      // reaches, and this repo has shipped that mistake four times.
      const counts = new Map();
      sc.scene.traverse((o) => {
        if (!o.isLight) return;
        for (let q = o; q; q = q.parent) { if (!q.visible) return; }
        if (!o.layers.test(sc.camera.layers)) return;
        counts.set(o.type, (counts.get(o.type) || 0) + 1);
      });
      return {
        inside: ch.isInside ? !!ch.isInside(st.x, st.z) : null,
        x: +st.x.toFixed(1),
        z: +st.z.toFixed(1),
        census: [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([t, n]) => `${t}:${n}`).join('|'),
      };
    });
    // THE CENSUS, READ AFTER THE GATE HAS PROVABLY SETTLED.
    //
    // The last attempt at the outdoor belt warm was WITHDRAWN because the
    // indoor census read PointLight:4 where every pre-fix run read 1, and a
    // fixed 1.6 s wait could not distinguish "the inside relit" from "the
    // interior's 2 Hz draw-distance gate had not caught up". So do not wait a
    // fixed time: sample until the SAME census comes back on four consecutive
    // samples spanning more than two full gate periods (>1 s at 2 Hz), and
    // report how long that took and how many distinct values were seen on the
    // way. A settled reading that took 3 s and passed through 1 then 4 is a
    // different fact from one that was 4 the whole time, and the driver now
    // says which.
    const settled = await page.evaluate(() => new Promise((done) => {
      const sc = window.__fw.scene3d;
      const read = () => {
        const counts = new Map();
        sc.scene.traverse((o) => {
          if (!o.isLight) return;
          for (let q = o; q; q = q.parent) { if (!q.visible) return; }
          if (!o.layers.test(sc.camera.layers)) return;
          counts.set(o.type, (counts.get(o.type) || 0) + 1);
        });
        return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([t, n]) => `${t}:${n}`).join('|');
      };
      const seen = [];
      const t0 = performance.now();
      const tick = () => {
        const v = read();
        if (!seen.length || seen[seen.length - 1].v !== v) {
          seen.push({ v, atMs: +(performance.now() - t0).toFixed(0), n: 1 });
        } else {
          seen[seen.length - 1].n += 1;
        }
        const tail = seen[seen.length - 1];
        const elapsed = performance.now() - t0;
        // four consecutive identical samples AND more than 1.2 s of wall time
        // in that run, so a 2 Hz gate has had at least two chances to move it
        if (tail.n >= 4 && elapsed - tail.atMs > 1200) {
          done({ census: v, settledAfterMs: +elapsed.toFixed(0), history: seen, settled: true });
          return;
        }
        if (elapsed > 12000) {
          done({ census: v, settledAfterMs: null, history: seen, settled: false });
          return;
        }
        setTimeout(tick, 300);
      };
      tick();
    }));
    await page.waitForTimeout(400);

    const rows = [];
    for (const tool of belt) {
      const before = await page.evaluate(() => {
        const i = window.__fw.scene3d.renderer.info;
        return { p: i.programs ? i.programs.length : -1, t: i.memory ? i.memory.textures : -1 };
      });
      await startFrames();
      await startBlocks();
      await page.evaluate((id) => {
        const w = window.__fw.scene3d.walk;
        (w.setToolImmediate || w.setTool).call(w, id);
      }, tool);
      await page.waitForTimeout(1200);
      const frames = await stopFrames();
      const worstBlockMs = await stopBlocks();
      const after = await page.evaluate(() => {
        const i = window.__fw.scene3d.renderer.info;
        return { p: i.programs ? i.programs.length : -1, t: i.memory ? i.memory.textures : -1 };
      });
      rows.push({
        tool,
        minted: after.p - before.p,
        dTextures: after.t - before.t,
        worstMs: frames ? frames.worstMs : null,
        // the honest one: never null, and it is the number that says "laggy"
        worstBlockMs,
        framesSeen: frames ? frames.n : 0,
        p95Ms: frames ? frames.p95Ms : null,
        medianMs: frames ? frames.medianMs : null,
      });
      await page.evaluate(() => {
        const w = window.__fw.scene3d.walk;
        (w.setToolImmediate || w.setTool).call(w, null);
      });
      await page.waitForTimeout(500);
    }
    return {
      where: `${labelWhere} inside=${where.inside} at ${where.x},${where.z}`,
      census: where.census,
      settledCensus: settled.census,
      censusSettled: settled.settled,
      censusSettledAfterMs: settled.settledAfterMs,
      censusHistory: settled.history,
      rows,
    };
  }

  async function walkFrames(labelWhere, pos, yaw, ms) {
    await place(pos, yaw, -0.06);
    await page.waitForTimeout(1400);
    await startFrames();
    await page.evaluate((duration) => new Promise((resolve) => {
      const sc = window.__fw.scene3d;
      const st = sc.walk.state;
      const t0 = performance.now();
      const step = () => {
        st.yaw += 0.0022;                    // a slow pan, so new ground enters shot
        st.x += Math.sin(st.yaw) * 0.09;     // and the player actually moves over it
        st.z += Math.cos(st.yaw) * 0.09;
        if (performance.now() - t0 < duration) requestAnimationFrame(step);
        else resolve(true);
      };
      requestAnimationFrame(step);
    }), ms);
    const f = await stopFrames();
    return Object.assign({ where: labelWhere }, f);
  }

  const beforeAnyPress = await viewmodelState();

  // ORDER IS THE CONTROL. "Outdoors mints four programs indoors did not" and
  // "whichever route runs second is free" produce the SAME table when you only
  // ever run indoor first. FW_REVERSE_ROUTES=1 runs them the other way round:
  // if outdoor still mints and indoor still does not, the programs are outdoor
  // ones. If the minting simply follows whichever went first, they are not.
  const reversed = process.env.FW_REVERSE_ROUTES === '1';
  const first = reversed
    ? await pressRoute('outdoor-fairway', spots.fairway, 0)
    : await pressRoute('indoor', spots.inside, 0);
  const second = reversed
    ? await pressRoute('indoor', spots.inside, 0)
    : await pressRoute('outdoor-fairway', spots.fairway, 0);
  const indoorPress = reversed ? second : first;
  const outdoorPress = reversed ? first : second;

  const indoorWalk = await walkFrames('indoor', spots.inside, 0, 6000);
  const outdoorWalk = await walkFrames('outdoor-fairway', spots.fairway, 0, 6000);

  const afterPresses = await viewmodelState();

  return {
    routeOrder: reversed ? 'outdoor first' : 'indoor first',
    veilStillUp: veilUp,
    viewmodels: { atFirstFrame: beforeAnyPress, afterBothRoutes: afterPresses },
    indoorPress,
    outdoorPress,
    indoorWalk,
    outdoorWalk,
    tripwireCount: tripwire.length,
    tripwire: tripwire.slice(0, 40),
    errors: errors.slice(0, 10),
  };
}
