// P1 (owner playtest) — THE QUEUE, IN THE GAME.
//
// The arithmetic is pinned in tests/queue-single-file-and-reach.test.js. This
// asks the running world the two questions the owner actually asked, because a
// constant being correct is not the same as four people standing in a line.
//
//   1. With four customers queued, is the fourth IN THE LINE -- one behind
//      another -- or off in the overflow pocket beside and behind the third?
//   2. Does anybody place goods on the counter while another body is standing
//      between them and it?
//
// Question 2 is measured continuously rather than sampled: the through-body
// handoff the owner sees lasts a fraction of a second at the moment the line
// advances, and a poll every half second walks straight past it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p1-queue-single-file.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-queue');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const campaign = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    campaign.disableCampaign(app.state);
    if (app.state.shop) { app.state.shop.open = true; app.state.shop.signOpen = true; }
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    for (const id of ['balls1', 'glove1', 'tees1', 'water1']) {
      const inv = app.state.shop?.inventory?.[id];
      if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
    }
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
    w.x = ip.x; w.z = ip.z + 3.0; w.vx = 0; w.vz = 0;
    ch.refreshShopProgression?.();
    ch.rebuildStock?.();
  });
  await page.waitForTimeout(1500);

  // FOUR CUSTOMERS, which is the exact depth the owner named.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.sendToCounter?.(['balls1'], 'card');
    ch.sendToCounter?.(['glove1'], 'cash');
    ch.sendToCounter?.(['tees1'], 'card');
    ch.sendToCounter?.(['water1'], 'cash');
  });
  await page.waitForTimeout(16000);

  // ---- 1. is it a line? ----------------------------------------------------
  out.line = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const queue = ch.checkoutQueue ? ch.checkoutQueue() : [];
    const slots = [];
    for (let i = 0; i < Math.max(4, queue.length); i += 1) {
      const s = ch.queueSlotForIndex ? ch.queueSlotForIndex(i) : null;
      if (s) slots.push({ i, x: +s.x.toFixed(2), z: +s.z.toFixed(2) });
    }
    return { queued: queue.length, slots };
  });

  // ---- 2. did anyone ever place from behind a body? ------------------------
  //
  // Sampled every frame for the whole advance, not polled. `atDesk` is the
  // game's own answer (customerIsAtTheDesk via the debug accessor); the body
  // check is measured here from real world positions so the two are independent.
  out.watch = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const rec = { samples: 0, violations: [], minGap: Infinity, sawAnyoneAtDesk: false };
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        // ch.debugQueueCorridors reports through the gate's own functions, so
        // atDesk here is the game's answer, not a re-derivation.
        const rows = ch.debugQueueCorridors ? ch.debugQueueCorridors() : [];
        for (const r of rows) {
          if (r.atDesk) rec.sawAnyoneAtDesk = true;
          if (r.corridorMinBodyGapYd != null && r.corridorMinBodyGapYd < rec.minGap) {
            rec.minGap = r.corridorMinBodyGapYd;
          }
          // THE VIOLATION: the game says this person may place goods, AND there
          // is a body on the corridor between their hand and the counter.
          if (r.atDesk && r.corridorMinBodyGapYd != null && r.corridorMinBodyGapYd < 0.32) {
            rec.violations.push({
              atMs: +(performance.now() - t0).toFixed(0),
              placer: r.name, blockedBy: r.blockedBy, gap: r.corridorMinBodyGapYd,
            });
          }
        }
        rec.samples += 1;
        if (performance.now() - t0 > 30000) { done(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return {
      samples: rec.samples,
      sawAnyoneAtDesk: rec.sawAnyoneAtDesk,
      minGapToBodyInFront: Number.isFinite(rec.minGap) ? rec.minGap : null,
      violationCount: rec.violations.length,
      violations: rec.violations.slice(0, 20),
    };
  });

  // POINT THE CAMERA AT THE LINE BEFORE PHOTOGRAPHING IT. The first run shot
  // whatever the player happened to face -- a grey greybox volume with one
  // customer's arm at the frame edge -- and "the line is single file" is a
  // VISUAL complaint. A frame that does not contain the queue proves nothing
  // about the queue.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    const head = ch.queueSlotForIndex(0);
    const tail = ch.queueSlotForIndex(3);
    // stand off the SIDE of the line and look along it, so four bodies read as
    // four depths rather than one occluding the rest
    const mx = (head.x + tail.x) / 2;
    const mz = (head.z + tail.z) / 2;
    const ax = tail.x - head.x;
    const az = tail.z - head.z;
    const len = Math.hypot(ax, az) || 1;
    // PICK THE SIDE THAT IS INSIDE THE ROOM. A perpendicular has two signs and
    // the first version took whichever fell out of the maths -- it put the
    // camera behind the desk looking at back-counter cabinetry. The room centre
    // decides which side a viewer can actually stand on.
    let px = -az / len;
    let pz = ax / len;
    const c = ch.interior.position;
    const toCentre = ((c.x - mx) * px) + ((c.z - mz) * pz);
    if (toCentre < 0) { px = -px; pz = -pz; }
    w.x = mx + px * 3.2;
    w.z = mz + pz * 3.2;
    w.vx = 0; w.vz = 0;
    const lx = mx - w.x;
    const lz = mz - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    const eye = window.__fw.scene3d?.camera?.position?.y;
    w.pitch = Math.atan2((Number.isFinite(eye) ? eye - 0.9 : 0.7) * -1, h);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'four-deep.png') });

  const s = out.line.slots;
  const stepsBack = s.length >= 4
    ? [1, 2, 3].every((i) => s[i - 1].z - s[i].z > 0.4)
    : false;
  const singleFile = s.length >= 4
    ? [1, 2, 3].every((i) => Math.abs(s[i].x - s[i - 1].x) <= 0.30)
    : false;

  out.clauses = {
    fourSlotsAreAvailable: s.length >= 4,
    fourthSlotIsBehindTheThird: stepsBack,
    fourthSlotIsNotOffToTheSide: singleFile,
    // THE INSTRUMENT'S CONTROL: if nothing was ever placing, the body check
    // measured nothing and its clean result means nothing.
    // THE INSTRUMENT'S CONTROL, and it is the important one: if nobody ever
    // reached the desk during the window, "no through-body handoff" is a
    // statement about an empty shop, not about the fix.
    somethingWasActuallyWatched: out.watch.sawAnyoneAtDesk === true && out.watch.samples > 100,
    noGoodsPlacedThroughABody: out.watch.violationCount === 0,
  };
  out.ok = Object.values(out.clauses).every((v) => v === true) && out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'queue.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-QUEUE', JSON.stringify({ line: out.line, watch: out.watch, clauses: out.clauses, ok: out.ok }, null, 2));
  return out;
}
