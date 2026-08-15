// B2 (Goal 19) — "IN QUEUE" MUST MEAN PHYSICALLY IN THE LINE, RIGHT NOW.
//
// The check-in screen labels rows AT DESK / IN QUEUE from `queueIndex` alone.
// `queued` flips TRUE the moment a walk-in's route STOP becomes the counter —
// while they are still crossing the room — and an actor that left the line
// entirely reads queueIndex -1, which the old map also printed as IN QUEUE.
//
// This driver samples the bridge rows AND the actor's real distance to their
// queue slot through the walk-up, so ONE instrument serves both runs:
//   - on the unfixed build it prints LIE_CONFIRMED when a row's OLD-map label
//     says AT DESK / IN QUEUE while the actor is over 1.2 yd from the slot;
//   - on the fixed build the rows carry `atSlot`, and the NEW-map label for
//     those same samples must read as walking up, with AT DESK / IN QUEUE
//     reserved for actors physically at their slots.
// NEGATIVE CONTROL: before any walk-in exists, the bridge lists nobody.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b2-queue-truth.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b2-queue-truth');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.scene3d.clubhouse().setOrganicWalkins(true);
    app.speedIdx = 1;
  });

  // NEGATIVE CONTROL
  out.control = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const bridge = typeof ch.frontDeskBridge === 'function' ? ch.frontDeskBridge() : ch.frontDeskBridge;
    return { rows: bridge.walkIns().length };
  });

  // wait for a walk-in-tee customer to take the counter stop, then sample the
  // whole walk-up at 200 ms
  const series = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const slotWorld = (i) => {
      if (i < 0) return null;
      if (ch.queueSlotWorld) return ch.queueSlotWorld(i);
      const s = L.queueSlot(i);
      const o = ch.interior.position;
      return { x: o.x + s.x, z: o.z + s.z };
    };
    const bridge = typeof ch.frontDeskBridge === 'function' ? ch.frontDeskBridge() : ch.frontDeskBridge;
    return new Promise((resolve) => {
    const samples = [];
    const t0 = performance.now();
    const tick = () => {
      const rows = bridge.walkIns();
      const queuedRows = rows.filter((row) => row.queued);
      if (queuedRows.length) {
        for (const row of queuedRows) {
          const actor = ch.customers().find((c) => c.customerId === row.customerId);
          if (!actor || !actor.mesh) continue;
          const slot = slotWorld(row.queueIndex);
          samples.push({
            t: +(performance.now() - t0).toFixed(0),
            customerId: row.customerId,
            queueIndex: row.queueIndex,
            atSlot: row.atSlot ?? null,
            leaving: row.leaving ?? null,
            ax: +actor.mesh.position.x.toFixed(2),
            az: +actor.mesh.position.z.toFixed(2),
            sx: slot ? +slot.x.toFixed(2) : null,
            sz: slot ? +slot.z.toFixed(2) : null,
            dist: slot ? +Math.hypot(actor.mesh.position.x - slot.x, actor.mesh.position.z - slot.z).toFixed(2) : null,
          });
        }
        const last = samples[samples.length - 1];
        if (samples.length > 12 && last.dist !== null && last.dist < 0.5) { resolve(samples); return; }
        if (samples.length > 600) { resolve(samples); return; }
      }
      if (performance.now() - t0 > 240000) { resolve(samples); return; }
      setTimeout(tick, 200);
    };
    tick();
    });
  });
  out.samples = series.length;
  out.hasSlotFn = series.some((s) => s.dist !== null);

  const OLD_LABEL = (s) => (s.queueIndex === 0 ? 'AT DESK' : 'IN QUEUE');
  const NEW_LABEL = (s) => (s.queueIndex === 0 && s.atSlot ? 'AT DESK'
    : s.atSlot ? 'IN QUEUE' : 'WALKING UP');
  const farSamples = series.filter((s) => s.dist !== null && s.dist > 1.2);
  out.lieWindowSamples = farSamples.length;
  out.LIE_CONFIRMED = farSamples.some((s) => OLD_LABEL(s) === 'AT DESK' || OLD_LABEL(s) === 'IN QUEUE');
  out.fixedFieldPresent = series.some((s) => s.atSlot !== null);
  out.NEW_MAP_HONEST = out.fixedFieldPresent
    ? farSamples.every((s) => NEW_LABEL(s) === 'WALKING UP')
      && series.filter((s) => s.dist !== null && s.dist < 0.5).every((s) => s.atSlot === true)
    : null;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('B2-TRUTH', JSON.stringify(out));
}
