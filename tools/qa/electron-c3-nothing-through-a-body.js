// C3 (Goal 24) — NOTHING CROSSES ANOTHER BODY, AND NOTHING IS HANDED OVER EARLY.
//
// "They hand goods THROUGH the body of the person being served, before their
// turn."
//
// The gate on placing goods was `counterQueue.indexOf(c) === 0` — a position in
// an ARRAY, not a position on the floor. Goal 23's own note on queue advancement
// says why those differ: the line advances when the FLOOR is clear, and the
// array advances the instant the served customer is spliced out. So the next
// person became "head of the queue" while still standing yards back, began
// reaching for the staging mat from there, and the product's flight — a straight
// line from wrist to counter — passed through whoever was still at the desk.
//
// THE MEASUREMENT IS GEOMETRIC AND DELIBERATELY NOT THE FIX'S OWN CONDITION.
// Asking "did anyone place while far from the desk" reads back the gate I just
// wrote, which proves the `if` runs. Instead this samples every in-flight
// product at ~20 Hz and measures its distance to the TORSO of every other
// customer in the room. A product that passes within a body radius of someone
// else has gone through them, whatever the queue array believed.
//
// THE SCENARIO HAS TO ADVANCE THE QUEUE, and the first version did not.
// Staging two shoppers and watching them is not enough: nobody serves the first,
// so the line never moves, the second never becomes head, and no product is ever
// placed early. That version measured 1.047 yd on the BROKEN build and 1.074 on
// the fixed one -- indistinguishable, and it would have shipped as proof. So the
// driver now plays customer one's sale to the bank, which is the only thing that
// makes customer two advance while the first body is still at the counter.
//
// CONTROLS:
//   1. flights must actually have been observed. Zero flights makes "no body was
//      crossed" true and meaningless.
//   2. two customers must have been in the queue AT THE SAME TIME. One customer
//      cannot pass a product through anybody.
//   3. the sampler must have seen the two bodies close enough for a crossing to
//      be possible at all — recorded as the closest the two people ever got.
//
// Records a clip. Frames are extracted and LOOKED AT; a number about a gesture
// is not evidence of the gesture.
//
//   VIDEO_DIR=qa/clips/c3-through-body node tools/qa/run-electron.cjs \
//     tools/qa/electron-c3-nothing-through-a-body.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c3-through-body');
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
  await page.waitForTimeout(3000);

  // Two shoppers, one behind the other. The second is the one whose goods used
  // to fly through the first.
  out.staged = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    app.speedIdx = 0;
    ch.setOrganicWalkins?.(false);
    if (app.state.shop) app.state.shop.open = true;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    for (const id of ['balls1', 'glove1', 'tees1']) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 12);
    }
    ch.rebuildStock();
    const first = ch.sendToCounter(['balls1', 'glove1'], 'card');
    const second = ch.sendToCounter(['tees1', 'balls1'], 'card');
    return { first, second, ok: !!first && !!second };
  });
  console.log('C3 staged', JSON.stringify(out.staged));
  if (!out.staged.ok) {
    fs.writeFileSync(path.join(OUT, 'through-body.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  // Stand where the counter is in frame, so the clip shows the gesture.
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
    w.pitch = -0.18;
  });

  // THE SAMPLER, in the page, at ~20 Hz. It runs across the whole visit so it
  // sees the handover moment, which is the one that matters and the one a
  // single snapshot always misses.
  await page.evaluate(([a, b]) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    window.__c3 = {
      samples: 0, flightSamples: 0, minItemToBody: Infinity, minBodyToBody: Infinity,
      worst: null, placedWhileBackOfTheLine: 0, bothQueuedSamples: 0,
    };
    const names = [a, b];
    window.__c3iv = setInterval(() => {
      const s = window.__c3;
      s.samples += 1;
      const people = names.map((n) => ch.customerByName(n)).filter(Boolean);
      if (people.length < 2) return;
      const [p, q] = people;
      const bodyGap = Math.hypot(
        p.mesh.position.x - q.mesh.position.x,
        p.mesh.position.z - q.mesh.position.z,
      );
      s.minBodyToBody = Math.min(s.minBodyToBody, bodyGap);
      if (p.queued && q.queued) s.bothQueuedSamples += 1;
      for (const owner of people) {
        const motion = owner.placeMotion;
        if (!motion || !owner.itemMeshes) continue;
        if (owner.mesh) {
          const hs = ch.queueHeadSlot ? ch.queueHeadSlot() : null;
          if (hs) {
            const back = Math.hypot(owner.mesh.position.x - hs.x, owner.mesh.position.z - hs.z);
            if (back > 0.8) s.placedWhileBackOfTheLine += 1;
          }
        }
        const mesh = owner.itemMeshes.get(motion.uid);
        if (!mesh) continue;
        mesh.updateWorldMatrix(true, false);
        const e = mesh.matrixWorld.elements;
        const item = { x: e[12], y: e[13], z: e[14] };
        s.flightSamples += 1;
        // "NEAR" IS NOT "THROUGH", and the first version could not tell them
        // apart. It measured the horizontal distance from the product to the
        // other person's origin and read 0.159 yd -- on a queue whose people
        // stand 0.6 yd apart, where the product passing close to the NEXT
        // person in line is simply what a counter looks like. It reported the
        // customer who was correctly at the desk as the offender.
        //
        // Passing THROUGH somebody means the body lies inside the corridor
        // between the hand that is placing and the product it is placing --
        // and BETWEEN them, not behind either end. So: distance from the body
        // to the segment owner->product, and the projection has to land inside
        // the segment.
        for (const other of people) {
          if (other === owner || !other.mesh) continue;
          const ax = owner.mesh.position.x; const az = owner.mesh.position.z;
          const vx = item.x - ax; const vz = item.z - az;
          const len2 = vx * vx + vz * vz;
          if (len2 < 1e-4) continue;
          const t = (((other.mesh.position.x - ax) * vx) + ((other.mesh.position.z - az) * vz)) / len2;
          if (t <= 0.15 || t >= 1) continue; // behind the hand, or past the product
          const cx = ax + vx * t; const cz = az + vz * t;
          const d = Math.hypot(other.mesh.position.x - cx, other.mesh.position.z - cz);
          if (d < s.minItemToBody) {
            s.minItemToBody = d;
            s.worst = {
              owner: owner.fullName, through: other.fullName,
              corridorDist: +d.toFixed(3), along: +t.toFixed(2), itemY: +item.y.toFixed(2),
            };
          }
        }
      }
    }, 50);
  }, [out.staged.first, out.staged.second]);

  // ---- SERVE CUSTOMER ONE, so the line actually moves ----------------------
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx.items.length >= 2;
  }, null, { timeout: 120000 }).catch(() => {});
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const clickItem = async (uid) => {
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
    if (!spot || !spot.ok) return false;
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(1500);
    return true;
  };
  const uids = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx ? tx.items.map((i) => i.uid) : [];
  });
  for (const uid of uids) await clickItem(uid);
  await page.waitForTimeout(2000);

  // play the card out, the way the B driver does -- the keypad is what banks it
  for (let i = 0; i < 26; i += 1) {
    const st = await page.evaluate(async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const r = window.__fw.scene3d.clubhouse().register;
      const pick = (fn) => { try { return fn ? fn() : null; } catch { return null; } };
      let card = null;
      const node = pick(r.cardNode);
      if (node) {
        const v = node.getWorldPosition(new THREE.Vector3());
        v.project(window.__fw.scene3d.camera);
        const rect = document.querySelector('canvas').getBoundingClientRect();
        card = {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((-v.y + 1) / 2) * rect.height,
          onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
        };
      }
      return {
        flow: r.getFlow?.()?.state ?? null, card,
        terminal: pick(r.cardTerminalScreenPoint), confirm: pick(r.cardXScreenPoint),
      };
    });
    if (!st.flow || st.flow === 'Done' || st.flow === 'Complete') break;
    if (st.flow === 'CardAmountEntry') {
      const keys = await page.evaluate(async () => {
        const r = window.__fw.scene3d.clubhouse().register;
        const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
        const tx = r.getTx();
        if (!tx) return null;
        const cents = String(Math.round(reg.totalOf(tx) * 100));
        const pt = (id) => { try { const p = r.cardKeyScreenPoint(id); return p ? { x: p.x, y: p.y } : null; } catch { return null; } };
        return { digits: cents.split('').map(pt), ok: pt('OK') };
      });
      if (keys) {
        for (const k of keys.digits) if (k) { await page.mouse.click(k.x, k.y); await page.waitForTimeout(150); }
        if (keys.ok) { await page.mouse.click(keys.ok.x, keys.ok.y); await page.waitForTimeout(900); }
      }
    } else {
      const t = (st.card && st.card.onScreen ? st.card : null) || st.terminal || st.confirm;
      if (t && Number.isFinite(t.x)) await page.mouse.click(t.x, t.y);
    }
    await page.waitForTimeout(800);
    const banked = await page.evaluate(() => (window.__fw.state.shop.transactionHistory || []).length > 0);
    if (banked) break;
  }
  out.servedFirst = await page.evaluate(() => (window.__fw.state.shop.transactionHistory || []).length > 0);
  console.log('C3 served-first', out.servedFirst);

  // NOW the queue advances. This window is the one the complaint is about.
  await page.waitForTimeout(45000);

  out.measured = await page.evaluate(() => {
    clearInterval(window.__c3iv);
    const s = window.__c3;
    return {
      samples: s.samples,
      flightSamples: s.flightSamples,
      bothQueuedSamples: s.bothQueuedSamples,
      minItemToBodyYd: Number.isFinite(s.minItemToBody) ? +s.minItemToBody.toFixed(3) : null,
      minBodyToBodyYd: Number.isFinite(s.minBodyToBody) ? +s.minBodyToBody.toFixed(3) : null,
      worst: s.worst,
      // how far from the head slot a placement was STARTED. Recorded, not
      // gated: it is the fix's own condition and proves the `if` ran, not that
      // a body was missed.
      placedWhileBackOfTheLine: s.placedWhileBackOfTheLine,
    };
  });
  console.log('C3 measured', JSON.stringify(out.measured));

  // KNOWN LIMITATION OF THIS INSTRUMENT, stated rather than hidden.
  //
  // `placeMotion` is only cleared when a product LANDS. When the gate below
  // holds a placement back mid-sequence, the last motion stays on the customer
  // and this sampler goes on treating a stationary product as "in flight". So a
  // frozen item that somebody later walks past reads exactly like an item that
  // flew through them, and `nothingPassedThroughABody` cannot yet tell the two
  // apart. It scores 0.026 yd on the fixed build and on the broken one.
  //
  // The check is therefore NOT evidence that C3 is fixed and is left failing.
  // What it did establish, twice, on every run: the two queue positions are
  // 0.600 yd apart, and a person is about 0.45 yd across the shoulders. The
  // people in this line are nearly touching, which is very likely a large part
  // of what "handing goods through the person in front" looks like from the
  // player's side, and is a separate thing to fix.
  //
  // A person is about 0.45 yd across the shoulders; half of that is the radius a
  // product must stay outside of to have missed them.
  const BODY_RADIUS_YD = 0.28;
  out.checks = {
    // CONTROL 1
    flightsObserved: (out.measured.flightSamples ?? 0) >= 10,
    // CONTROL 2
    twoInTheQueueTogether: (out.measured.bothQueuedSamples ?? 0) >= 20,
    // CONTROL 4: the queue MUST have advanced, or the second customer never
    // becomes head and the situation under test never happens
    firstCustomerWasServed: out.servedFirst === true,
    // CONTROL 3: they were close enough that a crossing was possible
    bodiesCameCloseEnoughToCross: (out.measured.minBodyToBodyYd ?? 99) < 2.5,
    // THE CLAIM
    nothingPassedThroughABody: (out.measured.minItemToBodyYd ?? 99) > BODY_RADIUS_YD,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'through-body.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('C3-BODY', JSON.stringify({ measured: out.measured, checks: out.checks }, null, 2));
  return out;
}
