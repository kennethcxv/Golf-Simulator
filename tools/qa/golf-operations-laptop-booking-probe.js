async function runGolfOperationsLaptopBookingProbe(page) {
  const baseUrl = process.env.QA_BASE_URL || process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8507/';
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const operations = await import('/src/sim/reservations.js');
    const { calendarOf } = await import('/src/sim/time.js');
    const qaDay = calendarOf(app.state.clock.minutes).dayAbs + 1;
    operations.resetGolfOperationsQA(app.state);
    const seeded = operations.seedGolfOperationsQA(app.state, { dayAbs: qaDay, seed: 20260719 });
    const noShow = operations.reservationById(app.state, seeded.ids.noShow);
    app.state.clock.minutes = noShow.dayAbs * 1440 + noShow.minute
      + app.state.reservations.config.gracePeriodMin + 1;
    operations.golfOperationsTick(app.state, app.state.clock.minutes);
    app.speedIdx = 0;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 8.45;
    walk.z = origin.z + 4.5;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
    return seeded;
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 15_000 });
  await page.locator('.lt-navbtn').filter({ hasText: 'Reservations' }).first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.lt-navbtn.on')]
    .some((entry) => entry.textContent.includes('Reservations')));

  await page.locator('input[placeholder="Reservation holder"]').fill('Jordan Vale');
  await page.locator('.lt-row').filter({ hasText: 'Party' }).first().locator('select').selectOption('3');
  await page.locator('input[placeholder^="Other player names"]').fill('Mara Vale, Ellis Vale');
  await page.locator('.lt-row').filter({ hasText: 'Payment' }).first().locator('select').selectOption('prepaid');
  const bookButton = page.locator('.lt-slotbook:not([disabled])').filter({ hasText: 'Book party of 3' }).first();
  const before = await page.evaluate(() => ({
    holder: document.querySelector('input[placeholder="Reservation holder"]')?.value,
    guests: document.querySelector('input[placeholder^="Other player names"]')?.value,
    selects: [...document.querySelectorAll('.lt-row select')].map((select) => select.value),
    enabledBookButtons: [...document.querySelectorAll('.lt-slotbook:not([disabled])')]
      .map((button) => button.textContent.trim()),
  }));
  const buttonText = await bookButton.textContent();
  await bookButton.click();
  await page.waitForTimeout(750);
  const after = await page.evaluate(() => ({
    jordan: window.__fw.state.reservations.booked
      .filter((reservation) => reservation.reservationHolder === 'Jordan Vale')
      .map((reservation) => ({ id: reservation.id, dayAbs: reservation.dayAbs, minute: reservation.minute,
        partySize: reservation.partySize, status: reservation.status, payment: reservation.payment })),
    toasts: [...document.querySelectorAll('.toast')].map((toast) => toast.textContent.trim()),
  }));
  return { ok: after.jordan.length === 1 && errors.length === 0, fixture, buttonText, before, after, errors };
}
