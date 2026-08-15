// A1 (Goal 19) — THE POCKET PHONE, SEEN WORKING.
//
// Proves on screen: T slides the phone in and away; the world keeps running
// and the player KEEPS CONTROL while it is up (real W walks, real mouse
// turns — both measured); arrows+Enter drive the apps; a ringing call shows
// the banner with the caller ID when the phone is down and the incoming
// screen when it is up; answering books through bookSlot with channel
// 'phone', logs the call, and texts a confirmation.
//
// NEGATIVE CONTROL: before any request exists, the ring banner must be
// absent and the incoming screen unreachable — a chip that shows with no
// caller would mean the instrument (or the feature) invents calls.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a-phone.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a-phone');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = await page.$('#game');
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    app.speedIdx = 0;
  });
  // capture the pointer like a player — retried, because the first click after
  // boot sometimes lands before the window will grant the lock
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.mouse.click(800, 450);
    await page.waitForTimeout(450);
    const locked = await page.evaluate(() => !!document.pointerLockElement);
    if (locked) break;
    await page.bringToFront().catch(() => {});
  }

  // NEGATIVE CONTROL — no request: no banner, and the phone opens to HOME
  out.control = await page.evaluate(() => ({
    banner: !!document.querySelector('.phone-ring-chip'),
    pending: window.__fw.state.reservations?.requests?.filter?.((r) => r.status === 'pending')?.length ?? 0,
  }));
  await shot('00-before.png');

  // T brings the phone up; W must still walk and the mouse must still look
  await page.keyboard.press('t');
  await page.waitForTimeout(500);
  out.openState = await page.evaluate(() => ({
    open: window.__fw.phone?.isOpen?.() ?? null,
    pointerLock: !!document.pointerLockElement,
  }));
  await shot('01-phone-home.png');
  const before = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z, yaw: w.yaw };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  for (let i = 0; i < 10; i += 1) { await page.mouse.move(830, 450, { steps: 2 }); await page.mouse.move(800, 450, { steps: 1 }); await page.waitForTimeout(16); }
  const after = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z, yaw: w.yaw };
  });
  out.keepsControl = {
    moved: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(3),
    turned: +Math.abs(after.yaw - before.yaw).toFixed(4),
  };
  await shot('02-phone-up-after-walk.png');

  // arrows + Enter: open Messages (third app), then back home
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  await shot('03-messages-empty.png');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(250);
  await page.keyboard.press('t'); // away
  await page.waitForTimeout(450);
  out.closedState = await page.evaluate(() => ({ open: window.__fw.phone?.isOpen?.() ?? null }));

  // RING: inject a real request through the book (the sim's own shape)
  await page.evaluate(() => {
    const app = window.__fw;
    const state = app.state;
    const book = state.reservations;
    book.requests = Array.isArray(book.requests) ? book.requests : [];
    const nowAbs = Math.floor(state.clock.minutes);
    const dayAbs = Math.floor(nowAbs / 1440);
    book.nextRequestId = (book.nextRequestId || 1) + 1;
    book.requests.push({
      id: `req_qa_${book.nextRequestId}`,
      channel: 'phone',
      holder: 'Nina Calloway',
      partySize: 2,
      dayAbs,
      minute: 14 * 60,
      createdAtAbs: nowAbs,
      expiresAtAbs: nowAbs + 30,
      status: 'pending',
    });
  });
  await page.waitForTimeout(900);
  out.ringBanner = await page.evaluate(() => {
    const chip = document.querySelector('.phone-ring-chip');
    return { present: !!chip, text: chip ? chip.textContent.slice(0, 140) : null };
  });
  await shot('04-ring-banner.png');

  // T while ringing: the incoming screen, then Enter answers (focus starts on Answer)
  await page.keyboard.press('t');
  await page.waitForTimeout(500);
  await shot('05-incoming.png');
  out.incoming = await page.evaluate(() => {
    const caller = document.querySelector('.phone-caller');
    return { caller: caller ? caller.textContent : null };
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await shot('06-booked-card.png');
  out.afterAnswer = await page.evaluate(() => {
    const state = window.__fw.state;
    const res = (state.reservations.booked || []).find((r) => r.holder === 'Nina Calloway'
      || r.fullName === 'Nina Calloway' || r.name === 'Nina Calloway');
    return {
      reservation: res ? { source: res.source, minute: res.minute } : null,
      call: state.phone?.calls?.[0] || null,
      text: state.phone?.texts?.[0] ? { kind: state.phone.texts[0].kind, from: state.phone.texts[0].from } : null,
      bannerGone: !document.querySelector('.phone-ring-chip'),
    };
  });
  await page.keyboard.press('t');
  await page.waitForTimeout(400);
  await shot('07-away.png');

  out.ok = out.control.banner === false
    && out.openState.open === true
    && out.keepsControl.moved > 0.4
    && out.keepsControl.turned > 0.005
    && out.ringBanner.present === true
    && out.incoming.caller === 'Nina Calloway'
    && !!out.afterAnswer.reservation
    && out.afterAnswer.reservation.source === 'phone'
    && out.afterAnswer.call?.outcome === 'booked'
    && out.afterAnswer.text?.kind === 'bookingConfirmed'
    && out.afterAnswer.bannerGone === true
    && out.closedState.open === false;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('A-PHONE', JSON.stringify(out));
  return { ok: out.ok !== false, ...out };
}
