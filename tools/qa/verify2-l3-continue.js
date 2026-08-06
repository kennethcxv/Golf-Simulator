// VERIFY2 queue L — the last link of L3 persistence: a REAL boot resuming the
// quit-save that probe D wrote (restored from the app's own .bak rotation
// after the probe's fallback new-game overwrote it). Waits for Continue to
// ENABLE — probe D's one-shot check raced the menu's async save inspection —
// clicks it, and reads where the ledger book stands.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-l3');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };

  await page.setViewportSize(VIEWPORT);
  // The Continue button's textContent is the label PLUS a detail span
  // ("ContinuePine Hills Municipal Golf · Day 1"), so qa-boot's exact-match
  // regex can never see it enabled. Match the label span instead.
  const continueEnabled = await page.waitForFunction(() => {
    const label = [...document.querySelectorAll('button .menu-action-label')]
      .find((candidate) => (candidate.textContent || '').trim() === 'Continue');
    const button = label ? label.closest('button') : null;
    return !!button && !button.disabled;
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  const menuSummary = await page.evaluate(() => {
    const title = document.querySelector('.menu-save-title');
    const detail = document.querySelector('.menu-save-detail');
    const actionDetail = document.querySelector('button .menu-action-detail');
    return {
      title: title ? title.textContent : null,
      detail: detail ? detail.textContent : null,
      actionDetail: actionDetail ? actionDetail.textContent : null,
    };
  });
  await page.screenshot({ path: path.join(OUT, '13-menu-continue.png') });
  if (!continueEnabled) {
    const out = { continueEnabled: false, menuSummary, ok: true, errs };
    fs.writeFileSync(path.join(OUT, 'verify2-l3-continue.json'), `${JSON.stringify(out, null, 1)}\n`);
    return out;
  }
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('button .menu-action-label')]
      .find((candidate) => (candidate.textContent || '').trim() === 'Continue');
    label.closest('button').click();
  });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  const resumed = await page.evaluate(async () => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const { rosterEntries } = await import(new URL('src/sim/clubRoster.js', document.baseURI).href);
    return {
      clockMinutes: app.state.clock.minutes,
      ledgerSpot: app.state.shop?.ledgerSpot ? { ...app.state.shop.ledgerSpot } : null,
      bookPosition: club.ledgerBook.position(),
      roster: rosterEntries(app.state).length,
    };
  });

  // stand near the resumed book, read the prompt, open it
  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const book = club.ledgerBook.position();
    const dx = (book.x + off.x) - walk.x;
    const dz = (book.z + off.z) - walk.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    const eyeY = app.scene3d.camera.position.y;
    walk.pitch = Math.atan2((book.y + off.y) - eyeY, horizontal);
  });
  await page.waitForTimeout(700);
  const prompt = await page.evaluate(() => {
    const el = document.querySelector('.shop-prompt');
    return el ? (el.textContent || '').trim() : null;
  });
  await page.screenshot({ path: path.join(OUT, '14-resumed-book.png') });
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('e');
  const opens = await page.waitForFunction(
    () => window.__fw.ledgerOpen === true,
    null, { timeout: 8000 },
  ).then(() => true).catch(() => false);
  const diag = opens ? await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().ledgerBook.diagnostics()
  )) : null;
  await page.screenshot({ path: path.join(OUT, '15-resumed-open.png') });

  const expected = { x: -1.1405564586793275, z: 1.624380973968771 };
  const out = {
    continueEnabled,
    menuSummary,
    resumed,
    prompt,
    opens,
    diag,
    spotMatchesQuitSave: !!resumed.ledgerSpot
      && Math.abs(resumed.ledgerSpot.x - expected.x) < 0.001
      && Math.abs(resumed.ledgerSpot.z - expected.z) < 0.001
      && Math.abs(resumed.bookPosition.x - expected.x) < 0.001
      && Math.abs(resumed.bookPosition.z - expected.z) < 0.001,
    errs: errs.slice(0, 10),
    ok: true,
  };
  fs.writeFileSync(path.join(OUT, 'verify2-l3-continue.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
