// GOAL 33 PART 0 — WHICH POPULATION IS THE PLAYER LOOKING AT?
//
// "There are two customer populations in this codebase — sim/customerSimulation.js's
//  `active` and clubhouse.customers() — and the tests have historically read the one
//  the player never sees."
//
// Reading the imports answers this on paper (clubhouse/customers.js is imported by
// nothing; the live array is inline in clubhouse.js). Paper is what produced three
// clean probes about visibly broken things. So this settles it in PIXELS:
//
//   1. Customers arrive ORGANICALLY — the shop's own footfall loop at the game's own
//      speed control. Nothing is spawned, placed, or teleported.
//   2. Every body in clubhouse.customers() is painted emissive magenta
//      (toneMapped:false, fog:false — neither ACES nor the lighting can hide it).
//   3. A real screenshot is taken through the full pipeline.
//   4. Each population's world positions are projected through the LIVE camera
//      matrices and the screenshot is sampled at those pixels. The population whose
//      coordinates land on painted bodies is the one the player watches.
//
// CONTROLS (golf-qa law 1 — an instrument that cannot fail measures nothing):
//   noise floor  — unpainted frame must contain ~no magenta, or counting is void.
//   detection    — painted frame must contain a lot of magenta, or the probe is blind.
//   offset       — the same projected points shifted 2.5 yd sideways must MISS.
//                  Without this, "the projection hit paint" could just mean the
//                  screen is full of paint.
//
//   node tools/qa/run-electron.cjs tools/qa/goal33-part0-populations.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const sharp = (await import('sharp')).default;
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'part0', errs: [], failures: [], notes: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  const note = (why) => { out.notes.push(why); console.log('NOTE:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  // QA_RESUME=1 boots his seeded save. A FRESH profile cannot answer this
  // question at all: the starter shop's sign defaults to CLOSED, so
  // shopAcceptsWalkIns is false and nobody ever walks in — the first run of this
  // driver waited 181 s and measured an empty room.
  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const cont = [...document.querySelectorAll('button')]
        .find((b) => /\bContinue\b/.test(
          b.querySelector('.menu-action-label')?.textContent || b.textContent || '',
        ));
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
  await page.waitForTimeout(4000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
  out.viewport = vp;
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);

  // ---- projection helpers, installed in the page -----------------------------
  // matrixWorld, not local transforms, and no THREE import: the camera's own
  // Matrix4 instances carry the methods.
  await page.evaluate(() => {
    window.__p0 = {
      project(x, y, z) {
        const cam = window.__fw.scene3d.camera;
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        const v = cam.matrixWorldInverse.elements;
        const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
        const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
        const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
        const p = cam.projectionMatrix.elements;
        const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
        const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
        const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        if (!cw) return null;
        return {
          ndcX: cx / cw,
          ndcY: cy / cw,
          behind: cw <= 0,
          sx: (cx / cw * 0.5 + 0.5) * window.innerWidth,
          sy: (-(cy / cw) * 0.5 + 0.5) * window.innerHeight,
          dist: Math.hypot(vx, vy, vz),
        };
      },
      // World position of a customer body, from the matrix the renderer used.
      bodyPos(c) {
        c.mesh.updateWorldMatrix(true, false);
        const e = c.mesh.matrixWorld.elements;
        return { x: e[12], y: e[13], z: e[14] };
      },
    };
  });

  // ---- let the shop fill up on its own ---------------------------------------
  // NOTHING is spawned, placed or hurried. The footfall loop decides who walks
  // in and when, through the real door.
  //
  // speedIdx is LEFT ALONE. BALANCE.speeds is [0, 1] — there is no fast-forward
  // rung — so the `speedIdx = 2` that several older drivers set resolves to
  // undefined and the `if (speed > 0)` clock gate goes false: it PAUSES the day
  // while looking like a fast-forward. The shop then never opens, nobody
  // arrives, and the driver reports a healthy empty room.
  out.shop = await page.evaluate(() => {
    const st = window.__fw.state;
    return {
      clockMinutes: st.clock?.minutes ?? null,
      signOpen: !!st.shop?.signOpen,
      speedIdx: window.__fw.speedIdx,
      scheduled: st.shop?.customerSimulation?.scheduled?.length ?? null,
    };
  });
  console.log('SHOP', JSON.stringify(out.shop));
  const waitStart = Date.now();
  let population = 0;
  const WAIT_MS = Number(process.env.QA_ARRIVAL_WAIT_MS || 480000);
  while (Date.now() - waitStart < WAIT_MS) {
    const s = await page.evaluate(() => ({
      n: window.__fw.scene3d.clubhouse().customers().length,
      minutes: window.__fw.state.clock?.minutes ?? null,
    }));
    population = s.n;
    if (population >= 2) break;
    if ((Date.now() - waitStart) % 30000 < 1100) {
      console.log(`waiting: ${population} in the room, clock ${Math.round(s.minutes)} (${Math.floor(s.minutes / 60)}:${String(Math.round(s.minutes % 60)).padStart(2, '0')})`);
    }
    await page.waitForTimeout(1000);
  }
  out.arrivalWaitMs = Date.now() - waitStart;
  out.populationAfterWait = population;
  if (population < 1) fail(`no customer arrived organically in ${Math.round(out.arrivalWaitMs / 1000)} s — nothing to measure`);

  // ---- aim at the crowd with REAL MOUSE INPUT --------------------------------
  // Closed loop: read where the body projects, move the mouse, read again. The
  // game's own pointer-lock mouse-look does the turning.
  // Does synthetic mouse input actually turn the camera in this harness? Yaw is
  // read before and after, because an aim loop that silently does nothing would
  // leave every screenshot pointed wherever the boot left it — and the pacing
  // legs in Block A claim to sweep with the mouse too.
  const cx = Math.round(vp.w / 2);
  const cy = Math.round(vp.h / 2);
  const nudge = async (dx, dy) => {
    await page.mouse.move(cx, cy);
    await page.mouse.move(cx + Math.round(dx), cy + Math.round(dy), { steps: 12 });
    await page.waitForTimeout(140);
  };
  // CALIBRATE the mouse, then aim in one shot. An iterative "move a bit and look
  // again" loop never converged (60 iterations, body still off frame), and a
  // loop that cannot aim leaves the screenshot pointed wherever the boot left
  // it — which is how a probe ends up photographing an empty corner and
  // reporting that it found nothing.
  out.mouseLookControl = await (async () => {
    const read = () => page.evaluate(() => ({
      yaw: window.__fw.scene3d.walk.state.yaw,
      pitch: window.__fw.scene3d.walk.state.pitch,
    }));
    const a = await read();
    await nudge(400, 0);
    const b = await read();
    await nudge(-400, 0);
    await nudge(0, 200);
    const c = await read();
    await nudge(0, -200);
    const wrap = (d) => { let x = d; while (x > Math.PI) x -= Math.PI * 2; while (x < -Math.PI) x += Math.PI * 2; return x; };
    return {
      yawPerPx: +(wrap(b.yaw - a.yaw) / 400).toFixed(6),
      pitchPerPx: +((c.pitch - b.pitch) / 200).toFixed(6),
      moved: Math.abs(wrap(b.yaw - a.yaw)) > 0.01,
    };
  })();
  console.log('MOUSELOOK', JSON.stringify(out.mouseLookControl));
  if (!out.mouseLookControl.moved) fail('synthetic mouse movement does not turn the camera — aiming is impossible');

  // Aim at the nearest body, re-read live each attempt because they are walking.
  const aimAtNearestBody = async () => {
    const cal = out.mouseLookControl;
    const trace = [];
    for (let i = 0; i < 8; i += 1) {
      const t = await page.evaluate(() => {
        const ch = window.__fw.scene3d.clubhouse();
        const w = window.__fw.scene3d.walk.state;
        const cam = window.__fw.scene3d.camera;
        let best = null;
        for (const c of ch.customers()) {
          // A body whose mesh is switched off is not a subject. The first
          // calibrated aim locked onto one 0.9 yd away and photographed nothing.
          if (!c.mesh || c.mesh.visible === false) continue;
          const b = window.__p0.bodyPos(c);
          const d = Math.hypot(b.x - w.x, b.z - w.z);
          // Too close and the body is half outside the frustum; score by how far
          // it is from a comfortable 3 yd portrait distance.
          const score = Math.abs(d - 3);
          if (!best || score < best.score) best = { d, b, score };
        }
        if (!best) return null;
        const { b, d } = best;
        // The yaw that points the walk camera at a world point, in the game's
        // own convention (see queue-slot facing in clubhouse.js).
        const wantYaw = Math.atan2(-(b.x - w.x), -(b.z - w.z));
        const wantPitch = Math.atan2((b.y + 0.9) - cam.position.y, d);
        const pr = window.__p0.project(b.x, b.y + 0.9, b.z);
        return {
          wantYaw, wantPitch, yaw: w.yaw, pitch: w.pitch, dist: d,
          ndcX: pr ? pr.ndcX : null, ndcY: pr ? pr.ndcY : null, behind: pr ? pr.behind : null,
        };
      });
      if (!t) return { ok: false, why: 'no bodies to aim at' };
      trace.push({ ndcX: t.ndcX == null ? null : +t.ndcX.toFixed(3), dist: +t.dist.toFixed(1) });
      if (t.behind === false && Math.abs(t.ndcX) < 0.3 && Math.abs(t.ndcY) < 0.55) {
        return { ok: true, iters: i, trace, dist: +t.dist.toFixed(1) };
      }
      const wrap = (d) => { let x = d; while (x > Math.PI) x -= Math.PI * 2; while (x < -Math.PI) x += Math.PI * 2; return x; };
      const dYaw = wrap(t.wantYaw - t.yaw);
      const dPitch = t.wantPitch - t.pitch;
      const px = cal.yawPerPx ? dYaw / cal.yawPerPx : 0;
      const py = cal.pitchPerPx ? dPitch / cal.pitchPerPx : 0;
      await nudge(Math.max(-1200, Math.min(1200, px)), Math.max(-400, Math.min(400, py)));
    }
    return { ok: false, trace: trace.slice(-6) };
  };

  out.aim = await aimAtNearestBody();
  console.log('AIM', JSON.stringify(out.aim));
  if (!out.aim.ok) note('the aim never framed a body; frames may not contain the crowd');
  await page.waitForTimeout(600);

  // ---- both populations, as the game holds them ------------------------------
  const snapshot = async () => page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const visible = ch.customers().map((c) => {
      const p = window.__p0.bodyPos(c);
      return {
        customerId: c.customerId ?? null,
        name: c.fullName ?? null,
        x: +p.x.toFixed(3),
        y: +p.y.toFixed(3),
        z: +p.z.toFixed(3),
        meshVisible: c.mesh?.visible !== false,
        stop: c.stops?.[c.stopIdx]?.kind ?? null,
        queued: !!c.queued,
      };
    });
    const sim = fw.state?.shop?.customerSimulation || null;
    const active = (sim?.active || []).map((c) => ({
      id: c.id ?? null,
      state: c.state ?? null,
      intent: c.intent ?? null,
      position: c.position ? { x: c.position.x, z: c.position.z } : null,
      pathNodes: Array.isArray(c.currentPath) ? c.currentPath.length : null,
    }));
    return {
      visible,
      active,
      simCounts: {
        active: sim?.active?.length ?? null,
        scheduled: sim?.scheduled?.length ?? null,
        serviceQueue: sim?.serviceQueue?.length ?? null,
        spawned: sim?.metrics?.spawned ?? null,
      },
      walk: { x: fw.scene3d.walk.state.x, z: fw.scene3d.walk.state.z, yaw: fw.scene3d.walk.state.yaw },
    };
  });
  out.snapshot = await snapshot();
  out.counts = {
    visibleBodies: out.snapshot.visible.length,
    simActive: out.snapshot.active.length,
    simActiveWithPosition: out.snapshot.active.filter((c) => c.position).length,
  };

  // ---- paint every visible body ----------------------------------------------
  const setPaint = (on) => page.evaluate((paintOn) => {
    const W = window;
    if (!W.__p0paint) W.__p0paint = { stash: [] };
    const P = W.__p0paint;
    const ch = W.__fw.scene3d.clubhouse();
    if (paintOn) {
      let painted = 0;
      const perBody = [];
      for (const c of ch.customers()) {
        if (!c.mesh) continue;
        const before = painted;
        c.mesh.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const repl = mats.map((orig) => {
            const m = new orig.constructor();
            if (m.emissive) { m.color?.set?.(0x000000); m.emissive.set(0xff00ff); m.emissiveIntensity = 4; }
            else m.color?.set?.(0xff00ff);
            m.toneMapped = false;
            m.fog = false;
            m.transparent = false;
            m.opacity = 1;
            m.side = orig.side;
            m.skinning = orig.skinning;
            return m;
          });
          P.stash.push({ mesh: o, original: o.material });
          o.material = Array.isArray(o.material) ? repl : repl[0];
          painted += 1;
        });
        perBody.push({
          id: c.customerId ?? null,
          meshes: painted - before,
          meshVisible: c.mesh.visible !== false,
        });
      }
      return { painted, bodies: ch.customers().length, perBody };
    }
    for (const { mesh, original } of P.stash) mesh.material = original;
    const n = P.stash.length;
    P.stash = [];
    return { restored: n };
  }, on);

  const grab = async (label) => {
    const file = path.join(OUT, `p0-${label}.png`);
    const buf = await page.screenshot({ path: file });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    let magenta = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] >= 140 && data[i + 1] <= 100 && data[i + 2] >= 140) magenta += 1;
    }
    return { label, file, magenta, data, info };
  };

  // Sample a square window around a projected point and count magenta in it.
  const sampleAt = (shot, sx, sy, half = 7) => {
    const scaleX = shot.info.width / vp.w;
    const scaleY = shot.info.height / vp.h;
    const px = Math.round(sx * scaleX);
    const py = Math.round(sy * scaleY);
    let hits = 0;
    let looked = 0;
    for (let y = py - half; y <= py + half; y += 1) {
      if (y < 0 || y >= shot.info.height) continue;
      for (let x = px - half; x <= px + half; x += 1) {
        if (x < 0 || x >= shot.info.width) continue;
        const i = (y * shot.info.width + x) * shot.info.channels;
        looked += 1;
        if (shot.data[i] >= 140 && shot.data[i + 1] <= 100 && shot.data[i + 2] >= 140) hits += 1;
      }
    }
    return { px, py, hits, looked };
  };

  const noise = await grab('00-unpainted');
  out.controlNoiseFloor = noise.magenta;
  out.paint = await setPaint(true);
  await page.waitForTimeout(300);
  // POSITIONS AND PROJECTION IN ONE TICK, THEN THE SHOT WITH NOTHING IN BETWEEN.
  // The first working version snapshotted positions, then painted, then waited,
  // then shot — about a second, during which the bodies WALKED. 1,955 magenta
  // pixels were in the frame and not one projected point landed on them, which
  // reads exactly like "these are not the bodies on screen" and was really a
  // stale coordinate.
  const live = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const rows = [];
    for (const c of ch.customers()) {
      if (!c.mesh) continue;
      const b = window.__p0.bodyPos(c);
      const pr = window.__p0.project(b.x, b.y + 0.9, b.z);
      const off = window.__p0.project(b.x + 2.5, b.y + 0.9, b.z);
      rows.push({
        id: c.customerId ?? null,
        meshVisible: c.mesh.visible !== false,
        world: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2) },
        self: pr, offset: off,
      });
    }
    return rows;
  });
  const painted = await grab('01-painted');
  out.paintedMagenta = painted.magenta;
  out.liveProjection = live;

  if (noise.magenta > 200) fail(`noise floor ${noise.magenta} px — the unpainted world already reads magenta, counting is void`);
  if (painted.magenta < 400) fail(`painted frame has only ${painted.magenta} px — no body is in shot, so the population test cannot run`);

  // ---- the actual question: whose coordinates land on the paint? -------------
  // A body walks ~1.3 yd/s, so a tenth of a second of unavoidable slack between
  // the projection tick and the captured frame is tens of pixels at 4 yd. The
  // window is 30 px; the offset control sits ~800 px away at that distance, so
  // it still discriminates by a wide margin.
  const score = (p) => {
    if (!p || p.behind || p.sx < 0 || p.sy < 0 || p.sx > vp.w || p.sy > vp.h) return { onScreen: false, hits: 0 };
    const s = sampleAt(painted, p.sx, p.sy, 30);
    return { onScreen: true, sx: Math.round(p.sx), sy: Math.round(p.sy), hits: s.hits, looked: s.looked };
  };
  out.visibleProjection = live.map((r) => ({ id: r.id, meshVisible: r.meshVisible, ...score(r.self) }));
  out.offsetControl = live.map((r) => ({ id: `${r.id}-offset`, ...score(r.offset) }));
  // The sim's own people, if it has any with coordinates at all.
  const simPts = out.snapshot.active.filter((c) => c.position)
    .map((c) => ({ id: c.id, x: c.position.x, y: 0, z: c.position.z }));
  const simProj = simPts.length
    ? await page.evaluate((pts) => pts.map((p) => ({ id: p.id, ...(window.__p0.project(p.x, p.y, p.z) || {}) })), simPts)
    : [];
  out.simProjection = simProj.map((p) => ({ id: p.id, ...score(p) }));

  const onScreenHits = (rows) => {
    const on = rows.filter((r) => r.onScreen);
    return { onScreen: on.length, withPaint: on.filter((r) => r.hits > 0).length };
  };
  out.verdict = {
    clubhouseCustomers: onScreenHits(out.visibleProjection),
    simActive: onScreenHits(out.simProjection),
    offsetControl: onScreenHits(out.offsetControl),
  };

  await setPaint(false);
  await page.waitForTimeout(200);
  const after = await grab('02-restored');
  out.restoredMagenta = after.magenta;
  if (after.magenta > 200) fail(`paint did not restore (${after.magenta} px left) — the world was mutated`);

  // ---- verdict ---------------------------------------------------------------
  const v = out.verdict;
  // A body can project on screen and still be behind the counter, a shelf or a
  // wall, so "every on-screen body must be painted" is the wrong bar — an
  // occluded body correctly shows no paint. The claim being tested is narrower
  // and does not need occlusion knowledge: the pixels that appeared when
  // clubhouse.customers() was painted are AT clubhouse.customers()' coordinates,
  // and are not at coordinates 2.5 yd away.
  if (v.clubhouseCustomers.onScreen === 0) {
    fail('no clubhouse.customers() body projected on screen — inconclusive, aim failed');
  } else if (v.clubhouseCustomers.withPaint === 0) {
    fail('no clubhouse.customers() body landed on any painted pixel — they are not the bodies on screen');
  }
  if (v.offsetControl.withPaint > 0) {
    fail(`offset control hit paint at ${v.offsetControl.withPaint} of ${v.offsetControl.onScreen} points — `
      + 'the frame is too full of magenta for the projection test to discriminate');
  }
  out.occludedOrMissed = v.clubhouseCustomers.onScreen - v.clubhouseCustomers.withPaint;
  out.population = (v.clubhouseCustomers.withPaint > 0 && v.offsetControl.withPaint === 0
    && out.paintedMagenta > 400 && out.controlNoiseFloor < 200)
    ? 'clubhouse.customers() — the inline array in clubhouse.js'
    : 'UNDETERMINED';
  // The other half of the answer, and it needs no pixels: the sim's own
  // population while those bodies were walking around.
  out.simPopulationWhileVisibleBodiesWalked = out.counts.simActive;

  fs.writeFileSync(path.join(OUT, 'part0-populations.json'), JSON.stringify(out, (k, val) => (k === 'data' ? undefined : val), 2));
  console.log('PART0', JSON.stringify({
    counts: out.counts,
    noise: out.controlNoiseFloor,
    painted: out.paintedMagenta,
    verdict: out.verdict,
    population: out.population,
    failures: out.failures,
  }, null, 2));
  if (out.failures.length) process.exitCode = 1;
  return out;
}
