async (page) => {
  // BASELINE for the physical card swipe. Drives a real card sale up to the moment the
  // terminal is waiting to be run, and screenshots what is there today: a card that is
  // "presented" and then RUN BY CLICKING the terminal — no swipe, the gesture the brief
  // asks for. Screens land in qa/register-production/before/.
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'register-production', 'before',
  );
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); };
  const log = [];

  const txNow = () => page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx ? { stage: tx.stage, method: tx.method, scanned: tx.items.filter((i) => i.scanned).length, of: tx.items.length } : null;
  });
  const untilTx = (ms = 15000) => page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: ms });
  const untilStage = (stages, ms = 15000) => page.waitForFunction((want) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && want.includes(tx.stage);
  }, Array.isArray(stages) ? stages : [stages], { timeout: ms });
  const untilFlag = (key, val, ms = 15000) => page.waitForFunction(([k, v]) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx[k] === v;
  }, [key, val], { timeout: ms });
  const CASHIER_EYE = { x: 2.78 - 8, z: 5.52 + 228 };
  const untilCameraSettled = (ms = 10000) => page.waitForFunction((eye) => {
    const c = window.__fw.scene3d.camera;
    return Math.hypot(c.position.x - eye.x, c.position.z - eye.z) < 0.03;
  }, CASHIER_EYE, { timeout: ms });

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
  await page.waitForTimeout(700);

  await page.keyboard.press('e');
  await untilCameraSettled();
  await page.waitForTimeout(300);
  await shot('01-register-overview');
  log.push({ step: 'register overview', tx: await txNow() });

  const dragTo = async (at, toLocal, via) => {
    const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    const to = await page.evaluate((p) => window.__qa.px(p[0], p[1], p[2]), toLocal);
    const legs = [];
    if (via) legs.push(await page.evaluate((p) => window.__qa.px(p[0], p[1], p[2]), via));
    legs.push(to);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    let cur = from;
    for (const leg of legs) {
      for (let s = 1; s <= 14; s++) { const t = s / 14; await page.mouse.move(cur.x + (leg.x - cur.x) * t, cur.y + (leg.y - cur.y) * t); await page.waitForTimeout(14); }
      cur = leg;
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const scan = async (i) => {
    const at = await page.evaluate((k) => window.__qa.find('item', k), i);
    if (!at) return false;
    await dragTo(at, [3.68, 1.17, 4.44], [2.70, 1.17, 4.22]);
    return true;
  };
  await scan(0);
  await scan(1);
  log.push({ step: 'scanned', tx: await txNow() });

  await page.keyboard.press('t');
  await untilFlag('method', 'card');
  await page.waitForTimeout(400);
  log.push({ step: 'totalled (card)', tx: await txNow() });

  const term = await page.evaluate(() => window.__qa.px(2.05, 1.12, 3.88));
  await page.mouse.click(term.x, term.y);
  await untilStage('card-ready');
  await page.waitForTimeout(400);
  await shot('02-card-ready-click-to-run');
  log.push({ step: 'card presented — terminal now waits for a CLICK to run (no swipe)', tx: await txNow() });

  return { log, errors: errors.slice(0, 8), errorCount: errors.length };
}
