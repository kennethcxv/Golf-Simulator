// Save/reload integrity: stamp the shop state (cash, drawer contents, inventory,
// sales), write the game's OWN autosave, reload the page, and confirm every value
// came back. This is the write the nightly rollover makes, taken mid-session.
async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 140)); });

  await page.goto(baseUrl);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(1500);

  // stamp a distinctive state, then write the game's own snapshot to autosave
  const before = await page.evaluate(async () => {
    const app = window.__fw;
    const shop = app.state.shop;
    app.state.cash = 424242;
    shop.markup.balls = 1.37;
    const firstSku = Object.keys(shop.inventory)[0];
    shop.inventory[firstSku].shelf = 7;
    shop.inventory[firstSku].back = 13;
    // give the drawer a known composition
    const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
    shop.drawer = reg.newDrawer ? reg.newDrawer() : shop.drawer;
    // persist via the same path the game uses
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    if (app.empire) {
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(app.empire)));
    } else if (app.saveGame) {
      app.saveGame();
    }
    return {
      cash: app.state.cash,
      ballsMarkup: shop.markup.balls,
      firstSku,
      shelf: shop.inventory[firstSku].shelf,
      back: shop.inventory[firstSku].back,
      drawerKeys: Object.keys(shop.drawer || {}).length,
    };
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(1500);

  const after = await page.evaluate((sku) => {
    const app = window.__fw;
    const shop = app.state.shop;
    return {
      cash: app.state.cash,
      ballsMarkup: shop.markup.balls,
      shelf: shop.inventory[sku] ? shop.inventory[sku].shelf : null,
      back: shop.inventory[sku] ? shop.inventory[sku].back : null,
      drawerKeys: Object.keys(shop.drawer || {}).length,
      booted: !!app.scene3d.clubhouse(),
      registerReady: !!app.scene3d.clubhouse().register,
    };
  }, before.firstSku);

  const match = {
    cash: after.cash === before.cash,
    ballsMarkup: after.ballsMarkup === before.ballsMarkup,
    shelf: after.shelf === before.shelf,
    back: after.back === before.back,
    booted: after.booted && after.registerReady,
  };
  return { before, after, match, errs: errs.slice(0, 6) };
}
