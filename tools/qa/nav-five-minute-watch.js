// THE FIVE-MINUTE WATCH — the shop's own contact number, and a clip of it.
//
// The instrument is proven first: tools/qa/nav-contact-detector-control.js has
// been watched staying silent on two people four yards apart, firing on two
// written onto the same point, and — the leg that matters — firing on two held
// 0.66 yd apart, which is visibly touching, is not interpenetration, and is
// ABOVE the old detector's threshold. This driver is the same watch pointed at
// organic play.
//
// It records video, because the brief's acceptance is a clip somebody has
// looked at and not a number. Run it with VIDEO_DIR set and extract frames
// afterwards; the numbers here exist to say WHERE in the five minutes to look.
//
// The player stands still by default. He is a neighbour in the crowd solve, so
// a driver that walks him around all five minutes is measuring itself as much
// as the shop; QA_NAV_PATROL=1 opts into a slow patrol for the doorway case.
//
//   VIDEO_DIR=qa/nav/before QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/nav-five-minute-watch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/nav');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'watch';
  const minutes = Number(process.env.QA_NAV_MINUTES || 5);
  const out = { tag, minutes, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')]
        .find((c) => /\bContinue\b/.test(c.querySelector('.menu-action-label')?.textContent || c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 90000 }).catch(() => {});
  }
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);
  for (let leg = 0; leg < 6; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6500 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(600);
    out.inside = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse?.();
      return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
    });
    if (out.inside) break;
  }
  if (!out.inside) fail('never got inside — this is not the room he watches');

  // AIM AT THE PEOPLE, AND PROVE THEY ARE IN FRAME.
  //
  // The first cut of this driver turned by a fixed 420 px and recorded five
  // minutes of the ceiling and the back-office desk with not one customer in
  // shot (qa/nav/before, tiles-13). That is the same fault that parked the D6
  // driver, and a clip of the wrong thing is worse than no clip: it invites a
  // verdict. So the camera is aimed at the centroid of the visible customers by
  // calibrated one-shot, re-aimed as they move, and the run FAILS if they were
  // not actually on screen for most of it.
  const YAW_PER_PX = -0.001927;
  const PITCH_PER_PX = -0.0019;
  const cx = Math.round(vp.w / 2);
  const cy = Math.round(vp.h / 2);
  await page.evaluate(() => {
    window.__navAim = {
      project(x, y, z) {
        const cam = window.__fw.scene3d.camera;
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        const v = cam.matrixWorldInverse.elements;
        const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
        const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
        const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
        const p = cam.projectionMatrix.elements;
        const ax = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
        const ay = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
        const aw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        if (!aw || aw <= 0) return null;
        return { ndcX: ax / aw, ndcY: ay / aw };
      },
      // how many visible customers project inside the frame, right now
      onScreen() {
        const ch = window.__fw.scene3d.clubhouse();
        let n = 0;
        for (const c of (ch.customers() || [])) {
          if (!c.mesh || c.mesh.visible === false) continue;
          const p = this.project(c.mesh.position.x, c.mesh.position.y + 1.0, c.mesh.position.z);
          if (p && Math.abs(p.ndcX) < 0.95 && Math.abs(p.ndcY) < 0.95) n += 1;
        }
        return n;
      },
      centroid() {
        const ch = window.__fw.scene3d.clubhouse();
        const live = (ch.customers() || []).filter((c) => c.mesh && c.mesh.visible !== false);
        if (!live.length) return null;
        let x = 0;
        let z = 0;
        for (const c of live) { x += c.mesh.position.x; z += c.mesh.position.z; }
        return { x: x / live.length, y: live[0].mesh.position.y + 0.9, z: z / live.length, n: live.length };
      },
    };
  });
  const aimAtPeople = async (tries = 6) => {
    for (let i = 0; i < tries; i += 1) {
      const t = await page.evaluate(() => {
        const A = window.__navAim;
        const p = A.centroid();
        if (!p) return null;
        const w = window.__fw.scene3d.walk.state;
        const cam = window.__fw.scene3d.camera;
        const d = Math.hypot(p.x - w.x, p.z - w.z);
        let dy = Math.atan2(-(p.x - w.x), -(p.z - w.z)) - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        return { dy, dp: Math.atan2(p.y - cam.position.y, d) - w.pitch, onScreen: A.onScreen(), n: p.n };
      });
      if (!t) return { ok: false, why: 'nobody visible to aim at' };
      if (t.onScreen >= Math.min(2, t.n) && Math.abs(t.dy) < 0.35) return { ok: true, iters: i, onScreen: t.onScreen };
      await page.mouse.move(cx, cy);
      await page.mouse.move(
        cx + Math.round(Math.max(-1400, Math.min(1400, t.dy / YAW_PER_PX))),
        cy + Math.round(Math.max(-350, Math.min(350, t.dp / PITCH_PER_PX))),
        { steps: 14 },
      );
      await page.waitForTimeout(220);
    }
    return { ok: false, why: 'aim did not converge' };
  };
  out.firstAim = await aimAtPeople();
  await page.waitForTimeout(600);

  out.stage = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse();
    return {
      player: { x: +w.x.toFixed(2), z: +w.z.toFixed(2), yaw: +w.yaw.toFixed(3) },
      customers: (ch.customers() || []).filter((c) => c.mesh && c.mesh.visible !== false).length,
      speedIdx: window.__fw.speedIdx,
      signOpen: !!window.__fw.state?.holdings?.[0]?.state?.shop?.signOpen,
    };
  });

  await page.evaluate(() => window.__fw.scene3d.clubhouse().resetContactWatch());
  out.watchStartedAt = await page.evaluate(() => +performance.now().toFixed(0));

  // Sample the running totals every 15 s so the report can say WHEN, and so a
  // dead sim (nobody ever arrives) is visible rather than reported as clean.
  const samples = [];
  const patrol = process.env.QA_NAV_PATROL === '1';
  const until = Date.now() + minutes * 60000;
  let tick = 0;
  while (Date.now() < until) {
    await page.waitForTimeout(15000);
    tick += 1;
    const s = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const w = ch.contactWatchDiagnostics();
      return {
        t: +w.seconds.toFixed(0),
        people: w.people,
        preTouch: w.beforeSolver.framesTouching,
        preHard: w.beforeSolver.framesInterpenetrating,
        postTouch: w.afterSolver.framesTouching,
        closest: w.beforeSolver.closestApproachYd,
        corrFrames: w.corrections.frames,
        episodes: w.episodes.count,
      };
    });
    // THE FRAMING GATE. Recorded every sample, so the clip's worth is a number
    // in the report rather than something discovered by opening a tile sheet.
    s.onScreen = await page.evaluate(() => window.__navAim.onScreen());
    if (s.onScreen < 2) { out.reaims = (out.reaims || 0) + 1; await aimAtPeople(4); }
    samples.push(s);
    console.log(`[${String(s.t).padStart(3)}s] people=${s.people} onScreen=${s.onScreen} preTouch=${s.preTouch} preHard=${s.preHard} `
      + `postTouch=${s.postTouch} closest=${s.closest} shoveFrames=${s.corrFrames} episodes=${s.episodes}`);
    if (patrol && tick % 4 === 0) {
      await page.keyboard.down('w');
      await page.waitForTimeout(900);
      await page.keyboard.up('w');
      await page.mouse.move(Math.round(vp.w / 2), Math.round(vp.h / 2));
      await page.mouse.move(Math.round(vp.w / 2) + 300, Math.round(vp.h / 2), { steps: 16 });
    }
    if (tick % 4 === 0) {
      await page.screenshot({ path: path.join(OUT, `${tag}-t${s.t}.png`) });
    }
  }

  out.samples = samples;
  out.watch = await page.evaluate(() => window.__fw.scene3d.clubhouse().contactWatchDiagnostics());
  out.oldDetector = await page.evaluate(() => window.__fw.scene3d.clubhouse().crowdDiagnostics());
  out.nav = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return typeof ch.navBlockDiagnostics === 'function' ? ch.navBlockDiagnostics() : null;
  });
  await page.screenshot({ path: path.join(OUT, `${tag}-final.png`) });

  if (out.watch.people < 2 && !samples.some((s) => s.people >= 2)) {
    fail('never had two people in the room at once — this watch has measured nothing about crowds');
  }
  const framed = samples.filter((s) => (s.onScreen || 0) >= 2).length;
  out.framing = {
    samples: samples.length,
    withTwoOnScreen: framed,
    pct: +(100 * framed / Math.max(1, samples.length)).toFixed(1),
    reaims: out.reaims || 0,
  };
  if (out.framing.pct < 60) {
    fail(`the clip had two customers in frame in only ${out.framing.pct}% of samples — `
      + 'it is a recording of the room, not of the crowd, and no verdict may be read off it');
  }

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    tag,
    minutes,
    stage: out.stage,
    seconds: out.watch.seconds,
    frames: out.watch.frames,
    contactYd: out.watch.contactYd,
    beforeSolver: out.watch.beforeSolver,
    afterSolver: out.watch.afterSolver,
    corrections: out.watch.corrections,
    episodes: {
      count: out.watch.episodes.count,
      perMinute: out.watch.episodes.perMinute,
      hard: out.watch.episodes.hard,
      longestFrames: out.watch.episodes.longestFrames,
    },
    oldDetectorSaid: { pairs: out.oldDetector.pairs, worstOverlap: out.oldDetector.worstOverlap },
    framing: out.framing,
    failures: out.failures,
  }, null, 2));
  return out;
}
