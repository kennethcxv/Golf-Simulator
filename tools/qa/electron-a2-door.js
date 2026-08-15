// A2 — WHAT DOES OPENING A DOOR ACTUALLY COST?
//
// Attribution before repair. This does not assume the answer; it records, per
// frame, the four things that tell the causes apart:
//
//   * frame delta            - what the player feels
//   * renderer program count - a COMPILE (and after A3 we know a changing light
//                              list is one of the ways this project produces
//                              them)
//   * VISIBLE LIGHT COUNT    - the A3 mechanism, tested directly: three bakes
//                              light counts into every program's cache key, so
//                              a light entering or leaving the list recompiles
//                              every lit material on screen
//   * draw calls + triangles - geometry appearing
//
// Reviewer 3's objection is built in: a lurch is not always a frame-time event.
// A 10 Hz fitted shadow refit can jump the whole room's shadows on a healthy
// 16 ms frame. So the driver also diffs successive captured frames with the
// camera held still, and reports pixel discontinuity beside the timings.
//
// Negative control: the identical approach walk with NO press. If that shows
// the same hitch, the finding is about walking, not doors.
//
//   A2_LEG=press|control   node tools/qa/run-electron.cjs tools/qa/electron-a2-door.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a2-door');
  fs.mkdirSync(OUT, { recursive: true });
  const LEG = process.env.A2_LEG || 'press';
  const out = { leg: LEG, errs: [] };
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

  // Find a door the walk controller will actually focus on.
  out.doors = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    const doors = ch?.doors;
    let list = null;
    try { list = typeof doors?.list === 'function' ? doors.list() : null; } catch (_) { list = null; }
    return {
      hasDoorsApi: !!doors,
      keys: doors ? Object.keys(doors).slice(0, 14) : null,
      count: Array.isArray(list) ? list.length : null,
    };
  });

  // Sampler: everything at once, per frame.
  await page.evaluate(() => {
    const s = { rows: [], marks: [], stop: false };
    window.__a2 = s;
    window.addEventListener('keydown', (e) => {
      s.marks.push({ key: e.key, t: performance.now() });
    }, true);
    const r = window.__fw.scene3d.renderer;
    const scene = window.__fw.scene3d.scene;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      let lights = 0;
      scene.traverseVisible((o) => { if (o.isLight) lights += 1; });
      s.rows.push({
        t: +now.toFixed(1),
        dt: +(now - last).toFixed(1),
        programs: r.info.programs ? r.info.programs.length : -1,
        calls: r.info.render.calls,
        lights,
      });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Approach: five real doors in a row, so "every time, not just the first" is
  // answerable. The approach itself is scripted movement through the real key
  // handlers; the interact press is the only thing the control removes.
  await page.mouse.click(700, 500);
  await page.waitForTimeout(400);
  const bindings = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  const interact = bindings.interact || 'e';
  const events = [];
  for (let i = 0; i < 5; i += 1) {
    // hunt a door with the focus label, then press (or not)
    const found = await page.evaluate(async () => {
      const walk = window.__fw.scene3d.walk;
      const st = walk.state;
      const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
      const base = st.yaw;
      for (let k = 0; k < 24; k += 1) {
        st.yaw = base + (k / 24) * Math.PI * 2;
        st.pitch = -0.05;
        await sleep(90);
        const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/door/i.test(label)) return { hit: true, label: label.slice(0, 60) };
      }
      return { hit: false };
    });
    if (!found.hit) {
      // Not in reach from here. Stage to door i (outside every measured
      // window) and hunt again - the player walks to a door, and a driver that
      // spawns nowhere near one is measuring the spawn point.
      const staged = await page.evaluate(async (idx) => {
        const fw = window.__fw;
        const ch = fw.scene3d.clubhouse();
        const list = ch.doors || [];
        const door = list[idx % Math.max(1, list.length)];
        if (!door) return { ok: false, why: 'no door' };
        // A door carries interior-LOCAL lx/lz (the same convention the ledger
        // book uses), not a world node. Reading it wrong is how the first run
        // of this driver "found no doors" while standing next to four.
        const st = fw.scene3d.walk.state;
        const ip = ch.interior.position;
        let p = null;
        if (Number.isFinite(door.lx) && Number.isFinite(door.lz)) {
          p = { x: ip.x + door.lx, z: ip.z + door.lz };
        } else if (door.hinge?.getWorldPosition) {
          const V = Object.getPrototypeOf(door.hinge.position).constructor;
          const w = door.hinge.getWorldPosition(new V());
          p = { x: w.x, z: w.z };
        }
        if (!p) return { ok: false, why: 'no position', keys: Object.keys(door).slice(0, 14) };
        const to = { x: ip.x - p.x, z: ip.z - p.z };
        const len = Math.hypot(to.x, to.z) || 1;
        st.x = p.x + (to.x / len) * 1.4;
        st.z = p.z + (to.z / len) * 1.4;
        st.yaw = Math.atan2(-(p.x - st.x), -(p.z - st.z));
        st.pitch = -0.05;
        return { ok: true, name: door.name, door: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) } };
      }, i);
      await page.waitForTimeout(700);
      const again = await page.evaluate(async () => {
        const walk = window.__fw.scene3d.walk;
        const st = walk.state;
        const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
        const base = st.yaw;
        for (let k = 0; k < 20; k += 1) {
          st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.22);
          st.pitch = -0.05 + (k > 12 ? 0.18 : 0);
          await sleep(90);
          const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
          if (/door/i.test(label)) return { hit: true, label: label.slice(0, 60) };
        }
        return { hit: false };
      });
      if (!again.hit) { events.push({ i, found: false, staged }); continue; }
      found.hit = true;
      found.label = again.label;
      found.staged = staged;
    }
    const at = await page.evaluate(() => performance.now());
    if (LEG === 'press') await page.keyboard.press(interact);
    await page.waitForTimeout(2200);
    events.push({ i, found: true, label: found.label, at });
    // step away and back so the next one is a fresh approach
    await page.keyboard.down('s');
    await page.waitForTimeout(700);
    await page.keyboard.up('s');
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
  }
  out.events = events;

  out.trace = await page.evaluate((evs) => {
    const s = window.__a2;
    s.stop = true;
    const rows = s.rows;
    const perEvent = evs.filter((e) => e.found).map((e) => {
      const win = rows.filter((r) => r.t >= e.at && r.t <= e.at + 2200);
      if (!win.length) return { i: e.i, empty: true };
      const d = win.map((r) => r.dt);
      const worst = Math.max(...d);
      const worstRow = win[d.indexOf(worst)];
      return {
        i: e.i,
        worst: +worst.toFixed(1),
        over16: d.filter((x) => x > 16).length,
        over33: d.filter((x) => x > 33).length,
        programsStart: win[0].programs,
        programsEnd: win[win.length - 1].programs,
        programsAtWorst: worstRow.programs,
        lightsStart: win[0].lights,
        lightsEnd: win[win.length - 1].lights,
        lightsMin: Math.min(...win.map((r) => r.lights)),
        lightsMax: Math.max(...win.map((r) => r.lights)),
        callsStart: win[0].calls,
        callsAtWorst: worstRow.calls,
      };
    });
    return {
      totalFrames: rows.length,
      programsFirst: rows[0]?.programs ?? null,
      programsLast: rows[rows.length - 1]?.programs ?? null,
      lightsSeen: [...new Set(rows.map((r) => r.lights))].sort((a, b) => a - b),
      perEvent,
    };
  }, events);

  fs.writeFileSync(path.join(OUT, `a2-${LEG}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`A2[${LEG}] doors`, JSON.stringify(out.doors));
  console.log(`A2[${LEG}] trace`, JSON.stringify(out.trace));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
