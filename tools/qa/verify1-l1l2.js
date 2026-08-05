// VERIFIER 1 — L1/L2 focused run. Forces a walk-in tee-time asker straight into
// the service queue (debugSpawn(true, 'walk-in-tee-time')), then:
//   L2: E at the desk -> screenshot the register monitor's walk-in offer UI.
//   L1: bridge instrumentation — asked vs offered vs booked vs check-in result.
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

  // spawn until one identity rolls the tee-time purpose (the shipped gate:
  // walkInRequest needs visitProfile.preferredPurpose === 'tee-time')
  const seeded = await page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 10 * 60;
    if (st.campaign) st.campaign.businessOpen = true;
    if (st.shop) st.shop.signOpen = true;
    app.speedIdx = 1;
    app.scene3d.applyTimeWeather?.(600, st.weather);
    const club = app.scene3d.clubhouse();
    if (!club.debugSpawn) return { spawned: false, reason: 'no debugSpawn' };
    const list = () => (typeof club.customers === 'function' ? club.customers() : club.customers);
    let spawns = 0;
    let asker = null;
    for (let i = 0; i < 30 && !asker; i++) {
      club.debugSpawn(false, null, { allowWalkInRequest: true });
      spawns += 1;
      asker = list().find((c) => c.customerType === 'walk-in-tee'
        || c.intent === 'walk-in-tee-time'
        || (c.requestedTeeMinute != null && c.reservationId == null));
    }
    return {
      spawned: !!asker, spawns,
      asker: asker ? {
        name: asker.fullName || asker.name,
        requestedTeeMinute: asker.requestedTeeMinute ?? null,
        customerType: asker.customerType || null,
      } : null,
      population: list().length,
    };
  });

  // wait for the asker to physically reach the desk head: phase 'walk-in-waiting'
  const walkInReady = await page.waitForFunction(() => {
    const club = window.__fw.scene3d.clubhouse();
    const desk = club.frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || [])[0];
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, null, { timeout: 180000 }).then(() => true).catch(() => false);

  let l1 = { walkInReady };
  let l2 = {};
  if (walkInReady) {
    l1.askAndOffers = await page.evaluate(() => {
      const app = window.__fw;
      const club = app.scene3d.clubhouse();
      const desk = club.frontDeskBridge();
      const entry = (desk.walkIns() || [])[0];
      const list = typeof club.customers === 'function' ? club.customers() : club.customers;
      const c = list.find((x) => x.customerId === entry.customerId);
      const slots = desk.walkInSlotsFor(entry.customerId) || [];
      return {
        entry,
        customer: c ? {
          requestedTeeMinute: c.requestedTeeMinute ?? null,
          state: c.state, queued: c.queued, checkoutPhase: c.checkoutPhase || null,
          partySize: c.partySize || 1, name: c.fullName || c.name,
        } : null,
        clockMin: app.state.clock.minutes % 1440,
        slots: slots.slice(0, 10),
      };
    });

    // L2: E at the stand -> monitor offer screen
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
    l2.promptBeforeE = await page.evaluate(() => {
      const p = document.querySelector('.shop-prompt');
      return p ? (p.textContent || '').trim().slice(0, 160) : null;
    });
    await page.keyboard.press('e');
    l2.registerEngaged = await page.waitForFunction(
      () => window.__fw.scene3d.clubhouse().register?.isActive?.(),
      null, { timeout: 20000 },
    ).then(() => true).catch(() => false);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, l2.registerEngaged ? 'l2-monitor-offers.png' : 'l2-no-register.png') });

    // L1 flow via the bridge (the same calls the monitor actions route to)
    l1.flow = await page.evaluate(async () => {
      const app = window.__fw;
      const club = app.scene3d.clubhouse();
      const desk = club.frontDeskBridge();
      const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
      const entry = (desk.walkIns() || [])[0];
      if (!entry) return { step: 'walkin-vanished' };
      const list = typeof club.customers === 'function' ? club.customers() : club.customers;
      const c = list.find((x) => x.customerId === entry.customerId);
      const asked = c?.requestedTeeMinute ?? null;
      const slots = desk.walkInSlotsFor(entry.customerId) || [];
      if (!slots.length) return { step: 'no-slots', asked };
      let pick = slots[0];
      if (asked != null) {
        pick = slots.reduce((best, s) => (Math.abs(s.minute - asked) < Math.abs(best.minute - asked) ? s : best), slots[0]);
      }
      const booked = desk.bookWalkIn(entry.customerId, pick.dayAbs, pick.minute);
      const resId = booked?.res?.id ?? null;
      const rows = desk.list() || [];
      const row = rows.find((r) => (r.id ?? r.reservationId) === resId) || null;
      let completeResult = null;
      if (row) completeResult = desk.completeCustomer(row.id ?? row.reservationId);
      const direct = resId != null ? R.checkInReservation(app.state, resId) : null;
      const res = resId != null
        ? (app.state.reservations?.booked || []).find((r) => r.id === resId) || null
        : null;
      return {
        asked,
        offeredMinutes: slots.slice(0, 8).map((s) => s.minute),
        askOffered: asked != null && slots.some((s) => s.minute === asked),
        pickedMinute: pick.minute,
        booked: booked ? {
          ok: booked.ok, reason: booked.reason || null,
          minute: booked.res?.minute ?? null, id: resId,
          checkInStatus: booked.res?.checkInStatus ?? null,
        } : null,
        deskRowFound: !!row,
        deskRowCount: rows.length,
        completeResult,
        directCheckIn: direct ? { ok: direct.ok, reason: direct.reason || null, already: direct.already || false } : null,
        resCheckInStatus: res?.checkIn?.status ?? null,
        resStatus: res?.status ?? null,
        customerPhaseAfter: c ? (c.checkoutPhase || null) : null,
        clockMin: app.state.clock.minutes % 1440,
      };
    }).catch((e) => ({ step: 'threw', error: String(e) }));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'l1-after-desk-flow.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  } else {
    await page.screenshot({ path: path.join(OUT, 'l1-no-walkin.png') });
    l1.diag = await page.evaluate(() => {
      const club = window.__fw.scene3d.clubhouse();
      const list = typeof club.customers === 'function' ? club.customers() : club.customers;
      return list.slice(0, 8).map((c) => ({
        name: c.fullName || c.name, intent: c.intent, state: c.state,
        queued: c.queued, phase: c.checkoutPhase || null, requestedTeeMinute: c.requestedTeeMinute ?? null,
      }));
    });
  }

  const out = { seeded, l1, l2, faults: faults.slice(0, 10), ok: true };
  fs.writeFileSync(path.join(OUT, 'l1l2.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
