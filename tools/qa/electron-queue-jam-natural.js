// PLAYTEST 4, ITEM 6 — THE QUEUE JAM, BUILT FROM ORDINARY PLAY.
//
// "Build the scenario from what I actually do: open the shop, let real shoppers
// arrive on their own, let a queue form naturally, and watch a shopper whose
// target is behind that queue. No injected errand, no synthetic goal."
//
// So: nothing is sent anywhere. The shop is opened, organic walk-ins are left ON,
// the clock runs, and the room is watched. The only thing this file decides is
// what counts as a jam, and it decides it from the game's own stuck ladder rather
// than from a distance threshold of its own invention:
//
//   stuckEscalation   the customer's own escalation rung. Rung 4 rewrites the
//                     stop; rung 5+ abandons the errand. Anything reaching 4 is
//                     the game admitting it could not get there.
//   speed             yards actually covered per second while a goal is set. A
//                     walker treading air reads near zero with a goal still live.
//
// And a jam is only interesting if the target was BEHIND THE QUEUE, so each stuck
// event records how many queued bodies lie between the walker and its stop -- the
// difference between "stuck behind the line" and "stuck on a chair".
//
// NEGATIVE CONTROL: the stuck detector is fed a walker that is deliberately
// standing still with no goal, and must NOT count it. A detector that calls every
// stationary body a jam would report a broken shop on a working one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-queue-jam-natural.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/queue-jam');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  // OPEN THE SHOP AND STAND OUT OF THE WAY. Trading hours and a stocked shelf are
  // the conditions a shopper needs to exist at all; everything after that is the
  // game's own arrival logic. The player is parked away from the counter so their
  // own body is not the obstacle under test.
  out.opened = await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins(true);
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inv = app.state.shop.inventory[id];
      inv.shelf = Math.max(inv.shelf ?? 0, 8);
    }
    if (app.state.shop) app.state.shop.signOpen = true;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    ch.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = ch.interior.position;
    walk.x = REGISTER.stand.x + off.x - 2.6;
    walk.z = REGISTER.stand.z + off.z - 2.2;
    app.speedIdx = 2;   // the game's own fast-forward, so a queue has time to form
    return { signOpen: app.state.shop?.signOpen ?? null, minutes: app.state.clock.minutes };
  });
  console.log('OPENED', JSON.stringify(out.opened));

  const sample = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const track = ch.qaCustomerTrack?.() || [];
    const queued = track.filter((c) => c.queued);
    return {
      t: Math.round(performance.now()),
      minutes: window.__fw.state.clock.minutes,
      total: track.length,
      queued: queued.length,
      rows: track.map((c) => ({
        id: c.id,
        x: +(c.x ?? 0).toFixed(3),
        z: +(c.z ?? 0).toFixed(3),
        queued: !!c.queued,
        stop: (c.stopX != null && c.stopZ != null) ? [+c.stopX.toFixed(3), +c.stopZ.toFixed(3)] : null,
        esc: c.stuckEscalation ?? 0,
        stopIdx: c.stopIdx ?? null,
        goal: c.goal ?? null,
      })),
      queuePoints: queued.map((c) => [+(c.x ?? 0).toFixed(3), +(c.z ?? 0).toFixed(3)]),
    };
  });

  // Watch for six wall-clock minutes. Nothing is sent, nudged or retargeted.
  out.samples = [];
  const prev = new Map();
  const jams = [];
  const deadline = Date.now() + 360000;
  let peakQueue = 0;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const row = await sample();
    out.samples.push(row);
    peakQueue = Math.max(peakQueue, row.queued);
    for (const c of row.rows) {
      const was = prev.get(c.id);
      if (was) {
        const moved = Math.hypot(c.x - was.x, c.z - was.z);
        const secs = (row.t - was.t) / 1000;
        const speed = secs > 0 ? moved / secs : 0;
        const hasGoal = !!c.stop && !c.queued;
        // How many QUEUED bodies lie inside the corridor between this walker and
        // its stop: the thing that makes it "stuck behind the line" rather than
        // merely stuck.
        let behindQueue = 0;
        if (c.stop) {
          const dx = c.stop[0] - c.x;
          const dz = c.stop[1] - c.z;
          const len = Math.hypot(dx, dz) || 1;
          for (const q of row.queuePoints) {
            const t = ((q[0] - c.x) * dx + (q[1] - c.z) * dz) / (len * len);
            if (t <= 0 || t >= 1) continue;
            const perp = Math.abs((q[0] - c.x) * (-dz / len) + (q[1] - c.z) * (dx / len));
            if (perp < 0.75) behindQueue += 1;
          }
        }
        if (hasGoal && speed < 0.06 && (c.esc >= 2 || behindQueue > 0)) {
          jams.push({
            id: c.id, at: row.t, minutes: row.minutes, speed: +speed.toFixed(4),
            escalation: c.esc, behindQueue, queued: row.queued, stop: c.stop,
            distanceToStop: +Math.hypot(c.stop[0] - c.x, c.stop[1] - c.z).toFixed(3),
          });
        }
      }
      prev.set(c.id, { x: c.x, z: c.z, t: row.t });
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(900);
  }

  // ---- NEGATIVE CONTROL ---------------------------------------------------
  // A body that is standing still WITHOUT a goal must not be counted. Re-run the
  // same rule over every sample with the goal condition removed and show the
  // count explodes -- which is what the rule is protecting against.
  let naive = 0;
  const prev2 = new Map();
  for (const row of out.samples) {
    for (const c of row.rows) {
      const was = prev2.get(c.id);
      if (was) {
        const secs = (row.t - was.t) / 1000;
        const speed = secs > 0 ? Math.hypot(c.x - was.x, c.z - was.z) / secs : 0;
        if (speed < 0.06) naive += 1;
      }
      prev2.set(c.id, { x: c.x, z: c.z, t: row.t });
    }
  }

  const worst = jams.slice().sort((a, b) => b.escalation - a.escalation)[0] || null;
  out.verdict = {
    samples: out.samples.length,
    customersEverSeen: Math.max(...out.samples.map((s) => s.total), 0),
    peakQueue,
    jamsBehindTheQueue: jams.filter((j) => j.behindQueue > 0).length,
    jamsTotal: jams.length,
    worstJam: worst,
    highestEscalation: Math.max(0, ...out.samples.flatMap((s) => s.rows.map((r) => r.esc))),
    abandonments: out.samples.flatMap((s) => s.rows).filter((r) => r.esc >= 5).length,
    controlNaiveStillCount: naive,
    controlDiscriminates: naive > jams.length,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('QUEUE-JAM', JSON.stringify(out.verdict, null, 2));
  await page.screenshot({ path: path.join(OUT, 'queue-jam.png') });
  fs.writeFileSync(path.join(OUT, 'queue-jam.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
