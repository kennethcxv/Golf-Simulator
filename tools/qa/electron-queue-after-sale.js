// ROUND 4, ARM B — the head leaves the SHIPPED way, does #2 ever come up?
//
// Arm A (electron-queue-advance.js) proved advancement into an EMPTY slot works
// -- #2 walked up in 0.5 s when the head was despawned outright. The owner's
// case is different: he finishes a real transaction, the served customer walks
// out through the room, and #2 "just stands there". So this drives the entire
// shipped sale -- E at the station, click-to-scan-and-bag each item, present the
// card, type the amount, wait for the bag handoff to run to 'released' -- and
// then watches the line.
//
// The sale recipe is checkout-bag-handoff-path.js's, reduced to what this
// question needs.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-queue-after-sale.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/queue-after-sale');
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

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(500);

  // Three card customers so the whole line pays the same way.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.sendToCounter?.(['balls1'], 'card');
    ch.sendToCounter?.(['glove1'], 'card');
    ch.sendToCounter?.(['tees1'], 'card');
  });
  await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return (ch.checkoutQueue?.() || []).length >= 3;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(8000);

  // Behind the till, facing it -- the cashier's spot.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const st = s3.walk.stations()[0];
    const w = s3.walk.state;
    w.x = st.x; w.z = st.z + 1.15;
    w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
    w.pitch = -0.2;
    w.vx = 0; w.vz = 0;
  });
  await page.waitForTimeout(700);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForFunction(
    () => !!window.__fw.scene3d.clubhouse().register.getTx(),
    null, { timeout: 30000 },
  );
  await page.waitForTimeout(1000);

  const project = (uid) => page.evaluate((id) => {
    const s3 = window.__fw.scene3d;
    const mesh = s3.clubhouse().register.itemMesh(id);
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    const THREE_V = { x: 0, y: 0, z: 0 };
    const e = mesh.matrixWorld.elements;
    THREE_V.x = e[12]; THREE_V.y = e[13]; THREE_V.z = e[14];
    const v = new (Object.getPrototypeOf(s3.camera.position).constructor)(THREE_V.x, THREE_V.y, THREE_V.z);
    v.project(s3.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((-v.y + 1) / 2) * rect.height,
      inView: v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
    };
  }, uid);

  // Scan-and-bag each item by clicking it, the shipped interaction.
  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid)));
  out.itemCount = uids.length;
  for (const uid of uids) {
    let point = await project(uid);
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await project(uid);
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
        point = next; break;
      }
      point = next;
    }
    if (!point || !point.inView) { out.errs.push(`item ${uid} not in frame`); continue; }
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((c) => c.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 15000 }).catch(() => out.errs.push(`item ${uid} never bagged`));
  }

  // Card: click the presented card, type the exact total in cents, Enter.
  await page.waitForFunction(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    return r.getTx()?.stage === 'card-ready' && r.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 40000 });
  await page.waitForTimeout(700);
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const digits = await page.evaluate(async () => {
    // The terminal wants the EXACT total, and the total includes sales tax --
    // summing item prices typed $6.00 at a till expecting $6.42, the card was
    // never approved, and the first run then blamed the game for a sale that
    // this driver had failed to pay for. Ask the shipped arithmetic instead.
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return String(Math.round(totalOf(tx) * 100));
  });
  out.cardDigits = digits;
  for (const key of digits) await page.keyboard.press(key);
  await page.keyboard.press('Enter');

  // Ride the handoff to released.
  out.releasedPhaseSeen = await page.waitForFunction(() => {
    const p = window.__fw.scene3d.clubhouse().register.deliveryPhase?.();
    return p === 'released' || p === 'bag-customer-hold';
  }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave?.());
  await page.waitForTimeout(500);

  // ---- THE QUESTION: does #2 come up? --------------------------------------
  const snap = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const q = ch.checkoutQueue?.() || [];
    const slot0 = ch.queueSlotForIndex ? ch.queueSlotForIndex(0) : null;
    const near = [];
    for (const c of ch.customers?.() || []) {
      if (!c.mesh || !slot0) continue;
      const d = Math.hypot(c.mesh.position.x - slot0.x, c.mesh.position.z - slot0.z);
      if (d < 1.2) near.push({ name: (c.fullName || c.name || '?').slice(0, 12), d: +d.toFixed(2), queued: c.queued === true });
    }
    const rows = q.slice(0, 3).map((row) => {
      const name = row.fullName || row.name || '?';
      const actor = ch.customerByName ? ch.customerByName(name) : null;
      return {
        name: String(name).slice(0, 12),
        held: actor?.queueSlotHeld ?? null,
        distToSlot0: actor?.mesh && slot0
          ? +Math.hypot(actor.mesh.position.x - slot0.x, actor.mesh.position.z - slot0.z).toFixed(3)
          : null,
      };
    });
    return {
      queueLen: q.length,
      rows,
      nearSlot0: near,
      registerCustomer: !!ch.register.getCustomer(),
      // where the transaction actually is -- without this the first run could
      // only say "never released", which blames the game for what may be the
      // driver typing the wrong amount
      txStage: ch.register.getTx()?.stage ?? null,
      flowState: ch.register.getFlow()?.state ?? null,
      deliveryPhase: ch.register.deliveryPhase?.() ?? null,
    };
  });

  const timeline = [];
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(600);
    timeline.push({ t: +((i + 1) * 0.6).toFixed(1), ...(await snap()) });
  }
  out.timeline = timeline;
  await page.screenshot({ path: path.join(OUT, 'after-sale.png') });

  const last = timeline[timeline.length - 1];
  const arrived = timeline.find((s) => s.rows[0] && s.rows[0].distToSlot0 != null && s.rows[0].distToSlot0 < 0.35);
  out.summary = {
    saleReachedRelease: out.releasedPhaseSeen,
    errs: out.errs,
    finalQueueLen: last?.queueLen ?? null,
    finalHead: last?.rows?.[0] ?? null,
    blockersNearSlot0AtEnd: last?.nearSlot0 ?? null,
    registerStillHoldsCustomer: last?.registerCustomer ?? null,
    headArrivedAtSeconds: arrived ? arrived.t : null,
    ADVANCED_AFTER_REAL_SALE: !!arrived,
  };
  fs.writeFileSync(path.join(OUT, 'after-sale.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('QUEUE-AFTER-SALE', JSON.stringify(out.summary, null, 2));
  return out;
}
