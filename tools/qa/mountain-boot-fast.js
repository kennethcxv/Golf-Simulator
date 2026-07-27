async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.goto(`${base}?clubhouse=mountain-lodge`);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await Promise.race([
    page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 20000 }).catch(() => null),
    page.waitForTimeout(5000),
  ]);
  await page.waitForTimeout(750);
  return {
    ok: errors.length === 0 && Boolean(await page.evaluate(() => window.__fw?.scene3d?.clubhouse?.())),
    errors,
    screen: await page.evaluate(() => window.__fw?.screen || null),
    hasScene: await page.evaluate(() => Boolean(window.__fw?.scene3d)),
    pose: await page.evaluate(() => {
      const scene = window.__fw?.scene3d;
      const clubhouse = scene?.clubhouse?.();
      const root = clubhouse?.mountainLodge?.root?.();
      const center = clubhouse?.group?.position;
      const rootWorld = root?.getWorldPosition?.(root.position.clone());
      return {
        center: center?.toArray?.() || null,
        rootWorld: rootWorld?.toArray?.() || null,
        walk: scene?.walk?.state ? { ...scene.walk.state } : null,
        camera: scene?.camera?.position?.toArray?.() || null,
      };
    }),
  };
}
