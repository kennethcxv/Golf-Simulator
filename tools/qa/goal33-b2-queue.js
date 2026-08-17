// B2 — THE QUEUE, PHOTOGRAPHED AND MEASURED.
//
// "Single file running back from the desk, natural gaps. Advance when the person
//  ahead moves; re-flow when someone leaves the middle. They must not all leave
//  together. Joiners walk to the back rather than teleporting into the shape."
//
// The five-minute watch already answered the shape numerically once the
// unreachable-stop fix landed: median lateral offset from the queue axis fell
// from 3.507 yd to 0.141 yd and the line held slots 0/1/2 at 0.79 yd pitch. But
// three probes have reported clean on things he could see were broken, so this
// one AIMS AT THE LINE and takes the picture, then keeps watching to answer the
// two dynamic questions:
//
//   JOINERS   does the next arrival walk to the BACK, or appear inside the
//             shape? Tracked as the slot they first hold and the distance they
//             covered getting there.
//   EXODUS    when people leave, do they leave together? Every departure is
//             timestamped and the worst 3-second burst is reported.
//
// CONTROL: the aim is verified by projecting the queue head into the frame and
// requiring it on screen before the shutter — a screenshot of the wrong wall is
// how "the queue looks fine" gets reported about a queue nobody photographed.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<profile> \
//   node tools/qa/run-electron.cjs tools/qa/goal33-b2-queue.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'b2';
  const out = { tag, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const cont = [...document.querySelectorAll('button')]
        .find((b) => /\bContinue\b/.test(b.querySelector('.menu-action-label')?.textContent || b.textContent || ''));
      return !!(cont && !cont.disabled);
    }, null, { timeout: 90000 });
  }
  const how = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  if (process.env.QA_RESUME && how !== 'continue') throw new Error(`seeded profile did not resume: ${how}`);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__p0 = {
      project(x, y, z) {
        const cam = window.__fw.scene3d.camera;
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        const v = cam.matrixWorldInverse.elements;
        const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
        const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
        const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
        const p = cam.projectionMatrix.elements;
        const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
        const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
        const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        if (!cw) return null;
        return { ndcX: cx / cw, ndcY: cy / cw, behind: cw <= 0 };
      },
    };
  });

  // walk in
  await page.keyboard.down('w');
  await page.waitForTimeout(6000);
  await page.keyboard.up('w');
  await page.waitForTimeout(700);

  const yawPerPx = -0.001927;
  const pitchPerPx = -0.0019;
  const lookAt = async (target) => {
    for (let i = 0; i < 8; i += 1) {
      const t = await page.evaluate((pt) => {
        const w = window.__fw.scene3d.walk.state;
        const cam = window.__fw.scene3d.camera;
        const d = Math.hypot(pt.x - w.x, pt.z - w.z);
        let dy = Math.atan2(-(pt.x - w.x), -(pt.z - w.z)) - w.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        const dp = Math.atan2((pt.y ?? 1.0) - cam.position.y, d) - w.pitch;
        const pr = window.__p0.project(pt.x, pt.y ?? 1.0, pt.z);
        return { dy, dp, ndcX: pr?.ndcX ?? null, ndcY: pr?.ndcY ?? null, behind: pr?.behind ?? true, dist: d };
      }, target);
      if (!t.behind && Math.abs(t.ndcX) < 0.35 && Math.abs(t.ndcY) < 0.5) return { ok: true, iters: i, dist: +t.dist.toFixed(2) };
      await page.mouse.move(Math.round(vp.w / 2), Math.round(vp.h / 2));
      await page.mouse.move(
        Math.round(vp.w / 2 + Math.max(-1200, Math.min(1200, t.dy / yawPerPx))),
        Math.round(vp.h / 2 + Math.max(-400, Math.min(400, t.dp / pitchPerPx))),
        { steps: 12 },
      );
      await page.waitForTimeout(130);
    }
    return { ok: false };
  };

  // ---- wait for a line to form, tracking every joiner on the way ----------
  const WAIT_MS = Number(process.env.QA_QUEUE_WAIT_MS || 420000);
  const t0 = Date.now();
  const joiners = new Map();
  const seenAt = new Map();
  const departures = [];
  let best = null;
  while (Date.now() - t0 < WAIT_MS) {
    const s = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const w = window.__fw.scene3d.walk.state;
      const rows = ch.customers().filter((c) => c.mesh).map((c) => ({
        id: c.customerId,
        x: +c.mesh.position.x.toFixed(3),
        z: +c.mesh.position.z.toFixed(3),
        queued: !!c.queued,
        slot: Number.isFinite(c.queueSlotHeld) ? c.queueSlotHeld : null,
        stop: c.stops?.[c.stopIdx]?.kind ?? null,
      }));
      return {
        t: performance.now(),
        clock: window.__fw.state.clock?.minutes ?? null,
        player: { x: +w.x.toFixed(2), z: +w.z.toFixed(2) },
        rows,
        slots: [0, 1, 2, 3, 4].map((i) => ch.queueSlotForIndex?.(i) ?? null),
      };
    });
    // joiners: first time we see somebody holding a slot, and where they were
    for (const r of s.rows) {
      if (!seenAt.has(r.id)) seenAt.set(r.id, { t: s.t, x: r.x, z: r.z });
      if (r.queued && r.slot != null && !joiners.has(r.id)) {
        const first = seenAt.get(r.id);
        joiners.set(r.id, {
          id: r.id, firstSlot: r.slot, atMs: Math.round(s.t - first.t),
          walked: +Math.hypot(r.x - first.x, r.z - first.z).toFixed(2),
        });
      }
    }
    const ids = new Set(s.rows.map((r) => r.id));
    for (const id of seenAt.keys()) {
      if (!ids.has(id) && !departures.find((d) => d.id === id)) departures.push({ id, t: s.t });
    }
    const q = s.rows.filter((r) => r.queued);
    if (!best || q.length > best.q.length) best = { ...s, q };
    if (q.length >= 3) break;
    await page.waitForTimeout(400);
  }
  out.waitedMs = Date.now() - t0;
  out.joiners = [...joiners.values()];
  out.queueDepth = best ? best.q.length : 0;
  if (!best || best.q.length < 2) { fail(`only ${out.queueDepth} in line after ${Math.round(out.waitedMs / 1000)} s — no queue to photograph`); }

  // ---- aim at the line and shoot -----------------------------------------
  if (best && best.q.length >= 2) {
    const head = best.slots[0];
    out.aim = await lookAt({ x: head.x, y: 1.0, z: head.z });
    await page.waitForTimeout(700);
    const shot = path.join(OUT, `b2-queue-${tag}.png`);
    await page.screenshot({ path: shot });
    out.screenshot = shot;
    if (!out.aim.ok) fail('could not frame the queue head — the screenshot may not show the line');

    // measure at the moment of the shot
    const geom = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const q = ch.customers().filter((c) => c.mesh && c.queued)
        .map((c) => ({
          id: c.customerId,
          slot: Number.isFinite(c.queueSlotHeld) ? c.queueSlotHeld : null,
          x: +c.mesh.position.x.toFixed(3),
          z: +c.mesh.position.z.toFixed(3),
        }))
        .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
      const s0 = ch.queueSlotForIndex(0);
      const s1 = ch.queueSlotForIndex(1);
      const ax = s1.x - s0.x;
      const az = s1.z - s0.z;
      const len = Math.hypot(ax, az) || 1;
      const ux = ax / len;
      const uz = az / len;
      return q.map((b, i) => ({
        ...b,
        lateralYd: +Math.abs((b.x - s0.x) * uz - (b.z - s0.z) * ux).toFixed(3),
        gapToPrevYd: i === 0 ? null : +Math.hypot(b.x - q[i - 1].x, b.z - q[i - 1].z).toFixed(3),
      }));
    });
    out.queueAtShot = geom;
    console.log('QUEUE', JSON.stringify(geom, null, 2));
  }

  // ---- keep watching for how they LEAVE ----------------------------------
  const EXODUS_MS = Number(process.env.QA_EXODUS_MS || 120000);
  const t1 = Date.now();
  while (Date.now() - t1 < EXODUS_MS) {
    const s = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      return {
        t: performance.now(),
        ids: ch.customers().map((c) => c.customerId),
        leaving: ch.customers().filter((c) => ['exit', 'gone'].includes(c.stops?.[c.stopIdx]?.kind)).length,
      };
    });
    const ids = new Set(s.ids);
    for (const id of seenAt.keys()) {
      if (!ids.has(id) && !departures.find((d) => d.id === id)) departures.push({ id, t: s.t });
    }
    for (const id of s.ids) if (!seenAt.has(id)) seenAt.set(id, { t: s.t });
    await page.waitForTimeout(400);
  }
  let worstBurst = 0;
  for (const d of departures) {
    worstBurst = Math.max(worstBurst, departures.filter((o) => Math.abs(o.t - d.t) < 3000).length);
  }
  out.result = {
    tag,
    queueDepthSeen: out.queueDepth,
    joiners: out.joiners,
    medianLateralYd: out.queueAtShot?.length
      ? +(out.queueAtShot.map((r) => r.lateralYd).sort((a, b) => a - b)[out.queueAtShot.length >> 1]).toFixed(3) : null,
    gaps: out.queueAtShot?.map((r) => r.gapToPrevYd).filter((x) => x != null) ?? [],
    departures: departures.length,
    worstDepartureBurst3s: worstBurst,
    screenshot: out.screenshot ?? null,
  };
  fs.writeFileSync(path.join(OUT, `b2-queue-${tag}.json`), JSON.stringify(out, null, 2));
  console.log('B2', JSON.stringify(out.result, null, 2));
  return out;
}
