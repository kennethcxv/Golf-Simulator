async (page) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const OUT = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/delivery';

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(1200);

  const off = await page.evaluate(() => { const o = window.__fw.scene3d.clubhouse().interior.position; return { x: o.x, z: o.z }; });
  const goTo = async (lx, lz, yaw, pitch) => {
    await page.evaluate((p) => { const w = window.__fw.scene3d.walk.state; w.x = p.x; w.z = p.z; w.yaw = p.yaw; w.pitch = p.pitch; }, { x: lx + off.x, z: lz + off.z, yaw, pitch });
    await page.waitForTimeout(400);
  };

  // clear floor: the middle of the stockroom, well away from the backroom shelving (z ~ -6)
  await page.evaluate(async () => {
    const del = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    st.cash = 200000; st.shop.unlockedTier = 3;
    st.shop.deliveries.boxes = []; st.shop.carry = null;
    const ballMani = { supplier: 'Fairway Supply Co.', boxes: [{ kind: 'ballcase', qty: 12, w: 0.52, h: 0.34, d: 0.42, lb: 18.7, fragile: false }], boxCount: 1, weight: 18.7, fee: 9 };
    del.arriveOrder(st, { id: 801, skuId: 'balls1', qty: 12, manifest: ballMani });
    del.arriveOrder(st, { id: 802, skuId: 'balls3', qty: 12, manifest: ballMani });
    del.arriveOrder(st, { id: 803, skuId: 'range2', qty: 4, manifest: { supplier: 'Fairway Supply Co.', boxes: [{ kind: 'carton', qty: 4, w: 0.42, h: 0.30, d: 0.36, lb: 3.6, fragile: true }], boxCount: 1, weight: 3.6, fee: 9 } });
    const boxes = del.boxesOf(st);
    const put = (oid, x, z, ry) => { const b = boxes.find((bb) => bb.orderId === oid); del.pickUpBox(st, b.id); del.putDownBox(st, b.id, { x, z, ry }); return b; };
    put(801, 6.4, -2.4, 0.15);       // sealed
    const opened = put(802, 7.4, -2.6, -0.2);  // open, half full
    put(803, 8.4, -2.4, 0.1);        // fragile
    del.cutTape(st, opened.id, 1);
    del.openFlap(st, opened.id); del.openFlap(st, opened.id);
    opened.qty = 7;
    window.__fw.scene3d.clubhouse().rebuildBoxes();
  });

  // 1. the three boxes on open floor: sealed / open-with-contents / fragile
  await goTo(7.3, -0.9, 0, -0.32);
  await page.screenshot({ path: `${OUT}/box-states.png` });

  // 2. right over the open case, looking down into the product
  await goTo(7.4, -1.9, 0, -0.62);
  await page.screenshot({ path: `${OUT}/box-open-contents.png` });

  // 3. the box cutter in hand at the sealed case (verify it equipped)
  await goTo(6.4, -1.5, 0, -0.42);
  await page.waitForTimeout(400);
  const cut = await page.evaluate(() => ({ label: window.__fw.scene3d.walk.getFocusLabel(), tool: window.__fw.scene3d.walk.getTool() }));
  await page.screenshot({ path: `${OUT}/box-cutter-hand.png` });

  // 4. an armful of product in the arms
  await page.evaluate(() => { window.__fw.state.shop.carry = { skuId: 'balls3', qty: 6 }; window.__fw.scene3d.clubhouse().rebuildBoxes(); });
  await goTo(7.4, -1.9, 0, -0.12);
  await page.screenshot({ path: `${OUT}/box-armful.png` });

  return { cutterShot: cut, errs: errs.slice(0, 5), errCount: errs.length };
}
