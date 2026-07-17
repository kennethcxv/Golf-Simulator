async (page) => {
  // THE PHYSICAL LOOP, PROVEN THROUGH THE RUNNING GAME with real key presses. Rather than guess
  // where a box stacked, I place one at a known spot in the stockroom and stand facing it, then
  // drive the whole chain: cutter equips -> HOLD E cuts the tape -> tap opens each flap -> tap
  // takes an armful into the arms -> carry to the ball wall -> HOLD E stocks it. The sim is checked
  // at every step and the console must stay clean.
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  const OUT = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/delivery';
  const log = [];

  await page.goto('http://localhost:8457/');
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
  await goTo(11.2, -3.6, -Math.PI / 2, -0.15);
  await page.screenshot({ path: `${OUT}/loop-1-pad.png` });
  log.push({ step: '1. delivery on the pad', focus: await focus() });

  // Now CLEAR the pad and leave ONE balls case, alone, exactly in front of where we will stand —
  // so focus is unambiguous and the loop is the only thing under test.
  await page.evaluate(async () => {
    const del = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    st.shop.deliveries.boxes = [];
    st.shop.carry = null;
    del.arriveOrder(st, { id: 999, skuId: 'balls1', qty: 12, manifest: { supplier: 'Fairway Supply Co.', boxes: [{ kind: 'ballcase', qty: 12, w: 0.52, h: 0.34, d: 0.42, lb: 18.7, fragile: false }], boxCount: 1, weight: 18.7, fee: 9 } });
    const hero = del.boxesOf(st).find((b) => b.orderId === 999);
    del.pickUpBox(st, hero.id);
    del.putDownBox(st, hero.id, { x: 7.4, z: -5.2, ry: 0 });
    window.__fw.scene3d.clubhouse().rebuildBoxes();
  });

  // 2. stand facing the hero case; the box cutter should appear
  await goTo(7.4, -4.1, 0, -0.28);
  const sealed = await focus();
  log.push({ step: '2. facing the sealed case', ...sealed, cutterEquipped: sealed.tool === 'boxcutter' });
  await page.screenshot({ path: `${OUT}/loop-2-cutter.png` });

  // 3. HOLD E to cut
  await page.keyboard.down('e');
  await page.waitForTimeout(2250);
  await page.keyboard.up('e');
  await page.waitForTimeout(200);
  let b = await ballBox();
  log.push({ step: '3. held E — tape', tape: b.tape, cut: b.tape >= 1 });

  // 4. one normal action starts the deterministic four-flap sequence
  await page.keyboard.press('e');
  await page.waitForTimeout(1550);
  b = await ballBox();
  log.push({ step: '4. flaps', flaps: b.flaps, open: b.flaps[0] >= 1 && b.flaps[1] >= 1 });
  await page.screenshot({ path: `${OUT}/loop-3-open.png` });

  // 5. tap to take an armful into the arms
  await page.keyboard.press('e'); await page.waitForTimeout(300);
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
    stocked: afterShelf > beforeShelf,
    handsLeft: h2 ? h2.qty : 0,
  });
  await page.screenshot({ path: `${OUT}/loop-5-stocked.png` });

  return { log, errs: errs.slice(0, 8), errCount: errs.length };
}
