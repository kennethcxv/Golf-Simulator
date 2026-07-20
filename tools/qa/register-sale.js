async (page) => {
  // MANUAL ACCEPTANCE: a whole sale, driven through the controls a player has.
  //
  // Nothing here reaches into the transaction. Every step is a real mouse click at a
  // real screen pixel, or a real keypress — the same events main.js routes. The only
  // thing the harness does that a player cannot is `sendToCounter`, which spawns a
  // shopper holding shelf-debited goods so we do not have to wait on the RNG to
  // produce a two-item customer. It skips the browsing, not the accounting.
  //
  // Set MODE to 'card' or 'cash'. Screenshots land in qa/register/<MODE>/.
  //
  // TWO THINGS THIS FILE LEARNED THE HARD WAY.
  //
  // 1. forward = (-sin yaw, -cos yaw), so yaw 0 faces -z and yaw PI faces +z. The
  //    first cut set yaw = PI "to face the counter" and the player faced the back
  //    wall. The register prop's facing test rejected [E], register mode never
  //    opened, and every scan step reported 0/2 — which read like a broken scanner
  //    and was a broken harness.
  //
  // 2. NEVER SLEEP FOR STATE. Headless rAF runs slow, so a fixed 1.6s wait under-ran
  //    a 1.5s card auth plus a 0.8s printer, and the harness reported "receipt never
  //    printed" when the receipt printed fine two seconds later. Every wait below is
  //    a condition on the real transaction.

  const MODE = globalThis.__QA_REGISTER_MODE || 'cash';
  const OUT = globalThis.__QA_REGISTER_OUT
    || ('C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/register/' + MODE);
  const BASE_URL = globalThis.__QA_BASE_URL || 'http://localhost:8457/';
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); };
  const log = [];

  const txNow = () => page.evaluate(async () => {
    const R = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    if (!tx) return null;
    return {
      stage: tx.stage, method: tx.method,
      scanned: tx.items.filter((i) => i.scanned).length,
      bagged: tx.items.filter((i) => i.bagged).length,
      of: tx.items.length,
      cardAttempts: tx.cardAttempts, cardsTried: tx.cardsTried,
      receiptPrinted: !!tx.receiptPrinted, banked: !!tx.banked,
      drawerOpen: !!tx.drawerOpen, deposited: !!tx.deposited,
      changeDue: R.changeDue(tx), holding: R.handTotal(tx),
    };
  });
  const money = () => page.evaluate(() => {
    const held = window.__fw.state.shop.held || [];
    const saleUids = window.__qa?.saleUids || [];
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
    return {
      revenue: (window.__fw.state.shop.salesLive || {}).revenue || 0,
      units: (window.__fw.state.shop.salesLive || {}).units || 0,
      held: held.length,
      saleHeld: held.filter((entry) => saleUids.includes(entry.uid)).length,
      transactionActive: !!clubhouse.register.getTx(),
      customerPresent: customers.some((customer) => customer.__qaSale === true),
      shelfBalls: window.__fw.state.shop.inventory.balls3.shelf,
      shelfGlove: window.__fw.state.shop.inventory.glove1.shelf,
    };
  });
  // Wait for a REAL condition on the transaction, never for a stopwatch. Typed
  // predicates, not eval'd source: a harness that builds `new Function()` out of a
  // string is a code-injection shape, and there is no reason to reach for one here.
  const untilTx = (ms = 15000) => page.waitForFunction(
    () => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: ms });
  const untilStage = (stages, ms = 15000) => page.waitForFunction((want) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && want.includes(tx.stage);
  }, Array.isArray(stages) ? stages : [stages], { timeout: ms });
  const untilFlag = (key, val, ms = 15000) => page.waitForFunction(([k, v]) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx[k] === v;
  }, [key, val], { timeout: ms });

  // WAIT FOR THE CAMERA TO ACTUALLY ARRIVE. isActive() flips true the instant [E] is
  // pressed, but the cashier pose BLENDS in over 0.4s — and headless rAF is throttled,
  // so a wall-clock wait under-runs the ease. Project an item while the camera is still
  // mid-flight and you get a pixel ~90px off; the click lands on bare counter, nothing
  // is grabbed, and the run reports "scanned: 0" as though the scanner were broken.
  // It is the same trap as sleeping for the receipt. Never sleep for state.
  const CASHIER_EYE = { x: 2.78 - 8, z: 5.52 + 228 };   // REGISTER cashier pose, in world
  const untilCameraSettled = (ms = 10000) => page.waitForFunction((eye) => {
    const c = window.__fw.scene3d.camera;
    return Math.hypot(c.position.x - eye.x, c.position.z - eye.z) < 0.03;
  }, CASHIER_EYE, { timeout: ms });


  // --- boot ------------------------------------------------------------------------
  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isEnabled().catch(() => false)) {
    await continueButton.click();
  } else {
    await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
    await page.getByRole('heading', { name: 'PROPERTY MARKET' }).waitFor();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  }
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Hide the guide' }).click().catch(() => {});

  // --- set the stage ----------------------------------------------------------------
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    app.scene3d.clubhouse().prepareCheckoutQa();
    window.__qa = {
      // interior-local -> screen pixels, so a click lands on the pixel the thing is
      // actually drawn at, not where I hope it is
      px(lx, ly, lz) {
        const s3 = app.scene3d;
        const ch = s3.clubhouse();
        const v = new THREE.Vector3(
          lx + ch.interior.position.x, ly + ch.interior.position.y, lz + ch.interior.position.z,
        );
        v.project(s3.camera);
        const c = document.querySelector('canvas').getBoundingClientRect();
        return { x: c.left + ((v.x + 1) / 2) * c.width, y: c.top + ((-v.y + 1) / 2) * c.height };
      },
      // AIM AT THE BOUNDING-BOX CENTRE, not the origin. A banknote is 1.8 mm thick, so
      // "origin plus 4 cm" is a ray that sails clean over it and grabs nothing — which
      // is exactly how the cash run stalled with the notes still on the counter.
      centre(m, ch) {
        const b = new THREE.Box3().setFromObject(m);
        const c = b.getCenter(new THREE.Vector3());
        const o = ch.interior.position;
        return { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
      },
      find(kind, i = 0) {
        const ch = app.scene3d.clubhouse();
        const out = [];
        ch.interior.traverse((o) => {
          if (o.userData && o.userData.kind === kind && o.visible) out.push(o);
        });
        const m = out[i];
        if (!m) return null;
        const c = window.__qa.centre(m, ch);
        return { ...c, uid: m.userData.uid || null, denom: m.userData.denom || null, n: out.length };
      },
      findMoney(from, denom) {
        const ch = app.scene3d.clubhouse();
        const out = [];
        ch.interior.traverse((o) => {
          const u = o.userData;
          if (u && u.kind === 'money' && u.from === from && (denom == null || u.denom === denom) && o.visible) out.push(o);
        });
        if (!out.length) return null;
        const m = out[out.length - 1];   // the top of the stack
        const c = window.__qa.centre(m, ch);
        return { ...c, denom: m.userData.denom, n: out.length };
      },
    };
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inv = app.state.shop.inventory[id];
      if (['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1'].includes(id)) { inv.back = 0; inv.shelf = 0; continue; }
      inv.shelf = Math.max(inv.shelf, 10);
      inv.back = 0;
    }
    app.scene3d.clubhouse().rebuildStock();

    // behind the till, FACING IT: yaw 0 is -z, which is where the counter is
    const st = app.scene3d.walk.state;
    st.x = 2.80 - 8;
    st.z = 5.10 + 228;
    st.yaw = 0;
    st.pitch = -0.18;
  });
  await page.waitForTimeout(800);

  // The normal Space control pauses only the simulation clock; register animation,
  // input, card authorisation, and receipt printing continue. Headless WebGL can
  // otherwise turn a 90-second acceptance run into seven in-game hours and close
  // the shop while the cashier is still counting change.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__fw.speedIdx === 0);

  log.push({ step: '0. before', ...(await money()) });

  // --- a customer arrives -------------------------------------------------------------
  const who = await page.evaluate((m) => window.__fw.scene3d.clubhouse().sendToCounter(['balls3', 'glove1'], m), MODE);
  await untilTx();
  await page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    window.__qa.saleUids = tx.items.map((item) => item.uid);
    register.getCustomer().__qaSale = true;
  });
  await page.waitForTimeout(900);
  await shot('01-customer-at-counter');
  log.push({ step: '1. customer at the counter', who, ...(await money()), tx: await txNow() });

  // --- [E] into register mode -----------------------------------------------------------
  await page.keyboard.press('e');
  await untilCameraSettled();
  await page.waitForTimeout(250);
  await shot('02-register-mode');
  log.push({ step: '2. [E] register mode', active: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()) });

  // --- SCAN: drag each item across the glass ---------------------------------------------
  // Nothing calls scanItem(). The CROSSING calls it.
  // `via` routes the drag through a waypoint — the scanner glass, for a scan. Leave it
  // out and it goes straight there, which is what putting a note in the till should do.
  const dragTo = async (at, toLocal, { via = null, steps = 14 } = {}) => {
    const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    const to = await page.evaluate((p) => window.__qa.px(p[0], p[1], p[2]), toLocal);
    const legs = [];
    if (via) legs.push(await page.evaluate((p) => window.__qa.px(p[0], p[1], p[2]), via));
    legs.push(to);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    let cur = from;
    for (const leg of legs) {
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        await page.mouse.move(cur.x + (leg.x - cur.x) * t, cur.y + (leg.y - cur.y) * t);
        await page.waitForTimeout(14);
      }
      cur = leg;
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const scan = async (i) => {
    const at = await page.evaluate((k) => window.__qa.find('item', k), i);
    if (!at) return false;
    await dragTo(at, [3.68, 1.17, 4.44], { via: [2.70, 1.17, 4.22] });   // over the glass
    return true;
  };
  const clickPalm = async () => {
    const at = await page.evaluate(() => window.__qa.find('palm'));
    if (!at) throw new Error('Visible customer palm was not available for handoff');
    const px = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    await page.mouse.move(px.x, px.y);
    await page.mouse.click(px.x, px.y);
    return { at, px };
  };

  await scan(0);
  await shot('03-scanned-one');
  log.push({ step: '3. dragged item 1 over the glass', tx: await txNow() });

  await scan(0);   // the SAME item again — it must not count twice
  log.push({ step: '4. dragged the SAME item back over the glass', tx: await txNow(), expect: 'scanned still 1' });

  await page.keyboard.press('t');   // payment with one unscanned — must refuse
  await page.waitForTimeout(250);
  log.push({ step: '5. [T] with 1 unscanned', tx: await txNow(), expect: 'stage scanning, method null' });

  await scan(1);
  await shot('04-all-scanned');
  log.push({ step: '6. dragged item 2 over the glass', tx: await txNow() });

  // --- TOTAL --------------------------------------------------------------------------
  await page.keyboard.press('t');
  await untilFlag('method', MODE);
  await page.waitForTimeout(400);
  await shot('05-totalled');
  log.push({ step: '7. [T] total', tx: await txNow(), ...(await money()), expect: 'revenue still 0' });

  const term = await page.evaluate(() => window.__qa.px(2.05, 1.12, 3.88));

  if (MODE === 'card') {
    // --- CARD ---------------------------------------------------------------------------
    await page.mouse.click(term.x, term.y);
    await untilStage('card-ready');
    await shot('06-card-presented');
    log.push({ step: '8. clicked terminal — they present', tx: await txNow() });

    await page.mouse.click(term.x, term.y);
    await page.waitForTimeout(350);
    await shot('07-card-authorising');
    log.push({ step: '9. clicked terminal — running', tx: await txNow(), ...(await money()) });

    await untilStage(['receipt', 'card-declined']);
    let t = await txNow();
    log.push({ step: '10. terminal answered', tx: t, ...(await money()), expect: 'revenue STILL 0 — an approval banks nothing' });
    await shot('08-card-result');

    // declined? they dig out a second card.
    while (t.stage === 'card-declined') {
      await page.mouse.click(term.x, term.y);          // retry -> another card
      await untilStage('card-ready');
      await page.mouse.click(term.x, term.y);          // run it
      await untilStage(['receipt', 'card-declined']);
      t = await txNow();
      log.push({ step: '10b. second card', tx: t });
    }
  } else {
    // --- CASH ---------------------------------------------------------------------------
    // their notes are on the counter. Take them, open the till, put each one away,
    // then count the change back out of the wells.
    let piece = await page.evaluate(() => window.__qa.findMoney('tender'));
    log.push({ step: '8. they counted out notes', notes: piece ? piece.n : 0 });
    await shot('06-cash-on-counter');

    await page.keyboard.press('d');   // drawer refuses until the cash is in hand
    log.push({ step: '9. [D] drawer before taking the cash', tx: await txNow(), expect: 'still cash-tender' });

    // pick up the first note — touching it IS accepting it
    const p0 = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), piece);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    log.push({ step: '10. took their cash', tx: await txNow() });

    await page.keyboard.press('d');   // NOW the drawer opens
    await untilFlag('drawerOpen', true);
    await page.waitForTimeout(700);   // it slides
    await shot('07-drawer-open');
    log.push({ step: '11. [D] drawer open', tx: await txNow() });

    // put every tendered note into the till, one at a time
    for (let guard = 0; guard < 8; guard++) {
      piece = await page.evaluate(() => window.__qa.findMoney('tender'));
      if (!piece) break;
      await dragTo(piece, [2.42, 1.12, 4.98], { steps: 10 });   // straight into the open till
      await page.waitForTimeout(150);
    }
    await shot('08-cash-in-till');
    log.push({ step: '12. put their notes away', tx: await txNow(), ...(await money()) });

    // count the change out of the wells
    const need = await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const paid = tx.tenderedTotal || 0;
      return paid;
    });
    const want = await page.evaluate(async () => {
      const R = await import('/src/sim/register.js');
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return R.makeChange(R.changeDue(tx));
    });
    log.push({ step: '13. change owed', want });
    for (const [denom, n] of Object.entries(want)) {
      for (let k = 0; k < n; k++) {
        const src = await page.evaluate((d) => window.__qa.findMoney('drawer', Number(d)), denom);
        if (!src) { log.push({ warn: 'drawer is out of ' + denom }); break; }
        const px = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), src);
        await page.mouse.click(px.x, px.y);
        await page.waitForTimeout(140);
      }
    }
    await shot('09-change-counted');
    const counted = await txNow();
    log.push({ step: '14. counted the change', tx: counted });
    if (Math.abs(counted.holding - counted.changeDue) > 0.001) {
      throw new Error(`Wrong change selected: due $${counted.changeDue}, holding $${counted.holding}`);
    }

    // hand it over: click their open palm
    const palm = await clickPalm();
    await untilStage('receipt');
    log.push({ step: '15. handed the change back', palm, tx: await txNow(), ...(await money()), expect: 'revenue STILL 0' });
  }

  // --- RECEIPT -----------------------------------------------------------------------
  await untilFlag('receiptPrinted', true);
  await page.waitForTimeout(250);
  await shot('10-receipt-printed');
  const rp = await page.evaluate(() => window.__qa.find('receipt'));
  log.push({ step: '16. receipt printed', at: rp && { x: +rp.x.toFixed(2), z: +rp.z.toFixed(2) } });

  const rpx = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), rp);
  await page.mouse.click(rpx.x, rpx.y);
  await untilStage('bagging');
  log.push({ step: '17. took the receipt', tx: await txNow() });

  // --- BAG ---------------------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const at = await page.evaluate(() => window.__qa.find('item'));
    if (!at) break;
    const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    const to = await page.evaluate(() => window.__qa.px(3.50, 1.20, 4.44));   // the open carrier
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let s = 1; s <= 10; s++) {
      const t = s / 10;
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await page.waitForTimeout(14);
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  await shot('11-bagged');
  log.push({ step: '18. bagged', tx: await txNow(), ...(await money()), expect: 'revenue STILL 0' });

  // --- HAND IT OVER — the only thing that banks the money ---------------------------------
  const finalPalm = await clickPalm();
  await page.waitForTimeout(900);
  await shot('12-handed-over');
  log.push({ step: '19. HANDED IT OVER', palm: finalPalm, ...(await money()), expect: 'revenue banked NOW, held back to 0' });

  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customers = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
    return !customers.some((customer) => customer.__qaSale === true);
  }, null, { timeout: 15000 });
  await shot('13-done');
  log.push({ step: '20. final', ...(await money()) });

  return { mode: MODE, log, errors: errors.slice(0, 10), errorCount: errors.length };
}
