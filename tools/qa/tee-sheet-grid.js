// L2 — the tee sheet is a SHEET. The monitor's new Tee Sheet tab must show
// every slot of the operating day (time, seat pips, holder names, closed
// rows, the now line), and booking a walk-in from the sheet must run the same
// select-walkin-slot flow the check-in tab uses.
//
// The review's control, kept: the rendered ROW COUNT is checked against
// (closeMin - openMin) / stepMin computed here from the reservation config -
// independent arithmetic, not the daySheet call the UI itself renders from.
// Rows are counted from the monitor canvas PIXELS (dark text bands in the
// two time columns), and the band counter carries its own negative control:
// a strip where nothing draws must count zero.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tee-sheet-l2');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(600, state.weather);
    const club = app.scene3d.clubhouse();
    club.setOrganicWalkins(false);
    const walk = app.scene3d.walk.state;
    const off = club.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    // INDEPENDENT expected row count: straight config arithmetic
    const config = state.reservations?.config || {};
    const expectedRows = Math.floor((config.closeMin - config.openMin) / config.stepMin);
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const nowMin = state.clock.minutes % 1440;
    const grid = R.slotTimes(state).filter((minute) => minute >= nowMin + 90);
    return { expectedRows, config: { openMin: config.openMin, closeMin: config.closeMin, stepMin: config.stepMin }, grid: grid.slice(0, 4) };
  });
  assert(Number.isFinite(setup.expectedRows) && setup.expectedRows > 0, 'no operating-hours config');

  // a walk-in with an ask, at the desk head
  const ask = setup.grid[1];
  const staged = await page.evaluate((minute) => {
    const club = window.__fw.scene3d.clubhouse();
    const c = club.sendWalkInToDesk({ requestedTeeMinute: minute });
    if (!c) return null;
    c.paymentPreference = 'card';
    c.payMethod = 'card';
    c.partySize = 1;
    return { customerId: c.customerId, name: c.fullName };
  }, ask);
  assert(staged, 'walk-in did not spawn');
  await page.waitForFunction((id) => {
    const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, staged.customerId, { timeout: 60000 });

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const clickMonitor = async (actionId, label) => {
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), actionId);
    assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
  };

  // select the walk-in on check-in, then open the sheet (the flow a player
  // takes: see who is asking, then look at the day)
  await clickMonitor('tab-check-in', 'check-in tab');
  await clickMonitor(`select-walkin:${staged.customerId}`, 'walk-in row');
  await clickMonitor('tab-tee-sheet', 'tee sheet tab');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'sheet-with-ask.png') });

  // ---- count the rendered rows from the monitor canvas ---------------------
  const rendered = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    // the POS glass by NAME - a blind size match found the laptop's dark
    // 1024x640 lock screen first and read every band as one black run
    const monitor = clubhouse.interior.getObjectByName('FrontDeskLiveMonitor');
    const image = monitor?.material?.map?.image;
    if (!image || image.tagName !== 'CANVAS') return { error: 'monitor canvas not found' };
    const scratch = document.createElement('canvas');
    scratch.width = image.width; scratch.height = image.height;
    const sctx = scratch.getContext('2d');
    sctx.drawImage(image, 0, 0);
    const bands = (x0, x1, y0, y1) => {
      const data = sctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const width = x1 - x0;
      const dark = [];
      for (let y = 0; y < y1 - y0; y += 1) {
        let hit = false;
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] < 120) { hit = true; break; }
        }
        dark.push(hit);
      }
      let count = 0;
      for (let y = 0; y < dark.length; y += 1) if (dark[y] && !dark[y - 1]) count += 1;
      return count;
    };
    return {
      // the two time columns of the sheet body
      column1Rows: bands(26, 96, 238, 618),
      column2Rows: bands(526, 596, 238, 618),
      // NEGATIVE CONTROL: nothing draws in this strip
      controlBands: bands(1002, 1022, 238, 618),
    };
  });
  assert(!rendered.error, rendered.error || 'canvas read failed');

  const hotspots = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots()
      .filter((h) => h.kind === 'slot')
      .map((h) => ({ id: h.id, label: h.label }))
  ));

  // ---- book the ASKED slot from the sheet ----------------------------------
  const askedHotspotId = hotspots.find((h) => h.id.endsWith(`:${ask}`))?.id;
  assert(askedHotspotId, 'no bookable hotspot for the asked slot on the sheet');
  await clickMonitor(askedHotspotId, 'asked row on the sheet');
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const dueDigits = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    return String(Math.round(totalOf(window.__fw.scene3d.clubhouse().register.getTx()) * 100));
  });
  for (const key of dueDigits) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 45000 });
  await page.waitForTimeout(800);

  // the sheet after the booking: the asked slot carries a filled pip + name
  await clickMonitor('tab-tee-sheet', 'tee sheet tab (after booking)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'sheet-after-booking.png') });
  const after = await page.evaluate((minute) => {
    const app = window.__fw;
    const dayAbs = Math.floor(app.state.clock.minutes / 1440);
    return import(new URL('src/sim/reservations.js', document.baseURI).href).then((R) => {
      const slot = R.daySheet(app.state, dayAbs).find((s) => s.minute === minute);
      return slot ? {
        bookedPlayers: slot.bookedPlayers ?? slot.reservedSeats ?? 0,
        holders: (slot.reservations || []).map((r) => r.holder || r.fullName).filter(Boolean),
      } : null;
    });
  }, ask);
  const hotspotsAfter = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots().filter((h) => h.kind === 'slot').length
  ));

  const checks = {
    // the sheet shows the WHOLE operating day, counted from pixels against
    // independent config arithmetic
    rowCountMatchesOperatingHours:
      rendered.column1Rows + rendered.column2Rows === setup.expectedRows,
    bandCounterControlQuiet: rendered.controlBands === 0,
    // booking from the sheet: hotspots exist while a walk-in is selected,
    // include the ask, and the ask books at its minute
    bookableRowsExist: hotspots.length > 0,
    askedRowBookable: !!askedHotspotId,
    bookedAtAskedMinute: !!after && after.bookedPlayers >= 1 && after.holders.length >= 1,
    // with no walk-in selected any more, the sheet offers no booking rows
    noBookingRowsWithoutWalkIn: hotspotsAfter === 0,
    noPageErrors: errs.length === 0,
  };
  const out = { setup, ask, staged, rendered, hotspotCount: hotspots.length, after, hotspotsAfter, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'tee-sheet.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
