async (page) => {
  // Does the register even boot? Collect every console error and page error, load the
  // game, and report. This runs FIRST, before any pretty screenshots, because a
  // screenshot of a broken scene is worse than no screenshot: it looks like evidence.
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});

  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(3000);

  const probe = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    return {
      hasClubhouse: !!ch,
      hasRegisterApi: !!(ch && ch.register),
      registerActive: ch && ch.register ? ch.register.isActive() : null,
      hasTx: ch && ch.register ? ch.register.hasTx() : null,
      drawerInState: !!(app.state.shop && app.state.shop.drawer),
      heldLedger: (app.state.shop.held || []).length,
      customers: ch && ch.getCustomers ? ch.getCustomers().length : -1,
    };
  });

  return { errors: errors.slice(0, 12), errorCount: errors.length, probe };
}
