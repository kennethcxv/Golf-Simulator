// ROUND 4 — "I just finished a transaction and the second person in line
// doesn't come up anymore, he just stands there."
//
// Two arms, because "the head left" has two shapes and only one of them is the
// one the owner plays:
//
//   A  DISMISS   the head is REMOVED outright (despawned). If #2 will not walk
//                into a slot that is literally empty, the advancement logic
//                itself is broken.
//   B  (follow-up, only if A passes) the head leaves the SHIPPED way and #2 has
//                to advance past a body that is still walking out.
//
// Reports the new head's held slot and distance-to-slot-0 over time, so the
// answer is a curve rather than a feeling.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-queue-advance.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/queue-advance');
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
  await page.waitForTimeout(2500);

  // Stand clear of the queue so the player's own 0.74 yd bubble is not the
  // obstacle the test is about.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    w.x = c.x + 4.5; w.z = c.z + 4.5; w.vx = 0; w.vz = 0;
    ch.sendToCounter?.(['balls1'], 'card');
    ch.sendToCounter?.(['glove1'], 'cash');
    ch.sendToCounter?.(['tees1'], 'card');
  });

  // Let the line form.
  await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return (ch.checkoutQueue?.() || []).length >= 3;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(9000); // settle onto slots

  const snap = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const q = ch.checkoutQueue?.() || [];
    const slot0 = ch.queueSlotForIndex ? ch.queueSlotForIndex(0) : null;
    return {
      queueLen: q.length,
      members: q.slice(0, 4).map((row) => {
        // checkoutQueue() rows are SIM entries with no mesh and no slot state.
        // The render actor -- the thing that actually stands in the room -- is
        // found through customerByName. Reading the rows directly produced a
        // full snapshot of nulls that said nothing about anybody's position.
        const name = row.fullName || row.name || '?';
        const actor = ch.customerByName ? ch.customerByName(name) : null;
        const px = actor?.mesh?.position?.x ?? null;
        const pz = actor?.mesh?.position?.z ?? null;
        return {
          name: String(name).slice(0, 14),
          held: actor?.queueSlotHeld ?? null,
          queued: actor?.queued === true,
          hasActor: !!actor,
          x: px == null ? null : +px.toFixed(2),
          z: pz == null ? null : +pz.toFixed(2),
          distToSlot0: slot0 && px != null
            ? +Math.hypot(px - slot0.x, pz - slot0.z).toFixed(3)
            : null,
        };
      }),
    };
  });

  out.beforeDismiss = await snap();
  console.log('QUEUE before', JSON.stringify(out.beforeDismiss));

  // ---- ARM A: the head vanishes outright -----------------------------------
  out.dismissed = await page.evaluate(() => window.__fw.scene3d.clubhouse().dismissCounterCustomer());
  const timeline = [];
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(500);
    const s = await snap();
    timeline.push({ t: (i + 1) * 0.5, head: s.members[0] ?? null, queueLen: s.queueLen });
  }
  out.timeline = timeline;
  await page.screenshot({ path: path.join(OUT, 'after-dismiss.png') });

  const last = timeline[timeline.length - 1];
  const arrived = timeline.find((s) => s.head && s.head.distToSlot0 != null && s.head.distToSlot0 < 0.35);
  out.summary = {
    dismissed: out.dismissed,
    queueLenBefore: out.beforeDismiss.queueLen,
    newHeadName: last?.head?.name ?? null,
    newHeadHeldSlot: last?.head?.held ?? null,
    newHeadDistToSlot0: last?.head?.distToSlot0 ?? null,
    arrivedAtSeconds: arrived ? arrived.t : null,
    ADVANCED: !!arrived,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'advance.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('QUEUE-ADVANCE', JSON.stringify(out.summary, null, 2));
  return out;
}
