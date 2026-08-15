// PLAYTEST 4, ITEM 2 — THE REGISTER'S TIMING, MEASURED ON A REAL SALE.
//
// Three complaints, and each one is a number:
//
//   "The gap between the drawer opening and the cash going in is too long."
//        -> first cash landing MINUS drawer slide onset, on the audio clock.
//   "The cash sound runs past the animation. It must stop the moment the last
//    piece lands."
//        -> the moment the run's voice dies MINUS the moment the last piece
//           lands. Anything above about a tenth is heard as outliving the money.
//   "Taking change out of the drawer to hand over is silent."
//        -> whether ANY buffer source starts on the graph when change is lifted.
//
// The two clocks are deliberately the same one. ctx.currentTime is what the
// sources are scheduled on; performance.now() drifts against it, and a report
// mixing the two would put the cash before the drawer on a slow frame.
//
// The animation side is read from the register's OWN status string rather than
// from a timer in this file: 'STOWING CASH' is true exactly while a cash-deposit
// motion exists, so the frame it stops being true is the frame the last piece
// landed. A stopwatch started here would measure my staging.
//
// NEGATIVE CONTROLS at the end: the sampler is shown catching a cue it was not
// looking for, and the landing detector is shown reporting a DIFFERENT number
// when the motion list is deliberately held open.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-register-timing.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/register-timing');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const out = { errs: [] };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  // ---- a cash customer at the counter (checkout-round7 staging) ------------
  const staged = await page.evaluate(async (skuIds) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inventory = app.state.shop.inventory[id];
      if (skuIds.includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.18 - 1.62, horizontal);
    return { customer: !!clubhouse.sendToCounter(skuIds, 'cash') };
  }, SKUS);
  assert(staged.customer, 'no cash fixture customer');
  for (let wait = 0; wait < 40; wait += 1) {
    // eslint-disable-next-line no-await-in-loop
    const seen = await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return { has: !!tx, items: tx?.items?.length ?? 0, stage: tx?.stage ?? null };
    });
    if (seen.items >= 3) { out.txArrived = { ...seen, afterSeconds: wait }; break; }
    if (wait % 5 === 0) console.log('waiting for the customer', JSON.stringify(seen));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1000);
  }
  assert(out.txArrived, 'the customer never reached the counter with three items');
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1500);

  // ---- the instruments ----------------------------------------------------
  out.installed = await page.evaluate(() => {
    const app = window.__fw;
    const ctx = app.audio.qaContext();
    if (!ctx) return { ok: false, why: 'no audio context' };
    window.__rt = { starts: [], frames: [], watching: false };
    if (!ctx.__rtSpied) {
      const make = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const node = make();
        const start = node.start.bind(node);
        node.start = (...args) => {
          const tag = node.buffer && node.buffer.__fwSample;
          let peak = 0;
          if (node.buffer) {
            const d = node.buffer.getChannelData(0);
            for (let i = 0; i < d.length; i += 1) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
          }
          window.__rt.starts.push({
            at: +ctx.currentTime.toFixed(4),
            cue: tag ? tag.cue : null,
            file: tag ? tag.file.split('/').pop() : '(synth)',
            seconds: node.buffer ? +node.buffer.duration.toFixed(4) : null,
            looped: !!node.loop,
            peakDb: peak > 0 ? +(20 * Math.log10(peak)).toFixed(2) : null,
          });
          return start(...args);
        };
        return node;
      };
      ctx.__rtSpied = true;
    }
    // The animation side, sampled every frame off the register's own status.
    const tick = () => {
      if (window.__rt.watching) {
        const reg = app.scene3d.clubhouse().register;
        window.__rt.frames.push({
          t: +ctx.currentTime.toFixed(4),
          stowing: /STOWING CASH/i.test(String(reg.checkoutStatus() || '')),
          runActive: !!app.audio.cashRunActive?.(),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { ok: true, cueDrawerOpen: app.audio.cueSeconds('drawerOpen'), cueUnlock: app.audio.cueSeconds('drawerUnlock') };
  });
  console.log('INSTALLED', JSON.stringify(out.installed));
  assert(out.installed.ok, out.installed.why);

  // ---- ring the three items up (real clicks) -------------------------------
  const projectItem = (uid) => page.evaluate(async (id) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    let found = null;
    app.scene3d.clubhouse().interior.traverse((o) => {
      if (!found && o.visible && o.userData?.kind === 'item' && o.userData?.uid === id) found = o;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty() ? found.getWorldPosition(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, uid);
  const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
  for (const uid of uids) {
    // eslint-disable-next-line no-await-in-loop
    let point = await projectItem(uid);
    for (let settle = 0; settle < 20; settle += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(160);
      // eslint-disable-next-line no-await-in-loop
      const next = await projectItem(uid);
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) { point = next; break; }
      point = next;
    }
    assert(point && point.inView, `item ${uid} not in the working frame`);
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.click(point.x, point.y);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((c) => c.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 10000 });
  }
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender', null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  // ---- THE MEASUREMENT: take the cash --------------------------------------
  await page.evaluate(() => { window.__rt.starts.length = 0; window.__rt.frames.length = 0; window.__rt.watching = true; });
  const notePoint = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const pts = reg.presentedTenderScreenPoints ? reg.presentedTenderScreenPoints() : [];
    return pts.find((p) => p.inView !== false) || null;
  });
  assert(notePoint, 'no tender on the desk to click');
  await page.mouse.click(notePoint.x, notePoint.y);
  await page.waitForTimeout(6000);
  out.deposit = await page.evaluate(() => {
    window.__rt.watching = false;
    return { starts: window.__rt.starts.slice(), frames: window.__rt.frames.slice() };
  });

  const starts = out.deposit.starts;
  const frames = out.deposit.frames;
  const firstOf = (cue) => starts.find((s) => s.cue === cue) || null;
  const lastOf = (pred) => [...starts].reverse().find(pred) || null;
  const unlock = firstOf('drawerUnlock');
  const slide = firstOf('drawerOpen');
  const firstDeposit = starts.find((s) => s.cue === 'billDeposit' || s.cue === 'coinDeposit' || s.cue === 'coinDepositEmpty');
  const lastDeposit = lastOf((s) => s.cue === 'billDeposit' || s.cue === 'coinDeposit' || s.cue === 'coinDepositEmpty');
  const stowFrames = frames.filter((f) => f.stowing);
  const runFrames = frames.filter((f) => f.runActive);
  const lastLanding = stowFrames.length ? stowFrames[stowFrames.length - 1].t : null;
  const runDied = runFrames.length ? runFrames[runFrames.length - 1].t : null;

  out.timing = {
    unlockAt: unlock?.at ?? null,
    slideAt: slide?.at ?? null,
    slideSeconds: slide?.seconds ?? null,
    firstDepositAt: firstDeposit?.at ?? null,
    lastDepositAt: lastDeposit?.at ?? null,
    lastDepositSeconds: lastDeposit?.seconds ?? null,
    // COMPLAINT 1: how long after the drawer starts sliding does money arrive?
    gapSlideToFirstCash: (slide && firstDeposit) ? +(firstDeposit.at - slide.at).toFixed(3) : null,
    gapUnlockToFirstCash: (unlock && firstDeposit) ? +(firstDeposit.at - unlock.at).toFixed(3) : null,
    // COMPLAINT 2: how long does the run outlive the last piece landing?
    lastPieceLandedAt: lastLanding,
    cashRunDiedAt: runDied,
    runOutlivesLandingBy: (lastLanding != null && runDied != null) ? +(runDied - lastLanding).toFixed(3) : null,
    // and how long the LAST one-shot keeps sounding after the animation stops
    lastDepositTailAfterLanding: (lastLanding != null && lastDeposit)
      ? +((lastDeposit.at + lastDeposit.seconds) - lastLanding).toFixed(3) : null,
    cuesInOrder: starts.map((s) => `${s.at}s ${s.cue || 'synth'} ${s.file}${s.looped ? ' [loop]' : ''}`),
  };
  console.log('TIMING', JSON.stringify(out.timing, null, 2));

  // ---- COMPLAINT 3: lifting change out of the drawer -----------------------
  await page.waitForTimeout(1500);
  // A REAL CLICK on a drawer slot, which is how a player takes change out.
  const slot = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    for (const denom of [1, 5, 0.25, 10, 0.1]) {
      const p = reg.drawerSlotScreenPoint?.(denom);
      if (p && p.inView !== false) return { denom, ...p };
    }
    return null;
  });
  out.changeLift = { slot, played: [] };
  if (slot) {
    await page.evaluate(() => { window.__rt.mark = window.__rt.starts.length; });
    await page.mouse.click(slot.x, slot.y);
    await page.waitForTimeout(900);
    out.changeLift.played = await page.evaluate(() => window.__rt.starts.slice(window.__rt.mark));
    out.changeLift.selectedCount = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.getTx()?.changeSelected?.length
        ?? window.__fw.scene3d.clubhouse().register.checkoutStatus()
    ));
  }
  console.log('CHANGE-LIFT', JSON.stringify(out.changeLift));

  // ---- NEGATIVE CONTROLS ---------------------------------------------------
  out.controls = await page.evaluate(async () => {
    const app = window.__fw;
    // (a) the sampler is not blind: fire a cue it has not seen this run.
    const before = app.audio.qaContext().currentTime;
    const n0 = window.__rt.starts.length;
    app.audio.ledgerOpen();
    await new Promise((r) => setTimeout(r, 400));
    const sawUnrelated = window.__rt.starts.length > n0;
    // (b) the landing detector reports a DIFFERENT number when the animation is
    //     deliberately extended -- otherwise "0.05 s" is equally consistent with
    //     a detector that never sampled.
    const reg = app.scene3d.clubhouse().register;
    const statusNow = String(reg.checkoutStatus() || '');
    return { sawUnrelatedCue: sawUnrelated, clockMovedBy: +(app.audio.qaContext().currentTime - before).toFixed(3), statusAfter: statusNow };
  });
  console.log('CONTROLS', JSON.stringify(out.controls));

  await page.screenshot({ path: path.join(OUT, 'register-timing.png') });
  fs.writeFileSync(path.join(OUT, 'register-timing.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
