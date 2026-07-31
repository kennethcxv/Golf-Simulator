async (page) => {
  // BROWSE ON ONE SCREEN, REVIEW ON ANOTHER.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/laptop-cart-flow.js
  //
  // Reported 2026-07-29: "Rework ordering into a real cart flow: browse and add items to
  // cart on one screen, then a SEPARATE cart screen showing the line items, delivery choice,
  // subtotal, taxes and total. Not all on one page."
  //
  // Both halves of "not all on one page" are checked, because only one of them is obvious:
  // the cart screen must HAVE the five things, and the browse screen must no longer have
  // them. A split that adds a second screen while leaving the totals on the first has not
  // moved anything.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // Sit at the laptop the way the player does, with the retry the proven drivers use.
  await page.evaluate(async () => {
    const app = window.__fw;
    const L = await import('/src/data/shopLayout.js');
    const origin = app.scene3d.clubhouse().interior.position;
    const st = app.scene3d.walk.state;
    const laptop = L.FRONT_DESK.laptop;
    const seat = { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
    st.x = seat.x + origin.x;
    st.z = seat.z + origin.z;
    const dx = laptop.x - seat.x;
    const dz = laptop.z - seat.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    st.pitch = Math.atan2(1.06 - 1.62, horizontal);
    const clock = app.state.clock;
    clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 9 * 60;
    app.scene3d.applyTimeWeather(9 * 60, app.state.weather);
  });
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyE');
  let open = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 6000 })
    .then(() => true).catch(() => false);
  if (!open) {
    await page.evaluate(async () => {
      const app = window.__fw;
      const L = await import('/src/data/shopLayout.js');
      const origin = app.scene3d.clubhouse().interior.position;
      const st = app.scene3d.walk.state;
      const laptop = L.FRONT_DESK.laptop;
      st.x = laptop.x + origin.x;
      st.z = laptop.z + 0.95 + origin.z;
      st.yaw = Math.atan2(0, 0.95);
      st.pitch = Math.atan2(1.06 - 1.62, 0.95);
    });
    await page.waitForTimeout(700);
    await page.keyboard.press('KeyE');
    open = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 9000 })
      .then(() => true).catch(() => false);
  }
  await page.waitForFunction(() => {
    const r = document.querySelector('.laptop-screen');
    return r && r.style.display !== 'none';
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1400);

  // The nav lives OUTSIDE .lt-main â€” the first version scoped to .lt-main and timed out
  // looking for the "Pro Shop" nav button, which is in the sidebar.
  const clickText = async (text) => {
    const target = page.locator(`.laptop-screen button:has-text("${text}")`).first();
    await target.click({ timeout: 10000 });
    await page.waitForTimeout(700);
  };

  // Browse: Pro Shop -> Orders & Suppliers, then add two lines with the + buttons.
  await clickText('Pro Shop');
  await clickText('Orders & Suppliers');
  const plusButtons = page.locator('.lt-product .lt-qbtn', { hasText: '+' });
  const plusCount = await plusButtons.count();
  for (const index of [0, 1, 1]) {
    if (index < plusCount) {
      await plusButtons.nth(index).click({ timeout: 8000 });
      await page.waitForTimeout(250);
    }
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'laptop-cart-1-browse.png') });

  const browse = await page.evaluate(() => {
    const main = document.querySelector('.lt-main');
    const text = main?.textContent || '';
    return {
      hasStrip: !!document.querySelector('.lt-cartstrip'),
      stripText: document.querySelector('.lt-cartstripcount')?.textContent || null,
      hasProductGrid: !!document.querySelector('.lt-grid'),
      // The five things that must have MOVED off this screen.
      showsSubtotal: /Subtotal/i.test(text),
      showsTax: /Sales tax/i.test(text),
      showsTotalRow: !!document.querySelector('.lt-carttotal'),
      showsDeliveryChooser: !!document.querySelector('.lt-shipping'),
      showsPlaceOrder: /Place Order/i.test(text),
      lineItemRows: document.querySelectorAll('.lt-cartitem').length,
    };
  });

  // Cross to the cart screen with the button the player uses.
  await clickText('Review cart');
  await page.screenshot({ path: path.join(outDir, 'laptop-cart-2-cart.png') });

  const cartScreen = await page.evaluate(() => {
    const main = document.querySelector('.lt-main');
    const text = main?.textContent || '';
    const lineOf = (label) => {
      for (const row of document.querySelectorAll('.lt-cartline')) {
        if (row.textContent && row.textContent.trim().startsWith(label)) return row.textContent.trim();
      }
      return null;
    };
    return {
      lineItemRows: document.querySelectorAll('.lt-cartitem').length,
      lineItemNames: [...document.querySelectorAll('.lt-cartitemname')].map((n) => n.textContent),
      lineItemSums: [...document.querySelectorAll('.lt-cartitemsum')].map((n) => n.textContent),
      hasDeliveryChooser: !!document.querySelector('.lt-shipping'),
      deliveryOptions: [...document.querySelectorAll('.lt-shiprow .lt-shipname')].map((n) => n.textContent),
      subtotalLine: lineOf('Subtotal'),
      taxLine: lineOf('Sales tax'),
      totalLine: document.querySelector('.lt-carttotal')?.textContent?.trim() || null,
      hasPlaceOrder: /Place Order/i.test(text),
      // The browse grid must NOT be here â€” that is the other half of the split.
      hasProductGrid: !!document.querySelector('.lt-grid'),
      keepShopping: /Keep shopping/i.test(text),
    };
  });

  // Changing the delivery speed must move the total, on this screen, in view.
  const before = cartScreen.totalLine;
  const expressRow = page.locator('.lt-shiprow', { hasText: 'Express' }).first();
  let afterExpress = null;
  if (await expressRow.count()) {
    await expressRow.click({ timeout: 8000 });
    await page.waitForTimeout(700);
    afterExpress = await page.evaluate(() => ({
      totalLine: document.querySelector('.lt-carttotal')?.textContent?.trim() || null,
      chosen: document.querySelector('.lt-shiprow.on .lt-shipname')?.textContent || null,
    }));
    await page.screenshot({ path: path.join(outDir, 'laptop-cart-3-express.png') });
  }

  // THE FOLD, MEASURED WITH A FULL CART.
  //
  // Reported 2026-07-29: "Place Order sits below the lid's fold with a full cart. Fix it â€” a
  // confirm button you have to scroll to find is the same defect as the shipping options
  // sitting under the total." So: load the basket up to eight lines, reset the scroll, and
  // compare the button's box against the scroller's box. Then scroll to the bottom and check
  // it is STILL in view â€” that is the sticky rail doing its job, not a short page.
  // The express step left us ON the cart screen; the + buttons live on browse.
  await clickText('Keep shopping');
  const addAll = page.locator('.lt-product .lt-qbtn', { hasText: '+' });
  const addable = await addAll.count();
  for (let i = 2; i < Math.min(addable, 8); i += 1) {
    await addAll.nth(i).click({ timeout: 8000 });
    await page.waitForTimeout(140);
  }
  await clickText('Review cart');
  const foldCheck = await page.evaluate(() => {
    const content = document.querySelector('.lt-content');
    content.scrollTop = 0;
    const button = [...document.querySelectorAll('.lt-primary')]
      .find((b) => b.textContent === 'Place Order');
    const box = button?.getBoundingClientRect?.() || null;
    const view = content?.getBoundingClientRect?.() || null;
    const atTop = {
      lines: document.querySelectorAll('.lt-cartitem').length,
      buttonBottom: box ? Math.round(box.bottom) : null,
      viewBottom: view ? Math.round(view.bottom) : null,
      inViewAtTop: !!(box && view && box.top >= view.top - 2 && box.bottom <= view.bottom + 2),
      contentScrollable: content.scrollHeight > content.clientHeight + 4,
    };
    content.scrollTop = content.scrollHeight;
    const box2 = button?.getBoundingClientRect?.() || null;
    return {
      ...atTop,
      inViewAtBottom: !!(box2 && view && box2.top >= view.top - 2 && box2.bottom <= view.bottom + 2),
    };
  });
  await page.screenshot({ path: path.join(outDir, 'laptop-cart-4-full-fold.png') });

  const findings = {
    // The cart screen HAS the five things the brief lists.
    cartListsLineItems: cartScreen.lineItemRows > 0,
    cartHasDeliveryChoice: cartScreen.hasDeliveryChooser && cartScreen.deliveryOptions.length === 2,
    cartHasSubtotal: !!cartScreen.subtotalLine,
    cartHasTax: !!cartScreen.taxLine,
    cartHasTotal: !!cartScreen.totalLine,
    cartHasPlaceOrder: cartScreen.hasPlaceOrder,
    // â€¦and the browse screen no longer does. "Not all on one page" is a claim about BOTH.
    browseHasNoMoney: !browse.showsSubtotal && !browse.showsTax
      && !browse.showsTotalRow && !browse.showsDeliveryChooser && !browse.showsPlaceOrder,
    browseStillHasTheGrid: browse.hasProductGrid,
    browseShowsBasketCount: !!browse.stripText,
    cartHasNoProductGrid: !cartScreen.hasProductGrid,
    cartCanReturnToBrowsing: cartScreen.keepShopping,
    // Changing the delivery speed changes the total where the player can see it.
    totalRespondsToDelivery: !!afterExpress && afterExpress.totalLine !== before,
    totalBefore: before,
    totalAfterExpress: afterExpress?.totalLine ?? null,
    // Full cart: the button is inside the lid before any scroll, the page has real overflow
    // (so the check is not passing on a short page), and the rail sticks when scrolled.
    fullCartHasManyLines: foldCheck.lines >= 6,
    placeOrderAboveTheFold: foldCheck.inViewAtTop,
    theCheckHadSomethingToProve: foldCheck.contentScrollable,
    placeOrderStaysWhileScrolling: foldCheck.inViewAtBottom,
  };

  const result = {
    what: 'the laptop ordering split: browse screen, cart screen, and what moved between them',
    browse,
    cartScreen,
    afterExpress,
    foldCheck,
    findings,
    shots: ['laptop-cart-1-browse.png', 'laptop-cart-2-cart.png', 'laptop-cart-3-express.png', 'laptop-cart-4-full-fold.png'],
    errs: errs.slice(0, 12),
    ok: Object.entries(findings)
      .filter(([key]) => !key.startsWith('total') || key === 'totalRespondsToDelivery')
      .every(([, value]) => value === true)
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'laptop-cart-flow.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
