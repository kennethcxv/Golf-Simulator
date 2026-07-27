async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.goto(`${base}?clubhouse=modern-public`);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await Promise.race([
    page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 25000 }).catch(() => null),
    page.waitForTimeout(7000),
  ]);
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    return {
      screen: window.__fw?.screen || null,
      hasScene: Boolean(window.__fw?.scene3d),
      hasClubhouse: Boolean(clubhouse),
      modern: clubhouse?.modernClubhouse?.diagnostics?.() || null,
    };
  });
  return { ok: errors.length === 0 && state.hasClubhouse, errors, ...state };
}
