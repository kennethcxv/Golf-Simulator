// D5 — "Cash hover highlight — verify or fix. You said it is an outline shell
// by construction but never re-verified it visually. Look at it."
//
// Runs a cash sale to the tender-on-the-desk beat, photographs the pile with the
// cursor OFF it and then ON it, cropped tight, and counts the outline shells in
// both states.
//
// Negative control: the un-hovered frame. If the shell count is not zero with
// the cursor away, the "highlight" is permanent decoration and the hovered
// frame proves nothing.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/cash-hover');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const assert = (v, m) => { if (!v) throw new Error(m); };

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
    const c = app.scene3d.clubhouse();
    c.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      if (skuIds.includes(id)) app.state.shop.inventory[id].shelf = Math.max(app.state.shop.inventory[id].shelf, 12);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    c.rebuildStock();
    const w = app.scene3d.walk.state;
    const off = c.interior.position;
    w.x = REGISTER.stand.x + off.x;
    w.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.yaw = Math.atan2(-dx / h, -dz / h);
    w.pitch = Math.atan2(1.18 - 1.62, h);
    c.sendToCounter(skuIds, 'cash');
  }, [SKUS]);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 40000 });
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1500);

  const projectItem = (uid) => page.evaluate(async (id) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    let found = null;
    app.scene3d.clubhouse().interior.traverse((o) => {
      if (!found && o.visible && o.userData?.kind === 'item' && o.userData.uid === id) found = o;
    });
    if (!found) return null;
    const b = new THREE.Box3().setFromObject(found);
    const w = b.isEmpty() ? found.getWorldPosition(new THREE.Vector3()) : b.getCenter(new THREE.Vector3());
    w.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((w.x + 1) / 2) * rect.width,
      y: rect.top + ((-w.y + 1) / 2) * rect.height,
      inView: Math.abs(w.x) <= 1 && Math.abs(w.y) <= 1,
    };
  }, uid);

  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid)));
  for (const uid of uids) {
    let p = await projectItem(uid);
    for (let s = 0; s < 20; s += 1) {
      await page.waitForTimeout(160);
      const n = await projectItem(uid);
      if (n && p && Math.abs(n.x - p.x) < 1.5 && Math.abs(n.y - p.y) < 1.5) { p = n; break; }
      p = n;
    }
    assert(p && p.inView, `item ${uid} not in frame`);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const it = tx?.items.find((c) => c.uid === id);
      return !!(it?.scanned && it?.bagged);
    }, uid, { timeout: 15000 });
  }

  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 30000 });
  await page.waitForTimeout(1400);

  const cash = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()));
  assert(cash?.inView, 'the desk tender is not in view');
  const clip = {
    x: Math.max(0, Math.round(cash.x - 260)),
    y: Math.max(0, Math.round(cash.y - 170)),
    width: 520,
    height: 340,
  };

  const shells = () => page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const c = window.__fw.scene3d.clubhouse();
    let count = 0;
    let sprites = 0;
    let biggestShellScale = 0;
    c.interior.traverse((o) => {
      if (o.userData?.grabOutlineShell) {
        count += 1;
        const b = new THREE.Box3().setFromObject(o);
        if (!b.isEmpty()) {
          biggestShellScale = Math.max(biggestShellScale, b.getSize(new THREE.Vector3()).length());
        }
      }
      if (o.isSprite && o.visible) sprites += 1;
    });
    return { count, sprites, biggestShellScale: +biggestShellScale.toFixed(4) };
  });

  // ---- control: cursor well away from the pile -----------------------------
  await page.mouse.move(120, 120);
  await page.waitForTimeout(600);
  const away = await shells();
  await page.screenshot({ path: path.join(OUT, '01-not-hovered.png'), clip });

  // ---- hovered ---------------------------------------------------------------
  await page.mouse.move(cash.x, cash.y);
  await page.waitForTimeout(700);
  const over = await shells();
  await page.screenshot({ path: path.join(OUT, '02-hovered.png'), clip });
  await page.screenshot({ path: path.join(OUT, '02-hovered-full.png') });

  const report = {
    control: away,
    hovered: over,
    // the highlight must APPEAR on hover, not simply exist
    appearsOnHover: over.count > away.count,
    // …and it must be a shell around the goods, not a billboard sprite over them
    isOutlineNotSprite: over.sprites <= away.sprites,
  };
  fs.writeFileSync(path.join(OUT, 'cash-hover.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert(away.count === 0,
    `NEGATIVE CONTROL FAILED: ${away.count} outline shells exist with the cursor away, `
    + 'so the hovered frame does not show a highlight appearing.');
  return report;
}
