async (page) => {
  // THE PHYSICAL LOOP, PROVEN THROUGH THE RUNNING GAME with real key presses. Rather than guess
  // where a box stacked, I place one at a known spot in the stockroom and stand facing it, then
  // drive the whole chain: press E tears the tape -> press E folds the other flap pair -> press E
  // takes an armful into the arms -> carry to the ball wall -> HOLD E stocks it. The sim is
  // checked at every step and the console must stay clean.
  // (Ported off the box-cutter equip/hold-E-cut choreography 2026-07-30 — the tool was deleted;
  // cartons open in three presses with no equip. tools/qa/proshop-box-open-loop.js owns the
  // gesture-contract claims; this driver owns the delivery->stock chain around it.)
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  const OUT = path.resolve(process.env.MANAGEMENT_STOCK_QA_ROOT
    || path.join(process.cwd(), 'qa', 'delivery'));
  fs.mkdirSync(OUT, { recursive: true });
  const log = [];

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(1500);

  const goTo = async (lx, lz, yaw, pitch = -0.1) => {
    await page.evaluate((p) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = p.lx + o.x; w.z = p.lz + o.z; w.yaw = p.yaw; w.pitch = p.pitch;
    }, { lx, lz, yaw, pitch });
    await page.waitForTimeout(350);
  };
  const focus = () => page.evaluate(() => ({
    label: window.__fw.scene3d.walk.getFocusLabel(),
    tool: window.__fw.scene3d.walk.getTool(),
  }));
  const ballBox = () => page.evaluate(async () => {
    const del = await import('/src/sim/deliveries.js');
    const b = del.boxesOf(window.__fw.state).find((x) => x.skuId === 'balls1');
    return b ? { loc: b.loc, tape: b.tape, flaps: b.flaps, qty: b.qty, flat: b.flat } : null;
  });
  const hands = () => page.evaluate(async () => {
    const s = await import('/src/sim/stocking.js');
    const c = s.carriedGoods(window.__fw.state);
    return c ? { skuId: c.skuId, qty: c.qty } : null;
  });

  // First a busy pad JUST for the screenshot — a real mixed delivery, several kinds of carton.
  await page.evaluate(async () => {
    const shop = await import('/src/sim/shop.js');
    const st = window.__fw.state;
    st.cash = 200000; st.shop.unlockedTier = 3;
    st.shop.inventory.balls1.shelf = 0;
    for (const [id, q] of [['driver1', 3], ['polo1', 10], ['bag1', 2], ['tees1', 20], ['light1', 1]]) {
      const r = shop.placeOrder(st, id, q);
      const o = st.shop.orders[st.shop.orders.length - 1];
      for (let i = 0; i < 6 && st.shop.orders.includes(o); i++) shop.tickDeliveries(st, o.deliveryMin + 1);
    }
    window.__fw.scene3d.clubhouse().rebuildBoxes();
  });
  await page.waitForFunction(() => {
    const stage = window.__fw?.scene3d?.scene?.getObjectByName('DeliveryPalletStage');
    return stage?.userData?.ready === true
      && Array.from({ length: 5 }, (_, index) => (
        stage.getObjectByName(`DeliveryPallet_${index + 1}`)
      )).every(Boolean);
  }, null, { timeout: 60000 });
  const receivingOverview = await page.evaluate(async () => {
    const S = await import('/src/data/deliveryStaging.js');
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const slab = app.scene3d.scene.getObjectByName('DeliveryReceivingSlab');
    if (!slab) return null;
    slab.updateWorldMatrix(true, true);
    const centre = slab.getWorldPosition(slab.position.clone());
    const apron = S.DELIVERY_PALLET_STAGING.receivingApron;
    // This is the ref-44 validated diagonal overview, scaled from the live
    // receiving-apron dimensions and anchored to its rendered centre.
    const yaw = 0.83;
    const distance = Math.max(4.60, Math.hypot(apron.length, apron.width) * 0.90);
    return {
      x: centre.x - origin.x + Math.sin(yaw) * distance,
      z: centre.z - origin.z + Math.cos(yaw) * distance,
      yaw,
      pitch: -0.30,
      target: {
        x: +(centre.x - origin.x).toFixed(4),
        z: +(centre.z - origin.z).toFixed(4),
      },
      apron: { ...apron },
    };
  });
  if (!receivingOverview) throw new Error('Cannot derive the five-pallet receiving-apron overview.');
  await goTo(
    receivingOverview.x,
    receivingOverview.z,
    receivingOverview.yaw,
    receivingOverview.pitch,
  );
  const overviewFraming = await page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    const camera = window.__fw.scene3d.camera;
    camera.updateWorldMatrix(true, false);
    camera.updateProjectionMatrix();
    return Array.from({ length: 5 }, (_, index) => {
      const anchor = scene.getObjectByName(`DeliveryPallet_${index + 1}`);
      if (!anchor) return { name: `DeliveryPallet_${index + 1}`, exists: false };
      anchor.updateWorldMatrix(true, false);
      const ndc = anchor.getWorldPosition(anchor.position.clone()).project(camera);
      return {
        name: anchor.name,
        exists: true,
        ndc: { x: +ndc.x.toFixed(4), y: +ndc.y.toFixed(4), z: +ndc.z.toFixed(4) },
        inFrame: Math.abs(ndc.x) <= 0.92 && Math.abs(ndc.y) <= 0.92
          && ndc.z >= -1 && ndc.z <= 1,
      };
    });
  });
  if (!overviewFraming.every((entry) => entry.exists && entry.inFrame)) {
    throw new Error(`Five-pallet receiving overview is not fully framed: ${JSON.stringify(overviewFraming)}.`);
  }
  await page.screenshot({ path: `${OUT}/loop-1-pad.png` });
  log.push({
    step: '1. delivery on the five-pallet receiving apron',
    camera: receivingOverview,
    framing: overviewFraming,
    focus: await focus(),
  });

  // Now CLEAR the pad and leave ONE balls case, alone, exactly in front of where we will stand —
  // so focus is unambiguous and the loop is the only thing under test.
  await page.evaluate(async () => {
    const del = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    st.shop.deliveries.boxes = [];
    st.shop.carry = null;
    if (st.shop.reno) {
      st.shop.reno.grime?.fill?.(0);
      st.shop.reno.clutter = [];
    }
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    clubhouse.rebuildReno?.();
    clubhouse.refreshCondition?.();
    del.arriveOrder(st, { id: 999, skuId: 'balls1', qty: 12, manifest: { supplier: 'Fairway Supply Co.', boxes: [{ kind: 'ballcase', qty: 12, w: 0.52, h: 0.34, d: 0.42, lb: 18.7, fragile: false }], boxCount: 1, weight: 18.7, fee: 9 } });
    const hero = del.boxesOf(st).find((b) => b.orderId === 999);
    // SELF-VALIDATING world placement: hardcoded spots go stale whenever the
    // room is relaid (the old putDownBox({x:7.4,z:-5.2}) failed silently and
    // left the carton in the player's arms), and a spot proven in one variant
    // is unproven in another. Try candidates until one SURVIVES rebuildBoxes'
    // own reconciliation — the game's occupancy rules stay the referee.
    const candidates = [
      { x: 0.4, z: 1.2 }, { x: 7.4, z: -5.2 }, { x: 6.5, z: -1.5 },
      { x: 2.0, z: 3.0 }, { x: -2.0, z: 2.0 }, { x: 0.0, z: -2.0 },
    ];
    let stagedAt = null;
    for (const spot of candidates) {
      hero.loc = 'world';
      hero.surfaceId = 'floor:clubhouse';
      hero.x = spot.x; hero.z = spot.z; hero.ry = 0;
      clubhouse.rebuildBoxes();
      const staged = del.boxesOf(st).find((b) => b.orderId === 999);
      if (staged.loc === 'world') { stagedAt = spot; break; }
    }
    if (st.shop.carry) throw new Error(`Fixture left goods in hand: ${JSON.stringify(st.shop.carry)}`);
    if (!stagedAt) {
      throw new Error(`Hero carton did not stage at any candidate spot: ${JSON.stringify(candidates)}`);
    }
    window.__deliveryLoopStagedAt = stagedAt;
  });
  const stagedAt = await page.evaluate(() => window.__deliveryLoopStagedAt);

  // 2. stand facing the hero case; the press prompt should offer the tear, with NO tool
  await goTo(stagedAt.x, stagedAt.z + 1.1, 0, -0.35);
  const sealed = await focus();
  log.push({
    step: '2. facing the sealed case — press prompt offered, no tool involved',
    initialLabel: sealed.label,
    ...sealed,
    pressPromptOffered: /tear the tape/i.test(sealed.label || ''),
    noToolInvolved: sealed.tool === null,
  });
  await page.screenshot({ path: `${OUT}/loop-2-sealed-prompt.png` });

  // 3. first press tears the tape (synchronously) and animates the wide flap
  // pair open. A press during that animation is deliberately ignored, so the
  // settle signal is the NEXT prompt appearing — never a flat timeout.
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => /open the other flap/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
    null, { timeout: 6000 },
  );
  let b = await ballBox();
  log.push({ step: '3. press one — tape', tape: b.tape, cut: b.tape >= 1 });

  // 4. second press folds the remaining flap pair open
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.skuId === 'balls1');
    const flaps = box?.flapProgress || box?.flaps || [];
    return flaps.length >= 2 && flaps.every((value) => value >= 0.999);
  }, null, { timeout: 5000 });
  b = await ballBox();
  log.push({ step: '4. flaps', flaps: b.flaps, open: b.flaps[0] >= 1 && b.flaps[1] >= 1 });
  await page.screenshot({ path: `${OUT}/loop-3-open.png` });

  // 5. tap to take an armful into the arms (gated on the armful prompt — the
  // flap animation from press two must settle first)
  await page.waitForFunction(
    () => /take an armful/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
    null, { timeout: 6000 },
  );
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.carry?.skuId === 'balls1', null, { timeout: 3000 });
  await page.waitForTimeout(300);
  const h1 = await hands();
  b = await ballBox();
  log.push({ step: '5. armful into the arms', hands: h1, leftInBox: b.qty });
  await page.screenshot({ path: `${OUT}/loop-4-armful.png` });

  // 6. carry to the ball wall and HOLD E to stock
  await goTo(-6.9, -5.4, 0, -0.05);
  const beforeShelf = await page.evaluate(() => window.__fw.state.shop.inventory.balls1.shelf);
  const fx = await focus();
  await page.keyboard.down('e');
  await page.waitForTimeout(1000);
  await page.keyboard.up('e');
  await page.waitForTimeout(200);
  const afterShelf = await page.evaluate(() => window.__fw.state.shop.inventory.balls1.shelf);
  const h2 = await hands();
  log.push({
    step: '6. stocked the ball wall',
    fixtureLabel: fx.label,
    shelf: `${beforeShelf} -> ${afterShelf}`,
    shelfBefore: beforeShelf,
    shelfAfter: afterShelf,
    stocked: afterShelf > beforeShelf,
    handsLeft: h2 ? h2.qty : 0,
  });
  await page.screenshot({ path: `${OUT}/loop-5-stocked.png` });

  // 7. take the remaining armful and finish the same carton/fixture route.
  await goTo(stagedAt.x, stagedAt.z + 1.1, 0, -0.35);
  await page.waitForFunction(
    () => /take an armful/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
    null, { timeout: 6000 },
  );
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.carry?.skuId === 'balls1', null, { timeout: 3000 });
  const secondHands = await hands();
  const afterSecondTake = await ballBox();
  await goTo(-6.9, -5.4, 0, -0.05);
  const secondFixture = await focus();
  await page.keyboard.down('e');
  await page.waitForTimeout(1000);
  await page.keyboard.up('e');
  await page.waitForTimeout(250);
  const finalShelf = await page.evaluate(() => window.__fw.state.shop.inventory.balls1.shelf);
  const finalHands = await hands();
  const finalBox = await ballBox();
  log.push({
    step: '7. remaining armful stocked with all units conserved',
    fixtureLabel: secondFixture.label,
    secondHands,
    boxQtyAfterTake: afterSecondTake?.qty ?? null,
    finalBoxQty: finalBox?.qty ?? 0,
    finalShelf,
    handsLeft: finalHands?.qty ?? 0,
  });
  await page.screenshot({ path: `${OUT}/loop-6-fully-stocked.png` });

  const assertions = {
    cutterEquipped: log[1]?.cutterEquipped === true,
    tapeCut: log[2]?.cut === true,
    flapsOpened: log[3]?.open === true,
    armfulTaken: log[4]?.hands?.skuId === 'balls1' && log[4]?.hands?.qty > 0,
    shelfStocked: log[5]?.stocked === true && log[5]?.handsLeft === 0,
    firstTripConserved: log[4]?.leftInBox + log[5]?.shelfAfter + log[5]?.handsLeft === 12,
    allUnitsStocked: log[6]?.finalBoxQty === 0
      && log[6]?.finalShelf === 12 && log[6]?.handsLeft === 0,
    noRuntimeErrors: errs.length === 0,
  };
  if (Object.values(assertions).some((value) => !value)) {
    throw new Error(`Physical unbox/stock route failed: ${JSON.stringify({ assertions, log, errs })}`);
  }
  return { ok: true, assertions, log, errs: [], errCount: 0 };
}
