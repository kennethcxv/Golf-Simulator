async (page) => {
  // THE PHYSICAL CARD SWIPE, driven through real inputs. Scans a two-item card sale,
  // presents the card, then works the reader with a real top-to-bottom mouse drag down
  // the channel — no click-to-run anywhere. A clean swipe authorises; the sale is then
  // carried to the bank so the whole card path is proven end to end.
  //
  // Screens land in qa/register-production/pass-1/. Never sleep for state — every wait
  // is a condition on the real transaction.
  const OUT = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/register-production/pass-1';
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); };
  const log = [];

  const txNow = () => page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx ? { stage: tx.stage, method: tx.method, cardAttempts: tx.cardAttempts, cardsTried: tx.cardsTried, banked: !!tx.banked } : null;
  });
  const money = () => page.evaluate(() => ({
    revenue: (window.__fw.state.shop.salesLive || {}).revenue || 0,
    units: (window.__fw.state.shop.salesLive || {}).units || 0,
    held: (window.__fw.state.shop.held || []).length,
  }));
  const untilTx = (ms = 15000) => page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: ms });
  const untilStage = (stages, ms = 20000) => page.waitForFunction((want) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && want.includes(tx.stage);
  }, Array.isArray(stages) ? stages : [stages], { timeout: ms });
  const untilFlag = (key, val, ms = 15000) => page.waitForFunction(([k, v]) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx[k] === v;
  }, [key, val], { timeout: ms });
  const CASHIER_EYE = { x: 2.78 - 8, z: 5.52 + 228 };
  const untilCameraNear = (eye, tol, ms = 10000) => page.waitForFunction(([e, t]) => {
    const c = window.__fw.scene3d.camera;
    return Math.hypot(c.position.x - e.x, c.position.z - e.z) < t;
  }, [eye, tol], { timeout: ms });

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);

  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    window.__qa = {
      px(lx, ly, lz) {
        const ch = app.scene3d.clubhouse();
        const v = new THREE.Vector3(lx + ch.interior.position.x, ly + ch.interior.position.y, lz + ch.interior.position.z);
        v.project(app.scene3d.camera);
        const c = document.querySelector('canvas').getBoundingClientRect();
        return { x: c.left + ((v.x + 1) / 2) * c.width, y: c.top + ((-v.y + 1) / 2) * c.height };
      },
      centre(m, ch) {
        const b = new THREE.Box3().setFromObject(m);
        const c = b.getCenter(new THREE.Vector3());
        const o = ch.interior.position;
        return { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
      },
      find(kind, i = 0) {
        const ch = app.scene3d.clubhouse();
        const out = [];
        ch.interior.traverse((o) => { if (o.userData && o.userData.kind === kind && o.visible) out.push(o); });
        const m = out[i];
        if (!m) return null;
        const c = window.__qa.centre(m, ch);
        return { ...c, uid: m.userData.uid || null, n: out.length };
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
    const st = app.scene3d.walk.state;
    st.x = 2.80 - 8; st.z = 5.10 + 228; st.yaw = 0; st.pitch = -0.18;
  });
  await page.waitForTimeout(800);

  await page.evaluate(() => window.__fw.scene3d.clubhouse().sendToCounter(['balls3', 'glove1'], 'card'));
  await untilTx();
  await page.waitForTimeout(600);
  await page.keyboard.press('e');
  await untilCameraNear(CASHIER_EYE, 0.03);
  await page.waitForTimeout(250);

  // scan both
  const dragScan = async (i) => {
    const at = await page.evaluate((k) => window.__qa.find('item', k), i);
    if (!at) return;
    const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    const via = await page.evaluate(() => window.__qa.px(2.70, 1.17, 4.22));
    const to = await page.evaluate(() => window.__qa.px(3.68, 1.17, 4.44));
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    let cur = from;
    for (const leg of [via, to]) { for (let s = 1; s <= 12; s++) { const t = s / 12; await page.mouse.move(cur.x + (leg.x - cur.x) * t, cur.y + (leg.y - cur.y) * t); await page.waitForTimeout(13); } cur = leg; }
    await page.mouse.up(); await page.waitForTimeout(150);
  };
  await dragScan(0); await dragScan(1);
  log.push({ step: 'scanned', tx: await txNow() });

  await page.keyboard.press('t');
  await untilFlag('method', 'card');
  await page.waitForTimeout(300);

  // present the card
  const term = await page.evaluate(() => window.__qa.px(2.05, 1.12, 3.88));
  await page.mouse.click(term.x, term.y);
  await untilStage('card-ready');
  // the swipe camera eases in — wait for it to arrive
  const SWIPE_EYE = { x: 2.05 - 8, z: 4.28 + 228 };
  await untilCameraNear(SWIPE_EYE, 0.05);
  await page.waitForTimeout(250);
  await shot('01-swipe-ready');
  log.push({ step: 'card presented — reader waiting for a SWIPE', tx: await txNow() });

  // read the channel endpoints and turn them into screen pixels
  const chan = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.swipeAt());
  const topPx = await page.evaluate((p) => window.__qa.px(p.x, p.y, p.z), chan.top);
  const botPx = await page.evaluate((p) => window.__qa.px(p.x, p.y, p.z), chan.bot);
  log.push({ step: 'channel', top: { x: Math.round(topPx.x), y: Math.round(topPx.y) }, bot: { x: Math.round(botPx.x), y: Math.round(botPx.y) } });

  // a demonstration part-swipe, purely to photograph the card mid-channel — released
  // short, so it's judged incomplete and springs back; the real swipe follows
  await page.mouse.move(topPx.x, topPx.y);
  await page.mouse.down();
  for (let s = 1; s <= 6; s++) { const t = 0.58 * (s / 6); await page.mouse.move(topPx.x, topPx.y + (botPx.y - topPx.y) * t); await page.waitForTimeout(16); }
  await shot('02-mid-swipe');
  await page.mouse.up();
  await page.waitForTimeout(250);
  log.push({ step: 'part-swipe released short (springs back)', tx: await txNow() });

  // THE REAL SWIPE: a clean top-to-bottom pull, no screenshots in the middle so its
  // duration lands inside the valid window
  const swipeOnce = async () => {
    await page.mouse.move(topPx.x, topPx.y);
    await page.mouse.down();
    for (let s = 1; s <= 14; s++) { const t = s / 14; await page.mouse.move(topPx.x, topPx.y + (botPx.y - topPx.y) * t); await page.waitForTimeout(15); }
    await page.mouse.up();
  };
  await swipeOnce();
  await untilStage(['card-busy', 'receipt', 'card-declined']);
  await page.waitForTimeout(200);
  await shot('03-reading');
  log.push({ step: 'swiped — reader is reading', tx: await txNow(), ...(await money()) });

  await untilStage(['receipt', 'card-declined']);
  let t = await txNow();
  log.push({ step: 'reader answered', tx: t, ...(await money()), expect: 'revenue STILL 0 — an approval banks nothing' });

  // declined? present another card and swipe again
  let guard = 0;
  while (t.stage === 'card-declined' && guard++ < 4) {
    const tm = await page.evaluate(() => window.__qa.px(2.05, 1.12, 3.88));
    await page.mouse.click(tm.x, tm.y);      // retry -> another card, back to card-ready
    await untilStage('card-ready');
    await page.waitForTimeout(200);
    await swipeOnce();
    await untilStage(['receipt', 'card-declined']);
    t = await txNow();
    log.push({ step: 'swiped a second card', tx: t });
  }
  await shot('04-approved');

  // carry it to the bank: take the receipt, bag the goods, hand it over
  await untilFlag('receiptPrinted', true);
  await page.waitForTimeout(200);
  const rp = await page.evaluate(() => window.__qa.find('receipt'));
  const rpx = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), rp);
  await page.mouse.click(rpx.x, rpx.y);
  await untilStage('bagging');
  for (let i = 0; i < 3; i++) {
    const at = await page.evaluate(() => window.__qa.find('item'));
    if (!at) break;
    const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    const to = await page.evaluate(() => window.__qa.px(3.50, 1.20, 4.44));
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let s = 1; s <= 10; s++) { const tt = s / 10; await page.mouse.move(from.x + (to.x - from.x) * tt, from.y + (to.y - from.y) * tt); await page.waitForTimeout(13); }
    await page.mouse.up(); await page.waitForTimeout(200);
  }
  const palm = await page.evaluate(() => window.__qa.px(1.78, 1.13, 3.64));
  await page.mouse.click(palm.x, palm.y);
  await page.waitForTimeout(900);
  await shot('05-banked');
  log.push({ step: 'handed over — money banks NOW', tx: await txNow(), ...(await money()), expect: 'revenue > 0, held back to 0' });

  return { log, errors: errors.slice(0, 10), errorCount: errors.length };
}
