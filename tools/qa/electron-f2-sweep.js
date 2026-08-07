// F2 (Full_Goal_16), per plan R-H: the tee-time screen's note/grid overlap is
// fixed in layout; THIS driver is the recorder sweep that proves the class.
//   - MONITOR_OVERLAPS (the C3-pattern rect recorder) stays EMPTY across
//     every drawn register-monitor screen: home, checkout, check-in (with a
//     seeded reservation carrying a NOTE — the goal's own case — and a live
//     walk-in ask), and the tee sheet.
//   - NEGATIVE CONTROL: a deliberately planted string across the action grid
//     must be caught before the clean sweep is believed.
//   - DOM sweep: pause, all six settings pages, and the laptop's first page
//     audited for intersecting TEXT LEAVES (exclusion rules stated in code
//     BEFORE the run: ancestor/descendant exempt; zero-area and invisible
//     elements exempt; borders may kiss — rects shrink 1px).
//   - Surfaces WITHOUT a recorder are enumerated UNCONFIRMED in the report,
//     not silently skipped.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f2-sweep');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = { errs };

  await page.evaluate(() => { window.__monitorRectAudit = true; });

  // seed: a booked reservation WITH a long note (the goal's own case), and a
  // live walk-in ask so the check-in screen draws at max content
  out.seed = await page.evaluate(async () => {
    const state = window.__fw.state;
    const reservations = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const nowMin = ((state.clock.minutes % 1440) + 1440) % 1440;
    const dayAbs = Math.floor(state.clock.minutes / 1440);
    // DUE NOW: the check-in screen lists arrivals that are due — a two-hour
    // booking never listed and the detail hotspot never existed (chain run 1)
    const made = reservations.bookReservation(state, {
      dayAbs,
      minute: Math.min(1380, nowMin + 60), // the sheet is a grid: +30 was 'Not a tee time on the sheet'
      fullName: 'Harper Quinn-Delacroix',
      partySize: 3,
      paymentPreference: 'card',
      totalFee: (state.club?.greenFee || 30) * 3,
      plannedArrival: nowMin + 1,
      arrivalWindow: { start: nowMin, end: nowMin + 15 },
      travelVariationMin: 0,
      weatherDelayMin: 0,
      parkingDelayMin: 0,
      bankDeposit: false,
    });
    if (!made.ok) return { fail: made.reason };
    made.res.note = 'Prefers the early light, a quiet cart on the first tee, and their own pull trolley waiting';
    const ch = window.__fw.scene3d.clubhouse();
    const walkIn = ch.sendWalkInToDesk({ requestedTeeMinute: Math.min(1380, nowMin + 180) });
    return { reservationId: made.res.id, walkIn: !!walkIn, note: made.res.note.length };
  });
  // give the arrival sweep the sim-minutes it needs to mark the booking
  // due and the walk-in to reach the desk (1x only — A3 removed the rungs)
  await page.waitForTimeout(75000);

  // enter the till (real E through the F1 door)
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const st = s3.walk.stations()[0];
    const w = s3.walk.state;
    w.x = st.x; w.z = st.z + 1.15;
    w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
    w.pitch = -0.2;
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForTimeout(1000);

  const clickAction = async (id) => {
    // monitorScreenPoint projects the hotspot to CLIENT pixels;
    // monitorActionPoint is the monitor-canvas space and every "click" on it
    // silently missed the window (probe: draws stayed at 1, screen 'home')
    const pt = await page.evaluate(([aid]) => {
      const reg = window.__fw.scene3d.clubhouse().register;
      const p = reg.monitorScreenPoint?.(aid);
      return p && p.inView ? { x: p.x, y: p.y } : null;
    }, [id]);
    if (!pt) return false;
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(500);
    return true;
  };
  const overlapsNow = () => page.evaluate(async () => {
    const m = await import(new URL('src/render3d/clubhouse/frontDeskMonitorUi.js', document.baseURI).href);
    return m.MONITOR_OVERLAPS.map((o) => ({
      screen: o.screen, a: o.a.label, b: o.b.label, w: o.overlapW, h: o.overlapH,
    }));
  });
  const hotspotIds = () => page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    return (reg.monitorHotspots?.() || []).map((h) => h.id);
  });

  // sweep the screens
  out.sweep = [];
  out.sweep.push({ screen: 'home', clicked: await clickAction('home') });
  out.sweep.push({ screen: 'checkout', clicked: await clickAction('tab-checkout') });
  out.sweep.push({ screen: 'check-in', clicked: await clickAction('tab-check-in') });
  // select the noted reservation's detail (the goal's own screen)
  out.hotspotsCheckIn = await hotspotIds();
  const selId = out.hotspotsCheckIn.find((h) => String(h).startsWith('select-reservation'));
  if (selId) {
    out.sweep.push({ screen: 'reservation-detail', clicked: await clickAction(selId) });
    await page.screenshot({ path: path.join(OUT, 'tee-time-detail-after.png') });
  }
  const walkinSel = (await hotspotIds()).find((h) => String(h).startsWith('select-walkin'));
  if (walkinSel) {
    out.sweep.push({ screen: 'walk-in-detail', clicked: await clickAction(walkinSel) });
    await page.screenshot({ path: path.join(OUT, 'walk-in-detail-after.png') });
  }
  out.sweep.push({ screen: 'tee-sheet', clicked: await clickAction('tab-tee-sheet') });
  out.cleanOverlaps = await overlapsNow();

  // planted control: the recorder must catch a string laid across the grid
  await page.evaluate(() => { window.__monitorPlantOverlap = true; });
  await clickAction('tab-check-in');
  if (selId) await clickAction(selId);
  await page.waitForTimeout(400);
  const withPlant = await overlapsNow();
  out.planted = withPlant.filter((o) => o.a.includes('PLANTED') || o.b.includes('PLANTED'));
  await page.evaluate(() => { window.__monitorPlantOverlap = false; });
  await page.screenshot({ path: path.join(OUT, 'planted-control.png') });

  // leave the register before the DOM sweep
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave());
  await page.waitForTimeout(600);

  // ---- DOM sweep: pause + settings pages + laptop -------------------------
  const domAudit = () => page.evaluate(() => {
    const leaves = [];
    for (const el2 of document.querySelectorAll('body *')) {
      if (el2.childElementCount > 0) continue;
      if (el2.closest('canvas')) continue;
      const cs = getComputedStyle(el2);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const text = (el2.innerText || el2.textContent || '').trim();
      if (!text) continue;
      let r = el2.getBoundingClientRect();
      let anc2 = el2.parentElement;
      while (anc2 && anc2 !== document.body) {
        const ov = getComputedStyle(anc2).overflow + getComputedStyle(anc2).overflowY;
        if (/(hidden|auto|scroll)/.test(ov)) {
          const cr = anc2.getBoundingClientRect();
          const x1 = Math.max(r.x, cr.x);
          const y1 = Math.max(r.y, cr.y);
          const x2 = Math.min(r.x + r.width, cr.x + cr.width);
          const y2 = Math.min(r.y + r.height, cr.y + cr.height);
          r = { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
        }
        anc2 = anc2.parentElement;
      }
      if (r.width < 2 || r.height < 2) continue;
      leaves.push({ text: text.slice(0, 36), x: r.x, y: r.y, w: r.width, h: r.height, el: el2 });
    }
    const hits = [];
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) {
        const a = leaves[i]; const b = leaves[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // clip-clamp exemption (declared): an overflow-clipped element keeps
        // its layout rect — chain run 1 flagged a keycap whose rect ran
        // under the pause footer while every drawn pixel was clipped away.
        // Rects are clamped to every overflow!=visible ancestor before the
        // intersection is judged.
        const x = Math.max(a.x + 1, b.x + 1);
        const y = Math.max(a.y + 1, b.y + 1);
        const r2 = Math.min(a.x + a.w - 1, b.x + b.w - 1);
        const bo = Math.min(a.y + a.h - 1, b.y + b.h - 1);
        if (r2 > x && bo > y) hits.push({ a: a.text, b: b.text, w: +(r2 - x).toFixed(1), h: +(bo - y).toFixed(1) });
      }
    }
    return { leaves: leaves.length, hits: hits.slice(0, 20) };
  });

  out.dom = {};
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  out.dom.pause = await domAudit();
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.pause-nav-btn')].find((b) => /settings/i.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  const pageIds = await page.evaluate(() => [...document.querySelectorAll('.settings-tab')].map((b) => b.dataset.page));
  for (const id of pageIds) {
    await page.evaluate(([pid]) => {
      const b = [...document.querySelectorAll('.settings-tab')].find((x) => x.dataset.page === pid);
      if (b) b.click();
    }, [id]);
    await page.waitForTimeout(350);
    out.dom[`settings:${id}`] = await domAudit();
  }
  for (let i = 0; i < 3; i += 1) {
    const open = await page.evaluate(() => document.body.classList.contains('pause-open'));
    if (!open) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => window.__fw.scene3d.walk.hooks.openLaptop?.());
  await page.waitForFunction(() => {
    const root = document.querySelector('.laptop-screen');
    return root && root.style.display !== 'none' && root.querySelector('button');
  }, null, { timeout: 12000 }).catch(() => {});
  out.dom.laptop = await domAudit();
  await page.keyboard.press('Escape');

  const domHitTotal = Object.values(out.dom).reduce((a, d) => a + (d.hits ? d.hits.length : 0), 0);
  out.checks = {
    reservationSeeded: !out.seed.fail,
    detailScreenDrawn: !!selId,
    monitorClean: out.cleanOverlaps.length === 0,
    plantedCaught: out.planted.length >= 1,
    domClean: domHitTotal === 0,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'f2.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
