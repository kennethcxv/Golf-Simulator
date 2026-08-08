// VERIFY-A / A2 + A1 — one session, my own instrument.
//
//   * doors: alternating PRESS and NO-PRESS approaches in the SAME session,
//     so the control shares every condition with the press (the author ran
//     them as two separate sessions).
//   * movement: two free-walk laps at the end give the ordinary-walking
//     frame population: % over 16 ms, worst, and every stall > 250 ms with
//     program/geometry/texture deltas across it (A1's multi-program tail).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-a');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(9000);

  // sampler for the whole session
  await page.evaluate(() => {
    const s = { rows: [], stop: false };
    window.__va2 = s;
    const r = window.__fw.scene3d.renderer;
    const scene = window.__fw.scene3d.scene;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      let lights = 0;
      scene.traverseVisible((o) => { if (o.isLight) lights += 1; });
      s.rows.push({
        t: +now.toFixed(1),
        dt: +(now - last).toFixed(2),
        programs: r.info.programs ? r.info.programs.length : -1,
        geoms: r.info.memory.geometries,
        texs: r.info.memory.textures,
        lights,
      });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const centre = await page.evaluate(() => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(400);

  // ---- six door approaches, alternating press / control -------------------
  const events = [];
  for (let i = 0; i < 6; i += 1) {
    const staged = await page.evaluate(async (idx) => {
      const fw = window.__fw;
      const ch = fw.scene3d.clubhouse();
      const list = ch.doors || [];
      const door = list[idx % Math.max(1, list.length)];
      if (!door) return { ok: false, why: 'no door' };
      const st = fw.scene3d.walk.state;
      const ip = ch.interior.position;
      let p = null;
      if (Number.isFinite(door.lx) && Number.isFinite(door.lz)) {
        p = { x: ip.x + door.lx, z: ip.z + door.lz };
      }
      if (!p) return { ok: false, why: 'no lx/lz' };
      const to = { x: ip.x - p.x, z: ip.z - p.z };
      const len = Math.hypot(to.x, to.z) || 1;
      st.x = p.x + (to.x / len) * 1.4;
      st.z = p.z + (to.z / len) * 1.4;
      st.yaw = Math.atan2(-(p.x - st.x), -(p.z - st.z));
      st.pitch = -0.05;
      return { ok: true, name: door.name || null };
    }, i);
    await page.waitForTimeout(650);
    const found = await page.evaluate(async () => {
      const walk = window.__fw.scene3d.walk;
      const st = walk.state;
      const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
      const base = st.yaw;
      for (let k = 0; k < 20; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.22);
        st.pitch = -0.05 + (k > 12 ? 0.18 : 0);
        await sleep(85);
        const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/door/i.test(label)) return { hit: true, label: label.slice(0, 60) };
      }
      return { hit: false };
    });
    if (!found.hit) { events.push({ i, found: false, staged }); continue; }
    const mode = i % 2 === 0 ? 'press' : 'control';
    const at = await page.evaluate(() => performance.now());
    if (mode === 'press') await page.keyboard.press('e');
    await page.waitForTimeout(2200);
    events.push({ i, found: true, mode, at, label: found.label, staged });
    await page.keyboard.down('s');
    await page.waitForTimeout(650);
    await page.keyboard.up('s');
  }
  out.events = events;

  // ---- ordinary movement laps ---------------------------------------------
  out.walkStart = await page.evaluate(() => performance.now());
  const key = async (k, ms) => {
    await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    await page.keyboard.up(k);
  };
  for (let lap = 0; lap < 2; lap += 1) {
    await key('w', 1800);
    await page.mouse.move(centre.x - 200, centre.y);
    await page.mouse.move(centre.x + 200, centre.y, { steps: 18 });
    await key('a', 1200);
    await key('s', 1800);
    await page.mouse.move(centre.x - 200, centre.y, { steps: 18 });
    await key('d', 1200);
  }
  out.walkEnd = await page.evaluate(() => performance.now());

  out.trace = await page.evaluate(({ evs, walkStart, walkEnd }) => {
    const s = window.__va2;
    s.stop = true;
    const rows = s.rows.slice(3);
    const stat = (list) => {
      if (!list.length) return null;
      const d = [...list].sort((a, b) => a - b);
      const pct = (p) => +(d[Math.floor((d.length - 1) * p)] || 0).toFixed(2);
      return {
        n: list.length,
        median: pct(0.5),
        p95: pct(0.95),
        worst: +Math.max(...list).toFixed(1),
        over16: list.filter((x) => x > 16).length,
        over16pct: +(100 * list.filter((x) => x > 16).length / list.length).toFixed(1),
        over33: list.filter((x) => x > 33).length,
      };
    };
    const perEvent = evs.filter((e) => e.found).map((e) => {
      const win = rows.filter((r) => r.t >= e.at && r.t <= e.at + 2200);
      const d = win.map((r) => r.dt);
      if (!d.length) return { i: e.i, mode: e.mode, empty: true };
      return {
        i: e.i,
        mode: e.mode,
        worst: +Math.max(...d).toFixed(1),
        over16: d.filter((x) => x > 16).length,
        over33: d.filter((x) => x > 33).length,
        dPrograms: win[win.length - 1].programs - win[0].programs,
        dLights: win[win.length - 1].lights - win[0].lights,
      };
    });
    const walkRows = rows.filter((r) => r.t >= walkStart && r.t <= walkEnd);
    const stalls = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.dt > 250).map(({ r, i }) => {
      const before = rows[Math.max(0, i - 1)];
      return {
        atMs: +(r.t - rows[0].t).toFixed(0),
        dt: r.dt,
        dPrograms: r.programs - before.programs,
        dGeoms: r.geoms - before.geoms,
        dTexs: r.texs - before.texs,
        inWalk: r.t >= walkStart && r.t <= walkEnd,
      };
    });
    const press = perEvent.filter((e) => e.mode === 'press' && !e.empty);
    const control = perEvent.filter((e) => e.mode === 'control' && !e.empty);
    return {
      totalFrames: rows.length,
      programsFirst: rows[0]?.programs,
      programsLast: rows[rows.length - 1]?.programs,
      lightsSeen: [...new Set(rows.map((r) => r.lights))].sort((a, b) => a - b),
      perEvent,
      pressWorsts: press.map((e) => e.worst),
      controlWorsts: control.map((e) => e.worst),
      walking: stat(walkRows.map((r) => r.dt)),
      wholeSession: stat(rows.map((r) => r.dt)),
      stalls,
    };
  }, { evs: events, walkStart: out.walkStart, walkEnd: out.walkEnd });

  fs.writeFileSync(path.join(OUT, 'va2.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('VA2 perEvent', JSON.stringify(out.trace.perEvent));
  console.log('VA2 press worsts  ', JSON.stringify(out.trace.pressWorsts));
  console.log('VA2 control worsts', JSON.stringify(out.trace.controlWorsts));
  console.log('VA2 walking', JSON.stringify(out.trace.walking));
  console.log('VA2 stalls', JSON.stringify(out.trace.stalls));
  console.log('VA2 programs', out.trace.programsFirst, '->', out.trace.programsLast,
    'lights', JSON.stringify(out.trace.lightsSeen));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 4)));
  return out;
}
