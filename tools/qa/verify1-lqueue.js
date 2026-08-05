// VERIFIER 1 — L-queue still-broken confirmation, register-monitor edition.
// (The DOM front desk is dead: ch.register.cashierPose does not exist, so
// enterFrontDesk always returns. The desk is served ON THE REGISTER MONITOR.)
//   L2: spawn a walk-in asker, E at the desk, screenshot the monitor's offer UI.
//   L1: bridge instrumentation — asked vs offered vs booked vs check-in result.
//   L3: whole-scene /ledger|book/i sweep + desk screenshot + state probe.
//   L4: 'House notes' exists nowhere (DOM + state).
// Piggybacks the H1 laptop-mode i test via the openLaptop hook.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify1');
  fs.mkdirSync(OUT, { recursive: true });

  const faults = [];
  let phase = '(boot)';
  page.on('pageerror', (e) => faults.push({ phase, message: String(e && e.message || e) }));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3500);

  // ---- L3: scene sweep for ledger/book props --------------------------------
  phase = 'l3';
  const l3 = await page.evaluate(async () => {
    const app = window.__fw;
    const { FRONT_DESK_FRAME } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    const off = clubhouse.interior.position;
    const deskWorld = { x: FRONT_DESK_FRAME.x + off.x, z: FRONT_DESK_FRAME.z + off.z };
    const rx = /ledger|book/i;
    const matches = [];
    const root = app.scene3d.scene || clubhouse.interior;
    root.traverse((o) => {
      if (!o.name || !rx.test(o.name)) return;
      const wp = o.getWorldPosition(new (o.position.constructor)());
      matches.push({
        name: o.name,
        type: o.type,
        world: { x: +wp.x.toFixed(2), y: +wp.y.toFixed(2), z: +wp.z.toFixed(2) },
        distToDeskYd: +Math.hypot(wp.x - deskWorld.x, wp.z - deskWorld.z).toFixed(2),
      });
    });
    return {
      sceneRootUsed: app.scene3d.scene ? 'scene' : 'interior',
      matchCount: matches.length,
      matches: matches.slice(0, 60),
      stateLedgerBook: app.state.ledgerBook === undefined ? 'undefined' : JSON.stringify(app.state.ledgerBook).slice(0, 200),
      stateLedgerKeys: app.state.ledger ? Object.keys(app.state.ledger).slice(0, 8) : null,
    };
  });
  // face the desk from the guest side and screenshot the surface
  await page.evaluate(async () => {
    const app = window.__fw;
    const { frontDeskPoint } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    const guest = frontDeskPoint(0, -1.8);
    const desk = frontDeskPoint(0, 0);
    walk.x = guest.x + off.x; walk.z = guest.z + off.z;
    const dx = (desk.x + off.x) - walk.x; const dz = (desk.z + off.z) - walk.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = -0.35;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'l3-front-desk-surface.png') });

  // ---- L4: 'House notes' nowhere --------------------------------------------
  phase = 'l4';
  const l4 = await page.evaluate(() => {
    const domHits = [...document.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && /house notes/i.test(n.textContent || '')).length;
    let stateHit = false;
    try { stateHit = JSON.stringify(window.__fw.state).toLowerCase().includes('house notes'); } catch {}
    return { domHouseNotesNodes: domHits, stateMentionsHouseNotes: stateHit };
  });

  // ---- H1 piggyback: laptop mode i via the shipped hook ---------------------
  phase = 'laptop-i';
  let laptop = {};
  const laptopOpened = await page.evaluate(() => {
    const h = window.__fw.scene3d?.walk?.hooks;
    if (h && typeof h.openLaptop === 'function') { h.openLaptop(null); return true; }
    return false;
  });
  await page.waitForTimeout(1500);
  laptop.hookCalled = laptopOpened;
  laptop.open = await page.evaluate(() => !!window.__fw.laptopOpen);
  if (laptop.open) {
    for (const k of ['i', 'i', 's', 'm', '0', '9']) { phase = `laptop-${k}`; await page.keyboard.press(k); await page.waitForTimeout(110); }
    laptop.afterKeys = await page.evaluate(() => ({
      laptopOpen: !!window.__fw.laptopOpen,
      veil: [...document.querySelectorAll('div')]
        .some((n) => n.textContent && n.textContent.includes('The game hit a problem') && n.offsetParent !== null),
      maintenanceVisible: (() => { const cm = document.querySelector('.cm-panel'); return !!(cm && cm.style.display !== 'none' && cm.getClientRects().length > 0); })(),
    }));
    await page.screenshot({ path: path.join(OUT, 'h1-laptop-i.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);
  }

  // ---- L1 + L2: spawn a tee-time asker, serve them at the monitor -----------
  phase = 'seed-walkin';
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
    for (let i = 0; i < 3; i++) club.debugSpawn(false, null, { allowWalkInRequest: true });
    return { spawned: true };
  });

  const walkInReady = await page.waitForFunction(() => {
    const club = window.__fw.scene3d.clubhouse();
    const desk = club.frontDeskBridge?.();
    const entries = desk?.walkIns?.() || [];
    return entries.length > 0;
  }, null, { timeout: 240000 }).then(() => true).catch(() => false);

  let l1 = { walkInReady };
  let l2 = {};
  if (walkInReady) {
    phase = 'l1-instrument';
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

    // L2: E at the desk -> the monitor's walk-in offer screen
    phase = 'l2-monitor';
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
    await page.waitForTimeout(600);
    l2.promptBeforeE = await page.evaluate(() => {
      const p = document.querySelector('.shop-prompt');
      return p ? (p.textContent || '').trim().slice(0, 160) : null;
    });
    await page.keyboard.press('e');
    l2.registerEngaged = await page.waitForFunction(
      () => window.__fw.scene3d.clubhouse().register?.isActive?.(),
      null, { timeout: 20000 },
    ).then(() => true).catch(() => false);
    if (l2.registerEngaged) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, 'l2-monitor-offers.png') });
    } else {
      await page.screenshot({ path: path.join(OUT, 'l2-no-register.png') });
    }

    // L1 flow: book the slot nearest the ask through the bridge, then check in
    phase = 'l1-book';
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
      // immediately try the check-in leg, as the desk would
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
          arrivalStatus: booked.res?.arrival?.status ?? booked.res?.arrivalStatus ?? null,
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
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'l1-after-desk-flow.png') });
    // leave register mode if it engaged
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }

  const out = {
    seeded, l1, l2, l3: { ...l3, screenshot: 'l3-front-desk-surface.png' }, l4, laptop,
    faults: faults.slice(0, 12),
    ok: true,
  };
  fs.writeFileSync(path.join(OUT, 'lqueue.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
