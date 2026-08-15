// VERIFY2 queue L — follow-up to probe A's QUEUE2 leg. Probe A found the
// second walk-in's slot buttons unreachable through actionPoint (null), but
// its raw-click leg skipped because no disabled select-walkin-slot hotspot
// was found at probe time. This dump settles it: stage two walk-ins, select
// the second, dump the raw hotspot table, and if the disabled buttons are
// registered, click the first one's real screen pixels and report effects.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-l1a');
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
    return { grid: R.slotTimes(state).filter((minute) => minute >= nowMin + 90).slice(0, 6) };
  });

  const stageWalkIn = async (askMinute, waitIndex) => {
    const staged = await page.evaluate((minute) => {
      const club = window.__fw.scene3d.clubhouse();
      const c = club.sendWalkInToDesk({ requestedTeeMinute: minute });
      if (!c) return null;
      c.paymentPreference = 'card';
      c.payMethod = 'card';
      c.partySize = 1;
      return { customerId: c.customerId, name: c.fullName };
    }, askMinute);
    assert(staged, 'walk-in did not spawn');
    await page.waitForFunction(([id, index]) => {
      const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
      const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
      return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === index);
    }, [staged.customerId, waitIndex], { timeout: 60000 });
    return staged;
  };
  const first = await stageWalkIn(setup.grid[1], 0);
  const second = await stageWalkIn(setup.grid[2], 1);

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const clickMonitor = async (actionId, label) => {
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), actionId);
    assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
  };
  await clickMonitor('tab-check-in', 'check-in tab');
  await clickMonitor(`select-walkin:${second.customerId}`, 'second walk-in row');
  await page.waitForTimeout(400);

  // the raw hotspot table, verbatim
  const dump = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.monitorHotspots()
      .map((h) => ({ id: h.id, kind: h.kind, disabled: h.disabled, x: h.x, y: h.y, w: h.width, h: h.height }))
  ));

  // click the first disabled slot button's true pixels via the affine map
  const disabledSlot = dump.find((h) => h.disabled && h.id.startsWith('select-walkin-slot:'));
  let rawClick = { found: !!disabledSlot };
  if (disabledSlot) {
    // anchors must have UNIQUE ids: the Full Sheet button reuses the id
    // 'tab-tee-sheet', and monitorScreenPoint resolves an id to the FIRST
    // hotspot carrying it — a duplicated id maps the wrong rect (the first
    // run of this dump clicked 293 px off because of exactly that)
    const idCounts = dump.reduce((m, h) => { m[h.id] = (m[h.id] || 0) + 1; return m; }, {});
    const anchors = dump.filter((h) => !h.disabled && idCounts[h.id] === 1).slice(0, 12);
    const sp = (id) => page.evaluate((k) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(k)
    ), id);
    // two live anchors with wide separation + a third for validation
    let bestPair = null;
    for (const a of anchors) {
      for (const b of anchors) {
        const score = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) * Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
        if (!bestPair || score > bestPair.score) bestPair = { a, b, score };
      }
    }
    const third = anchors.find((h) => h.id !== bestPair.a.id && h.id !== bestPair.b.id);
    const pa = await sp(bestPair.a.id);
    const pb = await sp(bestPair.b.id);
    const pc = await sp(third.id);
    const centre = (h) => ({ x: h.x + h.w / 2, y: h.y + h.h / 2 });
    const aC = centre(bestPair.a);
    const bC = centre(bestPair.b);
    const sxScale = (pb.x - pa.x) / (bC.x - aC.x || 1);
    const syScale = (pb.y - pa.y) / (bC.y - aC.y || 1);
    const toScreen = (c) => ({ x: pa.x + (c.x - aC.x) * sxScale, y: pa.y + (c.y - aC.y) * syScale });
    const predicted = toScreen(centre(third));
    const mapErr = Math.hypot(predicted.x - pc.x, predicted.y - pc.y);
    if (mapErr >= 6) {
      rawClick = { found: true, id: disabledSlot.id, mapErr, note: 'map unreliable; click withheld' };
    } else {
      const before = await page.evaluate(() => ({
        booked: window.__fw.state.reservations.booked.length,
        tx: !!window.__fw.scene3d.clubhouse().register.getTx(),
      }));
      const hit = toScreen(centre(disabledSlot));
      // what would the game itself pick at these pixels?
      const gamePick = await page.evaluate(([clientX, clientY]) => (
        window.__fw.scene3d.clubhouse().register.debugPickAt(clientX, clientY)
      ), [hit.x, hit.y]);
      await page.mouse.click(hit.x, hit.y);
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => ({
        booked: window.__fw.state.reservations.booked.length,
        tx: !!window.__fw.scene3d.clubhouse().register.getTx(),
      }));
      await page.screenshot({ path: path.join(OUT, 'q2-dump-after-raw-click.png') });
      rawClick = { found: true, id: disabledSlot.id, mapErr, hit, gamePick, before, after };
    }
  } else {
    await page.screenshot({ path: path.join(OUT, 'q2-dump-no-disabled-hotspot.png') });
  }

  const out = {
    setup, first, second, dump, rawClick,
    errs: errs.slice(0, 10),
    ok: true,
  };
  fs.writeFileSync(path.join(OUT, 'verify2-l1-q2-dump.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
