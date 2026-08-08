// VERIFY-A / A1 follow-up — the 12.6 s / +5-program frame seen when va2
// TELEPORTED to the stockroom door. This is the player's version: stage once
// at the shop door (outside the measured window), then WALK to the stockroom
// door, open it, and walk in, sampling every frame. If a multi-second
// multi-program frame lands on the walk, the A1 "multi-program tail removed"
// claim fails for the player, not just for a teleporting harness.
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

  // Stage at the SHOP door, facing inward — outside the measured window.
  out.staged = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const doors = ch.doors || [];
    const shop = doors.find((d) => /shop/i.test(d.name || '')) || doors[0];
    const stock = doors.find((d) => /stock/i.test(d.name || ''));
    if (!shop || !stock) return { ok: false, names: doors.map((d) => d.name) };
    const st = fw.scene3d.walk.state;
    const ip = ch.interior.position;
    st.x = ip.x + shop.lx; st.z = ip.z + shop.lz;
    // face the stockroom door
    const tx = ip.x + stock.lx; const tz = ip.z + stock.lz;
    st.yaw = Math.atan2(-(tx - st.x), -(tz - st.z));
    st.pitch = -0.05;
    return {
      ok: true,
      from: shop.name,
      to: stock.name,
      dist: +Math.hypot(tx - st.x, tz - st.z).toFixed(1),
      target: { x: tx, z: tz },
    };
  });
  if (!out.staged.ok) {
    fs.writeFileSync(path.join(OUT, 'va2b.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('VA2B ABORT', JSON.stringify(out.staged));
    return out;
  }
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const s = { rows: [], stop: false };
    window.__vb = s;
    const r = window.__fw.scene3d.renderer;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const w = window.__fw.scene3d.walk.state;
      s.rows.push({
        t: +now.toFixed(1),
        dt: +(now - last).toFixed(2),
        programs: r.info.programs ? r.info.programs.length : -1,
        geoms: r.info.memory.geometries,
        texs: r.info.memory.textures,
        x: +w.x.toFixed(2),
        z: +w.z.toFixed(2),
      });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const centre = await page.evaluate(() => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(400);

  // WALK toward the stockroom door: steer by re-aiming yaw at the target
  // every 700 ms while holding W through the real key handler.
  await page.keyboard.down('w');
  for (let i = 0; i < 18; i += 1) {
    await page.waitForTimeout(700);
    const d = await page.evaluate((tgt) => {
      const st = window.__fw.scene3d.walk.state;
      st.yaw = Math.atan2(-(tgt.x - st.x), -(tgt.z - st.z));
      return +Math.hypot(tgt.x - st.x, tgt.z - st.z).toFixed(2);
    }, out.staged.target);
    if (d < 1.5) break;
  }
  await page.keyboard.up('w');
  out.arrived = await page.evaluate((tgt) => {
    const st = window.__fw.scene3d.walk.state;
    return { dist: +Math.hypot(tgt.x - st.x, tgt.z - st.z).toFixed(2) };
  }, out.staged.target);

  // find the door with the focus label and open it
  out.focus = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const st = walk.state;
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const base = st.yaw;
    for (let k = 0; k < 22; k += 1) {
      st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
      st.pitch = -0.05 + (k > 14 ? 0.15 : 0);
      await sleep(85);
      const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
      if (/stockroom/i.test(label)) return { hit: true, label: label.slice(0, 60) };
    }
    return { hit: false };
  });
  out.pressAt = await page.evaluate(() => performance.now());
  if (out.focus.hit) await page.keyboard.press('e');
  await page.waitForTimeout(1500);
  // walk INTO the stockroom and look around
  await page.keyboard.down('w');
  await page.waitForTimeout(2200);
  await page.keyboard.up('w');
  for (let i = 0; i < 16; i += 1) {
    await page.mouse.move(centre.x - 300 + (i % 2) * 600, centre.y, { steps: 4 });
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'va2b-stockroom.png') });

  out.trace = await page.evaluate(() => {
    const s = window.__vb;
    s.stop = true;
    const rows = s.rows.slice(3);
    const d = rows.map((r) => r.dt);
    const sorted = [...d].sort((a, b) => a - b);
    const pct = (p) => +(sorted[Math.floor((sorted.length - 1) * p)] || 0).toFixed(2);
    return {
      n: rows.length,
      median: pct(0.5),
      p95: pct(0.95),
      worst: +Math.max(...d).toFixed(1),
      over16pct: +(100 * d.filter((x) => x > 16).length / d.length).toFixed(1),
      over33: d.filter((x) => x > 33).length,
      over100: d.filter((x) => x > 100).length,
      programsFirst: rows[0].programs,
      programsLast: rows[rows.length - 1].programs,
      big: rows.map((r, i) => ({ r, i })).filter(({ r }) => r.dt > 100).map(({ r, i }) => {
        const b = rows[Math.max(0, i - 1)];
        return {
          atMs: +(r.t - rows[0].t).toFixed(0),
          dt: r.dt,
          dPrograms: r.programs - b.programs,
          dGeoms: r.geoms - b.geoms,
          dTexs: r.texs - b.texs,
          at: { x: r.x, z: r.z },
        };
      }),
    };
  });

  fs.writeFileSync(path.join(OUT, 'va2b.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('VA2B staged', JSON.stringify(out.staged), 'arrived', JSON.stringify(out.arrived));
  console.log('VA2B focus', JSON.stringify(out.focus));
  console.log('VA2B trace', JSON.stringify(out.trace));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 4)));
  return out;
}
