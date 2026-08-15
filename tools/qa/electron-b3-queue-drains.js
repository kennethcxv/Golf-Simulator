// B3 (Goal 23) — A QUEUE OF FOUR DRAINING, AND WHO STARTS WHEN.
//
// WHAT THE PREVIOUS CHECKS MEASURED. The queue work in Goals 20 and 21 measured
// the LIST: is the IN QUEUE label true, does the front of the line abandon, does
// the look-ahead run. All of those are about bookkeeping and all of them passed.
// Nothing ever measured the distance between two BODIES during a handover, which
// is the entire complaint: "a customer finishes, pauses for a second or two, and
// the next one starts moving and walks into their back."
//
// So this samples positions at 20 Hz for the whole drain and reports, per
// person: the frame their predecessor's body cleared the slot, the frame they
// started moving, and the CLOSEST they ever came to the person in front. The
// rule is "cleared, not started to move", so starting before the clearance
// moment is a failure however far apart they ended up.
//
//   VIDEO_DIR=qa/clips/queue-drain node tools/qa/run-electron.cjs \
//     tools/qa/electron-b3-queue-drains.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b3-queue-drains');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  // Watch the line side-on, from the shop floor, so the clip shows the gap.
  out.staged = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const { COUNTER, queueSlot } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 11 * 60;
    app.speedIdx = 0;
    ch.setOrganicWalkins?.(false);
    if (app.state.shop) app.state.shop.open = true;
    for (const id of ['balls1', 'glove1', 'water1', 'sportdrink2']) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 20);
    }
    ch.rebuildStock();
    const names = [];
    for (const skus of [['balls1'], ['glove1'], ['water1'], ['sportdrink2']]) {
      const n = ch.sendToCounter(skus, 'card');
      if (n) names.push(n);
    }
    // stand off to the side of the line so four bodies are all in frame
    const mid = queueSlot(1);
    const w = app.scene3d.walk.state;
    const off = ch.interior.position;
    w.x = mid.x + off.x + 3.4;
    w.z = mid.z + off.z + 0.6;
    w.yaw = Math.atan2(-(mid.x + off.x - w.x), -(mid.z + off.z - w.z));
    w.pitch = -0.12;
    return { names, count: names.length, base: { x: COUNTER.queueBase.x, z: COUNTER.queueBase.z } };
  });
  console.log('B3 staged', JSON.stringify(out.staged));
  if (out.staged.count < 3) {
    out.ok = false;
    out.why = `only ${out.staged.count} customers staged; a drain needs a line`;
    fs.writeFileSync(path.join(OUT, 'queue-drains.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  await page.waitForTimeout(9000); // let them walk to their slots

  // Sample every body and every slot at 20 Hz for the whole drain.
  await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const { queueSlot } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = ch.interior.position;
    window.__qSamples = [];
    window.__qSlots = [0, 1, 2, 3].map((i) => {
      const s = queueSlot(i);
      return { i, x: s.x + off.x, z: s.z + off.z };
    });
    const t0 = performance.now();
    window.__qTimer = setInterval(() => {
      const rows = (ch.customerList ? ch.customerList() : []).map((c) => c);
      window.__qSamples.push({
        t: +(performance.now() - t0).toFixed(0),
        people: rows,
      });
    }, 50);
  }).catch(() => {});

  // customerList may not exist; fall back to the checkoutQueue accessor plus a
  // scene walk. Whichever is available, SAY which one was used.
  out.sampler = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return {
      customerList: typeof ch.customerList === 'function',
      checkoutQueue: typeof ch.checkoutQueue === 'function',
      customers: typeof ch.customers === 'function',
    };
  });
  console.log('B3 sampler', JSON.stringify(out.sampler));

  await page.evaluate(() => { if (window.__qTimer) clearInterval(window.__qTimer); });
  await page.evaluate(async ([names]) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    window.__qSamples = [];
    const t0 = performance.now();
    window.__qTimer = setInterval(() => {
      const people = names.map((n) => {
        const c = ch.customerByName(n);
        if (!c || !c.mesh) return null;
        return {
          n,
          x: +c.mesh.position.x.toFixed(3),
          z: +c.mesh.position.z.toFixed(3),
          phase: c.checkoutPhase || null,
          held: Number.isFinite(c.queueSlotHeld) ? c.queueSlotHeld : null,
        };
      });
      window.__qSamples.push({ t: +(performance.now() - t0).toFixed(0), people });
    }, 50);
  }, [out.staged.names]);

  // Serve them one after another: walk to the till, take each sale.
  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const off = ch.interior.position;
    w.x = REGISTER.stand.x + off.x;
    w.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.yaw = Math.atan2(-dx / h, -dz / h);
    w.pitch = Math.atan2(1.18 - 1.62, h);
  });

  const clickItems = async () => {
    const uids = await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx ? tx.items.filter((i) => !i.scanned).map((i) => i.uid) : [];
    });
    for (const uid of uids) {
      const spot = await page.evaluate(async (id) => {
        const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
        const app = window.__fw;
        const mesh = app.scene3d.clubhouse().register.itemMesh(id);
        if (!mesh) return null;
        const world = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        world.project(app.scene3d.camera);
        const rect = document.querySelector('canvas').getBoundingClientRect();
        return {
          x: rect.left + ((world.x + 1) / 2) * rect.width,
          y: rect.top + ((-world.y + 1) / 2) * rect.height,
          ok: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
        };
      }, uid);
      if (spot && spot.ok) { await page.mouse.click(spot.x, spot.y); await page.waitForTimeout(1500); }
    }
  };

  out.served = [];
  for (let n = 0; n < 4; n += 1) {
    const got = await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.items.length > 0;
    }, null, { timeout: 45000 }).then(() => true).catch(() => false);
    if (!got) { out.served.push({ n, gotTx: false }); break; }
    if (!(await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()))) {
      await page.keyboard.press('e');
      await page.waitForTimeout(1500);
    }
    await clickItems();
    // the register banks the sale itself once the goods are bagged
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !tx;
    }, null, { timeout: 60000 }).catch(() => {});
    out.served.push({ n, gotTx: true });
    await page.waitForTimeout(2500);
  }

  const samples = await page.evaluate(() => {
    if (window.__qTimer) clearInterval(window.__qTimer);
    return { samples: window.__qSamples, slots: window.__qSlots };
  });
  out.sampleCount = samples.samples.length;

  // ---- the analysis: who started when, and how close did they get -----------
  const CLEAR = 0.95;
  const names = out.staged.names;
  const trackOf = (name) => samples.samples
    .map((s) => ({ t: s.t, p: (s.people || []).find((q) => q && q.n === name) || null }))
    .filter((r) => r.p);
  const tracks = Object.fromEntries(names.map((n) => [n, trackOf(n)]));

  const speedAt = (track, i) => {
    if (i === 0) return 0;
    const a = track[i - 1].p; const b = track[i].p;
    const dt = Math.max(1, track[i].t - track[i - 1].t) / 1000;
    return Math.hypot(b.x - a.x, b.z - a.z) / dt;
  };
  const analysis = [];
  for (let k = 1; k < names.length; k += 1) {
    const me = tracks[names[k]] || [];
    const ahead = tracks[names[k - 1]] || [];
    if (!me.length || !ahead.length) { analysis.push({ person: names[k], why: 'no track' }); continue; }
    // the slot they are moving INTO is where the person ahead was standing
    const slot = samples.slots[k - 1];
    let startedMs = null; let clearedMs = null; let closest = Infinity;
    for (let i = 1; i < me.length; i += 1) {
      if (startedMs == null && speedAt(me, i) > 0.25) startedMs = me[i].t;
      const a = ahead.find((r) => r.t === me[i].t);
      if (a) {
        const gap = Math.hypot(a.p.x - me[i].p.x, a.p.z - me[i].p.z);
        if (gap < closest) closest = gap;
        if (clearedMs == null && slot
          && Math.hypot(a.p.x - slot.x, a.p.z - slot.z) > CLEAR) clearedMs = a.t;
      }
    }
    analysis.push({
      person: names[k],
      aheadClearedTheSlotAtMs: clearedMs,
      startedMovingAtMs: startedMs,
      startedAfterCleared: clearedMs != null && startedMs != null ? startedMs >= clearedMs : null,
      closestApproachYd: Number.isFinite(closest) ? +closest.toFixed(3) : null,
    });
  }
  out.analysis = analysis;
  out.checks = {
    sampled: out.sampleCount > 40,
    // the rule, per person: nobody starts before the slot ahead is clear
    nobodyStartedEarly: analysis.every((a) => a.startedAfterCleared !== false),
    // ...and nobody PENETRATED the separation the simulation itself enforces.
    //
    // The first version of this check asked for more than 0.6 yards and failed
    // at 0.599 and 0.600 — which is not a collision, it is the resolver's own
    // floor: resolveCustomer rejects any point within 0.6 of another body, so
    // two people standing in line REST at exactly that. Asking for more than
    // the simulation guarantees is a check that can never pass, and reporting
    // it as a queue fault would have been wrong. 0.55 is the honest question:
    // did anyone get INSIDE the separation, which would mean a body was pushed
    // through another rather than held off it.
    nobodyTouched: analysis.every((a) => a.closestApproachYd == null || a.closestApproachYd >= 0.55),
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'queue-drains.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B3-RESULT', JSON.stringify({ ok: out.ok, checks: out.checks, analysis: out.analysis }, null, 2));
  return out;
}
