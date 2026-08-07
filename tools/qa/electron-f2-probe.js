// Throwaway probe: why does the planted monitor overlap never record, and
// why did the due-now bookReservation fail? Reads MONITOR_AUDIT_STATS.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = {};
  await page.evaluate(() => { window.__monitorRectAudit = true; });

  out.booking = await page.evaluate(async () => {
    const state = window.__fw.state;
    const reservations = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const nowMin = ((state.clock.minutes % 1440) + 1440) % 1440;
    const dayAbs = Math.floor(state.clock.minutes / 1440);
    const tries = {};
    for (const lead of [30, 60, 90, 120]) {
      const made = reservations.bookReservation(state, {
        dayAbs,
        minute: Math.min(1380, nowMin + lead),
        fullName: `Probe ${lead}`,
        partySize: 2,
        paymentPreference: 'card',
        totalFee: 60,
        plannedArrival: nowMin + Math.max(1, lead - 30),
        arrivalWindow: { start: nowMin, end: nowMin + lead },
        travelVariationMin: 0,
        weatherDelayMin: 0,
        parkingDelayMin: 0,
        bankDeposit: false,
      });
      tries[lead] = made.ok ? `ok id ${made.res.id}` : `FAIL ${made.reason}`;
      if (made.ok) break;
    }
    return { nowMin, tries };
  });

  // enter the register and drive the check-in tab with the plant on
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
  await page.waitForTimeout(800);
  const clickAction = async (id) => {
    const pt = await page.evaluate(([aid]) => {
      const reg = window.__fw.scene3d.clubhouse().register;
      const p = reg.monitorActionPoint?.(aid);
      return p && Number.isFinite(p.x) ? { x: p.x, y: p.y } : null;
    }, [id]);
    if (!pt) return false;
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(450);
    return true;
  };
  const stats = () => page.evaluate(async () => {
    const m = await import(new URL('src/render3d/clubhouse/frontDeskMonitorUi.js', document.baseURI).href);
    return { ...m.MONITOR_AUDIT_STATS, overlaps: m.MONITOR_OVERLAPS.length };
  });
  out.statsAfterEnter = await stats();
  await clickAction('tab-check-in');
  out.statsCheckIn = await stats();
  await page.evaluate(() => { window.__monitorPlantOverlap = true; });
  await clickAction('tab-checkout');
  await clickAction('tab-check-in');
  await page.waitForTimeout(400);
  out.statsPlanted = await stats();
  out.overlaps = await page.evaluate(async () => {
    const m = await import(new URL('src/render3d/clubhouse/frontDeskMonitorUi.js', document.baseURI).href);
    return m.MONITOR_OVERLAPS.slice(-4).map((o) => `${o.screen}: ${o.a.label} x ${o.b.label}`);
  });
  fs.writeFileSync('qa/electron/f2-sweep/probe.json', `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
