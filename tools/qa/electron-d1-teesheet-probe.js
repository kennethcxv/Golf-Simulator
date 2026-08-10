// D1 — WHY IS THE SCHEDULER EMPTY? Read the live save's tee sheet, the
// generator's inputs, and today's booked list. Diagnosis before change.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-d1-teesheet-probe.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d1-teesheet-probe');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async () => {
    const fw = window.__fw;
    const state = fw.state;
    const res = await import('./src/sim/reservations.js');
    const dayAbs = Math.floor(state.clock.minutes / 1440);
    const booked = (state.reservations?.booked || []);
    const todays = booked.filter((r) => Math.floor(Number(r.teeTimeAbs || 0) / 1440) === dayAbs);
    const gen = state.reservations?.generator || null;
    let sheet = null;
    try { sheet = res.daySheet(state, dayAbs).map((s) => ({ m: s.minute, avail: s.available, seats: s.availableSeats })); } catch (e) { sheet = String(e); }
    let occupancy = null;
    try {
      const mod = await import('./src/sim/reservations.js');
      occupancy = mod.generatedOccupancy ? mod.generatedOccupancy(state, dayAbs) : 'not exported';
    } catch (e) { occupancy = String(e); }
    return {
      clock: state.clock.minutes,
      dayAbs,
      bookedTotal: booked.length,
      bookedToday: todays.length,
      todaysSample: todays.slice(0, 6).map((r) => ({
        id: r.id, tee: r.teeTimeAbs, planned: r.plannedArrival, status: r.status, arrival: r.arrivalStatus, source: r.source,
      })),
      generator: gen,
      reputation: state.club?.reputation,
      greenFee: state.club?.greenFee,
      sheetSlots: Array.isArray(sheet) ? sheet.length : sheet,
      sheetOpenSlots: Array.isArray(sheet) ? sheet.filter((s) => s.avail).length : null,
      occupancy,
    };
  });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('D1-PROBE', JSON.stringify(out));
}
