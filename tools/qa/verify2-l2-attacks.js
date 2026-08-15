// VERIFY2 queue L — adversarial probe against L2 (the tee sheet).
//   CROWD  — 13 parties booked into 9 slots (three of them FULL, one slot
//            holding four separate names, several very long holder names).
//            The sheet must render all of it: 4 filled pips on full slots,
//            names fitted, and no booking hotspot on any full row.
//   RAWROW — a raw mouse click on a FULL slot's row (which has no hotspot)
//            must not book anything or open a transaction.
//   CASH   — book the walk-in from the sheet with a CASH preference, then
//            probe the tabs at every stage of the cash flow: can the tee
//            sheet be reached mid-transaction, and if so what does the
//            monitor show during the tender/drawer stages?
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-l2');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  // ALWAYS a fresh game: Electron userData persists between runs, and a
  // Continue here would resume whatever world the previous probe left behind.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /new game/i.test(candidate.textContent || ''));
    return !!button && !button.disabled;
  }, null, { timeout: 90000 });
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmBtn = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) await confirmBtn.click();
  const bootMode = 'new-game';
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
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const nowMin = state.clock.minutes % 1440;
    const grid = R.slotTimes(state).filter((minute) => minute >= nowMin + 90);
    const config = state.reservations?.config || {};
    return {
      grid,
      allSlots: R.slotTimes(state),
      nowMin,
      expectedRows: Math.floor((config.closeMin - config.openMin) / config.stepMin),
    };
  });
  assert(setup.grid.length >= 10, 'not enough future slots for the crowd');

  // ---- the crowd: 13 parties into 9 slots ----------------------------------
  const crowd = await page.evaluate(async (grid) => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const dayAbs = Math.floor(app.state.clock.minutes / 1440);
    const book = (minute, name, partySize) => {
      const result = R.bookReservation(app.state, { name, dayAbs, minute, partySize, walkIn: false });
      return { minute, name, partySize, ok: !!result.ok, reason: result.reason || null };
    };
    const results = [
      book(grid[0], 'Bartholomew Featherstonehaugh-Cholmondeley', 4),
      book(grid[1], 'Margaret Winterbottom-Ashworth', 2),
      book(grid[1], 'Christopher Vandermeer', 2),
      book(grid[2], 'Pemberton Family Reunion', 3),
      book(grid[3], 'Anastasia Oberholtzer', 1),
      book(grid[3], 'Benedict Cumberpatch', 1),
      book(grid[3], 'Clementine Featherston', 1),
      book(grid[3], 'Demetrios Papadopoulos', 1),
      book(grid[4], 'Rosalind Ng', 2),
      book(grid[5], 'Ampersand Wu', 1),
      book(grid[6], 'Quadrilateral Quigley-Quattlebaum', 4),
      book(grid[7], 'Ledger and Sons Golfing Society', 2),
      book(grid[8], 'Maximiliana Constantinopoulos-Wetherington', 1),
    ];
    const sheet = R.daySheet(app.state, dayAbs)
      .filter((slot) => grid.slice(0, 9).includes(slot.minute))
      .map((slot) => ({
        minute: slot.minute,
        booked: slot.bookedPlayers ?? slot.reservedSeats ?? 0,
        capacity: slot.capacity,
        names: (slot.reservations || []).map((r) => r.holder || r.fullName).filter(Boolean),
      }));
    return { results, sheet, dayAbs };
  }, setup.grid);
  assert(crowd.results.every((r) => r.ok), `crowd booking failed: ${JSON.stringify(crowd.results.filter((r) => !r.ok))}`);

  // ---- walk-in (CASH preference), select, open the sheet -------------------
  const ask = setup.grid[9];
  const staged = await page.evaluate((minute) => {
    const club = window.__fw.scene3d.clubhouse();
    const c = club.sendWalkInToDesk({ requestedTeeMinute: minute });
    if (!c) return null;
    c.paymentPreference = 'cash';
    c.payMethod = 'cash';
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
  await page.waitForTimeout(1800);
  // The DOM notification cards (.notification-center) float over the canvas
  // top-right — exactly where the monitor projects at the overview pose. A
  // card under the cursor eats the pointerdown before the canvas sees it
  // (this probe's first two runs died there). Instrument-level remedy: let
  // clicks pass through the cards; they stay visible for screenshots.
  await page.evaluate(() => {
    const centre = document.querySelector('.notification-center');
    if (centre) centre.style.setProperty('pointer-events', 'none', 'important');
  });
  const clickMonitor = async (actionId, label, verified = null) => {
    let lastDiag = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const point = await page.evaluate((id) => (
        window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
      ), actionId);
      assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
      if (attempt < 2) {
        await page.mouse.click(point.x, point.y);
      } else {
        // fallback: the game's own event pipeline, bypassing Playwright input
        await page.evaluate(([x, y]) => {
          const canvas = document.querySelector('canvas');
          canvas.dispatchEvent(new PointerEvent('pointerdown', {
            clientX: x, clientY: y, button: 0, pointerId: 7, bubbles: true, cancelable: true,
          }));
          canvas.dispatchEvent(new PointerEvent('pointerup', {
            clientX: x, clientY: y, button: 0, pointerId: 7, bubbles: true, cancelable: true,
          }));
        }, [point.x, point.y]);
      }
      await page.waitForTimeout(650);
      if (!verified) return;
      if (await page.evaluate(verified)) return;
      lastDiag = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const reg = window.__fw.scene3d.clubhouse().register;
        const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
        return {
          domAtPoint: el ? `${el.tagName}.${el.className}` : null,
          pointerLocked: !!document.pointerLockElement,
          gamePick: reg.debugPickAt(x, y),
          workspace: reg.workspace(),
          hotspotIds: reg.monitorHotspots().map((h) => h.id).slice(0, 12),
          walkInsListed: (desk?.walkIns?.() || []).length,
          dpr: window.devicePixelRatio,
          inner: [window.innerWidth, window.innerHeight],
        };
      }, [point.x, point.y]);
      await page.screenshot({ path: path.join(OUT, `click-fail-${label.replace(/[^a-z0-9-]+/gi, '_')}-${attempt}.png`) });
    }
    throw new Error(`${label}: click on ${actionId} had no effect after 4 attempts; diag=${JSON.stringify(lastDiag)}`);
  };
  await clickMonitor('tab-check-in', 'check-in tab',
    () => window.__fw.scene3d.clubhouse().register.monitorHotspots().some((h) => h.id.startsWith('select-walkin:')));
  await clickMonitor(`select-walkin:${staged.customerId}`, 'walk-in row',
    () => window.__fw.scene3d.clubhouse().register.monitorHotspots().some((h) => h.id.startsWith('select-walkin-slot:') || h.id === 'reject-walkin'));
  await clickMonitor('tab-tee-sheet', 'tee sheet tab',
    () => window.__fw.scene3d.clubhouse().register.monitorHotspots().some((h) => h.kind === 'slot'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'crowded-sheet.png') });

  // pixel row count, same instrument as the stock driver, plus its control
  const rendered = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
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
      column1Rows: bands(26, 96, 238, 618),
      column2Rows: bands(526, 596, 238, 618),
      controlBands: bands(1002, 1022, 238, 618),
    };
  });

  const hotspotCensus = await page.evaluate((fullMinutes) => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const slots = reg.monitorHotspots().filter((h) => h.kind === 'slot');
    return {
      total: slots.length,
      fullRowsWithHotspot: slots.filter((h) => fullMinutes.some((m) => h.id.endsWith(`:${m}`))).length,
      ids: slots.map((h) => h.id),
    };
  }, [setup.grid[0], setup.grid[3], setup.grid[6]]);

  // ---- RAWROW: click the FULL 11:30 row's pixels ---------------------------
  // affine canvas->screen map from two live slot hotspots, validated on a third
  const mapData = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const live = reg.monitorHotspots().filter((h) => !h.disabled);
    if (live.length < 3) return null;
    let best = null;
    for (const a of live) {
      for (const b of live) {
        const ax = a.x + a.width / 2; const ay = a.y + a.height / 2;
        const bx = b.x + b.width / 2; const by = b.y + b.height / 2;
        const score = Math.abs(ax - bx) * Math.abs(ay - by);
        if (!best || score > best.score) best = { a: a.id, b: b.id, score };
      }
    }
    const third = live.find((h) => h.id !== best.a && h.id !== best.b);
    const centre = (id) => {
      const h = live.find((k) => k.id === id);
      return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    };
    return { aId: best.a, bId: best.b, thirdId: third.id, aC: centre(best.a), bC: centre(best.b), thirdC: centre(third.id) };
  });
  assert(mapData, 'no live hotspots to derive the screen map from');
  const sp = (id) => page.evaluate((k) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(k)
  ), id);
  const pa = await sp(mapData.aId);
  const pb = await sp(mapData.bId);
  const pc = await sp(mapData.thirdId);
  const sx = (pb.x - pa.x) / (mapData.bC.x - mapData.aC.x || 1);
  const sy = (pb.y - pa.y) / (mapData.bC.y - mapData.aC.y || 1);
  const toScreen = (c) => ({ x: pa.x + (c.x - mapData.aC.x) * sx, y: pa.y + (c.y - mapData.aC.y) * sy });
  const predicted = toScreen(mapData.thirdC);
  const mapErr = Math.hypot(predicted.x - pc.x, predicted.y - pc.y);

  // the FULL 11:30 row's canvas rectangle, from the drawTeeSheet arithmetic
  const fullRowCanvas = await page.evaluate(async (minute) => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const slots = R.slotTimes(app.state);
    const index = slots.indexOf(minute);
    const perColumn = Math.ceil(slots.length / 2);
    const top = 240;
    const bottom = 596; // a note renders (the walk-in has an ask)
    const rowHeight = Math.max(22, Math.min(34, (bottom - top) / perColumn));
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = [24, 524][column];
    return { x: x + 238, y: top + row * rowHeight + rowHeight / 2, index, rowHeight };
  }, setup.grid[0]);
  let rawRowClick = { attempted: false, mapErr };
  if (mapErr < 6) {
    const hit = toScreen({ x: fullRowCanvas.x, y: fullRowCanvas.y });
    const before = await page.evaluate(() => window.__fw.state.reservations.booked.length);
    await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      booked: window.__fw.state.reservations.booked.length,
      tx: !!window.__fw.scene3d.clubhouse().register.getTx(),
    }));
    rawRowClick = {
      attempted: true, mapErr, hit,
      bookedBefore: before, bookedAfter: after.booked, txAfter: after.tx,
    };
    await page.screenshot({ path: path.join(OUT, 'after-full-row-click.png') });
  }

  // ---- CASH: book the ask from the sheet, then probe the tabs --------------
  const askHotspot = await page.evaluate((minute) => {
    const reg = window.__fw.scene3d.clubhouse().register;
    return reg.monitorHotspots().find((h) => h.kind === 'slot' && h.id.endsWith(`:${minute}`))?.id || null;
  }, ask);
  assert(askHotspot, 'walk-in ask row is not bookable on the sheet');
  await clickMonitor(askHotspot, 'ask row on the sheet',
    () => !!window.__fw.scene3d.clubhouse().register.getTx());
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 15000 });

  const stageProbe = () => page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const tx = reg.getTx();
    const hotspots = reg.monitorHotspots();
    return {
      stage: tx ? tx.stage : null,
      method: tx ? tx.method : null,
      tabTeeSheet: !!reg.monitorScreenPoint('tab-tee-sheet')?.inView,
      tabCheckout: !!reg.monitorScreenPoint('tab-checkout')?.inView,
      slotHotspots: hotspots.filter((h) => h.kind === 'slot').length,
      hotspotIds: hotspots.map((h) => h.id).slice(0, 14),
    };
  });

  const timeline = [];
  let hijacked = null;
  for (let i = 0; i < 80; i += 1) {
    const probe = await stageProbe();
    timeline.push(probe);
    if (!hijacked && probe.stage && probe.tabTeeSheet) {
      // the attack: the sheet tab is reachable mid-transaction — click it
      const point = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().register.monitorScreenPoint('tab-tee-sheet')
      ));
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(400);
      hijacked = { atStage: probe.stage, after: await stageProbe() };
      await page.screenshot({ path: path.join(OUT, 'cash-tab-clicked-midtx.png') });
    }
    if (probe.stage === 'cash-tender' || probe.stage === 'cash-drawer') break;
    if (!probe.stage) break; // tx ended unexpectedly
    await page.waitForTimeout(300);
  }
  const atTender = await stageProbe();
  await page.screenshot({ path: path.join(OUT, 'cash-tender-monitor.png') });

  // if the sheet took the glass, can the player get the cash screen back?
  let recovery = null;
  if (atTender.stage === 'cash-tender' && atTender.tabCheckout) {
    const point = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint('tab-checkout')
    ));
    if (point && point.inView) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(500);
      recovery = await stageProbe();
      await page.screenshot({ path: path.join(OUT, 'cash-tab-recovered.png') });
    }
  }

  // teardown: void the transaction, clear the floor
  await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    club.register.abandon?.();
    club.register.leave?.({ restorePointer: false });
    club.clearWalkins();
  });

  const fullSheetTruth = crowd.sheet;
  const checks = {
    bootMode,
    allThirteenPartiesBooked: crowd.results.every((r) => r.ok),
    threeSlotsFull: fullSheetTruth.filter((s) => s.booked >= s.capacity).length === 3,
    fourNamesInOneSlot: fullSheetTruth.some((s) => s.names.length === 4),
    rowCountMatchesOperatingHours:
      !rendered.error && rendered.column1Rows + rendered.column2Rows === setup.expectedRows,
    bandCounterControlQuiet: !rendered.error && rendered.controlBands === 0,
    fullRowsHaveNoHotspot: hotspotCensus.fullRowsWithHotspot === 0,
    openRowsStillBookable: hotspotCensus.total > 0,
    rawFullRowClickDidNothing: !rawRowClick.attempted
      || (rawRowClick.bookedAfter === rawRowClick.bookedBefore && rawRowClick.txAfter === false),
    // cash-flight facts (read from the timeline in the report)
    reachedCashStage: atTender.stage === 'cash-tender' || atTender.stage === 'cash-drawer'
      || timeline.some((t) => t.stage === 'cash-tender' || t.stage === 'cash-drawer'),
    noSlotHotspotsAnyMidTxProbe: timeline.every((t) => !t.stage || t.slotHotspots === 0)
      && (hijacked ? hijacked.after.slotHotspots === 0 : true)
      && atTender.slotHotspots === 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    setup: { grid: setup.grid.slice(0, 10), expectedRows: setup.expectedRows, nowMin: setup.nowMin },
    crowd, ask, staged, rendered, hotspotCensus,
    mapErr, fullRowCanvas, rawRowClick,
    cash: { timeline, hijacked, atTender, recovery },
    errs: errs.slice(0, 10),
    checks,
  };
  out.ok = true;
  fs.writeFileSync(path.join(OUT, 'verify2-l2.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
