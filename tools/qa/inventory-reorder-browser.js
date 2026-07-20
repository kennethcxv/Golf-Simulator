async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.QA_OUTPUT_DIR
    || 'qa/inventory-delivery-loop/reorder');
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));
  const shot = (name) => page.screenshot({ path: path.join(out, name) });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1600);

  const before = await page.evaluate(async () => {
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const app = window.__fw;
    app.state.shop.unlockedTier = 3;
    app.state.cash = 250000;
    app.empire.cash = 250000;
    const clubhouse = app.scene3d.clubhouse();
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 8.45;
    walk.z = origin.z + 4.5;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
    const suggestion = lifecycle.reorderSuggestion(app.state, 'balls2');
    return {
      cash: app.state.cash,
      position: lifecycle.inventoryPosition(app.state, 'balls2'),
      suggestion,
    };
  });
  if (!before.suggestion.outOfStock || before.suggestion.suggestedQuantity <= 0) {
    throw new Error(`Expected balls2 to begin out of stock: ${JSON.stringify(before)}`);
  }

  await page.waitForFunction(() => /laptop/i.test(
    window.__fw.scene3d.walk.getFocusLabel?.() || '',
  ), null, { timeout: 10000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
  await page.locator('.lt-navbtn').filter({ hasText: 'Inventory' }).first().click();
  const inventoryRow = page.locator('.lt-invtable tbody tr').filter({ hasText: 'Tour-soft dozen' });
  await inventoryRow.waitFor({ state: 'visible', timeout: 10000 });
  const lowStockRow = (await inventoryRow.innerText()).replace(/\s+/g, ' ').trim();
  await shot('01-low-stock-inventory.png');

  await page.locator('.lt-navbtn').filter({ hasText: 'Supplier' }).first().click();
  const product = page.locator('.lt-product').filter({ hasText: 'Tour-soft dozen' });
  await product.waitFor({ state: 'visible', timeout: 10000 });
  const plus = product.locator('.lt-qbtn').filter({ hasText: '+' });
  for (let unit = 0; unit < 12; unit += 1) await plus.click();
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('.lt-product')];
    const card = cards.find((node) => /Tour-soft dozen/.test(node.textContent || ''));
    return card && card.querySelector('.lt-qty')?.textContent === '12';
  });
  await shot('02-explicit-reorder-basket.png');

  const placeOrder = page.getByRole('button', { name: /Place order —/ }).first();
  await placeOrder.click();
  const confirm = page.getByRole('button', { name: 'Place the order', exact: true });
  await confirm.waitFor({ state: 'visible', timeout: 10000 });
  await confirm.click();
  await page.waitForFunction(() => window.__fw.state.shop.orders.some((order) =>
    order.lines?.some((line) => line.skuId === 'balls2' && line.quantity === 12)), null,
  { timeout: 10000 });
  await page.waitForTimeout(450);
  await shot('03-reorder-submitted.png');

  const after = await page.evaluate(async () => {
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const app = window.__fw;
    const orders = app.state.shop.orders.filter((order) =>
      order.lines?.some((line) => line.skuId === 'balls2'));
    const order = orders[0];
    const reconciliation = lifecycle.reconcileInventory(app.state, {
      qa: true,
      context: 'browser-reorder',
    });
    return {
      cash: app.state.cash,
      orderCount: orders.length,
      order: order && {
        id: order.id,
        supplierId: order.supplierId,
        supplier: order.supplier,
        lines: order.lines,
        goodsCost: order.goods,
        shippingCost: order.shippingCost,
        totalCost: order.totalCost,
        createdMin: order.createdMin,
        state: order.state,
        processingState: order.processingState,
        dispatchState: order.dispatchState,
        deliveredState: order.deliveredState,
        receivingState: order.receivingState,
        dispatchMin: order.dispatchMin,
        deliveryEtaMin: order.deliveryEtaMin,
        boxIds: order.boxIds,
        remainingUnreceivedQuantity: order.remainingUnreceivedQuantity,
        completionState: order.completionState,
      },
      position: lifecycle.inventoryPosition(app.state, 'balls2'),
      suggestion: lifecycle.reorderSuggestion(app.state, 'balls2'),
      reconciled: reconciliation.ok,
      discrepancies: reconciliation.discrepancies,
    };
  });
  const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
  const charged = before.cash - after.cash;
  const ok = errors.length === 0
    && nonAborted.length === 0
    && after.reconciled
    && after.orderCount === 1
    && after.order
    && after.order.lines.length === 1
    && after.order.lines[0].quantity === 12
    && charged === after.order.totalCost
    && after.position.inTransit === 12
    && after.suggestion.incoming === 12
    && Number.isFinite(after.suggestion.earliestEtaMin);

  return {
    ok,
    lowStockRow,
    before,
    after,
    charged,
    errors,
    failedRequests,
    nonAbortedFailedRequests: nonAborted,
  };
}
