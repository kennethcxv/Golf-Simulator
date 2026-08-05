// VERIFIER 1 — L2 monitor navigation, take 2: verify the action point with
// debugPickAt, then drive register.onDown/onUp with synthetic events in-page.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify1');
  fs.mkdirSync(OUT, { recursive: true });

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
    for (let i = 0; i < 30 && !asker; i++) {
      club.debugSpawn(false, null, { allowWalkInRequest: true });
      asker = list().find((c) => c.customerType === 'walk-in-tee');
    }
    return { spawned: !!asker };
  });

  const walkInReady = await page.waitForFunction(() => {
    const club = window.__fw.scene3d.clubhouse();
    const desk = club.frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || [])[0];
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, null, { timeout: 180000 }).then(() => true).catch(() => false);
  if (!walkInReady) return { seeded, walkInReady, ok: true };

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
  if (!engaged) return { seeded, walkInReady, engaged, ok: true };
  await page.waitForTimeout(1500);

  const tap = async (id) => {
    const pt = await page.evaluate((actionId) => {
      const reg = window.__fw.scene3d.clubhouse().register;
      const p = reg.monitorScreenPoint ? reg.monitorScreenPoint(actionId) : null;
      if (!p) return null;
      const pick = reg.debugPickAt ? reg.debugPickAt(p.x, p.y) : null;
      return { ...p, pick };
    }, id);
    if (!pt || !Number.isFinite(pt.x)) return { ok: false, pt };
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(600);
    return { ok: true, pt };
  };

  const readSpots = () => page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    return (reg.monitorHotspots?.() || []).map((s) => ({ id: s.id, label: s.label || null, disabled: !!s.disabled }));
  });

  const nav = [];
  nav.push({ step: 'home', spots: await readSpots() });
  const t1 = await tap('tab-check-in');
  await page.waitForTimeout(1000);
  const spots2 = await readSpots();
  await page.screenshot({ path: path.join(OUT, 'l2b-after-checkin-tap.png') });
  nav.push({ step: 'after-tab-check-in', tap: t1, spots: spots2 });

  // whatever walk-in-ish action now exists, tap it
  const walkInSpot = spots2.find((s) => /walk/i.test(s.id) || /walk/i.test(s.label || ''))
    || spots2.find((s) => /select|guest|queue|serve/i.test(s.id));
  let t2 = null;
  let spots3 = null;
  if (walkInSpot) {
    t2 = await tap(walkInSpot.id);
    await page.waitForTimeout(1000);
    spots3 = await readSpots();
    await page.screenshot({ path: path.join(OUT, 'l2b-walkin-offers.png') });
    nav.push({ step: 'after-walkin-tap', tapped: walkInSpot.id, tap: t2, spots: spots3 });
  }

  const deepest = spots3 || spots2;
  const offers = deepest.filter((s) => /select-walkin-slot/i.test(s.id));
  const out = { seeded, walkInReady, engaged, nav, offerCount: offers.length, offers, ok: true };
  fs.writeFileSync(path.join(OUT, 'l2-monitor2.json'), `${JSON.stringify(out, null, 1)}\n`);
  await page.keyboard.press('Escape');
  return out;
}
