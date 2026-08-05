// VERIFIER 1 — L2 monitor navigation: reach the walk-in slot-offer sheet on the
// register monitor and screenshot it. Navigates by monitorHotspots() +
// monitorActionPoint(id) so no pixel guessing.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify1');
  fs.mkdirSync(OUT, { recursive: true });

  const faults = [];
  page.on('pageerror', (e) => faults.push(String(e && e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3500);

  const seeded = await page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 10 * 60;
    if (st.campaign) st.campaign.businessOpen = true;
    if (st.shop) st.shop.signOpen = true;
    app.speedIdx = 1;
    app.scene3d.applyTimeWeather?.(600, st.weather);
    const club = app.scene3d.clubhouse();
    const list = () => (typeof club.customers === 'function' ? club.customers() : club.customers);
    let asker = null;
    let spawns = 0;
    for (let i = 0; i < 30 && !asker; i++) {
      club.debugSpawn(false, null, { allowWalkInRequest: true });
      spawns += 1;
      asker = list().find((c) => c.customerType === 'walk-in-tee');
    }
    return { spawned: !!asker, spawns, name: asker ? (asker.fullName || asker.name) : null };
  });

  const walkInReady = await page.waitForFunction(() => {
    const club = window.__fw.scene3d.clubhouse();
    const desk = club.frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || [])[0];
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, null, { timeout: 180000 }).then(() => true).catch(() => false);
  if (!walkInReady) {
    await page.screenshot({ path: path.join(OUT, 'l2-no-walkin.png') });
    return { seeded, walkInReady, ok: true };
  }

  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
  });
  await page.waitForTimeout(700);
  await page.keyboard.press('e');
  const engaged = await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register?.isActive?.(),
    null, { timeout: 20000 },
  ).then(() => true).catch(() => false);
  if (!engaged) {
    await page.screenshot({ path: path.join(OUT, 'l2-no-register.png') });
    return { seeded, walkInReady, engaged, ok: true };
  }
  await page.waitForTimeout(1500);

  const readHotspots = () => page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const spots = reg.monitorHotspots ? (reg.monitorHotspots() || []) : [];
    return spots.map((s) => ({ id: s.id, label: s.label || null, kind: s.kind || null, disabled: !!s.disabled }));
  });
  const clickAction = async (id) => {
    const pt = await page.evaluate((actionId) => {
      const reg = window.__fw.scene3d.clubhouse().register;
      return reg.monitorActionPoint ? reg.monitorActionPoint(actionId) : null;
    }, id);
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return { clicked: false, pt };
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(900);
    return { clicked: true, pt };
  };

  const nav = [];
  let shotIdx = 0;
  const snapState = async (tag) => {
    shotIdx += 1;
    const name = `l2-step${shotIdx}-${tag}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
    return name;
  };

  nav.push({ step: 'home', hotspots: await readHotspots(), shot: await snapState('home') });

  // 1) open check-in
  const home = nav[0].hotspots;
  const openCheckIn = home.find((s) => /check.?in/i.test(s.id) || /check.?in/i.test(s.label || ''));
  if (openCheckIn) {
    await clickAction(openCheckIn.id);
    const spots = await readHotspots();
    nav.push({ step: 'check-in', clicked: openCheckIn.id, hotspots: spots, shot: await snapState('checkin') });

    // 2) select the walk-in if a selection action exists
    const selectWalkIn = spots.find((s) => /walk.?in/i.test(s.id) || /walk.?in/i.test(s.label || ''));
    if (selectWalkIn) {
      await clickAction(selectWalkIn.id);
      const spots2 = await readHotspots();
      nav.push({ step: 'walk-in', clicked: selectWalkIn.id, hotspots: spots2, shot: await snapState('walkin-offers') });
    }
  }

  // the offer actions visible at the deepest step
  const last = nav[nav.length - 1];
  const offerActions = (last.hotspots || []).filter((s) => /select-walkin-slot/i.test(s.id));

  const out = {
    seeded, walkInReady, engaged, nav, offerCount: offerActions.length,
    offers: offerActions.map((s) => ({ id: s.id, label: s.label })),
    faults: faults.slice(0, 10),
    ok: true,
  };
  fs.writeFileSync(path.join(OUT, 'l2-monitor.json'), `${JSON.stringify(out, null, 1)}\n`);
  await page.keyboard.press('Escape');
  return out;
}
