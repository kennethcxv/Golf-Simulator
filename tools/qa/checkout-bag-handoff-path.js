// C4 — "IT PHASES THROUGH THE DESK. ROUTE IT OVER." plus "the customer still
// LIFTS their hands — the bag goes to their LOWER hand, taken at hip height."
//
// Runs one real card sale at 1x and samples the bag's world AABB every
// animation frame across the whole handoff, against the counter's own box. The
// number that matters is how far the bag's lowest point sits BELOW the counter
// top while its footprint is still over the counter — that is the penetration a
// player reads as phasing.
//
// Negative control: the same sampler runs over the STAGED bag first, while it
// rests on the counter top. It must report ~0 sink there. A sampler that finds
// penetration in a bag sitting on the counter is measuring the wrong box, and
// nothing after it can be believed.
//
// Second measurement, separate from the first: the height of the receiving hand
// and of the bag when the beat ends, against the customer's own hip and
// shoulder. "Taken at hip height" is not the same claim as "does not phase" and
// one number cannot answer both.
async (page) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/checkout-bag-handoff');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const startBtn = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await startBtn.isVisible({ timeout: 1500 }).catch(() => false)) await startBtn.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1200);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);

  await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import('/src/data/shopLayout.js');
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      if (skuIds.includes(id)) {
        app.state.shop.inventory[id].shelf = Math.max(app.state.shop.inventory[id].shelf, 12);
      }
    }
    app.speedIdx = 0;                      // 1x — this is a customer beat
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
    clubhouse.sendToCounter(skuIds, 'card');
  }, [SKUS]);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 40000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const prices = [6.90, 9.20, 19.62];
    tx.items.forEach((item, index) => {
      item.price = prices[index];
      item.priceCents = Math.round(prices[index] * 100);
    });
    tx.rng = () => 0.9;   // approves
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1500);

  // The sampler, installed in the page so it can run per animation frame.
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { COUNTER, COUNTER_TOP, FRONT_DESK_FRAME, frontDeskLocalPoint } = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    // The counter's footprint from the LAYOUT DATUM, not from a mesh name. The
    // first pass hunted for a mesh called something like "checkout_counter",
    // found nothing, and silently sampled zero rows — a name search that misses
    // fails as "no data", which reads exactly like "no penetration".
    const counterTopWorld = clubhouse.interior.position.y + COUNTER_TOP;
    const counterBox = (() => {
      const half = new THREE.Vector2(COUNTER.len / 2, COUNTER.depth / 2);
      const c = Math.cos(COUNTER.ry || 0);
      const s = Math.sin(COUNTER.ry || 0);
      const box = new THREE.Box3();
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = sx * half.x;
          const lz = sz * half.y;
          box.expandByPoint(clubhouse.interior.localToWorld(new THREE.Vector3(
            COUNTER.x + lx * c + lz * s,
            counterTopWorld - clubhouse.interior.position.y,
            COUNTER.z - lx * s + lz * c,
          )));
        }
      }
      box.min.y = counterTopWorld - 1.2;
      box.max.y = counterTopWorld;
      return box;
    })();
    const findBag = () => {
      let hit = null;
      clubhouse.interior.traverse((o) => {
        if (hit || !o.visible) return;
        if (o.userData?.checkoutOwner && /bag/i.test(o.name || '')) hit = o;
        else if (/checkout-shopping_bag|CheckoutBag|PaidBag/i.test(o.name || '')) hit = o;
      });
      if (hit) return hit;
      const c = register.getCustomer && register.getCustomer();
      return (c && c.bagMesh) || null;
    };
    window.__c4 = { samples: [], counterTopWorld, running: false, ticks: 0, bagTicks: 0,
      frontDepthHalf: +(FRONT_DESK_FRAME.frontDepth / 2).toFixed(3),
      counterVsFrame: {
        counter: [+COUNTER.x.toFixed(3), +COUNTER.z.toFixed(3)],
        frame: [+FRONT_DESK_FRAME.x.toFixed(3), +FRONT_DESK_FRAME.z.toFixed(3)],
        counterDepth: +COUNTER.depth.toFixed(3),
      },
      counterBox: counterBox ? { min: counterBox.min.toArray(), max: counterBox.max.toArray() } : null };
    const scratch = new THREE.Vector3();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!window.__c4.running) return;
      // COUNT THE TICK BEFORE ANYTHING CAN BAIL. "no frames" and "no bag" are
      // different failures and the control has to tell them apart — the first
      // version of this conflated them and reported a still page when the truth
      // was that the carrier had not been built yet.
      window.__c4.ticks += 1;
      const bag = findBag();
      if (!bag) return;
      window.__c4.bagTicks += 1;
      const box = new THREE.Box3().setFromObject(bag);
      if (box.isEmpty() || !counterBox) return;
      // "over the counter" is a PLAN overlap. A bag hanging past the front edge
      // is entitled to be low; a bag below the top with its footprint still on
      // the slab is inside it.
      const overCounter = box.max.x > counterBox.min.x && box.min.x < counterBox.max.x
        && box.max.z > counterBox.min.z && box.min.z < counterBox.max.z;
      const cust = register.getCustomer && register.getCustomer();
      const rig = cust && cust.mesh;
      const nodeY = (name) => {
        const n = rig && rig.getObjectByName(name);
        return n ? +n.getWorldPosition(scratch).y.toFixed(3) : null;
      };
      window.__c4.samples.push({
        ms: Math.round(performance.now()),
        phase: register.deliveryPhase ? register.deliveryPhase() : null,
        stage: register.getTx() ? register.getTx().stage : null,
        minY: +box.min.y.toFixed(4),
        maxY: +box.max.y.toFixed(4),
        overCounter,
        sink: overCounter ? +(counterTopWorld - box.min.y).toFixed(4) : 0,
        // the bag's own desk-local z, so the sampler's plan test and the
        // renderer's clamp can be compared instead of assumed to agree
        bagLocalZ: (() => {
          const c2 = box.getCenter(new THREE.Vector3());
          const l = clubhouse.interior.worldToLocal(c2.clone());
          return +frontDeskLocalPoint(l.x, l.z).z.toFixed(3);
        })(),
        gripL: nodeY('CarryGripL'),
        // Height fractions off the character's OWN standing height, so "hip
        // height" survives a taller customer. limbs.hipL has no Object3D name;
        // characterRoot and headJoint do.
        rootY: nodeY('characterRoot'),
        headY: nodeY('headJoint'),
        gripR: nodeY('CarryGripR'),
        hipL: nodeY('hipL'),
        shoulderL: nodeY('shoulderL'),
        // desk-local z of the receiving grip: negative is the customer side of
        // the counter, and |z| under frontDepth/2 means the hand is still OVER
        // the slab, where a bag hanging from it must intersect it
        gripLocalZ: (() => {
          const n = rig && rig.getObjectByName('CarryGripL');
          if (!n) return null;
          const w2 = n.getWorldPosition(new THREE.Vector3());
          const l = clubhouse.interior.worldToLocal(w2.clone());
          return +frontDeskLocalPoint(l.x, l.z).z.toFixed(3);
        })(),
      });
    };
    requestAnimationFrame(loop);
  });

  // ---- ring up, pay by card ------------------------------------------------
  const projectObject = (query) => page.evaluate(async (q) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    let found = null;
    app.scene3d.clubhouse().interior.traverse((o) => {
      if (found || !o.visible || !o.userData) return;
      if (q.uid && o.userData.uid !== q.uid) return;
      if (q.kind && o.userData.kind !== q.kind) return;
      found = o;
    });
    if (!found) return null;
    const b = new THREE.Box3().setFromObject(found);
    const w = b.isEmpty() ? found.getWorldPosition(new THREE.Vector3()) : b.getCenter(new THREE.Vector3());
    w.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((w.x + 1) / 2) * rect.width,
      y: rect.top + ((-w.y + 1) / 2) * rect.height,
      inView: w.z >= -1 && w.z <= 1 && Math.abs(w.x) <= 1 && Math.abs(w.y) <= 1,
    };
  }, query);

  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid)));
  for (const uid of uids) {
    let point = await projectObject({ kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject({ kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
        point = next; break;
      }
      point = next;
    }
    assert(point && point.inView, `item ${uid} is not in frame`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((c) => c.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 15000 });
  }
  await shot('01-rung-up.png');

  // ---- negative control: the loaded carrier, resting on the counter --------
  // Run AFTER bagging, because the carrier does not exist before it. It sits ON
  // the top here, so a sampler that agrees with reality reports ~0 sink; if it
  // reports penetration now it is measuring the wrong box.
  await page.evaluate(() => { window.__c4.running = true; });
  await page.waitForTimeout(1200);
  const control = await page.evaluate(() => {
    const s = window.__c4.samples.splice(0);
    return {
      ticks: window.__c4.ticks,
      bagTicks: window.__c4.bagTicks,
      frames: s.length,
      maxSink: s.reduce((m, r) => Math.max(m, r.sink), 0),
      counterBox: window.__c4.counterBox,
      restingMinY: s.length ? s[s.length - 1].minY : null,
      counterTopWorld: window.__c4.counterTopWorld,
    };
  });
  assert(control.ticks > 20,
    `NEGATIVE CONTROL FAILED: ${control.ticks} animation frames — the page is not animating.`);
  assert(control.frames > 20,
    `NEGATIVE CONTROL FAILED: the page ticked ${control.ticks} times but the sampler found a bag `
    + `on ${control.bagTicks} of them — the bag lookup is wrong, not the page.`);
  assert(control.counterBox, 'NEGATIVE CONTROL FAILED: no counter box, so "over the counter" is meaningless.');
  assert(control.maxSink <= 0.02,
    `NEGATIVE CONTROL FAILED: the carrier RESTING on the counter already reads ${control.maxSink} yd `
    + 'below the top, so the sink measurement is not measuring penetration.');

  await page.waitForFunction(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    return r.getTx()?.stage === 'card-ready' && r.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot('02-card-entry.png');
  for (const key of ['3', '8', '2', '2']) await page.keyboard.press(key);
  await page.keyboard.press('Enter');

  // ---- the handoff itself --------------------------------------------------
  await page.waitForFunction(() => (
    ['receipt', 'bagging', 'done'].includes(window.__fw.scene3d.clubhouse().register.getTx()?.stage)
  ), null, { timeout: 40000 });
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'bag-deliver'
  ), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
  await shot('03-handoff-mid.png');
  await page.waitForFunction(() => {
    const p = window.__fw.scene3d.clubhouse().register.deliveryPhase();
    return p === 'bag-customer-hold' || p === 'released';
  }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot('04-customer-holds-bag.png');
  await page.waitForTimeout(2500);
  await shot('05-after-release.png');

  const run = await page.evaluate(() => {
    const s = window.__c4.samples.slice();
    window.__c4.running = false;
    const deliver = s.filter((r) => r.phase === 'bag-deliver');
    const over = deliver.filter((r) => r.overCounter);
    const worst = over.reduce((m, r) => (r.sink > (m ? m.sink : -1) ? r : m), null);
    const held = s.filter((r) => r.phase === 'bag-customer-hold');
    const last = held[held.length - 1] || s[s.length - 1] || null;
    return {
      frames: s.length,
      deliverFrames: deliver.length,
      framesOverCounter: over.length,
      worstSinkYd: worst ? worst.sink : 0,
      worstSample: worst,
      phasesSeen: [...new Set(s.map((r) => r.phase))],
      frontDepthHalf: window.__c4.frontDepthHalf,
      counterVsFrame: window.__c4.counterVsFrame,
      atHold: last ? {
        bagMinY: last.minY,
        gripLocalZ: last.gripLocalZ,
        bagMaxY: last.maxY,
        bagCentreY: +((last.minY + last.maxY) / 2).toFixed(3),
        gripL: last.gripL, rootY: last.rootY, headY: last.headY,
        gripHeightFraction: (last.gripL != null && last.rootY != null && last.headY != null)
          ? +((last.gripL - last.rootY) / Math.max(0.01, last.headY - last.rootY)).toFixed(3) : null,
      } : null,
    };
  });

  const report = {
    control: { frames: control.frames, maxSinkYd: control.maxSink },
    run,
    // ACCEPTANCE 1 — nothing of the bag may be under the counter while its
    // footprint is still on it. 0.02 yd (18 mm) is render tolerance, not slack.
    phasesThroughDesk: run.worstSinkYd > 0.02,
    // ACCEPTANCE 2 — the receiving hand is at the hip, not raised toward the
    // shoulder. Measured as a fraction of the customer's own hip->shoulder span,
    // so it survives a different character height.
    // A standing adult's hip sits near 0.52 of their own height and the
    // shoulder near 0.82. Anything at or under ~0.60 is a hand at the hip.
    receivingHandAtHip: run.atHold && run.atHold.gripHeightFraction != null
      ? run.atHold.gripHeightFraction <= 0.60 : null,
  };
  fs.writeFileSync(path.join(OUT, 'bag-handoff-path.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
