// A3 (Goal 23) — THE DOOR HITCH, THIRD ATTEMPT, WITH THE DOOR CONFIRMED OPEN.
//
// WHAT THE TWO PREVIOUS CHECKS MEASURED:
//   1. tools/qa/doors-performance.js timed door frames in HEADLESS CHROME
//      against http://localhost:8457/. It never ran the shipped build. Void.
//   2. tools/qa/electron-f-door-lag.js (Goal 21) did run in Electron, cold, with
//      real keys — and never once asked whether the door OPENED. It walked
//      forward for three seconds, pressed E, and timed the frames either side.
//      If the player stopped short, or E landed on a different prop, the
//      numbers describe standing in a field. Void for a different reason.
//
// So this one refuses to report a number until the door's own angle has
// changed. mainEntranceDiagnostics() exposes leftAngle/rightAngle; they are
// read before the approach and after the press, and every timing below is
// marked VOID unless the leaves actually swung.
//
// The control is unchanged and still the point: walking AWAY from the door is
// movement without a door. If the approach costs the same, the door is not the
// cause and "ordinary movement is over budget" is a different bug.
//
//   VIDEO_DIR=qa/clips/door-hitch node tools/qa/run-electron.cjs \
//     tools/qa/electron-a3-door-hitch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a3-door-hitch');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // COLD. The complaint is the FIRST open; a warm-up lap cannot see a
  // first-time cost. Only the veil's own fade.
  await page.waitForTimeout(1200);

  // --shadows=off is the ELIMINATION LEG. The stall lands entirely inside the
  // draw submit with no new programs, textures, geometries or heap, which is
  // what a driver-side pipeline specialisation looks like — and the biggest
  // thing this frame submits that the calm frames do not is a 4096 shadow map
  // re-render of the whole outdoor scene (shadowQuality high, bake every 60 ms).
  // If the stall survives with shadows off, that mechanism is eliminated.
  const shadowsArg = process.argv.find((a) => a.startsWith('--shadows='));
  const shadowMode = shadowsArg ? shadowsArg.slice(10) : null;
  if (shadowMode) {
    await page.evaluate((m) => window.__fw.preferences.set('display.shadowQuality', m), shadowMode);
    await page.waitForTimeout(1500);
  }

  // Where the entrance actually is, from the game rather than a constant.
  const door = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const { DOOR_MAIN, SHELL } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const halfD = SHELL.d / 2 - SHELL.wallT / 2;
    const w = ch.L2W ? ch.L2W(DOOR_MAIN.x, halfD) : null;
    const ip = ch.interior.position;
    const target = w || { x: ip.x + DOOR_MAIN.x, z: ip.z + halfD };
    // `ch.doors` is the QA accessor (clubhouse.js's own comment says so).
    // `ch.doorApi` is passed INTO the sub-builders and is not on the returned
    // object — my first version read it, got an empty list, and reported "the
    // leaves never moved" about a clip that plainly shows them swinging open.
    // A probe that cannot see the thing reports the same as a thing that did
    // not happen, which is the fault this whole driver exists to avoid.
    const list = (ch.doors || []).map((d, i) => ({
      i, x: +d.world.x.toFixed(2), z: +d.world.z.toFixed(2),
      dist: +Math.hypot(d.world.x - target.x, d.world.z - target.z).toFixed(2),
    })).sort((a, b) => a.dist - b.dist);
    return {
      target: { x: +target.x.toFixed(2), z: +target.z.toFixed(2) },
      doorCount: (ch.doors || []).length,
      nearest: list.slice(0, 3),
    };
  });

  const doorState = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const list = ch.doors || [];
    return {
      count: list.length,
      angles: list.map((d) => (typeof d.angle === 'number' ? +d.angle.toFixed(4) : null)),
      desired: list.map((d) => !!d.desiredOpen),
    };
  });

  const distToDoor = () => page.evaluate((t) => {
    const st = window.__fw.scene3d.walk.state;
    return +Math.hypot(st.x - t.x, st.z - t.z).toFixed(2);
  }, door.target);

  // Stand back from the door, facing it. A teleport places the PLAYER, not the
  // door — the door object has still never been touched this session, which is
  // the cold state the complaint is about.
  await page.evaluate((t) => {
    const st = window.__fw.scene3d.walk.state;
    const back = 7.0;
    const dx = st.x - t.x; const dz = st.z - t.z;
    const h = Math.hypot(dx, dz) || 1;
    st.x = t.x + (dx / h) * back;
    st.z = t.z + (dz / h) * back;
    st.yaw = Math.atan2(-(t.x - st.x), -(t.z - st.z));
    st.pitch = -0.05;
    st.vx = 0; st.vz = 0;
  }, door.target);
  await page.waitForTimeout(1600);

  const before = await doorState();
  const startDist = await distToDoor();

  await page.evaluate(() => {
    window.__frameLog = [];
    // WHAT IS THE LONG FRAME DOING? Sampling the program count and the loaded
    // resource count beside every frame turns "there is a 13 second stall" into
    // "the stall compiled N programs and finished M downloads", which is the
    // difference between a finding and a complaint.
    const fw = window.__fw;
    const r = fw.scene3d.renderer;
    window.__stallDetail = [];
    // THE SPLIT THAT NAMES IT. scene3d.render is patchable from outside, so a
    // long frame can be attributed to the DRAW SUBMIT or to everything else
    // (sim, doors, customers, input). Those have completely different fixes and
    // no frame-time log can tell them apart.
    const origRender = fw.scene3d.render;
    window.__lastRenderMs = 0;
    fw.scene3d.render = function patched(...a) {
      const t0 = performance.now();
      const res = origRender.apply(this, a);
      window.__lastRenderMs = performance.now() - t0;
      return res;
    };
    const snap = () => ({
      programs: r.info.programs?.length ?? null,
      textures: r.info.memory?.textures ?? null,
      geometries: r.info.memory?.geometries ?? null,
      calls: r.info.render?.calls ?? null,
      triangles: r.info.render?.triangles ?? null,
      heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    });
    let prev = snap();
    let last = performance.now();
    const tick = (now) => {
      const dt = now - last;
      window.__frameLog.push(+dt.toFixed(2));
      const cur = snap();
      if (dt > 100) {
        window.__stallDetail.push({
          at: +now.toFixed(1),
          dtMs: +dt.toFixed(1),
          insideRenderMs: +(window.__lastRenderMs || 0).toFixed(1),
          before: prev,
          after: cur,
          delta: {
            programs: (cur.programs ?? 0) - (prev.programs ?? 0),
            textures: (cur.textures ?? 0) - (prev.textures ?? 0),
            geometries: (cur.geometries ?? 0) - (prev.geometries ?? 0),
            heapMb: cur.heapMb != null && prev.heapMb != null ? +(cur.heapMb - prev.heapMb).toFixed(1) : null,
          },
        });
      }
      prev = cur;
      last = now;
      window.__frameRaf = requestAnimationFrame(tick);
    };
    window.__frameRaf = requestAnimationFrame(tick);
    window.__mark = (label) => window.__frameLog.push(label);
  });
  const mark = (l) => page.evaluate((x) => window.__mark(x), l);
  const hold = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };

  await page.mouse.click(800, 450); // take the look with the player's own gesture
  await page.waitForTimeout(400);

  await mark('still');
  await page.waitForTimeout(3000);

  await mark('control-away');
  await hold('s', 2600); // movement, no door

  await mark('turn');
  await page.waitForTimeout(500);

  // Approach until the door is genuinely within reach, or give up and SAY SO.
  await mark('approach');
  let reached = false;
  for (let i = 0; i < 12 && !reached; i += 1) {
    await hold('w', 700);
    if ((await distToDoor()) < 2.2) reached = true;
  }
  const approachDist = await distToDoor();

  await mark('open');
  await page.keyboard.press('e');
  await page.waitForTimeout(2600);
  const after = await doorState();

  await mark('end');
  const { log, stallDetail } = await page.evaluate(() => {
    cancelAnimationFrame(window.__frameRaf);
    return { log: window.__frameLog, stallDetail: window.__stallDetail };
  });
  await page.screenshot({ path: path.join(OUT, 'at-the-door.png') });

  const phases = {};
  let current = null;
  for (const entry of log) {
    if (typeof entry === 'string') { current = entry; phases[current] = phases[current] || []; continue; }
    if (current) phases[current].push(entry);
  }
  const stat = (frames) => {
    if (!frames || !frames.length) return null;
    const s = [...frames].sort((a, b) => a - b);
    const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    return {
      frames: frames.length,
      median: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      worst: +s[s.length - 1].toFixed(2),
      over33: frames.filter((f) => f > 33).length,
      over100: frames.filter((f) => f > 100).length,
    };
  };

  const swung = Math.max(0, ...(before.angles || []).map(
    (a, i) => Math.abs((after.angles?.[i] ?? 0) - (a ?? 0)),
  ));
  const out = {
    door, startDist, approachDist, reached,
    doorBefore: before, doorAfter: after, swungRadians: +swung.toFixed(4),
    stallDetail,
    still: stat(phases.still),
    controlAway: stat(phases['control-away']),
    approach: stat(phases.approach),
    open: stat(phases.open),
    errs,
  };
  // THE GATE ON THE NUMBERS THEMSELVES. Nothing below is reportable unless the
  // leaves moved: that is the difference between this run and the last two.
  out.doorActuallyOpened = swung > 0.2;
  const worstControl = out.controlAway?.worst ?? 0;
  out.verdict = out.doorActuallyOpened ? {
    doorActuallyOpened: true,
    reachedTheDoor: reached,
    approachWorseThanControl: (out.approach?.worst ?? 0) > worstControl * 1.5,
    openWorseThanControl: (out.open?.worst ?? 0) > worstControl * 1.5,
    controlIsItselfOverBudget: (out.controlAway?.over33 ?? 0) > 0,
    stillWorstMs: out.still?.worst ?? null,
    controlWorstMs: worstControl,
    approachWorstMs: out.approach?.worst ?? null,
    openWorstMs: out.open?.worst ?? null,
    openOver100: out.open?.over100 ?? null,
  } : {
    doorActuallyOpened: false,
    reachedTheDoor: reached,
    distanceAtPress: approachDist,
    swungRadians: out.swungRadians,
    VOID: 'The leaves never moved. Every timing in this run is about a player '
      + 'standing near a shut door and is not evidence about door cost.',
  };
  fs.writeFileSync(path.join(OUT, 'door-hitch.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A3-DOOR', JSON.stringify(out.verdict, null, 2));
  return out;
}
