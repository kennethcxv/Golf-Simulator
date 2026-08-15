// VERIFY2 queue L — the one hotspot the cash screen leaves live besides Exit.
// Probe C measured the monitor's hotspots at cash-tender as ['home','exit']:
// the header BRAND BLOCK is a click target even while the cash count owns the
// glass. This probe books a cash walk-in, waits for the tender stage, clicks
// the brand block, and photographs what the monitor shows mid-count.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-l2');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /new game/i.test(candidate.textContent || ''));
    return !!button && !button.disabled;
  }, null, { timeout: 90000 });
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmBtn = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) await confirmBtn.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(600, state.weather);
    const club = app.scene3d.clubhouse();
    club.setOrganicWalkins(false);
    const walk = app.scene3d.walk.state;
    const off = club.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    const R = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const nowMin = state.clock.minutes % 1440;
    return { grid: R.slotTimes(state).filter((minute) => minute >= nowMin + 90).slice(0, 4) };
  });

  const staged = await page.evaluate((minute) => {
    const club = window.__fw.scene3d.clubhouse();
    const c = club.sendWalkInToDesk({ requestedTeeMinute: minute });
    if (!c) return null;
    c.paymentPreference = 'cash';
    c.payMethod = 'cash';
    c.partySize = 1;
    return { customerId: c.customerId, name: c.fullName };
  }, setup.grid[1]);
  assert(staged, 'walk-in did not spawn');
  await page.waitForFunction((id) => {
    const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, staged.customerId, { timeout: 60000 });

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const centre = document.querySelector('.notification-center');
    if (centre) centre.style.setProperty('pointer-events', 'none', 'important');
  });
  const clickMonitor = async (actionId, label, verified = null) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const point = await page.evaluate((id) => (
        window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
      ), actionId);
      assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(650);
      if (!verified) return;
      if (await page.evaluate(verified)) return;
    }
    throw new Error(`${label}: click on ${actionId} had no effect after 3 attempts`);
  };
  await clickMonitor('tab-check-in', 'check-in tab',
    () => window.__fw.scene3d.clubhouse().register.monitorHotspots().some((h) => h.id.startsWith('select-walkin:')));
  await clickMonitor(`select-walkin:${staged.customerId}`, 'walk-in row',
    () => window.__fw.scene3d.clubhouse().register.monitorHotspots().some((h) => h.id.startsWith('select-walkin-slot:')));
  const firstSlot = await page.evaluate((id) => (
    (window.__fw.scene3d.clubhouse().frontDeskBridge().walkInSlotsFor(id) || [])[0] || null
  ), staged.customerId);
  await clickMonitor(
    `select-walkin-slot:${staged.customerId}:${firstSlot.dayAbs}:${firstSlot.minute}`,
    'slot button',
    () => !!window.__fw.scene3d.clubhouse().register.getTx(),
  );
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 30000 });
  await page.waitForTimeout(800);

  const probe = () => page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const tx = reg.getTx();
    return {
      stage: tx ? tx.stage : null,
      hotspots: reg.monitorHotspots().map((h) => ({ id: h.id, disabled: h.disabled })),
    };
  });
  const atTender = await probe();
  await page.screenshot({ path: path.join(OUT, 'homeleak-1-tender.png') });

  // the attack: click the header brand block mid-count
  const homePoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint('home')
  ));
  let leak = { homeReachable: !!(homePoint && homePoint.inView) };
  if (leak.homeReachable) {
    await page.mouse.click(homePoint.x, homePoint.y);
    await page.waitForTimeout(700);
    leak.afterHomeClick = await probe();
    await page.screenshot({ path: path.join(OUT, 'homeleak-2-after-brand-click.png') });
    // recovery: is the Checkout tab offered on whatever now shows, and does
    // it bring the cash screen back?
    const checkoutPoint = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint('tab-checkout')
    ));
    leak.checkoutReachable = !!(checkoutPoint && checkoutPoint.inView);
    if (leak.checkoutReachable) {
      await page.mouse.click(checkoutPoint.x, checkoutPoint.y);
      await page.waitForTimeout(700);
      leak.afterRecovery = await probe();
      await page.screenshot({ path: path.join(OUT, 'homeleak-3-recovered.png') });
    }
  }

  // teardown
  await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    club.register.abandon?.();
    club.register.leave?.({ restorePointer: false });
    club.clearWalkins();
  });

  const out = {
    staged, atTender, leak,
    errs: errs.slice(0, 10),
    ok: true,
  };
  fs.writeFileSync(path.join(OUT, 'verify2-l2-home-leak.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
