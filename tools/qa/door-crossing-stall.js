// THE STALL, INSTRUMENTED AT THE DOOR — because no driver here has ever walked
// through one.
//
// The owner can reproduce a multi-second hitch and named the trigger: running
// back toward the door and through it, and switching items around that moment.
// That is spatial, and every perf driver in this repo measures a player standing
// in one room. So this walks the threshold, both directions, sampling EVERY
// frame, and it records what changes at the moment it hurts.
//
// THE HYPOTHESIS UNDER TEST is his: crossing is where the interior visibility
// gate fires. src/render3d/clubhouse.js runs syncCameraVisibility() on a 2 Hz
// tick (`if (visClock > 0.5)`) and that call sets `interior.visible` off a
// distance test against CLUBHOUSE_INTERIOR_DRAW_DISTANCE (80 yd), and separately
// drives props61to100.setCameraVisibility(). If a crossing flips which materials
// are live, the renderer may relink programs on that frame.
//
// WHAT IS RECORDED, per frame, in the page:
//   dt                the frame interval (rAF), so the HISTOGRAM is available
//   programs          renderer.info.programs.length -- a relink shows here
//   geometries, textures  renderer.info.memory -- an upload shows here
//   interiorVisible   the gate's own output
//   isInside, dist    where the player actually was on that frame
// plus a timer-queue block recorder, because a frame that blocks for seconds
// produces too few rAF callbacks to have any gaps of its own.
//
// FOUR STATIONS so a crossing can be compared with not crossing:
//   A  stand still INSIDE          the control for indoor work
//   B  walk OUT through the door
//   C  stand still OUTSIDE         the control for outdoor work
//   D  run BACK IN through the door
// and belt presses in the two seconds either side of each crossing.
//
// THE CONTROL is a deliberate 400 ms block taken on the same recorder in the
// same session. If a known block does not appear, no quiet crossing means
// anything.
//
//   node tools/qa/run-electron.cjs tools/qa/door-crossing-stall.js --clubhouse=pine-hills-v2
//
// QA_DOOR_FAR   how far outside to walk, in yards (default 26). Set it past 80
//               to cross CLUBHOUSE_INTERIOR_DRAW_DISTANCE as well.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/door-stall';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], phases: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };
  const FAR = Number(process.env.QA_DOOR_FAR || 26);

  // QA_FORCE_WARM=belt-outdoor puts a RETIRED warm stage back for this boot, so
  // "what did retiring it cost at the door" is a measurement rather than an
  // argument. Set on the live page before the menu click, because the runner
  // hands this driver an already-loaded page and an init script never runs.
  const FORCE = process.env.QA_FORCE_WARM || '';
  await page.evaluate((v) => { window.__fwForceWarm = v; }, FORCE);
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  if (FORCE) console.log(`warm stages forced back on: ${FORCE}`);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // The belt has to exist, or "pressing tools at the door" presses nothing.
  await page.evaluate(() => {
    const inv = window.__fw.state.shop.inventory;
    inv.vac1 = inv.vac1 || { shelf: 0, back: 0 };
    inv.vac1.back = Math.max(1, inv.vac1.back);
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
  });

  // Where the door actually is, from the live interior rather than a constant.
  out.geometry = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    return {
      center: { x: +c.x.toFixed(2), z: +c.z.toFixed(2) },
      // The main door in interior-local coordinates, converted to world.
      inside: ch.localToWorld(-0.8, 2.6),
      doorway: ch.localToWorld(-0.8, 5.2),
      outside: ch.localToWorld(-0.8, 8.5),
    };
  });
  console.log(`clubhouse centre ${JSON.stringify(out.geometry.center)}`);

  // ---------------------------------------------------------------- recorder
  await page.evaluate(() => {
    const w = window;
    w.__fwDoor = { on: false, rows: [], last: 0, label: '', blockLast: 0, worstBlock: 0 };
    const D = w.__fwDoor;
    const raf = (t) => {
      if (D.on && D.last) {
        const sc = w.__fw.scene3d;
        const info = sc.renderer?.info;
        const ch = sc.clubhouse?.();
        const st = sc.walk?.state;
        const c = ch?.interior?.position;
        const dx = (st?.x ?? 0) - (c?.x ?? 0);
        const dz = (st?.z ?? 0) - (c?.z ?? 0);
        D.rows.push({
          label: D.label,
          dt: +(t - D.last).toFixed(2),
          programs: info?.programs?.length ?? -1,
          geometries: info?.memory?.geometries ?? -1,
          textures: info?.memory?.textures ?? -1,
          interiorVisible: ch?.interior?.visible === true,
          inside: ch?.isInside ? !!ch.isInside(st.x, st.z) : null,
          dist: +Math.hypot(dx, dz).toFixed(1),
          x: +(st?.x ?? 0).toFixed(2), z: +(st?.z ?? 0).toFixed(2),
        });
      }
      D.last = t;
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    // The timer queue: it lands a sample once a block ENDS, whether or not any
    // frame drew during it. A pure rAF recorder reports null for exactly the
    // events that stall.
    const timer = () => {
      const t = performance.now();
      if (D.on && D.blockLast) D.worstBlock = Math.max(D.worstBlock, t - D.blockLast);
      D.blockLast = t;
      setTimeout(timer, 0);
    };
    setTimeout(timer, 0);
  });

  const begin = (label) => page.evaluate((l) => {
    const D = window.__fwDoor;
    D.label = l; D.on = true; D.worstBlock = 0; D.blockLast = 0; D.last = 0;
  }, label);
  const end = () => page.evaluate(() => {
    const D = window.__fwDoor;
    D.on = false;
    return +D.worstBlock.toFixed(1);
  });

  // Move the player along a straight line at a running pace, stepping the
  // controller's own state each frame -- the walk controller is authoritative
  // for collisions, so this is a real traversal and not a teleport.
  const glide = (from, to, seconds) => page.evaluate(([a, b, secs]) => new Promise((done) => {
    const st = window.__fw.scene3d.walk.state;
    const t0 = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / (secs * 1000));
      st.x = a.x + (b.x - a.x) * u;
      st.z = a.z + (b.z - a.z) * u;
      st.yaw = Math.atan2(st.x - b.x, st.z - b.z);
      if (u < 1) requestAnimationFrame(step); else done(true);
    };
    requestAnimationFrame(step);
  }), [from, to, seconds]);

  const tap = async () => {
    await page.keyboard.down('f');
    await page.waitForTimeout(90);
    await page.keyboard.up('f');
    await page.waitForTimeout(320);
  };

  const phase = async (label, fn) => {
    await begin(label);
    await fn();
    const worst = await end();
    const rows = await page.evaluate((l) => {
      const r = window.__fwDoor.rows.filter((x) => x.label === l);
      window.__fwDoor.rows = window.__fwDoor.rows.filter((x) => x.label !== l);
      return r;
    }, label);
    const dts = rows.map((r) => r.dt).sort((a, b) => a - b);
    const q = (p) => (dts.length ? +dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(1) : null);
    const p0 = rows[0] || {};
    const pN = rows[rows.length - 1] || {};
    const row = {
      label,
      frames: rows.length,
      p50: q(0.5), p95: q(0.95), p99: q(0.99), max: dts.length ? +dts[dts.length - 1].toFixed(1) : null,
      worstBlockMs: worst,
      over100: rows.filter((r) => r.dt > 100).length,
      over1000: rows.filter((r) => r.dt > 1000).length,
      dPrograms: (pN.programs ?? 0) - (p0.programs ?? 0),
      dGeometries: (pN.geometries ?? 0) - (p0.geometries ?? 0),
      dTextures: (pN.textures ?? 0) - (p0.textures ?? 0),
      interiorVisibleFlips: rows.reduce((a, r, i) => (
        i && r.interiorVisible !== rows[i - 1].interiorVisible ? a + 1 : a), 0),
      insideFlips: rows.reduce((a, r, i) => (
        i && r.inside !== rows[i - 1].inside ? a + 1 : a), 0),
    };
    // The worst frame, with everything that was true when it happened.
    const worstRow = rows.reduce((a, r) => (r.dt > (a?.dt ?? -1) ? r : a), null);
    row.worstFrame = worstRow;
    out.phases.push(row);
    console.log(`  ${label.padEnd(30)} n=${String(row.frames).padStart(4)}  p50 ${String(row.p50).padStart(6)}`
      + `  p99 ${String(row.p99).padStart(7)}  max ${String(row.max).padStart(8)}`
      + `  block ${String(row.worstBlockMs).padStart(8)}  >100ms ${String(row.over100).padStart(3)}`
      + `  dProg ${String(row.dPrograms).padStart(4)}  visFlips ${row.interiorVisibleFlips}`);
    return row;
  };

  // ---- CONTROL: a block this recorder must be able to see.
  console.log('\n== CONTROL ==');
  const ctl = await phase('deliberate 400 ms block', async () => {
    await page.evaluate(() => new Promise((r) => {
      setTimeout(() => {
        const end2 = performance.now() + 400;
        while (performance.now() < end2) { /* spin on purpose */ }
        r();
      }, 200);
    }));
    await page.waitForTimeout(600);
  });
  if (!(ctl.worstBlockMs >= 350)) {
    fail(`a deliberate 400 ms block read ${ctl.worstBlockMs} ms — this recorder cannot see a stall, so every quiet row below is meaningless`);
  }

  // ---- THE STATIONS
  const g = out.geometry;
  console.log('\n== STATIONS ==');

  await page.evaluate((p) => {
    const st = window.__fw.scene3d.walk.state;
    st.x = p.x; st.z = p.z;
  }, g.inside);
  await page.waitForTimeout(2000);

  await phase('A  stand still INSIDE', () => page.waitForTimeout(4000));
  await phase('A2 belt presses INSIDE', async () => { for (let i = 0; i < 4; i += 1) await tap(); });

  await phase('B  walk OUT through the door', async () => {
    await glide(g.inside, g.outside, 2.2);
    await page.waitForTimeout(600);
  });
  await phase('B2 belt presses just OUTSIDE', async () => { for (let i = 0; i < 4; i += 1) await tap(); });

  // Out to FAR and back, which is what crosses the 80 yd interior draw distance
  // when QA_DOOR_FAR is set past it.
  const far = { x: g.outside.x, z: g.outside.z + FAR };
  await phase(`C  walk out to ${FAR} yd`, async () => {
    await glide(g.outside, far, 3.0);
    await page.waitForTimeout(1500);
  });
  await phase('C2 stand still OUTSIDE', () => page.waitForTimeout(4000));
  await phase('C3 belt presses OUTSIDE', async () => { for (let i = 0; i < 4; i += 1) await tap(); });

  await phase('D  RUN BACK to the door', async () => {
    await glide(far, g.outside, 2.4);
  });
  await phase('D2 RUN BACK IN through the door', async () => {
    await glide(g.outside, g.inside, 1.6);
    await page.waitForTimeout(600);
  });
  await phase('D3 belt presses just INSIDE', async () => { for (let i = 0; i < 4; i += 1) await tap(); });

  // ---- THE VERDICT
  const crossings = out.phases.filter((p) => /walk OUT|RUN BACK IN/.test(p.label));
  const stills = out.phases.filter((p) => /stand still/.test(p.label));
  const worstCross = crossings.reduce((a, p) => (p.worstBlockMs > (a?.worstBlockMs ?? -1) ? p : a), null);
  const worstStill = stills.reduce((a, p) => (p.worstBlockMs > (a?.worstBlockMs ?? -1) ? p : a), null);
  out.verdict = {
    worstCrossingMs: worstCross?.worstBlockMs ?? null,
    worstCrossingAt: worstCross?.label ?? null,
    worstStandingStillMs: worstStill?.worstBlockMs ?? null,
  };
  console.log(`\nworst block CROSSING a threshold: ${out.verdict.worstCrossingMs} ms  (${out.verdict.worstCrossingAt})`);
  console.log(`worst block STANDING STILL:       ${out.verdict.worstStandingStillMs} ms`);

  const allProg = out.phases.reduce((a, p) => a + Math.max(0, p.dPrograms), 0);
  console.log(`programs minted across the whole run: ${allProg}`);

  fs.writeFileSync(`${OUT}/door.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
